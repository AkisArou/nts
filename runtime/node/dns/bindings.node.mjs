// The `nts_dns_*` bindings, stood in for by node's own resolver.
//
// # This makes the interpreted lane test the TypeScript, not the resolver
//
// `nts_dns_getaddrinfo` here is `dns.lookup` there. So on the interpreted lane
// this module's TypeScript runs over **node's** resolver, and a comparison
// against node measures the argument parsing, the option handling, the result
// shaping and the callback ordering -- not whether the resolution is right.
//
// That is the same arrangement `zlib` has, where the stand-in imports
// `node:zlib` and the compression engine is only compared on the compiled lane.
// It is stated here because the alternative is to discover it later and call it
// a result: a stand-in that *is* the subject makes a lane pass for nothing, and
// `run.mjs --sabotage` is what distinguishes the two -- blanking this module
// still breaks every test, because the TypeScript above is what is under test.
//
// The resolver itself is compared only on the compiled lane, where the binding
// is `getaddrinfo` rather than node's.
// The shared stand-ins first, as every module's are: `lookup` of an empty name
// answers on the next tick, and the tick queue's async context is one of them.
import "../internal/bindings.node.mjs";
// `dns` reports `dns` performance entries through perf_hooks' observers, which
// deliver on a timer check and read perf_hooks' clock.
import "../perf_hooks/bindings.node.mjs";
import { lookup, lookupService, Resolver } from "node:dns";
import { getSystemErrorName } from "node:util";

const errnoOf = (error) => {
  if (error === null || error === undefined) return 0;
  if (typeof error.errno === "number") return error.errno;
  return -1;
};

globalThis.nts_dns_getaddrinfo = (hostname, family, hints, order, callback) => {
  lookup(
    hostname,
    { family, hints, verbatim: order === 0 },
    (error, address, resolvedFamily) => {
      if (error) callback(errnoOf(error), "", 0);
      else callback(0, address, resolvedFamily);
    },
  );
};

globalThis.nts_dns_getaddrinfo_all = (hostname, family, hints, order, callback) => {
  lookup(
    hostname,
    { family, hints, all: true, verbatim: order === 0 },
    (error, addresses) => {
      if (error) {
        callback(errnoOf(error), [], []);
        return;
      }
      callback(0, addresses.map((a) => a.address), addresses.map((a) => a.family));
    },
  );
};

globalThis.nts_dns_getnameinfo = (address, port, callback) => {
  lookupService(address, port, (error, hostname, service) => {
    if (error) callback(errnoOf(error), "", "");
    else callback(0, hostname, service);
  });
};

// `uv_err_name`. Node exposes the same table through `util.getSystemErrorName`,
// which is the mapping this profile already uses for every other errno.
globalThis.nts_dns_errname = (errno) => {
  try {
    return getSystemErrorName(errno);
  } catch {
    return "UNKNOWN";
  }
};

// # The resolver's channel, stood in for by node's own
//
// Each channel is one of node's `dns.Resolver`s, so a query is c-ares's answer
// parsed by node, flattened here into the layout `src/resolver.ts` documents
// and rebuilt there. What this lane tests is the TypeScript around the channel
// -- validation, server parsing and formatting, error construction, the
// callback and promise forms -- for the reason the header gives for `lookup`.
// Server lists go through the channel's own handle (`_handle`, node's
// `ChannelWrap`), because that is the binding the TypeScript stands where
// node's JavaScript stands.
const channels = new Map();
let nextChannel = 1;
const channelOf = (id) => channels.get(id);

globalThis.nts_dns_channel_new = (timeout, tries, maxTimeout) => {
  const id = nextChannel++;
  channels.set(id, new Resolver({ timeout, tries, maxTimeout }));
  return id;
};

globalThis.nts_dns_channel_cancel = (id) => channelOf(id).cancel();

globalThis.nts_dns_channel_server_hosts = (id) =>
  (channelOf(id)._handle.getServers() || []).map((server) => server[0]);

globalThis.nts_dns_channel_server_ports = (id) =>
  (channelOf(id)._handle.getServers() || []).map((server) => server[1]);

