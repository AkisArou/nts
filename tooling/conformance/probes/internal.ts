// The bindings in `runtime/node/internal`, which every module shares.
//
// These sit under error reporting and platform detection for all twenty-two
// modules, so a defect in one of them is a defect everywhere at once — and none
// of them had ever been compared to node, because the modules that would carry
// them do not compile.
//
// `nts_uv_err_name` in particular is what turns a negative errno into
// `"ENOENT"`, and node exposes the same mapping as `util.getSystemErrorName`,
// which makes it directly comparable rather than merely observable.
//
// Exports prefixed away from libc: see `blockers/libc-name-collision`.
declare function nts_uv_err_name(code: number): string;
declare function nts_uv_err_message(code: number): string;
declare function nts_platform(): string;
declare function nts_os_release(): string;
declare function nts_stdout_is_tty(): boolean;
declare function nts_stderr_is_tty(): boolean;

export function probeErrName(code: number): string {
  return nts_uv_err_name(code);
}
export function probeErrMessage(code: number): string {
  return nts_uv_err_message(code);
}
export function probePlatform(): string {
  return nts_platform();
}
export function probeRelease(): string {
  return nts_os_release();
}
export function probeStdoutTty(): boolean {
  return nts_stdout_is_tty();
}
export function probeStderrTty(): boolean {
  return nts_stderr_is_tty();
}
