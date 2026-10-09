// expect: NTS1001 an object where a boolean is wanted
//
// `obj && flag` read as a value, where `obj` is an object type that is never
// null or undefined: the answer is `flag`, since an object is always truthy.
// The same `&&` as a condition compiles and agrees with node --
// `examples/an-object-in-a-boolean-context`, React's
// `ctor.prototype && ctor.prototype.isPureReactComponent` -- and this is the
// one difference from it: the result is returned rather than branched on.
// Found converting that example from a blocker, when its value form, written
// alongside, still refused.

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

export function andAsAValue(n: number): boolean {
  const type = new Type((n & 1) === 1);
  return type.prototype && type.prototype.isPure;
}
