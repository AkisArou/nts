import { inet_pton, type In6Addr } from "c:inet";
import { local } from "c:memory";
import type { ConstPtr, c_char, c_int } from "c:types";

// `AF_INET6`. A macro, so no binding can carry it; `native/caller.c` asserts
// this against the real one.
const INET6 = 10 as c_int;

// Parses an address and returns one byte of it, reached *through* the
// anonymous union: `addr.__in6_u.__u6_addr8[at]`. Two hops, and the type in
// between has no name — the compiler computes the address rather than
// declaring a variable of a type C cannot spell.
export function byteAt(text: ConstPtr<c_char>, at: number): number {
  const addr = local<In6Addr>();
  if (inet_pton(INET6, text, addr) !== 1) return -1;
  return addr.__in6_u.__u6_addr8[at];
}

// The same sixteen bytes read as four 32-bit words, which is the other member
// of the same union and therefore the same storage. Reading a different member
// than the one written is C's rule and not this compiler's: the bytes are
// whatever `inet_pton` left there.
export function wordAt(text: ConstPtr<c_char>, at: number): number {
  const addr = local<In6Addr>();
  if (inet_pton(INET6, text, addr) !== 1) return -1;
  return addr.__in6_u.__u6_addr32[at];
}
