// A `bigint` is a machine value, and this is the case that says so.
//
// It is `__int128` -- exact to 128 bits rather than arbitrary precision, which
// `typescript.md` argues for and names the one value it cannot spell. What
// follows from that choice is a memory question: a true bignum puts a heap
// allocation into every `readBigUInt64BE` and every hrtime timestamp, and this
// representation puts none anywhere.
//
// So the bigint goes where a value gets charged: a field of an object, a
// parameter, a return, and a loop-carried accumulator.

class Ledger {
  total: bigint;
  step: bigint;
  constructor(step: bigint) {
    this.total = 0n;
    this.step = step;
  }
}

function advance(by: bigint, times: bigint): bigint {
  return by * times + 1n;
}

export function work(n: number): number {
  const ledger = new Ledger(1000000007n);
  let carried = 1n;
  for (let i = 0; i < 16 + n; i = i + 1) {
    carried = advance(ledger.step, carried);
    ledger.total = ledger.total + (carried & 0xffffffffn);
  }
  // One number out, so the harness has something to compare. The conversion
  // itself is the only thing here that could allocate, and it is outside the
  // loop on purpose: what is being measured is the arithmetic.
  return Number(ledger.total & 0xffffn);
}
