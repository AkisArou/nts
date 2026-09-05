/* The bindings more than one module needs.
 *
 * `internal/` holds what is shared, in both languages: the TypeScript every
 * module imports and the C every module links. A binding lands here when a
 * second module declares it -- `nts_process_env` is read by `console`,
 * `path` and `util`, so it is not `path`'s to own. When `node:process`
 * exists these move into it. */
#ifndef NTS_NODE_INTERNAL_H
#define NTS_NODE_INTERNAL_H
#include "nts_runtime.h"

/* process */
NtsString *nts_process_cwd(void);
NtsString *nts_process_env(NtsString *name);
bool nts_process_env_has(NtsString *name);
double nts_process_pid(void);
NtsString *nts_platform(void);
NtsString *nts_os_release(void);
__int128 nts_hrtime_ns(void);
double nts_write_stdout(NtsString *text);
double nts_write_stderr(NtsString *text);
double nts_debug_write(NtsString *text);
bool nts_stdout_is_tty(void);
bool nts_stderr_is_tty(void);
void nts_process_really_exit(double code);
struct NtsObj_Error;
void nts_process_emit_warning_object(NtsString *message, NtsString *name,
                                     struct NtsObj_Error *warning);

#endif
