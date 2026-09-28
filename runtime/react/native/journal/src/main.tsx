// The Journal as an application: its window opens when the application
// activates, and it runs until the window closes.

import { ApplicationFlags } from "c:Gio-2.0";
import { GtkApplication, GtkStringList } from "c:Gtk-4.0";
import { createApplicationRoot } from "react-gtk";
import { Journal } from "./Journal.tsx";

function main(): void {
  const app = new GtkApplication({ application_id: "org.example.Journal", flags: ApplicationFlags.DEFAULT_FLAGS });
  app.connect("activate", () => {
    createApplicationRoot(app).render(<Journal entries={new GtkStringList()} />);
  });
  app.run(null);
}

main();
