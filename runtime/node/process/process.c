/* `initgroups(3)` is a BSD extension exposed by glibc under this feature set. */
#ifndef _DEFAULT_SOURCE
#define _DEFAULT_SOURCE
#endif

/* Native operations specific to `node:process`. */
#include "process.h"

#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <pwd.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <uv.h>

#include "../internal/shared.h"

static char *string_utf8(const NtsString *value);

static NtsString *utf8(const char *text) {
    return nts_string_from_utf8(text, text == NULL ? 0 : strlen(text));
}

static NtsArray *number_array(size_t length) {
    return nts_array_new(&nts_node_desc_double, (double)length);
}

static double system_error(void) {
    return (double)uv_translate_sys_error(errno);
}

/* --------------------------------------------------------------- identity */

double nts_process_ppid(void) { return (double)uv_os_getppid(); }

NtsString *nts_process_arch(void) {
#if defined(__x86_64__)
    return utf8("x64");
#elif defined(__aarch64__)
    return utf8("arm64");
#elif defined(__arm__)
    return utf8("arm");
#elif defined(__i386__)
    return utf8("ia32");
#elif defined(__riscv) && __riscv_xlen == 64
    return utf8("riscv64");
#elif defined(__powerpc64__)
    return utf8("ppc64");
#elif defined(__s390x__)
    return utf8("s390x");
#else
    return utf8("unknown");
#endif
}

#if defined(__linux__)
static char *linux_command_line(size_t *length) {
    FILE *file = fopen("/proc/self/cmdline", "rb");
    if (file == NULL) return NULL;

    size_t capacity = 4096;
    size_t used = 0;
    char *bytes = malloc(capacity);
    if (bytes == NULL) {
        fclose(file);
        return NULL;
    }

    for (;;) {
        if (used == capacity) {
            capacity *= 2;
            char *larger = realloc(bytes, capacity);
            if (larger == NULL) {
                free(bytes);
                fclose(file);
                return NULL;
            }
            bytes = larger;
        }
        size_t received = fread(bytes + used, 1, capacity - used, file);
        used += received;
        if (received == 0) break;
    }
    bool failed = ferror(file) != 0;
    fclose(file);
    if (failed || used == 0) {
        free(bytes);
        return NULL;
    }
    if (bytes[used - 1] != '\0') {
        if (used == capacity) {
            char *larger = realloc(bytes, capacity + 1);
            if (larger == NULL) {
                free(bytes);
                return NULL;
            }
            bytes = larger;
        }
        bytes[used++] = '\0';
    }
    *length = used;
    return bytes;
}

static size_t command_line_count(const char *bytes, size_t length) {
    size_t count = 0;
    for (size_t i = 0; i < length; i++) {
        if (bytes[i] == '\0') count++;
    }
    return count;
}
#endif

NtsArray *nts_process_argv(void) {
#if defined(__linux__)
    size_t length = 0;
    char *bytes = linux_command_line(&length);
    if (bytes == NULL) return nts_array_new(&nts_desc_ref, 0);
    size_t count = command_line_count(bytes, length);
    NtsArray *answer = nts_array_new(&nts_desc_ref, (double)count);
    char *at = bytes;
    for (size_t i = 0; i < count; i++) {
        char *end = memchr(at, '\0', length - (size_t)(at - bytes));
        size_t item_length = end == NULL ? 0 : (size_t)(end - at);
        NTS_ITEMS(answer, void *)[i] =
            i == 0 ? nts_process_exec_path()
                   : nts_string_from_utf8(at, item_length);
        at += item_length + 1;
    }
    free(bytes);
    return answer;
#else
    NtsArray *answer = nts_array_new(&nts_desc_ref, 1);
    NTS_ITEMS(answer, void *)[0] = nts_process_exec_path();
    return answer;
#endif
}

NtsString *nts_process_argv0(void) {
#if defined(__linux__)
    size_t length = 0;
    char *bytes = linux_command_line(&length);
    if (bytes == NULL) return utf8("");
    size_t first_length = strnlen(bytes, length);
    NtsString *answer = nts_string_from_utf8(bytes, first_length);
    free(bytes);
    return answer;
#else
    return nts_process_exec_path();
#endif
}

