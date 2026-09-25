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
  // An opaque pointer with a single-inheritance hierarchy, as GObject lays
  // out: every instance struct begins with its parent's, so a `GtkButton *`
  // is a `GtkWidget *` and C spells the conversion `GTK_WIDGET(b)`.
  //
  //     type GObject = Class<"_GObject">;
  //     type GtkWidget = Class<"_GtkWidget", GObject>;
  //     type GtkButton = Class<"_GtkButton", GtkWidget>;
  //
  // A `GtkButton` is accepted where a `GtkWidget` goes, and nothing converts
  // downward or sideways: the chain is a tuple of tags, root first, and a
  // child's is its parent's with one more tag, so TypeScript's own tuple
  // assignability is the upcast rule. The compiler reads the same chain and
  // refuses what an `as` assertion would otherwise let through. `Tag` is the
  // C struct tag, as for `Opaque`.
  export type Class<Tag extends string, Parent extends ClassChain | null = null> = {
    readonly __c_chain: readonly [...ChainOf<Parent>, Tag, ...string[]];
  };
  // A TypeScript function handed to C as a callback that carries a context --
  // the `(callback, void *user_data, destroy)` triple C libraries use in place
  // of closures. Write the callback's TypeScript signature; the C one is that
  // with a trailing `void *`, and the context and the destroy function that
  // follow it in the C prototype are not written here and not passed by the
  // caller:
  //
  //     // guint g_idle_add_full(gint, GSourceFunc, gpointer, GDestroyNotify)
  //     export function g_idle_add_full(priority: c_int, f: Closure<() => c_int>): c_uint;
  //     g_idle_add_full(0 as c_int, () => { count++; return 0 as c_int; });
  //
  // The closure may capture. `Closure` is for a callback C keeps: the closure
  // is released when C calls the destroy function, not when the call returns.
  // `ScopedClosure` is for one C calls only during the call -- its C prototype
  // has the context and no destroy function -- and it is released after.
  export type Closure<F extends (...args: never[]) => unknown> = F & { readonly __c_closure?: "retained" };
  // A retained closure handed to C as GLib's type-erased `GCallback`,
  // `void (*)(void)`, the shape of `g_signal_connect_data`. C calls it with
  // the signature `F` plus a trailing context -- which is how a GObject
  // signal's marshaller calls a handler -- so the bridge is typed `F` and only
  // the pointer C receives is erased. Whether `F` is the signal's real
  // signature is the binding's claim; `bind-gir` writes it from GIR.
  //
  // `N` is the destroy function's C type, which C libraries do not agree on:
  // GLib's `GClosureNotify` is `(gpointer, GClosure *)`, and the witness
  // compares it exactly. The context is released through it; any arguments
  // past the first are ignored, which is GLib's own `(GClosureNotify) g_free`.
  export type ErasedClosure<
    F extends (...args: never[]) => unknown,
    N extends (context: Ptr<unknown>, ...rest: never[]) => void,
  > = F & { readonly __c_closure?: "erased"; readonly __c_notify?: N };
  export type ScopedClosure<F extends (...args: never[]) => unknown> = F & { readonly __c_closure?: "scoped" };
  // A closure C calls exactly once, some time after the call that registered
  // it returns, and passes no destroy function for: GIO's
  // `GAsyncReadyCallback`, GIR's `scope="async"`. The context follows it as
  // for `ScopedClosure`, and the closure is released after that one call.
  // A callback C calls twice, or never, is not this.
  export type OnceClosure<F extends (...args: never[]) => unknown> = F & { readonly __c_closure?: "once" };
  // A `string[]` as C's NULL-terminated array of strings -- `argv`, GLib's
  // `gchar **` -- converted for the call and released after it, the way a
  // `string` parameter is. `Q` is the header's spelling, which the witness
  // compares exactly: `"char"` is `char **`, `"const"` is `const char **`,
  // and `"const const"` is `const char * const *`. C that keeps the array
  // past the call cannot be declared this way.
  export type CStrings<Q extends "char" | "const" | "const const" = "const const"> = readonly string[] & {
    readonly __c_strings?: Q;
  };
  // A `string` as NUL-terminated UTF-16, `const uint16_t *` -- Windows'
  // `LPCWSTR`, which every `W` function takes. Callers pass an ordinary
  // `string`; the brand is optional, so any `string` is one. Borrowed for the
  // call and released after it, like a plain `string` parameter's UTF-8: a
  // string already stored as UTF-16 is lent in place, with no copy. Named for
  // the encoding and not "wide": `wchar_t` is four bytes on Linux. A lone
  // surrogate crosses unchanged (Windows' strings are WTF-16), where the UTF-8
  // crossing replaces it; U+0000 inside the string ends the process.
  export type Utf16String = string & { readonly __c_utf16?: true };
  // A `Uint8Array` as C's pointer to its bytes -- `const guint8 *data` --
  // borrowed in place for the call: no copy in or out, so bytes C writes are
  // the ones the array holds when the call returns. `Q` is the header's
  // pointee spelling, which the witness compares exactly. Like `CStrings`,
  // only for C that does not keep the pointer past the call.
  export type CBytes<Q extends "const uint8_t" | "uint8_t" | "const char" | "const void" | "void" = "const uint8_t"> =
    Uint8Array & { readonly __c_bytes?: Q };
  // An array whose length C takes in a parameter of its own -- `argc` beside
  // `argv`, `gsize len` after `const guint8 *data`. The caller does not pass
  // it: the compiler does, from the array, into a slot of brand `L` placed
  // right after the array (`"after"`) or right before it (`"before"`).
  export type Counted<A, L extends number | bigint, At extends "after" | "before" = "after"> = A & {
    readonly __c_count?: L;
    readonly __c_count_at?: At;
  };
  // A handle read-only through this view: C's `const GtkBitset *`. A plain
  // handle is assignable to it, and the C prototype says `const`, which is
  // what the header declares and so what the witness compares against.
  export type Const<H extends ClassChain | Opaque<string>> = H & { readonly __c_const?: true };
  // A handle C takes as `void *` -- `gpointer` -- where the binding still
  // knows which handle it is: the instance of `g_signal_connect_data`, typed
  // by the signal it connects. Any `H` converts to it, and C sees `void *`.
  export type Erased<H extends ClassChain | Opaque<string>> = H & { readonly __c_erased?: true };
  // An enum C takes as the integer `B` -- `GtkOrientation`, which the header
  // makes an `unsigned int` -- so its members pass as they are, with no
  // `as c_uint`, and a member of another enum does not. A plain number is
  // still accepted, as C accepts one.
  export type CEnum<E extends number, B extends number> = E & { readonly __c_enum?: B };
  // A boolean C holds in the integer `B` -- GLib's `gboolean`, an `int`. The
  // program passes and reads `true` and `false`; C sees `1` and `0`, and any
  // non-zero it answers is `true`.
  export type CBool<B extends number> = boolean & { readonly __c_bool?: B };
  // A C number a binding takes and gives as a plain `number`: `C` names the
  // C type (`"int"` is `int`, `"size_t"` is `size_t`), and a program writes
  // `box.spacing = 4` or `read_upto("\n", -1)` with no cast. A 64-bit
  // quantity past 2^53 rounds, as it does in GJS and in every bridge to
  // JavaScript; what must keep every bit -- an identifier, GLib's `GType` --
  // keeps its `bigint` brand. The same optional brand `objc:types` spells
  // Swift's numbers with.
  export type CNumber<
    C extends
      | "char" | "int8" | "uint8" | "int16" | "uint16" | "int" | "uint" | "int32" | "uint32"
      | "int64" | "uint64" | "long" | "ulong" | "size_t" | "float" | "double",
  > = number & { readonly [K in `__c_${C}`]?: true };
  // A handle C declares as one of its ancestors: `gtk_box_new` returns the
  // `GtkBox` GIR says it does, which the header declares `GtkWidget *`. The
  // program has a `T`; C's prototype says `D`, which must be an ancestor of
  // `T`. A trust boundary, not a check: the claim is believed, as gtk-rs
  // believes it (`unsafe_cast`), and a factory that returned a sibling of
  // `T` would be read as a `T`. Only a `D` unrelated to `T` is refused.
  export type Declared<T extends ClassChain, D extends ClassChain> = T & { readonly __c_declared?: D };
  // A record C takes or returns **by value** -- `NSRect frame`, not
  // `NSRect *frame`. TypeScript holds a record only as storage, so this is a
  // pointer to it: an argument is read from the storage it points at, and C
  // copies it; a result is written into storage the call makes in the
  // caller's frame, with `local<T>()`'s rules. The brand is optional, so any
  // `Ptr<T>` passes.
  //
  // Plain bytes only: a record holding a counted handle is refused, because a
  // copy of it would be a second owner.
  export type ByValue<T> = Ptr<T> & { readonly __c_by_value?: true };
  // The same record written as an object literal, where a parameter takes
  // `ByValue<T> | Fields<T>`: `{ origin: { x: 0, y: 0 }, size: { width: 320,
  // height: 200 } }` for an `NSRect`, as Swift writes `NSRect(origin:size:)`.
  // The literal becomes storage in the caller's frame, zeroed, with
  // `local<T>()`'s rules. Each field is written in the order the literal
  // gives it, which is when JavaScript evaluates it, and a field left out
  // stays zero. Nothing is allocated: it is C's compound literal.
  //
  // A number field takes a `number` whatever C's width is, converted at the
  // write as `p.x = n` converts it. A record field takes its own literal.
  // Only a literal: an object held in a variable is the program's, and has
  // no storage to pass.
  export type Fields<T> = ([T] extends [Struct<infer F, string>] ? { [K in keyof F]?: FieldOf<F[K]> } : never) & {
    readonly __c_fields?: T;
  };
  type FieldOf<V> = [V] extends [number] ? number : [V] extends [Struct<any, string>] ? Fields<V> : V;
  // A `GObject`: `Class<Tag, Parent>` for an object GLib counts. Under the
  // reference-counting provider the compiler takes a reference where a
  // second one is kept -- `g_object_ref_sink`, which also takes the floating
  // reference a new widget is born with -- and drops it where the last one
  // dies, `g_object_unref`; so a program never calls either. Under the
  // no-GC provider nothing is ever freed, a GObject included.
  //
  // `Implements` is the tags of the interfaces the class declares, and a
  // class also implements what its parent does: `GtkEntry` is a `GtkEditable`,
  // which is how `entry.get_text()` reaches `gtk_editable_get_text`.
  export type GObjectClass<
    Tag extends string,
    Parent extends ClassChain | null = null,
    Implements extends string = never,
  > = Class<Tag, Parent> & {
    readonly __gobject: true;
    readonly __c_implements: ImplementsOf<Parent> & { readonly [K in Implements]: true };
  };
  // A GObject interface: a handle of its prerequisite class (`GtkWidget` for
  // `GtkEditable`) that C spells by its own tag, `GtkEditable *`. Anything
  // implementing `Tag` converts to one -- its `__c_implements` says so -- and
  // nothing else does. The marker is optional so that an implementing class,
  // which has none, is assignable; its value tells two interfaces apart. An
  // interface whose prerequisite is another interface names the first class
  // above it and `Implements` the interfaces between: `GDtlsConnection` is a
  // `GObject` implementing `GDatagramBased`, so there is one marker per type.
  export type GObjectInterface<Tag extends string, Prerequisite extends ClassChain, Implements extends string = never> =
    Prerequisite & {
      readonly __c_interface?: Tag;
      readonly __c_implements: { readonly [K in Tag | Implements]: true };
    };
  type ImplementsOf<P> = P extends { readonly __c_implements: infer I } ? I : {};
  // A result the caller owns -- GIR's `transfer-ownership="full"`: the
  // reference comes with it, and is not taken again.
  export type Owned<T extends ClassChain> = T & { readonly __c_owned?: true };
  // An argument the callee keeps -- GIR's `transfer-ownership="full"` on a
  // parameter: the caller hands its reference over instead of dropping it
  // after the call, taking one first if it has only a borrowed handle.
  export type Consumed<T extends ClassChain> = T & { readonly __c_consumed?: true };
  // A GLib boxed record -- a C struct GLib copies and frees by its `GType`
  // (`g_boxed_copy`, `g_boxed_free`): `GtkTextIter`, `GdkRGBA`. The program
  // holds one by reference, as JavaScript holds any object, in a box of its
  // own that gives the struct back when the program's last reference goes:
  // `iter.forward_char()` moves the one iterator every name for it sees.
  //
  // `GetType` names the record's `GType` function; `Size` is its `sizeof`,
  // for a record C lets its caller allocate, and 0 where the headers keep the
  // struct opaque. A record a function hands over (`Owned<...>`) is boxed as
  // it is; one it lends is copied first, since the box will free what it
  // holds.
  export type Boxed<Tag extends string, GetType extends string, Size extends number = 0> = Class<Tag> & {
    readonly __c_boxed?: GetType;
    readonly __c_size?: Size;
  };
  // What a `Class` is, for the constraint above; not a type to write.
  export type ClassChain = { readonly __c_chain: readonly string[] };
  // A parent's tags, without the rest element that keeps the chain open.
  // Read head by head because inferring the prefix before a rest element in
  // one pattern degrades to `string[]` -- which made every chain assignable to
  // every other.
  type ChainOf<P> = P extends { readonly __c_chain: infer C } ? Tags<C> : [];
  type Tags<T> = T extends readonly [infer H extends string, ...infer R] ? [H, ...Tags<R>] : [];
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
  // The record's name is a **typedef**, not a tag. C spells the type
  // `__sigset_t` and never `struct __sigset_t`, because
  // `typedef struct { ... } __sigset_t;` gives the struct no tag at all -- only
  // a typedef name, which C11 6.7.8 grants for linkage and which is not a name
  // source may write after `struct`.
  //
  // A wrapper rather than a third argument to `Struct`, for the reason `Packed`
  // is one: it says a thing about the whole record, and a positional flag in a
  // tag slot reads as part of the name. It is the only thing in this surface
  // that changes how a type is *spelled* rather than how it is laid out, which
  // is why it is not inferable -- nothing in `Struct<{...}, "__sigset_t">` says
  // which of the two the header wrote, and this compiler does not read headers.
  export type Typedef<T> = T & { readonly __c_typedef: true };
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
  //
  // Distributive on purpose, and `null` kept as itself: a slot of a nullable
  // handle (`GError **`'s pointee) reads as the handle or `null`, where
  // `null & { __c_of?: T }` would be `never` and lose the null C writes.
  type Slot<T> = T extends number
    ? number & { readonly __c_of?: T }
    : T extends null
      ? T
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
  // `T name[]` at the end of a struct -- C's *flexible array member*. Storage
  // with no extent: placed at T's alignment, raising the struct's, and adding
  // no bytes. `struct cmsghdr` is 16 bytes and `__cmsg_data` is at 16.
  //
  // Reading it gives a `Ptr<T>`, the decay C performs, and that is all C offers
  // -- there is no extent to copy and no whole value to load.
  //
  // **The count is not in the type, and not anywhere this compiler can see.**
  // For `cmsghdr` it is `cmsg_len` minus the header; elsewhere it is another
  // member, an argument, or a protocol. Nothing bounds a read through one,
  // which is the same footing as every other native pointer here.
  export type Flexible<T> = {
    readonly __c_flexible: T;
  };
  export type Ptr<T> = { readonly __c_pointer: T; readonly __c_writable: true } & ([T] extends [
    | Struct<infer Fields, string>
    | Union<infer Fields, string>]
    // In brackets, so a union element is one pointer and not a union of
    // pointers: `Ptr<GError | null>` is `GError **`, which distributing over
    // the `null` split into two types no C declaration spells.
    // A struct-typed member is stored inline and projects as a *pointer to it*,
    // never as a value: reading one as a value would be an aggregate copy, and
    // `p.inner.field` should reach the bytes that are there rather than a
    // duplicate of them. This is what `p[i]` already does for a block of
    // structs, for the same reason.
    ? { [K in keyof Fields]: Fields[K] extends
          | { readonly __c_struct: unknown }
          | { readonly __c_union: unknown }
          ? Ptr<Fields[K]>
            : Fields[K] extends Flexible<infer E>
              ? Ptr<E>
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
  export type ConstPtr<T> = { readonly __c_pointer: T } & ([T] extends [
    | Struct<infer Fields, string>
    | Union<infer Fields, string>]
    // In brackets for the reason `Ptr`'s are.
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
            : Fields[K] extends Flexible<infer E>
              ? ConstPtr<E>
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
  // `size_t` and `ptrdiff_t` are 64 bits on every supported target, and so is
  // `long` except on Windows. Giving `int64_t` exact values while its own
  // underlying spelling rounded would be the worse of both.
  //
  // **`c_long` and `c_ulong` on Windows.** Win64 is LLP64: C's `long` is 32
  // bits there. The brand stays `bigint` on every target, so one source builds
  // for all of them, and the value in TypeScript is the same exact integer.
  // Only the slot C reads is narrower:
  // - **A constant that does not fit** a 32-bit `long` (or `unsigned long`) is
  //   refused when building for Windows, naming the value.
  // - **A runtime value is truncated** modulo 2^32 at the boundary, as C
  //   truncates: `2n ** 32n + 5n` arrives as `5`. A value C hands back is
  //   sign-extended for `c_long` and zero-extended for `c_ulong`.
  // Use `c_int64`/`c_uint64` for a value that needs 64 bits on every target.
  export type c_int64 = bigint & { readonly __c_int64: unique symbol };
  export type c_uint64 = bigint & { readonly __c_uint64: unique symbol };
  export type c_long = bigint & { readonly __c_long: unique symbol };
  export type c_ulong = bigint & { readonly __c_ulong: unique symbol };
  // C's `long` and `unsigned long` where they are 32 bits: Windows (LLP64),
  // whose APIs are built on `LONG` and `DWORD`. A `number`, where `c_long` is
  // a `bigint` so that portable code is exact on every target. A Windows
  // binding uses these; a build for a target whose `long` is 64 bits refuses
  // every function that takes or returns one, by name.
  export type c_long32 = number & { readonly __c_long32: unique symbol };
  export type c_ulong32 = number & { readonly __c_ulong32: unique symbol };
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
  import type { c_char } from "c:types";
  // A C string as a `string`: the bytes up to its NUL, copied, and decoded as
  // UTF-8 -- an ill-formed sequence becomes one U+FFFD for its maximal
  // prefix, as node's `TextDecoder` has it. The pointer is neither kept nor
  // freed: a string a function handed over is still the caller's to free,
  // after this has copied it. NULL is `null`.
  //
  // For a `char *` that does not arrive as a function's result -- which is
  // copied without asking -- but out of an out parameter's slot or a
  // struct's member.
  /** @ntsAbi intrinsic */
  export function stringFrom(c: ConstPtr<c_char> | null): string | null;
  import type { c_uint8 } from "c:types";
  // `length` **bytes** at `bytes` -- bytes, not elements; the result is a
  // `Uint8Array`, where the two are the same number -- copied into a new
  // `Uint8Array` the program owns. The pointer is neither kept nor freed: a
  // buffer a function handed over is still the caller's to free, after this
  // has copied it. NULL with a length of 0 is an empty array; NULL with any
  // other length ends the process, since a length with nothing behind it is
  // a broken promise rather than an absence.
  /** @ntsAbi intrinsic */
  export function bytesFrom(bytes: ConstPtr<c_uint8> | null, length: number): Uint8Array;
  // `value` as the handle type `T` when `is` holds, and `null` otherwise:
  // a downcast along a declared `Class` hierarchy, `GTK_BOX(w)` with its
  // check made explicit.
  //
  // **`is` is the caller's claim, and nothing ties it to `value`**, which is
  // what the name says. The object system answers it --
  // `g_type_check_instance_is_a` for GObject, `isKindOfClass:` for
  // Objective-C -- and a binding generator writes one checked helper per class
  // (`asGtkBox(v)`) so that application code never calls this. The compiler
  // checks what it can: `T` must be a strict descendant of `value`'s type, so
  // a sideways or unrelated cast is refused however `is` was computed. A null
  // `value` answers null, as both runtimes' checks do for one.
  /** @ntsAbi intrinsic */
  export function unsafeDowncast<T extends import("c:types").ClassChain>(
    value: import("c:types").ClassChain | null,
    is: boolean,
  ): T | null;
}

// Type aliases only: every export here renames a brand `c:types` already
// publishes. **No `@ntsHeader`** -- there is no function to re-declare and no
// record to lay out, so a header would add an include and give the witness
// nothing to compare. `c:stdlib` and `c:math` keep theirs, because they
// declare real C functions whose prototypes the witness checks.
declare module "c:pending" {
  // An operation the program awaits is outstanding, and then is not: while
  // any is, the program keeps running, as node keeps it running for an fs
  // request -- a completion that comes from another thread is not work the
  // loop can see. A binding's Promise over a foreign async operation calls
  // both, on the owning thread: the end on the completion, and on a start
  // that failed.
  /** @ntsAbi intrinsic */
  export function nts_pending_begin(): void;
  /** @ntsAbi intrinsic */
  export function nts_pending_end(): void;
}

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
 * Allocation, conversion, the integer absolute values, and `exit`.
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
  // Ends the process with `status`, flushing its streams: what Swift's
  // `exit(0)` is, from a program whose run loop never returns.
  export function exit(status: c_int): void;
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
