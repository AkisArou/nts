// Source control for builtin-study-web-atob. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
function sourceBtoa(value: string): string { return value === "hi" ? "aGk=" : ""; }
function sourceAtob(value: string): string { return value === "aGk=" ? "hi" : ""; }

export function webAtobControl(): string {
  return sourceBtoa("hi") + ":" + sourceAtob("aGk=");
}
