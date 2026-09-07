// expect: emit-c --napi -> no wrapper for posix: is exported and is not a
//         function this backend can name
//
// A module namespace re-exported as a name. `path` is built out of exactly this
// -- `export * from "./posix.ts"` for the platform's own functions, and
// `export * as posix` / `export * as win32` so both are reachable -- which is
// upstream's structure, not a choice made here: `lib/path.js` ends by hanging
// both namespaces off each other.
//
// It is a fourth thing behind the single message "is not a function this backend
// can name", which has already turned out to cover a value export (fixed), a
// class (`blockers/export-class`), and a shorthand property
// (`blockers/export-object-shorthand`). This one is none of those: there is no
// object literal anywhere, and the thing being exported is a module.
//
// Whatever publishes these has to give `path.posix` and `path.win32` as *the
// same objects* the namespace graph is wired from -- `path.posix.posix ===
// path.posix`, and all four slots. `runtime/node/path/test/namespace-identity-
// static.js` asserts that graph and passes on the interpreted lane. The repair
// that publishes a freshly built namespace object per access satisfies every
// name, passes every upstream test, and makes that graph infinite.
//
// The same caution as `blockers/export-alias-identity`, and for the same reason:
// two exported names that node guarantees are one object have to arrive as one
// object, not as two that compare equal.
export * from "./posix.ts";
export * as posix from "./posix.ts";
