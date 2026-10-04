//! Initialization order for module bindings, shared by representation selection,
//! exception analysis and lowering. A binding and an access are different facts:
//! one early reader needs a flag, while a reader reachable only later needs none.
//!
//! Function bodies are summarized once. At each initialization frontier a worklist
//! follows resolved calls and, for an unknown call, currently available function
//! values. Unknown calls do not make values created at a later frontier reachable.
//! Repeated calls reconsider the available values; a body's first invocation alone
//! cannot settle callbacks it may receive later.

use std::rc::Rc;

use nts_semantic_schema::{SymbolId, VariableKind, syntax};
use rustc_hash::{FxHashMap, FxHashSet};

use super::{
    FuncBuilder, HirType, ManagedType, NodeId, PrimitiveBuiltin, SemanticSnapshot,
    binds_its_own_this, children_in_the_body_of, children_that_run, declaration_initializer,
    declared_base_class, declares_a_class, evaluation_order, implemented_member, is_static_member,
    names_a_body, raising_callees_of, reads_a_name, the_constructor_declared_by, the_function_of,
};

#[derive(Debug, Clone, Copy)]
struct Binding {
    module: usize,
    declaration: NodeId,
    name: NodeId,
    lexical: bool,
}

/// The result contains only source facts, never global indices or emitted names.
/// Builders share it rather than cloning a table of access sites for every copy.
#[derive(Debug, Default)]
pub(super) struct Analysis {
    bindings: FxHashMap<u32, Binding>,
    early: FxHashSet<u32>,
    guarded: FxHashSet<(NodeId, u32)>,
    /// Ancestors within the same executable body. Folding one of these would
    /// discard a TDZ or checked assertion exception, even for a known constant.
    guarded_expressions: FxHashSet<NodeId>,
    flagged_declarations: FxHashSet<NodeId>,
    cyclic: FxHashSet<usize>,
}

impl Analysis {
    pub(super) fn guards(&self, at: NodeId, symbol: u32) -> bool {
        self.guarded.contains(&(at, symbol))
    }

    pub(super) fn can_raise_at(&self, at: NodeId) -> bool {
        self.guarded_expressions.contains(&at)
    }

    pub(super) fn proven_ready(&self, symbol: u32) -> bool {
        self.bindings.get(&symbol).is_some_and(|binding| {
            !self.early.contains(&symbol) && !self.cyclic.contains(&binding.module)
        })
    }

    pub(super) fn flagged(&self) -> impl Iterator<Item = (u32, NodeId)> + '_ {
        self.early.iter().filter_map(|symbol| {
            let binding = self.bindings.get(symbol)?;
            binding.lexical.then_some((*symbol, binding.name))
        })
    }

    pub(super) fn guards_declaration(&self, declaration: NodeId) -> bool {
        self.flagged_declarations.contains(&declaration)
    }

    fn guard(&mut self, probe: &FuncBuilder, at: NodeId, symbol: u32) {
        self.flagged_declarations
            .insert(self.bindings[&symbol].declaration);
        self.guarded.insert((at, symbol));
        // Stores and compound operations lower at their operator node. Retain
        // the binding identity, so a different access in that expression cannot
        // cause a guard on its assignment target.
        if probe.stands_on_the_target_side(at)
            && let Some(parent) = probe.node(at).parent
        {
            self.guarded.insert((parent, symbol));
        }
        self.preserve_effect(probe, at);
    }

    fn preserve_effect(&mut self, probe: &FuncBuilder, at: NodeId) {
        for ancestor in std::iter::successors(Some(at), |at| probe.node(*at).parent) {
            if !self.guarded_expressions.insert(ancestor) {
                break;
            }
            if names_a_body(probe.kind_of(ancestor))
                || probe.kind_of(ancestor).is_some_and(declares_a_class)
            {
                break;
            }
        }
    }
}

#[derive(Debug, Clone)]
enum Event {
    Access(NodeId, u32),
    Initialize(u32),
    /// A variable's initializer can name a closure before the variable has
    /// run. Such a mention is a usable value only after that binding is ready.
    Value {
        body: NodeId,
        binding: Option<u32>,
    },
    Call {
        bodies: Vec<NodeId>,
        unknown: bool,
    },
    EndCall(bool),
}

