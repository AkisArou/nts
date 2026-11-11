//! Select HIR representations for semantic types and substitutions.

use super::{
    Absence, HirType, LiteralValue, ManagedType, SemanticSnapshot, Substitution, TypeId, TypeKind,
    absence_of_member, abstract_generator_kind, declares_storage, generator_element_type,
    holds_only_absences, inherited_typed_array, iterator_result_element, named, property_branded,
    provided, table_key_within, tuple_representation,
};

/// Whether an erased value can be read back as this.
///
/// `Unerase` is a load out of the payload, so it needs a representation to load
/// *as*. A `Void` has none -- there is nothing in the payload for `undefined`,
/// the tag is the whole value -- and neither has a `Never`, an erased value, or
/// a table.
///
/// Asked in two places, which is why it is a function rather than a `matches!`:
/// [`FuncBuilder::narrowed`](super::FuncBuilder::narrowed) reads back what the checker narrowed, and
/// [`FuncBuilder::present_of`](super::FuncBuilder::present_of) reads back what a `?.` test established. The two
/// have different licences and the same question about the destination.
/// What a representation is, in words a diagnostic can use.
///
/// For a refusal whose subject is the *representation* rather than the checker's
/// type: the value has been lowered by the time it is refused, so the node's
/// type would describe what the source said and not what the receiver is.
///
/// Grouped rather than exhaustive — a census wants "a promise" against "an
/// erased value", not every element width apart.
pub(super) fn named_representation(ty: &HirType) -> &'static str {
    match ty {
        HirType::Void => "nothing",
        HirType::Erased => "an erased value",
        HirType::PossiblyUndefined(_) => "a possibly undefined value",
        HirType::Bool => "a boolean",
        HirType::BigInt => "a bigint",
        HirType::Never => "a value of type `never`",
        HirType::Int { .. } | HirType::Float { .. } => "a number",
        HirType::NativePointer(_) => "an opaque C pointer",
        HirType::Managed(managed) => match managed {
            ManagedType::BoxedBigInt => "owned bigint storage",
            ManagedType::String => "a string",
            ManagedType::Array(_) => "an array",
            ManagedType::Template => "an immutable template object",
            ManagedType::Promise(_) => "a promise",
            ManagedType::Map(_, _) => "a map",
            ManagedType::Set(_) => "a set",
            ManagedType::Table(_, _) => "a table",
            ManagedType::Symbol => "a symbol",
            ManagedType::View(_) | ManagedType::AnyView => "a typed array",
            ManagedType::Date => "a date",
            ManagedType::Region => "a region's handle",
            ManagedType::Buffer => "a buffer",
            ManagedType::DataView => "a data view",
            // Exhaustive on purpose. A new representation should have to answer
            // here rather than inherit a sentence that is wrong about it.
            ManagedType::Object(_) => "an object",
        },
    }
}

/// Whether a value of this type can be erased into an `unknown`.
///
/// A whitelist, and it is the third list of this family in one file: this one,
/// [`readable_back`](super::readable_back), and the C backend's `erased_tag`. Two of them went stale
/// on the same day for the same reason -- a typed array was covered by accident
/// while it was `ManagedType::Array`, and left every list the moment it got a
/// variant of its own, with nothing noticing until a feature needed the one
/// conversion it no longer had.
///
/// Stated once here so the two in this file cannot disagree again;
/// `erasure_and_read_back_are_one_fact` is what holds them together.
/// Whether a value of this type may be boxed into an `unknown`.
///
/// **Public so that the C backend can hold it against `erased_tag`.** The two
/// are one decision written twice -- this says a value may be asked about, that
/// says which tag it carries -- and they have disagreed six times, always the
/// same way: a variant taught to the backend that has to spell it and not to
/// the predicate that decides whether it may be asked about. The seventh is a
/// test rather than a comment.
#[must_use]
pub fn erasable(ty: &HirType) -> bool {
    // A counted handle of a family erased as a tag (`tags::erased_handle_tag`),
    // which the backends' `erased_tag` spells from the same table.
    if let HirType::NativePointer(pointee) = ty {
        return crate::hir::tags::erased_handle_tag(pointee).is_some();
    }
    matches!(
        ty,
        HirType::Float { .. }
            | HirType::Int { .. }
            | HirType::Bool
            | HirType::BigInt
            | HirType::Void
            | HirType::Managed(
                ManagedType::BoxedBigInt
                    | ManagedType::String
                    | ManagedType::Object(_)
                    | ManagedType::Array(_)
                    | ManagedType::Template
                    | ManagedType::View(_)
                    | ManagedType::Buffer
                    // A promise is an ordinary managed object too, and it is
                    // here for the reason the two above are: `util.inspect`
                    // asks `x instanceof Promise` of an `unknown`, and a test
                    // is worth nothing if the value cannot get into one.
                    | ManagedType::Promise(_)
                    // A symbol has had `NTS_TAG_SYMBOL` since it got a tag of
                    // its own, and the C backend's `erased_tag` has mapped it
                    // ever since -- this list is the one that never learned.
                    // The fourth time this family has gone stale, and found the
                    // same way as the others: by a narrowing that had no reason
                    // to be refused. `typeof v === "symbol"` on an `unknown` is
                    // a question the runtime can answer, and the value is
                    // sitting right there.
                    | ManagedType::Symbol
                    // A table, which is the **seventh** time and the first that
                    // was predicted in writing: the comment above says a variant
                    // taught to the backend and not to this predicate is how
                    // these drift, and `Table` leaving `Map` did exactly that
                    // within a day of the comment being written.
                    //
                    // Found by `readline`, whose `internal/errors.ts` narrows an
                    // `unknown` to a `Record<string, unknown>` -- and found by
                    // the *gate* rather than by review, because `erased_tag`'s
                    // match ends in `_ => None` and a new variant falls through
                    // it silently. Every other match this change touched was
                    // exhaustive and named itself; this family is the one that
                    // cannot, which is why it now has the test the comment above
                    // has been claiming for a day.
                    | ManagedType::Table(_, _)
                    // A table, which is the **seventh** time and the first that
                    // was predicted in writing: the comment above says a variant
                    // taught to the backend and not to this predicate is how
                    // these drift, and `Table` leaving `Map` did exactly that
                    // within a day of the comment being written.
                    //
                    // Found by `readline`, whose `internal/errors.ts` narrows an
                    // `unknown` to a `Record<string, unknown>` -- and found by
                    // the *gate* rather than by review, because `erased_tag`'s
                    // match ends in `_ => None` and a new variant falls through
                    // it silently. Every other match this change touched was
                    // exhaustive and named itself; this family is the one that
                    // cannot, which is why it now has the test the comment above
                    // has been claiming for a day.
                    // And a view whose element type the declaration does not
                    // name, which is the *fifth* time this list has gone stale
                    // and the first where the omission was made the same hour
                    // the variant was. `AnyView` is one `NtsView *` with an
                    // `NTS_TAG_OBJECT`, exactly as `View` beside it is, and the
                    // C backend's `erased_tag` was taught both at once.
                    //
                    // `unknown` in parameter position is what node's validators
                    // are declared with -- `ERR_INVALID_ARG_TYPE`'s third
                    // parameter is one, `internal/validators.ts` is imported by
                    // every module, and `blob.ts` hands it the view it just
                    // rejected. So a representation that cannot be boxed is a
                    // representation that cannot be reported on.
                    | ManagedType::AnyView
                    // And a `DataView`, and a `Date`. The **sixth** time this
                    // list has gone stale, and the first with two entries at
                    // once -- both have been in the C backend's `erased_tag`
                    // for longer than `AnyView` has, under the same
                    // `NTS_TAG_OBJECT` as every other reference, so the boxing
                    // was always emittable and only this list said no.
                    //
                    // Found by the JVM lane probing `instanceof DataView` end
                    // to end: the predicate landed in both backends and a
                    // *constructed* `DataView` still could not reach an
                    // `unknown` to be asked about. Both lanes refused the same
                    // program with the same message, which is what said the
                    // gap was upstream of either.
                    //
                    // The pattern this list keeps repeating: a variant is added
                    // to `ManagedType`, taught to the backend that has to spell
                    // it, and not to the predicate that decides whether it may
                    // be asked about. A test is worth nothing if the value
                    // cannot get into the thing being tested.
                    | ManagedType::DataView
                    | ManagedType::Date
                    // A `Map` and a `Set` are ordinary references too, and a
                    // predicate that cannot be asked of a constructed value is
                    // half a feature -- which is what `DataView` was until an
                    // hour ago.
                    | ManagedType::Map(_, _)
                    | ManagedType::Set(_)
            )
    )
}

