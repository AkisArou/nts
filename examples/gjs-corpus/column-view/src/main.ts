// Workbench's "Column View" demo (CC0, workbenchdev/demos), ported.
import { GListStore } from "c:Gio-2.0";
import { GObject, type GObjectProps } from "c:GObject-2.0";
import {
  GtkColumnView,
  GtkColumnViewColumn,
  GtkLabel,
  GtkListItem,
  GtkNumericSorter,
  GtkPropertyExpression,
  GtkSignalListItemFactory,
  GtkSingleSelection,
  GtkSortListModel,
  GtkStringSorter,
} from "c:Gtk-4.0";
import type { Properties, Property } from "c:types";
import { run, type Workbench } from "../../host/workbench.ts";

// Define our class for our custom model: GJS's `GObject.registerClass({
// Properties })`, as a class declares its properties here.
class Book extends GObject {
  title: Property<string> = "";
  author: Property<string> = "";
  year: Property<number> = 0;
  // The constructor GJS infers, in TypeScript's one line.
  constructor(props: Properties<Book, GObjectProps> = {}) {
    super(props);
  }
}

function demo(workbench: Workbench): void {
  const column_view = workbench.builder.get_object("column_view");
  const col1 = workbench.builder.get_object("col1");
  const col2 = workbench.builder.get_object("col2");
  const col3 = workbench.builder.get_object("col3");
  if (
    !(column_view instanceof GtkColumnView) ||
    !(col1 instanceof GtkColumnViewColumn) ||
    !(col2 instanceof GtkColumnViewColumn) ||
    !(col3 instanceof GtkColumnViewColumn)
  ) {
    throw new Error("the demo's UI");
  }

  // Create the model
  const data_model = new GListStore({ item_type: Book.$gtype });
  data_model.splice(0, 0, [
    new Book({
      title: "Winds from Afar",
      author: "Kenji Miyazawa",
      year: 1972,
    }),
    new Book({
      title: "Like Water for Chocolate",
      author: "Laura Esquivel",
      year: 1989,
    }),
    new Book({
      title: "Works and Nights",
      author: "Alejandra Pizarnik",
      year: 1965,
    }),
    new Book({
      title: "Understading Analysis",
      author: "Stephen Abbott",
      year: 2002,
    }),
    new Book({
      title: "The Timeless Way of Building",
      author: "Cristopher Alexander",
      year: 1979,
    }),
    new Book({
      title: "Bitter",
      author: "Akwaeke Emezi",
      year: 2022,
    }),
    new Book({
      title: "Saying Yes",
      author: "Griselda Gambaro",
      year: 1981,
    }),
    new Book({
      title: "Itinerary of a Dramatist",
      author: "Rodolfo Usigli",
      year: 1940,
    }),
  ]);

  col1.sorter = new GtkStringSorter({
    expression: GtkPropertyExpression.new(Book.$gtype, null, "title"),
  });

  col2.sorter = new GtkStringSorter({
    expression: GtkPropertyExpression.new(Book.$gtype, null, "author"),
  });

  col3.sorter = new GtkNumericSorter({
    expression: GtkPropertyExpression.new(Book.$gtype, null, "year"),
  });

  // View
  // Column 1
  const factory_col1 = col1.factory;
  if (!(factory_col1 instanceof GtkSignalListItemFactory)) throw new Error("the demo's UI");
  factory_col1.connect("setup", (_self, list_item) => {
    if (!(list_item instanceof GtkListItem)) return;
    const label = new GtkLabel({
      margin_start: 12,
      margin_end: 12,
    });
    list_item.set_child(label);
  });
  factory_col1.connect("bind", (_self, list_item) => {
    if (!(list_item instanceof GtkListItem)) return;
    const label_widget = list_item.get_child();
    const model_item = list_item.get_item();
    if (!(label_widget instanceof GtkLabel) || !(model_item instanceof Book)) return;
    label_widget.label = model_item.title;
  });

  // Column 2
  const factory_col2 = col2.factory;
  if (!(factory_col2 instanceof GtkSignalListItemFactory)) throw new Error("the demo's UI");
  factory_col2.connect("setup", (_self, list_item) => {
    if (!(list_item instanceof GtkListItem)) return;
    const label = new GtkLabel({
      margin_start: 12,
      margin_end: 12,
    });
    list_item.set_child(label);
  });
  factory_col2.connect("bind", (_self, list_item) => {
    if (!(list_item instanceof GtkListItem)) return;
    const label_widget = list_item.get_child();
    const model_item = list_item.get_item();
    if (!(label_widget instanceof GtkLabel) || !(model_item instanceof Book)) return;
    label_widget.label = model_item.author;
  });

  // Column 3
  const factory_col3 = col3.factory;
  if (!(factory_col3 instanceof GtkSignalListItemFactory)) throw new Error("the demo's UI");
  factory_col3.connect("setup", (_self, list_item) => {
    if (!(list_item instanceof GtkListItem)) return;
    const label = new GtkLabel({
      margin_start: 12,
      margin_end: 12,
    });
    list_item.set_child(label);
  });
  factory_col3.connect("bind", (_self, list_item) => {
    if (!(list_item instanceof GtkListItem)) return;
    const label_widget = list_item.get_child();
    const model_item = list_item.get_item();
    if (!(label_widget instanceof GtkLabel) || !(model_item instanceof Book)) return;
    label_widget.label = model_item.year.toString();
  });

  const sort_model = new GtkSortListModel({
    model: data_model,
  });
  // GJS passes `sorter` in the props. A props object has no `| null` (the
  // binder folds it into absent), and the view's sorter is `GtkSorter |
  // null`, so it is set through the property, which takes NULL.
  sort_model.sorter = column_view.sorter;

  column_view.model = new GtkSingleSelection({
    model: sort_model,
  });
}

run(demo);
