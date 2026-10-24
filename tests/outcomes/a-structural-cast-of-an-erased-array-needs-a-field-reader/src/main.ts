// run: check
// Known gap: arrays have no own stack property, so JavaScript answers
// "undefined". An array is not a planned field-family supplier yet; this
// cast must stop by name, never read array header words at a record offset.
// The control differs only in the receiver kind: an ordinary record missing
// the same property already has an undefined-returning row.
class Missing {
  value = 0;
}
function kindOf(value: unknown): string {
  const held = value as { stack?: string };
  return typeof held.stack;
}
export function array(n: number): string { return kindOf([n]); }
export function control(n: number): string { return kindOf(new Missing()); }
