/* The native half of `node:os`.
 *
 * One rule: every function here is a *marshalling* function. The work is done
 * by libuv -- the same library node calls -- so node's semantics are inherited
 * rather than reimplemented and then tested for. What node's own C++ spends on
 * `v8::Local` and `FunctionCallbackInfo`, these spend on `NtsString`.
 *
 * Each declaration here pairs with a `declare function` in this module's
 * TypeScript and a stand-in in its `bindings.node.mjs`. All three live in this
 * directory so the three halves of a binding can be read together. */
#ifndef NTS_NODE_OS_H
#define NTS_NODE_OS_H
#include "nts_runtime.h"

/* os */
NtsString *nts_os_hostname(void);
NtsArray  *nts_os_static_information(void);
NtsString *nts_os_homedir(void);
NtsString *nts_os_tmpdir(void);
double     nts_os_uptime(void);
double     nts_os_totalmem(void);
double     nts_os_freemem(void);
double     nts_os_available_parallelism(void);
NtsArray  *nts_os_loadavg(void);
NtsArray  *nts_os_cpus(void);
NtsArray  *nts_os_network_interfaces(void);
NtsArray  *nts_os_user_info(void);
double     nts_os_get_priority(double pid);
double     nts_os_set_priority(double pid, double priority);
NtsArray  *nts_os_constants(void);
double     nts_os_udp_reuseaddr(void);

#endif
