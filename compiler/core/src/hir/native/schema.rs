//! Decode only authored native storage. An unsupported layout remains refused;
//! it must not fall back to managed-object layout or guessed member offsets.
use nts_semantic_schema::{LiteralValue, MemberKind, PropertyRecord, SemanticSnapshot, TypeId, TypeKind};
use super::{Field, Pointee, Record, RecordKind, scalar};

fn property<'a>(snapshot: &'a SemanticSnapshot, ty: TypeId, name: &str) -> Option<&'a PropertyRecord> {
    match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Object { properties } => properties.iter().find(|p| p.name == name),
        TypeKind::Intersection(parts) => parts.iter().find_map(|part| property(snapshot, *part, name)),
        _ => None,
    }
}

fn marker(snapshot: &SemanticSnapshot, ty: TypeId, name: &str) -> Option<TypeId> {
    let p = property(snapshot, ty, name)?;
    (p.readonly && !p.optional && p.kind == MemberKind::Field).then_some(p.ty)
}

fn text(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<&str> {
    match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Literal(LiteralValue::String(name)) => Some(name),
        _ => None,
    }
}

/// A nullable pointer has the same address representation; undefined and mixed
/// pointer unions do not have that contract. Recursive pointees require a
/// separately named incomplete type and are not expanded speculatively here.
#[must_use]
pub fn pointer(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Pointee> {
    pointer_within(snapshot, ty, &mut Vec::new())
}

/// An opaque pointee: `Opaque<Tag>`, or `Class<Tag, Parent>` with its chain.
fn handle(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Pointee> {
    if let Some(tag) = marker(snapshot, ty, "___c_opaque") {
        return Some(Pointee::Opaque(text(snapshot, tag)?.into()));
    }
    // `Class<Tag, Parent>` -- an opaque pointee with a hierarchy. The chain is
    // a tuple of string literals, root first, ending in a `...string[]` rest,
    // which the snapshot flattens to one trailing `string` element: the tags
    // are the literal prefix and the last of them is this handle's own.
    let chain = marker(snapshot, ty, "___c_chain")?;
    let TypeKind::Tuple(elements) = &snapshot.types.get(chain.0 as usize)?.kind else {
        return None;
    };
    let mut tags: Vec<String> =
        elements.iter().map_while(|element| text(snapshot, *element).map(str::to_owned)).collect();
    let tag = tags.pop()?;
    // `ObjcClass<Tag, Parent>` is `Class<Tag, Parent>` with this brand beside
    // it: the same chain, an object the program counts.
    let family = if marker(snapshot, ty, "___objc").is_some() {
        super::Family::Objc
    } else {
        super::Family::C
    };
    Some(Pointee::Opaque(super::Handle { tag, ancestors: tags, family }))
}

/// A `Struct<...>` describes native storage; constructing its phantom marker as a
/// managed JS object is not constructing that storage.
#[must_use]
pub fn is_layout(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    marker(snapshot, ty, "___c_struct").is_some() || marker(snapshot, ty, "___c_union").is_some()
}

fn pointer_within(snapshot: &SemanticSnapshot, ty: TypeId, visiting: &mut Vec<TypeId>) -> Option<Pointee> {
    if visiting.contains(&ty) { return None; }
    visiting.push(ty);
    let answer = pointer_body(snapshot, ty, visiting);
    visiting.pop();
    answer
}

fn pointer_body(snapshot: &SemanticSnapshot, ty: TypeId, visiting: &mut Vec<TypeId>) -> Option<Pointee> {
    if let TypeKind::Union(parts) = &snapshot.types.get(ty.0 as usize)?.kind {
        let [a, b] = parts.as_slice() else { return None; };
        let is_null = |id: TypeId| matches!(snapshot.types[id.0 as usize].kind, TypeKind::Null);
        let payload = if is_null(*a) { *b } else if is_null(*b) { *a } else { return None; };
        return pointer_within(snapshot, payload, visiting);
    }
    if let Some(handle) = handle(snapshot, ty) {
        // `Const<H>` -- the same handle, read-only through this view: C's
        // `const GtkBitset *`. The marker is optional, so a plain handle is
        // assignable to it, which is C's own qualification conversion.
        let constant = property(snapshot, ty, "___c_const").is_some_and(|p| p.optional && p.readonly);
        // `Erased<H>` -- the same handle, spelled `void *` where C erases it.
        let erased = property(snapshot, ty, "___c_erased").is_some_and(|p| p.optional && p.readonly);
        if erased {
            return Some(Pointee::Void);
        }
        return Some(if constant { Pointee::Const(Box::new(handle)) } else { handle });
    }
    // `Flexible<T>` -- `T name[]`, storage with no extent. Read before the
    // pointer cases for the reason the others are: it is the thing a pointer to
    // it would point at, not a pointer.
    if let Some(element) = marker(snapshot, ty, "___c_flexible") {
        return Some(super::Pointee::Flexible(Box::new(storage(snapshot, element)?)));
    }
    // `Bits<T, N>` -- N bits of a T-sized unit. Read before the pointer cases
    // for the reason `CArray` is: it is not a pointer, and not a thing anything
    // may point at.
    //
    // The marker is spelled with **three** leading underscores here and two in
    // `libc.d.ts`. That is not a typo on either side: TypeScript escapes a
    // property name beginning with `__` by prefixing another one, so `__c_bits`
    // is `___c_bits` by the time it reaches a snapshot. Every native marker in
    // this file has the same shape, and getting it wrong is silent -- the
    // lookup simply never matches and the type falls through to "not native".
    if let Some(unit) = marker(snapshot, ty, "___c_bits")
        && let Some(width) = marker(snapshot, ty, "___c_width")
    {
        let TypeKind::Literal(LiteralValue::Number(width)) =
            &snapshot.types.get(width.0 as usize)?.kind
        else {
            return None;
        };
        let unit = scalar(snapshot, unit)?;
        // A width, so the same rule the length follows: a fractional or
        // out-of-range literal is not a small width, it is not a width. And a
        // bit-field may not be wider than its unit -- C says so, and a wider
        // one would make the recomputed layout disagree with the header's in a
        // way that reads as a packing bug rather than as a bad declaration.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::float_cmp)]
        let width = {
            let written = *width;
            if !(1.0..=64.0).contains(&written) {
                return None;
            }
            let narrowed = written as u32;
            let unit_bits = crate::hir::layout::shape_of(&unit.representation())?
                .size
                .checked_mul(8)?;
            if f64::from(narrowed) != written || narrowed > unit_bits {
                return None;
            }
            narrowed
        };
        return Some(super::Pointee::Bits { unit, width });
    }
    // `CArray<T, N>` -- storage of N elements inline. Read before the pointer
    // cases because it is not a pointer: it is the thing a pointer to it would
    // point at, and the length is part of the layout rather than of a value.
    if let Some(element) = marker(snapshot, ty, "___c_array")
        && let Some(count) = marker(snapshot, ty, "___c_length")
    {
        let TypeKind::Literal(LiteralValue::Number(length)) = &snapshot.types.get(count.0 as usize)?.kind
        else {
            return None;
        };
        // A count, so a fractional or out-of-range literal is not a small count
        // -- it is not a count. `CArray<c_char, 64.5>` truncating to 64 would
        // produce a struct 65 bytes short of the one the header defines, and
        // the only thing that would have noticed is the witness.
        //
        // `float_cmp` is allowed because exact equality is the question: the
        // cast is accepted exactly when it round-trips, which is what makes
        // the truncation the other two lints warn about unreachable.
        #[allow(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::float_cmp
        )]
        let length = {
            let count = *length;
            if !(count >= 1.0 && count <= f64::from(u32::MAX)) {
                return None;
            }
            let narrowed = count as u32;
            if f64::from(narrowed) != count {
                return None;
            }
            narrowed
        };
        let inner = if let Some(scalar) = scalar(snapshot, element) {
            Pointee::Scalar(scalar)
        } else {
            pointer_within(snapshot, element, visiting)?
        };
        return Some(Pointee::Array { element: Box::new(inner), length });
    }
    let element = marker(snapshot, ty, "___c_pointer")?;
    // `ConstPtr<T>` is `Ptr<T>` without the writable marker. The marker sits on
    // the *mutable* type on purpose: the const one is then the smaller of the
    // two, so a `Ptr<T>` satisfies a `ConstPtr<T>` and not the reverse, which is
    // exactly the one direction C converts. A marker on the const type would
    // invert that and make every call site convert explicitly.
    let writable = marker(snapshot, ty, "___c_writable").is_some();
    let qualify = |pointee: Pointee| {
        if writable { pointee } else { Pointee::Const(Box::new(pointee)) }
    };
    // `Ptr<unknown>` is C's `void *`. Only `unknown`: `Ptr<any>` stays refused,
    // because `any` is what a program ends up with by accident and `unknown` is
    // what someone writes on purpose. `TypeKind::Unsupported` is a third thing
    // again -- the checker telling us it rendered something we do not model --
    // and reading that as `void *` would turn every unmodelled type into a
    // pointer nobody declared.
    if matches!(snapshot.types.get(element.0 as usize)?.kind, TypeKind::Unknown) {
        return Some(qualify(Pointee::Void));
    }
    if let Some(scalar) = scalar(snapshot, element) { return Some(qualify(Pointee::Scalar(scalar))); }
    if let Some(layout) = structure(snapshot, element, visiting, false) { return Some(qualify(Pointee::Record(layout.into()))); }
    pointer_within(snapshot, element, visiting).map(|p| qualify(Pointee::Pointer(Box::new(p))))
}

