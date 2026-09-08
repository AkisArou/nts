// The remaining reachable `fs` bindings: ownership, vectored I/O, and the
// bigint and byte-path variants of stat and statfs.
//
// `chown` family calls pass `-1` for both ids, which POSIX defines as "change
// nothing". That exercises the whole syscall path -- path resolution, permission
// check, errno -- without the probe needing privileges or leaving a file it did
// not own. `lchown` and `lutimes` are pointed at a *symlink*, because their
// entire reason to exist is not following one, and a probe aimed at a regular
// file would pass for an implementation that followed.
declare function nts_fs_open(path: string, flags: number, mode: number): number;
declare function nts_fs_open_bytes(path: number[], flags: number, mode: number): number;
declare function nts_fs_close(descriptor: number): number;
declare function nts_fs_fchown(fd: number, uid: number, gid: number): number;
declare function nts_fs_lchown(path: string, uid: number, gid: number): number;
declare function nts_fs_lchown_bytes(path: number[], uid: number, gid: number): number;
declare function nts_fs_lutimes(path: string, atime: number, mtime: number): number;
declare function nts_fs_readv(fd: number, lengths: number[], position: number): number[];
declare function nts_fs_writev(
  fd: number, bytes: number[], lengths: number[], position: number,
): number;
declare function nts_fs_stat(path: string, follow: boolean): number[];
declare function nts_fs_stat_bytes(path: number[], follow: boolean): number[];
declare function nts_fs_stat_bigint_bytes(path: number[], follow: boolean): string[];
declare function nts_fs_fstat_bigint(descriptor: number): string[];
declare function nts_fs_statfs_bytes(path: number[]): number[];
declare function nts_fs_statfs_bigint(path: string): string[];
declare function nts_fs_statfs_bigint_bytes(path: number[]): string[];
declare function nts_fs_o_filemap(): number;

function bytesOf(text: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index++) {
    out.push(text.charCodeAt(index) & 0xff);
  }
  return out;
}

export function probeFchownNoChange(path: string): number {
  const fd = nts_fs_open(path, 0, 0o666);
  if (fd < 0) return fd;
  const result = nts_fs_fchown(fd, -1, -1);
  nts_fs_close(fd);
  return result;
}

export function probeLchownNoChange(path: string): number {
  return nts_fs_lchown(path, -1, -1);
}

export function probeLchownBytesNoChange(path: string): number {
  return nts_fs_lchown_bytes(bytesOf(path), -1, -1);
}

export function probeLchownMissing(path: string): number {
  return nts_fs_lchown(path, -1, -1);
}

/**
 * `lutimes` on a symlink must move the *link's* mtime and leave its target's
 * alone. Answers both, so an implementation that followed the link is visible
 * rather than merely un-asserted.
 */
export function probeLutimesOnLink(link: string, target: string, mtime: number): string {
  const result = nts_fs_lutimes(link, 1000, mtime);
  if (result !== 0) return `errno:${result}`;
  const linkMtime = nts_fs_stat(link, false)[11] ?? -1;
  const targetMtime = nts_fs_stat(target, true)[11] ?? -1;
  return `${linkMtime}:${targetMtime === mtime * 1000}`;
}

/** Two buffers filled from one read, which is what vectored I/O is for. */
export function probeReadv(path: string, first: number, second: number): string {
  const fd = nts_fs_open(path, 0, 0o666);
  if (fd < 0) return `open:${fd}`;
  const lengths: number[] = [first, second];
  const bytes = nts_fs_readv(fd, lengths, 0);
  nts_fs_close(fd);
  let out = "";
  for (let index = 0; index < bytes.length; index++) {
    out += String.fromCharCode(bytes[index] ?? 0);
  }
  return out;
}

export function probeWritev(path: string, a: string, b: string): number {
  const fd = nts_fs_open(path, 65 | 512, 0o666);
  if (fd < 0) return fd;
  const bytes = bytesOf(a + b);
  const lengths: number[] = [a.length, b.length];
  const written = nts_fs_writev(fd, bytes, lengths, 0);
  nts_fs_close(fd);
  return written;
}

export function probeOpenBytes(path: string): number {
  const fd = nts_fs_open_bytes(bytesOf(path), 0, 0o666);
  if (fd < 0) return fd;
  nts_fs_close(fd);
  return 0;
}

export function probeStatBytesSize(path: string): number {
  return nts_fs_stat_bytes(bytesOf(path), true)[8] ?? -1;
}

export function probeStatBigIntBytesSize(path: string): string {
  return nts_fs_stat_bigint_bytes(bytesOf(path), true)[8] ?? "";
}

export function probeFstatBigIntSize(path: string): string {
  const fd = nts_fs_open(path, 0, 0o666);
  if (fd < 0) return `open:${fd}`;
  const columns = nts_fs_fstat_bigint(fd);
  nts_fs_close(fd);
  return columns[8] ?? "";
}

export function probeStatfsBytesBsize(path: string): number {
  return nts_fs_statfs_bytes(bytesOf(path))[1] ?? -1;
}

export function probeStatfsBigIntBsize(path: string): string {
  return nts_fs_statfs_bigint(path)[1] ?? "";
}

export function probeStatfsBigIntBytesBsize(path: string): string {
  return nts_fs_statfs_bigint_bytes(bytesOf(path))[1] ?? "";
}

/** Zero on every platform that is not Windows, which is where it is defined. */
export function probeOFilemap(): number {
  return nts_fs_o_filemap();
}
