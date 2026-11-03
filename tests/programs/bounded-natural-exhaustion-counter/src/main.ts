class Source {
  count = 0;
  closed = 0;
  [Symbol.iterator](): Source { return this; }
  next(): { value: number; done: boolean } {
    return { value: ++this.count, done: this.count > 2 };
  }
  return(value: number): { value: number; done: boolean } {
    this.closed = typeof value === "undefined" ? 1 : 9;
    return { value: 0, done: true };
  }
}

class DynamicSource {
  count = 0;
  constructor(readonly limit: number) {}
  [Symbol.iterator](): DynamicSource { return this; }
  next(): { value: number; done: boolean } {
    return { value: ++this.count, done: this.count > this.limit };
  }
}

function naturalExhaustion(n: number): number {
  const source = new Source();
  for (const _value of source) {}
  return source.closed + n;
}

function dynamicCountFor(limit: number): number {
  const source = new DynamicSource(limit);
  for (const _value of source) {}
  return source.count;
}

// Source.next() runs three times: values 1 and 2 are yielded, then count 3
// marks natural exhaustion. Exercise the largest positive and negative
// int32 inputs to the function containing that loop.
export function boundedCount(): string {
  return `${naturalExhaustion(-2147483648)},${naturalExhaustion(-1)},${naturalExhaustion(0)},${naturalExhaustion(1)},${naturalExhaustion(2147483647)}`;
}

// One difference from FixedSource.next: the exhaustion bound is an unchecked
// caller value instead of the literal 2, so it must not inherit the fixed proof.
export function dynamicCount(limit: number): number {
  // Keep generated differential inputs finite and small while retaining a
  // caller-selected threshold the compiler cannot replace with the literal 2.
  return dynamicCountFor((limit >>> 0) % 8);
}
