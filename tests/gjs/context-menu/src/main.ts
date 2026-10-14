// Workbench's "Context Menu" demo (CC0, workbenchdev/demos), ported.
import { GdkRectangle } from "c:Gdk-4.0";
import { GSimpleAction, GSimpleActionGroup } from "c:Gio-2.0";
import { g_variant_type_new } from "c:GLib-2.0";
import { GtkBox, GtkGestureClick, GtkLabel, GtkPopoverMenu } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const box_menu_parent = workbench.builder.get_object("box_menu_parent");
  const label_emoji = workbench.builder.get_object("label_emoji");
  const gesture_click = workbench.builder.get_object("gesture_click");
  const popover_menu = workbench.builder.get_object("popover_menu");
  if (
    !(box_menu_parent instanceof GtkBox) ||
    !(label_emoji instanceof GtkLabel) ||
    !(gesture_click instanceof GtkGestureClick) ||
    !(popover_menu instanceof GtkPopoverMenu)
  ) {
    throw new Error("the demo's UI");
  }

  gesture_click.connect("pressed", (_self, _n_press, x, y) => {
    const position = new GdkRectangle({ x: x, y: y });
    popover_menu.pointing_to = position;
    popover_menu.popup();
  });

  const mood_group = new GSimpleActionGroup({});
  box_menu_parent.insert_action_group("mood", mood_group);

  const emoji_action = new GSimpleAction({
    name: "emoji",
    parameter_type: g_variant_type_new("s"),
  });

  emoji_action.connect("activate", (_action, parameter) => {
    // GJS unpacks a variant with `deepUnpack()`; the binding reads it as
    // what it is, a string.
    label_emoji.label = parameter!.get_string()[0];
  });
  mood_group.add_action(emoji_action);
}

run(demo);
