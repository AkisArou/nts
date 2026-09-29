// Workbench's "List View with Sections" demo (CC0, workbenchdev/demos), ported.
import {
  Align,
  GtkLabel,
  GtkListHeader,
  GtkListItem,
  GtkListView,
  GtkNoSelection,
  type GtkSectionModelImplementation,
  GtkSignalListItemFactory,
  GtkStringList,
  GtkStringObject,
} from "c:Gtk-4.0";
import type { CNumber } from "c:types";
import { run, type Workbench } from "../../host/workbench.ts";

// GJS's `Implements: [Gtk.SectionModel]`, as the class's second type
// argument.
class CustomModel extends GtkStringList<{}, GtkSectionModelImplementation> {
  vfunc_get_section(position: CNumber<"uint">): [CNumber<"uint">, CNumber<"uint">] {
    const start = position;
    const end = start + 5;
    return [start, end];
  }
}

function demo(workbench: Workbench): void {
  const list_view = workbench.builder.get_object("list_view");
  const item_factory = workbench.builder.get_object("item_factory");
  const header_factory = workbench.builder.get_object("header_factory");
  if (
    !(list_view instanceof GtkListView) ||
    !(item_factory instanceof GtkSignalListItemFactory) ||
    !(header_factory instanceof GtkSignalListItemFactory)
  ) {
    throw new Error("the demo's UI");
  }

  item_factory.connect("setup", (_self, list_item) => {
    if (!(list_item instanceof GtkListItem)) return;
    list_item.set_child(new GtkLabel({ margin_start: 12, halign: Align.START }));
  });

  item_factory.connect("bind", (_self, list_item) => {
    if (!(list_item instanceof GtkListItem)) return;
    const item = list_item.get_item();
    const label = list_item.get_child();
    if (!(item instanceof GtkStringObject) || !(label instanceof GtkLabel)) return;

    label.set_label(item.get_string());
  });

  header_factory.connect("setup", (_self, list_item) => {
    if (!(list_item instanceof GtkListHeader)) return;
    list_item.set_child(new GtkLabel({ label: "Header", halign: Align.START }));
  });

  const custom_model = new CustomModel();

  for (let i = 1; i <= 200; i++) {
    custom_model.append(`Item ${i}`);
  }

  const selection_model = new GtkNoSelection({ model: custom_model });
  list_view.set_model(selection_model);
}

run(demo);
