// expect: emit-c --rc -> emits-c Closure0__call(
//
// **FIXED 2026-10-07, kept as a guard** (MainClaude; reported and reduced by
// the Chromium lane): the second shape of a-captured-let-read-after-a-bound-
// for-each. `visited`, a frame cell carried through the inlined walk's block
// parameters, is passed straight to a closure, so the cell's string is loaded
// through the parameter and retained for the call -- and the cell's field was
// given back between the load and the retain: `v61 = v42->value;
// nts_release(v26->value); nts_retain(v61)`. The retain path of the last-use
// scan looked only at the load's container, not at the frame cell it names;
// it reads every name for a frame object now (`rc::reads_of`). On a page the
// line came back as its own prefix, the freed block reused by `log`'s concat.
//
// As with the first shape, the emitted text cannot say "before", so this
// guards compiling; the Chromium lane's live-list vector checks the run.
// Control, one difference: without `const root`, the retain came first.

export function go(ul: HTMLUListElement): string {
  const lines: string[] = [];
  const log = (label: string, value: string): void => {
    lines.push(label + "=" + value);
  };
  const root = document.createElement("section");
  let visited = "";
  ul.childNodes.forEach((child: ChildNode): void => {
    visited += "," + child.textContent;
  });
  log("x", visited);
  return lines.join("\n") + root.childElementCount;
}
