import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import exifReader from 'exif-reader';
import sharp from 'sharp';
import { MAX_OPTIMIZE_PIXELS } from './optimizer.js';
import { OptimizationError, remainingMs, runProcess } from './tools.js';

type PdfObject = Record<string, unknown>;
interface QpdfJsonV1 {
  version?: number;
  pages?: Array<{ object?: string; outlines?: unknown[] }>;
  objects?: Record<string, PdfObject>;
}

interface PdfSummary {
  pageCount: number;
  pages: Array<{
    mediaBox: number[] | null;
    cropBox: number[] | null;
    rotate: number;
    userUnit: number;
    annotationCount: number;
    outlines: unknown[];
  }>;
  info: unknown;
}

export interface ValidationInput {
  originalPath: string;
  candidatePath: string;
  extension: string;
  deadline: number;
}

export type ValidationResult = { valid: true } | { valid: false; reason: string };

function expectedSharpFormat(extension: string): string {
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  if (extension === 'png') return 'png';
  if (extension === 'webp') return 'webp';
  return 'tiff';
}

async function qpdfSummary(filePath: string, deadline: number): Promise<PdfSummary> {
  const json = await runProcess(
    'qpdf',
    ['--json=1', '--json-key=pages', '--json-key=objects', filePath],
    { deadline, maxTimeoutMs: 15_000 },
  );
  if (json.code !== 0) throw new OptimizationError('pdf_json_failed');

  let parsed: QpdfJsonV1;
  try {
    parsed = JSON.parse(json.stdout.toString('utf8')) as QpdfJsonV1;
  } catch {
    throw new OptimizationError('pdf_json_invalid');
  }
  const pages = parsed.pages;
  const objects = parsed.objects;
  if (!Array.isArray(pages) || !objects) throw new OptimizationError('pdf_json_invalid');

  const resolve = (value: unknown): PdfObject | null => {
    if (typeof value !== 'string') return null;
    const object = objects[value];
    return object && typeof object === 'object' ? object : null;
  };

  const inherited = (page: PdfObject, key: string): unknown => {
    let current: PdfObject | null = page;
    const seen = new Set<string>();
    for (let depth = 0; current && depth < 64; depth += 1) {
      if (Object.prototype.hasOwnProperty.call(current, key)) return current[key];
      const parentRef = current['/Parent'];
      if (typeof parentRef !== 'string' || seen.has(parentRef)) return undefined;
      seen.add(parentRef);
      current = resolve(parentRef);
    }
    return undefined;
  };

  const asBox = (value: unknown): number[] | null =>
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
      ? (value as number[])
      : null;

  const asNumber = (value: unknown, fallback: number): number => {
    const parsedValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : fallback;
  };

  const pageSummaries = pages.map((entry) => {
    const pageObject = entry.object ? objects[entry.object] : undefined;
    if (!pageObject) throw new OptimizationError('pdf_page_object_missing');
    const annots = inherited(pageObject, '/Annots');
    return {
      mediaBox: asBox(inherited(pageObject, '/MediaBox')),
      cropBox: asBox(inherited(pageObject, '/CropBox')),
      rotate: ((asNumber(inherited(pageObject, '/Rotate'), 0) % 360) + 360) % 360,
      userUnit: asNumber(inherited(pageObject, '/UserUnit'), 1),
      annotationCount: Array.isArray(annots) ? annots.length : 0,
      outlines: Array.isArray(entry.outlines) ? entry.outlines : [],
    };
  });

  // معلومات المستند (/Info) تُقارن كما هي؛ qpdf لا يعيد كتابة قيمها.
  const trailer = await runProcess('qpdf', ['--show-object=trailer', filePath], {
    deadline,
    maxTimeoutMs: 10_000,
    maxStdoutBytes: 1024 * 1024,
  });
  if (trailer.code !== 0) throw new OptimizationError('pdf_trailer_failed');
  const match = /\/Info\s+(\d+)\s+(\d+)\s+R/.exec(trailer.stdout.toString('latin1'));
  let info: unknown = null;
  if (match) {
    const key = `${match[1]} ${match[2]} R`;
    info = objects[key] ?? null;
    if (info === null) throw new OptimizationError('pdf_info_missing');
  }

  return {
    pageCount: pages.length,
    pages: pageSummaries,
    info,
  };
}

