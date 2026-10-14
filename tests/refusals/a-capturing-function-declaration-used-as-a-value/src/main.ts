// expect: NTS1001 `append`, a function used as a value is not supported by this lowering yet
//
// A `function` declaration that captures, handed to a signal's `connect`
// as the handler value, as the Box corpus port writes it
// (`button_append.connect("clicked", append)` where `append` counts and
// relabels). A non-capturing declaration lowers; a capturing one is a
// closure, and read as a value it has nowhere to live yet.
// Measured with the compiler built from main d753577a6 (this tree).
//
// Control beside it, which must stay clean: the same handler written as
// an arrow capturing the same variables, which is how the port will be
// written until this lands.
import { Button, Label } from "gi:gtk";

export function boxCase(button: Button, box: Label): void {
  let count = 0;
  button.connect("clicked", append);
  function append(): void { count++; box.label = String(count); }
}

export function boxControl(button: Button, box: Label): void {
  let count = 0;
  button.connect("clicked", () => { count++; box.label = String(count); });
}
