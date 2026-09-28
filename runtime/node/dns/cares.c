/* The resolver half of `node:dns`, over c-ares: node's `cares_wrap.cc`, for
 * this profile's seam. See `nts_dns.h` for the contract and
 * `src/resolver.ts` for the layout each answer crosses in.
 *
 * The structure is node's, piece for piece, because the behaviour a program
 * sees is decided here: a channel is c-ares's channel with node's options, its
 * sockets are watched by libuv polls and its timeouts by a libuv timer that
 * c-ares is poked from, an answer is parsed by the same c-ares calls node
 * makes, and every answer reaches the program on a later turn of the loop --
 * never from inside `ares_process_fd` -- as node's `SetImmediate` delivers
 * it. That last one is not taste: a callback that cancels or replaces the
 * servers would otherwise re-enter c-ares from its own callback. */
#define CARES_NO_DEPRECATED
#include <ares.h>
#include <arpa/nameser.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include "nts_dns.h"
#include "shared.h"

/* Node's own status for `setServers` while a query is in flight. */
#define DNS_ESETSRVPENDING (-1000)

/* The query kinds, as `src/resolver.ts` numbers them. */
enum {
    kQueryAny = 0,
    kQueryA = 1,
    kQueryAaaa = 2,
    kQueryCaa = 3,
    kQueryCname = 4,
    kQueryMx = 5,
    kQueryNs = 6,
    kQueryTlsa = 7,
    kQueryTxt = 8,
    kQuerySrv = 9,
    kQueryPtr = 10,
    kQueryNaptr = 11,
    kQuerySoa = 12,
    kQueryReverse = 13,
};

/* ------------------------------------------------------------------ helpers */

static uv_loop_t *loop(void) { return uv_default_loop(); }

static char *cstring(const NtsString *value) {
    if (value == NULL) return NULL;
    size_t length = 0;
    return nts_node_to_utf8_alloc(value, &length);
}

/* Node's `OneByteString`: every byte one code unit, which is what a DNS
 * string is -- bytes, not UTF-8. */
static NtsString *latin1(const unsigned char *bytes, size_t length) {
    uint16_t *units = malloc((length == 0 ? 1 : length) * sizeof *units);
    if (units == NULL) return nts_string_from_utf8("", 0);
    for (size_t i = 0; i < length; i++) units[i] = bytes[i];
    NtsString *string = nts_str_alloc(units, (uint32_t)length);
    free(units);
    return string;
}

static NtsString *latin1z(const char *text) {
    return latin1((const unsigned char *)text, text == NULL ? 0 : strlen(text));
}

/* The flat answer, grown as it is parsed and turned into arrays at the end. */
typedef struct {
    NtsString **texts;
    size_t text_count, text_capacity;
    double *numbers;
    size_t number_count, number_capacity;
} Answer;

static void add_text(Answer *answer, NtsString *text) {
    if (answer->text_count == answer->text_capacity) {
        size_t capacity = answer->text_capacity == 0 ? 8 : answer->text_capacity * 2;
        NtsString **grown = realloc(answer->texts, capacity * sizeof *grown);
        if (grown == NULL) return;
        answer->texts = grown;
        answer->text_capacity = capacity;
    }
    answer->texts[answer->text_count++] = text;
}

static void add_number(Answer *answer, double number) {
    if (answer->number_count == answer->number_capacity) {
        size_t capacity = answer->number_capacity == 0 ? 8 : answer->number_capacity * 2;
        double *grown = realloc(answer->numbers, capacity * sizeof *grown);
        if (grown == NULL) return;
        answer->numbers = grown;
        answer->number_capacity = capacity;
    }
    answer->numbers[answer->number_count++] = number;
}

/* A failed parse's strings, released: they were made for an answer that is
 * not going to be delivered. */
static void answer_discard(Answer *answer) {
    for (size_t i = 0; i < answer->text_count; i++) nts_release((NtsHeader *)answer->texts[i]);
    answer->text_count = 0;
    answer->number_count = 0;
}

static void answer_free(Answer *answer) {
    free(answer->texts);
    free(answer->numbers);
    memset(answer, 0, sizeof *answer);
}

static NtsArray *texts_array(const Answer *answer) {
    NtsArray *array = nts_array_new(&nts_desc_ref, (double)answer->text_count);
    void **items = NTS_ITEMS(array, void *);
    for (size_t i = 0; i < answer->text_count; i++) items[i] = answer->texts[i];
    return array;
}

static NtsArray *numbers_array(const Answer *answer) {
    NtsArray *array = nts_array_new(&nts_node_desc_double, (double)answer->number_count);
    double *items = NTS_ITEMS(array, double);
    for (size_t i = 0; i < answer->number_count; i++) items[i] = answer->numbers[i];
    return array;
}

