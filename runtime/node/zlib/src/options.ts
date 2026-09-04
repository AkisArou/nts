import {
  ERR_BROTLI_INVALID_PARAM,
  ERR_INVALID_ARG_TYPE,
  ERR_ZSTD_INVALID_PARAM,
} from "../../internal/errors.ts";

export type ParameterFamily = "brotli" | "zstd";

interface CompressionParameters {
  readonly [name: string]: unknown;
}

function validateCompressionParameters(
  value: unknown,
): asserts value is CompressionParameters {
  // Node intentionally accepts every non-null object here, including arrays.
  // Object.keys reads only the caller's own enumerable parameter slots.
  if (value === null || typeof value !== "object") {
    throw new ERR_INVALID_ARG_TYPE("options.params", "Object", value);
  }
}

function invalidParameter(family: ParameterFamily, name: string): never {
  if (family === "brotli") throw new ERR_BROTLI_INVALID_PARAM(name);
  throw new ERR_ZSTD_INVALID_PARAM(name);
}

/** Validate and flatten Node's numeric Brotli/Zstd parameter dictionary. */
export function parameterArrays(
  params: unknown,
  maximum: number,
  family: ParameterFamily,
): [number[], number[]] {
  if (params === undefined) return [[], []];
  validateCompressionParameters(params);

  const names = Object.keys(params);
  const keys = new Array<number>(names.length);
  const values = new Array<number>(names.length);
  for (let i = 0; i < names.length; i++) {
    const originalName = names[i] ?? "";
    const key = +originalName;
    if (
      !Number.isInteger(key) ||
      String(key) !== originalName ||
      key < 0 ||
      key > maximum
    ) {
      invalidParameter(family, originalName);
    }
    const value = params[originalName];
    if (typeof value !== "number" && typeof value !== "boolean") {
      throw new ERR_INVALID_ARG_TYPE("options.params[key]", "number", value);
    }
    keys[i] = key;
    values[i] = typeof value === "boolean" ? (value ? 1 : 0) : value;
  }
  return [keys, values];
}

/** A byte view over caller-owned binary storage, without copying it. */
export function byteView(value: unknown, name: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new ERR_INVALID_ARG_TYPE(
    name,
    ["Buffer", "TypedArray", "DataView", "ArrayBuffer"],
    value,
  );
}

/** Missing dictionaries are represented by one empty byte view at the ABI. */
export function optionalByteView(value: unknown, name: string): Uint8Array {
  return value === undefined ? new Uint8Array(0) : byteView(value, name);
}
