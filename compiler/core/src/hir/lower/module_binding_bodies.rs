//! Emit module binding writes and initialized-state checks for the reads and statements that use them.

use super::{
    BinOp, Diagnostic, FuncBuilder, HirType, LoweringSnapshot, NodeId, OpKind, PatternScope, Place,
    ValueId, collect_kind, declaration_initializer, declares_a_class, names_a_class_element,
    syntax,
};

/// Reads that happen before the module declaring them has evaluated.
///
/// This is the compile-time half of what node reports at runtime as
/// `ReferenceError: Cannot access 'x' before initialization`, and it is the one
/// thing a compiler can do here that a runtime cannot: node finds out when the
/// read executes, and only for the path it took.
///
/// The shape needs a cycle to exist at all. `b` importing `a` puts `a` first,
/// so a read in `b`'s module body is always safe -- unless `a` also imports
/// `b`, which is what lets the walk reach `b` first and leaves `a`'s bindings
/// in their dead zone while `b`'s body runs. That is why this arrived with
/// cycles rather than before them.
///
/// Without this the program compiles and is *wrong quietly*: a module-scope
/// binding is a global with a static initializer, so the read finds the
/// initializer rather than nothing, and the compiled program answers 7 where
/// node refuses to answer at all.
///
/// # What is and is not looked at
///
/// Only module-scope variable bindings, and only reads that module evaluation
/// actually performs. A read inside a function body is not one: by the time
/// anything calls it every module has evaluated, which is exactly how the
/// legal half of a cycle is written and why `tests/programs/module-cycle-late`
/// compiles.
///
/// A class is a dead-zone binding too, and is not checked here. Its heritage
/// clause is walked -- `class X extends Imported` does read at evaluation --
/// but the map is built from variable declarations, so nothing matches yet.
/// Instance property initializers are skipped for the opposite reason: they
/// run at construction, and treating them as evaluation would refuse programs
/// that are fine.
pub(super) fn dead_zone_reads(snapshot: &LoweringSnapshot<'_>, order: &[usize]) -> Vec<Diagnostic> {
    let probe = FuncBuilder::probe(snapshot);

    let mut position = vec![usize::MAX; snapshot.modules.len()];
    for (rank, at) in order.iter().enumerate() {
        if let Some(slot) = position.get_mut(*at) {
            *slot = rank;
        }
    }

    // Which module declares each module-scope binding. Keyed by the
    // declaration's own symbol, which is what an import alias resolves to.
    let mut declared_in: rustc_hash::FxHashMap<u32, usize> = rustc_hash::FxHashMap::default();
    for (at, module) in snapshot.modules.iter().enumerate() {
        for child in probe.children(module.root) {
            if probe.kind_of(child) != Some(syntax::VARIABLE_STATEMENT) {
                continue;
            }
            let mut names = Vec::new();
            probe.declared_symbols(child, &mut names);
            for symbol in names {
                declared_in.insert(symbol, at);
            }
        }
    }

    let mut found = Vec::new();
    for (at, module) in snapshot.modules.iter().enumerate() {
        let mine = position[at];
        for child in probe.children(module.root) {
            evaluated_reads(&probe, child, &mut |id| {
                let Some(symbol) = probe.node(id).symbol else {
                    return;
                };
                let target = probe.denoted_symbol(symbol);
                let Some(&declaring) = declared_in.get(&target.0) else {
                    return;
                };
                if declaring == at || position[declaring] <= mine {
                    return;
                }
                let name = &snapshot.symbols[target.0 as usize].name;
                let file = snapshot
                    .sources
                    .get(snapshot.modules[declaring].file.0 as usize)
                    .map_or_else(|| "another module".to_owned(), |source| source.uri.clone());
                found.push(Diagnostic::error(
                    "NTS1004",
                    format!(
                        "`{name}` is read here while evaluating this module, and `{file}` -- \
                         which declares it -- has not been evaluated yet; the two modules \
                         import each other, so one of them runs first and this is the one. \
                         Node reports the same program as `ReferenceError: Cannot access \
                         '{name}' before initialization`, at the moment the read runs"
                    ),
                    probe.location(id),
                ));
            });
        }
    }
    found
}

