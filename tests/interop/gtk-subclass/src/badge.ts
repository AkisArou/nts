// A class the program writes over a GObject class, in a module of its own:
// `new Badge()` in main.ts names the import, and makes a `Badge`.
import { GtkLabel } from "c:Gtk-4.0";

export class Badge extends GtkLabel {
  hits = 0;

  hit(): number {
    this.hits++;
    return this.hits;
  }
}
