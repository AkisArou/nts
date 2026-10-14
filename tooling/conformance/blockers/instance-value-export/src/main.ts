// expect: emit-c --napi -> no wrapper for thing: is exported as a value of type `an object`, which does not cross
//
// An exported const holding a class instance does not cross the Node-API
// boundary. The class beside it publishes (1 class in the addon.c summary);
// the instance does not, because its type is reported as `an object` rather
// than as the class it is an instance of.
//
// The control pair is in this file: `Thing` publishes and `label` (a scalar
// value export, see `value-export`) crosses, so value exports and class
// exports each work alone. What does not cross is a value whose value is a
// constructed instance.
//
// This gates the default-shaped modules on the compiled axis: `cluster`'s
// `export default cluster` and `console`'s `export default globalConsole`
// (and its `globalConsole` named export) are instances, so their addons
// publish the class and some functions but shape() reads the missing
// default and the lane publishes {} (measured on main e0b77e5a7, slice 0).
// Plain object-literal tables are a different shape and do cross --
// `object-value-export` is the guard for those.

export class Thing {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
}

// Refused: a value of type `an object`.
export const thing: Thing = new Thing(7);

// Control: a scalar value export crosses.
export const label: string = "thing";
