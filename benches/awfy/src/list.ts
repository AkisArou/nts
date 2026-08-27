// Ported from `benchmarks/JavaScript/list.js`.

import { Benchmark } from "./benchmark.ts";

class Element {
  val: number;
  next: Element | null;

  constructor(v: number) {
    this.val = v;
    this.next = null;
  }

  length(): number {
    if (this.next === null) {
      return 1;
    }
    return 1 + this.next.length();
  }
}

export class List extends Benchmark {
  override benchmark(): number {
    const result = this.tail(this.makeList(15), this.makeList(10), this.makeList(6));
    // `tail` returns `z`, which the algorithm guarantees is a list rather than
    // the empty one. The original is untyped and says so by indexing it.
    return result!.length();
  }

  makeList(length: number): Element | null {
    if (length === 0) {
      return null;
    }
    const e = new Element(length);
    e.next = this.makeList(length - 1);
    return e;
  }

  isShorterThan(x: Element | null, y: Element | null): boolean {
    let xTail = x;
    let yTail = y;

    while (yTail !== null) {
      if (xTail === null) { return true; }
      xTail = xTail.next;
      yTail = yTail.next;
    }
    return false;
  }

  tail(x: Element | null, y: Element | null, z: Element | null): Element | null {
    if (this.isShorterThan(y, x)) {
      return this.tail(
        this.tail(x!.next, y, z),
        this.tail(y!.next, z, x),
        this.tail(z!.next, x, y)
      );
    }
    return z;
  }

  override verifyResult(result: number): boolean {
    return 10 === result;
  }
}
