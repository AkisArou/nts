// The node side of tooling/gate/token.sh: `withToken(fn)` runs `fn` holding
// one of the gate's tokens -- a TCP connection to run.mjs, open while `fn`
// runs and closed after (or by the kernel, however this process ends).
//
// A tool's worker pool calls it around each process it spawns for the work, so
// the gate's whole run holds at most its budget of such processes, whichever
// steps they belong to. Outside the gate (no NTS_GATE_TOKENS) `fn` simply
// runs; inside one, a runner that cannot be reached is an error (below).
//
// **What this process spawns does not ask for tokens**: importing this module
// sets NTS_GATE_TOKEN_HELD=1 in this process's environment, which every child
// built from it inherits. The tool asks for one around each process it runs;
// a child asking again while every token is held by such tools would deadlock
// the run.
//
// A runner that is gone -- unreachable, or closing the connection without
// `go` -- rejects: inside a gate that is the runner having died, and running
// untokened would start every waiting worker at once (see token.sh).
import { connect } from "node:net";

const WHERE = process.env.NTS_GATE_TOKENS ?? "";
const STEP = process.env.NTS_GATE_STEP ?? "?";
const ENABLED = WHERE !== "" && !process.env.NTS_GATE_TOKEN_HELD;
process.env.NTS_GATE_TOKEN_HELD = "1";

function acquire() {
  return new Promise((resolve, reject) => {
    const i = WHERE.lastIndexOf(":");
    const sock = connect({ host: WHERE.slice(0, i), port: Number(WHERE.slice(i + 1)) });
    let settled = false;
    let buf = "";
    const fail = (why) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(new Error(`tokens.mjs: the gate runner at ${WHERE} ${why}`));
    };
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(`want ${STEP} ${process.pid}\n`));
    sock.on("data", (d) => {
      buf += d;
      if (settled || !buf.includes("\n")) return;
      if (buf.split("\n")[0] !== "go") return fail(`answered ${JSON.stringify(buf.split("\n")[0])}`);
      settled = true;
      resolve(sock);
    });
    sock.on("error", (e) => fail(`cannot be reached (${e.code ?? e.message})`));
    sock.on("close", () => fail("went away before granting a token"));
  });
}

export async function withToken(fn) {
  if (!ENABLED) return fn();
  const sock = await acquire();
  try {
    return await fn();
  } finally {
    sock.destroy();
  }
}

export const tokensEnabled = ENABLED;
