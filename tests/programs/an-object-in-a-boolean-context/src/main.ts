// An operand of `&&` whose type is an object, never null or undefined: its
// truthiness is `true`, and nothing needs to be read to know it. React's
// reconciler writes `ctor.prototype && ctor.prototype.isPureReactComponent`,
// where `ctor` is a class component's descriptor and `prototype` is never
// null (runtime/react/CLASS-COMPONENTS.md). Filed from the React lane as a
// blocker refusing with "an object where a boolean is wanted"; it compiles now
// and agrees with node, which is what this holds it to. The same `&&` read as a
// value still refuses: `blockers/an-object-and-a-boolean-as-a-value`.

class Proto {
  readonly isPure: boolean;
  constructor(isPure: boolean) {
    this.isPure = isPure;
  }
}

class Type {
  readonly prototype: Proto;
  constructor(isPure: boolean) {
    this.prototype = new Proto(isPure);
  }
}

function pure(type: Type): boolean {
  if (type.prototype && type.prototype.isPure) {
    return true;
  }
  return false;
}

/** Both arms of the `&&`: a pure prototype and one that is not. */
export function pureOf(n: number): string {
  return String(pure(new Type((n & 1) === 0))) + String(pure(new Type(false)));
}