globalThis.nts_dns_channel_set_servers = (id, families, hosts, ports) =>
  channelOf(id)._handle.setServers(families.map((family, index) => [family, hosts[index], ports[index]]));

globalThis.nts_dns_channel_set_local_address = (id, ipv4, ipv6) => {
  const resolver = channelOf(id);
  if (ipv4 !== "" && ipv6 !== "") resolver.setLocalAddress(ipv4, ipv6);
  else resolver.setLocalAddress(ipv4 !== "" ? ipv4 : ipv6);
};

const caresWrap = process.binding("cares_wrap");
globalThis.nts_dns_strerror = (status) => caresWrap.strerror(status);

// The query kinds, as `src/resolver.ts` numbers them.
const methods = [
  "resolveAny", "resolve4", "resolve6", "resolveCaa", "resolveCname", "resolveMx",
  "resolveNs", "resolveTlsa", "resolveTxt", "resolveSrv", "resolvePtr", "resolveNaptr",
  "resolveSoa", "reverse",
];
const kAny = 0;
const kA = 1;
const kAaaa = 2;
const kCaa = 3;
const kCname = 4;
const kMx = 5;
const kNs = 6;
const kTlsa = 7;
const kTxt = 8;
const kSrv = 9;
const kPtr = 10;
const kNaptr = 11;
const kSoa = 12;
const kReverse = 13;
const kindOfType = {
  A: kA, AAAA: kAaaa, CAA: kCaa, CNAME: kCname, MX: kMx, NS: kNs, TLSA: kTlsa,
  TXT: kTxt, SRV: kSrv, PTR: kPtr, NAPTR: kNaptr, SOA: kSoa,
};

/** One record of `kind` into `texts` and `numbers`, in the documented layout. */
function flatten(kind, record, texts, numbers, inAny) {
  switch (kind) {
    case kA:
    case kAaaa:
      texts.push(record.address);
      numbers.push(record.ttl);
      return;
    case kCname:
    case kNs:
    case kPtr:
    case kReverse:
      texts.push(inAny ? record.value : record);
      return;
    case kMx:
      texts.push(record.exchange);
      numbers.push(record.priority);
      return;
    case kTxt: {
      const entries = inAny ? record.entries : record;
      texts.push(...entries);
      numbers.push(entries.length);
      return;
    }
    case kSrv:
      texts.push(record.name);
      numbers.push(record.priority, record.weight, record.port);
      return;
    case kNaptr:
      texts.push(record.flags, record.service, record.regexp, record.replacement);
      numbers.push(record.order, record.preference);
      return;
    case kSoa:
      texts.push(record.nsname, record.hostmaster);
      numbers.push(record.serial, record.refresh, record.retry, record.expire, record.minttl);
      return;
    case kCaa: {
      const property = Object.keys(record).find((key) => key !== "critical" && key !== "type");
      texts.push(property, record[property]);
      numbers.push(record.critical);
      return;
    }
    case kTlsa: {
      const bytes = new Uint8Array(record.data);
      numbers.push(record.certUsage, record.selector, record.match, bytes.length, ...bytes);
      return;
    }
  }
}

globalThis.nts_dns_channel_query = (id, kind, name, callback) => {
  const done = (error, result) => {
    if (error) {
      callback(error.code, [], []);
      return;
    }
    const texts = [];
    const numbers = [];
    if (kind === kAny) {
      for (const record of result) {
        const each = kindOfType[record.type];
        numbers.push(each);
        flatten(each, record, texts, numbers, true);
      }
    } else if (kind === kSoa) {
      flatten(kind, result, texts, numbers, false);
    } else {
      for (const record of result) flatten(kind, record, texts, numbers, false);
    }
    callback("", texts, numbers);
  };
  try {
    if (kind === kA || kind === kAaaa) channelOf(id)[methods[kind]](name, { ttl: true }, done);
    else channelOf(id)[methods[kind]](name, done);
  } catch (error) {
    // Only `reverse` fails before it is sent, for a name that is not an
    // address, and it fails with a libuv errno as the native does.
    if (typeof error.errno === "number") return error.errno;
    throw error;
  }
  return 0;
};
