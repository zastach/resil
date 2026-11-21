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
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => response);
  assert.deepEqual(await Promise.all([discordMembership('test'), discordMembership('test')]), [
    'allowed',
    'allowed',
  ]);
  assert.equal(await discordMembership('test'), 'allowed');
  assert.equal(fetchMock.mock.callCount(), 1);
  response = new Response(JSON.stringify({ roles: ['000'] }));
  assert.equal(await discordMembership('denied'), 'denied');
  response = new Response(null, { status: 404 });
  assert.equal(await discordMembership('denied'), 'denied');
  response = new Response(null, { status: 401 });
  assert.equal(await discordMembership('expired'), 'expired');
  response = new Response(null, { status: 429, headers: { 'Retry-After': '2.5' } });
  await assert.rejects(
    discordMembership('limited'),
    /Discord is rate limiting membership checks.*Please try logging out and back in\./,
  );
  const calls = fetchMock.mock.callCount();
  await assert.rejects(discordMembership('limited'), /Discord is rate limiting/);
  assert.equal(fetchMock.mock.callCount(), calls);
  response = new Response(null, { status: 502 });
  await assert.rejects(
    discordMembership('unavailable'),
    /Discord membership verification unavailable.*Please try logging out and back in\./,
  );
});
