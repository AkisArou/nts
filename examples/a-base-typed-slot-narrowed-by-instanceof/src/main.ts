// `if (x instanceof Sub) x.own`, where `x` is declared at the base.
//
// The checker narrows `x` to `Sub` inside the guard and records it on the
// **node**; the value keeps the representation its declaration gave it, which is
// a pointer at the base. So the member was looked up in the base's layout, was
// not there, and the read refused -- with a sentence about the base, which is the
// type the program had already stopped talking about.
//
// Reported by the React lane, whose reconciler models tag-dependent fibre fields
// as a sealed base-class hierarchy. The representation is the reason: a
// base-typed field is an 8-byte `Managed(Object)` where a union of the same
// classes is a 16-byte `Erased`, so this is what lets those fields be
// pointer-sized.
//
// The narrowing is a **downcast**, and it goes through the erased pair because
// the three backends disagree about what one costs: C and LLVM need nothing --
// `put_bases_first` guarantees the base is a prefix -- and the JVM needs a
// `checkcast`, which is what `Unerase` already emits.

abstract class Hook {
  order = 0;
}

class Counting extends Hook {
  count: number;
  constructor(count: number) {
    super();
    this.count = count;
  }
}

class Naming extends Hook {
  label: string;
  constructor(label: string) {
    super();
    this.label = label;
  }
}

/** Two levels down, so the walk up the base chain is more than one step. */
class CountingTwice extends Counting {
  twice: number;
  constructor(count: number) {
    super(count);
    this.twice = count * 2;
  }
}

class Fiber {
  state: Hook | null = null;
}

/** The reported case: one subclass, one field. */
export function throughOneSubclass(n: number): number {
  const fiber = new Fiber();
  fiber.state = new Counting(n);
  const state = fiber.state;
  if (state instanceof Counting) return state.count;
  return -1;
}

/**
 * **The control, and the reason there are two subclasses.** `Counting.count` and
 * `Naming.label` sit at the same index behind `Hook.order`, so a downcast that
 * ignored which class arrived would read one as the other -- and with a `number`
 * against a `string` that is a wrong width, not merely a wrong value. Each guard
 * must reach its own field.
 */
export function eitherSubclass(pick: number): number {
  const fiber = new Fiber();
  fiber.state = pick > 0 ? new Counting(pick) : new Naming("twelve");
  const state = fiber.state;
  if (state instanceof Counting) return state.count;
  if (state instanceof Naming) return state.label.length;
  return -1;
}

/** Two levels, so the base chain is walked rather than compared once. */
export function throughTwoLevels(n: number): number {
  const fiber = new Fiber();
  fiber.state = new CountingTwice(n);
  const state = fiber.state;
  if (state instanceof CountingTwice) return state.twice;
  return -1;
}

/**
 * **The second control**: a member the *base* declares, read through the same
 * narrowed slot. It was never refused and must not start going through the
 * downcast -- a repair that sent every base-typed read through an erase would
 * cost a box on the JVM for a read that never needed one.
 */
export function theBasesOwnMember(n: number): number {
  const fiber = new Fiber();
  const counting = new Counting(n);
  counting.order = n + 1;
  fiber.state = counting;
  const state = fiber.state;
  return state === null ? -1 : state.order;
}
