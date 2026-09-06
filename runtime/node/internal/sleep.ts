// The blocking sleep used by Node's synchronous retry loops.
//
// This is deliberately a native operation. A JavaScript busy loop would burn
// a core and would make the requested delay depend on optimizer behaviour;
// libuv already exposes the platform sleep Node uses for this purpose.

declare function nts_sleep(milliseconds: number): void;

/** Block the current thread for at least `milliseconds`. */
export const sleep = nts_sleep;
