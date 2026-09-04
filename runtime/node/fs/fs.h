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
NtsArray *nts_fs_stat(NtsString *path, bool follow);
NtsArray *nts_fs_stat_bytes(NtsArray *path, bool follow);
NtsArray *nts_fs_stat_bigint(NtsString *path, bool follow);
NtsArray *nts_fs_stat_bigint_bytes(NtsArray *path, bool follow);
NtsArray *nts_fs_fstat(double fd);
NtsArray *nts_fs_fstat_bigint(double fd);
NtsArray *nts_fs_statfs(NtsString *path);
NtsArray *nts_fs_statfs_bytes(NtsArray *path);
NtsArray *nts_fs_statfs_bigint(NtsString *path);
NtsArray *nts_fs_statfs_bigint_bytes(NtsArray *path);
double nts_fs_open(NtsString *path, double flags, double mode);
double nts_fs_open_bytes(NtsArray *path, double flags, double mode);
double nts_fs_close(double fd);
NtsArray *nts_fs_read_file_bytes_fd(double fd);
double nts_fs_write_file_utf8(NtsString *path, NtsString *contents,
                              double flags, double mode, bool flush);
double nts_fs_write_file_bytes(NtsString *path, NtsArray *bytes, double flags,
                               double mode, bool flush);
double nts_fs_write_file_bytes_fd(double fd, NtsArray *bytes, bool flush);
NtsArray *nts_fs_read(double fd, double length, double position);
NtsArray *nts_fs_read_bigint(double fd, double length, __int128 position);
double nts_fs_write(double fd, NtsArray *bytes, double position);
NtsArray *nts_fs_readv(double fd, NtsArray *lengths, double position);
double nts_fs_writev(double fd, NtsArray *bytes, NtsArray *lengths,
                     double position);
double nts_fs_fsync(double fd);
double nts_fs_fdatasync(double fd);
double nts_fs_ftruncate(double fd, double length);
double nts_fs_fchmod(double fd, double mode);
double nts_fs_fchown(double fd, double uid, double gid);
double nts_fs_futimes(double fd, double atime, double mtime);
double nts_fs_lutimes(NtsString *path, double atime, double mtime);
NtsArray *nts_fs_scandir(NtsString *path);
NtsArray *nts_fs_scandir_bytes(NtsArray *path);
double nts_fs_opendir(NtsString *path);
double nts_fs_opendir_bytes(NtsArray *path);
NtsArray *nts_fs_dir_read(double identifier, double buffer_size);
double nts_fs_dir_close(double identifier);
double nts_fs_unlink(NtsString *path);
double nts_fs_mkdir(NtsString *path, double mode);
double nts_fs_rmdir(NtsString *path);
double nts_fs_rename(NtsString *from, NtsString *to);
double nts_fs_copyfile(NtsString *from, NtsString *to, double flags);
double nts_fs_access(NtsString *path, double mode);
double nts_fs_access_bytes(NtsArray *path, double mode);
double nts_fs_chmod(NtsString *path, double mode);
double nts_fs_chown(NtsString *path, double uid, double gid);
double nts_fs_lchown(NtsString *path, double uid, double gid);
double nts_fs_lchown_bytes(NtsArray *path, double uid, double gid);
double nts_fs_utimes(NtsString *path, double atime, double mtime);
double nts_fs_link(NtsString *from, NtsString *to);
double nts_fs_symlink(NtsString *target, NtsString *at, double flags);
double nts_fs_symlink_bytes(NtsArray *target, NtsArray *at, double flags);
NtsString *nts_fs_readlink(NtsString *path);
NtsString *nts_fs_realpath(NtsString *path);
NtsArray *nts_fs_realpath_bytes(NtsArray *path);
NtsString *nts_fs_mkdtemp(NtsString *template_);
NtsArray *nts_fs_mkdtemp_bytes(NtsArray *template_);
double nts_fs_o_creat(void);
double nts_fs_o_excl(void);
double nts_fs_o_trunc(void);
double nts_fs_o_append(void);
double nts_fs_o_sync(void);
bool nts_fs_binding_warns_on_mkdtemp(void);
double nts_fs_eisdir(void);
double nts_errno(void);

/* libuv error names */
NtsString *nts_uv_err_name(double code);
NtsString *nts_uv_err_message(double code);

#endif
