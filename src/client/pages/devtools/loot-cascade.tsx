import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconInfoCircle, IconPackage, IconTrash } from '@tabler/icons-react';
import { LootItemPicker } from './loot-item-picker';
import { cascadeOdds, type Loot, type LootEntry } from '@/lib/raids/loot';

const palette = ['orange', 'grape', 'teal', 'blue', 'gray'];
const blankItem: LootEntry = { Item: '', Min: 1, Max: 1, Weight: 1 };
const percent = (value: number) =>
  value > 0 && value < 0.01 ? '<0.01%' : value.toLocaleString(undefined, { maximumFractionDigits: 2 }) + '%';

export function LootTip({ label, help }: { label: string; help: string }) {
  return (
    <Group gap={4} wrap='nowrap' component='span' display='inline-flex'>
      <span>{label}</span>
      <Tooltip label={help} multiline w={260} events={{ hover: true, focus: true, touch: true }} withArrow>
        <ActionIcon component='span' tabIndex={0} aria-label={help} variant='subtle' size='xs'>
          <IconInfoCircle size={15} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

export function RustLootIcon({ item }: { item: string }) {
  const [failed, setFailed] = useState('');
  return (
    <span
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: 38,
        height: 38,
        borderRadius: 6,
        background: 'var(--mantine-color-dark-6)',
        flexShrink: 0,
      }}
    >
      {/^[a-z0-9_.-]+$/.test(item) && item !== failed ? (
        <img
          alt=''
          width={34}
          height={34}
          loading='lazy'
          src={'https://wiki.rustclash.com/img/items180/' + encodeURIComponent(item) + '.png'}
          onError={() => setFailed(item)}
        />
      ) : (
        <IconPackage size={21} color='var(--mantine-color-gray-5)' />
      )}
    </span>
  );
}

function DropRows({
  entries,
  weighted,
  onChange,
}: {
  entries: LootEntry[];
  weighted: boolean;
  onChange: (items: LootEntry[]) => void;
}) {
  const total = entries.reduce((sum, entry) => sum + entry.Weight, 0);
  return (
    <Stack gap='xs'>
      {entries.map((entry, i) => {
        const update = (field: keyof LootEntry, value: number | string) =>
          onChange(entries.map((row, j) => (j === i ? { ...row, [field]: value } : row)));
        return (
          <Group align='end' gap='xs' key={i}>
            <Stack gap={4}>
              <Text component='div' size='sm'>
                <LootTip
                  label='Item'
                  help='Browse Rust items by category or search by name. Each selected item has its own quantity and weight.'
                />
              </Text>
              <LootItemPicker
                value={entry.Item}
                Icon={RustLootIcon}
                onChange={(value) => update('Item', value)}
              />
            </Stack>
            <NumberInput
              label={<LootTip label='Min' help='Smallest stack this item can drop when selected.' />}
              min={1}
              max={100000}
              allowDecimal={false}
              w={80}
              value={entry.Min}
              onChange={(v) => update('Min', Number(v))}
            />
            <NumberInput
              label={
                <LootTip
                  label='Max'
                  help='Largest stack this item can drop. Quantities between min and max are equally likely.'
                />
              }
              min={1}
              max={100000}
              allowDecimal={false}
              w={80}
              value={entry.Max}
              onChange={(v) => update('Max', Number(v))}
            />
            {weighted && (
              <NumberInput
                label={
                  <LootTip
                    label='Weight'
                    help='An item’s share of this tier is its weight divided by the total weight. Increasing it reduces other items’ shares without changing the tier’s hit chance.'
                  />
                }
                min={1}
                max={100000}
                allowDecimal={false}
                w={96}
                value={entry.Weight}
                onChange={(v) => update('Weight', Number(v))}
              />
            )}
            {weighted && (
              <Badge
                mb={8}
                color='gray'
                variant='light'
                title='Chance to select this item after the pool is hit'
              >
                {percent(total > 0 ? (entry.Weight / total) * 100 : 0)} of pool
              </Badge>
            )}
            <ActionIcon
              color='red'
              variant='subtle'
              mb={4}
              aria-label={'Remove ' + (entry.Item || 'item ' + (i + 1))}
              onClick={() => onChange(entries.filter((_, j) => j !== i))}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        );
      })}
      {entries.length < 200 && (
        <Group>
          <LootItemPicker
            adding
            value=''
            Icon={RustLootIcon}
            onChange={(Item) => onChange([...entries, { ...blankItem, Item }])}
          />
        </Group>
      )}
    </Stack>
  );
}

