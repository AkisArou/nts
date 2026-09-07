import { isASCIIWhitespace } from "../core/ascii.ts";
import { forgivingBase64Decode } from "../core/base64.ts";
import { encodeByteString } from "../core/encoding.ts";

/**
 * Subresource integrity metadata.
 *
 * The grammar is whitespace-separated `<algorithm>-<base64 digest>` entries, each with
 * optional `?option` text that carries no defined meaning and is ignored rather than
 * rejected, so future options do not turn a valid request into a failure.
 */
export interface IntegrityEntry {
  readonly algorithm: string;
  readonly digest: string;
}

/** Strongest first: a stronger entry present in the metadata is the one that applies. */
const ALGORITHM_STRENGTH: readonly string[] = ["sha512", "sha384", "sha256"];

function isSupportedAlgorithm(name: string): boolean {
  return ALGORITHM_STRENGTH.includes(name);
}

/**
 * Parses integrity metadata into the entries that will actually be checked.
 *
 * Entries naming an algorithm this profile does not know are dropped, as the standard
 * requires: unknown algorithms must not make otherwise-valid metadata fail. Only the
 * strongest algorithm present is returned, and a match against any of its entries is a
 * match.
 */
/**
 * Whether a digest is a base64 value, in either the standard or URL alphabet.
 *
 * Checked at parse time because the grammar says so, and because the alternative was
 * worse than untidy: a digest containing any code unit above U+00FF reached
 * `encodeByteString` at match time and **threw** `TypeError: Expected an HTTP
 * ByteString`. A script can set `integrity` to any string, so
 * `new Request(url, { integrity: "sha256-\u0100" })` turned an integrity check into an
 * exception from a layer below the one the caller was talking to.
 *
 * Discarding it instead is what the Subresource Integrity grammar asks for, and it is
 * what this parser already did for an unsupported algorithm. **The consequence is worth
 * being explicit about:** metadata that parses to nothing means no integrity check at
 * all, not a check that always fails. That is the standard's behaviour and browsers do
 * it too, and a caller who wants "invalid metadata must fail" has to validate before
 * setting it rather than rely on this to fail closed.
 */
function isBase64Value(digest: string): boolean {
  for (let index = 0; index < digest.length; index++) {
    const code = digest.charCodeAt(index);
    const alphanumeric =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39);
    // `+` and `/`, their URL-alphabet substitutes `-` and `_`, and `=` padding.
    if (
      !alphanumeric &&
      code !== 0x2b &&
      code !== 0x2f &&
      code !== 0x2d &&
      code !== 0x5f &&
      code !== 0x3d
    ) {
      return false;
    }
  }
  return true;
}

export function parseIntegrity(metadata: string): readonly IntegrityEntry[] {
  const entries: IntegrityEntry[] = [];
  // Tokenized with the shared ASCII-whitespace predicate rather than a pattern: it is
  // the same set the grammar names, and it is what the rest of this runtime uses.
  let cursor = 0;
  while (cursor < metadata.length) {
    while (cursor < metadata.length && isASCIIWhitespace(metadata.charCodeAt(cursor))) cursor++;
    const start = cursor;
    while (cursor < metadata.length && !isASCIIWhitespace(metadata.charCodeAt(cursor))) cursor++;
    if (start === cursor) break;
    const token = metadata.slice(start, cursor);
    const separator = token.indexOf("-");
    if (separator <= 0) continue;
    const algorithm = token.slice(0, separator).toLowerCase();
    if (!isSupportedAlgorithm(algorithm)) continue;
    let digest = token.slice(separator + 1);
    const option = digest.indexOf("?");
    if (option >= 0) digest = digest.slice(0, option);
    if (digest === "" || !isBase64Value(digest)) continue;
    entries.push({ algorithm, digest });
  }
  if (entries.length === 0) return entries;
  for (const algorithm of ALGORITHM_STRENGTH) {
    const strongest = entries.filter((entry) => entry.algorithm === algorithm);
    if (strongest.length !== 0) return strongest;
  }
  return [];
}

/**
 * Whether metadata names at least one algorithm this profile understands.
 *
 * Metadata consisting entirely of unknown algorithms places no requirement on the
 * response, which is the standard's behaviour and is not the same as no metadata.
 */
export function integrityApplies(metadata: string): boolean {
  return parseIntegrity(metadata).length !== 0;
}

/**
 * Compares a computed digest against the entries.
 *
 * The expected values are decoded and the *bytes* are compared, so padding and the
 * choice of base64 alphabet cannot make two spellings of the same digest disagree.
 * `-_` is mapped to `+/` first, because both appear in the wild and mean the same
 * digest. An entry that does not decode never matches.
 *
 * The comparison does not exit early on the first differing byte. Integrity is a
 * security check, and a loop that stops at the first mismatch reports how much of a
 * digest was correct through the time it takes.
 */
export function digestMatches(digest: Uint8Array, entries: readonly IntegrityEntry[]): boolean {
  let matched = false;
  for (const entry of entries) {
    const expected = forgivingBase64Decode(base64AlphabetBytes(entry.digest));
    if (expected === null || expected.length !== digest.length) continue;
    let difference = 0;
    for (let index = 0; index < expected.length; index++) {
      difference |= (expected[index] ?? 0) ^ (digest[index] ?? 0);
    }
    if (difference === 0) matched = true;
  }
  return matched;
}

/**
 * The digest text as base64 bytes, with the URL alphabet folded onto the standard one.
 *
 * Both `+/` and `-_` appear in real integrity metadata and mean the same digest, so
 * the two are folded in a single pass rather than through chained replacements that
 * each allocate another string.
 */
function base64AlphabetBytes(digest: string): Uint8Array<ArrayBuffer> {
  const bytes = encodeByteString(digest);
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] === 0x2d) bytes[index] = 0x2b;
    else if (bytes[index] === 0x5f) bytes[index] = 0x2f;
  }
  return bytes;
}

/** The algorithm every returned entry shares. */
export function integrityAlgorithm(entries: readonly IntegrityEntry[]): string {
  const first = entries[0];
  if (first === undefined) throw new TypeError("No applicable integrity entry");
  return first.algorithm;
}

/**
 * Provider-owned digest primitive used only for integrity checks.
 *
 * Cryptographic primitives belong to the platform, so this is a capability rather than
 * a shared implementation. `algorithms` names exactly what the provider will compute;
 * anything absent from it cannot be verified, and an unverifiable requirement fails the
 * request rather than being ignored.
 */
export interface DigestProvider {
  readonly algorithms: readonly string[];

  digest(algorithm: string, bytes: Uint8Array): Promise<Uint8Array>;
}
