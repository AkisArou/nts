// Whether an optional property is *there*, which the slot cannot say.
//
// An optional property holds `T | undefined` and a fresh allocation is zeroed,
// which is already the `undefined` tag. That is the right representation for
// reading the property and the wrong one for asking whether it exists, because
// JavaScript distinguishes `{}` from `{ limit: undefined }` and a slot does
// not. So `in`, `Object.keys`, `Object.hasOwn` and `for...in` all refused.
//
// The answer is one bit per optional property in the object header's `flags`
// word, which cost nothing: bits 0 through 5 are spoken for by the string,
// array and collector flags and the other twenty-six were free, in a word every
// object already carries.
//
// # The two shapes answer differently, and node is why the code knows
//
// This was reasoned out the wrong way round first — "an optional property is
// absent until written" — and the first run against node said otherwise on
// three of six functions:
//
//     class field declared, never assigned    "maybe" in b   true
//     object literal without it               "maybe" in o   false
//     object literal with `maybe: undefined`  "maybe" in o   true
//
// A class field *declaration* defines its property even with no initialiser —
// ES2022 class-field semantics, which `target: ESNext` selects — so
// constructing a `Box` writes `maybe`. An interface's values are object
// literals, where nothing is written unless the literal writes it.
//
// That is a difference in what construction *does*, not in what the question
// means, which is why both go through the same bit: the class's are set by one
// constant-mask store at construction, and `delete` clears them like any other.
// The tempting shortcut — answer `true` from the type for a class, skip the bit
// — is wrong for one program, and `deletedFromAClass` is that program.

class Box {
  keep: number;
  maybe?: string;
  other?: number;

  constructor(n: number) {
    this.keep = n;
  }
}

interface Opts {
  keep: number;
  maybe?: string;
  other?: number;
}

// A class field is present from construction, written or not.
export function aClassFieldIsThere(n: number): number {
  const b = new Box(n);
  return "maybe" in b ? 1 : 0;
}

// And still present after being assigned, which is the same answer for a
// different reason — the write sets a bit that construction had already set.
export function aClassFieldAssigned(n: number): number {
  const b = new Box(n);
  if (n > 3) {
    b.maybe = "set";
  }
  return "maybe" in b ? 1 : 0;
}

// Deleting it removes it. The static answer this example's header warns about
// would say `1` here for every input.
export function deletedFromAClass(n: number): number {
  const b = new Box(n);
  if (n > 3) {
    delete b.maybe;
  }
  return "maybe" in b ? 1 : 0;
}

// Deleted and then written again, so the bit has to be cleared and set rather
// than latched either way.
export function deletedThenWrittenAgain(n: number): number {
  const b = new Box(n);
  delete b.maybe;
  if (n > 3) {
    b.maybe = "back";
  }
  return "maybe" in b ? 1 : 0;
}

// A literal that omits it. This is the case a slot cannot answer.
export function aLiteralWithout(n: number): number {
  const o: Opts = { keep: n };
  return "maybe" in o ? 1 : 0;
}

// A literal that writes it.
export function aLiteralWith(n: number): number {
  const o: Opts = { keep: n, maybe: "set" };
  return "maybe" in o ? 1 : 0;
}

// A literal that writes it *as `undefined`*, which is the whole distinction:
// the value read back is identical to the case above it and the answer is not.
export function aLiteralWithUndefined(n: number): number {
  const o: Opts = { keep: n, maybe: undefined };
  return "maybe" in o ? 1 : 0;
}

// Assigned after the fact, on a path the compiler cannot fold.
export function aLiteralAssignedLater(n: number): number {
  const o: Opts = { keep: n };
  if (n > 3) {
    o.maybe = "set";
  }
  return "maybe" in o ? 1 : 0;
}

// Two properties, so a wrong bit index shows up as an answer about the other
// one rather than as a crash. With one optional property every index is 0 and
// every mistake agrees.
export function twoOptionalsAreDistinct(n: number): number {
  const o: Opts = { keep: n };
  if (n > 3) {
    o.maybe = "set";
  }
  if (n > 5) {
    o.other = n;
  }
  return ("maybe" in o ? 1 : 0) + ("other" in o ? 2 : 0);
}

// A required property is still answered from the type, with no bit and no test.
export function aRequiredPropertyIsStatic(n: number): number {
  const o: Opts = { keep: n };
  return "keep" in o ? 1 : 0;
}

// # A subclass and its base have to number a shared property the same way
//
// A bit is a position in one layout, so a `Derived` reaching a `Base`-typed
// parameter reads whichever bit that layout numbers `tag` — and the writes used
// the other one. Base-first layout is why they agree, and the lowering *checks*
// that rather than relying on it, because base-first is a property of a pass
// that runs later.

class Holder {
  id: number;
  tag?: string;

  constructor(n: number) {
    this.id = n;
  }
}

class HolderWithMore extends Holder {
  extra?: number;
  own: number;

  constructor(n: number) {
    super(n);
    this.own = n * 2;
  }
}

function askAHolder(h: Holder): number {
  return "tag" in h ? 1 : 0;
}

// The base itself, which is the control: whatever the subclass does, this is
// the answer the bit is supposed to give.
export function aBaseThroughTheParameter(n: number): number {
  const h = new Holder(n);
  if (n > 3) {
    delete h.tag;
  }
  return askAHolder(h);
}

// And the subclass through the same parameter. A disagreement between the two
// layouts shows up here and nowhere else.
export function aSubclassThroughTheParameter(n: number): number {
  const h = new HolderWithMore(n);
  if (n > 3) {
    delete h.tag;
  }
  return askAHolder(h);
}

// The subclass's own optional property, which sits after the inherited one and
// must not collide with it.
export function aSubclassOwnOptional(n: number): number {
  const h = new HolderWithMore(n);
  if (n > 3) {
    delete h.extra;
  }
  return ("extra" in h ? 1 : 0) + ("tag" in h ? 2 : 0);
}
