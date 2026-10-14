// expect: emit-c --napi -> publishes sum
//
// FIXED. This refused until the compiler lane taught the Node-API wrapper to
// carry an array of numbers across the boundary; it is kept as a regression
// guard, because `punycode.ucs2` needs it and `ucs2` is what stood between
// this project and its first passing compiled module.
//
// An array of numbers cannot cross the Node-API boundary inbound. This is what
// `punycode.ucs2.encode` needs, and node's own test-punycode.js calls it six
// times, so it is the whole distance to this project's first passing addon.
//
// Nothing here is refused by the lowering: `nts hir` says "nothing refused".
// The limit is the wrapper's signature, which is why this fixture has to be
// checked with `emit-c --napi` and not with `hir`.
export function sum(codePoints: number[]): number {
  let total = 0;
  for (const c of codePoints) total += c;
  return total;
}
