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

// Loopback by default so the deck never faces the LAN; probes opt out via HOST=0.0.0.0
// (docker headless-shell reaches us through host.docker.internal, which is not loopback).
const hostname = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8000);

const server = Bun.serve({
  hostname,
  port,
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

// 0.0.0.0 isn't browsable; show localhost for that case only.
const shownHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
console.log(`deck → http://${shownHost}:${server.port}`);
