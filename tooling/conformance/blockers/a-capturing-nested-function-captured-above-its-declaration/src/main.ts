// expect: NTS1001 `createConfirmationDialog`, captured above its own declaration, where it has no value yet is not supported by this lowering yet
//
// A nested async function that captures, called from a signal handler
// connected in the same scope, as the Message Dialogs corpus port writes
// it. The capture is read where the handler is made, above the point the
// lowering gives the nested function a value, and nothing defines it.
// Measured with the compiler built from main d753577a6 (this tree).
//
// Control beside it, which must stay clean: the same handler awaiting a
// module-scope async function, which has a value from the start.
import { Button, Label } from "gi:gtk";

function report(_e: unknown): void {}

async function later(): Promise<void> {}

export function msgCase(button: Button, label: Label): void {
  async function createConfirmationDialog(): Promise<void> { label.label = "x"; }
  button.connect("clicked", () => { createConfirmationDialog().catch(report); });
}

export function msgControl(button: Button): void {
  button.connect("clicked", () => { void later(); });
}
