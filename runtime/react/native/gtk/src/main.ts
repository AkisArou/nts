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
//   controlled  a controlled Entry's text, changed by the user: put back to
//             the props' value when the app keeps it, kept when the app's
//             flush commits it, without passing through the old value on the
//             way (the flush is stubbed: no reconciler here)
//   object    an object the app makes (a Scale's adjustment) passes through the
//             props as itself, and the widget holds that object
//   reference a widget named by another widget's prop (a Label's mnemonic
//             widget), passed as a ref's `current` is: the other node's widget
//   decision  a signal whose handler answers whether it handled it: the
//             handler's answer reaches GTK, and with the prop removed the
//             answer is "not handled" without calling the old handler
//   slot      slot elements fill a Paned's start and end children, their
//             children placed first as React completes them; a child removed
//             from its slot element empties the slot, and so does the slot
//             element removed from the Paned. A Frame's label widget comes
//             from a slot element after its child, which React inserts before
//             the slot element
//
// What the host refuses -- text outside a widget with a label, an unknown
// prop or widget, a second child for a single-child widget -- is an Error
// naming what is wrong. It is not asserted here: nts does not carry those
// throws to a handler in this program yet (a throw from a method of a class
// in another module aborts instead; reported).
//   work      a slice of scheduler work posted to GLib ran
//   timer     a timer fired, and a cancelled one did not

import { gtk_init, GtkAdjustment, GtkWindow, type GtkWidget } from "c:Gtk-4.0";
import { g_main_context_iteration, g_main_loop_new } from "c:GLib-2.0";
import { react_gtk_emit, react_gtk_emit_decision, react_gtk_emit_double, react_gtk_log } from "c:react-gtk-shim";
import {
  appendChildToContainer,
  appendInitialChild,
  commitUpdate,
  createInstance,
  getCurrentUpdatePriority,
  getPublicInstance,
  GtkContainer,
  hideInstance,
  insertBefore,
  removeChild,
  unhideInstance,
  type HostNode,
  type Props,
} from "../../../packages/react-gtk/src/ReactFiberConfig.ts";
import { setAfterEvent } from "../../../packages/react-gtk/src/HostNode.ts";
import { BoxNode, ButtonNode, EntryNode, FrameNode, LabelNode, ListBoxNode, PanedNode, ScaleNode } from "../../../packages/react-gtk/src/widgets.ts";
import { bindPerformWork, cancelTimer, postWork, startTimer } from "../../../packages/react-gtk/src/SchedulerHost.ts";

// The widget a node shows: what a ref to it holds.
function widget(node: HostNode): GtkWidget {
  return getPublicInstance(node);
}