/* Node's `ToErrorCodeString`: the code a program matches on. */
static const char *code_of(int status) {
    switch (status) {
#define V(code) case ARES_##code: return #code;
        V(EADDRGETNETWORKPARAMS)
        V(EBADFAMILY)
        V(EBADFLAGS)
        V(EBADHINTS)
        V(EBADNAME)
        V(EBADQUERY)
        V(EBADRESP)
        V(EBADSTR)
        V(ECANCELLED)
        V(ECONNREFUSED)
        V(EDESTRUCTION)
        V(EFILE)
        V(EFORMERR)
        V(ELOADIPHLPAPI)
        V(ENODATA)
        V(ENOMEM)
        V(ENONAME)
        V(ENOTFOUND)
        V(ENOTIMP)
        V(ENOTINITIALIZED)
        V(EOF)
        V(EREFUSED)
        V(ESERVFAIL)
        V(ETIMEOUT)
#undef V
    }
    return "UNKNOWN_ARES_ERROR";
}

/* ---------------------------------------------------------------- channels */

typedef struct Task {
    uv_poll_t poll;
    ares_socket_t socket;
    struct Channel *channel;
    struct Task *next;
} Task;

typedef struct Channel {
    ares_channel_t *channel;
    uv_timer_t *timer;
    Task *tasks;
    int timeout;
    int tries;
    int max_timeout;
    int active_queries;
    bool query_last_ok;
    bool servers_default;
} Channel;

static Channel **channels;
static size_t channel_count;
static bool library_inited;

static Channel *channel_of(double id) {
    if (id < 1 || (size_t)id > channel_count) return NULL;
    return channels[(size_t)id - 1];
}

/* c-ares's once-a-second poke, so a query whose server never answers still
 * times out. */
static void on_ares_timeout(uv_timer_t *handle) {
    Channel *channel = handle->data;
    ares_process_fd(channel->channel, ARES_SOCKET_BAD, ARES_SOCKET_BAD);
}

static void start_timer(Channel *channel) {
    if (channel->timer == NULL) {
        channel->timer = malloc(sizeof *channel->timer);
        if (channel->timer == NULL) return;
        channel->timer->data = channel;
        uv_timer_init(loop(), channel->timer);
    } else if (uv_is_active((uv_handle_t *)channel->timer)) {
        return;
    }
    int timeout = channel->timeout;
    if (timeout <= 0 || timeout > 1000) timeout = 1000;
    uv_timer_start(channel->timer, on_ares_timeout, (uint64_t)timeout, (uint64_t)timeout);
}

static void free_on_close(uv_handle_t *handle) { free(handle); }

static void close_timer(Channel *channel) {
    if (channel->timer == NULL) return;
    uv_close((uv_handle_t *)channel->timer, free_on_close);
    channel->timer = NULL;
}

static void on_poll(uv_poll_t *watcher, int status, int events) {
    Task *task = (Task *)watcher;
    Channel *channel = task->channel;
    if (channel->timer != NULL) uv_timer_again(channel->timer);
    if (status < 0) {
        /* An error: let c-ares find out by reading and writing. */
        ares_process_fd(channel->channel, task->socket, task->socket);
        return;
    }
    ares_process_fd(channel->channel,
                    (events & UV_READABLE) ? task->socket : ARES_SOCKET_BAD,
                    (events & UV_WRITABLE) ? task->socket : ARES_SOCKET_BAD);
}

static void on_socket_state(void *data, ares_socket_t socket, int read, int write) {
    Channel *channel = data;
    Task **link = &channel->tasks;
    while (*link != NULL && (*link)->socket != socket) link = &(*link)->next;
    Task *task = *link;
    if (read || write) {
        if (task == NULL) {
            start_timer(channel);
            task = calloc(1, sizeof *task);
            if (task == NULL) return; /* unpolled; the query times out */
            task->socket = socket;
            task->channel = channel;
            if (uv_poll_init_socket(loop(), &task->poll, socket) < 0) {
                free(task);
                return;
            }
            task->next = channel->tasks;
            channel->tasks = task;
        }
        uv_poll_start(&task->poll, (read ? UV_READABLE : 0) | (write ? UV_WRITABLE : 0), on_poll);
    } else {
        if (task != NULL) {
            *link = task->next;
            uv_close((uv_handle_t *)&task->poll, free_on_close);
        }
        if (channel->tasks == NULL) close_timer(channel);
    }
}

/* Node's `ChannelWrap::Setup`: the options node sets, and nothing cached. */
static int setup(Channel *channel) {
    if (!library_inited) {
        int status = ares_library_init(ARES_LIB_INIT_ALL);
        if (status != ARES_SUCCESS) return status;
        library_inited = true;
    }
    struct ares_options options;
    memset(&options, 0, sizeof options);
    options.flags = ARES_FLAG_NOCHECKRESP;
    options.sock_state_cb = on_socket_state;
    options.sock_state_cb_data = channel;
    options.timeout = channel->timeout;
    options.tries = channel->tries;
    options.qcache_max_ttl = 0;
    int mask = ARES_OPT_FLAGS | ARES_OPT_TIMEOUTMS | ARES_OPT_SOCK_STATE_CB | ARES_OPT_TRIES |
               ARES_OPT_QUERY_CACHE;
    if (channel->max_timeout > 0) {
        options.maxtimeout = channel->max_timeout;
        mask |= ARES_OPT_MAXTIMEOUTMS;
    }
    return ares_init_options(&channel->channel, &options, mask);
}

