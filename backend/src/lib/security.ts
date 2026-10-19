import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { ApiError } from './errors.js';

/** يولّد قيمة عشوائية آمنة (64 حرفاً سداسياً عشرياً). */
export function randomToken(): string {
  return randomBytes(32).toString('hex');
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw ApiError.badRequest('weak_password', 'كلمة المرور يجب أن تكون بين 8 و 200 حرفاً.');
  }
}

export function validateUsername(username: unknown): asserts username is string {
  if (typeof username !== 'string' || !/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    throw ApiError.badRequest(
      'invalid_username',
      'اسم المستخدم يجب أن يتكوّن من 3 إلى 32 حرفاً إنجليزياً أو رقماً أو الرموز (. _ -).',
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * التحقق من كلمة مرور وهمية عند عدم وجود المستخدم،
 * لتحقيق زمن استجابة متقارب ومنع استنتاج أسماء المستخدمين.
 */
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHashPromise ??= hashPassword('hlc-timing-equalizer-0000000000');
  const hash = await dummyHashPromise;
  await verifyPassword(hash, password);
  return false;
}
