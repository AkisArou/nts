//! Constructor selection starts with the referenced value, never its result type.

use nts_semantic_schema::{Library, SymbolId, TypeId};

use super::{
    Callee, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, TypeKind, ValueId, class_symbol,
    const_alias_of, declaration_initializer, declares_a_class, instance_type_of, syntax,
    the_constructor_declared_by,
};

/// A subclass of a builtin with a class in its chain that is not that
/// builtin's storage: one declaring fields, or one that is not a subclass of it.
pub(super) const NOT_ITS_STORAGE: &str = "a subclass of a builtin with a class in its chain that \
     declares fields or is not that builtin's storage";

/// A class whose `extends` operand references something other than the base
/// its type names: `extends (Own as unknown as typeof Base)` runs `Own`.
const BASE_THROUGH_A_CAST: &str =
    "a class extending a cast, whose base its type names something it does not run";

/// The type a `new` is called through says its constructor builds something it
/// does not.
const SITE_HOLDS_OTHERWISE: &str =
    "a `new` whose constructor builds something other than the type its site holds";

pub(super) struct CheckedGlobalReference {
    pub(super) symbol: SymbolId,
    pub(super) name: String,
    pub(super) library: Library,
    pub(super) bindings: Vec<u32>,
}

pub(super) struct ReferencedValue {
    pub(super) symbol: SymbolId,
    pub(super) bindings: Vec<u32>,
}

/// Global identity is separate from the ordered bindings that authorize an
/// executable read. The collector may retain the former without the latter.
pub(super) struct CheckedGlobalIdentity {
    pub(super) symbol: SymbolId,
    pub(super) name: String,
    pub(super) library: Library,
}

