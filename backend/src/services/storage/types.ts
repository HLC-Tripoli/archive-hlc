import type { Readable } from 'node:stream';

export interface StoredObject {
  body: Readable;
  contentType: string | null;
  contentLength: number | null;
}

/**
 * واجهة مزوّد التخزين: تُغلف خلف هذه الواجهة آلية حفظ المرفقات
 * (نظام الملفات المحلي في هذا النشر) كي تبقى بقية طبقات التطبيق
 * مستقلة عن المزوّد، ويسهل استبدالها بنسخة وهمية في الاختبارات.
 */
export interface StorageProvider {
  readonly name: string;
  health(): Promise<boolean>;
  putObject(
    key: string,
    source: Readable | Buffer,
    options: { contentType: string; contentLength?: number },
  ): Promise<void>;
  getObject(key: string): Promise<StoredObject>;
  deleteObject(key: string): Promise<void>;
}