/// A collection nothing in the program chose the contents of: every type
/// parameter erased, which is what a library overload answers when an
/// allocation names none -- `new Array(n)`'s `any[]`, `new Map()`'s
/// `Map<any, any>` (the zero-argument `new (): Map<any, any>`), and `Set<any>`.
///
/// Such a type says nothing about the elements, so it gives way to where the
/// value goes: see [`chooses`].
pub(super) fn an_unchosen_collection(ty: &HirType) -> bool {
    match ty {
        HirType::Managed(ManagedType::Array(element) | ManagedType::Set(element)) => {
            **element == HirType::Erased
        }
        HirType::Managed(ManagedType::Map(key, value)) => {
            **key == HirType::Erased && **value == HirType::Erased
        }
        _ => false,
    }
}

/// Whether `wanted` is the collection an [`an_unchosen_collection`] stands
/// for: one of the same kind that chooses something. A `Map<any, number>`
/// chooses its values; a context that is itself unchosen, or another kind of
/// thing, chooses nothing, and the allocation keeps the library's answer.
pub(super) fn chooses(unchosen: &HirType, wanted: &HirType) -> bool {
    let same_kind = matches!(
        (unchosen, wanted),
        (
            HirType::Managed(ManagedType::Array(_)),
            HirType::Managed(ManagedType::Array(_))
        ) | (
            HirType::Managed(ManagedType::Map(..)),
            HirType::Managed(ManagedType::Map(..))
        ) | (
            HirType::Managed(ManagedType::Set(_)),
            HirType::Managed(ManagedType::Set(_))
        )
    );
    same_kind && !an_unchosen_collection(wanted)
}

#[must_use]
pub fn representation(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<HirType> {
    representation_with(snapshot, ty, &Substitution::default())
}

/// [`representation`], resolving type parameters through a substitution.
#[must_use]
pub fn representation_with(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    subst: &Substitution,
) -> Option<HirType> {
    representation_within(
        snapshot,
        ty,
        &mut Vec::new(),
        &Representation {
            substitution: subst,
            cast_faces: &rustc_hash::FxHashSet::default(),
        },
    )
}

/// Cast-face values retain their erased tag through every storage position.
/// The selector alone forms a transient managed view after testing that tag.
pub(super) struct Representation<'a> {
    pub(super) substitution: &'a Substitution,
    pub(super) cast_faces: &'a rustc_hash::FxHashSet<TypeId>,
}

impl std::ops::Deref for Representation<'_> {
    type Target = Substitution;
    fn deref(&self) -> &Self::Target {
        self.substitution
    }
}

pub(super) fn representation_within(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    path: &mut Vec<TypeId>,
    subst: &Representation<'_>,
) -> Option<HirType> {
    if path.contains(&ty) {
        return None;
    }
    path.push(ty);
    let result = representation_of(snapshot, ty, path, subst);
    path.pop();
    // Runtime containers dispatch between numbers, managed references and
    // tagged values. A native pointer belongs to none of those protocols.
    //
    // **And neither does `undefined`.** `undefined[]` -- which `[undefined]`
    // is, and which an untyped `([x = 23] = [undefined])` parameter default
    // produces -- has `HirType::Void` as its element, and the C backend writes
    // the element type into every access: `NTS_ITEMS(v, void)[i]` is not C.
    // The program emitted, the compiler exited 0, and `cc` failed on generated
    // code -- the silently-unbuilt shape, which is worse than a refusal.
    //
    // **`Array` alone.** A `Promise<void>` is the most ordinary thing in the
    // language and settles with nothing rather than storing it; the same arm
    // covers both, so the test has to name the container. `Set<undefined>` is
    // left out for want of a program that writes one.
    result.filter(|ty| match ty {
        // A counted foreign object is an element the array owns a count of
        // (`NTS_ARRAY_FOREIGN`); a C handle nobody counts is not one it can own.
        HirType::Managed(ManagedType::Array(element)) => match element.as_ref() {
            HirType::NativePointer(_) => element.counting().is_some(),
            HirType::Void | HirType::Never => false,
            _ => true,
        },
        // A promise has a slot of its own for a C handle
        // (`nts_promise_fulfill_pointer`), outside its value; a set has none.
        // Except an Objective-C object's, Swift's `Set<NSObject>`: held in
        // its family's box, and hashed and compared by the object's own
        // `-hash` and `-isEqual:` (`NTS_KEY_OBJC`), not by the box's identity.
        HirType::Managed(ManagedType::Set(element)) => match element.as_ref() {
            HirType::NativePointer(pointee) => crate::hir::tables::is_objc_object(pointee),
            _ => true,
        },
        // A map's *value* may be a counted foreign object -- Swift's
        // `[String: NSObject]` -- held in a box of its family, as a promise
        // holds one (`erased`). A key may not: a box has an
        // identity of its own, not the object's.
        HirType::Managed(ManagedType::Map(key, value)) => {
            !matches!(key.as_ref(), HirType::NativePointer(_))
                && !matches!(value.as_ref(), HirType::NativePointer(pointee) if pointee.counting().is_none())
        }
        HirType::Managed(ManagedType::Table(key, value)) => !matches!(key.as_ref(), HirType::NativePointer(_)) && !matches!(value.as_ref(), HirType::NativePointer(_)),
        _ => true,
    })
}

