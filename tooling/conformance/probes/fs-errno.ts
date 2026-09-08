// Nine mutating `fs` bindings, exercised on their error paths.
//
// `probes/fs.ts` covers the read-only checks. These are the ones that change the
// filesystem, so they are probed where node's own suite is thinnest and where a
// wrong answer is most expensive: the failure path. Every one of them returns a
// libuv errno rather than throwing, and the number it returns is what `fs` turns
// into an `Error` with a `code` -- so a binding that returns the wrong sign, or
// `-1` and the C `errno` instead of the negated libuv one, produces an error
// object with the wrong `code` and node's tests for *that* would need the module
// to compile before they could notice.
//
// **`unlink`, `rename`, `link` and `symlink` are all libc symbols.** Exporting
// any of those names from a shared object hands the call to glibc -- see
// `blockers/libc-name-collision`, found by the first of these probe files. The
// `probe` prefix is what keeps this file measuring nts.
declare function nts_fs_unlink(path: string): number;
declare function nts_fs_rename(from: string, to: string): number;
declare function nts_fs_copyfile(from: string, to: string, flags: number): number;
declare function nts_fs_chown(path: string, uid: number, gid: number): number;
declare function nts_fs_utimes(path: string, atime: number, mtime: number): number;
declare function nts_fs_link(from: string, to: string): number;
declare function nts_fs_symlink(target: string, at: string, flags: number): number;
declare function nts_fs_mkdtemp(template: string): string;
declare function nts_fs_ftruncate(fd: number, length: number): number;

export function probeUnlink(path: string): number {
  return nts_fs_unlink(path);
}
export function probeRename(from: string, to: string): number {
  return nts_fs_rename(from, to);
}
export function probeCopyfile(from: string, to: string, flags: number): number {
  return nts_fs_copyfile(from, to, flags);
}
export function probeChown(path: string, uid: number, gid: number): number {
  return nts_fs_chown(path, uid, gid);
}
export function probeUtimes(path: string, atime: number, mtime: number): number {
  return nts_fs_utimes(path, atime, mtime);
}
export function probeLink(from: string, to: string): number {
  return nts_fs_link(from, to);
}
export function probeSymlink(target: string, at: string, flags: number): number {
  return nts_fs_symlink(target, at, flags);
}
export function probeMkdtemp(template: string): string {
  return nts_fs_mkdtemp(template);
}
export function probeFtruncate(fd: number, length: number): number {
  return nts_fs_ftruncate(fd, length);
}
