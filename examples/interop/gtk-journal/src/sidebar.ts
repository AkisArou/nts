// The sidebar: every entry, sorted by day or by title, filtered by a search
// over titles and tags, one label a row.
import {
  GtkCustomFilter,
  GtkCustomSorter,
  GtkFilterListModel,
  GtkLabel,
  GtkListView,
  GtkScrolledWindow,
  GtkSignalListItemFactory,
  GtkSingleSelection,
  GtkSortListModel,
  Ordering,
  type GtkOrdering,
  GtkListItem,
} from "c:Gtk-4.0";
import type { CEnum } from "c:types";
import type { c_int } from "@nts/scalars";
import { GListStore } from "c:Gio-2.0";
import { Entry } from "./model.ts";

function compare<T>(x: T, y: T): CEnum<GtkOrdering, c_int> {
  return x < y ? Ordering.SMALLER : x > y ? Ordering.LARGER : Ordering.EQUAL;
}

export class Sidebar {
  readonly store = new GListStore({ item_type: Entry.$gtype });
  readonly view: GtkListView;
  // What the window shows: the list, scrolled, so it lays out the rows in
  // sight and not all of them.
  readonly scrolled: GtkScrolledWindow;
  readonly selection: GtkSingleSelection;
  readonly visible: GtkFilterListModel;
  private byTitle = false;
  private query = "";
  private readonly sorter = new GtkCustomSorter({});
  private readonly filter = new GtkCustomFilter({});

  constructor() {
    this.sorter.set_sort_func((a, b) => {
      if (!(a instanceof Entry) || !(b instanceof Entry)) return Ordering.EQUAL;
      return this.byTitle ? compare(a.title, b.title) : compare(a.day, b.day);
    });
    this.filter.set_filter_func((item) => {
      if (!(item instanceof Entry)) return false;
      return this.query === "" || item.title.includes(this.query) || item.tags.includes(this.query);
    });
    const sorted = new GtkSortListModel({ model: this.store, sorter: this.sorter });
    this.visible = new GtkFilterListModel({ model: sorted, filter: this.filter });
    this.selection = new GtkSingleSelection({ model: this.visible });
    const factory = new GtkSignalListItemFactory({});
    factory.connect("setup", (_factory, item) => {
      if (item instanceof GtkListItem) item.child = new GtkLabel({ xalign: 0 });
    });
    factory.connect("bind", (_factory, item) => {
      if (!(item instanceof GtkListItem)) return;
      const label = item.child;
      const entry = item.item;
      if (label instanceof GtkLabel && entry instanceof Entry) label.label = entry.title;
    });
    this.view = new GtkListView({ model: this.selection, factory });
    this.scrolled = new GtkScrolledWindow({ child: this.view, vexpand: true });
  }

  search(query: string): void {
    this.query = query;
    this.filter.changed(0);
  }

  sortByTitle(byTitle: boolean): void {
    this.byTitle = byTitle;
    this.sorter.changed(0);
  }

  selected(): Entry | null {
    const item = this.selection.selected_item;
    return item instanceof Entry ? item : null;
  }
}
