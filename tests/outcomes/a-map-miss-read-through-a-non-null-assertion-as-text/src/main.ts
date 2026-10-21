// run: build
//
// **Declines by name, where it answered wrong.** `m.get(k)!` only asserts a
// type, so at a missing key it is `undefined`, and `String` of it is
// "undefined" in node. The read was unerased to the number the `!` claimed:
// C, LLVM and the JVM printed the payload beside `undefined`, "0"; Wasm
// stopped. Converting it to a number would print "NaN", a new wrong answer:
// `String` sees the value as it is, not as a number.
//
// Now a claimed read whose consumer would see `undefined` as it is -- an
// argument here, a store or a return the same -- declines on every backend
// where the value is not the number its type says, as an index its `!`
// promised was in range does: `refused: an erased value read as a number,
// which it is not`. Consumers that apply ToNumber or
// ask whether it is there answer exactly:
// tests/programs/a-map-miss-read-through-a-non-null-assertion-as-a-number.
//
// What lifts it is carrying the absence past the read, which is the erased
// representation every such read would pay for.
//
// The control is the first observation: the same read of a key that is
// there, which agrees.
const counts = new Map<string, number>([["a", 1]]);

function text(key: string): string {
  return String(counts.get(key)!);
}

observe("a", text("a"));
observe("missing", text("missing"));
done();
