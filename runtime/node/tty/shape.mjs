// The public object `node:tty` publishes, from what `src/main.ts` exports.
//
// Node publishes `isatty`, `ReadStream` and `WriteStream`. One is here. The two
// stream classes are not stubbed: `'ReadStream' in tty` answering true against a
// class that cannot be constructed would send a feature-detecting program down a
// branch with no way back.
//
// `isatty` is wrapped here, and the reason is a boundary rather than a taste.
// Node's `isatty` answers `false` for an argument that is not a number at all --
// `'1'`, `{}`, `() => {}`, each asserted in pseudo-tty/test-tty-isatty.js -- and a
// Node-API parameter has no representation for `unknown`, so the compiled lane
// answered `an argument of this type has no representation in the compiled
// runtime` on the first such call. The type test therefore cannot live behind the
// boundary, and this file is the only one that runs on both lanes. Everything that
// remains once the argument is known to be a number is still in `src/main.ts`.
export function shape(exports) {
  const tty = { ...exports };
  delete tty.default;
  const isatty = exports.isatty;
  tty.isatty = (fd) => (typeof fd === "number" ? isatty(fd) : false);
  Object.defineProperty(tty.isatty, "name", { value: "isatty", configurable: true });
  return tty;
}