impl CheckedGlobalIdentity {
    pub(super) fn with_bindings(self, bindings: Vec<u32>) -> CheckedGlobalReference {
        CheckedGlobalReference {
            symbol: self.symbol,
            name: self.name,
            library: self.library,
            bindings,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) enum ReferenceStep {
    Terminal(SymbolId),
    Alias { symbol: SymbolId, next: SymbolId },
}

impl ReferenceStep {
    pub(super) const fn symbol(self) -> SymbolId {
        match self {
            Self::Terminal(symbol) | Self::Alias { symbol, .. } => symbol,
        }
    }
}

impl FuncBuilder<'_> {
    /// The shared identity reader for builtin calls, members and construction.
    /// Constant aliases preserve the checked global identity; their reads still
    /// owe the ordinary initialization checks when lowering consumes this proof.
    pub(super) fn checked_global_reference(&self, at: NodeId) -> Option<CheckedGlobalReference> {
        let reference = self.referenced_value(at)?;
        Some(
            self.checked_global_identity(reference.symbol)?
                .with_bindings(reference.bindings),
        )
    }

    /// The same checked global membership authority used by executable reads,
    /// without claiming that any source binding has been initialized yet.
    pub(super) fn checked_global_identity(
        &self,
        symbol: SymbolId,
    ) -> Option<CheckedGlobalIdentity> {
        let binding = super::super::features::global_binding(
            &self.snapshot.symbols,
            symbol,
            super::super::features::GlobalMeaning::Value,
        )
        .ok()??;
        Some(CheckedGlobalIdentity {
            symbol: binding.symbol(),
            name: binding.name().to_owned(),
            library: binding.library().clone(),
        })
    }

    pub(super) fn reference_start(&self, at: NodeId) -> Option<SymbolId> {
        let at = self.through_assertions(at);
        (self.kind_of(at) == Some(syntax::IDENTIFIER))
            .then(|| self.node(at).symbol)
            .flatten()
    }

    /// One existing const-alias step: checked import identity first, then the
    /// same declaration/const-initializer rule as the ordinary value reader.
    pub(super) fn reference_step(&self, symbol: SymbolId) -> Option<ReferenceStep> {
        self.snapshot.symbols.get(symbol.0 as usize)?;
        let symbol = self.denoted_symbol(symbol);
        let record = self.snapshot.symbols.get(symbol.0 as usize)?;
        let [declaration] = record.declarations.as_slice() else {
            return Some(ReferenceStep::Terminal(symbol));
        };
        let Some(target) = const_alias_of(self, *declaration) else {
            return Some(ReferenceStep::Terminal(symbol));
        };
        Some(ReferenceStep::Alias {
            symbol,
            next: SymbolId(target),
        })
    }

    pub(super) fn referenced_value(&self, at: NodeId) -> Option<ReferencedValue> {
        let mut symbol = self.reference_start(at)?;
        let mut bindings = Vec::new();
        for _ in 0..self.snapshot.symbols.len() {
            match self.reference_step(symbol)? {
                ReferenceStep::Terminal(symbol) => {
                    #[cfg(test)]
                    super::view_class_tests::note_discovery_bindings(bindings.len());
                    return Some(ReferencedValue { symbol, bindings });
                }
                ReferenceStep::Alias {
                    symbol: binding,
                    next,
                } => {
                    #[cfg(test)]
                    super::view_class_tests::note_alias_link();
                    bindings.push(binding.0);
                    symbol = next;
                }
            }
        }
        None
    }

    /// The declaration whose body a reference to `symbol` runs: a class or
    /// function declaration, or the class expression a binding is initialized
    /// with. Such a binding holds no value (see `lower_variable_statement`);
    /// it names its class as a declaration does. A `let` or `var` does so only
    /// where nothing writes it again -- the rule `initializer_settles` states
    /// for a function -- since a reassigned one can hold another constructor.
    pub(super) fn referenced_declaration(&self, symbol: SymbolId) -> Option<NodeId> {
        let record = self.snapshot.symbols.get(symbol.0 as usize)?;
        record.declarations.iter().find_map(|&declaration| {
            let kind = self.kind_of(declaration)?;
            if declares_a_class(kind) {
                return Some(declaration);
            }
            // An overloaded factory's first declaration is a signature; the
            // body is its implementation's.
            if kind == syntax::FUNCTION_DECLARATION {
                return Some(self.implementation_of(declaration));
            }
            if kind != syntax::VARIABLE_DECLARATION {
                return None;
            }
            let name = self.name_node(declaration)?;
            if self.declaration_kind(declaration) != nts_semantic_schema::VariableKind::Const
                && super::reassigned_anywhere(self, name)
            {
                return None;
            }
            declaration_initializer(&self.children(declaration), name, |at| self.kind_of(at))
                .filter(|at| self.kind_of(*at) == Some(syntax::CLASS_EXPRESSION))
        })
    }

    fn read_constructor_binding(
        &mut self,
        at: NodeId,
        reference: &ReferencedValue,
    ) -> Result<(), Diagnostic> {
        for binding in &reference.bindings {
            self.check_initialized(at, *binding)?;
        }
        self.check_initialized(at, reference.symbol.0)
    }

    pub(super) fn lower_referenced_construction(
        &mut self,
        id: NodeId,
        callee: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        let reference = self.referenced_value(callee)?;
        if let Some(global) = self.checked_global_reference(callee) {
            if global.library != Library::Es {
                return None;
            }
            return Some((|| {
                for binding in &global.bindings {
                    self.check_initialized(callee, *binding)?;
                }
                self.lower_builtin_construction(id, &global)
            })());
        }
        let declaration = self.referenced_declaration(reference.symbol)?;
        if self.kind_of(declaration).is_some_and(declares_a_class) {
            let class = instance_type_of(self.snapshot, declaration)
                .and_then(|ty| class_symbol(self.snapshot, ty))?;
            if !self.an_implemented_class(class) {
                return None;
            }
            Some((|| {
                self.read_constructor_binding(callee, &reference)?;
                self.lower_source_class_construction(id, callee, declaration)
            })())
        } else {
            Some((|| {
                self.read_constructor_binding(callee, &reference)?;
                self.lower_source_function_construction(id, declaration)
            })())
        }
    }

    fn lower_source_class_construction(
        &mut self,
        id: NodeId,
        callee: NodeId,
        declaration: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let declared = instance_type_of(self.snapshot, declaration)
            .ok_or_else(|| self.unrepresentable(declaration, "the referenced constructor"))?;
        // The declaration chose the class; the checker's type at this site says
        // which instantiation of it, which `Box<T>` alone cannot. A site typed
        // as some other class or a builtin is a cast, which says nothing about
        // this class: its own instance type is built, and must be what the
        // site holds.
        let class = class_symbol(self.snapshot, declared);
        let names_the_class = class.is_some()
            && self
                .snapshot
                .node_types
                .get(&id)
                .is_some_and(|site| class_symbol(self.snapshot, *site) == class);
        // A class whose instances are its builtin base's storage is built by
        // the nearest constructor up its chain, or by that builtin.
        if let Some(native) = self.native_instance(declaration, None) {
            if !names_the_class {
                self.refuse_a_site_holding_otherwise(id, &native)?;
            }
            let target = self
                .native_constructor_of(declaration)
                .ok_or_else(|| self.unsupported(id, NOT_ITS_STORAGE))?;
            return self.construct_native(id, target, native, declared);
        }
        let ty = if names_the_class {
            self.type_of(id)
                .ok_or_else(|| self.unrepresentable(id, "a `new`"))?
        } else {
            let built = self
                .represent(declared)
                .ok_or_else(|| self.unrepresentable(declaration, "the referenced constructor"))?;
            self.refuse_a_site_holding_otherwise(id, &built)?;
            built
        };
        let ty = self.widened(id, ty);
        let HirType::Managed(ManagedType::Object(type_id)) = ty else {
            return Err(
                self.unsupported(id, "a source constructor without object instance storage")
            );
        };
        if !self.bases_are_what_they_reference(declaration) {
            return Err(self.unsupported(id, BASE_THROUGH_A_CAST));
        }
        self.require_an_implemented_constructor(id, type_id)?;
        let name = self
            .hierarchy
            .name
            .get(&type_id)
            .cloned()
            .unwrap_or_else(|| "constructor".to_owned());
        let constructor = self.constructor_running(type_id);
        // The checker's resolution is the arguments' authority only where it
        // reached this constructor, which carries the instantiation; a cast
        // reaches some other one.
        let resolved = self
            .snapshot
            .call_targets
            .get(&id)
            .and_then(|target| target.callee)
            .map(|callee| self.implementation_of(callee));
        let saved = self.argument_declaration;
        if let Some(constructor) = constructor
            && resolved != Some(constructor)
        {
            self.argument_declaration = Some((id, constructor));
        }
        let result = self.lower_new_object(id, ty, type_id, callee, name);
        self.argument_declaration = saved;
        result
    }

    /// The constructor a `new` of a source class runs, found by the route
    /// `lower_referenced_construction` takes: the class its callee references,
    /// then the nearest constructor declared up that class's chain. The copy
    /// planner asks this rather than the checker, whose resolution through a
    /// value typed `new (n: number) => Sized` is that type's signature, which
    /// has no body. `None` where the callee references no source class.
    pub(super) fn referenced_constructor(&self, site: NodeId) -> Option<NodeId> {
        let callee = *self.children(site).first()?;
        let reference = self.referenced_value(callee)?;
        if self.checked_global_reference(callee).is_some() {
            return None;
        }
        let declaration = self.referenced_declaration(reference.symbol)?;
        if !self.kind_of(declaration).is_some_and(declares_a_class) {
            return None;
        }
        let declared = instance_type_of(self.snapshot, declaration)?;
        let Some(HirType::Managed(ManagedType::Object(type_id))) = self.represent(declared) else {
            return None;
        };
        self.constructor_running(type_id)
    }

    /// The constructor a `super(...)` runs, found as `lower_super` finds it:
    /// the nearest one declared above the enclosing class. Through `class Sub
    /// extends Base` with `const Base: new (n: number) => Sized = Sized`, the
    /// checker resolves the call to the annotation's signature.
    pub(super) fn super_constructor(&self, call: NodeId) -> Option<NodeId> {
        let class = self.enclosing_class(call)?;
        let declared = instance_type_of(self.snapshot, class)?;
        let Some(HirType::Managed(ManagedType::Object(type_id))) = self.represent(declared) else {
            return None;
        };
        let base = self.hierarchy.base.get(&type_id).copied()?;
        self.constructor_running(base)
    }

    /// The nearest constructor declared up `type_id`'s class chain.
    fn constructor_running(&self, type_id: TypeId) -> Option<NodeId> {
        self.hierarchy
            .constructor(type_id)
            .and_then(|owner| class_symbol(self.snapshot, owner))
            .and_then(|symbol| self.snapshot.symbols.get(symbol as usize))
            .and_then(|record| {
                record
                    .declarations
                    .iter()
                    .find_map(|class| the_constructor_declared_by(self, *class))
            })
    }

    fn lower_source_function_construction(
        &mut self,
        id: NodeId,
        declaration: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        if self
            .node(declaration)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::ASYNC)
            || self
                .children(declaration)
                .iter()
                .any(|child| self.kind_of(*child) == Some(syntax::ASTERISK_TOKEN))
        {
            return Err(self.unsupported(id, "construction through a non-constructible function"));
        }
        let ty = self
            .read_type(declaration)
            .ok_or_else(|| self.unrepresentable(declaration, "a function constructor"))?;
        let TypeKind::Function(signature) = self.snapshot.types[ty.0 as usize].kind else {
            return Err(self.unsupported(id, "a function constructor without a callable signature"));
        };
        let signature = &self.snapshot.signatures[signature.0 as usize];
        let returns_object = self.represent(signature.return_type).is_some_and(|ty| {
            matches!(ty, HirType::Managed(ref kind) if !matches!(kind, ManagedType::String | ManagedType::Symbol))
        });
        if signature.this_type.is_some()
            || !returns_object
            || !self.constructor_factory_returns_objects(declaration)
        {
            return Err(self.unsupported(
                id,
                "a function constructor requiring instance storage or a primitive-return fallback",
            ));
        }
        let return_type = signature.return_type;
        // Reached only through a cast, so the factory's own return is what is
        // built, and must be what the site holds.
        let returned = self.represent(return_type).ok_or_else(|| {
            self.unrepresentable(declaration, "the referenced constructor's object return")
        })?;
        self.refuse_a_site_holding_otherwise(id, &returned)?;
        // A proved object return is the result of [[Construct]]. No instance
        // receiver is observed by this signature, so its allocation is dead.
        let saved_signature = self.callee_signature;
        let saved_declaration = self.argument_declaration;
        self.callee_signature = Some((id, ty));
        self.argument_declaration = Some((id, declaration));
        let result = (|| {
            let name_node = self.name_node(declaration).unwrap_or(declaration);
            let arguments = self.arguments_of(id);
            let captured = self
                .node(name_node)
                .symbol
                .and_then(|symbol| self.closure_bound_to(symbol.0))
                .and_then(|ty| match ty {
                    HirType::Managed(ManagedType::Object(ty)) => {
                        self.closures.get(super::closure_index(ty))
                    }
                    _ => None,
                })
                .is_some_and(|info| !info.captures.is_empty());
            if captured {
                return self.lower_closure_call(id, name_node, &arguments);
            }
            let name = self.emitted_callee_name(Some(declaration), name_node)?;
            let specialization = self.generic_calls.get(&id).map_or("", String::as_str);
            let name = format!("{name}{specialization}{}", self.raising_suffix_of(id));
            let callee = Callee::Direct(name);
            let (args, lent) = self.lower_call_arguments(id, &callee, &arguments, None)?;
            self.finish_call_typed(id, callee, args, lent, Some(declaration), Some(returned))
        })();
        self.callee_signature = saved_signature;
        self.argument_declaration = saved_declaration;
        result
    }

