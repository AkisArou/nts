// The gate's token pool: the server half of token.sh and tokens.mjs, used by
// run.mjs (see "Tokens" there). Kept apart so tokens.test.mjs can drive the
// same code the gate runs.
//
// A token is a TCP connection on 127.0.0.1: the client sends one line,
// `want <step> <pid>`, receives `go` when granted, and holds the token until
// the connection closes. The kernel closes it however the holder ends, so a
// token cannot leak.
//
// A request may name its own size, `want <step> <pid> bytes:<n>`: the memory
// its case was measured to hold. The runner then grants it when that size
// fits and counts it at that size while it is held; a request without one is
// its step's unit, as every request was before sizes. A size that is not a
// positive whole number of bytes is refused: the connection closes without
// `go`, which the client reports as the runner going away.
import { createServer } from "node:net";

/**
 * `free()`      tokens that may be handed out right now (the caller's budget
 *               minus what everything, these tokens included, holds)
 * `claim(step, { held, used, waitedS })`  how strongly `step` wants the next
 *               one; the highest claim among waiting steps wins
 * `eligible(step, bytes)`  false to pass a request over for now (a frontend
 *               cap, or memory): `bytes` is its size, undefined for the
 *               step's unit. Asked once per step and size in each choice.
 * `answering(step, request)`  a promise to settle before a sized token's `go`
 *               (its step's limits raised to hold it), or nothing to answer
 *               at once
 * `known(step)`     whether the name is a step; unknown names pool as "?"
 * `released()`  called after a granted token comes back
 */
