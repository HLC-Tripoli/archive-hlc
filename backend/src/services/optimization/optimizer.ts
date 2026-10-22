import { createReadStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { OptimizationError, remainingMs, runProcess } from './tools.js';

/**
 * سقف عدد بكسلات الصورة الواحدة أثناء التحسين. الصور الأكبر تُترك كما هي
 * بدلاً من تحميلها كاملة في الذاكرة أو السماح بعمل غير محدود.
 */
export const MAX_OPTIMIZE_PIXELS = 20_000_000;

const LOSSLESS_IMAGE_EXTENSIONS = new Set(['png', 'webp', 'tif', 'tiff']);

export type CandidateResult =
  | { produced: true }
  | { produced: false; reason: string };

export interface OptimizeCandidateInput {
  sourcePath: string;
  outputPath: string;
  extension: string;
  /** وقت مطلق بالمللي ثانية تنتهي عنده محاولة التحسين. */
  deadline: number;
}

export interface AttachmentOptimizer {
  produceCandidate(input: OptimizeCandidateInput): Promise<CandidateResult>;
}

/** قائمة انتظار بسيطة تحدّ من عمليات التحسين المتزامنة داخل العملية. */
class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  private async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
    } else {
      // نقل الشريحة يتم داخل release أدناه؛ لا نزيد العدّاد هنا كي لا يتجاوز
      // الحد عند وصول عملية جديدة في نفس اللحظة التي يستيقظ فيها منتظر.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    return () => this.release();
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      // المنتظر يرث الشريحة نفسها بدل تحريرها وإعادة أخذها.
      next();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }
}

/**
 * فحص توقيع PDF رقمي قبل أي معالجة. نبحث عن العلامات كبايتات متدفقة
 * (لا نحمّل الملف كاملاً) لأن أي إعادة كتابة قد تُبطل التوقيع.
 */
async function pdfHasSignature(sourcePath: string): Promise<boolean> {
  const needles = [Buffer.from('/ByteRange'), Buffer.from('/Sig')];
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(sourcePath)) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    const data = carry.length > 0 ? Buffer.concat([carry, piece]) : piece;
    if (needles.some((needle) => data.includes(needle))) return true;
    carry = Buffer.from(data.subarray(Math.max(0, data.length - 32)));
  }
  return false;
}

async function producePdfCandidate(input: OptimizeCandidateInput): Promise<CandidateResult> {
  if (await pdfHasSignature(input.sourcePath)) {
    return { produced: false, reason: 'pdf_signed' };
  }

  const encrypted = await runProcess('qpdf', ['--is-encrypted', input.sourcePath], {
    deadline: input.deadline,
    maxTimeoutMs: 10_000,
    maxStdoutBytes: 1024,
  });
  // 0 = مشفّر، 2 = غير مشفّر. أي رمز آخر يعني أن الملف غير صالح للمعالجة الآمنة.
  if (encrypted.code === 0) return { produced: false, reason: 'pdf_encrypted' };
  if (encrypted.code !== 2) return { produced: false, reason: 'pdf_unreadable' };

  await rm(input.outputPath, { force: true });
  const optimized = await runProcess(
    'qpdf',
    [
      '--object-streams=generate',
      '--recompress-flate',
      '--compression-level=9',
      input.sourcePath,
      input.outputPath,
    ],
    { deadline: input.deadline, maxTimeoutMs: 15_000, maxStdoutBytes: 4096 },
  );
  if (optimized.code !== 0) return { produced: false, reason: 'pdf_optimizer_failed' };
  return { produced: true };
}

async function produceJpegCandidate(input: OptimizeCandidateInput): Promise<CandidateResult> {
  await rm(input.outputPath, { force: true });
  const optimized = await runProcess(
    'jpegtran',
    ['-copy', 'all', '-optimize', '-outfile', input.outputPath, input.sourcePath],
    { deadline: input.deadline, maxTimeoutMs: 15_000, maxStdoutBytes: 4096 },
  );
  if (optimized.code !== 0) return { produced: false, reason: 'jpeg_optimizer_failed' };
  return { produced: true };
}

async function produceLosslessImageCandidate(
  input: OptimizeCandidateInput,
): Promise<CandidateResult> {
  const remaining = remainingMs(input.deadline);
  if (remaining <= 0) return { produced: false, reason: 'timeout' };
  const seconds = Math.max(1, Math.floor(remaining / 1000));

  const image = sharp(input.sourcePath, {
    limitInputPixels: MAX_OPTIMIZE_PIXELS,
    failOn: 'error',
    sequentialRead: true,
  });
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) return { produced: false, reason: 'image_unreadable' };
  if ((metadata.pages ?? 1) > 1) return { produced: false, reason: 'image_multipage' };
  // إعادة الترميز بعمق مختلف قد تفقد دقة 16-bit؛ نتركها بلا تحسين.
  if (metadata.depth !== 'uchar') return { produced: false, reason: 'image_high_depth' };

  let pipeline = image.keepMetadata().timeout({ seconds });

  switch (input.extension) {
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false });
      break;
    case 'webp':
      pipeline = pipeline.webp({ lossless: true, effort: 6 });
      break;
    case 'tif':
    case 'tiff':
      // TIFF بمساحة ألوان CMYK قد يتحول أثناء الترميز؛ نكتفي بالمساحات القياسية.
      if (metadata.space !== 'srgb' && metadata.space !== 'b-w') {
        return { produced: false, reason: 'image_colourspace_unsupported' };
      }
      pipeline = pipeline.tiff({ compression: 'deflate', predictor: 'horizontal', pyramid: false });
      break;
    default:
      return { produced: false, reason: 'unsupported_type' };
  }

  await pipeline.toFile(input.outputPath);
  return { produced: true };
}

async function produceCandidate(input: OptimizeCandidateInput): Promise<CandidateResult> {
  try {
    if (input.extension === 'pdf') return await producePdfCandidate(input);
    if (input.extension === 'jpg' || input.extension === 'jpeg') {
      return await produceJpegCandidate(input);
    }
    if (LOSSLESS_IMAGE_EXTENSIONS.has(input.extension)) {
      return await produceLosslessImageCandidate(input);
    }
    // GIF وBMP وبقية الأنواع غير المدعومة تبقى بايتاً بايتاً كما وردت.
    return { produced: false, reason: 'unsupported_type' };
  } catch (error) {
    if (error instanceof OptimizationError) return { produced: false, reason: error.reason };
    // لا نُعيد نص الخطأ خاماً: قد يحتوي مسارات أو تفاصيل من مكتبة المعالجة.
    return { produced: false, reason: 'optimizer_error' };
  }
}

export function createAttachmentOptimizer(options: {
  concurrency: number;
  tmpDir: string;
}): AttachmentOptimizer {
  const limiter = new Semaphore(Math.max(1, options.concurrency));
  let directoryReady: Promise<unknown> | null = null;

  return {
    async produceCandidate(input: OptimizeCandidateInput): Promise<CandidateResult> {
      return limiter.run(async () => {
        if (remainingMs(input.deadline) <= 0) return { produced: false, reason: 'timeout' };
        if (!directoryReady) {
          directoryReady = mkdir(options.tmpDir, { recursive: true, mode: 0o700 });
        }
        await directoryReady;
        return produceCandidate(input);
      });
    },
  };
}

/** مسار مرشّح داخل مجلد العمل المؤقت نفسه (لا يلمس الملف الأصلي). */
export function candidatePathFor(sourcePath: string, extension: string): string {
  return path.join(path.dirname(sourcePath), `optimized.${extension}`);
}
