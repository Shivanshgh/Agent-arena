[CmdletBinding()]
param([switch]$ApplyPendingMigrations)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env'
Set-Location $repoRoot

function Read-EnvValue([string]$Name) {
  $existing = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($existing)) { return $existing }
  if (-not (Test-Path -LiteralPath $envFile)) { return $null }
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match ('^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*?)\s*$')) {
      $value = $Matches[1]
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      return $value
    }
  }
  return $null
}

function Assert-TestDatabaseTarget {
  if (-not $env:DATABASE_URL) { throw 'DATABASE_URL is missing from the process environment and .env.' }
  try { $uri = [Uri]$env:DATABASE_URL } catch { throw 'DATABASE_URL is not a valid PostgreSQL URL; refusing to continue.' }
  $username = [Uri]::UnescapeDataString(($uri.UserInfo -split ':', 2)[0])
  $database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
  $schema = 'public'
  if ($uri.Query -match '(?:\?|&)schema=([^&]+)') { $schema = [Uri]::UnescapeDataString($Matches[1]) }
  if ($uri.Scheme -cnotin @('postgresql', 'postgres') -or $uri.Host -cne '127.0.0.1' -or $uri.Port -ne 5432 -or $username -cne 'postgres' -or $database -cne 'agentarena_test' -or $schema -cne 'public') {
    throw 'Refusing database operation: DATABASE_URL must target postgres@127.0.0.1:5432/agentarena_test?schema=public.'
  }
}

function Invoke-NativeCommand([string]$File, [string[]]$Arguments) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $lines = & $File @Arguments 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  $text = ($lines | ForEach-Object { $_.ToString() }) -join "`n"
  return [pscustomobject]@{ ExitCode = $code; Output = $text }
}

function Invoke-TargetCheck {
  Assert-TestDatabaseTarget
  $result = Invoke-NativeCommand 'node' @((Join-Path $PSScriptRoot 'postgres-target-check.mjs'))
  if ($result.Output) { Write-Host ($result.Output -replace '(?i)(postgres(?:ql)?://)[^@\s]+@', '$1[credentials-redacted]@') }
  if ($result.ExitCode -ne 0) { throw 'PostgreSQL connection/identity check failed; stopped before any migration or test setup.' }
}

