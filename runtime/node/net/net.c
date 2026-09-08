/* The native half of `node:net`, over libuv. See `nts_net.h`. */
#include <stdlib.h>
#include <string.h>
#include <uv.h>

#include "nts_net.h"
#include "shared.h"

/* Defaults from Node v24.20.0's EnvironmentOptions. NTS does not currently
 * consume Node engine flags, so there is no per-process override to apply at
 * this boundary. The public setters are maintained by the TypeScript module
 * after these initial values have been read. */
bool nts_net_default_auto_select_family(void) { return true; }

double nts_net_default_auto_select_family_attempt_timeout(void) {
    return 250.0;
}

/* ------------------------------------------------------------ the handles */

typedef enum { KIND_FREE = 0, KIND_BOUND, KIND_SOCKET, KIND_SERVER } Kind;

typedef struct {
    Kind kind;
    bool pipe;
    bool closing;
    union {
        uv_tcp_t tcp;
        uv_pipe_t named;
        uv_handle_t any;
        uv_stream_t stream;
    } h;
    /* Retained for the life of the entry. A started read owns its three, a
     * server owns its two, and nothing else holds them once TypeScript
     * returns. */
    NtsHeader *on_data;
    NtsHeader *on_end;
    NtsHeader *on_error;
    NtsHeader *on_connection;
    NtsHeader *on_closed;
} Entry;

static Entry *entries = NULL;
static size_t capacity = 0;

static uv_loop_t *loop(void) { return uv_default_loop(); }

static Entry *at(double handle, Kind kind) {
    if (!(handle >= 1.0)) return NULL;
    size_t index = (size_t)handle - 1;
    if (index >= capacity) return NULL;
    Entry *entry = &entries[index];
    if (entry->kind == KIND_FREE) return NULL;
    /* KIND_FREE as the wanted kind means "any live entry". */
    if (kind != KIND_FREE && entry->kind != kind) return NULL;
    return entry;
}

static double index_of(const Entry *entry) {
    return (double)((entry - entries) + 1);
}

/* A free slot, grown into if there is none. Returns NULL only out of memory. */
static Entry *claim(void) {
    size_t index = 0;
    while (index < capacity && entries[index].kind != KIND_FREE) index++;
    if (index == capacity) {
        size_t grown = capacity == 0 ? 8 : capacity * 2;
        Entry *moved = realloc(entries, grown * sizeof(Entry));
        if (moved == NULL) return NULL;
        memset(moved + capacity, 0, (grown - capacity) * sizeof(Entry));
        entries = moved;
        capacity = grown;
    }
    Entry *entry = &entries[index];
    memset(entry, 0, sizeof(*entry));
    return entry;
}

static NtsString *utf8(const char *text) {
    return nts_string_from_utf8(text, text == NULL ? 0 : strlen(text));
}

static char *cstring(const NtsString *value) {
    if (value == NULL) return NULL;
    size_t length = 0;
    return nts_node_to_utf8_alloc(value, &length);
}

/* Empty is not an absent argument: the module passes "" for an unused `path`
 * and an unused `host`, and only one of the two is meaningful per call. */
static bool given(const char *text) { return text != NULL && text[0] != '\0'; }

static void call_0(NtsHeader *callback) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *))
         callback->descriptor->methods[nts_closure_call_slot])(callback);
}

static void call_1n(NtsHeader *callback, double a) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double))
         callback->descriptor->methods[nts_closure_call_slot])(callback, a);
}

static void call_bytes(NtsHeader *callback, NtsView *bytes) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, NtsView *))
         callback->descriptor->methods[nts_closure_call_slot])(callback, bytes);
}

static void call_lookup(NtsHeader *callback, double status, NtsString *address,
                        double family) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, NtsString *, double))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, status, address, family);
}

static void call_lookup_all(NtsHeader *callback, double status,
                            NtsArray *addresses, NtsArray *families) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, NtsArray *, NtsArray *))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, status, addresses, families);
}

