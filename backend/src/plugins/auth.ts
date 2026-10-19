import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import { ApiError } from '../lib/errors.js';
import {
  findSessionWithUser,
  SESSION_COOKIE_NAME,
  verifyCsrfToken,
  type SessionRecord,
  type SessionUserInfo,
} from '../services/sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: SessionUserInfo | null;
    authSession: SessionRecord | null;
  }
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface AuthGuards {
  /** يحمّل المستخدم والجلسة من كوكي الجلسة إن وُجد، دون إلزام تسجيل الدخول. */
  loadUser: (request: FastifyRequest) => Promise<void>;
  /** يتطلب جلسة صالحة، ويفرض رمز CSRF على الطلبات المتغيّرة. */
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** يتطلب جلسة صالحة بدور مدير النظام. */
  requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  clearSessionCookie: (reply: FastifyReply) => void;
  sessionCookieOptions: {
    httpOnly: boolean;
    sameSite: 'lax';
    secure: boolean;
    path: string;
    maxAge: number;
  };
}

export function buildAuthGuards(deps: { pool: Pool; config: AppConfig }): AuthGuards {
  const { pool, config } = deps;

  const sessionCookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionTtlHours * 3600,
  };

  function clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE_NAME, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
    });
  }

  async function loadUser(request: FastifyRequest): Promise<void> {
    request.authUser = null;
    request.authSession = null;
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) return;
    const lookup = await findSessionWithUser(pool, token);
    if (!lookup) return;
    request.authUser = lookup.user;
    request.authSession = lookup.session;
  }

  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.authUser || !request.authSession) {
      await loadUser(request);
    }
    if (!request.authUser || !request.authSession) {
      clearSessionCookie(reply);
      throw ApiError.unauthorized();
    }
    if (MUTATING_METHODS.has(request.method)) {
      const header = request.headers['x-csrf-token'];
      const provided = Array.isArray(header) ? header[0] : header;
      if (!verifyCsrfToken(request.authSession, provided)) {
        throw new ApiError(
          403,
          'csrf_failed',
          'فشل التحقق من حماية الطلب. حدّث الصفحة ثم أعد المحاولة.',
        );
      }
    }
  }

  async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await requireAuth(request, reply);
    if (request.authUser?.role !== 'admin') {
      throw ApiError.forbidden('هذه العملية متاحة لمدير النظام فقط.');
    }
  }

  return { loadUser, requireAuth, requireAdmin, clearSessionCookie, sessionCookieOptions };
}
