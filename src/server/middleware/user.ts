import { hasAcceptedResilPolicy } from '@/lib/resil-policy';
import { isAdministrator } from '@/lib/role';
import { config } from '@/lib/config';
import { decryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';
import { getUserBySession, getUserByToken, type User } from '@/lib/db/models/user';
import { FastifyReply } from 'fastify';
import { FastifyRequest } from 'fastify/types/request';
import { getSession } from '../session';
import { ApiError } from '@/lib/api/errors';

declare module 'fastify' {
  export interface FastifyRequest {
    user: User;
  }
}

export function parseUserToken(encryptedToken: string | undefined | null): string;
export function parseUserToken(encryptedToken: string | undefined | null, noThrow: true): string | null;
export function parseUserToken(
  encryptedToken: string | undefined | null,
  noThrow: boolean = false,
): string | null {
  if (!encryptedToken) {
    if (noThrow) return null;
    throw new ApiError(2001);
  }

  const decryptedToken = decryptToken(encryptedToken, config.core.secret);
  if (!decryptedToken) {
    if (noThrow) return null;
    throw new ApiError(2001);
  }

  const [date, token] = decryptedToken;
  if (isNaN(new Date(date).getTime())) {
    if (noThrow) return null;

    throw new ApiError(2001);
  }

  return token;
}

export async function authenticateUser(req: FastifyRequest, res: FastifyReply) {
  const path = req.url.toLowerCase().split('?')[0];
  const upload = ['/api/upload', '/api/upload/partial'].includes(path);
  const leanUpload = upload && !config.discord?.onUpload && !config.httpWebhook.onUpload;

  const authorization = req.headers.authorization;

  if (authorization) {
    const token = parseUserToken(authorization);

    let user;
    if (leanUpload) {
      user = await db.query.users.findFirst({
        columns: { id: true, username: true, role: true, resilPolicyAcceptance: true },
        where: { token },
        with: { quota: true },
      });
    } else {
      user = await getUserByToken(token);
    }
    if (!user) throw new ApiError(2001);
    if (!isAdministrator(user.role)) throw new ApiError(3000);

    req.user = user as User;

    return;
  }

  const session = await getSession(req, res);
  if (session.tokenAuth) throw new ApiError(2004);

  if (!session.id || !session.sessionId) throw new ApiError(2000);

  let user;
  if (leanUpload) {
    user = await db.query.users.findFirst({
      columns: { id: true, username: true, role: true, resilPolicyAcceptance: true },
      where: { sessions: { id: session.sessionId } },
      with: { quota: true },
    });
  } else {
    user = await getUserBySession(session.sessionId);
  }
  if (!user) throw new ApiError(2001);

  req.user = user as User;
}

export async function userMiddleware(req: FastifyRequest, res: FastifyReply) {
  await authenticateUser(req, res);
  if (!hasAcceptedResilPolicy(req.user)) throw new ApiError(3020);
}
