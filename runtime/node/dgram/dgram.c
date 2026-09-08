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
