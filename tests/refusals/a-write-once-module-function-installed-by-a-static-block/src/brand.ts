// The cycle-break half of the pattern: this module cannot import the class
// module (the class module imports the interface from here), so the brand
// check arrives by installation rather than by import. One assignment, from
// the class's static block, before any caller can run -- write-once in
// everything but spelling.
export interface Ops {
  readonly ready: boolean;
}

let checkInstalled!: (value: unknown) => value is Ops;

export function installCheck(check: (value: unknown) => value is Ops): void {
  checkInstalled = check;
}

export function isOps(value: unknown): value is Ops {
  return checkInstalled(value);
}
