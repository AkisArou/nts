// expect: emit-c --napi -> calls exports.inner === undefined
// control: typeof exports.top === "function"
//
// A re-exported module namespace whose every member is declined is created
// in the addon (`napi_create_object(env, &nts_ns_inner)`) and counted in
// the addon.c summary ("1 namespace(s)"), but it is never set on `exports`,
// so `require(...).inner` is undefined. A namespace with at least one
// published member is set -- `export-namespace` is the guard for that half,
// and it is the control at module scale: publishing is partial by design,
// and zero is a number of members, not a reason to drop the object.
//
// This is half of why compiled `timers` publishes nothing: every member of
// its `promises` namespace is declined (a `T | undefined` parameter, a
// `finally` spanning a `yield`), the empty namespace is then dropped, and
// shape() reads `exports.promises === undefined` and returns {} (measured
// on main e0b77e5a7, slice 0). The members' own refusals are separate
// blockers; this fixture is only about the object that should still cross.

import * as inner from "./inner.ts";
export { inner };

export function top(): number {
  return 2;
}
