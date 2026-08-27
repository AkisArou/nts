/* The native half of `node:fs`, sync surface.
 *
 * Every function is one `uv_fs_*` call with a NULL callback, which is how
 * node's own `SyncCall` runs them, plus the conversion between `NtsString` and
 * the UTF-8 libuv takes. Node's `src/node_file.cc` is the same shape with
 * `v8::Local` where these have `NtsString`.
 *
 * Errors are reported as libuv's negative errno through `nts_errno`, and the
 * TypeScript builds the exception. Keeping the message construction upstairs
 * means there is one copy of it and it is the one node's tests read. */
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include "nts_node.h"
#include "shared.h"

/* One loop for the synchronous calls. libuv wants one even when the callback
 * is NULL and the work happens inline. */
static uv_loop_t *loop(void) { return uv_default_loop(); }

#define PATH_OF(s, buf) char buf[4096]; nts_node_to_utf8((s), buf, sizeof buf)

/* A call whose only result is success or failure. */
static double simple(int result) {
    nts_node_set_errno(result);
    return (double)result;
}

/* ------------------------------------------------------------------ stat */

/* `uv_stat_t` as fourteen doubles, in the order `Stats` reads them. One
 * binding answers `stat`, `lstat` and `fstat`: the difference is which libuv
 * call fills the buffer, not what comes back. */
static NtsArray *stat_columns(const uv_stat_t *st) {
    NtsArray *a = nts_array_new(&nts_desc_double, 14);
    double *v = NTS_ITEMS(a, double);
    v[0] = (double)st->st_dev;
    v[1] = (double)st->st_mode;
    v[2] = (double)st->st_nlink;
    v[3] = (double)st->st_uid;
    v[4] = (double)st->st_gid;
    v[5] = (double)st->st_rdev;
    v[6] = (double)st->st_blksize;
    v[7] = (double)st->st_ino;
    v[8] = (double)st->st_size;
    v[9] = (double)st->st_blocks;
    /* Milliseconds, which is what `Stats.atimeMs` is. */
    v[10] = (double)st->st_atim.tv_sec * 1000.0 + (double)st->st_atim.tv_nsec / 1.0e6;
    v[11] = (double)st->st_mtim.tv_sec * 1000.0 + (double)st->st_mtim.tv_nsec / 1.0e6;
    v[12] = (double)st->st_ctim.tv_sec * 1000.0 + (double)st->st_ctim.tv_nsec / 1.0e6;
    v[13] = (double)st->st_birthtim.tv_sec * 1000.0 + (double)st->st_birthtim.tv_nsec / 1.0e6;
    return a;
}

static NtsArray *empty_doubles(void) { return nts_array_new(&nts_desc_double, 0); }

NtsArray *nts_fs_stat(NtsString *path, bool follow) {
    PATH_OF(path, p);
    uv_fs_t req;
    int r = follow ? uv_fs_stat(loop(), &req, p, NULL)
                   : uv_fs_lstat(loop(), &req, p, NULL);
    nts_node_set_errno(r);
    NtsArray *out = r == 0 ? stat_columns(&req.statbuf) : empty_doubles();
    uv_fs_req_cleanup(&req);
    return out;
}

NtsArray *nts_fs_fstat(double fd) {
    uv_fs_t req;
    int r = uv_fs_fstat(loop(), &req, (uv_file)fd, NULL);
    nts_node_set_errno(r);
    NtsArray *out = r == 0 ? stat_columns(&req.statbuf) : empty_doubles();
    uv_fs_req_cleanup(&req);
    return out;
}

/* ---------------------------------------------------------- open and read */

double nts_fs_open(NtsString *path, double flags, double mode) {
    PATH_OF(path, p);
    uv_fs_t req;
    int fd = uv_fs_open(loop(), &req, p, (int)flags, (int)mode, NULL);
    uv_fs_req_cleanup(&req);
    nts_node_set_errno(fd);
    return (double)fd;
}

double nts_fs_close(double fd) {
    uv_fs_t req;
    int r = uv_fs_close(loop(), &req, (uv_file)fd, NULL);
    uv_fs_req_cleanup(&req);
    return simple(r);
}

/* The whole file as a string. Node reads into a `Buffer` and decodes; until
 * `node:buffer` exists the decode happens here, and the TypeScript asks for a
 * string. What that costs is the `Buffer`-returning form of `readFileSync`,
 * not its correctness for an encoding. */
