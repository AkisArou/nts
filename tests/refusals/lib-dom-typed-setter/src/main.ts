// expect: emit-c --rc -> emits-c nts_dom_HTMLElement_set_onclick_null(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// property whose lib.dom type is a union a binding spells as one setter per
// type of value -- `hidden: boolean | "until-found"` -- is written through the
// setter a plain `=` picks by what it assigns: `_set_hidden_boolean`,
// `_set_hidden_string`. An event handler the same way, by the closure's
// result: `_set_onclick_void`, `_set_onclick_boolean`, and `= null` is
// `_set_onclick_null`, which takes no value.
//
// **Kept as a guard from the day it was written (2026-10-07)**: found by
// MainClaude compiling the TodoMVC acceptance target
// (runtime/chromium/benchmarks/workloads/todo-dom.ts, `todo.li.hidden = ...`).
//
// Control, one difference: the same program against the generated nts:dom
// module, calling the setters by name (emit-c --rc, clean):
//
//     import { document } from "nts:dom";
//     export function go(): number {
//       const div = document().body;
//       if (div === null) return -1;
//       div._set_hidden_boolean(true);
//       div._set_hidden_string("until-found");
//       div._set_onclick_void(() => {});
//       div._set_onclick_null();
//       return 0;
//     }

export function go(): number {
  const div = document.createElement("div");
  div.hidden = true;
  div.hidden = "until-found";
  div.onclick = () => {};
  div.onclick = null;
  return 0;
}
