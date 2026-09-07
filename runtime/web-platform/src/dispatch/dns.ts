import { AbortController } from "../core/abort.ts";
import type { AbortSignal } from "../core/abort.ts";
import { TransportError } from "../fetch/transport.ts";
import type {
  ByteConnection,
  CancelHandle,
  ConnectAddress,
  DnsAddress,
  DnsAddressFamily,
  DnsResolver,
  Scheduler,
  SocketConnector,
} from "../provider/primitives.ts";

const DEFAULT_MAXIMUM_ITEMS = 256;
const DEFAULT_MAXIMUM_PENDING = 64;
const DEFAULT_MAXIMUM_ADDRESSES = 32;
const DEFAULT_MAXIMUM_TTL_MILLISECONDS = 10000;
const DEFAULT_ATTEMPT_DELAY_MILLISECONDS = 250;
const DEFAULT_MAXIMUM_ATTEMPTS = 8;

interface CachedAddress {
  readonly address: string;
  readonly family: DnsAddressFamily;
  readonly expiresAt: number;
}

interface CacheRecord {
  readonly hostname: string;
  addresses: CachedAddress[];
  ipv4Offset: number;
  ipv6Offset: number;
}

interface PendingLookup {
  readonly key: string;
  readonly controller: AbortController;
  promise: Promise<readonly DnsAddress[]>;
  consumers: number;
  settled: boolean;
}

export interface DnsCacheOptions {
  readonly resolver: DnsResolver;
  /** A monotonic environment clock, never a wall clock. */
  readonly nowMilliseconds: () => number;
  readonly maximumItems?: number;
  readonly maximumPendingLookups?: number;
  readonly maximumAddressesPerHostname?: number;
  readonly maximumTTLMilliseconds?: number;
}

export interface DnsCacheStats {
  readonly entries: number;
  readonly pending: number;
  readonly cacheHits: number;
  readonly resolverCalls: number;
  readonly evictions: number;
}

export class DnsLookupLimitError extends Error {
  readonly code = "UND_ERR_DNS_QUEUE_FULL";
  readonly maximumPendingLookups: number;

  constructor(maximumPendingLookups: number) {
    super("The DNS lookup queue is full");
    this.name = "DnsLookupLimitError";
    this.maximumPendingLookups = maximumPendingLookups;
  }
}

export class DnsNoAddressError extends TransportError {
  readonly hostname: string;

  constructor(hostname: string) {
    super("ENOTFOUND", "No DNS address was returned for " + hostname);
    this.name = "DnsNoAddressError";
    this.hostname = hostname;
  }
}

export class DnsConnectionError extends TransportError {
  readonly hostname: string;
  readonly failures: readonly unknown[];

  constructor(hostname: string, failures: readonly unknown[]) {
    const cause = failures.length === 0 ? undefined : failures[failures.length - 1];
    super("UND_ERR_SOCKET", "Every resolved address failed for " + hostname, cause);
    this.name = "DnsConnectionError";
    this.hostname = hostname;
    this.failures = failures.slice();
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(name + " must be a positive safe integer");
  }
}

function validateNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(name + " must be a non-negative finite number");
  }
}

function familyKey(families: readonly DnsAddressFamily[]): string {
  if (families.length === 1 && families[0] === 4) return "4";
  if (families.length === 1 && families[0] === 6) return "6";
  if (
    families.length === 2 &&
    ((families[0] === 4 && families[1] === 6) || (families[0] === 6 && families[1] === 4))
  ) {
    return "46";
  }
  throw new TypeError("DNS families must contain 4, 6, or each exactly once");
}

function hasFamily(families: readonly DnsAddressFamily[], family: DnsAddressFamily): boolean {
  for (const candidate of families) if (candidate === family) return true;
  return false;
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isIPv4Address(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) return false;
    let number = 0;
    for (let index = 0; index < part.length; index++) {
      const code = part.charCodeAt(index);
      if (!isAsciiDigit(code)) return false;
      number = number * 10 + code - 48;
    }
    if (number > 255) return false;
  }
  return true;
}

function isIPv6Address(value: string): boolean {
  const compression = value.indexOf("::");
  if (compression !== value.lastIndexOf("::")) return false;
  if (compression < 0) {
    const groups = value.split(":");
    return ipv6GroupCount(groups, true) === 8;
  }
  const left = value.slice(0, compression);
  const right = value.slice(compression + 2);
  const leftGroups = left === "" ? [] : left.split(":");
  const rightGroups = right === "" ? [] : right.split(":");
  const leftCount = ipv6GroupCount(leftGroups, false);
  const rightCount = ipv6GroupCount(rightGroups, true);
  return leftCount !== null && rightCount !== null && leftCount + rightCount < 8;
}

