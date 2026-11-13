import fs from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execAsync = promisify(exec);

export interface DockerExecutionOptions {
  image?: string;
  command?: string[];
  code?: string;
  timeoutMs?: number;
  maxOutputSizeBytes?: number;
}

export interface DockerExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  isolationApplied: boolean;
  errorMessage?: string;
}

// Pinned secure sandbox images
const digestPinnedImage = (value?: string): string | undefined => value && /^[^\s@]+@sha256:[a-f0-9]{64}$/i.test(value) ? value : undefined;
export const ALLOWED_DOCKER_IMAGES: Record<string, string> = Object.fromEntries(
  Object.entries({
    python: digestPinnedImage(process.env.AGENTARENA_DOCKER_IMAGE_PYTHON),
    typescript: digestPinnedImage(process.env.AGENTARENA_DOCKER_IMAGE_NODE),
    javascript: digestPinnedImage(process.env.AGENTARENA_DOCKER_IMAGE_NODE),
  }).filter((entry): entry is [string, string] => Boolean(entry[1]))
);

export class DockerExecutor {
  /**
   * Inspects Docker daemon availability in the current container environment
   */
  static async checkAvailability(): Promise<{
    available: boolean;
    status: 'AVAILABLE' | 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE' | 'DISABLED';
    reason: string;
    version?: string;
  }> {
    // 1. Check if docker socket exists
    const socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
    const socketExists = fs.existsSync(socketPath);
    if (socketExists && !process.env.DOCKER_HOST) process.env.DOCKER_HOST = `unix://${socketPath}`;

    if (!socketExists) {
      return {
        available: false,
        status: 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE',
        reason: 'Docker socket (/var/run/docker.sock) is not accessible in this container environment.',
      };
    }

    // 2. Try pinging docker daemon CLI
    try {
      const { stdout } = await execAsync('docker info --format \"{{.ServerVersion}}\"', { timeout: 5000 });
      return {
        available: true,
        status: 'AVAILABLE',
        reason: 'Docker daemon responded to docker info; isolation still requires workload testing.',
        version: stdout.trim(),
      };
    } catch (err: any) {
      return {
        available: false,
        status: 'BLOCKED_BY_EXTERNAL_INFRASTRUCTURE',
        reason: `Docker binary or daemon connection failed: ${err.message}`,
      };
    }
  }

  /**
   * Returns security parameters enforced on any isolated container execution
   */
  static getSecurityProfile(): {
    networkDisabled: boolean;
    nonRootUser: boolean;
    memoryLimit: string;
    cpuLimit: string;
    readOnlyRoot: boolean;
    capDrop: string;
    pidsLimit: number;
  } {
    return {
      networkDisabled: true,
      nonRootUser: true,
      memoryLimit: '512m',
      cpuLimit: '1.0',
      readOnlyRoot: true,
      capDrop: 'ALL',
      pidsLimit: 64,
    };
  }

  /**
   * Executes code inside an isolated Docker sandbox with strict security constraints
   */
  static async executeCode(
    language: string,
    code: string,
    options: DockerExecutionOptions = {}
  ): Promise<DockerExecutionResult> {
    const normalizedLanguage = language.trim().toLowerCase();
    const image = ALLOWED_DOCKER_IMAGES[normalizedLanguage];
    if (!image) return { success: false, exitCode: 2, stdout: '', stderr: `Unsupported language or missing digest-pinned image: ${language}`, durationMs: 0, timedOut: false, isolationApplied: false, errorMessage: 'Unsupported language or execution image is not configured' };

    const availability = await this.checkAvailability();
    if (!availability.available) {
      return {
        success: false,
        exitCode: 126,
        stdout: '',
        stderr: availability.reason,
        durationMs: 0,
        timedOut: false,
        isolationApplied: false,
        errorMessage: availability.reason,
      };
    }

    const timeoutMs = options.timeoutMs || 30_000;
    const maxOutputSizeBytes = options.maxOutputSizeBytes || 100_000;

    const startTime = performance.now();

    // Security flags according to Stage 7 specification:
    // --rm: remove container upon exit
    // --network=none: drop all external network access
    // --user=1000:1000: non-root user
    // --cap-drop=ALL: drop all capabilities
    // --memory=512m: memory limit
    // --cpus=1.0: CPU cap
    // --read-only: read-only rootfs
    // --tmpfs: temporary memory mount for script execution
    const containerName = `agentarena-${crypto.randomUUID()}`;
    const dockerArgs = [
      'run',
      '--name', containerName,
      '--rm',
      '--network=none',
      '--user=1000:1000',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true',
      '--memory=512m',
      '--cpus=1.0',
      '--pids-limit=64',
      '--read-only',
      '--tmpfs=/tmp:rw,noexec,nosuid,size=64m',
      '-i',
      image,
    ];

    if (normalizedLanguage === 'python') {
      dockerArgs.push('python3', '-c', code);
    } else {
      dockerArgs.push('node', '-e', code);
    }

    return new Promise((resolve) => {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let outputExceeded = false;
      let timedOut = false;
      const appendBounded = (current: Buffer, chunk: Buffer): Buffer => {
        const remaining = Math.max(0, maxOutputSizeBytes - current.length);
        if (chunk.length > remaining) outputExceeded = true;
        return Buffer.concat([current, chunk.subarray(0, remaining)]);
      };

      const proc = spawn('docker', dockerArgs, { timeout: timeoutMs });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
        void execAsync(`docker rm -f ${containerName}`, { timeout: 5000 }).catch(() => undefined);
      }, timeoutMs);

      proc.stdout.on('data', chunk => {
        stdout = appendBounded(stdout, Buffer.from(chunk));
        if (outputExceeded) { proc.kill('SIGKILL'); void execAsync(`docker rm -f ${containerName}`, { timeout: 5000 }).catch(() => undefined); }
      });

      proc.stderr.on('data', chunk => {
        stderr = appendBounded(stderr, Buffer.from(chunk));
        if (outputExceeded) { proc.kill('SIGKILL'); void execAsync(`docker rm -f ${containerName}`, { timeout: 5000 }).catch(() => undefined); }
      });

      proc.on('close', code => {
        clearTimeout(timer);
        const durationMs = Math.round(performance.now() - startTime);

        resolve({
          success: code === 0 && !timedOut,
          exitCode: code ?? 1,
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
          durationMs,
          timedOut,
          isolationApplied: true,
          errorMessage: timedOut ? `Execution timed out after ${timeoutMs}ms` : outputExceeded ? `Execution output exceeded ${maxOutputSizeBytes} bytes` : undefined,
        });
      });

      proc.on('error', err => {
        clearTimeout(timer);
        resolve({
          success: false,
          exitCode: 1,
          stdout: stdout.toString('utf8'),
          stderr: err.message,
          durationMs: Math.round(performance.now() - startTime),
          timedOut: false,
          isolationApplied: false,
          errorMessage: err.message,
        });
      });
    });
  }
}
