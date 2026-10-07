// The node side of tooling/gate/token.sh: `withToken(fn)` runs `fn` holding
// one of the gate's tokens -- a TCP connection to run.mjs, open while `fn`
// runs and closed after (or by the kernel, however this process ends).
//
// A tool's worker pool calls it around each process it spawns for the work, so
// the gate's whole run holds at most its budget of such processes, whichever
// steps they belong to. Outside the gate (no NTS_GATE_TOKENS), or when the
// runner cannot be reached, `fn` simply runs: scheduling is never a verdict.
//
// A process spawned inside `fn` does not inherit the connection (node opens
// sockets close-on-exec), so it must not ask for a token of its own: a holder
// waiting for a second token can deadlock the run. Spawn compilers and
// programs here, never another token-aware tool.
import { connect } from "node:net";

const WHERE = process.env.NTS_GATE_TOKENS ?? "";
const STEP = process.env.NTS_GATE_STEP ?? "?";
const ENABLED = WHERE !== "" && !process.env.NTS_GATE_TOKEN_HELD;

function acquire() {
  return new Promise((resolve) => {
    const i = WHERE.lastIndexOf(":");
    const sock = connect({ host: WHERE.slice(0, i), port: Number(WHERE.slice(i + 1)) });
    let settled = false;
    const done = (s) => { if (!settled) { settled = true; resolve(s); } };
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(`want ${STEP} ${process.pid}\n`));
    sock.on("data", (d) => { if (d.includes("\n")) done(sock); });
    // Unreachable or gone: run untokened rather than fail or hang.
    sock.on("error", () => done(null));
    sock.on("close", () => done(null));
  });
}

export async function withToken(fn) {
  if (!ENABLED) return fn();
  const sock = await acquire();
  try {
    return await fn();
  } finally {
    sock?.destroy();
  }
}

export const tokensEnabled = ENABLED;
