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
// Both are here. This file is the `getaddrinfo` half; `resolver.ts` is the
// c-ares half, over the same c-ares node links.
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
import { resolverPromises } from "./resolver.ts";
import { AsyncRequest } from "../../internal/async-request.ts";
import { getDefaultTriggerAsyncId } from "../../internal/async-hooks.ts";
import {
  hasObserver,
  startPerf,
  stopPerf,
  type PerfContext,
} from "../../perf_hooks/src/observe.ts";

export {
  Resolver,
  getServers,
  resolve,
  resolve4,
  resolve6,
  resolveAny,
  resolveCaa,
  resolveCname,
  resolveMx,
  resolveNaptr,
  resolveNs,
  resolvePtr,
  resolveSoa,
  resolveSrv,
  resolveTlsa,
  resolveTxt,
  reverse,
  setServers,
} from "./resolver.ts";

/**
 * One address, resolved. `errno` is 0 on success and a negative libuv code
 * otherwise, which is the convention every binding in this profile uses.
 */
/** @ntsAbi managed */
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
/** @ntsAbi managed */
declare function nts_dns_getaddrinfo_all(
  hostname: string,
  family: number,
  hints: number,
  order: number,
  callback: (errno: number, addresses: string[], families: number[]) => void,
): void;

/** The reverse direction: an address and port to a hostname and service. */
/** @ntsAbi managed */
declare function nts_dns_getnameinfo(
  address: string,
  port: number,
  callback: (errno: number, hostname: string, service: string) => void,
): void;

/** `uv_err_name`, so an errno is reported the way node reports it. */
/** @ntsAbi managed */
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
 *
 * Declared fields rather than four assignments through a
 * `Record<string, unknown>` cast. The cast version was correct on the
 * interpreted lane and refused on the compiled one -- "`errno`, which `Error`
 * does not declare" -- and `cascade-reach.mjs` put three functions behind it.
 * An object with a fixed layout is what the backend can carry, and it is the
 * better TypeScript either way: the cast erased every one of these names from
 * the checker.
 */
/**
 * Node's name for a libuv errno. `EAI_NODATA` and `EAI_NONAME` are both
 * reported as `ENOTFOUND` -- "not a proper POSIX error", node's comment says,
 * and kept because programs have matched on it for a decade.
 */
function codeOf(errno: number): string {
  const name = nts_dns_errname(errno);
  return name === "EAI_NODATA" || name === "EAI_NONAME" ? "ENOTFOUND" : name;
}

class DNSException extends Error {
  errno: number;
  code: string;
  syscall: string;
  hostname: string;

  constructor(errno: number, syscall: string, hostname: string) {
    const code = codeOf(errno);
    super(`${syscall} ${code} ${hostname}`);
    this.errno = errno;
    this.code = code;
    this.syscall = syscall;
    this.hostname = hostname;
  }
}

/**
 * **No `captureStackTrace` here, and that is measured rather than forgotten.**
 *
 * Node's `DNSException` hides its own frame, so the first stack line below the
 * message belongs to the caller; ours leaves one frame of plumbing there. Adding
 * `captureStackTrace(error, dnsException)` fixes that and costs five functions on
 * the compiled lane:
 *
 *     without   59 refusal lines, `dnsException` not refused at all
 *     with      64 refusal lines, `dnsException` plus Closure10/11/12/47 refused
 *
 * because `captureStackTrace` is itself refused -- `internal/errors.ts:247`, a
 * parameter of type `CallableFunction | undefined`. Nothing live observes the
 * extra frame (`test-dns-memory-error.js` would, and it is skipped), so one
 * cosmetic stack line loses to five functions on the lane the goal is about.
 *
 * Re-add it when that union-parameter refusal is fixed; it is free then.
 */
function dnsException(errno: number, syscall: string, hostname: string): Error {
  return new DNSException(errno, syscall, hostname);
}

/**
 * Node's `validateHints`: only `ADDRCONFIG`, `ALL` and `V4MAPPED` may be set,
 * because those are the `getaddrinfo` flags node defines and passes through.
 */
function validateHints(hints: number): void {
  if ((hints & ~(ADDRCONFIG | ALL | V4MAPPED)) !== 0) {
    throw new ERR_INVALID_ARG_VALUE("hints", hints);
  }
}

