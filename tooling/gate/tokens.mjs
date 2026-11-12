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
//
// `acquireToken` is the same token for a tool whose unit of work is not one
// function call -- a resident worker's case, answered later on its stdout --
// so it hands back the release instead of running a callback.
import { connect } from "node:net";
import {randomUUID} from 'node:crypto';
import {runWithToken,closeCaseWorkers} from './case-context.ts';
export {runWithToken} from './case-context.ts';

const WHERE = process.env.NTS_GATE_TOKENS ?? "";
const STEP = process.env.NTS_GATE_STEP ?? "?";
const ENABLED = WHERE !== "" && !process.env.NTS_GATE_TOKEN_HELD;
process.env.NTS_GATE_TOKEN_HELD = "1";

/**
 * A client of the token pool at `where` (`host:port`) asking for `step`.
 * `acquire(context, signal, bytes)` resolves to the release of one granted token:
 * calling it closes the connection, and calling it again does nothing.
 * `signal` aborting while the request waits closes the pending connection --
 * the runner counts it cancelled, never granted -- and resolves to `null`.
 * `bytes`, when given, is the memory the case was measured to hold: the
 * runner grants the token when that fits and counts it at that size.
 */
export function tokenClient(where, step) {
  const i = where.lastIndexOf(":");
  const address = { host: where.slice(0, i), port: Number(where.slice(i + 1)) };
  const acquire = (context, signal, bytes) => {
    if (bytes !== undefined && !(Number.isSafeInteger(bytes) && bytes > 0)) return Promise.reject(new Error(`tokens.mjs: a token's size is a positive whole number of bytes, not ${bytes}`));
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const lease=context?.project===undefined?undefined:randomUUID();
      const sock = connect(address);
      let settled = false;
      let buf = "";
      const settle = () => {
        settled = true;
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        if (settled) return;
        settle();
        sock.destroy();
        resolve(null);
      };
      const fail = (why) => {
        if (settled) return;
        settle();
        sock.destroy();
        reject(new Error(`tokens.mjs: the gate runner at ${where} ${why}`));
      };
      signal?.addEventListener("abort", abort, { once: true });
      sock.setEncoding("utf8");
      sock.on("connect", () => {
        const label = context || process.env.NTS_GATE_CASE_COSTS_DIR ? ` json64:${Buffer.from(JSON.stringify(context ?? {})).toString("base64url")}` : "";
        sock.write(`want ${step} ${process.pid}${bytes === undefined ? "" : ` bytes:${bytes}`}${lease?` lease:${lease}`:''}${label}\n`);
      });
      sock.on("data", (d) => {
        buf += d;
        if (settled || !buf.includes("\n")) return;
        if (buf.split("\n")[0] !== "go") return fail(`answered ${JSON.stringify(buf.split("\n")[0])}`);
        settle();
        let held = true;
        const release=() => {
          if (!held) return;
          held = false;
          try{if(lease)closeCaseWorkers({address:where,id:lease});}
          catch(error){sock.destroy();throw error;}
          sock.end('done\n');
        };
        if(lease)release.case={address:where,id:lease};
        resolve(release);
      });
      sock.on("error", (e) => fail(`cannot be reached (${e.code ?? e.message})`));
      sock.on("close", () => fail("went away before granting a token"));
    });
  };
  return { acquire };
}

const gate = ENABLED ? tokenClient(WHERE, STEP) : null;

/**
 * This process's step's token from the gate's pool (`tokenClient`'s
 * `acquire`), of `bytes` when the case's size is known. Outside a gate it
 * resolves at once to a release that does nothing.
 */
export function acquireToken(context, signal, bytes) {
  return gate ? gate.acquire(context, signal, bytes) : Promise.resolve(() => {});
}

export async function withToken(fn, context) {
  if (!ENABLED) return fn();
  const release = await acquireToken(context);
  try {
    return await runWithToken(release,fn);
  } finally {
    release();
  }
}

export const tokensEnabled = ENABLED;
