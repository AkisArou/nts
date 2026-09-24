// A list view over a model of a thousand rows, as GJS writes one: a
// `GListStore` of string objects -- made by the constructor that takes its
// construct-only `item_type` -- a single selection over it, and a factory
// whose `setup` gives each row a label and whose `bind` fills it from the
// row's item. `get_item` is `gpointer` to C; the program holds the object.
//
// The log:
//   items 1000    the store's `get_n_items`, through `GListModel`
//   bound rows    `bind` ran for the rows GTK laid out, each label filled
//                 from its `GtkStringObject` -- read through checked casts
import {
  GtkApplication,
  GtkApplicationWindow,
  GtkLabel,
  GtkListView,
  GtkSignalListItemFactory,
  GtkSingleSelection,
  gtk_string_object_get_type,
  gtk_string_object_new,
} from "c:Gtk-4.0";
import { asGtkLabel, asGtkListItem, asGtkStringObject } from "../types/gir/Gtk-4.0.values.ts";
import { ApplicationFlags, GListStore } from "c:Gio-2.0";
import { g_timeout_add_full } from "c:GLib-2.0";
import { notes_log } from "c:notes";

function open(application: GtkApplication): void {
  const store = new GListStore({ item_type: gtk_string_object_get_type() });
  for (let row = 0; row < 1000; row++) store.append(gtk_string_object_new("row " + String(row)));
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
  const view = new GtkListView({ model: new GtkSingleSelection({ model: store }), factory });
  const window = new GtkApplicationWindow({ application, title: "List" });
  window.set_default_size(300, 400);
  window.set_child(view);
  window.present();
  notes_log("items " + String(store.get_n_items()));
  g_timeout_add_full(0, 300, () => {
    notes_log(bound > 0 ? "bound rows" : "bound nothing");
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
