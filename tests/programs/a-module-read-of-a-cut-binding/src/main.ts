// Module evaluation reading a binding whose own statement was cut.
//
// `make` is refused, so excision cuts `const made = make()` and evaluation
// goes on. It went on into `const label = made.label`, which read a `made`
// nothing had assigned: a null, and SIGSEGV while the module loaded -- every
// function here died with it, `control` included. A read of a binding
// evaluation does not assign is now cut with its statement, and what that
// statement assigns goes unwritten in turn (`label`, then `size`), so the
// functions reading them are refused by name and the rest of the module runs.
//
// `control` is the half that must agree: it reads `kept`, which nothing cut
// touches. `labelLength` and `sized` are refused, and say which binding why.

interface Box {
  x: number;
  label: string;
}

function make(): Box {
  const box: Box = { x: 7, label: "seven" };
  Object.defineProperty(box, "hidden", { value: 1 });
  return box;
}

const made = make();
const label = made.label;
const size = label.length * 2;
const kept = [1, 2, 3].length;

export function labelLength(n: number): number {
  return label.length + n;
}

export function sized(n: number): number {
  return size + n;
}

export function control(n: number): number {
  return kept * 10 + n;
}