struct Summaries<'a, 'b> {
    probe: &'a FuncBuilder<'b>,
    bindings: &'a FxHashMap<u32, Binding>,
    bodies: FxHashMap<NodeId, Rc<Vec<Event>>>,
    unknown: FxHashMap<NodeId, bool>,
}

impl Summaries<'_, '_> {
    fn provided_global(&self, at: NodeId) -> bool {
        self.probe.kind_of(at) == Some(syntax::IDENTIFIER)
            && self.probe.node(at).symbol.is_none_or(|symbol| {
                self.probe
                    .snapshot
                    .symbols
                    .get(symbol.0 as usize)
                    .is_some_and(|record| record.declarations.is_empty())
            })
    }

    fn primitive(&self, at: NodeId) -> bool {
        matches!(
            self.probe.type_of(at),
            Some(
                HirType::Float { .. }
                    | HirType::Int { .. }
                    | HirType::Bool
                    | HirType::BigInt
                    | HirType::Void
                    | HirType::Managed(ManagedType::String)
            )
        )
    }

    /// The same provided representations lowering constructs. Promise executors,
    /// iterable inputs and foreign calls remain callable; allocation alone does
    /// not make every available program function a possible callback.
    fn runtime_operation(&self, at: NodeId, kind: Option<u16>) -> bool {
        if self.probe.gobject_intrinsic(at).is_some() {
            return true;
        }
        let arguments = self.probe.arguments_of(at);
        if kind == Some(syntax::NEW_EXPRESSION) {
            return match self.probe.type_of(at) {
                Some(HirType::Managed(
                    ManagedType::View(_) | ManagedType::Buffer | ManagedType::DataView,
                )) => arguments.iter().enumerate().all(|(index, arg)| {
                    self.primitive(*arg)
                        || (index == 0
                            && matches!(
                                self.probe.type_of(*arg),
                                Some(HirType::Managed(ManagedType::Buffer | ManagedType::View(_)))
                            ))
                }),
                Some(HirType::Managed(ManagedType::Date)) => {
                    arguments.iter().all(|arg| self.primitive(*arg))
                }
                Some(HirType::Managed(ManagedType::Map(..) | ManagedType::Set(_))) => {
                    arguments.is_empty()
                }
                _ => false,
            };
        }
        if kind != Some(syntax::CALL_EXPRESSION) {
            return false;
        }
        let Some(callee) = self.probe.children(at).first().copied() else {
            return false;
        };
        // Only a provided global: a local parameter or declaration with the
        // same spelling is a program callee and may invoke a stored callback.
        if !self.provided_global(callee)
            || self
                .probe
                .snapshot
                .call_targets
                .get(&at)
                .and_then(|target| target.callee)
                .is_some()
        {
            return false;
        }
        self.probe
            .node(callee)
            .text
            .as_deref()
            .and_then(super::primitive_builtin)
            .is_some_and(|builtin| {
                builtin == PrimitiveBuiltin::Boolean
                    || arguments.iter().all(|arg| self.primitive(*arg))
            })
    }

    fn body(&mut self, body: NodeId) -> Rc<Vec<Event>> {
        if let Some(events) = self.bodies.get(&body) {
            return events.clone();
        }
        let mut events = Vec::new();
        if self.probe.kind_of(body).is_some_and(declares_a_class) {
            // Instance methods are available before any initializer executes.
            for member in self.probe.children(body) {
                if implemented_member(self.probe, member) && !self.is_static(member) {
                    events.push(Event::Value {
                        body: member,
                        binding: None,
                    });
                }
            }
            for child in children_in_the_body_of(self.probe, body) {
                self.tree(child, &mut events);
            }
            if the_constructor_declared_by(self.probe, body).is_none()
                && let Some(base) = declared_base_class(self.probe.snapshot, self.probe, body)
            {
                events.push(Event::Call {
                    bodies: self.declared_bodies(SymbolId(base)),
                    unknown: false,
                });
            }
        } else {
            for child in children_that_run(self.probe, body) {
                self.tree(child, &mut events);
            }
        }
        let events = Rc::new(events);
        self.bodies.insert(body, events.clone());
        events
    }

    fn is_static(&self, at: NodeId) -> bool {
        is_static_member(self.probe.snapshot, at)
            || self.probe.kind_of(at) == Some(syntax::CLASS_STATIC_BLOCK)
    }