static void hold(NtsHeader **slot, NtsHeader *value) {
    if (*slot != NULL) nts_release(*slot);
    *slot = value;
    if (value != NULL) nts_retain(value);
}

/* ----------------------------------------------------------- addresses */

/* Every address question answers from one of these two. `remote` is only
 * meaningful for a connected socket; a bound or listening handle has one
 * address and it is the local one. */
static int address_of(Entry *entry, bool remote, struct sockaddr_storage *out) {
    int length = (int)sizeof(*out);
    if (entry->pipe) {
        /* A pipe has a path, not a sockaddr. The text accessor handles it; the
         * numeric one has nothing to say, which is what the empty array is. */
        return UV_EINVAL;
    }
    return remote ? uv_tcp_getpeername(&entry->h.tcp, (struct sockaddr *)out,
                                       &length)
                  : uv_tcp_getsockname(&entry->h.tcp, (struct sockaddr *)out,
                                       &length);
}

static NtsString *address_text_of(Entry *entry, bool remote) {
    if (entry == NULL) return utf8("");
    if (entry->pipe) {
        char path[4096] = {0};
        size_t size = sizeof(path);
        int status = remote ? uv_pipe_getpeername(&entry->h.named, path, &size)
                            : uv_pipe_getsockname(&entry->h.named, path, &size);
        return utf8(status == 0 ? path : "");
    }
    struct sockaddr_storage found;
    if (address_of(entry, remote, &found) != 0) return utf8("");
    char text[INET6_ADDRSTRLEN] = {0};
    if (found.ss_family == AF_INET6) {
        uv_ip6_name((struct sockaddr_in6 *)&found, text, sizeof(text));
    } else {
        uv_ip4_name((struct sockaddr_in *)&found, text, sizeof(text));
    }
    return utf8(text);
}

/* `[family, port]`, or empty when there is no address -- the shape the module
 * reads, and the empty array is how it learns there is none. */
static NtsArray *address_numbers_of(Entry *entry, bool remote) {
    struct sockaddr_storage found;
    if (entry == NULL || address_of(entry, remote, &found) != 0) {
        return nts_array_new(&nts_node_desc_double, 0);
    }
    NtsArray *result = nts_array_new(&nts_node_desc_double, 2);
    double *items = NTS_ITEMS(result, double);
    if (found.ss_family == AF_INET6) {
        items[0] = 6.0;
        items[1] = (double)ntohs(((struct sockaddr_in6 *)&found)->sin6_port);
    } else {
        items[0] = 4.0;
        items[1] = (double)ntohs(((struct sockaddr_in *)&found)->sin_port);
    }
    return result;
}

NtsString *nts_net_address_text(double handle, bool remote) {
    return address_text_of(at(handle, KIND_SOCKET), remote);
}
NtsArray *nts_net_address_numbers(double handle, bool remote) {
    return address_numbers_of(at(handle, KIND_SOCKET), remote);
}
NtsString *nts_net_bound_address_text(double handle) {
    return address_text_of(at(handle, KIND_BOUND), false);
}
NtsArray *nts_net_bound_address_numbers(double handle) {
    return address_numbers_of(at(handle, KIND_BOUND), false);
}
NtsString *nts_net_server_address_text(double handle) {
    return address_text_of(at(handle, KIND_SERVER), false);
}
NtsArray *nts_net_server_address_numbers(double handle) {
    return address_numbers_of(at(handle, KIND_SERVER), false);
}

/* ---------------------------------------------------------- construction */

/* Initialise the transport the arguments imply. A `path` means a pipe; the
 * module passes empty for the one it is not using, which is why `given` and
 * not a null check decides. */
static int start_handle(Entry *entry, bool pipe) {
    entry->pipe = pipe;
    if (pipe) return uv_pipe_init(loop(), &entry->h.named, 0);
    return uv_tcp_init(loop(), &entry->h.tcp);
}

