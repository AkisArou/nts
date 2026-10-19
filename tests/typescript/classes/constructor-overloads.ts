/*---
description: Constructor overload signatures are erased; the one implementation sees every call.
features: [ts-class, ts-overloads]
---*/
class Span {
  readonly start: number;
  readonly end: number;
  constructor(length: number);
  constructor(start: number, end: number);
  constructor(a: number, b?: number) {
    this.start = b === undefined ? 0 : a;
    this.end = b === undefined ? a : b;
  }
}
assert.sameValue(new Span(4).end - new Span(4).start, 4);
assert.sameValue(new Span(2, 9).start, 2);
assert.sameValue(Span.length, 2);
