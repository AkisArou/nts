// Workbench's "Notification" demo (CC0, workbenchdev/demos), ported.
import { GNotification, GSimpleAction, GThemedIcon } from "c:Gio-2.0";
import { GtkButton } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const { application, builder } = workbench;

  // https://gjs-docs.gnome.org/gio20/gio.notification
  const notification = new GNotification();

  notification.set_title("Lunch is ready");
  notification.set_body("Today we have pancakes and salad, and fruit and cake for dessert");
  notification.set_default_action("app.notification-reply");
  notification.add_button("Accept", "app.notification-accept");
  notification.add_button("Decline", "app.notification-decline");

  const icon = new GThemedIcon({ name: "object-rotate-right-symbolic" });
  notification.set_icon(icon);

  const button_simple = builder.get_object("button_simple");
  if (!(button_simple instanceof GtkButton)) throw new Error("the demo's UI");
  button_simple.connect("clicked", () => {
    application.send_notification("lunch-is-ready", notification);
  });

  const action_reply = new GSimpleAction({ name: "notification-reply" });
  action_reply.connect("activate", () => {
    console.log("Reply");
  });
  application.add_action(action_reply);

  const action_accept = new GSimpleAction({ name: "notification-accept" });
  action_accept.connect("activate", () => {
    console.log("Accept");
  });
  application.add_action(action_accept);

  const action_decline = new GSimpleAction({ name: "notification-decline" });
  action_decline.connect("activate", () => {
    console.log("Decline");
  });
  application.add_action(action_decline);
}

run(demo);
