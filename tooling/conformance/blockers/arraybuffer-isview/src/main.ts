// expect: NTS1001 `ArrayBuffer.isView`, a global member with no definition here
//
// `ArrayBuffer.isView` has no definition in this compiler, and it is the single
// thing standing between `string_decoder`'s own source and having nothing left
// to refuse.
//
// Measured against a binary carrying `AnyView`: `string_decoder` goes from four
// own-source refusals to **one**, and this is the one. All twelve of
// `StringDecoder`'s other methods lower, including `text(buf: anyview)`. `write`
// lowers too and is refused only here, at `main.ts:112`:
//
//     write(buf: ArrayBufferView | string): string {
//       if (typeof buf === "string") return buf;
//       if (!ArrayBuffer.isView(buf)) {                 // <- refused
//         throw new ERR_INVALID_ARG_TYPE(...);
//       }
//
// **The control matters here for a specific reason, and it caught me.** The
// first draft of it narrowed the union and then read `buf.byteLength` off the
// non-string branch. That refuses -- but with a *different* diagnostic, "an
// `unknown` narrowed to Managed(AnyView), which it cannot be read back as" --
// so the control was failing for a reason that had nothing to do with this
// fixture, and had I not read which line it named I would have concluded
// `string_decoder` needed two fixes here rather than one.
//
// It needs one. `string_decoder`'s `write` narrows the union and *does not read
// a property off the view* at that point, so the control now does what the real
// code does and lowers. If it ever refuses, the diagnostic is coming from the
// narrowing and this fixture is about the wrong thing.
//
// **The readback refusal is real and separate**, and it is a follow-on gap in
// `AnyView` rather than in this global: a value narrowed to `AnyView` cannot
// have `.byteLength` read off it. It is not on `string_decoder`'s path and is
// not filed here, because a fixture asserting two diagnostics tells you which
// one you fixed only by accident.
//
// A second control names a global the compiler *does* provide, so the fixture
// cannot be read as "static members of built-ins are unsupported".
//
// `string_decoder` is the shortest path to a second green module: this global,
// plus the export-class arm for `export class StringDecoder`. Its `shape.mjs`
// reads only `exports.StringDecoder`, so `export default { StringDecoder }`
// does not have to publish for node's tests to see the right object -- which
// means the object-valued-export arm is *not* on this module's critical path,
// though it is on `querystring`'s.

// Control: the union narrowed by `typeof`, using only the branch
// `string_decoder` uses. Must lower -- this is what says the subject is about
// one missing global and not about narrowing a union.
export function narrowsWithTypeof(buf: ArrayBufferView | string): number {
  if (typeof buf === "string") {
    return buf.length;
  }
  return 0;
}

// Control: a static member of a built-in that this compiler does provide.
// Must lower, so the fixture is about one missing name and not a category.
export function usesAProvidedStatic(xs: number[]): boolean {
  return Array.isArray(xs);
}

// Subject.
export function usesIsView(buf: ArrayBufferView | string): number {
  if (typeof buf === "string") {
    return buf.length;
  }
  if (!ArrayBuffer.isView(buf)) {
    throw new Error("not a view");
  }
  return 0;
}
