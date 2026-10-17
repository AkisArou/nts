// expect: emit-c --rc -> NTS2006 native local address escapes
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md):
// a member answering a dictionary -- `ctx.getContextAttributes()`
// answering CanvasRenderingContext2DSettings -- binds as a foreign
// function returning the dictionary's C struct by value (src/settings.
// d.ts). A member whose presence the program must be told -- `alpha`,
// whose IDL default is true, so an absent one reads `undefined` where
// a present false does not -- is a c:types `Given` field of that
// struct, as it is for a dictionary argument. Reading it from the
// answered record escapes the native local the record was answered
// into, stored (here) or chained inline alike. Found 2026-10-17 by
// the Chromium lane binding dictionary results.
//
// Control, one difference -- the same record's plain boolean member
// read from the same stored result -- emits the call (the first lines
// of go()).

export function go(): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx === null) return "no";
  const s = ctx.getContextAttributes();
  const plain = s.desynchronized;
  const a = s.alpha === undefined ? "u" : s.alpha ? "t" : "f";
  return "" + plain + "," + a;
}
