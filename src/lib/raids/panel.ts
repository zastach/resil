import z from 'zod';

export const panelRule = z.object({
  mode: z.enum(['fixed', 'majority', 'supermajority']),
  minimum: z.number().int().min(1).max(1000),
  percent: z.number().int().min(51).max(100),
});
export type PanelRule = z.infer<typeof panelRule>;
export function requiredVotes(rule: PanelRule, eligible: number) {
  if (rule.mode === 'fixed') return rule.minimum;
  const share =
    rule.mode === 'majority' ? Math.floor(eligible / 2) + 1 : Math.ceil((eligible * rule.percent) / 100);
  return Math.max(rule.minimum, share);
}
