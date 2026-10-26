// A binding's inferred display name does not give its class a nominal name.
// The control writes a real class name, including the old internal spelling.
export function anAssignedAnonymousClass(n: number): number {
  const Foo = class {
    value(x: number): number { return x + 1; }
  };
  return new Foo().value(n);
}

export function aWrittenClassName(n: number): number {
  const Foo = class __class {
    value(x: number): number { return x + 1; }
  };
  return new Foo().value(n);
}

export function twoAnonymousClassesKeepTheirOwnBody(n: number): number {
  const First = class {
    static value(x: number): number { return x + 1; }
  };
  const Second = class {
    static value(x: number): number { return x + 2; }
  };
  return First.value(n) * 10 + Second.value(n);
}