function ipv6GroupCount(groups: readonly string[], mayEndWithIPv4: boolean): number | null {
  let count = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    if (group === undefined || group.length === 0) return null;
    if (group.includes(".")) {
      if (!mayEndWithIPv4 || groupIndex !== groups.length - 1 || !isIPv4Address(group)) {
        return null;
      }
      count += 2;
      continue;
    }
    if (group.length > 4) return null;
    for (let index = 0; index < group.length; index++) {
      const code = group.charCodeAt(index);
      if (!isAsciiDigit(code) && !(code >= 65 && code <= 70) && !(code >= 97 && code <= 102)) {
        return null;
      }
    }
    count++;
  }
  return count;
}

function isLiteralAddress(value: string): boolean {
  return isIPv4Address(value) || isIPv6Address(value);
}

function copyAddresses(addresses: readonly DnsAddress[]): readonly DnsAddress[] {
  const copied: DnsAddress[] = [];
  for (const address of addresses) {
    copied.push({
      address: address.address,
      family: address.family,
      ttlMilliseconds: address.ttlMilliseconds,
    });
  }
  return copied;
}

function callResolver(
  resolver: DnsResolver,
  hostname: string,
  families: readonly DnsAddressFamily[],
  maximumAddresses: number,
  signal: AbortSignal,
): Promise<readonly DnsAddress[]> {
  try {
    return resolver.resolve(hostname, { families, maximumAddresses }, signal);
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Environment-local positive DNS cache with bounded LRU storage and miss coalescing. */
export class DnsCache {
  private readonly resolver: DnsResolver;
  private readonly clock: () => number;
  private readonly maximumItems: number;
  private readonly maximumPendingLookups: number;
  private readonly maximumAddresses: number;
  private readonly maximumTTL: number;
  private readonly records = new Map<string, CacheRecord>();
  private readonly pending = new Map<string, PendingLookup>();
  private hitCount = 0;
  private resolverCallCount = 0;
  private evictionCount = 0;

  constructor(options: DnsCacheOptions) {
    this.resolver = options.resolver;
    this.clock = options.nowMilliseconds;
    this.maximumItems = options.maximumItems ?? DEFAULT_MAXIMUM_ITEMS;
    this.maximumPendingLookups = options.maximumPendingLookups ?? DEFAULT_MAXIMUM_PENDING;
    this.maximumAddresses = options.maximumAddressesPerHostname ?? DEFAULT_MAXIMUM_ADDRESSES;
    this.maximumTTL = options.maximumTTLMilliseconds ?? DEFAULT_MAXIMUM_TTL_MILLISECONDS;
    validatePositiveInteger(this.maximumItems, "maximumItems");
    validatePositiveInteger(this.maximumPendingLookups, "maximumPendingLookups");
    validatePositiveInteger(this.maximumAddresses, "maximumAddressesPerHostname");
    validateNonNegativeFinite(this.maximumTTL, "maximumTTLMilliseconds");
  }

  get stats(): DnsCacheStats {
    return {
      entries: this.records.size,
      pending: this.pending.size,
      cacheHits: this.hitCount,
      resolverCalls: this.resolverCallCount,
      evictions: this.evictionCount,
    };
  }

  lookup(
    hostname: string,
    families: readonly DnsAddressFamily[],
    signal: AbortSignal,
  ): Promise<readonly DnsAddress[]> {
    if (hostname.length === 0) return Promise.reject(new TypeError("DNS hostname is empty"));
    if (signal.aborted) return Promise.reject(signal.reason);
    const requested = familyKey(families);
    const normalizedHostname = hostname.toLowerCase();
    const cached = this.takeCached(normalizedHostname, families);
    if (cached.length !== 0) {
      this.hitCount++;
      return Promise.resolve(cached);
    }

    const pendingKey = normalizedHostname + "|" + requested;
    let lookup = this.pending.get(pendingKey);
    if (lookup === undefined) {
      if (this.pending.size >= this.maximumPendingLookups) {
        return Promise.reject(new DnsLookupLimitError(this.maximumPendingLookups));
      }
      lookup = this.startLookup(pendingKey, hostname, normalizedHostname, families);
    }
    return this.joinLookup(lookup, signal);
  }

  /**
   * Endpoints already known for this hostname, without resolving.
   *
   * Read-only on purpose: it neither performs a lookup nor advances the round-robin
   * rotation nor refreshes recency, because a caller deciding how to pool must not
   * change what the next real lookup answers. An empty result means "not known", never
   * "no addresses exist".
   */
  knownAddresses(
    hostname: string,
    families: readonly DnsAddressFamily[] = [4, 6],
  ): readonly string[] {
    if (hostname.length === 0) return [];
    const record = this.records.get(hostname.toLowerCase());
    if (record === undefined) return [];
    const now = this.now();
    const known: string[] = [];
    for (const address of record.addresses) {
      if (address.expiresAt <= now) continue;
      if (!hasFamily(families, address.family)) continue;
      known.push(address.address);
    }
    return known;
  }

  invalidate(hostname: string): boolean {
    return this.records.delete(hostname.toLowerCase());
  }

  clear(): void {
    this.records.clear();
  }

  private now(): number {
    const value = this.clock();
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError("DNS monotonic clock returned an invalid value");
    }
    return value;
  }

  private takeCached(
    hostname: string,
    families: readonly DnsAddressFamily[],
  ): readonly DnsAddress[] {
    const record = this.records.get(hostname);
    if (record === undefined) return [];
    const now = this.now();
    const valid: CachedAddress[] = [];
    for (const address of record.addresses) if (address.expiresAt > now) valid.push(address);
    record.addresses = valid;
    if (valid.length === 0) {
      this.records.delete(hostname);
      return [];
    }

    this.records.delete(hostname);
    this.records.set(hostname, record);
    const ipv4: DnsAddress[] = [];
    const ipv6: DnsAddress[] = [];
    for (const address of valid) {
      if (!hasFamily(families, address.family)) continue;
      const copy = {
        address: address.address,
        family: address.family,
        ttlMilliseconds: address.expiresAt - now,
      };
      if (address.family === 4) ipv4.push(copy);
      else ipv6.push(copy);
    }
    const result: DnsAddress[] = [];
    this.appendRotated(result, ipv4, record.ipv4Offset);
    this.appendRotated(result, ipv6, record.ipv6Offset);
    if (ipv4.length !== 0) record.ipv4Offset = (record.ipv4Offset + 1) % ipv4.length;
    if (ipv6.length !== 0) record.ipv6Offset = (record.ipv6Offset + 1) % ipv6.length;
    return result;
  }

  private appendRotated(result: DnsAddress[], source: readonly DnsAddress[], offset: number): void {
    for (let index = 0; index < source.length; index++) {
      const address = source[(offset + index) % source.length];
      if (address !== undefined) result.push(address);
    }
  }

  private startLookup(
    key: string,
    originalHostname: string,
    normalizedHostname: string,
    families: readonly DnsAddressFamily[],
  ): PendingLookup {
    const controller = new AbortController();
    const lookup: PendingLookup = {
      key,
      controller,
      promise: Promise.resolve<readonly DnsAddress[]>([]),
      consumers: 0,
      settled: false,
    };
    this.resolverCallCount++;
    lookup.promise = callResolver(
      this.resolver,
      originalHostname,
      families,
      this.maximumAddresses,
      controller.signal,
    ).then(
      (addresses) => {
        try {
          const normalized = this.normalize(addresses, families);
          if (normalized.length === 0) throw new DnsNoAddressError(originalHostname);
          this.store(normalizedHostname, families, normalized);
          return normalized;
        } finally {
          lookup.settled = true;
          this.pending.delete(key);
        }
      },
      (error) => {
        lookup.settled = true;
        this.pending.delete(key);
        throw error;
      },
    );
    this.pending.set(key, lookup);
    return lookup;
  }

  private joinLookup(lookup: PendingLookup, signal: AbortSignal): Promise<readonly DnsAddress[]> {
    const result = Promise.withResolvers<readonly DnsAddress[]>();
    let finished = false;
    lookup.consumers++;
    const release = (): void => {
      if (finished) return;
      finished = true;
      lookup.consumers--;
      if (lookup.consumers === 0 && !lookup.settled) {
        lookup.controller.abort(new TypeError("DNS lookup has no remaining consumer"));
      }
    };
    const unsubscribe = signal.subscribe(() => {
      if (finished) return;
      result.reject(signal.reason);
      release();
    });
    lookup.promise.then(
      (addresses) => {
        if (!finished) result.resolve(copyAddresses(addresses));
        unsubscribe();
        release();
      },
      (error) => {
        if (!finished) result.reject(error);
        unsubscribe();
        release();
      },
    );
    return result.promise;
  }

  private normalize(
    addresses: readonly DnsAddress[],
    families: readonly DnsAddressFamily[],
  ): readonly DnsAddress[] {
    if (addresses.length > this.maximumAddresses) {
      throw new TypeError("DNS provider exceeded the requested address bound");
    }
    const result: DnsAddress[] = [];
    const seen = new Set<string>();
    for (const address of addresses) {
      if (result.length >= this.maximumAddresses) break;
      if (!hasFamily(families, address.family)) continue;
      if (address.address.length === 0) throw new TypeError("DNS returned an empty address");
      if (address.family === 4 && !isIPv4Address(address.address)) {
        throw new TypeError("DNS returned an invalid IPv4 address");
      }
      if (address.family === 6 && !isIPv6Address(address.address)) {
        throw new TypeError("DNS returned an invalid IPv6 address");
      }
      validateNonNegativeFinite(address.ttlMilliseconds, "DNS record TTL");
      const key = String(address.family) + "|" + address.address;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        address: address.address,
        family: address.family,
        ttlMilliseconds: Math.min(address.ttlMilliseconds, this.maximumTTL),
      });
    }
    return result;
  }

  private store(
    hostname: string,
    families: readonly DnsAddressFamily[],
    addresses: readonly DnsAddress[],
  ): void {
    const now = this.now();
    const retained: CachedAddress[] = [];
    const previous = this.records.get(hostname);
    if (previous !== undefined) {
      for (const address of previous.addresses) {
        if (address.expiresAt > now && !hasFamily(families, address.family)) {
          retained.push(address);
        }
      }
    }
    for (const address of addresses) {
      if (address.ttlMilliseconds === 0) continue;
      retained.push({
        address: address.address,
        family: address.family,
        expiresAt: Math.min(Number.MAX_SAFE_INTEGER, now + address.ttlMilliseconds),
      });
    }
    if (retained.length === 0) return;

    if (previous === undefined && this.records.size >= this.maximumItems) {
      for (const oldest of this.records.keys()) {
        this.records.delete(oldest);
        this.evictionCount++;
        break;
      }
    }
    this.records.delete(hostname);
    this.records.set(hostname, {
      hostname,
      addresses: retained,
      ipv4Offset: previous?.ipv4Offset ?? 0,
      ipv6Offset: previous?.ipv6Offset ?? 0,
    });
  }
}

