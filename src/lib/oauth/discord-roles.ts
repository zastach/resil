import { ApiError } from '@/lib/api/errors';

export function discordRolePolicy() {
  const guild = process.env.OAUTH_DISCORD_GUILD_ID;
  const raw = process.env.OAUTH_DISCORD_REQUIRED_ROLE_IDS;
  if (guild === undefined && raw === undefined) return null;
  const roles = (raw ?? '').split(',').map((role) => role.trim());
  if (!guild || !/^\d+$/.test(guild) || !roles.length || roles.some((role) => !/^\d+$/.test(role)))
    throw new ApiError(2003, 'Discord role policy is misconfigured.');
  return { guild, roles };
}

export async function discordMembership(accessToken: string): Promise<'allowed' | 'denied' | 'expired'> {
  const policy = discordRolePolicy();
  if (!policy) return 'allowed';
  const response = await fetch(`https://discord.com/api/v10/users/@me/guilds/${policy.guild}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (response?.status === 401) return 'expired';
  if (response?.status === 403 || response?.status === 404) return 'denied';
  if (!response?.ok) throw new ApiError(6008, 'Discord membership verification unavailable.', 503);
  const member = await response.json().catch(() => null);
  if (!Array.isArray(member?.roles)) throw new ApiError(6008, 'Invalid Discord membership response.', 503);
  return policy.roles.some((role) => member.roles.includes(role)) ? 'allowed' : 'denied';
}