/**
 * A `dns` performance entry for this lookup, started if anything observes
 * the type: node's `startPerf` in `lookup`. Node reports only a lookup that
 * went to the resolver -- not an empty name, not a literal address -- and
 * only once it succeeds.
 */
function lookupPerf(
  hostname: string,
  family: number,
  hints: number,
  order: number,
  dnsOrder: string,
): PerfContext | undefined {
  if (!hasObserver("dns")) return undefined;
  return startPerf("dns", "lookup", {
    hostname,
    family,
    hints,
    verbatim: order === ORDER_VERBATIM,
    order: dnsOrder,
  });
}

/** The same for `lookupService`. */
function lookupServicePerf(host: string, port: number): PerfContext | undefined {
  if (!hasObserver("dns")) return undefined;
  return startPerf("dns", "lookupService", { host, port });
}

/**
 * Report a timed operation that succeeded, if it was timed and is still
 * watched. `addresses` of a single-address lookup is that one address; node's
 * lists every address the resolver returned, which the binding here does not
 * hand back when only the first is wanted.
 */
function finishPerf(context: PerfContext | undefined, detail: Record<string, unknown>): void {
  if (context !== undefined && hasObserver("dns")) stopPerf(context, detail);
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
      validateHints(hints);
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
      // Hoisted and annotated, not written inline. The parameter is
      // `string | LookupAddress[] | null`, so an inline `[]` is contextually
      // typed as that union and the backend reads "an array literal that is not
      // an array". A `const` with its own annotation gives the literal a
      // concrete array type at the point it is written.
      const noAddresses: LookupAddress[] = [];
      nextTick(() => answer(null, noAddresses));
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
  const perf = lookupPerf(hostname, family, hints, order, dnsOrder);
  if (all) {
    const request = new AsyncRequest("GETADDRINFOREQWRAP", getDefaultTriggerAsyncId());
    nts_dns_getaddrinfo_all(hostname, family, hints, order, (errno, addresses, families) =>
      request.complete(() => {
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
        finishPerf(perf, { addresses: out });
      }),
    );
    return;
  }

  const request = new AsyncRequest("GETADDRINFOREQWRAP", getDefaultTriggerAsyncId());
  nts_dns_getaddrinfo(hostname, family, hints, order, (errno, address, resolved) =>
    request.complete(() => {
      if (errno !== 0) {
        answer(dnsException(errno, "getaddrinfo", hostname), null);
        return;
      }
      answer(null, address, resolved);
      finishPerf(perf, { addresses: [address] });
    }),
  );
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

  const perf = lookupServicePerf(address, resolvedPort);
  const request = new AsyncRequest("GETNAMEINFOREQWRAP", getDefaultTriggerAsyncId());
  nts_dns_getnameinfo(address, resolvedPort, (errno, hostname, service) =>
    request.complete(() => {
      if (errno !== 0) {
        callback(dnsException(errno, "getnameinfo", address), null, null);
        return;
      }
      callback(null, hostname, service);
      finishPerf(perf, { hostname, service });
    }),
  );
}

// The c-ares error codes, which node publishes on the module object and the
// resolver in `resolver.ts` reports failures with.
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
// The platform's own `AI_*`, because `dns.c` assigns `hints` straight to
// `ai_flags`. These were 1024 and 256, which are `AI_NUMERICSERV` and `AI_IDN` --
// so `lookup(host, { hints: dns.ADDRCONFIG })` asked for a numeric service and
// `dns.ALL` asked for IDN. Found by `surface-diff.mjs`, which compares published
// values against node and had never been run on this module; node publishes 32,
// 16 and 8, and node is right because these are the host's numbers.
export const ADDRCONFIG = 32;
export const ALL = 16;
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

/** A promise `lookup`'s answer: `null` is the address of an empty hostname, as node has it. */
export interface PromiseLookupAddress {
  address: string | null;
  family: number;
}

/**
 * Upstream `dns.promises.lookup`, node `lib/internal/dns/promises.js:197`.
 *
 * Its own parsing rather than the callback form's: it checks as it is called,
 * so a bad argument throws rather than rejects, it has no `"IPv4"` spelling of
 * a family, and an empty hostname resolves to `{ address: null }` at once.
 */