/* One address, from a host and port, either family. */
static int resolve(const char *host, double port,
                   struct sockaddr_storage *out) {
    int status = uv_ip4_addr(host, (int)port, (struct sockaddr_in *)out);
    if (status == 0) return 0;
    return uv_ip6_addr(host, (int)port, (struct sockaddr_in6 *)out);
}

double nts_net_bind(NtsString *host, double port, NtsString *path, bool pipe,
                    bool ipv6_only, bool reuse_port) {
    char *name = cstring(host);
    char *where = cstring(path);
    Entry *entry = claim();
    if (entry == NULL) {
        free(name);
        free(where);
        return UV_ENOMEM;
    }
    int status = start_handle(entry, pipe);
    if (status != 0) goto done;

    if (pipe) {
        status = uv_pipe_bind(&entry->h.named, given(where) ? where : "");
    } else {
        struct sockaddr_storage target;
        status = resolve(given(name) ? name : "0.0.0.0", port, &target);
        if (status == 0) {
            unsigned int flags = 0;
            if (ipv6_only) flags |= UV_TCP_IPV6ONLY;
#ifdef UV_TCP_REUSEPORT
            if (reuse_port) flags |= UV_TCP_REUSEPORT;
#else
            (void)reuse_port;
#endif
            status = uv_tcp_bind(&entry->h.tcp,
                                 (const struct sockaddr *)&target, flags);
        }
    }

done:
    free(name);
    free(where);
    if (status != 0) {
        /* Never started, or started and now useless. An initialised handle
         * has to be closed rather than forgotten, and the slot cannot be
         * reused until libuv says so. */
        entry->kind = KIND_FREE;
        return (double)status;
    }
    entry->kind = KIND_BOUND;
    return index_of(entry);
}

double nts_net_bound_fd(double handle) {
    Entry *entry = at(handle, KIND_BOUND);
    if (entry == NULL) return UV_EBADF;
    uv_os_fd_t fd;
    int status = uv_fileno(&entry->h.any, &fd);
    return status != 0 ? (double)status : (double)(intptr_t)fd;
}

static void on_handle_closed(uv_handle_t *handle) {
    Entry *entry = (Entry *)handle->data;
    if (entry == NULL) return;
    NtsHeader *closed = entry->on_closed;
    if (entry->on_data != NULL) nts_release(entry->on_data);
    if (entry->on_end != NULL) nts_release(entry->on_end);
    if (entry->on_error != NULL) nts_release(entry->on_error);
    if (entry->on_connection != NULL) nts_release(entry->on_connection);
    entry->on_data = NULL;
    entry->on_end = NULL;
    entry->on_error = NULL;
    entry->on_connection = NULL;
    entry->on_closed = NULL;
    entry->kind = KIND_FREE;
    /* Last, and after the slot is free: the callback may open another handle
     * and would otherwise be handed this one. */
    call_0(closed);
    if (closed != NULL) nts_release(closed);
}

static void close_entry(Entry *entry, NtsHeader *callback) {
    if (entry == NULL) {
        call_0(callback);
        return;
    }
    if (entry->closing || uv_is_closing(&entry->h.any)) {
        call_0(callback);
        return;
    }
    entry->closing = true;
    hold(&entry->on_closed, callback);
    entry->h.any.data = entry;
    uv_close(&entry->h.any, on_handle_closed);
}

double nts_net_bound_close(double handle) {
    Entry *entry = at(handle, KIND_BOUND);
    if (entry == NULL) return UV_EBADF;
    close_entry(entry, NULL);
    return 0.0;
}

void nts_net_close(double handle, NtsHeader *callback) {
    close_entry(at(handle, KIND_SOCKET), callback);
}

void nts_net_server_close(double handle, NtsHeader *callback) {
    close_entry(at(handle, KIND_SERVER), callback);
}

double nts_net_adopt_fd(double fd, bool readable, bool writable) {
    (void)readable;
    (void)writable;
    Entry *entry = claim();
    if (entry == NULL) return UV_ENOMEM;
    int status = uv_tcp_init(loop(), &entry->h.tcp);
    if (status == 0) {
        status = uv_tcp_open(&entry->h.tcp, (uv_os_sock_t)(intptr_t)fd);
    }
    if (status != 0) {
        entry->kind = KIND_FREE;
        return (double)status;
    }
    entry->kind = KIND_SOCKET;
    entry->h.any.data = entry;
    return index_of(entry);
}