double nts_dns_channel_new(double timeout, double tries, double max_timeout) {
    Channel *channel = calloc(1, sizeof *channel);
    if (channel == NULL) return 0;
    channel->timeout = (int)timeout;
    channel->tries = (int)tries;
    channel->max_timeout = (int)max_timeout;
    channel->query_last_ok = true;
    channel->servers_default = true;
    if (setup(channel) != ARES_SUCCESS) {
        free(channel);
        return 0;
    }
    Channel **grown = realloc(channels, (channel_count + 1) * sizeof *grown);
    if (grown == NULL) {
        ares_destroy(channel->channel);
        free(channel);
        return 0;
    }
    channels = grown;
    channels[channel_count++] = channel;
    return (double)channel_count;
}

/* Node's `EnsureServers`: a channel still on c-ares's fallback server -- one
 * loopback address, which is what it uses when the system names none -- whose
 * last query was refused is set up again, in case the system has a resolver
 * now. Nothing to do once servers were set or anything has answered. */
static void ensure_servers(Channel *channel) {
    if (channel->query_last_ok || !channel->servers_default) return;
    struct ares_addr_port_node *servers = NULL;
    ares_get_servers_ports(channel->channel, &servers);
    if (servers == NULL) return;
    if (servers->next != NULL) {
        ares_free_data(servers);
        channel->servers_default = false;
        return;
    }
    bool loopback = false;
    if (servers->family == AF_INET) {
        loopback = servers->addr.addr4.s_addr == htonl(INADDR_LOOPBACK);
    } else if (servers->family == AF_INET6) {
        static const unsigned char kLoopback[16] = {0, 0, 0, 0, 0, 0, 0, 0,
                                                    0, 0, 0, 0, 0, 0, 0, 1};
        loopback = memcmp(&servers->addr.addr6, kLoopback, sizeof kLoopback) == 0;
    }
    ares_free_data(servers);
    if (!loopback) {
        channel->servers_default = false;
        return;
    }
    ares_destroy(channel->channel);
    close_timer(channel);
    setup(channel);
}

void nts_dns_channel_cancel(double id) {
    Channel *channel = channel_of(id);
    if (channel != NULL) ares_cancel(channel->channel);
}

/* The servers, as `ares_get_servers_ports` reports them: address and UDP
 * port. Two arrays, one per call, read in the same order. */
static struct ares_addr_port_node *servers_of(Channel *channel) {
    struct ares_addr_port_node *servers = NULL;
    if (channel != NULL) ares_get_servers_ports(channel->channel, &servers);
    return servers;
}

NtsArray *nts_dns_channel_server_hosts(double id) {
    struct ares_addr_port_node *servers = servers_of(channel_of(id));
    size_t count = 0;
    for (struct ares_addr_port_node *each = servers; each != NULL; each = each->next) count++;
    NtsArray *hosts = nts_array_new(&nts_desc_ref, (double)count);
    void **items = NTS_ITEMS(hosts, void *);
    size_t index = 0;
    for (struct ares_addr_port_node *each = servers; each != NULL; each = each->next) {
        char ip[INET6_ADDRSTRLEN] = {0};
        uv_inet_ntop(each->family, &each->addr, ip, sizeof ip);
        items[index++] = latin1z(ip);
    }
    if (servers != NULL) ares_free_data(servers);
    return hosts;
}

NtsArray *nts_dns_channel_server_ports(double id) {
    struct ares_addr_port_node *servers = servers_of(channel_of(id));
    size_t count = 0;
    for (struct ares_addr_port_node *each = servers; each != NULL; each = each->next) count++;
    NtsArray *ports = nts_array_new(&nts_node_desc_double, (double)count);
    double *items = NTS_ITEMS(ports, double);
    size_t index = 0;
    for (struct ares_addr_port_node *each = servers; each != NULL; each = each->next) {
        items[index++] = (double)each->udp_port;
    }
    if (servers != NULL) ares_free_data(servers);
    return ports;
}

/* Node's `SetServers`: every address parsed before any is set, and refused
 * outright while a query is in flight. */
