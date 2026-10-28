// Source control for builtin-study-dom-window-alert. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
function sourceAlert(message: string): string { return message; }

export function domWindowAlertControl(): string {
  return sourceAlert("x");
}
