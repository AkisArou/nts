//! Program requirements before provider selection or lowering. All decisions
//! use checked snapshot facts; this pass performs no I/O or native queries.

use std::collections::HashMap;

use nts_diagnostics::{Digest, Location};
use nts_semantic_schema::{
    BuiltinBinding, Library, NodeData, NodeId, NodeKind, SemanticSnapshot, SnapshotError, SymbolId,
    reachability::{self, Demand, Edge},
    syntax, walk,
};

use super::{FeatureBindings, GlobalMeaning};

/// One canonical library global, independent of aliases and value/type uses.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FeatureId {
    pub library: Library,
    pub name: String,
}

impl FeatureId {
    fn order(&self) -> (&str, &str, &str) {
        match &self.library {
            Library::Es => ("es", "", &self.name),
            Library::Dom => ("web", "", &self.name),
            Library::Node => ("node", "", &self.name),
            Library::Package(package) => ("package", package, &self.name),
        }
    }
}

/// Erased annotations and availability observations never require a provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum FeatureUse {
    TypeOnly,
    Probe,
    Runtime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureWitness {
    pub node: NodeId,
    pub location: Location,
    pub meaning: GlobalMeaning,
    pub use_kind: FeatureUse,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReachedFeature {
    pub feature: FeatureId,
    pub witnesses: Vec<FeatureWitness>,
}

impl ReachedFeature {
    #[must_use]
    pub fn requires_provider(&self) -> bool {
        self.witnesses
            .iter()
            .any(|witness| witness.use_kind == FeatureUse::Runtime)
    }
}

/// A supported availability expression and the target/profile's answer. An
/// unresolved binding or dynamic key is unknown, never an absent provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AvailabilityProbe {
    pub node: NodeId,
    pub feature: Option<FeatureId>,
    pub available: Option<bool>,
}

/// Requirements and the reach plan that produced them form one sealed result.
/// Only the checked walk constructs it; callers can inspect, but cannot remove
/// witnesses while retaining a plan that validates against the checked inputs.
///
/// ```compile_fail,E0616
/// use nts_core::hir::features::ReachedFeatures;
/// fn truncate(mut reached: ReachedFeatures) {
///     reached.features.clear();
/// }
/// ```
///
/// ```compile_fail,E0616
/// use nts_core::hir::features::ReachedFeatures;
/// fn truncate(mut reached: ReachedFeatures) {
///     reached.probes.clear();
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReachedFeatures {
    /// Canonically sorted, with each feature appearing once for the program.
    features: Vec<ReachedFeature>,
    probes: Vec<AvailabilityProbe>,
    plan: FeatureReachPlan,
}

/// The checked revision and target/profile supplied by the capture/resolver.
/// A new checking revision gets a new identity even if source bytes are equal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReachContext {
    pub revision: Digest,
    pub profile: Digest,
}

/// The single reached definition to be consumed by resolution and lowering.
/// Arena IDs are licensed only for this snapshot, product roots and profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureReachPlan {
    snapshot: Digest,
    roots: Vec<SymbolId>,
    root_nodes: Vec<NodeId>,
    context: ReachContext,
    reached: Vec<NodeId>,
    demanded: Vec<(NodeId, Demand)>,
    guards: Vec<(NodeId, bool)>,
    work: ReachWork,
}

/// Counts at the actual graph, statement-index and membership operations.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ReachWork {
    pub graph_edges: usize,
    pub statement_index_visits: usize,
    pub statement_membership_checks: usize,
    pub normalization_visits: usize,
    pub probe_role_checks: usize,
    pub binding_cache_misses: usize,
    pub owner_hops: usize,
    pub alias_hops: usize,
}
impl ReachedFeatures {
    #[must_use]
    pub fn features(&self) -> &[ReachedFeature] {
        &self.features
    }
    #[must_use]
    pub fn probes(&self) -> &[AvailabilityProbe] {
        &self.probes
    }
    #[must_use]
    pub const fn plan(&self) -> &FeatureReachPlan {
        &self.plan
    }
}
impl FeatureReachPlan {
    #[must_use]
    pub const fn work(&self) -> ReachWork {
        self.work
    }
    #[must_use]
    pub fn validates(
        &self,
        snapshot: &SemanticSnapshot,
        roots: &[SymbolId],
        nodes: &[NodeId],
        context: ReachContext,
    ) -> bool {
        let mut roots = roots.to_vec();
        roots.sort_unstable();
        roots.dedup();
        let mut nodes = nodes.to_vec();
        nodes.sort_unstable();
        nodes.dedup();
        snapshot
            .digest()
            .is_ok_and(|digest| self.snapshot == Digest(digest))
            && self.roots == roots
            && self.root_nodes == nodes
            && self.context == context
    }
    #[must_use]
    pub fn reached(&self, node: NodeId) -> bool {
        self.reached.binary_search(&node).is_ok()
    }
    #[must_use]
    pub fn demanded(&self, node: NodeId) -> bool {
        self.demand(node) != Demand::Definition
    }
    #[must_use]
    pub fn demand(&self, node: NodeId) -> Demand {
        self.demanded
            .binary_search_by_key(&node, |(node, _)| *node)
            .ok()
            .map_or(Demand::Definition, |at| self.demanded[at].1)
    }
    #[must_use]
    pub fn folded_guard(&self, node: NodeId) -> Option<bool> {
        self.guards
            .binary_search_by_key(&node, |(node, _)| *node)
            .ok()
            .map(|at| self.guards[at].1)
    }
}