NtsArray *nts_process_exec_argv(void) {
    // NTS has no engine flags interleaved with application arguments. The
    // compatibility runner also invokes no flags that the compiled program
    // itself consumed, so its faithful list is empty.
    return nts_array_new(&nts_desc_ref, 0);
}

NtsString *nts_process_version(void) { return utf8("v24.20.0"); }

static const char *const VERSION_NAMES[] = {
    "node", "acorn", "ada", "amaro", "ares", "brotli", "cldr", "icu",
    "llhttp", "merve", "modules", "napi", "nbytes", "ncrypto", "nghttp2",
    "nghttp3", "ngtcp2", "openssl", "simdjson", "simdutf", "sqlite", "tz",
    "undici", "unicode", "uv", "uvwasi", "v8", "zlib", "zstd",
};

static const char *const VERSION_VALUES[] = {
    "24.20.0", "8.18.0", "4.0.0", "1.1.11", "1.34.8", "1.2.0", "48.0",
    "78.3", "9.4.3", "1.2.2", "137", "10", "0.1.4", "0.0.1", "1.70.0",
    "", "", "3.5.7", "4.6.6", "6.4.0", "3.53.4", "2026c", "7.29.0",
    "17.0", "1.52.1", "0.0.23", "13.6.233.17-node.53",
    "1.3.2.1-motley-42c2f19", "1.5.7",
};

static const char *const ALLOWED_ENV_FLAGS[] = {
#include "allowed-flags.inc"
};

static NtsArray *constant_strings(const char *const *values, size_t count) {
    NtsArray *answer = nts_array_new(&nts_desc_ref, (double)count);
    for (size_t i = 0; i < count; i++) {
        NTS_ITEMS(answer, void *)[i] = utf8(values[i]);
    }
    return answer;
}

NtsArray *nts_process_version_names(void) {
    return constant_strings(VERSION_NAMES,
                            sizeof(VERSION_NAMES) / sizeof(VERSION_NAMES[0]));
}

NtsArray *nts_process_version_values(void) {
    return constant_strings(VERSION_VALUES,
                            sizeof(VERSION_VALUES) / sizeof(VERSION_VALUES[0]));
}

NtsArray *nts_process_allowed_env_flags(void) {
    return constant_strings(
        ALLOWED_ENV_FLAGS,
        sizeof(ALLOWED_ENV_FLAGS) / sizeof(ALLOWED_ENV_FLAGS[0]));
}

NtsString *nts_process_metadata(NtsString *name) {
    char *key = string_utf8(name);
    if (key == NULL) return utf8("{}");
    const char *json = "{}";
    if (strcmp(key, "release") == 0) {
        json = "{\"name\":\"node\",\"lts\":\"Krypton\"}";
    } else if (strcmp(key, "features") == 0) {
        json = "{\"inspector\":false,\"debug\":false,\"uv\":true,"
               "\"ipv6\":true,\"openssl_is_boringssl\":false,\"quic\":false,"
               "\"tls_alpn\":false,\"tls_sni\":false,\"tls_ocsp\":false,"
               "\"tls\":false,\"cached_builtins\":false,"
               "\"require_module\":false,\"typescript\":\"strip\"}";
    } else if (strcmp(key, "config") == 0) {
        json = "{\"variables\":{\"napi_build_version\":\"10\","
               "\"node_builtin_shareable_builtins\":[],"
               "\"node_use_amaro\":false,\"node_shared_openssl\":false}}";
    }
    free(key);
    return utf8(json);
}

NtsString *nts_process_exec_path(void) {
    size_t capacity = 256;
    for (;;) {
        char *path = malloc(capacity);
        if (path == NULL) return utf8("");
        size_t length = capacity;
        int result = uv_exepath(path, &length);
        if (result == UV_ENOBUFS) {
            free(path);
            capacity *= 2;
            continue;
        }
        nts_node_set_errno(result);
        NtsString *answer = result == 0
                                ? nts_string_from_utf8(path, length)
                                : utf8("");
        free(path);
        return answer;
    }
}

NtsString *nts_process_title(void) {
    char title[512];
    int result = uv_get_process_title(title, sizeof(title));
    nts_node_set_errno(result);
    return result == 0 ? utf8(title) : utf8("");
}

