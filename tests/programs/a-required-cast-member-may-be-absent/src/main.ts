// The only difference between the two assertions is optionality. No concrete
// supplier has a stack member; both assertions now read undefined for it.
function required(value: unknown): string {
  const held = value as { stack: string };
  return typeof held.stack;
}
function optional(value: unknown): string {
  const held = value as { stack?: string };
  return typeof held.stack;
}
export function asserted(n: number): string { return required({ other: n }); }
export function control(n: number): string { return optional({ other: n }); }
