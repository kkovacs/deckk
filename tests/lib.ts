// Shared plumbing for the probe suites): raw CDP over WebSocket, zero deps.
// Obscura only (its bundled headless browser): attach to /devtools/browser,
// then Target.createTarget + Target.attachToTarget with flatten - the /json/*
// HTTP endpoints are intentionally unsupported, so never bother with them.
// Serve the deck: bun serve.ts   -   browser: obscura serve --allow-private-network
export const DEV = process.env.CDP ?? "ws://127.0.0.1:9222";
export const BASE = process.env.BASE ?? "http://127.0.0.1:8000";

// Expected deck shape - keep in sync with template.html (and AGENTS.md) when
// sections change.
export const SLIDES_TOTAL = 43; // ~32 showcase + 11 element-audit
export const GROUPS = 7; // front + 4 sections + thank-you + element-audit
export const AUDIT_SLIDES = 11; // slides in the element-audit stack (= GROUPS last)

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
  const cdp = () => ({ send, evalJs, close });
  return (async () => {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as any);
    return cdp();
  })() as unknown as Cdp;
}

// PDF paper: obscura does not reliably honor scale/page-break print controls -
// export at the native 16:9 canvas (paper = 1280/96 x 720/96 inches, margins 0).
export const printParams = {
  preferCSSPageSize: false,
  printBackground: true,
  paperWidth: (1280 / 96) + 0.01,
  paperHeight: (720 / 96) + 0.01,
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
};

export async function attach(): Promise<Cdp> {
  let ws: WebSocket;
  try {
    ws = new WebSocket(`${DEV}/devtools/browser`);
    await new Promise((ok, bad) => {
      ws.onopen = ok;
      ws.onerror = () => bad(new Error(`ws: ${DEV}/devtools/browser`));
    });
  } catch {
    throw new Error(`obscura not reachable at ${DEV} - start: obscura serve --allow-private-network`);
  }
  return session(ws);
}

// Navigate once per view (hash changes never fire load) and wait for `until`.
// 10s budget - fail fast instead of letting the probes flail.
export async function goto(c: Cdp, url: string, until = "!!window.Reveal && Reveal.isReady()"): Promise<void> {
  await c.send("Page.navigate", { url });
  for (let i = 0; i < 40 && !(await c.evalJs(until)); i++) await sleep(250);
  if (!(await c.evalJs(until))) throw new Error(`page not ready: ${url}`);
}