export interface DnsConnectorOptions {
  readonly cache: DnsCache;
  readonly connector: SocketConnector;
  readonly scheduler: Scheduler;
  readonly families?: readonly DnsAddressFamily[];
  readonly preferredFamily?: DnsAddressFamily;
  readonly attemptDelayMilliseconds?: number;
  readonly maximumAttempts?: number;
}

function connectWith(
  connector: SocketConnector,
  address: ConnectAddress,
  signal: AbortSignal,
): Promise<ByteConnection> {
  try {
    return connector.connect(address, signal);
  } catch (error) {
    return Promise.reject(error);
  }
}

/** DNS-caching connector with bounded RFC 8305-style staggered address attempts. */
export class DnsConnector implements SocketConnector {
  private readonly cache: DnsCache;
  private readonly connector: SocketConnector;
  private readonly scheduler: Scheduler;
  private readonly families: readonly DnsAddressFamily[];
  private readonly preferredFamily: DnsAddressFamily | undefined;
  private readonly attemptDelay: number;
  private readonly maximumAttempts: number;

  constructor(options: DnsConnectorOptions) {
    this.cache = options.cache;
    this.connector = options.connector;
    this.scheduler = options.scheduler;
    this.families = options.families ?? [4, 6];
    familyKey(this.families);
    this.preferredFamily = options.preferredFamily;
    if (this.preferredFamily !== undefined && !hasFamily(this.families, this.preferredFamily)) {
      throw new RangeError("preferredFamily must be present in families");
    }
    this.attemptDelay = options.attemptDelayMilliseconds ?? DEFAULT_ATTEMPT_DELAY_MILLISECONDS;
    this.maximumAttempts = options.maximumAttempts ?? DEFAULT_MAXIMUM_ATTEMPTS;
    validateNonNegativeFinite(this.attemptDelay, "attemptDelayMilliseconds");
    validatePositiveInteger(this.maximumAttempts, "maximumAttempts");
  }

