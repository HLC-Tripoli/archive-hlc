import { spawn } from 'node:child_process';

/**
 * أخطاء التحسين لا تُعرض للمستخدم ولا تُسجَّل بنصّها الخام. نحتفظ فقط
 * بسبب مختصر (timeout/tool_unavailable/exit_code) كي يبقى القرار آمناً
 * وقابلاً للتشخيص دون كشف مسارات محلية أو مخرجات أدوات قد تحتوي محتوى.
 */
export class OptimizationError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'OptimizationError';
    this.reason = reason;
  }
}

export interface ProcessResult {
  code: number;
  stdout: Buffer;
  stderrLength: number;
}

export interface RunProcessOptions {
  /** وقت مطلق (Date.now) تنتهي عنده العملية كلها. */
  deadline: number;
  /** أقصى زمن لعملية واحدة، إضافة إلى الموعد النهائي الكلي. */
  maxTimeoutMs?: number;
  /** أقصى حجم لـ stdout (JSON من qpdf مثلاً). */
  maxStdoutBytes?: number;
}

const DEFAULT_MAX_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_STDOUT_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;

export function remainingMs(deadline: number): number {
  return deadline - Date.now();
}

/**
 * تشغيل أداة خارجية دون shell، مع سقف زمني وسقف للذاكرة.
 * لا نمرّر أي مدخلات من المستخدم كوسائط؛ المسارات كلها مولّدة داخلياً.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  const remaining = remainingMs(options.deadline);
  if (remaining <= 0) return Promise.reject(new OptimizationError('timeout'));
  const timeoutMs = Math.max(1, Math.min(remaining, options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS));
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;

  return new Promise<ProcessResult>((resolve, reject) => {
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
      },
    });

    const finish = (error?: Error, result?: ProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new OptimizationError('timeout'));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        child.kill('SIGKILL');
        finish(new OptimizationError('output_limit'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      // نستهلك stderr كاملاً كي لا يتوقف الطفل، لكن نحتفظ بالطول فقط.
      stderrBytes = Math.min(stderrBytes + chunk.length, MAX_STDERR_BYTES);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(new OptimizationError(error.code === 'ENOENT' ? 'tool_unavailable' : 'spawn_failed'));
    });
    child.on('close', (code) => {
      finish(undefined, {
        code: code ?? -1,
        stdout: Buffer.concat(stdout, stdoutBytes),
        stderrLength: stderrBytes,
      });
    });
  });
}
