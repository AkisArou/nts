#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <limits.h>
#include <uv.h>
#include "nts_node.h"
#include "shared.h"

/* Hoisted above its first use: the addon half of this file is guarded on it from
 * `nts_process_cwd` onward, and the probe used to sit below that. */
#if defined(__has_include)
#  if __has_include(<node_api.h>)
#    define NTS_HAVE_NODE_API 1
#  endif
#endif


#ifdef NTS_HAVE_NODE_API
/* Defined in the Node-API section below. True when the host answered, in which
 * case `*answer` is set and `uv_cwd` is not consulted. */
static bool nts_cwd_through_node(NtsString **answer);
#endif

/* Transcribed from node `src/node_process_methods.cc:159` (`Cwd`). */
NtsString *nts_process_cwd(void) {
#ifdef NTS_HAVE_NODE_API
    /* Node's own `lib/path.js` calls `process.cwd()`, so replacing it is
     * observable there -- `test-path-resolve.js:87` relies on exactly that.
     * Ask the host first and fall through to `uv_cwd` whenever it cannot
     * answer, which is every standalone binary. */
    NtsString *hosted = NULL;
    if (nts_cwd_through_node(&hosted)) return hosted;
#endif
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

NtsArray *nts_process_env_keys(void) {
    uv_env_item_t *items = NULL;
    int count = 0;
    int err = uv_os_environ(&items, &count);
    if (err != 0) {
        nts_node_set_errno(err);
        return nts_array_new(&nts_desc_ref, 0);
    }

    NtsArray *names = nts_array_new(&nts_desc_ref, (double)count);
    for (int i = 0; i < count; i++) {
        const char *name = items[i].name;
        NTS_ITEMS(names, void *)[i] =
            nts_string_from_utf8(name, name == NULL ? 0 : strlen(name));
    }
    uv_os_free_environ(items, count);
    nts_node_set_errno(0);
    return names;
}

double nts_process_pid(void) { return (double)uv_os_getpid(); }

NtsString *nts_platform(void) {
#if defined(__ANDROID__)
    return nts_string_from_utf8("android", 7);
#elif defined(__linux__)
    return nts_string_from_utf8("linux", 5);
#elif defined(__APPLE__)
    return nts_string_from_utf8("darwin", 6);
#elif defined(__CYGWIN__)
    return nts_string_from_utf8("cygwin", 6);
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
#elif defined(__HAIKU__)
    return nts_string_from_utf8("haiku", 5);
#elif defined(__NetBSD__)
    return nts_string_from_utf8("netbsd", 6);
#else
#error "unsupported Node platform"
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

#ifdef NTS_HAVE_NODE_API
#include <node_api.h>

/* Set once by the addon's `NAPI_MODULE_INIT`, before the module body runs.
 * Null in a standalone binary, which is the case the stderr sink below is for. */
static napi_env nts_host_env = NULL;

void nts_napi_set_env(void *env) { nts_host_env = (napi_env)env; }

/* `process.cwd()` through the host, so a JS-level replacement is honoured.
 *
 * A compiled addon that calls `uv_cwd` directly cannot see `process.cwd = f`,
 * and `test-path-resolve.js` fails compiled while passing interpreted for that
 * reason alone -- `resolve` itself agrees with node on every input tried.
 *
 * Every failure path returns false and leaves the caller on `uv_cwd`, which is
 * the right answer for a standalone binary and a safe one everywhere else. */
static bool nts_cwd_in_progress = false;

static bool nts_cwd_through_node(NtsString **answer) {
    napi_env env = nts_host_env;
    if (env == NULL) return false;
    /* `runtime/node/process/src/control.ts:68` defines our own `cwd()` as
     * `nts_process_cwd()`. A host whose `process` is that compiled module would
     * loop through here; the second entry falls through to `uv_cwd` instead. */
    if (nts_cwd_in_progress) return false;

    napi_value global, host_process, cwd_fn;
    if (napi_get_global(env, &global) != napi_ok) return false;
    if (napi_get_named_property(env, global, "process", &host_process) != napi_ok) {
        return false;
    }
    napi_valuetype kind;
    if (napi_typeof(env, host_process, &kind) != napi_ok || kind != napi_object) {
        return false;
    }
    if (napi_get_named_property(env, host_process, "cwd", &cwd_fn) != napi_ok) return false;
    if (napi_typeof(env, cwd_fn, &kind) != napi_ok || kind != napi_function) return false;

    nts_cwd_in_progress = true;
    napi_value result;
    napi_status called = napi_call_function(env, host_process, cwd_fn, 0, NULL, &result);
    nts_cwd_in_progress = false;
    /* A throwing `process.cwd` leaves the exception pending for the addon
     * boundary to surface, which is what node does with it. */
    if (called != napi_ok) return false;
    if (napi_typeof(env, result, &kind) != napi_ok || kind != napi_string) return false;

    size_t length = 0;
    if (napi_get_value_string_utf8(env, result, NULL, 0, &length) != napi_ok) return false;
    char *buffer = malloc(length + 1);
    if (buffer == NULL) return false;
    size_t written = 0;
    if (napi_get_value_string_utf8(env, result, buffer, length + 1, &written) != napi_ok) {
        free(buffer);
        return false;
    }
    *answer = nts_string_from_utf8(buffer, written);
    free(buffer);
    nts_node_set_errno(0);
    return true;
}

/* `process.emitWarning(message, name, code)`.
 *
 * Node defers the `'warning'` event to a later tick, which is why a listener
 * registered after the addon loads still sees this -- and why an addon that
 * writes to stderr instead is unobservable to `common.expectWarning`, whatever
 * the text says.
 *
 * Every failure here falls through to the stderr sink rather than being
 * reported: a warning is a diagnostic, and losing one silently would be worse
 * than printing it the old way. */
static bool nts_emit_warning_through_node(const char *message_text,
                                          const char *name_text,
                                          const char *code_text) {
    napi_env env = nts_host_env;
    if (env == NULL) return false;

    napi_value global, process, emit_warning;
    if (napi_get_global(env, &global) != napi_ok) return false;
    if (napi_get_named_property(env, global, "process", &process) != napi_ok) return false;
    napi_valuetype kind;
    if (napi_typeof(env, process, &kind) != napi_ok || kind != napi_object) return false;
    if (napi_get_named_property(env, process, "emitWarning", &emit_warning) != napi_ok) {
        return false;
    }
    if (napi_typeof(env, emit_warning, &kind) != napi_ok || kind != napi_function) return false;

    napi_value args[3];
    if (napi_create_string_utf8(env, message_text, NAPI_AUTO_LENGTH, &args[0]) != napi_ok) {
        return false;
    }
    if (napi_create_string_utf8(env, name_text, NAPI_AUTO_LENGTH, &args[1]) != napi_ok) {
        return false;
    }
    /* The three-argument form is what carries the code. `process.emitWarning
     * (message, name)` leaves `warning.code` undefined, and node's own tests
     * assert the code -- `common.expectWarning(type, message, code)`. */
    size_t argc = 2;
    if (code_text != NULL && code_text[0] != '\0') {
        if (napi_create_string_utf8(env, code_text, NAPI_AUTO_LENGTH, &args[2]) != napi_ok) {
            return false;
        }
        argc = 3;
    }

    napi_value ignored;
    return napi_call_function(env, process, emit_warning, argc, args, &ignored) == napi_ok;
}
#else
void nts_napi_set_env(void *env) { (void)env; }
#endif

/* The warning sink for a program that does not include the `node:process`
 * compatibility module. When that module is present it installs the typed
 * TypeScript handler in `internal/process-warning.ts`, so the exact Error
 * object is emitted there and this function is not reached.
 *
 * A compiled addon *always* reaches it -- `node:process` is not in its program
 * -- and an addon is running inside node, where a warning belongs on
 * `process` rather than on the diagnostic stream. So this tries node first and
 * writes to stderr only when there is no host to hand it to, which is the
 * standalone case the stderr path was written for.
 *
 * `warning` is kept in the ABI because the Node host stand-in forwards that
 * exact object; neither path here has an object receiver, so the already
 * extracted name, message and code are what get used. */
void nts_process_emit_warning_object(NtsString *message, NtsString *name,
                                     NtsString *code, NtsHeader *warning) {
    (void)warning;
    char *message_text = native_string(message);
    char *name_text = native_string(name);
    char *code_text = native_string(code);
    if (message_text == NULL || name_text == NULL) {
        fputs("Warning: unable to allocate warning text\n", stderr);
    } else {
#ifdef NTS_HAVE_NODE_API
        if (!nts_emit_warning_through_node(message_text, name_text, code_text))
#endif
        {
            fprintf(stderr, "(node:%d) %s: %s\n", (int)uv_os_getpid(), name_text,
                    message_text);
        }
    }
    free(message_text);
    free(name_text);
    free(code_text);
}