  connect(address: ConnectAddress, signal: AbortSignal): Promise<ByteConnection> {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (address.resolvedAddress !== undefined || isLiteralAddress(address.hostname)) {
      return connectWith(this.connector, address, signal);
    }
    return this.cache.lookup(address.hostname, this.families, signal).then((addresses) => {
      signal.throwIfAborted();
      return this.connectResolved(address, this.order(addresses), signal);
    });
  }

  private order(addresses: readonly DnsAddress[]): readonly DnsAddress[] {
    const ipv4: DnsAddress[] = [];
    const ipv6: DnsAddress[] = [];
    for (const address of addresses) {
      if (address.family === 4) ipv4.push(address);
      else ipv6.push(address);
    }
    const firstFamily = this.preferredFamily ?? addresses[0]?.family ?? 4;
    const first = firstFamily === 4 ? ipv4 : ipv6;
    const second = firstFamily === 4 ? ipv6 : ipv4;
    const ordered: DnsAddress[] = [];
    let index = 0;
    while (
      ordered.length < this.maximumAttempts &&
      (index < first.length || index < second.length)
    ) {
      const primary = first[index];
      if (primary !== undefined) ordered.push(primary);
      if (ordered.length >= this.maximumAttempts) break;
      const alternate = second[index];
      if (alternate !== undefined) ordered.push(alternate);
      index++;
    }
    return ordered;
  }

