// A pattern is the reads it stands for: a field per name for an object, an
// element per position for an array. The initializer is lowered *once*, which
// is what the pattern means -- `const { a, b } = f()` calls `f` a single time.

interface Point {
  x: number;
  y: number;
}

let calls = 0;

function origin(n: number): Point {
  calls = calls + 1;
  return { x: n, y: n * 3 };
}

// Positions have to be distinguishable, or a lowering that read index 0 twice
// would agree with node by accident.
export function byPosition(n: number): number {
  const xs: number[] = [n, n * 7, n * 13];
  const [first, second] = xs;
  return first * 1000 + second;
}

export function byName(n: number): number {
  const p: Point = { x: n, y: n * 7 };
  const { x, y } = p;
  return x * 1000 + y;
}

// The property and the new name differ, and so do the values, so swapping them
// changes the answer.
export function renaming(n: number): number {
  const p: Point = { x: n, y: n * 7 };
  const { x: second, y: first } = p;
  return first * 1000 + second;
}

// `calls` counts, so an initializer lowered twice is visible rather than
// merely wasteful.
export function evaluatesItsInitializerOnce(n: number): number {
  calls = 0;
  const { x, y } = origin(n);
  return calls * 1000000 + x * 1000 + y;
}

// A pattern where a name would go. One parameter, one value, several names.
function distance({ x, y }: Point): number {
  return x * x + y * y;
}

export function throughAParameter(n: number): number {
  return distance({ x: n, y: n + 1 });
}

// A pattern in a loop body, rebound on every iteration.
export function inALoop(n: number): number {
  const xs: number[] = [n, n + 1, n + 2, n + 3];
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const [a, b] = xs;
    total = total + a + b + i;
  }
  return total;
}

interface Wrapper {
  inner: Point;
  scale: number;
}

// A pattern inside a pattern is a read and then the same function one level
// down. The inner names are the ones that get bound; `inner` itself is not.
export function nested(n: number): number {
  const w: Wrapper = { inner: { x: n, y: n * 7 }, scale: n + 1 };
  const {
    inner: { x, y },
    scale,
  } = w;
  return (x * 1000 + y) * 10 + scale;
}

// `...tail` is everything from that position on, as a new array. Its length and
// its contents both have to be right, so the check reads both.
export function restElement(n: number): number {
  const xs: number[] = [n, n + 1, n + 2, n + 3];
  const [head, ...tail] = xs;
  return head * 10000 + tail.length * 1000 + tail[0]! * 10 + tail[2]!;
}

// A rest that takes nothing, which is an empty array rather than an absent one.
export function emptyRest(n: number): number {
  const xs: number[] = [n];
  const [only, ...none] = xs;
  return only * 10 + none.length;
}

// Destructuring *assignment*, where the targets are places that already exist
// rather than names being introduced. The right-hand side is lowered once and
// each target is assigned a read of it, which is what makes the swap idiom a
// swap rather than two copies of `b`.
export function swap(n: number): number {
  let a = n;
  let b = n * 7;
  [a, b] = [b, a];
  return a * 1000 + b;
}

export function assignFromArray(n: number): number {
  let a = 0;
  let b = 0;
  const xs: number[] = [n, n * 7];
  [a, b] = xs;
  return a * 1000 + b;
}

// The targets need not be locals: a field and an element are places too.
export function assignIntoFields(n: number): number {
  const p: Point = { x: 0, y: 0 };
  [p.x, p.y] = [n, n * 7];
  return p.x * 1000 + p.y;
}

// An object pattern, written the long way. `({ x, y } = p)` is refused: the
// symbol on a shorthand is the *property's*, so assigning through it writes
// where nothing reads.
export function assignByName(n: number): number {
  let a = 0;
  let b = 0;
  ({ x: a, y: b } = { x: n, y: n * 7 } as Point);
  return a * 1000 + b;
}

// A tuple whose elements share a representation is an array of it, which is
// what makes the swap above expressible at all.
export function tupleValue(n: number): number {
  const pair: [number, number] = [n, n * 7];
  return pair[0]! * 1000 + pair[1]!;
}

// The same patterns in a `for...of` head.
//
// A head is not a different feature from a declaration: it binds off the one
// value the walk produces, which is exactly what the declarations above do.
// This was refused because the head reported the names it bound *in order*, and
// an order is the one thing an object pattern does not have -- `[k, v]` over a
// table needs it, because those two names take the two values the walk reads
// without ever building the pair.

interface Segment {
  from: Point;
  weight: number;
}

export function byNameInAWalk(n: number): number {
  const points: Point[] = [{ x: n, y: 2 }, { x: 3, y: n * 5 }];
  let total = 0;
  for (const { x, y } of points) {
    total = total * 100 + x * 10 + y;
  }
  return total;
}

// Renamed, so a lowering that bound by position rather than by property would
// still have to get the names right to agree.
export function renamedInAWalk(n: number): number {
  const points: Point[] = [{ x: n, y: 2 }, { x: 3, y: n * 5 }];
  let total = 0;
  for (const { x: across, y: down } of points) {
    total = total * 100 + down * 10 + across;
  }
  return total;
}

// Nested, and with a bound name the body writes to -- which is the case where
// the loop has to know the head declared it rather than carrying it round.
export function nestedInAWalk(n: number): number {
  // The inner points are named rather than written in place. Two object
  // literals nested inside two more get an anonymous type each, and the array's
  // element type is a third: same fields, different types, and the emitter has
  // no cast to reconcile them. That is the anonymous-type row in
  // `docs/conformance/typescript.md`, not this feature.
  const near: Point = { x: n, y: 2 };
  const far: Point = { x: 3, y: n };
  const segments: Segment[] = [
    { from: near, weight: 5 },
    { from: far, weight: 7 },
  ];
  let total = 0;
  for (const { from: { x, y }, weight } of segments) {
    let scaled = x * 100 + y * 10 + weight;
    scaled = scaled + 1;
    total = total + scaled;
  }
  return total;
}

// A default in a pattern: `{ a = d }` uses `d` where the read is `undefined`,
// and only there. `{ a: b }` and `{ a = b }` encode as the same two identifiers,
// and are told apart by which one *declares* the symbol it names -- a binding's
// own identifier is in its symbol's declaration list and a reference is not.
interface Options {
  name?: string;
  flag: number;
}

function options(n: number): Options {
  if (n < 0) {
    return { flag: 1 };
  }
  return { flag: 2, name: "abcd" };
}

export function aDefaultStandsIn(n: number): number {
  const { name = "xy" } = options(n);
  return name.length * 10 + n;
}

// Renamed and defaulted at once, which is the three-part shape.
export function renamedAndDefaulted(n: number): number {
  const { name: label = "z", flag } = options(n);
  return label.length * 10 + flag + n;
}

// A nested pattern is a binding, not a default -- it declares no symbol of its
// own, so the rule above needs the second half: a pattern binds too.
export function nestedAndDefaulted(n: number): number {
  const outer = { inner: options(n) };
  const {
    inner: { name = "wxyz", flag },
  } = outer;
  return name.length * 10 + flag + n;
}

// The property is required, so its representation has no room for `undefined`
// and the default is unreachable. The language says the same: a default is
// evaluated only when the value is missing, and this one never is.
export function aDefaultThatCannotApply(n: number): number {
  const o = { a: 1, b: 2 };
  const { a = 99, b } = o;
  return a * 10 + b + n;
}

// In a parameter, which is the shape most real code writes.
function take({ name = "xy", flag }: Options): number {
  return name.length * 10 + flag;
}

export function defaultedParameter(n: number): number {
  return take(options(n)) + n;
}
