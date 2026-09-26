// Child elements: a container that places a child with parameters of its own
// takes it through an element that carries them.
//
//   <Grid><Grid.Child column={1} row={0}><Label /></Grid.Child></Grid>
//   <Stack><Stack.Page name="files" title="Files"><FileList /></Stack.Page></Stack>
//   <Notebook><Notebook.Page tab="Files"><FileList /></Notebook.Page></Notebook>
//   <HeaderBar><HeaderBar.Start><Button /><Button /></HeaderBar.Start></HeaderBar>
//   <Overlay><Picture /><Overlay.Layer><Spinner /></Overlay.Layer></Overlay>
//   <Fixed><Fixed.Child x={12} y={40}><Label /></Fixed.Child></Fixed>
//
// GIR says a Grid attaches at a cell and a Stack adds named pages, but not that
// an app should say which, so these are written by hand; src/widgets.ts
// declares them as members of their container's component (`Grid.Child`) and
// creates them. Each is a PlacedNode (HostNode.ts): it attaches its one child
// once both are placed, and finds its container as the GTK class it needs.
// A bar's start and end are groups, which hold any number (PackNode).

import { GtkActionBar, GtkFixed, GtkGrid, GtkHeaderBar, GtkNotebook, GtkOverlay, GtkStack, type GtkStackPage, type GtkWidget } from "c:Gtk-4.0";
import type { HostComponent } from "shared/ReactHostComponent.ts";

import { HostNode, insertAt, PlacedNode, type Props, type WidgetNode } from "./HostNode.ts";

function numberProp(props: Props, key: string, fallback: number): number {
  const value = props[key];
  return typeof value === "number" ? value : fallback;
}

function stringProp(props: Props, key: string): string | null {
  const value = props[key];
  return typeof value === "string" ? value : null;
}

function misplaced(element: string, container: string, owner: WidgetNode): Error {
  return new Error(`<${element}> goes directly inside a <${container}>, not a <${owner.name()}>.`);
}

// ---- Grid --------------------------------------------------------------------------

export interface GridChildProps {
  /** The first column the child covers: 0 by default. */
  column?: number;
  /** The first row the child covers: 0 by default. */
  row?: number;
  /** How many columns it covers: 1 by default. */
  columnSpan?: number;
  /** How many rows it covers: 1 by default. */
  rowSpan?: number;
  children?: unknown;
}

export interface GridChildren {
  /** `<Grid.Child column row>`: its one child, at that cell of the Grid. */
  readonly Child: HostComponent<"GtkGrid.Child", GridChildProps>;
}

export class GridChildNode extends PlacedNode {
  protected attach(owner: WidgetNode, widget: GtkWidget): void {
    const grid = owner.widget;
    if (!(grid instanceof GtkGrid)) {
      throw misplaced("Grid.Child", "Grid", owner);
    }
    const props = this.props;
    grid.attach(widget, numberProp(props, "column", 0), numberProp(props, "row", 0), numberProp(props, "columnSpan", 1), numberProp(props, "rowSpan", 1));
  }
  protected detach(owner: WidgetNode, widget: GtkWidget): void {
    const grid = owner.widget;
    if (grid instanceof GtkGrid) {
      grid.remove(widget);
    }
  }
}

// ---- Stack ---------------------------------------------------------------------------

export interface StackPageProps {
  /** The page's name: what the Stack's `visibleChildName` selects. */
  name?: string;
  /** The page's title, as a StackSwitcher or StackSidebar shows it. */
  title?: string;
  iconName?: string;
  needsAttention?: boolean;
  children?: unknown;
}

export interface StackChildren {
  /** `<Stack.Page name title>`: its one child, a page of the Stack. */
  readonly Page: HostComponent<"GtkStack.Page", StackPageProps>;
}

/**
 * A page keeps the order it was added in: GtkStack has no way to move one, so
 * a page React moves goes last (a switcher then lists it last).
 */
export class StackPageNode extends PlacedNode {
  protected attach(owner: WidgetNode, widget: GtkWidget): void {
    const stack = owner.widget;
    if (!(stack instanceof GtkStack)) {
      throw misplaced("Stack.Page", "Stack", owner);
    }
    this.describe(stack.add_child(widget));
    // The Stack's `visibleChildName` was applied before its pages existed
    // (React sets a node's props before placing its children): it names this
    // page, so this page is the one shown.
    const name = stringProp(this.props, "name");
    if (name !== null && owner.prop("visibleChildName") === name) {
      stack.set_visible_child(widget);
    }
  }
  protected detach(owner: WidgetNode, widget: GtkWidget): void {
    const stack = owner.widget;
    if (stack instanceof GtkStack) {
      stack.remove(widget);
    }
  }
  protected update(owner: WidgetNode, widget: GtkWidget): void {
    const stack = owner.widget;
    if (stack instanceof GtkStack) {
      this.describe(stack.get_page(widget));
    }
  }