/// What a tuple represents as.
///
/// Two answers, and the difference is whether the elements agree.
///
/// A tuple whose elements share a representation *is* an array of it:
/// `[number, number]` is two doubles in a row, which is what `number[]` is, and
/// what the tuple adds is a length -- which is not part of a representation.
///
/// A heterogeneous one is a struct with positional fields, which needs a layout
/// rather than an element type. `layout_of` builds it, and it is a reference
/// like any other object. Before that existed this was refused, at a cost of 40
/// refusals in the node profile -- 38 of them a `Map` value, where naming the
/// argument is what made them visible at all.
/// A representation as it is **stored**, rather than as it is produced.
///
/// `undefined` and `void` both represent as [`HirType::Void`], which is right
/// for a function's result — it returns nothing — and wrong for a slot that is
/// read back. `[,]` is typed `undefined[]`, and
///
/// ```js
/// method([x = 23] = [,]) { … }
/// ```
///
/// reads index 0 and compares it with `undefined` to decide whether the default
/// fires. A slot with no width has nothing to hand back, and a **numeric**
/// placeholder would hand back `0` — so the default would not fire and `x`
/// would be `0` where JavaScript says 23. That is the difference from
/// `suspend::yielded_slot`, which may use a number precisely because nothing
/// can read the slot it fills.
///
/// `Erased` is the one representation with an `undefined` in it, so it is the
/// only honest answer. It costs a tagged value where nothing is stored, which
/// is the right trade for a slot that exists only to be compared against
/// `undefined`.
///
/// Asked at the three places a representation becomes a **slot** — an array's
/// element, a tuple's position, and a binding declared without an initializer.
///
/// The third was excluded here, on the grounds that "a function's result, a
/// parameter and a binding are not slots in this sense: they hand `undefined`
/// back by having nothing there". True of a result and a parameter, and false of
/// the binding [`Lowering::unwritten`] makes: that name is *carried* from its
/// declaration to its first assignment, through block parameters and merges, so
/// it has to be a value, and `Void` is not one. `var g;` read before anything
/// writes it refused for want of a zero.
///
/// **A result stays excluded and a parameter does not, and the reason is not a
/// read.** "Nothing reads them back" is true of both, and irrelevant to a
/// parameter: the caller passes it *positionally*, so it must have a width
/// whether or not the body looks at it. C spells a zero-width one `void v2`,
/// which is not C -- and that is how it was found, in `fs`'s addon, once a
/// closure inside a generic function's copy could be lowered at all and met
/// `(...args: [unknown, T])` with `T` bound to `void`. A result genuinely can be
/// absent from a signature; a parameter cannot.
///
/// So the slot positions are five, and the fifth is asked **twice** -- at
/// `lower_param` and at `Lowering::parameter_representation`, which is the call
/// site's answer to the same question. Both, or neither: one side alone makes an
/// erased value meet a `Void` and refuse.
pub(super) fn in_a_slot(representation: HirType) -> HirType {
    if matches!(representation, HirType::Void) {
        HirType::Erased
    } else {
        representation
    }
}

/// The representation a **slot** takes for an element type.
///
/// [`in_a_slot`] over [`representation_within`], plus the step that function
/// cannot make: a type whose whole inhabitant set is `null` and `undefined` has
/// no representation at all, so the `?` discarded the array or tuple containing
/// it rather than reaching the mapping. `[undefined, undefined]` lowered and
/// `[null, null]` did not, which is the same asymmetry an object's field had.
///
/// The four slot positions answer this one way: an array's element, a tuple's
/// position, an object's field, and a merge's parameter. Narrowing reaches none
/// of them -- which is what separates this from the `representation_of` change
/// reverted on 2026-09-13, recorded in
/// `blockers/a-property-typed-exactly-null`.
pub(super) fn slot_for(
    snapshot: &SemanticSnapshot,
    element: TypeId,
    path: &mut Vec<TypeId>,
    subst: &Representation<'_>,
) -> Option<HirType> {
    if holds_only_absences(snapshot, element) {
        return Some(HirType::Erased);
    }
    Some(in_a_slot(representation_within(
        snapshot, element, path, subst,
    )?))
}

