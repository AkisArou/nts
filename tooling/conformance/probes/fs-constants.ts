// The twelve `O_*` open flags, which node's own tests cannot get wrong.
//
// These are the bindings the oracle under-tests hardest. A constant cannot fail
// on node -- node reads it from the same header the test would -- so node's
// suite asserts almost nothing about their *values*. Here they are a separate
// implementation, and a wrong one is silent: `O_EXCL` off by a bit does not
// throw, it makes an exclusive create quietly non-exclusive, and `O_TRUNC` in
// the wrong position truncates a file that was opened to be appended to. That is
// the assertion the oracle had no reason to write.
//
// Named `probe*` rather than after the flag for the reason `probes/fs.ts`
// records: a plain exported `open` is replaced by libc's at load time.
declare function nts_fs_o_append(): number;
declare function nts_fs_o_creat(): number;
declare function nts_fs_o_direct(): number;
declare function nts_fs_o_directory(): number;
declare function nts_fs_o_dsync(): number;
declare function nts_fs_o_excl(): number;
declare function nts_fs_o_noatime(): number;
declare function nts_fs_o_noctty(): number;
declare function nts_fs_o_nofollow(): number;
declare function nts_fs_o_nonblock(): number;
declare function nts_fs_o_sync(): number;
declare function nts_fs_o_trunc(): number;
declare function nts_fs_is_32_bit(): boolean;

export function probeAppend(): number { return nts_fs_o_append(); }
export function probeCreat(): number { return nts_fs_o_creat(); }
export function probeDirect(): number { return nts_fs_o_direct(); }
export function probeDirectory(): number { return nts_fs_o_directory(); }
export function probeDsync(): number { return nts_fs_o_dsync(); }
export function probeExcl(): number { return nts_fs_o_excl(); }
export function probeNoatime(): number { return nts_fs_o_noatime(); }
export function probeNoctty(): number { return nts_fs_o_noctty(); }
export function probeNofollow(): number { return nts_fs_o_nofollow(); }
export function probeNonblock(): number { return nts_fs_o_nonblock(); }
export function probeSync(): number { return nts_fs_o_sync(); }
export function probeTrunc(): number { return nts_fs_o_trunc(); }
export function probeIs32Bit(): boolean { return nts_fs_is_32_bit(); }
