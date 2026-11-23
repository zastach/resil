import { db } from '@/lib/db';
import { encodeVoicePackets } from '@/server/lib/npc-voice';
import { isAdministrator } from '@/lib/role';
import { authenticateUser } from '@/server/middleware/user';
import typedPlugin from '@/server/typedPlugin';
import { sql } from 'drizzle-orm';
import z from 'zod';

export const PATH = '/api/devtools/npcs';
const id = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
const folderBody = z.object({ id: id.optional(), name: z.string().trim().min(1).max(100), parentId: id.nullable().optional() });
const npcBody = z.object({ id, name: z.string().trim().min(1).max(150), folderId: id.nullable().optional(), expectedRevision: z.number().int().min(0).optional(), definition: z.record(z.string(), z.unknown()) });
const MAX_NPCS = 1000;
const MAX_DEFINITION_BYTES = 64 * 1024;
const audioBody = z.object({ filename:z.string().min(1).max(200), contentType:z.enum(['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg']), data:z.string().min(1).max(11200000) });
const guard = async (req: Parameters<typeof authenticateUser>[0], res: Parameters<typeof authenticateUser>[1]) => {
 await authenticateUser(req,res);
 if(!req.user || !isAdministrator(req.user.role)) return res.code(403).send({error:'Administrator access required'});
};
let initialized:Promise<void>|undefined;
function setup(){
 initialized ??= (async()=>{
  await db.execute(sql`CREATE TABLE IF NOT EXISTS resil_npc_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS resil_npc_audio (id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL, content BYTEA NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS resil_npc_voice_frames (audio_id TEXT PRIMARY KEY, frames JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS resil_npc_definitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, folder_id TEXT, definition JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
 })().catch(e=>{initialized=undefined;throw e;});
 return initialized;
}
export default typedPlugin(async server=>{
 const runtimeGuard=async(req:Parameters<typeof authenticateUser>[0],res:Parameters<typeof authenticateUser>[1])=>{const secret=process.env.RESIL_NPC_RUNTIME_TOKEN;if(!secret||secret.length<32||req.headers.authorization!=='Bearer '+secret)return res.code(401).send({error:'Runtime authentication required'});};
 server.get(PATH+'/runtime',{preHandler:[runtimeGuard]},async(_req,res)=>{await setup();const npcs=await db.execute(sql`SELECT id,name,definition,revision FROM resil_npc_definitions ORDER BY name`);return res.header('Cache-Control','no-store').send({version:1,npcs:npcs.rows});});
 server.get(PATH+'/runtime/audio/:id',{preHandler:[runtimeGuard]},async(req,res)=>{const audioId=id.parse((req.params as {id:string}).id);await setup();const result=await db.execute(sql`SELECT mime,content FROM resil_npc_audio WHERE id=${audioId}`);if(!result.rows.length)return res.code(404).send({error:'Audio not found'});const row=result.rows[0] as {mime:string;content:Buffer};return res.header('Cache-Control','private, max-age=3600').header('X-Content-Type-Options','nosniff').type(row.mime).send(row.content);});
 server.get(PATH+'/runtime/audio/:id/frames',{preHandler:[runtimeGuard]},async(req,res)=>{
  const audioId=id.parse((req.params as {id:string}).id);await setup();
  const result=await db.execute(sql`SELECT frames FROM resil_npc_voice_frames WHERE audio_id=${audioId}`);
  if(!result.rows.length)return res.code(404).send({error:'Voice packets unavailable'});
  return res.header('Cache-Control','no-store').send({version:1,codec:'opus',sampleRate:48000,frameDurationMs:20,frames:result.rows[0].frames});
 });
 server.post(PATH+'/audio',{preHandler:[guard],bodyLimit:12000000},async(req,res)=>{
  const body=audioBody.parse(req.body);
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.data))return res.code(400).send({error:'Invalid audio encoding'});
  const bytes=Buffer.from(body.data,'base64');
  if(bytes.length===0||bytes.length>8*1024*1024)return res.code(413).send({error:'Audio file must be 8 MB or smaller'});
  const mime=body.contentType==='audio/mp3'?'audio/mpeg':body.contentType==='audio/x-wav'?'audio/wav':body.contentType;
  const mp3=bytes.subarray(0,3).toString()==='ID3'||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0);
  const wav=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE';
  const ogg=bytes.subarray(0,4).toString()==='OggS';
  if(!((mime==='audio/mpeg'&&mp3)||(mime==='audio/wav'&&wav)||(mime==='audio/ogg'&&ogg)))return res.code(400).send({error:'File contents do not match MP3, WAV, or OGG audio'});
  let frames:string[];
  try{frames=await encodeVoicePackets(bytes);}catch(e){return res.code(422).send({error:'Unable to prepare Rust voice audio: '+String(e)});}
  await setup();
  const audioId='voice-'+crypto.randomUUID();
  await db.execute(sql`INSERT INTO resil_npc_audio(id,filename,mime,content,created_by) VALUES (${audioId},${body.filename},${mime},${bytes},${req.user.username})`);
  await db.execute(sql`INSERT INTO resil_npc_voice_frames(audio_id,frames) VALUES (${audioId},${JSON.stringify(frames)}::jsonb)`);
  return res.send({url:PATH+'/audio/'+audioId,id:audioId});
 });
 server.get(PATH+'/audio/:id',{preHandler:[guard]},async(req,res)=>{
  const audioId=id.parse((req.params as {id:string}).id);await setup();
  const result=await db.execute(sql`SELECT mime,content FROM resil_npc_audio WHERE id=${audioId}`);
  if(!result.rows.length)return res.code(404).send({error:'Audio not found'});
  const row=result.rows[0] as {mime:string;content:Buffer};
  return res.header('Cache-Control','private, max-age=3600').header('X-Content-Type-Options','nosniff').type(row.mime).send(row.content);
 });
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
  if(body.parentId){
   const ancestors=await db.execute(sql`WITH RECURSIVE parents AS (SELECT id,parent_id FROM resil_npc_folders WHERE id=${body.parentId} UNION SELECT f.id,f.parent_id FROM resil_npc_folders f JOIN parents p ON f.id=p.parent_id) SELECT id FROM parents WHERE id=${folderId} LIMIT 1`);
   if(ancestors.rows.length)return res.code(400).send({error:'Folder hierarchy would contain a cycle'});
  }
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
  if(Buffer.byteLength(JSON.stringify(body.definition),'utf8')>MAX_DEFINITION_BYTES)return res.code(413).send({error:'NPC definition is too large'});
  const definition=body.definition;
  if(!Array.isArray(definition.dialogue)||definition.dialogue.length===0||definition.dialogue.length>128)return res.code(400).send({error:'NPC requires 1–128 dialogue nodes'});
  const nodes=new Set<string>();
  for(const rawNode of definition.dialogue){
   if(!rawNode||typeof rawNode!=='object'||Array.isArray(rawNode))return res.code(400).send({error:'Invalid dialogue node'});
   const node=rawNode as Record<string,unknown>;
   if(typeof node.id!=='string'||!id.safeParse(node.id).success||nodes.has(node.id)||typeof node.text!=='string'||!node.text.trim()||node.text.length>4096||!Array.isArray(node.choices)||node.choices.length>4)return res.code(400).send({error:'Invalid or duplicate dialogue node'});
   nodes.add(node.id);
  }
  for(const rawNode of definition.dialogue){
   const node=rawNode as {choices:Array<{text?:unknown;next?:unknown;condition?:unknown}>};
   for(const choice of node.choices){
    if(!choice||typeof choice!=='object'||typeof choice.text!=='string'||!choice.text.trim()||choice.text.length>300||choice.condition)return res.code(400).send({error:'Invalid or unsupported conditional dialogue choice'});
    if(choice.next!=null&&(typeof choice.next!=='string'||(choice.next.length>0&&!nodes.has(choice.next))))return res.code(400).send({error:'Dialogue choice points to a missing node'});
   }
  }
  const visited=new Set<string>();
  const pending=['start'];
  if(!nodes.has('start'))return res.code(400).send({error:'Dialogue must contain a start node'});
  const byId=new Map((definition.dialogue as Array<{id:string;choices:Array<{next?:string}>}>).map(n=>[n.id,n]));
  while(pending.length){
   const current=pending.pop()!;
   if(visited.has(current))continue;
   visited.add(current);
   for(const choice of byId.get(current)?.choices||[])if(choice.next&&!visited.has(choice.next))pending.push(choice.next);
  }
  if(visited.size!==nodes.size)return res.code(400).send({error:'Every dialogue node must be reachable from start'});
  const audioRefs:string[]=[];
  for(const rawNode of definition.dialogue){
   const node=rawNode as Record<string,unknown>;
   if(node.audio==null||node.audio==='')continue;
   if(typeof node.audio!=='string'||node.audio.length>200||!node.audio.trim())return res.code(400).send({error:'Invalid audio reference'});
   if(/^clip:[A-Za-z0-9_-]+$/.test(node.audio))continue;
   const match=/^\/api\/devtools\/npcs\/audio\/(voice-[A-Za-z0-9_-]+)$/.exec(node.audio);
   if(!match)return res.code(400).send({error:'Use uploaded audio or a native clip reference; external URLs are not playable'});
   audioRefs.push(match[1]);
  }
  if(audioRefs.length){
   const available=await db.execute(sql`SELECT id FROM resil_npc_voice_frames WHERE audio_id IN (${sql.join([...new Set(audioRefs)].map(ref=>sql`${ref}`),sql`,`)})`);
   const found=new Set(available.rows.map(row=>String(row.id)));
   if(audioRefs.some(ref=>!found.has(ref)))return res.code(400).send({error:'One or more uploaded voice recordings are unavailable'});
  }
  if(definition.equipment!=null&&(!Array.isArray(definition.equipment)||definition.equipment.length>32))return res.code(400).send({error:'Too many equipment entries'});
  if(definition.equipment!=null){
   for(const raw of definition.equipment){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return res.code(400).send({error:'Invalid equipment entry'});
    const piece=raw as Record<string,unknown>;
    if(typeof piece.shortname!=='string'||piece.shortname.length>100||
       (piece.shortname!==''&&!/^[a-zA-Z0-9_.-]+$/.test(piece.shortname))||
       (piece.skinId!=null&&(!/^(0|[1-9][0-9]*)$/.test(String(piece.skinId))||BigInt(String(piece.skinId))>18446744073709551615n)))return res.code(400).send({error:'Invalid wearable or skin ID'});
   }
  }
  if(definition.hp!=null&&(typeof definition.hp!=='number'||!Number.isFinite(definition.hp)||definition.hp<1||definition.hp>100000))return res.code(400).send({error:'NPC health must be between 1 and 100000'});
  if(definition.killable!=null&&typeof definition.killable!=='boolean')return res.code(400).send({error:'Invalid NPC killable setting'});
  if(definition.repeatable!=null&&typeof definition.repeatable!=='boolean')return res.code(400).send({error:'Invalid repeatable setting'});
  if(body.folderId){const f=await db.execute(sql`SELECT id FROM resil_npc_folders WHERE id=${body.folderId}`);if(!f.rows.length)return res.code(400).send({error:'Folder does not exist'});}
  const existing=await db.execute(sql`SELECT revision FROM resil_npc_definitions WHERE id=${npcId}`);
  if(!existing.rows.length){const count=await db.execute(sql`SELECT COUNT(*)::int AS total FROM resil_npc_definitions`);if(Number(count.rows[0]?.total??0)>=MAX_NPCS)return res.code(409).send({error:'NPC limit reached'});}
  const expectedRevision=body.expectedRevision??0;
  const author=req.user.username;
  const result=await db.execute(sql`INSERT INTO resil_npc_definitions(id,name,folder_id,definition,created_by,updated_by) VALUES (${npcId},${body.name},${body.folderId||null},${JSON.stringify(body.definition)}::jsonb,${author},${author}) ON CONFLICT(id) DO UPDATE SET name=excluded.name,folder_id=excluded.folder_id,definition=excluded.definition,revision=resil_npc_definitions.revision+1,updated_by=excluded.updated_by,updated_at=now() WHERE resil_npc_definitions.revision=${expectedRevision} RETURNING revision`);
  if(!result.rows.length)return res.code(409).send({error:'NPC changed since it was loaded. Refresh before saving.'});
  return res.send({revision:result.rows[0]?.revision});
 });
 server.delete(PATH+'/:id',{preHandler:[guard]},async(req,res)=>{
  const npcId=id.parse((req.params as {id:string}).id);await setup();
  await db.execute(sql`DELETE FROM resil_npc_definitions WHERE id=${npcId}`);
  return res.send({ok:true});
 });
});
