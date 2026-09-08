// The byte-path native family, which this lane wrote and therefore has to
// measure rather than trust.
//
// Eleven bindings added on 2026-09-08 so that twenty-four public `fs` functions
// would accept a Buffer path the way node does. Adding them took
// `standin-blindspot.mjs` from 1 to 11: each has a stand-in that delegates to
// node, and `fs` does not compile, so the moment they existed nothing in the
// tree could report them wrong. Writing a binding and leaving it unmeasured is
// worse than not writing it, because the count of things that work goes up
// either way.
//
// Every probe here operates on paths built from ordinary ASCII so the
// comparison against node is exact; `probes/fs-blind.ts` covers the non-UTF-8
// case for the bindings that existed before.
declare function nts_fs_unlink_bytes(path: number[]): number;
declare function nts_fs_mkdir_bytes(path: number[], mode: number): number;
declare function nts_fs_rmdir_bytes(path: number[]): number;
declare function nts_fs_chmod_bytes(path: number[], mode: number): number;
declare function nts_fs_chown_bytes(path: number[], uid: number, gid: number): number;
declare function nts_fs_utimes_bytes(path: number[], atime: number, mtime: number): number;
declare function nts_fs_lutimes_bytes(path: number[], atime: number, mtime: number): number;
declare function nts_fs_rename_bytes(from: number[], to: number[]): number;
declare function nts_fs_copyfile_bytes(from: number[], to: number[], flags: number): number;
declare function nts_fs_link_bytes(from: number[], to: number[]): number;
declare function nts_fs_readlink_bytes(path: number[]): number[];
declare function nts_fs_stat(path: string, follow: boolean): number[];

function bytesOf(text: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index++) {
    out.push(text.charCodeAt(index) & 0xff);
  }
  return out;
}

export function probeUnlink(path: string): number {
  return nts_fs_unlink_bytes(bytesOf(path));
}

export function probeMkdir(path: string, mode: number): number {
  return nts_fs_mkdir_bytes(bytesOf(path), mode);
}

export function probeRmdir(path: string): number {
  return nts_fs_rmdir_bytes(bytesOf(path));
}

/** Sets the mode and reads it back through the *string* path, not the byte one. */
export function probeChmod(path: string, mode: number): number {
  const result = nts_fs_chmod_bytes(bytesOf(path), mode);
  if (result !== 0) return result;
  return (nts_fs_stat(path, true)[1] ?? 0) & 0o777;
}

export function probeChown(path: string): number {
  return nts_fs_chown_bytes(bytesOf(path), -1, -1);
}

export function probeUtimes(path: string, atime: number, mtime: number): number {
  const result = nts_fs_utimes_bytes(bytesOf(path), atime, mtime);
  if (result !== 0) return result;
  return nts_fs_stat(path, true)[11] ?? -1;
}

/** `lutimes` on a symlink must move the link and leave the target alone. */
export function probeLutimes(link: string, target: string, mtime: number): string {
  const result = nts_fs_lutimes_bytes(bytesOf(link), 1000, mtime);
  if (result !== 0) return `errno:${result}`;
  const linkMtime = nts_fs_stat(link, false)[11] ?? -1;
  const targetMtime = nts_fs_stat(target, true)[11] ?? -1;
  return `${linkMtime}:${targetMtime === mtime * 1000}`;
}

export function probeRename(from: string, to: string): number {
  return nts_fs_rename_bytes(bytesOf(from), bytesOf(to));
}

export function probeCopyfile(from: string, to: string): number {
  return nts_fs_copyfile_bytes(bytesOf(from), bytesOf(to), 0);
}

export function probeLink(from: string, to: string): number {
  return nts_fs_link_bytes(bytesOf(from), bytesOf(to));
}

export function probeReadlink(path: string): string {
  const bytes = nts_fs_readlink_bytes(bytesOf(path));
  let out = "";
  for (let index = 0; index < bytes.length; index++) {
    out += String.fromCharCode(bytes[index] ?? 0);
  }
  return out;
}

/** Each of them on a path that is not there, which is where errnos go wrong. */
export function probeMissingErrnos(path: string): string {
  return `${nts_fs_unlink_bytes(bytesOf(path))}:` +
    `${nts_fs_rmdir_bytes(bytesOf(path))}:` +
    `${nts_fs_chmod_bytes(bytesOf(path), 0o644)}:` +
    `${nts_fs_chown_bytes(bytesOf(path), -1, -1)}:` +
    `${nts_fs_utimes_bytes(bytesOf(path), 0, 0)}`;
}
