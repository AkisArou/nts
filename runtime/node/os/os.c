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
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#if !defined(_WIN32)
#include <sys/socket.h>
#include <netinet/in.h>
#endif
#include <uv.h>
#include "os.h"
#include "../internal/shared.h"

static NtsString *utf8(const char *s) {
    return nts_string_from_utf8(s, s ? strlen(s) : 0);
}

static NtsArray *number_array(const double *items, size_t count) {
    NtsArray *a = nts_array_new(&nts_node_desc_double, (double)count);
    for (size_t i = 0; i < count; i++) {
        NTS_ITEMS(a, double)[i] = items[i];
    }
    return a;
}

static NtsArray *byte_array(const char *items) {
    size_t count = items ? strlen(items) : 0;
    NtsArray *a = nts_array_new(&nts_node_desc_double, (double)count);
    for (size_t i = 0; i < count; i++) {
        NTS_ITEMS(a, double)[i] = (double)(unsigned char)items[i];
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

/* `process.arch` and `process.platform` are what the *compiler* targeted, not
 * what the machine reports, so they are compile-time constants exactly as
 * node's `configure` bakes them in. */
static const char *architecture_name(void) {
#if defined(__x86_64__) || defined(_M_X64)
    return "x64";
#elif defined(__aarch64__) || defined(_M_ARM64)
    return "arm64";
#elif defined(__loongarch64) || defined(__loongarch64__)
    return "loong64";
#elif defined(__arm__) || defined(_M_ARM)
    return "arm";
#elif defined(__i386__) || defined(_M_IX86)
    return "ia32";
#elif defined(__mips__)
#if defined(__MIPSEL__) || defined(__MIPSEL) || defined(_MIPSEL)
    return "mipsel";
#else
    return "mips";
#endif
#elif defined(__riscv) && __riscv_xlen == 64
    return "riscv64";
#elif defined(__powerpc64__)
    return "ppc64";
#elif defined(__s390x__)
    return "s390x";
#else
#error "unsupported Node architecture"
#endif
}

static const char *platform_name(void) {
#if defined(__ANDROID__)
    return "android";
#elif defined(__linux__)
    return "linux";
#elif defined(__APPLE__)
    return "darwin";
#elif defined(__CYGWIN__)
    return "cygwin";
#elif defined(_WIN32)
    return "win32";
#elif defined(__FreeBSD__)
    return "freebsd";
#elif defined(__OpenBSD__)
    return "openbsd";
#elif defined(__sun)
    return "sunos";
#elif defined(_AIX)
    return "aix";
#elif defined(__HAIKU__)
    return "haiku";
#elif defined(__NetBSD__)
    return "netbsd";
#else
#error "unsupported Node platform"
#endif
}

static const char *endianness_name(void) {
    const uint16_t probe = 1;
    return *(const unsigned char *)&probe == 1 ? "LE" : "BE";
}

/* Node snapshots `uv_os_uname` when `lib/os.js` initializes. Architecture,
 * platform, and endianness are equally immutable for this addon instance, so
 * marshal all seven values through one typed module-initialization binding. */
NtsArray *nts_os_static_information(void) {
    uv_utsname_t info;
    int err = uv_os_uname(&info);
    NtsArray *result = nts_array_new(&nts_desc_ref, 7);
    void **fields = NTS_ITEMS(result, void *);
    fields[0] = utf8(err == 0 ? info.sysname : "");
    fields[1] = utf8(err == 0 ? info.version : "");
    fields[2] = utf8(err == 0 ? info.release : "");
    fields[3] = utf8(err == 0 ? info.machine : "");
    fields[4] = utf8(architecture_name());
    fields[5] = utf8(platform_name());
    fields[6] = utf8(endianness_name());
    return result;
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

/* One synchronous binding owns one libuv snapshot from allocation through
 * release. The outer reference array is the TypeScript tuple
 * `[models, numericColumns]`; each numeric row is speed, user, nice, sys,
 * idle, irq. No process-global hand-off exists for another Worker to race. */
NtsArray *nts_os_cpus(void) {
    uv_cpu_info_t *cpu_infos = NULL;
    int cpu_count = 0;
    int err = uv_cpu_info(&cpu_infos, &cpu_count);

    NtsArray *columns = nts_array_new(&nts_desc_ref, 2);
    NtsArray *models = nts_array_new(&nts_desc_ref, err == 0 ? cpu_count : 0);
    NtsArray *values = nts_array_new(
        &nts_node_desc_double, err == 0 ? (double)(cpu_count * 6) : 0);
    NTS_ITEMS(columns, void *)[0] = models;
    NTS_ITEMS(columns, void *)[1] = values;
    if (err != 0) {
        if (cpu_infos) uv_free_cpu_info(cpu_infos, cpu_count);
        return columns;
    }

    for (int i = 0; i < cpu_count; i++) {
        const uv_cpu_info_t *info = &cpu_infos[i];
        NTS_ITEMS(models, void *)[i] = utf8(info->model);
        double *at = &NTS_ITEMS(values, double)[i * 6];
        at[0] = (double)info->speed;
        at[1] = (double)info->cpu_times.user;
        at[2] = (double)info->cpu_times.nice;
        at[3] = (double)info->cpu_times.sys;
        at[4] = (double)info->cpu_times.idle;
        at[5] = (double)info->cpu_times.irq;
    }
    uv_free_cpu_info(cpu_infos, cpu_count);
    return columns;
}

/* ------------------------------------------------------------- interfaces */

/* One synchronous binding owns the complete libuv snapshot. The outer array
 * is the seven-array tuple consumed by TypeScript; it is populated before the
 * snapshot is released, so hot-plugged interfaces cannot misalign columns and
 * Workers share no mutable native state. */
NtsArray *nts_os_network_interfaces(void) {
    uv_interface_address_t *interfaces = NULL;
    int interface_count = 0;
    int err = uv_interface_addresses(&interfaces, &interface_count);
    int output_count = err == 0 ? interface_count : 0;
    if (err == UV_ENOSYS) {
        err = 0;
        output_count = 0;
    }
    nts_node_set_errno(err);

    NtsArray *columns = nts_array_new(&nts_desc_ref, 7);
    void **column = NTS_ITEMS(columns, void *);
    for (int i = 0; i < 5; i++) {
        column[i] = nts_array_new(&nts_desc_ref, (double)output_count);
    }
    column[5] = nts_array_new(&nts_node_desc_double, (double)output_count);
    column[6] = nts_array_new(&nts_node_desc_double, (double)output_count);
    if (err != 0) {
        if (interfaces) {
            uv_free_interface_addresses(interfaces, interface_count);
        }
        return columns;
    }

    NtsArray *names = column[0];
    NtsArray *addresses = column[1];
    NtsArray *netmasks = column[2];
    NtsArray *families = column[3];
    NtsArray *macs = column[4];
    NtsArray *internal = column[5];
    NtsArray *scopeids = column[6];

    for (int i = 0; i < output_count; i++) {
        const uv_interface_address_t *entry = &interfaces[i];
        char address[INET6_ADDRSTRLEN] = {0};
        char netmask[INET6_ADDRSTRLEN] = {0};
        const char *family = "unknown";
        uint32_t scopeid = 0;
        int address_family = entry->address.address4.sin_family;

        if (address_family == AF_INET) {
            uv_ip4_name(&entry->address.address4, address, sizeof address);
            uv_ip4_name(&entry->netmask.netmask4, netmask, sizeof netmask);
            family = "IPv4";
        } else if (address_family == AF_INET6) {
            uv_ip6_name(&entry->address.address6, address, sizeof address);
            uv_ip6_name(&entry->netmask.netmask6, netmask, sizeof netmask);
            family = "IPv6";
            scopeid = entry->address.address6.sin6_scope_id;
        } else {
            snprintf(address, sizeof address, "<unknown sa family>");
        }

        char mac[18];
        const unsigned char *physical =
            (const unsigned char *)entry->phys_addr;
        snprintf(mac, sizeof mac, "%02x:%02x:%02x:%02x:%02x:%02x",
                 physical[0], physical[1], physical[2], physical[3],
                 physical[4], physical[5]);

        NTS_ITEMS(names, void *)[i] = utf8(entry->name);
        NTS_ITEMS(addresses, void *)[i] = utf8(address);
        NTS_ITEMS(netmasks, void *)[i] = utf8(netmask);
        NTS_ITEMS(families, void *)[i] = utf8(family);
        NTS_ITEMS(macs, void *)[i] = utf8(mac);
        NTS_ITEMS(internal, double)[i] = entry->is_internal ? 1.0 : 0.0;
        NTS_ITEMS(scopeids, double)[i] =
            address_family == AF_INET6 ? (double)scopeid : -1.0;
    }
    if (interfaces) uv_free_interface_addresses(interfaces, interface_count);
    return columns;
}

/* ------------------------------------------------------------------- user */

NtsArray *nts_os_user_info(void) {
    uv_passwd_t passwd;
    int err = uv_os_get_passwd(&passwd);
    nts_node_set_errno(err);

    NtsArray *result = nts_array_new(&nts_desc_ref, 4);
    void **columns = NTS_ITEMS(result, void *);
    double identity_values[3] = {-1, -1, 0};
    if (err != 0) {
        columns[0] = number_array(identity_values, 3);
        columns[1] = byte_array(NULL);
        columns[2] = byte_array(NULL);
        columns[3] = byte_array(NULL);
        return result;
    }

#ifdef _WIN32
    identity_values[0] = (double)(int32_t)(uint32_t)passwd.uid;
    identity_values[1] = (double)(int32_t)(uint32_t)passwd.gid;
#else
    identity_values[0] = (double)passwd.uid;
    identity_values[1] = (double)passwd.gid;
#endif
    identity_values[2] = passwd.shell != NULL ? 1.0 : 0.0;
    columns[0] = number_array(identity_values, 3);
    columns[1] = byte_array(passwd.username);
    columns[2] = byte_array(passwd.homedir);
    columns[3] = byte_array(passwd.shell);
    uv_os_free_passwd(&passwd);
    return result;
}

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
#if !defined(_WIN32)
#include <dlfcn.h>
#endif

typedef struct { const char *group; const char *name; double value; } NtsOsConstant;

#define C_(g, n) { g, #n, (double)n }
static const NtsOsConstant OS_CONSTANTS[] = {
#ifdef SIGHUP
    C_("signals", SIGHUP),
#endif
#ifdef SIGINT
    C_("signals", SIGINT),
#endif
#ifdef SIGQUIT
    C_("signals", SIGQUIT),
#endif
#ifdef SIGILL
    C_("signals", SIGILL),
#endif
#ifdef SIGTRAP
    C_("signals", SIGTRAP),
#endif
#ifdef SIGABRT
    C_("signals", SIGABRT),
#endif
#ifdef SIGIOT
    C_("signals", SIGIOT),
#endif
#ifdef SIGBUS
    C_("signals", SIGBUS),
#endif
#ifdef SIGFPE
    C_("signals", SIGFPE),
#endif
#ifdef SIGKILL
    C_("signals", SIGKILL),
#endif
#ifdef SIGUSR1
    C_("signals", SIGUSR1),
#endif
#ifdef SIGSEGV
    C_("signals", SIGSEGV),
#endif
#ifdef SIGUSR2
    C_("signals", SIGUSR2),
#endif
#ifdef SIGPIPE
    C_("signals", SIGPIPE),
#endif
#ifdef SIGALRM
    C_("signals", SIGALRM),
#endif
    C_("signals", SIGTERM),
#ifdef SIGCHLD
    C_("signals", SIGCHLD),
#endif
#ifdef SIGSTKFLT
    C_("signals", SIGSTKFLT),
#endif
#ifdef SIGCONT
    C_("signals", SIGCONT),
#endif
#ifdef SIGSTOP
    C_("signals", SIGSTOP),
#endif
#ifdef SIGTSTP
    C_("signals", SIGTSTP),
#endif
#ifdef SIGBREAK
    C_("signals", SIGBREAK),
#endif
#ifdef SIGTTIN
    C_("signals", SIGTTIN),
#endif
#ifdef SIGTTOU
    C_("signals", SIGTTOU),
#endif
#ifdef SIGURG
    C_("signals", SIGURG),
#endif
#ifdef SIGXCPU
    C_("signals", SIGXCPU),
#endif
#ifdef SIGXFSZ
    C_("signals", SIGXFSZ),
#endif
#ifdef SIGVTALRM
    C_("signals", SIGVTALRM),
#endif
#ifdef SIGPROF
    C_("signals", SIGPROF),
#endif
#ifdef SIGWINCH
    C_("signals", SIGWINCH),
#endif
#ifdef SIGIO
    C_("signals", SIGIO),
#endif
#ifdef SIGPOLL
    C_("signals", SIGPOLL),
#endif
#ifdef SIGLOST
    C_("signals", SIGLOST),
#endif
#ifdef SIGPWR
    C_("signals", SIGPWR),
#endif
#ifdef SIGINFO
    C_("signals", SIGINFO),
#endif
#ifdef SIGSYS
    C_("signals", SIGSYS),
#endif
#ifdef SIGUNUSED
    C_("signals", SIGUNUSED),
#endif

#ifdef E2BIG
    C_("errno", E2BIG),
#endif
#ifdef EACCES
    C_("errno", EACCES),
#endif
#ifdef EADDRINUSE
    C_("errno", EADDRINUSE),
#endif
#ifdef EADDRNOTAVAIL
    C_("errno", EADDRNOTAVAIL),
#endif
#ifdef EAFNOSUPPORT
    C_("errno", EAFNOSUPPORT),
#endif
#ifdef EAGAIN
    C_("errno", EAGAIN),
#endif
#ifdef EALREADY
    C_("errno", EALREADY),
#endif
#ifdef EBADF
    C_("errno", EBADF),
#endif
#ifdef EBADMSG
    C_("errno", EBADMSG),
#endif
#ifdef EBUSY
    C_("errno", EBUSY),
#endif
#ifdef ECANCELED
    C_("errno", ECANCELED),
#endif
#ifdef ECHILD
    C_("errno", ECHILD),
#endif
#ifdef ECONNABORTED
    C_("errno", ECONNABORTED),
#endif
#ifdef ECONNREFUSED
    C_("errno", ECONNREFUSED),
#endif
#ifdef ECONNRESET
    C_("errno", ECONNRESET),
#endif
#ifdef EDEADLK
    C_("errno", EDEADLK),
#endif
#ifdef EDESTADDRREQ
    C_("errno", EDESTADDRREQ),
#endif
#ifdef EDOM
    C_("errno", EDOM),
#endif
#ifdef EDQUOT
    C_("errno", EDQUOT),
#endif
#ifdef EEXIST
    C_("errno", EEXIST),
#endif
#ifdef EFAULT
    C_("errno", EFAULT),
#endif
#ifdef EFBIG
    C_("errno", EFBIG),
#endif
#ifdef EHOSTUNREACH
    C_("errno", EHOSTUNREACH),
#endif
#ifdef EIDRM
    C_("errno", EIDRM),
#endif
#ifdef EILSEQ
    C_("errno", EILSEQ),
#endif
#ifdef EINPROGRESS
    C_("errno", EINPROGRESS),
#endif
#ifdef EINTR
    C_("errno", EINTR),
#endif
#ifdef EINVAL
    C_("errno", EINVAL),
#endif
#ifdef EIO
    C_("errno", EIO),
#endif
#ifdef EISCONN
    C_("errno", EISCONN),
#endif
#ifdef EISDIR
    C_("errno", EISDIR),
#endif
#ifdef ELOOP
    C_("errno", ELOOP),
#endif
#ifdef EMFILE
    C_("errno", EMFILE),
#endif
#ifdef EMLINK
    C_("errno", EMLINK),
#endif
#ifdef EMSGSIZE
    C_("errno", EMSGSIZE),
#endif
#ifdef EMULTIHOP
    C_("errno", EMULTIHOP),
#endif
#ifdef ENAMETOOLONG
    C_("errno", ENAMETOOLONG),
#endif
#ifdef ENETDOWN
    C_("errno", ENETDOWN),
#endif
#ifdef ENETRESET
    C_("errno", ENETRESET),
#endif
#ifdef ENETUNREACH
    C_("errno", ENETUNREACH),
#endif
#ifdef ENFILE
    C_("errno", ENFILE),
#endif
#ifdef ENOBUFS
    C_("errno", ENOBUFS),
#endif
#ifdef ENODATA
    C_("errno", ENODATA),
#endif
#ifdef ENODEV
    C_("errno", ENODEV),
#endif
#ifdef ENOENT
    C_("errno", ENOENT),
#endif
#ifdef ENOEXEC
    C_("errno", ENOEXEC),
#endif
#ifdef ENOLCK
    C_("errno", ENOLCK),
#endif
#ifdef ENOLINK
    C_("errno", ENOLINK),
#endif
#ifdef ENOMEM
    C_("errno", ENOMEM),
#endif
#ifdef ENOMSG
    C_("errno", ENOMSG),
#endif
#ifdef ENOPROTOOPT
    C_("errno", ENOPROTOOPT),
#endif
#ifdef ENOSPC
    C_("errno", ENOSPC),
#endif
#ifdef ENOSR
    C_("errno", ENOSR),
#endif
#ifdef ENOSTR
    C_("errno", ENOSTR),
#endif
#ifdef ENOSYS
    C_("errno", ENOSYS),
#endif
#ifdef ENOTCONN
    C_("errno", ENOTCONN),
#endif
#ifdef ENOTDIR
    C_("errno", ENOTDIR),
#endif
#ifdef ENOTEMPTY
    C_("errno", ENOTEMPTY),
#endif
#ifdef ENOTSOCK
    C_("errno", ENOTSOCK),
#endif
#ifdef ENOTSUP
    C_("errno", ENOTSUP),
#endif
#ifdef ENOTTY
    C_("errno", ENOTTY),
#endif
#ifdef ENXIO
    C_("errno", ENXIO),
#endif
#ifdef EOPNOTSUPP
    C_("errno", EOPNOTSUPP),
#endif
#ifdef EOVERFLOW
    C_("errno", EOVERFLOW),
#endif
#ifdef EPERM
    C_("errno", EPERM),
#endif
#ifdef EPIPE
    C_("errno", EPIPE),
#endif
#ifdef EPROTO
    C_("errno", EPROTO),
#endif
#ifdef EPROTONOSUPPORT
    C_("errno", EPROTONOSUPPORT),
#endif
#ifdef EPROTOTYPE
    C_("errno", EPROTOTYPE),
#endif
#ifdef ERANGE
    C_("errno", ERANGE),
#endif
#ifdef EROFS
    C_("errno", EROFS),
#endif
#ifdef ESPIPE
    C_("errno", ESPIPE),
#endif
#ifdef ESRCH
    C_("errno", ESRCH),
#endif
#ifdef ESTALE
    C_("errno", ESTALE),
#endif
#ifdef ETIME
    C_("errno", ETIME),
#endif
#ifdef ETIMEDOUT
    C_("errno", ETIMEDOUT),
#endif
#ifdef ETXTBSY
    C_("errno", ETXTBSY),
#endif
#ifdef EWOULDBLOCK
    C_("errno", EWOULDBLOCK),
#endif
#ifdef EXDEV
    C_("errno", EXDEV),
#endif

    /* `DefineWindowsErrorConstants`, immediately after the portable errno
     * table in pinned `node_constants.cc`. These names are supplied by
     * Winsock on Windows and disappear entirely on other platforms. */
#ifdef WSAEINTR
    C_("errno", WSAEINTR),
#endif
#ifdef WSAEBADF
    C_("errno", WSAEBADF),
#endif
#ifdef WSAEACCES
    C_("errno", WSAEACCES),
#endif
#ifdef WSAEFAULT
    C_("errno", WSAEFAULT),
#endif
#ifdef WSAEINVAL
    C_("errno", WSAEINVAL),
#endif
#ifdef WSAEMFILE
    C_("errno", WSAEMFILE),
#endif
#ifdef WSAEWOULDBLOCK
    C_("errno", WSAEWOULDBLOCK),
#endif
#ifdef WSAEINPROGRESS
    C_("errno", WSAEINPROGRESS),
#endif
#ifdef WSAEALREADY
    C_("errno", WSAEALREADY),
#endif
#ifdef WSAENOTSOCK
    C_("errno", WSAENOTSOCK),
#endif
#ifdef WSAEDESTADDRREQ
    C_("errno", WSAEDESTADDRREQ),
#endif
#ifdef WSAEMSGSIZE
    C_("errno", WSAEMSGSIZE),
#endif
#ifdef WSAEPROTOTYPE
    C_("errno", WSAEPROTOTYPE),
#endif
#ifdef WSAENOPROTOOPT
    C_("errno", WSAENOPROTOOPT),
#endif
#ifdef WSAEPROTONOSUPPORT
    C_("errno", WSAEPROTONOSUPPORT),
#endif
#ifdef WSAESOCKTNOSUPPORT
    C_("errno", WSAESOCKTNOSUPPORT),
#endif
#ifdef WSAEOPNOTSUPP
    C_("errno", WSAEOPNOTSUPP),
#endif
#ifdef WSAEPFNOSUPPORT
    C_("errno", WSAEPFNOSUPPORT),
#endif
#ifdef WSAEAFNOSUPPORT
    C_("errno", WSAEAFNOSUPPORT),
#endif
#ifdef WSAEADDRINUSE
    C_("errno", WSAEADDRINUSE),
#endif
#ifdef WSAEADDRNOTAVAIL
    C_("errno", WSAEADDRNOTAVAIL),
#endif
#ifdef WSAENETDOWN
    C_("errno", WSAENETDOWN),
#endif
#ifdef WSAENETUNREACH
    C_("errno", WSAENETUNREACH),
#endif
#ifdef WSAENETRESET
    C_("errno", WSAENETRESET),
#endif
#ifdef WSAECONNABORTED
    C_("errno", WSAECONNABORTED),
#endif
#ifdef WSAECONNRESET
    C_("errno", WSAECONNRESET),
#endif
#ifdef WSAENOBUFS
    C_("errno", WSAENOBUFS),
#endif
#ifdef WSAEISCONN
    C_("errno", WSAEISCONN),
#endif
#ifdef WSAENOTCONN
    C_("errno", WSAENOTCONN),
#endif
#ifdef WSAESHUTDOWN
    C_("errno", WSAESHUTDOWN),
#endif
#ifdef WSAETOOMANYREFS
    C_("errno", WSAETOOMANYREFS),
#endif
#ifdef WSAETIMEDOUT
    C_("errno", WSAETIMEDOUT),
#endif
#ifdef WSAECONNREFUSED
    C_("errno", WSAECONNREFUSED),
#endif
#ifdef WSAELOOP
    C_("errno", WSAELOOP),
#endif
#ifdef WSAENAMETOOLONG
    C_("errno", WSAENAMETOOLONG),
#endif
#ifdef WSAEHOSTDOWN
    C_("errno", WSAEHOSTDOWN),
#endif
#ifdef WSAEHOSTUNREACH
    C_("errno", WSAEHOSTUNREACH),
#endif
#ifdef WSAENOTEMPTY
    C_("errno", WSAENOTEMPTY),
#endif
#ifdef WSAEPROCLIM
    C_("errno", WSAEPROCLIM),
#endif
#ifdef WSAEUSERS
    C_("errno", WSAEUSERS),
#endif
#ifdef WSAEDQUOT
    C_("errno", WSAEDQUOT),
#endif
#ifdef WSAESTALE
    C_("errno", WSAESTALE),
#endif
#ifdef WSAEREMOTE
    C_("errno", WSAEREMOTE),
#endif
#ifdef WSASYSNOTREADY
    C_("errno", WSASYSNOTREADY),
#endif
#ifdef WSAVERNOTSUPPORTED
    C_("errno", WSAVERNOTSUPPORTED),
#endif
#ifdef WSANOTINITIALISED
    C_("errno", WSANOTINITIALISED),
#endif
#ifdef WSAEDISCON
    C_("errno", WSAEDISCON),
#endif
#ifdef WSAENOMORE
    C_("errno", WSAENOMORE),
#endif
#ifdef WSAECANCELLED
    C_("errno", WSAECANCELLED),
#endif
#ifdef WSAEINVALIDPROCTABLE
    C_("errno", WSAEINVALIDPROCTABLE),
#endif
#ifdef WSAEINVALIDPROVIDER
    C_("errno", WSAEINVALIDPROVIDER),
#endif
#ifdef WSAEPROVIDERFAILEDINIT
    C_("errno", WSAEPROVIDERFAILEDINIT),
#endif
#ifdef WSASYSCALLFAILURE
    C_("errno", WSASYSCALLFAILURE),
#endif
#ifdef WSASERVICE_NOT_FOUND
    C_("errno", WSASERVICE_NOT_FOUND),
#endif
#ifdef WSATYPE_NOT_FOUND
    C_("errno", WSATYPE_NOT_FOUND),
#endif
#ifdef WSA_E_NO_MORE
    C_("errno", WSA_E_NO_MORE),
#endif
#ifdef WSA_E_CANCELLED
    C_("errno", WSA_E_CANCELLED),
#endif
#ifdef WSAEREFUSED
    C_("errno", WSAEREFUSED),
#endif

    /* Node's own names, not the platform's: `uv_os_setpriority` takes a nice
     * value and node presents it as a scale. `src/node_os.cc`. */
#ifdef UV_PRIORITY_LOW
    { "priority", "PRIORITY_LOW", (double)UV_PRIORITY_LOW },
#endif
#ifdef UV_PRIORITY_BELOW_NORMAL
    { "priority", "PRIORITY_BELOW_NORMAL", (double)UV_PRIORITY_BELOW_NORMAL },
#endif
#ifdef UV_PRIORITY_NORMAL
    { "priority", "PRIORITY_NORMAL", (double)UV_PRIORITY_NORMAL },
#endif
#ifdef UV_PRIORITY_ABOVE_NORMAL
    { "priority", "PRIORITY_ABOVE_NORMAL", (double)UV_PRIORITY_ABOVE_NORMAL },
#endif
#ifdef UV_PRIORITY_HIGH
    { "priority", "PRIORITY_HIGH", (double)UV_PRIORITY_HIGH },
#endif
#ifdef UV_PRIORITY_HIGHEST
    { "priority", "PRIORITY_HIGHEST", (double)UV_PRIORITY_HIGHEST },
#endif

#ifdef RTLD_LAZY
    C_("dlopen", RTLD_LAZY),
#endif
#ifdef RTLD_NOW
    C_("dlopen", RTLD_NOW),
#endif
#ifdef RTLD_GLOBAL
    C_("dlopen", RTLD_GLOBAL),
#endif
#ifdef RTLD_LOCAL
    C_("dlopen", RTLD_LOCAL),
#endif
#ifdef RTLD_DEEPBIND
    C_("dlopen", RTLD_DEEPBIND),
#endif
};
#undef C_

static const size_t OS_CONSTANT_COUNT = sizeof(OS_CONSTANTS) / sizeof(OS_CONSTANTS[0]);

NtsArray *nts_os_constants(void) {
    NtsArray *columns = nts_array_new(&nts_desc_ref, 3);
    NtsArray *groups = nts_array_new(&nts_desc_ref, (double)OS_CONSTANT_COUNT);
    NtsArray *names = nts_array_new(&nts_desc_ref, (double)OS_CONSTANT_COUNT);
    NtsArray *values =
        nts_array_new(&nts_node_desc_double, (double)OS_CONSTANT_COUNT);
    NTS_ITEMS(columns, void *)[0] = groups;
    NTS_ITEMS(columns, void *)[1] = names;
    NTS_ITEMS(columns, void *)[2] = values;
    for (size_t i = 0; i < OS_CONSTANT_COUNT; i++) {
        NTS_ITEMS(groups, void *)[i] = utf8(OS_CONSTANTS[i].group);
        NTS_ITEMS(names, void *)[i] = utf8(OS_CONSTANTS[i].name);
        NTS_ITEMS(values, double)[i] = OS_CONSTANTS[i].value;
    }
    return columns;
}

double nts_os_udp_reuseaddr(void) { return (double)UV_UDP_REUSEADDR; }
