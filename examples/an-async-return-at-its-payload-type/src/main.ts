// An `async` function's `return`, built at the promise's **payload type**.
//
//     async function make(n: number): Promise<Opts> { return { x: n }; }
//
// refused with ``an anonymous type` where a `Opts` is wanted`, while the
// identical `return` in a synchronous function lowered. The literal had simply
// not been told what it was.
//
// A `return` has three destinations and they want three different types. A
// **callback** return hands its value to an iteration's accumulator, whose type
// the loop decides and the return cannot see. A **plain** return wants the
// function's own return type. An **`async`** return hands it to a promise, and
// the payload is written on `AsyncResult` for exactly this reason — the field's
// own comment says it is what decides whether settling emits
// `nts_promise_fulfill_number`, `_reference` or `_void`.
//
// When the plain path was taught to lower its value at the declared type, the
// async path was **excluded** rather than given its own answer: the exclusion
// was a guess that the third destination was as unknowable as the callback's,
// and it was one field away. So this is the same fact at a tenth slot, and the
// nine before it are why it was worth looking for.

interface Opts {
  x: number;
  y?: number;
}

/** The shape that refused: a plain literal returned from an `async` function. */
export async function literalPayload(n: number): Promise<number> {
  const got = await makeLiteral(n);
  return got.x * 10 + (got.y ?? 7);
}

async function makeLiteral(n: number): Promise<Opts> {
  return { x: n };
}

/** A **conditional** between two literal shapes, which needs the merge type to
 *  come from the arms *and* the arms to be built at the payload. Two of
 *  tonight's changes meeting. */
export async function conditionalPayload(n: number): Promise<number> {
  const got = await makeConditional(n);
  return got.x * 100 + (got.y ?? 7);
}

async function makeConditional(n: number): Promise<Opts> {
  return n > 0 ? { x: n, y: 1 } : { x: 0 };
}

/** An **array** payload declared empty and filled, so the element type comes
 *  from the annotation and the whole thing from the payload. */
export async function arrayPayload(n: number): Promise<number> {
  const got = await makeArray(n);
  return got.length * 10 + (got[0]?.x ?? 0);
}

async function makeArray(n: number): Promise<Opts[]> {
  const items: Opts[] = [];
  items.push({ x: n });
  return items;
}

/** Two returns on two paths, so the payload is wanted at more than one exit. */
export async function twoExits(n: number): Promise<number> {
  const got = await makeTwoWays(n);
  return got.x * 10 + (got.y ?? 7);
}

async function makeTwoWays(n: number): Promise<Opts> {
  if (n > 0) {
    return { x: n, y: 2 };
  }
  return { x: 0 };
}

/** Control: the same literal returned from a **synchronous** function, which is
 *  the path that already worked and is what made the async one look wrong. */
export function synchronousPayload(n: number): number {
  const got = makeSync(n);
  return got.x * 10 + (got.y ?? 7);
}

function makeSync(n: number): Opts {
  return { x: n };
}

/** Control: an `async` function returning a **number**, which needs no slot and
 *  must be untouched. */
export async function numberPayload(n: number): Promise<number> {
  return (await double(n)) + 1;
}

async function double(n: number): Promise<number> {
  return n * 2;
}

let sink = 0;

/** Control: an `async` function returning **void**, whose payload is `Void` and
 *  which drops the value entirely. */
export async function voidPayload(n: number): Promise<number> {
  sink = 0;
  await record(n);
  return sink;
}

async function record(n: number): Promise<void> {
  sink = n * 3;
}

/** Control: a **callback** return, the destination this deliberately leaves
 *  alone — its type is the iteration's accumulator and not any declaration. */
export function callbackReturn(n: number): number {
  return [1, 2, n].reduce((total, v) => {
    return total + v;
  }, 0);
}