/* ------------------------------------------------------------- connecting */

typedef struct {
    uv_connect_t request;
    NtsHeader *callback;
    Entry *entry;
} ConnectRequest;

static void on_connected(uv_connect_t *request, int status) {
    ConnectRequest *connect = (ConnectRequest *)request;
    if (status == 0 && connect->entry != NULL) {
        connect->entry->kind = KIND_SOCKET;
    }
    call_1n(connect->callback, (double)status);
    if (connect->callback != NULL) nts_release(connect->callback);
    free(connect);
}

static double connect_entry(Entry *entry, const char *host, double port,
                            const char *path, NtsHeader *callback) {
    ConnectRequest *request = calloc(1, sizeof(ConnectRequest));
    if (request == NULL) return UV_ENOMEM;
    request->callback = callback;
    request->entry = entry;
    if (callback != NULL) nts_retain(callback);

    if (entry->pipe) {
        /* `uv_pipe_connect2` reports failure through the callback rather than
         * a return code, which is the shape everything else here has. */
        int status = uv_pipe_connect2(&request->request, &entry->h.named,
                                      given(path) ? path : "",
                                      given(path) ? strlen(path) : 0, 0,
                                      on_connected);
        if (status != 0) {
            if (callback != NULL) nts_release(callback);
            free(request);
        }
        return (double)status;
    }

    struct sockaddr_storage target;
    int status = resolve(given(host) ? host : "127.0.0.1", port, &target);
    if (status == 0) {
        status = uv_tcp_connect(&request->request, &entry->h.tcp,
                                (const struct sockaddr *)&target, on_connected);
    }
    if (status != 0) {
        if (callback != NULL) nts_release(callback);
        free(request);
    }
    return (double)status;
}

double nts_net_connect(NtsString *host, double port, NtsString *path,
                       NtsString *local_address, double local_port,
                       NtsHeader *callback) {
    char *name = cstring(host);
    char *where = cstring(path);
    char *from = cstring(local_address);
    Entry *entry = claim();
    if (entry == NULL) {
        free(name);
        free(where);
        free(from);
        return UV_ENOMEM;
    }
    int status = start_handle(entry, given(where));
    if (status == 0 && !entry->pipe && (given(from) || local_port != 0.0)) {
        /* A local address is a bind before the connect, and node reports a
         * failure here as the connect's failure rather than a separate one. */
        struct sockaddr_storage local;
        status = resolve(given(from) ? from : "0.0.0.0", local_port, &local);
        if (status == 0) {
            status = uv_tcp_bind(&entry->h.tcp,
                                 (const struct sockaddr *)&local, 0);
        }
    }
    if (status != 0) {
        entry->kind = KIND_FREE;
        free(name);
        free(where);
        free(from);
        return (double)status;
    }

    entry->kind = KIND_BOUND;
    entry->h.any.data = entry;
    double result = connect_entry(entry, name, port, where, callback);
    free(name);
    free(where);
    free(from);
    if (result != 0.0) entry->kind = KIND_FREE;
    return result != 0.0 ? result : index_of(entry);
}

double nts_net_connect_bound(double handle, NtsString *host, double port,
                             NtsString *path, NtsHeader *callback) {
    Entry *entry = at(handle, KIND_BOUND);
    if (entry == NULL) return UV_EBADF;
    char *name = cstring(host);
    char *where = cstring(path);
    double status = connect_entry(entry, name, port, where, callback);
    free(name);
    free(where);
    return status;
}

/* ------------------------------------------------------------- streaming */

static void on_alloc(uv_handle_t *handle, size_t suggested, uv_buf_t *buffer) {
    (void)handle;
    buffer->base = malloc(suggested);
    buffer->len = buffer->base == NULL ? 0 : suggested;
}