/// Compute requirements from the build's roots over the checked declaration
/// graph. `available` is one immutable target/profile decision per feature,
/// not the compiler's source-level table and not a provider chosen by a use.
/// Unknown guards retain both arms. Results and witnesses have stable ordering
/// independent of root/discovery order.
pub fn reached_features(
    snapshot: &SemanticSnapshot,
    roots: impl IntoIterator<Item = SymbolId>,
    nodes: impl IntoIterator<Item = NodeId>,
    context: ReachContext,
    available: impl Fn(&FeatureId) -> Option<bool>,
) -> Result<ReachedFeatures, SnapshotError> {
    let roots = ordered(roots);
    let nodes = ordered(nodes);
    let contexts = contexts(snapshot)?;
    let mut facts = Facts::new(snapshot, &contexts, available)?;
    // Branches are selected before their edges reach a declaration. Guard
    // answers never depend on the accumulated requirements.
    let mut failure = None;
    let reached = reachability::from_roots_with(
        snapshot,
        roots.iter().copied(),
        nodes.iter().copied(),
        |from, edge, demanded| {
            if failure.is_some() {
                return None;
            }
            match facts.follow(from, edge, demanded, &contexts) {
                Ok(follow) => follow,
                Err(error) => {
                    failure = Some(error);
                    None
                }
            }
        },
    );
    if let Some(error) = failure {
        return Err(error);
    }
    let mut features: HashMap<FeatureId, Vec<FeatureWitness>> = HashMap::new();
    let mut probes = Vec::new();
    for &node in &reached.nodes {
        let record = &snapshot.nodes[node.0 as usize];
        let context = contexts[node.0 as usize];
        let probe = facts.probe(node)?;
        if let Some(probe) = probe {
            probes.push(probe);
        }
        let Some(symbol) = record.symbol else {
            continue;
        };
        let use_kind = if context.type_only {
            FeatureUse::TypeOnly
        } else if facts.probe_operand(node)? {
            FeatureUse::Probe
        } else {
            FeatureUse::Runtime
        };
        let Some(binding) = facts.attribution.get(symbol, context.meaning)? else {
            continue;
        };
        features
            .entry(FeatureId {
                library: binding.library().clone(),
                name: binding.name().into(),
            })
            .or_default()
            .push(FeatureWitness {
                node,
                location: record.origin.location,
                meaning: context.meaning,
                use_kind,
            });
    }
    let features = ordered_features(features);
    probes.sort_by_key(|probe| probe.node.0);
    let reached_nodes = ordered(reached.nodes);
    let demanded = ordered(reached.node_demands);
    facts.work.owner_hops = facts.attribution.work().owner_hops;
    facts.work.alias_hops = facts.attribution.work().alias_hops;
    let mut guards: Vec<_> = facts
        .guards
        .into_iter()
        .filter_map(|(node, value)| value.map(|value| (node, value)))
        .collect();
    guards.sort_unstable_by_key(|(node, _)| *node);
    Ok(ReachedFeatures {
        features,
        probes,
        plan: FeatureReachPlan {
            snapshot: Digest(snapshot.digest()?),
            roots,
            root_nodes: nodes,
            context,
            reached: reached_nodes,
            demanded,
            guards,
            work: facts.work,
        },
    })
}

#[derive(Clone, Copy)]
struct Context {
    type_only: bool,
    meaning: GlobalMeaning,
    reference_demand: Demand,
    probe_root: Option<NodeId>,
}

