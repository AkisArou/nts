//! Shared evidence for private functions with every caller known.
use super::{FuncBuilder, NodeId, SymbolId, syntax};
use nts_semantic_schema::walk;
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug, Default)]
pub(super) struct Functions {
    references: FxHashMap<SymbolId, Vec<NodeId>>,
    calls: FxHashMap<NodeId, Vec<NodeId>>,
    closed: FxHashSet<NodeId>,
}

impl Functions {
    pub(super) fn collect(probe: &FuncBuilder) -> Self {
        let snapshot = probe.snapshot;
        let mut out = Self::default();
        for (at, node) in snapshot.nodes.iter().enumerate() {
            if node.kind == nts_semantic_schema::NodeKind::Syntax(syntax::IDENTIFIER)
                && let Some(symbol) = node.symbol
            {
                out.references
                    .entry(walk::denoted(snapshot, symbol))
                    .or_default()
                    .push(NodeId(u32::try_from(at).unwrap_or(u32::MAX)));
            }
        }
        for (call, target) in &snapshot.call_targets {
            if let Some(callee) = target.callee {
                out.calls.entry(callee).or_default().push(*call);
            }
        }
        let exported: FxHashSet<_> = snapshot
            .modules
            .iter()
            .flat_map(|module| {
                module
                    .exports
                    .iter()
                    .map(|(_, symbol)| walk::denoted(snapshot, *symbol))
            })
            .collect();
        for declaration in out.calls.keys().copied() {
            if function_is_closed(probe, declaration, &out.references, &exported) {
                out.closed.insert(declaration);
            }
        }
        for calls in out.calls.values_mut() {
            calls.sort_unstable_by_key(|call| call.0);
        }
        out
    }

    pub(super) fn is_closed(&self, declaration: NodeId) -> bool {
        self.closed.contains(&declaration)
    }

    pub(super) fn references(&self) -> &FxHashMap<SymbolId, Vec<NodeId>> {
        &self.references
    }

    /// A plain, unwritten parameter of a closed helper. Defaults, rest and
    /// optional parameters need an additional supply and are not proved here.
    pub(super) fn parameter(
        &self,
        probe: &FuncBuilder,
        declaration: NodeId,
        position: u32,
    ) -> Option<(NodeId, SymbolId)> {
        if !self.is_closed(declaration) {
            return None;
        }
        let parameter = *super::parameters_of(probe, declaration).get(position as usize)?;
        if probe.default_of(parameter).is_some()
            || probe.children(parameter).into_iter().any(|child| {
                matches!(
                    probe.kind_of(child),
                    Some(syntax::DOT_DOT_DOT_TOKEN | syntax::QUESTION_TOKEN)
                )
            })
        {
            return None;
        }
        let name = probe.name_node(parameter)?;
        if probe.kind_of(name) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let symbol = walk::denoted(probe.snapshot, probe.node(name).symbol?);
        if probe
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .as_slice()
            != [parameter]
            || self
                .references
                .get(&symbol)
                .into_iter()
                .flatten()
                .any(|reference| *reference != name && probe.stands_on_the_target_side(*reference))
        {
            return None;
        }
        Some((name, symbol))
    }

    /// Every actual value entering the parameter denoted by this identifier.
    /// An escaping/exported helper or even one unresolved call gives no proof.
    pub(super) fn inputs(&self, probe: &FuncBuilder, source: NodeId) -> Option<Vec<NodeId>> {
        let symbol = walk::denoted(probe.snapshot, probe.node(source).symbol?);
        let [parameter] = probe
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .as_slice()
        else {
            return None;
        };
        if probe.kind_of(*parameter) != Some(syntax::PARAMETER) {
            return None;
        }
        let declaration = walk::parent(probe.snapshot, *parameter)?;
        let position = u32::try_from(
            super::parameters_of(probe, declaration)
                .iter()
                .position(|at| at == parameter)?,
        )
        .ok()?;
        self.parameter(probe, declaration, position)?;
        let calls = self.calls.get(&declaration)?;
        if calls.is_empty() {
            return None;
        }
        calls
            .iter()
            .map(|call| {
                let arguments = probe.arguments_of(*call);
                if probe.kind_of(*call) != Some(syntax::CALL_EXPRESSION)
                    || arguments
                        .iter()
                        .any(|at| probe.kind_of(*at) == Some(syntax::SPREAD_ELEMENT))
                {
                    return None;
                }
                arguments.get(position as usize).copied()
            })
            .collect()
    }
}

fn function_is_closed(
    probe: &FuncBuilder,
    declaration: NodeId,
    references: &FxHashMap<SymbolId, Vec<NodeId>>,
    exported: &FxHashSet<SymbolId>,
) -> bool {
    if probe.kind_of(declaration) != Some(syntax::FUNCTION_DECLARATION) {
        return false;
    }
    let Some(name) = probe.name_node(declaration) else {
        return false;
    };
    let Some(symbol) = probe.node(name).symbol else {
        return false;
    };
    let symbol = walk::denoted(probe.snapshot, symbol);
    if exported.contains(&symbol)
        || super::super::generics::declared_signature(probe.snapshot, declaration)
            .is_none_or(|signature| signature.this_type.is_some())
        || probe
            .node(declaration)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::EXPORT)
        || probe
            .snapshot
            .symbols
            .get(symbol.0 as usize)
            .is_none_or(|record| record.declarations.as_slice() != [declaration])
    {
        return false;
    }
    references
        .get(&symbol)
        .into_iter()
        .flatten()
        .all(|reference| {
            *reference == name
                || walk::parent(probe.snapshot, *reference).is_some_and(|call| {
                    probe.kind_of(call) == Some(syntax::CALL_EXPRESSION)
                        && probe.children(call).first() == Some(reference)
                        && probe
                            .snapshot
                            .call_targets
                            .get(&call)
                            .and_then(|target| target.callee)
                            == Some(declaration)
                })
        })
}

pub(super) fn enclosing_function(probe: &FuncBuilder, node: NodeId) -> Option<NodeId> {
    let mut at = walk::parent(probe.snapshot, node);
    while let Some(node) = at {
        if matches!(
            probe.kind_of(node),
            Some(
                syntax::FUNCTION_DECLARATION
                    | syntax::FUNCTION_EXPRESSION
                    | syntax::ARROW_FUNCTION
                    | syntax::METHOD_DECLARATION
                    | syntax::CONSTRUCTOR
                    | syntax::GET_ACCESSOR
                    | syntax::SET_ACCESSOR
            )
        ) {
            return Some(node);
        }
        at = walk::parent(probe.snapshot, node);
    }
    None
}
