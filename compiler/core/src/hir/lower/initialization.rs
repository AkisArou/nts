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

use crate::hir::{OpKind, Terminator, ValueId};
use nts_diagnostics::Diagnostic;
use nts_semantic_schema::{SymbolId, VariableKind, syntax};
use rustc_hash::{FxHashMap, FxHashSet};

use super::{
    Branch, ClosureInfo, FuncBuilder, HirType, ManagedType, NodeId, PrimitiveBuiltin,
    SemanticSnapshot, binds_its_own_this, children_in_the_body_of, children_that_run,
    declaration_initializer, declared_base_class, declares_a_class, evaluation_order,
    implemented_member, is_static_member, names_a_body, raising_callees_of, reads_a_name,
    the_constructor_declared_by, the_function_of,
};

#[derive(Debug, Clone, Copy)]
struct Binding {
    module: usize,
    declaration: NodeId,
    name: NodeId,
    lexical: bool,
}

impl FuncBuilder<'_> {
    /// Only a bare captured var read is answered locally. A call returning
    /// that value still needs undefined-capable result transport and stays a
    /// named stop until its representation is widened together with its ABI.
    pub(super) fn guarded_var_typeof(
        &mut self,
        at: NodeId,
        operand: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        let operand = self.through_parentheses(operand);
        if !self.in_closure || self.kind_of(operand) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let symbol = self.node(operand).symbol?.0;
        if !self.module.initialization.var_cell(symbol)
            || !self
                .cell_of(symbol)
                .is_some_and(|index| self.is_guarded(index))
        {
            return None;
        }
        let spelling = self.typeof_from_the_checkers_type(operand)?;
        let cell = *self.bindings.get(&symbol)?;
        let origin = self.origin(at);
        let ready = self.push(
            OpKind::FieldGet {
                object: cell,
                field: 1,
            },
            HirType::Bool,
            origin.clone(),
        );
        let text = HirType::Managed(ManagedType::String);
        let initialized = self.push(
            OpKind::ConstString(spelling.to_owned()),
            text.clone(),
            origin.clone(),
        );
        let undefined = self.push(OpKind::ConstString("undefined".to_owned()), text, origin);
        Some(self.lower_branching_value(
            at,
            ready,
            Branch::Value(initialized),
            Branch::Value(undefined),
        ))
    }

    /// Numeric and other narrow cells have no representation for var's entry
    /// value. This is an unsupported transport, never a lexical `ReferenceError`.
    pub(super) fn check_var_ready(&mut self, at: NodeId, symbol: u32, cell: ValueId) {
        let origin = self.origin(at);
        let ready = self.push(
            OpKind::FieldGet {
                object: cell,
                field: 1,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (carry_on, refused) = (self.new_block(), self.new_block());
        self.terminate(Terminator::Branch {
            cond: ready,
            then_target: carry_on,
            then_args: Vec::new(),
            else_target: refused,
            else_args: Vec::new(),
        });
        self.switch_to(refused);
        let name = &self.snapshot.symbols[symbol as usize].name;
        let declared = self
            .type_of(at)
            .and_then(|ty| self.spelling_for(&ty))
            .map_or_else(|| self.describe_node(at), str::to_owned);
        let reason = format!(
            "`{name}` (var) was read before its assignment; JS gives undefined here, \
             which this compiler cannot carry where `{name}`'s type is {declared}"
        );
        let what = self.push(
            OpKind::ConstString(reason),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        self.runtime_call("nts_refused", vec![what], HirType::Void, origin);
        self.terminate(Terminator::Unreachable);
        self.switch_to(carry_on);
    }
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
    lexical_cells: FxHashSet<u32>,
    var_cells: FxHashSet<u32>,
    ready_cells: FxHashSet<u32>,
    captured_guards: FxHashSet<(NodeId, u32)>,
    class_readiness: FxHashSet<u32>,
}

impl Analysis {
    pub(super) fn guards(&self, at: NodeId, symbol: u32) -> bool {
        self.guarded.contains(&(at, symbol))
    }

    pub(super) fn can_raise_at(&self, at: NodeId) -> bool {
        self.guarded_expressions.contains(&at)
    }

    pub(super) fn lexical_cell(&self, symbol: u32) -> bool {
        self.lexical_cells.contains(&symbol)
    }

    pub(super) fn var_cell(&self, symbol: u32) -> bool {
        self.var_cells.contains(&symbol)
    }

    pub(super) fn cell_needs_guard(&self, symbol: u32) -> bool {
        !self.ready_cells.contains(&symbol)
    }

    pub(super) fn guards_capture(&self, at: NodeId, symbol: u32) -> bool {
        self.captured_guards.contains(&(at, symbol))
    }

    pub(super) fn class_cell(&self, symbol: u32) -> bool {
        self.class_readiness.contains(&symbol)
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

    fn captured_cells(
        &mut self,
        probe: &FuncBuilder,
        closures: &[ClosureInfo],
        readers: &PrivateReaders,
    ) {
        self.var_cells = super::guarded_symbols(closures)
            .into_iter()
            .filter(|symbol| {
                probe
                    .snapshot
                    .symbols
                    .get(*symbol as usize)
                    .is_some_and(|record| {
                        !record.declarations.is_empty()
                            && record.declarations.iter().all(|declaration| {
                                probe.variable_kind(*declaration) == Some(VariableKind::Var)
                            })
                    })
            })
            .collect();
        self.class_readiness = closures
            .iter()
            .filter(|closure| closure.refusal.is_none())
            .flat_map(|closure| &closure.captures)
            .filter(|capture| capture.readiness_only)
            .map(|capture| capture.symbol)
            .collect();
        self.lexical_cells = super::guarded_symbols(closures)
            .into_iter()
            .filter(|symbol| {
                probe
                    .snapshot
                    .symbols
                    .get(*symbol as usize)
                    .is_some_and(|record| {
                        !record.declarations.is_empty()
                            && record.declarations.iter().all(|declaration| {
                                probe.kind_of(*declaration) == Some(syntax::CLASS_DECLARATION)
                                    || matches!(
                                        probe.variable_kind(*declaration),
                                        Some(VariableKind::Let | VariableKind::Const)
                                    )
                            })
                    })
            })
            .collect();
        self.ready_cells = cells_proven_ready(probe, closures, &self.lexical_cells, readers);
        // A captured lexical read can throw even though its enclosing function
        // contains no explicit throw. Publish the effect before raising copies
        // are selected, and retain it through typeof and constant folding.
        for closure in closures.iter().filter(|closure| closure.refusal.is_none()) {
            if !closure.captures.iter().any(|capture| {
                self.lexical_cell(capture.symbol) && self.cell_needs_guard(capture.symbol)
            }) {
                continue;
            }
            let mut subtree = Vec::new();
            probe.subtree(closure.node, &mut subtree);
            for at in subtree {
                if reads_a_name(probe, at)
                    && probe.node(at).symbol.is_some_and(|symbol| {
                        self.lexical_cell(symbol.0)
                            && self.cell_needs_guard(symbol.0)
                            && closure
                                .captures
                                .iter()
                                .any(|capture| capture.symbol == symbol.0)
                    })
                {
                    if let Some(symbol) = probe.node(at).symbol {
                        self.captured_guards.insert((at, symbol.0));
                    }
                    self.preserve_effect(probe, at);
                }
            }
        }
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

fn syntax_parent(probe: &FuncBuilder, at: NodeId) -> Option<NodeId> {
    std::iter::successors(probe.node(at).parent, |at| probe.node(*at).parent)
        .find(|at| probe.kind_of(*at).is_some())
}

fn execution_owner(probe: &FuncBuilder, at: NodeId) -> Option<NodeId> {
    std::iter::successors(probe.node(at).parent, |at| probe.node(*at).parent)
        .find(|at| names_a_body(probe.kind_of(*at)))
}

pub(super) fn reentered_scope(probe: &FuncBuilder, declaration: NodeId) -> bool {
    for at in std::iter::successors(probe.node(declaration).parent, |at| probe.node(*at).parent) {
        let inline_executor = probe.kind_of(at) == Some(syntax::ARROW_FUNCTION)
            && syntax_parent(probe, at).is_some_and(|parent| {
                probe.kind_of(parent) == Some(syntax::NEW_EXPRESSION)
                    && probe.arguments_of(parent).first() == Some(&at)
                    && matches!(
                        probe.type_of(parent),
                        Some(HirType::Managed(ManagedType::Promise(_)))
                    )
            });
        if !inline_executor
            && (names_a_body(probe.kind_of(at))
                || probe.kind_of(at).is_some_and(binds_its_own_this))
        {
            break;
        }
        if matches!(
            probe.kind_of(at),
            Some(
                syntax::FOR_STATEMENT
                    | syntax::FOR_IN_STATEMENT
                    | syntax::FOR_OF_STATEMENT
                    | syntax::WHILE_STATEMENT
                    | syntax::DO_STATEMENT
            )
        ) {
            return true;
        }
    }
    false
}

pub(super) fn runtime_reference(probe: &FuncBuilder, at: NodeId) -> bool {
    for parent in std::iter::successors(probe.node(at).parent, |at| probe.node(*at).parent) {
        if probe.kind_of(parent).is_some_and(syntax::is_type_node) {
            return false;
        }
        if names_a_body(probe.kind_of(parent)) {
            break;
        }
    }
    true
}

/// A declaration directly in a function body runs before every later source
/// statement in that body. If its initializer throws, none of those statements
/// executes. A nested block or loop does not establish that same fact.
fn unconditional_owner(probe: &FuncBuilder, declaration: NodeId) -> Option<NodeId> {
    let statement = if probe.kind_of(declaration) == Some(syntax::VARIABLE_DECLARATION) {
        probe.ancestor(declaration, syntax::VARIABLE_STATEMENT)?
    } else {
        declaration
    };
    let block = syntax_parent(probe, statement)?;
    if probe.kind_of(block) != Some(syntax::BLOCK) {
        return None;
    }
    let owner = syntax_parent(probe, block)?;
    names_a_body(probe.kind_of(owner)).then_some(owner)
}

/// Source uses of callable bindings, indexed once before closure collection.
/// The same proof serves capture selection and initialization effects.
#[derive(Debug, Default)]
pub(super) struct PrivateReaders {
    mentions: FxHashMap<u32, Vec<NodeId>>,
}

impl PrivateReaders {
    pub(super) fn new(probe: &FuncBuilder) -> Self {
        let mut result = Self::default();
        for (index, node) in probe.snapshot.nodes.iter().enumerate() {
            let Ok(index) = u32::try_from(index) else {
                continue;
            };
            let at = NodeId(index);
            if reads_a_name(probe, at)
                && let Some(symbol) = node.symbol
            {
                result.mentions.entry(symbol.0).or_default().push(at);
            }
        }
        result
    }

    /// Permission to omit only: every use is a direct call in the declaring
    /// invocation, after an unconditional declaration. Escaped readers, calls
    /// from another body, and re-entered scopes retain their readiness check.
    pub(super) fn ready_after(
        &self,
        probe: &FuncBuilder,
        reader: NodeId,
        declaration: NodeId,
    ) -> bool {
        let Some(owner) = unconditional_owner(probe, declaration) else {
            return false;
        };
        let binding = match probe.kind_of(reader) {
            Some(syntax::FUNCTION_DECLARATION) => reader,
            Some(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION) => {
                let Some(binding) = syntax_parent(probe, reader) else {
                    return false;
                };
                if probe.kind_of(binding) != Some(syntax::VARIABLE_DECLARATION)
                    || the_function_of(probe, binding) != reader
                {
                    return false;
                }
                binding
            }
            _ => return false,
        };
        if execution_owner(probe, binding) != Some(owner) {
            return false;
        }
        let Some(name) = probe.children(binding).first().copied() else {
            return false;
        };
        let Some(symbol) = probe.node(name).symbol else {
            return false;
        };
        let initialized = probe.node(declaration).origin.location;
        self.mentions.get(&symbol.0).is_some_and(|uses| {
            uses.iter().all(|at| {
                if *at == name {
                    return true;
                }
                let called = probe.node(*at).origin.location;
                probe.is_callee(*at)
                    && execution_owner(probe, *at) == Some(owner)
                    && called.file == initialized.file
                    && called.span.start > initialized.span.end
            })
        })
    }
}

fn cells_proven_ready(
    probe: &FuncBuilder,
    closures: &[ClosureInfo],
    candidates: &FxHashSet<u32>,
    readers: &PrivateReaders,
) -> FxHashSet<u32> {
    candidates
        .iter()
        .copied()
        .filter(|symbol| {
            let Some(record) = probe.snapshot.symbols.get(*symbol as usize) else {
                return false;
            };
            let [declaration] = record.declarations.as_slice() else {
                return false;
            };
            closures
                .iter()
                .filter(|closure| {
                    closure.refusal.is_none()
                        && closure
                            .captures
                            .iter()
                            .any(|capture| capture.symbol == *symbol)
                })
                .all(|closure| readers.ready_after(probe, closure.node, *declaration))
        })
        .collect()
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
        if matches!(
            kind,
            Some(
                syntax::CALL_EXPRESSION
                    | syntax::NEW_EXPRESSION
                    | syntax::TAGGED_TEMPLATE_EXPRESSION
            )
        ) || self.probe.reads_an_accessor(at)
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
pub(super) fn analyze(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    closures: &[ClosureInfo],
    readers: &PrivateReaders,
) -> Analysis {
    let mut analysis = Analysis {
        bindings: module_bindings(probe),
        cyclic: evaluation_order(snapshot, &[])
            .1
            .into_iter()
            .flatten()
            .collect(),
        ..Analysis::default()
    };
    analysis.captured_cells(probe, closures, readers);
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
    // Source assertions synthesize throws without a THROW_STATEMENT, and so
    // do `+` of a bigint and a dereferenced getter read the checker narrowed
    // past an absence. Keep their effect at each enclosing expression so all
    // existing folding and synchronous-call decisions use the same licence as
    // lowering.
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let nts_semantic_schema::NodeKind::Syntax(kind) = node.kind else {
            continue;
        };
        let Ok(index) = u32::try_from(index) else {
            continue;
        };
        let at = NodeId(index);
        let throws = match kind {
            syntax::AS_EXPRESSION | syntax::NON_NULL_EXPRESSION => {
                super::assertions::can_throw(probe, at)
            }
            syntax::PREFIX_UNARY_EXPRESSION => probe.plus_of_a_bigint(at),
            syntax::PROPERTY_ACCESS_EXPRESSION => {
                super::assertions::getter_read_can_throw(probe, at)
            }
            _ => false,
        };
        if throws {
            analysis.preserve_effect(probe, at);
        }
    }
    analysis
}
