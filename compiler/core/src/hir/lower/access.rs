//! Null receiver checks belong to the access, after its operands have run.
//!
//! Assertions along the receiver's transparent chain defer only presence to
//! this check. Other assertions keep establishing their native representation.

use super::{
    BinOp, BlockId, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, Place,
    Terminator, ValueId, syntax,
};
use crate::hir::tags;

#[derive(Debug)]
pub(super) struct Pending {
    node: NodeId,
    raw: Option<(NodeId, ValueId)>,
}

#[derive(Debug, Clone)]
pub(super) struct Guard {
    absent: ValueId,
    null: ValueId,
}

#[derive(Debug, Clone)]
pub(super) enum Key {
    Name(String),
    Index(ValueId, NodeId),
}

/// The index expression is already captured by the read/place lowering. Its
/// source node carries which absence a nullable string key's pointer means.
pub(super) fn index_key(probe: &FuncBuilder<'_>, access: NodeId, value: ValueId) -> Key {
    // element_access_parts/lower_string_index established the two-child shape.
    Key::Index(value, probe.children(access)[1])
}

/// A member's physical name is not necessarily its JavaScript property key.
/// Symbol fields use the checker's identity for lookup, but diagnostics read
/// the actual symbol, whose description may differ from the variable's name.
pub(super) fn named_key(
    builder: &mut FuncBuilder<'_>,
    access: NodeId,
    member: NodeId,
    name: String,
) -> Result<Key, Diagnostic> {
    if builder.kind_of(access) == Some(syntax::ELEMENT_ACCESS_EXPRESSION)
        && builder.type_of(member) == Some(HirType::Managed(ManagedType::Symbol))
    {
        return Ok(Key::Index(builder.lower_expression(member)?, member));
    }
    Ok(Key::Name(name))
}

fn transparent(probe: &FuncBuilder<'_>, node: NodeId) -> bool {
    matches!(
        probe.kind_of(node),
        Some(
            syntax::PARENTHESIZED_EXPRESSION
                | syntax::NON_NULL_EXPRESSION
                | syntax::AS_EXPRESSION
                | syntax::SATISFIES_EXPRESSION
        )
    )
}

fn source(probe: &FuncBuilder<'_>, mut node: NodeId) -> NodeId {
    while transparent(probe, node) {
        let Some(inner) = probe.children(node).first().copied() else {
            break;
        };
        node = inner;
    }
    node
}

fn nullable(probe: &FuncBuilder<'_>, receiver: NodeId) -> bool {
    let receiver = source(probe, receiver);
    (probe.type_of(receiver) == Some(HirType::Erased)
        && probe.read_type(receiver).is_none_or(|ty| {
            probe
                .snapshot
                .types
                .get(ty.0 as usize)
                .is_none_or(|record| {
                    matches!(
                        record.kind,
                        super::TypeKind::Any
                            | super::TypeKind::Unknown
                            | super::TypeKind::Evolving
                            | super::TypeKind::TypeParameter { .. }
                    )
                })
        }))
        || probe
            .absences_of(receiver)
            .is_some_and(|absent| !absent.is_empty())
}

/// The same licence for lowering and the walk that selects raising entries.
/// A non-null receiver costs no check. An optional link already handles absence.
pub(super) fn can_throw(probe: &FuncBuilder<'_>, access: NodeId) -> bool {
    if !matches!(
        probe.kind_of(access),
        Some(syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION)
    ) {
        return false;
    }
    let children = probe.children(access);
    children.len() == 2 && nullable(probe, children[0])
}

/// Save the pre-assertion value, including its erased absence tag. The node
/// check prevents a nested call argument's assertion inheriting this context.
pub(super) fn defer_presence(builder: &mut FuncBuilder<'_>, node: NodeId, value: ValueId) -> bool {
    let Some(pending) = &builder.access_receiver else {
        return false;
    };
    if source(builder, pending.node) != source(builder, node)
        || matches!(
            builder.values[value.0 as usize].ty,
            HirType::NativePointer(_)
        )
    {
        return false;
    }
    let node = source(builder, node);
    if let Some(pending) = &mut builder.access_receiver {
        pending.raw.get_or_insert((node, value));
    }
    true
}

pub(super) fn receiver(
    builder: &mut FuncBuilder<'_>,
    node: NodeId,
) -> Result<(ValueId, Option<Guard>), Diagnostic> {
    if !nullable(builder, node) {
        return Ok((builder.lower_expression(node)?, None));
    }
    let previous = builder.access_receiver.replace(Pending { node, raw: None });
    let value = builder.lower_expression(node);
    let pending = std::mem::replace(&mut builder.access_receiver, previous);
    let value = value?;
    let (at, raw) = pending
        .and_then(|pending| pending.raw)
        .unwrap_or((source(builder, node), value));
    let Some(absent) = builder.absence_of(at, raw) else {
        return Ok((value, None));
    };
    let origin = builder.origin(node);
    let null = if builder.values[raw.0 as usize].ty == HirType::Erased {
        let ty = HirType::Int {
            bits: 32,
            signed: false,
        };
        let tag = builder.push(OpKind::TagOf { value: raw }, ty.clone(), origin.clone());
        let null = builder.push(OpKind::ConstInt(i128::from(tags::NULL)), ty, origin.clone());
        builder.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: tag,
                rhs: null,
            },
            HirType::Bool,
            origin,
        )
    } else {
        let null = builder
            .absences_of(at)
            .is_some_and(|absent| absent.contains(&tags::NULL));
        builder.push(OpKind::ConstBool(null), HirType::Bool, origin)
    };
    Ok((value, Some(Guard { absent, null })))
}

