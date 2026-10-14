// expect: NTS1001 a property `stackStartFn` of unrepresentable type (a union of `CallableFunction` | undefined) is not supported by this lowering yet
//
// A class with a property of type `CallableFunction | undefined` is refused
// outright (NTS1001 at lowering), so its constructor is never compiled and
// the class cannot be published as an addon export.
//
// The control is `Plain` below: a class with an ordinary optional property
// lowers cleanly. The pair differs in one thing -- the property's type --
// so the refusal is the callable union, not optionality.
//
// This is the first refusal in `node:assert`: both `AssertionError` and
// `Assert` carry `stackStartFn` (node's own options shape), both
// constructors are refused through it, and with the classes unpublished
// the compiled `assert` addon publishes zero names (measured on main
// e0b77e5a7, slice 0). Node's type for the field is
// `CallableFunction | undefined`; there is no way to write the module
// differently and keep node's surface.

export class WithCallable {
  stackStartFn: CallableFunction | undefined;
  constructor() {
    this.stackStartFn = undefined;
  }
}

// Control: lowers.
export class Plain {
  label: string | undefined;
  constructor() {
    this.label = undefined;
  }
}
