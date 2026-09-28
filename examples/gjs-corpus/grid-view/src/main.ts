// Workbench's "Grid View" demo (CC0, workbenchdev/demos), ported.
import {
  Align,
  GtkBox,
  GtkButton,
  GtkGridView,
  GtkLabel,
  GtkListItem,
  GtkSignalListItemFactory,
  GtkSingleSelection,
  GtkStringList,
  GtkStringObject,
} from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const grid_view = workbench.builder.get_object("grid_view");
  const add = workbench.builder.get_object("add");
  const remove = workbench.builder.get_object("remove");
  if (!(grid_view instanceof GtkGridView) || !(add instanceof GtkButton) || !(remove instanceof GtkButton)) {
    throw new Error("the demo's UI");
  }

  //Model
  let item = 1;
  const string_model = new GtkStringList({
    strings: ["Default Item 1", "Default Item 2", "Default Item 3"],
  });

  const model = new GtkSingleSelection({ model: string_model });

  const factory_for_grid_view = new GtkSignalListItemFactory();
  factory_for_grid_view.connect("setup", (_self, listItem) => {
    if (!(listItem instanceof GtkListItem)) return;
    const listBox = new GtkBox({
      width_request: 160,
      height_request: 160,
      css_classes: ["card"],
    });
    const label = new GtkLabel({
      halign: Align.CENTER,
      hexpand: true,
      valign: Align.CENTER,
    });
    listBox.append(label);
    listItem.set_child(listBox);
  });
  factory_for_grid_view.connect("bind", (_self, listItem) => {
    if (!(listItem instanceof GtkListItem)) return;
    const listBox = listItem.get_child();
    const modelItem = listItem.get_item();
    const labelWidget = listBox?.get_last_child() ?? null;
    if (!(labelWidget instanceof GtkLabel) || !(modelItem instanceof GtkStringObject)) return;

    labelWidget.label = modelItem.string;
  });

  //View
  string_model.connect("items-changed", (_list, position, removed, added) => {
    console.log(
      `position: ${position}, Item removed? ${Boolean(
        removed,
      )}, Item added? ${Boolean(added)}`,
    );
  });

  model.connect("selection-changed", () => {
    const selected_item = model.get_selected();
    console.log(
      `Model item selected from view: ${string_model.get_string(selected_item)}`,
    );
  });

  grid_view.model = model;
  grid_view.factory = factory_for_grid_view;

  // Controller
  add.connect("clicked", () => {
    const new_item = `New item ${item}`;
    string_model.append(new_item);
    item++;
  });

  remove.connect("clicked", () => {
    const selected_item = model.get_selected();
    string_model.remove(selected_item);
  });
}

run(demo);
