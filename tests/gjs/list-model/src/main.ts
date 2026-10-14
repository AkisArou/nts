// Workbench's "List Model" demo (CC0, workbenchdev/demos), ported.
import { AdwActionRow, AdwBin } from "c:Adw-1";
import { GObject } from "c:GObject-2.0";
import {
  Align,
  GtkButton,
  GtkFilterListModel,
  GtkFlowBox,
  GtkLabel,
  GtkListBox,
  GtkPropertyExpression,
  GtkSearchEntry,
  GtkStack,
  GtkStringFilter,
  GtkStringList,
  GtkStringObject,
  GtkWidget,
  StringFilterMatchMode,
} from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function title(item: GObject): string {
  return item instanceof GtkStringObject ? item.string : "";
}

function createItemForListBox(listItem: GObject): GtkWidget {
  const listRow = new AdwActionRow({
    title: title(listItem),
  });
  return listRow;
}

function createItemForFlowBox(listItem: GObject): GtkWidget {
  const listBox = new AdwBin({
    width_request: 160,
    height_request: 160,
    css_classes: ["card"],
    valign: Align.START,
    child: new GtkLabel({
      label: title(listItem),
      halign: Align.CENTER,
      hexpand: true,
      valign: Align.CENTER,
    }),
  });
  return listBox;
}

function createItemForFilterModel(listItem: GObject): GtkWidget {
  const listRow = new AdwActionRow({
    title: title(listItem),
  });
  return listRow;
}

function demo(workbench: Workbench): void {
  const stack = workbench.builder.get_object("stack");
  const list_box = workbench.builder.get_object("list_box");
  const flow_box = workbench.builder.get_object("flow_box");
  const add = workbench.builder.get_object("add");
  const remove = workbench.builder.get_object("remove");
  const list_box_editable = workbench.builder.get_object("list_box_editable");
  const search_entry = workbench.builder.get_object("search_entry");
  if (
    !(stack instanceof GtkStack) ||
    !(list_box instanceof GtkListBox) ||
    !(flow_box instanceof GtkFlowBox) ||
    !(add instanceof GtkButton) ||
    !(remove instanceof GtkButton) ||
    !(list_box_editable instanceof GtkListBox) ||
    !(search_entry instanceof GtkSearchEntry)
  ) {
    throw new Error("the demo's UI");
  }

  //Model
  const model = new GtkStringList({
    strings: ["Default Item 1", "Default Item 2", "Default Item 3"],
  });
  let item = 1;

  model.connect("items-changed", (_self, position, removed, added) => {
    console.log(
      `position: ${position}, Item removed? ${Boolean(
        removed,
      )}, Item added? ${Boolean(added)}`,
    );
  });

  //Filter-Model
  const search_expression = GtkPropertyExpression.new(GtkStringObject.$gtype, null, "string");
  const filter = new GtkStringFilter({
    expression: search_expression,
    ignore_case: true,
    match_mode: StringFilterMatchMode.SUBSTRING,
  });
  const filter_model = new GtkFilterListModel({
    model: model,
    filter: filter,
    incremental: true,
  });

  list_box.bind_model(model, createItemForListBox);
  flow_box.bind_model(model, createItemForFlowBox);
  list_box_editable.bind_model(filter_model, createItemForFilterModel);

  // Controller
  add.connect("clicked", () => {
    const new_item = `New Item ${item}`;
    model.append(new_item);
    item++;
  });

  remove.connect("clicked", () => {
    const selectedRow = list_box_editable.get_selected_row();
    if (selectedRow === null) return;
    // -1 for a row in no list, which C would read as row 4294967295.
    const index = selectedRow.get_index();
    if (index < 0) return;
    model.remove(index);
  });

  search_entry.connect("search-changed", () => {
    const searchText = search_entry.get_text();
    filter.search = searchText;
  });

  // View
  stack.connect("notify::visible-child", () => {
    console.log("View changed");
  });

  list_box_editable.connect("row-selected", () => {
    remove.sensitive = list_box_editable.get_selected_row() !== null;
  });
}

run(demo);
