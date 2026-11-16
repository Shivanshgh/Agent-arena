$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'

if (Test-Path -LiteralPath $envFile) {
  throw 'A .env file already exists. It was left unchanged; add DATABASE_URL to it locally instead.'
}
git -C $projectRoot check-ignore -q .env
if ($LASTEXITCODE -ne 0) { throw '.env is not ignored by Git; refusing to write credentials.' }

$securePassword = Read-Host 'Enter the local PostgreSQL postgres password (input is hidden)' -AsSecureString
$pointer = [IntPtr]::Zero
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ([string]::IsNullOrWhiteSpace($password)) { throw 'Password cannot be empty.' }
  $encodedPassword = [Uri]::EscapeDataString($password)
  $url = "postgresql://postgres:$encodedPassword@127.0.0.1:5432/agentarena_test?schema=public"
  [IO.File]::WriteAllText($envFile, "DATABASE_URL=`"$url`"$([Environment]::NewLine)", [Text.UTF8Encoding]::new($false))
  'Local PostgreSQL URL saved to ignored .env. Password was not displayed.'
}
finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if ($securePassword) { $securePassword.Dispose() }
  $password = $null
  $encodedPassword = $null
  $url = $null
}
