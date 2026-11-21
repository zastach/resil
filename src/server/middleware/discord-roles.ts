import { ApiError } from '@/lib/api/errors';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { type User } from '@/lib/db/models/user';
import { oauthProviders, users } from '@/lib/db/schema';
import { discordMembership, discordRolePolicy } from '@/lib/oauth/discord-roles';
import { and, eq } from 'drizzle-orm';

export async function requireDiscordRole(user: Pick<User, 'id' | 'role'>) {
  if (user.role === 'SUPERADMIN' || user.role === 'ADMIN' || !discordRolePolicy()) return;
  const [account] = await db
    .select({ manualInviteAccess: users.manualInviteAccess })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (account?.manualInviteAccess) return;
  const allowed = await db.transaction(async (tx) => {
    const [provider] = await tx
      .select()
      .from(oauthProviders)
      .where(and(eq(oauthProviders.userId, user.id), eq(oauthProviders.provider, 'DISCORD')))
      .limit(1)
      .for('update');
    if (!provider) return false;
    let membership = await discordMembership(provider.accessToken);
    if (membership === 'expired' && provider.refreshToken) {
      const response = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: config.oauth.discord.clientId ?? '',
          client_secret: config.oauth.discord.clientSecret ?? '',
          grant_type: 'refresh_token',
          refresh_token: provider.refreshToken,
        }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (response?.status === 400 || response?.status === 401) return false;
      if (!response?.ok) throw new ApiError(6008, 'Discord token refresh unavailable.', 503);
      const token = await response.json().catch(() => null);
      if (typeof token?.access_token !== 'string' || !token.access_token) return false;
      await tx
        .update(oauthProviders)
        .set({
          accessToken: token.access_token,
          refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : provider.refreshToken,
        })
        .where(eq(oauthProviders.id, provider.id));
      membership = await discordMembership(token.access_token);
    }
    return membership === 'allowed';
  });
  if (!allowed) throw new ApiError(3017, 'An eligible Discord donator role is required.');
}
