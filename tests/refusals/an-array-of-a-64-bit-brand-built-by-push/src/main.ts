// expect: `push` on a typed array is not supported by this lowering yet
//
// An array of a 64-bit brand built by `push` is refused. A `c_size_t[]` -- the
// `GType`s a GTK binding's values form copies out of `g_type_children` --
// lowers as a typed array, and a typed array takes no `push`. An array of a
// narrower brand built the same way lowers as an array, and compiles: the
// values forms copying a key file's integer list are that.
//
// Control, one difference -- `c_int` for `c_size_t`: nothing refused.
//
// Found 2026-10-21 by the Sdk lane, building the values forms that copy the
// arrays GLib hands back (`bind-gir`). Six of them hold `GType`s, and the
// binder declines to copy those until this compiles.
import type { c_size_t } from "@nts/scalars";

export function sizes(): c_size_t[] {
  const out: c_size_t[] = [];
  for (let i = 7n; i < 10n; i++) {
    out.push(i as c_size_t);
  }
  return out;
}