    fn has_unknown_call(&mut self, root: NodeId) -> bool {
        if let Some(known) = self.unknown.get(&root) {
            return *known;
        }
        let mut visited = FxHashSet::default();
        let mut pending = vec![root];
        while let Some(body) = pending.pop() {
            if !visited.insert(body) {
                continue;
            }
            if let Some(known) = self.unknown.get(&body) {
                if *known {
                    self.unknown.insert(root, true);
                    return true;
                }
                continue;
            }
            for event in self.body(body).iter() {
                if let Event::Call { bodies, unknown } = event {
                    if *unknown {
                        self.unknown.insert(root, true);
                        return true;
                    }
                    pending.extend(bodies.iter().copied());
                }
            }
        }
        self.unknown.insert(root, false);
        false
    }

    fn declared_bodies(&self, symbol: SymbolId) -> Vec<NodeId> {
        self.probe
            .snapshot
            .symbols
            .get(self.probe.denoted_symbol(symbol).0 as usize)
            .into_iter()
            .flat_map(|record| &record.declarations)
            .map(|at| {
                self.probe
                    .implementation_of(the_function_of(self.probe, *at))
            })
            .filter(|at| {
                names_a_body(self.probe.kind_of(*at))
                    || self.probe.kind_of(*at).is_some_and(declares_a_class)
            })
            .collect()
    }

    fn initializer(&self, declaration: NodeId, into: &mut Vec<Event>) {
        let children = self.probe.children(declaration);
        if let Some(name) = children.first().copied()
            && let Some(initializer) =
                declaration_initializer(&children, name, |at| self.probe.kind_of(at))
        {
            self.tree(initializer, into);
        }
    }

    fn initialize_name(&self, name: NodeId, into: &mut Vec<Event>) {
        if let Some(symbol) = self.probe.node(name).symbol
            && self.bindings.contains_key(&symbol.0)
        {
            into.push(Event::Initialize(symbol.0));
        }
    }

    fn pattern(&self, pattern: NodeId, into: &mut Vec<Event>) {
        if self.probe.kind_of(pattern) == Some(syntax::IDENTIFIER) {
            self.initialize_name(pattern, into);
            return;
        }
        for element in self.probe.children(pattern) {
            let Some((property, binding, default)) =
                super::binding_element_parts(self.probe, element)
            else {
                continue;
            };
            if self.probe.kind_of(property) == Some(syntax::COMPUTED_PROPERTY_NAME) {
                self.tree(property, into);
            }
            if let Some(default) = default {
                self.tree(default, into);
            }
            self.pattern(binding, into);
        }
    }

    fn inner_class_binding(&self, at: NodeId, declaration: NodeId) -> bool {
        // The class's inner name is initialized before static elements run;
        // its outer binding is initialized after they finish. Heritage still
        // runs in the inner name's dead zone.
        if !self
            .probe
            .kind_of(declaration)
            .is_some_and(declares_a_class)
        {
            return false;
        }
        for ancestor in
            std::iter::successors(self.probe.node(at).parent, |at| self.probe.node(*at).parent)
        {
            if self.probe.kind_of(ancestor) == Some(syntax::HERITAGE_CLAUSE) {
                return false;
            }
            if ancestor == declaration {
                return true;
            }
        }
        false
    }

    fn class_definition(&self, at: NodeId, into: &mut Vec<Event>) {
        let children = self.probe.children(at);
        for child in &children {
            if self.probe.kind_of(*child) == Some(syntax::HERITAGE_CLAUSE) {
                self.tree(*child, into);
            }
        }
        for member in &children {
            for child in self.probe.children(*member) {
                if self.probe.kind_of(child) == Some(syntax::COMPUTED_PROPERTY_NAME) {
                    self.tree(child, into);
                }
            }
        }
        for member in &children {
            if self.is_static(*member) && !implemented_member(self.probe, *member) {
                if self.probe.kind_of(*member) == Some(syntax::PROPERTY_DECLARATION) {
                    self.initializer(*member, into);
                } else {
                    self.tree(*member, into);
                }
            }
        }
        if let Some(name) = children
            .into_iter()
            .find(|at| self.probe.kind_of(*at) == Some(syntax::IDENTIFIER))
        {
            self.initialize_name(name, into);
        }
    }

