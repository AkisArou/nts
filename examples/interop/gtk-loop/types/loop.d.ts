// Hand-written; the GTK half as in ../gtk-hello/types/gtk.d.ts.
/**
 * @ntsHeader "loop.h"
 */
declare module "c:gtk-loop" {
  import type { Class, Closure, Ptr, c_char, c_int, c_uint, c_ulong } from "c:types";

  export type GObject = Class<"_GObject">;
  export type GApplication = Class<"_GApplication", GObject>;
  export type GtkApplication = Class<"_GtkApplication", GApplication>;
  export type GtkWidget = Class<"_GtkWidget", GObject>;
  export type GtkWindow = Class<"_GtkWindow", GtkWidget>;

  export function gtk_application_new(id: string, flags: c_uint): GtkApplication;
  export function gtk_application_window_new(app: GtkApplication): GtkWidget;
  export function gtk_button_new(): GtkWidget;
  export function gtk_window_set_child(window: GtkWindow, child: GtkWidget | null): void;
  export function gtk_window_present(window: GtkWindow): void;
  export function g_application_run(app: GApplication, argc: c_int, argv: Ptr<Ptr<c_char>> | null): c_int;
  export function g_application_quit(app: GApplication): void;

  export function loop_connect(
    instance: GObject,
    signal: string,
    handler: Closure<(instance: GObject) => void>,
  ): c_ulong;
  export function loop_as_window(widget: GtkWidget): GtkWindow;
  export function loop_unref(app: GtkApplication): void;
  export function loop_log(line: string): void;
  export function loop_click_later(button: GtkWidget): void;
  export function loop_click_now(button: GtkWidget): void;
  export function loop_control(app: GApplication): void;
  export function loop_quit(app: GApplication): void;
}
