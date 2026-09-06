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

// A subclass declares more than its base, and the value can be one.
//
// This is the case the first version of this lowering got wrong. Neither
// `Base` nor `Other` declares `extra`, so asking the *arms* folds `"extra" in
// v` to `false` — and at run time `v` is a `Derived`, which has it. Node says
// true. The differential said so on 20 of 29 cases, and the unit tests at the
// time did not, because every fixture they had used interfaces with nothing
// below them.
//
// Inheritance is additive: a subclass declares everything its base does and
// possibly more. So the `true` direction is safe from the arms alone and the
// `false` direction is not, which is exactly the asymmetry a "no arm has it"
// fold walks into. The set is each arm *and everything below it*.
class Base {
  common: number;
  constructor(common: number) {
    this.common = common;
  }
}

class Derived extends Base {
  extra: number;
  constructor(common: number, extra: number) {
    super(common);
    this.extra = extra;
  }
}

class Unrelated {
  own: number;
  constructor(own: number) {
    this.own = own;
  }
}

export function aSubclassHasMore(n: number): number {
  const v: Base | Unrelated = n > 0 ? new Derived(1, 2) : new Unrelated(3);
  return ("extra" in v ? 10 : 0) + ("common" in v ? 100 : 0) + ("own" in v ? 1000 : 0);
}

// And the base itself, which does not have the subclass's field. Same declared
// type, a different run-time class, and the answers differ — which is what
// makes this a test of the *value* rather than of the declaration.
export function theBaseItselfDoesNot(n: number): number {
  const v: Base | Unrelated = n > 0 ? new Base(1) : new Unrelated(3);
  return ("extra" in v ? 10 : 0) + ("common" in v ? 100 : 0);
}

// `"k" in value` where `value` is **`object`** and nothing narrower.
//
// This is how a program duck-types an `unknown`, and it is the shape every one
// of the 67 sites in `runtime/node` is written in:
//
//     value !== null && typeof value === "object" && "message" in value
//
// The `typeof` guard is what makes it sound. `"k" in 5` throws in JavaScript,
// and a value that reaches the `in` has already been proved an object *by the
// program* — which is why an unguarded `unknown` is still refused: the type
// says so, and this compiler is not the one doing the proving.
//
// The candidate set is then every object type the program has, which is the
// same closed-world argument the union arms get: a compiled program gains no
// types. Not every *class* — an object literal typed by an interface has a
// layout and no entry in the hierarchy, and asking the hierarchy answered
// `false` for `"label" in { label: "l" }` on 20 of 29 cases.

interface Labelled {
  label: string;
}

class Messaged {
  message = "m";
}

class Coded {
  code = 1;
}

function hasLabel(value: unknown): boolean {
  return value !== null && typeof value === "object" && "label" in value;
}

function hasMessage(value: unknown): boolean {
  return value !== null && typeof value === "object" && "message" in value;
}

export function duckTypedAgainstAClass(n: number): number {
  const v: unknown = n > 0 ? new Messaged() : new Coded();
  return (hasMessage(v) ? 1 : 0) + (hasLabel(v) ? 10 : 0);
}

// The literal, which is the half the hierarchy could not see.
export function duckTypedAgainstALiteral(n: number): number {
  const lit: Labelled = { label: "l" };
  const v: unknown = n > 0 ? lit : new Coded();
  return (hasLabel(v) ? 1 : 0) + (hasMessage(v) ? 10 : 0);
}

// And a value that is *not* an object at all, which the guard rejects before
// the `in` runs — so the compiled program never reaches a test JavaScript
// would have thrown for.
export function duckTypedAgainstANumber(n: number): number {
  const v: unknown = n;
  return (hasMessage(v) ? 1 : 0) + (hasLabel(v) ? 10 : 0) + 100;
}