/// Identifiers a module's evaluation actually reads.
///
/// The walk stops at anything deferred. A function body runs when it is
/// called, not when the module is evaluated, and descending into one would
/// refuse the legal way to cross a cycle. An import clause names a binding
/// rather than reading it, and would otherwise report every import in a cycle
/// as a dead-zone read of itself.
fn evaluated_reads(probe: &FuncBuilder, id: NodeId, visit: &mut impl FnMut(NodeId)) {
    let Some(kind) = probe.kind_of(id) else {
        // A `NodeList` -- an argument list, a declaration list -- which has no
        // syntax kind. Stopping here truncated the walk at the first one, and
        // a variable declaration is reached through exactly one: the
        // initializer of `export const derived = imported + 1` was never
        // looked at, which is the shape the check exists for.
        for child in &probe.node(id).children {
            evaluated_reads(probe, *child, visit);
        }
        return;
    };
    match kind {
        syntax::FUNCTION_DECLARATION
        | syntax::ARROW_FUNCTION
        | syntax::METHOD_DECLARATION
        | syntax::CONSTRUCTOR
        | syntax::GET_ACCESSOR
        | syntax::SET_ACCESSOR
        | syntax::PROPERTY_DECLARATION
        | syntax::IMPORT_DECLARATION
        | syntax::EXPORT_DECLARATION
        | syntax::INTERFACE_DECLARATION => return,
        syntax::IDENTIFIER => visit(id),
        _ => {}
    }
    for child in &probe.node(id).children {
        evaluated_reads(probe, *child, visit);
    }
}

