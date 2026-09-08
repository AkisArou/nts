// A cookie jar that survives the process.
//
// `CookieJarStore` is `loadAll`/`saveAll` over a whole snapshot, and its contract says a
// durable implementation "atomically replaces the previous snapshot or rejects". That maps
// exactly onto one key in a `DurableByteStore`, whose own contract already promises that a
// key holds the old value or the new one after a crash mid-write -- never a mix and never
// absent. So the atomicity is inherited rather than reimplemented, which is the reason this
// module is small.
//
// The part that needed a decision is what to do with bytes that come back wrong.
import type { AbortSignal } from "../core/abort.ts";
import { decodeUTF8, TextEncoder } from "../core/encoding.ts";
import { jsonStringify } from "../json/json.ts";
import { parseJsonText } from "../json/parse.ts";
import { JsonValue } from "../json/value.ts";
import type { DurableByteStore } from "../storage/durable.ts";

import type { CookieJarStore, StoredCookie } from "./jar.ts";
import { validStoredCookieShape } from "./jar.ts";
import type { StoredSameSite } from "./jar.ts";

/**
 * What to do about a stored cookie that does not survive validation.
 *
 * `reject` is the default and it is the safer one. A jar that silently starts empty because
 * one byte was corrupt loses a user's session with no evidence anywhere, and the caller
 * cannot distinguish it from a first run. Dropping is available because a version skew that
 * makes old records unreadable is a real situation and permanently bricking the jar is a bad
 * answer to it -- but it has to be asked for, and it reports what it dropped.
 */
export type InvalidCookiePolicy = "reject" | "drop";

export interface DurableCookieJarStoreOptions {
  /** Defaults to `"cookies"`. */
  readonly namespace?: string;
  /** Defaults to `"jar"`. One key holds the whole snapshot, because `saveAll` replaces it. */
  readonly key?: string;
  /** Defaults to `"reject"`. */
  readonly onInvalid?: InvalidCookiePolicy;
  /**
   * Called when `onInvalid` is `"drop"` and something was dropped.
   *
   * Dropping without a way to observe it is the failure this whole option exists to avoid,
   * so the report is part of the feature rather than a debugging aid.
   */
  readonly reportDropped?: (count: number, total: number) => void;
}

/** Raised when a stored snapshot cannot be read back as cookies. */
export class CookieJarStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieJarStoreError";
  }
}

const snapshotEncoder = new TextEncoder();

/**
 * One cookie as a JSON object node.
 *
 * Written out field by field rather than reflected over. That is not a limitation being
 * worked around -- it is what the plan calls direct typed materialization, done by hand for
 * one type: no generic object graph is built and walked, the field names are checked at
 * compile time, and a field added to `StoredCookie` without a line here fails to type-check
 * on the way back in rather than vanishing silently.
 */
function cookieToJson(cookie: StoredCookie): JsonValue {
  const keys = [
    "name",
    "value",
    "expiryTime",
    "domain",
    "path",
    "creationTime",
    "lastAccessTime",
    "creationIndex",
    "persistent",
    "hostOnly",
    "secure",
    "httpOnly",
    "sameSite",
  ];
  const values = [
    JsonValue.stringValue(cookie.name, 0, 0),
    JsonValue.stringValue(cookie.value, 0, 0),
    cookie.expiryTime === null
      ? JsonValue.nullValue(0, 0)
      : JsonValue.numberValue(cookie.expiryTime, 0, 0),
    JsonValue.stringValue(cookie.domain, 0, 0),
    JsonValue.stringValue(cookie.path, 0, 0),
    JsonValue.numberValue(cookie.creationTime, 0, 0),
    JsonValue.numberValue(cookie.lastAccessTime, 0, 0),
    JsonValue.numberValue(cookie.creationIndex, 0, 0),
    JsonValue.booleanValue(cookie.persistent, 0, 0),
    JsonValue.booleanValue(cookie.hostOnly, 0, 0),
    JsonValue.booleanValue(cookie.secure, 0, 0),
    JsonValue.booleanValue(cookie.httpOnly, 0, 0),
    JsonValue.stringValue(cookie.sameSite, 0, 0),
  ];
  return JsonValue.objectValue(keys, values, 0, 0);
}

