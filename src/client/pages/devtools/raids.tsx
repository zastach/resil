import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  FileInput,
  Group,
  NumberInput,
  Progress,
  SimpleGrid,
  Image,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { starter, simulate, lootSchema, tiers, type Loot } from '@/lib/raids/loot';
import { requiredVotes, type PanelRule } from '@/lib/raids/panel';
const api = '/api/devtools/raids';
type Revision = {
  progress: { eligible: number; required: number; counts: Record<string, number> };
  id: string;
  family: string;
  revision: number;
  name: string;
  tier: string;
  loot: Loot | null;
  author: string;
  status: string;
  revision_notice_seen: boolean;
  votes: Record<string, string>;
  notes: { by: string; action: string; note: string; difficulty?: string; at: string }[];
};
type State = {
  policy: { rule: PanelRule; version: number; discordRole: string };
  panelMembers?: { id: string; username: string }[];
  panelUnavailable: boolean;
  panelSize: number;
  admin: boolean;
  reviewer: boolean;
  viewer: string;
  revisions: Revision[];
  tables: { version: number; data: Loot }[];
};
async function request(path = '', body?: unknown) {
  const res = await fetch(
    api + path,
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const result = await res.json();
  if (!res.ok) throw Error(result.error || result.message || 'Request failed');
  return result;
}
export function Component() {
  const [state, set] = useState<State>(),
    [message, msg] = useState(''),
    [busy, lock] = useState(false);
  const [tab, selectTab] = useState<string | null>('queue');
  const [params, setParams] = useSearchParams();
  const id = params.get('revision') ?? '';
  const select = (revision: string) => setParams(revision ? { revision } : {});
  const [note, comment] = useState('');
  const [reviewDetails, setReviewDetails] = useState<{
    id: string;
    counts: Record<string, number>;
    photo: string | null;
  }>();
  const [reviewDetailsError, setReviewDetailsError] = useState('');
  useEffect(() => {
    if (!id) return;
    let active = true;
    request('/' + id + '/storage')
      .then((data) => {
        if (active) {
          setReviewDetails({ ...data, id });
          setReviewDetailsError('');
        }
      })
      .catch((error) => {
        if (active) setReviewDetailsError(error.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  const [name, setName] = useState(''),
    [tier, setTier] = useState<string>('Easy'),
    [file, upload] = useState<File | null>(null),
    [parent, revise] = useState(''),
    [lootName, assign] = useState('');
  const [table, edit] = useState<Loot>(structuredClone(starter)),
    [version, setVersion] = useState(0),
    [results, preview] = useState('');
  const [importCode, setImportCode] = useState('');
  const [selectedImport, setSelectedImport] = useState<{ code: string; hasPhoto: boolean } | null>(null);
  const [credential, showCredential] = useState('');
  const [draftPolicy, setPolicy] = useState<State['policy'] | null>(null);
  const policy = draftPolicy ?? state?.policy;
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const current = state?.revisions.find((r) => r.id === id);
  async function refresh() {
    set(await request());
  }
  useEffect(() => {
    let active = true;
    request()
      .then((data) => {
        if (active) set(data);
      })
      .catch((e) => {
        if (active) msg(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(fn: () => Promise<string>) {
    lock(true);
    try {
      const message = await fn();
      await refresh();
      msg(message);
    } catch (e) {
      msg(String(e));
    } finally {
      lock(false);
    }
  }
  function change(t: Loot) {
    edit(t);
    preview('');
  }
  return (
    <Stack p='lg' maw={1080} mx='auto'>
      <Group justify='space-between'>
        <Title order={2}>Raid Center</Title>
        <Button variant='subtle' disabled={busy} onClick={() => run(async () => 'Queue refreshed.')}>
          Refresh
        </Button>
      </Group>
      {state?.panelUnavailable && (
        <Alert>Raid Center could not check Discord roles. Refresh to try again.</Alert>
      )}
      {message && (
        <Alert withCloseButton onClose={() => msg('')}>
          {message}
        </Alert>
      )}
      {state?.revisions
        .filter((r) => r.author === state.viewer && r.status === 'Revise' && !r.revision_notice_seen)
        .map((r) => (
          <Alert key={r.id} title='Revision requested' color='yellow'>
            <Text size='sm'>
              The panel requested changes to {r.name}, revision {r.revision}.
            </Text>
            <Group mt='xs'>
              <Button
                variant='light'
                onClick={() => {
                  select(r.id);
                  selectTab('queue');
                }}
              >
                Open review
              </Button>
              <Button
                variant='subtle'
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await request('/' + r.id + '/notice/read', {});
                    return 'Notification marked as read.';
                  })
                }
              >
                Mark as read
              </Button>
            </Group>
          </Alert>
        ))}
      <Tabs value={tab} onChange={selectTab}>
        <Tabs.List>
          <Tabs.Tab value='queue'>
            {state?.reviewer || state?.admin ? 'Review queue' : 'My submissions'}
          </Tabs.Tab>
          <Tabs.Tab value='submit'>Submit a base</Tabs.Tab>
          {(state?.admin || state?.reviewer) && <Tabs.Tab value='loot'>Loot tables</Tabs.Tab>}
          {state?.admin && <Tabs.Tab value='panel'>Panel settings</Tabs.Tab>}
          {state?.admin && <Tabs.Tab value='server'>Server setup</Tabs.Tab>}
        </Tabs.List>
        {state?.admin && policy && (
          <Tabs.Panel value='panel' pt='md'>
            <Stack maw={600}>
              <Title order={3}>Panel voting requirements</Title>
              <TextInput
                label='Discord panel role ID'
                value={policy.discordRole}
                onChange={(e) => setPolicy({ ...policy, discordRole: e.currentTarget.value })}
              />
              <Text size='sm'>
                Only linked accounts with this role in the Rust Empires Discord server count toward the panel.
              </Text>
              {state.panelUnavailable ? (
                <Alert>Discord panel membership is temporarily unavailable.</Alert>
              ) : (
                <Text size='sm'>
                  Panel members ·{' '}
                  {state.panelMembers?.map((member) => member.username).join(', ') || 'None found'}
                </Text>
              )}
              <Select
                label='Decision rule'
                value={policy.rule.mode}
                data={[
                  { value: 'fixed', label: 'Fixed vote count' },
                  { value: 'majority', label: 'Simple majority (over half)' },
                  { value: 'supermajority', label: 'Supermajority (percentage)' },
                ]}
                onChange={(mode) =>
                  mode && setPolicy({ ...policy, rule: { ...policy.rule, mode: mode as PanelRule['mode'] } })
                }
              />
              <NumberInput
                label='Minimum matching votes'
                min={1}
                max={1000}
                allowDecimal={false}
                value={policy.rule.minimum}
                onChange={(v) => setPolicy({ ...policy, rule: { ...policy.rule, minimum: Number(v) } })}
              />
              {policy.rule.mode === 'supermajority' && (
                <NumberInput
                  label='Required share of eligible panelists (%)'
                  min={51}
                  max={100}
                  allowDecimal={false}
                  value={policy.rule.percent}
                  onChange={(v) => setPolicy({ ...policy, rule: { ...policy.rule, percent: Number(v) } })}
                />
              )}
              <Text>
                {state.panelSize} current panelists. For a submission from outside the panel, this rule
                requires {requiredVotes(policy.rule, state.panelSize)} matching votes. A panelist who submits
                a base is excluded from that revision’s vote count and eligible panel size.
              </Text>
              <Text size='sm'>
                Approve, request revision, and reject each require the threshold. Changes apply to pending
                reviews when a vote is cast. Completed decisions stand.
              </Text>
              {requiredVotes(policy.rule, state.panelSize) > state.panelSize && (
                <Alert>The required vote count exceeds the current panel size.</Alert>
              )}
              <Group>
                <Button
                  disabled={busy || !draftPolicy}
                  onClick={() =>
                    run(async () => {
                      await request('/policy', policy);
                      setPolicy(null);
                      return 'Panel requirements saved.';
                    })
                  }
                >
                  Save requirements
                </Button>
                <Button variant='subtle' disabled={busy || !draftPolicy} onClick={() => setPolicy(null)}>
                  Discard edits
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>
        )}
        {state?.admin && (
          <Tabs.Panel value='server' pt='md'>
            <Stack>
              <Title order={3}>Rust server connection</Title>
              <Text>
                Set CatalogEndpoint in oxide/config/RERaid.json to the address below. Use a read key on
                servers that pull published raids. Add a publish key on the creative server for imports and
                playtests.
              </Text>
              <Code block>https://resil.me/api/devtools/raids/catalog</Code>
              {(['READ', 'PUBLISH'] as const).map((scope) => (
                <Button
                  key={scope}
                  variant='light'
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Generate a new ' +
                          scope.toLowerCase() +
                          ' key? This replaces the previous site-generated key for this scope.',
                      )
                    )
                      run(async () => {
                        const key = await request('/key', { scope });
                        showCredential(
                          (scope === 'READ' ? 'CatalogReadToken' : 'CatalogPublishToken') + ' = ' + key.value,
                        );
                        return 'Copy the key into the server config now.';
                      });
                  }}
                >
                  Generate or replace {scope.toLowerCase()} key
                </Button>
              ))}
              {credential && (
                <>
                  <Code block>{credential}</Code>
                  <Button variant='subtle' onClick={() => showCredential('')}>
                    Hide key
                  </Button>
                </>
              )}
              <Text>
                Reload RERaid after saving the config. Use /reraid admin pull on the raid server after
                publishing a revision.
              </Text>
            </Stack>
          </Tabs.Panel>
        )}

        <Tabs.Panel value='queue' pt='md'>
          <Stack>
            {id && (
              <Button
                variant='subtle'
                onClick={() => {
                  select('');
                  setReviewDetailsError('');
                }}
              >
                Back to review queue
              </Button>
            )}
            {state && id && !current && <Alert>This revision is unavailable.</Alert>}
            {state && !state.revisions.length && <Text>No submissions yet.</Text>}
            {state?.revisions
              .filter((r) => !id || r.id === id)
              .map((r) => (
                <Card withBorder key={r.id}>
                  <Group justify='space-between'>
                    <div>
                      <Text fw={650}>
                        {r.name} · revision {r.revision}
                      </Text>
                      <Text size='sm'>
                        {r.tier} · {r.loot?.Name || 'Server tier loot'}
                      </Text>
                    </div>
                    <Group>
                      <Badge>{r.status}</Badge>
                      {!id && (
                        <Button
                          variant='light'
                          onClick={() => {
                            select(r.id);
                            setDifficulty(null);
                            comment('');
                          }}
                        >
                          Open review
                        </Button>
                      )}
                    </Group>
                  </Group>
                  {current?.id === r.id && (
                    <Stack mt='md'>
                      {reviewDetailsError && <Alert>{reviewDetailsError}</Alert>}
                      {reviewDetails?.id === r.id && (
                        <>
                          {reviewDetails.photo && (
                            <Image
                              src={reviewDetails.photo}
                              alt={'Rust camera photo of ' + r.name}
                              mah={420}
                              fit='contain'
                              radius='md'
                            />
                          )}
                          <Title order={4}>Storage containers</Title>
                          <SimpleGrid cols={{ base: 2, sm: 5 }}>
                            {Object.entries({
                              furnaces: 'Furnaces',
                              largeBoxes: 'Large boxes',
                              smallBoxes: 'Small boxes',
                              lockers: 'Lockers',
                              toolCupboards: 'Tool cupboards',
                            }).map(([key, label]) => (
                              <Card key={key} withBorder>
                                <Text fw={700}>{reviewDetails.counts[key]}</Text>
                                <Text size='sm'>{label}</Text>
                              </Card>
                            ))}
                          </SimpleGrid>
                        </>
                      )}
                      <Title order={4}>Approval progress</Title>
                      <Progress
                        value={
                          r.status === 'Approved' || r.status === 'Published'
                            ? 100
                            : (r.progress.counts.Approve / Math.max(1, r.progress.required)) * 100
                        }
                        aria-label='Approval progress'
                        size='lg'
                      />
                      {r.loot && (
                        <Text size='sm'>
                          {r.loot.Rolls} weighted rolls ·{' '}
                          {r.loot.Entries.map(
                            (e) => e.Item + ' × ' + e.Min + '–' + e.Max + ' (weight ' + e.Weight + ')',
                          ).join(', ')}{' '}
                          · Guaranteed:{' '}
                          {r.loot.Guaranteed.map((e) => e.Item + ' × ' + e.Min + '–' + e.Max).join(', ') ||
                            'none'}
                        </Text>
                      )}
                      {state.reviewer && (
                        <>
                          <Text size='sm'>Run this on the review server to playtest this revision.</Text>
                          <Code block>/reraid admin webtest {r.id}</Code>
                        </>
                      )}
                      <Title order={4}>Comments and recommendations</Title>
                      {!r.notes.length && (
                        <Text size='sm' c='dimmed'>
                          No comments yet.
                        </Text>
                      )}
                      {r.notes.map((n, i) => (
                        <Text key={i} size='sm'>
                          {n.by} · {n.difficulty ? 'Recommended ' + n.difficulty : n.action} ·{' '}
                          {new Date(n.at).toLocaleString()} {n.note}
                        </Text>
                      ))}
                      {r.status === 'Pending' && (
                        <Text size='sm'>
                          {r.progress.counts.Approve} approve · {r.progress.counts.Revise} request revision ·{' '}
                          {r.progress.counts.Reject} reject. Requires {r.progress.required} matching votes
                          from {r.progress.eligible} eligible panelists.
                        </Text>
                      )}
                      {(state.reviewer || state.admin) && (
                        <>
                          <TextInput
                            label='Review note'
                            value={note}
                            onChange={(e) => comment(e.currentTarget.value)}
                          />
                          {state.reviewer && r.status === 'Pending' && (
                            <Group align='end'>
                              <Select
                                label='Recommended difficulty'
                                placeholder='Choose a tier'
                                data={[...tiers]}
                                value={difficulty}
                                onChange={setDifficulty}
                              />
                              <Button
                                variant='light'
                                disabled={busy || !difficulty}
                                onClick={() =>
                                  run(async () => {
                                    await request('/' + r.id + '/review', {
                                      action: 'Recommend difficulty',
                                      difficulty,
                                      note,
                                    });
                                    setDifficulty(null);
                                    comment('');
                                    return 'Difficulty recommendation recorded.';
                                  })
                                }
                              >
                                Save recommendation
                              </Button>
                            </Group>
                          )}
                          <Group>
                            {[
                              ...(state.reviewer ? ['Comment'] : []),
                              ...(state.reviewer && r.status === 'Pending' && r.author !== state.viewer
                                ? ['Approve', 'Revise', 'Reject']
                                : []),
                              ...(state.admin && r.status === 'Approved' ? ['Publish'] : []),
                            ].map((action) => (
                              <Button
                                key={action}
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    await request('/' + r.id + '/review', { action, note });
                                    comment('');
                                    return action + ' recorded.';
                                  })
                                }
                              >
                                {action === 'Revise' ? 'Request revision' : action}
                              </Button>
                            ))}
                          </Group>
                        </>
                      )}
                      {r.author === state.viewer &&
                        ['Published', 'Revise', 'Reject'].includes(r.status) &&
                        !state.revisions.some((x) => x.family === r.family && x.revision > r.revision) && (
                          <Button
                            onClick={() => {
                              revise(r.id);
                              setName(r.name);
                              setTier(r.tier);
                              assign(r.loot?.Name || '');
                              selectTab('submit');
                            }}
                          >
                            Submit next revision
                          </Button>
                        )}
                    </Stack>
                  )}
                </Card>
              ))}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value='submit' pt='md'>
          <Stack>
            <Title order={3}>{parent ? 'New revision' : 'New raid base'}</Title>
            {parent && (
              <Button variant='subtle' onClick={() => revise('')}>
                Start a separate base instead
              </Button>
            )}
            <TextInput label='Base name' value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <Select
              label='Difficulty'
              data={[...tiers]}
              value={tier}
              onChange={(v) => setTier(v || 'Easy')}
            />
            <TextInput
              label='Creative server import code'
              description='Aim at the base and run /reraid submit <tier> <name>. Take a photo when prompted, then enter the code here.'
              value={importCode}
              onChange={(e) => setImportCode(e.currentTarget.value.trim())}
            />
            <Button
              variant='light'
              disabled={busy || !importCode}
              onClick={() =>
                run(async () => {
                  const imported = await request('/import', { code: importCode });
                  upload(null);
                  setSelectedImport({ code: importCode, hasPhoto: imported.hasPhoto });
                  setName(imported.name);
                  setTier(imported.tier);
                  setImportCode('');
                  return 'Snapshot imported. Select loot and submit for review.';
                })
              }
            >
              Import from creative server
            </Button>
            {selectedImport && (
              <Alert onClose={() => setSelectedImport(null)} withCloseButton>
                {selectedImport.hasPhoto
                  ? 'Snapshot and Rust camera photo imported.'
                  : state?.admin
                    ? 'Snapshot imported without a photo.'
                    : 'This code has no camera photo. Submit from Rust again and take a photo when prompted.'}
              </Alert>
            )}
            {state?.admin && (
              <FileInput
                accept='.json'
                label='CopyPaste snapshot'
                description='Upload the saved base JSON from oxide/data/copypaste.'
                value={file}
                onChange={(file) => {
                  upload(file);
                  if (file) setSelectedImport(null);
                }}
              />
            )}
            <Select
              label='Loot table'
              placeholder='Server tier loot'
              clearable
              value={lootName || null}
              data={state?.tables.map((t) => t.data.Name) || []}
              onChange={(v) => assign(v || '')}
            />
            <Button
              disabled={
                busy ||
                (!file && !selectedImport) ||
                (!state?.admin && !selectedImport?.hasPhoto) ||
                !name.trim()
              }
              onClick={() =>
                run(async () => {
                  if (file && file.size > 15 * 1024 * 1024) throw Error('Snapshot must be under 15 MiB');
                  const saved = await request('', {
                    name,
                    tier,
                    parent: parent || undefined,
                    data: file ? JSON.parse(await file.text()) : undefined,
                    importCode: selectedImport?.code,
                    loot: state?.tables.find((t) => t.data.Name === lootName)?.data ?? null,
                  });
                  select(saved.id);
                  revise('');
                  setSelectedImport(null);
                  upload(null);
                  selectTab('queue');
                  return 'Snapshot submitted for review.';
                })
              }
            >
              Submit for review
            </Button>
          </Stack>
        </Tabs.Panel>
        {(state?.admin || state?.reviewer) && (
          <Tabs.Panel value='loot' pt='md'>
            <Stack>
              <Select
                label='Edit saved table'
                placeholder='Choose a table'
                data={state.tables.map((t) => t.data.Name)}
                onChange={(v) => {
                  const t = state.tables.find((t) => t.data.Name === v);
                  if (t) {
                    change(structuredClone(t.data));
                    setVersion(t.version);
                  }
                }}
              />
              <TextInput
                label='Table name'
                value={table.Name}
                onChange={(e) => {
                  setVersion(0);
                  change({ ...table, Name: e.currentTarget.value });
                }}
              />
              <NumberInput
                label='Weighted rolls per raid'
                min={0}
                max={200}
                value={table.Rolls}
                onChange={(v) => change({ ...table, Rolls: Number(v) })}
              />
              {(['Entries', 'Guaranteed'] as const).map((group) => (
                <Card key={group} withBorder>
                  <Stack>
                    <Title order={4}>{group === 'Entries' ? 'Weighted drops' : 'Guaranteed drops'}</Title>
                    {table[group].map((entry, i) => (
                      <Group align='end' key={i}>
                        {(
                          ['Item', 'Min', 'Max', ...(group === 'Entries' ? ['Weight' as const] : [])] as const
                        ).map((field) => {
                          const update = (v: string | number) =>
                            change({
                              ...table,
                              [group]: table[group].map((e, j) => (i === j ? { ...e, [field]: v } : e)),
                            });
                          return field === 'Item' ? (
                            <TextInput
                              key={field}
                              label='Item shortname'
                              value={entry.Item}
                              onChange={(e) => update(e.currentTarget.value)}
                            />
                          ) : (
                            <NumberInput
                              key={field}
                              w={90}
                              label={field}
                              min={1}
                              value={entry[field]}
                              onChange={(v) => update(Number(v))}
                            />
                          );
                        })}
                        <Button
                          variant='subtle'
                          onClick={() =>
                            change({ ...table, [group]: table[group].filter((_, j) => i !== j) })
                          }
                        >
                          Remove
                        </Button>
                      </Group>
                    ))}
                    <Button
                      variant='light'
                      onClick={() =>
                        change({
                          ...table,
                          [group]: [...table[group], { Item: '', Min: 1, Max: 1, Weight: 1 }],
                        })
                      }
                    >
                      Add item
                    </Button>
                  </Stack>
                </Card>
              ))}
              <Group>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const checked = lootSchema.parse(table);
                      await request('/loot', { table: checked, version });
                      setVersion(version + 1);
                      return 'Table saved. Submitted revisions retain their original loot.';
                    })
                  }
                >
                  Save table
                </Button>
                <Button
                  variant='light'
                  onClick={() => {
                    try {
                      preview(
                        simulate(lootSchema.parse(table))
                          .map((e) => e.item + ' × ' + e.count)
                          .join(', '),
                      );
                    } catch {
                      msg('Check item names, quantities, weights and rolls.');
                    }
                  }}
                >
                  Simulate 100 raids
                </Button>
              </Group>
              {results && <Text>Total items across 100 raids · {results}</Text>}
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
