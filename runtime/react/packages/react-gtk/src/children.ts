// Child elements: a container that places a child with parameters of its own
// takes it through an element that carries them.
//
//   <Grid><Grid.Child column={1} row={0}><Label /></Grid.Child></Grid>
//   <Stack><Stack.Page name="files" title="Files"><FileList /></Stack.Page></Stack>
//   <Notebook><Notebook.Page tab="Files"><FileList /></Notebook.Page></Notebook>
//
// GIR says a Grid attaches at a cell and a Stack adds named pages, but not that
// an app should say which, so these are written by hand; src/widgets.ts
// declares them as members of their container's component (`Grid.Child`) and
// creates them. Each is a PlacedNode (HostNode.ts): it attaches its one child
// once both are placed, and finds its container as the GTK class it needs.

import { GtkGrid, GtkNotebook, GtkStack, type GtkStackPage, type GtkWidget } from "c:Gtk-4.0";
import type { HostComponent } from "shared/ReactHostComponent.ts";

import { PlacedNode, type Props, type WidgetNode } from "./HostNode.ts";

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
