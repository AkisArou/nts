// expect: a field `stack` write through a structural cast of an erased value as `{ stack?: string }`
// A cast does not supply storage for a missing member. Reads are the control;
// assignment, literal-key assignment, deletion and an aliased write all refuse.
function assign(value: unknown): void {
  const held = value as { stack?: string };
  held.stack = "written";
}
function bracket(value: unknown): void {
  const held = value as { stack?: string };
  held["stack"] = "written";
}
function remove(value: unknown): void {
  const held = value as { stack?: string };
  delete held.stack;
}
function alias(value: unknown): void {
  const held = value as { stack?: string };
  const same = held;
  same.stack = "written";
}
function read(value: unknown): string {
  const held = value as { stack?: string };
  return typeof held.stack;
}
export function assignment(n: number): void { assign({ other: n }); }
export function indexed(n: number): void { bracket({ other: n }); }
export function deletion(n: number): void { remove({ other: n }); }
export function aliased(n: number): void { alias({ other: n }); }
export function control(n: number): string { return read({ other: n }); }
