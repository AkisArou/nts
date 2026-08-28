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