fn provided_representation(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    path: &mut Vec<TypeId>,
    subst: &Representation<'_>,
) -> Option<HirType> {
    let record = snapshot.types.get(ty.0 as usize)?;
    if !matches!(record.kind, TypeKind::Object { .. } | TypeKind::Structured) {
        return None;
    }
    // declared its own `Promise` would be mis-read, and the principled
    // version is `docs/records/notebooks/any-unknown.md`'s profiles, which tie a trusted
    // A `Date` carries nothing: the specification's "time value" is the whole
    // of its contents, so there are no arguments to read and no payload
    // representation to decide. First, because it is the only one of these
    // that reads nothing further.
    if provided(snapshot, ty) == Some("Date") {
        return Some(HirType::Managed(ManagedType::Date));
    }

    // A runtime-immutable source-site object, rather than TypeScript's purely
    // static readonly-array annotation. Raw strings remain a named boundary.
    if provided(snapshot, ty) == Some("TemplateStringsArray") {
        return Some(HirType::Managed(ManagedType::Template));
    }

    // An `ArrayBuffer`, for the same reason and on the same terms: it carries
    // no element type, so there is nothing further to read. What varies about
    // a buffer is its length and whether it is resizable, and both are runtime
    // state rather than representation -- `ArrayBuffer` is one TypeScript type
    // whether or not `maxByteLength` was passed, so a parameter declared
    // `ArrayBuffer` may be either and the type cannot say which.
    if provided(snapshot, ty) == Some("ArrayBuffer") {
        return Some(HirType::Managed(ManagedType::Buffer));
    }

    // **A `SharedArrayBuffer` is the same bytes**, and the same representation.
    //
    // It was in no list at all -- the name appears nowhere else in this
    // compiler -- so every signature naming one refused, and the shape the
    // corpus writes is a *union*:
    //
    //     ArrayBufferView | ArrayBuffer | SharedArrayBuffer | undefined
    //
    // 67 property sites and 27 parameter sites in `runtime/node` carry that
    // union, and it reads as a union problem. It is not: `ArrayBuffer` alone
    // lowers, `ArrayBufferView` alone lowers, `ArrayBufferView | ArrayBuffer`
    // lowers, and every refusing spelling has `SharedArrayBuffer` in it. One
    // missing member, ~94 sites.
    //
    // **Sharing a representation is not sharing an identity.** `instanceof` is
    // a descriptor check at run time rather than a question about the static
    // type, so two types that lay out identically can still be told apart --
    // which is exactly how `Map` and `Set` share one struct and one
    // `holds_values` bit. What this compiler does not yet have is a descriptor
    // for a shared buffer, so the two operations that would need one refuse by
    // name below rather than answering from `ArrayBuffer`'s:
    //
    //   * `new SharedArrayBuffer(n)` -- nothing allocates with that descriptor;
    //   * `x instanceof SharedArrayBuffer` -- `nts_is_buffer` would answer
    //     `true` for a plain `ArrayBuffer`, which is a wrong answer where this
    //     is a missing one.
    //
    // Both refused before this too, because the type had no representation at
    // all, so nothing that used to compile changes.
    if provided(snapshot, ty) == Some("SharedArrayBuffer") {
        return Some(HirType::Managed(ManagedType::Buffer));
    }

    // A `DataView`, on the same terms once more -- and it is the clearest case
    // in this family rather than the murkiest. A typed array *is* its element
    // type; a `DataView` has none, because the width is chosen per access by
    // the method called. `getUint8` and `getFloat64` are two calls on one type,
    // so there is nothing for a payload to carry.
    if provided(snapshot, ty) == Some("DataView") {
        return Some(HirType::Managed(ManagedType::DataView));
    }

    // `Generator<T, TReturn, TNext>` — the **abstract generator**, and the
    // checker's own id for it is the class. Its layout is the prefix every
    // generator frame already begins with, so a frame reaches a parameter
    // declared as one without a cast to relate, and the resumption it declares
    // is what a walk dispatches through when the generator was made elsewhere.
    //
    // `Generator` alone, deliberately. A generator satisfies `Iterator<T>` and
    // `IterableIterator<T>`, but so does a hand-written object with a `next` --
    // and that shape *already works*, as a protocol object with a `{ value,
    // done }` result rather than a frame. Representing those two names as a
    // frame would take the working case and give it the wrong machine value.
    // They are a subtyping question, and a separate row.
    // No `!= Void` here any more: `generator_element_type` answers through
    // `yielded_slot`, so an uninhabited element arrives as the placeholder and
    // a `Generator<void, …>` represents like any other.
    if abstract_generator_kind(snapshot, ty).is_some()
        && generator_element_type(snapshot, ty, path, subst).is_some()
    {
        return Some(HirType::Managed(ManagedType::Object(ty)));
    }

    // An `ArrayBufferView`, which is none of the above and is not a typed array
    // either: it is the interface every typed array and `DataView` satisfies,
    // and it is how node declares every API that takes "some view". There is no
    // element to read, because the declaration does not name one -- see
    // `ManagedType::AnyView` for why that is a representation rather than
    // `View` of something.
    if provided(snapshot, ty) == Some("ArrayBufferView") {
        return Some(HirType::Managed(ManagedType::AnyView));
    }

    // A provided error class used as a **value**. `lib.d.ts` declares
    // `TypeError` as a variable of type `TypeErrorConstructor`, so this is the
    // type a name's own mention has and the type a slot holding one is declared
    // at -- and without it the *value* had the token type while every join,
    // parameter and declaration around it asked the checker and got an object
    // type with no layout. `NTS2006 an object type with no layout`, from a
    // program in which nothing was refused.
    //
    // The class itself is not this: `Error` the instance type is laid out by
    // `builtin::error_fields`, and only the constructor's is named this way.
    if let Some(name) = provided(snapshot, ty)
        && let Some(class) = name.strip_suffix("Constructor")
        && let Some(index) = crate::hir::builtin::error_index(class)
    {
        return Some(HirType::Managed(ManagedType::Object(
            crate::hir::constructor_token(index),
        )));
    }

    // The payload comes from the checker's type arguments rather than from the
    // return annotation, so an inferred `Promise<number>` works as well as a
    // written one. `Promise` with no argument is `Promise<void>`, which is what
    // an `async` function with no `return` has.
    if provided(snapshot, ty) == Some("Promise") {
        // No recorded argument is *not* `Promise<void>`. `Promise<void>` has
        // one argument and it is `void`; none at all means the frontend did not
        // get them -- it stops at the library boundary, and a file large enough
        // to exhaust its type budget stops earlier still.
        //
        // Defaulting to `void` was a guess that reads as an answer: every
        // payload became nothing, the settle discarded the value, and the
        // resumption read a slot that was never filled. Refusing says so.
        let argument = *snapshot
            .type_arguments
            .get(&ty)
            .and_then(|arguments| arguments.first())?;
        let payload = representation_within(snapshot, argument, path, subst)?;
        return Some(HirType::Managed(ManagedType::Promise(Box::new(payload))));
    }

    // `PromiseWithResolvers<T>` is *represented as* `Promise<T>`, because it
    // holds nothing else. The interface is `{ promise, resolve, reject }`, and
    // `resolve` and `reject` are derivable from the promise alone -- they are
    // the two settles the runtime already has, with the promise as the
    // receiver. So the capability object needs no layout, no allocation and no
    // closure: it *is* the promise, and `.promise` is the identity.
    //
    // This is what made the feature look hard. `new Promise(executor)` avoids
    // closures by inlining the executor, and reading `withResolvers` as the
    // same problem without that escape hatch says it needs real first-class
    // `resolve` values. It does not, as long as the three members are reached
    // through the object -- and 23 of the 25 sites in `runtime/node` keep the
    // object rather than destructuring it, in a local, a reassigned `let` or a
    // private field. Those are exactly the sites a closure would have been for.
    if provided(snapshot, ty) == Some("PromiseWithResolvers") {
        let argument = *snapshot
            .type_arguments
            .get(&ty)
            .and_then(|arguments| arguments.first())?;
        let payload = representation_within(snapshot, argument, path, subst)?;
        return Some(HirType::Managed(ManagedType::Promise(Box::new(payload))));
    }

    // `Map<K, V>` and `Set<T>`, recognized the same way and stopping at the
    // library boundary for the same reason -- decomposing one would pull in
    // `forEach`, `entries` and the rest of a type this compiler represents
    // itself. `ReadonlyMap` and `ReadonlySet` are the same table in a narrower
    // type: readonly is a type-level fact and does not change storage.
    //
    // Both arguments are required, and a missing one refuses rather than
    // defaulting, exactly as the promise above does. A `Map` whose key
    // representation was guessed would hash with the wrong function and find
    // nothing, which is the kind of wrong that looks like an empty table rather
    // than like a bug.
    if matches!(provided(snapshot, ty), Some("Map" | "ReadonlyMap")) {
        let arguments = snapshot.type_arguments.get(&ty)?;
        let key = table_key_within(snapshot, *arguments.first()?, path, subst)?;
        let value = representation_within(snapshot, *arguments.get(1)?, path, subst)?;
        return Some(HirType::Managed(ManagedType::Map(
            Box::new(key),
            Box::new(value),
        )));
    }
    if matches!(provided(snapshot, ty), Some("Set" | "ReadonlySet")) {
        let arguments = snapshot.type_arguments.get(&ty)?;
        let element = table_key_within(snapshot, *arguments.first()?, path, subst)?;
        return Some(HirType::Managed(ManagedType::Set(Box::new(element))));
    }

    // `Record<string, V>`, and every other spelling of a string-keyed table.
    //
    // `SemanticSnapshot::index_signatures` has been recorded since the frontend
    // was written and read by nothing, and its own documentation says what for:
    // "the single fact that decides representation -- a type with an index
    // signature cannot be a flat struct with fixed field offsets, because its
    // keys are not known at compile time. Missing it means emitting a struct
    // for something that needs a map, and every dynamic key silently misses."
    // That is what was happening: `table["alpha"] = n` on a `Record` refused as
    // "`alpha`, which `an anonymous type` does not declare", because the type
    // had become an object layout with no fields.
    //
    // A map is what it is, and the runtime already has one with a hash chosen
    // per key type.
    //
    // # Only when the signature is the whole of it
    //
    // A type with named members *and* an index signature is both things at
    // once -- `stream`'s `StreamState` has eight optional fields beside its
    // signature -- and a map would lose the fields' offsets while a struct
    // loses the dynamic keys. Refused rather than half-represented, which is
    // the same rule `cross` applies to a nested object at the boundary.
    if let Some(signatures) = snapshot.index_signatures.get(&ty)
        && let Some(signature) = signatures.first()
    {
        let named_members = match &snapshot.types.get(ty.0 as usize)?.kind {
            TypeKind::Object { properties } => properties.len(),
            // A named interface carrying a signature decomposes elsewhere; only
            // the anonymous forms reach here as a whole type.
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            TypeKind::NonPrimitive | TypeKind::UniqueSymbol => return None,
            _ => return None,
        };
        if named_members > 0 || signatures.len() > 1 {
            return None;
        }
        let key = representation_within(snapshot, signature.key, path, subst)?;
        // Only a string key. A numeric index signature is what an array *is*,
        // and giving one a hash table would be a slower array with worse
        // locality and no `length`.
        if !matches!(key, HirType::Managed(ManagedType::String)) {
            return None;
        }
        let value = representation_within(snapshot, signature.value, path, subst)?;
        return Some(HirType::Managed(ManagedType::Table(
            Box::new(key),
            Box::new(value),
        )));
    }

    None
}

