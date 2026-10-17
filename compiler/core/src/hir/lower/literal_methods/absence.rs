//! Positive evidence for an absent member, separate from callable supplies.
//! An unmodelled writer removes permission; it never supplies an empty list.
use super::{FuncBuilder, NodeId, Supplies, TypeId, TypeKind, immutable_initializer, syntax};
use rustc_hash::FxHashSet;

#[derive(Debug, Clone)]
struct Effect {
    receiver: NodeId,
    key: Option<String>,
    nested: bool,
}

#[derive(Debug, Clone, Default)]
pub(super) struct Effects(Vec<Effect>);

impl Effects {
    pub(super) fn collect(probe: &FuncBuilder) -> Self {
        let mut effects = Vec::new();
        for (at, _) in probe.snapshot.nodes.iter().enumerate() {
            let Ok(at) = u32::try_from(at) else { break };
            let at = NodeId(at);
            let member = probe.member_access(at);
            let indexed = probe.kind_of(at) == Some(syntax::ELEMENT_ACCESS_EXPRESSION);
            if (member.is_some() || indexed) && probe.stands_on_the_target_side(at) {
                let (receiver, key) = member.map_or_else(
                    || (probe.children(at)[0], None),
                    |(receiver, key)| (receiver, Some(key)),
                );
                effects.push(Effect {
                    receiver,
                    key,
                    nested: false,
                });
            }
            if !matches!(
                probe.kind_of(at),
                Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION)
            ) || authored_body(probe, at).is_some()
            {
                continue;
            }
            // Unknown calls can mutate their receiver and anything reachable
            // from an argument. This includes reflection/merge intrinsics
            // without relying on a list of their names.
            let mut inputs = probe.arguments_of(at);
            if let Some(callee) = probe.children(at).first().copied() {
                if let Some((receiver, _)) = probe.member_access(callee) {
                    inputs.push(receiver);
                } else if probe.kind_of(callee) == Some(syntax::ELEMENT_ACCESS_EXPRESSION)
                    && let Some(receiver) = probe.children(callee).first()
                {
                    inputs.push(*receiver);
                }
            }
            effects.extend(inputs.into_iter().map(|receiver| Effect {
                receiver,
                key: None,
                nested: true,
            }));
        }
        Self(effects)
    }

    pub(super) fn can_supply(
        &self,
        probe: &FuncBuilder,
        supplies: &Supplies,
        owner: TypeId,
        key: &str,
    ) -> bool {
        self.0.iter().any(|effect| {
            effect
                .key
                .as_deref()
                .is_none_or(|written| written == key || written == "__proto__")
                && reaches_owner(probe, supplies, effect, owner)
        })
    }
}

/// Only a real authored body is transparent: every property effect in it was
/// visited above. A declaration/signature alone promises no such thing.
fn authored_body(probe: &FuncBuilder, call: NodeId) -> Option<NodeId> {
    let declaration = probe.implementation_of(probe.snapshot.call_targets.get(&call)?.callee?);
    if probe.kind_of(declaration) == Some(syntax::ARROW_FUNCTION) {
        return probe.children(declaration).last().copied();
    }
    probe
        .children(declaration)
        .into_iter()
        .find(|child| probe.kind_of(*child) == Some(syntax::BLOCK))
}

