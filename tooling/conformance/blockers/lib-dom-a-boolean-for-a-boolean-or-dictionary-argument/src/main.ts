// expect: a managed value where C takes a pointer: pass a handle, a `Ptr`,
//         or `null` is not supported by this lowering yet
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md): lib.dom
// declares `importNode(node, options?: boolean | ImportNodeOptions)`, one
// union parameter, where nts:dom declares an overload per arm -- `options` a
// dictionary (`_2_ImportNodeOptions`, first) and a boolean (`_2_boolean`).
// `document.importNode(node, true)` -- how a template's content is cloned into
// the document -- is refused: "a managed value where C takes a pointer".
//
// Why: an argument fits a dictionary parameter whatever its type
// (`arguments_fit` checks strings, handles and numbers, and lets any other
// parameter take anything), so `true` fits both overloads; they are equally
// long, and the first declared is taken -- the dictionary's, with `true` as
// its struct. `scrollIntoView(true)`, the same union, compiles only because
// its dictionary overload also carries an `@ntsThrows` slot its boolean one
// lacks, so the boolean overload is the shorter.
//
// Found by the Chromium lane writing a kanban app against lib.dom
// (2026-10-14).
//
// Fixed, this expectation stops holding; then a guard,
// `emit-c --rc -> emits-c nts_dom_Document_importNode_2_boolean(`.
//
// Control, one difference: the same program against the generated nts:dom
// module, where the checker picks the overload (emit-c --rc, clean, and
// emitting nts_dom_Document_importNode_2_boolean):
//
//     import { document } from "nts:dom";
//     export function go(): number {
//       const list = document().createElement("ul");
//       list.appendChild(document().createElement("li"));
//       return document().importNode(list, true).childNodes.length;
//     }

export function go(): number {
  const list = document.createElement("ul");
  list.appendChild(document.createElement("li"));
  return document.importNode(list, true).childNodes.length;
}
