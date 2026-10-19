import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { S3Config } from '../../config.js';
import { ApiError } from '../../lib/errors.js';
import type { StorageProvider, StoredObject } from './types.js';

/** واجهة مصغّرة لعميل S3 تسهّل اختبار المزوّد دون شبكة. */
export interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

function withCause(apiError: ApiError, cause: unknown): ApiError {
  (apiError as { cause?: unknown }).cause = cause;
  return apiError;
}

export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  private readonly client: S3ClientLike;
  private readonly bucket: string;

  constructor(config: S3Config, client?: S3ClientLike) {
    this.bucket = config.bucket;
    this.client =
      client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKey,
          secretAccessKey: config.secretKey,
        },
      });
  }

  async health(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  async putObject(
    key: string,
    source: Readable | Buffer,
    options: { contentType: string; contentLength?: number },
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: source,
          ContentType: options.contentType,
          ContentLength: options.contentLength,
        }),
      );
    } catch (error) {
      throw withCause(
        ApiError.badGateway('storage_upload_failed', 'تعذّر رفع الملف إلى خدمة التخزين. يرجى إعادة المحاولة.'),
        error,
      );
    }
  }

  async getObject(key: string): Promise<StoredObject> {
    let response: GetObjectCommandOutput;
    try {
      response = (await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))) as GetObjectCommandOutput;
    } catch (error) {
      throw withCause(
        ApiError.badGateway('storage_download_failed', 'تعذّر تنزيل الملف من خدمة التخزين.'),
        error,
      );
    }
    if (!response.Body) {
      throw ApiError.badGateway('storage_download_failed', 'تعذّر تنزيل الملف من خدمة التخزين.');
    }
    return {
      body: response.Body as Readable,
      contentType: response.ContentType ?? null,
      contentLength: response.ContentLength ?? null,
    };
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      throw withCause(
        ApiError.badGateway('storage_delete_failed', 'تعذّر حذف الملف من خدمة التخزين. يرجى إعادة المحاولة.'),
        error,
      );
    }
  }
}
