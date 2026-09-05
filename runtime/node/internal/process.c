#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <limits.h>
#include <uv.h>
#include "nts_node.h"
#include "shared.h"

/* Transcribed from node `src/node_process_methods.cc:159` (`Cwd`). */
NtsString *nts_process_cwd(void) {
    size_t capacity = 256;
    for (;;) {
        char *buffer = malloc(capacity);
        if (buffer == NULL) {
            nts_node_set_errno(UV_ENOMEM);
            return nts_string_from_utf8("", 0);
        }
        size_t length = capacity;
        int result = uv_cwd(buffer, &length);
        if (result == UV_ENOBUFS) {
            free(buffer);
            capacity *= 2;
            continue;
        }
        nts_node_set_errno(result);
        NtsString *answer = result == 0
                                ? nts_string_from_utf8(buffer, length)
                                : nts_string_from_utf8("", 0);
        free(buffer);
        return answer;
    }
}

static char *native_string(const NtsString *value) {
    return nts_node_to_utf8_alloc(value, NULL);
}

/* `process.env[name]`, empty when unset. `win32.resolve` reads `=C:` to find a
 * drive-relative working directory; on a posix host there is none, and the
 * empty answer is what upstream's `||` falls through on. */
NtsString *nts_process_env(NtsString *name) {
    char *key = native_string(name);
    if (key == NULL) return nts_string_from_utf8("", 0);

    size_t capacity = 256;
    for (;;) {
        char *value = malloc(capacity);
        if (value == NULL) {
            free(key);
            return nts_string_from_utf8("", 0);
        }
        size_t length = capacity;
        int result = uv_os_getenv(key, value, &length);
        if (result == UV_ENOBUFS) {
            free(value);
            capacity = length > capacity ? length : capacity * 2;
            continue;
        }
        free(key);
        NtsString *answer = result == 0
                                ? nts_string_from_utf8(value, length)
                                : nts_string_from_utf8("", 0);
        free(value);
        return answer;
    }
}

bool nts_process_env_has(NtsString *name) {
    char *key = native_string(name);
    if (key == NULL) return false;
    char value[1];
    size_t len = sizeof(value);
    int err = uv_os_getenv(key, value, &len);
    free(key);
    return err == 0 || err == UV_ENOBUFS;
}

double nts_process_pid(void) { return (double)uv_os_getpid(); }

NtsString *nts_platform(void) {
#if defined(__linux__)
    return nts_string_from_utf8("linux", 5);
#elif defined(__APPLE__)
    return nts_string_from_utf8("darwin", 6);
#elif defined(_WIN32)
    return nts_string_from_utf8("win32", 5);
#elif defined(__FreeBSD__)
    return nts_string_from_utf8("freebsd", 7);
#elif defined(__OpenBSD__)
    return nts_string_from_utf8("openbsd", 7);
#elif defined(__sun)
    return nts_string_from_utf8("sunos", 5);
#elif defined(_AIX)
    return nts_string_from_utf8("aix", 3);
#else
    return nts_string_from_utf8("unknown", 7);
#endif
}

NtsString *nts_os_release(void) {
    uv_utsname_t name;
    int result = uv_os_uname(&name);
    return result == 0
               ? nts_string_from_utf8(name.release, strlen(name.release))
               : nts_string_from_utf8("", 0);
}

__int128 nts_hrtime_ns(void) { return (__int128)uv_hrtime(); }

/* A synchronous standard-stream write. The TypeScript stream reports a
 * negative libuv result through its callback and `error` event. Loop because a
 * pipe or file is allowed to accept only part of a buffer, and preserve the
 * byte length so an embedded NUL in a JavaScript string is not a terminator. */
static double write_to_descriptor(uv_file descriptor, NtsString *value) {
    size_t length = 0;
    char *bytes = nts_node_to_utf8_alloc(value, &length);
    if (bytes == NULL) return (double)UV_ENOMEM;

    size_t offset = 0;
    int error = 0;
    while (offset < length) {
        size_t remaining = length - offset;
        unsigned int size = remaining > UINT_MAX
                                ? UINT_MAX
                                : (unsigned int)remaining;
        uv_buf_t buffer = uv_buf_init(bytes + offset, size);
        uv_fs_t request;
        int written = uv_fs_write(NULL, &request, descriptor, &buffer, 1, -1,
                                  NULL);
        uv_fs_req_cleanup(&request);
        if (written < 0) {
            error = written;
            break;
        }
        if (written == 0) {
            error = UV_EIO;
            break;
        }
        offset += (size_t)written;
    }

    free(bytes);
    return (double)error;
}

double nts_write_stdout(NtsString *text) {
    return write_to_descriptor(1, text);
}

double nts_write_stderr(NtsString *text) {
    return write_to_descriptor(2, text);
}

double nts_debug_write(NtsString *text) {
    return write_to_descriptor(2, text);
}

bool nts_stdout_is_tty(void) { return uv_guess_handle(1) == UV_TTY; }

bool nts_stderr_is_tty(void) { return uv_guess_handle(2) == UV_TTY; }

void nts_process_really_exit(double code) { _Exit((int)code); }

/* The fallback warning sink for a native program that does not include the
 * `node:process` compatibility module. When that module is present it installs
 * the typed TypeScript handler in `internal/process-warning.ts`, so the exact
 * Error object is emitted there and this function is not reached.
 *
 * `warning` is kept in the ABI because the Node host stand-in forwards that
 * exact object. A native diagnostic stream has no object receiver, so only its
 * already-extracted name and message are written here. */
void nts_process_emit_warning_object(NtsString *message, NtsString *name,
                                     void *warning) {
    (void)warning;
    char *message_text = native_string(message);
    char *name_text = native_string(name);
    if (message_text == NULL || name_text == NULL) {
        fputs("Warning: unable to allocate warning text\n", stderr);
    } else {
        fprintf(stderr, "(node:%d) %s: %s\n", (int)uv_os_getpid(), name_text,
                message_text);
    }
    free(message_text);
    free(name_text);
}
