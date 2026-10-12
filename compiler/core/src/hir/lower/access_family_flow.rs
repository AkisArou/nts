//! Concrete suppliers follow value transfers, not coincident member names.
//!
//! This graph carries source layout identities through coercion contexts.
//! Nested contracts transfer their payloads separately from their containers.
//! Erased source contracts retain all incoming layouts; an assertion cannot discard
//! a supplier's actual representation or absence. Each owner fact crosses an
//! edge once, using a worklist rather than rescanning the graph to convergence.
//!
//! The native JS boundary does not inject managed records: object and
//! reference-array parameters/setters are outward-only, and erased arguments
//! accept primitives. Exported record results are copies, so their managed
//! layout cannot come back through an interface argument. A published class
//! constructs its own receiver layout, already seeded here; its source field,
//! callback and result transfers supply the receiving contracts. Foreign/native
//! source call signatures and any/unknown contracts keep their conservative
//! incoming identities. An unproven family stays on the existing field path
//! and layout guard. Adding an inbound managed-object bridge must extend this
//! bound with the layouts that bridge constructs or can reintroduce.

use std::collections::VecDeque;

use rustc_hash::{FxHashMap, FxHashSet};

use super::{FuncBuilder, NodeId, TypeId, TypeKind, interfaces, syntax};

#[derive(Debug, Clone, Default)]
pub(super) struct Bound {
    actual: FxHashSet<TypeId>,
    suppliers: FxHashMap<TypeId, FxHashSet<TypeId>>,
}

impl Bound {
    pub(super) fn collect(
        probe: &FuncBuilder<'_>,
        owners: &[TypeId],
        literals: &std::collections::BTreeMap<TypeId, Vec<NodeId>>,
        faces: impl Iterator<Item = TypeId>,
    ) -> Self {
        let mut graph = Graph::new(probe);
        // A declaration-only reservation creates no object. It can reserve
        // the existing alias geometry, but never seeds an actual supplier.
        let actual: FxHashSet<_> = owners.iter().copied().collect();
        for owner in owners {
            graph.seed(*owner);
        }
        let literal_owner: FxHashMap<_, _> = literals
            .iter()
            .flat_map(|(owner, sites)| sites.iter().map(|site| (*site, *owner)))
            .collect();
        let reached = reachable_sites(probe);
        for index in 0..probe.snapshot.nodes.len() {
            let Ok(index) = u32::try_from(index) else {
                continue;
            };
            let at = NodeId(index);
            if reached.contains(at) {
                graph.site(at, &literal_owner);
            }
        }
        Self {
            actual,
            suppliers: graph.finish(faces),
        }
    }

    pub(super) fn permits(&self, owner: TypeId, face: TypeId) -> bool {
        !self.actual.contains(&owner)
            || self
                .suppliers
                .get(&face)
                .is_some_and(|suppliers| suppliers.contains(&owner))
    }
}

/// Source exports and module evaluation can reach code before a backend is
/// chosen. Imported helper exports are conservative roots too; an unreferenced
/// private declaration is not an executed coercion merely because it has a body.
fn reachable_sites(probe: &FuncBuilder<'_>) -> nts_semantic_schema::reachability::Reachability {
    let modules: Vec<_> = probe
        .snapshot
        .modules
        .iter()
        .filter(|module| !super::is_declaration_file(probe.snapshot, module))
        .collect();
    let roots = modules
        .iter()
        .flat_map(|module| module.exports.iter().map(|(_, symbol)| *symbol));
    let statements = modules
        .iter()
        .flat_map(|module| probe.children(module.root))
        .filter(|at| {
            probe.kind_of(*at).is_some_and(super::is_module_statement)
                || super::runs_a_static_initializer(probe, *at)
        });
    nts_semantic_schema::reachability::from_roots(probe.snapshot, roots, statements)
}

struct Graph<'p, 's> {
    probe: &'p FuncBuilder<'s>,
    edges: Vec<FxHashSet<usize>>,
    facts: Vec<FxHashSet<TypeId>>,
    pairs: FxHashSet<(TypeId, TypeId)>,
}

impl<'p, 's> Graph<'p, 's> {
    fn new(probe: &'p FuncBuilder<'s>) -> Self {
        let count = probe.snapshot.types.len();
        Self {
            probe,
            edges: vec![FxHashSet::default(); count],
            facts: vec![FxHashSet::default(); count],
            pairs: FxHashSet::default(),
        }
    }

