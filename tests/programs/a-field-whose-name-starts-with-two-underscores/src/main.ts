// A name the program begins with `__`.
//
// The checker interns such a name with one more `_` (`escapeLeadingUnderscores`)
// so its own names -- `__function`, `__call` -- cannot collide with one a program
// writes. Carried into the layout, a field `__snapshot` was `___snapshot` there
// while every access said `__snapshot`, and was refused as a member its own class
// does not declare. React's `__reactInternalSnapshotBeforeUpdate` is the field
// that found it (filed from the React lane as an outcomes fixture, 2026-09-27).
// The frontend now gives every name the program wrote back as it wrote it
// (`written_name`).
//
// One underscore is not escaped, and none is the plain control; each arm differs
// from the subject in that one place.

class Twice {
  state: string = "";
  __snapshot: string = "";
}

class Once {
  state: string = "";
  _snapshot: string = "";
}

class Plain {
  state: string = "";
  snapshot: string = "";
}

export function twoUnderscores(n: number): string {
  const instance = new Twice();
  instance.__snapshot = "kept" + String(n & 3);
  return instance.__snapshot;
}

export function oneUnderscore(n: number): string {
  const instance = new Once();
  instance._snapshot = "kept" + String(n & 3);
  return instance._snapshot;
}

export function noUnderscore(n: number): string {
  const instance = new Plain();
  instance.snapshot = "kept" + String(n & 3);
  return instance.snapshot;
}

class Instance {
  props: string = "";
  __reactInternalSnapshotBeforeUpdate: number = 0;
  ___three: number = 0;
  static __made = 0;
  __bump(by: number): number {
    this.__reactInternalSnapshotBeforeUpdate += by;
    this.___three += by * 3;
    Instance.__made += 1;
    return this.__reactInternalSnapshotBeforeUpdate + this.___three;
  }
}

/** React's own name, three underscores, a static and a method, together. */
export function reactsShape(n: number): number {
  // Reset, so the answer is this case's and not a count of the cases before it.
  Instance.__made = 0;
  const instance = new Instance();
  instance.__bump(n & 7);
  return instance.__bump(1) * 100 + Instance.__made;
}

function withParameter(__given: number): number {
  return __given * 2;
}

/** A parameter, and a property of an object literal. */
export function aParameterAndALiteral(n: number): number {
  const literal = { __tag: n & 3, plain: 1 };
  return withParameter(literal.__tag) + literal.plain;
}
