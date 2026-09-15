// Hand-written, curated C ABI declarations. Not generated from system headers.
// Module members enter scope only through imports.

/**
 * The brand vocabulary. **No `@ntsHeader`, and deliberately**: nothing here is
 * a declaration of anything C declares. `c_int` is how this compiler spells a
 * target's `int`, not a name <stdint.h> or any other header publishes, so
 * there is no header for a witness to compare it against -- the comparison
 * happens wherever a *binding* uses one of these to describe a real function.
 */
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
  // The same member list at one address. Everything a `Struct` does, a `Union`
  // does -- reached by the same `p.member`, described by the same fields --
  // and only the layout differs, which is how C has it: one grammar, one `->`,
  // and "structure or union type" throughout the standard.
  //
  // Reading one member after writing another is C's rule and not this
  // compiler's: the bytes are whatever the write left there. Nothing here
  // tracks which member is live, and nothing should pretend to.
  export type Union<Fields, Tag extends string = ""> = {
    readonly __c_union: Fields;
    readonly __c_tag: Tag;
  };
  // `__attribute__((packed))`: no padding between members, no tail padding,
  // and an alignment of one. It has to be declared because it cannot be seen --
  // a packed and an unpacked declaration of the same members are the same text
  // and different layouts, and `struct epoll_event` is 12 bytes where the
  // natural layout is 16.
  //
  // It composes rather than taking a third argument, so a binding writes
  // `Packed<Struct<{...}, "epoll_event">>` and everything that reads a struct
  // keeps reading one.
  export type Packed<T> = T & { readonly __c_packed: true };
  // A record the header declares **without a tag** needs no marker:
  //
  //     struct in6_addr { union { uint8_t a[16]; uint32_t b[4]; } __in6_u; };
  //     export type In6Addr = Struct<{ __in6_u: Union<{ ... }> }, "in6_addr">;
  //
  // It is *inferred*. A record with a C tag is one some header defines, so its
  // members are the header's too -- a member whose type carries no tag cannot
  // be a layout this program invented, because the header defines the struct
  // and therefore the type of every member in it. A marker would have restated
  // what the enclosing tag already says.
  //
  // What follows from it: C has no spelling for such a type, so nothing may be
  // declared to point at one and `_Generic` cannot ask about it. The compiler
  // reaches its members by byte offset from the enclosing record, which is what
  // a C programmer does when they cannot name a type either.
  //
  // `Untagged` and not `Anonymous`, had it needed a name: C11 6.7.2.1p13
  // reserves "anonymous structure or union" for a member with **no declarator**,
  // whose fields are reached as the enclosing record's. A different rule.
  // A slot reads as the plain value it holds and remembers what it is a slot
  // *of*. The phantom is optional, which is the whole trick: a plain `number`
  // satisfies it, so `p[i] = n`, `p[i] += 1` and `p.count += 2` stay ordinary
  // arithmetic -- while `addrOf` can still recover the declared C type, because
  // an address must know the width it loads through and a bare `number` names
  // none. Neither half works without the other: brand the slot and every write
  // becomes a conversion; strip it and every address loses its element type.
  // The value half is `number` for anything numeric, not the brand: that is
  // what keeps `p[i] = n` and `p.count += 2` ordinary arithmetic. A pointer
  // field keeps its own type, having no number to project to.
  type Slot<T> = T extends number
    ? number & { readonly __c_of?: T }
    : T & { readonly __c_of?: T };
  // `__c_writable` is what separates `Ptr` from `ConstPtr`, and it sits on the
  // mutable one so that const is the *smaller* type: a `Ptr<T>` then satisfies
  // a `ConstPtr<T>` and a `ConstPtr<T>` does not satisfy a `Ptr<T>`, which is
  // C's qualification conversion, in the one direction C performs it, out of
  // TypeScript's own assignability rather than a rule written here.
  // `T[N]` stored inline, which is what a C struct member like `char name[65]`
  // is. The length is part of the type because it is part of the layout: a
  // struct holding one has no size without it.
  //
  // Reading the member gives a `Ptr<T>` -- the array decays to a pointer to its
  // first element, exactly as in C -- so `p.name[0]` reads a byte and
  // `addrOf(p.name[0])` is its address. There is no value form: an array is
  // storage, and reading one *as a value* would be an aggregate copy.
  export type CArray<T, N extends number> = {
    readonly __c_array: T;
    readonly __c_length: N;
  };
  // `T name : N` -- a bit-field. N bits of a T-sized storage unit, packed with
  // the bit-fields beside it rather than given a byte of its own.
  //
  // It projects as a plain `number`, deliberately **without** the `__c_of`
  // phantom every other member carries. That phantom is the only thing
  // `addrOf` can read, so `addrOf(header.ihl)` is a type error here -- which is
  // what C says too: a bit-field has no address, and `&p->ihl` does not compile
  // there either. The surface cannot express what C forbids, rather than
  // expressing it and refusing it afterwards.
  //
  // The width is part of the type for the reason `CArray`'s length is: it is
  // part of the layout, and a struct holding one has no size without it.
  export type Bits<T extends number, N extends number> = {
    readonly __c_bits: T;
    readonly __c_width: N;
  };
  export type Ptr<T> = { readonly __c_pointer: T; readonly __c_writable: true } & (T extends
    | Struct<infer Fields, string>
    | Union<infer Fields, string>
    // A struct-typed member is stored inline and projects as a *pointer to it*,
    // never as a value: reading one as a value would be an aggregate copy, and
    // `p.inner.field` should reach the bytes that are there rather than a
    // duplicate of them. This is what `p[i]` already does for a block of
    // structs, for the same reason.
    ? { [K in keyof Fields]: Fields[K] extends
          | { readonly __c_struct: unknown }
          | { readonly __c_union: unknown }
          ? Ptr<Fields[K]>
          : Fields[K] extends CArray<infer E, number>
            ? Ptr<E>
            : Fields[K] extends Bits<number, number>
              ? number
              : Slot<Fields[K]> }
      & { [index: number]: Ptr<T> }
    : { [index: number]: Slot<T> });
  // A view that may be read and not written. `const` restricts this holder; it
  // is not a claim that the storage is immutable or unaliased, and nothing here
  // promises otherwise. Writing through one is `TS2542`, "only permits
  // reading", before the compiler is reached.
  export type ConstPtr<T> = { readonly __c_pointer: T } & (T extends
    | Struct<infer Fields, string>
    | Union<infer Fields, string>
    // The same projection `Ptr` makes, restricted. A record member is storage,
    // so it is a *pointer* to that storage here too -- a const one, because a
    // view that could hand out a writable interior would not be a view.
    //
    // It did not mirror `Ptr` until a `copy(destination, source)` needed to
    // pass a `Ptr<Sample>` where a `ConstPtr<Sample>` was wanted and could not:
    // `Ptr` gives `Ptr<Pair>` for a nested record and this gave `Slot<Pair>`,
    // which are unrelated types. Every `ConstPtr` to a record with a nested
    // record or an inline array was unusable, and nothing had asked for one.
    ? { readonly [K in keyof Fields]: Fields[K] extends
          | { readonly __c_struct: unknown }
          | { readonly __c_union: unknown }
          ? ConstPtr<Fields[K]>
          : Fields[K] extends CArray<infer E, number>
            ? ConstPtr<E>
            : Fields[K] extends Bits<number, number>
              ? number
              : Slot<Fields[K]> }
      & { readonly [index: number]: ConstPtr<T> }
    : { readonly [index: number]: Slot<T> });
  // Hand-written native ABI scalar declarations, maintained with hir/native.rs.
  // Import the required types from "c:types".
  // Brands select the C boundary type; arithmetic inside TypeScript is ordinary
  // number arithmetic. An assertion requests a conversion at a foreign call;
  // it does not validate the value's range. The __c_* properties are phantom
  // markers and cannot be read by compiled code.
  // C's `char` is a third type, distinct from both `signed char` and
  // `unsigned char` however it is signed on a target. A `char[65]` member
  // described with `c_uint8` has the same size, alignment and offsets and is
  // still the wrong type -- which the generated witness refuses.
  export type c_char = number & { readonly __c_char: unique symbol };
  export type c_int = number & { readonly __c_int: unique symbol };
  export type c_uint = number & { readonly __c_uint: unique symbol };
  export type c_int8 = number & { readonly __c_int8: unique symbol };
  export type c_uint8 = number & { readonly __c_uint8: unique symbol };
  export type c_int16 = number & { readonly __c_int16: unique symbol };
  export type c_uint16 = number & { readonly __c_uint16: unique symbol };
  export type c_int32 = number & { readonly __c_int32: unique symbol };
  export type c_uint32 = number & { readonly __c_uint32: unique symbol };
  // LP64 native ABI, over `bigint` rather than `number`: a double holds every
  // integer up to 2^53 exactly and nothing above it, so these six carry values
  // a `number` cannot. Measured rather than assumed -- a round trip through a
  // `number`-based `c_int64` returned INT64_MAX as INT64_MIN, with a correct
  // `int64_t` prototype at both ends.
  //
  // Arithmetic on them is ordinary bigint arithmetic; the brand selects the C
  // boundary type and does not wrap each intermediate. A value stored into
  // signed 64-bit storage normalizes like `BigInt.asIntN(64, x)` and unsigned
  // like `asUintN`, and one loaded back is the exact signed or unsigned value.
  //
  // `long`, `size_t` and `ptrdiff_t` are 64 bits on this target, and giving
  // `int64_t` exact values while its own underlying spelling rounded would be
  // the worse of both. A target where `long` is 32 bits would move them back;
  // LP64 is the model implemented here.
  export type c_int64 = bigint & { readonly __c_int64: unique symbol };
  export type c_uint64 = bigint & { readonly __c_uint64: unique symbol };
  export type c_long = bigint & { readonly __c_long: unique symbol };
  export type c_ulong = bigint & { readonly __c_ulong: unique symbol };
  export type c_size_t = bigint & { readonly __c_size_t: unique symbol };
  export type c_ptrdiff_t = bigint & { readonly __c_ptrdiff_t: unique symbol };
  export type c_float = number & { readonly __c_float: unique symbol };
  export type c_double = number & { readonly __c_double: unique symbol };
}

