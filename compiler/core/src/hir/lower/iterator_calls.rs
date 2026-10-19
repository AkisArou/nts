//! The ordinary methods called implicitly by an iterable walk, and by `+`
//! converting an object to a primitive. Source call analysis and lowering
//! share these identities; a loop or an operator has no call expression from
//! which either could recover them later.

use nts_semantic_schema::{NodeId, TypeId};
use rustc_hash::{FxHashMap, FxHashSet};
use std::rc::Rc;

use super::{
    Callee, Diagnostic, FuncBuilder, HirType, ManagedType, OpKind, Origin, RAISING_SUFFIX, Reached,
    Terminator, abstract_generator_kind, declaration_initializer, for_each_parts, members_filling,
    syntax,
};

#[derive(Clone)]
pub(super) struct Target {
    pub declaration: NodeId,
    pub symbol: u32,
}

#[derive(Clone)]
pub(super) struct Method {
    pub receiver: TypeId,
    pub key: String,
    pub targets: Vec<Target>,
}

impl Method {
    pub(super) fn resolve(probe: &FuncBuilder<'_>, receiver: TypeId, key: &str) -> Option<Self> {
        let owner = probe.hierarchy.declaring(receiver, key)?;
        let mut declarations = if probe.hierarchy.overridden(receiver, key) {
            members_filling(probe.snapshot, probe, &probe.hierarchy, owner, key)
        } else {
            vec![probe.implementation_of(
                probe.member_declaration(owner, key.strip_prefix("get ").unwrap_or(key))?,
            )]
        };
        for literal in probe
            .hierarchy
            .literal_methods
            .owners()
            .filter(|owner| probe.hierarchy.descends_from(*owner, receiver))
        {
            declarations.extend(
                probe
                    .hierarchy
                    .literal_methods
                    .method_declarations(probe, literal, key),
            );
        }
        let mut targets: Vec<_> = declarations
            .into_iter()
            .filter_map(|declaration| {
                let symbol = probe
                    .name_node(declaration)
                    .and_then(|name| probe.node(name).symbol)
                    .map(|symbol| symbol.0)
                    .or_else(|| {
                        probe
                            .snapshot
                            .symbols
                            .iter()
                            .position(|record| record.declarations.contains(&declaration))
                            .and_then(|at| u32::try_from(at).ok())
                    })?;
                Some(Target {
                    declaration,
                    symbol,
                })
            })
            .collect();
        targets.sort_by_key(|target| target.declaration);
        targets.dedup_by_key(|target| target.declaration);
        Some(Self {
            receiver,
            key: key.to_owned(),
            targets,
        })
    }

    pub(super) fn can_raise(&self, throwing: &FxHashSet<u32>) -> bool {
        self.targets
            .iter()
            .any(|target| throwing.contains(&target.symbol))
    }
}

struct Site {
    methods: Vec<Rc<Method>>,
    steps: usize,
    close: Option<Rc<super::iterator_close::Selection>>,
    normal_close: bool,
}

#[derive(Default)]
pub(super) struct Plan {
    sites: FxHashMap<NodeId, Site>,
    methods: FxHashMap<(TypeId, String), Option<Rc<Method>>>,
    /// The types whose chain declares a program `valueOf`, sorted: asked by
    /// every conversion whose operand's type has none, so it is found once.
    value_of: Vec<TypeId>,
}

impl Plan {
    pub(super) fn new(probe: &FuncBuilder<'_>, generators: &FxHashMap<NodeId, usize>) -> Self {
        let mut plan = Self::default();
        let mut named: Vec<TypeId> = probe.hierarchy.name.keys().copied().collect();
        named.sort();
        plan.value_of = named
            .into_iter()
            .filter(|ty| {
                plan.resolve_method(probe, *ty, "valueOf")
                    .is_some_and(|method| !method.targets.is_empty())
            })
            .collect();
        let mut closes = FxHashMap::default();
        for at in 0..probe.snapshot.nodes.len() {
            let Ok(at) = u32::try_from(at) else { break };
            let at = NodeId(at);
            let conversions = plan.conversion_methods(probe, at);
            if !conversions.is_empty() {
                plan.sites.insert(
                    at,
                    Site {
                        steps: conversions.len(),
                        methods: conversions,
                        close: None,
                        normal_close: false,
                    },
                );
                continue;
            }
            let Some(input) = input_of(probe, at) else {
                continue;
            };
            let (input, forced) = probe.sequence_source(input);
            if forced.is_some() {
                continue;
            }
            let Some(HirType::Managed(ManagedType::Object(receiver))) = probe.type_of(input) else {
                continue;
            };
            if abstract_generator_kind(probe.snapshot, receiver).is_some() {
                continue;
            }
            let Some(key) = probe.symbol_property_name(receiver, "iterator") else {
                continue;
            };
            let Some(iterator) = plan.resolve_method(probe, receiver, &key) else {
                continue;
            };
            let frame = probe
                .member_declaration(receiver, &key)
                .is_some_and(|declaration| generators.contains_key(&declaration));
            let mut site = Site {
                methods: vec![iterator],
                steps: 1,
                close: None,
                normal_close: false,
            };
            if let Some(HirType::Managed(ManagedType::Object(receiver))) =
                probe.member_returns(receiver, &key)
                && let Some(next) = plan.resolve_method(probe, receiver, "next")
            {
                site.methods.push(next);
                site.steps = site.methods.len();
                if !frame
                    && !super::iterator_close::guarded_regions(probe, at).is_empty()
                    && let Some(selection) = closes
                        .entry(receiver)
                        .or_insert_with(|| {
                            super::iterator_close::Selection::resolve(probe, receiver).map(Rc::new)
                        })
                        .clone()
                {
                    site.methods.extend(selection.methods());
                    site.normal_close = super::iterator_close::may_leave_without_throw(probe, at);
                    site.close = Some(selection);
                }
            }
            plan.sites.insert(at, site);
        }
        plan
    }

