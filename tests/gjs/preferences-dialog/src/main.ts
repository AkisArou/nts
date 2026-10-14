// Workbench's "Preferences Dialog" demo (CC0, workbenchdev/demos), ported.
import {
  AdwActionRow,
  AdwNavigationPage,
  AdwPreferencesDialog,
  AdwSwitchRow,
  AdwToast,
  ColorScheme,
  adw_style_manager_get_default,
} from "c:Adw-1";
import { GtkButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const dialog = workbench.builder.get_object("dialog");
  const dm_switch = workbench.builder.get_object("dm_switch");
  const subpage = workbench.builder.get_object("subpage");
  const subpage_row = workbench.builder.get_object("subpage_row");
  const subpage_button = workbench.builder.get_object("subpage_button");
  const toast_button = workbench.builder.get_object("toast_button");
  const style_manager = adw_style_manager_get_default();
  const button = workbench.builder.get_object("button");
  if (
    !(dialog instanceof AdwPreferencesDialog) ||
    !(dm_switch instanceof AdwSwitchRow) ||
    !(subpage instanceof AdwNavigationPage) ||
    !(subpage_row instanceof AdwActionRow) ||
    !(subpage_button instanceof GtkButton) ||
    !(toast_button instanceof GtkButton) ||
    !(button instanceof GtkButton)
  ) {
    throw new Error("the demo's UI");
  }

  dm_switch.active = style_manager.dark;

  dm_switch.connect("notify::active", () => {
    // When the Switch is toggled, set the color scheme
    if (dm_switch.active) {
      style_manager.color_scheme = ColorScheme.FORCE_DARK;
    } else {
      style_manager.color_scheme = ColorScheme.FORCE_LIGHT;
    }
  });

  // Preferences dialogs can display subpages
  subpage_row.connect("activated", () => {
    dialog.push_subpage(subpage);
  });

  subpage_button.connect("clicked", () => {
    dialog.pop_subpage();
  });

  toast_button.connect("clicked", () => {
    const toast = new AdwToast({
      title: "Preferences dialogs can display toasts",
    });

    dialog.add_toast(toast);
  });

  button.connect("clicked", () => {
    dialog.present(workbench.window);
  });
}

run(demo);
