// Constants fixed per build. The JavaScript build replaces
// `process.env.NODE_ENV` with a literal for each of its two builds, so every
// `if (isDevelopment)` folds away in production. A native build gives this
// module a twin with the literal written in.
export const isDevelopment: boolean = process.env.NODE_ENV !== "production";

// Profiling builds measure render durations for `<Profiler>`. Upstream turns
// them on exactly when it builds for development.
export const isProfiling: boolean = isDevelopment;

// A native build checks that each hook reads back the kind of state it wrote
// (see ReactFiberHooks' HookKind). Its reads of erased state are unchecked,
// so a hook order that changed between renders would be type confusion there.
// Here it is a wrong answer at worst, as in upstream React, which this build
// matches exactly.
export const checksHookKinds = false;
