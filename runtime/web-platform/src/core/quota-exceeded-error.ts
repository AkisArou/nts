import { DOMException } from "./errors.ts";
import { coerceToDOMString, requireDictionary } from "./webidl.ts";

/** Web IDL §2.8.3, https://webidl.spec.whatwg.org/#idl-QuotaExceededError. */
export interface QuotaExceededErrorOptions {
  quota?: number;
  requested?: number;
}

interface QuotaExceededErrorInput {
  quota?: unknown;
  requested?: unknown;
}

/** Missing dictionary members stay absent; present values undergo `double` conversion. */
function optionalDouble(value: unknown): number | null {
  if (value === undefined) return null;
  // Unary plus is ToNumber, which rejects BigInt and Symbol, unlike Number().
  const number = +(value as number);
  if (!Number.isFinite(number)) throw new TypeError("Quota values must be finite doubles");
  return number;
}

/**
 * Web IDL §§2.8.3, 3.2.7 and 3.2.17: a DOMException-derived interface with
 * converted, optional quota information. Serialization belongs to the native
 * structured-clone provider, as it does for DOMException.
 */
export class QuotaExceededError extends DOMException {
  readonly #quota: number | null;
  readonly #requested: number | null;

  constructor(message: unknown = "", options: unknown = undefined) {
    const text = coerceToDOMString(message);
    requireDictionary(options, "QuotaExceededErrorOptions");
    const dictionary = options as QuotaExceededErrorInput | null | undefined;
    // Web IDL converts every member, in identifier order, before running the
    // constructor steps. A requested conversion error precedes a negative quota.
    const quota = optionalDouble(dictionary?.quota);
    const requested = optionalDouble(dictionary?.requested);
    super(text, "QuotaExceededError");
    if (quota !== null && quota < 0) throw new RangeError("Quota must not be negative");
    if (requested !== null && requested < 0) throw new RangeError("Requested amount must not be negative");
    if (quota !== null && requested !== null && requested < quota) {
      throw new RangeError("Requested amount must not be below quota");
    }
    this.#quota = quota;
    this.#requested = requested;
  }

  get quota(): number | null { return this.#quota; }

  get requested(): number | null { return this.#requested; }

  get [Symbol.toStringTag](): string { return "QuotaExceededError"; }
}