/** The value a JSON object node holds under `key`, or `undefined` if it has no such key. */
function memberOf(node: JsonValue, key: string): JsonValue | undefined {
  const at = node.keys.indexOf(key);
  return at < 0 ? undefined : node.values[at];
}

function stringMember(node: JsonValue, key: string): string | null {
  const member = memberOf(node, key);
  return member !== undefined && member.kind === "string" ? member.text : null;
}

function numberMember(node: JsonValue, key: string): number | null {
  const member = memberOf(node, key);
  return member !== undefined && member.kind === "number" ? member.number : null;
}

function booleanMember(node: JsonValue, key: string): boolean | null {
  const member = memberOf(node, key);
  return member !== undefined && member.kind === "boolean" ? member.boolean : null;
}

/**
 * Narrowed rather than asserted.
 *
 * A cast from `string` would type-check and admit any text the file happened to contain, which
 * is exactly the corruption this whole path exists to catch; four comparisons give the compiler
 * the same knowledge honestly.
 */
function sameSiteOf(text: string): StoredSameSite | null {
  if (text === "Default") return "Default";
  if (text === "Strict") return "Strict";
  if (text === "Lax") return "Lax";
  if (text === "None") return "None";
  return null;
}

/**
 * One stored cookie read back out of the graph, or `null` if a field is missing or is the
 * wrong kind.
 *
 * These kind checks are the `typeof` half of {@link validStoredCookieShape}, moved to where
 * the kinds actually are; the semantic half -- that a path begins with a solidus, that
 * `persistent` agrees with `expiryTime`, that an index is in range -- still runs afterwards on
 * the assembled record, so nothing that was checked before is checked less now.
 */
function cookieFromJson(node: JsonValue): StoredCookie | null {
  if (node.kind !== "object") return null;

  const name = stringMember(node, "name");
  const value = stringMember(node, "value");
  const domain = stringMember(node, "domain");
  const path = stringMember(node, "path");
  const sameSiteText = stringMember(node, "sameSite");
  const creationTime = numberMember(node, "creationTime");
  const lastAccessTime = numberMember(node, "lastAccessTime");
  const creationIndex = numberMember(node, "creationIndex");
  const persistent = booleanMember(node, "persistent");
  const hostOnly = booleanMember(node, "hostOnly");
  const secure = booleanMember(node, "secure");
  const httpOnly = booleanMember(node, "httpOnly");

  if (
    name === null ||
    value === null ||
    domain === null ||
    path === null ||
    sameSiteText === null ||
    creationTime === null ||
    lastAccessTime === null ||
    creationIndex === null ||
    persistent === null ||
    hostOnly === null ||
    secure === null ||
    httpOnly === null
  ) {
    return null;
  }

  const sameSite = sameSiteOf(sameSiteText);
  if (sameSite === null) return null;

  // `null` is a legitimate value here and not an absence, so it is read directly rather than
  // through one of the typed accessors: a session cookie stores `"expiryTime":null`.
  const expiry = memberOf(node, "expiryTime");
  if (expiry === undefined) return null;
  let expiryTime: number | null;
  if (expiry.kind === "null") expiryTime = null;
  else if (expiry.kind === "number") expiryTime = expiry.number;
  else return null;

  return {
    name,
    value,
    expiryTime,
    domain,
    path,
    creationTime,
    lastAccessTime,
    creationIndex,
    persistent,
    hostOnly,
    secure,
    httpOnly,
    sameSite,
  };
}

