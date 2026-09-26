// Where a React root renders: the host config's `Container`.
//
//   WindowRoot       a window, which holds one child: `createRoot(window)`
//   ApplicationRoot  an application, whose children are its windows:
//                    `createApplicationRoot(app)`, rendering
//                    `<ApplicationWindow>`s, each opened as the app's
//
// A window rendered in either is a toplevel (HostNode.ts, WidgetNode): placing
// it records what opened it, and it is presented at commit.

import type { GtkApplication, GtkWindow } from "c:Gtk-4.0";

import type { HostNode, WidgetNode, WidgetSet } from "./HostNode.ts";
import { createNode } from "./widgets.ts";

export abstract class HostRoot {
  // The widget sets beyond GTK's this root creates from (`adw`).
  private readonly widgets: readonly WidgetSet[];

  constructor(widgets: readonly WidgetSet[]) {
    this.widgets = widgets;
  }

  /** A new node for the host type `type`: GTK's widgets first, then each set's; null if none has it. */
  createNode(type: string): HostNode | null {
    const node = createNode(type);
    if (node !== null) {
      return node;
    }
    for (let i = 0; i < this.widgets.length; i++) {
      const made = this.widgets[i]!.createNode(type);
      if (made !== null) {
        return made;
      }
    }
    return null;
  }

  /** Places `child` at the root. */
  abstract appendChild(child: HostNode): void;
  /** Places `child` before `before`, a child already at the root. */
  abstract insertBefore(child: HostNode, before: HostNode): void;
  /** Takes `child` out of the root. */
  abstract removeChild(child: HostNode): void;
  /** Empties the root before a render replaces what it held. */
  abstract clear(): void;
}

/** The widget node a root child is, or an error naming what went there instead. */
function widgetOf(child: HostNode, where: string): WidgetNode {
  const widget = child.widgetNode();
  if (widget === null) {
    throw new Error(`<${child.name()}> goes directly inside its widget, not in ${where}.`);
  }
  return widget;
}

/** A window's root: its one child, or windows opened over it. */
export class WindowRoot extends HostRoot {
  readonly window: GtkWindow;
  private child: WidgetNode | null = null;

  constructor(window: GtkWindow, widgets: readonly WidgetSet[]) {
    super(widgets);
    this.window = window;
  }

  appendChild(child: HostNode): void {
    const widget = widgetOf(child, "a window's root");
    // A window rendered at the root opens over the root's window.
    if (widget.isToplevel()) {
      widget.openFrom(this.window);
      return;
    }
    if (this.child !== null && this.child !== widget) {
      throw new Error("A GTK window holds one child: wrap its children in a <Box>.");
    }
    this.child = widget;
    this.window.set_child(widget.widget);
  }

  insertBefore(child: HostNode, _before: HostNode): void {
    const widget = widgetOf(child, "a window's root");
    if (!widget.isToplevel()) {
      throw new Error("A GTK window holds one child: wrap its children in a <Box>.");
    }
    widget.openFrom(this.window);
  }

  removeChild(child: HostNode): void {
    const widget = child.widgetNode();
    if (widget !== null && widget.isToplevel()) {
      widget.close();
      return;
    }
    if (this.child === child) {
      this.child = null;
      this.window.set_child(null);
    }
  }

  clear(): void {
    this.child = null;
    this.window.set_child(null);
  }
}

/** An application's root: every child is a window, opened as the application's. */
export class ApplicationRoot extends HostRoot {
  readonly application: GtkApplication;

  constructor(application: GtkApplication, widgets: readonly WidgetSet[]) {
    super(widgets);
    this.application = application;
  }

  appendChild(child: HostNode): void {
    const widget = widgetOf(child, "an application's root");
    if (!widget.isToplevel()) {
      throw new Error(`An application renders windows: put <${widget.name()}> in an <ApplicationWindow>.`);
    }
    widget.joinApplication(this.application);
  }

  insertBefore(child: HostNode, _before: HostNode): void {
    this.appendChild(child);
  }

  removeChild(child: HostNode): void {
    const widget = child.widgetNode();
    if (widget !== null) {
      widget.close();
    }
  }

  // An application's windows are each React's to close, as their nodes are
  // taken out; nothing is held here to empty.
  clear(): void {}
}