// Syntax parents supply occurrence roles, not declaration graph predecessors:
// the same helper reached first through `typeof helper` in an annotation must
// still be followed when a later executable reference calls it.
fn contexts(snapshot: &SemanticSnapshot) -> Result<Vec<Context>, SnapshotError> {
    let mut contexts = vec![None; snapshot.nodes.len()];
    for index in 0..snapshot.nodes.len() {
        let mut pending = Vec::new();
        let mut at = Some(NodeId(
            u32::try_from(index).map_err(|_| invalid("node arena is too large"))?,
        ));
        while let Some(id) = at {
            if contexts.get(id.0 as usize).is_some_and(Option::is_some) {
                break;
            }
            let node = snapshot
                .nodes
                .get(id.0 as usize)
                .ok_or_else(|| invalid("unknown syntax parent"))?;
            pending.push(id);
            if pending.len() > snapshot.nodes.len() {
                return Err(invalid("cyclic syntax parents"));
            }
            at = node.parent;
        }
        let mut context = at
            .and_then(|id| contexts[id.0 as usize])
            .unwrap_or(Context {
                type_only: false,
                meaning: GlobalMeaning::Value,
                reference_demand: Demand::Value,
                probe_root: None,
            });
        while let Some(id) = pending.pop() {
            context = child_context(snapshot, id, context);
            contexts[id.0 as usize] = Some(context);
        }
    }
    Ok(contexts.into_iter().flatten().collect())
}

fn child_context(snapshot: &SemanticSnapshot, id: NodeId, mut context: Context) -> Context {
    let node = &snapshot.nodes[id.0 as usize];
    let (reference_demand, probe_root) = reference_context(snapshot, id, context);
    context.reference_demand = reference_demand;
    context.probe_root = probe_root;
    if let NodeKind::Syntax(kind) = node.kind {
        let type_node =
            syntax::is_type_node(kind) && kind != syntax::EXPRESSION_WITH_TYPE_ARGUMENTS;
        if type_node
            || matches!(
                kind,
                syntax::INTERFACE_DECLARATION | syntax::TYPE_ALIAS_DECLARATION
            )
        {
            context.type_only = true;
            context.meaning = GlobalMeaning::Type;
        }
        if let Some(parent) = node.parent {
            let parent_node = &snapshot.nodes[parent.0 as usize];
            if walk::child(snapshot, parent, "typeArguments") == Some(id)
                || walk::child(snapshot, parent, "typeParameters") == Some(id)
            {
                context.type_only = true;
                context.meaning = GlobalMeaning::Type;
            }
            // TypeQuery is the schema's normalized TS `typeof` type.
            if parent_node.kind == NodeKind::Syntax(syntax::TYPE_QUERY)
                && walk::child(snapshot, parent, "exprName") == Some(id)
            {
                context.meaning = GlobalMeaning::Value;
            }
        }
        if matches!(
            kind,
            syntax::IMPORT_CLAUSE | syntax::IMPORT_SPECIFIER | syntax::EXPORT_SPECIFIER
        ) && small(node.data) == 1
        {
            context.type_only = true;
            context.meaning = GlobalMeaning::Type;
        }
        if kind == syntax::HERITAGE_CLAUSE && small(node.data) == 1 {
            context.type_only = true; // implements, never class extends
            context.meaning = GlobalMeaning::Type;
        }
    } else if let Some(parent) = node.parent
        && ["typeArguments", "typeParameters"]
            .iter()
            .any(|slot| walk::child(snapshot, parent, slot) == Some(id))
    {
        context.type_only = true;
        context.meaning = GlobalMeaning::Type;
    }
    context
}

fn reference_context(
    snapshot: &SemanticSnapshot,
    id: NodeId,
    inherited: Context,
) -> (Demand, Option<NodeId>) {
    let node = &snapshot.nodes[id.0 as usize];
    let mut context = inherited;
    context.reference_demand = Demand::Value;
    context.probe_root = None;
    if let Some(parent) = node.parent {
        let kind = walk::kind_of(snapshot, parent);
        if kind == Some(syntax::NEW_EXPRESSION)
            && walk::child(snapshot, parent, "expression") == Some(id)
        {
            context.reference_demand = Demand::Construct;
        }
        if matches!(
            kind,
            Some(
                syntax::PARENTHESIZED_EXPRESSION
                    | syntax::AS_EXPRESSION
                    | syntax::NON_NULL_EXPRESSION
                    | syntax::SATISFIES_EXPRESSION
            )
        ) {
            context.reference_demand = inherited.reference_demand;
        }
        if kind == Some(syntax::TYPE_OF_EXPRESSION)
            || kind == Some(syntax::BINARY_EXPRESSION)
                && binary_operator(snapshot, parent) == Some(syntax::IN_KEYWORD)
                && walk::child(snapshot, parent, "left") == Some(id)
        {
            context.probe_root = Some(parent);
        } else if matches!(
            kind,
            Some(syntax::PARENTHESIZED_EXPRESSION | syntax::PROPERTY_ACCESS_EXPRESSION)
        ) {
            context.probe_root = inherited.probe_root;
        }
    }
    (context.reference_demand, context.probe_root)
}

