// **Ours, not upstream's: react-gtk's libadwaita group nodes in miniature.** A
// factory, imported and handed to a WidgetSet at module scope, builds an
// `AdwGroupNode`, whose base `GroupNode` is declared in another module
// (children.ts) and extends an abstract `HostNode` in a third. The factory is
// called through a function value inside a `try`, so it needs a raising copy,
// and that copy calls `GroupNode#constructor@raises`, "which nothing in this
// program defines". Every function on that path is refused, and the program
// ends where node answers.
//
// Bisected by the React lane (9533b3a5e good, 46168ddfb bad) to 33653912a, "A
// function used as a value carries its throw, overloaded or imported": before
// it, the call aborted at run time for want of any raising copy.
//
// The control differs in one thing and agrees: the same program with
// `GroupNode` declared in adwchildren.ts, beside `AdwGroupNode`, prints
// `Start caught none` on 33653912a and on main. The two cannot share a file,
// since the difference is which module declares the base.
//
// **Expected, confirmed under node:**
//
//     made     Start caught none
import { WidgetSet } from "./host.ts";
import { createNode } from "./widgets.ts";

export const adw: WidgetSet = new WidgetSet("adw", createNode);

function make(type: string): string {
  try {
    const node = adw.make(type);
    return node === null ? "none" : node.type;
  } catch (error) {
    return "caught";
  }
}

observe("made", make("Start") + " " + make("Other") + " " + make("Box"));
done();
