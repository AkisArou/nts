/* The native half of `node:os`.
 *
 * Every function here is a libuv call and a conversion. Node's `src/node_os.cc`
 * is the same shape -- `uv_os_gethostname`, `uv_cpu_info`,
 * `uv_interface_addresses` -- with `v8::Local` where these have `NtsString`.
 *
 * Where node's binding returns one flat `v8::Array` of mixed strings and
 * numbers, these return one typed array per column. The TypeScript assembles
 * the same objects from them, and the declarations stay typed. */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <uv.h>
#include "os.h"
#include "../internal/shared.h"

static NtsString *utf8(const char *s) {
    return nts_string_from_utf8(s, s ? strlen(s) : 0);
}

/* An array of references. `nts_desc_ref` is the runtime's descriptor for one;
 * a string array is an array of references to strings. */
static NtsArray *string_array(char **items, size_t count) {
    NtsArray *a = nts_array_new(&nts_desc_ref, (double)count);
    for (size_t i = 0; i < count; i++) {
        NTS_ITEMS(a, void *)[i] = utf8(items[i]);
    }
    return a;
}

static NtsArray *number_array(const double *items, size_t count) {
    NtsArray *a = nts_array_new(&nts_desc_double, (double)count);
    for (size_t i = 0; i < count; i++) {
        NTS_ITEMS(a, double)[i] = items[i];
    }
    return a;
}

/* --------------------------------------------------------------- identity */

NtsString *nts_os_hostname(void) {
    char buf[UV_MAXHOSTNAMESIZE];
    size_t size = sizeof(buf);
    int err = uv_os_gethostname(buf, &size);
    nts_node_set_errno(err);
    return err == 0 ? nts_string_from_utf8(buf, size) : utf8("");
}

/* `uv_os_uname` fills all four at once, so one call answers four bindings. */
static int uname_into(uv_utsname_t *out) { return uv_os_uname(out); }

NtsString *nts_os_type(void) {
    uv_utsname_t u;
    return uname_into(&u) == 0 ? utf8(u.sysname) : utf8("");
}

NtsString *nts_os_version(void) {
    uv_utsname_t u;
    return uname_into(&u) == 0 ? utf8(u.version) : utf8("");
}

NtsString *nts_os_machine(void) {
    uv_utsname_t u;
    return uname_into(&u) == 0 ? utf8(u.machine) : utf8("");
}

/* `process.arch` and `process.platform` are what the *compiler* targeted, not
 * what the machine reports, so they are compile-time constants exactly as
 * node's `configure` bakes them in. */