void nts_process_set_title(NtsString *title) {
    char *text = string_utf8(title);
    if (text == NULL) {
        nts_node_set_errno(UV_ENOMEM);
        return;
    }
    nts_node_set_errno(uv_set_process_title(text));
    free(text);
}

/* --------------------------------------------------------- process control */

double nts_process_chdir(NtsString *directory) {
    char *path = string_utf8(directory);
    if (path == NULL) return (double)UV_ENOMEM;
    int result = uv_chdir(path);
    free(path);
    return (double)result;
}

double nts_process_umask(double mask) {
    return (double)umask((mode_t)(uint32_t)mask);
}

double nts_process_umask_read(void) {
    mode_t previous = umask(0);
    (void)umask(previous);
    return (double)previous;
}

double nts_process_kill(double pid, double signal_number) {
    return (double)uv_kill((int)pid, (int)signal_number);
}

void nts_process_abort(void) { abort(); }

double nts_process_getuid(void) { return (double)getuid(); }
double nts_process_getgid(void) { return (double)getgid(); }
double nts_process_geteuid(void) { return (double)geteuid(); }
double nts_process_getegid(void) { return (double)getegid(); }

NtsArray *nts_process_getgroups(void) {
    int count = getgroups(0, NULL);
    if (count < 0) {
        nts_node_set_errno(uv_translate_sys_error(errno));
        return number_array(0);
    }

    gid_t *groups = count == 0 ? NULL : malloc((size_t)count * sizeof(*groups));
    if (count != 0 && groups == NULL) {
        nts_node_set_errno(UV_ENOMEM);
        return number_array(0);
    }
    if (count != 0 && getgroups(count, groups) < 0) {
        free(groups);
        nts_node_set_errno(uv_translate_sys_error(errno));
        return number_array(0);
    }

    gid_t effective = getegid();
    bool has_effective = false;
    for (int i = 0; i < count; i++) {
        if (groups[i] == effective) has_effective = true;
    }

    NtsArray *answer = number_array((size_t)count + (has_effective ? 0u : 1u));
    for (int i = 0; i < count; i++) {
        NTS_ITEMS(answer, double)[i] = (double)groups[i];
    }
    if (!has_effective) NTS_ITEMS(answer, double)[count] = (double)effective;
    free(groups);
    nts_node_set_errno(0);
    return answer;
}

/* ------------------------------------------------------------- accounting */

static NtsArray *cpu_usage(int result, const uv_rusage_t *usage) {
    NtsArray *answer = number_array(2);
    nts_node_set_errno(result);
    if (result == 0) {
        NTS_ITEMS(answer, double)[0] =
            1000000.0 * (double)usage->ru_utime.tv_sec +
            (double)usage->ru_utime.tv_usec;
        NTS_ITEMS(answer, double)[1] =
            1000000.0 * (double)usage->ru_stime.tv_sec +
            (double)usage->ru_stime.tv_usec;
    }
    return answer;
}

double nts_process_uptime(void) {
    static uint64_t started = 0;
    uint64_t now = uv_hrtime();
    if (started == 0) started = now;
    return (double)(now - started) / 1000000000.0;
}

NtsArray *nts_process_cpu_usage(void) {
    uv_rusage_t usage;
    int result = uv_getrusage(&usage);
    return cpu_usage(result, &usage);
}

NtsArray *nts_process_thread_cpu_usage(void) {
    uv_rusage_t usage;
    int result = uv_getrusage_thread(&usage);
    return cpu_usage(result, &usage);
}

double nts_process_rss(void) {
    size_t rss = 0;
    int result = uv_resident_set_memory(&rss);
    nts_node_set_errno(result);
    return result == 0 ? (double)rss : 0;
}

NtsArray *nts_process_memory_usage(void) {
    NtsArray *answer = number_array(5);
    double rss = nts_process_rss();
    double managed = (double)nts_live_bytes();
    double *fields = NTS_ITEMS(answer, double);
    fields[0] = rss;
    // NTS providers account managed bytes directly rather than exposing a V8
    // heap capacity. The closest faithful meanings are therefore the bytes
    // currently owned for both heapTotal and heapUsed. NTS arrays live in that
    // same managed heap, so there is no separate external/ArrayBuffer pool.
    fields[1] = managed;
    fields[2] = managed;
    fields[3] = 0;
    fields[4] = 0;
    return answer;
}

