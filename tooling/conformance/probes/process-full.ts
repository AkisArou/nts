// The rest of `process`'s native half that answers without mutating the process.
//
// `probes/process.ts` covers twelve. This adds the read-only remainder that can
// cross the boundary as a scalar or a string. Deliberately absent, and named
// rather than skipped in silence:
//
//   nts_process_abort, nts_process_really_exit, nts_process_execve
//       these end or replace the process, so a probe cannot survive them
//   nts_process_chdir, nts_process_umask, nts_process_kill
//       these mutate global state the test runner is also using
//   nts_process_cpu_usage, nts_process_memory_usage, nts_process_resource_usage
//       these fill a caller-provided object, which does not cross as a return
//
// `string[]` returns are reduced to a count or a joined string here, because an
// array of strings does not cross the wrapper boundary. Where the reduction
// hides something the comment says so.
declare function nts_process_env_keys(): string[];
declare function nts_process_getgroups(): number[];
declare function nts_process_ppid(): number;
declare function nts_process_arch(): string;
declare function nts_process_argv(): string[];
declare function nts_process_exec_argv(): string[];
declare function nts_process_version(): string;
declare function nts_process_version_names(): string[];
declare function nts_process_version_values(): string[];
declare function nts_process_title(): string;
declare function nts_process_umask_read(): number;

export function probeArch(): string {
  return nts_process_arch();
}

export function probeVersion(): string {
  return nts_process_version();
}

export function probeTitle(): string {
  return nts_process_title();
}

export function probePpid(): number {
  return nts_process_ppid();
}

export function probeUmaskRead(): number {
  return nts_process_umask_read();
}

export function probeEnvKeyCount(): number {
  return nts_process_env_keys().length;
}

/** Whether a name the harness sets is present, which a count cannot show. */
export function probeEnvHasKey(name: string): boolean {
  const keys = nts_process_env_keys();
  for (let index = 0; index < keys.length; index++) {
    if (keys[index] === name) return true;
  }
  return false;
}

export function probeGroupCount(): number {
  return nts_process_getgroups().length;
}

export function probeFirstGroup(): number {
  return nts_process_getgroups()[0] ?? -1;
}

export function probeArgvCount(): number {
  return nts_process_argv().length;
}

export function probeArgvFirst(): string {
  return nts_process_argv()[0] ?? "";
}

export function probeExecArgvCount(): number {
  return nts_process_exec_argv().length;
}

/** The version table, joined, so a shifted column cannot pass as a count. */
export function probeVersionsJoined(): string {
  const names = nts_process_version_names();
  const values = nts_process_version_values();
  let joined = "";
  for (let index = 0; index < names.length; index++) {
    joined += `${names[index]}=${values[index]};`;
  }
  return joined;
}

export function probeVersionTableAligned(): boolean {
  return nts_process_version_names().length === nts_process_version_values().length;
}