    /// The calls an operator converting its operands to primitives may make:
    /// `OrdinaryToPrimitive` (ECMA-262 7.1.1.1) asks an object's `valueOf`, then
    /// its `toString`, and where the operand's class declares either in the
    /// program that is an ordinary method call no call expression spells. Both
    /// are listed whichever answers first, which is what "may call" means;
    /// `FuncBuilder::ordinary_to_primitive` refuses a call this did not list.
    fn conversion_methods(&mut self, probe: &FuncBuilder<'_>, at: NodeId) -> Vec<Rc<Method>> {
        let mut methods = Vec::new();
        for operand in converted_operands(probe, at) {
            let Some(HirType::Managed(ManagedType::Object(receiver))) = probe.type_of(operand)
            else {
                continue;
            };
            for key in ["valueOf", "toString"] {
                if let Some(method) = self.resolve_method(probe, receiver, key)
                    && !method.targets.is_empty()
                {
                    methods.push(method);
                }
            }
        }
        methods
    }

    fn resolve_method(
        &mut self,
        probe: &FuncBuilder<'_>,
        receiver: TypeId,
        key: &str,
    ) -> Option<Rc<Method>> {
        self.methods
            .entry((receiver, key.to_owned()))
            .or_insert_with(|| Method::resolve(probe, receiver, key).map(Rc::new))
            .clone()
    }

    /// The types whose chain declares a program `valueOf`.
    pub(super) fn declaring_value_of(&self) -> &[TypeId] {
        &self.value_of
    }

    pub(super) fn closes_at(&self, at: NodeId) -> Option<Rc<super::iterator_close::Selection>> {
        self.sites.get(&at).and_then(|site| site.close.clone())
    }

    pub(super) fn close_can_raise(&self, at: NodeId) -> bool {
        self.sites.get(&at).is_some_and(|site| site.normal_close)
    }

    pub(super) fn close_calls_value(&self, at: NodeId) -> bool {
        self.closes_at(at).is_some_and(|close| close.calls_value())
    }

    pub(super) fn at(&self, at: NodeId) -> &[Rc<Method>] {
        self.sites
            .get(&at)
            .map_or(&[], |site| site.methods.as_slice())
    }

    pub(super) fn potential_calls(&self, at: NodeId) -> impl Iterator<Item = Reached> + '_ {
        let count = self.sites.get(&at).map_or(0, |site| {
            if site.normal_close {
                site.methods.len()
            } else {
                site.steps
            }
        });
        self.at(at)
            .iter()
            .take(count)
            .flat_map(|method| &method.targets)
            .map(|target| Reached::Body(target.symbol))
    }

    pub(super) fn raising_callees(&self, at: NodeId, throwing: &FxHashSet<u32>) -> Vec<NodeId> {
        self.at(at)
            .iter()
            .flat_map(|method| &method.targets)
            .filter(|target| throwing.contains(&target.symbol))
            .map(|target| target.declaration)
            .collect()
    }
}

/// Only contexts that actually create a Walk. Ordinary mentions of an iterable
/// are not calls to its protocol. Generator-pattern admission is separate.
fn input_of(probe: &FuncBuilder<'_>, at: NodeId) -> Option<NodeId> {
    match probe.kind_of(at)? {
        syntax::FOR_OF_STATEMENT => for_each_parts(probe, at).map(|(_, [_, source, _])| source),
        syntax::VARIABLE_DECLARATION => {
            let name = probe
                .children(at)
                .into_iter()
                .find(|child| probe.kind_of(*child) == Some(syntax::ARRAY_BINDING_PATTERN))?;
            if !bare_rest(probe, name) {
                return None;
            }
            declaration_initializer(&probe.children(at), name, |node| probe.kind_of(node))
        }
        syntax::PARAMETER => {
            let name = probe
                .children(at)
                .into_iter()
                .find(|child| probe.kind_of(*child) == Some(syntax::ARRAY_BINDING_PATTERN))?;
            bare_rest(probe, name).then_some(at)
        }
        syntax::YIELD_EXPRESSION => {
            let children = probe.children(at);
            children
                .iter()
                .any(|child| probe.kind_of(*child) == Some(syntax::ASTERISK_TOKEN))
                .then(|| {
                    children
                        .iter()
                        .copied()
                        .find(|child| probe.kind_of(*child) != Some(syntax::ASTERISK_TOKEN))
                })?
        }
        syntax::CALL_EXPRESSION => {
            let callee = *probe.children(at).first()?;
            if probe.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
                return None;
            }
            let parts = probe.children(callee);
            let [object, member] = parts.as_slice() else {
                return None;
            };
            if probe.kind_of(*object) != Some(syntax::IDENTIFIER)
                || probe.node(*object).text.as_deref() != Some("Array")
                || probe.node(*member).text.as_deref() != Some("from")
            {
                return None;
            }
            let arguments = probe.arguments_of(at);
            matches!(arguments.len(), 1 | 2).then(|| arguments[0])
        }
        _ => None,
    }
}

