// react-gtk's libadwaita group nodes in miniature. A factory, imported and
// handed to a `WidgetSet` at module scope, builds an `AdwGroupNode`, whose base
// `GroupNode` is declared in another module (children.ts) and extends an
// abstract `HostNode` in a third. The factory is called through a function
// value inside a `try`, so it needs a raising copy, and that copy calls
// `GroupNode`'s.
//
// That copy was not made: "`GroupNode#constructor@raises`, which nothing in
// this program defines", and every function on the path was refused. The
// base named through an import was dropped, so `GroupNode`'s construction was
// not known to raise. Bisected by the React lane to 33653912a, which first
// asked for the copy.
import { WidgetSet } from "./host.ts";
import { createNode } from "./widgets.ts";

export const adw: WidgetSet = new WidgetSet("adw", createNode);

function make(type: string): number {
  try {
    const node = adw.make(type);
    return node === null ? 0 : node.type.length;
  } catch (error) {
    return -1;
  }
}

// 5 for a group made, -1 for an unknown one caught, 0 for no group at all.
export function made(n: number): number {
  const kind = Math.abs(n) % 3;
  return make(kind === 0 ? "Start" : kind === 1 ? "Other" : "Box");
}
