// Minimal static file server for the deck - bun stdlib only, zero deps.
// Why bun: one binary, no package.json, `bun run serve.ts`.
const root = new URL('.', import.meta.url).pathname;

// Loopback by default so the deck never faces the LAN; probes opt out via HOST=0.0.0.0
// (docker headless-shell reaches us through host.docker.internal, which is not loopback).
const hostname = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8000);

const server = Bun.serve({
  hostname,
  port,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    // "/" => index.html; everything else resolved under root; no traversal cleanup needed
    // (Bun.file rejects paths outside cwd patterns - XXX: revisit if deck is exposed publicly)
    const rel = path === '/' ? 'index.html' : path.slice(1);
    const file = Bun.file(root + rel);
    if (!(await file.exists())) return new Response('404', { status: 404 });
    return new Response(file);
  },
});

console.log(`deck => listening on ${hostname}:${server.port}`);