static NtsView *bytes_view(const char *bytes, size_t length) {
    NtsBuffer *buffer = nts_buffer_new((double)length);
    if (buffer == NULL) return NULL;
    if (length != 0) memcpy(buffer->bytes, bytes, length);
    return nts_view_new(buffer, 0.0, (double)length, (double)NTS_ELEMENT_U8,
                        false);
}

static void on_read(uv_stream_t *stream, ssize_t count, const uv_buf_t *buffer) {
    Entry *entry = (Entry *)stream->data;
    if (entry == NULL) {
        free(buffer->base);
        return;
    }
    if (count == UV_EOF) {
        free(buffer->base);
        call_0(entry->on_end);
        return;
    }
    if (count < 0) {
        free(buffer->base);
        call_1n(entry->on_error, (double)count);
        return;
    }
    /* Zero is libuv saying "nothing readable this time", which is not an empty
     * chunk. Delivering it would give the module a zero-length `data` event
     * node never emits. */
    if (count == 0) {
        free(buffer->base);
        return;
    }
    NtsView *bytes = bytes_view(buffer->base, (size_t)count);
    free(buffer->base);
    if (bytes == NULL) {
        call_1n(entry->on_error, (double)UV_ENOMEM);
        return;
    }
    call_bytes(entry->on_data, bytes);
}

void nts_net_read_start(double handle, NtsHeader *on_data, NtsHeader *on_end,
                        NtsHeader *on_error) {
    Entry *entry = at(handle, KIND_SOCKET);
    if (entry == NULL) return;
    hold(&entry->on_data, on_data);
    hold(&entry->on_end, on_end);
    hold(&entry->on_error, on_error);
    entry->h.any.data = entry;
    uv_read_start(&entry->h.stream, on_alloc, on_read);
}

void nts_net_read_stop(double handle) {
    Entry *entry = at(handle, KIND_SOCKET);
    if (entry == NULL) return;
    uv_read_stop(&entry->h.stream);
}

typedef struct {
    uv_write_t request;
    NtsHeader *callback;
} WriteRequest;

static void on_written(uv_write_t *request, int status) {
    WriteRequest *write = (WriteRequest *)request;
    call_1n(write->callback, (double)status);
    if (write->callback != NULL) nts_release(write->callback);
    free(write);
}

double nts_net_write(double handle, NtsView *bytes, NtsHeader *callback) {
    Entry *entry = at(handle, KIND_SOCKET);
    if (entry == NULL) return UV_EBADF;
    WriteRequest *request = calloc(1, sizeof(WriteRequest));
    if (request == NULL) return UV_ENOMEM;
    request->callback = callback;
    if (callback != NULL) nts_retain(callback);

    /* libuv copies nothing: the buffer has to outlive the write. It does --
     * the view is reachable from the TypeScript side until the callback runs,
     * and the callback is what releases it. */
    uv_buf_t buffer = uv_buf_init(
        bytes == NULL ? NULL : (char *)nts_view_bytes(bytes),
        bytes == NULL ? 0 : (unsigned int)nts_view_byte_length(bytes));
    int status = uv_write(&request->request, &entry->h.stream, &buffer, 1,
                          on_written);
    if (status != 0) {
        if (callback != NULL) nts_release(callback);
        free(request);
    }
    return (double)status;
}

typedef struct {
    uv_shutdown_t request;
    NtsHeader *callback;
} ShutdownRequest;

static void on_shutdown(uv_shutdown_t *request, int status) {
    ShutdownRequest *down = (ShutdownRequest *)request;
    call_1n(down->callback, (double)status);
    if (down->callback != NULL) nts_release(down->callback);
    free(down);
}

