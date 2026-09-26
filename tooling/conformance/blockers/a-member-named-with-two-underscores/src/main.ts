// expect: NTS1001 `__snapshot`, which `Holder` does not declare

// A member whose name starts with two underscores is not found, though the
// class declares it: renamed `_snapshot`, the same program compiles.
// TypeScript escapes such a name in its symbol tables (`___snapshot`), which
// is the likely mismatch. React's reconciler writes
// `instance.__reactInternalSnapshotBeforeUpdate`. Filed from the React lane.

class Holder {
  __snapshot: unknown = undefined;
  plain: unknown = undefined;
}

function read(holder: Holder): string {
  return String(holder.__snapshot === undefined) + String(holder.plain === undefined);
}

export const answer = read(new Holder());
