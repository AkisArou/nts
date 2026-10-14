// expect: emit-c --napi -> calls typeof exports.Shared === "function" && new exports.Shared(true).get() === true && new exports.Shared(false).get() === false && new exports.Twin(true).get() === false && new exports.Twin(false).get() === true
// control: typeof exports.Unique === "function" && new exports.Unique(true).get() === true && new exports.Unique(false).get() === false
//
// FIXED: kept as a guard. Sharing a canonical field layout drops an exported
// class on main 23a533015 (Shared is undefined; both Unique controls agree).
// The earlier interface gives Shared its layout; Unique differs only in its
// field name and therefore has a distinct canonical shape. Both constructors
// take a scalar, so an object-parameter refusal cannot mask missing roots.
interface Earlier { flag: boolean }
export function earlierControl(flag: boolean): Earlier { return { flag }; }

export class Shared {
  flag: boolean;
  constructor(flag: boolean) { this.flag = flag; }
  get(): boolean { return this.flag; }
}

export class Unique {
  uniqueFlag: boolean;
  constructor(flag: boolean) { this.uniqueFlag = flag; }
  get(): boolean { return this.uniqueFlag; }
}

// Two published identities on one shape must also link without duplicate
// callbacks and allocate with different native descriptors.
export class Twin {
  flag: boolean;
  constructor(flag: boolean) { this.flag = !flag; }
  get(): boolean { return this.flag; }
}
