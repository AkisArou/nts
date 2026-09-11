/* The native half of `node:dns`, over libuv. See `nts_dns.h`. */
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include "nts_dns.h"
#include "shared.h"

/* `loop`, `utf8` and `cstring` are `static` in `net.c` rather than shared, so
 * this file carries its own. Three lines each, and making them shared would put
 * a header between two modules that otherwise have no relationship. */
static uv_loop_t *loop(void) { return uv_default_loop(); }

static NtsString *utf8(const char *text) {
    return nts_string_from_utf8(text, text == NULL ? 0 : strlen(text));
}

static char *cstring(const NtsString *value) {
    if (value == NULL) return NULL;
    size_t length = 0;
    return nts_node_to_utf8_alloc(value, &length);
}

/* --------------------------------------------------------------- calling back */

static void call_one(NtsHeader *callback, double status, NtsString *address,
                     double family) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, NtsString *, double))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, status, address, family);
}

static void call_all(NtsHeader *callback, double status, NtsArray *addresses,
                     NtsArray *families) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, NtsArray *, NtsArray *))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, status, addresses, families);
}

static void call_name(NtsHeader *callback, double status, NtsString *hostname,
                      NtsString *service) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, NtsString *, NtsString *))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, status, hostname, service);
}

/* ------------------------------------------------------------------ resolving */

typedef struct {
    uv_getaddrinfo_t request;
    NtsHeader *callback;
    bool all;
    /* `order` is applied here rather than passed to libuv, which has no such
     * option: `getaddrinfo` returns the platform's order and node reorders the
     * result itself. `verbatim` is therefore the cheap case and the two
     * family-first orders are the ones that cost a pass. */
    int order;
} Resolution;

/* Node's DNS_ORDER_*. Mirrors the constants in `dns/src/main.ts`. */
#define ORDER_VERBATIM 0
#define ORDER_IPV4_FIRST 1
#define ORDER_IPV6_FIRST 2

static int family_of(struct addrinfo *entry) {
    return entry->ai_family == AF_INET6 ? 6 : 4;
}

static NtsString *text_of(struct addrinfo *entry) {
    char one[INET6_ADDRSTRLEN] = {0};
    if (entry->ai_family == AF_INET6) {
        uv_ip6_name((struct sockaddr_in6 *)entry->ai_addr, one, sizeof(one));
    } else {
        uv_ip4_name((struct sockaddr_in *)entry->ai_addr, one, sizeof(one));
    }
    return utf8(one);
}

/* Whether `entry` belongs in the first pass for this order. Two passes over the
 * list rather than a sort, because the order within a family has to be the
 * platform's and a comparison sort would not promise that. */
static bool in_first_pass(struct addrinfo *entry, int order) {
    if (order == ORDER_IPV4_FIRST) return entry->ai_family != AF_INET6;
    if (order == ORDER_IPV6_FIRST) return entry->ai_family == AF_INET6;
    return true;
}

static void on_resolved(uv_getaddrinfo_t *request, int status,
                        struct addrinfo *result) {
    Resolution *resolution = (Resolution *)request;

    if (!resolution->all) {
        char text[INET6_ADDRSTRLEN] = {0};
        double family = 0.0;
        struct addrinfo *chosen = NULL;
        if (status == 0) {
            /* The first entry the order prefers, falling back to the first of
             * any family -- a host with only A records asked for ipv6first is
             * not an error, it is an A record. */
            for (struct addrinfo *each = result; each != NULL; each = each->ai_next) {
                if (in_first_pass(each, resolution->order)) { chosen = each; break; }
            }
            if (chosen == NULL) chosen = result;
        }
        if (chosen != NULL) {
            if (chosen->ai_family == AF_INET6) {
                uv_ip6_name((struct sockaddr_in6 *)chosen->ai_addr, text, sizeof(text));
            } else {
                uv_ip4_name((struct sockaddr_in *)chosen->ai_addr, text, sizeof(text));
            }
            family = (double)family_of(chosen);
        }
        call_one(resolution->callback, (double)status, utf8(text), family);
    } else {
        size_t count = 0;
        for (struct addrinfo *each = result; each != NULL; each = each->ai_next) count++;
        NtsArray *addresses = nts_array_new(&nts_desc_ref, (double)count);
        NtsArray *families = nts_array_new(&nts_node_desc_double, (double)count);
        void **texts = NTS_ITEMS(addresses, void *);
        double *kinds = NTS_ITEMS(families, double);
        size_t index = 0;
        for (int pass = 0; pass < 2; pass++) {
            for (struct addrinfo *each = result; each != NULL; each = each->ai_next) {
                bool first = in_first_pass(each, resolution->order);
                if ((pass == 0) != first) continue;
                if (pass == 1 && resolution->order == ORDER_VERBATIM) continue;
                texts[index] = text_of(each);
                kinds[index] = (double)family_of(each);
                index++;
            }
        }
        call_all(resolution->callback, (double)status, addresses, families);
    }

    if (resolution->callback != NULL) nts_release(resolution->callback);
    if (result != NULL) uv_freeaddrinfo(result);
    free(resolution);
}

