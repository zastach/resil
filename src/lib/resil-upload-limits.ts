export const RESIL_MAX_FILE_BYTES = 999_999;
export const RESIL_USER_STORAGE_BYTES = 1_000_000_000;

export function formatResilFileLimit(limit: number, fallback: string) {
  return limit === RESIL_MAX_FILE_BYTES ? '1 MB' : fallback;
}