double nts_dns_channel_set_servers(double id, NtsArray *families, NtsArray *hosts, NtsArray *ports) {
    Channel *channel = channel_of(id);
    if (channel == NULL) return ARES_EBADSTR;
    if (channel->active_queries > 0) return DNS_ESETSRVPENDING;
    uint32_t count = hosts == NULL ? 0 : hosts->header.length;
    if (count == 0) return ares_set_servers(channel->channel, NULL);

    struct ares_addr_port_node *servers = calloc(count, sizeof *servers);
    if (servers == NULL) return ARES_ENOMEM;
    double *family_items = NTS_ITEMS(families, double);
    double *port_items = NTS_ITEMS(ports, double);
    NtsString **host_items = NTS_ITEMS(hosts, NtsString *);
    int status = 0;
    for (uint32_t i = 0; i < count; i++) {
        struct ares_addr_port_node *server = &servers[i];
        server->tcp_port = server->udp_port = (int)port_items[i];
        char *ip = cstring(host_items[i]);
        if ((int)family_items[i] == 6) {
            server->family = AF_INET6;
            status = uv_inet_pton(AF_INET6, ip == NULL ? "" : ip, &server->addr);
        } else {
            server->family = AF_INET;
            status = uv_inet_pton(AF_INET, ip == NULL ? "" : ip, &server->addr);
        }
        free(ip);
        if (status != 0) break;
        server->next = i + 1 < count ? &servers[i + 1] : NULL;
    }
    int result = status == 0 ? ares_set_servers_ports(channel->channel, servers) : ARES_EBADSTR;
    free(servers);
    if (result == ARES_SUCCESS) channel->servers_default = false;
    return result;
}

/* Node's `SetLocalAddress`, the addresses already validated: an empty one is
 * the system's choice for that family. */
void nts_dns_channel_set_local_address(double id, NtsString *ipv4, NtsString *ipv6) {
    Channel *channel = channel_of(id);
    if (channel == NULL) return;
    char *four = cstring(ipv4);
    char *six = cstring(ipv6);
    unsigned char address[sizeof(struct in6_addr)];
    if (four != NULL && four[0] != '\0' && uv_inet_pton(AF_INET, four, address) == 0) {
        ares_set_local_ip4(channel->channel, ((unsigned int)address[0] << 24) |
                                                 ((unsigned int)address[1] << 16) |
                                                 ((unsigned int)address[2] << 8) |
                                                 (unsigned int)address[3]);
    } else {
        ares_set_local_ip4(channel->channel, 0);
    }
    if (six != NULL && six[0] != '\0' && uv_inet_pton(AF_INET6, six, address) == 0) {
        ares_set_local_ip6(channel->channel, address);
    } else {
        memset(address, 0, sizeof address);
        ares_set_local_ip6(channel->channel, address);
    }
    free(four);
    free(six);
}

NtsString *nts_dns_strerror(double status) {
    if ((int)status == DNS_ESETSRVPENDING) return latin1z("There are pending queries.");
    return latin1z(ares_strerror((int)status));
}

/* ------------------------------------------------------------------ parsing */

/* How many address-TTL slots an A or AAAA parse needs: the header's answer
 * count, as node sizes them. */
static int answer_count(const unsigned char *buf, int len) {
    if (len <= 7) return 256;
    int count = ((int)buf[6] << 8) | (int)buf[7];
    return count == 0 ? 1 : count;
}

static void add_address(Answer *answer, int family, const void *address) {
    char ip[INET6_ADDRSTRLEN] = {0};
    uv_inet_ntop(family, address, ip, sizeof ip);
    add_text(answer, latin1z(ip));
}

/* `A` and the CNAME it may have followed. `as_any` is node's
 * `ns_t_cname_or_a`: a CNAME answer is reported as the CNAME. Sets `*cname`. */
static int parse_a(const unsigned char *buf, int len, Answer *answer, bool with_kind,
                   bool cname_or_a, bool *cname) {
    int count = answer_count(buf, len);
    struct ares_addrttl *ttls = calloc((size_t)count, sizeof *ttls);
    if (ttls == NULL) return ARES_ENOMEM;
    struct hostent *host = NULL;
    int naddrttls = count;
    int status = ares_parse_a_reply(buf, len, &host, ttls, &naddrttls);
    if (status == ARES_SUCCESS) {
        *cname = cname_or_a && host->h_name != NULL && host->h_aliases[0] != NULL;
        if (*cname) {
            if (with_kind) add_number(answer, kQueryCname);
            add_text(answer, latin1z(host->h_name));
        } else {
            for (int i = 0; host->h_addr_list[i] != NULL; i++) {
                if (with_kind) add_number(answer, kQueryA);
                add_address(answer, AF_INET, host->h_addr_list[i]);
                add_number(answer, i < naddrttls ? (double)(unsigned int)ttls[i].ttl : 0);
            }
        }
        ares_free_hostent(host);
    }
    free(ttls);
    return status;
}

