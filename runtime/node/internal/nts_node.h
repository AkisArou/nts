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

#endif
