// A GTK4 executable on bindings generated from GIR, in TypeScript only;
// gtk4 arrives through pkg-config. `girExtras` reaches what GIR describes
// and its own headers do not include: GLib's gstdio.h, HarfBuzz's OpenType
// API and its GLib blobs, Gio's settings backend behind its macro, and GTK's
// unix-print types, whose package the program compiles and links against
// too. harfbuzz-gobject holds the types that release a HarfBuzz face, set or
// blob the program owns.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    gir: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  dependencies: {
    "linux-gnu": { from: "pkg-config", packages: ["gtk4", "gtk4-unix-print", "harfbuzz-gobject"] },
  },
  girExtras: {
    "GLib-2.0": { headers: ["glib/gstdio.h"] },
    "HarfBuzz-0.0": { headers: ["hb-ot.h", "hb-glib.h"] },
    "Gio-2.0": { defines: ["G_SETTINGS_ENABLE_BACKEND"], headers: ["gio/gsettingsbackend.h"] },
    "Gtk-4.0": { packages: ["gtk4-unix-print"], headers: ["gtk/gtkunixprint.h"] },
  },
});