export function createTokenPool({ free, claim, eligible = () => true, answering = () => null, known = () => true, released = () => {}, observe = () => {}, prepare = () => {}, attach = async () => {}, completed = () => {} }) {
  const pool = {
    addr: null,
    held: new Map(), // step -> tokens held now
    sized: new Map(), // step -> { count, bytes } of the sized tokens it holds now
    peak: new Map(), // step -> most held at once
    used: new Map(), // step -> token-seconds so far
    total: 0,
    waiting: [], // { sock, step, since, granted, gone, bytes }
    active:new Set(),
    last: Date.now(),
    server: null,
  };

  // A broken observer must not change token grants or command status.
  const trace = (event, w) => {
    try { observe({ event, request: w?.id, step: w?.step, pid: w?.pid, context: w?.context, bytes: w?.bytes }); } catch {}
  };
  let requests = 0;

  pool.account = () => {
    // Live leases change their charge while work runs. The same sized-token
    // totals feed both eligibility and the runner's reservation accounting.
    for(const w of [...pool.waiting,...pool.active])if(w.memory){w.memory.sample();w.bytes=w.memory.bytes;}
    pool.sized.clear();
    for(const w of pool.active)if(w.bytes!==undefined){const row=pool.sized.get(w.step)??{count:0,bytes:0};pool.sized.set(w.step,{count:row.count+1,bytes:row.bytes+w.bytes});}
    const now = Date.now();
    const dt = (now - pool.last) / 1000;
    pool.last = now;
    for (const [step, n] of pool.held) pool.used.set(step, (pool.used.get(step) ?? 0) + n * dt);
  };

  // Each step's first waiting request that may be granted now, in the order
  // they came: a sized one that fits goes before an older one that does not,
  // and requests of one size are asked about once, so a step whose requests
  // are all of its unit is asked about once, by its oldest.
  const candidates = () => {
    const oldest = new Map(), chosen = new Map(), asked = new Map();
    for (const w of pool.waiting) {
      if (!oldest.has(w.step)) oldest.set(w.step, w.since);
      if (chosen.has(w.step)) continue;
      const key = `${w.step}\0${w.bytes ?? ""}`;
      if (!asked.has(key)) asked.set(key, eligible(w.step, w.bytes,w));
      if (asked.get(key)) chosen.set(w.step, w);
    }
    return { oldest, chosen };
  };

  pool.grant = () => {
    pool.account();
    const now = Date.now();
    while (pool.waiting.length && free() > 0) {
      const { oldest, chosen } = candidates();
      let best = null;
      for (const [step, w] of chosen) {
        const c = claim(step, {
          held: pool.held.get(step) ?? 0,
          used: pool.used.get(step) ?? 0,
          waitedS: (now - oldest.get(step)) / 1000,
        });
        if (!best || c > best.c) best = { w, c };
      }
      if (!best) break;
      const w = best.w;
      pool.waiting.splice(pool.waiting.indexOf(w), 1);
      trace("token.grant", w);
      w.granted = true;
      pool.active.add(w);
      const n = (pool.held.get(w.step) ?? 0) + 1;
      pool.held.set(w.step, n);
      if (w.bytes !== undefined) {
        const s = pool.sized.get(w.step) ?? { count: 0, bytes: 0 };
        pool.sized.set(w.step, { count: s.count + 1, bytes: s.bytes + w.bytes });
      }
      pool.total += 1;
      if (n > (pool.peak.get(w.step) ?? 0)) pool.peak.set(w.step, n);
      const ready = w.bytes === undefined ? null : answering(w.step, w);
      if (ready) {
        const go = () => { if (!w.gone) w.sock.write("go\n"); };
        ready.then(go,error=>w.sock.end(`error: ${error.message}\n`));
      } else w.sock.write("go\n");
      trace("pool.change");
    }
  };

  pool.start = () => new Promise((resolve) => {
    const server = createServer((sock) => {
      const w = { sock, id: ++requests, step: null, pid: null, context: null, since: Date.now(), granted: false, gone: false, bytes: undefined };
      let buf = "";
      sock.setEncoding("utf8");
      sock.on("data", (d) => {
        if (w.step !== null) return;
        buf += d;
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        const words = buf.slice(0, nl).split(" ");
        if(words[0]==='attach'){
          w.step='registration';
          const [,id,group,cap,scope]=words;
          const owner=[...pool.active].find(entry=>entry.lease===id);
          if(!owner){sock.end('error: case lease has ended\n');return;}
          Promise.resolve().then(()=>attach(owner,{group,cap:Number(cap),scope})).then(()=>sock.end('ready\n'),error=>sock.end(`error: ${error.message}\n`));
          return;
        }
        if(words[0]!=='want'){sock.destroy();return;}
        const step = words[1] ?? "?";
        w.pid = Number(words[2]);
        let rest = words.slice(3);
        if (rest[0]?.startsWith("bytes:")) {
          const bytes = Number(rest[0].slice(6));
          if (!/^bytes:[1-9][0-9]*$/.test(rest[0]) || !Number.isSafeInteger(bytes)) { sock.destroy(); return; }
          w.bytes = bytes;
          rest = rest.slice(1);
        }
        if(rest[0]?.startsWith('lease:')){
          w.lease=rest[0].slice(6);
          if(!/^[-a-zA-Z0-9]{1,64}$/.test(w.lease)){sock.destroy();return;}
          rest=rest.slice(1);
        }
        w.context = rest.join(" ");
        w.step = known(step) ? step : "?";
        w.since = Date.now();
        try{prepare(w);if(w.memory)w.bytes=w.memory.bytes;}
        catch(error){sock.end(`error: ${error.message}\n`);return;}
        pool.waiting.push(w);
        trace("token.request", w);
        pool.grant();
        trace("pool.change");
      });
      const gone = () => {
        if (w.gone) return;
        w.gone = true;
        trace(w.granted ? "token.release" : "token.cancel", w);
        if (w.granted) {
          pool.account();
          pool.active.delete(w);
          completed(w);
          pool.held.set(w.step, pool.held.get(w.step) - 1);
          if (w.bytes !== undefined) {
            const s = pool.sized.get(w.step);
            pool.sized.set(w.step, { count: s.count - 1, bytes: s.bytes - w.bytes });
          }
          pool.total -= 1;
          released();
          pool.grant();
          trace("pool.change");
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
