/* The native half of `node:dgram`, over libuv. See `nts_dgram.h`. */
#include <stdlib.h>
#include <string.h>
#include <uv.h>

#include "nts_dgram.h"
#include "shared.h"

/* One open socket. Handles are 1-based indices into `sockets`, so 0 is never a
 * live handle and a zeroed slot is a free one. */
typedef struct {
    uv_udp_t udp;
    bool used;
    bool refed;
    bool connected;
    /* Retained for the life of the socket: a started read owns its callbacks,
     * and nothing else holds them once the TypeScript side returns. */
    NtsHeader *on_message;
    NtsHeader *on_error;
} Socket;

static Socket *sockets = NULL;
static size_t socket_capacity = 0;

static uv_loop_t *loop(void) { return uv_default_loop(); }

static Socket *at(double handle) {
    if (!(handle >= 1.0)) return NULL;
    size_t index = (size_t)handle - 1;
    if (index >= socket_capacity) return NULL;
    Socket *socket = &sockets[index];
    return socket->used ? socket : NULL;
}

static NtsString *utf8(const char *text) {
    return nts_string_from_utf8(text, text == NULL ? 0 : strlen(text));
}

/* The caller frees. `nts_node_to_utf8_alloc` is the shared one; this wrapper
 * exists so a null string reads as the empty string rather than as a crash,
 * which is what every option here wants. */
static char *cstring(const NtsString *value) {
    if (value == NULL) return NULL;
    size_t length = 0;
    return nts_node_to_utf8_alloc(value, &length);
}

/* `[errno]`, the shape `address` answers with when there is no address. */
static NtsArray *one_errno(int status) {
    NtsArray *result = nts_array_new(&nts_node_desc_value, 1);
    NTS_ITEMS(result, NtsValue)[0] = nts_value_of_number((double)status);
    return result;
}

double nts_udp_new(NtsString *type, bool reuse_addr, bool reuse_port,
                   bool ipv6_only) {
    char *kind = cstring(type);
    if (kind == NULL) return UV_ENOMEM;
    unsigned int domain = strcmp(kind, "udp6") == 0 ? AF_INET6 : AF_INET;
    free(kind);

    size_t index = 0;
    while (index < socket_capacity && sockets[index].used) index++;
    if (index == socket_capacity) {
        size_t grown = socket_capacity == 0 ? 8 : socket_capacity * 2;
        Socket *moved = realloc(sockets, grown * sizeof(Socket));
        if (moved == NULL) return UV_ENOMEM;
        memset(moved + socket_capacity, 0,
               (grown - socket_capacity) * sizeof(Socket));
        sockets = moved;
        socket_capacity = grown;
    }

    Socket *socket = &sockets[index];
    memset(socket, 0, sizeof(*socket));

    /* `UV_UDP_RECVMMSG` is deliberately not set. It changes how many datagrams
     * one read delivers, and the module above reports one `message` event per
     * datagram either way -- but the allocation callback then has to size for a
     * batch, and getting that wrong loses mail rather than failing loudly. */
    unsigned int flags = domain;
    if (reuse_addr) flags |= UV_UDP_REUSEADDR;
#ifdef UV_UDP_REUSEPORT
    if (reuse_port) flags |= UV_UDP_REUSEPORT;
#else
    (void)reuse_port;
#endif
    if (ipv6_only && domain == AF_INET6) flags |= UV_UDP_IPV6ONLY;

    int status = uv_udp_init_ex(loop(), &socket->udp, flags);
    if (status != 0) return (double)status;

    socket->udp.data = socket;
    socket->used = true;
    socket->refed = true;
    return (double)(index + 1);
}

double nts_udp_bind_sync(double handle, NtsString *address, double port) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    char *host = cstring(address);
    if (host == NULL) return UV_ENOMEM;

    struct sockaddr_storage target;
    int status = uv_ip4_addr(host, (int)port, (struct sockaddr_in *)&target);
    if (status != 0) {
        status = uv_ip6_addr(host, (int)port, (struct sockaddr_in6 *)&target);
    }
    free(host);
    if (status != 0) return (double)status;
    return (double)uv_udp_bind(&socket->udp, (const struct sockaddr *)&target, 0);
}

static void on_closed(uv_handle_t *handle) {
    Socket *socket = (Socket *)handle->data;
    if (socket == NULL) return;
    /* Released here rather than in `close`, because libuv may still call the
     * read callback between the close request and this. */
    if (socket->on_message != NULL) nts_release(socket->on_message);
    if (socket->on_error != NULL) nts_release(socket->on_error);
    socket->on_message = NULL;
    socket->on_error = NULL;
    socket->used = false;
}

void nts_udp_close(double handle) {
    Socket *socket = at(handle);
    if (socket == NULL) return;
    if (uv_is_closing((uv_handle_t *)&socket->udp)) return;
    uv_close((uv_handle_t *)&socket->udp, on_closed);
}