/**
 * The compiler's own storage operations -- `local`, `sizeof`, `addrOf`, `copy`.
 *
 * **No `@ntsHeader`, and that was wrong for a while.** This module was tagged
 * `string.h` on the strength of its name, and it declares not one C function:
 * every export here is an intrinsic the compiler lowers itself. The tag put
 * `#include <string.h>` into every program that named any header-backed
 * struct, for a header nothing in it used, and gave the witness nothing to
 * check. A header names what a module *describes*, not what it sounds like.
 */
declare module "c:memory" {
  // Zero-initialized function-local storage; count is a positive compile-time
  // constant. Local addresses cannot escape, suspend, or be freed manually.
  /** @ntsAbi intrinsic */
  export function local<T>(count?: number): Ptr<T>;
  // Size in bytes, including native struct padding. Requires a complete type.
  /** @ntsAbi intrinsic */
  export function sizeof<T>(): number;

  import type { ConstPtr, Ptr } from "c:types";
  // The address of a native place, written the way C writes it: `addrOf(p.fd)`
  // is `&p->fd`, and `addrOf(p[i])` is `&p[i]`.
  //
  // TypeScript has no lvalues, so this signature accepts any expression and the
  // compiler decides. `addrOf(1 + 1)` and `addrOf(f())` typecheck here and are
  // refused at lowering, naming the expression -- the same contract the rest of
  // this compiler works to: reachable behaviour either lowers or produces a
  // precise diagnostic. What is addressable is a field or an element of native
  // storage, and nothing else; a managed object has no address to take.
  /** @ntsAbi intrinsic */
  export function addrOf<T>(place: { readonly __c_of?: T }): Ptr<T>;
  // `*destination = *source` -- one whole `T`, copied.
  //
  // **An operation rather than an assignment**, because there is nowhere to
  // write one. A record member projects as `Ptr<T>`, deliberately: `p.inner`
  // is the bytes that are there and not a duplicate of them, so
  // `p.inner = q.inner` is a pointer assignment and reads like one. Copying is
  // a different thing and says so.
  //
  // `Ptr` on the destination and `ConstPtr` on the source, which is C's own
  // `memcpy(void *restrict, const void *restrict, size_t)` minus the size --
  // the size is the type's, and both sides share the type.
  //
  // **Overlap is undefined**, exactly as it is for `memcpy`. Nothing here
  // checks it: two pointers into one array can overlap and this compiler
  // cannot see that.
  /** @ntsAbi intrinsic */
  export function copy<T>(destination: Ptr<T>, source: ConstPtr<T>): void;
}

