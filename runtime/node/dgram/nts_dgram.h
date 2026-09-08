/* The twenty-one primitives `dgram/src/main.ts` declares, over libuv.
 *
 * `runtime/node/dgram/` held no `.c` at all, so the module could not have
 * linked whatever the compiler did with it. Two of the twenty-one are reached
 * by the compiled module today -- `nts_udp_recv_stop` and `nts_udp_ref`, which
 * `nm -D` found undefined in the built addon -- and the other nineteen are
 * behind refusals in `dgram`'s own source rather than behind anything here.
 *
 * A shared object binds lazily, so an addon carrying an undefined binding
 * loads and aborts on first call. That is why the two matter now and the
 * nineteen matter later.
 *
 * The contract is in `main.ts` and in `bindings.node.mjs`, which stands in for
 * this file on the interpreted lane. What is here is the part about libuv.
 *
 * Handles are `double` and not pointers: the seam is a C number, and a table
 * here answers it. Same shape as the stand-in's `Map`.
 *
 * libuv's convention throughout: negative errno on failure, zero on success. A
 * function returning something other than a status says so in its name or its
 * return type. */
#ifndef NTS_NODE_DGRAM_H
#define NTS_NODE_DGRAM_H
#include "nts_runtime.h"

/* Lifecycle. `nts_udp_new` answers a handle, or a negative errno. */
double nts_udp_new(NtsString *type, bool reuse_addr, bool reuse_port,
                   bool ipv6_only);
double nts_udp_bind_sync(double handle, NtsString *address, double port);
void nts_udp_close(double handle);

/* `[address, family, port]`, or `[errno]` when there is none. The elements are
 * erased values -- see `nts_node_desc_value` -- because the module tells the
 * two apart with `typeof`. */
NtsArray *nts_udp_address(double handle, bool remote);

/* The three that take closures, spelled `NtsHeader *` for the reason
 * `nts_timers_install` is: the compiler names a closure type per program, so
 * the one definition every program links against cannot spell it. */
double nts_udp_send(double handle, NtsArray *chunks, double port,
                    NtsString *address, NtsHeader *callback);
double nts_udp_recv_start(double handle, NtsHeader *on_message,
                          NtsHeader *on_error);
void nts_udp_lookup(NtsString *hostname, double family, NtsHeader *callback);

double nts_udp_recv_stop(double handle);
double nts_udp_connect_sync(double handle, NtsString *address, double port);
double nts_udp_disconnect(double handle);

/* Socket options. Each answers a status. */
double nts_udp_set_broadcast(double handle, bool on);
double nts_udp_set_ttl(double handle, double ttl);
double nts_udp_set_multicast_ttl(double handle, double ttl);
double nts_udp_set_multicast_loopback(double handle, bool on);
double nts_udp_set_multicast_interface(double handle, NtsString *address);
double nts_udp_membership(double handle, NtsString *address, NtsString *iface,
                          bool join);
double nts_udp_source_membership(double handle, NtsString *source,
                                 NtsString *group, NtsString *iface, bool join);
double nts_udp_buffer_size(double handle, double size, bool receive);

double nts_udp_send_queue_size(double handle);
double nts_udp_send_queue_count(double handle);

/* Whether the socket keeps the loop alive. Not a status: libuv's ref/unref
 * cannot fail. */
void nts_udp_ref(double handle, bool keep_process_alive);

#endif /* NTS_NODE_DGRAM_H */
