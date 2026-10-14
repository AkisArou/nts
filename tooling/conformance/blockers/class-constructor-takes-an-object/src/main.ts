// expect: emit-c --napi -> no wrapper for WithOpts#constructor: takes an object
//
// An exported class whose constructor takes an options object is not
// published at all. The constructor wrapper refuses the object parameter
// ("takes an object", which crosses outward only), and with no constructor
// the class itself is "not a function this backend can name", so the addon
// publishes zero names.
//
// The control is `Plain` below: a class whose constructor takes a scalar
// publishes (1 class in the addon.c summary). The pair differs in one
// thing -- the constructor parameter's type -- so the refusal is about the
// object parameter at the constructor wrapper, not about classes.
//
// `object-parameter-at-the-wrapper` fixtures the same refusal for a plain
// function. This is the constructor dispatch, and it gates `node:events`:
// `EventEmitter`'s constructor takes an options object, the class is the
// module's whole surface, and the compiled addon for `events` therefore
// publishes nothing (measured on main e0b77e5a7, slice 0).

export interface Opts {
  captureRejections?: boolean;
}

export class WithOpts {
  flag: boolean;
  constructor(opts?: Opts) {
    this.flag = opts?.captureRejections ?? false;
  }
  get(): boolean {
    return this.flag;
  }
}

// Control: publishes.
export class Plain {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  get(): number {
    return this.value;
  }
}