/// `within_header` is whether the record *holding* this one is defined by a
/// header, which is what makes an untagged member type inferable rather than
/// something a binding has to mark.
///
/// A header-defined record's members are the header's, so a member whose type
/// carries no tag cannot be a layout this program invented -- the header
/// defines the struct, and therefore its members' types. It must be the
/// header's own untagged one. That inference is why the surface has no marker
/// for it: the author would have been restating what the enclosing tag already
/// says.
fn structure(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    visiting: &mut Vec<TypeId>,
    within_header: bool,
) -> Option<Record> {
    // `Struct<F, Tag>` and `Union<F, Tag>` differ in one marker and nothing
    // else: the same member list, read the same way, laid out differently.
    let (shape, kind) = match marker(snapshot, ty, "___c_struct") {
        Some(shape) => (shape, RecordKind::Struct),
        None => (marker(snapshot, ty, "___c_union")?, RecordKind::Union),
    };
    // `Packed<T>` intersects a marker in, so this reads through to the `T`.
    let packed = marker(snapshot, ty, "___c_packed").is_some();
    let tag = text(snapshot, marker(snapshot, ty, "___c_tag")?)?;
    let TypeKind::Object { properties } = &snapshot.types.get(shape.0 as usize)?.kind else { return None; };
    if properties.is_empty() { return None; }
    let declarations = properties.iter().map(|p| p.declaration).collect::<Option<Vec<_>>>()?;
    let parent = snapshot.nodes[declarations[0].0 as usize].parent?;
    if declarations.iter().any(|id| snapshot.nodes[id.0 as usize].parent != Some(parent)) { return None; }
    // Decided before the members are read, because a member's own answer
    // depends on it: a record this header defines makes its untagged members
    // the header's too, however deep.
    let foreign = !tag.is_empty();
    let from_header = foreign.then(|| declaring_module(snapshot, parent)).flatten();
    // `Typedef<...>` says the name is a typedef rather than a tag, which
    // changes only how C spells the type. Read before the tagged case, which it
    // is otherwise identical to.
    let naming = if foreign && marker(snapshot, ty, "___c_typedef").is_some() {
        super::Naming::Typedef { from_header }
    } else if foreign {
        super::Naming::Tagged { from_header }
    } else if within_header {
        super::Naming::Untagged
    } else {
        super::Naming::Invented
    };
    let members_are_the_header_s = from_header.is_some() || within_header;
    let mut ordered: Vec<_> = properties.iter().collect();
    ordered.sort_by_key(|p| snapshot.nodes[p.declaration.map_or(0, |id| id.0) as usize].origin.location.span.start);
    let mut fields = Vec::new();
    for property in ordered {
        // Inheritance, optional fields, methods and synthesized members do not
        // define a C declaration order. Refuse until their contract is explicit.
        if property.optional || property.kind != MemberKind::Field || property.declaration.is_none() { return None; }
        // A struct-typed member is stored *inline*, the way C stores it: the
        // nested layout's bytes sit in this one, and `native_shape` already
        // knew how to size and align that. It is tried before the pointer case
        // because a `Struct<...>` is not a pointer and would otherwise be
        // refused as one.
        //
        // `visiting` is what stops a type that contains itself by value. C has
        // no such type -- a struct may contain a pointer to itself, never a
        // copy -- so the guard refuses rather than recursing, and the pointer
        // form remains available and is unaffected.
        // A member's own type, which for an array is the array and not a
        // pointer to one: `char name[65]` occupies 65 bytes here, and the
        // pointer path below would have made it 8. Tried before that path for
        // the same reason the struct case is.
        let ty = if let Some(scalar) = scalar(snapshot, property.ty) {
            Pointee::Scalar(scalar)
        } else if let Some(
            inline @ (Pointee::Array { .. } | Pointee::Bits { .. } | Pointee::Flexible(_)),
        ) =
            pointer_body(snapshot, property.ty, visiting)
        {
            // Two member types that are neither a scalar nor a pointer, and
            // both resolved by the helper that reads the surface's markers. A
            // bit-field is here rather than beside `scalar` above because
            // `Bits<c_uint, 4>` is an object type carrying markers, not a
            // branded number -- `scalar` would not recognise it and the
            // pointer path below would have made it an address, which is the
            // one thing a bit-field does not have.
            inline
        } else if !visiting.contains(&property.ty)
            && let Some(inner) = {
                visiting.push(property.ty);
                let inner = structure(snapshot, property.ty, visiting, members_are_the_header_s);
                visiting.pop();
                inner
            }
        {
            Pointee::Record(inner.into())
        } else if let Some(signature) = super::fn_pointer(snapshot, property.ty) {
            // A member written as an ordinary TypeScript function type, which
            // at a C boundary can mean one thing -- `struct sigaction` and
            // every registration table in C is this shape. It is read by the
            // same function a *parameter* goes through, because a
            // function-typed member is a function pointer for the same reason
            // a function-typed parameter is.
            Pointee::Pointer(Box::new(Pointee::FnPointer(signature)))
        } else {
            Pointee::Pointer(Box::new(pointer_within(snapshot, property.ty, visiting)?))
        };
        let name = property.name.strip_prefix("___").map_or_else(|| property.name.clone(), |rest| format!("__{rest}"));
        fields.push(Field { name, ty });
    }
    let name = if foreign { tag.to_owned() } else { format!("NtsNative_Type{}", shape.0) };
    // An anonymous record is the header's, so nothing about it is this
    // program's to define -- but it has no tag either, so `foreign` cannot
    // carry that. The two facts are separate and both are recorded.
    Some(Record {
        name,
        fields,
        kind,
        naming,
        packed,
    })
}

