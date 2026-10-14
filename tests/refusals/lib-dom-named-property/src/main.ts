// expect: emit-c --rc -> emits-c nts_dom_DOMStringMap_named_set(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a name
// lib.dom types through an index signature -- `el.dataset.userId` on
// `DOMStringMap` -- reads through the bound type's `_named_get("userId")` and
// writes through `_named_set("userId", v)`, its name as a constant; a missing
// one reads as `undefined`, as page script's does.
//
// **Kept as a guard from the day it was written (2026-10-07)**: found by
// MainClaude compiling the TodoMVC acceptance target
// (runtime/chromium/benchmarks/workloads/todo-dom.ts, `li.dataset.id`).
//
// Control, one difference: the same program against the generated nts:dom
// module, calling the methods by name (emit-c --rc, clean):
//
//     import { document } from "nts:dom";
//     export function go(): number {
//       const body = document().body;
//       if (body === null) return -1;
//       body.dataset._named_set("id", "7");
//       const id = body.dataset._named_get("id");
//       return id === null ? -1 : Number(id);
//     }

export function go(): number {
  const li = document.createElement("li");
  li.dataset.id = "7";
  const id = li.dataset.id;
  return id === undefined ? -1 : Number(id);
}
