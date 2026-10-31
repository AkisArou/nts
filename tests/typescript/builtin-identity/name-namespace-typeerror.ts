/*---
description: A namespace-scoped TypeError namesake keeps its own constructor implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-errors, ts-strings, ts-namespace]
flags: [module]
---*/
// Route: namespace binding named TypeError; node runs the program's own implementation.
export {};
let calls: number = 0;
namespace Local {
  class TypeError {
    readonly name: string = "OwnTypeError";
    readonly message: string;
    constructor(message: string) { calls++; this.message = "own:" + message; }
  }
  export function check(message: string): void {
    calls = 0;
    const result = new TypeError(message);
    assert.sameValue(result.name, "OwnTypeError");
    assert.sameValue(result.message, "own:" + message);
    assert.sameValue(calls, 1);
  }
}
for (const message of ["first", "second", "third"]) Local.check(message);
