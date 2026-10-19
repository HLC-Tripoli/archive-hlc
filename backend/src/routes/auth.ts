import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import { ApiError } from '../lib/errors.js';
import {
  hashPassword,
  validatePassword,
  verifyDummyPassword,
  verifyPassword,
} from '../lib/security.js';
import type { AuthGuards } from '../plugins/auth.js';
import { writeAudit } from '../services/audit.js';
import {
  createSession,
  destroySession,
  destroyUserSessions,
  SESSION_COOKIE_NAME,
} from '../services/sessions.js';
import { findUserByUsername, getUserById, setUserPassword, touchLastLogin } from '../services/users.js';

export interface AuthRoutesDeps {
  pool: Pool;
  config: AppConfig;
  guards: AuthGuards;
}

const LOGIN_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  const { pool, config, guards } = deps;

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: config.rateLimits.loginMax, timeWindow: '5 minutes' } },
      schema: { body: LOGIN_BODY_SCHEMA },
    },
    async (request, reply) => {
      const body = request.body as { username: string; password: string };
      const username = body.username.trim();
      const auditContext = {
        ip: request.ip,
        userAgent: (request.headers['user-agent'] ?? '').slice(0, 500) || null,
      };

      const user = await findUserByUsername(pool, username);
      const passwordOk = user
        ? await verifyPassword(user.passwordHash, body.password)
        : await verifyDummyPassword(body.password);

      if (!user || !passwordOk || !user.isActive) {
        await writeAudit(
          pool,
          {
            actorUserId: user?.id ?? null,
            actorUsername: username,
            action: 'auth.login.failed',
            details: {
              reason: !user ? 'unknown_user' : !passwordOk ? 'bad_password' : 'inactive_account',
            },
          },
          auditContext,
        );
        throw ApiError.unauthorized('اسم المستخدم أو كلمة المرور غير صحيحة.');
      }

      const session = await createSession(pool, user.id, {
        ttlHours: config.sessionTtlHours,
        ip: auditContext.ip,
        userAgent: auditContext.userAgent,
      });
      await touchLastLogin(pool, user.id);
      await writeAudit(
        pool,
        { actorUserId: user.id, actorUsername: user.username, action: 'auth.login.success' },
        auditContext,
      );

      reply.setCookie(SESSION_COOKIE_NAME, session.token, guards.sessionCookieOptions);
      return {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
        },
        csrfToken: session.csrfToken,
      };
    },
  );

  app.post('/auth/logout', { preHandler: guards.requireAuth }, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) await destroySession(pool, token);
    guards.clearSessionCookie(reply);
    await writeAudit(
      pool,
      {
        actorUserId: request.authUser!.id,
        actorUsername: request.authUser!.username,
        action: 'auth.logout',
      },
      { ip: request.ip, userAgent: (request.headers['user-agent'] ?? '') || null },
    );
    return { ok: true };
  });

  app.get('/auth/session', async (request) => {
    if (!request.authUser || !request.authSession) {
      throw ApiError.unauthorized();
    }
    return { user: request.authUser, csrfToken: request.authSession.csrfToken };
  });

  app.post(
    '/auth/password',
    {
      preHandler: guards.requireAuth,
      config: { rateLimit: { max: config.rateLimits.sensitiveMax, timeWindow: '15 minutes' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string', minLength: 1, maxLength: 200 },
            newPassword: { type: 'string', minLength: 8, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { currentPassword: string; newPassword: string };
      validatePassword(body.newPassword);
      const user = await getUserById(pool, request.authUser!.id);
      if (!user) throw ApiError.unauthorized();
      const currentOk = await verifyPassword(user.passwordHash, body.currentPassword);
      if (!currentOk) {
        throw ApiError.badRequest('invalid_current_password', 'كلمة المرور الحالية غير صحيحة.');
      }
      const passwordHash = await hashPassword(body.newPassword);
      await setUserPassword(pool, user.id, passwordHash);
      const revoked = await destroyUserSessions(pool, user.id, {
        exceptToken: request.cookies[SESSION_COOKIE_NAME],
      });
      await writeAudit(
        pool,
        {
          actorUserId: user.id,
          actorUsername: user.username,
          action: 'auth.password.changed',
          entityType: 'user',
          entityId: user.id,
          details: { revokedSessions: revoked },
        },
        { ip: request.ip, userAgent: (request.headers['user-agent'] ?? '') || null },
      );
      return { ok: true };
    },
  );
}