static int parse_aaaa(const unsigned char *buf, int len, Answer *answer, bool with_kind) {
    int count = answer_count(buf, len);
    struct ares_addr6ttl *ttls = calloc((size_t)count, sizeof *ttls);
    if (ttls == NULL) return ARES_ENOMEM;
    struct hostent *host = NULL;
    int naddrttls = count;
    int status = ares_parse_aaaa_reply(buf, len, &host, ttls, &naddrttls);
    if (status == ARES_SUCCESS) {
        for (int i = 0; host->h_addr_list[i] != NULL; i++) {
            if (with_kind) add_number(answer, kQueryAaaa);
            add_address(answer, AF_INET6, host->h_addr_list[i]);
            add_number(answer, i < naddrttls ? (double)(unsigned int)ttls[i].ttl : 0);
        }
        ares_free_hostent(host);
    }
    free(ttls);
    return status;
}

static int parse_cname(const unsigned char *buf, int len, Answer *answer) {
    struct hostent *host = NULL;
    int status = ares_parse_a_reply(buf, len, &host, NULL, NULL);
    if (status == ARES_SUCCESS) {
        add_text(answer, latin1z(host->h_name));
        ares_free_hostent(host);
    }
    return status;
}

/* NS and PTR: the names are the host entry's aliases. */
static int parse_names(const unsigned char *buf, int len, Answer *answer, int kind,
                       bool with_kind) {
    struct hostent *host = NULL;
    int status = kind == kQueryNs ? ares_parse_ns_reply(buf, len, &host)
                                  : ares_parse_ptr_reply(buf, len, NULL, 0, AF_INET, &host);
    if (status == ARES_SUCCESS) {
        for (int i = 0; host->h_aliases[i] != NULL; i++) {
            if (with_kind) add_number(answer, kind);
            add_text(answer, latin1z(host->h_aliases[i]));
        }
        ares_free_hostent(host);
    }
    return status;
}

static int parse_mx(const unsigned char *buf, int len, Answer *answer, bool with_kind) {
    struct ares_mx_reply *start = NULL;
    int status = ares_parse_mx_reply(buf, len, &start);
    if (status != ARES_SUCCESS) return status;
    for (struct ares_mx_reply *each = start; each != NULL; each = each->next) {
        if (with_kind) add_number(answer, kQueryMx);
        add_text(answer, latin1z(each->host));
        add_number(answer, each->priority);
    }
    ares_free_data(start);
    return ARES_SUCCESS;
}

static int parse_caa(const unsigned char *buf, int len, Answer *answer, bool with_kind) {
    struct ares_caa_reply *start = NULL;
    int status = ares_parse_caa_reply(buf, len, &start);
    if (status != ARES_SUCCESS) return status;
    for (struct ares_caa_reply *each = start; each != NULL; each = each->next) {
        if (with_kind) add_number(answer, kQueryCaa);
        add_number(answer, each->critical);
        add_text(answer, latin1z((const char *)each->property));
        add_text(answer, latin1z((const char *)each->value));
    }
    ares_free_data(start);
    return ARES_SUCCESS;
}

/* TXT: chunks grouped into records, a record's chunk count before its chunks
 * are counted -- the count is only known at the next record's start. */
static int parse_txt(const unsigned char *buf, int len, Answer *answer, bool with_kind) {
    struct ares_txt_ext *start = NULL;
    int status = ares_parse_txt_reply_ext(buf, len, &start);
    if (status != ARES_SUCCESS) return status;
    size_t count_slot = (size_t)-1;
    for (struct ares_txt_ext *each = start; each != NULL; each = each->next) {
        if (each->record_start || count_slot == (size_t)-1) {
            if (with_kind) add_number(answer, kQueryTxt);
            count_slot = answer->number_count;
            add_number(answer, 0);
        }
        add_text(answer, latin1(each->txt, each->length));
        answer->numbers[count_slot] += 1;
    }
    ares_free_data(start);
    return ARES_SUCCESS;
}

static int parse_srv(const unsigned char *buf, int len, Answer *answer, bool with_kind) {
    struct ares_srv_reply *start = NULL;
    int status = ares_parse_srv_reply(buf, len, &start);
    if (status != ARES_SUCCESS) return status;
    for (struct ares_srv_reply *each = start; each != NULL; each = each->next) {
        if (with_kind) add_number(answer, kQuerySrv);
        add_text(answer, latin1z(each->host));
        add_number(answer, each->priority);
        add_number(answer, each->weight);
        add_number(answer, each->port);
    }
    ares_free_data(start);
    return ARES_SUCCESS;
}

static int parse_naptr(const unsigned char *buf, int len, Answer *answer, bool with_kind) {
    struct ares_naptr_reply *start = NULL;
    int status = ares_parse_naptr_reply(buf, len, &start);
    if (status != ARES_SUCCESS) return status;
    for (struct ares_naptr_reply *each = start; each != NULL; each = each->next) {
        if (with_kind) add_number(answer, kQueryNaptr);
        add_text(answer, latin1z((const char *)each->flags));
        add_text(answer, latin1z((const char *)each->service));
        add_text(answer, latin1z((const char *)each->regexp));
        add_text(answer, latin1z(each->replacement));
        add_number(answer, each->order);
        add_number(answer, each->preference);
    }
    ares_free_data(start);
    return ARES_SUCCESS;
}

