// A slot typed exactly `undefined`, and `return undefined` from a `void`
// function — one refusal, two spellings.
//
// # It cost twelve modules to land, and the price was not where it looked
//
// The field path already maps `Void | Never` to `Erased`, because C has no
// zero-width member. What failed was the **store**: the contextual type at the
// literal is computed from the checker's type independently and comes back
// `Void`, so `value: undefined` refused into a field that was already an
// ordinary erased word. Two halves of one decision, made in two places.
//
// Reading a `Void` contextual type as erased is three characters, and on its
// own it turns **12 of 24 addons** into `refusing to emit code from invalid
// HIR`:
//
//     NotDominated { func: "Closure48#call__resume", value: ValueId(4),
//                    used_in: BlockId(8) }
//
// **It did not introduce that.** The refusal was standing in front of a
// generator-resume path, and removing it was the first thing ever to compile
// one. The bug is in `hir::suspend`: a rejection handler is a block like any
// other and can read any value live before the `await`, and `crossing` spilled
// what was *passed* to the handler without spilling what its body *reads*.
//
// The comment above that code had found the same failure once before and fixed
// the half its own program exercised — it even quotes a `NotDominated` of its
// own. `live_in` of the handler block is the whole set, and it was available
// all along because `crossing` runs on the **unsplit** function, where the
// handler is an ordinary block liveness has already solved.
//
// # No arm here tests the suspend repair, and that is measured
//
// Two candidate arms were written and each was run against a build with the
// repair **reverted**. Both passed. So neither reaches it, and saying that is
// worth more than an arm with a confident comment: the repair's witness is the
// corpus — twelve of twenty-four addons go from invalid HIR to building — and
// `addons` is the guard.
//
// That is the reduction trap from the far side. The usual failure is a probe
// that avoids the observable; this is a probe that reproduces the *description*
// of a failure without reproducing the failure, which reads identically from
// inside and is only distinguishable by running the old compiler.
//
// # What is still refused
//
// The same slot typed `null`, which is a different problem with its own
// measurement: `blockers/a-property-typed-exactly-null`.

type Absent = { kind: "absent"; value: undefined };

/** A property typed exactly `undefined`. */
export function undefinedField(n: number): number {
  const o: Absent = { kind: "absent", value: undefined };
  return o.value === undefined ? (n & 7) + 2 : 0;
}

/** The same refusal, the other spelling. */
function nothing(n: number): void {
  if (n > 0) return undefined;
  return;
}
export function voidReturn(n: number): number {
  nothing(n & 7);
  return (n & 7) + 4;
}

/** The control that always worked: optional rather than required. */
type Optional = { kind: "maybe"; value?: undefined };
export function optionalField(n: number): number {
  const o: Optional = { kind: "maybe" };
  return o.value === undefined ? (n & 7) + 3 : 0;
}

/**
 * An async closure whose rejection path calls a captured closure — and it does
 * **not** reach the suspend bug this change repaired.
 *
 * Stated rather than implied, because two attempts at an arm that would were
 * checked against a build with the repair reverted and **both passed**. The
 * failing function in `runtime/node` is `Closure48#call__resume`, and what
 * distinguishes it is not a shape reproduced here.
 *
 * So the repair's only witness is the corpus: twelve of twenty-four addons go
 * from `refusing to emit code from invalid HIR` to building. `addons` is the
 * guard, not this file. The arm stays because it is a reasonable async
 * rejection path and costs nothing — it just should not be read as the test.
 */
async function failing(n: number): Promise<number> {
  if (n > 3) throw new RangeError("high");
  return n;
}

function runner(
  handler: (extra: number) => number,
): (n: number) => Promise<number> {
  return async (n: number): Promise<number> => {
    try {
      return handler(await failing(n & 7));
    } catch {
      return handler(1);
    }
  };
}

export async function awaitedThenRejected(n: number): Promise<number> {
  const base = (n & 7) * 10;
  const go = runner((extra: number): number => base + extra);
  // Awaited rather than returned: returning it directly is a promise settled
  // with another promise, which is its own refusal and not this arm's subject.
  return await go(n);
}
