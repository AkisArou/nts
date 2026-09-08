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
declare function nts_process_pid(): number;
declare function nts_process_argv(): string[];
declare function nts_process_signal_names(): string[];
declare function nts_process_signal_exit_code(signalCode: string): number;
declare function nts_node_eol(): string;
declare function nts_node_random_uuid(): string;
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

export function probePid(): number {
  return nts_process_pid();
}
export function probeArgvLength(): number {
  return nts_process_argv().length;
}
export function probeArgv0(): string {
  const argv = nts_process_argv();
  return argv.length > 0 ? (argv[0] ?? "") : "";
}
export function probeSignalCount(): number {
  return nts_process_signal_names().length;
}
export function probeSignalExitCode(name: string): number {
  return nts_process_signal_exit_code(name);
}
export function probeEol(): string {
  return nts_node_eol();
}
/** Shape only: a UUID is random, so its value cannot be compared to anything. */
export function probeUuidShape(): string {
  const uuid = nts_node_random_uuid();
  return `${uuid.length}:${uuid[14] ?? ""}`;
}
