// The resolver half of `node:dns`: `Resolver`, `resolve*`, `reverse`,
// `getServers` and `setServers`, from node v24.20.0
// `lib/internal/dns/utils.js`, `lib/internal/dns/callback_resolver.js` and the
// resolver half of `lib/internal/dns/promises.js`.
//
// # c-ares underneath, as in node
//
// Node's resolver is c-ares, a DNS client that speaks the wire protocol itself
// and ignores `/etc/hosts`, behind `internalBinding('cares_wrap')`. This is
// node's JavaScript over the same seam: a channel per resolver, queries by
// record type, results parsed by c-ares and handed across as flat arrays. The
// natives below are `cares_wrap`'s, spelled for this profile; `dns.c` links
// the c-ares node vendors, so a compiled program resolves exactly as node does.
//
// # Results cross flat
//
// A record is an object and the seam carries scalars and arrays, so every
// query answers `(code, texts, numbers)` in a layout fixed per record type,
// written once below and once in `nts_dns.h`. The objects are built here, in
// node's field order.

import {
  ERR_DNS_SET_SERVERS_FAILED,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_ARG_VALUE_BINDING,
  ERR_INVALID_IP_ADDRESS,
} from "../../internal/errors.ts";
import {
  validateArray,
  validateFunction,
  validateInteger,
  validateString,
  validateUint32,
} from "../../internal/validators.ts";
import { isIP } from "../../net/src/address.ts";
import { idnaToASCII } from "../../url/src/idna.ts";
import { hasObserver, startPerf, stopPerf } from "../../perf_hooks/src/observe.ts";

/**
 * A c-ares channel with node's options: `timeout` in milliseconds (-1 for
 * c-ares's default), `tries` per server, and a `maxTimeout` cap on the
 * backed-off timeout (0 for none). The channel's id.
 */
/** @ntsAbi managed */
declare function nts_dns_channel_new(timeout: number, tries: number, maxTimeout: number): number;

/** `ares_cancel`: every pending query on the channel completes `ECANCELLED`. */
/** @ntsAbi managed */
declare function nts_dns_channel_cancel(channel: number): void;

/** The channel's servers' addresses, in order. */
/** @ntsAbi managed */
declare function nts_dns_channel_server_hosts(channel: number): string[];

/** The channel's servers' UDP ports, beside `nts_dns_channel_server_hosts`. */
/** @ntsAbi managed */
declare function nts_dns_channel_server_ports(channel: number): number[];

/**
 * Replace the channel's servers: `ARES_SUCCESS` (0), a c-ares status, or
 * `DNS_ESETSRVPENDING` (-1000) while a query is in flight.
 */
/** @ntsAbi managed */
declare function nts_dns_channel_set_servers(
  channel: number,
  families: number[],
  hosts: string[],
  ports: number[],
): number;

/** `ares_set_local_ip4` and `ares_set_local_ip6`; "" clears one. Validated here. */
/** @ntsAbi managed */
declare function nts_dns_channel_set_local_address(channel: number, ipv4: string, ipv6: string): void;

/**
 * Send one query. `kind` is a `QueryKind`; the callback receives node's error
 * code ("" on success) and the answer in that kind's layout. Returns 0, or a
 * libuv errno the query could not start with -- only `reverse`, for a string
 * that is not an address, as node's does.
 */
/** @ntsAbi managed */
declare function nts_dns_channel_query(
  channel: number,
  kind: number,
  name: string,
  callback: (code: string, texts: string[], numbers: number[]) => void,
): number;

/** `ares_strerror` for a status, and node's own message for -1000. */
/** @ntsAbi managed */
declare function nts_dns_strerror(status: number): string;

/** `uv_err_name`, for the one query that fails with a libuv errno. */
/** @ntsAbi managed */
declare function nts_dns_errname(errno: number): string;