  private connectResolved(
    logical: ConnectAddress,
    addresses: readonly DnsAddress[],
    signal: AbortSignal,
  ): Promise<ByteConnection> {
    if (addresses.length === 0) return Promise.reject(new DnsNoAddressError(logical.hostname));
    const result = Promise.withResolvers<ByteConnection>();
    const controllers = new Set<AbortController>();
    const failures: unknown[] = [];
    let nextIndex = 0;
    let active = 0;
    let settled = false;
    let nextTimer: CancelHandle | null = null;
    let unsubscribe = (): void => {};

    const stopOthers = (reason: unknown): void => {
      nextTimer?.cancel();
      nextTimer = null;
      for (const controller of controllers) controller.abort(reason);
      controllers.clear();
    };
    const rejectAll = (reason: unknown): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      stopOthers(reason);
      result.reject(reason);
    };
    const rejectExhausted = (): void => {
      if (settled || active !== 0 || nextIndex < addresses.length) return;
      this.cache.invalidate(logical.hostname);
      rejectAll(new DnsConnectionError(logical.hostname, failures));
    };
    const armNext = (): void => {
      if (settled || nextTimer !== null || nextIndex >= addresses.length) return;
      try {
        nextTimer = this.scheduler.delay(this.attemptDelay, () => {
          nextTimer = null;
          launchNext();
        });
      } catch (error) {
        rejectAll(error);
      }
    };
    const launchNext = (): void => {
      if (settled) return;
      const resolved = addresses[nextIndex];
      if (resolved === undefined) {
        rejectExhausted();
        return;
      }
      nextIndex++;
      active++;
      const controller = new AbortController();
      controllers.add(controller);
      const target: ConnectAddress =
        logical.alpnProtocols === undefined
          ? {
              hostname: logical.hostname,
              port: logical.port,
              secure: logical.secure,
              connectTimeoutMs: logical.connectTimeoutMs,
              resolvedAddress: resolved.address,
              resolvedFamily: resolved.family,
            }
          : {
              hostname: logical.hostname,
              port: logical.port,
              secure: logical.secure,
              connectTimeoutMs: logical.connectTimeoutMs,
              alpnProtocols: logical.alpnProtocols,
              resolvedAddress: resolved.address,
              resolvedFamily: resolved.family,
            };
      connectWith(this.connector, target, controller.signal).then(
        (connection) => {
          controllers.delete(controller);
          active--;
          if (settled) {
            connection.close();
            return;
          }
          settled = true;
          unsubscribe();
          stopOthers(new TypeError("Another DNS address connected first"));
          result.resolve(connection);
        },
        (error) => {
          controllers.delete(controller);
          active--;
          if (settled) return;
          failures.push(error);
          if (nextTimer !== null) {
            nextTimer.cancel();
            nextTimer = null;
          }
          if (nextIndex < addresses.length) launchNext();
          else rejectExhausted();
        },
      );
      armNext();
    };

    unsubscribe = signal.subscribe(() => rejectAll(signal.reason));
    launchNext();
    return result.promise;
  }
}
