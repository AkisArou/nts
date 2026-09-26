// react-gtk's libadwaita widgets (react-gtk/adw), driven directly on real
// widgets as native/gtk drives GTK's. Each logged line is one observable fact,
// and build.sh compares the log whole.
//
//   props     an Adw widget's own prop (a HeaderBar's showEndTitleButtons) and
//             one it inherits from GTK (cssClasses, through GtkWidget's
//             function) reach the widget
//   slot      an ApplicationWindow's Content slot element fills its content,
//             and taken out empties it
//   signal    an ActionRow's activated signal runs its handler
//   controlled  an EntryRow's text, from GTK's Editable, is controlled: a
//             user's edit goes back to the props' value when the app keeps it
//   application  an AdwApplication's root: an ApplicationWindow rendered there
//             joins the application at commit
//   unknown   a root without the adw set creates no Adw widget
//   reset     removing the Adw prop restores libadwaita's default, and
//             removing the inherited GTK one clears it

import { AdwActionRow, adw_init, AdwApplication, AdwApplicationWindow, AdwEntryRow, AdwHeaderBar } from "c:Adw-1";
import { ApplicationFlags } from "c:Gio-2.0";
import { g_main_context_iteration } from "c:GLib-2.0";
import { GtkWindow, type GtkWidget } from "c:Gtk-4.0";
import { react_gtk_emit, react_gtk_log } from "c:react-gtk-shim";
import { setAfterEvent } from "../../../packages/react-gtk/src/HostNode.ts";
import { adw } from "../../../packages/react-gtk/src/adw/index.ts";
import {
  ApplicationRoot,
  appendChildToContainer,
  appendInitialChild,
  commitMount,
  commitUpdate,
  createInstance,
  finalizeInitialChildren,
  getPublicInstance,
  type HostNode,
  removeChild,
  removeChildFromContainer,
  WindowRoot,
} from "../../../packages/react-gtk/src/ReactFiberConfig.ts";

function widget(node: HostNode): GtkWidget {
  return getPublicInstance(node);
}

// Runs what the main loop has ready: controlled props are put back from it.
function idle(): void {
  while (g_main_context_iteration(null, false)) {
    // until nothing is ready
  }
}

function main(): void {
  adw_init();
  const root = new WindowRoot(new GtkWindow(), [adw]);

  const bar = createInstance("AdwHeaderBar", { showEndTitleButtons: false, cssClasses: ["flat"] }, root, 0, {});
  const barWidget = widget(bar);
  react_gtk_log(
    "props " +
      String(barWidget instanceof AdwHeaderBar && !barWidget.get_show_end_title_buttons()) +
      " " +
      String(barWidget.has_css_class("flat")),
  );

  const window = createInstance("AdwApplicationWindow", {}, root, 0, {});
  const content = createInstance("AdwApplicationWindow.Content", {}, root, 0, {});
  const label = createInstance("GtkLabel", { label: "content" }, root, 0, {});
  appendInitialChild(content, label);
  appendInitialChild(window, content);
  const windowWidget = widget(window);
  const filled = windowWidget instanceof AdwApplicationWindow && windowWidget.get_content() === widget(label);
  removeChild(window, content);
  const emptied = windowWidget instanceof AdwApplicationWindow && windowWidget.get_content() === null;
  react_gtk_log("slot " + String(filled) + " " + String(emptied));

  let activations = 0;
  const row = createInstance("AdwActionRow", { title: "Row", onActivated: () => activations++ }, root, 0, {});
  const rowWidget = widget(row);
  if (rowWidget instanceof AdwActionRow) {
    react_gtk_emit(rowWidget, "activated");
  }
  react_gtk_log("signal " + String(activations));

  // The app keeps its state: nothing is flushed, so the text goes back.
  setAfterEvent(() => {});
  const entry = createInstance("AdwEntryRow", { text: "kept" }, root, 0, {});
  const entryWidget = widget(entry);
  if (entryWidget instanceof AdwEntryRow) {
    entryWidget.set_text("typed");
  }
  idle();
  react_gtk_log("controlled " + (entryWidget instanceof AdwEntryRow ? entryWidget.get_text() : "not an entry row"));

  const application = new AdwApplication({ application_id: "org.nts.ReactAdw", flags: ApplicationFlags.NON_UNIQUE });
  application.register(null, null);
  const appRoot = new ApplicationRoot(application, [adw]);
  const appWindow = createInstance("AdwApplicationWindow", { title: "App" }, appRoot, 0, {});
  const wantsMount = finalizeInitialChildren(appWindow, "AdwApplicationWindow", { title: "App" }, 0);
  appendChildToContainer(appRoot, appWindow);
  commitMount(appWindow, "AdwApplicationWindow", { title: "App" }, {});
  const appWidget = widget(appWindow);
  const joined = appWidget instanceof GtkWindow && appWidget.get_application() === application;
  removeChildFromContainer(appRoot, appWindow);
  react_gtk_log("application " + String(wantsMount) + " " + String(joined));

  const gtkOnly = new WindowRoot(new GtkWindow(), []);
  react_gtk_log("unknown " + String(gtkOnly.createNode("AdwHeaderBar") === null) + " " + String(gtkOnly.createNode("GtkLabel") !== null));

  commitUpdate(bar, "AdwHeaderBar", { showEndTitleButtons: false, cssClasses: ["flat"] }, {}, {});
  react_gtk_log("reset " + String(barWidget instanceof AdwHeaderBar && barWidget.get_show_end_title_buttons()) + " " + String(!barWidget.has_css_class("flat")));
}

main();
