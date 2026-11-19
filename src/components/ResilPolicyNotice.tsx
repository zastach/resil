import type { User } from '@/lib/db/models/user';
import { fetchApi } from '@/lib/fetchApi';
import { RESIL_POLICY_VERSION } from '@/lib/resil-policy';
import { Alert, Anchor, Button, Checkbox, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function ResilPolicyNotice({
  user,
  refreshUser,
}: {
  user: User;
  refreshUser: () => Promise<unknown>;
}) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (user.resilPolicyAcceptance?.version === RESIL_POLICY_VERSION) return null;

  async function accept() {
    setSaving(true);
    setError('');
    try {
      const { error } = await fetchApi('/api/user', 'PATCH', { acceptResilPolicy: RESIL_POLICY_VERSION });
      if (error) throw error;
      await refreshUser();
    } catch {
      setError('Your acceptance could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Alert title='Review the RE /sil policies' mb='md'>
      <Stack align='flex-start' gap='sm'>
        <Text size='sm'>
          Read the{' '}
          <Anchor component={Link} to='/auth/terms'>
            Terms of Service
          </Anchor>{' '}
          and{' '}
          <Anchor component={Link} to='/auth/privacy'>
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
          Confirm
        </Button>
      </Stack>
    </Alert>
  );
}
