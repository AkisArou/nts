// expect: `this` outside a method
//
// A default parameter initializer that reads `this`. Node's `buffer` writes
// this and so does much of `lib`:
//
//     override toString(encoding?: string, start = 0, end = this.length): string
//
// The parameter list is lexically outside the body, so `this` there is neither
// the method's receiver by the lowering's reckoning nor a free `this` -- but at
// run time it is the receiver, and TypeScript types it as such.
//
// # Two controls, because the message is shared and the position is not
//
// `this-in-a-static-method` expects the *same text* for a different construct.
// Sharing a message is not sharing a cause, so this fixture carries controls
// that separate the position from the receiver:
//
//     bodyRead()            { return this.length; }   -> lowers
//     fromConst(end = 3)    { return end; }           -> lowers
//     fromThis(end = this.length) { return end; }     -> REFUSED
//
// `bodyRead` says `this` lowers on this class. `fromConst` says a default
// parameter lowers. Only the two together make the third about the pair.
//
// # The entry points are not decoration
//
// Three reductions of this reported **no diagnostic at all** before the entry
// points were added, and every one of them was wrong. With nothing exported
// that reaches the class, the wrapper declines it -- "is exported and is not a
// function this backend can name" -- and lowering never walks the method, so
// the construct under test is never reached and its absence from the output
// reads exactly like a clean bill.
//
// Checked by looking for the method symbols in `program.c` rather than by
// trusting the empty diagnostic list: `bodyRead` and `fromConst` are there,
// `fromThis` is not. A probe that did not run is not a probe that passed.
//
// # What it blocks
//
// `string_decoder` has **zero** refusals in its own source and publishes
// nothing. Its chains end at three constructs in `buffer`, and this is one:
// `buffer/src/main.ts:575:54`, `Buffer#toString`'s `end = this.length`.
//
// Three chain heads is not three fixes -- clearing one has moved the head
// sixteen lines down the same function before -- so this is filed as one of the
// places the chain currently ends, not as a third of the work.

class Plain {
  length: number;
  constructor(n: number) {
    this.length = n;
  }

  bodyRead(): number {
    return this.length;
  }

  fromConst(end = 3): number {
    return end;
  }

  fromThis(end = this.length): number {
    return end;
  }
}

export function callBodyRead(n: number): number {
  return new Plain(n).bodyRead();
}

export function callFromConst(n: number): number {
  return new Plain(n).fromConst();
}

export function callFromThis(n: number): number {
  return new Plain(n).fromThis();
}
