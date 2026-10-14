// Workbench's "Calendar" demo (CC0, workbenchdev/demos), ported.
import { GtkCalendar } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const calendar = workbench.builder.get_object("calendar");
  if (!(calendar instanceof GtkCalendar)) throw new Error("the demo's UI");

  // calendar.get_date() returns a GLib.DateTime object
  // https://docs.gtk.org/glib/struct.DateTime.html

  calendar.connect("notify::day", () => {
    console.log(calendar.get_date().format("%e"));
  });

  calendar.connect("notify::month", () => {
    console.log(calendar.get_date().format("%B"));
  });

  calendar.connect("notify::year", () => {
    console.log(calendar.get_date().format("%Y"));
  });

  calendar.connect("day-selected", () => {
    console.log(calendar.get_date().format_iso8601());
  });

  calendar.mark_day(15);
}

run(demo);
