// A slice of `process`'s 54 native bindings, exercised without compiling
// `process`.
//
// Read-only bindings only: these answer facts about the running process and
// mutate nothing, so a probe can call them freely and compare against what node
// reports for the same process.
//
// Exports are prefixed to stay clear of libc — `getuid`, `getgid`, `getpid`,
// `chdir` and `abort` are all POSIX symbols, and an export carrying one of those
// names is silently replaced by libc's. See `blockers/libc-name-collision`.
declare function nts_process_argv0(): string;
declare function nts_process_cwd(): string;
declare function nts_process_exec_path(): string;
declare function nts_process_env(name: string): string;
declare function nts_process_env_has(name: string): boolean;
declare function nts_process_getuid(): number;
declare function nts_process_getgid(): number;
declare function nts_process_geteuid(): number;
declare function nts_process_getegid(): number;
declare function nts_process_available_memory(): number;
declare function nts_process_constrained_memory(): number;
declare function nts_process_uptime(): number;

export function probeArgv0(): string {
  return nts_process_argv0();
}
export function probeCwd(): string {
  return nts_process_cwd();
}
export function probeExecPath(): string {
  return nts_process_exec_path();
}
export function probeEnv(name: string): string {
  return nts_process_env(name);
}
export function probeEnvHas(name: string): boolean {
  return nts_process_env_has(name);
}
export function probeGetuid(): number {
  return nts_process_getuid();
}
export function probeGetgid(): number {
  return nts_process_getgid();
}
export function probeGeteuid(): number {
  return nts_process_geteuid();
}
export function probeGetegid(): number {
  return nts_process_getegid();
}
export function probeAvailableMemory(): number {
  return nts_process_available_memory();
}
export function probeConstrainedMemory(): number {
  return nts_process_constrained_memory();
}
export function probeUptimeShape(): string {
  return typeof nts_process_uptime();
}
