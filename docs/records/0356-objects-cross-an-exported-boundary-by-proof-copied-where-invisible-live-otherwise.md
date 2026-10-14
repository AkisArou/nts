# 0356 — Objects cross an exported boundary by proof: copied where invisible, live otherwise

**Decided 2026-10-14, by the user, on the compiler lane's proposal.** Applies to
every exported boundary: a Node addon's N-API entry layer and a WebAssembly
module's JavaScript glue, which answer it with the same rule.

## The question

A program nts compiles is published as an artifact -- a `.node` addon on npm, a
Wasm module -- and called by someone who never uses nts: plain JavaScript,
`require("./fast.node").area({ w: 3, h: 4 })`. Inside nts an object is a native
struct and a field read is one load. The caller's object lives in the engine's
heap, and native code reaches it only through the engine (N-API, or imported
glue), at tens of nanoseconds per property. Until now every object, array or
function argument at an export was refused by name (`docs/wasm.md` M1: never
silently copy). That blocked node's `events`, `stream` and `net` (their option
bags), and about a dozen Wasm census rows.

The caller is not bound by our types. They may pass a wrong type, `null`, a
Proxy, an object with getters, an object they keep and change later. Whatever
crosses must answer as the same TypeScript would in JavaScript, for any caller.

## The decision

The compiler chooses, per exported parameter, from what it proves about the
compiled function -- never from a guess about the caller:

1. **Copied in** where a copy cannot be noticed: the function does not keep the
   object past the call, does not write it, does not compare its identity, does
   not read it after control can re-enter JavaScript, and reads each copied
   field on every path (a getter runs when it is read, so a field read only on
   some paths is not copied). One engine read per copied field per call, then
   native loads. This is the common case -- an options object read once.
2. **A live reference** otherwise: the native side holds a handle to the
   caller's object, and each field read or write goes through the engine at the
   moment the code performs it. Always exact; costs an engine call per access.
3. **A wrapper** for an object nts created (a class instance returned to
   JavaScript): one cached JavaScript wrapper per native object, so identity
   holds; passing it back in unwraps to the same native pointer at no cost.
4. **Borrowed** for a typed array: the native side reads the caller's own
   bytes, no copy.
5. **A function reference** for a function argument: held, and each call goes
   through the engine.

**Never a silent copy.** A value whose crossing the compiler cannot prove one of
these for is refused by name, as before.

**Argument types are checked at the entry.** The TypeScript signature is the
published contract: a value that is not what it declares -- a string where a
number is declared, `null` where it is not admitted -- throws a `TypeError`
naming the parameter, as node's own APIs throw `ERR_INVALID_ARG_TYPE`. Not
coerced: what JavaScript would have done with a wrong type depends on how the
body uses it, which the entry cannot reproduce.

## Why this and not the alternatives

- **Copy everything** is fastest and wrong: node's `net.Server` keeps its options
  object and reads it on every connection, so a copy freezes what the caller
  may still change. N-API leaves this choice to each addon author by hand; most
  copy at entry, which is the same bug waiting.
- **Everything live** is exact and slow in the common case: an options object
  read once would pay an engine call per field per access instead of once.
- **Opaque handles instead of wrappers** for class instances would keep identity
  but leave JavaScript unable to read a field or call a method naturally.

Measured by CompilerHelper's audit (`docs/node-api-object-inputs.md` on
`compiler/constructor-object`, 036253b8b): `EventEmitter` reads its options once
(copy); `stream` keeps callbacks and signals and rereads options after a
construction callback, and `net.Server` keeps the whole object (live).

## Order of work

1. The proof, in core, as a per-parameter crossing on the exported signature --
   one fact both backends read. Copy-in, wrappers and function references on
   N-API, with the entry's type checks. Unblocks `events` and `assert`.
2. Live references: a second object representation inside the compiler, the
   larger piece. Unblocks `net` and `stream`.
3. The WebAssembly glue answers the same crossings with its own means: an
   `externref` read through imported getters for a live reference, and its GC
   objects -- already opaque, identity-preserving JavaScript values -- wrapped
   for property access.
