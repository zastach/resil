import typedPlugin from '../typedPlugin';

export const PATH = '/robots.txt';
export default typedPlugin(
  async (server) => {
    server.get(PATH, (_, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
  },
  { name: PATH },
);