function promiseLookup(
  hostname: string,
  options?: LookupOptions | number,
): Promise<PromiseLookupAddress | LookupAddress[]> {
  let hints = 0;
  let family = 0;
  let all = false;
  let dnsOrder = getDefaultResultOrder();

  if (hostname) {
    validateStringWithoutNullBytes(hostname, "hostname");
  }

  if (typeof options === "number") {
    validateOneOf(options, "family", validFamilies);
    family = options + 0;
  } else if (options !== undefined && typeof options !== "object") {
    throw new ERR_INVALID_ARG_TYPE("options", ["integer", "object"], options);
  } else if (options !== undefined && options !== null) {
    if (options.hints !== undefined && options.hints !== null) {
      validateNumber(options.hints, "options.hints");
      hints = options.hints >>> 0;
      validateHints(hints);
    }
    if (options.family !== undefined && options.family !== null) {
      validateOneOf(options.family, "options.family", validFamilies);
      family = (options.family as number) + 0;
    }
    if (options.all !== undefined && options.all !== null) {
      validateBoolean(options.all, "options.all");
      all = options.all;
    }
    if (options.verbatim !== undefined && options.verbatim !== null) {
      validateBoolean(options.verbatim, "options.verbatim");
      dnsOrder = options.verbatim ? "verbatim" : "ipv4first";
    }
    if (options.order !== undefined && options.order !== null) {
      validateOneOf(options.order, "options.order", validDnsOrders);
      dnsOrder = options.order;
    }
  }

  return new Promise<PromiseLookupAddress | LookupAddress[]>((resolve, reject) => {
    if (!hostname) {
      if (all) {
        const noAddresses: LookupAddress[] = [];
        resolve(noAddresses);
      } else {
        resolve({ address: null, family: family === 6 ? 6 : 4 });
      }
      return;
    }

    const matchedFamily = isIP(hostname);
    if (matchedFamily !== 0) {
      const result: LookupAddress = { address: hostname, family: matchedFamily };
      if (all) resolve([result]);
      else resolve(result);
      return;
    }

    const order = orderOf(dnsOrder);
    const perf = lookupPerf(hostname, family, hints, order, dnsOrder);
    if (all) {
      const request = new AsyncRequest("GETADDRINFOREQWRAP", getDefaultTriggerAsyncId());
      nts_dns_getaddrinfo_all(hostname, family, hints, order, (errno, addresses, families) =>
        request.complete(() => {
          if (errno !== 0) {
            reject(dnsException(errno, "getaddrinfo", hostname));
            return;
          }
          const out: LookupAddress[] = [];
          for (let index = 0; index < addresses.length; index++) {
            const address = addresses[index];
            const each = families[index];
            if (address === undefined || each === undefined) continue;
            out.push({ address, family: each });
          }
          resolve(out);
          finishPerf(perf, { addresses: out });
        }),
      );
    } else {
      const request = new AsyncRequest("GETADDRINFOREQWRAP", getDefaultTriggerAsyncId());
      nts_dns_getaddrinfo(hostname, family, hints, order, (errno, address, resolvedFamily) =>
        request.complete(() => {
          if (errno !== 0) {
            reject(dnsException(errno, "getaddrinfo", hostname));
            return;
          }
          resolve({ address, family: resolvedFamily });
          finishPerf(perf, { addresses: [address] });
        }),
      );
    }
  });
}

/**
 * Upstream `dns.promises.lookupService`, node
 * `lib/internal/dns/promises.js:282`: exactly two arguments, an address, and
 * a port, all checked before the promise exists.
 */
function promiseLookupService(...args: [address?: unknown, port?: unknown]): Promise<LookupServiceResult> {
  if (args.length !== 2) throw new ERR_MISSING_ARGS("address", "port");
  const address = args[0];
  if (typeof address !== "string" || isIP(address) === 0) {
    throw new ERR_INVALID_ARG_VALUE("address", address);
  }
  const port = validatePort(args[1]);
  return new Promise<LookupServiceResult>((resolve, reject) => {
    const perf = lookupServicePerf(address, port);
    const request = new AsyncRequest("GETNAMEINFOREQWRAP", getDefaultTriggerAsyncId());
    nts_dns_getnameinfo(address, port, (errno, hostname, service) =>
      request.complete(() => {
        if (errno !== 0) {
          reject(dnsException(errno, "getnameinfo", address));
          return;
        }
        resolve({ hostname, service });
        finishPerf(perf, { hostname, service });
      }),
    );
  });
}

export const promises = {
  lookup: promiseLookup,
  lookupService: promiseLookupService,
  ...resolverPromises,
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
