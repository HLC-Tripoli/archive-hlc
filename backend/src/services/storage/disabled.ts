import type { Readable } from 'node:stream';
import { ApiError } from '../../lib/errors.js';
import type { StorageProvider, StoredObject } from './types.js';

/**
 * مزوّد بديل يُستخدم عندما لا تُضبط إعدادات S3 (بيئات التطوير والاختبار فقط؛
 * في بيئة الإنتاج يرفض التطبيق الإقلاع دون إعدادات تخزين كاملة).
 */
export class DisabledStorageProvider implements StorageProvider {
  readonly name = 'disabled';

  private fail(): never {
    throw ApiError.unavailable(
      'storage_not_configured',
      'خدمة تخزين المرفقات غير مهيأة على هذا الخادم. راجع مسؤول النظام.',
    );
  }

  health(): Promise<boolean> {
    return Promise.resolve(false);
  }

  putObject(_key: string, _source: Readable | Buffer): Promise<void> {
    this.fail();
  }

  getObject(_key: string): Promise<StoredObject> {
    this.fail();
  }

  deleteObject(_key: string): Promise<void> {
    this.fail();
  }
}