    /// A typed object return alone does not exclude `null!` or `as any`.
    /// This factory form needs neither a receiver nor a primitive-return
    /// fallback only when the authored returns themselves prove that fact.
    fn constructor_factory_returns_objects(&self, declaration: NodeId) -> bool {
        if self.binds_this(declaration) {
            return false;
        }
        let Some(body) = self
            .children(declaration)
            .into_iter()
            .find(|at| self.kind_of(*at) == Some(syntax::BLOCK))
        else {
            return false;
        };
        // A terminal authored return excludes an implicit undefined result.
        if self.children(body).last().and_then(|at| self.kind_of(*at))
            != Some(syntax::RETURN_STATEMENT)
        {
            return false;
        }
        let mut context = self.children(declaration);
        while let Some(at) = context.pop() {
            if self.kind_of(at) == Some(syntax::META_PROPERTY) {
                return false;
            }
            context.extend(self.children(at));
        }
        let mut pending = self.children(body);
        while let Some(at) = pending.pop() {
            match self.kind_of(at) {
                Some(syntax::RETURN_STATEMENT) => {
                    let Some(value) = self.children(at).first().copied() else {
                        return false;
                    };
                    if !matches!(
                        self.kind_of(self.through_assertions(value)),
                        Some(
                            syntax::ARRAY_LITERAL_EXPRESSION
                                | syntax::OBJECT_LITERAL_EXPRESSION
                                | syntax::NEW_EXPRESSION
                                | syntax::FUNCTION_EXPRESSION
                                | syntax::ARROW_FUNCTION
                                | syntax::CLASS_EXPRESSION
                        )
                    ) {
                        return false;
                    }
                }
                Some(kind)
                    if super::binds_its_own_this(kind)
                        || matches!(kind, syntax::ARROW_FUNCTION | syntax::CLASS_EXPRESSION) =>
                {
                    continue;
                }
                _ => {}
            }
            pending.extend(self.children(at));
        }
        true
    }

