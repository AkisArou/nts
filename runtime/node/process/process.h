#ifndef NTS_NODE_PROCESS_H
#define NTS_NODE_PROCESS_H

#include "nts_runtime.h"

/* Identity and build target. */
double nts_process_ppid(void);
NtsString *nts_process_arch(void);
NtsArray *nts_process_argv(void);
NtsString *nts_process_argv0(void);
NtsString *nts_process_exec_path(void);
NtsArray *nts_process_exec_argv(void);
NtsString *nts_process_version(void);
NtsArray *nts_process_version_names(void);
NtsArray *nts_process_version_values(void);
NtsArray *nts_process_allowed_env_flags(void);
NtsString *nts_process_metadata(NtsString *name);
NtsString *nts_process_title(void);
void nts_process_set_title(NtsString *title);

/* Direct process and credential operations. */
double nts_process_chdir(NtsString *directory);
double nts_process_umask(double mask);
double nts_process_umask_read(void);
double nts_process_kill(double pid, double signal_number);
void nts_process_abort(void);
double nts_process_getuid(void);
double nts_process_getgid(void);
double nts_process_geteuid(void);
double nts_process_getegid(void);
NtsArray *nts_process_getgroups(void);
double nts_process_setuid(double id, NtsString *name);
double nts_process_setgid(double id, NtsString *name);
double nts_process_seteuid(double id, NtsString *name);
double nts_process_setegid(double id, NtsString *name);
double nts_process_setgroups(NtsArray *ids, NtsArray *names);

/* Process accounting. */
double nts_process_uptime(void);
NtsArray *nts_process_cpu_usage(void);
NtsArray *nts_process_thread_cpu_usage(void);
NtsArray *nts_process_memory_usage(void);
double nts_process_rss(void);
NtsArray *nts_process_resource_usage(void);
double nts_process_available_memory(void);
double nts_process_constrained_memory(void);
void nts_process_raw_debug(NtsString *message);
void nts_process_execve(NtsString *path, NtsArray *arguments,
                        NtsArray *environment);
double nts_process_load_env_file(NtsString *path);

/** Names present in the host process environment. */
NtsArray *nts_process_env_keys(void);

/**
 * `initgroups(3)` with the numeric/string distinction preserved in two
 * columns. Returns 1 for an unknown user, 2 for an unknown group, or a
 * negative errno for a system-call failure.
 */
double nts_process_initgroups(double user_id, NtsString *user_name,
                              double group_id, NtsString *group_name);

#endif