struct Facts<'a, A> {
    snapshot: &'a SemanticSnapshot,
    available: A,
    availability: HashMap<FeatureId, Option<bool>>,
    guards: HashMap<NodeId, Option<bool>>,
    completions: HashMap<NodeId, u8>,
    indexed_lists: std::collections::HashSet<NodeId>,
    live_statements: std::collections::HashSet<NodeId>,
    work: ReachWork,
    contexts: &'a [Context],
    normalized: Vec<NodeId>,
    bindings: HashMap<NodeId, Option<FeatureId>>,
    probes: HashMap<NodeId, Option<AvailabilityProbe>>,
    attribution: FeatureBindings<'a>,
}

impl<'a, A: Fn(&FeatureId) -> Option<bool>> Facts<'a, A> {
    fn new(
        snapshot: &'a SemanticSnapshot,
        contexts: &'a [Context],
        available: A,
    ) -> Result<Self, SnapshotError> {
        let (normalized, normalization_visits) = normalized_operands(snapshot)?;
        Ok(Self {
            snapshot,
            available,
            availability: HashMap::new(),
            guards: HashMap::new(),
            completions: HashMap::new(),
            indexed_lists: std::collections::HashSet::new(),
            live_statements: std::collections::HashSet::new(),
            work: ReachWork {
                normalization_visits,
                ..ReachWork::default()
            },
            contexts,
            normalized,
            bindings: HashMap::new(),
            probes: HashMap::new(),
            attribution: FeatureBindings::new(&snapshot.symbols),
        })
    }