NtsArray *nts_process_resource_usage(void) {
    uv_rusage_t usage;
    int result = uv_getrusage(&usage);
    NtsArray *answer = number_array(16);
    nts_node_set_errno(result);
    if (result != 0) return answer;

    double *fields = NTS_ITEMS(answer, double);
    fields[0] = 1000000.0 * (double)usage.ru_utime.tv_sec +
                (double)usage.ru_utime.tv_usec;
    fields[1] = 1000000.0 * (double)usage.ru_stime.tv_sec +
                (double)usage.ru_stime.tv_usec;
    fields[2] = (double)usage.ru_maxrss;
    fields[3] = (double)usage.ru_ixrss;
    fields[4] = (double)usage.ru_idrss;
    fields[5] = (double)usage.ru_isrss;
    fields[6] = (double)usage.ru_minflt;
    fields[7] = (double)usage.ru_majflt;
    fields[8] = (double)usage.ru_nswap;
    fields[9] = (double)usage.ru_inblock;
    fields[10] = (double)usage.ru_oublock;
    fields[11] = (double)usage.ru_msgsnd;
    fields[12] = (double)usage.ru_msgrcv;
    fields[13] = (double)usage.ru_nsignals;
    fields[14] = (double)usage.ru_nvcsw;
    fields[15] = (double)usage.ru_nivcsw;
    return answer;
}

double nts_process_available_memory(void) {
    return (double)uv_get_available_memory();
}

double nts_process_constrained_memory(void) {
    return (double)uv_get_constrained_memory();
}

void nts_process_raw_debug(NtsString *message) {
    char *text = string_utf8(message);
    if (text == NULL) return;
    fputs(text, stderr);
    fputc('\n', stderr);
    fflush(stderr);
    free(text);
}

static void free_string_vector(char **values, size_t count) {
    if (values == NULL) return;
    for (size_t i = 0; i < count; i++) free(values[i]);
    free(values);
}

static char **string_vector(NtsArray *source) {
    size_t count = source->header.length;
    char **values = calloc(count + 1, sizeof(*values));
    if (values == NULL) return NULL;
    for (size_t i = 0; i < count; i++) {
        values[i] = string_utf8(NTS_ITEMS(source, NtsString *)[i]);
        if (values[i] == NULL) {
            free_string_vector(values, i);
            return NULL;
        }
    }
    return values;
}

static int inherit_standard_stream(int descriptor) {
    int flags = fcntl(descriptor, F_GETFD, 0);
    if (flags < 0) return -1;
    return fcntl(descriptor, F_SETFD, flags & ~FD_CLOEXEC);
}

void nts_process_execve(NtsString *path, NtsArray *arguments,
                        NtsArray *environment) {
    char *executable = string_utf8(path);
    char **argv = string_vector(arguments);
    char **envp = string_vector(environment);
    if (executable == NULL || argv == NULL || envp == NULL) {
        free(executable);
        free_string_vector(argv, arguments->header.length);
        free_string_vector(envp, environment->header.length);
        fputs("process.execve: out of memory\n", stderr);
        abort();
    }

    if (inherit_standard_stream(STDIN_FILENO) != 0 ||
        inherit_standard_stream(STDOUT_FILENO) != 0 ||
        inherit_standard_stream(STDERR_FILENO) != 0) {
        perror("process.execve fcntl");
        abort();
    }

    execve(executable, argv, envp);
    // Success never returns. Node treats a failed exec as fatal too: continuing
    // a supervisor after the process image it promised to become was not
    // installed is generally less safe than stopping it.
    perror("process.execve");
    abort();
}

typedef struct {
    char *name;
    char *value;
} EnvEntry;

static void trim_horizontal(const char **text, size_t *length) {
    while (*length != 0 && (**text == ' ' || **text == '\t')) {
        (*text)++;
        (*length)--;
    }
    while (*length != 0 &&
           ((*text)[*length - 1] == ' ' || (*text)[*length - 1] == '\t')) {
        (*length)--;
    }
}

static char *copy_text(const char *text, size_t length,
                       bool expand_newlines) {
    char *copy = malloc(length + 1);
    if (copy == NULL) return NULL;
    size_t written = 0;
    for (size_t i = 0; i < length; i++) {
        if (expand_newlines && text[i] == '\\' && i + 1 < length &&
            text[i + 1] == 'n') {
            copy[written++] = '\n';
            i++;
        } else {
            copy[written++] = text[i];
        }
    }
    copy[written] = '\0';
    return copy;
}

