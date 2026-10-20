// run: build
//
// **Stops by name, where it answered wrong.** A string record's entry the
// checker calls a `number` is `undefined` where its key is missing, and
// `rec[k] + 1` is then `NaN` in node. The entry was unerased to a number
// whatever it held: C, LLVM and the JVM read the payload `undefined` carries,
// 0, and answered 1; Wasm stopped, in its unerase's own words.
//
// Now every backend checks the entry is the number its type says before
// reading it as one, where its consumer does more than ask whether it is
// there -- arithmetic here, a store or an argument the same -- and a missing
// key stops: `refused at run time: an erased value read as a number, which it
// is not`. A consumer that only asks (`??`, `||`, a truthiness test, `typeof`,
// `=== undefined`) takes the erased read and answers from its tag:
// tests/programs/absent-record-keys-asked-whether-present.
//
// What lifts it is carrying the absence past the read -- a binding or a sum
// that holds `undefined` beside a number -- which is the erased
// representation every such read would pay for.
//
// The control is the first observation: the same read of a key that is
// there, which agrees.
const stock: Record<string, number> = { apples: 3 };

function next(key: string): number {
  return stock[key] + 1;
}

observe("apples", String(next("apples")));
observe("pears", String(next("pears")));
done();
