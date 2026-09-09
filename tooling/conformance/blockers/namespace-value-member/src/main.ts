// expect: emit-c --napi -> emits-addon could not add a value to a namespace
//
// FIXED, kept as a guard. A namespace carries its value members.
//
// `export const sep = "/"` is a *global*, not a function, and a namespace built
// only out of wrappers had neither `sep` nor `delimiter`. `path.posix` and
// `path.win32` published eleven members each where node's have seventeen, and
// two of the six missing were these.
//
// # The check is `win32.sep`, and that is not a detail
//
// `path.posix.sep` was already `"/"` before this landed, because `shape.mjs`
// builds `posix` from the *flat* exports and those carry the top-level `sep`.
// Only `win32` is built from the namespace object. So a test asserting
// `posix.sep === "/"` passes against a feature that does nothing, and the Node
// lane is why this fixture exists in the shape it does.
//
// Verified by loading the real addon: `posix.sep` `"/"`, `win32.sep` `"\\"`,
// `posix.delimiter` `":"`, `win32.delimiter` `";"` -- four of four against node.
//
// # The declaration, which is how it was found rather than reasoned about
//
// `path.sep` and `path.posix.sep` are one global under two names, so its extern
// is written once and skipped when the top-level value exports already wrote
// it; a second is a redefinition. `path.win32.sep` is a *different* global, and
// without its extern the addon reports `use of undeclared identifier 'sep17'`.
//
// The expectation names the emitted line rather than a symbol, because the
// symbol is numbered per program and the line is not.

export * as win32 from "./win32.ts";
