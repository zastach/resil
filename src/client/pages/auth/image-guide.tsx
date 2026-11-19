import { rustSignGroups } from '@/lib/rust-sign-sizes';
import { useTitle } from '@/lib/client/hooks/useTitle';
import { Anchor, Button, Container, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';

export function Component() {
  useTitle('Rust Image Guide');

  return (
    <Container component='main' size='sm' py='xl'>
      <Stack gap='xl'>
        <div>
          <Title order={1}>Rust Image Guide</Title>
          <Text c='dimmed' mt='xs'>
            Recommended canvas sizes for Rust signs and frames. Dimensions are width × height in pixels. Keep
            each file under 1 MB for /sil.
          </Text>
          <Button component={Link} to='/dashboard/image-optimizer' mt='md'>
            Open image optimizer
          </Button>
        </div>
        {rustSignGroups.map(({ name, sizes }) => (
          <Paper key={name} withBorder p='md'>
            <Title order={2} size='h4' mb='xs'>
              {name}
            </Title>
            <Table aria-label={name}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Rust item</Table.Th>
                  <Table.Th ta='right'>Width × height</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sizes.map(([item, width, height]) => (
                  <Table.Tr key={item}>
                    <Table.Td>{item}</Table.Td>
                    <Table.Td ta='right' style={{ whiteSpace: 'nowrap' }}>
                      {width} × {height}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        ))}
        <Anchor href='https://steamcommunity.com/sharedfiles/filedetails/?id=3284334935' size='sm'>
          Rust Image Dimensions on Steam
        </Anchor>
      </Stack>
    </Container>
  );
}