static void add_soa(Answer *answer, const char *nsname, const char *hostmaster,
                    unsigned int serial, unsigned int refresh, unsigned int retry,
                    unsigned int expire, unsigned int minttl, bool with_kind) {
    if (with_kind) add_number(answer, kQuerySoa);
    add_text(answer, latin1z(nsname));
    add_text(answer, latin1z(hostmaster));
    add_number(answer, serial);
    add_number(answer, (double)(int)refresh);
    add_number(answer, (double)(int)retry);
    add_number(answer, (double)(int)expire);
    add_number(answer, minttl);
}

static int parse_soa(const unsigned char *buf, int len, Answer *answer) {
    struct ares_soa_reply *soa = NULL;
    int status = ares_parse_soa_reply(buf, len, &soa);
    if (status != ARES_SUCCESS) return status;
    add_soa(answer, soa->nsname, soa->hostmaster, soa->serial, soa->refresh, soa->retry,
            soa->expire, soa->minttl, false);
    ares_free_data(soa);
    return ARES_SUCCESS;
}

static unsigned int read16(const unsigned char *at) {
    return ((unsigned int)at[0] << 8) | (unsigned int)at[1];
}

static unsigned int read32(const unsigned char *at) {
    return ((unsigned int)at[0] << 24) | ((unsigned int)at[1] << 16) |
           ((unsigned int)at[2] << 8) | (unsigned int)at[3];
}

/* Node's `ParseSoaReply`, for ANY: `ares_parse_soa_reply` insists on a single
 * record, so the answer section is walked by hand for the first SOA. */
static int parse_soa_in_any(const unsigned char *buf, int len, Answer *answer) {
    unsigned int ancount = read16(buf + 6);
    const unsigned char *ptr = buf + NS_HFIXEDSZ;
    char *name = NULL;
    long name_length = 0;
    int status = ares_expand_name(ptr, buf, len, &name, &name_length);
    if (status != ARES_SUCCESS) return status == ARES_EBADNAME ? ARES_EBADRESP : status;
    ares_free_string(name);
    if (ptr + name_length + NS_QFIXEDSZ > buf + len) return ARES_EBADRESP;
    ptr += name_length + NS_QFIXEDSZ;
    for (unsigned int i = 0; i < ancount; i++) {
        char *rr_name = NULL;
        long rr_length = 0;
        status = ares_expand_name(ptr, buf, len, &rr_name, &rr_length);
        if (status != ARES_SUCCESS) return status == ARES_EBADNAME ? ARES_EBADRESP : status;
        ares_free_string(rr_name);
        ptr += rr_length;
        if (ptr + NS_RRFIXEDSZ > buf + len) return ARES_EBADRESP;
        unsigned int rr_type = read16(ptr);
        unsigned int rr_len = read16(ptr + 8);
        ptr += NS_RRFIXEDSZ;
        if (rr_type == ns_t_soa) {
            char *nsname = NULL;
            long nsname_length = 0;
            status = ares_expand_name(ptr, buf, len, &nsname, &nsname_length);
            if (status != ARES_SUCCESS) return status == ARES_EBADNAME ? ARES_EBADRESP : status;
            ptr += nsname_length;
            char *hostmaster = NULL;
            long hostmaster_length = 0;
            status = ares_expand_name(ptr, buf, len, &hostmaster, &hostmaster_length);
            if (status != ARES_SUCCESS) {
                ares_free_string(nsname);
                return status == ARES_EBADNAME ? ARES_EBADRESP : status;
            }
            ptr += hostmaster_length;
            if (ptr + 5 * 4 > buf + len) {
                ares_free_string(nsname);
                ares_free_string(hostmaster);
                return ARES_EBADRESP;
            }
            add_soa(answer, nsname, hostmaster, read32(ptr), read32(ptr + 4), read32(ptr + 8),
                    read32(ptr + 12), read32(ptr + 16), true);
            ares_free_string(nsname);
            ares_free_string(hostmaster);
            break;
        }
        ptr += rr_len;
    }
    return ARES_SUCCESS;
}

