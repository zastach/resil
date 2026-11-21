import { resilPrivacy, resilTerms } from '@/lib/resil-policy-copy';
import Markdown from '@/components/render/Markdown';
import { useTitle } from '@/lib/client/hooks/useTitle';
import { Anchor, Container, Group } from '@mantine/core';
import { Link, useLocation } from 'react-router-dom';

const contact = `# Contact Us

- Contact us on Discord in [❓❓ staff-help-and-questions](https://discord.com/channels/382423281900191746/471822254670610433)
- [support@resil.me](mailto:support@resil.me) for account and upload help
- [privacy@resil.me](mailto:privacy@resil.me) for privacy and data requests
- [legal@resil.me](mailto:legal@resil.me) for legal inquiries
- [abuse@resil.me](mailto:abuse@resil.me) to report an upload or misuse. Include the link if you have it.`;

const pages = {
  '/auth/terms': { title: 'Terms of Service', body: resilTerms },
  '/auth/privacy': { title: 'Privacy Policy', body: resilPrivacy },
  '/auth/contact': { title: 'Contact Us', body: contact },
};

export function Component() {
  const { pathname } = useLocation();
  const page =
    pages[pathname.replace(/\/$/, '').toLowerCase() as keyof typeof pages] ?? pages['/auth/contact'];
  useTitle(page.title);

  return (
    <Container component='main' size='sm' my='xl'>
      <Group gap='md'>
        <Anchor component={Link} to='/auth/login'>
          Sign in
        </Anchor>
        <Anchor component={Link} to='/auth/terms'>
          Terms of Service
        </Anchor>
        <Anchor component={Link} to='/auth/privacy'>
          Privacy Policy
        </Anchor>
        <Anchor component={Link} to='/auth/contact'>
          Contact Us
        </Anchor>
      </Group>
      <Markdown md={page.body} />
    </Container>
  );
}
