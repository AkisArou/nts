// The last three reachable `fs` bindings: the byte-path directory openers and
// the bigint-positioned read.
//
// `read_bigint` exists so a file larger than 2^53 bytes can be read from an
// exact offset, which is the case a `number` position cannot express. The probe
// cannot make a file that large, so what it *can* check is that the bigint path
// agrees with the number path on offsets both can name — and that a position
// beyond 2^53 is accepted rather than silently truncated.
declare function nts_fs_open(path: string, flags: number, mode: number): number;
declare function nts_fs_close(descriptor: number): number;
declare function nts_fs_read(fd: number, length: number, position: number): number[];
declare function nts_fs_read_bigint(fd: number, length: number, position: bigint): number[];
declare function nts_fs_opendir_bytes(path: number[]): number;
declare function nts_fs_dir_read(handle: number, bufferSize: number): number[][];
declare function nts_fs_dir_close(handle: number): number;
declare function nts_fs_scandir_bytes(path: number[]): number[][];
declare function nts_errno(): number;

function bytesOf(text: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index++) {
    out.push(text.charCodeAt(index) & 0xff);
  }
  return out;
}

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

export function probeScandirBytes(path: string): string {
  return rowsToString(nts_fs_scandir_bytes(bytesOf(path)));
}

export function probeOpendirBytesWalk(path: string, batch: number): string {
  const handle = nts_fs_opendir_bytes(bytesOf(path));
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

export function probeOpendirBytesMissing(path: string): number {
  const handle = nts_fs_opendir_bytes(bytesOf(path));
  if (handle !== 0) {
    nts_fs_dir_close(handle);
    return 0;
  }
  return -nts_errno();
}

/** The two positioned reads must agree wherever both can name the offset. */
export function probeReadBigIntAgrees(path: string, length: number, position: number): boolean {
  const fd = nts_fs_open(path, 0, 0o666);
  if (fd < 0) return false;
  const asNumber = nts_fs_read(fd, length, position);
  const asBigInt = nts_fs_read_bigint(fd, length, BigInt(position));
  nts_fs_close(fd);
  if (asNumber.length !== asBigInt.length) return false;
  for (let index = 0; index < asNumber.length; index++) {
    if (asNumber[index] !== asBigInt[index]) return false;
  }
  return true;
}

export function probeReadBigIntAt(path: string, length: number, position: number): string {
  const fd = nts_fs_open(path, 0, 0o666);
  if (fd < 0) return `open:${fd}`;
  const bytes = nts_fs_read_bigint(fd, length, BigInt(position));
  nts_fs_close(fd);
  let out = "";
  for (let index = 0; index < bytes.length; index++) {
    out += String.fromCharCode(bytes[index] ?? 0);
  }
  return out;
}

/**
 * A position past 2^53 reads nothing rather than wrapping to a small offset.
 * If the bigint were truncated through a double this would return the head of
 * the file, which is the failure worth naming.
 */
export function probeReadBigIntHugePosition(path: string): number {
  const fd = nts_fs_open(path, 0, 0o666);
  if (fd < 0) return -1;
  const bytes = nts_fs_read_bigint(fd, 8, 9007199254740993n);
  nts_fs_close(fd);
  return bytes.length;
}
