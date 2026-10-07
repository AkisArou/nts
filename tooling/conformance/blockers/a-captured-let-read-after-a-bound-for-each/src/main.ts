// expect: emit-c --rc -> emits-c nts_concat(
//
// **FIXED 2026-10-07, kept as a guard** (MainClaude; reported and reduced by
// the Chromium lane): under reference counting, `visited + " left "` read a
// string already given back. `let visited` is captured by the `forEach`
// callback, so it is a frame cell; the inlined walk carries the cell through
// block parameters; and at the walk's exit the cell's string was released on
// entry to the block, before the concat read it through the parameter --
// `v70 = v22->value; nts_release(v70); v56 = v38->value; nts_concat(v56, ...)`,
// v38 being v22 carried. Liveness kept the cell live into that block through
// its names (`object_names`); the release inside the block looked only for a
// read of the cell itself, and the load through the name was read borrowed.
// It reads every name for a frame object as a read of the object now
// (`rc::frame_names`). On a page it printed " -remo" for ",a,b left ", bytes
// of another literal.
//
// The emitted text cannot say "after" with temporaries' names in it, so the
// expectation only says the program still compiles; the order is checked by
// the Chromium lane's live-list vector against V8. Control, one difference:
// without `const root`, an owned handle local across the function, the read
// came first and the release at the return.

export function go(ul: HTMLUListElement): string {
  const root = document.createElement("section");
  let visited = "";
  ul.childNodes.forEach((child: ChildNode): void => {
    visited += "," + child.textContent;
  });
  const result = visited + " left ";
  return result + root.childElementCount;
}
