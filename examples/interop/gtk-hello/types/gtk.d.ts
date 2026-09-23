// Hand-written. The GTK functions TypeScript calls directly, plus the example's
// own shim, `native/hello.h`, which exists only for what the compiler cannot
// reach yet (see that file).
/**
 * @ntsHeader "hello.h"
 */
declare module "c:gtk-hello" {
  import type { Class, Closure, Ptr, c_char, c_int, c_uint, c_ulong } from "c:types";

  // The instance hierarchy, root first, as GObject lays it out. GTK spells
  // these `typedef struct _GtkWidget GtkWidget`, so each tag is the
  // underscored one. `GInitiallyUnowned` is not a tag of its own -- it is
  // `typedef struct _GObject GInitiallyUnowned` -- so a widget's parent is
  // `GObject` here.
  export type GObject = Class<"_GObject">;
  export type GApplication = Class<"_GApplication", GObject>;
  export type GtkApplication = Class<"_GtkApplication", GApplication>;
  export type GtkWidget = Class<"_GtkWidget", GObject>;
  export type GtkWindow = Class<"_GtkWindow", GtkWidget>;

  // GTK itself. `flags` is `GApplicationFlags`, an enum whose values are all
  // non-negative, so C makes it compatible with `unsigned int` -- and the
  // witness is what checks that this machine's compiler agrees.
  export function gtk_application_new(id: string, flags: c_uint): GtkApplication;
  export function gtk_application_window_new(app: GtkApplication): GtkWidget;
  export function gtk_button_new(): GtkWidget;
  export function gtk_window_set_child(window: GtkWindow, child: GtkWidget | null): void;
  export function gtk_window_present(window: GtkWindow): void;
  export function g_application_run(app: GApplication, argc: c_int, argv: Ptr<Ptr<c_char>> | null): c_int;
  export function g_application_quit(app: GApplication): void;

  // The shim.
  export function hello_connect(
    instance: GObject,
    signal: string,
    handler: Closure<(instance: GObject) => void>,
  ): c_ulong;
  export function hello_as_window(widget: GtkWidget): GtkWindow;
  export function hello_click(button: GtkWidget): void;
  export function hello_unref(app: GtkApplication): void;
  export function hello_report(clicks: c_int, status: c_int): void;
}
