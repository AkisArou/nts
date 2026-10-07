// expect: emit-c --rc -> emits-c nts_dom_Element_append_nn(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): a
// lib.dom member a binding spells as several C functions is the one whose
// parameters fit the call. `append(...nodes: (Node | string)[])` is eight
// `nts:dom` overloads of `append`, one per arity and arm --
// `nts_dom_Element_append_nn` for two nodes, `_s` for one string.
//
// **Kept as a guard from the day it was written (2026-10-07)**: found by
// MainClaude compiling the TodoMVC acceptance target
// (runtime/chromium/benchmarks/workloads/todo-dom.ts, `header.append(title,
// entry)`). The snapshot keeps one signature per member, the first overload's,
// so each overload's is read from its own parameters. Its calls are the
// control's, at the control's arities.
//
// Control, one difference: the same program against the generated nts:dom
// module, where the checker picks the overload (emit-c --rc, clean):
//
//     import { document } from "nts:dom";
//     export function go(): number {
//       const h = document().createElement("h1");
//       const i = document().createElement("input");
//       h.append(h, i);
//       h.append("x");
//       return 0;
//     }

export function go(): number {
  const h = document.createElement("h1");
  const i = document.createElement("input");
  h.append(h, i);
  h.append("x");
  return 0;
}
