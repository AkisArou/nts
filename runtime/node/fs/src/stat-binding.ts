// Shared synchronous stat bindings. These are aliases, not forwarding
// wrappers: callers pay exactly the native operation and no extra TS call.

declare function nts_fs_stat(path: string, follow: boolean): number[];
declare function nts_fs_stat_bytes(path: number[], follow: boolean): number[];
declare function nts_fs_stat_bigint(path: string, follow: boolean): string[];
declare function nts_fs_stat_bigint_bytes(
  path: number[],
  follow: boolean,
): string[];
declare function nts_fs_fstat(descriptor: number): number[];
declare function nts_fs_fstat_bigint(descriptor: number): string[];

export const _statColumns = nts_fs_stat;
export const _statByteColumns = nts_fs_stat_bytes;
export const _statBigIntColumns = nts_fs_stat_bigint;
export const _statBigIntByteColumns = nts_fs_stat_bigint_bytes;
export const _fstatColumns = nts_fs_fstat;
export const _fstatBigIntColumns = nts_fs_fstat_bigint;