    /// Construct the authenticated builtin `global` at `id`: a `new` of it, or
    /// the `super(...)` of a typed-array subclass that is its storage.
    pub(super) fn lower_builtin_construction(
        &mut self,
        id: NodeId,
        global: &CheckedGlobalReference,
    ) -> Result<ValueId, Diagnostic> {
        if global.name == "SharedArrayBuffer" {
            let callee = self.children(id).first().copied().unwrap_or(id);
            return Err(self.unsupported(callee, super::SHARED_BUFFER_REFUSAL));
        }
        if global.name == "Array" {
            let ty = self.allocated_array_type(id)?;
            return self.lower_array_construction(id, &ty);
        }
        if let Some(element) = super::super::builtin::typed_array_element(&global.name) {
            if self.kind_of(id) == Some(syntax::NEW_EXPRESSION) {
                let built = HirType::Managed(ManagedType::View(Box::new(element.clone())));
                self.refuse_a_site_holding_otherwise(id, &built)?;
            }
            return self.lower_new_typed_array(id, &global.name, element);
        }
        if super::super::builtin::is_error(&global.name) {
            let type_id = self
                .provided_error_class(global)
                .ok_or_else(|| self.unsupported(id, "an unavailable error constructor"))?;
            self.refuse_a_site_holding_otherwise(
                id,
                &HirType::Managed(ManagedType::Object(type_id)),
            )?;
            let layout = self
                .provided_layout(type_id)
                .unwrap_or_else(|| self.layout_for_provided_error(type_id, &global.name));
            if !self
                .layouts
                .iter()
                .any(|layout| layout.types.contains(&type_id))
            {
                self.layouts.push(layout);
            }
            // At the declaration's wider type, where one widens it.
            let ty = self.widened(id, HirType::Managed(ManagedType::Object(type_id)));
            let HirType::Managed(ManagedType::Object(allocated)) = ty else {
                return Err(self.unsupported(id, "an error constructed as something else"));
            };
            let callee = self.children(id).first().copied().unwrap_or(id);
            return self.lower_new_object(id, ty, allocated, callee, global.name.clone());
        }
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `new`"))?;
        if !matches!(
            global.name.as_str(),
            "Map" | "Set" | "Promise" | "Date" | "ArrayBuffer" | "DataView"
        ) {
            return Err(self.unsupported(
                id,
                &format!(
                    "a `new {}`, a builtin this compiler does not construct",
                    global.name
                ),
            ));
        }
        let ty = self.widened(id, ty);
        let ty = self.instead_of_an_unchosen_collection(id, ty);
        // These build what their site holds, so the site's representation
        // must be the global's own.
        let builds = matches!(
            (global.name.as_str(), &ty),
            ("Map", HirType::Managed(ManagedType::Map(..)))
                | ("Set", HirType::Managed(ManagedType::Set(_)))
                | ("Promise", HirType::Managed(ManagedType::Promise(_)))
                | ("Date", HirType::Managed(ManagedType::Date))
                | ("ArrayBuffer", HirType::Managed(ManagedType::Buffer))
                | ("DataView", HirType::Managed(ManagedType::DataView))
        );
        if !builds {
            return Err(self.unsupported(id, SITE_HOLDS_OTHERWISE));
        }
        self.lower_new_provided(id, &ty)
            .unwrap_or_else(|| Err(self.unsupported(id, "an unavailable builtin constructor")))
    }

