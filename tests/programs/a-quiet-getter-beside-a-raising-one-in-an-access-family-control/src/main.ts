// The control for `a-quiet-getter-beside-a-raising-one-in-an-access-family`: the
// same program without the quiet supplier, so every supplier of the family can
// raise and has its copy.

interface Leveled {
  readonly level: number;
}

class Checked implements Leveled {
  constructor(private readonly reading: number) {}
  get level(): number {
    if (this.reading > 4) {
      throw new RangeError("over the scale");
    }
    return this.reading * 10;
  }
}

function levelOf(source: Leveled): number {
  return source.level + 1;
}

class Gauge {
  constructor(private readonly reading: number) {}
  read(): number {
    if (this.reading < 2) {
      throw new RangeError("under the scale");
    }
    return this.reading;
  }
}

function attempt(run: () => number): number {
  try {
    return run();
  } catch {
    return -1;
  }
}

function made(n: number): Leveled {
  return new Checked(n & 7);
}

/** The family read, through a closure inside a `try`. */
export function leveled(n: number): number {
  const source = made(n);
  return attempt(() => levelOf(source));
}

/** A throwing method through a closure, which compiles only where the gate is on. */
export function read(n: number): number {
  const gauge = new Gauge(n & 7);
  return attempt(() => gauge.read());
}
