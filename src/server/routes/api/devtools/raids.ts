import { linkedDiscordRole } from '@/server/middleware/discord-roles';
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
const importCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?:[0-9a-hjkmnp-tv-z]{10}|[a-f0-9]{32})$/);
const photoData = z
  .string()
  .max(1400000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
function imageType(bytes: Buffer) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  return null;
}

function countStorage(entities: unknown) {
  const counts = { furnaces: 0, largeBoxes: 0, smallBoxes: 0, lockers: 0, toolCupboards: 0 };
  if (!Array.isArray(entities)) return counts;
  for (const entity of entities) {
    const name = String(entity?.prefabname ?? '')
      .split('/')
      .pop()
      ?.replace(/\.prefab$/, '');
    if (name === 'box.wooden.large') counts.largeBoxes++;
    if (name === 'woodbox_deployed') counts.smallBoxes++;
    if (name === 'locker.deployed') counts.lockers++;
    if (name === 'cupboard.tool.deployed') counts.toolCupboards++;
    if (
      name === 'furnace' ||
      name === 'furnace.large' ||
      name === 'electricfurnace.deployed' ||
      name === 'industrial_electric_furnace.deployed'
    )
      counts.furnaces++;
  }
  return counts;
}
function stripLockAccess(snapshotData: z.infer<typeof snapshot>) {
  const pending: unknown[] = [...snapshotData.entities];
  while (pending.length) {
    const entry = pending.pop();
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const entity = entry as Record<string, unknown>;
    const prefab = String(entity.prefabname ?? '');
    if (prefab.endsWith('/lock.code.prefab')) {
      entity.code = '';
      delete entity.guestCode;
      delete entity.whitelistPlayers;
      delete entity.guestPlayers;
    } else if (prefab.endsWith('/lock.key.prefab')) {
      entity.code = '0';
      entity.firstKeyCreated = false;
    }
    if (entity.lock) pending.push(entity.lock);
    if (Array.isArray(entity.children)) for (const child of entity.children) pending.push(child);
  }
}
const draft = z.object({
  name: z.string().trim().min(1).max(100),
  tier: z.enum(tiers),
  parent: key.optional(),
  data: snapshot.optional(),
  importCode: importCode.optional(),
  loot: lootSchema.nullable(),
});
type Req = Parameters<typeof authenticateUser>[0];
type Res = Parameters<typeof authenticateUser>[1];
const adminOnly = async (req: Req, res: Res) => {
  await authenticateUser(req, res);
  if (req.user.role !== 'SUPERADMIN') return res.code(403).send({ error: 'Site administrator required' });
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
      sql`ALTER TABLE resil_raid_policy ADD COLUMN IF NOT EXISTS discord_role text NOT NULL DEFAULT '750403808483475468'`,
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
    await db.execute(sql`ALTER TABLE resil_raid_imports ADD COLUMN IF NOT EXISTS photo text`);
    await db.execute(sql`ALTER TABLE resil_raid_revisions ADD COLUMN IF NOT EXISTS photo text`);
    await db.execute(
      sql`ALTER TABLE resil_raid_revisions ADD COLUMN IF NOT EXISTS revision_notice_seen boolean NOT NULL DEFAULT false`,
    );
    await db.execute(sql`CREATE TABLE IF NOT EXISTS resil_raid_activity (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, revision_id text, builder text,
      actor text, audience text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS resil_raid_activity_read (
      activity_id bigint REFERENCES resil_raid_activity(id) ON DELETE CASCADE,
      user_id text NOT NULL, PRIMARY KEY(activity_id,user_id))`);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS resil_raid_activity_builder_idx ON resil_raid_activity (builder,id DESC)`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS resil_raid_activity_audience_idx ON resil_raid_activity (audience,id DESC)`,
    );
    await db.execute(sql`INSERT INTO resil_raid_activity(revision_id,builder,audience,message)
      SELECT id,author,'builder','Revision requested for ' || name || ' · revision ' || revision
      FROM resil_raid_revisions r WHERE status='Revise' AND NOT revision_notice_seen
      AND NOT EXISTS (SELECT FROM resil_raid_activity a WHERE a.revision_id=r.id AND a.message LIKE 'Revision requested%')`);
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS resil_raid_loot (name text primary key, version int not null, data jsonb not null)`,
    );
  })().catch((e) => {
    ready = undefined;
    throw e;
  }));
}
const policyQuery = sql`SELECT rule,version,discord_role AS "discordRole" FROM resil_raid_policy WHERE singleton`;
type PanelMember = { id: string; username: string };
let rosterCache: { role: string; expires: number; result: Promise<PanelMember[]> } | undefined;
function panelRoster(role: string) {
  if (rosterCache?.role === role && rosterCache.expires > Date.now()) return rosterCache.result;
  const result = loadPanelRoster(role);
  rosterCache = { role, expires: Infinity, result };
  void result.then(
    () => {
      if (rosterCache?.result === result) rosterCache.expires = Date.now() + 30000;
    },
    () => {
      if (rosterCache?.result === result) rosterCache = undefined;
    },
  );
  return result;
}
async function loadPanelRoster(role: string) {
  const guild = process.env.OAUTH_DISCORD_GUILD_ID;
  if (!guild) throw new Error('Raid Center requires the Rust Empires Discord server to be configured.');
  const { rows } = await db.execute(sql`SELECT DISTINCT u.id,u.username FROM "User" u
    JOIN "OAuthProvider" o ON o."userId"=u.id WHERE o.provider='DISCORD' ORDER BY u.username`);
  const members: PanelMember[] = [];
  for (let offset = 0; offset < rows.length; offset += 4) {
    await Promise.all(
      rows.slice(offset, offset + 4).map(async (row) => {
        const id = String(row.id);
        if (await linkedDiscordRole(id, { guild, roles: [role] }))
          members.push({ id, username: String(row.username) });
      }),
    );
  }
  return members.sort((a, b) => a.username.localeCompare(b.username));
}
function panelProgress(rule: PanelRule, roster: Set<string>, author: string, votes: Record<string, string>) {
  const eligible = roster.size - Number(roster.has(author));
  const counts: Record<string, number> = { Approve: 0, Revise: 0, Reject: 0 };
  for (const [id, vote] of Object.entries(votes))
    if (id !== author && roster.has(id) && vote in counts) counts[vote]++;
  return { eligible, required: requiredVotes(rule, eligible), counts };
}
function addActivity(event: {
  revisionId?: string;
  builder?: string;
  actor?: string;
  audience: string;
  message: string;
}) {
  return sql`INSERT INTO resil_raid_activity(revision_id,builder,actor,audience,message)
    VALUES (${event.revisionId ?? null},${event.builder ?? null},${event.actor ?? null},${event.audience},${event.message})`;
}

async function activityScope(user: Req['user']) {
  const admin = user.role === 'SUPERADMIN';
  const policy = (await db.execute(policyQuery)).rows[0];
  const reviewer = await panelRoster(String(policy.discordRole))
    .then((members) => members.some((member) => member.id === user.id))
    .catch(() => false);
  return sql`(a.actor IS DISTINCT FROM ${user.id}) AND
    (a.builder=${user.id} OR (a.audience='panel' AND (${reviewer} OR ${admin})) OR (a.audience='admin' AND ${admin}))`;
}
const columns = sql.raw('id,family,revision,name,tier,loot,author,status,votes,notes');
export default typedPlugin(async (server) => {
  server.addHook('preHandler', async (req) => {
    if (req.url.startsWith(PATH)) await setup();
  });
  server.post(
    PATH + '/catalog/import',
    { preHandler: machine('PUBLISH'), bodyLimit: 16 * 1024 * 1024 },
    async (req, res) => {
      const { name, tier, data, photo } = draft
        .pick({ name: true, tier: true })
        .extend({ data: snapshot, photo: photoData.optional() })
        .parse(req.body);
      if (photo && !imageType(Buffer.from(photo, 'base64')))
        return res.code(400).send({ error: 'Invalid Rust camera image' });

      stripLockAccess(data);
      await db.execute(sql`DELETE FROM resil_raid_imports WHERE expires<=now()`);
      const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = Array.from(randomBytes(10), (byte) => alphabet[byte & 31]).join('');
        const inserted = await db.execute(
          sql`INSERT INTO resil_raid_imports(code,name,tier,data,photo) VALUES (${code},${name},${tier},${JSON.stringify(data)}::jsonb,${photo ?? null}) ON CONFLICT DO NOTHING RETURNING code`,
        );
        if (inserted.rows.length) return { code };
      }
      throw new Error('Could not allocate a raid import code');
    },
  );
  server.post(PATH + '/import', { preHandler: authenticateUser }, async (req, res) => {
    const { code, metadataOnly } = z
      .object({ code: importCode, metadataOnly: z.boolean().optional() })
      .parse(req.body);
    const result = await db.execute(sql`UPDATE resil_raid_imports SET claimant=${req.user.id}
      WHERE code=${code} AND expires>now() AND (claimant IS NULL OR claimant=${req.user.id})
      RETURNING name,tier,(photo IS NOT NULL) AS "hasPhoto"${metadataOnly ? sql`` : sql`,data`}`);
    return result.rows[0] ?? res.code(404).send({ error: 'Import code expired or unavailable' });
  });
  server.post(PATH + '/key', { preHandler: adminOnly }, async (req, res) => {
    const { scope } = z.object({ scope: z.enum(['READ', 'PUBLISH']) }).parse(req.body);
    const value = randomBytes(32).toString('hex');
    const digest = createHash('sha256').update(value).digest('hex');
    await db.execute(
      sql`INSERT INTO resil_raid_keys VALUES (${scope},${digest}) ON CONFLICT(scope) DO UPDATE SET digest=excluded.digest`,
    );
    return res.header('Cache-Control', 'no-store').send({ value });
  });
  server.post(PATH + '/policy', { preHandler: adminOnly }, async (req, res) => {
    const parsed = z
      .object({
        rule: panelRule,
        discordRole: z
          .string()
          .trim()
          .regex(/^\d{17,20}$/),
        version: z.number().int().positive(),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.code(400).send({ error: 'Check the vote requirements and enter a valid Discord role ID.' });
    const { rule, version, discordRole } = parsed.data;
    return db.transaction(async (tx) => {
      const result = await tx.execute(
        sql`UPDATE resil_raid_policy SET rule=${JSON.stringify(rule)}::jsonb,discord_role=${discordRole},version=version+1 WHERE singleton AND version=${version} RETURNING version`,
      );
      if (!result.rows.length)
        return res.code(409).send({ error: 'Settings changed. Refresh and reopen panel settings.' });
      await tx.execute(
        addActivity({
          actor: req.user.id,
          audience: 'panel',
          message: 'Raid panel voting or Discord role settings updated',
        }),
      );
      return { saved: true };
    });
  });
  server.get(PATH, { preHandler: authenticateUser }, async (req) => {
    const policy = (await db.execute(policyQuery)).rows[0];
    const members = await panelRoster(String(policy.discordRole)).catch(() => null);
    const roster = new Set((members ?? []).map((member) => member.id));
    const reviewer = roster.has(req.user.id);
    const admin = req.user.role === 'SUPERADMIN';
    const revisions = await db.execute(
      sql`SELECT ${columns} FROM resil_raid_revisions WHERE ${reviewer || admin} OR author=${req.user.id} ORDER BY name,revision DESC`,
    );
    const tables = await db.execute(sql`SELECT version,data FROM resil_raid_loot ORDER BY name`);
    return {
      policy,
      panelSize: roster.size,
      panelUnavailable: members === null,
      admin,
      panelMembers: admin ? members : undefined,
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
  server.get(PATH + '/notifications', { preHandler: authenticateUser }, async (req, res) => {
    const scope = await activityScope(req.user);
    const { rows } =
      await db.execute(sql`SELECT a.id::text,a.revision_id AS "revisionId",a.message,a.created_at AS "createdAt"
      FROM resil_raid_activity a WHERE ${scope} AND NOT EXISTS
      (SELECT FROM resil_raid_activity_read x WHERE x.activity_id=a.id AND x.user_id=${req.user.id})
      ORDER BY a.id DESC LIMIT 100`);
    return res.header('Cache-Control', 'private, no-store').send({ notices: rows });
  });
  server.post(PATH + '/notifications/read', { preHandler: authenticateUser }, async (req, res) => {
    const { id } = z.object({ id: z.string().regex(/^\d{1,18}$/) }).parse(req.body);
    const scope = await activityScope(req.user);
    const result = await db.execute(sql`INSERT INTO resil_raid_activity_read(activity_id,user_id)
      SELECT a.id,${req.user.id} FROM resil_raid_activity a WHERE a.id=${id}::bigint AND ${scope}
      ON CONFLICT DO NOTHING RETURNING activity_id`);
    return result.rows.length ? { saved: true } : res.code(404).send({ error: 'Notification unavailable' });
  });
  server.get(PATH + '/:id/storage', { preHandler: authenticateUser }, async (req, res) => {
    const { id } = z.object({ id: key }).parse(req.params);
    const row = (await db.execute(sql`SELECT author FROM resil_raid_revisions WHERE id=${id}`)).rows[0];
    if (!row) return res.code(404).send({ error: 'Revision missing' });
    if (row.author !== req.user.id && req.user.role !== 'SUPERADMIN') {
      const policy = (await db.execute(policyQuery)).rows[0];
      if (!(await panelRoster(String(policy.discordRole))).some((member) => member.id === req.user.id))
        return res.code(404).send({ error: 'Revision missing' });
    }
    const snapshotRow = (
      await db.execute(
        sql`SELECT data->'entities' AS entities,photo FROM resil_raid_revisions WHERE id=${id}`,
      )
    ).rows[0];
    const photo = typeof snapshotRow.photo === 'string' ? snapshotRow.photo : null;
    const type = photo && imageType(Buffer.from(photo, 'base64'));
    return res.header('Cache-Control', 'private, no-store').send({
      counts: countStorage(snapshotRow.entities),
      photo: type ? 'data:' + type + ';base64,' + photo : null,
    });
  });
  server.post(PATH + '/loot', { preHandler: authenticateUser }, async (req, res) => {
    const policy = (await db.execute(policyQuery)).rows[0];
    if (
      req.user.role !== 'SUPERADMIN' &&
      !(await panelRoster(String(policy.discordRole))).some((member) => member.id === req.user.id)
    )
      return res.code(403).send({ error: 'Discord panel role required' });
    const { table, version } = z
      .object({ table: lootSchema, version: z.number().int().nonnegative() })
      .parse(req.body);
    return db.transaction(async (tx) => {
      const result =
        version === 0
          ? await tx.execute(
              sql`INSERT INTO resil_raid_loot VALUES (${table.Name},1,${JSON.stringify(table)}::jsonb) ON CONFLICT DO NOTHING RETURNING version`,
            )
          : await tx.execute(
              sql`UPDATE resil_raid_loot SET data=${JSON.stringify(table)}::jsonb,version=version+1 WHERE name=${table.Name} AND version=${version} RETURNING version`,
            );
      if (!result.rows.length) return res.code(409).send({ error: 'Table changed. Refresh and reopen it.' });
      await tx.execute(
        addActivity({ actor: req.user.id, audience: 'panel', message: 'Loot table saved · ' + table.Name }),
      );
      return { saved: true };
    });
  });
  server.post(PATH, { preHandler: authenticateUser, bodyLimit: 16 * 1024 * 1024 }, async (req, res) => {
    const value = draft.parse(req.body);
    let imported: Record<string, unknown> | undefined;
    if (value.importCode) {
      imported = (
        await db.execute(sql`SELECT data,photo FROM resil_raid_imports
        WHERE code=${value.importCode} AND claimant=${req.user.id} AND expires>now()`)
      ).rows[0];
    } else if (value.data) {
      // Older open clients send the imported snapshot instead of its code.
      imported = (
        await db.execute(sql`SELECT data,photo FROM resil_raid_imports
        WHERE claimant=${req.user.id} AND expires>now() AND data=${JSON.stringify(value.data)}::jsonb
        ORDER BY expires DESC LIMIT 1`)
      ).rows[0];
    }
    if (value.importCode && !imported)
      return res.code(404).send({ error: 'Import the base again with a current code' });
    const data = imported ? imported.data : value.data;
    if (!data)
      return res.code(400).send({ error: 'Import a creative-server snapshot or upload a CopyPaste file' });
    if (req.user.role !== 'SUPERADMIN' && !imported?.photo)
      return res
        .code(400)
        .send({ error: 'Take a Rust camera photo after /reraid submit, then import the new code.' });
    if (!imported && value.data) stripLockAccess(value.data);
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
    return db.transaction(async (tx) => {
      const result =
        await tx.execute(sql`INSERT INTO resil_raid_revisions(id,family,revision,name,tier,data,loot,author,photo) VALUES
      (${id},${family},${rev},${value.name},${value.tier},${JSON.stringify(data)}::jsonb,${JSON.stringify(value.loot)}::jsonb,${req.user.id},${imported ? imported.photo : null}) ON CONFLICT DO NOTHING RETURNING id`);
      if (!result.rows.length) return res.code(409).send({ error: 'A newer revision already exists' });
      await tx.execute(
        addActivity({
          revisionId: id,
          actor: req.user.id,
          audience: 'panel',
          message: `${rev > 1 ? 'New revision' : 'New raid submission'} · ${value.name} · revision ${rev}`,
        }),
      );
      return { id };
    });
  });
  server.post(PATH + '/:id/review', { preHandler: authenticateUser }, async (req, res) => {
    const { id } = z.object({ id: key }).parse(req.params);
    const { action, note, difficulty } = z
      .object({
        action: z.enum(['Approve', 'Revise', 'Reject', 'Publish', 'Comment', 'Recommend difficulty']),
        difficulty: z.enum(tiers).optional(),
        note: z.string().trim().max(2000),
      })
      .parse(req.body);
    const policy = (await db.execute(policyQuery)).rows[0];
    const roster =
      action === 'Publish'
        ? new Set<string>()
        : new Set((await panelRoster(String(policy.discordRole))).map((member) => member.id));
    if (action === 'Publish' ? req.user.role !== 'SUPERADMIN' : !roster.has(req.user.id))
      return res.code(403).send({
        error: action === 'Publish' ? 'Site administrator required' : 'Discord panel role required',
      });
    return db.transaction(async (tx) => {
      const row = (
        await tx.execute(
          sql`SELECT name,revision,author,status,votes FROM resil_raid_revisions WHERE id=${id} FOR UPDATE`,
        )
      ).rows[0];
      if (!row) return res.code(404).send({ error: 'Revision missing' });
      let status = String(row.status);
      const votes = row.votes as Record<string, string>;
      const previousVote = votes[req.user.id];
      if (action === 'Publish') {
        if (status !== 'Approved') return res.code(409).send({ error: 'Approval required' });
        status = 'Published';
      } else if (action === 'Recommend difficulty') {
        if (status !== 'Pending') return res.code(409).send({ error: 'This review has already closed' });
        if (!difficulty) return res.code(400).send({ error: 'Choose a difficulty to recommend' });
      } else if (action === 'Comment') {
        if (!note) return res.code(400).send({ error: 'Enter a comment' });
      } else {
        if (row.author === req.user.id || status !== 'Pending')
          return res.code(409).send({ error: 'Only independent reviewers can vote on pending revisions' });
        if (action === 'Revise' && !note)
          return res.code(400).send({ error: 'Explain the changes the builder should make.' });
        votes[req.user.id] = action;
        const currentPolicy = (await tx.execute(sql`${policyQuery} FOR SHARE`)).rows[0];
        if (currentPolicy.version !== policy.version)
          return res.code(409).send({ error: 'Panel settings changed. Try voting again.' });
        const progress = panelProgress(policy.rule as PanelRule, roster, String(row.author), votes);
        if (progress.counts[action] >= progress.required) status = action === 'Approve' ? 'Approved' : action;
      }
      const log = [
        {
          by: req.user.username,
          action,
          note,
          difficulty: action === 'Recommend difficulty' ? difficulty : undefined,
          at: new Date().toISOString(),
        },
      ];
      await tx.execute(
        sql`UPDATE resil_raid_revisions SET status=${status},votes=${JSON.stringify(votes)}::jsonb,notes=notes || ${JSON.stringify(log)}::jsonb WHERE id=${id}`,
      );
      const decisions: Record<string, string> = {
        Approved: 'Raid approved',
        Revise: 'Revision requested',
        Reject: 'Raid rejected',
        Published: 'Raid published',
      };
      const decision = decisions[status];
      const changed = status !== row.status && decision;
      const visibleFeedback = action === 'Comment' || action === 'Recommend difficulty' || note.length > 0;
      if (changed || visibleFeedback || previousVote !== votes[req.user.id]) {
        const label =
          changed ||
          (action === 'Comment'
            ? 'New review comment'
            : action === 'Recommend difficulty'
              ? 'Difficulty recommendation · ' + difficulty
              : action === 'Revise'
                ? 'Revision feedback added'
                : 'Review vote recorded');
        await tx.execute(
          addActivity({
            revisionId: id,
            actor: req.user.id,
            audience: 'panel',
            builder: changed || visibleFeedback ? String(row.author) : undefined,
            message: `${label} · ${row.name} · revision ${row.revision}`,
          }),
        );
      }
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
  server.post(PATH + '/catalog/test/:id/started', { preHandler: machine('PUBLISH') }, async (req, res) => {
    const { id } = z.object({ id: key }).parse(req.params);
    const row = (await db.execute(sql`SELECT name,revision,author FROM resil_raid_revisions WHERE id=${id}`))
      .rows[0];
    if (!row) return res.code(404).send({ error: 'Revision missing' });
    await db.execute(
      addActivity({
        revisionId: id,
        builder: String(row.author),
        audience: 'builder',
        message: `Playtest started · ${row.name} · revision ${row.revision}`,
      }),
    );
    return { saved: true };
  });
  server.get(PATH + '/catalog/test/:id', { preHandler: machine('PUBLISH') }, async (req, res) => {
    const { id } = z.object({ id: key }).parse(req.params);
    const row = (
      await db.execute(sql`SELECT id,name,tier,loot,data FROM resil_raid_revisions WHERE id=${id}`)
    ).rows[0];
    return row ?? res.code(404).send({ error: 'Revision missing' });
  });
});
