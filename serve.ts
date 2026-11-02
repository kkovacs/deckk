#!/usr/bin/env bun
// Minimal static file server for the deck - bun stdlib only, zero deps.
// Why bun: one binary, no package.json; run directly (`./serve.ts`) or `bun run serve.ts`.
const root = new URL('.', import.meta.url).pathname;

// Loopback by default so the deck never faces the LAN; probes opt out via HOST=0.0.0.0
// (obscura with --allow-private-network reaches loopback fine; 0.0.0.0 is only
// needed for a browser running on another machine).
const hostname = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8000);

const server = Bun.serve({
  hostname,
  port,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    // "/" => template.html; everything else resolved under root; no traversal
    // cleanup needed (Bun.file rejects paths outside cwd patterns - XXX: revisit if deck is exposed publicly)
    const rel = path === '/' ? 'template.html' : path.slice(1);
    const file = Bun.file(root + rel);
    if (!(await file.exists())) return new Response('404', { status: 404 });
    return new Response(file);
  },
});

console.log(`deck => listening on ${hostname}:${server.port}`);
