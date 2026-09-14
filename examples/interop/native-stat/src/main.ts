import { stat, type Stat } from "c:stat";
import { local } from "c:memory";
import type { ConstPtr, c_char } from "c:types";

// `struct stat` is the largest thing this compiler describes: 144 bytes,
// sixteen members, three of them a nested `struct timespec`, several 64-bit,
// and a trailing inline array. The binding is generated -- see `bind.sh` --
// which is the point of choosing it. Nobody should transcribe this by hand,
// and the first person to try would get `__pad0` wrong and every offset after
// it.
export function sizeOf(path: ConstPtr<c_char>): number {
  const info = local<Stat>();
  if (stat(path, info) !== 0) return -1;
  // `st_size` is `off_t`, 64 bits here and so bigint-branded: the conversion
  // out is explicit rather than through a double.
  return Number(info.st_size);
}

// A member past the nested structs, so an offset wrong by one member is
// visible. `st_mtim` is at 88 and its `tv_sec` is the first word of it.
export function modifiedSeconds(path: ConstPtr<c_char>): number {
  const info = local<Stat>();
  if (stat(path, info) !== 0) return -1;
  return Number(info.st_mtim.tv_sec);
}

// The count of hard links, which is early in the struct and 64-bit. Reading it
// as 32 bits would give the same answer on a little-endian machine for every
// plausible value, so this is not the arm that catches a width mistake -- the
// C side compares all three against its own `stat` for that.
export function linkCount(path: ConstPtr<c_char>): number {
  const info = local<Stat>();
  if (stat(path, info) !== 0) return -1;
  return Number(info.st_nlink);
}