    fn index(ty: TypeId) -> usize {
        // Physical erasure is not a source value transfer. In particular,
        // number|undefined and string|undefined cannot exchange objects just
        // because both use NtsValue storage. Shared any/unknown source types
        // conservatively join values that actually enter those contracts.
        ty.0 as usize
    }

    fn seed(&mut self, owner: TypeId) {
        let at = Self::index(owner);
        if let Some(facts) = self.facts.get_mut(at) {
            facts.insert(owner);
        }
    }

    fn expression(&self, at: NodeId, literals: &FxHashMap<NodeId, TypeId>) -> Option<TypeId> {
        literals
            .get(&at)
            .copied()
            .or_else(|| self.probe.snapshot.node_types.get(&at).copied())
    }

    fn transfer(&mut self, source: Option<TypeId>, target: Option<TypeId>) {
        if let (Some(source), Some(target)) = (source, target) {
            self.connect(source, target);
        }
    }

    fn connect(&mut self, source: TypeId, target: TypeId) {
        let mut pending = vec![(source, target)];
        while let Some((source, target)) = pending.pop() {
            if !self.pairs.insert((source, target)) {
                continue;
            }
            let (Some(source_kind), Some(target_kind)) = (
                self.probe.snapshot.types.get(source.0 as usize),
                self.probe.snapshot.types.get(target.0 as usize),
            ) else {
                continue;
            };
            // Scalar payload conversion cannot transport an object identity.
            // Erased storage can: its tag still says which layout it holds.
            if identity_type(&target_kind.kind) {
                let (from, to) = (Self::index(source), Self::index(target));
                if from != to {
                    self.edges[from].insert(to);
                }
            }
            match (&source_kind.kind, &target_kind.kind) {
                (TypeKind::Union(items) | TypeKind::Intersection(items), _) => {
                    pending.extend(items.iter().map(|item| (*item, target)));
                }
                (_, TypeKind::Union(items) | TypeKind::Intersection(items)) => {
                    pending.extend(items.iter().map(|item| (source, *item)));
                }
                (TypeKind::Array(one), TypeKind::Array(other)) => {
                    pending.push((*one, *other));
                }
                (TypeKind::Tuple(one), TypeKind::Tuple(other)) => {
                    pending.extend(one.iter().copied().zip(other.iter().copied()));
                }
                (TypeKind::Tuple(items), TypeKind::Array(element)) => {
                    pending.extend(items.iter().map(|item| (*item, *element)));
                }
                (TypeKind::Array(element), TypeKind::Tuple(items)) => {
                    pending.extend(items.iter().map(|item| (*element, *item)));
                }
                (TypeKind::Object { properties: one }, TypeKind::Object { properties: other }) => {
                    for wanted in other {
                        if let Some(found) = one.iter().find(|found| found.name == wanted.name) {
                            pending.push((found.ty, wanted.ty));
                        }
                    }
                }
                (TypeKind::Function(one), TypeKind::Function(other)) => {
                    let one = &self.probe.snapshot.signatures[one.0 as usize];
                    let other = &self.probe.snapshot.signatures[other.0 as usize];
                    pending.push((one.return_type, other.return_type));
                    // Arguments arrive from the receiving callable contract.
                    if let (Some(contract), Some(implementation)) = (other.this_type, one.this_type)
                    {
                        pending.push((contract, implementation));
                    }
                    pending.extend(
                        one.parameters
                            .iter()
                            .zip(&other.parameters)
                            .map(|(implementation, contract)| (contract.ty, implementation.ty)),
                    );
                }
                _ => {}
            }
        }
    }

    fn declared(&self, at: NodeId) -> Option<TypeId> {
        let probe = self.probe;
        let name = probe.children(at).into_iter().find(|child| {
            matches!(
                probe.kind_of(*child),
                Some(
                    syntax::IDENTIFIER
                        | syntax::OBJECT_BINDING_PATTERN
                        | syntax::ARRAY_BINDING_PATTERN
                )
            )
        });
        name.and_then(|name| probe.snapshot.node_types.get(&name).copied())
            .or_else(|| probe.snapshot.node_types.get(&at).copied())
    }

