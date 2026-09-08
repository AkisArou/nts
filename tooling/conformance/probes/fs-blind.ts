// The `fs` bindings that no lane could disagree with node about.
//
// Each of these has a stand-in that calls node's own implementation, so the
// interpreted lane agrees with node by construction; and `fs` does not compile,
// so the compiled lane never reaches them. `standin-blindspot.mjs` named them
// and this is the answer to ten of the seventeen.
//
// The `_bytes` variants take and answer a path as a byte column rather than a
// string, which is node's own arrangement for paths that are not valid UTF-8.
// They are the ones most likely to be wrong and least likely to be noticed: a
// test suite written in JavaScript passes strings.
declare function nts_fs_stat(path: string, follow: boolean): number[];
declare function nts_fs_stat_bigint(path: string, follow: boolean): string[];
declare function nts_fs_open(path: string, flags: number, mode: number): number;
declare function nts_fs_close(descriptor: number): number;
declare function nts_fs_read_file_utf8_fd(fd: number): string;
declare function nts_fs_write_file_utf8_fd(fd: number, contents: string): number;
declare function nts_fs_read_file_bytes_fd(fd: number, expectedSize: number): number[];
declare function nts_fs_access_bytes(path: number[], mode: number): number;
declare function nts_fs_realpath_bytes(path: number[]): number[];
declare function nts_fs_mkdtemp_bytes(template: number[]): number[];
declare function nts_fs_symlink_bytes(
  target: number[], at: number[], flags: number,
): number;
declare function nts_fs_write_file_bytes_fd(fd: number, bytes: number[]): number;
declare function nts_fs_readlink(path: string): string;

function bytesOf(text: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index++) {
    out.push(text.charCodeAt(index) & 0xff);
  }
  return out;
}

function joinBytes(bytes: number[]): string {
  let out = "";
  for (let index = 0; index < bytes.length; index++) {
    out += `${bytes[index]},`;
  }
  return out;
}

/** The stat columns, joined, so a shifted column cannot pass as a length. */
export function probeStatJoined(path: string): string {
  const columns = nts_fs_stat(path, true);
  let out = "";
  for (let index = 0; index < columns.length; index++) {
    out += `${columns[index]};`;
  }
  return out;
}

export function probeStatCount(path: string): number {
  return nts_fs_stat(path, true).length;
}

/** `lstat` rather than `stat`: `follow` false has to actually change the answer. */
export function probeStatNoFollowCount(path: string): number {
  return nts_fs_stat(path, false).length;
}

export function probeStatSize(path: string): number {
  return nts_fs_stat(path, true)[8] ?? -1;
}

export function probeStatBigIntCount(path: string): number {
  return nts_fs_stat_bigint(path, true).length;
}

export function probeStatBigIntSize(path: string): string {
  return nts_fs_stat_bigint(path, true)[8] ?? "";
}

export function probeReadUtf8(path: string): string {
  const fd = nts_fs_open(path, 0, 0o666);
  if (fd < 0) return `open:${fd}`;
  const text = nts_fs_read_file_utf8_fd(fd);
  nts_fs_close(fd);
  return text;
}

export function probeWriteUtf8(path: string, contents: string): number {
  const fd = nts_fs_open(path, 65 | 512, 0o666);
  if (fd < 0) return fd;
  const written = nts_fs_write_file_utf8_fd(fd, contents);
  nts_fs_close(fd);
  return written;
}

export function probeReadBytes(path: string, expected: number): string {
  const fd = nts_fs_open(path, 0, 0o666);
  if (fd < 0) return `open:${fd}`;
  const bytes = nts_fs_read_file_bytes_fd(fd, expected);
  nts_fs_close(fd);
  return joinBytes(bytes);
}

export function probeAccessBytes(path: string, mode: number): number {
  return nts_fs_access_bytes(bytesOf(path), mode);
}

export function probeRealpathBytes(path: string): string {
  const resolved = nts_fs_realpath_bytes(bytesOf(path));
  let out = "";
  for (let index = 0; index < resolved.length; index++) {
    out += String.fromCharCode(resolved[index] ?? 0);
  }
  return out;
}

export function probeMkdtempBytes(template: string): string {
  const made = nts_fs_mkdtemp_bytes(bytesOf(template));
  let out = "";
  for (let index = 0; index < made.length; index++) {
    out += String.fromCharCode(made[index] ?? 0);
  }
  return out;
}

/** A symlink made through the byte path, read back through the string one. */
export function probeSymlinkBytes(target: string, at: string): string {
  const errno = nts_fs_symlink_bytes(bytesOf(target), bytesOf(at), 0);
  if (errno !== 0) return `errno:${errno}`;
  return nts_fs_readlink(at);
}

export function probeWriteBytes(path: string, text: string): number {
  const fd = nts_fs_open(path, 65 | 512, 0o666);
  if (fd < 0) return fd;
  const written = nts_fs_write_file_bytes_fd(fd, bytesOf(text));
  nts_fs_close(fd);
  return written;
}
