import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { panelRule, requiredVotes, type PanelRule } from '@/lib/raids/panel';
import { db } from '@/lib/db';
import { lootSchema, tiers } from '@/lib/raids/loot';
import { userMiddleware as authenticateUser } from '@/server/middleware/user';
import typedPlugin from '@/server/typedPlugin';
import { sql } from 'drizzle-orm';
import z from 'zod';

export const PATH = '/api/devtools/raids';
const key = z.string().regex(/^[a-f0-9]{32}$/);
const snapshot = z.object({ entities: z.array(z.record(z.string(), z.unknown())).min(1) }).passthrough();
const draft = z.object({
  name: z.string().trim().min(1).max(100),
  tier: z.enum(tiers),
  parent: key.optional(),
  data: snapshot,
  loot: lootSchema.nullable(),
});
type Req = Parameters<typeof authenticateUser>[0];
type Res = Parameters<typeof authenticateUser>[1];
const isReviewer = (user: Req['user']) =>
  user.role === 'SUPERADMIN' ||
  (process.env.RESIL_RAID_PANEL_USERS || '')
    .split(',')
    .map((id) => id.trim())
    .includes(user.id);
const staff = async (req: Req, res: Res) => {
  await authenticateUser(req, res);
  if (!res.sent && !isReviewer(req.user))
    return res.code(403).send({ error: 'Site administrator access required' });
};
const machine = (access: 'READ' | 'PUBLISH') => async (req: Req, res: Res) => {
  const token = process.env['RESIL_RAID_' + access + '_TOKEN'];
  const candidate = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!req.headers.authorization?.startsWith('Bearer ') || candidate.length < 32 || candidate.length > 512)
    return res.code(401).send({ error: 'Raid server credentials required' });
  if (token && candidate === token) return;
  const digest = createHash('sha256').update(candidate).digest('hex');
  const match = await db.execute(
    sql`SELECT 1 FROM resil_raid_keys WHERE scope=${access} AND digest=${digest}`,
  );
  if (!match.rows.length) return res.code(401).send({ error: 'Raid server credentials required' });
};
let ready: Promise<void> | undefined;
function setup() {
  return (ready ??= (async () => {
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS resil_raid_policy (singleton boolean primary key check(singleton), rule jsonb not null, version integer not null)`,
    );
    await db.execute(
      sql`INSERT INTO resil_raid_policy VALUES(true,'{"mode":"fixed","minimum":2,"percent":67}',1) ON CONFLICT DO NOTHING`,
    );
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS resil_raid_keys (scope text primary key,digest text not null)`,
    );
    await db.execute(sql`CREATE TABLE IF NOT EXISTS resil_raid_imports (
      code text primary key, name text not null, tier text not null, data jsonb not null,
      claimant text, expires timestamptz not null default now() + interval '24 hours')`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS resil_raid_revisions (
      id text primary key, family text not null, revision int not null, name text not null, tier text not null,
      data jsonb not null, loot jsonb, author text not null, status text not null default 'Pending',
      votes jsonb not null default '{}', notes jsonb not null default '[]', unique(family,revision))`);
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS resil_raid_loot (name text primary key, version int not null, data jsonb not null)`,
    );
  })().catch((e) => {
    ready = undefined;
    throw e;
  }));
}
const policyQuery = sql`SELECT rule,version FROM resil_raid_policy WHERE singleton`;
function rosterQuery() {
  const configured = JSON.stringify(
    (process.env.RESIL_RAID_PANEL_USERS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
  return sql`SELECT id FROM "User" WHERE role='SUPERADMIN' OR id IN (SELECT jsonb_array_elements_text(${configured}::jsonb))`;
}
function panelProgress(rule: PanelRule, roster: Set<string>, author: string, votes: Record<string, string>) {
  const eligible = roster.size - Number(roster.has(author));
  const counts: Record<string, number> = { Approve: 0, Revise: 0, Reject: 0 };
  for (const [id, vote] of Object.entries(votes))
    if (id !== author && roster.has(id) && vote in counts) counts[vote]++;
  return { eligible, required: requiredVotes(rule, eligible), counts };
}
const columns = sql.raw('id,family,revision,name,tier,loot,author,status,votes,notes');
export default typedPlugin(async (server) => {
  server.addHook('preHandler', async (req) => {
    if (req.url.startsWith(PATH)) await setup();
  });
  server.post(
    PATH + '/catalog/import',
    { preHandler: machine('PUBLISH'), bodyLimit: 16 * 1024 * 1024 },
    async (req) => {
      const { name, tier, data } = draft.pick({ name: true, tier: true, data: true }).parse(req.body);

      await db.execute(sql`DELETE FROM resil_raid_imports WHERE expires<=now()`);
      const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = Array.from(randomBytes(10), (byte) => alphabet[byte & 31]).join('');
        const inserted = await db.execute(
          sql`INSERT INTO resil_raid_imports(code,name,tier,data) VALUES (${code},${name},${tier},${JSON.stringify(data)}::jsonb) ON CONFLICT DO NOTHING RETURNING code`,
        );
        if (inserted.rows.length) return { code };
      }
      throw new Error('Could not allocate a raid import code');
    },
  );
  server.post(PATH + '/import', { preHandler: authenticateUser }, async (req, res) => {
    const { code } = z.object({ code: z.string().trim().toLowerCase().regex(/^(?:[0-9a-hjkmnp-tv-z]{10}|[a-f0-9]{32})$/) }).parse(req.body);
    const result = await db.execute(sql`UPDATE resil_raid_imports SET claimant=${req.user.id}
      WHERE code=${code} AND expires>now() AND (claimant IS NULL OR claimant=${req.user.id})
      RETURNING name,tier,data`);
    return result.rows[0] ?? res.code(404).send({ error: 'Import code expired or unavailable' });
  });
  server.post(PATH + '/key', { preHandler: staff }, async (req, res) => {
    if (req.user.role !== 'SUPERADMIN') return res.code(403).send({ error: 'Site administrator required' });
    const { scope } = z.object({ scope: z.enum(['READ', 'PUBLISH']) }).parse(req.body);
    const value = randomBytes(32).toString('hex');
    const digest = createHash('sha256').update(value).digest('hex');
    await db.execute(
      sql`INSERT INTO resil_raid_keys VALUES (${scope},${digest}) ON CONFLICT(scope) DO UPDATE SET digest=excluded.digest`,
    );
    return res.header('Cache-Control', 'no-store').send({ value });
  });
  server.post(PATH + '/policy', { preHandler: staff }, async (req, res) => {
    if (req.user.role !== 'SUPERADMIN') return res.code(403).send({ error: 'Site administrator required' });
    const parsed = z.object({ rule: panelRule, version: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) return res.code(400).send({ error: 'Check the vote minimum and percentage.' });
    const { rule, version } = parsed.data;
    const result = await db.execute(
      sql`UPDATE resil_raid_policy SET rule=${JSON.stringify(rule)}::jsonb,version=version+1 WHERE singleton AND version=${version} RETURNING version`,
    );
    if (!result.rows.length)
      return res.code(409).send({ error: 'Settings changed. Refresh and reopen panel settings.' });
    return { saved: true };
  });
  server.get(PATH, { preHandler: authenticateUser }, async (req) => {
    const reviewer = isReviewer(req.user);
    const revisions = await db.execute(
      sql`SELECT ${columns} FROM resil_raid_revisions WHERE ${reviewer} OR author=${req.user.id} ORDER BY name,revision DESC`,
    );
    const tables = await db.execute(sql`SELECT version,data FROM resil_raid_loot ORDER BY name`);
    const policy = (await db.execute(policyQuery)).rows[0];
    const roster = new Set((await db.execute(rosterQuery())).rows.map((row) => String(row.id)));
    return {
      policy,
      panelSize: roster.size,
      admin: req.user.role === 'SUPERADMIN',
      reviewer,
      viewer: req.user.id,
      revisions: revisions.rows.map((r) => ({
        ...r,
        progress: panelProgress(
          policy.rule as PanelRule,
          roster,
          String(r.author),
          r.votes as Record<string, string>,
        ),
      })),
      tables: tables.rows,
    };
  });
  server.post(PATH + '/loot', { preHandler: staff }, async (req, res) => {
    const { table, version } = z
      .object({ table: lootSchema, version: z.number().int().nonnegative() })
      .parse(req.body);
    const result =
      version === 0
        ? await db.execute(
            sql`INSERT INTO resil_raid_loot VALUES (${table.Name},1,${JSON.stringify(table)}::jsonb) ON CONFLICT DO NOTHING RETURNING version`,
          )
        : await db.execute(
            sql`UPDATE resil_raid_loot SET data=${JSON.stringify(table)}::jsonb,version=version+1 WHERE name=${table.Name} AND version=${version} RETURNING version`,
          );
    if (!result.rows.length) return res.code(409).send({ error: 'Table changed. Refresh and reopen it.' });
    return { saved: true };
  });
  server.post(PATH, { preHandler: authenticateUser, bodyLimit: 16 * 1024 * 1024 }, async (req, res) => {
    const value = draft.parse(req.body);
    const id = randomUUID().replaceAll('-', '');
    const previous =
      value.parent &&
      (
        await db.execute(
          sql`SELECT family,revision,status,author FROM resil_raid_revisions WHERE id=${value.parent}`,
        )
      ).rows[0];
    if (
      value.parent &&
      (!previous ||
        previous.author !== req.user.id ||
        !['Published', 'Revise', 'Reject'].includes(String(previous.status)))
    )
      return res.code(409).send({ error: 'Select a reviewed parent revision' });
    const family = previous ? String(previous.family) : id;
    const rev = previous ? Number(previous.revision) + 1 : 1;
    const result =
      await db.execute(sql`INSERT INTO resil_raid_revisions(id,family,revision,name,tier,data,loot,author) VALUES
      (${id},${family},${rev},${value.name},${value.tier},${JSON.stringify(value.data)}::jsonb,${JSON.stringify(value.loot)}::jsonb,${req.user.id}) ON CONFLICT DO NOTHING RETURNING id`);
    if (!result.rows.length) return res.code(409).send({ error: 'A newer revision already exists' });
    return { id };
  });
  server.post(PATH + '/:id/review', { preHandler: staff }, async (req, res) => {
    const { id } = z.object({ id: key }).parse(req.params);
    const { action, note } = z
      .object({
        action: z.enum(['Approve', 'Revise', 'Reject', 'Publish', 'Comment']),
        note: z.string().trim().max(2000),
      })
      .parse(req.body);
    return db.transaction(async (tx) => {
      const row = (
        await tx.execute(sql`SELECT author,status,votes FROM resil_raid_revisions WHERE id=${id} FOR UPDATE`)
      ).rows[0];
      if (!row) return res.code(404).send({ error: 'Revision missing' });
      let status = String(row.status);
      const votes = row.votes as Record<string, string>;
      if (action === 'Publish') {
        if (status !== 'Approved') return res.code(409).send({ error: 'Approval required' });
        status = 'Published';
      } else if (action === 'Comment') {
        if (!note) return res.code(400).send({ error: 'Enter a comment' });
      } else {
        if (row.author === req.user.id || status !== 'Pending')
          return res.code(409).send({ error: 'Only independent reviewers can vote on pending revisions' });
        votes[req.user.id] = action;
        const policy = (await tx.execute(sql`${policyQuery} FOR SHARE`)).rows[0];
        const roster = new Set((await tx.execute(rosterQuery())).rows.map((row) => String(row.id)));
        const progress = panelProgress(policy.rule as PanelRule, roster, String(row.author), votes);
        if (progress.counts[action] >= progress.required) status = action === 'Approve' ? 'Approved' : action;
      }
      const log = [{ by: req.user.username, action, note, at: new Date().toISOString() }];
      await tx.execute(
        sql`UPDATE resil_raid_revisions SET status=${status},votes=${JSON.stringify(votes)}::jsonb,notes=notes || ${JSON.stringify(log)}::jsonb WHERE id=${id}`,
      );
      return { status };
    });
  });
  server.get(
    PATH + '/catalog',
    { preHandler: machine('READ') },
    async () =>
      (
        await db.execute(
          sql`SELECT DISTINCT ON (family) id,family,name,tier,revision,loot FROM resil_raid_revisions WHERE status='Published' ORDER BY family,revision DESC`,
        )
      ).rows,
  );
  server.get(PATH + '/catalog/:id', { preHandler: machine('READ') }, async (req, res) => {
    const { id } = z.object({ id: key }).parse(req.params);
    const row = (
      await db.execute(sql`SELECT data FROM resil_raid_revisions WHERE id=${id} AND status='Published'`)
    ).rows[0];
    return row ? row.data : res.code(404).send({ error: 'Published revision missing' });
  });
  server.get(PATH + '/catalog/test/:id', { preHandler: machine('PUBLISH') }, async (req, res) => {
    const { id } = z.object({ id: key }).parse(req.params);
    const row = (
      await db.execute(sql`SELECT id,name,tier,loot,data FROM resil_raid_revisions WHERE id=${id}`)
    ).rows[0];
    return row ?? res.code(404).send({ error: 'Revision missing' });
  });
});
