#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include "nts_node.h"
#include "shared.h"



/* A synchronous `uv_fs_*` call is one with a NULL callback, which is how
 * node's own `SyncCall` runs them. */
static int stat_of(NtsString *path, uv_stat_t *out) {
    char p[4096];
    nts_node_to_utf8(path, p, sizeof p);
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
    nts_node_to_utf8(path, p, sizeof p);
    uv_fs_t req;
    int fd = uv_fs_open(uv_default_loop(), &req, p, O_RDONLY, 0, NULL);
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
        int r = uv_fs_read(uv_default_loop(), &req, fd, &buf, 1, -1, NULL);
        uv_fs_req_cleanup(&req);
        if (r <= 0) {
            nts_node_set_errno(r);
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
    nts_node_to_utf8(path, p, sizeof p);
    size_t cap = (size_t)contents->length * 4 + 1;
    char *data = malloc(cap);
    size_t len = nts_node_to_utf8(contents, data, cap);

    uv_fs_t req;
    int fd = uv_fs_open(uv_default_loop(), &req, p, O_WRONLY | O_CREAT | O_TRUNC, 0666, NULL);
    uv_fs_req_cleanup(&req);
    if (fd < 0) {
        nts_node_set_errno(fd);
        free(data);
        return;
    }
    uv_buf_t buf = uv_buf_init(data, (unsigned)len);
    int r = uv_fs_write(uv_default_loop(), &req, fd, &buf, 1, -1, NULL);
    uv_fs_req_cleanup(&req);
    nts_node_set_errno(r);
    uv_fs_close(uv_default_loop(), &req, fd, NULL);
    uv_fs_req_cleanup(&req);
    free(data);
}

void nts_fs_unlink(NtsString *path) {
    char p[4096];
    nts_node_to_utf8(path, p, sizeof p);
    uv_fs_t req;
    int r = uv_fs_unlink(uv_default_loop(), &req, p, NULL);
    uv_fs_req_cleanup(&req);
    nts_node_set_errno(r);
}
