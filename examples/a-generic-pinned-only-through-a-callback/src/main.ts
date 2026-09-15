// A type parameter the checker pins from **inside a function type**, and from
// nowhere else.
//
// `hir::generics::unify` had two structural arms -- bind a type parameter, and
// descend through `Array` -- so a parameter named only by a callback was never
// pinned and the call was skipped. The declaration was then refused as "a
// generic function no call pins down", and every caller cascaded off it.
//
// Nine probe arms located the rule, and the pair that states it is:
//
//     call<T>(f: (a: T) => T): T        compiled -- the RETURN is `T`
//     g<T>(f: (a: T) => void): void     did not  -- `T` is only in the callback
//
// Both pin `T` to a reader. The second is `asRequest<Arguments>` in
// `runtime/node/fs`, which is the top root of all 26 modules by
// `tooling/conformance/gates.mjs` -- 22 exported fs functions decline behind it
// saying only "it calls `asRequest`, which was refused above".
//
// **It publishes none of them, and this fixture is not evidence that it does.**
// Measured against the unchanged binary across 26 modules: declined exports 505
// either side, definitions emitted 35,567 either side, and the single-file
// corpus unmoved at 53 lowered. Removing the root advances the chain one link
// into `takes an object` -- a callback is an object and an object does not
// cross N-API, so that axis is bounded by the boundary and not by this. What is
// here is a correctness gap closed on its own terms: a call any reader can pin
// was refused, and now is not.

/** `T` appears only as a callback's return and another callback's parameter. */
function runWith<T>(produce: () => T, consume: (value: T) => void): void {
  consume(produce());
}

export function throughTwoCallbacks(n: number): number {
  let seen = 0;
  runWith(
    (): number => (n & 15) + 1,
    (value: number): void => {
      seen = value * 2;
    },
  );
  return seen;
}

// **The shape that returns a function type is NOT here, and that is deliberate.**
//
//     function registerHandler<T>(handle: (value: T) => void): (value: T) => void
//
// is `asRequest`'s exact shape, and pinning `T` is no longer what stops it: it
// now reaches `NTS2006 an object type with no layout`, one link further on.
// `blockers/` is where that belongs once it has a name. Six of the eight shapes
// this change touches advance like that rather than compiling, and only two --
// both returning `void` -- clear outright. A fixture carrying the other six
// would be asserting a pass this change does not deliver.

/** Two instantiations of one declaration, so a single shared copy would be
 * wrong rather than merely imprecise. */
function firstOf<T>(read: () => T, use: (value: T) => void): void {
  use(read());
}

export function twoInstantiations(n: number): number {
  let asNumber = 0;
  let asLength = 0;
  firstOf(
    (): number => n & 7,
    (value: number): void => {
      asNumber = value;
    },
  );
  firstOf(
    (): string => (n & 1) === 0 ? "even" : "odd",
    (value: string): void => {
      asLength = value.length;
    },
  );
  return asNumber * 100 + asLength;
}
