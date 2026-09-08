/* The thirty primitives `net/src` declares, over libuv.
 *
 * `net.c` held two of them -- the two option defaults -- and the other
 * twenty-eight had no definition anywhere. Eleven are reached by compiled code
 * today and `nm -D` found them undefined in the built `net`, `http` and `dgram`
 * addons; a shared object binds lazily, so those three load and abort on first
 * call rather than failing at link.
 *
 * Three kinds of handle, all numbered from one out of a single table so a
 * handle is unambiguous across them:
 *
 *   bound    a socket that has an address and is not yet listening or
 *            connected. `bind` answers one; `listen` and `connect_bound`
 *            consume it.
 *   socket   a connected stream, from `connect`, `adopt_fd`, or a server's
 *            `onConnection`.
 *   server   a listening socket.
 *
 * TCP and pipes share every entry point. libuv does not share a type, so the
 * entry carries which one it is and every call dispatches on that -- the
 * alternative is two of each function and a module that has to know which.
 *
 * Addresses come back as two calls rather than one mixed array:
 * `address_text` and `address_numbers`. That is the module's design and it is
 * a good one; `dgram`'s single `(string | number)[]` is the only mixed array in
 * the tree and needed a descriptor written for it.
 *
 * libuv's convention: negative errno on failure, zero on success. */
#ifndef NTS_NODE_NET_H
#define NTS_NODE_NET_H
#include "nts_runtime.h"

/* Defaults from Node v24.20.0's EnvironmentOptions. */
bool nts_net_default_auto_select_family(void);
double nts_net_default_auto_select_family_attempt_timeout(void);

/* Bound handles. `bind` answers a handle or a negative errno. */
double nts_net_bind(NtsString *host, double port, NtsString *path, bool pipe,
                    bool ipv6_only, bool reuse_port);
NtsString *nts_net_bound_address_text(double handle);
NtsArray *nts_net_bound_address_numbers(double handle);
double nts_net_bound_fd(double handle);
double nts_net_bound_close(double handle);

/* Sockets. */
double nts_net_adopt_fd(double fd, bool readable, bool writable);
double nts_net_connect(NtsString *host, double port, NtsString *path,
                       NtsString *local_address, double local_port,
                       NtsHeader *callback);
double nts_net_connect_bound(double handle, NtsString *host, double port,
                             NtsString *path, NtsHeader *callback);
void nts_net_read_start(double handle, NtsHeader *on_data, NtsHeader *on_end,
                        NtsHeader *on_error);
void nts_net_read_stop(double handle);
double nts_net_write(double handle, NtsView *bytes, NtsHeader *callback);
void nts_net_shutdown(double handle, NtsHeader *callback);
void nts_net_close(double handle, NtsHeader *callback);
void nts_net_reset(double handle, NtsHeader *callback);
NtsString *nts_net_address_text(double handle, bool remote);
NtsArray *nts_net_address_numbers(double handle, bool remote);
void nts_net_set_no_delay(double handle, bool enable);
void nts_net_set_keepalive(double handle, bool enable, double delay);
double nts_net_set_tos(double handle, double value);
double nts_net_get_tos(double handle);
void nts_net_ref(double handle, bool keep_process_alive);

/* Servers. */
double nts_net_listen(NtsString *host, double port, NtsString *path,
                      double backlog, bool ipv6_only, bool reuse_port,
                      bool readable_all, bool writable_all, double fd,
                      double bound_handle, NtsHeader *on_listening,
                      NtsHeader *on_connection, NtsHeader *on_error);
NtsString *nts_net_server_address_text(double handle);
NtsArray *nts_net_server_address_numbers(double handle);
void nts_net_server_close(double handle, NtsHeader *callback);
void nts_net_server_ref(double handle, bool keep_process_alive);

/* Name resolution. */
void nts_net_lookup(NtsString *host, double family, NtsHeader *callback);
void nts_net_lookup_all(NtsString *host, double family, NtsHeader *callback);

#endif /* NTS_NODE_NET_H */
