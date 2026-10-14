// Workbench's "Banner" demo (CC0, workbenchdev/demos), ported.
import { AdwBanner, AdwToast, AdwToastOverlay } from "c:Adw-1";
import { GtkButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const banner = workbench.builder.get_object("banner");
  const overlay = workbench.builder.get_object("overlay");
  const button_show_banner = workbench.builder.get_object("button_show_banner");
  if (!(banner instanceof AdwBanner) || !(overlay instanceof AdwToastOverlay) || !(button_show_banner instanceof GtkButton)) {
    throw new Error("the demo's UI");
  }

  // An arrow where the original declares a function: TypeScript keeps the
  // narrowing above only in what cannot be called before it.
  const alert = (): void => {
    const toast = new AdwToast({
      title: "Troubleshoot successful!",
      timeout: 3,
    });

    overlay.add_toast(toast);
  };

  banner.connect("button-clicked", () => {
    alert();
    banner.revealed = false;
  });

  button_show_banner.connect("clicked", () => {
    banner.revealed = true;
  });
}

run(demo);