void nts_net_shutdown(double handle, NtsHeader *callback) {
    Entry *entry = at(handle, KIND_SOCKET);
    if (entry == NULL) {
        call_1n(callback, (double)UV_EBADF);
        return;
    }
    ShutdownRequest *request = calloc(1, sizeof(ShutdownRequest));
    if (request == NULL) {
        call_1n(callback, (double)UV_ENOMEM);
        return;
    }
    request->callback = callback;
    if (callback != NULL) nts_retain(callback);
    int status = uv_shutdown(&request->request, &entry->h.stream, on_shutdown);
    if (status != 0) {
        if (callback != NULL) nts_release(callback);
        free(request);
        call_1n(callback, (double)status);
    }
}

void nts_net_reset(double handle, NtsHeader *callback) {
    Entry *entry = at(handle, KIND_SOCKET);
    if (entry == NULL) {
        call_1n(callback, (double)UV_EBADF);
        return;
    }
    /* A reset is an abortive close: RST rather than FIN, so the peer sees
     * ECONNRESET. `uv_tcp_close_reset` both sends it and closes, which is why
     * this does not also call `close_entry`. */
    hold(&entry->on_closed, NULL);
    int status = entry->pipe
                     ? UV_ENOTSUP
                     : uv_tcp_close_reset(&entry->h.tcp, on_handle_closed);
    if (status != 0) {
        call_1n(callback, (double)status);
        return;
    }
    entry->closing = true;
    entry->h.any.data = entry;
    call_1n(callback, 0.0);
}

/* --------------------------------------------------------------- options */

void nts_net_set_no_delay(double handle, bool enable) {
    Entry *entry = at(handle, KIND_SOCKET);
    if (entry == NULL || entry->pipe) return;
    uv_tcp_nodelay(&entry->h.tcp, enable ? 1 : 0);
}

void nts_net_set_keepalive(double handle, bool enable, double delay) {
    Entry *entry = at(handle, KIND_SOCKET);
    if (entry == NULL || entry->pipe) return;
    uv_tcp_keepalive(&entry->h.tcp, enable ? 1 : 0, (unsigned int)delay);
}

/* libuv has no type-of-service call, so these two go through the socket
 * directly. IPv6 spells the same field `IPV6_TCLASS`, and asking for the wrong
 * one answers ENOPROTOOPT rather than a wrong number. */
static int tos_option(Entry *entry, int *level, int *name) {
    struct sockaddr_storage found;
    int length = (int)sizeof(found);
    if (uv_tcp_getsockname(&entry->h.tcp, (struct sockaddr *)&found, &length) !=
        0) {
        return UV_EBADF;
    }
    if (found.ss_family == AF_INET6) {
        *level = IPPROTO_IPV6;
        *name = IPV6_TCLASS;
    } else {
        *level = IPPROTO_IP;
        *name = IP_TOS;
    }
    return 0;
}

double nts_net_set_tos(double handle, double value) {
    Entry *entry = at(handle, KIND_SOCKET);
    if (entry == NULL || entry->pipe) return UV_EBADF;
    int level = 0, name = 0;
    int status = tos_option(entry, &level, &name);
    if (status != 0) return (double)status;
    uv_os_fd_t fd;
    if (uv_fileno(&entry->h.any, &fd) != 0) return UV_EBADF;
    int setting = (int)value;
    if (setsockopt((int)(intptr_t)fd, level, name, &setting, sizeof(setting)) !=
        0) {
        return (double)uv_translate_sys_error(errno);
    }
    return 0.0;
}

double nts_net_get_tos(double handle) {
    Entry *entry = at(handle, KIND_SOCKET);
    if (entry == NULL || entry->pipe) return UV_EBADF;
    int level = 0, name = 0;
    int status = tos_option(entry, &level, &name);
    if (status != 0) return (double)status;
    uv_os_fd_t fd;
    if (uv_fileno(&entry->h.any, &fd) != 0) return UV_EBADF;
    int setting = 0;
    socklen_t size = sizeof(setting);
    if (getsockopt((int)(intptr_t)fd, level, name, &setting, &size) != 0) {
        return (double)uv_translate_sys_error(errno);
    }
    return (double)setting;
}