NtsArray *nts_udp_address(double handle, bool remote) {
    Socket *socket = at(handle);
    if (socket == NULL) return one_errno(UV_EBADF);

    struct sockaddr_storage found;
    int length = (int)sizeof(found);
    int status =
        remote ? uv_udp_getpeername(&socket->udp, (struct sockaddr *)&found,
                                    &length)
               : uv_udp_getsockname(&socket->udp, (struct sockaddr *)&found,
                                    &length);
    if (status != 0) return one_errno(status);

    char text[INET6_ADDRSTRLEN] = {0};
    int port = 0;
    const char *family = "IPv4";
    if (found.ss_family == AF_INET6) {
        struct sockaddr_in6 *in6 = (struct sockaddr_in6 *)&found;
        uv_ip6_name(in6, text, sizeof(text));
        port = ntohs(in6->sin6_port);
        family = "IPv6";
    } else {
        struct sockaddr_in *in4 = (struct sockaddr_in *)&found;
        uv_ip4_name(in4, text, sizeof(text));
        port = ntohs(in4->sin_port);
    }

    NtsArray *result = nts_array_new(&nts_node_desc_value, 3);
    NtsValue *items = NTS_ITEMS(result, NtsValue);
    items[0] = nts_value_of_reference((NtsHeader *)utf8(text), NTS_TAG_STRING);
    items[1] = nts_value_of_reference((NtsHeader *)utf8(family), NTS_TAG_STRING);
    items[2] = nts_value_of_number((double)port);
    return result;
}

double nts_udp_recv_stop(double handle) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    return (double)uv_udp_recv_stop(&socket->udp);
}

double nts_udp_connect_sync(double handle, NtsString *address, double port) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    char *host = cstring(address);
    if (host == NULL) return UV_ENOMEM;
    struct sockaddr_storage target;
    int status = uv_ip4_addr(host, (int)port, (struct sockaddr_in *)&target);
    if (status != 0) {
        status = uv_ip6_addr(host, (int)port, (struct sockaddr_in6 *)&target);
    }
    free(host);
    if (status != 0) return (double)status;
    status = uv_udp_connect(&socket->udp, (const struct sockaddr *)&target);
    if (status == 0) socket->connected = true;
    return (double)status;
}

double nts_udp_disconnect(double handle) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    int status = uv_udp_connect(&socket->udp, NULL);
    if (status == 0) socket->connected = false;
    return (double)status;
}

double nts_udp_set_broadcast(double handle, bool on) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    return (double)uv_udp_set_broadcast(&socket->udp, on ? 1 : 0);
}

double nts_udp_set_ttl(double handle, double ttl) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    return (double)uv_udp_set_ttl(&socket->udp, (int)ttl);
}

double nts_udp_set_multicast_ttl(double handle, double ttl) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    return (double)uv_udp_set_multicast_ttl(&socket->udp, (int)ttl);
}

double nts_udp_set_multicast_loopback(double handle, bool on) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    return (double)uv_udp_set_multicast_loop(&socket->udp, on ? 1 : 0);
}

double nts_udp_set_multicast_interface(double handle, NtsString *address) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    char *host = cstring(address);
    if (host == NULL) return UV_ENOMEM;
    int status = uv_udp_set_multicast_interface(&socket->udp, host);
    free(host);
    return (double)status;
}

double nts_udp_membership(double handle, NtsString *address, NtsString *iface,
                          bool join) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    char *group = cstring(address);
    char *on = cstring(iface);
    /* A null interface is libuv's "let the stack choose", and an empty string
     * is not the same request -- node passes undefined through as null. */
    int status = uv_udp_set_membership(
        &socket->udp, group, (on != NULL && on[0] != '\0') ? on : NULL,
        join ? UV_JOIN_GROUP : UV_LEAVE_GROUP);
    free(group);
    free(on);
    return (double)status;
}

double nts_udp_source_membership(double handle, NtsString *source,
                                 NtsString *group, NtsString *iface,
                                 bool join) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    char *from = cstring(source);
    char *to = cstring(group);
    char *on = cstring(iface);
    int status = uv_udp_set_source_membership(
        &socket->udp, to, (on != NULL && on[0] != '\0') ? on : NULL, from,
        join ? UV_JOIN_GROUP : UV_LEAVE_GROUP);
    free(from);
    free(to);
    free(on);
    return (double)status;
}

double nts_udp_buffer_size(double handle, double size, bool receive) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    int value = (int)size;
    int status = receive ? uv_recv_buffer_size((uv_handle_t *)&socket->udp,
                                               &value)
                         : uv_send_buffer_size((uv_handle_t *)&socket->udp,
                                               &value);
    /* libuv reports the size it settled on through the same variable it was
     * asked with, and a zero request is a read rather than a write. Returning
     * the value keeps both callers honest: the module asks for zero to read. */
    return status != 0 ? (double)status : (double)value;
}

