// A slice bound to the unit that owns its run, so it stops when that unit
// stops and never outlives it: the gate's step slices bind to their run's
// root, that root and a census's aggregate to the unit their process runs
// in, and a census's worker slices to their aggregate (#633). Before this,
// a census's slices bound to nothing and a census killed mid-run left them
// loaded for ever.
import { readFileSync } from "node:fs";

/**
 * The user-manager unit this process runs in, from its cgroup: the last
 * component below `user@<uid>.service`, when it names a scope or service.
 * `undefined` outside a user manager's subtree, or directly in a slice:
 * there is no unit to bind to, and the caller's slices stand unbound, for
 * the full check's count to find if a run leaves them.
 */
export function ownUnit(cgroup: string = readFileSync("/proc/self/cgroup", "utf8")): string | undefined {
  const parts = cgroup.trim().replace(/^0::/, "").split("/").filter(Boolean);
  const manager = parts.findIndex(part => /^user@\d+\.service$/.test(part));
  if (manager < 0) return undefined;
  const own = parts.at(-1)!;
  return manager < parts.length - 1 && /^[a-zA-Z0-9_.:@-]+\.(?:scope|service)$/.test(own) ? own : undefined;
}

/**
 * The `StartTransientUnit` properties that bind a slice to `unit`, as
 * busctl `(sv)` elements, four per property: `BindsTo` (the slice stops
 * when the unit does) with the `After` that orders that stop after the
 * unit's. None when there is no unit to bind to.
 */
export function bindsToProperties(unit: string | undefined): string[] {
  return unit ? ["BindsTo", "as", "1", unit, "After", "as", "1", unit] : [];
}