/**
 * Every query node's `ChannelWrap` answers, by the number the native knows it
 * by, and the flat layout of its answer:
 *
 *   A, AAAA        texts: addresses          numbers: TTLs
 *   CNAME, NS,     texts: names              numbers: -
 *   PTR, REVERSE
 *   MX             texts: exchanges          numbers: priorities
 *   TXT            texts: every chunk        numbers: chunks per record
 *   SRV            texts: names              numbers: priority, weight, port per record
 *   NAPTR          texts: flags, service,    numbers: order, preference per record
 *                         regexp, replacement per record
 *   SOA            texts: nsname, hostmaster numbers: serial, refresh, retry, expire, minttl
 *   CAA            texts: property, value    numbers: critical per record
 *   TLSA           texts: -                  numbers: certUsage, selector, match,
 *                                                     byte length, the bytes, per record
 *   ANY            each record opens with its `QueryKind` in numbers, then that
 *                  kind's layout for one record (A and AAAA carry their TTL)
 */
const kQueryAny = 0;
const kQueryA = 1;
const kQueryAaaa = 2;
const kQueryCaa = 3;
const kQueryCname = 4;
const kQueryMx = 5;
const kQueryNs = 6;
const kQueryTlsa = 7;
const kQueryTxt = 8;
const kQuerySrv = 9;
const kQueryPtr = 10;
const kQueryNaptr = 11;
const kQuerySoa = 12;
const kQueryReverse = 13;

const IANA_DNS_PORT = 53;
const IPv6RE = /^\[([^[\]]*)\]/;
const addrSplitRE = /(^.+?)(?::(\d+))?$/;

export interface ResolverOptions {
  timeout?: number | undefined;
  tries?: number | undefined;
  maxTimeout?: number | undefined;
}

export interface ResolveOptions {
  ttl?: boolean | undefined;
}

export interface RecordWithTtl {
  address: string;
  ttl: number;
}

export interface MxRecord {
  exchange: string;
  priority: number;
}

export interface SrvRecord {
  name: string;
  port: number;
  priority: number;
  weight: number;
}

export interface NaptrRecord {
  flags: string;
  service: string;
  regexp: string;
  replacement: string;
  order: number;
  preference: number;
}

export interface SoaRecord {
  nsname: string;
  hostmaster: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minttl: number;
}

export interface CaaRecord {
  critical: number;
  [property: string]: number | string;
}

export interface TlsaRecord {
  certUsage: number;
  selector: number;
  match: number;
  data: ArrayBuffer;
}

/** What one query resolves to: its records, in the shape of their type. */
export type ResolveResult =
  | string[]
  | RecordWithTtl[]
  | MxRecord[]
  | string[][]
  | SrvRecord[]
  | NaptrRecord[]
  | SoaRecord
  | CaaRecord[]
  | TlsaRecord[]
  | AnyRecord[];

/** A record of `resolveAny`: one of the above, tagged with its type. */
export type AnyRecord = { type: string } & Record<string, unknown>;

/** Node's `validateTimeout`: -1 means c-ares's default. */
function validateTimeout(options: ResolverOptions | undefined): number {
  const { timeout = -1 } = { ...options };
  validateInteger(timeout, "options.timeout", -1, 2147483647);
  return timeout + 0;
}

function validateTries(options: ResolverOptions | undefined): number {
  const { tries = 4 } = { ...options };
  validateInteger(tries, "options.tries", 1, 2147483647);
  return tries;
}

function validateMaxTimeout(options: ResolverOptions | undefined): number {
  const { maxTimeout = 0 } = { ...options };
  validateUint32(maxTimeout, "options.maxTimeout");
  return maxTimeout + 0;
}

/** A server as `setServers` hands it down: family, address, port. */
type ServerTriple = [family: number, host: string, port: number];

/**
 * A resolver's failure: node's `DNSException` for a c-ares code, which has no
 * `errno` and carries the name it was asked about only when there was one.
 */
class DNSException extends Error {
  errno: number | undefined;
  code: string;
  syscall: string;
  hostname?: string;