NtsString *nts_os_arch(void) {
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

NtsString *nts_os_platform(void) {
#if defined(__linux__)
    return utf8("linux");
#elif defined(__APPLE__)
    return utf8("darwin");
#elif defined(_WIN32)
    return utf8("win32");
#elif defined(__FreeBSD__)
    return utf8("freebsd");
#elif defined(__OpenBSD__)
    return utf8("openbsd");
#elif defined(__sun)
    return utf8("sunos");
#elif defined(_AIX)
    return utf8("aix");
#else
    return utf8("unknown");
#endif
}

NtsString *nts_os_endianness(void) {
    const uint16_t probe = 1;
    return utf8(*(const unsigned char *)&probe == 1 ? "LE" : "BE");
}

NtsString *nts_os_eol(void) {
#ifdef _WIN32
    return utf8("\r\n");
#else
    return utf8("\n");
#endif
}

NtsString *nts_os_devnull(void) {
#ifdef _WIN32
    return utf8("\\\\.\\nul");
#else
    return utf8("/dev/null");
#endif
}

/* ------------------------------------------------------------ directories */

NtsString *nts_os_homedir(void) {
    char buf[4096];
    size_t size = sizeof(buf);
    int err = uv_os_homedir(buf, &size);
    nts_node_set_errno(err);
    return err == 0 ? nts_string_from_utf8(buf, size) : utf8("");
}

NtsString *nts_os_tmpdir(void) {
    char buf[4096];
    size_t size = sizeof(buf);
    int err = uv_os_tmpdir(buf, &size);
    nts_node_set_errno(err);
    return err == 0 ? nts_string_from_utf8(buf, size) : utf8("");
}

/* ---------------------------------------------------------------- machine */

double nts_os_uptime(void) {
    double seconds = 0;
    nts_node_set_errno(uv_uptime(&seconds));
    return seconds;
}

double nts_os_totalmem(void) { return (double)uv_get_total_memory(); }
double nts_os_freemem(void) { return (double)uv_get_free_memory(); }
double nts_os_available_parallelism(void) { return (double)uv_available_parallelism(); }

NtsArray *nts_os_loadavg(void) {
    double avg[3] = {0, 0, 0};
    uv_loadavg(avg);
    return number_array(avg, 3);
}

/* -------------------------------------------------------------------- cpus */

/* `cpus()` reads these three columns consecutively. Keep one libuv snapshot
 * across them: CPU speed can change between calls, and three independent
 * `uv_cpu_info` allocations would be both inconsistent and unnecessary. */
static uv_cpu_info_t *cpu_infos = NULL;
static int cpu_count = 0;

static int refresh_cpus(void) {
    if (cpu_infos) {
        uv_free_cpu_info(cpu_infos, cpu_count);
        cpu_infos = NULL;
        cpu_count = 0;
    }
    return uv_cpu_info(&cpu_infos, &cpu_count);
}

NtsArray *nts_os_cpu_models(void) {
    if (refresh_cpus() != 0) return string_array(NULL, 0);
    NtsArray *a = nts_array_new(&nts_desc_ref, (double)cpu_count);
    for (int i = 0; i < cpu_count; i++) {
        NTS_ITEMS(a, void *)[i] = utf8(cpu_infos[i].model);
    }
    return a;
}

NtsArray *nts_os_cpu_speeds(void) {
    NtsArray *a = nts_array_new(&nts_desc_double, (double)cpu_count);
    for (int i = 0; i < cpu_count; i++) {
        NTS_ITEMS(a, double)[i] = (double)cpu_infos[i].speed;
    }
    return a;
}

NtsArray *nts_os_cpu_times(void) {
    NtsArray *a = nts_array_new(&nts_desc_double, (double)(cpu_count * 5));
    for (int i = 0; i < cpu_count; i++) {
        double *at = &NTS_ITEMS(a, double)[i * 5];
        at[0] = (double)cpu_infos[i].cpu_times.user;
        at[1] = (double)cpu_infos[i].cpu_times.nice;
        at[2] = (double)cpu_infos[i].cpu_times.sys;
        at[3] = (double)cpu_infos[i].cpu_times.idle;
        at[4] = (double)cpu_infos[i].cpu_times.irq;
    }
    if (cpu_infos) uv_free_cpu_info(cpu_infos, cpu_count);
    cpu_infos = NULL;
    cpu_count = 0;
    return a;
}

/* ------------------------------------------------------------- interfaces */

/* One `uv_interface_addresses` call per column would report a different set
 * each time an interface appeared or vanished between calls. Taking the
 * snapshot once and answering every column from it is what keeps the columns
 * describing the same interfaces. */
static uv_interface_address_t *interfaces = NULL;
static int interface_count = 0;

static void refresh_interfaces(void) {
    if (interfaces) {
        uv_free_interface_addresses(interfaces, interface_count);
        interfaces = NULL;
        interface_count = 0;
    }
    int err = uv_interface_addresses(&interfaces, &interface_count);
    nts_node_set_errno(err);
    if (err != 0) {
        interfaces = NULL;
        interface_count = 0;
    }
}

NtsArray *nts_os_if_names(void) {
    refresh_interfaces();
    NtsArray *a = nts_array_new(&nts_desc_ref, (double)interface_count);
    for (int i = 0; i < interface_count; i++) {
        NTS_ITEMS(a, void *)[i] = utf8(interfaces[i].name);
    }
    return a;
}

static NtsArray *if_address_column(int netmask) {
    NtsArray *a = nts_array_new(&nts_desc_ref, (double)interface_count);
    for (int i = 0; i < interface_count; i++) {
        char buf[INET6_ADDRSTRLEN] = {0};
        const void *src = netmask ? (const void *)&interfaces[i].netmask
                                  : (const void *)&interfaces[i].address;
        if (((const struct sockaddr *)src)->sa_family == AF_INET6) {
            uv_ip6_name((const struct sockaddr_in6 *)src, buf, sizeof buf);
        } else {
            uv_ip4_name((const struct sockaddr_in *)src, buf, sizeof buf);
        }
        NTS_ITEMS(a, void *)[i] = utf8(buf);
    }
    return a;
}

NtsArray *nts_os_if_addresses(void) { return if_address_column(0); }
NtsArray *nts_os_if_netmasks(void) { return if_address_column(1); }

NtsArray *nts_os_if_families(void) {
    NtsArray *a = nts_array_new(&nts_desc_ref, (double)interface_count);
    for (int i = 0; i < interface_count; i++) {
        int v6 = interfaces[i].address.address4.sin_family == AF_INET6;
        NTS_ITEMS(a, void *)[i] = utf8(v6 ? "IPv6" : "IPv4");
    }
    return a;
}

NtsArray *nts_os_if_macs(void) {
    NtsArray *a = nts_array_new(&nts_desc_ref, (double)interface_count);
    for (int i = 0; i < interface_count; i++) {
        char mac[18];
        const unsigned char *p = (const unsigned char *)interfaces[i].phys_addr;
        snprintf(mac, sizeof mac, "%02x:%02x:%02x:%02x:%02x:%02x",
                 p[0], p[1], p[2], p[3], p[4], p[5]);
        NTS_ITEMS(a, void *)[i] = utf8(mac);
    }
    return a;
}

NtsArray *nts_os_if_internal(void) {
    NtsArray *a = nts_array_new(&nts_desc_double, (double)interface_count);
    for (int i = 0; i < interface_count; i++) {
        NTS_ITEMS(a, double)[i] = interfaces[i].is_internal ? 1.0 : 0.0;
    }
    return a;
}

NtsArray *nts_os_if_scopeids(void) {
    NtsArray *a = nts_array_new(&nts_desc_double, (double)interface_count);
    for (int i = 0; i < interface_count; i++) {
        int v6 = interfaces[i].address.address4.sin_family == AF_INET6;
        NTS_ITEMS(a, double)[i] =
            v6 ? (double)interfaces[i].address.address6.sin6_scope_id : -1.0;
    }
    return a;
}

/* ------------------------------------------------------------------- user */

static int passwd_loaded = 0;
static uv_passwd_t passwd;

static const uv_passwd_t *user(void) {
    if (!passwd_loaded) {
        int err = uv_os_get_passwd(&passwd);
        nts_node_set_errno(err);
        if (err != 0) return NULL;
        passwd_loaded = 1;
    } else {
        nts_node_set_errno(0);
    }
    return &passwd;
}

double nts_os_user_uid(void) { const uv_passwd_t *p = user(); return p ? (double)p->uid : -1.0; }
double nts_os_user_gid(void) { const uv_passwd_t *p = user(); return p ? (double)p->gid : -1.0; }
NtsString *nts_os_user_username(void) { const uv_passwd_t *p = user(); return utf8(p ? p->username : ""); }
NtsString *nts_os_user_homedir(void) { const uv_passwd_t *p = user(); return utf8(p ? p->homedir : ""); }
NtsString *nts_os_user_shell(void) { const uv_passwd_t *p = user(); return utf8(p && p->shell ? p->shell : ""); }

/* --------------------------------------------------------------- priority */

double nts_os_get_priority(double pid) {
    int priority = 0;
    int err = uv_os_getpriority((uv_pid_t)pid, &priority);
    nts_node_set_errno(err);
    return err == 0 ? (double)priority : 0.0;
}

double nts_os_set_priority(double pid, double priority) {
    int err = uv_os_setpriority((uv_pid_t)pid, (int)priority);
    nts_node_set_errno(err);
    return (double)err;
}

/* -------------------------------------------------------------- constants */

/* `os.constants`, node `src/node_constants.cc`.
 *
 * Node builds one object per group from the platform's own headers; these
 * report the same values as three parallel columns and let the TypeScript
 * assemble the object. Taking them from the headers rather than writing the
 * numbers down is the point: `SIGUSR1` is 10 on Linux and 30 on macOS, and a
 * table transcribed once would be wrong on the other. */
#include <signal.h>
#include <errno.h>
#include <dlfcn.h>

typedef struct { const char *group; const char *name; double value; } NtsOsConstant;

#define C_(g, n) { g, #n, (double)n }
static const NtsOsConstant OS_CONSTANTS[] = {
    C_("signals", SIGHUP),  C_("signals", SIGINT),  C_("signals", SIGQUIT),
    C_("signals", SIGILL),  C_("signals", SIGTRAP), C_("signals", SIGABRT),
    C_("signals", SIGBUS),  C_("signals", SIGFPE),  C_("signals", SIGKILL),
    C_("signals", SIGUSR1), C_("signals", SIGSEGV), C_("signals", SIGUSR2),
    C_("signals", SIGPIPE), C_("signals", SIGALRM), C_("signals", SIGTERM),
    C_("signals", SIGCHLD), C_("signals", SIGCONT), C_("signals", SIGSTOP),
    C_("signals", SIGTSTP), C_("signals", SIGTTIN), C_("signals", SIGTTOU),
    C_("signals", SIGURG),  C_("signals", SIGXCPU), C_("signals", SIGXFSZ),
    C_("signals", SIGVTALRM), C_("signals", SIGPROF), C_("signals", SIGWINCH),
    C_("signals", SIGIO),   C_("signals", SIGSYS),
#ifdef SIGPOLL
    C_("signals", SIGPOLL),
#endif
#ifdef SIGPWR
    C_("signals", SIGPWR),
#endif
#ifdef SIGSTKFLT
    C_("signals", SIGSTKFLT),
#endif

    C_("errno", E2BIG), C_("errno", EACCES), C_("errno", EADDRINUSE),
    C_("errno", EADDRNOTAVAIL), C_("errno", EAFNOSUPPORT), C_("errno", EAGAIN),
    C_("errno", EALREADY), C_("errno", EBADF), C_("errno", EBADMSG),
    C_("errno", EBUSY), C_("errno", ECANCELED), C_("errno", ECHILD),
    C_("errno", ECONNABORTED), C_("errno", ECONNREFUSED), C_("errno", ECONNRESET),
    C_("errno", EDEADLK), C_("errno", EDESTADDRREQ), C_("errno", EDOM),
    C_("errno", EEXIST), C_("errno", EFAULT), C_("errno", EFBIG),
    C_("errno", EHOSTUNREACH), C_("errno", EIDRM), C_("errno", EILSEQ),
    C_("errno", EINPROGRESS), C_("errno", EINTR), C_("errno", EINVAL),
    C_("errno", EIO), C_("errno", EISCONN), C_("errno", EISDIR),
    C_("errno", ELOOP), C_("errno", EMFILE), C_("errno", EMLINK),
    C_("errno", EMSGSIZE), C_("errno", ENAMETOOLONG), C_("errno", ENETDOWN),
    C_("errno", ENETRESET), C_("errno", ENETUNREACH), C_("errno", ENFILE),
    C_("errno", ENOBUFS), C_("errno", ENODEV), C_("errno", ENOENT),
    C_("errno", ENOEXEC), C_("errno", ENOLCK), C_("errno", ENOMEM),
    C_("errno", ENOMSG), C_("errno", ENOPROTOOPT), C_("errno", ENOSPC),
    C_("errno", ENOSYS), C_("errno", ENOTCONN), C_("errno", ENOTDIR),
    C_("errno", ENOTEMPTY), C_("errno", ENOTSOCK), C_("errno", ENOTSUP),
    C_("errno", ENOTTY), C_("errno", ENXIO), C_("errno", EOVERFLOW),
    C_("errno", EPERM), C_("errno", EPIPE), C_("errno", EPROTO),
    C_("errno", EPROTONOSUPPORT), C_("errno", EPROTOTYPE), C_("errno", ERANGE),
    C_("errno", EROFS), C_("errno", ESPIPE), C_("errno", ESRCH),
    C_("errno", ETIMEDOUT), C_("errno", EXDEV),

    /* Node's own names, not the platform's: `uv_os_setpriority` takes a nice
     * value and node presents it as a scale. `src/node_os.cc`. */
    { "priority", "PRIORITY_LOW", 19 },
    { "priority", "PRIORITY_BELOW_NORMAL", 10 },
    { "priority", "PRIORITY_NORMAL", 0 },
    { "priority", "PRIORITY_ABOVE_NORMAL", -7 },
    { "priority", "PRIORITY_HIGH", -14 },
    { "priority", "PRIORITY_HIGHEST", -20 },

    C_("dlopen", RTLD_LAZY), C_("dlopen", RTLD_NOW),
    C_("dlopen", RTLD_GLOBAL), C_("dlopen", RTLD_LOCAL),
};
#undef C_

static const size_t OS_CONSTANT_COUNT = sizeof(OS_CONSTANTS) / sizeof(OS_CONSTANTS[0]);

NtsArray *nts_os_constant_groups(void) {
    NtsArray *a = nts_array_new(&nts_desc_ref, (double)OS_CONSTANT_COUNT);
    for (size_t i = 0; i < OS_CONSTANT_COUNT; i++) {
        NTS_ITEMS(a, void *)[i] = utf8(OS_CONSTANTS[i].group);
    }
    return a;
}

NtsArray *nts_os_constant_names(void) {
    NtsArray *a = nts_array_new(&nts_desc_ref, (double)OS_CONSTANT_COUNT);
    for (size_t i = 0; i < OS_CONSTANT_COUNT; i++) {
        NTS_ITEMS(a, void *)[i] = utf8(OS_CONSTANTS[i].name);
    }
    return a;
}

NtsArray *nts_os_constant_values(void) {
    NtsArray *a = nts_array_new(&nts_desc_double, (double)OS_CONSTANT_COUNT);
    for (size_t i = 0; i < OS_CONSTANT_COUNT; i++) {
        NTS_ITEMS(a, double)[i] = OS_CONSTANTS[i].value;
    }
    return a;
}
