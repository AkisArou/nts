// A list view over a model of a thousand rows, as GJS writes one: a
// `GListStore` of string objects -- made by the constructor that takes its
// construct-only `item_type` -- a single selection over it, and a factory
// whose `setup` gives each row a label and whose `bind` fills it from the
// row's item. `get_item` is `gpointer` to C; the program holds the object.
//
// Beside it, as GJS writes its own models: a store of `Task`, a class the
// program writes over `GObject` with fields of its own, made with
// `item_type: Task.$gtype`, and a second view whose `bind` asks `instanceof
// Task` -- a `GType` check -- and reads the fields it narrowed to.
//
// The log:
//   tasks 100 true task 0  the task store's count, that its item type is
//                 `Task.$gtype`, and its first item read back through
//                 `get_item` and `instanceof`
//   items 1000    the store's `get_n_items`, through `GListModel`
//   bound rows    `bind` ran for the rows GTK laid out, each label filled
//                 from its `GtkStringObject` -- read through checked casts
//   bound tasks   and for the task view's, from each `Task`'s own fields
//   range 1000000 first line 0  a model the program writes itself
//                 (`GListModelImplementation`): a million rows, none stored --
//                 `vfunc_get_item` makes each as GTK asks for it
//   bound range   and a view over it bound rows from what it made
//   sorted apple,banana,fig,kiwi,pear filtered apple,banana  a sort model over a
//                 `GtkCustomSorter` whose compare function is TypeScript --
//                 its two items `GObject`s, as `GCompareDataFunc` does not say
//                 -- under a filter model whose `GtkCustomFilter` closure
//                 captures a bound, changed and announced with
//                 `filter.changed`; each item read as `asGtkStringObject(x)?.string`
import {
  GtkCustomFilter,
  GtkCustomSorter,
  GtkFilterListModel,
  GtkSortListModel,
  GtkStringList,
  Ordering,
  GtkApplication,
  GtkApplicationWindow,
  GtkBox,
  GtkLabel,
  GtkListView,
  GtkSignalListItemFactory,
  GtkSingleSelection,
  GtkStringObject,
  gtk_string_object_get_type,
} from "c:Gtk-4.0";
import { asGtkLabel, asGtkListItem, asGtkStringObject } from "../types/gir/Gtk-4.0.values.ts";
import { ApplicationFlags, type GListModel, type GListModelImplementation, GListStore } from "c:Gio-2.0";
import { GObject } from "c:GObject-2.0";
import type { CNumber, Erased, Owned, c_size_t } from "c:types";
import { g_timeout_add_full } from "c:GLib-2.0";

class Task extends GObject {
  title = "";
  done = false;
}

// A view over a store of `Task`s, and how many rows it has bound -- done ones
// among them -- by the time it is read.
function taskView(): { view: GtkListView; bound: () => number } {
  const store = new GListStore({ item_type: Task.$gtype });
  for (let i = 0; i < 100; i++) {
    const task = new Task({});
    task.title = "task " + String(i);
    task.done = i % 3 === 0;
    store.append(task);
  }
  const first = store.get_item(0);
  console.log("tasks " + String(store.get_n_items()) + " " + String(store.get_item_type() === Task.$gtype) + " " + (first instanceof Task ? first.title : "?"));
  const factory = new GtkSignalListItemFactory({});
  let bound = 0;
  factory.connect("setup", (_factory, object) => {
    const item = asGtkListItem(object);
    if (item !== null) item.child = new GtkLabel({ xalign: 0 });
  });
  factory.connect("bind", (_factory, object) => {
    const item = asGtkListItem(object);
    if (item === null) return;
    const label = asGtkLabel(item.child);
    const task = item.item;
    if (label !== null && task instanceof Task) {
      label.label = (task.done ? "[x] " : "[ ] ") + task.title;
      if (task.done) bound++;
    }
  });
  return { view: new GtkListView({ model: new GtkSingleSelection({ model: store }), factory, vexpand: true }), bound: () => bound };
}

