// expect: emit-c --napi -> calls typeof exports.Shared === "undefined"
// control: typeof exports.Unique === "function" && new exports.Unique(true).get() === true && new exports.Unique(false).get() === false
//
// Sharing a canonical field layout drops an exported class on main 23a533015.
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
