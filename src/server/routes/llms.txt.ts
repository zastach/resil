import typedPlugin from '../typedPlugin';

const notice = `# RE /sil

> Rust Empires image hosting for players.

Scraping, automated collection, and AI training on site content or player uploads are prohibited. See /robots.txt for crawler directives.
`;

export const PATH = '/llms.txt';
export default typedPlugin(
  async (server) => {
    for (const path of [PATH, '/llm.txt']) {
      server.get(path, (_, res) => res.type('text/plain').send(notice));
    }
  },
  { name: PATH },
);
