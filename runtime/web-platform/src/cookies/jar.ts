import { parseCookieForRequest } from "./cookies.ts";
import type { CookieSameSite } from "./cookies.ts";
import type { URLParser, URLRecord } from "../provider/primitives.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";

const maximumPersistentAgeSeconds = 400 * 24 * 60 * 60;

export type StoredSameSite = CookieSameSite | "Default";
export type CookieAccessType = "http" | "non-http";
export type CookieSameSiteStatus = "same-site" | "cross-site";

/** Explicit request context; this runtime does not invent a browser top-level site. */
export interface CookieAccessContext {
  type?: CookieAccessType;
  sameSite?: CookieSameSiteStatus;
  topLevelNavigation?: boolean;
  method?: string;
}

export interface StoredCookie {
  readonly name: string;
  readonly value: string;
  readonly expiryTime: number | null;
  readonly domain: string;
  readonly path: string;
  readonly creationTime: number;
  readonly lastAccessTime: number;
  readonly creationIndex: number;
  readonly persistent: boolean;
  readonly hostOnly: boolean;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: StoredSameSite;
}

/** Durable implementations atomically replace the previous snapshot or reject. */
export interface CookieJarStore {
  loadAll(): Promise<readonly StoredCookie[]>;
  saveAll(cookies: readonly StoredCookie[]): Promise<void>;
  close?(): Promise<void>;
}

/** A PSL-backed implementation should be pinned and updated independently of cookie policy. */
export interface PublicSuffixChecker {
  isPublicSuffix(canonicalDomain: string): boolean;
}

export interface CookieJarOptions {
  urls?: URLParser;
  wallTimeMilliseconds?: () => number;
  store?: CookieJarStore;
  publicSuffixes?: PublicSuffixChecker;
  isSecure?: (url: URLRecord) => boolean;
  maxCookiesPerDomain?: number;
  maxCookies?: number;
  maxPersistentAgeSeconds?: number;
}

function cloneCookie(cookie: StoredCookie): StoredCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    expiryTime: cookie.expiryTime,
    domain: cookie.domain,
    path: cookie.path,
    creationTime: cookie.creationTime,
    lastAccessTime: cookie.lastAccessTime,
    creationIndex: cookie.creationIndex,
    persistent: cookie.persistent,
    hostOnly: cookie.hostOnly,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  };
}

export class MemoryCookieJarStore implements CookieJarStore {
  private cookies: StoredCookie[] = [];

  async loadAll(): Promise<readonly StoredCookie[]> {
    return this.cookies.map(cloneCookie);
  }

  async saveAll(cookies: readonly StoredCookie[]): Promise<void> {
    this.cookies = cookies.map(cloneCookie);
  }
}

function validateLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid " + name);
  return value;
}

/**
 * Whether a value has the shape the jar's own invariants assume.
 *
 * Exported because a durable store has to answer the same question about bytes it read
 * back, and two definitions of "a valid cookie" would drift. This is the jar's.
 */
export function validStoredCookieShape(cookie: StoredCookie): boolean {
  return (
    typeof cookie.name === "string" &&
    typeof cookie.value === "string" &&
    (cookie.expiryTime === null || Number.isFinite(cookie.expiryTime)) &&
    typeof cookie.domain === "string" &&
    cookie.domain.length > 0 &&
    typeof cookie.path === "string" &&
    cookie.path.startsWith("/") &&
    Number.isFinite(cookie.creationTime) &&
    Number.isFinite(cookie.lastAccessTime) &&
    Number.isSafeInteger(cookie.creationIndex) &&
    cookie.creationIndex >= 0 &&
    cookie.creationIndex < Number.MAX_SAFE_INTEGER &&
    typeof cookie.persistent === "boolean" &&
    cookie.persistent === (cookie.expiryTime !== null) &&
    typeof cookie.hostOnly === "boolean" &&
    typeof cookie.secure === "boolean" &&
    typeof cookie.httpOnly === "boolean" &&
    (cookie.sameSite === "Default" ||
      cookie.sameSite === "Strict" ||
      cookie.sameSite === "Lax" ||
      cookie.sameSite === "None")
  );
}

