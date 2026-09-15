/**
 * IPv6 addresses, which are the reason `Untagged<T>` exists.
 *
 * glibc declares `struct in6_addr` as a single member whose *type* has no name:
 *
 *     struct in6_addr {
 *       union { uint8_t __u6_addr8[16]; uint16_t __u6_addr16[8];
 *               uint32_t __u6_addr32[4]; } __in6_u;
 *     };
 *
 * The member is named and its type is not. C has no spelling for that type, so
 * no variable can be declared to hold a pointer to it and `_Generic` cannot ask
 * about it -- and a tag invented here would be a second type beside the
 * header's, which `program.h` includes.
 *
 * Nothing marks it. `In6Addr` carries the tag `"in6_addr"`, so some header
 * defines it -- and a header-defined struct's members have the header's types,
 * so a member type with no tag can only be the header's untagged one. The
 * compiler reaches its fields by byte offset from `in6_addr`, which is what a
 * C programmer does when they cannot name a type either.
 *
 * @ntsHeader arpa/inet.h
 * @ntsHeader netinet/in.h
 */
declare module "c:arpa/inet" {
  import type {
    CArray, ConstPtr, Ptr, Struct, Union,
    c_char, c_int, c_uint8, c_uint16, c_uint32,
  } from "c:types";

  export type In6Addr = Struct<{
    __in6_u: Union<{
      __u6_addr8: CArray<c_uint8, 16>;
      __u6_addr16: CArray<c_uint16, 8>;
      __u6_addr32: CArray<c_uint32, 4>;
    }>;
  }, "in6_addr">;

  /** Parses `src` into `dst`. Reads one and writes the other, keeping neither.
   *
   * `dst` is `Ptr<unknown>` -- C's `void *` -- and the first version of this
   * file said `Ptr<In6Addr>`, which is what the function is *used* for and not
   * what it declares. It typechecked, it lowered, and the witness refused it:
   * `conflicting types for 'inet_pton'` against the real <arpa/inet.h>. That
   * is the entire reason the prototype is re-declared beside the real one.
   *
   * @ntsNoEscape src dst */
  export function inet_pton(family: c_int, src: ConstPtr<c_char>, dst: Ptr<unknown>): c_int;
}
