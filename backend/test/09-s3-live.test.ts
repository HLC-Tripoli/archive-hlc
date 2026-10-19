import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { S3StorageProvider } from '../src/services/storage/s3.js';

const liveEnabled = process.env.S3_LIVE_TEST === '1';

/**
 * اختبار تكاملي حقيقي ضد خدمة RustFS.
 * يُشغَّل فقط عند ضبط S3_LIVE_TEST=1 مع متغيرات S3_* (راجع README).
 */
test(
  'live S3-compatible storage round trip (RustFS)',
  { skip: liveEnabled ? false : 'S3_LIVE_TEST is not set to 1' },
  async () => {
    const config = loadConfig(process.env);
    assert.ok(config.s3, 'S3 configuration must be present to run the live storage test');

    const provider = new S3StorageProvider(config.s3);
    const prefix = config.s3.keyPrefix ? `${config.s3.keyPrefix}/` : '';
    const key = `${prefix}it-live/round-trip.txt`;
    const payload = Buffer.from(`live round trip at ${new Date().toISOString()}`, 'utf8');

    try {
      assert.equal(await provider.health(), true);

      await provider.putObject(key, payload, {
        contentType: 'text/plain',
        contentLength: payload.length,
      });

      const object = await provider.getObject(key);
      const chunks: Buffer[] = [];
      for await (const chunk of object.body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }
      assert.ok(Buffer.concat(chunks).equals(payload));
      assert.equal(object.contentLength, payload.length);
    } finally {
      await provider.deleteObject(key).catch(() => undefined);
    }

    await assert.rejects(() => provider.getObject(key));
  },
);
