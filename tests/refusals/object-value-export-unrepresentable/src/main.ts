// expect: emit-c --napi -> lacks-addon constantTables
//
// The control for `object-value-export`, and the reason that fixture's
// `publishes constantTables` is not vacuous. The same object value export, with
// one field the backend has no layout for.
//
// A guard that only ever says "this name is present" cannot tell a wrapper that
// builds the object it was asked for from one that publishes any object export
// and leaves the C to fail at the compiler. This fixture is the second answer:
// the value-export path has to reach the same representability question the
// return path already asks, and refuse by name here.
//
// It refuses with `is exported and is not a function this backend can name`,
// which is the wrapper's existing wording for an export it cannot build -- not
// a new message written for this case. If that changes to something that names
// the field, this fixture will say CHANGED rather than silently accepting it.
export const constantTables = {
  version: 1,
  rows: [{ index: 0 }],
};

export function read(): number {
  return constantTables.version;
}
