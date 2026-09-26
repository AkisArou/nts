// expect: NTS1001 an object where a boolean is wanted

// An operand of `&&` whose type is an object, never null or undefined: its
// truthiness is `true`, and nothing needs to be read to know it. React's
// reconciler writes `ctor.prototype && ctor.prototype.isPureReactComponent`,
// where `ctor` is a class component's descriptor and `prototype` is never
// null (runtime/react/CLASS-COMPONENTS.md). Filed from the React lane.

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

export const answer = String(pure(new Type(true))) + String(pure(new Type(false)));
