// The gate's token pool: the server half of token.sh and tokens.mjs, used by
// run.mjs (see "Tokens" there). Kept apart so tokens.test.mjs can drive the
// same code the gate runs.
//
// A token is a TCP connection on 127.0.0.1: the client sends one line,
// `want <step> <pid>`, receives `go` when granted, and holds the token until
// the connection closes. The kernel closes it however the holder ends, so a
// token cannot leak.
import { createServer } from "node:net";

/**
 * `free()`      tokens that may be handed out right now (the caller's budget
 *               minus what everything, these tokens included, holds)
 * `claim(step, { held, used, waitedS })`  how strongly `step` wants the next
 *               one; the highest claim among waiting steps wins
 * `eligible(step)`  false to pass a step over for now (a frontend cap)
 * `known(step)`     whether the name is a step; unknown names pool as "?"
 * `released()`  called after a granted token comes back
 */
export function createTokenPool({ free, claim, eligible = () => true, known = () => true, released = () => {} }) {
  const pool = {
    addr: null,
    held: new Map(), // step -> tokens held now
    peak: new Map(), // step -> most held at once
    used: new Map(), // step -> token-seconds so far
    total: 0,
    waiting: [], // { sock, step, since, granted, gone }
    last: Date.now(),
    server: null,
  };

  pool.account = () => {
    const now = Date.now();
    const dt = (now - pool.last) / 1000;
    pool.last = now;
    for (const [step, n] of pool.held) pool.used.set(step, (pool.used.get(step) ?? 0) + n * dt);
  };

  pool.grant = () => {
    pool.account();
    const now = Date.now();
    while (pool.waiting.length && free() > 0) {
      const oldest = new Map();
      for (const w of pool.waiting) if (!oldest.has(w.step)) oldest.set(w.step, w.since);
      let best = null;
      for (const [step, since] of oldest) {
        if (!eligible(step)) continue;
        const c = claim(step, {
          held: pool.held.get(step) ?? 0,
          used: pool.used.get(step) ?? 0,
          waitedS: (now - since) / 1000,
        });
        if (!best || c > best.c) best = { step, c };
      }
      if (!best) break;
      const w = pool.waiting.splice(pool.waiting.findIndex((x) => x.step === best.step), 1)[0];
      w.granted = true;
      const n = (pool.held.get(w.step) ?? 0) + 1;
      pool.held.set(w.step, n);
      pool.total += 1;
      if (n > (pool.peak.get(w.step) ?? 0)) pool.peak.set(w.step, n);
      w.sock.write("go\n");
    }
  };

  pool.start = () => new Promise((resolve) => {
    const server = createServer((sock) => {
      const w = { sock, step: null, since: Date.now(), granted: false, gone: false };
      let buf = "";
      sock.setEncoding("utf8");
      sock.on("data", (d) => {
        if (w.step !== null) return;
        buf += d;
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        const step = buf.slice(0, nl).split(" ")[1] ?? "?";
        w.step = known(step) ? step : "?";
        w.since = Date.now();
        pool.waiting.push(w);
        pool.grant();
      });
      const gone = () => {
        if (w.gone) return;
        w.gone = true;
        if (w.granted) {
          pool.account();
          pool.held.set(w.step, pool.held.get(w.step) - 1);
          pool.total -= 1;
          released();
          pool.grant();
        } else if (w.step !== null) {
          pool.waiting = pool.waiting.filter((x) => x !== w);
        }
      };
      sock.on("close", gone);
      sock.on("error", gone);
    });
    server.on("error", () => resolve(null));
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      pool.server = server;
      pool.addr = `127.0.0.1:${server.address().port}`;
      resolve(pool.addr);
    });
  });

  pool.close = () => pool.server?.close();
  return pool;
}
