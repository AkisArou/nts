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
//   input     input props add event controllers: a key handler's answer
//             reaches GTK (Escape handled, a letter not), a double click
//             reaches its handler with its count, a second key prop shares
//             the one key controller, and with the key prop removed a key is
//             not handled and the old handler is not called
//   classes   a list-of-strings prop (cssClasses) sets the widget's CSS
//             classes; an update replaces them, and removing the prop
//             clears them
//   interface a prop typed as a GObject interface (a ListView's selection
//             model, a DropDown's list model) takes each class that
//             implements it, as itself; one that does not (an adjustment)
//             leaves the model unset
//   grid      Grid.Child elements attach their children at their cells; a
//             child element whose column changes moves its child; one
//             removed takes its child out
//   stack     Stack.Page elements add named, titled pages; the Stack's
//             visibleChildName, applied before its pages existed, shows the
//             page it names; a page's title updates in place
//   switched  a Stack's visibleChildName is controlled: switched by the user
//             (as a StackSwitcher does) it goes back to the page its props
//             name when the app keeps its state; a Stack without the prop
//             keeps what the user chose
//   notebook  Notebook.Page elements add pages with tab text, one inserted
//             before another takes its place in the order; moved back and to
//             the end, pages keep the current one; one removed goes; one
//             whose child arrives after the pages behind it goes before them
//   bar       a HeaderBar's Start and End groups pack their children left to
//             right in React's order (the end packed from the edge in); one
//             inserted before another takes its place, one removed goes
//   overlay   an Overlay holds its main child as its one child and an
//             Overlay.Layer's child over it; the layer's `measure` updates in
//             place; a second layer is drawn over it, moved under it and
//             back; the layer removed leaves the Overlay
//   fixed     a Fixed.Child puts its child at its position and moves it
//   window    a Window rendered inside the tree is a toplevel, not a child:
//             placed in a Box it is not parented or shown; at commit it is
//             presented over the root's window; taken out, it is destroyed
//   popover   a Popover rendered in a Box is attached to it (set_parent), not
//             placed among its children; taken out, it is detached. Popping
//             it up is GTK's, and this display cannot: under Xvfb with no
//             focus, showing any popover is a GTK critical, in plain C too
//   application  an application's root: an ApplicationWindow rendered there
//             asks for a commit mount, joins the application and is shown at
//             commit, and taken out it leaves the application
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

