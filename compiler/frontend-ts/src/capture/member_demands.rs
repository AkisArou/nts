//! Implicit source operations request contracts just as explicit calls do.
//! These are transient graph demands, not runtime or representation facts.

use nts_frontend_tsrs::{ChildRole as C, ListRole as L, Node};
use nts_semantic_schema::{
    Library, NodeKind, PropertyKey, SemanticSnapshot, SymbolFlags, TypeId, TypeKind,
    WellKnownSymbol, syntax,
};
use rustc_hash::{FxHashMap, FxHashSet};

use super::Capture;

const ITERABLE: u8 = 1;
const ASYNC_ITERABLE: u8 = 2;
const ITERATOR: u8 = 4;
const COERCION: u8 = 8;
const RETURNS_ITERATOR: u8 = 16;

#[derive(Default)]
pub(super) struct MemberDemands {
    requested: FxHashMap<TypeId, u8>,
    pending: FxHashSet<TypeId>,
}

impl MemberDemands {
    fn request(&mut self, id: TypeId, demand: u8, work: &mut Vec<TypeId>) {
        if demand == 0 {
            return;
        }
        let previous = self.requested.entry(id).or_default();
        if demand & !*previous != 0 {
            *previous |= demand;
            if self.pending.insert(id) {
                work.push(id);
            }
        }
    }

    pub(super) fn contains(&self, id: TypeId) -> bool {
        self.requested.contains_key(&id)
    }

    pub(super) fn take_pending(&mut self, id: TypeId, kind: nts_frontend_tsrs::TypeKind) -> bool {
        use nts_frontend_tsrs::TypeKind as N;
        // Primitive records are already complete; requesting conversion of a
        // number/string must never send it through object decomposition.
        self.pending.remove(&id)
            && matches!(
                kind,
                N::Object | N::Reference | N::Tuple | N::Union | N::Intersection | N::TypeParameter
            )
    }

    pub(super) fn demands(
        &self,
        id: TypeId,
        key: &PropertyKey,
        snapshot: &SemanticSnapshot,
    ) -> bool {
        let demand = self.requested.get(&id).copied().unwrap_or(0);
        (demand & (ITERABLE | ASYNC_ITERABLE) != 0
            && snapshot.key_is_well_known(key, WellKnownSymbol::Iterator))
            || (demand & ASYNC_ITERABLE != 0
                && snapshot.key_is_well_known(key, WellKnownSymbol::AsyncIterator))
            || (demand & ITERATOR != 0
                && matches!(key.public_name(), Some("next" | "return" | "throw")))
            || (demand & COERCION != 0
                && (matches!(key.public_name(), Some("toString" | "valueOf"))
                    || snapshot.key_is_well_known(key, WellKnownSymbol::ToPrimitive)))
    }

    pub(super) fn follow_member(
        &mut self,
        owner: TypeId,
        key: &PropertyKey,
        ty: TypeId,
        snapshot: &SemanticSnapshot,
        work: &mut Vec<TypeId>,
    ) {
        if self.demands(owner, key, snapshot)
            && (snapshot.key_is_well_known(key, WellKnownSymbol::Iterator)
                || snapshot.key_is_well_known(key, WellKnownSymbol::AsyncIterator))
        {
            self.request(ty, RETURNS_ITERATOR, work);
        }
    }

    pub(super) fn follow(
        &mut self,
        id: TypeId,
        kind: &TypeKind,
        snapshot: &SemanticSnapshot,
        work: &mut Vec<TypeId>,
    ) {
        let demand = self.requested.get(&id).copied().unwrap_or(0);
        match kind {
            TypeKind::Union(parts) | TypeKind::Intersection(parts) => {
                for &part in parts {
                    self.request(part, demand, work);
                }
            }
            TypeKind::TypeParameter {
                constraint: Some(ty),
                ..
            } => self.request(*ty, demand, work),
            TypeKind::Function(signature) if demand & RETURNS_ITERATOR != 0 => {
                self.request(
                    snapshot.signatures[signature.0 as usize].return_type,
                    ITERATOR,
                    work,
                );
            }
            _ => {}
        }
    }
}