double nts_udp_send_queue_size(double handle) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    return (double)socket->udp.send_queue_size;
}

double nts_udp_send_queue_count(double handle) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;
    return (double)socket->udp.send_queue_count;
}

void nts_udp_ref(double handle, bool keep_process_alive) {
    Socket *socket = at(handle);
    if (socket == NULL) return;
    if (keep_process_alive) {
        uv_ref((uv_handle_t *)&socket->udp);
    } else {
        uv_unref((uv_handle_t *)&socket->udp);
    }
    socket->refed = keep_process_alive;
}

/* ------------------------------------------------------- the three closures */

/* The same cast the emitter makes at every closure call site: the method table
 * stores untyped pointers and the caller spells the signature. One spelling per
 * arity and argument shape, because there is no generic way to say it. */
static void call_2n(NtsHeader *callback, double a, double b) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, double))
         callback->descriptor->methods[nts_closure_call_slot])(callback, a, b);
}

static void call_1n(NtsHeader *callback, double a) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double))
         callback->descriptor->methods[nts_closure_call_slot])(callback, a);
}

static void call_message(NtsHeader *callback, NtsView *bytes,
                         NtsString *address, NtsString *family, double port) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, NtsView *, NtsString *, NtsString *, double))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, bytes, address, family, port);
}

static void call_lookup(NtsHeader *callback, double status, NtsString *address,
                        double family) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, NtsString *, double))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, status, address, family);
}

/* The bytes a datagram arrived in, as the `Uint8Array` the module is declared
 * to receive. A buffer and a view over the whole of it: a `Uint8Array` lowers
 * to `NtsView *`, which is a different struct from an `NtsArray` of `u8`. */
static NtsView *bytes_view(const char *bytes, size_t length) {
    NtsBuffer *buffer = nts_buffer_new((double)length);
    if (buffer == NULL) return NULL;
    if (length != 0) memcpy(buffer->bytes, bytes, length);
    return nts_view_new(buffer, 0.0, (double)length, (double)NTS_ELEMENT_U8,
                        false);
}

/* One send. The callback outlives this call, so the request owns a reference
 * and gives it back in the completion. */
typedef struct {
    uv_udp_send_t request;
    NtsHeader *callback;
    size_t length;
} SendRequest;

static void on_sent(uv_udp_send_t *request, int status) {
    SendRequest *sent = (SendRequest *)request;
    /* Node reports the byte count it was asked to send, not what the kernel
     * took: a datagram is all-or-nothing, and libuv reports a short write as a
     * failure rather than a partial one. */
    call_2n(sent->callback, (double)status,
            status == 0 ? (double)sent->length : 0.0);
    if (sent->callback != NULL) nts_release(sent->callback);
    free(sent);
}

double nts_udp_send(double handle, NtsArray *chunks, double port,
                    NtsString *address, NtsHeader *callback) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;

    size_t count = chunks == NULL ? 0 : (size_t)chunks->header.length;
    uv_buf_t *buffers = count == 0 ? NULL : calloc(count, sizeof(uv_buf_t));
    if (count != 0 && buffers == NULL) return UV_ENOMEM;

    size_t total = 0;
    NtsView **views = chunks == NULL ? NULL : NTS_ITEMS(chunks, NtsView *);
    for (size_t i = 0; i < count; i++) {
        NtsView *view = views[i];
        size_t length = view == NULL ? 0 : (size_t)nts_view_byte_length(view);
        buffers[i] = uv_buf_init(
            view == NULL ? NULL : (char *)nts_view_bytes(view),
            (unsigned int)length);
        total += length;
    }

    /* A connected socket must be sent to with no address, and an unconnected
     * one with an address. libuv answers EISCONN and EDESTADDRREQ for the two
     * ways of getting that wrong, which are the errors node reports. */
    struct sockaddr_storage target;
    const struct sockaddr *to = NULL;
    if (!socket->connected) {
        char *host = cstring(address);
        if (host == NULL) {
            free(buffers);
            return UV_ENOMEM;
        }
        int status = uv_ip4_addr(host, (int)port, (struct sockaddr_in *)&target);
        if (status != 0) {
            status =
                uv_ip6_addr(host, (int)port, (struct sockaddr_in6 *)&target);
        }
        free(host);
        if (status != 0) {
            free(buffers);
            return (double)status;
        }
        to = (const struct sockaddr *)&target;
    }

    SendRequest *request = calloc(1, sizeof(SendRequest));
    if (request == NULL) {
        free(buffers);
        return UV_ENOMEM;
    }
    request->callback = callback;
    request->length = total;
    if (callback != NULL) nts_retain(callback);

    int status = uv_udp_send(&request->request, &socket->udp, buffers,
                             (unsigned int)count, to, on_sent);
    free(buffers);
    if (status != 0) {
        if (callback != NULL) nts_release(callback);
        free(request);
    }
    return (double)status;
}