static bool put_env_entry(EnvEntry **entries, size_t *count, size_t *capacity,
                          const char *name, size_t name_length,
                          const char *value, size_t value_length,
                          bool expand_newlines) {
    char *name_copy = copy_text(name, name_length, false);
    char *value_copy = copy_text(value, value_length, expand_newlines);
    if (name_copy == NULL || value_copy == NULL) {
        free(name_copy);
        free(value_copy);
        return false;
    }

    for (size_t i = 0; i < *count; i++) {
        if (strcmp((*entries)[i].name, name_copy) == 0) {
            free((*entries)[i].value);
            (*entries)[i].value = value_copy;
            free(name_copy);
            return true;
        }
    }

    if (*count == *capacity) {
        size_t next = *capacity == 0 ? 16 : *capacity * 2;
        EnvEntry *larger = realloc(*entries, next * sizeof(*larger));
        if (larger == NULL) {
            free(name_copy);
            free(value_copy);
            return false;
        }
        *entries = larger;
        *capacity = next;
    }
    (*entries)[*count].name = name_copy;
    (*entries)[*count].value = value_copy;
    (*count)++;
    return true;
}

static void free_env_entries(EnvEntry *entries, size_t count) {
    for (size_t i = 0; i < count; i++) {
        free(entries[i].name);
        free(entries[i].value);
    }
    free(entries);
}

static int read_env_file(const char *path, char **contents, size_t *length) {
    uv_fs_t request;
    int descriptor = uv_fs_open(NULL, &request, path, O_RDONLY, 0, NULL);
    int result = descriptor < 0 ? descriptor : 0;
    uv_fs_req_cleanup(&request);
    if (result != 0) return result;

    size_t capacity = 8192;
    size_t used = 0;
    char *bytes = malloc(capacity + 1);
    if (bytes == NULL) {
        uv_fs_close(NULL, &request, descriptor, NULL);
        uv_fs_req_cleanup(&request);
        return UV_ENOMEM;
    }

    while (result == 0) {
        if (used == capacity) {
            capacity *= 2;
            char *larger = realloc(bytes, capacity + 1);
            if (larger == NULL) {
                result = UV_ENOMEM;
                break;
            }
            bytes = larger;
        }
        uv_buf_t buffer = uv_buf_init(bytes + used, (unsigned)(capacity - used));
        int read = (int)uv_fs_read(NULL, &request, descriptor, &buffer, 1, -1,
                                   NULL);
        if (read < 0) result = read;
        uv_fs_req_cleanup(&request);
        if (read <= 0) break;
        used += (size_t)read;
    }

    int close_result = uv_fs_close(NULL, &request, descriptor, NULL);
    uv_fs_req_cleanup(&request);
    if (result == 0 && close_result < 0) result = close_result;
    if (result != 0) {
        free(bytes);
        return result;
    }
    bytes[used] = '\0';
    *contents = bytes;
    *length = used;
    return 0;
}

