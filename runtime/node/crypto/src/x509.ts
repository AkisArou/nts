// `X509Certificate`, from node v24.20.0 `lib/internal/crypto/x509.js` over
// `src/crypto/crypto_x509.cc` (here `x509.c`).
//
// Every property is read once and kept, as node keeps it: a second read of
// `raw` or `publicKey` is the same object. A certificate parsed here has no
// issuer chain -- node's comes only from a TLS peer -- so `issuerCertificate`
// is always `undefined`.

import { Buffer } from "../../buffer/src/main.ts";
import {
  ERR_CRYPTO_OPERATION_FAILED,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_ARG_VALUE_BINDING,
} from "../../internal/errors.ts";
import { validateBoolean, validateObject, validateString } from "../../internal/validators.ts";
import { customInspectSymbol, inspect, type InspectOptions } from "../../util/src/inspect.ts";
import { isArrayBufferView } from "../../util/src/types.ts";
import { asymmetricHandle, handleOf, isKeyObject, type KeyObject, PublicKeyObject, typeOf } from "./keys.ts";
import { asBuffer, bytesOf, markedCryptoError } from "./util.ts";

/** OpenSSL's `X509_CHECK_FLAG_*`, which node's binding exports. */
const X509_CHECK_FLAG_ALWAYS_CHECK_SUBJECT = 0x1;
const X509_CHECK_FLAG_NO_WILDCARDS = 0x2;
const X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS = 0x4;
const X509_CHECK_FLAG_MULTI_LABEL_WILDCARDS = 0x8;
const X509_CHECK_FLAG_SINGLE_LABEL_SUBDOMAINS = 0x10;
const X509_CHECK_FLAG_NEVER_CHECK_SUBJECT = 0x20;

/** `x509.c`'s digests for a fingerprint. */
const FingerprintDigest = { Sha1: 0, Sha256: 1, Sha512: 2 } as const;

/** `x509.c`'s subjects to check, and ncrypto's `CheckMatch`. */
const SubjectKind = { Host: 0, Email: 1, Ip: 2 } as const;
const CheckMatch = { Match: 1, NoMatch: 0, InvalidName: -2, OperationFailed: -1 } as const;

/** Which of ncrypto's `ifRsa` and `ifEc` a certificate's key takes. */
const LegacyKeyFamily = { Other: 0, Rsa: 1, Ec: 2 } as const;

function orDefault(value: unknown, fallback: unknown): unknown {
  return value === undefined ? fallback : value;
}

/** Node's `getFlags`: the check options as OpenSSL's flags. */
function getFlags(options: unknown = {}): number {
  validateObject(options, "options");
  // Destructuring defaults: only `undefined` takes one, and `null` is refused.
  const copy: Record<string, unknown> = { ...(options as Record<string, unknown>) };
  const subject = orDefault(copy.subject, "default");
  const wildcards = orDefault(copy.wildcards, true);
  const partialWildcards = orDefault(copy.partialWildcards, true);
  const multiLabelWildcards = orDefault(copy.multiLabelWildcards, false);
  const singleLabelSubdomains = orDefault(copy.singleLabelSubdomains, false);
  validateString(subject, "options.subject");
  validateBoolean(wildcards, "options.wildcards");
  validateBoolean(partialWildcards, "options.partialWildcards");
  validateBoolean(multiLabelWildcards, "options.multiLabelWildcards");
  validateBoolean(singleLabelSubdomains, "options.singleLabelSubdomains");
  let flags = 0;
  if (subject === "always") flags |= X509_CHECK_FLAG_ALWAYS_CHECK_SUBJECT;
  else if (subject === "never") flags |= X509_CHECK_FLAG_NEVER_CHECK_SUBJECT;
  else if (subject !== "default") throw new ERR_INVALID_ARG_VALUE("options.subject", subject);
  if (!wildcards) flags |= X509_CHECK_FLAG_NO_WILDCARDS;
  if (!partialWildcards) flags |= X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS;
  if (multiLabelWildcards) flags |= X509_CHECK_FLAG_MULTI_LABEL_WILDCARDS;
  if (singleLabelSubdomains) flags |= X509_CHECK_FLAG_SINGLE_LABEL_SUBDOMAINS;
  return flags;
}

/** A name's entries as node's `GetX509NameObject` makes them: a key seen twice holds an array. */
export type X509NameObject = Record<string, string | string[]>;

