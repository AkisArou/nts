/* The primitives `dns/src` declares: libuv for `lookup`, c-ares for the rest.
 *
 * `lookup` and `lookupService` are the half of `node:dns` that does not need a
 * DNS client: they call the platform's `getaddrinfo` and `getnameinfo`, which is
 * what makes them honour `/etc/hosts` and the system resolver configuration.
 * The other half -- `resolve*`, `Resolver`, `setServers`, `getServers` -- speaks
 * the DNS wire protocol through c-ares, in `cares.c`, declared at the end.
 *
 * These duplicate machinery that `net.c` already has for `nts_net_lookup`. The
 * duplication is deliberate: those are `static` there, and exporting them would
 * make `net` a dependency of `dns` for no reason other than sharing forty lines
 * of libuv request plumbing. The two differ anyway -- this pair carries
 * `getaddrinfo` hints and a result order that `net` has no use for.
 */

#ifndef NTS_DNS_H
#define NTS_DNS_H

#include "nts_runtime.h"

/* One address. `errno` is 0 or a negative libuv code, as everywhere else. */
void nts_dns_getaddrinfo(NtsString *hostname, double family, double hints,
                         double order, NtsHeader *callback);

/* Every address, in the resolver's order unless `order` asks otherwise. */
void nts_dns_getaddrinfo_all(NtsString *hostname, double family, double hints,
                             double order, NtsHeader *callback);

/* The reverse direction: an address and port to a hostname and service. */
void nts_dns_getnameinfo(NtsString *address, double port, NtsHeader *callback);

/* `uv_err_name`, so an errno reaches JavaScript spelled as node spells it. */
NtsString *nts_dns_errname(double errno_value);

/* ------------------------------------------------ the resolver, over c-ares
 *
 * `cares.c`, node's `cares_wrap.cc` for this seam. A channel is an id; an
 * answer is `(code, texts, numbers)` in the per-type layout `src/resolver.ts`
 * documents, delivered on a later turn of the loop. */

/* A channel with node's options: timeout ms (-1 default), tries, max timeout
 * (0 none). The id, or 0 if c-ares could not start one. */
double nts_dns_channel_new(double timeout, double tries, double max_timeout);

/* `ares_cancel`: every pending query completes `ECANCELLED`. */
void nts_dns_channel_cancel(double channel);

/* The servers' addresses, and beside them their UDP ports. */
NtsArray *nts_dns_channel_server_hosts(double channel);
NtsArray *nts_dns_channel_server_ports(double channel);

/* Replace the servers: 0, a c-ares status, or -1000 while a query is pending. */
double nts_dns_channel_set_servers(double channel, NtsArray *families, NtsArray *hosts,
                                   NtsArray *ports);

/* The local addresses to send from; "" leaves a family to the system. */
void nts_dns_channel_set_local_address(double channel, NtsString *ipv4, NtsString *ipv6);

/* Send one query of `kind`. 0, or a libuv errno if it could not start. */
double nts_dns_channel_query(double channel, double kind, NtsString *name, NtsHeader *callback);

/* `ares_strerror`, and node's own message for -1000. */
NtsString *nts_dns_strerror(double status);

#endif
