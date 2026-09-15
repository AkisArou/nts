import { sigemptyset, sigaddset, sigismember, type SigSet } from "c:signal";
import { local } from "c:memory";
import type { c_int } from "c:types";

// `__sigset_t` is `typedef struct { unsigned long __val[16]; } __sigset_t;` --
// a struct with **no tag**. C spells the type `__sigset_t` and never
// `struct __sigset_t`, which is the only thing that separates it from every
// other header record here: `sizeof`, `offsetof` and `_Generic` all work on it.
//
// Storage this program owns, filled and read through libc's own functions, so
// the answer comes from the platform rather than from a constant here.
export function holds(signo: number): number {
  const set = local<SigSet>();
  if (sigemptyset(set) !== 0) return -1;
  if (sigaddset(set, signo as c_int) !== 0) return -2;
  return sigismember(set, signo as c_int);
}

// The arm that fails if the set was never emptied: a signal that was not added
// must not be a member.
export function holdsOther(added: number, asked: number): number {
  const set = local<SigSet>();
  if (sigemptyset(set) !== 0) return -1;
  if (sigaddset(set, added as c_int) !== 0) return -2;
  return sigismember(set, asked as c_int);
}