static int parse_tlsa(const unsigned char *buf, int len, Answer *answer, bool with_kind) {
    ares_dns_record_t *record = NULL;
    int status = ares_dns_parse(buf, (size_t)len, 0, &record);
    if (status != ARES_SUCCESS) {
        ares_dns_record_destroy(record);
        return status;
    }
    size_t count = ares_dns_record_rr_cnt(record, ARES_SECTION_ANSWER);
    for (size_t i = 0; i < count; i++) {
        const ares_dns_rr_t *rr = ares_dns_record_rr_get(record, ARES_SECTION_ANSWER, i);
        if (ares_dns_rr_get_type(rr) != ARES_REC_TYPE_TLSA) continue;
        size_t data_length = 0;
        const unsigned char *data = ares_dns_rr_get_bin(rr, ARES_RR_TLSA_DATA, &data_length);
        if (data == NULL || data_length == 0) continue;
        if (with_kind) add_number(answer, kQueryTlsa);
        add_number(answer, ares_dns_rr_get_u8(rr, ARES_RR_TLSA_CERT_USAGE));
        add_number(answer, ares_dns_rr_get_u8(rr, ARES_RR_TLSA_SELECTOR));
        add_number(answer, ares_dns_rr_get_u8(rr, ARES_RR_TLSA_MATCH));
        add_number(answer, (double)data_length);
        for (size_t byte = 0; byte < data_length; byte++) add_number(answer, data[byte]);
    }
    ares_dns_record_destroy(record);
    return ARES_SUCCESS;
}

/* Node's `AnyTraits::Parse`: every type in turn, each tolerating ENODATA, in
 * node's order -- the order `resolveAny` reports them in. */
static int parse_any(const unsigned char *buf, int len, Answer *answer) {
#define STEP(call)                                                   \
    do {                                                             \
        int step = (call);                                           \
        if (step != ARES_SUCCESS && step != ARES_ENODATA) return step; \
    } while (0)
    bool cname = false;
    STEP(parse_a(buf, len, answer, true, true, &cname));
    STEP(parse_aaaa(buf, len, answer, true));
    STEP(parse_mx(buf, len, answer, true));
    STEP(parse_names(buf, len, answer, kQueryNs, true));
    STEP(parse_txt(buf, len, answer, true));
    STEP(parse_srv(buf, len, answer, true));
    STEP(parse_names(buf, len, answer, kQueryPtr, true));
    STEP(parse_naptr(buf, len, answer, true));
    STEP(parse_soa_in_any(buf, len, answer));
    STEP(parse_tlsa(buf, len, answer, true));
    STEP(parse_caa(buf, len, answer, true));
#undef STEP
    return ARES_SUCCESS;
}

static int parse(int kind, const unsigned char *buf, int len, Answer *answer) {
    bool cname = false;
    switch (kind) {
    case kQueryAny: return parse_any(buf, len, answer);
    case kQueryA: return parse_a(buf, len, answer, false, false, &cname);
    case kQueryAaaa: return parse_aaaa(buf, len, answer, false);
    case kQueryCaa: return parse_caa(buf, len, answer, false);
    case kQueryCname: return parse_cname(buf, len, answer);
    case kQueryMx: return parse_mx(buf, len, answer, false);
    case kQueryNs: return parse_names(buf, len, answer, kQueryNs, false);
    case kQueryTlsa: return parse_tlsa(buf, len, answer, false);
    case kQueryTxt: return parse_txt(buf, len, answer, false);
    case kQuerySrv: return parse_srv(buf, len, answer, false);
    case kQueryPtr: return parse_names(buf, len, answer, kQueryPtr, false);
    case kQueryNaptr: return parse_naptr(buf, len, answer, false);
    case kQuerySoa: return parse_soa(buf, len, answer);
    default: return ARES_EBADRESP;
    }
}

/* ------------------------------------------------------------------ queries */

typedef struct Query {
    Channel *channel;
    int kind;
    NtsHeader *callback;
    int status;
    /* A record query's response, as `ares_dns_write` wrote it. */
    unsigned char *buf;
    size_t len;
    /* A reverse lookup's names, copied out of the host entry. */
    char **names;
    size_t name_count;
    struct Query *next;
} Query;

/* Answers waiting for the next check phase: node's `SetImmediate`, with an
 * idle handle so the poll phase does not block while any is waiting. */
static Query *completed_head;
static Query *completed_tail;
static uv_check_t delivery_check;
static uv_idle_t delivery_idle;
static bool delivery_ready;

static void deliver(Query *query) {
    Answer answer = {0};
    int status = query->status;
    if (status == ARES_SUCCESS) {
        if (query->kind == kQueryReverse) {
            for (size_t i = 0; i < query->name_count; i++) add_text(&answer, latin1z(query->names[i]));
        } else {
            status = parse(query->kind, query->buf, (int)query->len, &answer);
        }
    }
    NtsHeader *callback = query->callback;
    if (callback != NULL) {
        NtsString *code = status == ARES_SUCCESS ? latin1z("") : latin1z(code_of(status));
        if (status != ARES_SUCCESS) answer_discard(&answer);
        NtsArray *texts = texts_array(&answer);
        NtsArray *numbers = numbers_array(&answer);
        ((void (*)(NtsHeader *, NtsString *, NtsArray *, NtsArray *))
             callback->descriptor->methods[nts_closure_call_slot])(callback, code, texts, numbers);
        /* A closure borrows its arguments -- it retains what it keeps -- so
         * the three made for this call are released here. */
        nts_release((NtsHeader *)code);
        nts_release((NtsHeader *)texts);
        nts_release((NtsHeader *)numbers);
        nts_release(callback);
    }
    answer_free(&answer);
    if (query->buf != NULL) ares_free_string(query->buf);
    for (size_t i = 0; i < query->name_count; i++) free(query->names[i]);
    free(query->names);
    free(query);
}