impl<'p> Capture<'p, '_> {
    pub(super) fn member_demands(&self, work: &mut Vec<TypeId>) -> MemberDemands {
        let mut demands = MemberDemands::default();
        let mut request = |node: Node<'_>, demand| {
            if let Some(id) = self
                .nodes
                .get(&node)
                .and_then(|id| self.snapshot.node_types.get(id))
            {
                demands.request(*id, demand, work);
            }
        };
        // Native child roles select already captured coordinates/types only.
        // This scan performs no checker query and adds no source root.
        for (index, node) in self.native_nodes.iter().enumerate() {
            let Some(node) = *node else { continue };
            let kind = self.snapshot.nodes[index].kind;
            match kind {
                NodeKind::Syntax(syntax::FOR_OF_STATEMENT) => {
                    if let Some(source) = node.child(C::ForInOrOfStatementExpression) {
                        request(
                            source,
                            if node.child(C::ForInOrOfStatementAwaitModifier).is_some() {
                                ASYNC_ITERABLE
                            } else {
                                ITERABLE
                            },
                        );
                    }
                }
                NodeKind::Syntax(syntax::SPREAD_ELEMENT) => {
                    if let Some(source) = node.child(C::SpreadElementExpression) {
                        request(source, ITERABLE);
                    }
                }
                NodeKind::Syntax(syntax::YIELD_EXPRESSION) => {
                    if node.child(C::YieldExpressionAsteriskToken).is_some()
                        && let Some(source) = node.child(C::YieldExpressionExpression)
                    {
                        request(source, ASYNC_ITERABLE);
                    }
                }
                NodeKind::Syntax(syntax::VARIABLE_DECLARATION | syntax::PARAMETER) => {
                    if let Some(source) = self.destructured_input(node, kind) {
                        request(source, ITERABLE);
                    }
                }
                NodeKind::Syntax(syntax::TEMPLATE_SPAN) => {
                    if let Some(source) = node.child(C::TemplateSpanExpression) {
                        request(source, COERCION);
                    }
                }
                NodeKind::Syntax(syntax::BINARY_EXPRESSION) => {
                    let operator = node
                        .child(C::BinaryExpressionOperatorToken)
                        .and_then(|n| self.nodes.get(&n))
                        .map(|id| self.snapshot.nodes[id.0 as usize].kind);
                    let left = node.child(C::BinaryExpressionLeft);
                    let right = node.child(C::BinaryExpressionRight);
                    if matches!(
                        operator,
                        Some(NodeKind::Syntax(
                            syntax::PLUS_TOKEN
                                | syntax::PLUS_EQUALS_TOKEN
                                | syntax::LESS_THAN_TOKEN
                                | syntax::GREATER_THAN_TOKEN
                                | syntax::LESS_THAN_EQUALS_TOKEN
                                | syntax::GREATER_THAN_EQUALS_TOKEN
                        ))
                    ) {
                        for source in [left, right].into_iter().flatten() {
                            request(source, COERCION);
                        }
                    } else if operator == Some(NodeKind::Syntax(syntax::EQUALS_TOKEN))
                        && left.and_then(|n| self.nodes.get(&n)).is_some_and(|id| {
                            self.snapshot.nodes[id.0 as usize].kind
                                == NodeKind::Syntax(syntax::ARRAY_LITERAL_EXPRESSION)
                        })
                        && let Some(source) = right
                    {
                        request(source, ITERABLE);
                    }
                }
                NodeKind::Syntax(syntax::CALL_EXPRESSION) => {
                    if let Some(source) = self.array_from_input(node) {
                        request(source, ITERABLE);
                    }
                }
                _ => {}
            }
        }
        demands
    }

    fn destructured_input(&self, node: Node<'p>, kind: NodeKind) -> Option<Node<'p>> {
        let (name, value) = if kind == NodeKind::Syntax(syntax::PARAMETER) {
            (
                C::ParameterDeclarationName,
                C::ParameterDeclarationInitializer,
            )
        } else {
            (
                C::VariableDeclarationName,
                C::VariableDeclarationInitializer,
            )
        };
        let name = self.nodes.get(&node.child(name)?)?;
        (self.snapshot.nodes[name.0 as usize].kind
            == NodeKind::Syntax(syntax::ARRAY_BINDING_PATTERN))
        .then(|| node.child(value).unwrap_or(node))
    }

    fn array_from_input(&self, node: Node<'p>) -> Option<Node<'p>> {
        let callee = node.child(C::CallExpressionExpression)?;
        let object = callee.child(C::PropertyAccessExpressionExpression)?;
        if callee.child(C::PropertyAccessExpressionName)?.name_text() != Some("from") {
            return None;
        }
        let symbol = self.snapshot.nodes[self.nodes.get(&object)?.0 as usize].symbol?;
        let symbol = &self.snapshot.symbols[symbol.0 as usize];
        if symbol.name.is_name("Array")
            && symbol.library == Some(Library::Es)
            && symbol.flags.contains(SymbolFlags::GLOBAL_VALUE)
        {
            node.list(L::CallExpressionArguments)?.iter().next()
        } else {
            None
        }
    }
}