    /// Reading a method produces a function value. Defining a class alone does
    /// not hand its methods to a caller. A class evaluated as a value can expose
    /// its construction and static methods, while `C.prototype` and `new C()`
    /// resolve their own operation without exposing those function values.
    fn function_values(&self, at: NodeId, symbol: SymbolId, into: &mut Vec<Event>) {
        let binding = self.bindings.get(&symbol.0).and_then(|binding| {
            (!self.inner_class_binding(at, binding.declaration)).then_some(symbol.0)
        });
        for body in self.declared_bodies(symbol) {
            if names_a_body(self.probe.kind_of(body)) {
                into.push(Event::Value { body, binding });
            } else if self.probe.kind_of(body).is_some_and(declares_a_class) {
                self.class_value(at, body, binding, into);
            }
        }
    }

    fn class_value(&self, at: NodeId, body: NodeId, binding: Option<u32>, into: &mut Vec<Event>) {
        if self.probe.node(at).parent.is_some_and(|parent| {
            matches!(
                self.probe.kind_of(parent),
                Some(
                    syntax::PROPERTY_ACCESS_EXPRESSION
                        | syntax::ELEMENT_ACCESS_EXPRESSION
                        | syntax::NEW_EXPRESSION
                )
            ) && self.probe.children(parent).first() == Some(&at)
        }) || self.class_is_reflected(at)
        {
            return;
        }
        into.push(Event::Value { body, binding });
        for member in self.probe.children(body) {
            if implemented_member(self.probe, member) && self.is_static(member) {
                into.push(Event::Value {
                    body: member,
                    binding,
                });
            }
        }
    }

    /// The existing fixed-layout reflection boundary cannot produce a usable
    /// constructor or static method value: lowering refuses that operation and
    /// its result's readers. Do not invent a callable escape through it. Keep
    /// the call unknown, since its other arguments are still evaluated and can
    /// run code. Prototype creation is excluded because its supported forms
    /// can expose inherited methods.
    fn class_is_reflected(&self, at: NodeId) -> bool {
        let Some(call) = self.probe.syntactic_parent(at) else {
            return false;
        };
        if self.probe.kind_of(call) != Some(syntax::CALL_EXPRESSION)
            || self.probe.arguments_of(call).first() != Some(&at)
        {
            return false;
        }
        let Some(callee) = self.probe.children(call).first().copied() else {
            return false;
        };
        let Some((object, member)) = self.probe.member_access(callee) else {
            return false;
        };
        self.provided_global(object)
            && self.probe.node(object).text.as_deref() == Some("Object")
            && !matches!(member.as_str(), "create" | "prototype")
            && FuncBuilder::reflection_of_a_layout("Object", &member).is_some()
    }

    fn static_this(&self, at: NodeId) -> Option<NodeId> {
        let owner =
            std::iter::successors(self.probe.node(at).parent, |at| self.probe.node(*at).parent)
                .find(|at| {
                    self.probe.kind_of(*at).is_some_and(|kind| {
                        binds_its_own_this(kind)
                            || matches!(
                                kind,
                                syntax::PROPERTY_DECLARATION | syntax::CLASS_STATIC_BLOCK
                            )
                    })
                })?;
        self.is_static(owner)
            .then(|| self.probe.enclosing_class(owner))
            .flatten()
    }

