import { Button, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconUsersGroup } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

export function Component() {
  return (
    <Stack p='lg' maw={1100} mx='auto'>
      <Title order={2}>Developer Tools</Title>
      <Text c='dimmed'>Site-administrator tools for Rust Empires. Select a tool to get started.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        <Card withBorder radius='md' p='lg'>
          <Stack>
            <Group>
              <IconUsersGroup size={24} />
              <Title order={4}>NPC Studio</Title>
            </Group>
            <Text size='sm' c='dimmed'>
              Create civilian NPC definitions, outfits, and branching conversations.
            </Text>
            <Button component={Link} to='/devtools/npcstudio'>
              Open NPC Studio
            </Button>
          </Stack>
        </Card>
        <Card withBorder radius='md' p='lg'>
          <Stack>
            <Title order={4}>Raid Center</Title>
            <Text size='sm'>Review base revisions, publish approved raids, and tune loot tables.</Text>
            <Button component={Link} to='/devtools/raids'>
              Open Raid Center
            </Button>
          </Stack>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
