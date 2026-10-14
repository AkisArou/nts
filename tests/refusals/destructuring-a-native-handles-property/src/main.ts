// expect: NTS1001 destructuring something with no fields is not supported by this lowering yet
//
// `const { buffer } = textview`, as the Text View corpus port writes it:
// a binding's property is a getter call, not a field, so the handle has
// no fields to destructure. Measured on main d753577a6 (this tree).
//
// Control beside it, which must stay clean: the same property read
// with a plain member access.
import { TextView } from "gi:gtk";

export function textViewCase(view: TextView): number {
  const { buffer } = view;
  return buffer === null ? 0 : 1;
}

export function textViewControl(view: TextView): number {
  const buffer = view.buffer;
  return buffer === null ? 0 : 1;
}
