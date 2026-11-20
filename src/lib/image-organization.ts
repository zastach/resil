import { z } from 'zod';

export const imageOrganizationSchema = z.object({
  groupId: z.string().min(1).max(64),
  displayName: z.string().trim().min(1).max(120),
  sourceName: z.string().min(1).max(512),
  variant: z.string().min(1).max(120).nullable(),
});

export type ImageOrganization = z.infer<typeof imageOrganizationSchema>;

export function suggestImageName(filename: string) {
  const cleaned = filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) || 'Untitled image').slice(0, 120);
}
