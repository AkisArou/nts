// A slice of `fs`'s 133 native bindings, exercised without compiling `fs`.
//
// `fs` does not build, so none of its native half has ever run under this
// compiler or been compared to anything. These are the bindings whose behaviour
// is observable without mutating the filesystem: errno-returning path checks and
// two that answer strings.
//
// **Every export is named away from libc deliberately.** `access`, `chmod`,
// `readlink`, `realpath`, `link`, `mkdir`, `rmdir` and `rename` are all POSIX
// symbols, and an export carrying one of those names is silently replaced by
// libc's — see `blockers/libc-name-collision`, which this file found. The
// `probe` prefix is not style; without it this file measures glibc.
declare function nts_fs_access(path: string, mode: number): number;
declare function nts_fs_chmod(path: string, mode: number): number;
declare function nts_fs_readlink(path: string): string;
declare function nts_fs_realpath(path: string): string;
declare function nts_fs_mkdir(path: string, mode: number): number;
declare function nts_fs_rmdir(path: string): number;
declare function nts_fs_eisdir(): number;
declare function nts_fs_binding_warns_on_mkdtemp(): boolean;

export function probeAccess(path: string, mode: number): number {
  return nts_fs_access(path, mode);
}

export function probeChmod(path: string, mode: number): number {
  return nts_fs_chmod(path, mode);
}

export function probeReadlink(path: string): string {
  return nts_fs_readlink(path);
}

export function probeRealpath(path: string): string {
  return nts_fs_realpath(path);
}

export function probeMkdir(path: string, mode: number): number {
  return nts_fs_mkdir(path, mode);
}

export function probeRmdir(path: string): number {
  return nts_fs_rmdir(path);
}

export function probeEisdir(): number {
  return nts_fs_eisdir();
}

export function probeWarnsOnMkdtemp(): boolean {
  return nts_fs_binding_warns_on_mkdtemp();
}
