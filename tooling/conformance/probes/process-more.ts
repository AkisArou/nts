// The rest of `process`'s reachable native half.
//
// Three are unreachable by construction and stay that way: `nts_process_abort`,
// `nts_process_execve` and `nts_process_really_exit` are declared `never`, and a
// probe that forked to survive them would be measuring the fork.
//
// The privileged setters are probed on their **error path**, which is the only
// path this process can take: as a non-root user every one of them fails with
// `EPERM`, and that is a real answer about a real syscall rather than a skipped
// row. `setgroups` in particular is *only* probed that way -- succeeding would
// change the group set of the process running the tests.
//
// The two mutating-but-restorable ones -- `chdir` and `set_title` -- read the
// current value, change it, and put it back inside one call.
declare function nts_process_allowed_env_flags(): string[];
declare function nts_process_chdir(directory: string): number;
declare function nts_process_cwd(): string;
declare function nts_process_kill(pid: number, signal: number): number;
declare function nts_process_load_env_file(path: string): number;
declare function nts_process_metadata(name: "release" | "features" | "config"): string;
declare function nts_process_raw_debug(text: string): void;
declare function nts_process_set_title(title: string): void;
declare function nts_process_title(): string;
declare function nts_process_setuid(id: number, name: string): number;
declare function nts_process_setgid(id: number, name: string): number;
declare function nts_process_seteuid(id: number, name: string): number;
declare function nts_process_setegid(id: number, name: string): number;
declare function nts_process_setgroups(ids: number[], names: string[]): number;
declare function nts_process_initgroups(
  userId: number, userName: string, groupId: number, groupName: string,
): number;
declare function nts_process_thread_cpu_usage(values: [number, number]): number;

export function probeAllowedEnvFlagCount(): number {
  return nts_process_allowed_env_flags().length;
}

/** Whether a flag node also lists is present, which a count cannot show. */
export function probeAllowedEnvFlagHas(name: string): boolean {
  const flags = nts_process_allowed_env_flags();
  for (let index = 0; index < flags.length; index++) {
    if (flags[index] === name) return true;
  }
  return false;
}

/** Change directory and put it back, reporting both halves. */
export function probeChdirRoundTrip(to: string): string {
  const original = nts_process_cwd();
  const result = nts_process_chdir(to);
  const moved = nts_process_cwd();
  nts_process_chdir(original);
  const restored = nts_process_cwd();
  return `${result}:${moved === to}:${restored === original}`;
}

export function probeChdirMissing(path: string): number {
  return nts_process_chdir(path);
}

/** Signal 0 asks whether a pid exists without sending anything. */
export function probeKillExistence(pid: number): number {
  return nts_process_kill(pid, 0);
}

export function probeKillMissing(pid: number): number {
  return nts_process_kill(pid, 0);
}

export function probeLoadEnvFileMissing(path: string): number {
  return nts_process_load_env_file(path);
}

export function probeMetadataLength(name: "release" | "features" | "config"): number {
  return nts_process_metadata(name).length;
}

export function probeMetadata(name: "release" | "features" | "config"): string {
  return nts_process_metadata(name);
}

export function probeRawDebugSurvives(text: string): boolean {
  nts_process_raw_debug(text);
  return true;
}

/** Set a title and restore it, reporting whether the change took. */
export function probeTitleRoundTrip(title: string): string {
  const original = nts_process_title();
  nts_process_set_title(title);
  const changed = nts_process_title();
  nts_process_set_title(original);
  const restored = nts_process_title();
  return `${changed === title}:${restored === original}`;
}

/** Setting one's own id is the permitted no-op; the answer should be success. */
export function probeSetuidSelf(id: number): number {
  return nts_process_setuid(id, "");
}

export function probeSetgidSelf(id: number): number {
  return nts_process_setgid(id, "");
}

export function probeSeteuidSelf(id: number): number {
  return nts_process_seteuid(id, "");
}

export function probeSetegidSelf(id: number): number {
  return nts_process_setegid(id, "");
}

/** Root, which a non-root process must be refused. */
export function probeSetuidRoot(): number {
  return nts_process_setuid(0, "");
}

export function probeSetgroupsRefused(): number {
  const ids: number[] = [0];
  const names: string[] = [""];
  return nts_process_setgroups(ids, names);
}

export function probeInitgroupsRefused(): number {
  return nts_process_initgroups(0, "root", 0, "root");
}

export function probeThreadCpuUsage(): string {
  const values: [number, number] = [0, 0];
  const errno = nts_process_thread_cpu_usage(values);
  return `${errno}:${values[0] > 0}:${values[1] >= 0}`;
}
