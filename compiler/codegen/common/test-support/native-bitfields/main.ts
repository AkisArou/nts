import type { IpHeader } from "c:netinet/ip";
import type { Ptr, Struct, Packed, Bits } from "c:types";
import type { c_uint, Uint8 } from "@nts/scalars";

// Two bit-fields sharing byte 0 of a real `struct iphdr`, and one ordinary
// member after them. The C backend emits `h->version` and lets the header do
// the packing; the LLVM backend shifts and masks using the positions this
// compiler computed. `caller.c` asserts they answer the same thing, which is
// two independent derivations of one layout rather than one checked against
// itself.
export function versionOf(h: Ptr<IpHeader>): number { return h.version; }
export function ihlOf(h: Ptr<IpHeader>): number { return h.ihl; }
export function ttlOf(h: Ptr<IpHeader>): number { return h.ttl; }
// A store keeps the field's width, as C's own store into a bit-field keeps its
// low bits: the mask says so, which is what proves the value fits.
export function setVersion(h: Ptr<IpHeader>, n: number): void { h.version = n & 0xf; }
export function setTtl(h: Ptr<IpHeader>, n: number): void { h.ttl = n & 0xff; }

// A **packed** record this program invents, so C compiles the definition we
// emit and LLVM uses the positions we computed. Packed does not bump, so `q`
// begins six bits in and ends at bit 35 -- four bits past the 32-bit unit it is
// declared in. A reader that loads "the unit containing it" returns 26 of its
// 30 bits, and `caller.c` also compares C's own view of the same struct.
type Flags = Packed<Struct<{ p: Bits<Uint8, 6>; q: Bits<c_uint, 30> }, "flags">>;
export function pOf(f: Ptr<Flags>): number { return f.p; }
export function qOf(f: Ptr<Flags>): number { return f.q; }
export function setP(f: Ptr<Flags>, n: number): void { f.p = n & 0x3f; }
export function setQ(f: Ptr<Flags>, n: number): void { f.q = n & 0x3fffffff; }