/// Whether the scope that declared this struct named any header.
///
/// Walks out from the type literal to the enclosing `declare module` or source
/// file, which are the two scopes a header tag can sit on. It answers *whether*
/// and not *which*: a module may name several headers, all of them are included
/// together, and which one carries a given tag is the C compiler's to know --
/// claiming to know it here would be a second derivation of a fact the
/// preprocessor already holds, and the two could disagree.
/// The enclosing declaration whose `@ntsHeader` covers `from`, if any.
///
/// **Which one, not whether.** It answered `bool` and the identity it had just
/// found was discarded, so a program had no way to say which headers it needs
/// and carried every one in the snapshot -- `native-stat` compiled with seven
/// and used one.
pub(crate) fn declaring_module(
    snapshot: &SemanticSnapshot,
    from: nts_semantic_schema::NodeId,
) -> Option<nts_semantic_schema::NodeId> {
    let mut at = Some(from);
    while let Some(id) = at {
        let node = snapshot.nodes.get(id.0 as usize)?;
        if node.native.as_ref().is_some_and(|native| {
            native.headers.as_ref().is_some_and(|headers| !headers.is_empty())
        }) {
            return Some(id);
        }
        at = node.parent;
    }
    None
}

/// Storage named by a native type argument; pointer types occupy one word.
#[must_use]
pub fn storage(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Pointee> {
    if let Some(scalar) = scalar(snapshot, ty) { return Some(Pointee::Scalar(scalar)); }
    if let Some(layout) = structure(snapshot, ty, &mut Vec::new(), false) { return Some(Pointee::Record(layout.into())); }
    pointer(snapshot, ty).map(|p| Pointee::Pointer(Box::new(p)))
}
