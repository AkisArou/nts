import type { IpHeader } from "c:netinet/ip";
import type { Ptr } from "c:types";

// Two bit-fields sharing byte 0 of a real `struct iphdr`, and one ordinary
// member after them. The C backend emits `h->version` and lets the header do
// the packing; the LLVM backend shifts and masks using the positions this
// compiler computed. `caller.c` asserts they answer the same thing, which is
// two independent derivations of one layout rather than one checked against
// itself.
export function versionOf(h: Ptr<IpHeader>): number { return h.version; }
export function ihlOf(h: Ptr<IpHeader>): number { return h.ihl; }
export function ttlOf(h: Ptr<IpHeader>): number { return h.ttl; }
export function setVersion(h: Ptr<IpHeader>, n: number): void { h.version = n; }
export function setTtl(h: Ptr<IpHeader>, n: number): void { h.ttl = n; }