/* libuv asks for somewhere to put a datagram before it knows how big one is.
 * 64 KiB is the largest a UDP datagram can be, so one allocation always fits
 * and the read callback reports what actually arrived. */
static void on_alloc(uv_handle_t *handle, size_t suggested, uv_buf_t *buffer) {
    (void)handle;
    (void)suggested;
    buffer->base = malloc(65536);
    buffer->len = buffer->base == NULL ? 0 : 65536;
}

static void on_received(uv_udp_t *udp, ssize_t count, const uv_buf_t *buffer,
                        const struct sockaddr *from, unsigned flags) {
    Socket *socket = (Socket *)udp->data;
    if (socket == NULL) {
        free(buffer->base);
        return;
    }
    /* `count == 0 && from == NULL` is libuv saying "nothing this time", which
     * is not an empty datagram and not an error. An empty datagram arrives as
     * `count == 0` with an address. */
    if (count == 0 && from == NULL) {
        free(buffer->base);
        return;
    }
    if (count < 0) {
        call_1n(socket->on_error, (double)count);
        free(buffer->base);
        return;
    }
    /* A truncated datagram is a lost one: node reports what it got and libuv
     * has already dropped the tail. Reported as received rather than as an
     * error, which is what node's own `dgram` does. */
    (void)flags;

    char text[INET6_ADDRSTRLEN] = {0};
    int port = 0;
    const char *family = "IPv4";
    if (from != NULL && from->sa_family == AF_INET6) {
        const struct sockaddr_in6 *in6 = (const struct sockaddr_in6 *)from;
        uv_ip6_name(in6, text, sizeof(text));
        port = ntohs(in6->sin6_port);
        family = "IPv6";
    } else if (from != NULL) {
        const struct sockaddr_in *in4 = (const struct sockaddr_in *)from;
        uv_ip4_name(in4, text, sizeof(text));
        port = ntohs(in4->sin_port);
    }

    NtsView *bytes = bytes_view(buffer->base, (size_t)count);
    free(buffer->base);
    if (bytes == NULL) {
        call_1n(socket->on_error, (double)UV_ENOMEM);
        return;
    }
    call_message(socket->on_message, bytes, utf8(text), utf8(family),
                 (double)port);
}

double nts_udp_recv_start(double handle, NtsHeader *on_message,
                          NtsHeader *on_error) {
    Socket *socket = at(handle);
    if (socket == NULL) return UV_EBADF;

    /* Replacing a started read replaces its callbacks, so the old pair is
     * released here and not in `close`. */
    if (socket->on_message != NULL) nts_release(socket->on_message);
    if (socket->on_error != NULL) nts_release(socket->on_error);
    socket->on_message = on_message;
    socket->on_error = on_error;
    if (on_message != NULL) nts_retain(on_message);
    if (on_error != NULL) nts_retain(on_error);

    return (double)uv_udp_recv_start(&socket->udp, on_alloc, on_received);
}

/* One name resolution. Like a send, the callback outlives the call. */
typedef struct {
    uv_getaddrinfo_t request;
    NtsHeader *callback;
} LookupRequest;

static void on_resolved(uv_getaddrinfo_t *request, int status,
                        struct addrinfo *result) {
    LookupRequest *lookup = (LookupRequest *)request;
    char text[INET6_ADDRSTRLEN] = {0};
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
    if (lookup->callback != NULL) nts_release(lookup->callback);
    if (result != NULL) uv_freeaddrinfo(result);
    free(lookup);
}

void nts_udp_lookup(NtsString *hostname, double family, NtsHeader *callback) {
    LookupRequest *lookup = calloc(1, sizeof(LookupRequest));
    if (lookup == NULL) {
        call_lookup(callback, (double)UV_ENOMEM, utf8(""), 0.0);
        return;
    }
    lookup->callback = callback;
    if (callback != NULL) nts_retain(callback);

    struct addrinfo hints;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = family == 6.0   ? AF_INET6
                      : family == 4.0 ? AF_INET
                                      : AF_UNSPEC;
    hints.ai_socktype = SOCK_DGRAM;

    char *name = cstring(hostname);
    int status = uv_getaddrinfo(loop(), &lookup->request, on_resolved,
                                name == NULL ? "" : name, NULL, &hints);
    free(name);
    if (status != 0) {
        if (callback != NULL) nts_release(callback);
        free(lookup);
        call_lookup(callback, (double)status, utf8(""), 0.0);
    }
}
