/**
 * Linux epoll. Three C shapes this compiler could not describe until now meet
 * in one 12-byte struct, which is why it is the fixture:
 *
 *   - a **union**, `epoll_data_t`, whose four members share one address
 *   - a **packed** struct, so the union sits at offset 4 and not 8
 *   - a 64-bit member, `u64`, which is `bigint`-branded on this target
 *
 * Getting any of the three wrong gives a struct of the right *kind* and the
 * wrong size, and an array of them puts every element after the first at an
 * address the kernel does not agree with.
 *
 * @ntsHeader sys/epoll.h
 *
 * And `unistd.h`, because `close` is declared there and not by `sys/epoll.h`.
 * A module may name several headers and this one needs both: until the witness
 * began asserting that a named header actually declares each symbol, the
 * prototype for `close` was emitted, compiled and checked against **nothing**,
 * and happened to be right.
 * @ntsHeader unistd.h
 */
declare module "c:sys/epoll" {
  import type { Packed, Ptr, Struct, Union, c_int, c_uint32, c_uint64 } from "c:types";

  /** `EPOLLIN`. Spelled here rather than imported: a macro is not a
   * declaration, so no binding can name one and the witness cannot check it.
   * The value is asserted against the real macro in `native/caller.c`. */
  export type Events = c_uint32;

  /** The four spellings of one word the kernel hands back untouched. It never
   * reads this; only the program that set it does. */
  export type EpollData = Union<{
    // `Ptr<unknown>` is C's `void *`.
    ptr: Ptr<unknown>;
    fd: c_int;
    u32: c_uint32;
    u64: c_uint64;
  }, "epoll_data">;

  /** 12 bytes, not 16. `data` is 8 bytes wanting 8-byte alignment and it sits
   * at offset 4, which only `packed` allows -- and only on x86-64: the same
   * header leaves this struct unpacked on other architectures, so this
   * binding is as target-specific as the goal says the compiler is. */
  export type EpollEvent = Packed<Struct<{
    events: Events;
    data: EpollData;
  }, "epoll_event">>;

  export function epoll_create1(flags: c_int): c_int;
  /** @ntsNoEscape event */
  export function epoll_ctl(epfd: c_int, op: c_int, fd: c_int, event: Ptr<EpollEvent>): c_int;
  /** The kernel fills the caller's array and keeps no address into it.
   * @ntsNoEscape events */
  export function epoll_wait(epfd: c_int, events: Ptr<EpollEvent>, maxevents: c_int, timeout: c_int): c_int;
  export function close(fd: c_int): c_int;
}
