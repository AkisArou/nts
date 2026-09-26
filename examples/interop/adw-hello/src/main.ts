// A libadwaita application, written as GJS writes one: an `AdwApplication`,
// an `AdwApplicationWindow` whose content is an `AdwToolbarView` with an
// `AdwHeaderBar` on top -- every class made from its props. It checks itself
// and quits.
//
// The log:
//   status Hello from nts  an `AdwStatusPage` set as a view's content, read
//                 back narrowed through `instanceof AdwStatusPage`
//   wifi true name Ada view grid  a preferences group's rows, each written
//                 as a property: an `AdwSwitchRow`'s `active`, an
//                 `AdwEntryRow`'s `text`, an `AdwToggleGroup`'s `active_name`
//   activated 1   an `AdwActionRow`'s `activated` signal, from `activate()`
//   dismissed 1   an `AdwToast` added to an `AdwToastOverlay` by a button's
//                 handler, and dismissed when its one-second timeout ends
//   shown true    the window was presented
//
// That Adw-1's bindings typecheck at all rests on the props types folding
// `| null` into absent (`@ntsNullable`): `AdwPreferencesPage` redeclares
// `name` as nullable where `GtkWidget`'s is not, and its props would not
// otherwise extend `GtkWidgetProps` (TS2430).
import {
  AdwActionRow,
  AdwApplication,
  AdwApplicationWindow,
  AdwEntryRow,
  AdwHeaderBar,
  AdwPreferencesGroup,
  AdwStatusPage,
  AdwSwitchRow,
  AdwToast,
  AdwToastOverlay,
  AdwToggle,
  AdwToggleGroup,
  AdwToolbarView,
} from "c:Adw-1";
import { GtkBox, GtkButton, Orientation } from "c:Gtk-4.0";
import { ApplicationFlags } from "c:Gio-2.0";
import { g_timeout_add_full } from "c:GLib-2.0";

function status(): string {
  const view = new AdwToolbarView({});
  view.content = new AdwStatusPage({ title: "Hello", description: "from nts", icon_name: "face-smile-symbolic" });
  const page = view.content;
  return "status " + (page instanceof AdwStatusPage ? page.title + " " + (page.description ?? "") : "none");
}

function main(): void {
  const application = new AdwApplication({ application_id: "dev.nts.Adw", flags: ApplicationFlags.NON_UNIQUE });
  application.connect("activate", () => {
    console.log(status());
    const group = new AdwPreferencesGroup({ title: "Settings" });
    const wifi = new AdwSwitchRow({ title: "Wi-Fi" });
    const name = new AdwEntryRow({ title: "Name" });
    const about = new AdwActionRow({ title: "About", subtitle: "nts", activatable: true });
    let activated = 0;
    about.connect("activated", () => {
      activated++;
    });
    group.add(wifi);
    group.add(name);
    group.add(about);
    const toggles = new AdwToggleGroup({});
    toggles.add(new AdwToggle({ name: "list", label: "List" }));
    toggles.add(new AdwToggle({ name: "grid", label: "Grid" }));
    const overlay = new AdwToastOverlay({});
    const column = new GtkBox({ orientation: Orientation.VERTICAL, spacing: 12 });
    column.append(toggles);
    column.append(group);
    const button = new GtkButton({ label: "Save" });
    let dismissed = 0;
    button.connect("clicked", () => {
      const toast = new AdwToast({ title: "Saved", timeout: 1 });
      toast.connect("dismissed", () => {
        dismissed++;
      });
      overlay.add_toast(toast);
    });
    column.append(button);
    overlay.child = column;
    const view = new AdwToolbarView({});
    view.add_top_bar(new AdwHeaderBar({}));
    view.content = overlay;
    const window = new AdwApplicationWindow({ application, content: view, default_width: 360 });
    window.present();
    wifi.active = true;
    name.text = "Ada";
    toggles.active_name = "grid";
    about.activate();
    button.emit("clicked");
    console.log("wifi " + String(wifi.active) + " name " + name.text + " view " + (toggles.active_name ?? "") + " activated " + String(activated));
    g_timeout_add_full(0, 1500, () => {
      console.log("dismissed " + String(dismissed) + " shown " + String(window.get_visible()));
      application.quit();
      return false;
    });
  });
  application.run(["adw"]);
}

main();
