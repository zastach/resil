import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discordMembership, discordRolePolicy } from '@/lib/oauth/discord-roles';

test('Discord donor policy rejects missing roles and accepts any configured role', async (t) => {
  const guild = process.env.OAUTH_DISCORD_GUILD_ID;
  const roles = process.env.OAUTH_DISCORD_REQUIRED_ROLE_IDS;
  t.after(() => {
    if (guild === undefined) delete process.env.OAUTH_DISCORD_GUILD_ID;
    else process.env.OAUTH_DISCORD_GUILD_ID = guild;
    if (roles === undefined) delete process.env.OAUTH_DISCORD_REQUIRED_ROLE_IDS;
    else process.env.OAUTH_DISCORD_REQUIRED_ROLE_IDS = roles;
  });
  process.env.OAUTH_DISCORD_GUILD_ID = '123';
  delete process.env.OAUTH_DISCORD_REQUIRED_ROLE_IDS;
  assert.throws(() => discordRolePolicy());
  process.env.OAUTH_DISCORD_REQUIRED_ROLE_IDS = '456,789';
  let response = new Response(JSON.stringify({ roles: ['789'] }));
  t.mock.method(globalThis, 'fetch', async () => response);
  assert.equal(await discordMembership('test'), 'allowed');
  response = new Response(JSON.stringify({ roles: ['000'] }));
  assert.equal(await discordMembership('test'), 'denied');
  response = new Response(null, { status: 404 });
  assert.equal(await discordMembership('test'), 'denied');
  response = new Response(null, { status: 401 });
  assert.equal(await discordMembership('test'), 'expired');
  response = new Response(null, { status: 429 });
  await assert.rejects(discordMembership('test'), /Discord is rate limiting membership checks/);
  response = new Response(null, { status: 502 });
  await assert.rejects(discordMembership('test'), /Discord membership verification unavailable/);
});