    fn follow(
        &mut self,
        from: NodeId,
        edge: Edge,
        demanded: Demand,
        contexts: &[Context],
    ) -> Result<Option<Demand>, SnapshotError> {
        self.work.graph_edges += 1;
        let snapshot = self.snapshot;
        let Edge::Syntax(to) = edge else {
            if matches!(edge, Edge::Declaration(_))
                && !matches!(
                    walk::kind_of(snapshot, from),
                    Some(
                        syntax::IDENTIFIER
                            | syntax::PROPERTY_ACCESS_EXPRESSION
                            | syntax::ELEMENT_ACCESS_EXPRESSION
                            | syntax::STRING_LITERAL
                            | syntax::SHORTHAND_PROPERTY_ASSIGNMENT
                            | syntax::QUALIFIED_NAME
                    )
                )
            {
                return Ok(None);
            }
            return Ok((!contexts[from.0 as usize].type_only
                && !self.probe_operand(from)?
                && !definition_name(snapshot, from))
            .then_some(
                if matches!(edge, Edge::Call(_))
                    && walk::kind_of(snapshot, from) == Some(syntax::NEW_EXPRESSION)
                    || contexts[from.0 as usize].reference_demand == Demand::Construct
                {
                    if demanded == Demand::Value {
                        Demand::Value
                    } else {
                        Demand::Construct
                    }
                } else {
                    Demand::Value
                },
            ));
        };
        let kind = walk::kind_of(snapshot, from);
        if kind == Some(syntax::PROPERTY_DECLARATION)
            && demanded == Demand::Definition
            && !snapshot.nodes[from.0 as usize]
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::STATIC)
            && walk::child(snapshot, from, "initializer") == Some(to)
        {
            return Ok(None);
        }
        if function_like(kind)
            && (demanded == Demand::Definition
                || demanded == Demand::Construct
                    && matches!(
                        kind,
                        Some(
                            syntax::METHOD_DECLARATION
                                | syntax::GET_ACCESSOR
                                | syntax::SET_ACCESSOR
                                | syntax::ARROW_FUNCTION
                        )
                    ))
            && ["body", "parameters"]
                .iter()
                .any(|slot| walk::child(snapshot, from, slot) == Some(to))
        {
            return Ok(None);
        }
        if snapshot.nodes[from.0 as usize].kind == NodeKind::List
            && snapshot.nodes[from.0 as usize]
                .parent
                .is_some_and(|parent| walk::child(snapshot, parent, "statements") == Some(from))
        {
            self.index_statements(from)?;
            self.work.statement_membership_checks += 1;
            if !self.live_statements.contains(&to) {
                return Ok(None);
            }
        }
        if !self.branch_selected(from, to)? {
            return Ok(None);
        }
        Ok(Some(child_demand(snapshot, from, to, demanded)))
    }

    fn branch_selected(&mut self, from: NodeId, to: NodeId) -> Result<bool, SnapshotError> {
        let snapshot = self.snapshot;
        let kind = walk::kind_of(snapshot, from);
        if matches!(kind, Some(syntax::WHILE_STATEMENT | syntax::FOR_STATEMENT)) {
            let slot = if kind == Some(syntax::FOR_STATEMENT) {
                "condition"
            } else {
                "expression"
            };
            if let Some(condition) = walk::child(snapshot, from, slot)
                && self.guard(condition)? == Some(false)
                && ["statement", "incrementor"]
                    .iter()
                    .any(|slot| walk::child(snapshot, from, slot) == Some(to))
            {
                return Ok(false);
            }
        }
        let (condition, yes, no) = match kind {
            Some(syntax::IF_STATEMENT) => ("expression", "thenStatement", "elseStatement"),
            Some(syntax::CONDITIONAL_EXPRESSION) => ("condition", "whenTrue", "whenFalse"),
            Some(syntax::BINARY_EXPRESSION)
                if matches!(
                    binary_operator(snapshot, from),
                    Some(syntax::AMPERSAND_AMPERSAND_TOKEN | syntax::BAR_BAR_TOKEN)
                ) =>
            {
                if walk::child(snapshot, from, "right") == Some(to)
                    && let Some(left) = walk::child(snapshot, from, "left")
                    && self.guard(left)?.is_some_and(|answer| {
                        answer
                            != (binary_operator(snapshot, from)
                                == Some(syntax::AMPERSAND_AMPERSAND_TOKEN))
                    })
                {
                    return Ok(false);
                }
                return Ok(true);
            }
            _ => return Ok(true),
        };
        if let Some(condition) = walk::child(snapshot, from, condition)
            && let Some(answer) = self.guard(condition)?
            && walk::child(snapshot, from, if answer { no } else { yes }) == Some(to)
        {
            return Ok(false);
        }
        Ok(true)
    }

    fn index_statements(&mut self, list: NodeId) -> Result<(), SnapshotError> {
        if !self.indexed_lists.insert(list) {
            return Ok(());
        }
        for &statement in &self.snapshot.nodes[list.0 as usize].children {
            self.work.statement_index_visits += 1;
            self.live_statements.insert(statement);
            if self.completion(statement)? & NORMAL == 0 {
                break;
            }
        }
        Ok(())
    }

    fn completion(&mut self, root: NodeId) -> Result<u8, SnapshotError> {
        let mut pending = vec![(root, false)];
        let mut active = std::collections::HashSet::new();
        while let Some((node, finish)) = pending.pop() {
            if self.completions.contains_key(&node) {
                continue;
            }
            if finish {
                let answer = self.completion_answer(node)?;
                self.completions.insert(node, answer);
                active.remove(&node);
            } else {
                if !active.insert(node) {
                    return Err(invalid("cyclic statement completion"));
                }
                pending.push((node, true));
                let snapshot = self.snapshot;
                let slots: &[&str] = match walk::kind_of(snapshot, node) {
                    Some(syntax::BLOCK) => &["statements"],
                    Some(syntax::IF_STATEMENT) => &["thenStatement", "elseStatement"],
                    Some(
                        syntax::WHILE_STATEMENT | syntax::FOR_STATEMENT | syntax::DO_STATEMENT,
                    ) => &["statement"],
                    _ => &[],
                };
                for slot in slots {
                    if let Some(child) = walk::child(snapshot, node, slot) {
                        pending.push((child, false));
                    }
                }
                if snapshot.nodes[node.0 as usize].kind == NodeKind::List {
                    pending.extend(
                        snapshot.nodes[node.0 as usize]
                            .children
                            .iter()
                            .map(|child| (*child, false)),
                    );
                }
            }
        }
        Ok(self.completions[&root])
    }

    fn completion_answer(&mut self, node: NodeId) -> Result<u8, SnapshotError> {
        let snapshot = self.snapshot;
        let flow = |slot| {
            walk::child(snapshot, node, slot).map_or(NORMAL, |child| self.completions[&child])
        };
        match walk::kind_of(snapshot, node) {
            Some(syntax::RETURN_STATEMENT | syntax::THROW_STATEMENT) => Ok(ABRUPT),
            Some(syntax::BREAK_STATEMENT) => Ok(BREAK),
            Some(syntax::CONTINUE_STATEMENT) => Ok(CONTINUE),
            Some(syntax::BLOCK) => Ok(flow("statements")),
            Some(syntax::IF_STATEMENT) => {
                let yes = flow("thenStatement");
                let no = flow("elseStatement");
                let answer = match walk::child(snapshot, node, "expression") {
                    Some(condition) => self.guard(condition)?,
                    None => None,
                };
                Ok(match answer {
                    Some(true) => yes,
                    Some(false) => no,
                    None => yes | no,
                })
            }
            Some(syntax::WHILE_STATEMENT | syntax::FOR_STATEMENT | syntax::DO_STATEMENT) => {
                let body = flow("statement");
                let slot = if walk::kind_of(snapshot, node) == Some(syntax::FOR_STATEMENT) {
                    "condition"
                } else {
                    "expression"
                };
                let condition = match walk::child(snapshot, node, slot) {
                    Some(condition) => self.guard(condition)?,
                    None => Some(true),
                };
                if condition == Some(false)
                    && walk::kind_of(snapshot, node) != Some(syntax::DO_STATEMENT)
                {
                    return Ok(NORMAL);
                }
                let mut answer = body & ABRUPT;
                if body & BREAK != 0
                    || condition != Some(true)
                        && (walk::kind_of(snapshot, node) != Some(syntax::DO_STATEMENT)
                            || body & (NORMAL | CONTINUE) != 0)
                {
                    answer |= NORMAL;
                }
                Ok(answer)
            }
            _ if snapshot.nodes[node.0 as usize].kind == NodeKind::List => {
                let mut answer = NORMAL;
                for child in &snapshot.nodes[node.0 as usize].children {
                    if answer & NORMAL == 0 {
                        break;
                    }
                    answer = (answer & !NORMAL) | self.completions[child];
                }
                Ok(answer)
            }
            // An unmodelled control form may hide or override break,
            // continue, return or throw (notably try/finally). Absence of a
            // model is never evidence that an enclosing loop cannot exit.
            _ => Ok(NORMAL | ABRUPT | BREAK | CONTINUE),
        }
    }

    fn binding(&mut self, node: NodeId) -> Result<Option<FeatureId>, SnapshotError> {
        let node = self.normalized[node.0 as usize];
        if let Some(binding) = self.bindings.get(&node) {
            return Ok(binding.clone());
        }
        self.work.binding_cache_misses += 1;
        let binding = match self.snapshot.nodes[node.0 as usize].symbol {
            Some(symbol) => self
                .attribution
                .global(symbol, GlobalMeaning::Value)?
                .map(|binding| FeatureId {
                    library: binding.library().clone(),
                    name: binding.name().into(),
                }),
            None => None,
        };
        self.bindings.insert(node, binding.clone());
        Ok(binding)
    }

    fn probe(&mut self, node: NodeId) -> Result<Option<AvailabilityProbe>, SnapshotError> {
        if let Some(probe) = self.probes.get(&node) {
            return Ok(probe.clone());
        }
        let probe = self.probe_fact(node)?;
        self.probes.insert(node, probe.clone());
        Ok(probe)
    }

    fn probe_fact(&mut self, node: NodeId) -> Result<Option<AvailabilityProbe>, SnapshotError> {
        let snapshot = self.snapshot;
        let key = match walk::kind_of(snapshot, node) {
            Some(syntax::TYPE_OF_EXPRESSION) => walk::child(snapshot, node, "expression"),
            Some(syntax::BINARY_EXPRESSION)
                if binary_operator(snapshot, node) == Some(syntax::IN_KEYWORD) =>
            {
                let Some(right) = walk::child(snapshot, node, "right") else {
                    return Ok(None);
                };
                let right = self.normalized[right.0 as usize];
                let receiver = snapshot.nodes[right.0 as usize]
                    .symbol
                    .and_then(|symbol| snapshot.symbols.get(symbol.0 as usize));
                if receiver.is_none_or(|symbol| symbol.builtin != Some(BuiltinBinding::GlobalThis))
                {
                    return Ok(None);
                }
                walk::child(snapshot, node, "left")
                    .filter(|key| walk::kind_of(snapshot, *key) == Some(syntax::STRING_LITERAL))
            }
            _ => return Ok(None),
        };
        let Some(key) = key else { return Ok(None) };
        let feature = self.binding(key)?;
        let available = feature.as_ref().and_then(|feature| {
            *self
                .availability
                .entry(feature.clone())
                .or_insert_with(|| (self.available)(feature))
        });
        Ok(Some(AvailabilityProbe {
            node,
            feature,
            available,
        }))
    }

    fn probe_operand(&mut self, node: NodeId) -> Result<bool, SnapshotError> {
        self.work.probe_role_checks += 1;
        let Some(root) = self.contexts[node.0 as usize].probe_root else {
            return Ok(false);
        };
        let Some(binding) = self.binding(node)? else {
            return Ok(false);
        };
        Ok(self
            .probe(root)?
            .is_some_and(|probe| probe.feature == Some(binding)))
    }

    fn guard(&mut self, root: NodeId) -> Result<Option<bool>, SnapshotError> {
        let mut pending = vec![(root, false)];
        let mut active = std::collections::HashSet::new();
        while let Some((node, finish)) = pending.pop() {
            if self.guards.contains_key(&node) {
                continue;
            }
            if finish {
                let answer = self.guard_answer(node)?;
                self.guards.insert(node, answer);
                active.remove(&node);
            } else {
                if !active.insert(node) {
                    return Err(invalid("cyclic guard syntax"));
                }
                pending.push((node, true));
                pending.extend(
                    self.snapshot.nodes[node.0 as usize]
                        .children
                        .iter()
                        .map(|child| (*child, false)),
                );
            }
        }
        Ok(self.guards[&root])
    }

    fn guard_answer(&mut self, node: NodeId) -> Result<Option<bool>, SnapshotError> {
        let snapshot = self.snapshot;
        let value = |slot| {
            walk::child(snapshot, node, slot)
                .and_then(|child| self.guards.get(&child).copied().flatten())
        };
        let operator = binary_operator(snapshot, node);
        match walk::kind_of(snapshot, node) {
            Some(syntax::TRUE_KEYWORD) => Ok(Some(true)),
            Some(syntax::FALSE_KEYWORD) => Ok(Some(false)),
            Some(syntax::PARENTHESIZED_EXPRESSION) => Ok(value("expression")),
            Some(syntax::PREFIX_UNARY_EXPRESSION)
                if small(snapshot.nodes[node.0 as usize].data)
                    == syntax::prefix_operator::EXCLAMATION =>
            {
                Ok(value("operand").map(|value| !value))
            }
            Some(syntax::BINARY_EXPRESSION)
                if matches!(
                    operator,
                    Some(syntax::AMPERSAND_AMPERSAND_TOKEN | syntax::BAR_BAR_TOKEN)
                ) =>
            {
                let (left, right) = (value("left"), value("right"));
                Ok(if operator == Some(syntax::AMPERSAND_AMPERSAND_TOKEN) {
                    if left == Some(false) || right == Some(false) {
                        Some(false)
                    } else {
                        left.and(right)
                    }
                } else if left == Some(true) || right == Some(true) {
                    Some(true)
                } else {
                    left.and(right)
                })
            }
            Some(syntax::BINARY_EXPRESSION) if matches!(operator, Some(34..=37)) => {
                let Some(left) = walk::child(snapshot, node, "left") else {
                    return Ok(None);
                };
                let Some(right) = walk::child(snapshot, node, "right") else {
                    return Ok(None);
                };
                for (probe, literal) in [(left, right), (right, left)] {
                    if walk::kind_of(snapshot, probe) == Some(syntax::TYPE_OF_EXPRESSION)
                        && walk::kind_of(snapshot, literal) == Some(syntax::STRING_LITERAL)
                        && walk::text_of(snapshot, literal) == Some("undefined")
                    {
                        return Ok(self.probe(probe)?.and_then(|probe| probe.available).map(
                            |available| {
                                available
                                    == matches!(
                                        operator,
                                        Some(
                                            syntax::EXCLAMATION_EQUALS_TOKEN
                                                | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
                                        )
                                    )
                            },
                        ));
                    }
                }
                Ok(None)
            }
            Some(syntax::BINARY_EXPRESSION) => {
                Ok(self.probe(node)?.and_then(|probe| probe.available))
            }
            _ => Ok(None),
        }
    }
}

