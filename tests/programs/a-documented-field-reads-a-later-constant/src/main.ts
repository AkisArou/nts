// A documented field reads a constant declared after its class.
//
// A field's initializer runs when an instance is made, so reading a constant
// declared further down the module is fine once the module has run: node reads
// it. Lowering asks whether a read is in the module's own code before the
// declaration, and a field initializer is not -- it is its own execution. It
// found the initializer as the field's last child that is not its name or a
// type, and a `/** ... */` above the field was a child too, encoded after the
// others: the comment was taken for the initializer, the read for module code,
// and `new` threw `ReferenceError: Cannot access 'NONE' before initialization`.
// The JSON parser's frame met it with a comment on its `template` field.
//
// The control is the same field without its comment, which was never wrong.

class Holder {
  /** The names this holder was given. */
  names: string[] = NONE;
}

class Plain {
  names: string[] = NONE;
}

const NONE: string[] = [];

export function documented(extra: number): number {
  return new Holder().names.length + extra;
}

export function undocumented(extra: number): number {
  return new Plain().names.length + extra;
}

console.log(documented(1), undocumented(2));