/// The *source* representation of a C scalar brand, which is not its ABI.
///
/// The ABI stays whatever `Scalar::representation` says: `int64_t` is still
/// `i64` at the boundary and the emitted prototype does not move. What this
/// decides is the type a TypeScript value of the brand has in between, and for
/// the 64-bit spellings that has to be a bigint -- routing one through a double
/// is the loss the pairing exists to prevent, and it happens with a correct
/// `int64_t` prototype at both ends, where no check against a real header can
/// see it.
fn brand_representation(brand: crate::hir::native::Scalar) -> HirType {
    if brand.needs_exact_integer() {
        HirType::BigInt
    } else {
        HirType::NUMBER
    }
}

/// Whether the constant `value` is one of `kind`'s: a whole number in an
/// integer kind's range and not `-0`, exactly a `float` for a `float`, any
/// number for a `double`.
pub(super) fn constant_fits(value: f64, kind: crate::hir::native::Scalar) -> bool {
    match kind.integer_range() {
        #[allow(clippy::cast_precision_loss)]
        Some((lo, hi)) => {
            value.fract() == 0.0
                && value >= lo as f64
                && value <= hi as f64
                && !(value == 0.0 && value.is_sign_negative())
        }
        #[allow(clippy::cast_possible_truncation)]
        None if kind == crate::hir::native::Scalar::Float => {
            f64::from(value as f32).to_bits() == value.to_bits()
        }
        None => true,
    }
}

/// What [`decided_representation`] answers.
enum Decided {
    /// Provided as this, whatever the type's own kind says.
    As(HirType),
    /// **Recognised and deliberately unrepresentable** as a value -- a decision
    /// rather than a failure to find one, which is why it is not simply absent.
    Unrepresentable,
}

