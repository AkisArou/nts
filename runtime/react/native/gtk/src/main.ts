// react-gtk's host config, driven directly on real GTK widgets: what the
// reconciler will ask of it, before the reconciler compiles natively. Each
// line it logs is one observable fact, and build.sh compares the log whole.
//
//   tree      a Box holding a Label (its text from its children) and a Button
//   clicked   the button's signal ran the handler its props hold, at the
//             discrete event priority, and the priority was restored after
//   rebound   after an update with a new closure the click runs the new one,
//             not the old: the signal is connected once
//   label     an update to the Label's text children
//   inserted  a Label inserted before the Button, in GTK's own child order
//   moved     the Button moved before the first Label: a reorder, not an add
//   removed   a Label removed
//   hidden    hidden and shown again, as Suspense does
//   work      a slice of scheduler work posted to GLib ran
//   timer     a timer fired, and a cancelled one did not

import { gtk_init, GtkWindow, type GtkWidget } from "c:Gtk-4.0";
import { g_main_loop_new } from "c:GLib-2.0";
import { react_gtk_emit, react_gtk_log } from "c:react-gtk-shim";
import {
  appendChildToContainer,
  appendInitialChild,
  commitUpdate,
  createInstance,
  getCurrentUpdatePriority,
  GtkContainer,
  hideInstance,
  insertBefore,
  LabelNode,
  removeChild,
  unhideInstance,
  type HostNode,
  type Props,
} from "../../../packages/react-gtk/src/ReactFiberConfig.ts";
import { bindPerformWork, cancelTimer, postWork, startTimer } from "../../../packages/react-gtk/src/SchedulerHost.ts";

// The children of `parent`, as GTK orders them, named by the nodes they are.
function order(parent: HostNode, nodes: HostNode[], names: string[]): string {
  let out = "";
  let child: GtkWidget | null = parent.widget.get_first_child();
  while (child !== null) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i]!.widget === child) {
        out += (out === "" ? "" : ",") + names[i]!;
      }
    }
    child = child.get_next_sibling();
  }
  return out;
}

function main(): void {
  gtk_init();
  const container = new GtkContainer(new GtkWindow());
  const root = createInstance("GtkBox", { spacing: 6 }, container, 0, {});
  const label = createInstance("GtkLabel", { children: "hello" }, container, 0, {});
  let clicks = "";
  const firstProps: Props = {
    label: "Add",
    onClicked: () => {
      clicks += "first@" + String(getCurrentUpdatePriority()) + " ";
    },
  };
  const button = createInstance("GtkButton", firstProps, container, 0, {});
  appendInitialChild(root, label);
  appendInitialChild(root, button);
  appendChildToContainer(container, root);
  const nodes = [label, button];
  const names = ["label", "button"];
  react_gtk_log("tree " + order(root, nodes, names));

  react_gtk_emit(button.widget, "clicked");
  react_gtk_log("clicked " + clicks + "after@" + String(getCurrentUpdatePriority()));

  clicks = "";
  const secondProps: Props = {
    label: "Add",
    onClicked: () => {
      clicks += "second ";
    },
  };
  commitUpdate(button, "GtkButton", firstProps, secondProps, {});
  react_gtk_emit(button.widget, "clicked");
  react_gtk_log("rebound " + clicks.trim());

  commitUpdate(label, "GtkLabel", { children: "hello" }, { children: "world" }, {});
  react_gtk_log("label " + (label instanceof LabelNode ? String(label.label.get_label()) : "not a label"));

  const second = createInstance("GtkLabel", { label: "second" }, container, 0, {});
  nodes.push(second);
  names.push("second");
  insertBefore(root, second, button);
  react_gtk_log("inserted " + order(root, nodes, names));

  insertBefore(root, button, label);
  react_gtk_log("moved " + order(root, nodes, names));

  removeChild(root, label);
  react_gtk_log("removed " + order(root, nodes, names));

  hideInstance(button);
  const hidden = button.widget.get_visible();
  unhideInstance(button, secondProps);
  react_gtk_log("hidden " + String(hidden) + " " + String(button.widget.get_visible()));

  const loop = g_main_loop_new(null, false);
  let ran = "";
  bindPerformWork(() => {
    ran += "work ";
  });
  postWork();
  const cancelled = startTimer(() => {
    ran += "cancelled ";
  }, 5);
  cancelTimer(cancelled);
  startTimer(() => {
    ran += "timer ";
    loop.quit();
  }, 20);
  loop.run();
  react_gtk_log(ran.trim());
}

main();
