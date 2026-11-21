import { ApiError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { filePasswordExtra } from '@/lib/db/models/file';
import { files, filesToTags, folders, tags } from '@/lib/db/schema';
import { userMiddleware } from '@/server/middleware/user';
import typedPlugin from '@/server/typedPlugin';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

const PATH = '/api/user/folders/:id/images';
export { PATH };
const params = z.object({ id: z.string() });

export default typedPlugin(async (server) => {
  server.get(PATH, { schema: { params }, preHandler: [userMiddleware] }, async (req) => {
    const folder = await db.query.folders.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      columns: { imageOrder: true },
    });
    if (!folder) throw new ApiError(4001);
    const rows = await db.query.files.findMany({
      where: { folderId: req.params.id, userId: req.user.id, type: { like: 'image/%' } },
      columns: { id: true, name: true, originalName: true, organization: true, type: true, size: true },
      extras: filePasswordExtra,
      with: { tags: { columns: { id: true } } },
    });
    return { order: folder.imageOrder, files: rows };
  });

  server.patch(
    PATH,
    {
      schema: {
        params,
        body: z.union([
          z.object({ order: z.array(z.string().min(1).max(64)).max(10000).nullable() }).strict(),
          z
            .object({
              entryId: z.string().min(1).max(64),
              displayName: z.string().trim().min(1).max(120),
              tagIds: z.array(z.string()).max(100).optional(),
            })
            .strict(),
        ]),
      },
      preHandler: [userMiddleware],
    },
    async (req) => {
      const { id } = req.params;
      const owner = eq(folders.userId, req.user.id);
      const patch = req.body;
      return db.transaction(async (tx) => {
        const [folder] = await tx
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.id, id), owner))
          .for('update');
        if (!folder) throw new ApiError(4001);

        if ('order' in patch) {
          await tx
            .update(folders)
            .set({ imageOrder: patch.order && [...new Set(patch.order)] })
            .where(and(eq(folders.id, id), owner));
          return { success: true };
        }

        const entryFiles = and(
          eq(files.folderId, id),
          eq(files.userId, req.user.id),
          sql`${files.type} like 'image/%'`,
          sql`coalesce(${files.organization}->>'groupId', ${files.id}) = ${patch.entryId}`,
        );
        const rows = await tx
          .select({
            id: files.id,
            name: files.name,
            originalName: files.originalName,
            organization: files.organization,
          })
          .from(files)
          .where(entryFiles)
          .for('update');
        if (!rows.length) throw new ApiError(4000);

        await tx
          .update(files)
          .set({
            organization: sql`coalesce(${files.organization}, jsonb_build_object(
          'groupId', ${files.id}, 'sourceName', coalesce(${files.originalName}, ${files.name}), 'variant', null
        )) || jsonb_build_object('displayName', cast(${patch.displayName} as text))`,
          })
          .where(entryFiles);

        if (patch.tagIds) {
          const tagIds = [...new Set(patch.tagIds)];
          if (tagIds.length) {
            const ownedTags = await tx
              .select({ id: tags.id })
              .from(tags)
              .where(and(eq(tags.userId, req.user.id), inArray(tags.id, tagIds)));
            if (ownedTags.length !== tagIds.length)
              throw new ApiError(1001, 'One or more tags are unavailable.');
          }
          const fileIds = rows.map(({ id: fileId }) => fileId);
          await tx.delete(filesToTags).where(inArray(filesToTags.fileId, fileIds));
          if (tagIds.length)
            await tx
              .insert(filesToTags)
              .values(fileIds.flatMap((fileId) => tagIds.map((tagId) => ({ fileId, tagId }))));
        }
        return { success: true };
      });
    },
  );
});
