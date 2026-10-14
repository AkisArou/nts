// `async (a) => …`, which did not work at all.
//
// An `async` function allocates its promise before its body runs, so that every
// `return` has one to settle and the allocation happens once rather than on
// each path out. `lower_closure` never called `begin_async`, so an `async`
// arrow had no promise and the whole construct was the consequence:
//
//     async (a) => a + 1        a value of type Float { bits: 64 } where
//                               Managed(Promise(Float { bits: 64 })) is wanted
//     async (a) => await p      a top-level `await`
//
// The second is the one worth reading twice. `lower_await` refuses when
// `async_result` is `None`, because that is what module scope looks like from
// inside — so an `await` in an async arrow reported a true sentence about a
// different program. **The same two sentences an async generator produced** the
// day before, from the same missing call, in a third place: `lower_function`
// had it, `lower_method_of` had it, and `lower_closure` did not.
//
// # How it was found, which was from the far end
//
// The JVM lane reported four closures stored where a signature layout was
// declared — `Closure754` into `Fn2029_2043__25` — and pointed at
// `relate_closures_to_signatures`, which is the function whose job that is.
// That function is innocent. An async arrow's `call` answered `f64` where the
// declared signature said `Promise<f64>`, so the two signatures did not match,
// so no layout claimed the closure and it got no base. The backend then
// reported the missing base, which is the last link of the chain and the only
// one visible from there.
//
// My own probes did not reproduce it. Three of them — a named type alias, an
// inline signature, an optional parameter — all passed, because none of them
// was `async`. The reproduction came from reading the corpus site rather than
// from imagining one: `stream/src/iter/consumers.ts`' `tap`, which returns an
// async arrow into an inline signature.

/** An expression body: the expression is what the promise settles with. */
export async function expressionBody(n: number): Promise<number> {
  const f = async (a: number): Promise<number> => a + 1;
  return await f(n & 7);
}

/** A block body with an explicit `return`. */
export async function blockBody(n: number): Promise<number> {
  const f = async (a: number): Promise<number> => {
    return a + 1;
  };
  return await f(n & 7);
}

/** An `await` **inside** the arrow, which reported `a top-level await`. */
export async function awaitsInside(n: number): Promise<number> {
  const f = async (a: number): Promise<number> => {
    const doubled = await Promise.resolve(a * 2);
    return doubled + 1;
  };
  return await f(n & 7);
}

/**
 * Falling off the end, which resolves with `undefined` exactly as `return;`
 * does — so the two are one path rather than the second being a special case.
 */
export async function fallsOffTheEnd(n: number): Promise<number> {
  let seen = 0;
  const f = async (a: number): Promise<void> => {
    seen = a + 1;
  };
  await f(n & 7);
  return seen;
}

/** Two paths out, one of them early. */
export async function twoReturns(n: number): Promise<number> {
  const f = async (a: number): Promise<number> => {
    if (a > 3) return 100;
    return a;
  };
  return await f(n & 7);
}

/**
 * The corpus shape: an async arrow **returned** into an inline signature with
 * an optional parameter. `stream`'s `tap` is this, and it is the site that made
 * the JVM report a closure with no base.
 */
export function returnedIntoASignature(bias: number): (
  a: number,
  b?: number,
) => Promise<number> {
  return async (a, b): Promise<number> => {
    return a + (b ?? 0) + bias;
  };
}

export async function viaReturnedSignature(n: number): Promise<number> {
  return await returnedIntoASignature(n & 3)(n & 7, 2);
}

/** An async arrow **captured into a field**, called through it. */
class Holder {
  op: (a: number) => Promise<number>;
  constructor(f: (a: number) => Promise<number>) {
    this.op = f;
  }
}

export async function storedInAField(n: number): Promise<number> {
  const bias = n & 3;
  const h = new Holder(async (a) => await Promise.resolve(a * 2 + bias));
  return await h.op(n & 7);
}

/** Control: the synchronous arrow, which always worked. */
export function syncArrow(n: number): number {
  const f = (a: number): number => a + 1;
  return f(n & 7);
}
