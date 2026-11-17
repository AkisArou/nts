// A call through an element access -- `this.source[kCancel](n)` -- names a method
// under a computed key, and the method's own symbol says whether it can raise.
// The access carries no symbol, so the call read as unresolved: able to raise
// whatever it reached. Here that is an `async` method, which never raises, so the
// function writing the call lost its raising copy to a call it could always
// contain, and a closure calling that function held the whole program's raising
// gate off -- every `try` around a callback refused. `runtime/web-platform`'s
// `PipeState#abort` did that through `this.#source[kStreamCancelInternal](reason)`.
//
// The control is the same program with the method under a plain name.

const kCancel = Symbol("cancel");

class Source {
  cancelled = 0;
  async [kCancel](reason: number): Promise<void> {
    if (reason > 5) {
      throw new RangeError("too late to cancel");
    }
    this.cancelled = reason;
  }
}

class Pipe {
  constructor(private readonly source: Source) {}
  abort(reason: number): number {
    void this.source[kCancel](reason).catch(() => undefined);
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
