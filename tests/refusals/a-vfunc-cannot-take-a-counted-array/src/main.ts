// expect: emit-c --napi -> NTS2006 a GObject virtual function whose entry point and compiled function disagree about arity
//
// **A virtual function cannot take an array C counts beside it.** GIO calls
// GApplication's `open` with `GFile **files, gint n_files, const gchar *hint`,
// and the binding declares the first two as one parameter, as it declares a
// function's counted array: `Counted<CHandles<GFile, "element">, c_int,
// "after">`. A call lends a `readonly GFile[]` that way. An override's entry
// point has the slot's four C parameters and its compiled function the
// program's three, and emission stops on the difference: NTS2006, which
// `nts check` does not reach. Found by the Sdk lane writing the guard for
// a vfunc's string parameter, which had to use GActionGroup's
// `action_added` instead.
//
// Control beside it, which must stay clean: the same class's `activate`,
// with no parameters.
import { GApplication } from "c:Gio-2.0";
import type { GFile } from "c:Gio-2.0";
import type { CHandles, Counted } from "c:types";
import type { c_int } from "@nts/scalars";

class Opens extends GApplication {
  opened = 0;

  vfunc_open(files: Counted<CHandles<GFile, "element">, c_int, "after">, hint: string): void {
    this.opened = files.length;
  }
}

class Activates extends GApplication {
  activated = 0;

  vfunc_activate(): void {
    this.activated++;
  }
}

export function made(): number {
  return new Opens({}).opened + new Activates({}).activated;
}
