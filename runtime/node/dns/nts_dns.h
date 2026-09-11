/* The four primitives `dns/src` declares, over libuv.
 *
 * `lookup` and `lookupService` are the half of `node:dns` that does not need a
 * DNS client: they call the platform's `getaddrinfo` and `getnameinfo`, which is
 * what makes them honour `/etc/hosts` and the system resolver configuration.
 * The other half -- `resolve*`, `Resolver`, `setServers`, `getServers` -- speaks
 * the DNS wire protocol through c-ares and is absent here, named file by file in
 * `not-applicable` rather than stubbed.
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

#endif
