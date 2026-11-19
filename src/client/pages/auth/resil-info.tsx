import RustImageOptimizer from '@/components/RustImageOptimizer';
import Markdown from '@/components/render/Markdown';
import { useTitle } from '@/lib/client/hooks/useTitle';
import { Anchor, Container, Group } from '@mantine/core';
import { Link, useLocation } from 'react-router-dom';

const privacy = `# Privacy Policy

We collect only what we need to run RE /sil. That includes your account details, Discord information used to check access, and the files you upload. We do not collect your birthday. Our hosting provider stores and serves the files and data needed to operate the service.

Anyone with a public image link can view that image. Only upload work you are comfortable sharing through a public link.

RE Owners and service administrators may see your work while operating or moderating the service. If we would like to use your work ourselves, we may contact you directly on Discord for permission. RE Owners and service administrators will not use anything you have uploaded without your consent.

Contact [privacy@resil.me](mailto:privacy@resil.me) with privacy questions or requests to access or delete your data.

we built this service as a convenience for our players, not to profit off of them, or train AI.`;

export const resilTerms = `# Terms of Service

RE /sil hosts images for the Rust Empires community. To use an account, you must meet the minimum age required by applicable law where you live and meet Discord’s age requirements if you use Discord to sign in.

You keep ownership of your work. Upload only files you have permission to share. By uploading, you allow RE /sil and our hosting provider to store and deliver your files for you. Anyone with a public link can view or copy the file.

Do not upload illegal or infringing material, share someone’s private information without permission, or use the service to harass others, spread malware, or evade access controls. We may remove content or restrict access to enforce these terms, protect the service, or comply with law.

Keep your own copies. We may change upload limits, and links may stop working if files are removed or the service is unavailable.

For legal questions, email [legal@resil.me](mailto:legal@resil.me). Report abuse at [abuse@resil.me](mailto:abuse@resil.me).`;

const contact = `# Contact Us

- [support@resil.me](mailto:support@resil.me) for account and upload help
- [privacy@resil.me](mailto:privacy@resil.me) for privacy and data requests
- [legal@resil.me](mailto:legal@resil.me) for legal inquiries
- [abuse@resil.me](mailto:abuse@resil.me) to report an upload or misuse. Include the link if you have it.`;

const imageGuide = `# Rust Image Guide

1. Export your image as a PNG or JPEG. PNG is a good choice for sharp lettering and transparent artwork. JPEG works well for photos.
2. Crop the image to match the proportions of the sign you plan to use. Each file can be up to 999,999 bytes for /sil. Each account can store up to 1 GB.
3. Upload the image, copy the **/sil** command from the result, then look at your sign in Rust and paste the command into chat.

If an image fails to load in Rust, check that the direct image URL opens while signed out. A dashboard link requires a login and cannot be used by the game.`;

const pages = {
  '/auth/terms': { title: 'Terms of Service', body: resilTerms },
  '/auth/privacy': { title: 'Privacy Policy', body: privacy },
  '/auth/contact': { title: 'Contact Us', body: contact },
  '/auth/image-guide': { title: 'Rust Image Guide', body: imageGuide },
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
      {page.body === imageGuide && <RustImageOptimizer />}
    </Container>
  );
}
