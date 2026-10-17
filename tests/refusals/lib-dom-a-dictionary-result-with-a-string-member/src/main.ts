// expect: an opaque C pointer converted to a different representation is not supported by this lowering yet
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md):
// a member answering a dictionary -- `ctx.getContextAttributes()`
// answering CanvasRenderingContext2DSettings -- binds as a foreign
// function returning the dictionary's C struct by value (src/settings.
// d.ts), and its boolean and number members read as plainly as a
// record's do. A string or enum member is a `StringView` field, which
// a program writing the struct fills with its own string lent for the
// call; read back from an answered record there is no copy into a
// program string -- comparing it emits a pointer comparison against
// the interned literal, which no host filling Blink's text can satisfy
// (the scalar string result crosses because the compiler copies the
// lent view at the call), and taking it as a string value refuses.
// Found 2026-10-17 by the Chromium lane binding dictionary results.
//
// Control, one difference -- the same record's boolean member read
// from the same stored result -- emits the call (the first lines of
// go()).

export function go(): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx === null) return "no";
  const s = ctx.getContextAttributes();
  const plain = s.desynchronized;
  const space = s.colorSpace === undefined ? "u" : s.colorSpace;
  return "" + plain + "," + space;
}
