import { useState, type ComponentType } from 'react';
import {
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import catalog from './rust-loot-items.json';

const categories = Object.keys(catalog);
const items = Object.entries(catalog).flatMap(([category, entries]) =>
  entries.map(([shortname, name]) => ({ shortname, name, category })),
);
const names = new Map(items.map((item) => [item.shortname, item.name]));
export const lootItemName = (item: string) => names.get(item) ?? item;
const pageSize = 36;

export function LootItemPicker({
  value,
  onChange,
  Icon,
  adding = false,
}: {
  value: string;
  adding?: boolean;
  onChange: (value: string) => void;
  Icon: ComponentType<{ item: string }>;
}) {
  const [opened, open] = useState(false);
  const [category, chooseCategory] = useState('All categories');
  const [query, search] = useState('');
  const [limit, setLimit] = useState(pageSize);
  const [custom, setCustom] = useState('');
  const term = query.trim().toLowerCase();
  const matching = opened
    ? items.filter(
        (item) =>
          (category === 'All categories' || category === item.category) &&
          (!term || item.name.toLowerCase().includes(term) || item.shortname.includes(term)),
      )
    : [];
  function choose(shortname: string) {
    onChange(shortname);
    open(false);
  }
  return (
    <>
      <Button
        variant={adding ? 'light' : 'default'}
        size={adding ? 'xs' : 'compact-lg'}
        mih={adding ? undefined : 38}
        leftSection={!adding && <Icon item={value} />}
        onClick={() => {
          search('');
          setLimit(pageSize);
          setCustom(value);
          chooseCategory(items.find((item) => item.shortname === value)?.category ?? 'All categories');
          open(true);
        }}
        aria-label={
          value
            ? 'Change loot item ' + (names.get(value) ?? value)
            : adding
              ? 'Add loot item'
              : 'Choose loot item'
        }
      >
        {value ? (names.get(value) ?? value) : adding ? 'Add item' : 'Choose item'}
      </Button>
      <Modal opened={opened} onClose={() => open(false)} title='Choose a Rust item' size='xl'>
        <Stack>
          <Group grow align='end'>
            <Select
              label='Category'
              data={['All categories', ...categories]}
              value={category}
              allowDeselect={false}
              onChange={(value) => {
                chooseCategory(value ?? 'All categories');
                setLimit(pageSize);
              }}
            />
            <TextInput
              autoFocus
              label='Search'
              placeholder='Display name or shortname'
              value={query}
              onChange={(event) => {
                search(event.currentTarget.value);
                setLimit(pageSize);
              }}
            />
          </Group>
          <Group justify='space-between'>
            <Text c='dimmed' size='sm'>
              {matching.length} items
            </Text>
            {category !== 'All categories' && <Badge variant='light'>{category}</Badge>}
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {matching.slice(0, limit).map((item) => (
              <UnstyledButton key={item.shortname} onClick={() => choose(item.shortname)}>
                <Card
                  withBorder
                  px='sm'
                  py='xs'
                  h='100%'
                  bg={value === item.shortname ? 'var(--mantine-primary-color-light)' : undefined}
                >
                  <Group gap='xs' wrap='nowrap'>
                    <Icon item={item.shortname} />
                    <div style={{ minWidth: 0 }}>
                      <Text size='sm' fw={600} lineClamp={2}>
                        {item.name}
                      </Text>
                      <Text size='xs' c='dimmed' truncate>
                        {item.shortname}
                      </Text>
                    </div>
                  </Group>
                </Card>
              </UnstyledButton>
            ))}
          </SimpleGrid>
          {!matching.length && <Text c='dimmed'>No items match this search.</Text>}
          {matching.length > limit && (
            <Button variant='light' onClick={() => setLimit(limit + pageSize)}>
              Show more items
            </Button>
          )}
          <details>
            <summary>Enter a custom shortname</summary>
            <Group mt='xs' align='end'>
              <TextInput
                label='Rust shortname'
                value={custom}
                onChange={(e) => setCustom(e.currentTarget.value.trim().toLowerCase())}
              />
              <Button
                variant='light'
                disabled={!/^[a-z0-9_.-]{1,100}$/.test(custom)}
                onClick={() => choose(custom)}
              >
                Use shortname
              </Button>
            </Group>
            <Anchor
              href='https://wiki.rustclash.com/group=itemlist'
              target='_blank'
              rel='noreferrer'
              size='xs'
            >
              Rust item reference
            </Anchor>
          </details>
        </Stack>
      </Modal>
    </>
  );
}
