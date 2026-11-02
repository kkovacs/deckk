#!/usr/bin/env bun
// Minimal static file server for the deck - bun stdlib only, zero deps.
// Why bun: one binary, no package.json; run directly (`./serve.ts`) or `bun run serve.ts`.
// startServer() is exported so the probe suite (`bun test`) can serve the
// deck itself on an ephemeral port - the tests need no server running.
const root = new URL('.', import.meta.url).pathname;

export function startServer({ hostname = '127.0.0.1', port = 0, dir = root } = {}) {
  return Bun.serve({
    hostname,
    port,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      // "/" => the starter (index.html); the deck lives at /template.html - same
      // URLs any static webserver gives. No traversal cleanup needed
      // (Bun.file rejects paths outside cwd patterns - XXX: revisit if deck is exposed publicly)
      const rel = path === '/' ? 'index.html' : path.slice(1);
      const file = Bun.file(dir + rel);
      if (!(await file.exists())) return new Response('404', { status: 404 });
      return new Response(file);
    },
  });
}

if (import.meta.main) {
  // Loopback by default so the deck never faces the LAN.
  const hostname = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8000);
  const server = startServer({ hostname, port });
  console.log(`deck => listening on ${hostname}:${server.port}`);
}
