// A libadwaita application, written as GJS writes one: an `AdwApplication`,
// an `AdwApplicationWindow` whose content is an `AdwToolbarView` with an
// `AdwHeaderBar` on top and an `AdwStatusPage` inside -- every class made from
// its props, and the page read back through `instanceof`. It checks itself and
// quits.
//
// The log:
//   status Hello from nts  the toolbar view's content, narrowed to the status
//                 page it is (`instanceof AdwStatusPage`) and its properties read
//   shown true    the window was presented
//
// That Adw-1's bindings typecheck at all rests on the props types folding
// `| null` into absent (`@ntsNullable`): `AdwPreferencesPage` redeclares
// `name` as nullable where `GtkWidget`'s is not, and its props would not
// otherwise extend `GtkWidgetProps` (TS2430).
import { AdwApplication, AdwApplicationWindow, AdwHeaderBar, AdwStatusPage, AdwToolbarView } from "c:Adw-1";
import { ApplicationFlags } from "c:Gio-2.0";
import { g_timeout_add_full } from "c:GLib-2.0";
import { adw_log } from "c:adw-shim";

function main(): void {
  const application = new AdwApplication({ application_id: "dev.nts.Adw", flags: ApplicationFlags.NON_UNIQUE });
  application.connect("activate", () => {
    const view = new AdwToolbarView({});
    view.add_top_bar(new AdwHeaderBar({}));
    view.content = new AdwStatusPage({ title: "Hello", description: "from nts", icon_name: "face-smile-symbolic" });
    const window = new AdwApplicationWindow({ application, content: view });
    window.present();
    const page = view.content;
    adw_log("status " + (page instanceof AdwStatusPage ? page.title + " " + (page.description ?? "") : "none"));
    g_timeout_add_full(0, 200, () => {
      adw_log("shown " + String(window.get_visible()));
      application.quit();
      return false;
    });
  });
  application.run(["adw"]);
}

main();