static int parse_env_file(char *contents, size_t length) {
    // Node normalizes CRLF before parsing. Compacting in place also handles a
    // lone CR the same way its `erase` does.
    size_t compacted = 0;
    for (size_t i = 0; i < length; i++) {
        if (contents[i] != '\r') contents[compacted++] = contents[i];
    }
    length = compacted;

    EnvEntry *entries = NULL;
    size_t count = 0;
    size_t capacity = 0;
    size_t cursor = 0;
    bool okay = true;

    while (cursor < length && okay) {
        while (cursor < length &&
               (contents[cursor] == '\n' || contents[cursor] == ' ' ||
                contents[cursor] == '\t')) {
            cursor++;
        }
        if (cursor >= length) break;
        if (contents[cursor] == '#') {
            while (cursor < length && contents[cursor] != '\n') cursor++;
            continue;
        }

        size_t line_end = cursor;
        while (line_end < length && contents[line_end] != '\n') line_end++;
        size_t equals = cursor;
        while (equals < line_end && contents[equals] != '=') equals++;
        if (equals == line_end) {
            cursor = line_end + (line_end < length ? 1u : 0u);
            continue;
        }

        const char *name = contents + cursor;
        size_t name_length = equals - cursor;
        trim_horizontal(&name, &name_length);
        if (name_length >= 7 && memcmp(name, "export ", 7) == 0) {
            name += 7;
            name_length -= 7;
            trim_horizontal(&name, &name_length);
        }
        if (name_length == 0) {
            cursor = line_end + (line_end < length ? 1u : 0u);
            continue;
        }

        size_t value_start = equals + 1;
        while (value_start < length &&
               (contents[value_start] == ' ' || contents[value_start] == '\t')) {
            value_start++;
        }

        const char *value = contents + value_start;
        size_t value_length = 0;
        bool expand_newlines = false;
        size_t next = line_end + (line_end < length ? 1u : 0u);

        if (value_start < length &&
            (contents[value_start] == '\'' || contents[value_start] == '"' ||
             contents[value_start] == '`')) {
            char quote = contents[value_start];
            size_t closing = value_start + 1;
            while (closing < length && contents[closing] != quote) closing++;
            if (closing < length) {
                value = contents + value_start + 1;
                value_length = closing - value_start - 1;
                expand_newlines = quote == '"';
                next = closing + 1;
                while (next < length && contents[next] != '\n') next++;
                if (next < length) next++;
            } else {
                // An unmatched quote is ordinary text through the end of its
                // line, including the opening quote.
                value_length = line_end - value_start;
            }
        } else {
            value_length = line_end - value_start;
            for (size_t i = 0; i < value_length; i++) {
                if (value[i] == '#') {
                    value_length = i;
                    break;
                }
            }
            trim_horizontal(&value, &value_length);
        }

        okay = put_env_entry(&entries, &count, &capacity, name, name_length,
                             value, value_length, expand_newlines);
        cursor = next;
    }

    int result = okay ? 0 : UV_ENOMEM;
    for (size_t i = 0; i < count && result == 0; i++) {
        // Node's Dotenv::SetEnvironment preserves a variable that was already
        // in the process environment.
        if (getenv(entries[i].name) == NULL) {
            result = uv_os_setenv(entries[i].name, entries[i].value);
        }
    }
    free_env_entries(entries, count);
    return result;
}

