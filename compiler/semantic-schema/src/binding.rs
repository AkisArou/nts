//! Declarations a program does not own, bound by delegation to ones it does:
//! `/** @ntsBoundBy "nts:dom" Element */ interface Element {}` beside
//! lib.dom.d.ts (runtime/chromium/docs/lib-dom.md).
//!
//! The queries both halves ask: the frontend resolving a bound *type*
//! ([`crate::SemanticSnapshot::bound_types`]), and lowering resolving a bound
//! global or function. In this crate, as [`crate::reachability`] is, because it
//! is a pure question about a snapshot and the frontend must not depend on the
//! IR crate.
use rustc_hash::FxHashMap;

use crate::{NodeId, NodeKind, SemanticSnapshot, syntax};

/// `"nts:dom" Element` as its module and its name. `None` for anything else:
/// an unquoted module, a missing name, or more than one.
#[must_use]
pub fn parse(binding: &str) -> Option<(&str, &str)> {
    let rest = binding.trim().strip_prefix('"')?;
    let (module, name) = rest.split_once('"')?;
    let name = name.trim();
    (!module.is_empty() && !name.is_empty() && !name.contains(char::is_whitespace))
        .then_some((module, name))
}

/// The name of the nearest `declare module "..."` around a node.
#[must_use]
pub fn enclosing_module(snapshot: &SemanticSnapshot, mut at: NodeId) -> Option<&str> {
    // Bounded: a declaration sits a few levels below its module.
    for _ in 0..16 {
        at = snapshot.nodes.get(at.0 as usize)?.parent?;
        let node = snapshot.nodes.get(at.0 as usize)?;
        if node.kind == NodeKind::Syntax(syntax::MODULE_DECLARATION) {
            return node.children.iter().find_map(|child| {
                let child = snapshot.nodes.get(child.0 as usize)?;
                if child.kind == NodeKind::Syntax(syntax::STRING_LITERAL) {
                    child.text.as_deref()
                } else {
                    None
                }
            });
        }
    }
    None
}

/// A declaration's name: its first identifier child.
#[must_use]
pub fn declared_name(snapshot: &SemanticSnapshot, at: NodeId) -> Option<&str> {
    snapshot
        .nodes
        .get(at.0 as usize)?
        .children
        .iter()
        .find_map(|child| {
            let child = snapshot.nodes.get(child.0 as usize)?;
            if child.kind == NodeKind::Syntax(syntax::IDENTIFIER) {
                child.text.as_deref()
            } else {
                None
            }
        })
}

/// The declaration of kind `kind` named `name` in the ambient module `module`,
/// where there is one.
#[must_use]
pub fn declared_in(
    snapshot: &SemanticSnapshot,
    module: &str,
    name: &str,
    kind: u16,
) -> Option<NodeId> {
    snapshot.nodes.iter().enumerate().find_map(|(at, node)| {
        let at = NodeId(u32::try_from(at).ok()?);
        (node.kind == NodeKind::Syntax(kind)
            && declared_name(snapshot, at) == Some(name)
            && enclosing_module(snapshot, at) == Some(module))
        .then_some(at)
    })
}

/// Every type alias, interface and function an ambient module declares, by
/// module, name and kind: one pass over the nodes, for the many bindings a
/// generated overlay holds.
#[must_use]
pub fn module_declarations(snapshot: &SemanticSnapshot) -> FxHashMap<(&str, &str, u16), NodeId> {
    let mut declared = FxHashMap::default();
    for (at, node) in snapshot.nodes.iter().enumerate() {
        let NodeKind::Syntax(
            kind @ (syntax::TYPE_ALIAS_DECLARATION
            | syntax::INTERFACE_DECLARATION
            | syntax::FUNCTION_DECLARATION),
        ) = node.kind
        else {
            continue;
        };
        let Ok(at) = u32::try_from(at) else { continue };
        let at = NodeId(at);
        if let (Some(module), Some(name)) =
            (enclosing_module(snapshot, at), declared_name(snapshot, at))
        {
            declared.entry((module, name, kind)).or_insert(at);
        }
    }
    declared
}

/// The declaration each `@ntsBoundBy` names: a type alias for an interface, a
/// function for a `declare var` or a `declare function`. What lowering reaches
/// without the program naming it, as it reaches a foreign function by name.
#[must_use]
pub fn bound_declarations(snapshot: &SemanticSnapshot) -> Vec<NodeId> {
    let declared = module_declarations(snapshot);
    snapshot
        .nodes
        .iter()
        .filter_map(|node| {
            let (module, name) = parse(node.native.as_deref()?.bound_by.as_deref()?)?;
            let kind = match node.kind {
                NodeKind::Syntax(syntax::INTERFACE_DECLARATION) => syntax::TYPE_ALIAS_DECLARATION,
                _ => syntax::FUNCTION_DECLARATION,
            };
            declared.get(&(module, name, kind)).copied()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn a_binding_names_a_quoted_module_and_a_name() {
        assert_eq!(parse("\"nts:dom\" Element"), Some(("nts:dom", "Element")));
        assert_eq!(parse("\"nts:dom\" document"), Some(("nts:dom", "document")));
        assert_eq!(parse("nts:dom Element"), None);
        assert_eq!(parse("\"nts:dom\""), None);
        assert_eq!(parse("\"nts:dom\" two names"), None);
    }
}
