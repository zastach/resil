export const RESIL_POLICY_VERSION = '2026-11-18';
export const RESIL_POLICY_ACCEPTANCE_PATH = '/api/user/policy-acceptance';

export function hasAcceptedResilPolicy(user: { resilPolicyAcceptance?: { version: string } | null }) {
  return user.resilPolicyAcceptance?.version === RESIL_POLICY_VERSION;
}
