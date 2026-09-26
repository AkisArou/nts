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
//   reset     removing a prop restores GTK's default, not the last value; a
//             removed handler stops firing; text children become a Button's
//             label in the same update that removes its `label` prop
//   enum      an enum prop reaches its setter
//   single    a single-child widget holds its child
//   argument  a signal's argument reaches the handler its prop holds, typed,
//             at the discrete event priority
//   list      a ListBox, which wraps each child in a row: append, insert
//             before, move and remove, in the rows' own order
//   notify    a property changed from GTK's side (an Entry's text, as typing
//             changes it) reaches its onNotify handler with the new value;
//             React's own write of the prop does not
//   decision  a signal whose handler answers whether it handled it: the
//             handler's answer reaches GTK, and with the prop removed the
//             answer is "not handled" without calling the old handler
//
// What the host refuses -- text outside a widget with a label, an unknown
// prop or widget, a second child for a single-child widget -- is an Error
// naming what is wrong. It is not asserted here: nts does not carry those
// throws to a handler in this program yet (a throw from a method of a class
// in another module aborts instead; reported).
//   work      a slice of scheduler work posted to GLib ran
//   timer     a timer fired, and a cancelled one did not

import { gtk_init, GtkWindow, type GtkWidget } from "c:Gtk-4.0";
import { g_main_loop_new } from "c:GLib-2.0";
import { react_gtk_emit, react_gtk_emit_decision, react_gtk_emit_double, react_gtk_log } from "c:react-gtk-shim";
import {
  appendChildToContainer,
  appendInitialChild,
  commitUpdate,
  createInstance,
  getCurrentUpdatePriority,
  GtkContainer,
  hideInstance,
  insertBefore,
  removeChild,
  unhideInstance,
  type HostNode,
  type Props,
} from "../../../packages/react-gtk/src/ReactFiberConfig.ts";
import { BoxNode, ButtonNode, EntryNode, FrameNode, LabelNode, ListBoxNode } from "../../../packages/react-gtk/src/widgets.ts";
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

// The children of a ListBox, as its rows order them, named by the nodes they are.
function rows(list: HostNode, nodes: HostNode[], names: string[]): string {
  if (!(list instanceof ListBoxNode)) {
    return "not a list";
  }
  let out = "";
  for (let i = 0; ; i++) {
    const row = list.gtk.get_row_at_index(i);
    if (row === null) {
      break;
    }
    const child = row.get_child();
    for (let n = 0; n < nodes.length; n++) {
      if (nodes[n]!.widget === child) {
        out += (out === "" ? "" : ",") + names[n]!;
      }
    }
  }
  return out;
}

function frame(node: HostNode): string {
  return node instanceof ButtonNode ? String(node.gtk.get_has_frame()) : "not a button";
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
  react_gtk_log("label " + (label instanceof LabelNode ? String(label.gtk.get_label()) : "not a label"));

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

  const framed = frame(button);
  const unframedProps: Props = { label: "Add", hasFrame: false };
  commitUpdate(button, "GtkButton", secondProps, unframedProps, {});
  const unframed = frame(button);
  clicks = "";
  react_gtk_emit(button.widget, "clicked");
  commitUpdate(button, "GtkButton", unframedProps, { children: "Text" }, {});
  const text = button instanceof ButtonNode ? String(button.gtk.get_label()) : "not a button";
  react_gtk_log("reset " + framed + ">" + unframed + ">" + frame(button) + " clicks=" + (clicks === "" ? "none" : clicks) + " label=" + text);

  const column = createInstance("GtkBox", { orientation: 1 }, container, 0, {});
  react_gtk_log("enum " + (column instanceof BoxNode ? String(column.gtk.get_orientation()) : "not a box"));

  const framing = createInstance("GtkFrame", { label: "f" }, container, 0, {});
  const inner = createInstance("GtkLabel", { label: "inner" }, container, 0, {});
  appendInitialChild(framing, inner);
  const held = framing instanceof FrameNode && framing.gtk.get_child() === inner.widget;
  react_gtk_log("single " + String(held));


  let bounds = "none";
  const scale = createInstance(
    "GtkScale",
    {
      onAdjustBounds: (value: number) => {
        bounds = String(value) + "@" + String(getCurrentUpdatePriority());
      },
    },
    container,
    0,
    {},
  );
  react_gtk_emit_double(scale.widget, "adjust-bounds", 2.5);
  react_gtk_log("argument " + bounds);

  const list = createInstance("GtkListBox", {}, container, 0, {});
  const a = createInstance("GtkLabel", { label: "a" }, container, 0, {});
  const b = createInstance("GtkLabel", { label: "b" }, container, 0, {});
  const c = createInstance("GtkLabel", { label: "c" }, container, 0, {});
  const d = createInstance("GtkLabel", { label: "d" }, container, 0, {});
  const items = [a, b, c, d];
  const labels = ["a", "b", "c", "d"];
  appendInitialChild(list, a);
  appendInitialChild(list, b);
  appendInitialChild(list, c);
  const appended = rows(list, items, labels);
  insertBefore(list, d, b);
  const inserted = rows(list, items, labels);
  insertBefore(list, c, a);
  const moved = rows(list, items, labels);
  removeChild(list, b);
  react_gtk_log("list " + appended + " " + inserted + " " + moved + " " + rows(list, items, labels));

  let typed = "none";
  const entry = createInstance(
    "GtkEntry",
    {
      // The handler first, so that it is connected when `text` is set: it
      // must still not hear React's own write.
      onNotifyText: (value: string) => {
        typed = value;
      },
      text: "a",
    },
    container,
    0,
    {},
  );
  const before = typed;
  if (entry instanceof EntryNode) {
    entry.gtk.set_text("typed");
  }
  react_gtk_log("notify " + before + ">" + typed);

  let asked = 0;
  const closeProps: Props = {
    onCloseRequest: (): boolean => {
      asked++;
      return true;
    },
  };
  const closing = createInstance("GtkWindow", closeProps, container, 0, {});
  const kept = react_gtk_emit_decision(closing.widget, "close-request");
  commitUpdate(closing, "GtkWindow", closeProps, {}, {});
  const released = react_gtk_emit_decision(closing.widget, "close-request");
  react_gtk_log("decision " + String(kept) + " " + String(released) + " asked=" + String(asked));

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
