import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, FileInput, Group, NumberInput, Select, SimpleGrid, Stack, Switch, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconDownload, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';

type Equipment = { slot: string; shortname: string; skinId: string };
type Choice = { text: string; next: string; condition: string };
type Node = { id: string; text: string; audio: string; choices: Choice[] };
type Npc = { id: string; name: string; description: string; equipment: Equipment[]; backpack: string; killable: boolean; hp: number; repeatable: boolean; dialogue: Node[]; revision: number };
const slots = ['Head', 'Chest', 'Legs', 'Feet', 'Hands', 'Accessory'];
const items = ['hoodie','shirt.collared','tshirt','jacket','jacket.snow','roadsign.jacket','metal.facemask','hat.cap','hat.beenie','hat.boonie','mask.bandana','pants','pants.shorts','roadsign.kilt','shoes.boots','shoes.boots.frog','gloves.leather','burlap.gloves','backpack.small','backpack.large'];
const emptyEquipment = () => slots.map(slot => ({ slot, shortname: '', skinId: '0' }));
const starter = (): Npc => ({ id:'department-null-witness', name:'Department Null Witness', description:'', equipment:emptyEquipment(), backpack:'', killable:false, hp:100, repeatable:true, revision:1, dialogue:[{id:'start',text:'Can I help you?',audio:'',choices:[{text:'What happened here?',next:'answer',condition:''}]},{id:'answer',text:'I am not sure what I saw.',audio:'',choices:[]}] });
const blankNode = (id:string):Node => ({id,text:'',audio:'',choices:[]});
const storageKey='resil-npcstudio-v1';
function download(name:string, body:string, mime:string) { const url=URL.createObjectURL(new Blob([body],{type:mime})); const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function validate(n:Npc) { const ids=n.dialogue.map(x=>x.id);if(!/^[a-z0-9][a-z0-9-]*$/.test(n.id))return 'NPC ID must use lowercase letters, numbers and hyphens.';if(!n.name.trim())return 'NPC name required.';if(!ids.includes('start')||new Set(ids).size!==ids.length)return 'Dialogue must contain a start node and unique node IDs.';if(n.dialogue.some(x=>x.choices.some(c=>c.next&&!ids.includes(c.next))))return 'A dialogue response links to a missing node.';return ''; }
export function Component() {
 const [library,setLibrary]=useState<Npc[]>([]);
 const [selected,setSelected]=useState('');
 const [draft,setDraft]=useState<Npc>(starter);
 const [notice,setNotice]=useState('');
 const [loaded,setLoaded]=useState(false);
 const [tab,setTab]=useState<string|null>('appearance');
 useEffect(()=>{try{const raw=localStorage.getItem(storageKey);if(raw){const data=JSON.parse(raw) as Npc[];if(Array.isArray(data)){setLibrary(data);if(data[0]){setSelected(data[0].id);setDraft(data[0]);}}}}catch{}setLoaded(true);},[]);
 useEffect(()=>{if(loaded)localStorage.setItem(storageKey,JSON.stringify(library));},[library,loaded]);
 const patch=(p:Partial<Npc>)=>setDraft(prev=>({...prev,...p}));
 const save=()=>{const error=validate(draft);if(error){setNotice(error);return;}const exists=library.find(x=>x.id===draft.id);const next={...draft,revision:exists?exists.revision+1:1};setLibrary(prev=>[...prev.filter(x=>x.id!==next.id),next]);setSelected(next.id);setDraft(next);setNotice('Saved to this browser. Export a definition to transfer it; server-side publishing is not connected.');};
 const updateNode=(i:number,p:Partial<Node>)=>patch({dialogue:draft.dialogue.map((n,j)=>i===j?{...n,...p}:n)});
 const exportJson=()=>{const error=validate(draft);if(error){setNotice(error);return;}download(draft.id+'.json',JSON.stringify({...draft,version:1},null,2),'application/json');};
 const importJson=async(file:File|null)=>{if(!file)return;try{const data=JSON.parse(await file.text()) as Npc;if(!data.id||!Array.isArray(data.dialogue))throw Error('Invalid NPC definition');setDraft({...starter(),...data,equipment:Array.isArray(data.equipment)?data.equipment:emptyEquipment()});setSelected('');setNotice('Imported definition. Save to add it to your library.');}catch(e){setNotice(String(e));}};
 return <Stack p='lg' maw={1280} mx='auto'>
  <Group justify='space-between'><div><Title order={2}>NPC Studio</Title><Text c='dimmed'>Rust Empires · NPC definition workshop</Text></div><Badge color='blue'>V1 workshop</Badge></Group>
  <Alert color='yellow'>Definitions are currently saved in this browser only. Export JSON for safekeeping. Audio file hosting, server-side persistence, publishing, and in-game updates are not yet wired up.</Alert>
  <Group align='end'><Select label='NPC Library' placeholder='Select NPC' searchable data={library.map(x=>({value:x.id,label:x.name+' · r'+x.revision}))} value={selected||null} onChange={id=>{const npc=library.find(x=>x.id===id);if(npc){setDraft(npc);setSelected(npc.id);}}} style={{flex:1}}/>
   <Button variant='default' onClick={()=>{setDraft(starter());setSelected('');}}>New</Button>
   <Button variant='default' onClick={()=>{patch({id:draft.id+'-copy',name:draft.name+' (Copy)',revision:1});setSelected('');}}>Duplicate</Button>
   <Button onClick={save}>Save</Button>
   <Button variant='light' leftSection={<IconDownload size={16}/>} onClick={exportJson}>Export</Button>
   <FileInput placeholder='Import JSON' accept='.json,application/json' leftSection={<IconUpload size={16}/>} onChange={importJson} w={165}/>
  </Group>
  <Card withBorder><SimpleGrid cols={{base:1,sm:2}}><TextInput label='Definition ID' value={draft.id} onChange={e=>patch({id:e.currentTarget.value})}/><TextInput label='Display name' value={draft.name} onChange={e=>patch({name:e.currentTarget.value})}/></SimpleGrid><Textarea mt='sm' label='Internal description' value={draft.description} onChange={e=>patch({description:e.currentTarget.value})}/></Card>
  <Tabs value={tab} onChange={setTab}>
   <Tabs.List><Tabs.Tab value='appearance'>Appearance & Equipment</Tabs.Tab><Tabs.Tab value='dialogue'>Dialogue Graph</Tabs.Tab><Tabs.Tab value='audio'>Audio</Tabs.Tab><Tabs.Tab value='behavior'>Behavior</Tabs.Tab></Tabs.List>
   <Tabs.Panel value='appearance' pt='md'><Stack><Text fw={600}>Six wearable slots + backpack</Text><Text size='sm' c='dimmed'>Search the common Rust item shortnames, or type any shortname to use NPC-only/unobtainable equipment. Skin IDs are optional.</Text>
    <SimpleGrid cols={{base:1,sm:2,lg:3}}>{slots.map((slot,i)=>{const eq=draft.equipment.find(x=>x.slot===slot)||{slot,shortname:'',skinId:'0'};const set=(p:Partial<Equipment>)=>patch({equipment:slots.map(s=>s===slot?{...eq,...p}:draft.equipment.find(x=>x.slot===s)||{slot:s,shortname:'',skinId:'0'})});return <Card withBorder key={slot}><Stack gap='xs'><Group justify='space-between'><Text fw={600}>{slot}</Text><Badge variant='light'>{i+1}/6</Badge></Group><Select searchable clearable label='Item' placeholder='Search or enter below' data={items} value={items.includes(eq.shortname)?eq.shortname:null} onChange={v=>set({shortname:v||''})}/><TextInput label='Custom item shortname' value={eq.shortname} onChange={e=>set({shortname:e.currentTarget.value})}/><TextInput label='Skin ID' value={eq.skinId} onChange={e=>set({skinId:e.currentTarget.value})}/></Stack></Card>})}</SimpleGrid>
    <Card withBorder><Text fw={600}>Backpack slot</Text><Select mt='sm' searchable clearable data={['backpack.small','backpack.large']} label='Backpack' value={draft.backpack||null} onChange={v=>patch({backpack:v||''})}/></Card>
   </Stack></Tabs.Panel>
   <Tabs.Panel value='dialogue' pt='md'><Stack><Group justify='space-between'><Text fw={600}>Branching conversation</Text><Button leftSection={<IconPlus size={14}/>} onClick={()=>patch({dialogue:[...draft.dialogue,blankNode('node-'+(draft.dialogue.length+1))]})}>Add node</Button></Group>
    <Text size='sm' c='dimmed'>Start node is the entry point. Responses connect to other nodes; a blank destination ends the conversation. Conditions are reserved for future runtime evaluation.</Text>
    <SimpleGrid cols={{base:1,md:2}}>{draft.dialogue.map((node,i)=><Card withBorder key={i}><Stack gap='xs'><Group justify='space-between'><Badge>{node.id==='start'?'Entry node':'Dialogue node'}</Badge><Button color='red' size='xs' variant='subtle' disabled={node.id==='start'} onClick={()=>patch({dialogue:draft.dialogue.filter((_,j)=>j!==i)})}><IconTrash size={15}/></Button></Group><TextInput label='Node ID' value={node.id} disabled={node.id==='start'} onChange={e=>updateNode(i,{id:e.currentTarget.value})}/><Textarea autosize minRows={2} label='NPC speech' value={node.text} onChange={e=>updateNode(i,{text:e.currentTarget.value})}/><TextInput label='Audio URL / asset reference' value={node.audio} onChange={e=>updateNode(i,{audio:e.currentTarget.value})}/>{node.choices.map((choice,j)=><Card key={j} withBorder padding='xs'><Stack gap='xs'><TextInput label='Player response' value={choice.text} onChange={e=>updateNode(i,{choices:node.choices.map((c,k)=>k===j?{...c,text:e.currentTarget.value}:c)})}/><Group align='end'><Select label='Next node' clearable placeholder='End conversation' data={draft.dialogue.map(x=>x.id)} value={choice.next||null} onChange={v=>updateNode(i,{choices:node.choices.map((c,k)=>k===j?{...c,next:v||''}:c)})} style={{flex:1}}/><Button variant='subtle' color='red' onClick={()=>updateNode(i,{choices:node.choices.filter((_,k)=>k!==j)})}><IconTrash size={15}/></Button></Group><TextInput label='Condition (reserved)' value={choice.condition||''} onChange={e=>updateNode(i,{choices:node.choices.map((c,k)=>k===j?{...c,condition:e.currentTarget.value}:c)})}/></Stack></Card>)}<Button size='xs' variant='light' onClick={()=>updateNode(i,{choices:[...node.choices,{text:'',next:'',condition:''}]})}>Add player response</Button></Stack></Card>)}</SimpleGrid>
   </Stack></Tabs.Panel>
   <Tabs.Panel value='audio' pt='md'><Stack><Text fw={600}>Dialogue audio references</Text><Text c='dimmed' size='sm'>Each dialogue node can reference a voice asset. Local playback previews are supported for URL references; transcoding and upload are not yet implemented.</Text>{draft.dialogue.map(n=><Card withBorder key={n.id}><Text fw={600}>{n.id}</Text><Text size='sm'>{n.text}</Text>{n.audio&&<audio controls src={n.audio} style={{width:'100%',marginTop:8}}/>}</Card>)}</Stack></Tabs.Panel>
   <Tabs.Panel value='behavior' pt='md'><Card withBorder><Stack><Switch label='NPC can be killed' checked={draft.killable} onChange={e=>patch({killable:e.currentTarget.checked})}/><NumberInput label='Hit points' min={1} max={100000} disabled={!draft.killable} value={draft.hp} onChange={v=>patch({hp:Number(v)||100})}/><Switch label='Conversation can be repeated' checked={draft.repeatable} onChange={e=>patch({repeatable:e.currentTarget.checked})}/><Alert color='blue'>Stationary civilian · Press E to talk · No proximity-triggered dialogue · No combat or patrol AI. Placed instances must be updated explicitly.</Alert></Stack></Card></Tabs.Panel>
  </Tabs>
  {notice&&<Alert color={notice.startsWith('Saved')?'green':'blue'} withCloseButton onClose={()=>setNotice('')}>{notice}</Alert>}
 </Stack>;
}