  private describe(page: GtkStackPage): void {
    const props = this.props;
    page.set_name(stringProp(props, "name") ?? "");
    page.set_title(stringProp(props, "title") ?? "");
    page.set_icon_name(stringProp(props, "iconName") ?? "");
    page.set_needs_attention(props["needsAttention"] === true);
  }
}

// ---- Notebook ------------------------------------------------------------------------

export interface NotebookPageProps {
  /** The text of the page's tab. */
  tab?: string;
  /** Whether the user can drag the tab to reorder the pages. */
  reorderable?: boolean;
  children?: unknown;
}

export interface NotebookChildren {
  /** `<Notebook.Page tab>`: its one child, a page of the Notebook. */
  readonly Page: HostComponent<"GtkNotebook.Page", NotebookPageProps>;
}

export class NotebookPageNode extends PlacedNode {
  protected attach(owner: WidgetNode, widget: GtkWidget): void {
    const notebook = owner.widget;
    if (!(notebook instanceof GtkNotebook)) {
      throw misplaced("Notebook.Page", "Notebook", owner);
    }
    // React places a page before the next one it knows of; -1 is the end.
    const next = this.before === null ? null : this.before.shownWidget();
    notebook.insert_page(widget, null, next === null ? -1 : notebook.page_num(next));
    this.describe(notebook, widget);
    // As a Stack's visible child: the Notebook's `page` was applied before
    // its pages existed.
    const current = owner.prop("page");
    if (typeof current === "number" && notebook.page_num(widget) === current) {
      notebook.set_current_page(current);
    }
  }
  protected detach(owner: WidgetNode, widget: GtkWidget): void {
    const notebook = owner.widget;
    if (notebook instanceof GtkNotebook) {
      const index = notebook.page_num(widget);
      if (index >= 0) {
        notebook.remove_page(index);
      }
    }
  }
  protected update(owner: WidgetNode, widget: GtkWidget): void {
    const notebook = owner.widget;
    if (notebook instanceof GtkNotebook) {
      this.describe(notebook, widget);
    }
  }

  private describe(notebook: GtkNotebook, widget: GtkWidget): void {
    const tab = stringProp(this.props, "tab");
    if (tab !== null) {
      notebook.set_tab_label_text(widget, tab);
    }
    notebook.set_tab_reorderable(widget, this.props["reorderable"] === true);
  }
}

// ---- Overlay ---------------------------------------------------------------------------

export interface OverlayLayerProps {
  /** Whether the layer counts toward the Overlay's size, as its main child does. */
  measure?: boolean;
  /** Whether the layer is clipped to the Overlay's main child. */
  clip?: boolean;
  children?: unknown;
}

export interface OverlayChildren {
  /** `<Overlay.Layer>`: its one child, drawn over the Overlay's main child. */
  readonly Layer: HostComponent<"GtkOverlay.Layer", OverlayLayerProps>;
}

/**
 * A layer over an Overlay's main child, which the Overlay holds as its one
 * ordinary child. Layers stack in the order they were added: GtkOverlay
 * cannot move one, so a layer React moves goes on top.
 */
export class OverlayLayerNode extends PlacedNode {
  protected attach(owner: WidgetNode, widget: GtkWidget): void {
    const overlay = owner.widget;
    if (!(overlay instanceof GtkOverlay)) {
      throw misplaced("Overlay.Layer", "Overlay", owner);
    }
    overlay.add_overlay(widget);
    this.describe(overlay, widget);
  }
  protected detach(owner: WidgetNode, widget: GtkWidget): void {
    const overlay = owner.widget;
    if (overlay instanceof GtkOverlay) {
      overlay.remove_overlay(widget);
    }
  }
  protected update(owner: WidgetNode, widget: GtkWidget): void {
    const overlay = owner.widget;
    if (overlay instanceof GtkOverlay) {
      this.describe(overlay, widget);
    }
  }

  private describe(overlay: GtkOverlay, widget: GtkWidget): void {
    overlay.set_measure_overlay(widget, this.props["measure"] === true);
    overlay.set_clip_overlay(widget, this.props["clip"] === true);
  }
}

// ---- Fixed -----------------------------------------------------------------------------

export interface FixedChildProps {
  /** The child's left edge, in pixels from the Fixed's: 0 by default. */
  x?: number;
  /** The child's top edge: 0 by default. */
  y?: number;
  children?: unknown;
}

export interface FixedChildren {
  /** `<Fixed.Child x y>`: its one child, at that position in the Fixed. */
  readonly Child: HostComponent<"GtkFixed.Child", FixedChildProps>;
}

/** A child of a Fixed at a position, moved in place when it changes. */
export class FixedChildNode extends PlacedNode {
  protected attach(owner: WidgetNode, widget: GtkWidget): void {
    const fixed = owner.widget;
    if (!(fixed instanceof GtkFixed)) {
      throw misplaced("Fixed.Child", "Fixed", owner);
    }
    fixed.put(widget, numberProp(this.props, "x", 0), numberProp(this.props, "y", 0));
  }
  protected detach(owner: WidgetNode, widget: GtkWidget): void {
    const fixed = owner.widget;
    if (fixed instanceof GtkFixed) {
      fixed.remove(widget);
    }
  }
  protected update(owner: WidgetNode, widget: GtkWidget): void {
    const fixed = owner.widget;
    if (fixed instanceof GtkFixed) {
      fixed.move(widget, numberProp(this.props, "x", 0), numberProp(this.props, "y", 0));
    }
  }
}

