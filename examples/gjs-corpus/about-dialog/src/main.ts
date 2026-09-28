// Workbench's "About Dialog" demo (CC0, workbenchdev/demos), ported.
import { gettext as _ } from "gettext";
import { AdwAboutDialog } from "c:Adw-1";
import { GtkButton, License } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const button = workbench.builder.get_object("button");
  if (!(button instanceof GtkButton)) throw new Error("the demo's UI");

  function openAboutDialog(): void {
    const dialog = new AdwAboutDialog({
      application_icon: "application-x-executable",
      application_name: "Typeset",
      developer_name: "Angela Avery",
      version: "1.2.3",
      comments: _(
        "Typeset is an app that doesn’t exist and is used as an example content for About Dialog.",
      ),
      website: "https://example.org",
      issue_url: "https://example.org",
      support_url: "https://example.org",
      copyright: "© 2023 Angela Avery",
      license_type: License.GPL_3_0_ONLY,
      developers: ["Angela Avery <angela@example.org>"],
      artists: ["GNOME Design Team"],
      translator_credits: _("translator-credits"),
    });

    dialog.add_link(
      _("Documentation"),
      "https://gnome.pages.gitlab.gnome.org/libadwaita/doc/1.6/class.AboutDialog.html",
    );

    dialog.add_legal_section(
      _("Fonts"),
      null,
      License.CUSTOM,
      _(
        "This application uses font data from <a href='https://example.org'>somewhere</a>.",
      ),
    );

    dialog.add_acknowledgement_section(_("Special thanks to"), [_("My cat")]);

    dialog.present(workbench.window);
  }

  button.connect("clicked", openAboutDialog);
}

run(demo);
