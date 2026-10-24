// expect: an unlicensed field `stack` read through a structural cast of an erased value as `{ stack: string }`
// The only difference between the two assertions is optionality. No concrete
// supplier has the required stack member, so its family cannot be licensed.
function required(value: unknown): string {
  const held = value as { stack: string };
  return typeof held.stack;
}
function optional(value: unknown): string {
  const held = value as { stack?: string };
  return typeof held.stack;
}
export function refused(n: number): string { return required({ other: n }); }
export function control(n: number): string { return optional({ other: n }); }
