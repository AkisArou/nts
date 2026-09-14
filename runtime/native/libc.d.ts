// Hand-written, curated C ABI declarations. Not generated from system headers.
// Module members enter scope only through imports.

declare module "c:types" {
  // A pointer to a C struct tag, with no managed header or implicit lifetime.
  // Construct and destroy it through the library's functions. `| null` admits
  // a null pointer. The phantom field is never readable or constructible.
  export type Opaque<Name extends string> = { readonly __c_opaque: Name };
  // Struct is a layout description. The optional second argument names a
  // foreign C struct tag; application code normally uses the binding's alias.
  export type Struct<Fields, Tag extends string = ""> = {
    readonly __c_struct: Fields;
    readonly __c_tag: Tag;
  };
  // Addresses carry no extent or lifetime checks. Scalar slots project as TS
  // numbers; struct indexing returns an alias, and pointer slots stay pointers.
  type NativeValue<T> = T extends number ? number : T;
  export type Ptr<T> = { readonly __c_pointer: T } &
    (T extends Struct<infer Fields, string>
      ? { [K in keyof Fields]: NativeValue<Fields[K]> } & { [index: number]: Ptr<T> }
      : { [index: number]: NativeValue<T> });
  // Hand-written native ABI scalar declarations, maintained with hir/native.rs.
  // Import the required types from "c:types".
  // Brands select the C boundary type; arithmetic inside TypeScript is ordinary
  // number arithmetic. An assertion requests a conversion at a foreign call;
  // it does not validate the value's range. The __c_* properties are phantom
  // markers and cannot be read by compiled code.
  export type c_int = number & { readonly __c_int: unique symbol };
  export type c_uint = number & { readonly __c_uint: unique symbol };
  export type c_int8 = number & { readonly __c_int8: unique symbol };
  export type c_uint8 = number & { readonly __c_uint8: unique symbol };
  export type c_int16 = number & { readonly __c_int16: unique symbol };
  export type c_uint16 = number & { readonly __c_uint16: unique symbol };
  export type c_int32 = number & { readonly __c_int32: unique symbol };
  export type c_uint32 = number & { readonly __c_uint32: unique symbol };
  // LP64 native ABI (checked by the generated C). JavaScript number precision
  // still applies: integers outside the exact number range may round on return.
  export type c_int64 = number & { readonly __c_int64: unique symbol };
  export type c_uint64 = number & { readonly __c_uint64: unique symbol };
  export type c_long = number & { readonly __c_long: unique symbol };
  export type c_ulong = number & { readonly __c_ulong: unique symbol };
  export type c_size_t = number & { readonly __c_size_t: unique symbol };
  export type c_ptrdiff_t = number & { readonly __c_ptrdiff_t: unique symbol };
  export type c_float = number & { readonly __c_float: unique symbol };
  export type c_double = number & { readonly __c_double: unique symbol };
}

declare module "c:memory" {
  // Zero-initialized function-local storage; count is a positive compile-time
  // constant. Local addresses cannot escape, suspend, or be freed manually.
  /** @ntsAbi intrinsic */
  export function local<T>(count?: number): Ptr<T>;
  // Size in bytes, including native struct padding. Requires a complete type.
  /** @ntsAbi intrinsic */
  export function sizeof<T>(): number;

  import type { Ptr, Struct } from "c:types";
  // These operate on native storage, not JS temporaries. A field key preserves
  // its native type even though the field's value projects as a TS number.
  /** @ntsAbi intrinsic */
  export function addrOf<F, N extends string, K extends keyof F>(storage: Ptr<Struct<F, N>>, key: K): Ptr<F[K]>;
  /** @ntsAbi intrinsic */
  export function addrOf<T>(storage: Ptr<T>, index: number): Ptr<T>;
}

declare module "c:stdint" {
  // Hand-written fixed-width C integer aliases. JavaScript number precision applies.
  export type {
    c_int8 as int8_t, c_uint8 as uint8_t,
    c_int16 as int16_t, c_uint16 as uint16_t,
    c_int32 as int32_t, c_uint32 as uint32_t,
    c_int64 as int64_t, c_uint64 as uint64_t,
  } from "c:types";
}

declare module "c:stddef" {
  // Hand-written aliases for the supported LP64 C data model.
  export type { c_size_t as size_t, c_ptrdiff_t as ptrdiff_t } from "c:types";
}

declare module "c:stdbool" {
  // Hand-written: C bool has the same value domain as TypeScript boolean.
  export type bool = boolean;
}

declare module "c:stdlib" {
  // Hand-written, curated scalar bindings. Not generated from system headers.
  import type { c_int, c_long } from "c:types";

  // Bytes, not elements. Invalid/nonintegral counts, counts below sizeof<T>(),
  // counts above Number.MAX_SAFE_INTEGER, and allocator failure return null.
  // Successful storage is uninitialized and must be explicitly freed.
  /** @ntsAbi intrinsic */
  export function malloc<T>(byteCount: number): import("c:types").Ptr<T> | null;
  // free(null) does nothing. Only a live base address from malloc may be freed.
  /** @ntsAbi intrinsic */
  export function free<T>(pointer: import("c:types").Ptr<T> | null): void;

  export function abs(value: c_int): c_int;
  export function labs(value: c_long): c_long;
}

declare module "c:math" {
  // Hand-written, curated scalar bindings. Not generated from system headers.
  // Link libm where required.
  import type { c_double, c_float, c_int } from "c:types";

  export function fabs(value: c_double): c_double;
  export function fabsf(value: c_float): c_float;
  export function sqrt(value: c_double): c_double;
  export function sqrtf(value: c_float): c_float;
  export function pow(base: c_double, exponent: c_double): c_double;
  export function fmod(value: c_double, divisor: c_double): c_double;
  export function floor(value: c_double): c_double;
  export function ceil(value: c_double): c_double;
  export function trunc(value: c_double): c_double;
  export function copysign(magnitude: c_double, sign: c_double): c_double;
  export function ldexp(value: c_double, exponent: c_int): c_double;
}
