// **A guard on runtime internals nothing else compares.** `validateObject`
// (runtime/node/internal/validators.ts) and the `ERR_INVALID_ARG_TYPE` message
// it builds (internal/errors.ts, through `staticObjectName`) gave wrong answers
// for weeks, in files every module imports. `Array.isArray(value)` on a value
// the checker had narrowed to `object` was folded to `false`, so
// `validateObject([])` accepted an array where node throws, and a message never
// named an array "Array". 7f7bf5340 fixed the fold; nothing recorded it. The
// compiled axis runs a module's own tests, and these are nobody's module.
//
// So this compiles the runtime's own TypeScript and runs it against node running
// the same TypeScript, through `@nts/runtime/` (see outcomes-project.mjs). The
// message is reached the way a caller reaches it -- the error `validateObject`
// throws -- and not by calling `staticObjectName`, whose name is not API: a
// rename should not read as a regression.
//
// The record reads `refused`: importing errors.ts brings in error classes nts
// refuses for unrelated reasons (the first is a `CallableFunction | undefined`
// parameter). `ran` is the guard. On a clean 2f7cc745a all three arms agree
// with node. On e2dfdc68e, before the fix, the record reads CHANGED with
// "an array=accepted" -- the wrong answer, caught.

import { validateObject } from "@nts/runtime/node/internal/validators.ts";

function verdict(value: unknown): string {
  try {
    validateObject(value, "options");
    return "accepted";
  } catch (error) {
    return (error as Error).message;
  }
}

observe("an array", verdict([1, 2]));
observe("a plain object", verdict({ a: 1 }));
observe("null", verdict(null));
done();
