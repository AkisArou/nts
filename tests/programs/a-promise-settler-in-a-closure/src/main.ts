// `resolve` and `reject` reached from a closure inside the executor, which is
// how nearly every promise in this corpus is settled:
//
//     new Promise((resolve, reject) => {
//       const done = (e: Error | null): void => {
//         if (e !== null) { reject(e); return; }
//         resolve(v);
//       };
//       lookupService(host, done);        // `done` runs later
//     });
//
// `runtime/node/dns/src/main.ts:406` is that shape verbatim. It refused, and
// the row was **41 of the 48 sites** wearing a message about a different
// program: ``reject`, captured above its own declaration, where it has no
// value yet`. `reject` is a parameter of the executor arrow, declared as
// ordinarily as any parameter.
//
// # Why there was nothing to capture
//
// `Settler`'s doc says it: the executor runs synchronously, so its body is
// lowered at the construction site and `resolve`/`reject` "are not values at
// all" -- a call to one is the settle it stands for. Nothing goes into
// `bindings`, so the capture loop missed and fell through to a refusal about
// use-before-declaration.
//
// # What the closure captures instead
//
// The **promise**. That is a value, held right there by the executor being
// lowered inline, and the body re-derives the settle from it -- so
// `lower_settler_call` works inside the closure unchanged, which is the whole
// reason the field holds a promise rather than anything cleverer.
//
// The consequence is that the field's type and the name's type differ: the
// field is a `Promise<T>` and the source name is a `(value: T) => void`. Both
// sides of a closure layout are built by different builders and merged, so
// each has to read the field at the promise type -- which is what
// `Capture::settles` is for, and why it is decided in `collect_closures`
// rather than while lowering: the closure table is built once and *cloned*
// into each builder, so a mark made later would never arrive.
//
// # Measured
//
// The row goes **41 sites to 0**, and `runtime/node` from 1,495 refusal sites
// to 1,459. Cascades rise, which is the expected shape.
//
// # What still refuses, and has its own fixture
//
// A settler used as a *value* rather than called -- `promise.then(resolve,
// reject)`, `this.#callback = resolve`, `enqueue({ resolve, reject })` -- is a
// different feature: it needs a real function object, where this needs only
// the promise. `blockers/a-promise-settler-stored-as-a-value` is that arm, and
// the corpus writes it about 40 times, so it is worth knowing it is not
// covered here.

export async function resolvedThroughAClosure(n: number): Promise<number> {
  return await new Promise<number>((resolve) => {
    const done = (): void => {
      resolve(n * 2);
    };
    done();
  });
}

export async function rejectedThroughAClosure(n: number): Promise<number> {
  try {
    return await new Promise<number>((resolve, reject) => {
      const done = (): void => {
        reject(new Error("bad"));
      };
      done();
    });
  } catch {
    return n - 1;
  }
}

// Both paths out of one closure, which is the shape the corpus writes: a
// callback that either fails or answers.
export async function eitherWay(n: number): Promise<number> {
  try {
    return await new Promise<number>((resolve, reject) => {
      const done = (): void => {
        if (n < 0) {
          reject(new Error("neg"));
          return;
        }
        resolve(n + 1);
      };
      done();
    });
  } catch {
    return -1;
  }
}

// The closure captures an ordinary local *and* a settler, so the two kinds of
// capture share one layout and have to agree about their field offsets.
export async function alongsideAnOrdinaryCapture(n: number): Promise<number> {
  const bump = n + 10;
  return await new Promise<number>((resolve) => {
    const done = (): void => {
      resolve(bump);
    };
    done();
  });
}

// The direct call, which never refused and must keep its fast path: no closure
// is allocated for it and the settle is emitted where the call is.
export async function directStillWorks(n: number): Promise<number> {
  return await new Promise<number>((resolve) => {
    resolve(n + 3);
  });
}