function boxesEqual(a: number[] | null, b: number[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]!) < 0.01);
}

function normalizeForCompare(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { __buffer: value.toString('hex') };
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = normalizeForCompare(record[key]);
    return sorted;
  }
  return value;
}

function stableJson(value: unknown): string {
  const json = JSON.stringify(normalizeForCompare(value));
  return json === undefined ? 'undefined' : json;
}

function exifEquivalent(before: Buffer | undefined, after: Buffer | undefined): boolean {
  if (!before) return true; // لا توجد بيانات EXIF أصلية يمكن فقدها
  if (!after) return false;
  try {
    return stableJson(exifReader(before)) === stableJson(exifReader(after));
  } catch {
    return false;
  }
}

async function validatePdf(input: ValidationInput): Promise<ValidationResult> {
  const check = await runProcess('qpdf', ['--check', input.candidatePath], {
    deadline: input.deadline,
    maxTimeoutMs: 15_000,
    maxStdoutBytes: 1024 * 1024,
  });
  if (check.code !== 0) return { valid: false, reason: 'pdf_check_failed' };

  const encrypted = await runProcess('qpdf', ['--is-encrypted', input.candidatePath], {
    deadline: input.deadline,
    maxTimeoutMs: 10_000,
    maxStdoutBytes: 1024,
  });
  if (encrypted.code !== 2) return { valid: false, reason: 'pdf_encrypted_output' };

  const [original, candidate] = await Promise.all([
    qpdfSummary(input.originalPath, input.deadline),
    qpdfSummary(input.candidatePath, input.deadline),
  ]);

  if (original.pageCount === 0 || candidate.pageCount !== original.pageCount) {
    return { valid: false, reason: 'pdf_page_count_changed' };
  }
  for (let index = 0; index < original.pages.length; index += 1) {
    const before = original.pages[index]!;
    const after = candidate.pages[index]!;
    if (!boxesEqual(before.mediaBox, after.mediaBox)) {
      return { valid: false, reason: 'pdf_mediabox_changed' };
    }
    if (!boxesEqual(before.cropBox, after.cropBox)) {
      return { valid: false, reason: 'pdf_cropbox_changed' };
    }
    if (before.rotate !== after.rotate) return { valid: false, reason: 'pdf_rotation_changed' };
    if (before.userUnit !== after.userUnit) return { valid: false, reason: 'pdf_userunit_changed' };
    if (before.annotationCount !== after.annotationCount) {
      return { valid: false, reason: 'pdf_annotations_changed' };
    }
    if (stableJson(before.outlines) !== stableJson(after.outlines)) {
      return { valid: false, reason: 'pdf_outlines_changed' };
    }
  }
  if (stableJson(original.info) !== stableJson(candidate.info)) {
    return { valid: false, reason: 'pdf_info_changed' };
  }
  return { valid: true };
}

/** يقرأ مقاطع APP0..APP15 وCOM من JPEG حتى بداية بيانات الصورة. */
function jpegMetadataSegments(data: Buffer): Buffer[] {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return [];
  const segments: Buffer[] = [];
  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) return [];
    let markerOffset = offset;
    while (markerOffset + 1 < data.length && data[markerOffset + 1] === 0xff) markerOffset += 1;
    const marker = data[markerOffset + 1]!;
    offset = markerOffset + 2;
    if (marker === 0xda) break; // بداية البيانات المضغوطة
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > data.length) return [];
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) return [];
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      segments.push(data.subarray(markerOffset, offset + length));
    }
    offset += length;
  }
  return segments;
}

function buffersEqual(a: Buffer | undefined, b: Buffer | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.equals(b);
}

async function rawPixelHash(filePath: string, deadline: number): Promise<string> {
  const remaining = remainingMs(deadline);
  if (remaining <= 0) throw new OptimizationError('timeout');
  const raw = await sharp(filePath, {
    limitInputPixels: MAX_OPTIMIZE_PIXELS,
    failOn: 'error',
    sequentialRead: true,
  })
    .timeout({ seconds: Math.max(1, Math.floor(remaining / 1000)) })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return createHash('sha256').update(raw).digest('hex');
}

