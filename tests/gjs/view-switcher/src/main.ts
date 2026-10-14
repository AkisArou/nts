// Workbench's "View Switcher" demo (CC0, workbenchdev/demos), ported.
//
// GJS takes an enum's nick and a number as strings (`halign: "center"`,
// `margin_top: "10"`); a typed props object takes the member and the number.
import { AdwActionRow, AdwViewStackPage } from "c:Adw-1";
import { Align, GtkButton, GtkListBox } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const notifications_page = workbench.builder.get_object("page3");
  const notification_list = workbench.builder.get_object("notification_list");
  if (!(notifications_page instanceof AdwViewStackPage) || !(notification_list instanceof GtkListBox)) {
    throw new Error("the demo's UI");
  }

  const notification_count = 5;
  notifications_page.badge_number = notification_count;

  for (let i = 0; i < notification_count; i++) {
    const notification_row = new AdwActionRow({
      title: "Notification",
      selectable: false,
    });

    const button = new GtkButton({
      halign: Align.CENTER,
      valign: Align.CENTER,
      margin_top: 10,
      margin_bottom: 10,
      icon_name: "check-plain-symbolic",
    });

    button.connect("clicked", () => {
      // Never below zero: the badge is an unsigned count, and C would read
      // -1 as 4294967295.
      const badges = notifications_page.badge_number;
      if (badges > 0) notifications_page.badge_number = badges - 1;
      notification_list.remove(notification_row);

      if (notifications_page.badge_number === 0) {
        notifications_page.needs_attention = false;
      }
    });

    notification_row.add_suffix(button);

    notification_list.append(notification_row);
  }
}

run(demo);
