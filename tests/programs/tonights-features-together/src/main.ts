// Combinations of the lowering changes that landed on 2026-09-17 and -18.
//
// Every one of those changes has an example of its own with its controls. What
// nothing asserts is what happens when two of them meet — a static block whose
// body walks an array's `entries()`, a `findLast` over an array whose elements
// were built at their slot, a `super()` into a base whose field is an empty
// array of closures. Each is one line of ordinary TypeScript and each crosses
// two pieces of machinery that were separate a day ago.
//
// **Combinations cannot be covered by fixtures written before the features**,
// which is why this file is not the duplication a consolidated example usually
// is: a sweep of ordinary *single* shapes on 2026-09-17 found nineteen of
// twenty already driven by a named fixture, and none of these ten by anything.
//
// The pieces crossed here:
//
//     a literal built at the slot it is written into   85a96976
//     a `for...of` head that destructures              2bdbdd5f
//     an array walked by its own cursor                07fcde80
//     the backwards walks                              e8b72a17
//     `toReversed`                                     4881e245
//     `sort()` on strings                              d7dfadff
//     `codePointAt` answering `undefined`              f002ef2b
//     a base's initialisers through `super()`          b04afe5e
//     `static { … }`                                   7ae6925e
//     an empty array literal's element type            9c69ce3c
//     a conditional's merge type from its arms         13bf183b
//     a destructured parameter's default               0653a863

class Totals {
  static indexed = 0;

  static {
    const xs = [10, 20, 30];
    for (const [i, v] of xs.entries()) {
      Totals.indexed += i * v;
    }
  }
}

/** A **static block** whose body is a `for...of` over an array's `entries()` —
 *  a block that runs at class definition, walking by a cursor that is also the
 *  first of two bound names. */
export function staticBlockWalkingEntries(n: number): number {
  return Totals.indexed + n * 0;
}

interface Point {
  x: number;
  y?: number;
}

/** A **backwards** walk over an array whose elements were built at the slot's
 *  element type. Neither the walk nor the slot existed a day ago. */
export function findLastOverSlotBuiltElements(n: number): number {
  const ps: Point[] = [{ x: 1 }, { x: n, y: 2 }, { x: 3 }];
  const found = ps.findLast((p) => p.y !== undefined);
  return found === undefined ? -1 : found.x * 10 + (found.y ?? 0);
}

/** A destructured parameter whose **whole** default is an object literal, and
 *  whose members have defaults of their own. */
export function destructuredDefaultOfALiteral(n: number): number {
  return take({ x: n }) * 100 + take();
}

function take({ x, y = 9 }: Point = { x: 7 }): number {
  return x * 10 + y;
}

class Holder {
  items: (() => number)[] = [];
}

class Seeded extends Holder {
  constructor(public seed: number) {
    super();
  }
}

/** `super()` into a base whose only field is an **empty array of closures** —
 *  the base's initialiser has to run, and the array's element type has to be
 *  materialised, or the call below has no layout to dispatch through. */
export function superIntoAnEmptyArrayOfClosures(n: number): number {
  const s = new Seeded(n);
  s.items.push(() => s.seed * 2);
  return s.items[0]!() + s.items.length;
}

/** A backwards *index* search and a default `sort()` over the same array, so
 *  the search runs before the order changes under it. */
export function findLastIndexThenSort(n: number): number {
  const xs = ["b", "a", String(((n % 3) + 3) % 3)];
  const found = xs.findLastIndex((s) => s.length === 1);
  xs.sort();
  return found * 100 + xs[0]!.length * 10 + xs.length;
}

/** `codePointAt` inside a `reduceRight` — an absence that must stay
 *  `undefined`, folded by a loop that walks the other way. */
export function codePointsFromTheRight(s: string): number {
  const indices = [0, 1, 2];
  return indices.reduceRight((total, at) => total + (s.codePointAt(at) ?? 0), 0);
}

/** A **conditional** between two literal shapes, pushed into an array declared
 *  empty: the merge type comes from the arms and the element type from the
 *  annotation, and both had to be true at once. */
export function conditionalPushedIntoAnEmptyArray(n: number): number {
  const ps: Point[] = [];
  ps.push(n > 0 ? { x: n, y: 1 } : { x: 0 });
  return ps[0]!.x * 10 + (ps[0]!.y ?? 7);
}

class Registry {
  static callbacks: (() => number)[] = [];

  static {
    Registry.callbacks.push(() => 5);
    Registry.callbacks.push(() => 6);
  }
}

/** A static block filling an **empty array of closures**, which needs the block
 *  to run at all and the element type to have been materialised. */
export function staticBlockOfClosures(n: number): number {
  return Registry.callbacks[0]!() * 10 + Registry.callbacks[1]!() + n * 0;
}

/** A **rest pattern** in a `for...of` head over an array of arrays — the head
 *  routes to `bind_pattern`, which is decided after the sequence is lowered. */
export function restPatternInAHead(n: number): number {
  const rows: number[][] = [[1, 2, n], [4, 5]];
  let total = 0;
  for (const [head, ...tail] of rows) {
    total += head! * 10 + tail.length;
  }
  return total;
}

/** `toReversed` over an array whose elements are **conditional** literals: a
 *  copy, of values whose merge type came from their arms. */
export function reversedConditionalLiterals(n: number): number {
  const ps: Point[] = [n > 0 ? { x: 1, y: 1 } : { x: 2 }, { x: 3 }];
  const copy = ps.toReversed();
  return copy[0]!.x * 10 + (copy[1]!.y ?? 7);
}
