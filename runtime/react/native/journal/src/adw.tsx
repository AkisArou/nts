// The libadwaita Journal as an application: an AdwApplication, whose root
// creates libadwaita's widgets beside GTK's.

import { AdwApplication } from "c:Adw-1";
import { ApplicationFlags } from "c:Gio-2.0";
import { createApplicationRoot } from "react-gtk";
import { adw } from "react-gtk/adw";
import { AdwJournal } from "./AdwJournal.tsx";

function main(): void {
  const app = new AdwApplication({ application_id: "org.example.Journal", flags: ApplicationFlags.DEFAULT_FLAGS });
  app.connect("activate", () => {
    createApplicationRoot(app, { widgets: [adw] }).render(<AdwJournal />);
  });
  app.run(null);
}

main();
