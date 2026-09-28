// Hand-written: the shim's own declarations. GTK's come from `types/gir`,
// which `nts build` generates from GIR.
/**
 * @ntsHeader "shim.h"
 */
declare module "c:react-gtk-shim" {
  import type { GObject } from "c:GObject-2.0";
  import type { CNumber } from "c:types";

  export function react_gtk_emit(instance: GObject, signal: string): void;
  export function react_gtk_emit_double(instance: GObject, signal: string, value: CNumber<"double">): void;
  export function react_gtk_emit_decision(instance: GObject, signal: string): CNumber<"int">;
  export function react_gtk_emit_choice(instance: GObject, signal: string, index: CNumber<"uint">): CNumber<"uint">;
  export function react_gtk_emit_key_pressed(
    controller: GObject,
    keyval: CNumber<"uint">,
    keycode: CNumber<"uint">,
    state: CNumber<"uint">,
  ): CNumber<"int">;
  export function react_gtk_emit_pressed(gesture: GObject, n_press: CNumber<"int">, x: CNumber<"double">, y: CNumber<"double">): void;
  export function react_gtk_log(line: string): void;
}
