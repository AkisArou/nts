// The control for `a-method-under-a-computed-key-asked-by-its-own-symbol`: the same
// program with the `async` method under a plain name, so the call carries the
// method's symbol and no closure holds the raising gate off.

class Source {
  cancelled = 0;
  async cancel(reason: number): Promise<void> {
    if (reason > 5) {
      throw new RangeError("too late to cancel");
    }
    this.cancelled = reason;
  }
}

class Pipe {
  constructor(private readonly source: Source) {}
  abort(reason: number): number {
    void this.source.cancel(reason).catch(() => undefined);
    return reason + 1;
  }
}

class Gauge {
  constructor(private readonly reading: number) {}
  read(): number {
    if (this.reading > 4) {
      throw new RangeError("over the scale");
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

/** The computed-key call, through a closure inside a `try`. */
export function aborted(n: number): number {
  const pipe = new Pipe(new Source());
  return attempt(() => pipe.abort(n & 7));
}

/** A throwing method through a closure, which compiles only where the gate is on. */
export function read(n: number): number {
  const gauge = new Gauge(n & 7);
  return attempt(() => gauge.read());
}
