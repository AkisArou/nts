// A GTK4 executable on bindings generated from GIR, in TypeScript only. It
// names no `dependencies`: every binding module names its own pkg-config
// packages (`@ntsPackage`) -- gtk4, HarfBuzz's harfbuzz-gobject, whose types
// release a face, set or blob the program owns -- and the program compiles
// and links against those of the modules it uses, GLib's loop among them.
// `girExtras` reaches what GIR describes and its own headers do not include:
// GLib's gstdio.h, HarfBuzz's OpenType API and its GLib blobs, Gio's settings
// backend behind its macro, and GTK's unix-print types, with their package.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    gir: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  girExtras: {
    "GLib-2.0": { headers: ["glib/gstdio.h"] },
    "HarfBuzz-0.0": { headers: ["hb-ot.h", "hb-glib.h"] },
    "Gio-2.0": { defines: ["G_SETTINGS_ENABLE_BACKEND"], headers: ["gio/gsettingsbackend.h"] },
    "Gtk-4.0": { packages: ["gtk4-unix-print"], headers: ["gtk/gtkunixprint.h"] },
  },
});
