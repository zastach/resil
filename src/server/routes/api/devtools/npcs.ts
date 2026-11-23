import { db } from '@/lib/db';
import { isAdministrator } from '@/lib/role';
import { authenticateUser } from '@/server/middleware/user';
import typedPlugin from '@/server/typedPlugin';
import { sql } from 'drizzle-orm';
import z from 'zod';

export const PATH = '/api/devtools/npcs';
const id = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
const folderBody = z.object({ id: id.optional(), name: z.string().trim().min(1).max(100), parentId: id.nullable().optional() });
const npcBody = z.object({ id, name: z.string().trim().min(1).max(150), folderId: id.nullable().optional(), definition: z.record(z.string(), z.unknown()) });
const guard = async (req: Parameters<typeof authenticateUser>[0], res: Parameters<typeof authenticateUser>[1]) => {
 await authenticateUser(req,res);
 if(!isAdministrator(req.user.role)) throw new Error('Administrator access required');
};
let initialized:Promise<void>|undefined;
function setup(){
 initialized ??= (async()=>{
  await db.execute(sql`CREATE TABLE IF NOT EXISTS resil_npc_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS resil_npc_definitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, folder_id TEXT, definition JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 })().catch(e=>{initialized=undefined;throw e;});
 return initialized;
}
export default typedPlugin(async server=>{
 server.get(PATH,{preHandler:[guard]},async (_req,res)=>{
  await setup();
  const folders=await db.execute(sql`SELECT id,name,parent_id AS "parentId" FROM resil_npc_folders ORDER BY name`);
  const npcs=await db.execute(sql`SELECT id,name,folder_id AS "folderId",definition,revision,created_by AS "createdBy",updated_by AS "updatedBy",updated_at AS "updatedAt" FROM resil_npc_definitions ORDER BY name`);
  return res.send({folders:folders.rows,npcs:npcs.rows});
 });
 server.post(PATH+'/folders',{preHandler:[guard]},async (req,res)=>{
  const body=folderBody.parse(req.body);await setup();
  const folderId=body.id||'folder-'+crypto.randomUUID();
  if(body.parentId===folderId)return res.code(400).send({error:'Folder cannot contain itself'});
  if(body.parentId){const p=await db.execute(sql`SELECT id FROM resil_npc_folders WHERE id=${body.parentId}`);if(!p.rows.length)return res.code(400).send({error:'Parent folder does not exist'});}
  await db.execute(sql`INSERT INTO resil_npc_folders(id,name,parent_id) VALUES (${folderId},${body.name},${body.parentId||null}) ON CONFLICT (id) DO UPDATE SET name=excluded.name,parent_id=excluded.parent_id`);
  return res.send({id:folderId});
 });
 server.delete(PATH+'/folders/:id',{preHandler:[guard]},async(req,res)=>{
  const folderId=id.parse((req.params as {id:string}).id);await setup();
  await db.execute(sql`UPDATE resil_npc_definitions SET folder_id=NULL WHERE folder_id=${folderId}`);
  await db.execute(sql`UPDATE resil_npc_folders SET parent_id=NULL WHERE parent_id=${folderId}`);
  await db.execute(sql`DELETE FROM resil_npc_folders WHERE id=${folderId}`);
  return res.send({ok:true});
 });
 server.put(PATH+'/:id',{preHandler:[guard]},async(req,res)=>{
  const npcId=id.parse((req.params as {id:string}).id);const body=npcBody.parse(req.body);await setup();
  if(body.id!==npcId)return res.code(400).send({error:'NPC ID mismatch'});
  if(body.folderId){const f=await db.execute(sql`SELECT id FROM resil_npc_folders WHERE id=${body.folderId}`);if(!f.rows.length)return res.code(400).send({error:'Folder does not exist'});}
  const author=req.user.username;
  const result=await db.execute(sql`INSERT INTO resil_npc_definitions(id,name,folder_id,definition,created_by,updated_by) VALUES (${npcId},${body.name},${body.folderId||null},${JSON.stringify(body.definition)}::jsonb,${author},${author}) ON CONFLICT(id) DO UPDATE SET name=excluded.name,folder_id=excluded.folder_id,definition=excluded.definition,revision=resil_npc_definitions.revision+1,updated_by=excluded.updated_by,updated_at=now() RETURNING revision`);
  return res.send({revision:result.rows[0]?.revision});
 });
 server.delete(PATH+'/:id',{preHandler:[guard]},async(req,res)=>{
  const npcId=id.parse((req.params as {id:string}).id);await setup();
  await db.execute(sql`DELETE FROM resil_npc_definitions WHERE id=${npcId}`);
  return res.send({ok:true});
 });
});