async function validateImage(input: ValidationInput): Promise<ValidationResult> {
  const original = await sharp(input.originalPath, {
    limitInputPixels: MAX_OPTIMIZE_PIXELS,
    failOn: 'error',
  }).metadata();
  const candidate = await sharp(input.candidatePath, {
    limitInputPixels: MAX_OPTIMIZE_PIXELS,
    failOn: 'error',
  }).metadata();

  const expectedFormat = expectedSharpFormat(input.extension);
  if (candidate.format !== expectedFormat || original.format !== expectedFormat) {
    return { valid: false, reason: 'image_format_changed' };
  }
  if (candidate.width !== original.width || candidate.height !== original.height) {
    return { valid: false, reason: 'image_dimensions_changed' };
  }
  if ((candidate.pages ?? 1) !== (original.pages ?? 1)) {
    return { valid: false, reason: 'image_page_count_changed' };
  }
  if (Boolean(candidate.hasAlpha) !== Boolean(original.hasAlpha)) {
    return { valid: false, reason: 'image_alpha_changed' };
  }
  const beforeOrientation = original.orientation ?? 1;
  const afterOrientation = candidate.orientation ?? 1;
  if (afterOrientation !== beforeOrientation) {
    return { valid: false, reason: 'image_orientation_changed' };
  }
  if (candidate.space !== original.space) {
    return { valid: false, reason: 'image_colourspace_changed' };
  }
  if (original.density !== undefined && candidate.density !== original.density) {
    return { valid: false, reason: 'image_density_changed' };
  }
  if (original.icc && !buffersEqual(original.icc, candidate.icc)) {
    return { valid: false, reason: 'image_icc_changed' };
  }
  if (original.xmp && !buffersEqual(original.xmp, candidate.xmp)) {
    return { valid: false, reason: 'image_xmp_changed' };
  }
  if (!exifEquivalent(original.exif, candidate.exif)) {
    return { valid: false, reason: 'image_exif_changed' };
  }

  if (input.extension === 'jpg' || input.extension === 'jpeg') {
    const [before, after] = await Promise.all([
      readFile(input.originalPath),
      readFile(input.candidatePath),
    ]);
    const beforeSegments = jpegMetadataSegments(before);
    const afterSegments = jpegMetadataSegments(after);
    if (
      beforeSegments.length !== afterSegments.length ||
      beforeSegments.some((segment, index) => !segment.equals(afterSegments[index]!))
    ) {
      return { valid: false, reason: 'jpeg_metadata_changed' };
    }
  }

  // المقارنة الخام تثبت أن مسار الضغط كان بلا فقدان فعلاً (بما فيه الشفافية).
  const [beforeHash, afterHash] = await Promise.all([
    rawPixelHash(input.originalPath, input.deadline),
    rawPixelHash(input.candidatePath, input.deadline),
  ]);
  if (beforeHash !== afterHash) return { valid: false, reason: 'image_pixels_changed' };
  return { valid: true };
}

/**
 * تحقق مستقل من المرشّح قبل استبدال الأصل. حتى لو أنتج المحسّن ملفاً تالفاً
 * أو غيّر بكسلاً/خاصية، نرفضه ونُبقي البايتات الأصلية.
 */
export async function validateOptimizedCandidate(
  input: ValidationInput,
): Promise<ValidationResult> {
  try {
    if (input.extension === 'pdf') return await validatePdf(input);
    if (
      input.extension === 'jpg' ||
      input.extension === 'jpeg' ||
      input.extension === 'png' ||
      input.extension === 'webp' ||
      input.extension === 'tif' ||
      input.extension === 'tiff'
    ) {
      return await validateImage(input);
    }
    return { valid: false, reason: 'unsupported_type' };
  } catch (error) {
    if (error instanceof OptimizationError) return { valid: false, reason: error.reason };
    return { valid: false, reason: 'validation_error' };
  }
}
