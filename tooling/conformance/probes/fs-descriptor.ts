// `fs` bindings that need a descriptor, reached by opening one through the
// bindings themselves.
//
// This is the second kind of probe. The first takes a path and answers an errno;
// this one has to *create* the resource it measures, which is how `net`, `dgram`
// and most of `fs` will have to be reached. Every function here opens, uses and
// closes in one call so the probe leaks nothing even when an assertion fails.
//
// **Only bindings this file actually calls are declared here.** The coverage
// count is derived from the declarations across `probes/`, so a declaration that
// is never exercised inflates it -- `fchmod` and `ftruncate` were written into
// the first draft and never called, which would have counted two bindings as
// measured that nothing had touched.
//
// Exports are prefixed away from libc: `open`, `close`, `read`, `write`,
// `fsync`, `ftruncate` and `fchmod` are all POSIX symbols. See
// `blockers/libc-name-collision`.
declare function nts_fs_open(path: string, flags: number, mode: number): number;
declare function nts_fs_close(descriptor: number): number;
declare function nts_fs_fsync(fd: number): number;
declare function nts_fs_fdatasync(fd: number): number;
declare function nts_fs_fstat(descriptor: number): number[];

/** The descriptor an open answers, or its negative errno. */
export function probeOpenClose(path: string, flags: number): number {
  const fd = nts_fs_open(path, flags, 0o666);
  if (fd < 0) return fd;
  const closed = nts_fs_close(fd);
  return closed < 0 ? closed : 0;
}

/** `fsync` on a descriptor this opens, so the result is the binding's alone. */
export function probeFsync(path: string, flags: number): number {
  const fd = nts_fs_open(path, flags, 0o666);
  if (fd < 0) return fd;
  const result = nts_fs_fsync(fd);
  nts_fs_close(fd);
  return result;
}

export function probeFdatasync(path: string, flags: number): number {
  const fd = nts_fs_open(path, flags, 0o666);
  if (fd < 0) return fd;
  const result = nts_fs_fdatasync(fd);
  nts_fs_close(fd);
  return result;
}

/** How many columns `fstat` answers, and the size it reports. */
export function probeFstatShape(path: string, flags: number): string {
  const fd = nts_fs_open(path, flags, 0o666);
  if (fd < 0) return `open:${fd}`;
  const columns = nts_fs_fstat(fd);
  nts_fs_close(fd);
  return `${columns.length}`;
}

/** `close` on a descriptor that was never open. */
export function probeCloseBad(descriptor: number): number {
  return nts_fs_close(descriptor);
}

/** `fsync` on a descriptor that was never open. */
export function probeFsyncBad(fd: number): number {
  return nts_fs_fsync(fd);
}
