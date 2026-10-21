// A GTK4 executable on bindings generated from GIR, in TypeScript only. It
// names no `dependencies`: every binding module names its own pkg-config
// packages (`@ntsPackage`) -- gtk4, HarfBuzz's harfbuzz-gobject, whose types
// release a face, set or blob the program owns -- and the program compiles
// and links against those of the modules it uses, GLib's loop among them.
// What GIR describes and its own headers do not include -- GLib's gstdio.h,
// HarfBuzz's OpenType API and its GLib blobs, GTK's unix-print types with
// their package -- the GTK platform's bind request names for every program.
// `girExtras` adds what a library keeps for whoever implements it, behind a
// macro: Gio's settings backend, whose null backend the program makes, and
// GdkPixbuf's animation class struct, whose slot the program fills.
import { defineConfig, app } from "@nts/config";

export default defineConfig({
  products: {
    gir: app.linux({ entry: "./src/main.ts", backend: "c" }),
  },
  girExtras: {
    "Gio-2.0": { defines: ["G_SETTINGS_ENABLE_BACKEND"], headers: ["gio/gsettingsbackend.h"] },
    "GdkPixbuf-2.0": { defines: ["GDK_PIXBUF_ENABLE_BACKEND"] },
  },
});
