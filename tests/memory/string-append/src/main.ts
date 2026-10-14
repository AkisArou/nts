// An accumulator built one piece at a time, which is what building a string in
// a loop looks like in every language that has one.
//
// `runtime/node/internal/utf8.ts` is this exact shape and is the `node-utf8`
// benchmark: `out += String.fromCharCode(...)`, once per code point, inside the
// decoder's state machine. That row is 3.14x node, the worst on the board.
//
// A `+` on strings today allocates a whole new one and copies both sides, so a
// loop of n appends allocates n times and copies O(n^2) code units. Nothing
// about the *language* requires that: `out` is a local nothing else holds, and
// appending to something nobody else can see is a write, not a rebuild.

export function work(n: number): number {
  let out = "";
  for (let i = 0; i < 16 + n; i = i + 1) {
    out = out + "x";
  }
  return out.length;
}
