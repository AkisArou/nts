// A method with type parameters of its own is lowered once per type a call pins,
// as a generic function is, and each copy has its raising form. It had neither:
// lowered once as itself, `Picker#pick<T>` refused ("a function returning the type
// parameter `T`"), no raising copy could be made of it, and a closure calling it
// held the whole program's raising gate off -- so every `try` around a callback in
// the program refused, or (before the gate) lost its `throw`. `runtime/node`'s
// `AsyncResource#runInAsyncScope` did that to thirteen modules.
//
// The other arms are why it matters: a throwing plain method and a throwing getter,
// each reached through a closure inside a `try`, which compile only where the gate
// is on. The control is the same program whose generic method cannot throw.

class Picker {
  pick<T>(values: T[], at: number): T {
    if (at >= values.length) {
      throw new RangeError("past the end");
    }
    return values[at];
  }
  static first<T>(values: T[]): T {
    if (values.length === 0) {
      throw new RangeError("empty");
    }
    return values[0];
  }
}

class Meter {
  constructor(private reading: number) {}
  get level(): number {
    if (this.reading > 4) {
      throw new RangeError("over the scale");
    }
    return this.reading * 10;
  }
  read(): number {
    if (this.reading < 2) {
      throw new RangeError("under the scale");
    }
    return this.reading;
  }
}

const picker = new Picker();
const numbers = [3, 1, 4];
const words = ["a", "bb", "ccc"];

function attempt(run: () => number): number {
  try {
    return run();
  } catch {
    return -1;
  }
}

/** The generic method at two types, each through a closure inside a `try`. */
export function picked(n: number): number {
  const at = n & 3;
  return attempt(() => picker.pick(numbers, at)) * 10 + attempt(() => picker.pick(words, at).length);
}

/** A generic static, called directly inside a `try`. */
export function first(n: number): number {
  try {
    return Picker.first(n & 1 ? numbers : []);
  } catch {
    return -2;
  }
}

/** A throwing getter through a closure. */
export function level(n: number): number {
  const meter = new Meter(n & 7);
  return attempt(() => meter.level);
}

/** A throwing method through a closure. */
export function read(n: number): number {
  const meter = new Meter(n & 7);
  return attempt(() => meter.read());
}
