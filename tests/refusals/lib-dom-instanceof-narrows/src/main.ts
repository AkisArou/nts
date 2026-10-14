// expect: emit-c --rc -> emits-c nts_dom_HTMLElement_click(
//
// lib.dom.d.ts bound by delegation (runtime/chromium/docs/lib-dom.md):
// `el instanceof HTMLElement` against a class a binding implements asks the
// test the overlay's `@ntsIs` names -- `nts_dom_is(el, id)`, Blink's own
// wrapper-type test, synthesized from the tag and declared by `dom_idl.h` --
// and the branch it guards uses `el` as the `HTMLElement` it was proved to be.
//
// **Kept as a guard from the day it was written (2026-10-07)**: found by
// MainClaude while building the compiler half. lib-dom-instanceof asks the same
// question of `document.firstChild`, which waits on lib.dom's `ChildNode`
// mixin being bound; this one asks it of an `Element`. The emitted C compiles
// against dom_idl.h with clang, prototype and witness both.
//
// Control: none in nts:dom, which has no `instanceof`; there a program asks
// `asHTMLElement(el) !== null`.

export function go(): number {
  const div = document.createElement("div");
  const el: Element = div;
  if (el instanceof HTMLElement) {
    el.click();
    return el.offsetWidth;
  }
  return -1;
}
