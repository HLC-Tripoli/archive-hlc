import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs';
import { access, lstat, mkdir, open, realpath, rename, rmdir, rm, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ApiError, ConfigError } from '../../lib/errors.js';
import type { StorageProvider, StoredObject } from './types.js';

const MAX_KEY_LENGTH = 512;
const MAX_SEGMENT_LENGTH = 128;

/**
 * المفاتيح الداخلية التي يولّدها الخادم فقط (documents/<uuid>/<uuid>.<ext>).
 * نرفض أي مفتاح يخرج عن هذه القواعد: مسارات مطلقة، أو مقاطع "." / ".."،
 * أو فواصل Windows، أو رموز مشفّرة مثل ‎%2e‎، أو أحرف تحكّم — قبل أي لمس لنظام الملفات.
 */
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidStorageKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  const segments = key.split('/');
  for (const segment of segments) {
    if (segment.length === 0 || segment.length > MAX_SEGMENT_LENGTH) return false;
    if (!SEGMENT_PATTERN.test(segment)) return false;
  }
  return true;
}

function invalidKeyError(): ApiError {
  return ApiError.badGateway(
    'storage_key_invalid',
    'تعذّر الوصول إلى المرفق في التخزين المحلي. راجع مسؤول النظام.',
  );
}

function withCause(apiError: ApiError, cause: unknown): ApiError {
  (apiError as { cause?: unknown }).cause = cause;
  return apiError;
}

/**
 * مزوّد التخزين المحلي: يحفظ المرفقات على نظام الملفات تحت جذر مخصص
 * (‎/data/uploads‎ افتراضياً، يُوصَل من المضيف عبر Compose كحجم دائم).
 *
 * الضمانات:
 *   - المفاتيح نسبية وداخلية فقط؛ لا يُشتق أي مسار من اسم ملف قدّمه العميل.
 *   - التحقق من المفتاح + احتواء المسار المحلول داخل الجذر + رفض الروابط الرمزية
 *     يمنع أي خروج عن مجلد التخزين (‎..‎، مسار مطلق، فواصل Windows، ‎%2e‎، symlink).
 *   - الكتابة عبر ملف مؤقت بعلامة حصرية ثم إعادة تسمية ذرّية، دون استبدال ملف موجود.
 *   - العمليات كلها تدفّقية (streams) ولا تُحمَّل الملفات كاملةً في الذاكرة.
 *   - أخطاء التخزين تُعاد بصيغة ApiError (502) كي تبقى استجابة الواجهة ثابتة مهما كان المزوّد.
 */
