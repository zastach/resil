import type { MultipartFields } from '@fastify/multipart';
import { z } from 'zod';
import { ApiError } from './errors';
import { imageOrganizationSchema } from '../image-organization';

export function readUploadOrganization(fields: MultipartFields, count: number) {
  const field = fields['resil-organization'];
  if (!field) return undefined;
  try {
    if (Array.isArray(field) || field.type !== 'field' || typeof field.value !== 'string') throw new Error();
    return z.array(imageOrganizationSchema.nullable()).length(count).parse(JSON.parse(field.value));
  } catch {
    throw new ApiError(1001, 'Invalid image organization details.');
  }
}