static void on_idle(uv_idle_t *handle) { (void)handle; }

static void on_check(uv_check_t *handle) {
    (void)handle;
    Query *ready = completed_head;
    completed_head = completed_tail = NULL;
    uv_check_stop(&delivery_check);
    uv_idle_stop(&delivery_idle);
    while (ready != NULL) {
        Query *next = ready->next;
        deliver(ready);
        ready = next;
    }
}

/* Node's `QueueResponseCallback`: the channel's bookkeeping now, the program
 * on the next turn. */
static void complete(Query *query, int status) {
    query->status = status;
    query->channel->query_last_ok = status != ARES_ECONNREFUSED;
    query->channel->active_queries--;
    if (!delivery_ready) {
        uv_check_init(loop(), &delivery_check);
        uv_idle_init(loop(), &delivery_idle);
        uv_unref((uv_handle_t *)&delivery_check);
        delivery_ready = true;
    }
    query->next = NULL;
    if (completed_tail != NULL) completed_tail->next = query;
    else completed_head = query;
    completed_tail = query;
    uv_check_start(&delivery_check, on_check);
    uv_idle_start(&delivery_idle, on_idle);
}

static void on_record(void *arg, ares_status_t status, size_t timeouts,
                      const ares_dns_record_t *record) {
    (void)timeouts;
    Query *query = arg;
    if (status == ARES_SUCCESS && record != NULL) {
        ares_dns_write(record, &query->buf, &query->len);
    }
    complete(query, (int)status);
}

static void on_host(void *arg, int status, int timeouts, struct hostent *host) {
    (void)timeouts;
    Query *query = arg;
    if (status == ARES_SUCCESS && host != NULL) {
        size_t count = 0;
        while (host->h_aliases != NULL && host->h_aliases[count] != NULL) count++;
        query->names = calloc(count == 0 ? 1 : count, sizeof *query->names);
        if (query->names != NULL) {
            for (size_t i = 0; i < count; i++) query->names[i] = strdup(host->h_aliases[i]);
            query->name_count = count;
        }
    }
    complete(query, status);
}

static ares_dns_rec_type_t record_type(int kind) {
    switch (kind) {
    case kQueryAny: return ARES_REC_TYPE_ANY;
    case kQueryA: return ARES_REC_TYPE_A;
    case kQueryAaaa: return ARES_REC_TYPE_AAAA;
    case kQueryCaa: return ARES_REC_TYPE_CAA;
    case kQueryCname: return ARES_REC_TYPE_CNAME;
    case kQueryMx: return ARES_REC_TYPE_MX;
    case kQueryNs: return ARES_REC_TYPE_NS;
    case kQueryTlsa: return ARES_REC_TYPE_TLSA;
    case kQueryTxt: return ARES_REC_TYPE_TXT;
    case kQuerySrv: return ARES_REC_TYPE_SRV;
    case kQueryPtr: return ARES_REC_TYPE_PTR;
    case kQueryNaptr: return ARES_REC_TYPE_NAPTR;
    default: return ARES_REC_TYPE_SOA;
    }
}

double nts_dns_channel_query(double id, double kind_value, NtsString *name, NtsHeader *callback) {
    Channel *channel = channel_of(id);
    int kind = (int)kind_value;
    char *text = cstring(name);
    if (text == NULL) text = strdup("");

    unsigned char address[sizeof(struct in6_addr)];
    int family = 0;
    size_t length = 0;
    if (kind == kQueryReverse) {
        /* Node's `ReverseTraits::Send`: not an address is a libuv EINVAL,
         * reported before anything is sent. */
        if (uv_inet_pton(AF_INET, text, address) == 0) {
            family = AF_INET;
            length = sizeof(struct in_addr);
        } else if (uv_inet_pton(AF_INET6, text, address) == 0) {
            family = AF_INET6;
            length = sizeof(struct in6_addr);
        } else {
            free(text);
            return UV_EINVAL;
        }
    }

    Query *query = calloc(1, sizeof *query);
    if (channel == NULL || query == NULL) {
        free(query);
        free(text);
        return UV_ENOMEM;
    }
    query->channel = channel;
    query->kind = kind;
    query->callback = callback;
    if (callback != NULL) nts_retain(callback);
    channel->active_queries++;

    if (kind == kQueryReverse) {
        ares_gethostbyaddr(channel->channel, address, (int)length, family, on_host, query);
    } else {
        ensure_servers(channel);
        ares_query_dnsrec(channel->channel, text, ARES_CLASS_IN, record_type(kind), on_record,
                          query, NULL);
    }
    free(text);
    return 0;
}
