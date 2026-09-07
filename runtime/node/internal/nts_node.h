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
NtsArray *nts_process_env_keys(void);
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
                                     NtsString *code,
                                     struct NtsObj_Error *warning);

/* Hand this translation unit the Node-API environment, when there is one.
 *
 * A compiled addon runs inside node, so a process warning belongs on node's
 * `process` rather than on the diagnostic stream -- but reaching it needs an
 * `napi_env`, and nothing in the generated program has one to give. The addon's
 * `NAPI_MODULE_INIT` does, and calling this before `module__init()` is what
 * makes the difference between a warning node's own tests can observe and a
 * line of text on stderr.
 *
 * Declared as `void *` so this header stays usable by a standalone build with
 * no Node-API headers in its include path. Never called there, and the sink
 * falls back to stderr when it is not. */
void nts_napi_set_env(void *env);

/* Enqueue a compiled callback as a microtask. Named apart from the runtime's
 * `nts_enqueue_microtask`, which takes an `NtsTask` rather than a callback --
 * declaring a binding of that name with a callback parameter is what produced
 * the incompatible-pointer clang error in three modules. See `microtask.c`. */
void nts_node_enqueue_microtask(NtsHeader *callback);

#endif
