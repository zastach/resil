import { ApiError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { fileColumns, filePasswordExtra, fileRelations, fileSchema, formatFiles } from '@/lib/db/models/file';
import { getFolderWithOwner } from '@/lib/db/models/folder';
import { getUserIdentity } from '@/lib/db/models/user';
import { files, incompleteFiles, tags } from '@/lib/db/schema';
import { containsText } from '@/lib/db/utils';
import { canInteract, canManage } from '@/lib/role';
import { paginationQs } from '@/lib/validation';
import { userMiddleware } from '@/server/middleware/user';
import typedPlugin from '@/server/typedPlugin';
import { and, asc, eq, inArray, like, ne, notInArray, or, sql } from 'drizzle-orm';
import z from 'zod';

const searchFieldSchema = z.enum(['name', 'originalName', 'type', 'tags', 'id']);
const responseSchema = z.object({
  page: z.array(fileSchema),
  search: z
    .object({
      field: searchFieldSchema,
      query: z.union([z.string(), z.array(z.string())]),
    })
    .optional(),
  variants: z.record(z.string(), z.array(fileSchema)).optional(),
  total: z.number().optional(),
  pages: z.number().optional(),
});

export type FileSearchField = z.infer<typeof searchFieldSchema>;
export type ApiUserFilesResponse = z.infer<typeof responseSchema>;

export const PATH = '/api/user/files';
export default typedPlugin(
  async (server) => {
    server.get(
      PATH,
      {
        schema: {
          description:
            'List, filter, and search files for the authenticated user (or another user if permitted).',
          querystring: paginationQs.extend({
            searchField: searchFieldSchema.optional().default('name'),
            searchQuery: z.string().optional(),
            id: z.string().optional(),
            folder: z.string().optional(),
            grouped: z.literal('true').optional(),
          }),
          response: {
            200: responseSchema,
          },
          tags: ['auth'],
        },
        preHandler: [userMiddleware],
      },
      async (req, res) => {
        const user = await getUserIdentity(req.query.id ?? req.user.id);

        if (!user || (user.id !== req.user.id && !canInteract(req.user.role, user.role)))
          throw new ApiError(9002);

        const { perpage, searchQuery, searchField, page, filter, favorite, sortBy, order, folder } =
          req.query;

        let folderId: string | undefined;
        if (folder) {
          const targetFolder = await getFolderWithOwner(folder);
          if (!targetFolder || !canManage(req.user, targetFolder.user)) throw new ApiError(9002);

          folderId = targetFolder.id;
        }

        const incompleteIds = db
          .select({ id: sql<string>`${incompleteFiles.metadata}->'file'->>'id'` })
          .from(incompleteFiles)
          .where(and(eq(incompleteFiles.userId, user.id), ne(incompleteFiles.status, 'COMPLETE')));

        let tagIds: string[] = [];
        if (searchQuery && searchField === 'tags') {
          tagIds = searchQuery
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag);

          if (!tagIds.length) return res.send({ page: [], search: { field: searchField, query: tagIds } });

          const ownedTagCount = await db.$count(
            tags,
            and(eq(tags.userId, user.id), inArray(tags.id, tagIds)),
          );
          if (ownedTagCount !== tagIds.length) throw new ApiError(1032);
        }

        const fileFilter = (file: typeof files) =>
          and(
            eq(file.userId, user.id),
            filter === 'dashboard'
              ? or(
                  like(file.type, 'image/%'),
                  like(file.type, 'video/%'),
                  like(file.type, 'audio/%'),
                  like(file.type, 'text/%'),
                )
              : undefined,
            favorite && filter !== 'all' ? eq(file.favorite, true) : undefined,
            folderId ? eq(file.folderId, folderId) : undefined,
            notInArray(file.id, incompleteIds),
            searchQuery && searchField !== 'tags' ? containsText(file[searchField], searchQuery) : undefined,
          )!;

        // Select one representative before pagination, preferring the original when it exists.
        const groupKey = sql<string>`coalesce(${files.organization}->>'groupId', ${files.id})`;
        const grouped = req.query.grouped && !searchQuery && !favorite;
        const representatives = db
          .selectDistinctOn([groupKey], { id: files.id })
          .from(files)
          .where(fileFilter(files))
          .orderBy(
            groupKey,
            sql`(${files.organization}->>'variant') is not null`,
            asc(files.createdAt),
            asc(files.id),
          );
        const pageFilter = (file: typeof files) =>
          grouped ? and(fileFilter(file), inArray(file.id, representatives))! : fileFilter(file);

        const fileRows = await db.query.files.findMany({
          columns: fileColumns,
          extras: searchQuery ? undefined : filePasswordExtra,
          where: {
            RAW: pageFilter,
            AND: tagIds.map((id) => ({ tags: { id } })),
          },
          orderBy: (file, { asc, desc }) => [
            order === 'asc' ? asc(file[sortBy]) : desc(file[sortBy]),
            asc(file.id),
          ],
          offset: (page - 1) * perpage,
          limit: perpage,
          with: fileRelations,
        });
        const filePage = formatFiles(fileRows);

        if (searchQuery)
          return res.send({
            page: filePage,
            search: {
              field: searchField,
              query: searchField === 'tags' ? tagIds : searchQuery,
            },
          });

        const variants: Record<string, typeof filePage> = {};
        if (grouped && filePage.length) {
          const parentsByGroup = new Map(
            filePage.map((file) => [file.organization?.groupId ?? file.id, file.id]),
          );
          const children = await db.query.files.findMany({
            columns: fileColumns,
            extras: filePasswordExtra,
            where: {
              RAW: (file) =>
                and(
                  fileFilter(file),
                  inArray(sql<string>`${file.organization}->>'groupId'`, [...parentsByGroup.keys()]),
                  notInArray(
                    file.id,
                    filePage.map(({ id }) => id),
                  ),
                )!,
            },
            orderBy: (file, { asc }) => [asc(file.createdAt), asc(file.id)],
            with: fileRelations,
          });

          for (const child of formatFiles(children)) {
            const parentId = child.organization && parentsByGroup.get(child.organization.groupId);
            if (parentId) (variants[parentId] ??= []).push(child);
          }
        }

        const total = await db.$count(files, pageFilter(files));

        return res.send({
          page: filePage,
          ...(grouped && { variants }),
          total,
          pages: Math.ceil(total / perpage),
        });
      },
    );
  },
  { name: PATH },
);
