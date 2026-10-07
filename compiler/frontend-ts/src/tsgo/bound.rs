//! The types a program uses and does not own, each resolved to the type that
//! implements it: [`nts_semantic_schema::SemanticSnapshot::bound_types`].
//!
//! An overlay writes `/** @ntsBoundBy "nts:dom" Element */ interface Element {}`
//! beside lib.dom.d.ts. The interface merges into lib.dom's, so its node's type
//! is the type the program writes `Element` for; `"nts:dom" Element` names a
//! type alias declared in the ambient module `"nts:dom"`. Both are nodes this
//! frontend decoded, so the answer is read from the snapshot rather than asked
//! of the checker.
use nts_semantic_schema::binding::{declared_name, enclosing_module, parse};
use nts_semantic_schema::{NodeId, NodeKind, SemanticSnapshot, TypeId, syntax};
use rustc_hash::FxHashMap;

/// Every `@ntsBoundBy` interface whose bound type exists, as `used -> bound`.
///
/// A binding naming a module or a name this program does not declare is left
/// out, not guessed at: the interface then has no representation and lowering
/// refuses it by name, as it does today.
pub(crate) fn bound_types(snapshot: &SemanticSnapshot) -> FxHashMap<TypeId, TypeId> {
    let declared = module_types(snapshot);
    let mut bound = FxHashMap::default();
    for (at, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::INTERFACE_DECLARATION) {
            continue;
        }
        let Some(binding) = node.native.as_ref().and_then(|native| native.bound_by.as_deref()).and_then(parse) else {
            continue;
        };
        let Ok(at) = u32::try_from(at) else { continue };
        let (Some(used), Some(target)) = (snapshot.node_types.get(&NodeId(at)), declared.get(&binding)) else {
            continue;
        };
        if used != target {
            bound.insert(*used, *target);
        }
    }
    bound
}

/// The type of every type alias declared in an ambient module, by the module's
/// name and the alias's. Indexed once rather than asked per binding: there are
/// hundreds of each.
fn module_types(snapshot: &SemanticSnapshot) -> FxHashMap<(&str, &str), TypeId> {
    let mut declared = FxHashMap::default();
    for (at, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::TYPE_ALIAS_DECLARATION) {
            continue;
        }
        let Ok(at) = u32::try_from(at) else { continue };
        let at = NodeId(at);
        let (Some(module), Some(name), Some(ty)) =
            (enclosing_module(snapshot, at), declared_name(snapshot, at), snapshot.node_types.get(&at))
        else {
            continue;
        };
        declared.entry((module, name)).or_insert(*ty);
    }
    declared
}
