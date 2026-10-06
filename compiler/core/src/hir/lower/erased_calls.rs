//! Evidence for source copies of erased parameters at closed direct calls.
//!
//! A use classification motivates a copy; it does not authorize one. This
//! checks callable escape and every use of the parameter and its immutable
//! aliases separately. Stores, captures, returns of the parameter, mutation
//! and unresolved calls keep the ordinary erased entry. Forwarding edges
//! settle by removing candidates whose consumers are not closed.

use super::{FuncBuilder, HirType, NodeId, SymbolId, TypeKind, syntax};
use crate::erasure::{self, Verdict};
use nts_semantic_schema::walk;
use rustc_hash::{FxHashMap, FxHashSet};

/// New erased-parameter representations per declaration, independent of its
/// existing structural copies and of its ordinary/raising exception entries.
pub(super) const COPY_CAP: usize = 8;

#[derive(Default)]
pub(super) struct ClosedParameters {
    positions: FxHashMap<(NodeId, u32), SymbolId>,
    closed: FxHashSet<SymbolId>,
    /// What each closed binding's element reads (`xs[i]`) feed. See
    /// [`ClosedParameters::admits`].
    element_reads: FxHashMap<SymbolId, ElementReads>,
}

/// How a parameter's element reads are consumed, which decides whether an
/// array may be recovered for it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum ElementReads {
    /// None at all.
    #[default]
    None,
    /// Each feeds a number: arithmetic, a numeric comparison or shift, a
    /// number's compound assignment, a unary sign, or the return of a function
    /// declared to return `number`. There an out-of-range read's `undefined`
    /// and NaN agree, so the copy reads through `ToNumber`.
    Numeric,
    /// Some other consumer, where `undefined` is observable.
    Other,
}

