// `@nts/scalars`: nts's names for numbers of a fixed kind -- the widths
// JavaScript, C, Rust and Zig share, and C's own types.
//
// A scalar is a `number` (or a `bigint`) with an OPTIONAL label naming its
// kind. A plain number goes anywhere a scalar does, and a scalar anywhere a
// number does: the label makes no claim TypeScript checks. nts checks it, where
// a scalar type is written (`docs/scalar-numbers.md`):
//
//   - a value stored into a written kind -- a parameter, a field, a global, a
//     local, a return, an argument to C -- must be proven to be one of the
//     kind's values, or the build stops (NTS5001). Nothing is wrapped,
//     rounded or checked on the program's behalf;
//   - so a read of a written kind is one of its values, and a fact the
//     compiler uses: `n: Uint16` is a whole number in 0..65535;
//   - `x as Uint16` is TypeScript's assertion, with no run-time effect, and
//     accepted only where nts proves it.
//
// A kind is a set of values, not a machine word, though nts holds it in one
// where it can:
//
//   JavaScript   C          Rust  Zig   carried as
//   Int8         int8_t     i8    i8    number
//   Uint8        uint8_t    u8    u8    number
//   Int16        int16_t    i16   i16   number
//   Uint16       uint16_t   u16   u16   number
//   Int32        int32_t    i32   i32   number
//   Uint32       uint32_t   u32   u32   number
//   BigInt64     int64_t    i64   i64   bigint
//   BigUint64    uint64_t   u64   u64   bigint
//   Float32      float      f32   f32   number
//   Float64      double     f64   f64   number
//
// C's own types (`c_int`, `c_long`, `c_size_t` ...) are kinds of their own,
// spelled in C as C spells them, whose width is the target's. Typed arrays and
// `DataView` are JavaScript's and not slots: a store wraps, as in node.
//
// Each label is declared here, one by one, and nts knows a kind by its label
// coming from this module -- a property of the same name written anywhere else
// is a property like any other.

declare module "@nts/scalars" {
  // ---- The fixed widths -------------------------------------------------------
  export type Int8 = number & { readonly __Int8?: true };
  export type Uint8 = number & { readonly __Uint8?: true };
  export type Int16 = number & { readonly __Int16?: true };
  export type Uint16 = number & { readonly __Uint16?: true };
  export type Int32 = number & { readonly __Int32?: true };
  export type Uint32 = number & { readonly __Uint32?: true };
  /** Every bit of a 64-bit integer: a bigint, as no number holds them all. */
  export type BigInt64 = bigint & { readonly __BigInt64?: true };
  export type BigUint64 = bigint & { readonly __BigUint64?: true };
  /** A value C's `float` holds exactly. */
  export type Float32 = number & { readonly __Float32?: true };
  export type Float64 = number & { readonly __Float64?: true };

  // ---- C's own types ----------------------------------------------------------
  // Spelled in C as C spells them -- `int` and `int32_t` are two C types,
  // whatever their width -- and as wide as the target makes them. A build for
  // several targets takes a value into one only where it fits on every one.

  /** `char`: neither `signed char` nor `unsigned char`, though one of their widths. */
  export type c_char = number & { readonly __c_char?: true };
  export type c_int = number & { readonly __c_int?: true };
  export type c_uint = number & { readonly __c_uint?: true };
  /** `long`: 64 bits on LP64, 32 on Windows -- a bigint, for the targets where it is 64. */
  export type c_long = bigint & { readonly __c_long?: true };
  export type c_ulong = bigint & { readonly __c_ulong?: true };
  /** Windows' `LONG` and `ULONG`/`DWORD`: a `long` that is 32 bits everywhere it exists, as a number. */
  export type c_long32 = number & { readonly __c_long32?: true };
  export type c_ulong32 = number & { readonly __c_ulong32?: true };
  /** `size_t` and `ptrdiff_t`: as wide as a pointer, a bigint. */
  export type c_size_t = bigint & { readonly __c_size_t?: true };
  export type c_ptrdiff_t = bigint & { readonly __c_ptrdiff_t?: true };
  // `int8_t` ... `uint64_t`, `float` and `double` are the fixed widths above,
  // which C spells as those names: there is no second name for them here.

  // ---- At a binding -------------------------------------------------------------

  /**
   * A 64-bit (or pointer-wide) integer a binding hands the program as a number
   * -- a size, a count, an index (`AsNumber<c_size_t>`), as Swift and GJS do.
   * A value past 2^53 is a RangeError where C answers it, never rounded.
   */
  export type AsNumber<C extends bigint> = number & { readonly __AsNumber?: C };
}
