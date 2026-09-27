// Workbench's "Menu" demo (CC0, workbenchdev/demos), ported.
import { GSimpleAction, GSimpleActionGroup } from "c:Gio-2.0";
import { g_variant_new_boolean, g_variant_new_string, g_variant_type_new } from "c:GLib-2.0";
import { GtkLabel } from "c:Gtk-4.0";
import { pango_attr_list_from_string, type PangoAttrList } from "c:Pango-1.0";
import { run, type Workbench } from "../../host/workbench.ts";

interface TextState {
  italic: boolean;
  bold: boolean;
  foreground: string;
}

function demo(workbench: Workbench): void {
  const label = workbench.builder.get_object("label");
  if (!(label instanceof GtkLabel)) throw new Error("the demo's UI");

  const text_group = new GSimpleActionGroup({});
  label.insert_action_group("text", text_group);

  const text_state: TextState = { italic: false, bold: false, foreground: "green" };

  // GJS unpacks an action's state with `unpack()`; the binding reads the
  // variant as the type it is. And a `notify` handler's first parameter is
  // typed as the class that declares `notify`, GObject, so each handler
  // reads the action it was connected to.
  const italic_action = new GSimpleAction({
    name: "italic",
    state: g_variant_new_boolean(false),
  });

  italic_action.connect("notify::state", () => {
    if (italic_action.state!.get_boolean()) text_state["italic"] = true;
    else text_state["italic"] = false;
    label.attributes = stateToAttr(text_state);
  });
  text_group.add_action(italic_action);

  const bold_action = new GSimpleAction({
    name: "bold",
    state: g_variant_new_boolean(false),
  });

  bold_action.connect("notify::state", () => {
    if (bold_action.state!.get_boolean()) text_state["bold"] = true;
    else text_state["bold"] = false;
    label.attributes = stateToAttr(text_state);
  });
  text_group.add_action(bold_action);

  const color_action = new GSimpleAction({
    name: "color",
    state: g_variant_new_string("green"),
    parameter_type: g_variant_type_new("s"),
  });

  color_action.connect("notify::state", () => {
    text_state["foreground"] = color_action.state!.get_string()[0];
    label.attributes = stateToAttr(text_state);
  });

  text_group.add_action(color_action);
}

// Helper function to create a PangoAttrList from text_state
function stateToAttr(state: TextState): PangoAttrList {
  const attrs: string[] = [];
  if (state["bold"]) attrs.push("0 -1 weight bold");
  if (state["italic"]) attrs.push("0 -1 style italic");
  attrs.push(`0 -1 foreground ${state["foreground"]}`);
  const attr_string = attrs.join(", ");
  return pango_attr_list_from_string(attr_string)!;
}

run(demo);
