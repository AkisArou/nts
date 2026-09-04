// `"k" in value`.
//
// The same operation as `instanceof` with a different question in front of it.
// `instanceof` asks whether the value's class is one of a set the compiler
// computed from the hierarchy; `in` asks whether it is one of the set that
// *declares a property*. Both sets come from the static type, so `in` needs no
// new operation, no runtime helper, and nothing added to a descriptor.
//
// A property-name table in the descriptor was the first design — names in
// rodata beside the reference map, and a `nts_has_property` walking them. It
// would have been an ABI change in three backends to answer a question the
// compiler already knows the answer to. The set is finite and static; only
// *which* of them the value is, is not.

interface Circle {
  radius: number;
}

interface Square {
  side: number;
}

// The idiom this exists for: `in` narrows the union, and each arm reads the
// field only its own type has.
export function narrows(n: number): number {
  const shape: Circle | Square = n > 0 ? { radius: n } : { side: -n };
  if ("radius" in shape) {
    return shape.radius * shape.radius * 3;
  }
  return shape.side * shape.side;
}

// The other way round, so the test is not always taken in the same direction.
export function narrowsTheOtherWay(n: number): number {
  const shape: Circle | Square = n > 0 ? { radius: n } : { side: -n };
  if ("side" in shape) {
    return shape.side + 1;
  }
  return shape.radius + 2;
}

interface Both {
  shared: number;
  left: number;
}

interface Also {
  shared: number;
  right: number;
}

// Every arm declares it, so the answer is a constant `true` and no test is
// emitted. It is still an answer about the program rather than about the
// compiler: node agrees.
export function everyArmHasIt(n: number): number {
  const value: Both | Also = n > 0 ? { shared: n, left: 1 } : { shared: -n, right: 2 };
  return "shared" in value ? 10 : 20;
}

// No arm declares it, so the answer is a constant `false`.
export function noArmHasIt(n: number): number {
  const value: Both | Also = n > 0 ? { shared: n, left: 1 } : { shared: -n, right: 2 };
  return "absent" in value ? 10 : 20;
}

// A single object type, where the answer never needed a test at all.
export function oneType(n: number): number {
  const value: Circle = { radius: n };
  return ("radius" in value ? 1 : 0) + ("side" in value ? 100 : 0);
}

// A required property on a type that also has an optional one. The optional
// property is refused (see `examples/unsupported`); a required one beside it is
// not, and that is the distinction worth pinning — the refusal is about the
// *property*, not about the type carrying one.
interface Options {
  limit?: number;
  label: number;
}

export function requiredBesideOptional(n: number): number {
  const o: Options = { limit: n, label: 1 };
  return ("label" in o ? 7 : 0) + n * 0;
}

// The operand is evaluated even when the answer is a constant. `in` has no
// short circuit, and the left side of the `&&` chains that use it very often
// has an effect.
let touched = 0;

function look(n: number): Circle {
  touched = touched + 1;
  return { radius: n };
}

export function evaluatesItsOperand(n: number): number {
  touched = 0;
  const absent = "nope" in look(n) ? 1 : 0;
  const present = "radius" in look(n) ? 2 : 0;
  return absent + present + touched * 10;
}

// Nested in the shape `runtime/node` writes: a chain of tests where each arm is
// distinguished by a different property.
interface Reader {
  read: number;
}

interface Writer {
  write: number;
}

interface Duplex {
  read: number;
  write: number;
  duplex: number;
}

export function chained(n: number): number {
  const s: Reader | Writer | Duplex =
    n > 1 ? { read: 1 } : n < -1 ? { write: 2 } : { read: 3, write: 4, duplex: 5 };
  if ("duplex" in s) {
    return s.duplex * 100;
  }
  if ("read" in s) {
    return s.read * 10;
  }
  return s.write;
}
