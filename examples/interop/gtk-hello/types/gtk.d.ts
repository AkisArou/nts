// Hand-written. The GTK functions TypeScript calls directly, plus the example's
// own shim, `native/hello.h`, which exists only for what the compiler cannot
// reach yet (see that file).
/**
 * @ntsHeader "hello.h"
 */
declare module "c:gtk-hello" {
  import type { Opaque, Ptr, Struct, c_int, c_uint } from "c:types";

  // GTK spells these `typedef struct _GtkWidget GtkWidget`, so the tag is the
  // underscored one.
  export type GtkApplication = Opaque<"_GtkApplication">;
  export type GtkWidget = Opaque<"_GtkWidget">;
  export type GtkWindow = Opaque<"_GtkWindow">;
  export type State = Struct<{ clicks: c_int }, "hello_state">;

  // GTK itself. `flags` is `GApplicationFlags`, an enum whose values are all
  // non-negative, so C makes it compatible with `unsigned int` -- and the
  // witness is what checks that this machine's compiler agrees.
  export function gtk_application_new(id: string, flags: c_uint): GtkApplication;
  export function gtk_application_window_new(app: GtkApplication): GtkWidget;
  export function gtk_button_new(): GtkWidget;
  export function gtk_window_set_child(window: GtkWindow, child: GtkWidget | null): void;
  export function gtk_window_present(window: GtkWindow): void;

  // The shim.
  export function hello_as_window(widget: GtkWidget): GtkWindow;
  export function hello_on_activate(
    app: GtkApplication,
    handler: (app: GtkApplication, state: Ptr<State>) => void,
    state: Ptr<State>,
  ): void;
  export function hello_on_clicked(
    button: GtkWidget,
    handler: (button: GtkWidget, state: Ptr<State>) => void,
    state: Ptr<State>,
  ): void;
  export function hello_click(button: GtkWidget): void;
  export function hello_run(app: GtkApplication): c_int;
  export function hello_quit(app: GtkApplication): void;
  export function hello_unref(app: GtkApplication): void;
  export function hello_report(clicks: c_int, status: c_int): void;
}