// Type aliases only: every export here renames a brand `c:types` already
// publishes. **No `@ntsHeader`** -- there is no function to re-declare and no
// record to lay out, so a header would add an include and give the witness
// nothing to compare. `c:stdlib` and `c:math` keep theirs, because they
// declare real C functions whose prototypes the witness checks.
declare module "c:stdint" {
  // Hand-written fixed-width C integer aliases. JavaScript number precision applies.
  export type {
    c_int8 as int8_t,
    c_uint8 as uint8_t,
    c_int16 as int16_t,
    c_uint16 as uint16_t,
    c_int32 as int32_t,
    c_uint32 as uint32_t,
    c_int64 as int64_t,
    c_uint64 as uint64_t,
  } from "c:types";
}

// Type aliases only: every export here renames a brand `c:types` already
// publishes. **No `@ntsHeader`** -- there is no function to re-declare and no
// record to lay out, so a header would add an include and give the witness
// nothing to compare. `c:stdlib` and `c:math` keep theirs, because they
// declare real C functions whose prototypes the witness checks.
declare module "c:stddef" {
  // Hand-written aliases for the supported LP64 C data model.
  export type { c_size_t as size_t, c_ptrdiff_t as ptrdiff_t } from "c:types";
}

// Type aliases only: every export here renames a brand `c:types` already
// publishes. **No `@ntsHeader`** -- there is no function to re-declare and no
// record to lay out, so a header would add an include and give the witness
// nothing to compare. `c:stdlib` and `c:math` keep theirs, because they
// declare real C functions whose prototypes the witness checks.
declare module "c:stdbool" {
  // Hand-written: C bool has the same value domain as TypeScript boolean.
  export type bool = boolean;
}

/**
 * Allocation, conversion, and the integer absolute values.
 *
 * @ntsHeader stdlib.h
 */
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

/**
 * The floating-point functions. A program using these links `-lm`, which the
 * witness does not need -- it declares no `main` and is never linked.
 *
 * @ntsHeader math.h
 */
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
