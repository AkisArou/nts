// `fs`'s directory reading and positional I/O, neither of which had ever run.
//
// `scandir` and the `opendir`/`dir_read`/`dir_close` trio are what `readdirSync`
// and `opendirSync` are built on, and the second is a *handle lifecycle* -- the
// kind of binding that goes wrong on the third call rather than the first.
//
// A scandir row is `[type, ...nameBytes]` where type is a `UV_DIRENT_*` value
// between 0 and 7. That layout is read off `fs/src/readdir.ts:68-90` rather than
// guessed; a probe that assumes a layout is testing its own assumption.
//
// Rows are reduced to a `type:name` string here in TypeScript, because a
// `number[][]` does not cross the wrapper boundary. **Sorting happens on the
// comparison side rather than here**: readdir order is not specified, so the
// comparison has to sort, and `sort` on an array of strings is itself refused --
// see `blockers/sort-array-of-references`, which this probe found. Sorting in
// the probe is instrumentation rather than module source, so moving it is not a
// workaround for a refusal; it is putting it where it belongs.
declare function nts_fs_scandir(path: string): number[][];
declare function nts_fs_opendir(path: string): number;
declare function nts_fs_dir_read(handle: number, bufferSize: number): number[][];
declare function nts_fs_dir_close(handle: number): number;
declare function nts_fs_open(path: string, flags: number, mode: number): number;
declare function nts_fs_close(descriptor: number): number;
declare function nts_fs_read(fd: number, length: number, position: number): number[];
declare function nts_fs_write(fd: number, bytes: number[], position: number): number;
declare function nts_fs_statfs(path: string): number[];
declare function nts_fs_fchmod(fd: number, mode: number): number;
declare function nts_fs_futimes(fd: number, atime: number, mtime: number): number;
declare function nts_fs_stat(path: string, follow: boolean): number[];
declare function nts_errno(): number;

function rowsToString(rows: number[][]): string {
  const parts: string[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (row === undefined || row.length === 0) continue;
    let name = "";
    for (let byteIndex = 1; byteIndex < row.length; byteIndex++) {
      name += String.fromCharCode(row[byteIndex] ?? 0);
    }
    parts.push(`${row[0]}:${name}`);
  }
  return parts.join("|");
}

export function probeScandir(path: string): string {
  return rowsToString(nts_fs_scandir(path));
}

export function probeScandirCount(path: string): number {
  return nts_fs_scandir(path).length;
}

/**
 * The whole `opendir` lifecycle in one call, reading in small batches so the
 * handle is used more than once. A directory binding that works for the first
 * batch and not the second is the one worth catching.
 */
export function probeOpendirWalk(path: string, batch: number): string {
  // `opendir` answers **0** for failure, not a negative -- `dir.ts:432` is
  // `if (handle === 0) return;` and the errno is out of band in `nts_errno()`.
  // Guarding on `handle < 0` reported a missing directory as a success.
  const handle = nts_fs_opendir(path);
  if (handle === 0) return `opendir-failed:${nts_errno()}`;
  const collected: number[][] = [];
  for (let round = 0; round < 64; round++) {
    const rows = nts_fs_dir_read(handle, batch);
    if (rows.length === 0) break;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (row !== undefined) collected.push(row);
    }
  }
  nts_fs_dir_close(handle);
  return rowsToString(collected);
}

/** A closed directory handle must not still answer. */
export function probeDirCloseTwice(path: string): string {
  const handle = nts_fs_opendir(path);
  if (handle === 0) return `opendir-failed:${nts_errno()}`;
  const first = nts_fs_dir_close(handle);
  const second = nts_fs_dir_close(handle);
  return `${first}:${second}`;
}

export function probeOpendirMissing(path: string): number {
  const handle = nts_fs_opendir(path);
  if (handle !== 0) {
    nts_fs_dir_close(handle);
    return 0;
  }
  return -nts_errno();
}

/** A read from an explicit offset, which is what `position` is for. */
export function probeReadAt(path: string, length: number, position: number): string {
  const fd = nts_fs_open(path, 0, 0o666);
  if (fd < 0) return `open:${fd}`;
  const bytes = nts_fs_read(fd, length, position);
  nts_fs_close(fd);
  let out = "";
  for (let index = 0; index < bytes.length; index++) {
    out += String.fromCharCode(bytes[index] ?? 0);
  }
  return out;
}

/** A write at an offset must leave the bytes before it untouched. */
export function probeWriteAt(path: string, text: string, position: number): number {
  const fd = nts_fs_open(path, 2, 0o666);
  if (fd < 0) return fd;
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    bytes.push(text.charCodeAt(index) & 0xff);
  }
  const written = nts_fs_write(fd, bytes, position);
  nts_fs_close(fd);
  return written;
}

// Eight columns, not node's seven public `StatFs` properties -- `stats.ts:246`
// reads indices 0 through 7. libuv's `uv_statfs_t` carries the extra one, and
// expecting seven here reported a divergence for a binding that was right.
export function probeStatfsCount(path: string): number {
  return nts_fs_statfs(path).length;
}

export function probeStatfsBsize(path: string): number {
  return nts_fs_statfs(path)[1] ?? -1;
}

/** `fchmod` through a descriptor, read back through the path. */
export function probeFchmod(path: string, mode: number): number {
  const fd = nts_fs_open(path, 0, 0o666);
  if (fd < 0) return fd;
  const result = nts_fs_fchmod(fd, mode);
  nts_fs_close(fd);
  if (result !== 0) return result;
  return (nts_fs_stat(path, true)[1] ?? 0) & 0o777;
}

export function probeFutimes(path: string, atime: number, mtime: number): number {
  const fd = nts_fs_open(path, 0, 0o666);
  if (fd < 0) return fd;
  const result = nts_fs_futimes(fd, atime, mtime);
  nts_fs_close(fd);
  if (result !== 0) return result;
  return nts_fs_stat(path, true)[11] ?? -1;
}

/** `nts_errno` after a call that cannot have failed. */
export function probeErrnoAfterSuccess(path: string): number {
  nts_fs_scandir(path);
  return nts_errno();
}
