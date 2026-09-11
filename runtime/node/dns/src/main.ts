// `node:dns`, from node v24.20.0 `lib/dns.js`.
//
// # Two capabilities behind one module name
//
// Node's `dns` is two resolvers wearing one export object. `lookup` and
// `lookupService` go through the platform's `getaddrinfo` and `getnameinfo` --
// the same calls `net.connect` already makes here, and the ones that consult
// `/etc/hosts` and the system resolver configuration. `resolve*`, `Resolver`,
// `setServers` and `getServers` go through **c-ares**, a DNS client that speaks
// the wire protocol itself and ignores the platform entirely.
//
// This module implements the first and not the second, because the first is a
// binding this profile already has. The omission is named in `not-applicable`
// file by file rather than hidden behind a pattern, so adding c-ares later is a
// list to work through rather than a rule to remember to delete.
//
// The distinction is observable and node documents it: `lookup` honours
// `/etc/hosts` and `resolve4` does not.

import {
  validateBoolean,
  validateFunction,
  validateNumber,
  validateOneOf,
  validatePort,
  validateString,
} from "../../internal/validators.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_MISSING_ARGS,
} from "../../internal/errors.ts";
import { isIP } from "../../net/src/address.ts";

/**
 * One address, resolved. `errno` is 0 on success and a negative libuv code
 * otherwise, which is the convention every binding in this profile uses.
 */
declare function nts_dns_getaddrinfo(
  hostname: string,
  family: number,
  hints: number,
  order: number,
  callback: (errno: number, address: string, family: number) => void,
): void;

/**
 * Every address for `hostname`, in the resolver's order.
 *
 * A separate binding rather than a flag, for the reason `net` gives for the same
 * split: the two answer with different shapes, and one entry point would have to
 * describe both in a single signature.
 */
declare function nts_dns_getaddrinfo_all(
  hostname: string,
  family: number,
  hints: number,
  order: number,
  callback: (errno: number, addresses: string[], families: number[]) => void,
): void;

/** The reverse direction: an address and port to a hostname and service. */
declare function nts_dns_getnameinfo(
  address: string,
  port: number,
  callback: (errno: number, hostname: string, service: string) => void,
): void;

/** `uv_err_name`, so an errno is reported the way node reports it. */
declare function nts_dns_errname(errno: number): string;

export interface LookupAddress {
  address: string;
  family: number;
}

export interface LookupOptions {
  family?: number | string | undefined;
  hints?: number | undefined;
  all?: boolean | undefined;
  verbatim?: boolean | undefined;
  order?: string | undefined;
}

type LookupCallback = (
  error: Error | null,
  address: string | LookupAddress[] | null,
  family?: number,
) => void;

// Node's `DNS_ORDER_*`. The numbers are this profile's own and pass straight
// through to the binding; only their relative meaning is node's.
const ORDER_VERBATIM = 0;
const ORDER_IPV4_FIRST = 1;
const ORDER_IPV6_FIRST = 2;

const validFamilies = [0, 4, 6];
const validDnsOrders = ["verbatim", "ipv4first", "ipv6first"];

let defaultResultOrder = "verbatim";

/** Upstream `getDefaultResultOrder`, node `lib/internal/dns/utils.js`. */
export function getDefaultResultOrder(): string {
  return defaultResultOrder;
}

/** Upstream `setDefaultResultOrder`. */
export function setDefaultResultOrder(order: string): void {
  validateOneOf(order, "order", validDnsOrders);
  defaultResultOrder = order;
}

/**
 * `validateStringWithoutNullBytes`, node `lib/internal/validators.js:171`.
 *
 * Local rather than added to `internal/validators.ts`: `dns` is its only caller
 * here, and a shared validator with one user is one whose contract nothing else
 * constrains.
 */
function validateStringWithoutNullBytes(value: unknown, name: string): void {
  validateString(value, name);
  if ((value as string).includes("\u0000")) {
    throw new ERR_INVALID_ARG_VALUE(name, value, "must be a string without null bytes");
  }
}

/**
 * Node's `DNSException`: an `Error` carrying `errno`, `code`, `syscall` and
 * `hostname`, with the code spelled as libuv spells it.
 */
function dnsException(errno: number, syscall: string, hostname: string): Error {
  const code = nts_dns_errname(errno);
  const error = new Error(`${syscall} ${code} ${hostname}`);
  const carrier = error as unknown as Record<string, unknown>;
  carrier.errno = errno;
  carrier.code = code;
  carrier.syscall = syscall;
  carrier.hostname = hostname;
  return error;
}