    fn result(&self, callable: NodeId) -> Option<TypeId> {
        if self.probe.kind_of(callable) == Some(syntax::GET_ACCESSOR) {
            return self.probe.snapshot.node_types.get(&callable).copied();
        }
        super::super::generics::declared_signature(self.probe.snapshot, callable)
            .map(|signature| signature.return_type)
    }

    fn site(&mut self, at: NodeId, literals: &FxHashMap<NodeId, TypeId>) {
        let probe = self.probe;
        let type_at = |at: NodeId| probe.snapshot.node_types.get(&at).copied();
        match probe.kind_of(at) {
            Some(
                syntax::VARIABLE_DECLARATION | syntax::PROPERTY_DECLARATION | syntax::PARAMETER,
            ) => {
                let initializer = if probe.kind_of(at) == Some(syntax::PROPERTY_DECLARATION) {
                    probe.child_slots::<5>(at).and_then(|slots| slots[4])
                } else {
                    probe.child_slots::<4>(at).and_then(|slots| slots[3])
                };
                if let Some(initializer) = initializer {
                    self.transfer(self.expression(initializer, literals), self.declared(at));
                }
            }
            Some(syntax::IDENTIFIER) => self.identifier(at),
            Some(syntax::BINARY_EXPRESSION) => self.assignment(at, literals),
            Some(syntax::CONDITIONAL_EXPRESSION) => {
                if let Some([_, _, one, _, other]) = probe.child_slots::<5>(at) {
                    for value in one.into_iter().chain(other) {
                        self.transfer(self.expression(value, literals), type_at(at));
                    }
                }
            }
            Some(syntax::RETURN_STATEMENT) => {
                if let Some(value) = probe.children(at).first()
                    && let Some(callable) = probe.enclosing_callable(at)
                {
                    self.transfer(self.expression(*value, literals), self.result(callable));
                }
            }
            Some(syntax::ARROW_FUNCTION) => {
                if let Some(body) = probe.children(at).last()
                    && probe.kind_of(*body) != Some(syntax::BLOCK)
                {
                    self.transfer(self.expression(*body, literals), self.result(at));
                }
            }
            Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION) => self.call(at, literals),
            Some(
                syntax::AS_EXPRESSION
                | syntax::TYPE_ASSERTION_EXPRESSION
                | syntax::SATISFIES_EXPRESSION
                | syntax::NON_NULL_EXPRESSION
                | syntax::PARENTHESIZED_EXPRESSION,
            ) => {
                if let Some(value) = probe
                    .children(at)
                    .into_iter()
                    .find(|child| !syntax::is_type_node(probe.kind_of(*child).unwrap_or(0)))
                {
                    self.transfer(self.expression(value, literals), type_at(at));
                }
            }
            Some(syntax::OBJECT_LITERAL_EXPRESSION) => self.object_literal(at, literals),
            Some(syntax::ARRAY_LITERAL_EXPRESSION) => {
                let element = type_at(at).and_then(|ty| {
                    match &probe.snapshot.types.get(ty.0 as usize)?.kind {
                        TypeKind::Array(element) => Some(*element),
                        _ => None,
                    }
                });
                for value in probe.children(at) {
                    self.transfer(self.expression(value, literals), element);
                }
            }
            Some(syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION) => {
                self.transfer(self.stored_type(at), type_at(at));
            }
            Some(syntax::BINDING_ELEMENT) => self.binding(at, literals),
            Some(syntax::FOR_OF_STATEMENT) => {
                if let Some([_, Some(binding), Some(iterable), _]) = probe.child_slots::<4>(at) {
                    let element = type_at(iterable).and_then(|ty| self.array_element(ty));
                    let declarations =
                        if probe.kind_of(binding) == Some(syntax::VARIABLE_DECLARATION_LIST) {
                            probe.children(binding)
                        } else {
                            vec![binding]
                        };
                    for declaration in declarations {
                        self.transfer(
                            element,
                            self.declared(declaration).or_else(|| type_at(declaration)),
                        );
                    }
                }
            }
            _ => {}
        }
    }

    fn identifier(&mut self, at: NodeId) {
        let probe = self.probe;
        let type_at = |at: NodeId| probe.snapshot.node_types.get(&at).copied();
        if !probe.names_a_member(at)
            && let Some(declaration) = probe
                .node(at)
                .symbol
                .and_then(|symbol| probe.snapshot.symbols.get(symbol.0 as usize))
                .and_then(|symbol| symbol.declarations.first())
                .copied()
            && matches!(
                probe.kind_of(declaration),
                Some(syntax::VARIABLE_DECLARATION | syntax::PARAMETER | syntax::BINDING_ELEMENT)
            )
        {
            self.transfer(self.declared(declaration), type_at(at));
        }
    }

    fn assignment(&mut self, at: NodeId, literals: &FxHashMap<NodeId, TypeId>) {
        let probe = self.probe;
        let type_at = |at: NodeId| probe.snapshot.node_types.get(&at).copied();
        if let [left, operator, right] = probe.children(at).as_slice() {
            if matches!(
                probe.kind_of(*operator),
                Some(
                    syntax::BAR_BAR_TOKEN
                        | syntax::AMPERSAND_AMPERSAND_TOKEN
                        | syntax::QUESTION_QUESTION_TOKEN
                )
            ) {
                self.transfer(self.expression(*left, literals), type_at(at));
                self.transfer(self.expression(*right, literals), type_at(at));
            }
            if probe.kind_of(*operator) != Some(syntax::EQUALS_TOKEN) {
                return;
            }
            let wanted = self.stored_type(*left).or_else(|| type_at(*left));
            self.transfer(self.expression(*right, literals), wanted);
        }
    }

    fn call(&mut self, at: NodeId, literals: &FxHashMap<NodeId, TypeId>) {
        let probe = self.probe;
        let type_at = |at: NodeId| probe.snapshot.node_types.get(&at).copied();
        // CallableFunction.call/apply/bind have their own library signature.
        // The first argument is received by the underlying function's `this`
        // contract, not by the library wrapper's callable receiver contract.
        let function = probe.through_call_or_apply(at).or_else(|| {
            let callee = probe.through_assertions(*probe.children(at).first()?);
            let (function, name) = probe.member_access(callee)?;
            let member = *probe.children(callee).last()?;
            let ty = *probe.snapshot.node_types.get(&function)?;
            (name == "bind" && probe.function_type_of_receiver(member, ty).is_some())
                .then_some(function)
        });
        if let Some(function) = function
            && let Some(ty) = type_at(function)
            && let Some(TypeKind::Function(signature)) = probe
                .snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind)
            && let Some(this_type) = probe.snapshot.signatures[signature.0 as usize].this_type
            && let Some(receiver) = probe.arguments_of(at).first()
        {
            self.transfer(self.expression(*receiver, literals), Some(this_type));
        }
        if let Some(signature) = probe
            .snapshot
            .call_targets
            .get(&at)
            .and_then(|target| probe.snapshot.signatures.get(target.signature.0 as usize))
        {
            let mut first_spread = None;
            for (index, argument) in probe.arguments_of(at).iter().enumerate() {
                let spread = probe.kind_of(*argument) == Some(syntax::SPREAD_ELEMENT);
                if spread {
                    first_spread.get_or_insert(index);
                }
                let parameters: Vec<_> = if let Some(first) = first_spread {
                    // A spread can change every later argument position. Keep
                    // each possible receiving contract, including rest storage.
                    signature.parameters.iter().skip(first).collect()
                } else {
                    signature
                        .parameters
                        .get(index)
                        .or_else(|| {
                            signature
                                .parameters
                                .last()
                                .filter(|parameter| parameter.rest)
                        })
                        .into_iter()
                        .collect()
                };
                for parameter in parameters {
                    let target = if parameter.rest {
                        self.array_element(parameter.ty).unwrap_or(parameter.ty)
                    } else {
                        parameter.ty
                    };
                    if spread {
                        if let Some(source) = probe
                            .children(*argument)
                            .first()
                            .and_then(|source| self.expression(*source, literals))
                        {
                            match &probe.snapshot.types[source.0 as usize].kind {
                                TypeKind::Array(element) => {
                                    self.transfer(Some(*element), Some(target));
                                }
                                TypeKind::Tuple(elements) => {
                                    for element in elements {
                                        self.transfer(Some(*element), Some(target));
                                    }
                                }
                                _ => self.transfer(Some(source), Some(target)),
                            }
                        }
                    } else {
                        self.transfer(self.expression(*argument, literals), Some(target));
                    }
                }
            }
            if let Some(this_type) = signature.this_type
                && let Some(callee) = probe.children(at).first()
                && let Some((receiver, _)) = probe.member_access(*callee)
            {
                self.transfer(self.expression(receiver, literals), Some(this_type));
            }
            self.transfer(Some(signature.return_type), type_at(at));
        }
    }

    fn object_literal(&mut self, at: NodeId, literals: &FxHashMap<NodeId, TypeId>) {
        let probe = self.probe;
        if let Some(owner) = literals.get(&at) {
            for field in probe.children(at) {
                if !matches!(
                    probe.kind_of(field),
                    Some(syntax::PROPERTY_ASSIGNMENT | syntax::SHORTHAND_PROPERTY_ASSIGNMENT)
                ) {
                    continue;
                }
                let children = probe.children(field);
                let Some(name) = children.first().and_then(|name| probe.literal_name(*name)) else {
                    continue;
                };
                let Some(value) = children.last() else {
                    continue;
                };
                let wanted =
                    interfaces::property(probe.snapshot, *owner, &name).map(|property| property.ty);
                self.transfer(self.expression(*value, literals), wanted);
            }
        }
    }

    fn binding(&mut self, at: NodeId, literals: &FxHashMap<NodeId, TypeId>) {
        let probe = self.probe;
        let type_at = |at: NodeId| probe.snapshot.node_types.get(&at).copied();
        if let Some(pattern) = probe.node(at).parent {
            let owner = type_at(pattern);
            if let Some([_, property, name, initializer]) = probe.child_slots::<4>(at) {
                let member = property.or(name).and_then(|name| probe.literal_name(name));
                let stored = owner.and_then(|owner| {
                    member
                        .as_ref()
                        .and_then(|member| {
                            interfaces::property(probe.snapshot, owner, member)
                                .map(|property| property.ty)
                        })
                        .or_else(|| self.array_element(owner))
                });
                self.transfer(stored, self.declared(at));
                if let Some(initializer) = initializer {
                    self.transfer(self.expression(initializer, literals), self.declared(at));
                }
            }
        }
    }

    fn array_element(&self, ty: TypeId) -> Option<TypeId> {
        match &self.probe.snapshot.types.get(ty.0 as usize)?.kind {
            TypeKind::Array(element) => Some(*element),
            _ => None,
        }
    }

    fn stored_type(&self, at: NodeId) -> Option<TypeId> {
        let probe = self.probe;
        if let Some((receiver, member)) = probe.member_access(at) {
            let receiver = probe.snapshot.node_types.get(&receiver)?;
            return interfaces::property(probe.snapshot, *receiver, &member)
                .map(|property| property.ty);
        }
        if probe.kind_of(at) == Some(syntax::ELEMENT_ACCESS_EXPRESSION) {
            let receiver = *probe.children(at).first()?;
            let receiver = *probe.snapshot.node_types.get(&receiver)?;
            return self.array_element(receiver);
        }
        None
    }

    fn finish(
        mut self,
        faces: impl Iterator<Item = TypeId>,
    ) -> FxHashMap<TypeId, FxHashSet<TypeId>> {
        let mut pending = VecDeque::new();
        for (at, owners) in self.facts.iter().enumerate() {
            pending.extend(owners.iter().map(|owner| (at, *owner)));
        }
        while let Some((at, owner)) = pending.pop_front() {
            for target in &self.edges[at] {
                if self.facts[*target].insert(owner) {
                    pending.push_back((*target, owner));
                }
            }
        }
        let mut result = FxHashMap::default();
        for id in faces {
            let at = Self::index(id);
            if !self.facts[at].is_empty() {
                result.insert(id, self.facts[at].clone());
            }
        }
        result
    }
}

fn identity_type(kind: &TypeKind) -> bool {
    matches!(
        kind,
        TypeKind::Any
            | TypeKind::Unknown
            | TypeKind::Evolving
            | TypeKind::Object { .. }
            | TypeKind::Array(_)
            | TypeKind::Tuple(_)
            | TypeKind::Union(_)
            | TypeKind::Intersection(_)
            | TypeKind::Function(_)
            | TypeKind::TypeParameter { .. }
            | TypeKind::Unsupported { .. }
    )
}
