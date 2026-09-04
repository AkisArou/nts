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
NtsString *nts_os_type(void);
NtsString *nts_os_version(void);
NtsString *nts_os_machine(void);
NtsString *nts_os_arch(void);
NtsString *nts_os_platform(void);
NtsString *nts_os_homedir(void);
NtsString *nts_os_tmpdir(void);
NtsString *nts_os_devnull(void);
NtsString *nts_os_eol(void);
NtsString *nts_os_endianness(void);
double     nts_os_uptime(void);
double     nts_os_totalmem(void);
double     nts_os_freemem(void);
double     nts_os_available_parallelism(void);
NtsArray  *nts_os_loadavg(void);
NtsArray  *nts_os_cpu_models(void);
NtsArray  *nts_os_cpu_speeds(void);
NtsArray  *nts_os_cpu_times(void);
NtsArray  *nts_os_if_names(void);
NtsArray  *nts_os_if_addresses(void);
NtsArray  *nts_os_if_netmasks(void);
NtsArray  *nts_os_if_families(void);
NtsArray  *nts_os_if_macs(void);
NtsArray  *nts_os_if_internal(void);
NtsArray  *nts_os_if_scopeids(void);
double     nts_os_user_uid(void);
double     nts_os_user_gid(void);
NtsString *nts_os_user_username(void);
NtsString *nts_os_user_homedir(void);
NtsString *nts_os_user_shell(void);
double     nts_os_get_priority(double pid);
double     nts_os_set_priority(double pid, double priority);
NtsArray  *nts_os_constant_groups(void);
NtsArray  *nts_os_constant_names(void);
NtsArray  *nts_os_constant_values(void);

#endif
