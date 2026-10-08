// expect: NTS1001 a base `HTMLElement` of unrepresentable type (an opaque C pointer to NtsDomHTMLElement)
//
// A class extending a host class -- the custom element idiom, `class Counter
// extends HTMLElement`, which customElements.define registers -- is refused:
// the base is a handle, and a class here extends only classes the program
// defines. Blink would make the element and call the program's constructor
// with it; the program's object would hold its element and reach every
// inherited member through it. Request 13 in
// runtime/chromium/contracts/compiler-requests.md. Found 2026-10-08 by the
// Chromium lane: 39 [HTMLConstructor] members and customElements wait on it.
//
// Control, one difference -- `extends HTMLElement` left out (the class then
// defines `count` alone): nothing refused.
class Counter extends HTMLElement {
  count = 0;
}
export function countOf(counter: Counter): number {
  return counter.count;
}
