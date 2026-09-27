// Workbench's "List View" demo (CC0, workbenchdev/demos), ported.
import { GtkButton, GtkListView, GtkSingleSelection, GtkStringList } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const list_view = workbench.builder.get_object("list_view");
  const add = workbench.builder.get_object("add");
  const remove = workbench.builder.get_object("remove");
  if (!(list_view instanceof GtkListView) || !(add instanceof GtkButton) || !(remove instanceof GtkButton)) {
    throw new Error("the demo's UI");
  }

  //Model
  let item = 1;
  const string_model = new GtkStringList({
    strings: ["Default Item 1", "Default Item 2", "Default Item 3"],
  });

  const model = new GtkSingleSelection({ model: string_model });

  //View
  // GJS reads the selection's model back as the list it is; TypeScript
  // names the one the demo made.
  string_model.connect("items-changed", (_list, position, removed, added) => {
    console.log(`position: ${position}, Item removed? ${Boolean(removed)}, Item added? ${Boolean(added)}`);
  });

  model.connect("selection-changed", () => {
    const selected_item = model.get_selected();
    console.log(`Model item selected from view: ${string_model.get_string(selected_item)}`);
  });

  list_view.model = model;

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
