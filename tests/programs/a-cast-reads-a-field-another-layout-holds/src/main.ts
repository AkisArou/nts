// The cast and both controls must compare all 87 cases.
// `(shape as Square).side` on a `Square | Named` -- the idiom every
// user-defined type guard is written with. `as` is an unchecked assertion
// with no run-time effect, so node reads `side` off whatever object arrived
// and answers `undefined` for a `Named`. nts unerases the value to `Square`'s
// layout and reads its field 0: for a `Named` that is the `name` string's
// pointer, read as a double (-13146688 on C). A type confusion, in typed code.
// The TypeScript suite's unions/user-type-guard is the same read, where the
// other layout's field 0 happens to be a double too.
//
// The control is `byIn`: the same question asked with `"side" in shape`,
// which lowering answers per layout, and which agrees.
type Square = { side: number };
type Named = { name: string };

function sideOf(shape: Square | Named): number {
  const side = (shape as Square).side;
  return side === undefined ? -1 : side;
}

function byIn(shape: Square | Named): number {
  return "side" in shape ? shape.side : -1;
}

export function cast(n: number): number {
  return sideOf((n & 1) === 0 ? { side: n & 7 } : { name: `n${n}` });
}

export function control(n: number): number {
  return byIn((n & 1) === 0 ? { side: n & 7 } : { name: `n${n}` });
}

// A declared interface with the same member keeps its required contract.
// Its ordinary typed read must not inherit the cast view's optional plan.
interface RequiredSquare { side: number }
function typedSide(shape: RequiredSquare): number { return shape.side; }
export function typed(n: number): number { return typedSide({ side: n & 7 }); }
