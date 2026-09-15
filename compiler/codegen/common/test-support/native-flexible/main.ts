import type { CmsgHdr } from "c:sys/socket";
import type { Ptr } from "c:types";

// `struct cmsghdr` ends in `unsigned char __cmsg_data[]` -- a flexible array
// member. It contributes no bytes, so the struct is 16 and the member is *at*
// 16, and reading it decays to a pointer to its first element exactly as C's
// `CMSG_DATA` does: `((unsigned char *)((struct cmsghdr *)(cmsg) + 1))`.
//
// The count is nowhere in the type. For this record it is `cmsg_len` minus the
// header, which `caller.c` computes and this side is simply told.
export function levelOf(c: Ptr<CmsgHdr>): number { return c.cmsg_level; }
export function typeOf(c: Ptr<CmsgHdr>): number { return c.cmsg_type; }
export function lenOf(c: Ptr<CmsgHdr>): number { return Number(c.cmsg_len); }
export function dataAt(c: Ptr<CmsgHdr>, i: number): number { return c.__cmsg_data[i]; }
export function setDataAt(c: Ptr<CmsgHdr>, i: number, v: number): void {
  c.__cmsg_data[i] = v;
}
