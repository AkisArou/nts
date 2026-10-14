// Are We Fast Yet's List, transcribed to AssemblyScript.
import { Benchmark } from "./awfy";

class Element {
  val: i32;
  next: Element | null = null;

  constructor(v: i32) {
    this.val = v;
  }

  length(): i32 {
    const next = this.next;
    if (next === null) {
      return 1;
    }
    return 1 + next.length();
  }
}

class List extends Benchmark {
  benchmark(): f64 {
    const result = this.tail(this.makeList(15), this.makeList(10), this.makeList(6));
    return result!.length();
  }

  makeList(length: i32): Element | null {
    if (length == 0) {
      return null;
    }
    const e = new Element(length);
    e.next = this.makeList(length - 1);
    return e;
  }

  isShorterThan(x: Element | null, y: Element | null): bool {
    let xTail = x;
    let yTail = y;
    while (yTail !== null) {
      if (xTail === null) {
        return true;
      }
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
        this.tail(z!.next, x, y),
      );
    }
    return z;
  }

  verifyResult(result: f64): bool {
    return result == 10;
  }
}

export function work(iterations: i32): i32 {
  return new List().innerBenchmarkLoop(iterations) ? 1 : 0;
}
