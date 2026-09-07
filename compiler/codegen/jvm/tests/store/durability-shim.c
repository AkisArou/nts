/* Observes the syscalls a durable commit makes, by standing in front of libc.
 *
 * The store promises that a committed value survives a power cut, and that
 * needs two syncs rather than one: the file's own, so the bytes are on the
 * disk, and the containing *directory*'s, so the rename that published them is
 * too. Doing only the first leaves a committed value losable while still never
 * leaving a partial one -- a failure invisible to every test that does not cut
 * power.
 *
 * This does not cut power. It reports that the calls are made, and in which
 * order, which is the part that can be checked without a power supply. Paths
 * are filtered by the marker in `NTS_SHIM_MARK` so the JVM's own thousands of
 * file operations do not drown the four that matter. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void namefd(int fd, char *out, size_t n) {
    char link[64];
    snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
    ssize_t got = readlink(link, out, n - 1);
    out[got > 0 ? got : 0] = '\0';
}

static int interesting(const char *path) {
    const char *mark = getenv("NTS_SHIM_MARK");
    return mark && path && strstr(path, mark) != NULL;
}

int fsync(int fd) {
    static int (*real)(int);
    if (!real) real = dlsym(RTLD_NEXT, "fsync");
    char path[PATH_MAX];
    namefd(fd, path, sizeof path);
    if (interesting(path)) fprintf(stderr, "SHIM fsync %s\n", path);
    return real(fd);
}

int fdatasync(int fd) {
    static int (*real)(int);
    if (!real) real = dlsym(RTLD_NEXT, "fdatasync");
    char path[PATH_MAX];
    namefd(fd, path, sizeof path);
    if (interesting(path)) fprintf(stderr, "SHIM fsync %s\n", path);
    return real(fd);
}

int rename(const char *from, const char *to) {
    static int (*real)(const char *, const char *);
    if (!real) real = dlsym(RTLD_NEXT, "rename");
    if (interesting(from)) fprintf(stderr, "SHIM rename %s\n", from);
    return real(from, to);
}

int renameat(int fdf, const char *from, int fdt, const char *to) {
    static int (*real)(int, const char *, int, const char *);
    if (!real) real = dlsym(RTLD_NEXT, "renameat");
    if (interesting(from)) fprintf(stderr, "SHIM rename %s\n", from);
    return real(fdf, from, fdt, to);
}
