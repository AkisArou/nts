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

/* fs */
NtsString *nts_fs_read_text(NtsString *path);
void       nts_fs_write_text(NtsString *path, NtsString *contents);
bool       nts_fs_exists(NtsString *path);
double     nts_fs_size(NtsString *path);
bool       nts_fs_is_dir(NtsString *path);
double     nts_fs_mtime_ms(NtsString *path);
void       nts_fs_unlink(NtsString *path);
double     nts_errno(void);

#endif
