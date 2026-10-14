// The same accumulator, fed by a value that has to be made first.
//
// `string-append` appends a literal, which costs nothing to produce. This is
// what a decoder actually writes -- `out += String.fromCharCode(c)` -- and it
// has a second allocation on the right of every `+`: a string one code unit
// long, handed to the append and dead on the next line.

export function work(n: number): number {
  let out = "";
  for (let i = 0; i < 16 + n; i = i + 1) {
    out = out + String.fromCharCode(97 + (i % 26));
  }
  return out.length;
}