function nameObject(entries: string[]): X509NameObject {
  const result = Object.create(null) as X509NameObject;
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const key = entries[i]!;
    const value = entries[i + 1]!;
    const existing = result[key];
    if (existing === undefined) result[key] = value;
    else if (typeof existing === "string") result[key] = [existing, value];
    else existing.push(value);
  }
  return result;
}

/**
 * The information access text as node's `translatePeerCertificate` reads it
 * (`lib/internal/tls/common.js`): each "key:value" line, a value in quotes
 * being the JSON string ncrypto's printer escaped it into. A line with no
 * colon is skipped, as the pattern node matches with skips it.
 */
export function infoAccessObject(text: string): Record<string, string[]> {
  const result = Object.create(null) as Record<string, string[]>;
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.charCodeAt(0) === 0x22) value = JSON.parse(value) as string;
    const values = result[key];
    if (values === undefined) result[key] = [value];
    else values.push(value);
  }
  return result;
}

/** What `toLegacyObject` answers: node's `X509ToObject`, after `translatePeerCertificate`. */
export interface LegacyCertificate {
  subject: X509NameObject;
  issuer: X509NameObject;
  subjectaltname: string | undefined;
  infoAccess: Record<string, string[]> | undefined;
  ca: boolean;
  modulus: string | undefined;
  exponent: string | undefined;
  pubkey: Buffer | undefined;
  bits: number | undefined;
  valid_from: string | undefined;
  valid_to: string | undefined;
  fingerprint: string | undefined;
  fingerprint256: string | undefined;
  fingerprint512: string | undefined;
  ext_key_usage: string[] | undefined;
  serialNumber: string | undefined;
  raw: Buffer | undefined;
  asn1Curve: string | undefined;
  nistCurve: string | undefined;
}

function bufferOrUndefined(bytes: Uint8Array | null): Buffer | undefined {
  return bytes === null ? undefined : asBuffer(bytes);
}

/**
 * The brand, for node's `isX509Certificate`: the private field only the
 * constructor puts there. A field of an object rather than a module-scope
 * function for the reason `KeyObjectSlots` gives in `keys.ts`.
 */
class X509Slots {
  brand: ((value: object) => boolean) | null = null;
}

const slots = new X509Slots();

/** Node's `isX509Certificate`. */
export function isX509Certificate(value: unknown): value is X509Certificate {
  return typeof value === "object" && value !== null && slots.brand!(value);
}

export class X509Certificate {
  static {
    slots.brand = (value: object): boolean => #handle in value;
  }

  readonly #handle: number;
  #subject: string | undefined = undefined;
  #subjectAltName: string | undefined = undefined;
  #issuer: string | undefined = undefined;
  #infoAccess: string | undefined = undefined;
  #validFrom: string | undefined = undefined;
  #validTo: string | undefined = undefined;
  #validFromDate: Date | undefined = undefined;
  #validToDate: Date | undefined = undefined;
  #fingerprint: string | undefined = undefined;
  #fingerprint256: string | undefined = undefined;
  #fingerprint512: string | undefined = undefined;
  #keyUsage: string[] | undefined = undefined;
  #serialNumber: string | undefined = undefined;
  #signatureAlgorithm: string | undefined = undefined;
  #signatureAlgorithmOid: string | undefined = undefined;
  #raw: Buffer | undefined = undefined;
  #publicKey: KeyObject | undefined = undefined;
  #pem: string | undefined = undefined;
  #ca: boolean | undefined = undefined;

  constructor(buffer: unknown) {
    const input = typeof buffer === "string" ? Buffer.from(buffer) : buffer;
    if (!isArrayBufferView(input)) {
      throw new ERR_INVALID_ARG_TYPE("buffer", ["string", "Buffer", "TypedArray", "DataView"], buffer);
    }
    const handle = nts_crypto_x509_parse(bytesOf(input));
    if (handle === 0) throw markedCryptoError("error:00000000:lib(0)::reason(0)");
    this.#handle = handle;
  }