fn binary_operator(snapshot: &SemanticSnapshot, node: NodeId) -> Option<u16> {
    walk::child(snapshot, node, "operatorToken").and_then(|token| walk::kind_of(snapshot, token))
}

fn small(data: NodeData) -> u8 {
    match data {
        NodeData::Children { small, .. } | NodeData::Flags { small } => small,
        NodeData::ListLength(_) => 0,
    }
}

fn invalid(message: &str) -> SnapshotError {
    SnapshotError::Project(message.into())
}

fn normalized_operands(snapshot: &SemanticSnapshot) -> Result<(Vec<NodeId>, usize), SnapshotError> {
    let mut normalized = vec![None; snapshot.nodes.len()];
    let mut visits = 0;
    for index in 0..snapshot.nodes.len() {
        let mut path = Vec::new();
        let mut at = NodeId(u32::try_from(index).map_err(|_| invalid("node arena is too large"))?);
        while normalized[at.0 as usize].is_none() {
            visits += 1;
            path.push(at);
            if path.len() > snapshot.nodes.len() {
                return Err(invalid("cyclic operand normalization"));
            }
            if walk::kind_of(snapshot, at) == Some(syntax::PARENTHESIZED_EXPRESSION)
                && let Some(child) = walk::child(snapshot, at, "expression")
            {
                at = child;
            } else {
                normalized[at.0 as usize] = Some(at);
            }
        }
        let target = normalized[at.0 as usize];
        for node in path {
            normalized[node.0 as usize] = target;
        }
    }
    Ok((normalized.into_iter().flatten().collect(), visits))
}

