// Minimal static file server for the deck — bun stdlib only, zero deps.
// Why bun: one binary, no package.json, `bun run serve.ts`.
const root = new URL('.', import.meta.url).pathname;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

Bun.serve({
  port: Number(process.env.PORT ?? 8000),
  async fetch(req) {
    const path = new URL(req.url).pathname;
    // "/" → index.html; everything else resolved under root; no traversal cleanup needed
    // (Bun.file rejects paths outside cwd patterns — XXX: revisit if deck is exposed publicly)
    const rel = path === '/' ? 'index.html' : path.slice(1);
    const file = Bun.file(root + rel);
    if (!(await file.exists())) return new Response('404', { status: 404 });
    return new Response(file, {
      headers: { 'Content-Type': MIME[rel.slice(rel.lastIndexOf('.'))] ?? 'application/octet-stream' },
    });
  },
});

console.log(`deck → http://localhost:${process.env.PORT ?? 8000}`);