pub(super) fn protect(place: Place, guard: Option<Guard>, key: Key) -> Place {
    match guard {
        Some(guard) => Place::Checked {
            place: Box::new(place),
            guard,
            key,
        },
        None => place,
    }
}

pub(super) fn require(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    guard: &Guard,
    key: &Key,
    write: bool,
) -> Result<(), Diagnostic> {
    let rejected = builder.new_block();
    let accepted = builder.new_block();
    builder.terminate(Terminator::Branch {
        cond: guard.absent,
        then_target: rejected,
        then_args: Vec::new(),
        else_target: accepted,
        else_args: Vec::new(),
    });
    builder.switch_to(rejected);
    let null = builder.new_block();
    let undefined = builder.new_block();
    builder.terminate(Terminator::Branch {
        cond: guard.null,
        then_target: null,
        then_args: Vec::new(),
        else_target: undefined,
        else_args: Vec::new(),
    });
    throw(builder, at, key, write, null, "null")?;
    throw(builder, at, key, write, undefined, "undefined")?;
    builder.switch_to(accepted);
    Ok(())
}

fn throw(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    key: &Key,
    write: bool,
    block: BlockId,
    receiver: &str,
) -> Result<(), Diagnostic> {
    builder.switch_to(block);
    let action = if write { "set" } else { "read" };
    let participle = if write { "setting" } else { "reading" };
    let message = format!("Cannot {action} properties of {receiver}");
    let origin = builder.origin(at);
    let text = HirType::Managed(ManagedType::String);
    match key {
        Key::Name(name) => {
            let message = builder.push(
                OpKind::ConstString(format!("{message} ({participle} '{name}')")),
                text,
                origin,
            );
            builder.throw_provided_error_text(at, "TypeError", message)
        }
        Key::Index(index, from) => throw_index(builder, at, *from, *index, &message, participle),
    }
}

/// Definitely-object keys cannot be described with the metadata we hold.
/// Any/unknown and mixed unions remain dynamic: rejecting those would reject
/// ordinary unchecked JavaScript whose key turns out to be a primitive.
fn definitely_object(builder: &FuncBuilder<'_>, at: NodeId) -> bool {
    fn object(snapshot: &super::SemanticSnapshot, ty: super::TypeId, depth: u8) -> bool {
        if depth == 0 {
            return false;
        }
        match snapshot.types.get(ty.0 as usize).map(|ty| &ty.kind) {
            Some(
                super::TypeKind::Object { .. }
                | super::TypeKind::Array(_)
                | super::TypeKind::Tuple(_)
                | super::TypeKind::Function(_),
            ) => true,
            Some(super::TypeKind::Union(members) | super::TypeKind::Intersection(members)) => {
                !members.is_empty() && members.iter().all(|ty| object(snapshot, *ty, depth - 1))
            }
            _ => false,
        }
    }
    builder
        .read_type(at)
        .is_some_and(|ty| object(builder.snapshot, ty, 64))
}

fn throw_index(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    from: NodeId,
    index: ValueId,
    message: &str,
    participle: &str,
) -> Result<(), Diagnostic> {
    if definitely_object(builder, from) {
        return Err(builder.unsupported(at, "a property access on a possibly-null receiver with an object-typed key: node's message would describe the key by its constructor, which this compiler does not record"));
    }
    let origin = builder.origin(at);
    let text = HirType::Managed(ManagedType::String);
    // Preserve a nullable primitive key's source absence when giving it a tag.
    let key = builder.coerce(index, &HirType::Erased, from)?;
    let key = builder.runtime_call(
        "nts_access_key_description",
        vec![key],
        text.clone(),
        origin.clone(),
    );
    let null = builder.push(OpKind::ConstNull, text.clone(), origin.clone());
    let omitted = builder.push(
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: key,
            rhs: null,
        },
        HirType::Bool,
        origin.clone(),
    );
    let without_key = builder.new_block();
    let with_key = builder.new_block();
    builder.terminate(Terminator::Branch {
        cond: omitted,
        then_target: without_key,
        then_args: Vec::new(),
        else_target: with_key,
        else_args: Vec::new(),
    });
    builder.switch_to(without_key);
    // A dynamic object key is never coerced for an error message. V8 can add
    // '#<Constructor>' for some objects or a function's source text; without
    // that metadata we omit it.
    // This text divergence is recorded, while the TypeError stays catchable.
    let plain = builder.push(
        OpKind::ConstString(message.to_owned()),
        text.clone(),
        origin.clone(),
    );
    builder.throw_provided_error_text(at, "TypeError", plain)?;
    builder.switch_to(with_key);
    let prefix = builder.push(
        OpKind::ConstString(format!("{message} ({participle} '")),
        text.clone(),
        origin.clone(),
    );
    let message = builder.push(
        OpKind::Binary {
            op: BinOp::Concat,
            lhs: prefix,
            rhs: key,
        },
        text.clone(),
        origin.clone(),
    );
    let suffix = builder.push(
        OpKind::ConstString("')".to_owned()),
        text.clone(),
        origin.clone(),
    );
    let message = builder.push(
        OpKind::Binary {
            op: BinOp::Concat,
            lhs: message,
            rhs: suffix,
        },
        text,
        origin,
    );
    builder.throw_provided_error_text(at, "TypeError", message)
}
