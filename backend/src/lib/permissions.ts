import type { SessionUserInfo } from '../services/sessions.js';
import { ApiError } from './errors.js';

export const VALID_PERMISSIONS = ['view', 'create', 'edit', 'delete'] as const;
export type Permission = (typeof VALID_PERMISSIONS)[number];

export function hasPermission(user: SessionUserInfo, permission: Permission): boolean {
  if (user.role === 'admin') return true;
  if (!Array.isArray(user.permissions)) return false;
  return user.permissions.includes(permission);
}

export function assertPermission(user: SessionUserInfo, permission: Permission): void {
  if (!hasPermission(user, permission)) {
    throw new ApiError(403, 'permission_denied', `ليس لديك صلاحية ${permission}.`);
  }
}