NtsString *nts_fs_read_file_utf8(NtsString *path) {
    PATH_OF(path, p);
    uv_fs_t req;
    int fd = uv_fs_open(loop(), &req, p, O_RDONLY, 0, NULL);
    uv_fs_req_cleanup(&req);
    if (fd < 0) {
        nts_node_set_errno(fd);
        return nts_string_from_utf8("", 0);
    }

    size_t cap = 65536, len = 0;
    char *data = malloc(cap);
    for (;;) {
        if (len == cap) {
            cap *= 2;
            data = realloc(data, cap);
        }
        uv_buf_t buf = uv_buf_init(data + len, (unsigned)(cap - len));
        int r = uv_fs_read(loop(), &req, fd, &buf, 1, -1, NULL);
        uv_fs_req_cleanup(&req);
        if (r < 0) {
            nts_node_set_errno(r);
            break;
        }
        if (r == 0) {
            nts_node_set_errno(0);
            break;
        }
        len += (size_t)r;
    }
    uv_fs_close(loop(), &req, fd, NULL);
    uv_fs_req_cleanup(&req);

    NtsString *s = nts_string_from_utf8(data, len);
    free(data);
    return s;
}

double nts_fs_write_file_utf8(NtsString *path, NtsString *contents, double flags, double mode) {
    PATH_OF(path, p);
    size_t cap = (size_t)contents->length * 4 + 1;
    char *data = malloc(cap);
    size_t len = nts_node_to_utf8(contents, data, cap);

    uv_fs_t req;
    int fd = uv_fs_open(loop(), &req, p, (int)flags, (int)mode, NULL);
    uv_fs_req_cleanup(&req);
    if (fd < 0) {
        free(data);
        nts_node_set_errno(fd);
        return (double)fd;
    }

    size_t written = 0;
    int r = 0;
    while (written < len) {
        uv_buf_t buf = uv_buf_init(data + written, (unsigned)(len - written));
        r = uv_fs_write(loop(), &req, fd, &buf, 1, -1, NULL);
        uv_fs_req_cleanup(&req);
        if (r < 0) break;
        written += (size_t)r;
    }
    uv_fs_close(loop(), &req, fd, NULL);
    uv_fs_req_cleanup(&req);
    free(data);
    return simple(r < 0 ? r : 0);
}

/* ---------------------------------------------------------------- entries */

NtsArray *nts_fs_readdir(NtsString *path) {
    PATH_OF(path, p);
    uv_fs_t req;
    int count = uv_fs_scandir(loop(), &req, p, 0, NULL);
    nts_node_set_errno(count);
    if (count < 0) {
        uv_fs_req_cleanup(&req);
        return nts_array_new(&nts_desc_ref, 0);
    }
    NtsArray *a = nts_array_new(&nts_desc_ref, (double)count);
    uv_dirent_t entry;
    int i = 0;
    while (uv_fs_scandir_next(&req, &entry) != UV_EOF && i < count) {
        NTS_ITEMS(a, void *)[i++] = nts_string_from_utf8(entry.name, strlen(entry.name));
    }
    uv_fs_req_cleanup(&req);
    return a;
}

/* `withFileTypes` needs the kind of each entry beside its name. libuv reports
 * it during the same scan, so a second call would be both slower and capable
 * of disagreeing with the first. */
NtsArray *nts_fs_readdir_types(NtsString *path) {
    PATH_OF(path, p);
    uv_fs_t req;
    int count = uv_fs_scandir(loop(), &req, p, 0, NULL);
    nts_node_set_errno(count);
    if (count < 0) {
        uv_fs_req_cleanup(&req);
        return empty_doubles();
    }
    NtsArray *a = nts_array_new(&nts_desc_double, (double)count);
    uv_dirent_t entry;
    int i = 0;
    while (uv_fs_scandir_next(&req, &entry) != UV_EOF && i < count) {
        NTS_ITEMS(a, double)[i++] = (double)entry.type;
    }
    uv_fs_req_cleanup(&req);
    return a;
}

/* ------------------------------------------------------------ one-liners */

double nts_fs_unlink(NtsString *path) {
    PATH_OF(path, p);
    uv_fs_t req;
    double r = simple(uv_fs_unlink(loop(), &req, p, NULL));
    uv_fs_req_cleanup(&req);
    return r;
}

double nts_fs_mkdir(NtsString *path, double mode) {
    PATH_OF(path, p);
    uv_fs_t req;
    double r = simple(uv_fs_mkdir(loop(), &req, p, (int)mode, NULL));
    uv_fs_req_cleanup(&req);
    return r;
}

