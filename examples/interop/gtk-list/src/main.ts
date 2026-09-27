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
//   spliced 3 2 b listed  `splice` of an array of objects, lent to C in
//                 place (`CHandles`): three labels in a temporary array, then
//                 an empty array removing the first -- the task store is
//                 filled by one `splice` of its `Task[]` too -- and an
//                 file list made from two files, an array C spells
//                 `GFile **` rather than `gpointer *`
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
//                 `filter.changed`; each item narrowed by `instanceof GtkStringObject`
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
  GtkListItem,
  GtkListView,
  GtkSignalListItemFactory,
  GtkSingleSelection,
  GtkStringObject,
  gtk_string_object_get_type,
} from "c:Gtk-4.0";
import { ApplicationFlags, type GListModel, type GListModelImplementation, GListStore, g_file_new_for_path } from "c:Gio-2.0";
import { GdkFileList } from "c:Gdk-4.0";
import { GObject } from "c:GObject-2.0";
import type { CNumber, Erased, Owned, c_size_t } from "c:types";
import { g_getenv, g_timeout_add_full } from "c:GLib-2.0";

class Task extends GObject {
  title = "";
  done = false;
}

// A view over a store of `Task`s, and how many rows it has bound -- done ones
// among them -- by the time it is read.
function taskView(): { view: GtkListView; bound: () => number } {
  const store = new GListStore({ item_type: Task.$gtype });
  const tasks: Task[] = [];
  for (let i = 0; i < 100; i++) {
    const task = new Task({});
    task.title = "task " + String(i);
    task.done = i % 3 === 0;
    tasks.push(task);
  }
  // All at once, as GJS loads a store: the array is C's `gpointer *` in
  // place, and the store announces one change rather than a hundred.
  store.splice(0, 0, tasks);
  const first = store.get_item(0);
  console.log("tasks " + String(store.get_n_items()) + " " + String(store.get_item_type() === Task.$gtype) + " " + (first instanceof Task ? first.title : "?"));
  const factory = new GtkSignalListItemFactory({});
  let bound = 0;
  factory.connect("setup", (_factory, item) => {
    if (item instanceof GtkListItem) item.child = new GtkLabel({ xalign: 0 });
  });
  factory.connect("bind", (_factory, item) => {
    if (!(item instanceof GtkListItem)) return;
    const label = item.child;
    const task = item.item;
    if (label instanceof GtkLabel && task instanceof Task) {
      label.label = (task.done ? "[x] " : "[ ] ") + task.title;
      if (task.done) bound++;
    }
  });
  return { view: new GtkListView({ model: new GtkSingleSelection({ model: store }), factory, vexpand: true }), bound: () => bound };
}

// Arrays of objects lent to C (`CHandles`): binding classes in a temporary
// array, which only the call holds -- the store keeps what it takes -- and an
// empty one, which removes. Under `NTS_LIST_HOLE`, an array with nothing at
// index 1 -- a `null` asserted away, as nothing type-correct can put one
// there -- which ends the process naming it rather than handing C a NULL
// object.
function spliced(): string {
  const store = new GListStore({ item_type: GObject.$gtype });
  store.splice(0, 0, [new GtkLabel({ label: "a" }), new GtkLabel({ label: "b" }), new GtkLabel({ label: "c" })]);
  const three = store.get_n_items();
  store.splice(0, 1, []);
  const first = store.get_item(0);
  if (g_getenv("NTS_LIST_HOLE") !== null) {
    const holed: GtkLabel[] = [new GtkLabel({}), null!];
    store.splice(0, 0, holed);
  }
  // An array C spells as its element's own pointer, `GFile **`, where
  // `splice`'s is `gpointer *`: the loan converts to either.
  const files = GdkFileList.new_from_array([g_file_new_for_path("/tmp/a"), g_file_new_for_path("/tmp/b")]);
  return (
    "spliced " + String(three) + " " + String(store.get_n_items()) + " " + (first instanceof GtkLabel ? first.label : "?") +
    (files !== null ? " listed" : " unlisted")
  );
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
  factory.connect("setup", (_factory, item) => {
    if (item instanceof GtkListItem) item.child = new GtkLabel({ xalign: 0 });
  });
  factory.connect("bind", (_factory, item) => {
    if (!(item instanceof GtkListItem)) return;
    const label = item.child;
    const row = item.item;
    if (label instanceof GtkLabel && row instanceof GtkStringObject) {
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
    const x = a instanceof GtkStringObject ? a.string : "";
    const y = b instanceof GtkStringObject ? b.string : "";
    return x < y ? Ordering.SMALLER : x > y ? Ordering.LARGER : Ordering.EQUAL;
  });
  const sorted = new GtkSortListModel({ model: words, sorter });
  let longer = 3;
  const filter = new GtkCustomFilter({});
  filter.set_filter_func((item) => (item instanceof GtkStringObject ? item.string.length : 0) > longer);
  const filtered = new GtkFilterListModel({ model: sorted, filter });
  const read = (model: GListModel): string => {
    const out: string[] = [];
    for (let i = 0; i < model.get_n_items(); i++) {
      const item = model.get_item(i);
      out.push(item instanceof GtkStringObject ? item.string : "?");
    }
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
  console.log(spliced());
  const range = new Range();
  const first = range.get_item(0);
  console.log("range " + String(range.get_n_items()) + " first " + (first instanceof GtkStringObject ? first.string : "?"));
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