// The children of `parent`, as GTK orders them, named by the nodes they are.
function order(parent: HostNode, nodes: HostNode[], names: string[]): string {
  let out = "";
  let child: GtkWidget | null = widget(parent).get_first_child();
  while (child !== null) {
    for (let i = 0; i < nodes.length; i++) {
      if (widget(nodes[i]!) === child) {
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
      if (widget(nodes[n]!) === child) {
        out += (out === "" ? "" : ",") + names[n]!;
      }
    }
  }
  return out;
}

// Runs what the main loop has ready: controlled props are put back from it.
function idle(): void {
  while (g_main_context_iteration(null, false)) {
    // until nothing is ready
  }
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

  react_gtk_emit(widget(button), "clicked");
  react_gtk_log("clicked " + clicks + "after@" + String(getCurrentUpdatePriority()));

  clicks = "";
  const secondProps: Props = {
    label: "Add",
    onClicked: () => {
      clicks += "second ";
    },
  };
  commitUpdate(button, "GtkButton", firstProps, secondProps, {});
  react_gtk_emit(widget(button), "clicked");
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
  const hidden = widget(button).get_visible();
  unhideInstance(button, secondProps);
  react_gtk_log("hidden " + String(hidden) + " " + String(widget(button).get_visible()));

  const framed = frame(button);
  const unframedProps: Props = { label: "Add", hasFrame: false };
  commitUpdate(button, "GtkButton", secondProps, unframedProps, {});
  const unframed = frame(button);
  clicks = "";
  react_gtk_emit(widget(button), "clicked");
  commitUpdate(button, "GtkButton", unframedProps, { children: "Text" }, {});
  const text = button instanceof ButtonNode ? String(button.gtk.get_label()) : "not a button";
  react_gtk_log("reset " + framed + ">" + unframed + ">" + frame(button) + " clicks=" + (clicks === "" ? "none" : clicks) + " label=" + text);

  const column = createInstance("GtkBox", { orientation: 1 }, container, 0, {});
  react_gtk_log("enum " + (column instanceof BoxNode ? String(column.gtk.get_orientation()) : "not a box"));

  const framing = createInstance("GtkFrame", { label: "f" }, container, 0, {});
  const inner = createInstance("GtkLabel", { label: "inner" }, container, 0, {});
  appendInitialChild(framing, inner);
  const held = framing instanceof FrameNode && framing.gtk.get_child() === widget(inner);
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
  react_gtk_emit_double(widget(scale), "adjust-bounds", 2.5);
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
  idle();

  const entryText = (node: HostNode): string => (node instanceof EntryNode ? node.gtk.get_text() : "not an entry");
  // The app keeps its state: nothing is flushed, so the text goes back.
  setAfterEvent(() => {});
  const heldEntry = createInstance("GtkEntry", { text: "a" }, container, 0, {});
  if (heldEntry instanceof EntryNode) {
    heldEntry.gtk.set_text("typed");
  }
  idle();
  const rejected = entryText(heldEntry);
  // The app takes the new text: its flush commits it, so it stays.
  let taken = "";
  const acceptProps: Props = {
    text: "a",
    onNotifyText: (value: string) => {
      taken = value;
    },
  };
  const accepting = createInstance("GtkEntry", acceptProps, container, 0, {});
  setAfterEvent(() => {
    commitUpdate(accepting, "GtkEntry", acceptProps, { text: taken, onNotifyText: acceptProps["onNotifyText"] }, {});
  });
  // Whether the accepted text ever showed the old one on its way: the
  // restore runs after the flush, so it must not.
  let flashed = false;
  if (accepting instanceof EntryNode) {
    accepting.gtk.set_text("typed");
    const widget = accepting.gtk;
    widget.connect("notify::text", () => {
      if (widget.get_text() === "a") {
        flashed = true;
      }
    });
  }
  idle();
  setAfterEvent(() => {});
  react_gtk_log("controlled " + rejected + " " + entryText(accepting) + " flashed=" + String(flashed));

  const adjustment = new GtkAdjustment();
  adjustment.set_upper(100);
  adjustment.set_value(42);
  const scaled = createInstance("GtkScale", { adjustment }, container, 0, {});
  const holds = scaled instanceof ScaleNode && scaled.gtk.get_adjustment() === adjustment;
  const at = scaled instanceof ScaleNode ? scaled.gtk.get_value() : -1;
  react_gtk_log("object " + String(holds) + " " + String(at));

  const target = createInstance("GtkEntry", {}, container, 0, {});
  const naming = createInstance("GtkLabel", { label: "_Name", useUnderline: true, mnemonicWidget: widget(target) }, container, 0, {});
  react_gtk_log("reference " + String(naming instanceof LabelNode && naming.gtk.get_mnemonic_widget() === widget(target)));

  let asked = 0;
  const closeProps: Props = {
    onCloseRequest: (): boolean => {
      asked++;
      return true;
    },
  };
  const closing = createInstance("GtkWindow", closeProps, container, 0, {});
  const kept = react_gtk_emit_decision(widget(closing), "close-request");
  commitUpdate(closing, "GtkWindow", closeProps, {}, {});
  const released = react_gtk_emit_decision(widget(closing), "close-request");
  react_gtk_log("decision " + String(kept) + " " + String(released) + " asked=" + String(asked));

  const paned = createInstance("GtkPaned", {}, container, 0, {});
  const startSlot = createInstance("GtkPaned.StartChild", {}, container, 0, {});
  const endSlot = createInstance("GtkPaned.EndChild", {}, container, 0, {});
  const side = createInstance("GtkLabel", { label: "side" }, container, 0, {});
  const content = createInstance("GtkButton", { label: "main" }, container, 0, {});
  const nameOf = (child: GtkWidget | null): string =>
    child === null ? "none" : child === widget(side) ? "side" : child === widget(content) ? "main" : "other";
  const ends = (): string =>
    paned instanceof PanedNode ? nameOf(paned.gtk.get_start_child()) + "," + nameOf(paned.gtk.get_end_child()) : "not a paned";
  appendInitialChild(startSlot, side);
  appendInitialChild(endSlot, content);
  appendInitialChild(paned, startSlot);
  appendInitialChild(paned, endSlot);
  let slots = ends();
  removeChild(endSlot, content);
  slots += " " + ends();
  removeChild(paned, startSlot);
  slots += " " + ends();
  const titled = createInstance("GtkFrame", {}, container, 0, {});
  const titleSlot = createInstance("GtkFrame.LabelWidget", {}, container, 0, {});
  const title = createInstance("GtkLabel", { label: "Title" }, container, 0, {});
  const body = createInstance("GtkLabel", { label: "body" }, container, 0, {});
  appendInitialChild(titleSlot, title);
  appendInitialChild(titled, titleSlot);
  insertBefore(titled, body, titleSlot);
  const labelled =
    titled instanceof FrameNode && titled.gtk.get_child() === widget(body) && titled.gtk.get_label_widget() === widget(title);
  react_gtk_log("slot " + slots + " titled=" + String(labelled));

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
