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
    let element = marker(snapshot, ty, "___c_pointer")?;
    if let Some(scalar) = scalar(snapshot, element) { return Some(Pointee::Scalar(scalar)); }
    if let Some(layout) = structure(snapshot, element, visiting) { return Some(Pointee::Struct(layout.into())); }
    pointer_within(snapshot, element, visiting).map(|p| Pointee::Pointer(Box::new(p)))
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
        let ty = if let Some(scalar) = scalar(snapshot, property.ty) {
            Pointee::Scalar(scalar)
        } else {
            Pointee::Pointer(Box::new(pointer_within(snapshot, property.ty, visiting)?))
        };
        let name = property.name.strip_prefix("___").map_or_else(|| property.name.clone(), |rest| format!("__{rest}"));
        fields.push(Field { name, ty });
    }
    Some(Struct { name: if tag.is_empty() { format!("NtsNative_Type{}", shape.0) } else { tag.to_owned() }, fields })
}

/// Storage named by a native type argument; pointer types occupy one word.
#[must_use]
pub fn storage(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<Pointee> {
    if let Some(scalar) = scalar(snapshot, ty) { return Some(Pointee::Scalar(scalar)); }
    if let Some(layout) = structure(snapshot, ty, &mut Vec::new()) { return Some(Pointee::Struct(layout.into())); }
    pointer(snapshot, ty).map(|p| Pointee::Pointer(Box::new(p)))
}
