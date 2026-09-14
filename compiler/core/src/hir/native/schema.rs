//! Decode only authored native storage. An unsupported layout remains refused;
//! it must not fall back to managed-object layout or guessed member offsets.
use nts_semantic_schema::{LiteralValue, MemberKind, PropertyRecord, SemanticSnapshot, TypeId, TypeKind};
use super::{Field, Pointee, Struct, scalar};

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

/// A Struct describes native storage; constructing its phantom marker as a
/// managed JS object is not constructing that storage.
#[must_use]
pub fn is_layout(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    marker(snapshot, ty, "___c_struct").is_some()
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
    if let Some(tag) = marker(snapshot, ty, "___c_opaque") {
        return Some(Pointee::Opaque(text(snapshot, tag)?.to_owned()));
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
    if let Some(layout) = structure(snapshot, element, visiting) { return Some(qualify(Pointee::Struct(layout.into()))); }
    pointer_within(snapshot, element, visiting).map(|p| qualify(Pointee::Pointer(Box::new(p))))
}

fn structure(snapshot: &SemanticSnapshot, ty: TypeId, visiting: &mut Vec<TypeId>) -> Option<Struct> {
    let shape = marker(snapshot, ty, "___c_struct")?;
    let tag = text(snapshot, marker(snapshot, ty, "___c_tag")?)?;
    let TypeKind::Object { properties } = &snapshot.types.get(shape.0 as usize)?.kind else { return None; };
    if properties.is_empty() { return None; }
    let declarations = properties.iter().map(|p| p.declaration).collect::<Option<Vec<_>>>()?;
    let parent = snapshot.nodes[declarations[0].0 as usize].parent?;
    if declarations.iter().any(|id| snapshot.nodes[id.0 as usize].parent != Some(parent)) { return None; }
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
        } else if let Some(array @ Pointee::Array { .. }) =
            pointer_body(snapshot, property.ty, visiting)
        {
            array
        } else if !visiting.contains(&property.ty)
            && let Some(inner) = {
                visiting.push(property.ty);
                let inner = structure(snapshot, property.ty, visiting);
                visiting.pop();
                inner
            }
        {
            Pointee::Struct(inner.into())
        } else {
            Pointee::Pointer(Box::new(pointer_within(snapshot, property.ty, visiting)?))
        };
        let name = property.name.strip_prefix("___").map_or_else(|| property.name.clone(), |rest| format!("__{rest}"));
        fields.push(Field { name, ty });
    }
    let foreign = !tag.is_empty();
    let name = if foreign { tag.to_owned() } else { format!("NtsNative_Type{}", shape.0) };
    Some(Struct { name, fields, foreign, from_header: foreign && declares_a_header(snapshot, parent) })
}

/// Whether the scope that declared this struct named any header.
///
/// Walks out from the type literal to the enclosing `declare module` or source
/// file, which are the two scopes a header tag can sit on. It answers *whether*
/// and not *which*: a module may name several headers, all of them are included
/// together, and which one carries a given tag is the C compiler's to know --
/// claiming to know it here would be a second derivation of a fact the
/// preprocessor already holds, and the two could disagree.
fn declares_a_header(snapshot: &SemanticSnapshot, from: nts_semantic_schema::NodeId) -> bool {
    let mut at = Some(from);
    while let Some(id) = at {
        let Some(node) = snapshot.nodes.get(id.0 as usize) else { return false };
        if node.native.as_ref().is_some_and(|native| {
            native.headers.as_ref().is_some_and(|headers| !headers.is_empty())
        }) {
            return true;
        }
        at = node.parent;
    }
    false
}

/// Storage named by a native type argument; pointer types occupy one word.
#[must_use]
pub fn storage(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Pointee> {
    if let Some(scalar) = scalar(snapshot, ty) { return Some(Pointee::Scalar(scalar)); }
    if let Some(layout) = structure(snapshot, ty, &mut Vec::new()) { return Some(Pointee::Struct(layout.into())); }
    pointer(snapshot, ty).map(|p| Pointee::Pointer(Box::new(p)))
}
