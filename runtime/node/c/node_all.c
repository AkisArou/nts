#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include "nts_node.h"

/* libuv returns -errno on failure. Node turns that into an `ERR_*` code
 * through `uv_err_name`; the TypeScript above does the same mapping from the
 * number, so this only has to carry it across. */
static int last_errno = 0;
double nts_errno(void) { return (double)last_errno; }

/* `NtsString` is UTF-16 code units. Paths cross as UTF-8, which is what every
 * `uv_fs_*` call takes. */
static size_t to_utf8(const NtsString *s, char *buf, size_t cap) {
    size_t n = 0;
    for (uint32_t i = 0; i < s->length && n + 4 < cap; i++) {
        uint16_t u = nts_unit(s, i);
        if (u < 0x80) {
            buf[n++] = (char)u;
        } else if (u < 0x800) {
            buf[n++] = (char)(0xC0 | (u >> 6));
            buf[n++] = (char)(0x80 | (u & 0x3F));
        } else {
            buf[n++] = (char)(0xE0 | (u >> 12));
            buf[n++] = (char)(0x80 | ((u >> 6) & 0x3F));
            buf[n++] = (char)(0x80 | (u & 0x3F));
        }
    }
    buf[n] = 0;
    return n;
}

/* Transcribed from node `src/node_process_methods.cc:159` (`Cwd`). */
NtsString *nts_process_cwd(void) {
    char buf[4096];
    size_t len = sizeof(buf);
    int err = uv_cwd(buf, &len);
    if (err != 0) {
        last_errno = -err;
        return nts_string_from_utf8("", 0);
    }
    last_errno = 0;
    return nts_string_from_utf8(buf, len);
}

/* A synchronous `uv_fs_*` call is one with a NULL callback, which is how
 * node's own `SyncCall` runs them. */
static int stat_of(NtsString *path, uv_stat_t *out) {
    char p[4096];
    to_utf8(path, p, sizeof p);
    uv_fs_t req;
    int r = uv_fs_stat(uv_default_loop(), &req, p, NULL);
    if (r == 0) {
        *out = req.statbuf;
    }
    uv_fs_req_cleanup(&req);
    return r;
}

bool nts_fs_exists(NtsString *path) {
    uv_stat_t st;
    return stat_of(path, &st) == 0;
}

double nts_fs_size(NtsString *path) {
    uv_stat_t st;
    if (stat_of(path, &st) != 0) return -1.0;
    return (double)st.st_size;
}

bool nts_fs_is_dir(NtsString *path) {
    uv_stat_t st;
    if (stat_of(path, &st) != 0) return false;
    return (st.st_mode & S_IFMT) == S_IFDIR;
}

double nts_fs_mtime_ms(NtsString *path) {
    uv_stat_t st;
    if (stat_of(path, &st) != 0) return -1.0;
    return (double)st.st_mtim.tv_sec * 1000.0 + (double)st.st_mtim.tv_nsec / 1.0e6;
}

NtsString *nts_fs_read_text(NtsString *path) {
    char p[4096];
    to_utf8(path, p, sizeof p);
    uv_fs_t req;
    int fd = uv_fs_open(uv_default_loop(), &req, p, O_RDONLY, 0, NULL);
    uv_fs_req_cleanup(&req);
    if (fd < 0) {
        last_errno = -fd;
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
        int r = uv_fs_read(uv_default_loop(), &req, fd, &buf, 1, -1, NULL);
        uv_fs_req_cleanup(&req);
        if (r <= 0) {
            if (r < 0) last_errno = -r;
            break;
        }
        len += (size_t)r;
    }
    uv_fs_close(uv_default_loop(), &req, fd, NULL);
    uv_fs_req_cleanup(&req);

    NtsString *s = nts_string_from_utf8(data, len);
    free(data);
    return s;
}

void nts_fs_write_text(NtsString *path, NtsString *contents) {
    char p[4096];
    to_utf8(path, p, sizeof p);
    size_t cap = (size_t)contents->length * 4 + 1;
    char *data = malloc(cap);
    size_t len = to_utf8(contents, data, cap);

    uv_fs_t req;
    int fd = uv_fs_open(uv_default_loop(), &req, p, O_WRONLY | O_CREAT | O_TRUNC, 0666, NULL);
    uv_fs_req_cleanup(&req);
    if (fd < 0) {
        last_errno = -fd;
        free(data);
        return;
    }
    uv_buf_t buf = uv_buf_init(data, (unsigned)len);
    int r = uv_fs_write(uv_default_loop(), &req, fd, &buf, 1, -1, NULL);
    uv_fs_req_cleanup(&req);
    last_errno = r < 0 ? -r : 0;
    uv_fs_close(uv_default_loop(), &req, fd, NULL);
    uv_fs_req_cleanup(&req);
    free(data);
}

void nts_fs_unlink(NtsString *path) {
    char p[4096];
    to_utf8(path, p, sizeof p);
    uv_fs_t req;
    int r = uv_fs_unlink(uv_default_loop(), &req, p, NULL);
    uv_fs_req_cleanup(&req);
    last_errno = r < 0 ? -r : 0;
}
