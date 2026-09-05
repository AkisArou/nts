// Shared descriptor bindings. These direct aliases let internal state
// machines use already-validated arguments without paying the public
// fs.open/read/close normalization path again.

declare function nts_fs_open(
  path: string,
  flags: number,
  mode: number,
): number;
declare function nts_fs_open_bytes(
  path: number[],
  flags: number,
  mode: number,
): number;
declare function nts_fs_close(descriptor: number): number;

declare function nts_fs_open_async(
  path: string,
  flags: number,
  mode: number,
  callback: (errno: number, descriptor: number) => void,
): void;
declare function nts_fs_open_bytes_async(
  path: number[],
  flags: number,
  mode: number,
  callback: (errno: number, descriptor: number) => void,
): void;
declare function nts_fs_close_async(
  descriptor: number,
  callback: (errno: number) => void,
): void;
declare function nts_fs_read_async(
  descriptor: number,
  length: number,
  position: number,
  callback: (errno: number, bytesRead: number, bytes: number[]) => void,
): void;

export const _openAsync = nts_fs_open_async;
export const _openBytesAsync = nts_fs_open_bytes_async;
export const _closeAsync = nts_fs_close_async;
export const _readAsync = nts_fs_read_async;
export const _open = nts_fs_open;
export const _openBytes = nts_fs_open_bytes;
export const _close = nts_fs_close;
