// expect: a value asserted to be an opaque C pointer is not supported by
//         this lowering yet
//
// `event.target as HTMLInputElement` -- TypeScript's usual way to read an
// input's value in a listener -- is refused. Page script erases `as`; a
// compiled program cannot: the binding casts the Blink object to the
// interface the member belongs to, so a wrong assertion would read a
// different object's memory. What would be exact for a right assertion and
// safe for a wrong one is the bound type's check (nts_dom_is, as
// `instanceof` lowers), failing loudly where page script would go on with
// an object of the wrong kind. Found 2026-10-13 by the Chromium lane, in a
// census of common lib.dom idioms.
//
// Control, one difference -- `if (target instanceof HTMLInputElement)`
// narrowing in place of the assertion: nothing refused.
export function listen(): void {
  document.addEventListener("input", (event: Event): void => {
    const target = event.target as HTMLInputElement;
    document.title = target.value;
  });
}
