// run: check
// backend: jvm
//
// A string array built by `push`, read at an index that is not an integer.
// JavaScript reads `undefined` there -- `words[1.5]` is no element -- so
// `table[words[...]]` asks the record for the key "undefined", which it does
// not hold, and `lookup` answers -1. The read is an `array.get` at an f64
// index, unchecked because the checker types it `string`. C, LLVM and Wasm
// decline that input at run time ("an index its `!` promised was in range and
// was not"). The JVM read the element the truncated index names, `words[1]`
// for `words[1.5]`, and answered what the record holds for it, 29 cases of
// 29: its wrapper's read at a double index (`NtsArrayL.get(a, double)`)
// tested the range and not integrality. Held since that read tests both, so
// the JVM declines the input as the others do, and the record is the cases
// declined. Found on bench-agree's pool, as record-word-counts' first seed.
//
// The one-change control, `...-control`, reads `words[seed & 3]`, without the
// `+ 0.5`, and agrees.
const words: string[] = [];
for (let i = 0; i < 4; i++) {
  words.push("w" + i);
}
const table: Record<string, number> = { w0: 1, w1: 2, w2: 3, w3: 4 };

export function lookup(seed: number): number {
  return table[words[(seed & 3) + 0.5]] ?? -1;
}
