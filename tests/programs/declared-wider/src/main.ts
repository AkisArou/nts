// A declaration that is wider than what it is initialised with.
//
//     interface Tagged extends Error { code?: string }
//     const warning: Tagged = new Error(message);
//     warning.code = code;                            // refused
//
// TypeScript accepts this: `code` is optional, so an `Error` is assignable to a
// `Tagged`. The binding coerced to the declared type, which for two managed
// types is an upcast and leaves the value's type alone -- so the receiver
// stayed an `Error`, which declares no `code`, and the write was refused.
//
// The isolation the Node lane found is the sharp part. A factory with a
// declared RETURN type compiles:
//
//     function make(m: string): Tagged { return new Error(m); }
//     const w = make(m); w.code = c;                  // fine
//
// Same value, same annotation, same write. The only difference is how the type
// arrives -- and there the constructed type IS the declared one, so the
// allocation was already wide enough.
//
// So the fix is at the allocation rather than at the write: a `new` on the
// right of a declaration allocates the declared layout when that widens what is
// being constructed. It is sound rather than a cast, because base-first layout
// puts the base's fields in front -- the constructor writes `message` and
// `name` at the offsets it always did, and `code` is the zero any fresh field
// has. Nothing else holds the object; it was allocated a line ago.
//
// This one root blocked the whole of `node:punycode`, and is the same shape as
// twenty-one sites in `internal/errors.ts` that gate twenty of twenty-two
// modules in that profile.

interface Tagged extends Error {
  code?: string;
}

export function writesTheWiderMember(n: number): number {
  const warning: Tagged = new Error("boom");
  if (n > 0) {
    warning.code = "E";
  }
  return (warning.code ?? "").length * 10 + warning.message.length;
}

// THE IDENTITY CASE, and it is why this needed more than an allocation.
//
// Laying the object out as `Tagged` gives it `Tagged`'s descriptor, so
// `instanceof Error` went false -- the set of classes that test accepts is
// built by walking `hierarchy.base`, and an interface has no entry there
// because `base` is filled from class declarations. Two walks over one
// relation, and `instanceof` was asking the narrower one.
export function isStillAnError(n: number): number {
  const warning: Tagged = new Error("boom");
  return (warning instanceof Error ? 1 : 0) + (n > 0 ? 10 : 0);
}

// The base's own members still read and write at the right offsets, which is
// the whole claim base-first layout makes. A case that only wrote `code` would
// pass against a layout that had put it first.
export function theBaseMembersStillWork(n: number): number {
  const warning: Tagged = new Error("boom");
  warning.message = n > 0 ? "longer" : "no";
  warning.name = "Named";
  warning.code = "C";
  return warning.message.length * 100 + warning.name.length * 10 + (warning.code ?? "").length;
}

// The factory form -- which this file originally described as "always worked",
// and which was writing past the end of an allocation the whole time.
//
// `make` allocated an `Error` of two fields and returned it as a `Tagged` of
// three, and the caller then wrote field 2. On a pointer-cast backend that is a
// heap write past the end and produces the right answer, so C and LLVM agreed
// with node on every case here and this example raised a floor while doing it.
// The JVM verifier refused it: `Type 'Error' is not assignable to 'Tagged'`.
//
// The cause was that the widening asked only about a *declaration*, and a
// `return` with a declared return type is the same widening one syntactic
// position over. It asks the checker's contextual type now, which covers the
// declaration, the return and an argument alike.
function make(message: string): Tagged {
  return new Error(message);
}

export function throughAFactory(n: number): number {
  const warning = make(n > 0 ? "boom" : "x");
  warning.code = "F";
  return warning.message.length * 10 + (warning.code ?? "").length;
}

// A declaration that widens nothing must not change: `const e: Error = new
// Error(m)` allocates an `Error` exactly as before.
export function anExactDeclarationIsUnchanged(n: number): number {
  const plain: Error = new Error(n > 0 ? "boom" : "x");
  return plain.message.length;
}

// And a NARROWING declaration must not widen the other way. `Tagged` is what is
// constructed and `Error` is what is declared, so the allocation stays
// `Tagged`'s -- the subclass, not the annotation.
class Coded extends Error {
  tag = 0;
}

export function aNarrowerDeclarationKeepsTheSubclass(n: number): number {
  const held: Error = new Coded("boom");
  return held.message.length + (held instanceof Error ? n : -1);
}
