// The object node's tests see as `require('os')`.
//
// `EOL` and `devNull` are not writable on node's module -- `test-os-eol.js`
// asserts that assigning to `os.EOL` throws in strict mode -- and an ESM
// export copied into a plain object is. Node defines them with
// `ObjectDefineProperties` on `module.exports`, so this is the same step in
// the same place, not a workaround.
//
// `constants.signals` is frozen for the same reason node freezes it: it is a
// shared table, and a program that mutates it changes what every later reader
// sees.
export function shape(exports) {
  const { EOL, devNull, constants, ...rest } = exports;
  const os = { ...rest };
  for (const [name, value] of [["EOL", EOL], ["devNull", devNull]]) {
    Object.defineProperty(os, name, {
      configurable: true,
      enumerable: true,
      writable: false,
      value,
    });
  }
  Object.freeze(constants.signals);
  Object.defineProperty(os, "constants", {
    configurable: false,
    enumerable: true,
    value: constants,
  });
  return os;
}