impl ClosedParameters {
    pub(super) fn collect(probe: &FuncBuilder<'_>) -> Self {
        let snapshot = probe.snapshot;
        // Most programs have no ordinary erased parameter to recover. Do not
        // pay for a whole-program classification when no such call exists.
        if !snapshot.call_targets.values().any(|target| {
            target.callee.is_some_and(|callee| {
                probe.kind_of(callee) == Some(syntax::FUNCTION_DECLARATION)
                    && probe.children(callee).into_iter().any(|param| {
                        probe.kind_of(param) == Some(syntax::PARAMETER)
                            && probe.name_node(param).is_some_and(|name| {
                                snapshot.node_types.get(&name).is_some_and(|ty| {
                                    snapshot.types.get(ty.0 as usize).is_some_and(|record| {
                                        matches!(record.kind, TypeKind::Any | TypeKind::Unknown)
                                    })
                                })
                            })
                    })
            })
        }) {
            return Self::default();
        }

        let classifications = erasure::classify(snapshot);
        let mut references: FxHashMap<SymbolId, Vec<NodeId>> = FxHashMap::default();
        for (at, node) in snapshot.nodes.iter().enumerate() {
            if node.kind == nts_semantic_schema::NodeKind::Syntax(syntax::IDENTIFIER)
                && let Some(symbol) = node.symbol
            {
                references
                    .entry(walk::denoted(snapshot, symbol))
                    .or_default()
                    .push(NodeId(u32::try_from(at).unwrap_or(u32::MAX)));
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
        let mut functions = FxHashMap::default();
        let mut out = Self::default();
        for site in classifications.sites() {
            let Some(parameter) = site.parameter else {
                continue;
            };
            if site.verdict != Verdict::Examined
                || site.unresolved
                || site.in_container
                || probe.kind_of(parameter.declaration) != Some(syntax::FUNCTION_DECLARATION)
                || super::is_generic_function(snapshot, parameter.declaration)
                || probe.default_of(site.node).is_some()
                || probe.children(site.node).into_iter().any(|child| {
                    matches!(
                        probe.kind_of(child),
                        Some(syntax::DOT_DOT_DOT_TOKEN | syntax::QUESTION_TOKEN)
                    )
                })
            {
                continue;
            }
            let closed = *functions.entry(parameter.declaration).or_insert_with(|| {
                function_is_closed(probe, parameter.declaration, &references, &exported)
            });
            if closed {
                out.positions
                    .insert((parameter.declaration, parameter.position), site.binding);
                out.closed.insert(site.binding);
            }
        }

        let mut consumers: FxHashMap<SymbolId, Vec<SymbolId>> = FxHashMap::default();
        let mut invalid = Vec::new();
        let mut positions: Vec<_> = out.positions.iter().collect();
        positions.sort_by_key(|((declaration, position), _)| (declaration.0, *position));
        for ((declaration, _), binding) in positions {
            let mut forwarded = Vec::new();
            let mut reads = ElementReads::None;
            if !uses_are_closed(
                probe,
                *declaration,
                *binding,
                &references,
                &out.positions,
                &mut forwarded,
                &mut reads,
            ) {
                invalid.push(*binding);
            }
            out.element_reads.insert(*binding, reads);
            for target in forwarded {
                consumers.entry(target).or_default().push(*binding);
            }
        }
        // Each candidate can be removed only once. Cycles without an escape
        // remain closed; one unknown edge invalidates all upstream candidates.
        while let Some(binding) = invalid.pop() {
            if out.closed.remove(&binding) {
                invalid.extend(consumers.get(&binding).into_iter().flatten().copied());
            }
        }
        out
    }

    /// Whether a copy may take `ty` at this closed position.
    ///
    /// **An array only where its element reads cannot see an absence.** The
    /// copy reads the same array the caller made, and JavaScript answers
    /// `undefined` for a read past its end; the checker typed that read `any`,
    /// so nothing promised it was in range. Where every read feeds a number,
    /// `undefined` and NaN are the same answer, and the copy reads through
    /// `ToNumber` (`FuncBuilder::lower_element_access`): so a `number[]` is
    /// recovered there. Anything else -- a read compared with `===`,
    /// concatenated, passed on -- would see the difference, and keeps the
    /// erased original. An array whose elements are never read by index is
    /// recovered whatever they are.
    pub(super) fn admits(&self, declaration: NodeId, position: u32, ty: &HirType) -> bool {
        let Some(binding) = self.positions.get(&(declaration, position)) else {
            return false;
        };
        if !self.closed.contains(binding) {
            return false;
        }
        let HirType::Managed(super::ManagedType::Array(element)) = ty else {
            return true;
        };
        match self.element_reads.get(binding).copied().unwrap_or_default() {
            ElementReads::None => true,
            ElementReads::Numeric => **element == HirType::NUMBER,
            ElementReads::Other => false,
        }
    }
}

fn function_is_closed(
    probe: &FuncBuilder<'_>,
    declaration: NodeId,
    references: &FxHashMap<SymbolId, Vec<NodeId>>,
    exported: &FxHashSet<SymbolId>,
) -> bool {
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

fn uses_are_closed(
    probe: &FuncBuilder<'_>,
    declaration: NodeId,
    binding: SymbolId,
    references: &FxHashMap<SymbolId, Vec<NodeId>>,
    positions: &FxHashMap<(NodeId, u32), SymbolId>,
    forwarded: &mut Vec<SymbolId>,
    reads: &mut ElementReads,
) -> bool {
    let mut pending = vec![binding];
    let mut seen = FxHashSet::default();
    while let Some(symbol) = pending.pop() {
        if !seen.insert(symbol) {
            continue;
        }
        for reference in references.get(&symbol).into_iter().flatten() {
            let Some(parent) = walk::parent(probe.snapshot, *reference) else {
                return false;
            };
            let children = probe.children(parent);
            if matches!(
                probe.kind_of(parent),
                Some(syntax::PARAMETER | syntax::VARIABLE_DECLARATION)
            ) && probe.name_node(parent) == Some(*reference)
            {
                continue;
            }
            // A nested function/closure is a boundary even if it does not
            // currently escape. Closure creation flow is a later proof.
            if enclosing_function(probe, *reference) != Some(declaration) {
                return false;
            }
            // Preserve the existing checked narrowing path until copies can
            // prove and prune its alternatives in their own context.
            if probe.type_of(*reference) != Some(HirType::Erased) {
                return false;
            }
            match probe.kind_of(parent) {
                Some(syntax::VARIABLE_DECLARATION)
                    if probe.declaration_kind(parent)
                        == nts_semantic_schema::VariableKind::Const
                        && children.last() == Some(reference) =>
                {
                    let Some(alias) = probe
                        .name_node(parent)
                        .and_then(|name| probe.node(name).symbol)
                    else {
                        return false;
                    };
                    pending.push(alias);
                }
                Some(syntax::CALL_EXPRESSION) => {
                    let Some(callee) = probe
                        .snapshot
                        .call_targets
                        .get(&parent)
                        .and_then(|target| target.callee)
                    else {
                        return false;
                    };
                    let arguments = probe.arguments_of(parent);
                    // A spread changes written positions. Leave the whole
                    // forwarding edge erased until that mapping is proved.
                    if arguments
                        .iter()
                        .any(|arg| probe.kind_of(*arg) == Some(syntax::SPREAD_ELEMENT))
                    {
                        return false;
                    }
                    let Some(position) = arguments
                        .iter()
                        .position(|arg| arg == reference)
                        .and_then(|at| u32::try_from(at).ok())
                    else {
                        return false;
                    };
                    let Some(target) = positions.get(&(callee, position)) else {
                        return false;
                    };
                    forwarded.push(*target);
                }
                Some(syntax::BINARY_EXPRESSION) => {
                    if !binary_use_is_closed(probe, &children) {
                        return false;
                    }
                }
                Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                    if !matches!(probe.node(parent).data, nts_semantic_schema::NodeData::Children { small, .. }
                        if (small & syntax::prefix_operator::MASK) <= syntax::prefix_operator::EXCLAMATION)
                    {
                        return false;
                    }
                }
                Some(syntax::EXPRESSION_STATEMENT) => {}
                Some(syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION)
                    if children.first() == Some(reference) =>
                {
                    if access_is_written(probe, parent) {
                        return false;
                    }
                    if probe.kind_of(parent) == Some(syntax::ELEMENT_ACCESS_EXPRESSION) {
                        let numeric = feeds_a_number(probe, declaration, parent);
                        *reads = match (*reads, numeric) {
                            (ElementReads::Other, _) | (_, false) => ElementReads::Other,
                            _ => ElementReads::Numeric,
                        };
                    }
                }
                // No statement about storage, returned identities or casts
                // is inferred from the strongest use classification.
                _ => return false,
            }
        }
    }
    true
}

fn enclosing_function(probe: &FuncBuilder<'_>, node: NodeId) -> Option<NodeId> {
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

fn access_is_written(probe: &FuncBuilder<'_>, access: NodeId) -> bool {
    let Some(parent) = walk::parent(probe.snapshot, access) else {
        return true;
    };
    let children = probe.children(parent);
    match probe.kind_of(parent) {
        Some(syntax::BINARY_EXPRESSION) if children.first() == Some(&access) => children
            .get(1)
            .and_then(|op| probe.kind_of(*op))
            .is_none_or(|op| {
                op == syntax::EQUALS_TOKEN
                    || (syntax::PLUS_EQUALS_TOKEN..=syntax::CARET_EQUALS_TOKEN).contains(&op)
            }),
        Some(
            syntax::PREFIX_UNARY_EXPRESSION
            | syntax::POSTFIX_UNARY_EXPRESSION
            | syntax::DELETE_EXPRESSION,
        ) => true,
        _ => false,
    }
}

/// Whether the value of `read` -- an element read in `declaration` -- feeds
/// a number, so that `undefined` and NaN are the same answer there. See
/// [`ElementReads::Numeric`].
fn feeds_a_number(probe: &FuncBuilder<'_>, declaration: NodeId, read: NodeId) -> bool {
    let mut at = read;
    let parent = loop {
        let Some(parent) = walk::parent(probe.snapshot, at) else {
            return false;
        };
        if probe.kind_of(parent) != Some(syntax::PARENTHESIZED_EXPRESSION) {
            break parent;
        }
        at = parent;
    };
    let number = |node: &NodeId| probe.type_of(*node) == Some(HirType::NUMBER);
    match probe.kind_of(parent) {
        Some(syntax::BINARY_EXPRESSION) => {
            let [lhs, operator, rhs] = probe.children(parent)[..] else {
                return false;
            };
            let other = if lhs == at { rhs } else { lhs };
            match probe.kind_of(operator) {
                // `undefined + 1` is NaN; `undefined + "a"` is not "NaNa".
                Some(syntax::PLUS_TOKEN) => number(&other),
                Some(
                    syntax::MINUS_TOKEN
                    | syntax::ASTERISK_TOKEN
                    | syntax::ASTERISK_ASTERISK_TOKEN
                    | syntax::SLASH_TOKEN
                    | syntax::PERCENT_TOKEN
                    | syntax::LESS_THAN_TOKEN
                    | syntax::LESS_THAN_EQUALS_TOKEN
                    | syntax::GREATER_THAN_TOKEN
                    | syntax::GREATER_THAN_EQUALS_TOKEN
                    | syntax::LESS_THAN_LESS_THAN_TOKEN
                    | syntax::GREATER_THAN_GREATER_THAN_TOKEN
                    | syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_TOKEN
                    | syntax::AMPERSAND_TOKEN
                    | syntax::BAR_TOKEN
                    | syntax::CARET_TOKEN,
                ) => true,
                // The read on the right of a number's compound assignment.
                Some(
                    syntax::PLUS_EQUALS_TOKEN
                    | syntax::MINUS_EQUALS_TOKEN
                    | syntax::ASTERISK_EQUALS_TOKEN
                    | syntax::ASTERISK_ASTERISK_EQUALS_TOKEN
                    | syntax::SLASH_EQUALS_TOKEN
                    | syntax::PERCENT_EQUALS_TOKEN
                    | syntax::LESS_THAN_LESS_THAN_EQUALS_TOKEN
                    | syntax::GREATER_THAN_GREATER_THAN_EQUALS_TOKEN
                    | syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_EQUALS_TOKEN
                    | syntax::AMPERSAND_EQUALS_TOKEN
                    | syntax::BAR_EQUALS_TOKEN
                    | syntax::CARET_EQUALS_TOKEN,
                ) => rhs == at && number(&lhs),
                _ => false,
            }
        }
        Some(syntax::PREFIX_UNARY_EXPRESSION) => matches!(
            probe.node(parent).data,
            nts_semantic_schema::NodeData::Children { small, .. }
                if matches!(small & syntax::prefix_operator::MASK,
                    syntax::prefix_operator::PLUS | syntax::prefix_operator::MINUS | syntax::prefix_operator::TILDE)
        ),
        // Converted to the declared `number` on the way out, by the erased
        // original as by the copy.
        Some(syntax::RETURN_STATEMENT) => {
            enclosing_function(probe, parent) == Some(declaration)
                && super::super::generics::declared_signature(probe.snapshot, declaration)
                    .and_then(|signature| probe.represent(signature.return_type))
                    == Some(HirType::NUMBER)
        }
        _ => false,
    }
}

fn binary_use_is_closed(probe: &FuncBuilder<'_>, children: &[NodeId]) -> bool {
    let [lhs, operator, rhs] = children else {
        return false;
    };
    // A recovered number/string does not prove mixed BigInt semantics.
    // Contextual literal lowering can otherwise round a BigInt to double
    // before comparing it. Native integer storage is outside this proof too.
    probe.kind_of(*operator).is_some_and(consumes_both_operands)
        && [lhs, rhs].into_iter().all(|operand| {
            !matches!(
                probe.type_of(*operand),
                Some(HirType::BigInt | HirType::Int { .. })
            )
        })
}

fn consumes_both_operands(operator: u16) -> bool {
    matches!(
        operator,
        syntax::PLUS_TOKEN
            | syntax::MINUS_TOKEN
            | syntax::ASTERISK_TOKEN
            | syntax::SLASH_TOKEN
            | syntax::PERCENT_TOKEN
            | syntax::LESS_THAN_TOKEN
            | syntax::LESS_THAN_EQUALS_TOKEN
            | syntax::GREATER_THAN_TOKEN
            | syntax::GREATER_THAN_EQUALS_TOKEN
            | syntax::EQUALS_EQUALS_TOKEN
            | syntax::EXCLAMATION_EQUALS_TOKEN
            | syntax::EQUALS_EQUALS_EQUALS_TOKEN
            | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
            | syntax::LESS_THAN_LESS_THAN_TOKEN
            | syntax::GREATER_THAN_GREATER_THAN_TOKEN
            | syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_TOKEN
            | syntax::AMPERSAND_TOKEN
            | syntax::BAR_TOKEN
            | syntax::CARET_TOKEN
    )
}

/// A producer's representation, rather than a type demanded by a use or an
/// assertion: a literal, a `new`, an array literal, a `const` alias, a
/// parameter or a declared function's result, at what [`recoverable`] admits.
pub(super) fn produced(
    probe: &FuncBuilder<'_>,
    argument: NodeId,
    copied: &std::collections::BTreeMap<u32, HirType>,
    depth: u32,
) -> Option<HirType> {
    if depth > 16 {
        return None;
    }
    let kind = probe.kind_of(argument)?;
    if kind == syntax::PARENTHESIZED_EXPRESSION {
        return produced(probe, *probe.children(argument).first()?, copied, depth + 1);
    }
    let represented = probe.type_of(argument)?;
    // **A producer that can be absent proves nothing.** `Point | null` and
    // `string | null` are one pointer each, the same representation as the
    // present type, so a copy taking `Point` would read a field through the
    // null its caller passed -- where node throws a TypeError reading `x` of
    // `null`. Asked of what the argument can produce, which for a getter read
    // is its declaration ([`FuncBuilder::read_type`]).
    if probe.absences_of(argument).is_some_and(|absent| !absent.is_empty()) {
        return None;
    }
    if kind == syntax::IDENTIFIER {
        let symbol = probe.node(argument).symbol?;
        if let Some(ty) = copied.get(&symbol.0) {
            return recoverable(probe, ty).then(|| ty.clone());
        }
        let record = probe.snapshot.symbols.get(symbol.0 as usize)?;
        let [declaration] = record.declarations.as_slice() else {
            return None;
        };
        match probe.kind_of(*declaration)? {
            syntax::PARAMETER
                if probe
                    .name_node(*declaration)
                    .and_then(|name| probe.type_of(name))
                    == Some(represented.clone()) => {}
            syntax::VARIABLE_DECLARATION
                if probe.declaration_kind(*declaration)
                    == nts_semantic_schema::VariableKind::Const =>
            {
                let initializer = *probe.children(*declaration).last()?;
                let evidence = produced(probe, initializer, copied, depth + 1)?;
                return (represented == evidence).then_some(evidence);
            }
            _ => return None,
        }
    } else if kind == syntax::CALL_EXPRESSION {
        let target = probe.snapshot.call_targets.get(&argument)?;
        let callee = target.callee?;
        if probe.kind_of(callee) != Some(syntax::FUNCTION_DECLARATION) {
            return None;
        }
        let signature = super::super::generics::declared_signature(probe.snapshot, callee)?;
        if probe.represent(signature.return_type)? != represented {
            return None;
        }
    } else if !matches!(
        kind,
        syntax::NUMERIC_LITERAL
            | syntax::STRING_LITERAL
            | syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL
            | syntax::TRUE_KEYWORD
            | syntax::FALSE_KEYWORD
            | syntax::PREFIX_UNARY_EXPRESSION
            | syntax::BINARY_EXPRESSION
            | syntax::NEW_EXPRESSION
            | syntax::ARRAY_LITERAL_EXPRESSION
    ) {
        return None;
    }
    recoverable(probe, &represented).then_some(represented)
}

/// A representation a producer can hand a copy's parameter. A managed value
/// is the same object either way, so its identity and every mutation through
/// it are shared with the caller: an instance of a nominal class, whose layout
/// is its own and whose subclasses lay their fields out after it, and an array
/// of what is itself recoverable. An interface or a structural type is not: a
/// value of it can have another layout, which only dispatch can read.
fn recoverable(probe: &FuncBuilder<'_>, ty: &HirType) -> bool {
    match ty {
        HirType::Managed(super::ManagedType::Object(class)) => {
            !super::super::is_closure_type(*class) && super::assertions::is_nominal_class(probe, *class)
        }
        HirType::Managed(super::ManagedType::Array(element)) => recoverable(probe, element),
        _ => primitive(ty),
    }
}

/// Recovered representations whose methods lower inline as primitive methods.
fn primitive(ty: &HirType) -> bool {
    matches!(ty, HirType::Bool | HirType::Managed(super::ManagedType::String)) || *ty == HirType::NUMBER
}

/// A primitive receiver changed by this copy is lowered inline by the
/// existing primitive-method paths, or refused. It cannot dispatch a user
/// function value. One fact for prediction, try analysis and body verification.
pub(super) fn inline_method(probe: &FuncBuilder<'_>, call: NodeId) -> bool {
    if probe.kind_of(call) != Some(syntax::CALL_EXPRESSION) {
        return false;
    }
    let Some(callee) = probe.children(call).first().copied() else {
        return false;
    };
    if probe.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
        return false;
    }
    let Some(receiver) = probe.children(callee).first().copied() else {
        return false;
    };
    if probe.kind_of(receiver) != Some(syntax::IDENTIFIER) {
        return false;
    }
    probe
        .node(receiver)
        .symbol
        .and_then(|symbol| probe.retyped_symbols.get(&symbol.0))
        .is_some_and(primitive)
}

/// Exception eligibility belongs to a specialization, not to the unspecialized
/// declaration. Reuse the existing try/call proof in each copy's context, then
/// remove upstream copies when a selected callee cannot carry exceptions.
pub(super) fn raising_copies(
    snapshot: &super::SemanticSnapshot,
    hierarchy: &super::Hierarchy,
    naming: &super::Naming,
    structural: &mut super::Structural,
) {
    if structural.erased_copies.is_empty()
        || !snapshot
            .nodes
            .iter()
            .any(|node| node.kind == nts_semantic_schema::NodeKind::Syntax(syntax::TRY_STATEMENT))
    {
        return;
    }
    structural.raising.clone_from(&structural.erased_copies);
    let mut keys: Vec<_> = structural.erased_copies.iter().cloned().collect();
    keys.sort_by(|a, b| (a.0.0, &a.1).cmp(&(b.0.0, &b.1)));
    let mut consumers: FxHashMap<(NodeId, String), Vec<(NodeId, String)>> = FxHashMap::default();
    let mut invalid = Vec::new();
    for key in &keys {
        let Some(retyped) = structural
            .copies
            .get(&key.0)
            .into_iter()
            .flatten()
            .find_map(|(retyped, suffix)| (suffix == &key.1).then_some(retyped))
        else {
            continue;
        };
        let mut probe = FuncBuilder::probe(snapshot);
        probe.hierarchy = hierarchy.clone();
        probe.raising.clone_from(&naming.raising);
        probe.throwing.clone_from(&naming.throwing);
        probe.retyped_symbols = super::retyped_symbols_of(&probe, key.0, retyped);
        structural.wire_calls(&mut probe, &key.1);
        let mut selected = FxHashMap::default();
        for context in ["", key.1.as_str()] {
            if let Some(calls) = structural.at_call.get(context) {
                selected.extend(calls.iter());
            }
        }
        for call in super::calls_in_the_body_of(&probe, key.0) {
            if probe.call_within(call, &mut Vec::new()).is_some() {
                invalid.push(key.clone());
            }
            if let Some((suffix, _)) = selected.get(&call)
                && let Some(callee) = snapshot
                    .call_targets
                    .get(&call)
                    .and_then(|target| target.callee)
                && !naming.raising.contains(&callee)
            {
                let target = (callee, suffix.clone());
                if structural.raising.contains(&target) {
                    consumers.entry(target).or_default().push(key.clone());
                }
            }
        }
    }
    while let Some(key) = invalid.pop() {
        if structural.raising.remove(&key) {
            invalid.extend(consumers.get(&key).into_iter().flatten().cloned());
        }
    }
}
