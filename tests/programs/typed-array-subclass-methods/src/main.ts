// A class extending a typed array, calling its *own* methods on `this`.
//
// `class Buffer extends Uint8Array` adds no storage, so an instance is an
// `NtsArray` of bytes and nothing else — the representation says how the bytes
// are arranged and nothing about what declared the methods. Resolving a member
// therefore asks the checker what the receiver is.
//
// For `buf.at8(...)` that already worked. For `this.at8(...)` it did not:
// TypeScript gives `this` the *polymorphic this* type, which is a type
// parameter constrained to the class, and the method hierarchy is keyed by the
// class. Asking it about the parameter found nothing, so the call fell through
// to the runtime's array helpers and was refused as "`at8` on a typed array".
//
// 34 of the 56 typed-array refusals in the node profile were exactly that —
// `at8` and `checkInt`, Buffer's own methods, called on its own `this`.

class Bytes extends Uint8Array {
  // Reached through `this`, which is what this example exists for.
  private at8(offset: number): number {
    return this[offset];
  }

  private checkRange(value: number, low: number, high: number): number {
    if (value < low) {
      return low;
    }
    return value > high ? high : value;
  }

  sumFirst(count: number): number {
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += this.at8(i);
    }
    return total;
  }

  clamped(value: number): number {
    return this.checkRange(value, 0, 255);
  }

  // One of its own methods calling another of its own methods, so the
  // resolution has to hold more than one level deep.
  clampedSum(count: number): number {
    return this.checkRange(this.sumFirst(count), 0, 100);
  }
}

function filled(n: number): Bytes {
  const b = new Bytes(4);
  b[0] = n & 0xff;
  b[1] = (n + 1) & 0xff;
  b[2] = (n + 2) & 0xff;
  b[3] = (n + 3) & 0xff;
  return b;
}

export function throughThis(n: number): number {
  return filled(n).sumFirst(4);
}

export function clamping(n: number): number {
  const b = filled(n);
  return b.clamped(n * 10) + b.clamped(-5) * 1000;
}

export function nested(n: number): number {
  return filled(n).clampedSum(4);
}

// The inherited `length` still works and is still the array's, alongside the
// class's own methods.
export function inheritedLength(n: number): number {
  const b = filled(n);
  return b.length * 1000 + b[0] * 10 + b.clamped(300);
}
