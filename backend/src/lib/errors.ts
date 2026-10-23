/**
 * أخطاء التطبيق الموحّدة.
 * كل خطأ يصل إلى المستخدم يحمل رمزاً ثابتاً (code) ورسالة عربية واضحة،
 * دون كشف أي تفاصيل داخلية عن قاعدة البيانات أو التخزين.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: string, message: string, details?: unknown): ApiError {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(message = 'يجب تسجيل الدخول للمتابعة.'): ApiError {
    return new ApiError(401, 'unauthorized', message);
  }

  static forbidden(message = 'لا تملك صلاحية لتنفيذ هذه العملية.'): ApiError {
    return new ApiError(403, 'forbidden', message);
  }

  static notFound(message = 'العنصر المطلوب غير موجود.'): ApiError {
    return new ApiError(404, 'not_found', message);
  }

  static conflict(code: string, message: string): ApiError {
    return new ApiError(409, code, message);
  }

  static payloadTooLarge(message = 'حجم البيانات المرسلة يتجاوز الحد المسموح.'): ApiError {
    return new ApiError(413, 'payload_too_large', message);
  }

  static badGateway(code: string, message: string): ApiError {
    return new ApiError(502, code, message);
  }

  static unavailable(code: string, message: string): ApiError {
    return new ApiError(503, code, message);
  }
}

interface PgErrorLike {
  code?: string;
  constraint?: string;
}

const UNIQUE_CONSTRAINT_MESSAGES: Record<string, [string, string]> = {
  documents_reference_lower_active_uidx: ['duplicate_reference', 'الرقم الاشاري مستخدم بالفعل لمستند آخر.'],
  users_username_lower_uidx: ['duplicate_username', 'اسم المستخدم مستخدم بالفعل.'],
  users_employee_number_lower_uidx: [
    'duplicate_employee_number',
    'الرقم الوظيفي مستخدم بالفعل لحساب آخر.',
  ],
  departments_name_lower_uidx: ['duplicate_department', 'يوجد قسم أو إدارة بنفس الاسم.'],
  departments_legacy_uidx: ['duplicate_legacy_record', 'تم استيراد هذا السجل مسبقاً.'],
  documents_legacy_uidx: ['duplicate_legacy_record', 'تم استيراد هذا السجل مسبقاً.'],
  document_files_storage_key_key: ['duplicate_storage_key', 'تعارض في تخزين الملف. يرجى إعادة المحاولة.'],
  sessions_token_hash_key: ['conflict', 'تعارض في الجلسة. يرجى إعادة تسجيل الدخول.'],
};

/**
 * يحوّل أخطاء PostgreSQL المعروفة إلى أخطاء API واضحة بالعربية،
 * ويعيد null إذا كان الخطأ غير معروف كي يُعالج كخطأ داخلي.
 */
export function pgErrorToApiError(error: unknown): ApiError | null {
  if (typeof error !== 'object' || error === null) return null;
  const pgError = error as PgErrorLike;
  if (pgError.code === '23505') {
    const mapped = pgError.constraint ? UNIQUE_CONSTRAINT_MESSAGES[pgError.constraint] : undefined;
    if (mapped) return ApiError.conflict(mapped[0], mapped[1]);
    return ApiError.conflict('conflict', 'القيمة مستخدمة بالفعل.');
  }
  if (pgError.code === '23503') {
    return ApiError.conflict('referenced_record', 'لا يمكن تنفيذ العملية لوجود بيانات مرتبطة.');
  }
  if (pgError.code === '22P02') {
    return ApiError.badRequest('invalid_input', 'قيمة غير صالحة في الطلب.');
  }
  if (pgError.code === '22007' || pgError.code === '22008') {
    return ApiError.badRequest('invalid_date', 'التاريخ المرسل غير صالح.');
  }
  return null;
}
