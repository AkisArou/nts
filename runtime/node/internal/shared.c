#include <stdint.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include "shared.h"

const NtsDescriptor nts_node_desc_double = {
    NTS_KIND_ARRAY, sizeof(double), 0, 0, 0, 0, "double", 0, 0,
    NTS_ARRAY_FLOAT};

/* Matches what the emitter writes for the same shape, field for field:
 *
 *     static const NtsDescriptor nts_desc_NtsValue =
 *         { NTS_KIND_ARRAY, sizeof(NtsValue), 0, 0, 0, 0, "NtsValue[]", 1, 0 };
 *
 * Copied from a program that builds one rather than reasoned out, because the
 * two have to agree exactly and only one of them is generated. */
const NtsDescriptor nts_node_desc_value = {
    NTS_KIND_ARRAY, sizeof(NtsValue), 0, 0, 0, 0, "NtsValue[]", 1, 0,
    NTS_ARRAY_VALUE};

/* A loaded addon can be shared by Node workers. Result-plus-status calls are
 * synchronous, but their status still belongs to the calling runtime thread. */
static _Thread_local int last_errno = 0;

double nts_errno(void) { return (double)last_errno; }

void nts_sleep(double milliseconds) {
    if (milliseconds <= 0.0) return;
    uv_sleep((unsigned int)milliseconds);
}

static NtsString *node_empty_string(void) {
    return nts_string_from_utf8("", 0);
}