impl FuncBuilder<'_> {
    /// A potentially early access tests its binding, including a folded constant.
    pub(super) fn check_initialized(&mut self, id: NodeId, symbol: u32) -> Result<(), Diagnostic> {
        if self
            .initialization
            .uninitialized_local(id, symbol)
            .is_some()
        {
            return self.check_uninitialized_local(id, symbol);
        }
        if self.initialization.guards_capture(id, symbol)
            && let Some(cell) = self.class_cells.get(&symbol).copied()
        {
            let origin = self.origin(id);
            let ready = self.push(
                OpKind::FieldGet {
                    object: cell,
                    field: 0,
                },
                HirType::Bool,
                origin,
            );
            return self.check_binding_ready(id, symbol, ready);
        }
        if !self.initialization.guards(id, symbol) {
            return Ok(());
        }
        let Some(flag) = self.module.initialized.get(&symbol).copied() else {
            return Ok(());
        };
        let origin = self.origin(id);
        let ready = self.push(OpKind::GlobalGet(flag), HirType::Bool, origin.clone());
        self.check_binding_ready(id, symbol, ready)
    }

    pub(super) fn check_binding_ready(
        &mut self,
        id: NodeId,
        symbol: u32,
        ready: ValueId,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let unset = self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone());
        let missing = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: ready,
                rhs: unset,
            },
            HirType::Bool,
            origin,
        );
        let name = self
            .snapshot
            .symbols
            .get(symbol as usize)
            .and_then(|record| record.name.public_name())
            .unwrap_or("");
        self.refuse_when(
            id,
            missing,
            "ReferenceError",
            &format!("Cannot access '{name}' before initialization"),
        )
    }

    pub(super) fn check_initialized_place(
        &mut self,
        id: NodeId,
        global: u32,
    ) -> Result<(), Diagnostic> {
        let symbol = self.module.initialized.keys().copied().find(|symbol| {
            self.module.variables.get(symbol) == Some(&global)
                && self.initialization.guards(id, *symbol)
        });
        if let Some(symbol) = symbol {
            self.check_initialized(id, symbol)?;
        }
        Ok(())
    }

    /// Static calls and field accesses need no class object, but still evaluate
    /// the class binding. Its readiness check cannot vanish with that object.
    pub(super) fn check_class_binding(&mut self, at: NodeId) -> Result<(), Diagnostic> {
        let at = self.through_assertions(at);
        let at = if matches!(
            self.kind_of(at),
            Some(syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION)
        ) {
            self.children(at).first().copied().unwrap_or(at)
        } else {
            at
        };
        if let Some(symbol) = self.node(at).symbol {
            let symbol = self.denoted_symbol(symbol);
            if self
                .snapshot
                .symbols
                .get(symbol.0 as usize)
                .is_some_and(|record| {
                    record
                        .declarations
                        .iter()
                        .any(|at| self.kind_of(*at).is_some_and(declares_a_class))
                })
            {
                self.check_initialized(at, symbol.0)?;
            }
        }
        Ok(())
    }

    pub(super) fn mark_initialized(&mut self, at: NodeId, symbol: u32) {
        if self.is_terminated() {
            return;
        }
        if let Some(flag) = self.module.initialized.get(&symbol).copied() {
            let origin = self.origin(at);
            let ready = self.push(OpKind::ConstBool(true), HirType::Bool, origin.clone());
            self.push(
                OpKind::GlobalSet {
                    global: flag,
                    value: ready,
                },
                HirType::Void,
                origin,
            );
        }
    }

    /// A module-scope declaration, as the assignment it is.
    ///
    /// Not `lower_statement`: that would bind the name as a *local* of the
    /// initializer function, and every function that reads the name reads the
    /// global -- so the value would be computed, stored in a local, and thrown
    /// away, leaving the global at zero. The declaration and the store are the
    /// same line here.
    ///
    /// Declarations whose initializer folded to a constant need only readiness
    /// and any exception checks: their
    /// value is already in the artifact, either as the global's `initial` or,
    /// for a `const`, inlined at every read. `deferred` is exactly the set that
    /// needs code, which is why *that* decision is made once in
    /// `collect_module_scope` rather than re-derived here.
    ///
    /// The expression, though, comes from the declaration in hand rather than
    /// from the map: `deferred` is keyed by symbol, and one module-scope symbol
    /// can have several declarations.
    pub(super) fn lower_module_binding(
        &mut self,
        statement: NodeId,
        refused: &rustc_hash::FxHashSet<u32>,
    ) -> Result<(), Diagnostic> {
        // **Refused here rather than only in `collect_module_scope`, because a
        // refusal recorded against a *symbol* is reported where the name is
        // read — and a `using` binding often has no reader at all.** Its whole
        // purpose is the disposal at scope exit, so
        //
        //     using r = new R();
        //
        // mentions `r` exactly once. The collector's entry was correct and
        // silent, the declaration still lowered, and nothing said that
        // `[Symbol.dispose]` would not run. Refusing the *statement* is what
        // module evaluation reports.
        if self
            .ancestor(statement, syntax::VARIABLE_DECLARATION_LIST)
            .or_else(|| {
                self.children(statement)
                    .into_iter()
                    .find(|child| self.kind_of(*child) == Some(syntax::VARIABLE_DECLARATION_LIST))
            })
            .is_some_and(|list| {
                nts_semantic_schema::VariableKind::from_flags(self.node(list).flags).disposes()
            })
        {
            return Err(self.unsupported(
                statement,
                "a `using` declaration, whose scope-exit disposal",
            ));
        }
        let mut declarations = Vec::new();
        collect_kind(
            self.snapshot,
            statement,
            syntax::VARIABLE_DECLARATION,
            &mut declarations,
        );
        for declaration in declarations {
            // **Before the name is looked for.** A destructured declaration has
            // no single name, and the search below takes the first `IDENTIFIER`
            // it finds -- which for `const [a, b] = pair` is `a`, a name inside
            // the pattern rather than the declaration's.
            if self.module.destructured.contains(&declaration.0) {
                self.lower_destructured_module_binding(declaration)?;
                continue;
            }
            let children = self.children(declaration);
            let Some(name) = children
                .iter()
                .find(|child| self.kind_of(**child) == Some(syntax::IDENTIFIER))
            else {
                continue;
            };
            let Some(symbol) = self.node(*name).symbol else {
                continue;
            };
            // Already refused on its own, above. Its global keeps the zero it
            // was given, and the program is missing one value rather than all
            // of them.
            if refused.contains(&symbol.0) {
                continue;
            }
            // **This declaration's initializer, not the symbol's.**
            // `deferred` is keyed by symbol and answers *whether* the symbol
            // needs a store; a module-scope `var` may be declared more than
            // once, and the map holds only the last one. Reading the node from
            // the map stored the last declaration's value at every
            // declaration's position -- so `var x = 1; … var x = 2;` set `x` to
            // 2 twice.
            if !self.module.deferred.contains_key(&symbol.0) {
                // Folding the value must preserve evaluation's exceptions, and
                // a class expression, which has no value to store, is evaluated.
                let initializer = declaration_initializer(&children, *name, |c| self.kind_of(c));
                if !self.evaluate_a_class_initializer(initializer)?
                    && let Some(initializer) = initializer
                    && self.initialization.can_raise_at(initializer)
                {
                    self.lower_expression(initializer)?;
                }
                self.mark_initialized(declaration, symbol.0);
                continue;
            }
            let Some(initializer) = declaration_initializer(&children, *name, |c| self.kind_of(c))
            else {
                continue;
            };
            let Some(global) = self.module.variables.get(&symbol.0).copied() else {
                continue;
            };
            // At the global's type, like every other slot a value meets. An
            // erased global is the case that needs the coercion: the
            // initializer is a number and the global holds a tag beside a
            // payload.
            //
            // Lowered *expecting* that type rather than lowered and then
            // converted, because some literals decide nothing on their own and
            // take their shape from the slot. `[]` is the one: its element type
            // is `never`, and inside a function the declaration supplies the
            // real one while a module-scope initializer had nothing to ask.
            let want = self.module.types[global as usize].clone();
            let value = self.lower_expecting(initializer, &want)?;
            let value = self.coerce(value, &want, declaration)?;
            self.write_place(declaration, &Place::Global(global), value)?;
            self.mark_initialized(declaration, symbol.0);
        }
        Ok(())
    }

    /// The static member of `class` named `prototype`, where it has one.
    ///
    /// Defining one throws `TypeError` -- [`Self::lower_static_fields`] throws
    /// it -- and a field so named gets no global from `collect_static_fields`,
    /// where it took the name of the class's own prototype: an initial value of
    /// 42 in a slot typed as the prototype object, which the JVM's verifier
    /// refused at load (tests/outcomes/a-static-field-named-prototype).
    ///
    /// Only a computed key reaches here, since `static prototype` is an early
    /// error, and only a constant one is seen: a key the program computes is
    /// never evaluated (tests/outcomes/a-computed-field-key-is-never-evaluated).
    pub(super) fn static_named_prototype(&self, class: NodeId) -> Option<NodeId> {
        self.children(class).into_iter().find(|member| {
            names_a_class_element(self.kind_of(*member))
                && self
                    .node(*member)
                    .modifiers
                    .contains(nts_semantic_schema::DeclarationModifiers::STATIC)
                && self.member_name(*member).as_deref() == Some("prototype")
        })
    }

    /// The first member of `class` whose name the program computes, static or
    /// not: `[prefix + n]`, a key no checker can name, as against `["k"]`, a
    /// literal-typed `const` or a `unique symbol` such as `Symbol.iterator`,
    /// each of which names one member ([`Self::names_one_member`]).
    ///
    /// Evaluating the class evaluates the key, once, and defines the member
    /// under whatever it answers -- which no layout here can hold. A field so
    /// keyed was dropped with no diagnostic, and its key never evaluated
    /// (tests/outcomes/a-computed-field-key-is-never-evaluated); a method so
    /// keyed refused only its own function, while the function evaluating
    /// the class ran on with the key's effect dropped.
    pub(super) fn member_named_at_run_time(&self, class: NodeId) -> Option<NodeId> {
        self.children(class).into_iter().find(|member| {
            names_a_class_element(self.kind_of(*member))
                && self
                    .name_node(*member)
                    .filter(|name| self.kind_of(*name) == Some(syntax::COMPUTED_PROPERTY_NAME))
                    .and_then(|name| self.children(name).first().copied())
                    .is_some_and(|key| !self.names_one_member(key))
        })
    }

    /// A class's `static` field initializers, which run at class definition.
    ///
    /// `collect_static_fields` gives each one a global; this is where the ones
    /// that are not constants get written, in the same `module#init` and the
    /// same source order as every other deferred global. Class definition
    /// happens during module evaluation, so the order is already right by
    /// walking the statements as they are written.
    ///
    /// The body is `lower_module_binding`'s, keyed on the property's symbol
    /// rather than a declaration's -- the two share `ModuleScope::deferred`,
    /// which is what makes a static field's storage indistinguishable from a
    /// module-scope `const`'s everywhere downstream.
    pub(super) fn lower_static_fields(&mut self, class: NodeId) -> Result<(), Diagnostic> {
        if let Some(member) = self.member_named_at_run_time(class) {
            return Err(self.unsupported(member, "a member whose name the program computes"));
        }
        // **A static member named `prototype` throws before any of them runs**:
        // the constructor's own `prototype` is neither writable nor
        // configurable, so the class cannot be defined, and node throws while
        // defining it -- for a method as for a field, and before the first
        // static initializer or block. The loop below stops at the terminated
        // block, as it does for a static element that throws.
        if let Some(member) = self.static_named_prototype(class) {
            self.throw_provided_error(
                member,
                "TypeError",
                "Classes may not have a static property named 'prototype'",
            )?;
        }
        for member in self.children(class) {
            // **A static element that throws ends the class's evaluation there.**
            // `ClassDefinitionEvaluation` runs the static elements in source order
            // and returns the abrupt completion at the one that produced it, so
            //
            //     try { class C { static { throw new Error("thrown") } static x = (ran = true) } }
            //     catch (e) { caught = e.message }
            //
            // leaves `ran` false in the language, and this loop ran the field
            // anyway: the throw terminated the block and the next member's ops were
            // appended past the terminator.
            //
            // Invisible until a class in a block could run its statics at all,
            // because at module scope an uncaught throw ends the program and there
            // is no later element to observe. Caught by the conformance lane's
            // recorded run on `statements/class/static-init-abrupt.js`, which is the
            // very case that fix was for -- the two halves of one commit, one
            // enabling the other's defect.
            if self.is_terminated() {
                break;
            }
            // **`static { … }` runs here too, and in this loop rather than
            // beside it.** The specification runs a class's static blocks and
            // its static field initialisers in one source order, so
            //
            //     class C { static a = 1; static { C.a += 1 } static b = C.a }
            //
            // depends on walking them together; two loops would be two orders.
            //
            // It lowered to **nothing at all** before this — not refused,
            // ignored — so `class C { static a = 0; static { C.a = 5 } }`
            // answered 0 where node answers 5, silently and on every backend.
            // The frontend knew the node all along: `name_of(176)` is `class
            // static block declaration`, and only the lowering had never been
            // told. That is the shape `super::unaccounted` exists to catch, and
            // it does not see this one because a static block declares no
            // symbol for it to miss.
            if self.kind_of(member) == Some(syntax::CLASS_STATIC_BLOCK) {
                for child in self.children(member) {
                    if self.kind_of(child) == Some(syntax::BLOCK) {
                        self.lower_statement(child)?;
                    }
                }
                continue;
            }
            if self.kind_of(member) != Some(syntax::PROPERTY_DECLARATION)
                || !self
                    .node(member)
                    .modifiers
                    .contains(nts_semantic_schema::DeclarationModifiers::STATIC)
            {
                continue;
            }
            let Some([_, Some(name), _, _, _]) = self.child_slots::<5>(member) else {
                continue;
            };
            let Some(symbol) = self.node(name).symbol else {
                continue;
            };
            let Some(initializer) = self.module.deferred.get(&symbol.0).copied() else {
                continue;
            };
            let Some(global) = self.module.variables.get(&symbol.0).copied() else {
                continue;
            };
            let want = self.module.types[global as usize].clone();
            let value = self.lower_expecting(initializer, &want)?;
            let value = self.coerce(value, &want, member)?;
            self.write_place(member, &Place::Global(global), value)?;
        }
        Ok(())
    }

    /// `const [a, b] = pair` at module scope: destructure, then store.
    ///
    /// The reads are `bind_pattern`'s, unchanged — the same function that binds
    /// the same pattern inside a function body, with its defaults, its nested
    /// patterns and its rest elements. What differs is only where the values
    /// end up: a local binds them, and here each one is copied into the global
    /// `collect_module_scope` gave it.
    ///
    /// **Both halves walk the pattern with `pattern_names`.** The collector
    /// decides which names get storage and this decides which names get
    /// written, and if those two lists ever disagreed a name would have a
    /// global that nothing writes — storage reading as zero for ever, with no
    /// diagnostic. One walk, asked twice.
    fn lower_destructured_module_binding(&mut self, declaration: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(declaration);
        let Some(pattern) = children.first().copied() else {
            return Ok(());
        };
        let Some(initializer) = declaration_initializer(&children, pattern, |c| self.kind_of(c))
        else {
            return Ok(());
        };
        let value = self.lower_expression(initializer)?;
        self.bind_pattern(pattern, value, PatternScope::Module)
    }
}