static void toggle_ref(Entry *entry, bool keep_process_alive) {
    if (entry == NULL) return;
    if (keep_process_alive) {
        uv_ref(&entry->h.any);
    } else {
        uv_unref(&entry->h.any);
    }
}

void nts_net_ref(double handle, bool keep_process_alive) {
    toggle_ref(at(handle, KIND_SOCKET), keep_process_alive);
}

void nts_net_server_ref(double handle, bool keep_process_alive) {
    toggle_ref(at(handle, KIND_SERVER), keep_process_alive);
}

/* --------------------------------------------------------------- serving */

static void on_incoming(uv_stream_t *server, int status) {
    Entry *entry = (Entry *)server->data;
    if (entry == NULL) return;
    if (status != 0) {
        call_1n(entry->on_error, (double)status);
        return;
    }
    Entry *accepted = claim();
    if (accepted == NULL) {
        call_1n(entry->on_error, (double)UV_ENOMEM);
        return;
    }
    /* `claim` may have grown the table and moved every entry, so the server's
     * own pointer is refreshed from the loop's rather than reused. This is the
     * one place a realloc can happen while another entry is live on the stack. */
    entry = (Entry *)server->data;

    int started = start_handle(accepted, entry->pipe);
    if (started == 0) started = uv_accept(server, &accepted->h.stream);
    if (started != 0) {
        accepted->kind = KIND_FREE;
        call_1n(entry->on_error, (double)started);
        return;
    }
    accepted->kind = KIND_SOCKET;
    accepted->h.any.data = accepted;
    call_1n(entry->on_connection, index_of(accepted));
}

double nts_net_listen(NtsString *host, double port, NtsString *path,
                      double backlog, bool ipv6_only, bool reuse_port,
                      bool readable_all, bool writable_all, double fd,
                      double bound_handle, NtsHeader *on_listening,
                      NtsHeader *on_connection, NtsHeader *on_error) {
    Entry *entry = NULL;
    int status = 0;

    if (bound_handle >= 1.0) {
        /* Listening on an address that was bound earlier: the handle becomes
         * the server rather than a second one being made for it. */
        entry = at(bound_handle, KIND_BOUND);
        if (entry == NULL) return UV_EBADF;
    } else {
        char *name = cstring(host);
        char *where = cstring(path);
        entry = claim();
        if (entry == NULL) {
            free(name);
            free(where);
            return UV_ENOMEM;
        }
        status = start_handle(entry, given(where));
        if (status == 0) {
            if (entry->pipe) {
                status = uv_pipe_bind(&entry->h.named, where);
            } else if (fd >= 0.0) {
                status = uv_tcp_open(&entry->h.tcp, (uv_os_sock_t)(intptr_t)fd);
            } else {
                struct sockaddr_storage target;
                status = resolve(given(name) ? name : "0.0.0.0", port, &target);
                if (status == 0) {
                    unsigned int flags = 0;
                    if (ipv6_only) flags |= UV_TCP_IPV6ONLY;
#ifdef UV_TCP_REUSEPORT
                    if (reuse_port) flags |= UV_TCP_REUSEPORT;
#else
                    (void)reuse_port;
#endif
                    status = uv_tcp_bind(&entry->h.tcp,
                                         (const struct sockaddr *)&target,
                                         flags);
                }
            }
        }
        free(name);
        free(where);
        if (status != 0) {
            entry->kind = KIND_FREE;
            return (double)status;
        }
    }

    if (entry->pipe) {
        /* Node's `readableAll`/`writableAll` are the pipe's permissions, and
         * libuv spells them as one chmod call. */
        int mode = 0;
        if (readable_all) mode |= UV_READABLE;
        if (writable_all) mode |= UV_WRITABLE;
        if (mode != 0) uv_pipe_chmod(&entry->h.named, mode);
    }

    hold(&entry->on_connection, on_connection);
    hold(&entry->on_error, on_error);
    entry->h.any.data = entry;
    status = uv_listen(&entry->h.stream, (int)backlog, on_incoming);
    if (status != 0) {
        entry->kind = KIND_FREE;
        return (double)status;
    }
    entry->kind = KIND_SERVER;
    /* Node emits `listening` on the next turn, not from inside `listen`. The
     * module owns that scheduling; calling here would run it a turn early. */
    call_0(on_listening);
    return index_of(entry);
}