    /// Whether every class from `class` up extends what its type says it does:
    /// the class its `extends` operand references is the checker's base, or
    /// the builtin global it references is. Only a proven difference answers
    /// `false` -- a cast as a base; an operand naming neither (a mixin call)
    /// is the checker's to say, as it always was.
    fn bases_are_what_they_reference(&self, class: NodeId) -> bool {
        let mut class = class;
        for _ in 0..self.snapshot.nodes.len() {
            let (Some(operand), Some(declared)) = (
                self.extends_operand(class),
                instance_type_of(self.snapshot, class),
            ) else {
                return true;
            };
            let Some(base) = self
                .snapshot
                .base_types
                .get(&declared)
                .and_then(|bases| bases.first().copied())
            else {
                return true;
            };
            if let Some(global) = self.checked_global_reference(operand) {
                return super::provided(self.snapshot, base) == Some(global.name.as_str())
                    || self.constructs(&global, base);
            }
            let Some(next) = self
                .referenced_value(operand)
                .and_then(|reference| self.referenced_declaration(reference.symbol))
                .filter(|next| self.kind_of(*next).is_some_and(declares_a_class))
            else {
                return true;
            };
            let next_class = instance_type_of(self.snapshot, next)
                .and_then(|ty| class_symbol(self.snapshot, ty));
            if next_class.is_none() || next_class != class_symbol(self.snapshot, base) {
                return false;
            }
            class = next;
        }
        true
    }

