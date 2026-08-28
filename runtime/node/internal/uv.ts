// libuv's error names and messages, and the exception node builds from them.
//
// Node reaches these through `internalBinding('uv')`, which exposes libuv's own
// `uv_err_name` and `uv_strerror`. Taking them from libuv rather than from a
// table written here is the same argument as `os.constants`: the numbers and
// the wording are the platform's, and a transcribed copy would drift.

declare function nts_uv_err_name(code: number): string;
declare function nts_uv_err_message(code: number): string;

/** libuv's name for a negative errno: `-2` is `ENOENT`. */
export function errName(code: number): string {
  return nts_uv_err_name(code);
}

/**
 * The exception every failing `fs` call throws.
 *
 *   ENOENT: no such file or directory, stat '/nope/x'
 *
 * It is an ordinary `Error` with `code`, `errno`, `syscall` and `path` on it,
 * not a subclass -- node's `uvException` builds one that way and programs
 * check `err.code`, so the shape is the contract.
 */
export interface UVError extends Error {
  code: string;
  errno: number;
  syscall: string;
  path?: string;
  dest?: string;
}

export function uvException(
  code: number,
  syscall: string,
  path?: string,
  dest?: string,
): UVError {
  const name = nts_uv_err_name(code);
  const description = nts_uv_err_message(code);
  let message = `${name}: ${description}, ${syscall}`;
  if (path !== undefined) {
    message += ` '${path}'`;
  }
  if (dest !== undefined) {
    message += ` -> '${dest}'`;
  }

  const error = new Error(message) as UVError;
  error.code = name;
  error.errno = code;
  error.syscall = syscall;
  if (path !== undefined) {
    error.path = path;
  }
  if (dest !== undefined) {
    error.dest = dest;
  }
  return error;
}

/**
 * The other error shape node uses for a failed system call.
 *
 *   EPERM, Operation not permitted
 *
 * Node has two, and which one a call throws depends on which C++ helper it
 * went through rather than on anything a caller can see. The `fs` family gets
 * `uvException` above -- code, description, syscall and path. The credential
 * calls (`setuid`, `setgid`, `setgroups` and their effective forms) get this
 * one, which names no syscall and no path.
 *
 * Reproduced rather than unified because node's own tests match on the text:
 * `process.setegid` is asserted to fail with something *ending* in
 * `EPERM, ...`, which the other shape does not, since it puts the syscall
 * last.
 */
export function errnoException(code: number, syscall: string): UVError {
  const name = nts_uv_err_name(code);
  const error = new Error(`${name}, ${nts_uv_err_message(code)}`) as UVError;
  error.code = name;
  error.errno = code;
  error.syscall = syscall;
  return error;
}