/// The operands of an operator that converts them to primitives through
/// `valueOf`: `+` and `+=` (hint "default") and a relational comparison (hint
/// "number"). The rest of the numeric operators do not convert objects yet.
fn converted_operands(probe: &FuncBuilder<'_>, at: NodeId) -> Vec<NodeId> {
    if probe.kind_of(at) != Some(syntax::BINARY_EXPRESSION) {
        return Vec::new();
    }
    let children = probe.children(at);
    let [left, operator, right] = children.as_slice() else {
        return Vec::new();
    };
    if matches!(
        probe.kind_of(*operator),
        Some(
            syntax::PLUS_TOKEN
                | syntax::PLUS_EQUALS_TOKEN
                | syntax::LESS_THAN_TOKEN
                | syntax::GREATER_THAN_TOKEN
                | syntax::LESS_THAN_EQUALS_TOKEN
                | syntax::GREATER_THAN_EQUALS_TOKEN
        )
    ) {
        vec![*left, *right]
    } else {
        Vec::new()
    }
}

fn bare_rest(probe: &FuncBuilder<'_>, pattern: NodeId) -> bool {
    if probe.kind_of(pattern) != Some(syntax::ARRAY_BINDING_PATTERN) {
        return false;
    }
    let elements = probe.children(pattern);
    let [element] = elements.as_slice() else {
        return false;
    };
    probe.kind_of(*element) == Some(syntax::BINDING_ELEMENT)
        && probe
            .children(*element)
            .iter()
            .any(|at| probe.kind_of(*at) == Some(syntax::DOT_DOT_DOT_TOKEN))
}

impl FuncBuilder<'_> {
    pub(super) fn potential_implicit_calls(
        &self,
        at: NodeId,
    ) -> impl Iterator<Item = Reached> + '_ {
        self.printers
            .potential_calls(at)
            .chain(self.iterators.potential_calls(at))
    }

    pub(super) fn implicit_iterator_callees(&self, at: NodeId) -> Vec<NodeId> {
        self.iterators.raising_callees(at, &self.throwing)
    }

    pub(super) fn implicit_method(
        &mut self,
        at: NodeId,
        receiver: TypeId,
        key: &str,
    ) -> Result<(Callee, bool), Diagnostic> {
        let method = self
            .iterators
            .methods
            .get(&(receiver, key.to_owned()))
            .cloned()
            .flatten()
            .or_else(|| Method::resolve(self, receiver, key).map(Rc::new));
        let raises = method
            .as_ref()
            .is_some_and(|method| method.can_raise(&self.throwing))
            && (self.raises || !self.exits.is_empty());
        if raises
            && let Some(method) = &method
            && method.targets.iter().any(|target| {
                self.throwing.contains(&target.symbol)
                    && !self.raising.contains(&target.declaration)
            })
        {
            return Err(self.unsupported(
                at,
                &format!("an implicit iterator `{key}` call whose raising entry is unavailable"),
            ));
        }
        let suffix = if raises { RAISING_SUFFIX } else { "" };
        Ok((self.method_callee(at, receiver, key, suffix)?, raises))
    }

    /// Poll before any result is consumed, then use the language's own throw
    /// boundary so enclosing finally/iterator actions run in lexical order.
    pub(super) fn implicit_raise_test(
        &mut self,
        at: NodeId,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let flag_type = HirType::Int {
            bits: 32,
            signed: true,
        };
        let flag = self.runtime_call("nts_raising", Vec::new(), flag_type.clone(), origin.clone());
        let zero = self.push(OpKind::ConstInt(0), flag_type, origin.clone());
        let raised = self.push(
            OpKind::Binary {
                op: super::BinOp::Ne,
                lhs: flag,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let took = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: raised,
            then_target: took,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(took);
        self.lower_arm(|this| {
            let thrown = this.runtime_call(
                "nts_raise_take",
                Vec::new(),
                HirType::Erased,
                origin.clone(),
            );
            this.throw_erased(at, thrown, thrown, &HirType::Erased)
        })?;
        self.switch_to(carry_on);
        Ok(())
    }
}