    /// Whether `callee` references the class whose constructor `constructor`
    /// is (or which `constructor` is, for a class with none written).
    pub(super) fn references_the_class_of(&self, callee: NodeId, constructor: NodeId) -> bool {
        let mut class = constructor;
        while !self.kind_of(class).is_some_and(declares_a_class) {
            let Some(parent) = self.node(class).parent else {
                return false;
            };
            class = parent;
        }
        if let Some(declaration) = self
            .referenced_value(callee)
            .and_then(|reference| self.referenced_declaration(reference.symbol))
        {
            return declaration == class;
        }
        // `Catalog.Entry`: a member of a namespace or a class, named by the
        // checker's symbol for it.
        self.kind_of(callee) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
            && self
                .node(callee)
                .symbol
                .map(|symbol| self.denoted_symbol(symbol))
                .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
                .is_some_and(|record| record.declarations.contains(&class))
    }

    /// Whether `callee` references what the `new` at `id` builds: a global
    /// whose instance type it is, or a declared class whose instance type it
    /// is. A binding's delegated constructor answers for that type only.
    pub(super) fn references_what_it_builds(&self, callee: NodeId, id: NodeId) -> bool {
        let Some(built) = self.snapshot.node_types.get(&id).copied() else {
            return false;
        };
        if let Some(global) = self.checked_global_reference(callee) {
            return self.constructs(&global, built);
        }
        // A binding's `declare var URL` merges with its `interface URL` into one
        // symbol, which is the built type's own, or the type records the
        // value constructing it.
        if let Some(reference) = self.referenced_value(callee) {
            let owner = self
                .snapshot
                .types
                .get(built.0 as usize)
                .and_then(|record| record.symbol)
                .map(|symbol| self.denoted_symbol(symbol));
            if owner == Some(reference.symbol)
                || self.constructor_value_of(built) == Some(reference.symbol)
            {
                return true;
            }
        }
        self.referenced_value(callee)
            .and_then(|reference| self.referenced_declaration(reference.symbol))
            .filter(|declaration| self.kind_of(*declaration).is_some_and(declares_a_class))
            .and_then(|declaration| instance_type_of(self.snapshot, declaration))
            .and_then(|instance| class_symbol(self.snapshot, instance))
            .is_some_and(|class| class_symbol(self.snapshot, built) == Some(class))
    }

