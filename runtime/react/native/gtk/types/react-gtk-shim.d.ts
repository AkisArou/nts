// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "shim.h"
 */
declare module "c:react-gtk-shim" {
  import type { GObject } from "c:GObject-2.0";
  import type { Float64, c_int, c_uint } from "@nts/scalars";

  export function react_gtk_emit(instance: GObject, signal: string): void;
  export function react_gtk_emit_double(instance: GObject, signal: string, value: Float64): void;
  export function react_gtk_emit_decision(instance: GObject, signal: string): c_int;
  export function react_gtk_emit_choice(instance: GObject, signal: string, index: c_uint): c_uint;
  export function react_gtk_emit_key_pressed(
    controller: GObject,
    keyval: c_uint,
    keycode: c_uint,
    state: c_uint,
  ): c_int;
  export function react_gtk_emit_pressed(gesture: GObject, n_press: c_int, x: Float64, y: Float64): void;
  export function react_gtk_log(line: string): void;
}
