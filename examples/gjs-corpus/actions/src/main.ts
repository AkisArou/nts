// Workbench's "Actions" demo (CC0, workbenchdev/demos), ported.
//
// GJS's `new GLib.VariantType("s")` is `GVariantType.new("s")`, and its
// `Variant.unpack()` the typed getter GLib has for the variant's type.
import { GPropertyAction, GSimpleAction, GSimpleActionGroup } from "c:Gio-2.0";
import { GVariantType, g_variant_new_boolean, g_variant_new_string } from "c:GLib-2.0";
import { GtkLabel, GtkWidget } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const demo = workbench.builder.get_object("demo");
  const text = workbench.builder.get_object("text");
  if (!(demo instanceof GtkWidget) || !(text instanceof GtkLabel)) throw new Error("the demo's UI");

  const demo_group = new GSimpleActionGroup();
  demo.insert_action_group("demo", demo_group);

  // Action with no state or parameters
  const simple_action = new GSimpleAction({
    name: "simple",
  });

  simple_action.connect("activate", (action) => {
    console.log(`${action.name} action activated`);
  });

  demo_group.add_action(simple_action);

  // Action with parameter
  const bookmarks_action = new GSimpleAction({
    name: "open-bookmarks",
    parameter_type: GVariantType.new("s"),
  });

  bookmarks_action.connect("activate", (action, parameter) => {
    if (parameter !== null) console.log(`${action.name} activated with ${parameter.get_string()[0]}`);
  });

  demo_group.add_action(bookmarks_action);

  // Action with state
  const toggle_action = new GSimpleAction({
    name: "toggle",
    // Boolean actions dont need parameters for activation
    state: g_variant_new_boolean(false),
  });

  toggle_action.connect("notify::state", (action) => {
    const state = action.state;
    if (state !== null) console.log(`${action.name} action set to ${state.get_boolean()}`);
  });

  demo_group.add_action(toggle_action);

  // Action with state and parameter
  const scale_action = new GSimpleAction({
    name: "scale",
    state: g_variant_new_string("100%"),
    parameter_type: GVariantType.new("s"),
  });

  scale_action.connect("notify::state", (action) => {
    const state = action.state;
    if (state !== null) console.log(`${action.name} action set to ${state.get_string()[0]}`);
  });

  demo_group.add_action(scale_action);

  const alignment_action = new GPropertyAction({
    name: "text-align",
    object: text,
    property_name: "halign",
  });

  demo_group.add_action(alignment_action);
}

run(demo);
