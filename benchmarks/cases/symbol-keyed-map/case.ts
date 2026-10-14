// Looking a symbol up in a map, which is what an event emitter does.
//
// `EventEmitter._events` is `Map<string | symbol, ...>`, and 318 refusal sites
// in `runtime/node` were waiting on that key type — one property, inherited by
// every class that extends `EventEmitter`. This times the lookup the dispatch
// actually performs.
//
// **A symbol key needs no hashing.** Its identity is its address, so
// `nts_hash_key` mixes a pointer where a string key walks its bytes, and
// `nts_key_eq` compares pointers where a string key compares contents. Neither
// needed a line of symbol-specific code: both already had a reference fallback,
// written to be general and now load-bearing for a type that postdates them.
//
// The reference is what a C++ programmer writes for the same thing — a table
// keyed by an address — rather than a string map, because a string map would be
// measuring the hashing this deliberately does not do.
//
// Four keys and one that was never inserted, so the loop takes the miss path as
// often as the hit path. That is not padding: an emitter asks about events
// nobody is listening for far more often than about ones somebody is.

const a: symbol = Symbol("a");
const b: symbol = Symbol("b");
const c: symbol = Symbol("c");
const d: symbol = Symbol("d");
const absent: symbol = Symbol("absent");

export function work(seed: number): number {
  const step = seed | 0;
  const events = new Map<symbol, number>();
  events.set(a, 1);
  events.set(b, 2);
  events.set(c, 3);
  events.set(d, 4);
  let total = 0;
  for (let i = 0; i < 4096; i++) {
    const which = (i ^ step) & 3;
    const key = which === 0 ? a : which === 1 ? b : which === 2 ? c : d;
    total = (total + (events.get(key) ?? 0)) | 0;
    total = (total + (events.get(absent) ?? 0)) | 0;
  }
  return total;
}

export const seed = 5;
