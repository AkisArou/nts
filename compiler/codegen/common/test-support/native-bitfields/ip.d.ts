/**
 * @ntsHeader netinet/ip.h
 * @ntsDefine _GNU_SOURCE=1
 */
declare module "c:netinet/ip" {
  import type { Struct, Bits, c_uint, c_uint8, c_uint16, c_uint32 } from "c:types";
  export type IpHeader = Struct<{
    ihl: Bits<c_uint, 4>;
    version: Bits<c_uint, 4>;
    tos: c_uint8;
    tot_len: c_uint16;
    id: c_uint16;
    frag_off: c_uint16;
    ttl: c_uint8;
    protocol: c_uint8;
    check: c_uint16;
    saddr: c_uint32;
    daddr: c_uint32;
  }, "iphdr">;
}
