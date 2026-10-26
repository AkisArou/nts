//! A source copy may preserve a closure's identity without invoking a method.
//! Permission covers every use, including immutable aliases and downstream
//! private helpers. One unknown consumer removes all upstream permissions.
use super::super::{FuncBuilder, NodeId, SymbolId, TypeId, closed_calls, syntax};
use nts_semantic_schema::{VariableKind, walk};
use rustc_hash::{FxHashMap, FxHashSet};

type Position = (NodeId, u32);

pub(super) fn collect(
    probe: &FuncBuilder,
    functions: &closed_calls::Functions,
    faces: &FxHashSet<TypeId>,
    supplies: &super::Supplies,
) -> (FxHashSet<Position>, FxHashSet<TypeId>) {
    let mut positions = FxHashMap::default();
    let mut seen = FxHashSet::default();
    for target in probe.snapshot.call_targets.values() {
        let Some(declaration) = target.callee else {
            continue;
        };
        if !seen.insert(declaration) || !functions.is_closed(declaration) {
            continue;
        }
        for (position, _) in super::super::parameters_of(probe, declaration)
            .iter()
            .enumerate()
        {
            let Ok(position) = u32::try_from(position) else {
                continue;
            };
            if let Some((name, symbol)) = functions.parameter(probe, declaration, position)
                && matches!(
                    probe.type_of(name),
                    Some(super::super::HirType::Managed(
                        super::super::ManagedType::Object(_)
                    ))
                )
            {
                positions.insert((declaration, position), symbol);
            }
        }
    }
    let mut consumers: FxHashMap<Position, Vec<Position>> = FxHashMap::default();
    let mut invalid = Vec::new();
    for (position, symbol) in &positions {
        let mut forwarded = Vec::new();
        if !uses_only_values(
            probe,
            functions,
            position.0,
            *symbol,
            &positions,
            &mut forwarded,
        ) {
            invalid.push(*position);
        }
        for target in forwarded {
            consumers.entry(target).or_default().push(*position);
        }
    }
    let mut allowed: FxHashSet<_> = positions.keys().copied().collect();
    while let Some(position) = invalid.pop() {
        if allowed.remove(&position) {
            invalid.extend(consumers.get(&position).into_iter().flatten().copied());
        }
    }
    let by_symbol: FxHashMap<_, _> = positions
        .iter()
        .map(|(at, symbol)| (*symbol, *at))
        .collect();
    let legacy = legacy_faces(probe, faces, supplies, &by_symbol, &allowed);
    (allowed, legacy)
}

/// A value read outside a proved identity-only copy can coexist with a call
/// through that receiver, here or downstream. Until interface accessors return
/// the original closure, preserve the old inference and source-copy behavior
/// for the whole face. A typeof needs no closure extraction.
fn legacy_faces(
    probe: &FuncBuilder,
    faces: &FxHashSet<TypeId>,
    supplies: &super::Supplies,
    positions: &FxHashMap<SymbolId, Position>,
    allowed: &FxHashSet<Position>,
) -> FxHashSet<TypeId> {
    let mut legacy = FxHashSet::default();
    for (at, _) in probe.snapshot.nodes.iter().enumerate() {
        let Ok(at) = u32::try_from(at) else {
            continue;
        };
        let access = NodeId(at);
        let Some((receiver, member)) = probe.member_access_key(access) else {
            continue;
        };
        // Assigning the field does not extract the old closure's identity.
        if probe.stands_on_the_target_side(access) {
            continue;
        }
        let Some(face) = probe.snapshot.node_types.get(&receiver).copied() else {
            continue;
        };
        if !faces.contains(&face)
            || !super::interfaces::property(probe.snapshot, face, &member)
                .is_some_and(|property| property.kind == nts_semantic_schema::MemberKind::Method)
        {
            continue;
        }
        let expression = outer_expression(probe, access);
        let parent = walk::parent(probe.snapshot, expression);
        if parent.is_some_and(|parent| {
            probe.kind_of(parent) == Some(syntax::TYPE_OF_EXPRESSION)
                || (probe.kind_of(parent) == Some(syntax::CALL_EXPRESSION)
                    && probe.children(parent).first() == Some(&expression))
        }) || supplies
            .allocated_receiver(probe, receiver, 0)
            .is_some_and(|owners| owners.as_slice() == [face])
        {
            continue;
        }
        if !receiver_position(probe, receiver, positions, 0)
            .is_some_and(|position| allowed.contains(&position))
        {
            legacy.insert(face);
        }
    }
    legacy
}