  constructor(code: string, syscall: string, hostname: string, errno?: number) {
    super(`${syscall} ${code}${hostname ? ` ${hostname}` : ""}`);
    this.errno = errno;
    this.code = code;
    this.syscall = syscall;
    if (hostname) this.hostname = hostname;
  }
}

/**
 * The channel a resolver owns: node's `ChannelWrap`, by id, with its method
 * names -- node's tests replace `_handle.getServers` and `_handle.setServers`
 * to reach the paths a real server list cannot.
 */
class Channel {
  readonly id: number;

  constructor(timeout: number, tries: number, maxTimeout: number) {
    this.id = nts_dns_channel_new(timeout, tries, maxTimeout);
  }

  getServers(): Array<[host: string, port: number]> {
    const hosts = nts_dns_channel_server_hosts(this.id);
    const ports = nts_dns_channel_server_ports(this.id);
    const servers: Array<[string, number]> = [];
    for (let index = 0; index < hosts.length; index++) {
      servers.push([hosts[index]!, ports[index]!]);
    }
    return servers;
  }

  setServers(servers: readonly ServerTriple[]): number {
    return nts_dns_channel_set_servers(
      this.id,
      servers.map((server) => server[0]),
      servers.map((server) => server[1]),
      servers.map((server) => server[2]),
    );
  }
}

/**
 * Node's `ResolverBase`: a channel, its options, and the server list.
 *
 * `_handle` keeps node's name because node's own tests reach through it --
 * `resolver._handle.setServers` is what `test-dns-setserver-when-querying`
 * replaces to provoke a pending-query failure.
 */
class ResolverBase {
  _handle: Channel;

  constructor(options: ResolverOptions | undefined = undefined) {
    const timeout = validateTimeout(options);
    const tries = validateTries(options);
    const maxTimeout = validateMaxTimeout(options);
    this._handle = new Channel(timeout, tries, maxTimeout);
  }

  /** Abandon every pending query; each fails with `ECANCELLED`. */
  cancel(): void {
    nts_dns_channel_cancel(this._handle.id);
  }

