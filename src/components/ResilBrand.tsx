import { Box, Text } from '@mantine/core';

export default function ResilBrand({ large = false }: { large?: boolean }) {
  return (
    <Box style={{ width: 'fit-content', textAlign: 'center', margin: large ? '0 auto 20px' : undefined, lineHeight: 1 }} aria-label='RE /sil — Rust Empires'>
      <Text component='div' fw={800} c='white' style={{ fontSize: large ? 48 : 25, lineHeight: 1.1, borderBottom: '2px solid #eb1b0c', paddingBottom: 3, whiteSpace: 'nowrap' }}>
        RE <span style={{ color: '#eb1b0c' }}>/sil</span>
      </Text>
      <Text component='div' c='dimmed' fw={600} style={{ fontSize: large ? 12 : 8, letterSpacing: '0.16em', marginTop: 4 }}>RUST EMPIRES</Text>
    </Box>
  );
}
