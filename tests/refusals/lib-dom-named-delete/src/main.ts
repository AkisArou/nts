// expect: emit-c --rc -> emits-c nts_dom_DOMStringMap_named_delete(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// `delete` of a name lib.dom types through an index signature --
// `delete el.dataset.userId` -- is the bound type's `_named_delete("userId")`,
// the third of its named-property methods, and evaluates to `true`, as page
// script's always does.
//
// **Kept as a guard from the day it was written (2026-10-07)**, by MainClaude:
// it was "a `delete` of something that is not a stored field".
//
// Control, one difference: the same program against the generated nts:dom
// module, calling the methods by name (emit-c --rc, clean):
//
//     import { document } from "nts:dom";
//     export function go(): number {
//       const body = document().body;
//       if (body === null) return -1;
//       body.dataset._named_set("id", "1");
//       body.dataset._named_delete("id");
//       return body.dataset._named_get("id") === null ? 1 : 0;
//     }

export function go(): number {
  const li = document.createElement("li");
  li.dataset.id = "1";
  const deleted = delete li.dataset.id;
  return deleted && li.dataset.id === undefined ? 1 : 0;
}
