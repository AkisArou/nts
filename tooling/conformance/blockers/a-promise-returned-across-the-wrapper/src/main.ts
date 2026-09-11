// expect: emit-c --napi -> no wrapper for resolvesAnObject: returns Promise<an object>
// control: exports.resolvesAScalar instanceof Function
//
// An exported function returning a promise. The program builds it; the Node-API
// wrapper cannot carry it outward.
//
// # Why this is a separate blocker from the other promise ones
//
// `blockers/a-promise-that-settles-from-a-callback` is about *constructing* a
// promise in TypeScript, and this is about *exporting* one. They are opposite
// sides of the same boundary and nothing links them:
//
//   the program can build a promise         `zlib.c` returns `NtsPromise *` from
//                                           `nts_zlib_write`, declared in
//                                           TypeScript as `Promise<Uint8Array>`,
//                                           and `zlib/src/main.ts:436` awaits it
//   the wrapper cannot carry one out        this fixture
//
// I got that backwards twice in one day -- first concluding promises did not
// exist because TypeScript could not make one, then concluding they did because C
// could. A binding is C to compiled C and never crosses; an export has to reach
// JavaScript. The two boundaries have different rules and neither implies the
// other.
//
// # What it costs
//
// Every `promises` namespace node publishes. `fs` declines sixteen members of
// `fs.promises` and the addon has `typeof exports.promises === "undefined"`;
// `dns.promises` is declined outright. `fs.promises` alone is around sixty names.
//
// It is also the single thing between `dns`'s compiled lane and not being hollow:
// `test-dns-promises-exists.js` is the one file that could pass there, and it
// needs `dns/promises` to exist as an object whose members are these functions.
//
// # Two arities, because the messages differ and only one is the general case
//
// `resolvesAScalar` returns `Promise<number>` and `resolvesAnObject` returns
// `Promise<{...}>`. The expectation names the object one because that is the
// shape node's `promises` APIs actually have -- `dnsPromises.lookup` resolves to
// `{ address, family }`. The scalar is here so a future reader can see whether
// the two ever diverge; today `returns Promise<void>` is declined 24 times across
// the profile, so scalars do not cross either.

export interface Resolved {
  value: number;
  label: string;
}

export function resolvesAScalar(value: number): Promise<number> {
  return Promise.resolve(value);
}

export function resolvesAnObject(value: number): Promise<Resolved> {
  return Promise.resolve({ value, label: "resolved" });
}
