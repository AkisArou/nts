// Workbench's "Network Monitor" demo (CC0, workbenchdev/demos), ported.
import { AdwBanner } from "c:Adw-1";
import { g_network_monitor_get_default } from "c:Gio-2.0";
import { GtkLevelBar } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const banner = workbench.builder.get_object("banner");
  const network_monitor = g_network_monitor_get_default();
  const level_bar = workbench.builder.get_object("level_bar");
  if (!(banner instanceof AdwBanner) || !(level_bar instanceof GtkLevelBar)) throw new Error("the demo's UI");

  function setNetworkStatus(): void {
    if (!(banner instanceof AdwBanner) || !(level_bar instanceof GtkLevelBar)) return;
    banner.revealed = network_monitor.network_metered;
    level_bar.value = network_monitor.connectivity;
  }

  setNetworkStatus();
  network_monitor.connect("network-changed", () => {
    setNetworkStatus();
  });

  banner.connect("button-clicked", () => {
    banner.revealed = false;
  });
}

run(demo);