fn receiver_position(
    probe: &FuncBuilder,
    receiver: NodeId,
    positions: &FxHashMap<SymbolId, Position>,
    depth: u32,
) -> Option<Position> {
    if depth >= 16 {
        return None;
    }
    let receiver = probe.through_assertions(receiver);
    let symbol = walk::denoted(probe.snapshot, probe.node(receiver).symbol?);
    if let Some(position) = positions.get(&symbol) {
        return Some(*position);
    }
    receiver_position(
        probe,
        super::immutable_initializer(probe, receiver)?,
        positions,
        depth + 1,
    )
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Value {
    Receiver,
    Method,
}

fn uses_only_values(
    probe: &FuncBuilder,
    functions: &closed_calls::Functions,
    declaration: NodeId,
    binding: SymbolId,
    positions: &FxHashMap<Position, SymbolId>,
    forwarded: &mut Vec<Position>,
) -> bool {
    let mut pending = vec![(binding, Value::Receiver)];
    let mut seen = FxHashSet::default();
    while let Some((symbol, value)) = pending.pop() {
        if !seen.insert((symbol, value)) {
            continue;
        }
        for reference in functions.references().get(&symbol).into_iter().flatten() {
            let Some(parent) = walk::parent(probe.snapshot, *reference) else {
                return false;
            };
            if matches!(
                probe.kind_of(parent),
                Some(syntax::PARAMETER | syntax::VARIABLE_DECLARATION)
            ) && probe.name_node(parent) == Some(*reference)
            {
                continue;
            }
            if closed_calls::enclosing_function(probe, *reference) != Some(declaration)
                || probe.stands_on_the_target_side(*reference)
            {
                return false;
            }
            let mut expression = outer_expression(probe, *reference);
            let mut current = value;
            if current == Value::Receiver
                && let Some(access) = walk::parent(probe.snapshot, expression)
                && let Some((receiver, member)) = probe.member_access_key(access)
                && receiver == expression
            {
                let Some(ty) = probe.snapshot.node_types.get(reference) else {
                    return false;
                };
                if !super::interfaces::property(probe.snapshot, *ty, &member).is_some_and(
                    |property| {
                        matches!(
                            probe
                                .snapshot
                                .types
                                .get(property.ty.0 as usize)
                                .map(|record| &record.kind),
                            Some(super::TypeKind::Function(_))
                        ) && !matches!(property.kind, nts_semantic_schema::MemberKind::Accessor(_))
                    },
                ) {
                    return false;
                }
                expression = outer_expression(probe, access);
                current = Value::Method;
            }
            if !consume_value(
                probe,
                expression,
                current,
                positions,
                &mut pending,
                forwarded,
            ) {
                return false;
            }
        }
    }
    true
}

fn consume_value(
    probe: &FuncBuilder,
    expression: NodeId,
    current: Value,
    positions: &FxHashMap<Position, SymbolId>,
    pending: &mut Vec<(SymbolId, Value)>,
    forwarded: &mut Vec<Position>,
) -> bool {
    let Some(parent) = walk::parent(probe.snapshot, expression) else {
        return false;
    };
    let children = probe.children(parent);
    match probe.kind_of(parent) {
        Some(syntax::TYPE_OF_EXPRESSION) => {}
        Some(syntax::BINARY_EXPRESSION)
            if children
                .get(1)
                .and_then(|operator| probe.kind_of(*operator))
                .is_some_and(|operator| {
                    matches!(
                        operator,
                        syntax::EQUALS_EQUALS_EQUALS_TOKEN
                            | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
                    )
                }) => {}
        Some(syntax::VARIABLE_DECLARATION)
            if probe.declaration_kind(parent) == VariableKind::Const
                && children.last() == Some(&expression) =>
        {
            let Some(name) = probe.name_node(parent) else {
                return false;
            };
            if probe.kind_of(name) != Some(syntax::IDENTIFIER) {
                return false;
            }
            let Some(symbol) = probe.node(name).symbol else {
                return false;
            };
            pending.push((walk::denoted(probe.snapshot, symbol), current));
        }
        Some(syntax::CALL_EXPRESSION) if current == Value::Receiver => {
            let Some(callee) = probe
                .snapshot
                .call_targets
                .get(&parent)
                .and_then(|target| target.callee)
            else {
                return false;
            };
            let arguments = probe.arguments_of(parent);
            if arguments
                .iter()
                .any(|argument| probe.kind_of(*argument) == Some(syntax::SPREAD_ELEMENT))
            {
                return false;
            }
            let Some(position) = arguments
                .iter()
                .position(|argument| *argument == expression)
                .and_then(|position| u32::try_from(position).ok())
            else {
                return false;
            };
            let target = (callee, position);
            if !positions.contains_key(&target) {
                return false;
            }
            forwarded.push(target);
        }
        _ => return false,
    }
    true
}

fn outer_expression(probe: &FuncBuilder, mut expression: NodeId) -> NodeId {
    while let Some(parent) = walk::parent(probe.snapshot, expression) {
        if probe.through_assertions(parent) != expression {
            break;
        }
        expression = parent;
    }
    expression
}
