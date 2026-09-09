// An object literal assigned into an erased slot, read back through the
// declared type.
//
// The compiler lane found this while fixing something else, and reverted the
// fix because of it. `Optional.limit` is optional, so its field is `Erased` and
// the absence is a tag. The literal `{ limit: 19 }` has the checker type
// `{ limit: number }`, whose field is a plain `f64`. TypeScript says assignable;
// the two are different structs here. The union parameter is erased, so the
// object goes in as one shape and `unerase` reads it back as the other,
// trusting the static type -- eight bytes of double read as a tagged value.
//
// Every function here takes and returns a scalar, and does the interesting work
// inside. That is deliberate: calling through a boundary to inspect an object
// would add a second erasure and confuse which one answered.

interface Optional {
  limit?: number;
}

interface Required_ {
  limit: number;
}

type Listener = (value: number) => void;

function throughErasedSlot(o: Optional | Listener | undefined): Optional | undefined {
  if (typeof o === "function") return undefined;
  return o;
}

function throughNullable(o: Optional | undefined): Optional | undefined {
  return o;
}

function throughErasedRequired(o: Required_ | Listener | undefined): Required_ | undefined {
  if (typeof o === "function") return undefined;
  return o;
}

/** The case. Node answers 19. */
export function optionalThroughErasedSlot(): number {
  const back = throughErasedSlot({ limit: 19 });
  return back === undefined ? -1 : (back.limit ?? -2);
}

/** Control: the same field, declared required. Isolates the optionality. */
export function requiredThroughErasedSlot(): number {
  const back = throughErasedRequired({ limit: 19 });
  return back === undefined ? -1 : back.limit;
}

/** Control: the same optional field, no erasure. Isolates the erased slot. */
export function optionalThroughNullable(): number {
  const back = throughNullable({ limit: 19 });
  return back === undefined ? -1 : (back.limit ?? -2);
}