NtsString *nts_process_exec_path(void) {
    size_t capacity = 256;
    for (;;) {
        char *path = malloc(capacity);
        if (path == NULL) return node_empty_string();
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
                                : node_empty_string();
        free(path);
        return answer;
    }
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
        size_t available = capacity - used;
        size_t received = fread(bytes + used, 1, available, file);
        used += received;
        /* A short fread reached EOF or an error. Do not issue another read on
         * an errored stream: after an I/O error its file position may be
         * indeterminate, and retrying there is undefined by stdio. */
        if (received < available) break;
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
    for (size_t index = 0; index < length; index++) {
        if (bytes[index] == '\0') count++;
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
    for (size_t index = 0; index < count; index++) {
        char *end = memchr(at, '\0', length - (size_t)(at - bytes));
        size_t item_length = end == NULL ? 0 : (size_t)(end - at);
        NTS_ITEMS(answer, void *)[index] =
            index == 0 ? nts_process_exec_path()
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
    if (bytes == NULL) return node_empty_string();
    size_t first_length = 0;
    while (first_length < length && bytes[first_length] != '\0') {
        first_length++;
    }
    NtsString *answer = nts_string_from_utf8(bytes, first_length);
    free(bytes);
    return answer;
#else
    return nts_process_exec_path();
#endif
}

NtsString *nts_node_eol(void) {
#ifdef _WIN32
    return nts_string_from_utf8("\r\n", 2);
#else
    return nts_string_from_utf8("\n", 1);
#endif
}

static _Thread_local int random_uuid_status = 0;

double nts_node_random_uuid_status(void) {
    return (double)random_uuid_status;
}

NtsString *nts_node_random_uuid(void) {
    uint8_t bytes[16];
    int result = uv_random(NULL, NULL, bytes, sizeof(bytes), 0, NULL);
    random_uuid_status = result < 0 ? -result : 0;
    if (result < 0) return nts_string_from_utf8("", 0);

    bytes[6] = (uint8_t)((bytes[6] & 0x0f) | 0x40);
    bytes[8] = (uint8_t)((bytes[8] & 0x3f) | 0x80);

    static const char hexadecimal[] = "0123456789abcdef";
    char text[36];
    size_t at = 0;
    for (size_t index = 0; index < sizeof(bytes); index++) {
        if (index == 4 || index == 6 || index == 8 || index == 10) {
            text[at++] = '-';
        }
        uint8_t byte = bytes[index];
        text[at++] = hexadecimal[byte >> 4];
        text[at++] = hexadecimal[byte & 0x0f];
    }
    return nts_string_from_utf8(text, 36);
}

void nts_node_set_errno(int uv_result) {
    last_errno = uv_result < 0 ? -uv_result : 0;
}

size_t nts_node_to_utf8(const NtsString *s, char *buf, size_t cap) {
    if (cap == 0) return 0;
    size_t n = 0;
    for (uint32_t i = 0; i < s->length; i++) {
        uint32_t code_point = nts_unit(s, i);
        if (code_point >= 0xD800 && code_point <= 0xDBFF &&
            i + 1 < s->length) {
            uint32_t low = nts_unit(s, i + 1);
            if (low >= 0xDC00 && low <= 0xDFFF) {
                code_point = 0x10000 + ((code_point - 0xD800) << 10) +
                             (low - 0xDC00);
                i++;
            }
        }
        // V8's UTF-8 conversion replaces an unpaired UTF-16 surrogate rather
        // than emitting its invalid three-byte encoding.
        if (code_point >= 0xD800 && code_point <= 0xDFFF) code_point = 0xFFFD;

        size_t needed = code_point < 0x80      ? 1
                        : code_point < 0x800   ? 2
                        : code_point < 0x10000 ? 3
                                               : 4;
        if (n + needed >= cap) break;

        if (needed == 1) {
            buf[n++] = (char)code_point;
        } else if (needed == 2) {
            buf[n++] = (char)(0xC0 | (code_point >> 6));
            buf[n++] = (char)(0x80 | (code_point & 0x3F));
        } else if (needed == 3) {
            buf[n++] = (char)(0xE0 | (code_point >> 12));
            buf[n++] = (char)(0x80 | ((code_point >> 6) & 0x3F));
            buf[n++] = (char)(0x80 | (code_point & 0x3F));
        } else {
            buf[n++] = (char)(0xF0 | (code_point >> 18));
            buf[n++] = (char)(0x80 | ((code_point >> 12) & 0x3F));
            buf[n++] = (char)(0x80 | ((code_point >> 6) & 0x3F));
            buf[n++] = (char)(0x80 | (code_point & 0x3F));
        }
    }
    buf[n] = 0;
    return n;
}

char *nts_node_to_utf8_alloc(const NtsString *s, size_t *length) {
    if ((size_t)s->length > (SIZE_MAX - 1) / 3) return NULL;
    size_t capacity = (size_t)s->length * 3 + 1;
    char *buffer = malloc(capacity);
    if (buffer == NULL) return NULL;
    size_t written = nts_node_to_utf8(s, buffer, capacity);
    if (length != NULL) *length = written;
    return buffer;
}

/* libuv's own name and message for an error code. Node exposes the same pair
 * through `internalBinding('uv')`; taking them from libuv rather than from a
 * table means they cannot drift from the platform. */
NtsString *nts_uv_err_name(double code) {
    const char *name = uv_err_name((int)code);
    return nts_string_from_utf8(name, name ? strlen(name) : 0);
}

NtsString *nts_uv_err_message(double code) {
    const char *message = uv_strerror((int)code);
    return nts_string_from_utf8(message, message ? strlen(message) : 0);
}

/* Expand libuv's own table, exactly as node does in `src/uv.cc`. Keeping the
 * two columns in static C arrays means the TypeScript can assemble its typed
 * Map without a hand-maintained list or an erased array crossing the seam. */
#define NTS_UV_ERROR_COUNT(name, message) +1
enum { NTS_UV_ERROR_COUNT_VALUE = 0 UV_ERRNO_MAP(NTS_UV_ERROR_COUNT) };
#undef NTS_UV_ERROR_COUNT

#define NTS_UV_ERROR_CODE(name, message) UV_##name,
static const int uv_error_codes[NTS_UV_ERROR_COUNT_VALUE] = {
    UV_ERRNO_MAP(NTS_UV_ERROR_CODE)
};
#undef NTS_UV_ERROR_CODE

#define NTS_UV_ERROR_NAME(name, message) #name,
static const char *const uv_error_names[NTS_UV_ERROR_COUNT_VALUE] = {
    UV_ERRNO_MAP(NTS_UV_ERROR_NAME)
};
#undef NTS_UV_ERROR_NAME

NtsArray *nts_uv_error_codes(void) {
    NtsArray *codes =
        nts_array_new(&nts_node_desc_double, NTS_UV_ERROR_COUNT_VALUE);
    for (size_t i = 0; i < NTS_UV_ERROR_COUNT_VALUE; i++) {
        NTS_ITEMS(codes, double)[i] = (double)uv_error_codes[i];
    }
    return codes;
}

NtsArray *nts_uv_error_names(void) {
    NtsArray *names = nts_array_new(&nts_desc_ref, NTS_UV_ERROR_COUNT_VALUE);
    for (size_t i = 0; i < NTS_UV_ERROR_COUNT_VALUE; i++) {
        const char *name = uv_error_names[i];
        NTS_ITEMS(names, NtsString *)[i] = nts_string_from_utf8(name, strlen(name));
    }
    return names;
}

/* Node publishes the platform's own <signal.h> values. Keep one ordered table
 * for every consumer: `node:os` exposes the names and numbers, while
 * `util.convertProcessSignalToExitCode` validates the same names and applies
 * the POSIX 128 + signal-number convention. */
#define NTS_SIGNAL_(name) { #name, sizeof(#name) - 1, name }
static const NtsNodeSignalConstant signal_constants[] = {
#ifdef SIGHUP
    NTS_SIGNAL_(SIGHUP),
#endif
#ifdef SIGINT
    NTS_SIGNAL_(SIGINT),
#endif
#ifdef SIGQUIT
    NTS_SIGNAL_(SIGQUIT),
#endif
#ifdef SIGILL
    NTS_SIGNAL_(SIGILL),
#endif
#ifdef SIGTRAP
    NTS_SIGNAL_(SIGTRAP),
#endif
#ifdef SIGABRT
    NTS_SIGNAL_(SIGABRT),
#endif
#ifdef SIGIOT
    NTS_SIGNAL_(SIGIOT),
#endif
#ifdef SIGBUS
    NTS_SIGNAL_(SIGBUS),
#endif
#ifdef SIGFPE
    NTS_SIGNAL_(SIGFPE),
#endif
#ifdef SIGKILL
    NTS_SIGNAL_(SIGKILL),
#endif
#ifdef SIGUSR1
    NTS_SIGNAL_(SIGUSR1),
#endif
#ifdef SIGSEGV
    NTS_SIGNAL_(SIGSEGV),
#endif
#ifdef SIGUSR2
    NTS_SIGNAL_(SIGUSR2),
#endif
#ifdef SIGPIPE
    NTS_SIGNAL_(SIGPIPE),
#endif
#ifdef SIGALRM
    NTS_SIGNAL_(SIGALRM),
#endif
    NTS_SIGNAL_(SIGTERM),
#ifdef SIGCHLD
    NTS_SIGNAL_(SIGCHLD),
#endif
#ifdef SIGSTKFLT
    NTS_SIGNAL_(SIGSTKFLT),
#endif
#ifdef SIGCONT
    NTS_SIGNAL_(SIGCONT),
#endif
#ifdef SIGSTOP
    NTS_SIGNAL_(SIGSTOP),
#endif
#ifdef SIGTSTP
    NTS_SIGNAL_(SIGTSTP),
#endif
#ifdef SIGBREAK
    NTS_SIGNAL_(SIGBREAK),
#endif
#ifdef SIGTTIN
    NTS_SIGNAL_(SIGTTIN),
#endif
#ifdef SIGTTOU
    NTS_SIGNAL_(SIGTTOU),
#endif
#ifdef SIGURG
    NTS_SIGNAL_(SIGURG),
#endif
#ifdef SIGXCPU
    NTS_SIGNAL_(SIGXCPU),
#endif
#ifdef SIGXFSZ
    NTS_SIGNAL_(SIGXFSZ),
#endif
#ifdef SIGVTALRM
    NTS_SIGNAL_(SIGVTALRM),
#endif
#ifdef SIGPROF
    NTS_SIGNAL_(SIGPROF),
#endif
#ifdef SIGWINCH
    NTS_SIGNAL_(SIGWINCH),
#endif
#ifdef SIGIO
    NTS_SIGNAL_(SIGIO),
#endif
#ifdef SIGPOLL
    NTS_SIGNAL_(SIGPOLL),
#endif
#ifdef SIGLOST
    NTS_SIGNAL_(SIGLOST),
#endif
#ifdef SIGPWR
    NTS_SIGNAL_(SIGPWR),
#endif
#ifdef SIGINFO
    NTS_SIGNAL_(SIGINFO),
#endif
#ifdef SIGSYS
    NTS_SIGNAL_(SIGSYS),
#endif
#ifdef SIGUNUSED
    NTS_SIGNAL_(SIGUNUSED),
#endif
};
#undef NTS_SIGNAL_

static const size_t signal_constant_count =
    sizeof(signal_constants) / sizeof(signal_constants[0]);

const NtsNodeSignalConstant *nts_node_signal_constants(size_t *count) {
    if (count != NULL) *count = signal_constant_count;
    return signal_constants;
}

NtsArray *nts_process_signal_names(void) {
    NtsArray *names = nts_array_new(&nts_desc_ref, (double)signal_constant_count);
    for (size_t i = 0; i < signal_constant_count; i++) {
        const char *name = signal_constants[i].name;
        NTS_ITEMS(names, NtsString *)[i] =
            nts_string_from_utf8(name, signal_constants[i].name_length);
    }
    return names;
}

static bool signal_name_equals(const NtsString *actual,
                               const NtsNodeSignalConstant *expected) {
    size_t expected_length = expected->name_length;
    if ((size_t)actual->length != expected_length) return false;
    for (size_t i = 0; i < expected_length; i++) {
        if (nts_unit(actual, (uint32_t)i) != (uint8_t)expected->name[i]) {
            return false;
        }
    }
    return true;
}

double nts_process_signal_exit_code(NtsString *signal_code) {
    for (size_t i = 0; i < signal_constant_count; i++) {
        if (signal_name_equals(signal_code, &signal_constants[i])) {
            return (double)(128 + signal_constants[i].value);
        }
    }
    return 0;
}