static void start(NtsString *hostname, double family, double hints, double order,
                  NtsHeader *callback, bool all) {
    Resolution *resolution = calloc(1, sizeof(Resolution));
    if (resolution == NULL) {
        if (all) {
            call_all(callback, (double)UV_ENOMEM, nts_array_new(&nts_desc_ref, 0),
                     nts_array_new(&nts_node_desc_double, 0));
        } else {
            call_one(callback, (double)UV_ENOMEM, utf8(""), 0.0);
        }
        return;
    }
    resolution->callback = callback;
    resolution->all = all;
    resolution->order = (int)order;
    if (callback != NULL) nts_retain(callback);

    struct addrinfo request;
    memset(&request, 0, sizeof(request));
    request.ai_family = family == 6.0 ? AF_INET6 : family == 4.0 ? AF_INET : AF_UNSPEC;
    request.ai_socktype = SOCK_STREAM;
    request.ai_flags = (int)hints;

    char *name = cstring(hostname);
    int status = uv_getaddrinfo(loop(), &resolution->request, on_resolved,
                                name == NULL ? "" : name, NULL, &request);
    free(name);
    if (status != 0) {
        if (callback != NULL) nts_release(callback);
        free(resolution);
        if (all) {
            call_all(callback, (double)status, nts_array_new(&nts_desc_ref, 0),
                     nts_array_new(&nts_node_desc_double, 0));
        } else {
            call_one(callback, (double)status, utf8(""), 0.0);
        }
    }
}

void nts_dns_getaddrinfo(NtsString *hostname, double family, double hints,
                         double order, NtsHeader *callback) {
    start(hostname, family, hints, order, callback, false);
}

void nts_dns_getaddrinfo_all(NtsString *hostname, double family, double hints,
                             double order, NtsHeader *callback) {
    start(hostname, family, hints, order, callback, true);
}

/* ------------------------------------------------------------- reverse lookup */

typedef struct {
    uv_getnameinfo_t request;
    NtsHeader *callback;
} Naming;

static void on_named(uv_getnameinfo_t *request, int status, const char *hostname,
                     const char *service) {
    Naming *naming = (Naming *)request;
    call_name(naming->callback, (double)status,
              utf8(hostname == NULL ? "" : hostname),
              utf8(service == NULL ? "" : service));
    if (naming->callback != NULL) nts_release(naming->callback);
    free(naming);
}

void nts_dns_getnameinfo(NtsString *address, double port, NtsHeader *callback) {
    Naming *naming = calloc(1, sizeof(Naming));
    if (naming == NULL) {
        call_name(callback, (double)UV_ENOMEM, utf8(""), utf8(""));
        return;
    }
    naming->callback = callback;
    if (callback != NULL) nts_retain(callback);

    char *text = cstring(address);
    struct sockaddr_storage storage;
    memset(&storage, 0, sizeof(storage));
    int status;
    if (text != NULL && strchr(text, ':') != NULL) {
        status = uv_ip6_addr(text, (int)port, (struct sockaddr_in6 *)&storage);
    } else {
        status = uv_ip4_addr(text == NULL ? "" : text, (int)port,
                             (struct sockaddr_in *)&storage);
    }
    if (status == 0) {
        status = uv_getnameinfo(loop(), &naming->request, on_named,
                                (const struct sockaddr *)&storage, 0);
    }
    free(text);
    if (status != 0) {
        if (callback != NULL) nts_release(callback);
        free(naming);
        call_name(callback, (double)status, utf8(""), utf8(""));
    }
}

NtsString *nts_dns_errname(double errno_value) {
    return utf8(uv_err_name((int)errno_value));
}
