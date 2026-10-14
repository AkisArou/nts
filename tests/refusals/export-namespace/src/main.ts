// expect: emit-c --napi -> publishes posix
//
// FIXED, kept as a guard. A module re-exported as a name publishes now.
//
// `path` is built out of exactly this -- `export * from "./posix.ts"` for the
// platform's own functions and `export * as posix` / `export * as win32` so both
// are reachable -- which is upstream's structure rather than a choice made here.
//
// # What it was, and the wrong reason it looked hard
//
// It was a fourth thing behind the single message "is not a function this
// backend can name", which had already turned out to cover a value export, a
// class, and a shorthand property. This one was none of those: the thing being
// exported is a module.
//
// The obvious test for one is `SymbolFlags::MODULE`, and it is **`SymbolFlags(0)`**
// for both of `path`'s. Measured: `posix` declares `NodeId(14877)` and `win32`
// declares `NodeId(17028)`, and both of those *are* module root nodes, with no
// flag set on either. So the test is that the symbol's declaration is some
// module's `root` -- which is the stronger claim anyway. A symbol declared by a
// module's root node is that module, whatever a flag says.
//
// # The identity guarantee the old comment worried about
//
// Node wires all four slots to two objects, and the repair that builds a fresh
// namespace object per access satisfies every name while making
// `path.posix.posix === path.posix` false. That is not what happens here: the
// wrapper creates one `napi_value` per namespace in the addon's init and sets it
// on `exports` once, so `path.posix` is a property read of a single object and
// every access is the same one.
//
// # Partial by design
//
// A namespace publishes the members that crossed rather than being withheld
// until all of them do, and each absent member is named -- `posix.format` and
// `posix.matchesGlob` for `path`, one line each. Withholding the whole object
// is a rule the *top level* does not apply to itself: `path` publishes twelve of
// its own exports and declines five, and eight of that module's test files
// dereference `path.win32` before they reach anything else.
//
// An *empty* namespace is still withheld. A name bound to `{}` answers every
// presence check and no call, which is the same wrong-answer shape as a binding
// published as `undefined`.
//
// # What is not carried yet
//
// Value members. `export const sep = "/"` is a global rather than a function and
// the wrapper builds a namespace out of wrappers, so `posix.sep` is absent while
// `path.sep` publishes. That is the next piece and it is a different one.

export * from "./posix.ts";
export * as posix from "./posix.ts";