  [customInspectSymbol](depth: number, options: InspectOptions): unknown {
    if (depth < 0) return this;
    const nested: InspectOptions = {
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };
    const summary = {
      subject: this.subject,
      subjectAltName: this.subjectAltName,
      issuer: this.issuer,
      infoAccess: this.infoAccess,
      validFrom: this.validFrom,
      validTo: this.validTo,
      validFromDate: this.validFromDate,
      validToDate: this.validToDate,
      fingerprint: this.fingerprint,
      fingerprint256: this.fingerprint256,
      fingerprint512: this.fingerprint512,
      keyUsage: this.keyUsage,
      serialNumber: this.serialNumber,
      signatureAlgorithm: this.signatureAlgorithm,
      signatureAlgorithmOid: this.signatureAlgorithmOid,
    };
    return `X509Certificate ${inspect(summary, nested)}`;
  }

  get subject(): string | undefined {
    return (this.#subject ??= nts_crypto_x509_name(this.#handle, false) ?? undefined);
  }

  get subjectAltName(): string | undefined {
    return (this.#subjectAltName ??= nts_crypto_x509_subject_alt_name(this.#handle) ?? undefined);
  }

  get issuer(): string | undefined {
    return (this.#issuer ??= nts_crypto_x509_name(this.#handle, true) ?? undefined);
  }

  /** The issuer from a TLS peer's chain, which a parsed certificate has not. */
  get issuerCertificate(): X509Certificate | undefined {
    return undefined;
  }

  get infoAccess(): string | undefined {
    return (this.#infoAccess ??= nts_crypto_x509_info_access(this.#handle) ?? undefined);
  }

  get validFrom(): string | undefined {
    return (this.#validFrom ??= nts_crypto_x509_valid_text(this.#handle, false) ?? undefined);
  }

  get validTo(): string | undefined {
    return (this.#validTo ??= nts_crypto_x509_valid_text(this.#handle, true) ?? undefined);
  }

  get validFromDate(): Date {
    return (this.#validFromDate ??= new Date(nts_crypto_x509_valid_time(this.#handle, false) * 1000));
  }

  get validToDate(): Date {
    return (this.#validToDate ??= new Date(nts_crypto_x509_valid_time(this.#handle, true) * 1000));
  }

  get fingerprint(): string | undefined {
    return (this.#fingerprint ??= nts_crypto_x509_fingerprint(this.#handle, FingerprintDigest.Sha1) ?? undefined);
  }

  get fingerprint256(): string | undefined {
    return (this.#fingerprint256 ??=
      nts_crypto_x509_fingerprint(this.#handle, FingerprintDigest.Sha256) ?? undefined);
  }

  get fingerprint512(): string | undefined {
    return (this.#fingerprint512 ??=
      nts_crypto_x509_fingerprint(this.#handle, FingerprintDigest.Sha512) ?? undefined);
  }

  get keyUsage(): string[] | undefined {
    return (this.#keyUsage ??= nts_crypto_x509_key_usage(this.#handle) ?? undefined);
  }

  get serialNumber(): string | undefined {
    return (this.#serialNumber ??= nts_crypto_x509_serial_number(this.#handle) ?? undefined);
  }

  get signatureAlgorithm(): string | undefined {
    return (this.#signatureAlgorithm ??= nts_crypto_x509_signature_algorithm(this.#handle) ?? undefined);
  }

  get signatureAlgorithmOid(): string | undefined {
    return (this.#signatureAlgorithmOid ??= nts_crypto_x509_signature_algorithm_oid(this.#handle) ?? undefined);
  }

  get raw(): Buffer | undefined {
    return (this.#raw ??= bufferOrUndefined(nts_crypto_x509_raw(this.#handle)));
  }

  /** The subject's key; a key OpenSSL cannot decode is its error, thrown at each read. */
  get publicKey(): KeyObject {
    if (this.#publicKey === undefined) {
      const key = nts_crypto_x509_public_key(this.#handle);
      if (key === 0) throw markedCryptoError("error:00000000:lib(0)::reason(0)");
      this.#publicKey = new PublicKeyObject(asymmetricHandle(key));
    }
    return this.#publicKey;
  }

  toString(): string | undefined {
    return (this.#pem ??= nts_crypto_x509_pem(this.#handle) ?? undefined);
  }

  /** There is no standard JSON for a certificate, so node answers its PEM. */
  toJSON(): string | undefined {
    return this.toString();
  }

  get ca(): boolean {
    return (this.#ca ??= nts_crypto_x509_check_ca(this.#handle));
  }

  checkHost(name: unknown, options?: unknown): string | undefined {
    validateString(name, "name");
    return this.#checkSubject(SubjectKind.Host, name, getFlags(options));
  }

  checkEmail(email: unknown, options?: unknown): string | undefined {
    validateString(email, "email");
    return this.#checkSubject(SubjectKind.Email, email, getFlags(options));
  }

  /** `options` changes nothing for an address; node validates it anyway, for flags OpenSSL may add. */
  checkIP(ip: unknown, options?: unknown): string | undefined {
    validateString(ip, "ip");
    return this.#checkSubject(SubjectKind.Ip, ip, getFlags(options));
  }

  /** Node's `CheckX509Subject`: the name, or for a host the subject name it matched; `undefined` for none. */
  #checkSubject(kind: number, name: string, flags: number): string | undefined {
    const status = nts_crypto_x509_check(this.#handle, kind, name, flags);
    if (status === CheckMatch.NoMatch) return undefined;
    if (status === CheckMatch.InvalidName) throw new ERR_INVALID_ARG_VALUE_BINDING("Invalid name");
    if (status !== CheckMatch.Match) throw new ERR_CRYPTO_OPERATION_FAILED();
    if (kind !== SubjectKind.Host) return name;
    return nts_crypto_x509_matched_host(this.#handle, name, flags) ?? name;
  }

  checkIssued(otherCert: unknown): boolean {
    if (!isX509Certificate(otherCert)) {
      throw new ERR_INVALID_ARG_TYPE("otherCert", "X509Certificate", otherCert);
    }
    return nts_crypto_x509_check_issued(this.#handle, otherCert.#handle);
  }

  checkPrivateKey(pkey: unknown): boolean {
    if (!isKeyObject(pkey)) throw new ERR_INVALID_ARG_TYPE("pkey", "KeyObject", pkey);
    if (typeOf(pkey) !== "private") throw new ERR_INVALID_ARG_VALUE("pkey", pkey);
    return nts_crypto_x509_check_private_key(this.#handle, handleOf(pkey).native);
  }

  verify(pkey: unknown): boolean {
    if (!isKeyObject(pkey)) throw new ERR_INVALID_ARG_TYPE("pkey", "KeyObject", pkey);
    if (typeOf(pkey) !== "public") throw new ERR_INVALID_ARG_VALUE("pkey", pkey);
    return nts_crypto_x509_verify(this.#handle, handleOf(pkey).native);
  }

  /** Node's `X509ToObject` and `translatePeerCertificate`: every field, fresh, `undefined` where there is none. */
  toLegacyObject(): LegacyCertificate {
    const handle = this.#handle;
    const family = nts_crypto_x509_legacy_family(handle);
    const rsa = family === LegacyKeyFamily.Rsa;
    const bits = nts_crypto_x509_legacy_bits(handle);
    const infoAccess = nts_crypto_x509_info_access(handle);
    return {
      subject: nameObject(nts_crypto_x509_name_entries(handle, false)),
      issuer: nameObject(nts_crypto_x509_name_entries(handle, true)),
      subjectaltname: nts_crypto_x509_subject_alt_name(handle) ?? undefined,
      infoAccess: infoAccess === null ? undefined : infoAccessObject(infoAccess),
      ca: nts_crypto_x509_check_ca(handle),
      modulus: rsa ? (nts_crypto_x509_rsa_number(handle, false) ?? undefined) : undefined,
      exponent: rsa ? (nts_crypto_x509_rsa_number(handle, true) ?? undefined) : undefined,
      pubkey: bufferOrUndefined(nts_crypto_x509_legacy_public_key(handle)),
      bits: bits < 0 ? undefined : bits,
      valid_from: nts_crypto_x509_valid_text(handle, false) ?? undefined,
      valid_to: nts_crypto_x509_valid_text(handle, true) ?? undefined,
      fingerprint: nts_crypto_x509_fingerprint(handle, FingerprintDigest.Sha1) ?? undefined,
      fingerprint256: nts_crypto_x509_fingerprint(handle, FingerprintDigest.Sha256) ?? undefined,
      fingerprint512: nts_crypto_x509_fingerprint(handle, FingerprintDigest.Sha512) ?? undefined,
      ext_key_usage: nts_crypto_x509_key_usage(handle) ?? undefined,
      serialNumber: nts_crypto_x509_serial_number(handle) ?? undefined,
      raw: bufferOrUndefined(nts_crypto_x509_raw(handle)),
      asn1Curve: nts_crypto_x509_legacy_curve(handle, false) ?? undefined,
      nistCurve: nts_crypto_x509_legacy_curve(handle, true) ?? undefined,
    };
  }
}