function orderOf(dnsOrder: string): number {
  if (dnsOrder === "ipv4first") return ORDER_IPV4_FIRST;
  if (dnsOrder === "ipv6first") return ORDER_IPV6_FIRST;
  return ORDER_VERBATIM;
}

/**
 * Upstream `lookup`, node `lib/dns.js:143`.
 *
 * The argument parsing is node's shape rather than a tidied version: the three
 * ways to give a family (`4`, `"IPv4"`, `{ family: 4 }`), the `-0` coercion, and
 * `verbatim` being the older spelling of `order` are each asserted by a pinned
 * test.
 */
export function lookup(
  hostname: string,
  options: LookupOptions | number | LookupCallback,
  callback?: LookupCallback,
): void {
  let hints = 0;
  let family = 0;
  let all = false;
  let dnsOrder = getDefaultResultOrder();
  let done = callback;

  if (hostname) {
    validateStringWithoutNullBytes(hostname, "hostname");
  }

  if (typeof options === "function") {
    done = options;
    family = 0;
  } else if (typeof options === "number") {
    validateFunction(done, "callback");
    validateOneOf(options, "family", validFamilies);
    family = options + 0;
  } else if (options !== undefined && typeof options !== "object") {
    throw new ERR_INVALID_ARG_TYPE("options", ["integer", "object"], options);
  } else {
    validateFunction(done, "callback");
    const given = options as LookupOptions | undefined;
    if (given !== undefined && given.hints !== undefined && given.hints !== null) {
      validateNumber(given.hints, "options.hints");
      hints = given.hints >>> 0;
    }
    if (given !== undefined && given.family !== undefined && given.family !== null) {
      if (given.family === "IPv4") {
        family = 4;
      } else if (given.family === "IPv6") {
        family = 6;
      } else {
        validateOneOf(given.family, "options.family", validFamilies);
        family = (given.family as number) + 0;
      }
    }
    if (given !== undefined && given.all !== undefined && given.all !== null) {
      validateBoolean(given.all, "options.all");
      all = given.all;
    }
    if (given !== undefined && given.verbatim !== undefined && given.verbatim !== null) {
      validateBoolean(given.verbatim, "options.verbatim");
      dnsOrder = given.verbatim ? "verbatim" : "ipv4first";
    }
    if (given !== undefined && given.order !== undefined && given.order !== null) {
      validateOneOf(given.order, "options.order", validDnsOrders);
      dnsOrder = given.order;
    }
  }

  const answer = done as LookupCallback;

  // A falsy hostname answers with `null` rather than an error -- node's shape,
  // and one a pinned test asserts. The family reported is 4 unless 6 was asked
  // for.
  if (!hostname) {
    if (all) {
      nextTick(() => answer(null, []));
    } else {
      nextTick(() => answer(null, null, family === 6 ? 6 : 4));
    }
    return;
  }

  // A literal address resolves to itself without consulting anything.
  const matchedFamily = isIP(hostname);
  if (matchedFamily !== 0) {
    if (all) {
      nextTick(() => answer(null, [{ address: hostname, family: matchedFamily }]));
    } else {
      nextTick(() => answer(null, hostname, matchedFamily));
    }
    return;
  }

  const order = orderOf(dnsOrder);
  if (all) {
    nts_dns_getaddrinfo_all(hostname, family, hints, order, (errno, addresses, families) => {
      if (errno !== 0) {
        answer(dnsException(errno, "getaddrinfo", hostname), null);
        return;
      }
      // The two arrays are the same length by the binding's contract, and
      // `noUncheckedIndexedAccess` does not know that. Read once and guard,
      // rather than assert: an assertion here would be the profile's own rule
      // about unchecked casts, broken for a convenience.
      const out: LookupAddress[] = [];
      for (let index = 0; index < addresses.length; index++) {
        const address = addresses[index];
        const family = families[index];
        if (address === undefined || family === undefined) continue;
        out.push({ address, family });
      }
      answer(null, out);
    });
    return;
  }

  nts_dns_getaddrinfo(hostname, family, hints, order, (errno, address, resolved) => {
    if (errno !== 0) {
      answer(dnsException(errno, "getaddrinfo", hostname), null);
      return;
    }
    answer(null, address, resolved);
  });
}

/**
 * Upstream `lookupService`, node `lib/dns.js:274`.
 *
 * Node's own first check is `arguments.length !== 3`, before it validates
 * anything, so a two-argument call reports the missing callback rather than a
 * bad address.
 */
