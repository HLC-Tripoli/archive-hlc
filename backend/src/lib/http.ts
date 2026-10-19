import type { AppConfig } from '../config.js';

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export interface OriginCheckInput {
  origin?: string | undefined;
  referer?: string | undefined;
  host?: string | undefined;
  protocol: string;
}

/**
 * فحص المصدر للطلبات المتغيّرة (POST/PUT/PATCH/DELETE):
 *   * إذا حُدد PUBLIC_ORIGIN في الإعدادات فهو المرجع الوحيد المقبول.
 *   * وإلا يقارن مع ترويسة Host الحالية (مع البروتوكول بعد الوكيل العكسي).
 *   * غياب ترويستي Origin و Referer يعني عميلاً غير متصفح؛ لا يُرفض الطلب،
 *     بينما تبقى حماية CSRF مطبَّقة على كل الطلبات المرتبطة بجلسة.
 */
export function isOriginAllowed(input: OriginCheckInput, config: Pick<AppConfig, 'publicOrigin'>): boolean {
  const expected =
    config.publicOrigin ?? (input.host ? `${input.protocol}://${input.host}` : null);
  if (!expected) return false;
  if (input.origin !== undefined && input.origin !== '') {
    return normalizeOrigin(input.origin) === expected;
  }
  if (input.referer !== undefined && input.referer !== '') {
    return normalizeOrigin(input.referer) === expected;
  }
  return true;
}