function encodeSnapshot(cookies: readonly StoredCookie[]): Uint8Array {
  const items: JsonValue[] = [];
  for (const cookie of cookies) items.push(cookieToJson(cookie));
  const text = jsonStringify(JsonValue.arrayValue(items, 0, 0));
  if (text === undefined) throw new CookieJarStoreError("The cookie snapshot did not serialize");
  // UTF-8 rather than a byte-per-code-unit shortcut. A cookie value is an octet string, so
  // code units up to 0xFF reach this legitimately, and the serializer passes ordinary
  // non-ASCII through literally rather than escaping it.
  return snapshotEncoder.encode(text);
}

function decodeSnapshot(bytes: Uint8Array): string {
  // Fatal, because the replacement character is the wrong answer here. A corrupt byte
  // substituted with U+FFFD produces a cookie whose value is quietly not the one that was
  // stored, and it would be sent to a server that way.
  try {
    return decodeUTF8(bytes, true);
  } catch {
    throw new CookieJarStoreError("The stored cookie snapshot is not valid UTF-8");
  }
}

/**
 * `CookieJarStore` over a provider-owned durable byte store.
 *
 * The whole jar is one key. That is not a size compromise -- `saveAll` replaces the entire
 * snapshot, so per-cookie keys would need a second mechanism to make the replacement atomic,
 * and the store already provides exactly one.
 */
export class DurableCookieJarStore implements CookieJarStore {
  private readonly store: DurableByteStore;
  private readonly namespace: string;
  private readonly key: string;
  private readonly onInvalid: InvalidCookiePolicy;
  private readonly reportDropped: ((count: number, total: number) => void) | undefined;
  private readonly signal: AbortSignal;

  constructor(
    store: DurableByteStore,
    signal: AbortSignal,
    options: DurableCookieJarStoreOptions = {},
  ) {
    this.store = store;
    this.signal = signal;
    this.namespace = options.namespace ?? "cookies";
    this.key = options.key ?? "jar";
    this.onInvalid = options.onInvalid ?? "reject";
    this.reportDropped = options.reportDropped;
  }

  async loadAll(): Promise<readonly StoredCookie[]> {
    const bytes = await this.store.read(this.namespace, this.key, this.signal);
    // An absent key is a first run, which is not a failure.
    if (bytes === null) return [];
    // Decoded outside the JSON guard on purpose: inside it, a UTF-8 failure would be
    // caught and reported as malformed JSON, which sends a reader looking at the wrong
    // layer. The two failures have different causes and different repairs.
    const text = decodeSnapshot(bytes);
    let parsed: JsonValue;
    try {
      parsed = parseJsonText(text);
    } catch {
      throw new CookieJarStoreError("The stored cookie snapshot is not valid JSON");
    }
    if (parsed.kind !== "array") {
      throw new CookieJarStoreError("The stored cookie snapshot is not an array");
    }
    const cookies: StoredCookie[] = [];
    let dropped = 0;
    for (const entry of parsed.items) {
      const cookie = cookieFromJson(entry);
      if (cookie !== null && validStoredCookieShape(cookie)) {
        cookies.push(cookie);
        continue;
      }
      if (this.onInvalid === "reject") {
        throw new CookieJarStoreError("The stored cookie snapshot holds an unreadable cookie");
      }
      dropped++;
    }
    if (dropped > 0 && this.reportDropped !== undefined) {
      this.reportDropped(dropped, parsed.items.length);
    }
    return cookies;
  }

  async saveAll(cookies: readonly StoredCookie[]): Promise<void> {
    // Serialized before the write is opened, so a snapshot that cannot be encoded never
    // claims the key: the store refuses a second concurrent write rather than queueing it,
    // and a failure here would otherwise be paid for by the next caller.
    const bytes = encodeSnapshot(cookies);
    const write = await this.store.write(this.namespace, this.key, this.signal);
    try {
      await write.append(bytes);
      await write.commit();
    } catch (error) {
      // The store's crash contract covers a lost process, not a rejected append: without
      // this the key would keep an uncommitted write and refuse the next `saveAll`, since
      // a second concurrent write to a key is refused rather than queued.
      await write.discard();
      throw error;
    }
  }
}
