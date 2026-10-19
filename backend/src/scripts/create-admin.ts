/**
 * إنشاء أول مدير نظام — الطريقة الآمنة الوحيدة لتهيئة الحساب الأول
 * (لا توجد حسابات افتراضية ولا كلمات مرور مضمّنة في الشيفرة).
 *
 * الاستخدام:
 *   node dist/scripts/create-admin.js --username admin [--display-name "مدير النظام"]
 *   node dist/scripts/create-admin.js --username admin --password-stdin
 *   ADMIN_PASSWORD=... node dist/scripts/create-admin.js --username admin   (للأتمتة فقط)
 */
import { createInterface } from 'node:readline';
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { ConfigError } from '../lib/errors.js';
import { hashPassword, validatePassword, validateUsername } from '../lib/security.js';
import { writeAudit } from '../services/audit.js';
import { createUser, findUserByUsername } from '../services/users.js';

interface CliOptions {
  username?: string;
  displayName?: string;
  passwordStdin: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { passwordStdin: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--username') {
      options.username = argv[index + 1];
      index += 1;
    } else if (arg === '--display-name') {
      options.displayName = argv[index + 1];
      index += 1;
    } else if (arg === '--password-stdin') {
      options.passwordStdin = true;
    } else {
      throw new ConfigError(`وسيط غير معروف: ${arg}`);
    }
  }
  return options;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new ConfigError('الإدخال التفاعلي غير متاح. استخدم --password-stdin أو متغيّر ADMIN_PASSWORD.'));
      return;
    }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new ConfigError('أُلغي الإدخال.'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
        } else if (char >= ' ') {
          value += char;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function readLineFromStdin(): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  return new Promise((resolve) => {
    readline.once('line', (line) => {
      readline.close();
      resolve(line.trim());
    });
  });
}

async function resolvePassword(options: CliOptions): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  if (options.passwordStdin) return readLineFromStdin();
  const password = await promptHidden('كلمة مرور المدير: ');
  const confirm = await promptHidden('تأكيد كلمة المرور: ');
  if (password !== confirm) throw new ConfigError('كلمتا المرور غير متطابقتين.');
  return password;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    const username = (options.username ?? '').trim();
    if (!username) {
      throw new ConfigError('حدد اسم المستخدم: --username <name>');
    }
    validateUsername(username);
    const password = await resolvePassword(options);
    validatePassword(password);

    const existing = await findUserByUsername(pool, username);
    if (existing) {
      throw new ConfigError(`المستخدم «${username}» موجود بالفعل.`);
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser(pool, {
      username,
      displayName: (options.displayName ?? username).trim(),
      role: 'admin',
      passwordHash,
    });
    await writeAudit(
      pool,
      {
        actorUserId: null,
        actorUsername: null,
        action: 'admin.bootstrap',
        entityType: 'user',
        entityId: user.id,
        details: { username: user.username },
      },
      { ip: null, userAgent: 'create-admin-cli' },
    );
    console.log(`تم إنشاء مدير النظام «${user.username}» بنجاح.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