function Get-HistorySnapshot([switch]$All) {
  Invoke-TargetCheck
  if ($All) { $result = Invoke-NativeCommand 'node' @((Join-Path $PSScriptRoot 'postgres-history-snapshot.mjs'), '--all') }
  else { $result = Invoke-NativeCommand 'node' @((Join-Path $PSScriptRoot 'postgres-history-snapshot.mjs')) }
  if ($result.ExitCode -ne 0) { throw 'Could not capture the read-only PostgreSQL history snapshot.' }
  try { return ($result.Output.Trim() | ConvertFrom-Json) }
  catch { throw 'History snapshot did not return valid JSON; stopped without continuing.' }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js and npm are required.' }
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules/@prisma/client'))) { throw 'Dependencies are missing. Run npm ci first.' }

$databaseUrl = Read-EnvValue 'DATABASE_URL'
if (-not $databaseUrl) { throw 'DATABASE_URL is missing from .env and the current PowerShell environment.' }
$env:DATABASE_URL = $databaseUrl
Assert-TestDatabaseTarget

Write-Host 'Step 1: Verify live PostgreSQL target and connectivity (read-only).'
Invoke-TargetCheck

$secretKey = Read-EnvValue 'AGENTARENA_SECRET_KEY'
if ($secretKey) {
  if ($secretKey -notmatch '^[0-9a-fA-F]{64}$') { throw 'Configured AGENTARENA_SECRET_KEY is invalid; no migration or test setup was run.' }
  $env:AGENTARENA_SECRET_KEY = $secretKey
} else {
  # The integration suite uses a unique temporary owner and removes its records.
  # This ephemeral key is inherited only by this PowerShell process and its children.
  $randomBytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
  $env:AGENTARENA_SECRET_KEY = ([BitConverter]::ToString($randomBytes)).Replace('-', '').ToLowerInvariant()
  [Array]::Clear($randomBytes, 0, $randomBytes.Length)
  Write-Host 'No saved application secret key found; using a temporary process-only key for disposable integration fixtures. It is not written to .env or printed.'
}

Write-Host "`nStep 2: Read migration status (no schema changes)."
$statusResult = Invoke-NativeCommand (Join-Path $repoRoot 'node_modules/.bin/prisma.cmd') @('migrate', 'status')
$statusOutput = $statusResult.Output
$statusCode = $statusResult.ExitCode
$statusOutput = [regex]::Replace($statusOutput, ([char]27 + '\[[0-?]*[ -/]*[@-~]'), '')
Write-Host ($statusOutput -replace '(?i)(postgres(?:ql)?://)[^@\s]+@', '$1[credentials-redacted]@')
$statusHasPending = $statusOutput -match '(?i)not yet been applied'
if ($statusCode -ne 0 -or $statusHasPending) {
  $section = [regex]::Match($statusOutput, '(?is)Following.*?not yet been applied:\s*(.*?)(?:\r?\n\s*\r?\n|$)')
  $pendingNames = @()
  if ($section.Success) {
    $pendingNames = @([regex]::Matches($section.Groups[1].Value, '(?m)^\s*(\d{14}_[A-Za-z0-9_-]+)\s*$') | ForEach-Object { $_.Groups[1].Value })
  }
  if (-not $pendingNames.Count) { throw 'Migration status failed or reported an unrecognized state. No migration or test was run.' }
  if (-not $ApplyPendingMigrations) {
    Write-Host 'Pending migration(s) identified; none applied. Review the list, then rerun with -ApplyPendingMigrations if approved.'
    exit 2
  }
  if ($pendingNames.Count -ne 1 -or $pendingNames[0] -cne '20261120120000_model_benchmarking') {
    throw 'Only the reviewed 20261120120000_model_benchmarking migration is eligible for this runner. Other pending migrations require separate review; none applied.'
  }

  Write-Host 'MIGRATION IMPACT: this adds provider/evaluation enums and four model tables, adds BenchmarkTask.evaluationStrategy with CODE_UNVERIFIED for existing tasks, and allows existing ExecutionEvaluation accuracyScore/overallScore to be NULL. It drops or deletes no tables or rows. The schema changes and may briefly lock affected tables.'
  $migrationConfirmation = Read-Host 'Type APPLY agentarena_test to apply this one reviewed pending migration'
  if ($migrationConfirmation -cne 'APPLY agentarena_test') { Write-Host 'Cancelled; no migration was applied.'; exit 0 }

  $beforeMigration = Get-HistorySnapshot
  Invoke-TargetCheck
  $migrationResult = Invoke-NativeCommand 'npm.cmd' @('run', 'prisma:migrate:deploy')
  if ($migrationResult.Output) { Write-Host ($migrationResult.Output -replace '(?i)(postgres(?:ql)?://)[^@\s]+@', '$1[credentials-redacted]@') }
  if ($migrationResult.ExitCode -ne 0) { throw 'Migration deployment failed. Stop and inspect Prisma migration status; do not reset the database.' }
  $afterMigration = Get-HistorySnapshot
  $beforeJson = ConvertTo-Json -InputObject $beforeMigration -Depth 10 -Compress
  $afterJson = ConvertTo-Json -InputObject $afterMigration -Depth 10 -Compress
  if ($beforeJson -cne $afterJson) { throw 'Historical HTTP data snapshot changed during migration. No repair or deletion was attempted; inspect agentarena_test.' }
  Write-Host 'PASS: historical HTTP table counts and content hashes match across migration.'
}

$snapshotBefore = Get-HistorySnapshot
Write-Host ("`nRead-only historical HTTP-data snapshot captured: " + (($snapshotBefore.tables.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value.count)" }) -join ', '))

Write-Host "`nStep 3: Validate schema and generate Prisma client."
$validationResult = Invoke-NativeCommand 'npm.cmd' @('run', 'prisma:validate')
if ($validationResult.Output) { Write-Host ($validationResult.Output -replace '(?i)(postgres(?:ql)?://)[^@\s]+@', '$1[credentials-redacted]@') }
if ($validationResult.ExitCode -ne 0) { throw 'Prisma validation failed.' }
$generationResult = Invoke-NativeCommand 'npm.cmd' @('run', 'prisma:generate')
if ($generationResult.Output) { Write-Host ($generationResult.Output -replace '(?i)(postgres(?:ql)?://)[^@\s]+@', '$1[credentials-redacted]@') }
if ($generationResult.ExitCode -ne 0) { throw 'Prisma generation failed.' }

$snapshotAll = Get-HistorySnapshot -All
Write-Host ("`nBaseline snapshot captured for existing HTTP and model data: " + (($snapshotAll.tables.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value.count)" }) -join ', '))

Write-Host "`nImpact before PostgreSQL integration tests: the test creates uniquely named temporary accounts, agents, tasks, runs, provider credentials, and evaluations. Its cleanup deletes only records owned by those unique temporary accounts; it does not reset the database. Stop any other local AgentArena API/worker first so snapshots are stable."
$testConfirmation = Read-Host 'Type RUN tests on agentarena_test to continue'
if ($testConfirmation -cne 'RUN tests on agentarena_test') { Write-Host 'Cancelled; no integration tests were run.'; exit 0 }

Invoke-TargetCheck
$testResult = Invoke-NativeCommand 'npm.cmd' @('run', 'test:postgres')
if ($testResult.Output) { Write-Host ($testResult.Output -replace '(?i)(postgres(?:ql)?://)[^@\s]+@', '$1[credentials-redacted]@') }
$testExitCode = $testResult.ExitCode
$snapshotAfter = Get-HistorySnapshot -All
$same = ConvertTo-Json -InputObject $snapshotAll -Depth 10 -Compress
$after = ConvertTo-Json -InputObject $snapshotAfter -Depth 10 -Compress
if ($same -cne $after) {
  Write-Error 'Historical or pre-existing model data snapshot changed. No automatic repair/deletion was attempted; inspect agentarena_test before further tests.'
  exit 3
}
Write-Host 'PASS: existing HTTP-agent data and pre-existing model data are unchanged after integration-test cleanup.'
if ($testExitCode -ne 0) { throw "PostgreSQL integration tests failed with exit code $testExitCode. Snapshot remained unchanged." }
Write-Host 'PASS: PostgreSQL model and HTTP-agent integration tests completed; test-owned temporary records were cleaned up.'