double nts_fs_rmdir(NtsString *path) {
    PATH_OF(path, p);
    uv_fs_t req;
    double r = simple(uv_fs_rmdir(loop(), &req, p, NULL));
    uv_fs_req_cleanup(&req);
    return r;
}

double nts_fs_rename(NtsString *from, NtsString *to) {
    PATH_OF(from, a);
    PATH_OF(to, b);
    uv_fs_t req;
    double r = simple(uv_fs_rename(loop(), &req, a, b, NULL));
    uv_fs_req_cleanup(&req);
    return r;
}

double nts_fs_copyfile(NtsString *from, NtsString *to, double flags) {
    PATH_OF(from, a);
    PATH_OF(to, b);
    uv_fs_t req;
    double r = simple(uv_fs_copyfile(loop(), &req, a, b, (int)flags, NULL));
    uv_fs_req_cleanup(&req);
    return r;
}

double nts_fs_access(NtsString *path, double mode) {
    PATH_OF(path, p);
    uv_fs_t req;
    double r = simple(uv_fs_access(loop(), &req, p, (int)mode, NULL));
    uv_fs_req_cleanup(&req);
    return r;
}

double nts_fs_chmod(NtsString *path, double mode) {
    PATH_OF(path, p);
    uv_fs_t req;
    double r = simple(uv_fs_chmod(loop(), &req, p, (int)mode, NULL));
    uv_fs_req_cleanup(&req);
    return r;
}

double nts_fs_chown(NtsString *path, double uid, double gid) {
    PATH_OF(path, p);
    uv_fs_t req;
    double r = simple(uv_fs_chown(loop(), &req, p, (uv_uid_t)uid, (uv_gid_t)gid, NULL));
    uv_fs_req_cleanup(&req);
    return r;
}

double nts_fs_truncate(NtsString *path, double length) {
    PATH_OF(path, p);
    uv_fs_t req;
    int fd = uv_fs_open(loop(), &req, p, O_RDWR, 0, NULL);
    uv_fs_req_cleanup(&req);
    if (fd < 0) return simple(fd);
    int r = uv_fs_ftruncate(loop(), &req, fd, (int64_t)length, NULL);
    uv_fs_req_cleanup(&req);
    uv_fs_close(loop(), &req, fd, NULL);
    uv_fs_req_cleanup(&req);
    return simple(r);
}

double nts_fs_utimes(NtsString *path, double atime, double mtime) {
    PATH_OF(path, p);
    uv_fs_t req;
    double r = simple(uv_fs_utime(loop(), &req, p, atime, mtime, NULL));
    uv_fs_req_cleanup(&req);
    return r;
}

double nts_fs_link(NtsString *from, NtsString *to) {
    PATH_OF(from, a);
    PATH_OF(to, b);
    uv_fs_t req;
    double r = simple(uv_fs_link(loop(), &req, a, b, NULL));
    uv_fs_req_cleanup(&req);
    return r;
}

double nts_fs_symlink(NtsString *target, NtsString *at, double flags) {
    PATH_OF(target, a);
    PATH_OF(at, b);
    uv_fs_t req;
    double r = simple(uv_fs_symlink(loop(), &req, a, b, (int)flags, NULL));
    uv_fs_req_cleanup(&req);
    return r;
}

NtsString *nts_fs_readlink(NtsString *path) {
    PATH_OF(path, p);
    uv_fs_t req;
    int r = uv_fs_readlink(loop(), &req, p, NULL);
    nts_node_set_errno(r);
    NtsString *out = r == 0 ? nts_string_from_utf8((const char *)req.ptr, strlen((const char *)req.ptr))
                            : nts_string_from_utf8("", 0);
    uv_fs_req_cleanup(&req);
    return out;
}

NtsString *nts_fs_realpath(NtsString *path) {
    PATH_OF(path, p);
    uv_fs_t req;
    int r = uv_fs_realpath(loop(), &req, p, NULL);
    nts_node_set_errno(r);
    NtsString *out = r == 0 ? nts_string_from_utf8((const char *)req.ptr, strlen((const char *)req.ptr))
                            : nts_string_from_utf8("", 0);
    uv_fs_req_cleanup(&req);
    return out;
}

NtsString *nts_fs_mkdtemp(NtsString *template_) {
    PATH_OF(template_, p);
    uv_fs_t req;
    int r = uv_fs_mkdtemp(loop(), &req, p, NULL);
    nts_node_set_errno(r);
    NtsString *out = r == 0 ? nts_string_from_utf8(req.path, strlen(req.path))
                            : nts_string_from_utf8("", 0);
    uv_fs_req_cleanup(&req);
    return out;
}