export function lookupService(
  address: string,
  port: number,
  callback: (error: Error | null, hostname: string | null, service: string | null) => void,
): void {
  if (callback === undefined) {
    throw new ERR_MISSING_ARGS("address", "port", "callback");
  }
  if (isIP(address) === 0) {
    throw new ERR_INVALID_ARG_VALUE("address", address);
  }
  validatePort(port);
  validateFunction(callback, "callback");
  const resolvedPort = +port + 0;

  nts_dns_getnameinfo(address, resolvedPort, (errno, hostname, service) => {
    if (errno !== 0) {
      callback(dnsException(errno, "getnameinfo", address), null, null);
      return;
    }
    callback(null, hostname, service);
  });
}

// The c-ares error codes, which node publishes on the module object. They are
// data rather than behaviour, and a pinned test asserts each is present, so they
// are here even though nothing in this profile can raise one yet.
export const NODATA = "ENODATA";
export const FORMERR = "EFORMERR";
export const SERVFAIL = "ESERVFAIL";
export const NOTFOUND = "ENOTFOUND";
export const NOTIMP = "ENOTIMP";
export const REFUSED = "EREFUSED";
export const BADQUERY = "EBADQUERY";
export const BADNAME = "EBADNAME";
export const BADFAMILY = "EBADFAMILY";
export const BADRESP = "EBADRESP";
export const CONNREFUSED = "ECONNREFUSED";
export const TIMEOUT = "ETIMEOUT";
export const EOF = "EOF";
export const FILE = "EFILE";
export const NOMEM = "ENOMEM";
export const DESTRUCTION = "EDESTRUCTION";
export const BADSTR = "EBADSTR";
export const BADFLAGS = "EBADFLAGS";
export const NONAME = "ENONAME";
export const BADHINTS = "EBADHINTS";
export const NOTINITIALIZED = "ENOTINITIALIZED";
export const LOADIPHLPAPI = "ELOADIPHLPAPI";
export const ADDRGETNETWORKPARAMS = "EADDRGETNETWORKPARAMS";
export const CANCELLED = "ECANCELLED";

// `getaddrinfo` hint flags.
export const ADDRCONFIG = 1024;
export const ALL = 256;
export const V4MAPPED = 8;

// # `dns.promises`
//
// Node ships the same two entry points a second time, returning promises rather
// than taking callbacks, and a pinned test reads each one. They are written out
// rather than produced with `util.promisify`, because node's promise forms do
// not have the same shape as their callback forms: `lookup` without `all`
// resolves to `{ address, family }` where the callback receives two separate
// arguments, and `promisify` would hand back the first argument alone.
// `customPromisifyArgs` is how node reconciles those, and reproducing the
// reconciliation is more indirection than writing the four lines.

export interface LookupServiceResult {
  hostname: string;
  service: string;
}

function promiseLookup(
  hostname: string,
  options?: LookupOptions | number,
): Promise<LookupAddress | LookupAddress[]> {
  return new Promise<LookupAddress | LookupAddress[]>((resolve, reject) => {
    const done = (error: Error | null, address: string | LookupAddress[] | null, family?: number): void => {
      if (error !== null) {
        reject(error);
        return;
      }
      if (Array.isArray(address)) {
        resolve(address);
        return;
      }
      resolve({ address: (address as string) ?? "", family: family ?? 0 });
    };
    if (options === undefined) {
      lookup(hostname, done);
    } else {
      lookup(hostname, options, done);
    }
  });
}

function promiseLookupService(address: string, port: number): Promise<LookupServiceResult> {
  return new Promise<LookupServiceResult>((resolve, reject) => {
    lookupService(address, port, (error, hostname, service) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve({ hostname: hostname ?? "", service: service ?? "" });
    });
  });
}

export const promises = {
  lookup: promiseLookup,
  lookupService: promiseLookupService,
  getDefaultResultOrder,
  setDefaultResultOrder,
  NODATA,
  FORMERR,
  SERVFAIL,
  NOTFOUND,
  NOTIMP,
  REFUSED,
  BADQUERY,
  BADNAME,
  BADFAMILY,
  BADRESP,
  CONNREFUSED,
  TIMEOUT,
  EOF,
  FILE,
  NOMEM,
  DESTRUCTION,
  BADSTR,
  BADFLAGS,
  NONAME,
  BADHINTS,
  NOTINITIALIZED,
  LOADIPHLPAPI,
  ADDRGETNETWORKPARAMS,
  CANCELLED,
  ADDRCONFIG,
  ALL,
  V4MAPPED,
};
