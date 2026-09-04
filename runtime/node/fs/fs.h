/* The native half of `node:fs`.
 *
 * One rule: every function here is a *marshalling* function. The work is done
 * by libuv -- the same library node calls -- so node's semantics are inherited
 * rather than reimplemented and then tested for. What node's own C++ spends on
 * `v8::Local` and `FunctionCallbackInfo`, these spend on `NtsString`.
 *
 * Each declaration here pairs with a `declare function` in this module's
 * TypeScript and a stand-in in its `bindings.node.mjs`. All three live in this
 * directory so the three halves of a binding can be read together. */
#ifndef NTS_NODE_FS_H
#define NTS_NODE_FS_H
#include "nts_runtime.h"

/* fs, sync surface. Errors are libuv's negative errno through `nts_errno`;
 * the TypeScript builds the exception from it. */
NtsArray  *nts_fs_stat(NtsString *path, bool follow);
NtsArray  *nts_fs_fstat(double fd);
double     nts_fs_open(NtsString *path, double flags, double mode);
double     nts_fs_close(double fd);
NtsString *nts_fs_read_file_utf8(NtsString *path);
NtsArray  *nts_fs_read_file_bytes(NtsString *path);
double     nts_fs_write_file_utf8(NtsString *path, NtsString *contents, double flags, double mode);
double     nts_fs_write_file_bytes(NtsString *path, NtsArray *bytes, double flags, double mode);
NtsArray  *nts_fs_readdir(NtsString *path);
NtsArray  *nts_fs_readdir_types(NtsString *path);
double     nts_fs_unlink(NtsString *path);
double     nts_fs_mkdir(NtsString *path, double mode);
double     nts_fs_rmdir(NtsString *path);
double     nts_fs_rename(NtsString *from, NtsString *to);
double     nts_fs_copyfile(NtsString *from, NtsString *to, double flags);
double     nts_fs_access(NtsString *path, double mode);
double     nts_fs_chmod(NtsString *path, double mode);
double     nts_fs_chown(NtsString *path, double uid, double gid);
double     nts_fs_truncate(NtsString *path, double length);
double     nts_fs_utimes(NtsString *path, double atime, double mtime);
double     nts_fs_link(NtsString *from, NtsString *to);
double     nts_fs_symlink(NtsString *target, NtsString *at, double flags);
NtsString *nts_fs_readlink(NtsString *path);
NtsString *nts_fs_realpath(NtsString *path);
NtsString *nts_fs_mkdtemp(NtsString *template_);
double     nts_errno(void);

/* libuv error names */
NtsString *nts_uv_err_name(double code);
NtsString *nts_uv_err_message(double code);

#endif
