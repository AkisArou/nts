// The public object `node:tty` publishes, from what `src/main.ts` exports.
//
// Node publishes `isatty`, `ReadStream` and `WriteStream`. One is here. The two
// stream classes are not stubbed: `'ReadStream' in tty` answering true against a
// class that cannot be constructed would send a feature-detecting program down a
// branch with no way back.
export function shape(exports) {
  const tty = { ...exports };
  delete tty.default;
  return tty;
}
