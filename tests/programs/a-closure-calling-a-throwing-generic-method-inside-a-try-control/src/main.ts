// The control for `a-closure-calling-a-throwing-generic-method-inside-a-try`: the
// same program whose generic methods cannot throw, so no closure holds the raising
// gate off even where generic methods have no copies: `level` and `read` compile
// and agree on a compiler without them, while the fixture's refuse there.

class Picker {
  pick<T>(values: T[], at: number): T {
    return values[at % values.length];
  }
  static first<T>(values: T[]): T {
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
    return Picker.first(n & 1 ? numbers : [5]);
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