// ---- HeaderBar and ActionBar ----------------------------------------------------------

export interface PackProps {
  children?: unknown;
}

export interface HeaderBarChildren {
  /** `<HeaderBar.Start>`: its children, packed at the bar's start, left to right. */
  readonly Start: HostComponent<"GtkHeaderBar.Start", PackProps>;
  /** `<HeaderBar.End>`: its children, packed at the bar's end, left to right. */
  readonly End: HostComponent<"GtkHeaderBar.End", PackProps>;
}

export interface ActionBarChildren {
  /** `<ActionBar.Start>`: its children, packed at the bar's start, left to right. */
  readonly Start: HostComponent<"GtkActionBar.Start", PackProps>;
  /** `<ActionBar.End>`: its children, packed at the bar's end, left to right. */
  readonly End: HostComponent<"GtkActionBar.End", PackProps>;
}

/**
 * A bar's start or end (`GtkHeaderBar.Start`, `GtkActionBar.End`): a group
 * of widgets packed there in the order React holds them, left to right. GTK
 * packs an end from the edge in, so an end packs its children last first.
 * Neither bar can move a packed child, so any change packs the group again;
 * a bar holds a handful.
 */
export class PackNode extends HostNode {
  private owner: WidgetNode | null = null;
  private readonly items: WidgetNode[] = [];
  private packed = false;

  applyProps(_previous: Props | null, next: Props): void {
    const children = next["children"];
    if (typeof children === "string" || typeof children === "number") {
      throw new Error(`<${this.name()}> cannot hold text: put it in a <Label>.`);
    }
  }

  appendChild(child: HostNode): void {
    const widget = this.itemOf(child);
    this.unpack();
    this.remove(widget);
    this.items.push(widget);
    this.pack();
  }
  insertBefore(child: HostNode, before: HostNode): void {
    const widget = this.itemOf(child);
    this.unpack();
    this.remove(widget);
    const at = this.items.indexOf(before.widgetNode() ?? widget);
    insertAt(this.items, at < 0 ? this.items.length : at, widget);
    this.pack();
  }
  removeChild(child: HostNode): void {
    const widget = child.widgetNode();
    if (widget !== null && this.items.indexOf(widget) >= 0) {
      this.unpack();
      this.remove(widget);
      this.pack();
    }
  }

  placeIn(parent: WidgetNode, _before: HostNode | null): void {
    this.unpack();
    this.owner = parent;
    this.pack();
  }
  takeOutOf(parent: WidgetNode): void {
    if (this.owner === parent) {
      this.unpack();
      this.owner = null;
    }
  }

  private itemOf(child: HostNode): WidgetNode {
    const widget = child.widgetNode();
    if (widget === null) {
      throw new Error(`<${child.name()}> goes directly inside its widget, not in <${this.name()}>.`);
    }
    return widget;
  }

  private remove(widget: WidgetNode): void {
    const at = this.items.indexOf(widget);
    if (at >= 0) {
      this.items.splice(at, 1);
    }
  }

  private pack(): void {
    const owner = this.owner;
    if (this.packed || owner === null) {
      return;
    }
    const bar = owner.widget;
    const end = this.type.endsWith(".End");
    const count = this.items.length;
    for (let i = 0; i < count; i++) {
      const widget = this.items[end ? count - 1 - i : i]!.widget;
      if (bar instanceof GtkHeaderBar) {
        if (end) bar.pack_end(widget);
        else bar.pack_start(widget);
      } else if (bar instanceof GtkActionBar) {
        if (end) bar.pack_end(widget);
        else bar.pack_start(widget);
      } else {
        throw new Error(`<${this.name()}> goes directly inside a <${this.name().split(".")[0]}>, not a <${owner.name()}>.`);
      }
    }
    this.packed = true;
  }

  private unpack(): void {
    const owner = this.owner;
    if (!this.packed || owner === null) {
      return;
    }
    this.packed = false;
    const bar = owner.widget;
    for (let i = 0; i < this.items.length; i++) {
      const widget = this.items[i]!.widget;
      if (bar instanceof GtkHeaderBar) {
        bar.remove(widget);
      } else if (bar instanceof GtkActionBar) {
        bar.remove(widget);
      }
    }
  }

  widgetNode(): WidgetNode | null {
    return null;
  }

  shownWidget(): GtkWidget | null {
    const first = this.items[0];
    return first === undefined ? null : first.widget;
  }

  publicInstance(): GtkWidget {
    throw new Error(`<${this.name()}> is a group of widgets: put the ref on one of them.`);
  }

  setVisible(visible: boolean): void {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i]!.setVisible(visible);
    }
  }
}
