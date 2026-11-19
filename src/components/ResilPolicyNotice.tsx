import Markdown from '@/components/render/Markdown';
import { resilPrivacy, resilTerms } from '@/lib/resil-policy-copy';
import { RESIL_POLICY_ACCEPTANCE_PATH, RESIL_POLICY_VERSION } from '@/lib/resil-policy';
import { Alert, Anchor, Button, Checkbox, Modal, Stack, Text } from '@mantine/core';
import { useState } from 'react';

export default function ResilPolicyNotice({
  logout,
  refreshUser,
}: {
  logout: () => Promise<void>;
  refreshUser: () => Promise<unknown>;
}) {
  const [policy, setPolicy] = useState<'terms' | 'privacy' | null>(null);
  const policyTitle = policy === 'terms' ? 'Terms of Service' : 'Privacy Policy';
  const policyText = policy === 'terms' ? resilTerms : resilPrivacy;
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function accept() {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(RESIL_POLICY_ACCEPTANCE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: RESIL_POLICY_VERSION }),
      });
      if (!response.ok) throw new Error('Policy acceptance failed');
      await refreshUser();
    } catch {
      setError('Your acceptance could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Alert title='Review the RE /sil policies' mb='md'>
      <Modal opened={policy !== null} onClose={() => setPolicy(null)} title={policyTitle} size='lg' centered>
        <Markdown md={policyText.replace(/^# .+\n\n/, '')} />
      </Modal>
      <Stack align='flex-start' gap='sm'>
        <Text size='sm'>
          Read the{' '}
          <Anchor component='button' type='button' onClick={() => setPolicy('terms')}>
            Terms of Service
          </Anchor>{' '}
          and{' '}
          <Anchor component='button' type='button' onClick={() => setPolicy('privacy')}>
            Privacy Policy
          </Anchor>
          .
        </Text>
        <Checkbox
          checked={checked}
          onChange={(event) => setChecked(event.currentTarget.checked)}
          label='I meet the applicable age requirements, agree to the Terms of Service, and acknowledge the Privacy Policy.'
        />
        {error && (
          <Text size='sm' c='red' role='alert'>
            {error}
          </Text>
        )}
        <Button size='xs' disabled={!checked} loading={saving} onClick={accept}>
          Accept and continue
        </Button>
        <Button variant='subtle' size='xs' onClick={logout}>
          Sign out
        </Button>
      </Stack>
    </Alert>
  );
}
