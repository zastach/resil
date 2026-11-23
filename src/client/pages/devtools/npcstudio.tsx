import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, JsonInput, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconDownload, IconPlus, IconTrash } from '@tabler/icons-react';

type Choice = { text: string; next: string };
type Node = { id: string; text: string; choices: Choice[] };
type NpcDraft = { id: string; name: string; description: string; clothing: string[]; dialogue: Node[] };

const initial: NpcDraft = {
  id: 'department-null-witness',
  name: 'Department Null Witness',
  description: '',
  clothing: ['shirt.collared', 'pants', 'shoes.boots'],
  dialogue: [{ id: 'start', text: 'Can I help you?', choices: [{ text: 'What happened here?', next: 'answer' }] },
    { id: 'answer', text: 'I am not sure what I saw.', choices: [] }],
};

export function Component() {
  const [draft, setDraft] = useState<NpcDraft>(initial);
  const [notice, setNotice] = useState('');
  const patch = (value: Partial<NpcDraft>) => setDraft((prev) => ({ ...prev, ...value }));
  const updateNode = (index: number, value: Partial<Node>) =>
    patch({ dialogue: draft.dialogue.map((node, i) => i === index ? { ...node, ...value } : node) });
  const validate = () => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.id)) return 'NPC ID must contain lowercase letters, numbers and hyphens.';
    if (!draft.name.trim()) return 'An NPC name is required.';
    const ids = draft.dialogue.map((node) => node.id);
    if (!ids.includes('start') || new Set(ids).size !== ids.length || ids.some((id) => !id.trim())) return 'Dialogue requires a start node and unique nonempty node IDs.';
    if (draft.dialogue.some((node) => node.choices.some((choice) => choice.next && !ids.includes(choice.next)))) return 'A dialogue choice points to a nonexistent node.';
    return '';
  };
  const exportDraft = () => {
    const error = validate();
    if (error) { setNotice(error); return; }
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = draft.id + '.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('Draft exported. This is not yet a live NPC definition or server update.');
  };
  return (
    <Stack p='lg' maw={1100} mx='auto'>
      <Group justify='space-between'>
        <div><Title order={2}>NPC Studio</Title><Text c='dimmed'>Rust Empires · Civilian NPC definition editor</Text></div>
        <Badge color='yellow'>Draft editor</Badge>
      </Group>
      <Alert color='blue'>This foundation editor exports a draft JSON file. Saving to resil.me, Rust plugin synchronization and publishing are not connected yet. Existing NPCs are unaffected.</Alert>
      <Card withBorder><Stack>
        <Title order={4}>Identity</Title>
        <TextInput label='NPC ID' value={draft.id} onChange={(e) => patch({ id: e.currentTarget.value })} />
        <TextInput label='Display name' value={draft.name} onChange={(e) => patch({ name: e.currentTarget.value })} />
        <Textarea label='Description (editor only)' value={draft.description} onChange={(e) => patch({ description: e.currentTarget.value })} />
        <JsonInput label='Clothing item shortnames (JSON array)' formatOnBlur autosize minRows={3} value={JSON.stringify(draft.clothing, null, 2)}
          onChange={(value) => { try { const parsed = JSON.parse(value); if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) patch({ clothing: parsed }); } catch { /* wait for valid JSON */ } }} />
      </Stack></Card>
      <Title order={3}>Dialogue</Title>
      {draft.dialogue.map((node, index) => (
        <Card withBorder key={index}><Stack>
          <Group justify='space-between'><Text fw={700}>Node {index + 1}</Text><Button size='xs' color='red' variant='subtle' disabled={node.id === 'start'} leftSection={<IconTrash size={14}/>}
            onClick={() => patch({ dialogue: draft.dialogue.filter((_, i) => i !== index) })}>Remove</Button></Group>
          <TextInput label='Node ID' value={node.id} onChange={(e) => updateNode(index, { id: e.currentTarget.value })} disabled={node.id === 'start'} />
          <Textarea label='NPC speech' autosize minRows={2} value={node.text} onChange={(e) => updateNode(index, { text: e.currentTarget.value })} />
          {node.choices.map((choice, choiceIndex) => (
            <Group key={choiceIndex} align='end' grow>
              <TextInput label='Player response' value={choice.text} onChange={(e) => updateNode(index, { choices: node.choices.map((c, i) => i === choiceIndex ? { ...c, text: e.currentTarget.value } : c) })} />
              <TextInput label='Next node ID' placeholder='Leave blank to end' value={choice.next} onChange={(e) => updateNode(index, { choices: node.choices.map((c, i) => i === choiceIndex ? { ...c, next: e.currentTarget.value } : c) })} />
              <Button color='red' variant='light' style={{ flexGrow: 0 }} onClick={() => updateNode(index, { choices: node.choices.filter((_, i) => i !== choiceIndex) })}><IconTrash size={16}/></Button>
            </Group>
          ))}
          <Button variant='light' size='xs' leftSection={<IconPlus size={14}/>} onClick={() => updateNode(index, { choices: [...node.choices, { text: '', next: '' }] })}>Add response</Button>
        </Stack></Card>
      ))}
      <Group><Button variant='default' leftSection={<IconPlus size={16}/>} onClick={() => patch({ dialogue: [...draft.dialogue, { id: 'node-' + (draft.dialogue.length + 1), text: '', choices: [] }] })}>Add dialogue node</Button>
      <Button leftSection={<IconDownload size={16}/>} onClick={exportDraft}>Export draft JSON</Button></Group>
      {notice && <Alert color={notice.startsWith('Draft exported') ? 'green' : 'red'}>{notice}</Alert>}
    </Stack>
  );
}
