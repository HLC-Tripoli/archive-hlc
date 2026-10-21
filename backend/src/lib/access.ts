import type { SessionUserInfo } from '../services/sessions.js';
import { ApiError } from './errors.js';

/**
 * نطاق الوصول التشغيلي المستخرج من هوية الجلسة الحالية.
 * المدير عام؛ الموظف محصور في إدارته النشطة فقط.
 */
export interface DocumentAccessScope {
  isAdmin: boolean;
  departmentId: string | null;
}

/**
 * يحوّل هوية المستخدم الموثوقة (المقروءة من قاعدة البيانات في كل طلب) إلى نطاق وصول.
 * لا يعتمد أبداً على قيمة إدارة مرسلة من العميل، ولا يسمح لموظف بلا إدارة نشطة
 * بالوصول إلى المعاملات أو الإحصاءات أو المرفقات.
 */
export function resolveDocumentAccessScope(user: SessionUserInfo): DocumentAccessScope {
  if (user.role === 'admin') {
    return { isAdmin: true, departmentId: null };
  }
  if (!user.departmentId) {
    throw new ApiError(
      403,
      'department_required',
      'حسابك غير مرتبط بأي إدارة. يرجى مراجعة مدير النظام لتعيين إدارتك قبل الوصول إلى المعاملات.',
    );
  }
  if (!user.departmentActive) {
    throw new ApiError(
      403,
      'department_inactive',
      'الإدارة المرتبطة بحسابك معطّلة. يرجى مراجعة مدير النظام لتفعيلها أو إعادة تعيينك إلى إدارة نشطة.',
    );
  }
  return { isAdmin: false, departmentId: user.departmentId };
}