/// The representations decided before a type's own kind is read.
///
/// `None` means "not one of these, carry on"; the two `Decided` arms are the
/// ones a chain of early-outs could not tell apart without repeating itself.
/// A native pointer comes first, and that includes an Objective-C class a
/// binding declares (`@ntsClass`): its instances are the framework's objects,
/// counted by ARC, whatever TypeScript calls the class. A class the *program*
/// writes over one is one too, not a second representation on the same chain:
/// an Objective-C class of its own, registered as Swift registers one
/// (`Program::foreign_classes`).
fn decided_representation(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Decided> {
    if let Some(brand) = crate::hir::native::scalar(snapshot, ty) {
        // What the program holds is what TypeScript says it is: a `number`
        // over any brand is a number -- `AsNumber<c_size_t>`, Swift's `Int` --
        // and C's width is the boundary's to convert to. Only a `bigint` base
        // is a `bigint`, which `brand_representation` asks of the brand.
        if !crate::hir::native::over_bigint(snapshot, ty) {
            return Some(Decided::As(HirType::NUMBER));
        }
        return Some(Decided::As(brand_representation(brand)));
    }
    // A GLib boxed record, `Boxed<Tag, GetType, Size>`: a C struct the
    // program holds in a box of its own (`BOXED_RECORD`), whose pointer
    // crosses to C and whose box frees it. Before the handle it also is.
    if crate::hir::native::schema::boxed(snapshot, ty).is_some() {
        return Some(Decided::As(HirType::Managed(ManagedType::Object(TypeId(
            crate::hir::BOXED_RECORD,
        )))));
    }
    // `Erased<H>` is `void *` to C and an `H` to the program: what it holds
    // is the handle, counted, and C's spelling is the boundary's.
    if let Some(handle) = crate::hir::native::schema::erased_handle(snapshot, ty) {
        return Some(Decided::As(HirType::NativePointer(handle)));
    }
    if let Some(name) = crate::hir::native::pointer(snapshot, ty) {
        return Some(Decided::As(HirType::NativePointer(name)));
    }
    if crate::hir::native::is_layout(snapshot, ty) {
        return Some(Decided::Unrepresentable);
    }
    // **Provided, not decomposed**, for the reason `builtin.rs` exists: the
    // arms carry `done?: false`, and an optional property needs a presence bit,
    // which changes a layout rather than adding to it. One object stands for
    // the union, so `representation_within`'s union arm never sees two layouts
    // that differ -- and `TReturn`'s `any` gets no slot rather than a
    // representation it is not allowed to have.
    iterator_result_element(snapshot, ty)
        .map(|_| Decided::As(HirType::Managed(ManagedType::Object(ty))))
}

/// A union whose members all share one representation has that
/// representation. `0 | 1 | 2` is three literal types and one machine
/// type, and refusing it would reject the most useful thing TypeScript
/// can tell this compiler about a parameter.
///
/// `T | undefined` and `T | null` are what real TypeScript is made of,
/// and for a managed `T` they cost nothing: a reference already has a
/// value that is not an object, and the null pointer is it. So the
/// absent member is dropped and what is left has to agree.
///
/// *One* absent member. `T | null | undefined` has two, and a pointer
/// has one spare value to spend on them -- so representing it as one
/// made `null === undefined` answer `true`, which is a wrong answer
/// rather than a missing feature, and the profile writes that union
/// thirty-eight times. Two absent members go to an erased value, where
/// each has a tag of its own.
///
/// A number has no spare value. `number | undefined` needs a tag beside
/// it or a NaN payload inside it, and both change the representation of
/// every number that could reach the slot — so it is refused rather than
/// guessed at, as is any union whose members genuinely disagree.
fn union_representation(
    snapshot: &SemanticSnapshot,
    members: &[TypeId],
    path: &mut Vec<TypeId>,
    subst: &Representation<'_>,
) -> Option<HirType> {
    let mut shared: Option<HirType> = None;
    // Which absences are present, not how many members carry them:
    // `void` and `undefined` are the same value, so a union with both
    // still has one.
    let mut has_null = false;
    let mut has_undefined = false;
    let mut mixed = false;
    for member in members {
        match absence_of_member(snapshot, *member) {
            Some(Absence::Null) => {
                has_null = true;
                continue;
            }
            Some(Absence::Undefined) => {
                has_undefined = true;
                continue;
            }
            None => {}
        }
        // Each member still has to have a representation of its own:
        // erasing something is putting it in a payload, and a member
        // with no representation has nothing to put there.
        let member = representation_within(snapshot, *member, path, subst)?;
        match &shared {
            Some(existing) if *existing != member => mixed = true,
            _ => shared = Some(member),
        }
    }
    // Nothing left to be, which is not the same as nothing to represent.
    //
    // **`undefined | void` is one absence written twice**, and the loop
    // above already says so -- `absence_of_member` maps both to
    // `Absence::Undefined`, and the comment at the top of it says "`void`
    // and `undefined` are the same value, so a union with both still has
    // one". Then both members `continue`, nothing sets `shared`, and this
    // line answered `None` for a type whose representation is `Void`,
    // exactly as either member alone would have been.
    //
    // Where it comes from: `x?.m()` where `m` returns `void`. The optional
    // call is `undefined` when the receiver is nullish and `void` when it
    // ran, so the conditional it lowers to has that type and
    // `lower_branching_value` needs a representation for its merge
    // parameter. **597 sites over 51 distinct locations, 26 modules**, and
    // the shape is always the same: `this.#observer?.(size)`,
    // `controller?.abort()`, `capability?.resolve()`.
    //
    // `null | undefined` stays `None`, and the distinction is the whole
    // reason this is a condition rather than a fallthrough: those are *two*
    // absences, and with no payload beside them there is nothing to tell
    // the two apart with. One absence needs no tag; two need a value that
    // is not here.
    let Some(shared) = shared else {
        return (has_undefined && !has_null).then_some(HirType::Void);
    };
    // A native pointer with `undefined` beside it -- the chain
    // `NSGraphicsContext.current?.cgContext` is `CGContext | undefined` --
    // has one absence for its null to stand for, as `H | null` has; the
    // absence tests read it so (`absence_the_type_decides`).
    //
    // With `null` too -- `window.contentView?.superview`, a nullable
    // property down an optional chain -- its null stands for both, which is
    // Swift's one `nil`. Everything that asks *whether* it is absent (`==
    // null`, `??`, `?.`, a condition) is exact; only a strict comparison could
    // tell the two apart, and that is refused by name
    // (`absence_the_type_decides`).
    if matches!(shared, HirType::NativePointer(_)) {
        return (has_undefined && !mixed).then_some(shared);
    }
    // One representation, and at most one absence for the null pointer
    // to stand for. Two absences need two values and a pointer has one.
    let absences = usize::from(has_null) + usize::from(has_undefined);
    let absence_has_a_home = absences == 0 || (absences == 1 && shared.is_managed());
    if !mixed && absence_has_a_home {
        return Some(shared);
    }
    // Otherwise a tag says which -- two representations, or an absence
    // a scalar has no room for.
    //
    // This is the same value `unknown` lowers to, and deliberately: a
    // heterogeneous union is a *closed* erased value where `unknown` is
    // the open one, and the difference is what the checker knows rather
    // than what the machine holds. `Erase`, `TagOf`, `Unerase`, the
    // collector's erased slots and both specialization passes apply
    // unchanged -- so `number | undefined` costs what it costs and
    // nothing new had to be built for it.
    //
    // The tag domain being smaller than five is not exploited yet. It
    // is what would let `number | undefined` be a double and a bit
    // rather than a double and a word, and it is the same question
    // specialization asks.
    Some(HirType::Erased)
}

fn representation_of(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    path: &mut Vec<TypeId>,
    subst: &Representation<'_>,
) -> Option<HirType> {
    // A template this copy instantiates -- `Inner<T>` in `Outer<number>`'s
    // copy -- is the instantiation `instantiate::materialise` made for it,
    // `Inner<number>`, which has a record, a layout and copies of its own.
    // Before everything else, because the template's own record represents
    // as itself, and that is the one id in the program nothing lays out.
    if let Some(instance) = subst.instance_of(ty) {
        return Some(HirType::Managed(ManagedType::Object(instance)));
    }
    match decided_representation(snapshot, ty) {
        Some(Decided::As(representation)) => return Some(representation),
        Some(Decided::Unrepresentable) => return None,
        None => {}
    }
    if subst.cast_faces.contains(&ty) {
        debug_assert_eq!(
            representation_with(snapshot, ty, subst.substitution),
            Some(HirType::Managed(ManagedType::Object(ty))),
            "a cast face must retain an ordinary object representation underneath its erased view"
        );
        return Some(HirType::Erased);
    }
    let record = snapshot.types.get(ty.0 as usize)?;
    Some(match &record.kind {
        // **`any` and `unknown` share one representation, and separating
        // `Evolving` is what makes that safe.**
        //
        // This arm read `Unknown` alone, and `HirType::Erased`'s doc said `any`
        // "deliberately does *not* map here ... giving it a representation would
        // accept the escape hatch that rule exists to close". The fear is real and
        // the conclusion was backwards. `any`'s danger is that TypeScript
        // **permits operations it cannot justify** -- a read, a call, an index,
        // arithmetic, all without narrowing -- and an erased value meets the
        // refusal `unknown` already meets for every one of them: the same code,
        // the same place, the same sentence. `docs/records/notebooks/any-unknown.md`'s requirement,
        // "must legalize each one from independent representation evidence before
        // lowering it", is satisfied **by construction** rather than by a second
        // analysis. The hatch would be open only if `any` got a representation
        // *and* were readable without one.
        //
        // What made the first attempt cost **243 recorded test262 passes** was not
        // this arm but the absence of [`TypeKind::Evolving`]: `var x;` and `const
        // xs = []` are `any` meaning "not yet", every `evolved_type` fallback in
        // lowering was reached *because `any` had no representation*, and giving
        // one to all three intrinsics at once switched them off in a single step.
        // `Evolving` keeps that path, and falls through to the `None` below.
        //
        // The floor and not the answer: `erasure.rs` already measures which sites
        // only carry or test their value and which examine one, and specialising an
        // examined parameter from its call sites is the next slice. What this does
        // is make a program with an `any` in it compile at all, which nothing did:
        // `new Set()` in a JavaScript file is `Set<any>`, and `Set<unknown>` has
        // compiled all along.
        TypeKind::Any | TypeKind::Unknown | TypeKind::NonPrimitive => HirType::Erased,
        TypeKind::Void | TypeKind::Undefined => HirType::Void,
        TypeKind::Never => HirType::Never,
        // A literal shares its widened type's representation. The literal *value*
        // is still known and can become an immediate; what it cannot have is a
        // representation narrower than the type it widens to.
        TypeKind::Boolean | TypeKind::Literal(LiteralValue::Boolean(_)) => HirType::Bool,
        TypeKind::Number | TypeKind::Literal(LiteralValue::Number(_)) => HirType::NUMBER,
        // `bigint` is an exact integer, and TypeScript keeps it apart from
        // `number` for us: mixing the two is a type error the checker has
        // already rejected, so nothing here has to guard the arithmetic against
        // a double turning up in it.
        //
        // 128 bits, which is not what the specification says. See
        // `lower_bigint`, where the boundary is drawn and made visible.
        TypeKind::BigInt | TypeKind::Literal(LiteralValue::BigInt(_)) => HirType::BigInt,
        // A template literal type (`${string}-${string}`, which lib.dom's
        // `crypto.randomUUID()` answers) constrains which strings, never that
        // it is one: every value of it is a string.
        TypeKind::String
        | TypeKind::Literal(LiteralValue::String(_))
        | TypeKind::TemplateLiteral { .. } => HirType::Managed(ManagedType::String),
        // Every symbol has one representation, including a `unique symbol`.
        // The uniqueness is a *type-level* fact -- it is what lets the checker
        // tell `kRefed` from `kOther` when both are `unique symbol` -- and it
        // says nothing about the machine value, which is a pointer to an
        // interned cell either way.
        //
        // A `unique symbol` used as a **member name** never reaches here: the
        // lowering resolves it to a field name at compile time, which is what
        // makes `[kRefed]` an ordinary field rather than a map lookup. This is
        // for a symbol used as a *value*.
        TypeKind::Symbol | TypeKind::UniqueSymbol => HirType::Managed(ManagedType::Symbol),
        TypeKind::Array(element) => {
            let element = slot_for(snapshot, *element, path, subst)?;
            HirType::Managed(ManagedType::Array(Box::new(element)))
        }
        // A function value is an object with one method, which is why it shares
        // this arm rather than getting one. That is not a trick to make it fit:
        // a closure *is* captured state plus code, which is what an object is,
        // and saying so means it gets the object machinery -- a base-first
        // layout, escape analysis that keeps it in the frame when it does not
        // escape, reference counting, and dispatch -- rather than a second
        // mechanism that would need all four again.
        //
        // The layout for the function type itself has no fields. What varies
        // between two closures of one type is what they captured, and that
        // belongs to the closure's own class, which has this one as its base.
        // `Promise<T>`, recognized by name the way the rest of the provided
        // surface is. The same caveat applies as for `Math`: a program that
        _ if let Some(provided) = provided_representation(snapshot, ty, path, subst) => provided,
        // A class that extends a typed array and adds no storage of its own
        // *is* that typed array. `Buffer extends Uint8Array` is the whole of
        // this in the node profile -- it declares methods and not one field, so
        // an instance is an `NtsArray` of bytes and nothing else.
        //
        // Giving it an object layout instead is what the refusal above
        // `representable_bases` describes: `class Bytes extends Uint8Array {}`
        // came out as five `int32_t` and no bytes, and `b.length` read the
        // fifth field of a struct nothing allocates.
        //
        // A subclass that declares a field is a different type and stays
        // refused. An array's items are inline and variable-length, so there is
        // nowhere to put one -- that is a real layout question and not this
        // one.
        // An **anonymous empty object type**, which is `{}` and is not a struct.
        //
        // In TypeScript `{}` is every value except `null` and `undefined`, so a
        // number is assignable to it. Representing it as an object layout made
        // `const x: {} = n` fail with `a value of type Float { bits: 64 } where
        // Managed(Object(TypeId(4))) is wanted` -- the checker was right and the
        // representation disagreed with it.
        //
        // It is reached by inference far more often than by annotation.
        // `value ?? byDefault` with `value: unknown` has type `{}` or a union
        // containing it, and that one expression -- `internal/validators.ts`'s
        // `parseFileMode` -- is a root the Node lane measured as blocking 21 of
        // 22 modules. `fs.openSync` is behind it.
        //
        // **Anonymous only**, and the restriction is not fussiness. A declared
        // empty type is the same TypeScript type and a different intent: `class
        // Bare {}` is instantiated with `new`, asked about with `instanceof`,
        // and given an identity by having an address. Erasing it would take all
        // three. `interface Empty {}` is left with it rather than split from it,
        // because nothing in this tree needs the distinction and guessing which
        // side a declared empty type belongs on is how a representation change
        // becomes a behaviour change.
        //
        // Inherited members are flattened into `properties` before this sees
        // them -- checked, not assumed: `interface Derived extends Base {}`
        // carries `Base`'s field here and so is not empty.
        TypeKind::Object { properties }
            if properties.is_empty() && named(snapshot, ty).is_none() =>
        {
            HirType::Erased
        }
        TypeKind::Object { properties } => match inherited_typed_array(snapshot, ty) {
            Some(element) if !declares_storage(properties) => {
                HirType::Managed(ManagedType::View(Box::new(element)))
            }
            _ => HirType::Managed(ManagedType::Object(ty)),
        },
        TypeKind::Function(_) => HirType::Managed(ManagedType::Object(ty)),

        // A tuple whose elements share a representation *is* an array of that
        // representation. `[number, number]` is two doubles in a row, which is
        // what `number[]` is -- what the tuple adds is a length, and a length is
        // not part of a representation.
        //
        // A heterogeneous tuple is a struct with positional fields, which is a
        // different thing: it needs a layout rather than an element type, and
        // it is refused rather than approximated by the widest member.
        TypeKind::Tuple(tuple) => tuple_representation(snapshot, ty, &tuple.elements, path, subst)?,

        TypeKind::Union(members) => union_representation(snapshot, members, path, subst)?,

        // A type parameter has no representation of its own -- that is what
        // makes it one. It has the representation of whatever this instantiation
        // put there, and outside an instantiation there is nothing to say.
        // The polymorphic `this`, which TypeScript models as a type parameter
        // named after its class and constrained to it. `ref(): this` is the
        // fluent-interface shape and it is everywhere in a stream API: 62
        // refusals across 17 classes in the node profile, `Socket`, `Server`,
        // `Readable` and `Buffer` among them.
        //
        // Its representation is the receiver's, exactly. `this` in a method of
        // `Socket` is a `Socket` pointer, and in a subclass it is a pointer to
        // the subclass -- which under base-first layout is the same pointer and
        // is the rule `verify::compatible` already applies to a return, a store
        // and a call argument. So this is not an approximation of the
        // polymorphism; it is what the polymorphism costs at run time, which is
        // nothing.
        //
        // A genuine type parameter still requires a substitution. Its name
        // and constraint do not make it a polymorphic receiver parameter.
        TypeKind::TypeParameter { .. } => {
            if let Some(constraint) = snapshot.polymorphic_this_constraint(ty) {
                representation_within(snapshot, constraint, path, subst)?
            } else {
                subst.get(&ty)?.clone()
            }
        }

        // The named types this compiler provides rather than reads. Neither
        // `Error` nor `Uint8Array` is ever decomposed -- see `crate::hir::builtin`
        // for why the first cannot be -- so both arrive structured and would
        // otherwise have no representation at all.
        TypeKind::Structured => {
            let name = provided(snapshot, ty)?;
            if let Some(element) = crate::hir::builtin::typed_array_element(name) {
                // A view rather than an array. The specification says so --
                // `new Uint8Array(8)` allocates a buffer and returns a window
                // onto it -- and until now this compiler said otherwise, which
                // is the precision loss §16 records: `number[]` and
                // `Float64Array` were one representation, so nothing could
                // tell them apart at runtime.
                HirType::Managed(ManagedType::View(Box::new(element)))
            } else if crate::hir::builtin::is_error(name) {
                HirType::Managed(ManagedType::Object(ty))
            } else {
                return None;
            }
        }

        // **An optional brand never exists at run time, so this value is
        // exactly a string**, and `Managed(String)` has no field layout to
        // fabricate: not the case the comment below forbids. The shape is a
        // `string` beside a brand only a C boundary reads (`Utf16String`,
        // `string & { readonly __c_utf16?: true }`), and nothing else --
        // `string & { real: number }` is not it. Keyed on the recogniser the
        // call boundary uses, so the two cannot disagree about which types
        // these are.
        TypeKind::Intersection(_) if crate::hir::native::is_branded_string(snapshot, ty) => {
            HirType::Managed(ManagedType::String)
        }
        // A `GObject` property's field (`Property<T>` in `c:types`): `T` beside
        // a brand that is optional and never exists, so exactly a `T`. The
        // brand is read where the class registers, not here.
        TypeKind::Intersection(parts) if property_branded(snapshot, parts).is_some() => {
            let rest = property_branded(snapshot, parts)?;
            representation_within(snapshot, rest, path, subst)?
        }
        // An array of objects C hands a callback (`CHandles`, `Counted`): the
        // array beside markers that are optional and never exist, so exactly
        // the array. The markers are read where the bridge is made.
        TypeKind::Intersection(_)
            if crate::hir::native::lent_handles_value(snapshot, ty).is_some() =>
        {
            let array = crate::hir::native::lent_handles_value(snapshot, ty)?;
            representation_within(snapshot, array, path, subst)?
        }
        // A closure marker (`Closure<F>`, `c:types`): `F` beside a brand that is
        // optional and never exists, so exactly the function. Parameters never
        // asked, because `closure_slots` takes them apart at the boundary; a
        // closure a foreign function *returns* is a value the program holds.
        TypeKind::Intersection(_)
            if crate::hir::native::closure_function(snapshot, ty).is_some() =>
        {
            let function = crate::hir::native::closure_function(snapshot, ty)?;
            representation_within(snapshot, function, path, subst)?
        }
        // And one half of a `CBool` (`true & brand`): exactly a boolean, for
        // the same reason -- its brand is optional and never exists. A whole
        // `CBool` is the union of both, which the union arm above builds from
        // this.
        TypeKind::Intersection(_) if crate::hir::native::is_branded_bool(snapshot, ty) => {
            HirType::Bool
        }

        // `TypeKind::Intersection` falls here, and **that is a decision** rather
        // than an omission.
        //
        // It is tempting and it is wrong, measured on 2026-09-12. The rule that
        // suggests itself -- take whichever member has a concrete
        // representation, since `object` and `unknown` constrain nothing --
        // cleared 37 of 39 intersection refusals in `util` and `stream`, which
        // read exactly like progress.
        //
        // It answers incorrectly. Every one of those sites is the same shape,
        // and it is the shape `in` produces:
        //
        // ```ts
        // if (typeof v === "object" && "href" in v && typeof v.href === "string")
        // ```
        //
        // `"href" in v` narrows to `object & { href: unknown }`, and the
        // concrete member is a **synthetic record the checker made from the key
        // name**. Its layout puts `href` at index zero. The value is any object
        // that has an `href` at all, at whatever offset its own class put it --
        // so the read is at a fabricated offset. A class with two fields ahead
        // of `href` disagreed with node on **29 of 29 cases**, having refused
        // honestly a moment earlier.
        //
        // The general statement is one this compiler has already paid for
        // elsewhere: **`in` answers whether a property exists, not where it
        // is.** That is why presence needed a bit in the header rather than a
        // layout lookup, and it is the same sentence one level up.
        //
        // So a correct version needs the narrowing to establish a *layout*, not
        // a property. `v instanceof C` does that and already lowers. A type
        // predicate returning `v is C` for a declared class does too. What
        // cannot is a structural refinement over a receiver whose class is
        // unknown, which is what the corpus's 37 are.
        //
        // Left with no arm would read as an oversight; this is the arm.
        //
        // `Evolving` has no representation yet. Answering `None` retains the
        // inference path through `evolved_type`; ordinary `any` and `unknown`
        // take `Erased` above. Representation evidence and operation legality
        // remain separate questions.
        _ => return None,
    })
}
