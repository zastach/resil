import { ApiError } from '@/lib/api/errors';
import { log } from '@/lib/logger';
import { createHash } from 'node:crypto';

const logger = log('oauth').c('discord-membership');

type Membership = 'allowed' | 'denied' | 'expired';
const allowedForMs = 30_000;
const maximumCachedChecks = 1024;
const cachedChecks = new Map<string, { until: number; allowed: boolean }>();
const pendingChecks = new Map<string, Promise<Membership>>();
let globalRetryAt = 0;
let sharedLimit = { guild: '', retryAt: 0 };

function rememberCheck(key: string, until: number, allowed: boolean) {
  if (cachedChecks.size >= maximumCachedChecks) {
    const oldest = cachedChecks.keys().next().value;
    if (oldest !== undefined) cachedChecks.delete(oldest);
  }
  cachedChecks.set(key, { until, allowed });
}

function rateLimited() {
  return new ApiError(6008, 'Discord is rate limiting membership checks. Try again shortly.', 503);
}

export function discordRolePolicy() {
  const guild = process.env.OAUTH_DISCORD_GUILD_ID;
  const raw = process.env.OAUTH_DISCORD_REQUIRED_ROLE_IDS;
  if (guild === undefined && raw === undefined) return null;
  const roles = (raw ?? '').split(',').map((role) => role.trim());
  if (!guild || !/^\d+$/.test(guild) || !roles.length || roles.some((role) => !/^\d+$/.test(role)))
    throw new ApiError(2003, 'Discord role policy is misconfigured.');
  return { guild, roles };
}

export async function discordMembership(
  accessToken: string,
  policy = discordRolePolicy(),
): Promise<Membership> {
  if (!policy) return 'allowed';
  const key = createHash('sha256')
    .update(JSON.stringify([policy.guild, policy.roles, accessToken]))
    .digest('hex');
  const now = Date.now();
  const cached = cachedChecks.get(key);
  if (cached && cached.until > now) {
    if (cached.allowed) return 'allowed';
    throw rateLimited();
  }
  cachedChecks.delete(key);
  if (globalRetryAt > now || (sharedLimit.guild === policy.guild && sharedLimit.retryAt > now))
    throw rateLimited();

  const pending = pendingChecks.get(key);
  if (pending) return pending;

  const check = fetchMembership(accessToken, policy, key).finally(() => pendingChecks.delete(key));
  pendingChecks.set(key, check);
  return check;
}

async function fetchMembership(
  accessToken: string,
  policy: { guild: string; roles: string[] },
  key: string,
): Promise<Membership> {
  const response = await fetch(`https://discord.com/api/v10/users/@me/guilds/${policy.guild}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  }).catch((error: unknown) => {
    logger.warn('Discord membership request could not reach Discord', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  });
  if (response?.status === 401) return 'expired';
  if (response?.status === 403 || response?.status === 404) return 'denied';
  if (response && !response.ok) {
    logger.warn('Discord membership request failed', {
      status: response.status,
      retryAfter: response.headers.get('retry-after'),
    });
    if (response.status === 429) {
      const header = Number(response.headers.get('retry-after'));
      const body = header > 0 ? null : await response.json().catch(() => null);
      const seconds = header > 0 ? header : Number(body?.retry_after);
      const retryAt = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 5000);
      const scope = response.headers.get('x-ratelimit-scope');
      if (
        scope === 'global' ||
        response.headers.get('x-ratelimit-global') === 'true' ||
        body?.global === true
      ) {
        globalRetryAt = Math.max(globalRetryAt, retryAt);
      } else if (scope === 'shared') {
        sharedLimit = {
          guild: policy.guild,
          retryAt: Math.max(sharedLimit.guild === policy.guild ? sharedLimit.retryAt : 0, retryAt),
        };
      } else {
        rememberCheck(key, retryAt, false);
      }
      throw rateLimited();
    }
  }
  if (!response?.ok) throw new ApiError(6008, 'Discord membership verification unavailable.', 503);
  const member = await response.json().catch(() => null);
  if (!Array.isArray(member?.roles)) throw new ApiError(6008, 'Invalid Discord membership response.', 503);
  if (!policy.roles.some((role) => member.roles.includes(role))) return 'denied';
  rememberCheck(key, Date.now() + allowedForMs, true);
  return 'allowed';
}