export function LootCascade({ table, change }: { table: Loot; change: (table: Loot) => void }) {
  const cascade = table.Cascade;
  const { hits, remaining } = cascadeOdds(cascade ?? []);
  function move(from: number, to: number) {
    if (!cascade || to < 0 || to >= cascade.length) return;
    const next = [...cascade];
    [next[from], next[to]] = [next[to], next[from]];
    change({ ...table, Cascade: next });
  }
  return (
    <Stack>
      {cascade ? (
        <Stack gap={0}>
          <Group justify='space-between' mb='sm'>
            <Title order={4}>
              <LootTip
                label='Drop cascade'
                help='Every roll starts at the top. On a hit, it selects one item and stops. On a miss it tries the next tier. Order matters.'
              />
            </Title>
            <Button
              variant='light'
              size='xs'
              disabled={cascade.length >= 12}
              onClick={() => {
                const next = [...cascade];
                const position = next.at(-1)?.Chance === 10000 ? next.length - 1 : next.length;
                next.splice(position, 0, { Name: 'New tier', Chance: 200, Entries: [{ ...blankItem }] });
                change({ ...table, Cascade: next });
              }}
            >
              Add tier
            </Button>
          </Group>
          {cascade.map((pool, i) => {
            const color = palette[Math.min(i, palette.length - 1)];
            const update = (patch: Partial<typeof pool>) =>
              change({ ...table, Cascade: cascade.map((p, j) => (i === j ? { ...p, ...patch } : p)) });
            return (
              <div key={i}>
                <Card
                  withBorder
                  radius='md'
                  style={{ borderInlineStart: '4px solid var(--mantine-color-' + color + '-6)' }}
                  p='md'
                >
                  <Stack gap='sm'>
                    <Group justify='space-between' align='end'>
                      <Group align='end'>
                        <Badge color={color} size='lg' mb={6}>
                          Tier {i + 1}
                        </Badge>
                        <TextInput
                          label='Tier name'
                          value={pool.Name}
                          onChange={(e) => update({ Name: e.currentTarget.value })}
                        />
                        <NumberInput
                          label={
                            <LootTip
                              label='Chance if reached'
                              help='Chance this tier hits after all tiers above miss. At 100%, nothing below it can drop. At 0%, every roll skips it.'
                            />
                          }
                          w={151}
                          min={0}
                          max={100}
                          decimalScale={2}
                          suffix='%'
                          value={pool.Chance / 100}
                          onChange={(v) => update({ Chance: Math.round(Number(v) * 100) })}
                        />
                      </Group>
                      <Group gap={4}>
                        <Badge
                          color={color}
                          variant='light'
                          title='Chance per roll after accounting for all preceding tiers'
                        >
                          {percent(hits[i] * 100)} per roll
                        </Badge>
                        <ActionIcon
                          variant='subtle'
                          disabled={i === 0}
                          title='Move earlier in the cascade'
                          aria-label={'Move tier ' + (i + 1) + ' up'}
                          onClick={() => move(i, i - 1)}
                        >
                          <IconArrowUp size={17} />
                        </ActionIcon>
                        <ActionIcon
                          variant='subtle'
                          disabled={i === cascade.length - 1}
                          title='Move later in the cascade'
                          aria-label={'Move tier ' + (i + 1) + ' down'}
                          onClick={() => move(i, i + 1)}
                        >
                          <IconArrowDown size={17} />
                        </ActionIcon>
                        <ActionIcon
                          color='red'
                          variant='subtle'
                          disabled={cascade.length < 2}
                          aria-label={'Remove tier ' + (i + 1)}
                          onClick={() => change({ ...table, Cascade: cascade.filter((_, j) => i !== j) })}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Group>
                    {hits[i] === 0 && pool.Chance > 0 && (
                      <Text c='orange' size='xs'>
                        An earlier tier catches every roll before it reaches this one.
                      </Text>
                    )}
                    <DropRows entries={pool.Entries} weighted onChange={(Entries) => update({ Entries })} />
                  </Stack>
                </Card>
                <Group gap={5} c='dimmed' py={5} pl='md'>
                  <IconArrowDown size={15} />
                  <Text size='xs'>
                    {i === cascade.length - 1
                      ? percent(remaining * 100) + ' of rolls end with no drop'
                      : 'On a miss, try the next tier'}
                  </Text>
                </Group>
              </div>
            );
          })}
        </Stack>
      ) : (
        <Card withBorder>
          <Stack>
            <Group justify='space-between'>
              <Title order={4}>
                <LootTip
                  label='Weighted drops'
                  help='These items share a single pool. Start a cascade to give rare drops their own chance before the standard pool.'
                />
              </Title>
              <Button
                size='xs'
                variant='light'
                onClick={() =>
                  change({
                    ...table,
                    Cascade: [
                      { Name: 'Rare', Chance: 200, Entries: [{ ...blankItem }] },
                      {
                        Name: 'Common',
                        Chance: 10000,
                        Entries: table.Entries.length ? table.Entries : [{ ...blankItem }],
                      },
                    ],
                  })
                }
              >
                Start a cascade
              </Button>
            </Group>
            <DropRows
              entries={table.Entries}
              weighted
              onChange={(Entries) => change({ ...table, Entries })}
            />
          </Stack>
        </Card>
      )}
      <Card withBorder>
        <Stack>
          <Title order={4}>
            <LootTip
              label='Guaranteed drops'
              help='Every raid gets each of these drops once, even with zero rolls or when every tier misses.'
            />
          </Title>
          <DropRows
            entries={table.Guaranteed}
            weighted={false}
            onChange={(Guaranteed) => change({ ...table, Guaranteed })}
          />
        </Stack>
      </Card>
    </Stack>
  );
}
