// expect: NTS1001 a declaration with no initializer, of a native pointer, which has no zero is not supported by this lowering yet
//
// `let navigation_widget: GtkWidget;` filled in a branch below, as the
// Stack corpus port writes it. A native pointer has no zero the
// declaration could start from, so the declaration itself is refused.
// Measured with the compiler built from main d753577a6 (this tree).
//
// Control beside it, which must stay clean: the same variable
// initialized where it is declared.
import { Label, Widget } from "gi:gtk";

export function stackCase(): string {
  let navigationWidget: Widget;
  navigationWidget = new Label({ label: "x" });
  return navigationWidget instanceof Label ? "label" : "other";
}

export function stackControl(): string {
  const navigationWidget: Widget = new Label({ label: "x" });
  return navigationWidget instanceof Label ? "label" : "other";
}