    /// The provided error class an authenticated error global constructs: its
    /// entry in the canonical provided-error index, whose prototype the global
    /// owns, or the synthetic one where the prototype was not captured. One
    /// answer for `new` and `instanceof`; a program's own class of the same
    /// name is never it.
    pub(super) fn provided_error_class(&self, global: &CheckedGlobalReference) -> Option<TypeId> {
        let index = super::super::builtin::error_index(&global.name)?;
        Some(
            self.hierarchy
                .provided_errors
                .iter()
                .filter_map(|(ty, found)| {
                    if *found != index {
                        return None;
                    }
                    self.constructor_value_of(*ty)
                        .is_none_or(|symbol| symbol == global.symbol)
                        .then_some(*ty)
                })
                .min()
                .unwrap_or_else(|| super::super::provided_error_type(index)),
        )
    }

    /// The instance type an authenticated global constructs (`constructs`).
    pub(super) fn global_instance_type(&self, global: &CheckedGlobalReference) -> Option<TypeId> {
        (0..self.snapshot.types.len())
            .filter_map(|at| u32::try_from(at).ok().map(TypeId))
            .find(|ty| {
                matches!(
                    self.snapshot.types[ty.0 as usize].kind,
                    TypeKind::Object { .. }
                ) && self.constructs(global, *ty)
            })
    }

    /// Whether `global` is what constructs `ty`, by identity: the checker
    /// records it as the constructor value of `ty`'s owner, or the owner is the
    /// global's own symbol, as a `declare var` merged with its interface is.
    /// Never by name: a program's own class named like a builtin is not it.
    fn constructs(&self, global: &CheckedGlobalReference, ty: TypeId) -> bool {
        let owner = self
            .snapshot
            .types
            .get(ty.0 as usize)
            .and_then(|record| record.symbol)
            .map(|symbol| self.denoted_symbol(symbol));
        owner == Some(global.symbol) || self.constructor_value_of(ty) == Some(global.symbol)
    }

    fn constructor_value_of(&self, ty: TypeId) -> Option<SymbolId> {
        let symbol = self.snapshot.types.get(ty.0 as usize)?.symbol?;
        let value = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .constructor_value?;
        Some(self.denoted_symbol(value))
    }

    /// A `new` answers the type its site holds, so what its constructor builds
    /// must be that: the same representation, an object of the site's class or
    /// one below it, an error where the site holds one, or an erased site that
    /// carries the value's own tag. A cast that says the constructor builds
    /// something else is refused, rather than its object read as what the cast
    /// claims.
    pub(super) fn refuse_a_site_holding_otherwise(
        &self,
        id: NodeId,
        built: &HirType,
    ) -> Result<(), Diagnostic> {
        let Some(site) = self.type_of(id) else {
            return Ok(());
        };
        // A value dropped where it is made is read as nothing: `new C();`
        // runs the constructor, and no use holds what the cast claims.
        let mut use_of = self.node(id).parent;
        while let Some(at) = use_of
            && self.kind_of(at) == Some(syntax::PARENTHESIZED_EXPRESSION)
        {
            use_of = self.node(at).parent;
        }
        if use_of.is_some_and(|at| {
            matches!(
                self.kind_of(at),
                Some(syntax::EXPRESSION_STATEMENT | syntax::VOID_EXPRESSION)
            )
        }) {
            return Ok(());
        }
        let holds = site == *built
            || site == HirType::Erased
            || matches!((built, &site), (
                HirType::Managed(ManagedType::Object(built)),
                HirType::Managed(ManagedType::Object(site)),
            ) if self.descends_from(*built, *site)
                || (self.is_provided_error(*built) && self.is_provided_error(*site)));
        if holds {
            Ok(())
        } else {
            Err(self.unsupported(id, SITE_HOLDS_OTHERWISE))
        }
    }

    fn is_provided_error(&self, ty: TypeId) -> bool {
        super::provided(self.snapshot, ty).is_some_and(super::super::builtin::is_error)
            || self.provided_error_base(ty).is_some()
            || self
                .hierarchy
                .provided_errors
                .iter()
                .any(|(error, _)| *error == ty)
    }
}
