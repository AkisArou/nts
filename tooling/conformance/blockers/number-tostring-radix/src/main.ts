// expect: `toString` on a number is not supported by this lowering yet
//
// The most leveraged small refusal found so far, and it is three calls away from
// every module's front door.
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

export function hex(code: number): string {
  return code.toString(16);
}

export function upperHex(code: number): string {
  return code.toString(16).toUpperCase();
}