/* -------------------------------------------------------------- resolving */

typedef struct {
    uv_getaddrinfo_t request;
    NtsHeader *callback;
    bool all;
} LookupRequest;

static void on_resolved(uv_getaddrinfo_t *request, int status,
                        struct addrinfo *result) {
    LookupRequest *lookup = (LookupRequest *)request;
    char text[INET6_ADDRSTRLEN] = {0};

    if (!lookup->all) {
        double family = 0.0;
        if (status == 0 && result != NULL) {
            if (result->ai_family == AF_INET6) {
                uv_ip6_name((struct sockaddr_in6 *)result->ai_addr, text,
                            sizeof(text));
                family = 6.0;
            } else {
                uv_ip4_name((struct sockaddr_in *)result->ai_addr, text,
                            sizeof(text));
                family = 4.0;
            }
        }
        call_lookup(lookup->callback, (double)status, utf8(text), family);
    } else {
        size_t count = 0;
        for (struct addrinfo *each = result; each != NULL; each = each->ai_next) {
            count++;
        }
        NtsArray *addresses = nts_array_new(&nts_desc_ref, (double)count);
        NtsArray *families = nts_array_new(&nts_node_desc_double, (double)count);
        void **texts = NTS_ITEMS(addresses, void *);
        double *kinds = NTS_ITEMS(families, double);
        size_t index = 0;
        for (struct addrinfo *each = result; each != NULL; each = each->ai_next) {
            char one[INET6_ADDRSTRLEN] = {0};
            if (each->ai_family == AF_INET6) {
                uv_ip6_name((struct sockaddr_in6 *)each->ai_addr, one,
                            sizeof(one));
                kinds[index] = 6.0;
            } else {
                uv_ip4_name((struct sockaddr_in *)each->ai_addr, one,
                            sizeof(one));
                kinds[index] = 4.0;
            }
            texts[index] = utf8(one);
            index++;
        }
        call_lookup_all(lookup->callback, (double)status, addresses, families);
    }

    if (lookup->callback != NULL) nts_release(lookup->callback);
    if (result != NULL) uv_freeaddrinfo(result);
    free(lookup);
}

static void start_lookup(NtsString *host, double family, NtsHeader *callback,
                         bool all) {
    LookupRequest *lookup = calloc(1, sizeof(LookupRequest));
    if (lookup == NULL) {
        if (all) {
            call_lookup_all(callback, (double)UV_ENOMEM,
                            nts_array_new(&nts_desc_ref, 0),
                            nts_array_new(&nts_node_desc_double, 0));
        } else {
            call_lookup(callback, (double)UV_ENOMEM, utf8(""), 0.0);
        }
        return;
    }
    lookup->callback = callback;
    lookup->all = all;
    if (callback != NULL) nts_retain(callback);

    struct addrinfo hints;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = family == 6.0   ? AF_INET6
                      : family == 4.0 ? AF_INET
                                      : AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;

    char *name = cstring(host);
    int status = uv_getaddrinfo(loop(), &lookup->request, on_resolved,
                                name == NULL ? "" : name, NULL, &hints);
    free(name);
    if (status != 0) {
        if (callback != NULL) nts_release(callback);
        free(lookup);
        if (all) {
            call_lookup_all(callback, (double)status,
                            nts_array_new(&nts_desc_ref, 0),
                            nts_array_new(&nts_node_desc_double, 0));
        } else {
            call_lookup(callback, (double)status, utf8(""), 0.0);
        }
    }
}

void nts_net_lookup(NtsString *host, double family, NtsHeader *callback) {
    start_lookup(host, family, callback, false);
}

void nts_net_lookup_all(NtsString *host, double family, NtsHeader *callback) {
    start_lookup(host, family, callback, true);
}