double nts_process_load_env_file(NtsString *path) {
    char *native_path = string_utf8(path);
    if (native_path == NULL) return (double)UV_ENOMEM;
    char *contents = NULL;
    size_t length = 0;
    int result = read_env_file(native_path, &contents, &length);
    free(native_path);
    if (result == 0) result = parse_env_file(contents, length);
    free(contents);
    return (double)result;
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

static char *string_utf8(const NtsString *value) {
    size_t capacity = (size_t)value->length * 3 + 1;
    char *text = malloc(capacity);
    if (text == NULL) return NULL;
    nts_node_to_utf8(value, text, capacity);
    return text;
}

static size_t credential_buffer_size(long configured) {
    return configured > 0 ? (size_t)configured : 16384;
}

static char *user_name_by_id(uid_t id) {
    size_t size = credential_buffer_size(sysconf(_SC_GETPW_R_SIZE_MAX));
    for (;;) {
        char *buffer = malloc(size);
        if (buffer == NULL) return NULL;
        struct passwd entry;
        struct passwd *found = NULL;
        int err = getpwuid_r(id, &entry, buffer, size, &found);
        if (err == ERANGE) {
            free(buffer);
            size *= 2;
            continue;
        }
        if (err != 0 || found == NULL) {
            free(buffer);
            return NULL;
        }
        size_t length = strlen(found->pw_name);
        char *name = malloc(length + 1);
        if (name != NULL) memcpy(name, found->pw_name, length + 1);
        free(buffer);
        return name;
    }
}

static bool group_id_by_name(const char *name, gid_t *id) {
    size_t size = credential_buffer_size(sysconf(_SC_GETGR_R_SIZE_MAX));
    for (;;) {
        char *buffer = malloc(size);
        if (buffer == NULL) return false;
        struct group entry;
        struct group *found = NULL;
        int err = getgrnam_r(name, &entry, buffer, size, &found);
        if (err == ERANGE) {
            free(buffer);
            size *= 2;
            continue;
        }
        if (err != 0 || found == NULL) {
            free(buffer);
            return false;
        }
        *id = found->gr_gid;
        free(buffer);
        return true;
    }
}

static bool user_id_by_name(const char *name, uid_t *id) {
    size_t size = credential_buffer_size(sysconf(_SC_GETPW_R_SIZE_MAX));
    for (;;) {
        char *buffer = malloc(size);
        if (buffer == NULL) return false;
        struct passwd entry;
        struct passwd *found = NULL;
        int err = getpwnam_r(name, &entry, buffer, size, &found);
        if (err == ERANGE) {
            free(buffer);
            size *= 2;
            continue;
        }
        if (err != 0 || found == NULL) {
            free(buffer);
            return false;
        }
        *id = found->pw_uid;
        free(buffer);
        return true;
    }
}

static double set_user_id(double id, NtsString *name, int (*setter)(uid_t)) {
    char *given = string_utf8(name);
    if (given == NULL) return (double)UV_ENOMEM;
    uid_t resolved = (uid_t)id;
    if (given[0] != '\0' && !user_id_by_name(given, &resolved)) {
        free(given);
        return 1;
    }
    free(given);
    return setter(resolved) == 0 ? 0 : system_error();
}

static double set_group_id(double id, NtsString *name, int (*setter)(gid_t)) {
    char *given = string_utf8(name);
    if (given == NULL) return (double)UV_ENOMEM;
    gid_t resolved = (gid_t)id;
    if (given[0] != '\0' && !group_id_by_name(given, &resolved)) {
        free(given);
        return 1;
    }
    free(given);
    return setter(resolved) == 0 ? 0 : system_error();
}

double nts_process_setuid(double id, NtsString *name) {
    return set_user_id(id, name, setuid);
}

double nts_process_setgid(double id, NtsString *name) {
    return set_group_id(id, name, setgid);
}

double nts_process_seteuid(double id, NtsString *name) {
    return set_user_id(id, name, seteuid);
}

double nts_process_setegid(double id, NtsString *name) {
    return set_group_id(id, name, setegid);
}

double nts_process_setgroups(NtsArray *ids, NtsArray *names) {
    size_t count = ids->header.length;
    if (names->header.length != count) return (double)UV_EINVAL;

    gid_t *resolved = count == 0 ? NULL : malloc(count * sizeof(*resolved));
    if (count != 0 && resolved == NULL) return (double)UV_ENOMEM;

    for (size_t i = 0; i < count; i++) {
        double id = NTS_ITEMS(ids, double)[i];
        NtsString *name = NTS_ITEMS(names, NtsString *)[i];
        char *given = string_utf8(name);
        if (given == NULL) {
            free(resolved);
            return (double)UV_ENOMEM;
        }
        resolved[i] = (gid_t)id;
        if (given[0] != '\0' && !group_id_by_name(given, &resolved[i])) {
            free(given);
            free(resolved);
            // Node uses the positive one-based index to tell TypeScript which
            // input name should appear in ERR_UNKNOWN_CREDENTIAL.
            return (double)(i + 1);
        }
        free(given);
    }

    int result = setgroups(count, resolved);
    free(resolved);
    return result == 0 ? 0 : system_error();
}

double nts_process_initgroups(double user_id, NtsString *user_name,
                              double group_id, NtsString *group_name) {
    char *given_user = string_utf8(user_name);
    char *given_group = string_utf8(group_name);
    if (given_user == NULL || given_group == NULL) {
        free(given_user);
        free(given_group);
        return (double)UV_ENOMEM;
    }

    char *resolved_user = given_user[0] == '\0'
                              ? user_name_by_id((uid_t)user_id)
                              : given_user;
    if (resolved_user == NULL) {
        free(given_user);
        free(given_group);
        return 1;
    }

    gid_t resolved_group = (gid_t)group_id;
    if (given_group[0] != '\0' &&
        !group_id_by_name(given_group, &resolved_group)) {
        if (resolved_user != given_user) free(resolved_user);
        free(given_user);
        free(given_group);
        return 2;
    }

    int result = initgroups(resolved_user, resolved_group);
    int saved_errno = errno;
    if (resolved_user != given_user) free(resolved_user);
    free(given_user);
    free(given_group);
    return result == 0 ? 0 : -(double)saved_errno;
}
