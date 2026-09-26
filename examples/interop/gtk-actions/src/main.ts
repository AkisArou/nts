// An application's actions, menu, accelerators and style, as a GTK
// application writes them.
//
// The log:
//   count 2       `bump`, a `GSimpleAction` made from `{ name }` alone --
//                 `g_simple_action_new`, its `parameter_type` NULL -- and
//                 activated twice through the application
//   dark true     `dark`, made from `{ name, state }`: the literal names the
//                 state, so the constructor is `g_simple_action_new_stateful`;
//                 its `change-state` handler takes the new state
//   accels <Control>b  the accelerator set for `app.bump`, read back
//   big true      the label's style class, which a `GtkCssProvider` styles
import {
  GtkApplication,
  GtkApplicationWindow,
  GtkCssProvider,
  GtkHeaderBar,
  GtkLabel,
  GtkMenuButton,
  gtk_style_context_add_provider_for_display,
} from "c:Gtk-4.0";
import { gdk_display_get_default } from "c:Gdk-4.0";
import { ApplicationFlags, GMenu, GSimpleAction } from "c:Gio-2.0";
import { g_variant_get_boolean, g_variant_new_boolean } from "c:GLib-2.0";

function open(app: GtkApplication): void {
  let count = 0;
  const bump = new GSimpleAction({ name: "bump" });
  bump.connect("activate", () => {
    count++;
  });
  app.add_action(bump);
  const dark = new GSimpleAction({ name: "dark", state: g_variant_new_boolean(false) });
  dark.connect("change-state", (action, value) => {
    if (value !== null) action.set_state(value);
  });
  app.add_action(dark);
  app.set_accels_for_action("app.bump", ["<Control>b"]);
  const menu = new GMenu();
  menu.append("Bump", "app.bump");
  menu.append("Dark", "app.dark");
  const header = new GtkHeaderBar({});
  header.pack_end(new GtkMenuButton({ menu_model: menu, icon_name: "open-menu-symbolic" }));
  const css = new GtkCssProvider();
  css.load_from_string("label.big { font-size: 20px; }");
  const display = gdk_display_get_default();
  if (display !== null) gtk_style_context_add_provider_for_display(display, css, 600);
  const label = new GtkLabel({ label: "hi", css_classes: ["big"] });
  const window = new GtkApplicationWindow({ application: app, title: "Probe" });
  window.set_titlebar(header);
  window.set_child(label);
  window.present();
  app.activate_action("bump", null);
  app.activate_action("bump", null);
  app.change_action_state("dark", g_variant_new_boolean(true));
  const state = dark.get_state();
  const accels = app.get_accels_for_action("app.bump");
  console.log(
    "count " + String(count) + " dark " + String(state !== null && g_variant_get_boolean(state)) + " accels " + accels.join(",") +
      " big " + String(label.has_css_class("big")),
  );
  app.quit();
}

function main(): void {
  const app = new GtkApplication({ application_id: "dev.nts.Probe", flags: ApplicationFlags.NON_UNIQUE });
  app.connect("activate", () => {
    open(app);
  });
  app.run(["probe"]);
}

main();
