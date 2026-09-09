// expect: nothing refused
//
// FIXED, and kept as a guard. It was the most leveraged small refusal found,
// three calls from every module's front door.
//
//   path.normalize(p)            runtime/node/path/src/posix.ts:80
//     validateString(p, "path")  runtime/node/internal/validators.ts:19
//       new ERR_INVALID_ARG_TYPE(name, "string", value)
//         inspectString(value)   runtime/node/internal/errors.ts:401
//           `\\u${code.toString(16)}`                      :440
//
// `ERR_INVALID_ARG_TYPE` has to render the offending value into its message, and
// rendering a control character means a hex escape. So a module cannot validate
// an argument without this, and validating arguments is what node's entry points
// do first. `path` is the visible case: `toNamespacedPath` is `return path;` and
// publishes, while `normalize`, `dirname`, `extname`, `isAbsolute`, `relative`,
// `join`, `resolve`, `basename`, `parse` and `format` all begin with a validator
// and none of them reach `program.c` at all.
//
// Radix is the whole of it -- argument-less `toString` on a number lowers, which
// is why this fixture passes a literal 16 rather than nothing.
//
// What it bought, stated so the chain above is not read as cleared: `path`
// publishes its fifteen names already, and this moved the `inspectValue` chain
// exactly **one link**. `inspectString` compiles now; `inspectPropertyName`,
// one line further down `internal/errors.ts`, is
//
//     /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
//
// and needs a regular expression engine. So `inspectValue` still does not
// compile, and `ERR_OUT_OF_RANGE`, `ERR_INVALID_ARG_VALUE`,
// `ERR_UNKNOWN_ENCODING` and `ERR_INVALID_ARG_VALUE_RANGE` are still behind it.
// Across all 22 modules the published-name count went 86 -> 87.
//
// `examples/number-tostring-radix` is where the behaviour is checked; this
// fixture only says the construct lowers.

export function hex(code: number): string {
  return code.toString(16);
}

export function upperHex(code: number): string {
  return code.toString(16).toUpperCase();
}
