import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import typedPlugin from '@/server/typedPlugin';

export const PATH = '/api/sign-readability-model/eng.traineddata.gz';

const model = join(
  dirname(createRequire(import.meta.url).resolve('@tesseract.js-data/eng')),
  '4.0.0_best_int',
  'eng.traineddata.gz',
);

export default typedPlugin(
  async (server) => {
    server.get(PATH, (_, reply) =>
      reply
        .header('Cache-Control', 'public, max-age=86400')
        .type('application/octet-stream')
        .send(createReadStream(model)),
    );
  },
  { name: PATH },
);
