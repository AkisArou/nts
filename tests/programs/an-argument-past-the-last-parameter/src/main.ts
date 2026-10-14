// A call passing more arguments than the callee declares.
//
// JavaScript evaluates every argument written and the callee never sees one
// past its last parameter. A `.js` file may write the call, and TypeScript
// lets a `.ts` file write it under `@ts-expect-error`; test262 does both, as in
// `function await() {}` called `await(undefined)`. Lowering passed every argument
// to the callee, so the call had more arguments than the function takes: invalid
// HIR on every backend, at every call shape below, rather than an answer or a
// refusal. Past the callee's fixed arity each argument is now evaluated for
// its effects and dropped, and `note` counts that each one ran.
//
// What each export pins:
//
//   run      a plain call: `f(note("a"))` runs `note` though `f` takes nothing
//   undef    `undefined` and `null` past the end, which have no
//            representation until something expects one
//   spread   a fixed-arity tuple spread past the end: its extra position is
//            not passed
//   methods  a constructor, a static method and an instance method
//   values   a closure called directly, and through a typed binding
//
// Transcribed from node (v24), each export called with 3:
//
//     run 404      undef 3      spread 3      methods 643      values 12
let log = "";

function note(s: string): number {
  log += s;
  return s.length;
}

// What `note` wrote since the last call, emptied: a string a global still held
// after the call would read as a leak to the `--rc` lane.
function taken(): number {
  const length = log.length;
  log = "";
  return length;
}

function f(): number {
  return 1;
}

function g(a: number): number {
  return a;
}

export function run(n: number): number {
  // @ts-expect-error TS2554: f takes no arguments
  const one = f(note("a"));
  // @ts-expect-error TS2554: g takes one
  const two = g(n, note("bc"), note("d"));
  return (one + two) * 100 + taken();
}

export function undef(n: number): number {
  // @ts-expect-error TS2554
  f(undefined);
  // @ts-expect-error TS2554
  f((n, undefined), null);
  return n;
}

export function spread(n: number): number {
  const pair: [number, number] = [n, 7];
  // @ts-expect-error TS2556
  return g(...pair);
}

class Box {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
  get(): number {
    return this.v;
  }
  static of(v: number): Box {
    return new Box(v);
  }
}

export function methods(n: number): number {
  // @ts-expect-error TS2554
  const b = new Box(n, note("x"));
  // @ts-expect-error TS2554
  const c = Box.of(n + 1, note("yy"));
  // @ts-expect-error TS2554
  const sum = b.get(note("zzz")) + c.get() * 10;
  return sum + taken() * 100;
}

export function values(n: number): number {
  const h = (a: number) => a * 2;
  const k: (a: number) => number = h;
  // @ts-expect-error TS2554
  return h(n, 5) + k(n, 6);
}
