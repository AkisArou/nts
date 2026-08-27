/* The native layer behind `declare function`.
 *
 * One rule: every function here is a *marshalling* function. The work is done
 * by libuv -- the same library Node calls -- so Node's semantics are inherited
 * rather than reimplemented and then tested for. Node's own `src/node_file.cc`
 * is the reference; what it spends on `v8::Local`, `Environment*` and
 * `FunctionCallbackInfo` is what these functions spend on `NtsString`. */
#ifndef NTS_NODE_H
#define NTS_NODE_H
#include "nts_runtime.h"

/* process */
NtsString *nts_process_cwd(void);
NtsString *nts_process_env(NtsString *name);

/* fs */
NtsString *nts_fs_read_text(NtsString *path);
void       nts_fs_write_text(NtsString *path, NtsString *contents);
bool       nts_fs_exists(NtsString *path);
double     nts_fs_size(NtsString *path);
bool       nts_fs_is_dir(NtsString *path);
double     nts_fs_mtime_ms(NtsString *path);
void       nts_fs_unlink(NtsString *path);
double     nts_errno(void);

/* os */
NtsString *nts_os_hostname(void);
NtsString *nts_os_type(void);
NtsString *nts_os_release(void);
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