/// A single-return local factory is still a fresh allocation, not an unknown
/// value of its contextual interface. In particular an unrelated control's
/// writes cannot invalidate the subject's allocation owner.
fn fresh_owners(
    probe: &FuncBuilder,
    supplies: &Supplies,
    value: NodeId,
    depth: u32,
) -> Option<Vec<TypeId>> {
    if depth >= 16 {
        return None;
    }
    if let Some(owners) = supplies.allocated_receiver(probe, value, 0) {
        return Some(owners);
    }
    let value = probe.through_assertions(value);
    if probe.kind_of(value) == Some(syntax::IDENTIFIER) {
        return fresh_owners(
            probe,
            supplies,
            immutable_initializer(probe, value)?,
            depth + 1,
        );
    }
    if probe.kind_of(value) != Some(syntax::CALL_EXPRESSION) {
        return None;
    }
    let declaration = probe.implementation_of(probe.snapshot.call_targets.get(&value)?.callee?);
    if !matches!(
        probe.kind_of(declaration),
        Some(syntax::FUNCTION_DECLARATION | syntax::FUNCTION_EXPRESSION | syntax::ARROW_FUNCTION)
    ) || !supplies.closed_functions()?.is_closed(declaration)
    {
        return None;
    }
    let body = authored_body(probe, value)?;
    let returned = if probe.kind_of(body) == Some(syntax::BLOCK) {
        let statements = probe.children(body);
        let [statement] = statements.as_slice() else {
            return None;
        };
        if probe.kind_of(*statement) != Some(syntax::RETURN_STATEMENT) {
            return None;
        }
        *probe.children(*statement).first()?
    } else {
        body
    };
    let owners = fresh_owners(probe, supplies, returned, depth + 1)?;
    // A generic factory may be instantiated at another owner. Its template's
    // allocation is exact only when the call preserves that same identity.
    let result = probe.snapshot.node_types.get(&value)?;
    owners.iter().all(|owner| owner == result).then_some(owners)
}

fn reaches_owner(probe: &FuncBuilder, supplies: &Supplies, effect: &Effect, owner: TypeId) -> bool {
    let value = probe.through_assertions(effect.receiver);
    let fresh = fresh_owners(probe, supplies, value, 0)
        // A fresh dictionary has no registered record owner. That excludes a
        // direct write to the iterator, but not an iterator stored inside it.
        .filter(|owners| !effect.nested || !owners.is_empty());
    let mut pending = if let Some(fresh) = &fresh {
        fresh.clone()
    } else {
        let Some(ty) = probe.snapshot.node_types.get(&value) else {
            return true;
        };
        vec![*ty]
    };
    let mut seen = FxHashSet::default();
    while let Some(ty) = pending.pop() {
        if !seen.insert(ty) {
            continue;
        }
        let Some(record) = probe.snapshot.types.get(ty.0 as usize) else {
            return true;
        };
        let exact = fresh.as_ref().is_some_and(|owners| owners.contains(&ty));
        if exact && ty == owner {
            return true;
        }
        match &record.kind {
            TypeKind::Object { properties } => {
                if !exact
                    && (probe.hierarchy.descends_from(owner, ty)
                        || properties.iter().all(|property| {
                            property.optional
                                || super::interfaces::property(
                                    probe.snapshot,
                                    owner,
                                    &property.name,
                                )
                                .is_some()
                        }))
                {
                    return true;
                }
                if effect.nested {
                    pending.extend(properties.iter().map(|property| property.ty));
                    pending.extend(
                        probe
                            .snapshot
                            .index_signatures
                            .get(&ty)
                            .into_iter()
                            .flatten()
                            .map(|signature| signature.value),
                    );
                }
            }
            TypeKind::Union(members) | TypeKind::Intersection(members) => pending.extend(members),
            TypeKind::Array(element) if effect.nested => pending.push(*element),
            TypeKind::Tuple(elements) if effect.nested => pending.extend(elements),
            TypeKind::Function(signature) if effect.nested => {
                let Some(signature) = probe.snapshot.signatures.get(signature.0 as usize) else {
                    return true;
                };
                pending.push(signature.return_type);
            }
            TypeKind::Any
            | TypeKind::Unknown
            | TypeKind::Evolving
            | TypeKind::TypeParameter { .. }
            | TypeKind::Conditional { .. }
            | TypeKind::IndexedAccess { .. }
            | TypeKind::Structured { .. }
            | TypeKind::Unsupported { .. } => return true,
            _ => {}
        }
    }
    false
}