function hasNonOctet(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) > 255) return true;
  }
  return false;
}

function defaultPath(pathname: string): string {
  if (pathname.length === 0 || pathname.charAt(0) !== "/") return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function isIPv4(host: string): boolean {
  if (host.length === 0) return false;
  for (let index = 0; index < host.length; index++) {
    const code = host.charCodeAt(index);
    if (code !== 46 && (code < 48 || code > 57)) return false;
  }
  return true;
}

function isIPAddress(host: string): boolean {
  return host.includes(":") || isIPv4(host);
}

export function domainMatches(host: string, domain: string): boolean {
  if (host === domain) return true;
  return !isIPAddress(host) && host.endsWith("." + domain);
}

export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/";
}

function isSafeMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === "GET" || upper === "HEAD" || upper === "OPTIONS" || upper === "TRACE";
}

function isSecureURL(url: URLRecord): boolean {
  return url.protocol === "https:" || url.protocol === "wss:";
}

function sameCookieKey(left: StoredCookie, right: StoredCookie): boolean {
  return (
    left.name === right.name &&
    left.domain === right.domain &&
    left.hostOnly === right.hostOnly &&
    left.path === right.path
  );
}

function compareAccess(left: StoredCookie, right: StoredCookie): number {
  if (left.lastAccessTime !== right.lastAccessTime)
    return left.lastAccessTime - right.lastAccessTime;
  return left.creationIndex - right.creationIndex;
}