import { GdkRectangle, GdkRGBA } from "c:Gdk-4.0";
import { ApplicationFlags } from "c:Gio-2.0";
import {
  gtk_init,
  GtkAdjustment,
  GtkApplication,
  GtkEventControllerKey,
  GtkGestureClick,
  GtkSingleSelection,
  GtkStringList,
  GtkWindow,
  type GtkWidget,
} from "c:Gtk-4.0";
import { g_main_context_iteration, g_main_loop_new } from "c:GLib-2.0";
import type { GObject } from "c:GObject-2.0";
import {
  react_gtk_emit,
  react_gtk_emit_decision,
  react_gtk_emit_double,
  react_gtk_emit_key_pressed,
  react_gtk_emit_pressed,
  react_gtk_log,
} from "c:react-gtk-shim";
import {
  ApplicationRoot,
  appendChild,
  appendChildToContainer,
  appendInitialChild,
  commitMount,
  commitUpdate,
  createInstance,
  finalizeInitialChildren,
  getCurrentUpdatePriority,
  getPublicInstance,
  WindowRoot,
  hideInstance,
  insertBefore,
  removeChild,
  removeChildFromContainer,
  unhideInstance,
  type HostNode,
  type Props,
} from "../../../packages/react-gtk/src/ReactFiberConfig.ts";
import { setAfterEvent } from "../../../packages/react-gtk/src/HostNode.ts";
import {
  BoxNode,
  ButtonNode,
  ColorDialogButtonNode,
  DropDownNode,
  EntryNode,
  FixedNode,
  FrameNode,
  GridNode,
  LabelNode,
  ListBoxNode,
  ListViewNode,
  NotebookNode,
  OverlayNode,
  PanedNode,
  PopoverNode,
  ScaleNode,
  StackNode,
  WindowNode,
} from "../../../packages/react-gtk/src/widgets.ts";
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
  const container = new WindowRoot(new GtkWindow(), []);
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

  // A boxed record as a prop: the app's colour reaches the widget, a new one
  // replaces it, and a nullable one is cleared when its prop goes away. The
  // popover is attached, as an app's is: with no rectangle, GTK reads where it
  // points from its parent.
  const red = new GdkRGBA();
  red.parse("#ff0000");
  const blue = new GdkRGBA();
  blue.parse("#0000ff");
  const colour = createInstance("GtkColorDialogButton", { rgba: red }, container, 0, {});
  const shade = (): string => (colour instanceof ColorDialogButtonNode ? colour.gtk.get_rgba().to_string() : "none");
  const first = shade();
  commitUpdate(colour, "GtkColorDialogButton", { rgba: red }, { rgba: blue }, {});
  const pointed = createInstance("GtkPopover", { pointingTo: new GdkRectangle() }, container, 0, {});
  const pointedFrom = createInstance("GtkButton", {}, container, 0, {});
  appendInitialChild(pointedFrom, pointed);
  const pointing = (): boolean => pointed instanceof PopoverNode && pointed.gtk.get_pointing_to()[0];
  const wasPointing = pointing();
  commitUpdate(pointed, "GtkPopover", { pointingTo: new GdkRectangle() }, {}, {});
  const stillPointing = pointing();
  removeChild(pointedFrom, pointed);
  react_gtk_log("boxed " + first + ">" + shade() + " " + String(wasPointing) + ">" + String(stillPointing));

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

  let heard = "";
  const inputProps: Props = {
    onKeyPressed: (keyval: number): boolean => {
      heard += String(keyval) + " ";
      return keyval === 65307;
    },
    onClickPressed: (nPress: number) => {
      heard += "click" + String(nPress) + " ";
    },
  };
  const listening = createInstance("GtkBox", inputProps, container, 0, {});
  const controllersOf = (kind: string): GObject[] => {
    const found: GObject[] = [];
    const list = widget(listening).observe_controllers();
    for (let i = 0; i < list.get_n_items(); i++) {
      const item = list.get_item(i);
      if ((kind === "key" && item instanceof GtkEventControllerKey) || (kind === "click" && item instanceof GtkGestureClick)) {
        found.push(item);
      }
    }
    return found;
  };
  const keyController = controllersOf("key")[0]!;
  const escape = react_gtk_emit_key_pressed(keyController, 65307, 9, 0);
  const letter = react_gtk_emit_key_pressed(keyController, 97, 38, 0);
  react_gtk_emit_pressed(controllersOf("click")[0]!, 2, 1, 2);
  const withReleased: Props = { onKeyPressed: inputProps["onKeyPressed"], onKeyReleased: () => {} };
  commitUpdate(listening, "GtkBox", inputProps, withReleased, {});
  const keyControllers = controllersOf("key").length;
  commitUpdate(listening, "GtkBox", withReleased, {}, {});
  const unhandled = react_gtk_emit_key_pressed(keyController, 65307, 9, 0);
  react_gtk_log(
    "input " + String(escape) + " " + String(letter) + " " + heard.trim() + " keys=" + String(keyControllers) + " after=" + String(unhandled),
  );

  const styled = createInstance("GtkButton", { cssClasses: ["suggested-action", "pill"] }, container, 0, {});
  const hasClass = (name: string): string => String(widget(styled).has_css_class(name));
  let styling = hasClass("suggested-action") + " " + hasClass("pill");
  commitUpdate(styled, "GtkButton", { cssClasses: ["suggested-action", "pill"] }, { cssClasses: ["pill"] }, {});
  styling += ">" + hasClass("suggested-action") + " " + hasClass("pill");
  commitUpdate(styled, "GtkButton", { cssClasses: ["pill"] }, {}, {});
  styling += ">" + hasClass("pill");
  react_gtk_log("classes " + styling);

  const strings = new GtkStringList();
  strings.append("one");
  const selection = new GtkSingleSelection({ model: strings });
  const listed = createInstance("GtkListView", { model: selection }, container, 0, {});
  const dropped = createInstance("GtkDropDown", { model: strings }, container, 0, {});
  const refused = createInstance("GtkListView", { model: new GtkAdjustment() }, container, 0, {});
  react_gtk_log(
    "interface " +
      String(listed instanceof ListViewNode && listed.gtk.get_model() === selection) +
      " " +
      String(dropped instanceof DropDownNode && dropped.gtk.get_model() === strings) +
      " " +
      String(refused instanceof ListViewNode && refused.gtk.get_model() === null),
  );

  const grid = createInstance("GtkGrid", {}, container, 0, {});
  const cellA = createInstance("GtkGrid.Child", { column: 0, row: 0 }, container, 0, {});
  const cellB = createInstance("GtkGrid.Child", { column: 1, row: 0 }, container, 0, {});
  const inA = createInstance("GtkLabel", { label: "a" }, container, 0, {});
  const inB = createInstance("GtkLabel", { label: "b" }, container, 0, {});
  appendInitialChild(cellA, inA);
  appendInitialChild(cellB, inB);
  appendInitialChild(grid, cellA);
  appendInitialChild(grid, cellB);
  const cellAt = (column: number): string => {
    if (!(grid instanceof GridNode)) {
      return "not a grid";
    }
    const child = grid.gtk.get_child_at(column, 0);
    return child === null ? "-" : child === widget(inA) ? "a" : child === widget(inB) ? "b" : "?";
  };
  let cells = cellAt(0) + cellAt(1) + cellAt(2);
  commitUpdate(cellB, "GtkGrid.Child", { column: 1, row: 0 }, { column: 2, row: 0 }, {});
  cells += " " + cellAt(0) + cellAt(1) + cellAt(2);
  removeChild(grid, cellA);
  cells += " " + cellAt(0) + cellAt(1) + cellAt(2);
  react_gtk_log("grid " + cells);

  const stack = createInstance("GtkStack", { visibleChildName: "b" }, container, 0, {});
  const pageA = createInstance("GtkStack.Page", { name: "a", title: "A" }, container, 0, {});
  const pageB = createInstance("GtkStack.Page", { name: "b", title: "B" }, container, 0, {});
  const onA = createInstance("GtkLabel", { label: "a" }, container, 0, {});
  const onB = createInstance("GtkLabel", { label: "b" }, container, 0, {});
  appendInitialChild(pageA, onA);
  appendInitialChild(pageB, onB);
  appendInitialChild(stack, pageA);
  appendInitialChild(stack, pageB);
  const titleOfB = (): string => (stack instanceof StackNode ? String(stack.gtk.get_page(widget(onB)).get_title()) : "not a stack");
  const shown = stack instanceof StackNode ? String(stack.gtk.get_visible_child_name()) : "not a stack";
  const titleBefore = titleOfB();
  commitUpdate(pageB, "GtkStack.Page", { name: "b", title: "B" }, { name: "b", title: "Bee" }, {});
  react_gtk_log("stack " + shown + " " + titleBefore + " " + titleOfB());

  const free = createInstance("GtkStack", {}, container, 0, {});
  for (const name of ["a", "b"]) {
    const page = createInstance("GtkStack.Page", { name }, container, 0, {});
    appendInitialChild(page, createInstance("GtkLabel", { label: name }, container, 0, {}));
    appendInitialChild(free, page);
  }
  const visibleIn = (node: HostNode): string => (node instanceof StackNode ? String(node.gtk.get_visible_child_name()) : "not a stack");
  // The app keeps its state: nothing is flushed, so the controlled one goes back.
  setAfterEvent(() => {});
  if (stack instanceof StackNode) {
    stack.gtk.set_visible_child_name("a");
  }
  if (free instanceof StackNode) {
    free.gtk.set_visible_child_name("b");
  }
  idle();
  react_gtk_log("switched " + visibleIn(stack) + " " + visibleIn(free));

  const notebook = createInstance("GtkNotebook", {}, container, 0, {});
  const tabs: HostNode[] = [];
  const pages: HostNode[] = [];
  for (const tab of ["one", "two", "three"]) {
    const page = createInstance("GtkNotebook.Page", { tab }, container, 0, {});
    const content = createInstance("GtkLabel", { label: tab }, container, 0, {});
    appendInitialChild(page, content);
    tabs.push(page);
    pages.push(content);
  }
  appendInitialChild(notebook, tabs[0]!);
  appendInitialChild(notebook, tabs[2]!);
  insertBefore(notebook, tabs[1]!, tabs[2]!);
  let pageOrder = "not a notebook";
  const pagesOf = notebook instanceof NotebookNode ? notebook.gtk : null;
  if (pagesOf !== null) {
    pageOrder = pages.map((p) => String(pagesOf.page_num(widget(p)))).join(",");
    pageOrder += " " + String(pagesOf.get_tab_label_text(widget(pages[1]!)));
    // Moved, a page keeps the Notebook's current page: "two" stays shown.
    pagesOf.set_current_page(1);
    const positions = (): string => pages.map((p) => String(pagesOf.page_num(widget(p)))).join(",");
    insertBefore(notebook, tabs[0]!, tabs[2]!);
    pageOrder += " moved=" + positions();
    appendChild(notebook, tabs[1]!);
    pageOrder += ">" + positions();
    pageOrder += " current=" + String(pagesOf.get_nth_page(pagesOf.get_current_page()) === widget(pages[1]!));
    removeChild(notebook, tabs[0]!);
    pageOrder += " " + String(pagesOf.get_n_pages());
    // A page whose child comes after the pages behind it were placed (a
    // conditional child becoming true) goes where React's order puts it.
    const latePage = createInstance("GtkNotebook.Page", { tab: "late" }, container, 0, {});
    appendChild(notebook, latePage);
    const lastPage = createInstance("GtkNotebook.Page", { tab: "last" }, container, 0, {});
    appendChild(lastPage, createInstance("GtkLabel", { label: "last" }, container, 0, {}));
    appendChild(notebook, lastPage);
    const lateContent = createInstance("GtkLabel", { label: "late" }, container, 0, {});
    appendChild(latePage, lateContent);
    pageOrder += " late=" + String(pagesOf.page_num(widget(lateContent))) + "/" + String(pagesOf.get_n_pages());
  }
  react_gtk_log("notebook " + pageOrder);

  const bar = createInstance("GtkHeaderBar", {}, container, 0, {});
  const start = createInstance("GtkHeaderBar.Start", {}, container, 0, {});
  const end = createInstance("GtkHeaderBar.End", {}, container, 0, {});
  const packs: HostNode[] = [];
  const packNames = ["b1", "b2", "e1", "e2", "b0"];
  for (const text of packNames) {
    packs.push(createInstance("GtkButton", { label: text }, container, 0, {}));
  }
  const nameOfPacked = (child: GtkWidget | null): string => {
    for (let i = 0; i < packs.length; i++) {
      if (child === widget(packs[i]!)) {
        return packNames[i]!;
      }
    }
    return child === null ? "-" : "?";
  };
  const after = (i: number): string => packNames[i]! + ">" + nameOfPacked(widget(packs[i]!).get_next_sibling());
  appendInitialChild(start, packs[0]!);
  appendInitialChild(start, packs[1]!);
  appendInitialChild(end, packs[2]!);
  appendInitialChild(end, packs[3]!);
  appendInitialChild(bar, start);
  appendInitialChild(bar, end);
  let packing = after(0) + " " + after(2);
  insertBefore(start, packs[4]!, packs[0]!);
  packing += " " + after(4);
  removeChild(start, packs[1]!);
  packing += " " + after(0);
  react_gtk_log("bar " + packing);

  const overlay = createInstance("GtkOverlay", {}, container, 0, {});
  const underneath = createInstance("GtkLabel", { label: "main" }, container, 0, {});
  const layer = createInstance("GtkOverlay.Layer", { measure: true }, container, 0, {});
  const over = createInstance("GtkLabel", { label: "over" }, container, 0, {});
  appendInitialChild(layer, over);
  appendInitialChild(overlay, underneath);
  appendInitialChild(overlay, layer);
  const layered = overlay instanceof OverlayNode ? overlay.gtk : null;
  let layering = "not an overlay";
  if (layered !== null) {
    layering =
      String(layered.get_child() === widget(underneath)) +
      " " +
      String(widget(over).get_parent() === widget(overlay)) +
      " " +
      String(layered.get_measure_overlay(widget(over)));
    commitUpdate(layer, "GtkOverlay.Layer", { measure: true }, { measure: false }, {});
    layering += ">" + String(layered.get_measure_overlay(widget(over)));
    const topLayer = createInstance("GtkOverlay.Layer", {}, container, 0, {});
    const top = createInstance("GtkLabel", { label: "top" }, container, 0, {});
    appendInitialChild(topLayer, top);
    appendChild(overlay, topLayer);
    const drawn = (): string => {
      let names = "";
      for (let child = widget(overlay).get_first_child(); child !== null; child = child.get_next_sibling()) {
        names += child === widget(underneath) ? "m" : child === widget(over) ? "o" : child === widget(top) ? "t" : "?";
      }
      return names;
    };
    layering += " " + drawn();
    insertBefore(overlay, topLayer, layer);
    layering += ">" + drawn();
    appendChild(overlay, topLayer);
    layering += ">" + drawn();
    removeChild(overlay, topLayer);
    removeChild(overlay, layer);
    layering += " " + String(widget(over).get_parent() === null);
  }
  react_gtk_log("overlay " + layering);

  const fixed = createInstance("GtkFixed", {}, container, 0, {});
  const spot = createInstance("GtkFixed.Child", { x: 12, y: 40 }, container, 0, {});
  const pinned = createInstance("GtkLabel", { label: "pinned" }, container, 0, {});
  appendInitialChild(spot, pinned);
  appendInitialChild(fixed, spot);
  const positioned = fixed instanceof FixedNode ? fixed.gtk : null;
  // Where the Fixed has put its child: its transform, set by `put` and
  // `move` at once (the position GTK reports waits for a layout).
  const placedAt = (): string => {
    const transform = positioned === null ? null : positioned.get_child_transform(widget(pinned));
    if (transform === null) {
      return "none";
    }
    const [x, y] = transform.to_translate();
    return String(x) + "," + String(y);
  };
  let position = placedAt();
  commitUpdate(spot, "GtkFixed.Child", { x: 12, y: 40 }, { x: 5, y: 40 }, {});
  position += ">" + placedAt();
  react_gtk_log("fixed " + position);

  const dialog = createInstance("GtkWindow", { title: "Dialog" }, container, 0, {});
  const wantsMount = finalizeInitialChildren(dialog, "GtkWindow", { title: "Dialog" }, 0);
  appendInitialChild(root, dialog);
  const beforeCommit = String(widget(dialog).get_parent() === null) + " " + String(widget(dialog).get_visible());
  commitMount(dialog, "GtkWindow", { title: "Dialog" }, {});
  const opened = dialog instanceof WindowNode ? dialog.gtk : null;
  const overRoot = opened !== null && opened.get_transient_for() === container.window;
  const presented = widget(dialog).get_visible();
  removeChild(root, dialog);
  react_gtk_log(
    "window " + String(wantsMount) + " " + beforeCommit + ">" + String(presented) + " over=" + String(overRoot) + " closed=" + String(!widget(dialog).get_visible()),
  );

  // A popover opens inside a shown window, as an app's is.
  const popped = new WindowRoot(new GtkWindow(), []);
  const anchor = createInstance("GtkBox", {}, popped, 0, {});
  appendChildToContainer(popped, anchor);
  popped.window.present();
  idle();
  const popover = createInstance("GtkPopover", {}, popped, 0, {});
  const anchorChildren = (): number => {
    let count = 0;
    for (let child = widget(anchor).get_first_child(); child !== null; child = child.get_next_sibling()) {
      if (child !== widget(popover)) {
        count++;
      }
    }
    return count;
  };
  appendInitialChild(anchor, popover);
  let popping = String(widget(popover).get_parent() === widget(anchor)) + " " + String(anchorChildren() === 0);
  removeChild(anchor, popover);
  popping += " " + String(widget(popover).get_parent() === null);
  react_gtk_log("popover " + popping);

  const application = new GtkApplication({ application_id: "org.nts.ReactGtk", flags: ApplicationFlags.NON_UNIQUE });
  application.register(null, null);
  const appRoot = new ApplicationRoot(application, []);
  const appWindow = createInstance("GtkApplicationWindow", { title: "App" }, appRoot, 0, {});
  const appWantsMount = finalizeInitialChildren(appWindow, "GtkApplicationWindow", { title: "App" }, 0);
  appendChildToContainer(appRoot, appWindow);
  commitMount(appWindow, "GtkApplicationWindow", { title: "App" }, {});
  const appWidget = widget(appWindow);
  const joined = appWidget instanceof GtkWindow && appWidget.get_application() === application && appWidget.get_visible();
  removeChildFromContainer(appRoot, appWindow);
  const left = appWidget instanceof GtkWindow && appWidget.get_application() === null;
  react_gtk_log("application " + String(appWantsMount) + " " + String(joined) + " " + String(left));

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
