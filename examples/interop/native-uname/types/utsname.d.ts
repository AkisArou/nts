// Hand-written binding for POSIX uname on the supported Linux LP64 target.
// `native_witness.h`, generated beside program.c, checks it against the real
// <sys/utsname.h>: six inline arrays, their element type, and every offset.
/**
 * The binding names the header it describes, and the feature-test macro to
 * read it under. `native_witness.c` is generated from these two lines plus the
 * types below, and compiles on its own -- so what this file is checked against
 * is stated here rather than chosen by whoever writes the checking file.
 *
 * `_GNU_SOURCE` is load-bearing. glibc calls the sixth member `domainname`
 * under `__USE_GNU` and `__domainname` without it, so the same header gives
 * two different structs and only one of them is this one.
 *
 * @ntsHeader sys/utsname.h
 * @ntsDefine _GNU_SOURCE
 */
declare module "c:sys/utsname" {
  import type { CArray, Ptr, Struct, c_char, c_int } from "c:types";
  // Six fixed arrays stored inline. The length is part of the type because it
  // is part of the layout -- this struct is 390 bytes and is nothing without
  // them. glibc's sixth field is `domainname`; a declaration with five would
  // have the wrong size and the witness would say so.
  //
  // `c_char` and not `c_uint8`: C's `char` is a third type, and the first
  // version of this file used `c_uint8`. Same size, same alignment, same
  // offsets -- and the witness refused it, which is the whole reason the
  // member's *type* is asserted and not only its position.
  export type UtsName = Struct<{
    sysname: CArray<c_char, 65>;
    nodename: CArray<c_char, 65>;
    release: CArray<c_char, 65>;
    version: CArray<c_char, 65>;
    machine: CArray<c_char, 65>;
    domainname: CArray<c_char, 65>;
  }, "utsname">;
  /** Fills the caller's storage and keeps no address into it.
   * @ntsNoEscape buf
   */
  export function uname(buf: Ptr<UtsName>): c_int;
}