    fn call(&self, at: NodeId, kind: Option<u16>, into: &mut Vec<Event>) {
        if matches!(kind, Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION | syntax::TAGGED_TEMPLATE_EXPRESSION))
            || self.probe.reads_an_accessor(at)
        {
            let mut bodies = raising_callees_of(self.probe.snapshot, self.probe, at);
            if kind == Some(syntax::NEW_EXPRESSION) {
                // An explicit constructor's class also owns instance fields.
                for body in &mut bodies {
                    if self.probe.kind_of(*body) == Some(syntax::CONSTRUCTOR)
                        && let Some(class) = self.probe.enclosing_class(*body)
                    {
                        *body = class;
                    }
                }
                if bodies.is_empty()
                    && let Some(symbol) = self
                        .probe
                        .children(at)
                        .first()
                        .and_then(|callee| self.probe.node(*callee).symbol)
                {
                    bodies = self.declared_bodies(symbol);
                }
            }
            let unknown = (bodies.is_empty()
                || bodies.iter().any(|body| {
                    !self.probe.has_a_body(*body)
                        && !self.probe.kind_of(*body).is_some_and(declares_a_class)
                })
                || super::a_value_held_call(self.probe.snapshot, self.probe, at))
                && !self.runtime_operation(at, kind);
            // A value's signature may happen to name another initializer with
            // the same type. It does not establish that value's identity.
            if kind == Some(syntax::CALL_EXPRESSION)
                && super::a_value_held_call(self.probe.snapshot, self.probe, at)
            {
                bodies.clear();
            }
            bodies.retain(|body| {
                self.probe.has_a_body(*body)
                    || self.probe.kind_of(*body).is_some_and(declares_a_class)
            });
            into.push(Event::Call { bodies, unknown });
        }
    }

    fn tree(&self, at: NodeId, into: &mut Vec<Event>) {
        let kind = self.probe.kind_of(at);
        if kind.is_some_and(syntax::is_type_node) {
            return;
        }
        match kind {
            Some(
                syntax::FUNCTION_DECLARATION
                | syntax::INTERFACE_DECLARATION
                | syntax::TYPE_ALIAS_DECLARATION
                | syntax::IMPORT_DECLARATION,
            ) => return,
            Some(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION) => {
                into.push(Event::Value {
                    body: at,
                    binding: None,
                });
                return;
            }
            Some(syntax::METHOD_DECLARATION | syntax::GET_ACCESSOR | syntax::SET_ACCESSOR) => {
                // Object literals create callable members, including accessors.
                for child in self.probe.children(at) {
                    if self.probe.kind_of(child) == Some(syntax::COMPUTED_PROPERTY_NAME) {
                        self.tree(child, into);
                    }
                }
                into.push(Event::Value {
                    body: at,
                    binding: None,
                });
                return;
            }
            Some(syntax::VARIABLE_DECLARATION) => {
                let children = self.probe.children(at);
                let Some(name) = children.first().copied() else {
                    return;
                };
                self.initializer(at, into);
                self.pattern(name, into);
                return;
            }
            Some(syntax::PARAMETER) => {
                self.initializer(at, into);
                return;
            }
            Some(kind) if declares_a_class(kind) => {
                self.class_definition(at, into);
                return;
            }
            Some(syntax::IDENTIFIER) if reads_a_name(self.probe, at) => {
                if let Some(symbol) = self.probe.node(at).symbol {
                    let symbol = self.probe.denoted_symbol(symbol);
                    if let Some(binding) = self.bindings.get(&symbol.0)
                        && !self.inner_class_binding(at, binding.declaration)
                    {
                        into.push(Event::Access(at, symbol.0));
                    }
                    self.function_values(at, symbol, into);
                }
                return;
            }
            Some(syntax::THIS_KEYWORD) => {
                if let Some(class) = self.static_this(at) {
                    self.class_value(at, class, None, into);
                }
                return;
            }
            _ => {}
        }
        for child in children_that_run(self.probe, at) {
            self.tree(child, into);
        }
        if matches!(
            kind,
            Some(syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION)
        ) && !self.probe.reads_an_accessor(at)
            && let Some(symbol) = self
                .probe
                .children(at)
                .last()
                .and_then(|member| self.probe.node(*member).symbol)
        {
            self.function_values(at, self.probe.denoted_symbol(symbol), into);
        }
        self.call(at, kind, into);
    }
}

