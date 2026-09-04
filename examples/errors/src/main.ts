// `Error` is a class this compiler *provides* rather than reads. Its declared
// interface has `stack?` and `cause?`, and an optional property is refused --
// so decomposing it would refuse every class that extends it, for a reason
// having nothing to do with errors. See `hir::builtin`.
//
// What an error is here: a message and a name. A subclass adds its own fields
// after those, which is the base-first rule every other hierarchy follows.

class CodedError extends Error {
  code: string = "";
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "CodedError";
  }
}

// No constructor of its own, so `new Plain(m)` runs the provided one directly.
class Plain extends Error {}

// Two deep, and through a different provided base. `assert.throws(fn, TypeError)`
// is why the four are distinct rather than one.
class Wrapped extends TypeError {
  constructor(m: string) {
    super(m);
  }
}

class Deep extends Wrapped {}

export function messageIsStored(n: number): number {
  return new CodedError("boom", "E_CODE").message.length + n;
}

// The subclass's own field, laid out after the two the base provides.
export function ownFieldSurvives(): number {
  return new CodedError("b", "E_LONGER").code.length;
}

// A constructor that assigns `name` overrides the inherited one.
export function assignedName(): number {
  return new CodedError("b", "c").name.length;
}

// One that does not: JavaScript inherits `Error.prototype.name`, so this is
// "Error" and not "Plain".
export function inheritedName(): number {
  return new Plain("x").name.length;
}

export function typeErrorName(): number {
  return new Wrapped("z").name.length;
}

export function twoDeep(): number {
  return new Deep("zz").message.length + new Deep("zz").name.length;
}

export function emptyMessage(): number {
  return new Error().message.length;
}

// `message` is not `readonly`: assigning to one is ordinary JavaScript.
export function messageIsWritable(n: number): number {
  const e = new Plain("short");
  e.message = "considerably longer";
  return e.message.length + n;
}

// A class that extends `Error`, is named in a signature, and is never
// constructed.
//
// `e instanceof Error` is a comparison against a closed set, and the set is
// every class that extends the one written -- so it names `Unbuilt`'s
// descriptor. The descriptor emitter used to skip any layout nothing
// *allocates*, so the C referenced a descriptor it never defined and clang
// stopped at `use of undeclared identifier 'nts_desc_NtsObj_Unbuilt'` -- from
// an `emit-c` that had reported success.
//
// The shape is only reachable when the two rules disagree, which is why it is
// an example rather than a unit test: the `examples` gate step compiles and
// runs the emitted C, and that is what catches an emitter promising a symbol
// it does not write. Found by the Codex session compiling `runtime/node`,
// where a module declares many error subclasses whose constructors are refused.
class Unbuilt extends Error {
  code: number = 0;
}

// Deliberately not `new Error(...)` against `new RangeError(...)`: those two
// are structurally identical, share a layout, and `instanceof` between classes
// of identical shape is a separate open row in typescript.md. The number here
// is about the descriptor being *defined*, not about telling two errors apart.
export function neverConstructed(n: number): number {
  const e: unknown = n > 2 ? new Error("x") : 5;
  return e instanceof Error ? 1 : 0;
}

export function namesTheUnbuiltClass(w: Unbuilt): number {
  return w.code;
}
