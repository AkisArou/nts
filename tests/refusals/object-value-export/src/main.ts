// expect: emit-c --napi -> publishes constantTables
//
// FIXED, and kept as a regression guard. An exported `const` whose type is an
// object with table-typed fields -- `os.constants` reduced to the shape that
// mattered. The wrapper used to publish every function beside it and skip this,
// because `value_exports` filtered out anything crossing as an object: a value
// export could only be a number, a string or a boolean.
//
// `os` sat at 17 of 23 names for that reason, and five of its test files were
// behind this one export. `constants-table-static.js` and
// `constants-signals-static.js` cannot begin without it, and `core-static.js`
// destructures `priority`.
//
// The name is `constantTables` and not `shape` for a reason worth keeping: the
// wrapper's own boilerplate comments use the *English word* "shape" four times,
// so `publishes shape` held before this fixture compiled anything and
// `lacks-addon shape` could never hold at all. A guard reads the emitted text,
// and the emitted text contains prose. The counterpart of 0228 -- an
// expectation naming something the emitter writes unconditionally cannot fail;
// this one names something the emitter writes unconditionally in a comment,
// and cannot pass.
//
// The pairing fixture is `object-value-export-unrepresentable`, the same shape
// with one field the backend has no layout for. That one must still be refused;
// without it `publishes constantTables` would hold for a wrapper that published
// every object export whether or not it could build one.
export const constantTables = {
  version: 1,
  name: "reduced",
  signals: {} as Record<string, number>,
  priority: {} as Record<string, number>,
};

export function read(key: string): number {
  return constantTables.signals[key] ?? -1;
}