fn module_bindings(probe: &FuncBuilder) -> FxHashMap<u32, Binding> {
    let mut bindings = FxHashMap::default();
    for (module, record) in probe.snapshot.modules.iter().enumerate() {
        for statement in probe.children(record.root) {
            if probe.kind_of(statement) == Some(syntax::VARIABLE_STATEMENT) {
                for list in probe.children(statement) {
                    if probe.kind_of(list) != Some(syntax::VARIABLE_DECLARATION_LIST) {
                        continue;
                    }
                    let kind = VariableKind::from_flags(probe.node(list).flags);
                    for declaration in probe.children(list) {
                        let Some(pattern) = probe.children(declaration).first().copied() else {
                            continue;
                        };
                        let mut names = Vec::new();
                        if probe.kind_of(pattern) == Some(syntax::IDENTIFIER) {
                            names.push(pattern);
                        } else {
                            probe.pattern_names(pattern, &mut names);
                        }
                        for name in names {
                            if let Some(symbol) = probe.node(name).symbol {
                                bindings.entry(symbol.0).or_insert(Binding {
                                    module,
                                    declaration,
                                    name,
                                    lexical: matches!(
                                        kind,
                                        VariableKind::Let | VariableKind::Const
                                    ),
                                });
                            }
                        }
                    }
                }
            } else if probe.kind_of(statement) == Some(syntax::CLASS_DECLARATION)
                && let Some(name) = probe
                    .children(statement)
                    .into_iter()
                    .find(|at| probe.kind_of(*at) == Some(syntax::IDENTIFIER))
                && let Some(symbol) = probe.node(name).symbol
            {
                bindings.insert(
                    symbol.0,
                    Binding {
                        module,
                        declaration: statement,
                        name,
                        lexical: true,
                    },
                );
            }
        }
    }
    bindings
}

/// One traversal per module frontier, with cached bodies and bounded worklists.
/// A frontier ends at each binding, including each element of a pattern.
pub(super) fn analyze(snapshot: &SemanticSnapshot, probe: &FuncBuilder) -> Analysis {
    let mut analysis = Analysis {
        bindings: module_bindings(probe),
        cyclic: evaluation_order(snapshot, &[])
            .1
            .into_iter()
            .flatten()
            .collect(),
        ..Analysis::default()
    };
    let bindings = analysis.bindings.clone();
    let mut summaries = Summaries {
        probe,
        bindings: &bindings,
        bodies: FxHashMap::default(),
        unknown: FxHashMap::default(),
    };
    for (module, record) in snapshot.modules.iter().enumerate() {
        let mut ready = FxHashSet::default();
        let mut values = FxHashSet::default();
        let mut visited = FxHashSet::default();
        let mut unknown = false;
        for statement in probe.children(record.root) {
            let mut events = Vec::new();
            summaries.tree(statement, &mut events);
            let mut pending: Vec<Event> = events.into_iter().rev().collect();
            while let Some(event) = pending.pop() {
                match event {
                    Event::Access(at, symbol) => {
                        let binding = bindings[&symbol];
                        if binding.module == module && !ready.contains(&symbol) {
                            analysis.early.insert(symbol);
                            if binding.lexical {
                                analysis.guard(probe, at, symbol);
                            }
                        }
                    }
                    Event::Initialize(symbol) => {
                        if bindings[&symbol].module == module {
                            ready.insert(symbol);
                            visited.clear();
                            unknown = false;
                        }
                    }
                    Event::Value { body, binding } => {
                        let exists = binding.is_none_or(|symbol| {
                            bindings[&symbol].module != module || ready.contains(&symbol)
                        });
                        if exists && values.insert(body) && unknown && visited.insert(body) {
                            pending.extend(summaries.body(body).iter().rev().cloned());
                        }
                    }
                    Event::Call {
                        bodies,
                        unknown: through_value,
                    } => {
                        let mut targets = bodies;
                        let may_call_values = through_value
                            || targets.iter().any(|body| summaries.has_unknown_call(*body));
                        pending.push(Event::EndCall(unknown));
                        if may_call_values {
                            unknown = true;
                            targets.extend(values.iter().copied());
                        }
                        for body in targets {
                            if visited.insert(body) {
                                pending.extend(summaries.body(body).iter().rev().cloned());
                            }
                        }
                    }
                    Event::EndCall(previous) => unknown = previous,
                }
            }
        }
    }
    // Source assertions synthesize throws without a THROW_STATEMENT. Keep
    // their effect at each enclosing expression so all existing folding and
    // synchronous-call decisions use the same licence as lowering.
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if matches!(
            node.kind,
            nts_semantic_schema::NodeKind::Syntax(
                syntax::AS_EXPRESSION | syntax::NON_NULL_EXPRESSION
            )
        ) && let Ok(index) = u32::try_from(index)
        {
            let at = NodeId(index);
            if super::assertions::can_throw(probe, at) {
                analysis.preserve_effect(probe, at);
            }
        }
    }
    analysis
}
