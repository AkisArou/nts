// Workbench's "Drop Down" demo (CC0, workbenchdev/demos), ported.
import { GListStore } from "c:Gio-2.0";
import type { Property } from "c:types";
import { G_TYPE_STRING, GObject } from "c:GObject-2.0";
import { GtkClosureExpression, GtkDropDown, GtkPropertyExpression, GtkStringObject } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

// GJS's `GObject.registerClass({ Properties: ... })`, as a class declares
// its properties here.
class KeyValuePair extends GObject {
  key: Property<string> = "";
  value: Property<string> = "";
}

function demo(workbench: Workbench): void {
  const drop_down = workbench.builder.get_object("drop_down");
  const advanced_drop_down = workbench.builder.get_object("advanced_drop_down");
  if (!(drop_down instanceof GtkDropDown) || !(advanced_drop_down instanceof GtkDropDown)) {
    throw new Error("the demo's UI");
  }

  drop_down.connect("notify::selected-item", () => {
    const selected_item = drop_down.selected_item;
    if (!(selected_item instanceof GtkStringObject)) return;
    console.log(selected_item.get_string());
  });

  const expression = new GtkClosureExpression(G_TYPE_STRING, (obj: GtkStringObject) => obj.string, null);

  drop_down.expression = expression;

  const model = new GListStore({ item_type: KeyValuePair.$gtype });

  model.splice(0, 0, [
    new KeyValuePair({ key: "lion", value: "Lion" }),
    new KeyValuePair({ key: "tiger", value: "Tiger" }),
    new KeyValuePair({ key: "leopard", value: "Leopard" }),
    new KeyValuePair({ key: "elephant", value: "Elephant" }),
    new KeyValuePair({ key: "giraffe", value: "Giraffe" }),
    new KeyValuePair({ key: "cheetah", value: "Cheetah" }),
    new KeyValuePair({ key: "zebra", value: "Zebra" }),
    new KeyValuePair({ key: "panda", value: "Panda" }),
    new KeyValuePair({ key: "koala", value: "Koala" }),
    new KeyValuePair({ key: "crocodile", value: "Crocodile" }),
    new KeyValuePair({ key: "hippo", value: "Hippopotamus" }),
    new KeyValuePair({ key: "monkey", value: "Monkey" }),
    new KeyValuePair({ key: "rhino", value: "Rhinoceros" }),
    new KeyValuePair({ key: "kangaroo", value: "Kangaroo" }),
    new KeyValuePair({ key: "dolphin", value: "Dolphin" }),
  ]);

  const list_store_expression = GtkPropertyExpression.new(KeyValuePair.$gtype, null, "value");

  advanced_drop_down.expression = list_store_expression;
  advanced_drop_down.model = model;

  advanced_drop_down.connect("notify::selected-item", () => {
    const selected_item = advanced_drop_down.selected_item;
    if (selected_item instanceof KeyValuePair) {
      console.log(selected_item.key);
    }
  });
}

run(demo);
