// A read through an interface-typed receiver runs whichever supplier's getter the
// object has, dispatched at the access family's raising slot -- which holds the
// ordinary getter for a supplier that cannot raise. So only the suppliers that can
// raise need a raising copy. Every supplier was asked for one, so the quiet
// `Plain#level` (which has nothing to copy) cost `levelOf` its copy, and a closure
// calling `levelOf` held the program's raising gate off: `runtime/node/stream`'s
// `writableWebTarget` reads `value.writable` exactly so, where `Duplex`'s getter is
// the quiet supplier.
//
// The control is the same program without the quiet supplier.

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

class Plain implements Leveled {
  constructor(private readonly reading: number) {}
  get level(): number {
    return this.reading;
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
  return n & 8 ? new Plain(n & 7) : new Checked(n & 7);
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