const NORMAL: u8 = 1;
const ABRUPT: u8 = 2;
const BREAK: u8 = 4;
const CONTINUE: u8 = 8;

fn function_like(kind: Option<u16>) -> bool {
    matches!(
        kind,
        Some(
            syntax::FUNCTION_DECLARATION
                | syntax::FUNCTION_EXPRESSION
                | syntax::ARROW_FUNCTION
                | syntax::METHOD_DECLARATION
                | syntax::CONSTRUCTOR
                | syntax::GET_ACCESSOR
                | syntax::SET_ACCESSOR
        )
    )
}
fn definition_name(snapshot: &SemanticSnapshot, node: NodeId) -> bool {
    if snapshot.nodes[node.0 as usize]
        .symbol
        .and_then(|symbol| snapshot.symbols.get(symbol.0 as usize))
        .is_some_and(|symbol| symbol.declarations.contains(&node))
    {
        return true;
    }
    let Some(parent) = snapshot.nodes[node.0 as usize].parent else {
        return false;
    };
    walk::child(snapshot, parent, "name") == Some(node)
        && !matches!(
            walk::kind_of(snapshot, parent),
            Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT | syntax::PROPERTY_ACCESS_EXPRESSION)
        )
}
fn child_demand(snapshot: &SemanticSnapshot, from: NodeId, to: NodeId, demand: Demand) -> Demand {
    let kind = walk::kind_of(snapshot, from);
    if function_like(kind) {
        return if demand == Demand::Value
            && kind == Some(syntax::ARROW_FUNCTION)
            && walk::child(snapshot, from, "body") == Some(to)
            && walk::kind_of(snapshot, to) != Some(syntax::BLOCK)
        {
            Demand::Value
        } else {
            Demand::Definition
        };
    }
    if kind == Some(syntax::RETURN_STATEMENT) {
        return Demand::Value;
    }
    if matches!(kind, Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION))
        && walk::child(snapshot, from, "arguments") == Some(to)
    {
        return Demand::Value;
    }
    if kind == Some(syntax::NEW_EXPRESSION)
        && demand == Demand::Value
        && walk::child(snapshot, from, "expression") == Some(to)
    {
        return Demand::Value;
    }
    if demand == Demand::Construct && kind == Some(syntax::PROPERTY_DECLARATION) {
        return Demand::Definition;
    }
    if snapshot.nodes[from.0 as usize].kind == NodeKind::List
        || matches!(
            kind,
            Some(
                syntax::VARIABLE_DECLARATION
                    | syntax::PARAMETER
                    | syntax::PROPERTY_DECLARATION
                    | syntax::CLASS_DECLARATION
                    | syntax::CLASS_EXPRESSION
                    | syntax::PROPERTY_ASSIGNMENT
                    | syntax::OBJECT_LITERAL_EXPRESSION
                    | syntax::ARRAY_LITERAL_EXPRESSION
                    | syntax::PARENTHESIZED_EXPRESSION
                    | syntax::AS_EXPRESSION
                    | syntax::NON_NULL_EXPRESSION
                    | syntax::SATISFIES_EXPRESSION
                    | syntax::CONDITIONAL_EXPRESSION
            )
        )
    {
        demand
    } else {
        Demand::Definition
    }
}

fn ordered<T: Ord>(values: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut values: Vec<_> = values.into_iter().collect();
    values.sort_unstable();
    values.dedup();
    values
}

fn ordered_features(features: HashMap<FeatureId, Vec<FeatureWitness>>) -> Vec<ReachedFeature> {
    let mut features: Vec<_> = features
        .into_iter()
        .map(|(feature, mut witnesses)| {
            witnesses.sort_by_key(|w| {
                (
                    w.location.file.0,
                    w.location.span.start,
                    w.location.span.end,
                    w.node.0,
                    w.use_kind,
                )
            });
            ReachedFeature { feature, witnesses }
        })
        .collect();
    features.sort_by(|left, right| left.feature.order().cmp(&right.feature.order()));
    features
}
