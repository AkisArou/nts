// expect: emit-c --rc -> emits-c nts_dom_DOMStringMap_named_get(
//
// The acceptance target for lib.dom.d.ts bound by delegation
// (runtime/chromium/docs/lib-dom.md): TodoMVC as a browser program writes it,
// typed by the stock lib.dom.d.ts with no import,
// runtime/chromium/benchmarks/workloads/todo-dom.ts -- compiled where it lives,
// so this guard follows the file rather than a copy of it.
//
// **Kept as a guard from the day it first compiled (2026-10-07)**: every
// lib.dom use in it lowers to a bound `nts:dom` member, including the syntax
// rows of lib-dom.md's table it uses -- `hidden` through `_set_hidden_boolean`,
// `dataset` through `_named_get`/`_named_set`, `append` through its arms --
// and the emitted C compiles against dom_idl.h with clang. Running it, against
// page script on the same file, is the Chromium lane's benchmark.

export * from "../../../../../runtime/chromium/benchmarks/workloads/todo-dom.ts";