  /** The servers, as addresses, with the port only where it is not 53. */
  getServers(): string[] {
    // `|| []` is node's: a replaced `getServers` that answers nothing is an
    // empty list, not a crash.
    return (this._handle.getServers() || []).map(([host, port]) => {
      if (!port || port === IANA_DNS_PORT) return host;
      return `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
    });
  }

  /**
   * Replace the servers. Each is an address, an address and a port, or an
   * IPv6 address in brackets with or without a port; anything else throws
   * before any server changes.
   */
  setServers(servers: unknown): void {
    validateArray(servers, "servers");
    const newSet: ServerTriple[] = [];
    servers.forEach((server, index) => {
      validateString(server, `servers[${index}]`);
      let ipVersion = isIP(server);
      if (ipVersion !== 0) {
        newSet.push([ipVersion, server, IANA_DNS_PORT]);
        return;
      }

      const match = IPv6RE.exec(server);
      if (match) {
        ipVersion = isIP(match[1]!);
        if (ipVersion !== 0) {
          const port = Number.parseInt(server.replace(addrSplitRE, "$2")) || IANA_DNS_PORT;
          newSet.push([ipVersion, match[1]!, port]);
          return;
        }
      }

      const addrSplitMatch = addrSplitRE.exec(server);
      if (addrSplitMatch) {
        const hostIP = addrSplitMatch[1]!;
        const port = addrSplitMatch[2] || IANA_DNS_PORT;
        ipVersion = isIP(hostIP);
        if (ipVersion !== 0) {
          newSet.push([ipVersion, hostIP, Number.parseInt(String(port))]);
          return;
        }
      }

      throw new ERR_INVALID_IP_ADDRESS(server);
    });

    const original: ServerTriple[] = (this._handle.getServers() || [])
      .map(([host, port]) => [isIP(host), host, port]);
    const errorNumber = this._handle.setServers(newSet);
    if (errorNumber !== 0) {
      this._handle.setServers(original);
      throw new ERR_DNS_SET_SERVERS_FAILED(nts_dns_strerror(errorNumber), servers as string[]);
    }
  }

  /**
   * The local addresses queries are sent from: one IPv4 and one IPv6, in
   * either order, the other left as the system's choice.
   */
  setLocalAddress(ipv4: unknown, ipv6?: unknown): void {
    validateString(ipv4, "ipv4");
    if (ipv6 !== undefined) validateString(ipv6, "ipv6");

    const first = isIP(ipv4);
    if (first === 0) throw new ERR_INVALID_ARG_VALUE_BINDING("Invalid IP address.");
    let local4 = first === 4 ? ipv4 : "";
    let local6 = first === 6 ? ipv4 : "";
    if (ipv6 !== undefined) {
      const second = isIP(ipv6);
      if (second === 0) throw new ERR_INVALID_ARG_VALUE_BINDING("Invalid IP address.");
      if (second === first) {
        throw new ERR_INVALID_ARG_VALUE_BINDING(
          `Cannot specify two IPv${second} addresses.`,
        );
      }
      if (second === 4) local4 = ipv6;
      else local6 = ipv6;
    }
    nts_dns_channel_set_local_address(this._handle.id, local4, local6);
  }
}

/** The records of one answer, rebuilt from their flat layout. */
function recordsOf(
  kind: number,
  texts: string[],
  numbers: number[],
  ttl: boolean,
): ResolveResult {
  switch (kind) {
    case kQueryA:
    case kQueryAaaa:
      return ttl
        ? texts.map((address, index) => ({ address, ttl: numbers[index]! }))
        : texts;
    case kQueryCname:
    case kQueryNs:
    case kQueryPtr:
    case kQueryReverse:
      return texts;
    case kQueryMx:
      return texts.map((exchange, index) => ({ exchange, priority: numbers[index]! }));
    case kQueryTxt: {
      const records: string[][] = [];
      let at = 0;
      for (const count of numbers) {
        records.push(texts.slice(at, at + count));
        at += count;
      }
      return records;
    }
    case kQuerySrv:
      return texts.map((name, index) => ({
        name,
        port: numbers[index * 3 + 2]!,
        priority: numbers[index * 3]!,
        weight: numbers[index * 3 + 1]!,
      }));
    case kQueryNaptr: {
      const records: NaptrRecord[] = [];
      for (let index = 0; index * 4 < texts.length; index++) {
        records.push({
          flags: texts[index * 4]!,
          service: texts[index * 4 + 1]!,
          regexp: texts[index * 4 + 2]!,
          replacement: texts[index * 4 + 3]!,
          order: numbers[index * 2]!,
          preference: numbers[index * 2 + 1]!,
        });
      }
      return records;
    }
    case kQuerySoa:
      return {
        nsname: texts[0]!,
        hostmaster: texts[1]!,
        serial: numbers[0]!,
        refresh: numbers[1]!,
        retry: numbers[2]!,
        expire: numbers[3]!,
        minttl: numbers[4]!,
      };
    case kQueryCaa: {
      const records: CaaRecord[] = [];
      for (let index = 0; index * 2 < texts.length; index++) {
        const record: CaaRecord = { critical: numbers[index]! };
        record[texts[index * 2]!] = texts[index * 2 + 1]!;
        records.push(record);
      }
      return records;
    }
    case kQueryTlsa: {
      const records: TlsaRecord[] = [];
      let at = 0;
      while (at < numbers.length) {
        const length = numbers[at + 3]!;
        const data = new Uint8Array(length);
        for (let byte = 0; byte < length; byte++) data[byte] = numbers[at + 4 + byte]!;
        records.push({
          certUsage: numbers[at]!,
          selector: numbers[at + 1]!,
          match: numbers[at + 2]!,
          data: data.buffer,
        });
        at += 4 + length;
      }
      return records;
    }
    default:
      return anyRecordsOf(texts, numbers);
  }
}

/**
 * `resolveAny`'s answer: every record tagged with its type, in the order
 * node's `AnyTraits::Parse` reports the types -- which is by type, not by the
 * order the server sent them.
 */
function anyRecordsOf(texts: string[], numbers: number[]): AnyRecord[] {
  const records: AnyRecord[] = [];
  let t = 0;
  let n = 0;
  while (n < numbers.length) {
    const kind = numbers[n++]!;
    switch (kind) {
      case kQueryA:
      case kQueryAaaa:
        records.push({ address: texts[t++]!, ttl: numbers[n++]!, type: kind === kQueryA ? "A" : "AAAA" });
        break;
      case kQueryCname:
        records.push({ value: texts[t++]!, type: "CNAME" });
        break;
      case kQueryMx:
        records.push({ exchange: texts[t++]!, priority: numbers[n++]!, type: "MX" });
        break;
      case kQueryNs:
        records.push({ value: texts[t++]!, type: "NS" });
        break;
      case kQueryPtr:
        records.push({ value: texts[t++]!, type: "PTR" });
        break;
      case kQueryTxt: {
        const count = numbers[n++]!;
        records.push({ entries: texts.slice(t, t + count), type: "TXT" });
        t += count;
        break;
      }
      case kQuerySrv:
        records.push({
          name: texts[t++]!,
          port: numbers[n + 2]!,
          priority: numbers[n]!,
          weight: numbers[n + 1]!,
          type: "SRV",
        });
        n += 3;
        break;
      case kQueryNaptr:
        records.push({
          flags: texts[t]!,
          service: texts[t + 1]!,
          regexp: texts[t + 2]!,
          replacement: texts[t + 3]!,
          order: numbers[n]!,
          preference: numbers[n + 1]!,
          type: "NAPTR",
        });
        t += 4;
        n += 2;
        break;
      case kQuerySoa:
        records.push({
          nsname: texts[t]!,
          hostmaster: texts[t + 1]!,
          serial: numbers[n]!,
          refresh: numbers[n + 1]!,
          retry: numbers[n + 2]!,
          expire: numbers[n + 3]!,
          minttl: numbers[n + 4]!,
          type: "SOA",
        });
        t += 2;
        n += 5;
        break;
      case kQueryCaa: {
        const record: Record<string, unknown> = { critical: numbers[n++]! };
        record[texts[t]!] = texts[t + 1]!;
        records.push({ ...record, type: "CAA" });
        t += 2;
        break;
      }
      case kQueryTlsa: {
        const length = numbers[n + 3]!;
        const data = new Uint8Array(length);
        for (let byte = 0; byte < length; byte++) data[byte] = numbers[n + 4 + byte]!;
        records.push({
          certUsage: numbers[n]!,
          selector: numbers[n + 1]!,
          match: numbers[n + 2]!,
          data: data.buffer,
          type: "TLSA",
        });
        n += 4 + length;
        break;
      }
      default:
        return records;
    }
  }
  return records;
}

/**
 * The name as it goes on the wire: node passes every query name through
 * `ada::idna::to_ascii`, and this is the same UTS-46 conversion, from `url`.
 * Measured against node v24.20.0 with a local server recording what arrived
 * (`test/query-name-static.js` keeps it):
 *
 *     resolve4("Example.COM")   the server sees  example.com
 *     resolve4("bücher.de")     the server sees  xn--bcher-kva.de
 *     resolve4("a%b.com")       EBADNAME, nothing sent
 *     resolve4("a b.com")       EBADNAME, nothing sent
 *     resolve4("")              sent, as the root
 *
 * The two refusals are c-ares's, for characters a DNS name cannot carry --
 * the conversion leaves them in, which is why this is `idnaToASCII` and not
 * the URL host conversion, whose forbidden-code-point check would turn them
 * into `""`, a name c-ares does send.
 */
function queryName(hostname: string): string {
  return idnaToASCII(hostname);
}

/**
 * Send one query and hand its answer to `settle`: the one place both
 * resolvers reach the channel.
 */
function query(
  resolver: ResolverBase,
  bindingName: string,
  kind: number,
  hostname: string,
  ttl: boolean,
  settle: (error: DNSException | null, result: ResolveResult | null) => void,
): void {
  const name = kind === kQueryReverse ? hostname : queryName(hostname);
  // Node's `startPerf` for a query: named for its binding, timed from the send.
  const perf = hasObserver("dns") ? startPerf("dns", bindingName, { host: hostname, ttl }) : undefined;
  const errno = nts_dns_channel_query(resolver._handle.id, kind, name, (code, texts, numbers) => {
    if (code !== "") {
      settle(new DNSException(code, bindingName, hostname), null);
      return;
    }
    const result = recordsOf(kind, texts, numbers, ttl);
    settle(null, result);
    if (perf !== undefined && hasObserver("dns")) stopPerf(perf, { result });
  });
  if (errno !== 0) throw new DNSException(nts_dns_errname(errno), bindingName, hostname, errno);
}

/** The bindings behind each method, as node names them in errors. */
const kBindingNames: ReadonlyArray<[method: string, binding: string, kind: number, rrtype: string]> = [
  ["resolveAny", "queryAny", kQueryAny, "ANY"],
  ["resolve4", "queryA", kQueryA, "A"],
  ["resolve6", "queryAaaa", kQueryAaaa, "AAAA"],
  ["resolveCaa", "queryCaa", kQueryCaa, "CAA"],
  ["resolveCname", "queryCname", kQueryCname, "CNAME"],
  ["resolveMx", "queryMx", kQueryMx, "MX"],
  ["resolveNs", "queryNs", kQueryNs, "NS"],
  ["resolveTlsa", "queryTlsa", kQueryTlsa, "TLSA"],
  ["resolveTxt", "queryTxt", kQueryTxt, "TXT"],
  ["resolveSrv", "querySrv", kQuerySrv, "SRV"],
  ["resolvePtr", "queryPtr", kQueryPtr, "PTR"],
  ["resolveNaptr", "queryNaptr", kQueryNaptr, "NAPTR"],
  ["resolveSoa", "querySoa", kQuerySoa, "SOA"],
];

/** The record type `resolve` takes, to the query kind that answers it. */
function kindOfRrtype(rrtype: string): number | undefined {
  for (const [, , kind, name] of kBindingNames) {
    if (name === rrtype) return kind;
  }
  return undefined;
}

function bindingNameOf(kind: number): string {
  if (kind === kQueryReverse) return "getHostByAddr";
  for (const [, binding, each] of kBindingNames) {
    if (each === kind) return binding;
  }
  return "queryA";
}

type ResolveCallback = (error: Error | null, result?: ResolveResult) => void;

/**
 * The callback resolver's query: `(name, callback)` or `(name, options,
 * callback)`, the options being `{ ttl }`.
 */
function callbackQuery(
  resolver: ResolverBase,
  kind: number,
  args: unknown[],
): void {
  let name = args[0];
  let options: unknown = undefined;
  let callback = args[1];
  if (args.length > 2) {
    options = args[1];
    callback = args[2];
  }
  validateString(name, "name");
  validateFunction(callback, "callback");
  const done = callback as ResolveCallback;
  const ttl = hasTtl(options);
  query(resolver, bindingNameOf(kind), kind, name, ttl, (error, result) => {
    if (error !== null) done(error);
    else done(null, result!);
  });
}

/** `!!(options?.ttl)`, for options that may be any value. */
function hasTtl(options: unknown): boolean {
  if (options === null || options === undefined) return false;
  if (typeof options !== "object" && typeof options !== "function") return false;
  return "ttl" in options && Boolean(options.ttl);
}

/** Node's callback `Resolver`. */
export class Resolver extends ResolverBase {
  resolveAny(...args: unknown[]): void {
    callbackQuery(this, kQueryAny, args);
  }

  resolve4(...args: unknown[]): void {
    callbackQuery(this, kQueryA, args);
  }

  resolve6(...args: unknown[]): void {
    callbackQuery(this, kQueryAaaa, args);
  }

  resolveCaa(...args: unknown[]): void {
    callbackQuery(this, kQueryCaa, args);
  }

  resolveCname(...args: unknown[]): void {
    callbackQuery(this, kQueryCname, args);
  }

  resolveMx(...args: unknown[]): void {
    callbackQuery(this, kQueryMx, args);
  }

  resolveNs(...args: unknown[]): void {
    callbackQuery(this, kQueryNs, args);
  }

  resolveTlsa(...args: unknown[]): void {
    callbackQuery(this, kQueryTlsa, args);
  }

  resolveTxt(...args: unknown[]): void {
    callbackQuery(this, kQueryTxt, args);
  }

  resolveSrv(...args: unknown[]): void {
    callbackQuery(this, kQuerySrv, args);
  }

  resolvePtr(...args: unknown[]): void {
    callbackQuery(this, kQueryPtr, args);
  }

  resolveNaptr(...args: unknown[]): void {
    callbackQuery(this, kQueryNaptr, args);
  }

  resolveSoa(...args: unknown[]): void {
    callbackQuery(this, kQuerySoa, args);
  }

  reverse(...args: unknown[]): void {
    callbackQuery(this, kQueryReverse, args);
  }

  resolve(hostname: unknown, rrtype: unknown, callback?: unknown): void {
    callbackResolve(this, hostname, rrtype, callback);
  }
}

/** `resolve(hostname[, rrtype], callback)`, with `A` when no type is given. */
function callbackResolve(
  resolver: ResolverBase,
  hostname: unknown,
  rrtype: unknown,
  callback: unknown,
): void {
  let kind: number | undefined;
  let done = callback;
  if (typeof rrtype === "string") {
    kind = kindOfRrtype(rrtype);
  } else if (typeof rrtype === "function") {
    kind = kQueryA;
    done = rrtype;
  } else {
    throw new ERR_INVALID_ARG_TYPE("rrtype", "string", rrtype);
  }
  if (kind === undefined) throw new ERR_INVALID_ARG_VALUE("rrtype", rrtype);
  callbackQuery(resolver, kind, [hostname, done]);
}

/** The promise resolver's query: `(name[, options])`. */
function promiseQuery(
  resolver: ResolverBase,
  kind: number,
  name: unknown,
  options: unknown,
): Promise<ResolveResult> {
  validateString(name, "name");
  const ttl = hasTtl(options);
  const bindingName = bindingNameOf(kind);
  return new Promise<ResolveResult>((resolve, reject) => {
    try {
      query(resolver, bindingName, kind, name, ttl, (error, result) => {
        if (error !== null) reject(error);
        else resolve(result!);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/** Node's promise `Resolver`, from `dns.promises`. */
export class PromiseResolver extends ResolverBase {
  resolveAny(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryAny, name, options);
  }

  resolve4(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryA, name, options);
  }

  resolve6(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryAaaa, name, options);
  }

  resolveCaa(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryCaa, name, options);
  }

  resolveCname(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryCname, name, options);
  }

  resolveMx(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryMx, name, options);
  }

  resolveNs(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryNs, name, options);
  }

  resolveTlsa(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryTlsa, name, options);
  }

  resolveTxt(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryTxt, name, options);
  }

  resolveSrv(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQuerySrv, name, options);
  }

  resolvePtr(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryPtr, name, options);
  }

  resolveNaptr(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryNaptr, name, options);
  }

  resolveSoa(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQuerySoa, name, options);
  }

  reverse(name: unknown, options?: unknown): Promise<ResolveResult> {
    return promiseQuery(this, kQueryReverse, name, options);
  }

  resolve(hostname: unknown, rrtype?: unknown): Promise<ResolveResult> {
    return promiseResolve(this, hostname, rrtype);
  }
}

/** `resolve(hostname[, rrtype])`, with `A` when no type is given. */
function promiseResolve(
  resolver: ResolverBase,
  hostname: unknown,
  rrtype: unknown,
): Promise<ResolveResult> {
  let kind: number | undefined = kQueryA;
  if (rrtype !== undefined) {
    validateString(rrtype, "rrtype");
    kind = kindOfRrtype(rrtype);
    if (kind === undefined) throw new ERR_INVALID_ARG_VALUE("rrtype", rrtype);
  }
  return promiseQuery(resolver, kind, hostname, undefined);
}

/**
 * The resolver `dns.resolve*` and `dns.promises.resolve*` use until a
 * `setServers` replaces it. One for both, as node's is: setting the servers
 * through either namespace changes where the other sends its queries.
 *
 * # Looked up per call, not bound
 *
 * Node rebinds the module's `resolve*` properties to the new resolver on every
 * `setServers`, so `dns.resolve4` read after it is a different function. Here
 * each module function asks for the default resolver when it runs. A caller
 * that kept the old function -- `const { resolve4 } = dns`, then
 * `dns.setServers(...)` -- therefore reaches the new servers where node's
 * would still use the old ones; every read of `dns.resolve4` after the change
 * agrees with node, and it is what a module whose exports are fixed at load
 * can offer.
 */
let defaultResolver: ResolverBase | undefined;

function getDefaultResolver(): ResolverBase {
  defaultResolver ??= new Resolver();
  return defaultResolver;
}

// # The module's own functions, over the default resolver

export function resolveAny(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryAny, args);
}

export function resolve4(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryA, args);
}

export function resolve6(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryAaaa, args);
}

export function resolveCaa(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryCaa, args);
}

export function resolveCname(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryCname, args);
}

export function resolveMx(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryMx, args);
}

export function resolveNs(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryNs, args);
}

export function resolveTlsa(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryTlsa, args);
}

export function resolveTxt(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryTxt, args);
}

export function resolveSrv(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQuerySrv, args);
}

export function resolvePtr(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryPtr, args);
}

export function resolveNaptr(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryNaptr, args);
}

export function resolveSoa(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQuerySoa, args);
}

export function reverse(...args: unknown[]): void {
  callbackQuery(getDefaultResolver(), kQueryReverse, args);
}

export function resolve(hostname: unknown, rrtype: unknown, callback?: unknown): void {
  callbackResolve(getDefaultResolver(), hostname, rrtype, callback);
}

export function getServers(): string[] {
  return getDefaultResolver().getServers();
}

/** `dns.setServers`: a new default resolver, for both namespaces. */
export function setServers(servers: unknown): void {
  const resolver = new Resolver();
  resolver.setServers(servers);
  defaultResolver = resolver;
}

/** What `dns.promises` adds for the resolver, over the same default. */
export const resolverPromises = {
  Resolver: PromiseResolver,
  getServers,
  setServers(servers: unknown): void {
    const resolver = new PromiseResolver();
    resolver.setServers(servers);
    defaultResolver = resolver;
  },
  resolveAny: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryAny, name, options),
  resolve4: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryA, name, options),
  resolve6: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryAaaa, name, options),
  resolveCaa: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryCaa, name, options),
  resolveCname: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryCname, name, options),
  resolveMx: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryMx, name, options),
  resolveNs: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryNs, name, options),
  resolveTlsa: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryTlsa, name, options),
  resolveTxt: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryTxt, name, options),
  resolveSrv: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQuerySrv, name, options),
  resolvePtr: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryPtr, name, options),
  resolveNaptr: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryNaptr, name, options),
  resolveSoa: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQuerySoa, name, options),
  reverse: (name: unknown, options?: unknown) =>
    promiseQuery(getDefaultResolver(), kQueryReverse, name, options),
  resolve: (hostname: unknown, rrtype?: unknown) =>
    promiseResolve(getDefaultResolver(), hostname, rrtype),
};