function compareForHeader(left: StoredCookie, right: StoredCookie): number {
  if (left.path.length !== right.path.length) return right.path.length - left.path.length;
  if (left.creationTime !== right.creationTime) return left.creationTime - right.creationTime;
  return left.creationIndex - right.creationIndex;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCookieKey(left: StoredCookie, right: StoredCookie): number {
  const domain = compareText(left.domain, right.domain);
  if (domain !== 0) return domain;
  const path = compareText(left.path, right.path);
  if (path !== 0) return path;
  const name = compareText(left.name, right.name);
  if (name !== 0) return name;
  return Number(left.hostOnly) - Number(right.hostOnly);
}

interface EvictionCandidate {
  readonly cookie: StoredCookie;
  remove: boolean;
}

function compareDomainEviction(left: EvictionCandidate, right: EvictionCandidate): number {
  const domain = compareText(left.cookie.domain, right.cookie.domain);
  if (domain !== 0) return domain;
  if (left.cookie.secure !== right.cookie.secure) return left.cookie.secure ? 1 : -1;
  return compareAccess(left.cookie, right.cookie);
}

function compareGlobalEviction(left: EvictionCandidate, right: EvictionCandidate): number {
  return compareAccess(left.cookie, right.cookie);
}

function receiptAllowed(sameSite: StoredSameSite, context: Required<CookieAccessContext>): boolean {
  if (sameSite === "None" || context.sameSite === "same-site") return true;
  return context.type === "http" && context.topLevelNavigation;
}

function retrievalAllowed(
  sameSite: StoredSameSite,
  context: Required<CookieAccessContext>,
): boolean {
  if (sameSite === "None" || context.sameSite === "same-site") return true;
  return (
    context.type === "http" &&
    context.topLevelNavigation &&
    (sameSite === "Lax" || sameSite === "Default") &&
    isSafeMethod(context.method)
  );
}

function readContext(context: CookieAccessContext): Required<CookieAccessContext> {
  const result: Required<CookieAccessContext> = {
    type: context.type ?? "http",
    sameSite: context.sameSite ?? "same-site",
    topLevelNavigation: context.topLevelNavigation ?? false,
    method: context.method ?? "GET",
  };
  if (result.type !== "http" && result.type !== "non-http")
    throw new TypeError("Invalid cookie access type");
  if (result.sameSite !== "same-site" && result.sameSite !== "cross-site") {
    throw new TypeError("Invalid cookie same-site status");
  }
  return result;
}

function persistentCookies(cookies: readonly StoredCookie[]): StoredCookie[] {
  const result: StoredCookie[] = [];
  for (const cookie of cookies) {
    if (cookie.persistent) result.push(cloneCookie(cookie));
  }
  return result;
}

/**
 * RFC6265bis storage/retrieval with explicit site policy and pluggable persistence.
 * Operations serialize so concurrent Fetches cannot lose a replacement or eviction.
 */
export class CookieJar {
  private readonly urls: URLParser;
  private readonly now: () => number;
  private readonly store: CookieJarStore;
  private readonly publicSuffixes: PublicSuffixChecker | undefined;
  private readonly secureURL: (url: URLRecord) => boolean;
  private readonly maxCookiesPerDomain: number;
  private readonly maxCookies: number;
  private readonly maxAgeSeconds: number;
  private cookies: StoredCookie[] = [];
  private loaded = false;
  private closed = false;
  private locked = false;
  private readonly waiters: PromiseWithResolvers<void>[] = [];
  private nextCreationIndex = 0;

  constructor(options: CookieJarOptions = {}) {
    this.urls = options.urls ?? currentWebPlatformRuntime().urls;
    this.now =
      options.wallTimeMilliseconds ?? (() => currentWebPlatformRuntime().wallTimeMilliseconds());
    this.store = options.store ?? new MemoryCookieJarStore();
    this.publicSuffixes = options.publicSuffixes;
    this.secureURL = options.isSecure ?? isSecureURL;
    this.maxCookiesPerDomain = validateLimit(
      options.maxCookiesPerDomain ?? 50,
      "per-domain cookie limit",
    );
    this.maxCookies = validateLimit(options.maxCookies ?? 3000, "cookie limit");
    this.maxAgeSeconds = validateLimit(
      options.maxPersistentAgeSeconds ?? maximumPersistentAgeSeconds,
      "persistent cookie age",
    );
    if (this.maxAgeSeconds > maximumPersistentAgeSeconds) {
      throw new RangeError("Persistent cookie age cannot exceed 400 days");
    }
  }

  private async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    const waiter = Promise.withResolvers<void>();
    this.waiters.push(waiter);
    await waiter.promise;
  }

  private release(): void {
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.locked = false;
    else waiter.resolve();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const loaded = await this.store.loadAll();
    const cookies: StoredCookie[] = [];
    let nextIndex = 0;
    for (const candidate of loaded) {
      if (!validStoredCookieShape(candidate) || !candidate.persistent) {
        throw new TypeError("Cookie store returned an invalid persistent cookie");
      }
      const cookie = cloneCookie(candidate);
      if (
        cookie.name.length + cookie.value.length > 4096 ||
        (cookie.name.length === 0 && cookie.value.length === 0) ||
        hasForbiddenCookieControl(cookie.name) ||
        hasForbiddenCookieControl(cookie.value) ||
        hasForbiddenCookieControl(cookie.path) ||
        cookie.path.includes(";") ||
        hasNonOctet(cookie.name) ||
        hasNonOctet(cookie.value) ||
        hasNonOctet(cookie.path) ||
        this.canonicalDomain(cookie.domain) !== cookie.domain ||
        (cookie.sameSite === "None" && !cookie.secure) ||
        (cookie.name.toLowerCase().startsWith("__secure-") && !cookie.secure) ||
        (cookie.name.toLowerCase().startsWith("__host-") &&
          (!cookie.secure || !cookie.hostOnly || cookie.path !== "/")) ||
        (cookie.name.length === 0 &&
          (cookie.value.toLowerCase().startsWith("__secure-") ||
            cookie.value.toLowerCase().startsWith("__host-")))
      ) {
        throw new TypeError("Cookie store returned an invalid persistent cookie");
      }
      cookies.push(cookie);
      nextIndex = Math.max(nextIndex, cookie.creationIndex + 1);
    }
    const byKey = cookies.slice().sort(compareCookieKey);
    const byCreation = cookies
      .slice()
      .sort((left, right) => left.creationIndex - right.creationIndex);
    for (let index = 1; index < cookies.length; index++) {
      const leftKey = byKey[index - 1];
      const rightKey = byKey[index];
      const leftCreation = byCreation[index - 1];
      const rightCreation = byCreation[index];
      if (
        leftKey === undefined ||
        rightKey === undefined ||
        leftCreation === undefined ||
        rightCreation === undefined
      ) {
        throw new TypeError("Cookie store returned an invalid persistent cookie");
      }
      if (sameCookieKey(leftKey, rightKey)) {
        throw new TypeError("Cookie store returned duplicate cookie keys");
      }
      if (leftCreation.creationIndex === rightCreation.creationIndex) {
        throw new TypeError("Cookie store returned duplicate creation indexes");
      }
    }
    const now = this.now();
    if (!Number.isFinite(now)) throw new TypeError("Cookie clock returned a non-finite time");
    const maximumExpiry = now + this.maxAgeSeconds * 1000;
    let normalized = false;
    for (let index = 0; index < cookies.length; index++) {
      const cookie = cookies[index];
      if (cookie !== undefined && cookie.expiryTime !== null && cookie.expiryTime > maximumExpiry) {
        cookies[index] = { ...cookie, expiryTime: maximumExpiry };
        normalized = true;
      }
    }
    const priorLength = cookies.length;
    this.removeExpired(cookies, now);
    this.evict(cookies);
    if (normalized || cookies.length !== priorLength) {
      await this.store.saveAll(persistentCookies(cookies));
    }
    this.cookies = cookies;
    this.nextCreationIndex = nextIndex;
    this.loaded = true;
  }

  private parseURL(input: string | URLRecord): URLRecord {
    const url = typeof input === "string" ? this.urls.parse(input) : input;
    if (url.hostname.length === 0) throw new TypeError("Cookie URL must have a host");
    return url;
  }

  private canonicalDomain(input: string): string | null {
    if (input.length === 0) return "";
    for (let index = 0; index < input.length; index++) {
      if (input.charCodeAt(index) > 127) return null;
    }
    try {
      const parsed = this.urls.parse("http://" + input + "/");
      if (
        parsed.protocol !== "http:" ||
        parsed.username !== "" ||
        parsed.password !== "" ||
        parsed.port !== "" ||
        parsed.pathname !== "/" ||
        parsed.search !== "" ||
        parsed.hash !== "" ||
        parsed.hostname.length === 0
      ) {
        return null;
      }
      return parsed.hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  private removeExpired(cookies: StoredCookie[], now: number): boolean {
    let write = 0;
    for (const cookie of cookies) {
      if (cookie.expiryTime === null || cookie.expiryTime > now) cookies[write++] = cookie;
    }
    if (write === cookies.length) return false;
    cookies.length = write;
    return true;
  }

  private evict(cookies: StoredCookie[]): void {
    const candidates: EvictionCandidate[] = cookies.map((cookie) => ({ cookie, remove: false }));
    const byDomain = candidates.slice().sort(compareDomainEviction);
    let removed = 0;
    let start = 0;
    while (start < byDomain.length) {
      const first = byDomain[start];
      if (first === undefined) break;
      let end = start + 1;
      while (end < byDomain.length && byDomain[end]?.cookie.domain === first.cookie.domain) end++;
      const excess = end - start - this.maxCookiesPerDomain;
      for (let offset = 0; offset < excess; offset++) {
        const candidate = byDomain[start + offset];
        if (candidate !== undefined) {
          candidate.remove = true;
          removed++;
        }
      }
      start = end;
    }
    const globalExcess = candidates.length - removed - this.maxCookies;
    if (globalExcess > 0) {
      const remaining = candidates.filter((candidate) => !candidate.remove);
      remaining.sort(compareGlobalEviction);
      for (let index = 0; index < globalExcess; index++) {
        const candidate = remaining[index];
        if (candidate !== undefined) candidate.remove = true;
      }
    }
    let write = 0;
    for (const candidate of candidates) {
      if (!candidate.remove) cookies[write++] = candidate.cookie;
    }
    cookies.length = write;
  }

  private async save(cookies: StoredCookie[]): Promise<void> {
    await this.store.saveAll(persistentCookies(cookies));
    this.cookies = cookies;
  }

  async setCookie(
    header: string,
    inputURL: string | URLRecord,
    access: CookieAccessContext = {},
  ): Promise<boolean> {
    await this.acquire();
    try {
      if (this.closed) throw new TypeError("CookieJar is closed");
      await this.ensureLoaded();
      const url = this.parseURL(inputURL);
      const now = this.now();
      if (!Number.isFinite(now)) throw new TypeError("Cookie clock returned a non-finite time");
      for (let index = 0; index < header.length; index++) {
        if (header.charCodeAt(index) > 255) return false;
      }
      const parsed = parseCookieForRequest(header, defaultPath(url.pathname));
      if (parsed === null) return false;
      const cookie = parsed.cookie;
      if (cookie.name.length === 0 && cookie.value.length === 0) return false;
      if (hasForbiddenCookieControl(cookie.name) || hasForbiddenCookieControl(cookie.value))
        return false;
      const requestHost = url.hostname.toLowerCase();
      let domainAttribute = this.canonicalDomain(cookie.domain ?? "");
      if (domainAttribute === null) return false;
      if (
        domainAttribute.length > 0 &&
        this.publicSuffixes?.isPublicSuffix(domainAttribute) === true
      ) {
        if (domainAttribute === requestHost) domainAttribute = "";
        else return false;
      }
      const hostOnly = domainAttribute.length === 0;
      const domain = hostOnly ? requestHost : domainAttribute;
      if (!hostOnly && !domainMatches(requestHost, domain)) return false;
      const path = cookie.path ?? defaultPath(url.pathname);
      const secure = cookie.secure === true;
      const httpOnly = cookie.httpOnly === true;
      const context = readContext(access);
      if (secure && !this.secureURL(url)) return false;
      if (httpOnly && context.type === "non-http") return false;
      const sameSite: StoredSameSite = cookie.sameSite ?? "Default";
      if (!receiptAllowed(sameSite, context)) return false;
      if (sameSite === "None" && !secure) return false;
      const lowerName = cookie.name.toLowerCase();
      if (lowerName.startsWith("__secure-") && !secure) return false;
      if (
        lowerName.startsWith("__host-") &&
        (!secure || !hostOnly || !parsed.pathAttributePresent || path !== "/")
      ) {
        return false;
      }
      const lowerValue = cookie.value.toLowerCase();
      if (
        cookie.name.length === 0 &&
        (lowerValue.startsWith("__secure-") || lowerValue.startsWith("__host-"))
      ) {
        return false;
      }

      const next = this.cookies.map(cloneCookie);
      this.removeExpired(next, now);
      if (!secure && !this.secureURL(url)) {
        for (const existing of next) {
          if (
            existing.secure &&
            existing.name === cookie.name &&
            (domainMatches(existing.domain, domain) || domainMatches(domain, existing.domain)) &&
            pathMatches(path, existing.path)
          ) {
            return false;
          }
        }
      }

      let expiryTime: number | null = null;
      let persistent = false;
      if (cookie.maxAge !== undefined) {
        persistent = true;
        expiryTime =
          cookie.maxAge <= 0 ? 0 : now + Math.min(cookie.maxAge, this.maxAgeSeconds) * 1000;
      } else if (cookie.expires !== undefined) {
        persistent = true;
        const raw = typeof cookie.expires === "number" ? cookie.expires : cookie.expires.getTime();
        expiryTime = Math.min(raw, now + this.maxAgeSeconds * 1000);
      }

      let creationTime = now;
      let creationIndex = this.nextCreationIndex;
      const prototype: StoredCookie = {
        name: cookie.name,
        value: cookie.value,
        expiryTime,
        domain,
        path,
        creationTime,
        lastAccessTime: now,
        creationIndex,
        persistent,
        hostOnly,
        secure,
        httpOnly,
        sameSite,
      };
      const existingIndex = next.findIndex((existing) => sameCookieKey(existing, prototype));
      if (existingIndex >= 0) {
        const existing = next[existingIndex];
        if (existing === undefined) throw new TypeError("Cookie replacement index is invalid");
        if (context.type === "non-http" && existing.httpOnly) return false;
        creationTime = existing.creationTime;
        creationIndex = existing.creationIndex;
        next.splice(existingIndex, 1);
      } else this.nextCreationIndex++;

      if (expiryTime !== null && expiryTime <= now) {
        await this.save(next);
        return true;
      }
      next.push({ ...prototype, creationTime, creationIndex });
      this.evict(next);
      await this.save(next);
      return true;
    } finally {
      this.release();
    }
  }

  async getCookieHeader(
    inputURL: string | URLRecord,
    access: CookieAccessContext = {},
  ): Promise<string> {
    await this.acquire();
    try {
      if (this.closed) throw new TypeError("CookieJar is closed");
      await this.ensureLoaded();
      const url = this.parseURL(inputURL);
      const now = this.now();
      if (!Number.isFinite(now)) throw new TypeError("Cookie clock returned a non-finite time");
      const next = this.cookies.map(cloneCookie);
      let changed = this.removeExpired(next, now);
      const context = readContext(access);
      const host = url.hostname.toLowerCase();
      const selected: StoredCookie[] = [];
      for (let index = 0; index < next.length; index++) {
        const cookie = next[index];
        if (cookie === undefined) continue;
        if (cookie.hostOnly ? cookie.domain !== host : !domainMatches(host, cookie.domain))
          continue;
        if (this.publicSuffixes?.isPublicSuffix(cookie.domain) === true && !cookie.hostOnly)
          continue;
        if (!pathMatches(url.pathname, cookie.path)) continue;
        if (cookie.secure && !this.secureURL(url)) continue;
        if (cookie.httpOnly && context.type === "non-http") continue;
        if (!retrievalAllowed(cookie.sameSite, context)) continue;
        const accessed = { ...cookie, lastAccessTime: now };
        next[index] = accessed;
        selected.push(accessed);
        changed = true;
      }
      selected.sort(compareForHeader);
      if (changed) await this.save(next);
      return selected
        .map((cookie) => (cookie.name.length === 0 ? "" : cookie.name + "=") + cookie.value)
        .join("; ");
    } finally {
      this.release();
    }
  }

  async snapshot(): Promise<readonly StoredCookie[]> {
    await this.acquire();
    try {
      if (this.closed) throw new TypeError("CookieJar is closed");
      await this.ensureLoaded();
      const now = this.now();
      if (!Number.isFinite(now)) throw new TypeError("Cookie clock returned a non-finite time");
      const next = this.cookies.map(cloneCookie);
      if (this.removeExpired(next, now)) await this.save(next);
      return next.map(cloneCookie);
    } finally {
      this.release();
    }
  }

  async clear(): Promise<void> {
    await this.acquire();
    try {
      if (this.closed) throw new TypeError("CookieJar is closed");
      await this.ensureLoaded();
      await this.save([]);
    } finally {
      this.release();
    }
  }

  async close(): Promise<void> {
    await this.acquire();
    try {
      if (this.closed) return;
      await this.ensureLoaded();
      const persistent = persistentCookies(this.cookies);
      await this.store.saveAll(persistent);
      this.cookies = [];
      this.closed = true;
      if (this.store.close !== undefined) await this.store.close();
    } finally {
      this.release();
    }
  }
}

function hasForbiddenCookieControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code >= 0 && code <= 8) || (code >= 10 && code <= 31) || code === 127) return true;
  }
  return false;
}
