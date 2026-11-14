// Shared headless-browser plumbing: used by tests/probe.test.ts AND tools/shot.ts.
// Raw CDP over WebSocket, zero deps. Obscura only: its /devtools/browser endpoint
// + Target.createTarget + Target.attachToTarget (flatten) - /json/* is unsupported there.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Cdp = {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  evalJs: (expression: string) => Promise<any>;
  close: () => void;
};

function session(ws: WebSocket): Cdp {
  let id = 0;
  let sessionId: string | undefined;
  const pending = new Map<number, (m: any) => void>();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
    }
  };
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise((ok, bad) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? bad(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const evalJs = async (expression: string) => {
    const r = (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })) as any;
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result?.value;
  };
  const close = () => ws.close();
  return (async () => {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as any);
    return { send, evalJs, close };
  })() as unknown as Cdp;
}

async function attach(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, bad) => {
    ws.onopen = ok;
    ws.onerror = () => bad(new Error(`ws: ${wsUrl}`));
  });
  return session(ws);
}

// Fresh tab per probe: every test() picks its own target.
export async function tab(cdpUrl: string): Promise<Cdp> {
  const c = await attach(cdpUrl);
  await c.send("Page.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  return c;
}

// Navigate once per view (hash changes never fire load) and wait for `until`.
// 10s budget - fail fast instead of letting the probes flail.
export async function goto(c: Cdp, url: string, until = "!!window.Reveal && Reveal.isReady()"): Promise<void> {
  await c.send("Page.navigate", { url });
  for (let i = 0; i < 40 && !(await c.evalJs(until)); i++) await sleep(250);
  if (!(await c.evalJs(until))) throw new Error(`page not ready: ${url}`);
}

// PDF paper: obscura does not reliably honor scale/page-break print controls -
// export at the native 16:9 canvas (paper = 1280/96 x 720/96 inches, margins 0).
export const printParams = {
  preferCSSPageSize: false,
  printBackground: true,
  paperWidth: 1280 / 96 + 0.01,
  paperHeight: 720 / 96 + 0.01,
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
};

// First free TCP port (bind :0, read, close). Tiny race - startObscura retries.
function freePort(): number {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const p = s.port;
  s.stop(true);
  return p;
}

// Spawn obscura on an ephemeral port; `--ready-file` avoids ws polling.
// Retries on a fresh free port when the :0-bind vs obscura-bind race loses.
// Returns the CDP url and a stop() that kills it and removes its temp dir.
// (Bun.which, not the shell's PATH lookup: obscura may be on bun's PATH only.)
export async function startObscura(): Promise<{ cdpUrl: string; stop: () => Promise<void> }> {
  if (!Bun.which("obscura"))
    throw new Error("obscura not found on $PATH - the suite runs its own obscura headless browser (see AGENTS.md)");
  for (let attempt = 1; ; attempt++) {
    const port = freePort();
    const dir = mkdtempSync(join(tmpdir(), "deckk-obscura-"));
    const proc = Bun.spawn(
      ["obscura", "serve", "-p", String(port), "--allow-private-network", "--ready-file", join(dir, "ready"), "--quiet"],
      { stdout: "ignore", stderr: "inherit" },
    );
    for (let i = 0; i < 50 && !existsSync(join(dir, "ready")); i++) {
      if (proc.exitCode !== null) break; // crashed (port conflict, bad flag...)
      await sleep(100);
    }
    if (existsSync(join(dir, "ready"))) {
      const stop = async () => {
        proc.kill();
        for (let i = 0; i < 10 && proc.exitCode === null; i++) await sleep(200);
        if (proc.exitCode === null) proc.kill("SIGKILL");
        rmSync(dir, { recursive: true, force: true });
      };
      return { cdpUrl: `ws://127.0.0.1:${port}/devtools/browser`, stop };
    }
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
    if (attempt >= 3) throw new Error(`obscura would not start - last tried ephemeral port ${port}`);
  }
}