export class LocalFilesystemStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly rootDir: string;

  constructor(rootDir: string) {
    if (typeof rootDir !== 'string' || rootDir.trim() === '') {
      throw new ConfigError('UPLOADS_DIR must be a non-empty directory path');
    }
    const resolved = path.resolve(rootDir.trim());
    if (resolved === path.parse(resolved).root) {
      throw new ConfigError('UPLOADS_DIR must not point at the filesystem root');
    }
    this.rootDir = resolved;
  }

  /** يهيّئ مجلد التخزين عند الإقلاع: إنشاؤه إن لزم والتحقق من إمكانية الكتابة فيه. */
  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o750 });
    const info = await stat(this.rootDir);
    if (!info.isDirectory()) {
      throw new ConfigError(`UPLOADS_DIR is not a directory: ${this.rootDir}`);
    }
    await access(this.rootDir, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  }

  /** فحص صحة التخزين: وجود المجلد وقابلية الكتابة الفعلية فيه (اختبار كتابة مؤقت). */
  async health(): Promise<boolean> {
    try {
      const info = await stat(this.rootDir);
      if (!info.isDirectory()) return false;
      const probePath = path.join(this.rootDir, `.healthcheck-${randomUUID()}`);
      const handle = await open(probePath, 'wx', 0o600);
      await handle.close();
      await unlink(probePath).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  async putObject(
    key: string,
    source: Readable | Buffer,
    _options: { contentType: string; contentLength?: number },
  ): Promise<void> {
    const targetPath = this.resolveKey(key);
    const directory = path.dirname(targetPath);
    const tempPath = path.join(directory, `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
    try {
      // فحص الروابط الرمزية في المسار الموجود مسبقاً قبل إنشاء أي مجلد.
      await this.assertNoSymlinkComponents(directory);
      await mkdir(directory, { recursive: true, mode: 0o750 });
      await this.assertInsideRoot(directory);

      // لا نستبدل كائناً موجوداً بالمفتاح نفسه (المفاتيح مولّدة عشوائياً فلا يتوقع التصادم).
      try {
        await lstat(targetPath);
        throw ApiError.badGateway('storage_key_conflict', 'يوجد كائن مخزَّن بالمفتاح نفسه مسبقاً.');
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      const readable = Buffer.isBuffer(source) ? Readable.from(source) : source;
      await pipeline(readable, createWriteStream(tempPath, { flags: 'wx', mode: 0o640 }));

      // مزامنة القرص قبل إعادة التسمية كي لا يظهر ملف مبتور بعد انقطاع مفاجئ.
      const syncer = await open(tempPath, 'r+');
      try {
        await syncer.sync();
      } finally {
        await syncer.close();
      }

      await rename(tempPath, targetPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw withCause(
        ApiError.badGateway('storage_upload_failed', 'تعذّر حفظ الملف في التخزين المحلي. يرجى إعادة المحاولة.'),
        error,
      );
    }
  }

  async getObject(key: string): Promise<StoredObject> {
    const targetPath = this.resolveKey(key);
    try {
      const directory = path.dirname(targetPath);
      await this.assertNoSymlinkComponents(directory);
      await this.assertInsideRoot(directory);
      const info = await lstat(targetPath);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw ApiError.badGateway('storage_download_failed', 'تعذّر تنزيل الملف من التخزين المحلي.');
      }
      return {
        body: createReadStream(targetPath),
        contentType: null,
        contentLength: info.size,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw withCause(
        ApiError.badGateway('storage_download_failed', 'تعذّر تنزيل الملف من التخزين المحلي.'),
        error,
      );
    }
  }

  async deleteObject(key: string): Promise<void> {
    const targetPath = this.resolveKey(key);
    const directory = path.dirname(targetPath);
    try {
      await this.assertNoSymlinkComponents(directory);
      await this.assertInsideRoot(directory);
      await unlink(targetPath);
    } catch (error) {
      // الحذف المتكرر آمن: غياب الملف (أو مجلده) يعني أنه محذوف أصلاً.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      if (error instanceof ApiError) throw error;
      throw withCause(
        ApiError.badGateway('storage_delete_failed', 'تعذّر حذف الملف من التخزين المحلي. يرجى إعادة المحاولة.'),
        error,
      );
    }
    // أفضل جهد: إزالة مجلد المستند إذا فرغ، دون المساس بجذر التخزين أو أي شيء خارجه.
    if (directory !== this.rootDir) {
      await rmdir(directory).catch(() => undefined);
    }
  }

  /** يتحقق من صحة المفتاح ثم يحوّله إلى مسار مطلق مضمون الاحتواء داخل الجذر. */
  private resolveKey(key: string): string {
    if (!isValidStorageKey(key)) throw invalidKeyError();
    const resolved = path.resolve(this.rootDir, key);
    if (resolved !== this.rootDir && !resolved.startsWith(`${this.rootDir}${path.sep}`)) {
      throw invalidKeyError();
    }
    return resolved;
  }

  /** يقارن المسار الحقيقي (بعد فك الروابط الرمزية) بالجذر الحقيقي. */
  private async assertInsideRoot(absolutePath: string): Promise<void> {
    const [rootReal, pathReal] = await Promise.all([realpath(this.rootDir), realpath(absolutePath)]);
    if (pathReal !== rootReal && !pathReal.startsWith(`${rootReal}${path.sep}`)) {
      throw invalidKeyError();
    }
  }

  /** يرفض أي رابط رمزي ضمن مكوّنات المسار الموجودة مسبقاً تحت الجذر. */
  private async assertNoSymlinkComponents(absolutePath: string): Promise<void> {
    const relative = path.relative(this.rootDir, absolutePath);
    if (relative === '' || relative.startsWith('..')) return;
    let current = this.rootDir;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      if (info.isSymbolicLink()) throw invalidKeyError();
    }
  }
}