// A model the program writes: `count` rows of `GtkStringObject`, none held.
class Range extends GObject<{}, GListModelImplementation> {
  count = 1_000_000;
  vfunc_get_n_items(): CNumber<"uint"> {
    return this.count;
  }
  vfunc_get_item_type(): c_size_t {
    return gtk_string_object_get_type();
  }
  vfunc_get_item(position: CNumber<"uint">): Owned<Erased<GObject>> | null {
    return position < this.count ? GtkStringObject.new("line " + String(position)) : null;
  }
}

// A view over a model of `GtkStringObject`s, and how many rows it has bound.
function stringView(model: GListModel): { view: GtkListView; bound: () => number } {
  const factory = new GtkSignalListItemFactory({});
  let bound = 0;
  factory.connect("setup", (_factory, object) => {
    const item = asGtkListItem(object);
    if (item !== null) item.child = new GtkLabel({ xalign: 0 });
  });
  factory.connect("bind", (_factory, object) => {
    const item = asGtkListItem(object);
    if (item === null) return;
    const label = asGtkLabel(item.child);
    const row = asGtkStringObject(item.item);
    if (label !== null && row !== null) {
      label.label = row.string;
      bound++;
    }
  });
  return { view: new GtkListView({ model: new GtkSingleSelection({ model }), factory, vexpand: true }), bound: () => bound };
}

// Words sorted by a TypeScript compare function, then filtered by length.
function sortedWords(): string {
  const words = new GtkStringList({ strings: ["pear", "apple", "fig", "banana", "kiwi"] });
  const sorter = new GtkCustomSorter({});
  sorter.set_sort_func((a, b) => {
    const x = asGtkStringObject(a)?.string ?? "";
    const y = asGtkStringObject(b)?.string ?? "";
    return x < y ? Ordering.SMALLER : x > y ? Ordering.LARGER : Ordering.EQUAL;
  });
  const sorted = new GtkSortListModel({ model: words, sorter });
  let longer = 3;
  const filter = new GtkCustomFilter({});
  filter.set_filter_func((item) => (asGtkStringObject(item)?.string.length ?? 0) > longer);
  const filtered = new GtkFilterListModel({ model: sorted, filter });
  const read = (model: GListModel): string => {
    const out: string[] = [];
    for (let i = 0; i < model.get_n_items(); i++) out.push(asGtkStringObject(model.get_item(i))?.string ?? "?");
    return out.join(",");
  };
  const all = read(sorted);
  longer = 4;
  filter.changed(0);
  return "sorted " + all + " filtered " + read(filtered);
}

function open(application: GtkApplication): void {
  const store = new GListStore({ item_type: gtk_string_object_get_type() });
  // `GtkStringObject.new`, GJS's constructor on the class.
  for (let row = 0; row < 1000; row++) store.append(GtkStringObject.new("row " + String(row)));
  const rows = stringView(store);
  const tasks = taskView();
  const range = new Range();
  const first = asGtkStringObject(range.get_item(0));
  console.log("range " + String(range.get_n_items()) + " first " + (first !== null ? first.string : "?"));
  const lines = stringView(range);
  const column = new GtkBox({});
  column.append(rows.view);
  column.append(tasks.view);
  column.append(lines.view);
  const window = new GtkApplicationWindow({ application, title: "List" });
  window.set_default_size(300, 400);
  window.set_child(column);
  window.present();
  console.log("items " + String(store.get_n_items()));
  console.log(sortedWords());
  g_timeout_add_full(0, 300, () => {
    console.log(rows.bound() > 0 ? "bound rows" : "bound nothing");
    console.log(tasks.bound() > 0 ? "bound tasks" : "bound no tasks");
    console.log(lines.bound() > 0 ? "bound range" : "bound no range");
    application.quit();
    return false;
  });
}

function main(): void {
  const application = new GtkApplication({ application_id: "dev.nts.List", flags: ApplicationFlags.NON_UNIQUE });
  application.connect("activate", () => {
    open(application);
  });
  application.run(["list"]);
}

main();
