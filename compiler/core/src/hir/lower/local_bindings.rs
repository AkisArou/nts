//! Lower local declarations and identifier reads, including evolved types and declaration/initializer facts.

use super::{
    Diagnostic, FuncBuilder, HirType, Layout, ManagedType, NodeId, OpKind, PatternScope, Place,
    SemanticSnapshot, Settled, SymbolFlags, ValueId, closure_type, in_a_slot,
    is_an_unsettled_array, names_a_body, reassigned_anywhere, representation_word,
    settled_declaration_type, syntax,
};

impl FuncBuilder<'_> {
    pub(super) fn lower_variable_statement(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        // A `VariableDeclarationList` is an ordinary syntax node, not a NodeList,
        // so `children` does not flatten it away — the declarations sit one level
        // further down than they appear to.
        let declarations: Vec<NodeId> = self
            .children(id)
            .into_iter()
            .flat_map(|child| {
                if self.kind_of(child) == Some(syntax::VARIABLE_DECLARATION_LIST) {
                    self.children(child)
                } else {
                    vec![child]
                }
            })
            .collect();

        for declaration in declarations {
            if self.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION) {
                continue;
            }
            // name, `!`, type, initializer — the annotation is a child too, so
            // `const scale: number = 3` has three where `const scale = 3` has
            // two. Destructuring positionally refused every annotated local.
            let Some([Some(name), _, annotation, initializer]) = self.child_slots::<4>(declaration)
            else {
                return Err(self.unsupported(declaration, "a declaration of unexpected shape"));
            };
            // **A class is not a value here.** `const C = class { … }`
            // declares a *type*: the driver lowers a class's members wherever
            // the class sits, and `new C()` resolves through the checker's
            // type rather than through this binding, so there is nothing left
            // for the binding to hold. Module scope gives the same answer by
            // allocating no global for one. The class is evaluated all the
            // same ([`Self::evaluate_a_class_initializer`]).
            //
            // Naming the class -- `const C = class L { … }` -- changes none of
            // that. The name is in scope inside the class body and nowhere
            // else, which is a fact about the checker's scopes and not about
            // storage.
            if self.evaluate_a_class_initializer(initializer)? {
                if self.is_terminated() {
                    return Ok(());
                }
                continue;
            }
            // **`var v;` after `v = 2` must leave `v` alone.** A `var` binding
            // belongs to the function, not to the statement that spells it, so
            // a declaration with no initializer is not a point at which
            // anything happens -- the language evaluates nothing there. This
            // bound `unwritten`'s zero over whatever had already been written:
            //
            //     function f() { v = 2; var v: number; return v; }
            //     // node: 2.  this compiler, until the fix: 0
            //
            // Silently, with no diagnostic. It is the same shape as the
            // module-scope redeclaration defect and the same reason -- a
            // declaration treated as the moment the storage comes into
            // existence, when for `var` the storage was already there.
            //
            // `let` and `const` keep the placeholder, and must. Their binding
            // *begins* at the declaration and the checker has already proved
            // nothing read it earlier, so there is no earlier value to
            // preserve. The kind defaults to `Let` when the list cannot be
            // found, which is the arm that changes nothing.
            let declared_kind = self
                .ancestor(declaration, syntax::VARIABLE_DECLARATION_LIST)
                .map_or(nts_semantic_schema::VariableKind::Let, |list| {
                    nts_semantic_schema::VariableKind::from_flags(self.node(list).flags)
                });
            // Refused rather than lowered as an ordinary binding: see the
            // module-scope site, and `VariableKind::from_flags`, for why
            // accepting it was the worse of the two.
            if declared_kind.disposes() {
                return Err(self.unsupported(
                    declaration,
                    "a `using` declaration, whose scope-exit disposal",
                ));
            }
            let existing = self.binding_a_var_writes(declared_kind, declaration, name)?;
            if initializer.is_none()
                && declared_kind == nts_semantic_schema::VariableKind::Var
                && let Some(symbol) = self.node(name).symbol
                && (self.bindings.contains_key(&symbol.0) || existing.is_some())
            {
                continue;
            }
            // An empty array literal has type `never[]`: with no elements the
            // checker has nothing to infer from. The declaration does know —
            // `const out: number[] = []` says so — so the annotation supplies
            // what the literal cannot.
            let value = match initializer {
                // **Only when the declaration actually says what it holds.**
                //
                // `const out: number[] = []` and a name whose later writes
                // settle an element type both reach this and want the slot's
                // representation. `const [x = 23] = []` has neither: the
                // checker assigns no type to a `[]` in a destructuring
                // initializer, so this refused as *an empty array of
                // unrepresentable type (any)* --- while the identical line at
                // module scope compiled, because that path lowers the literal
                // and `a_stand_in_for_nothing` answers for it.
                //
                // So the guard asks first, and a literal with nothing in it
                // falls through to the ordinary arm below and the same
                // stand-in --- **but only when the declaration is a pattern**.
                //
                // "Zero elements is syntactic and stronger than any type
                // argument" is true of the literal and false of the *variable*.
                // `const xs = []; xs.push("a")` names an array that does not
                // stay empty: the stand-in gives it `[f64]`, the push puts an
                // `NtsString *` in it, and the emitted C is
                // `nts_array_push(v1, v2)` against `double` --- which clang
                // refuses, with no diagnostic of ours. Measured the same night
                // the fall-through was added, by pairing an inferred
                // declaration against an annotated one.
                //
                // A binding pattern cannot be grown. `const [x = 23] = []`
                // reads positions that do not exist and takes their defaults,
                // and the name never outlives the destructuring, so the element
                // width really is unobservable there.
                Some(initializer)
                    if self.kind_of(initializer) == Some(syntax::ARRAY_LITERAL_EXPRESSION)
                        && self.children(initializer).is_empty()
                        && !matches!(
                            self.kind_of(name),
                            Some(syntax::ARRAY_BINDING_PATTERN | syntax::OBJECT_BINDING_PATTERN)
                        ) =>
                {
                    // **The same derivation module scope uses**, rather than
                    // a shorter one spelled out again here.
                    //
                    // This was `type_of(name).or_else(|| evolved_type(name))`,
                    // which is what `settled_declaration_type` was before its
                    // own first bug: `var xs = []` types the declaration
                    // `never[]`, and a `Some` means the `or_else` beside it
                    // never runs. So the settled type the writes had already
                    // proven was never consulted, and
                    //
                    //     function f() { var xs = []; xs[0] = 7; xs[1] = 8; }
                    //
                    // refused *an empty array of unrepresentable type* where
                    // the module-scope spelling of the identical program
                    // lowered and ran. Found by writing the same construct
                    // twice, once in each placement, and diffing the verdicts.
                    let declared = settled_declaration_type(self, name)
                        .ok_or_else(|| self.unrepresentable(declaration, "an empty array"))?;
                    self.lower_empty_array(initializer, declared)?
                }
                // **At the annotation, the way module scope has always done it.**
                // `lower_module_binding` lowers a deferred initializer
                // *expecting* the global's type -- "because some literals decide
                // nothing on their own and take their shape from the slot" --
                // and a local declaration lowered its initializer and then
                // coerced. Two derivations of one fact, and the local one was
                // the wrong half:
                //
                //     interface Opts { a: number; b?: number }
                //     const xs: Opts[] = [{ a: 1 }];        // module scope: fine
                //     function f() { const xs: Opts[] = [{ a: 1 }]; }   // refused
                //
                // The literal's own element type is `{ a: number }`, the slot's
                // is `Opts`, and with an optional property the two are not the
                // same shape -- so the finished array met `coerce` and was
                // refused as *an array of ... where an array of ... is wanted*,
                // which is a true sentence about a cast this never had to make.
                // `lower_array_literal` already prefers the expected type over
                // its own; it was never given one here.
                //
                // And an **inferred** binding, where the initializer is a fresh
                // array literal. This said once that without an annotation
                // `type_of(name)` is what the expression produces anyway, so
                // passing it would be a loop rather than a slot. It is not: the
                // binding's type is the literal's *widened*, and the checker
                // gives the two -- and each nested record -- distinct ids, so
                // `const backing = [{ value: n, nested: { text: "a" } }]` built
                // an array of one id and met `coerce` wanting another: "an
                // array of Object(124) where an array of Object(126) is wanted".
                // Built at the binding's type instead, each element is lowered
                // and coerced as before. Only a *fresh* literal: an array that
                // already exists, or a pattern, has no construction to steer.
                // (Re-derived from Codex 7dab54f0a.)
                Some(initializer) => {
                    let fresh_array = self.kind_of(name) == Some(syntax::IDENTIFIER)
                        && self.kind_of(initializer) == Some(syntax::ARRAY_LITERAL_EXPRESSION);
                    match (annotation.is_some() || fresh_array)
                        .then(|| self.type_of(name))
                        .flatten()
                    {
                        Some(declared) => self.lower_expecting(initializer, &declared)?,
                        None => self.lower_expression(initializer)?,
                    }
                }
                None => self.unwritten(name, declaration)?,
            };
            // `const { a, b } = o` and `const [a, b] = xs`: one initializer,
            // several names. Lowered as the reads it stands for -- a field per
            // name, or an element per position.
            if matches!(
                self.kind_of(name),
                Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN)
            ) {
                self.bind_pattern(name, value, PatternScope::Local)?;
                continue;
            }
            if let Some(place) = existing {
                self.write_place(name, &place, value)?;
                continue;
            }
            let symbol = self
                .node(name)
                .symbol
                .ok_or_else(|| self.unsupported(name, "an unresolved declaration"))?;
            // At the type the declaration *says*, not the one the initializer
            // happens to have. `let held: unknown = n` binds an erased value;
            // binding the raw double instead left the declared type and the
            // stored representation disagreeing, and `typeof held` then matched
            // neither the primitive path nor the erased one.
            //
            // **Unless this copy re-types the name.** `const stream = source;`
            // where the copy re-typed `source` to `Writable` is a `Writable`,
            // and coercing it to the `WritableImplementation` the declaration
            // says would be the very cast the copy exists to avoid. See
            // `retyped_symbols`.
            if initializer.is_some() {
                self.oblige_local(symbol.0, value, declaration);
            }
            let declared = self
                .retyped_symbols
                .get(&symbol.0)
                .cloned()
                .or_else(|| self.type_of(name));
            let value = self.coerce_declared(value, declared, declaration, initializer)?;
            // A name some closure writes to lives in a cell from here on, and
            // the binding is the cell. Every read and write below goes through
            // it, in this function and in the closure.
            let value = self.open_cell(symbol.0, value, declaration);
            self.bindings.insert(symbol.0, value);
            // A once-entered module block uses the same readiness flag as a
            // root declaration, even when its value is local or folded.
            self.mark_initialized(declaration, symbol.0);
        }
        Ok(())
    }

    /// A declaration's value at the type it declares, where it declares one.
    ///
    /// **Asked of the initializer, not the declaration.** Which absence a null
    /// pointer is, erasing into a wider declaration, is the *value's* question:
    /// `const v: string | null | undefined = n < 10 ? null : "x"` holds a
    /// `string | null` pointer, and asked of the declaration -- both absences --
    /// it said neither, so a null `v` was erased with no tag to read (C
    /// answered `null` by its default, Wasm refused by name). See
    /// `coerce_from`.
    fn coerce_declared(
        &mut self,
        value: ValueId,
        declared: Option<HirType>,
        declaration: NodeId,
        initializer: Option<NodeId>,
    ) -> Result<ValueId, Diagnostic> {
        match declared {
            Some(declared) => self.coerce_from(
                value,
                &declared,
                declaration,
                initializer.unwrap_or(declaration),
            ),
            None => Ok(value),
        }
    }

    /// The binding a `var` declaration writes when it is not a new one -- its
    /// initializer is then a store, and with none it writes nothing.
    ///
    /// **A `var` has no block scope.** `{ var x = 'inside'; }` at module scope
    /// declares the module's own `x` a second time, so its initializer stores to
    /// that global. It was bound as a fresh local instead: a later read in the
    /// same function saw it, and a closure reading the global saw the old value
    /// (`outcomes/a-var-redeclared-in-a-block-under-a-closure-global`).
    ///
    /// **Unless a `catch` parameter of that name stands between**: Annex B.3.5
    /// makes `catch (foo) { var foo = 1; }` assign the *parameter* -- the binding
    /// `foo` names there -- while the `var` is hoisted outward with nothing
    /// written to it. The checker gives the declaration the outer symbol, so
    /// without this the initializer wrote the module global (annexB
    /// `catch-redeclared-var-statement-captured.js`).
    fn binding_a_var_writes(
        &mut self,
        kind: nts_semantic_schema::VariableKind,
        declaration: NodeId,
        name: NodeId,
    ) -> Result<Option<Place>, Diagnostic> {
        if kind != nts_semantic_schema::VariableKind::Var {
            return Ok(None);
        }
        if let Some(parameter) = self.catch_parameter_named(declaration, name) {
            return self.place_for_symbol(name, parameter).map(Some);
        }
        Ok(self
            .node(name)
            .symbol
            .filter(|symbol| !self.bindings.contains_key(&symbol.0))
            .and_then(|symbol| self.module.variables.get(&symbol.0).copied())
            .map(Place::Global))
    }

    /// The symbol of the `catch` parameter a `var` declaration's initializer
    /// assigns: an enclosing `catch (name)` with the same plain name, and no
    /// function between them (Annex B.3.5). `None` for a destructured
    /// parameter, which the annex leaves an early error.
    fn catch_parameter_named(
        &self,
        declaration: NodeId,
        name: NodeId,
    ) -> Option<nts_semantic_schema::SymbolId> {
        let written = self
            .node(name)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())?;
        for at in std::iter::successors(self.node(declaration).parent, |at| self.node(*at).parent) {
            let kind = self.kind_of(at);
            if names_a_body(kind) || kind == Some(syntax::CONSTRUCTOR) {
                return None;
            }
            if kind != Some(syntax::CATCH_CLAUSE) {
                continue;
            }
            let parameter = self
                .children(at)
                .into_iter()
                .find(|child| self.kind_of(*child) == Some(syntax::VARIABLE_DECLARATION))?;
            let bound = self.children(parameter).into_iter().next()?;
            if self.kind_of(bound) == Some(syntax::IDENTIFIER)
                && self
                    .node(bound)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    == Some(written)
            {
                return self.node(bound).symbol.or(self.node(parameter).symbol);
            }
        }
        None
    }

    /// What a name holds between its declaration and its first assignment.
    ///
    /// `let path: string;` and then a branch that writes it. It is how a value
    /// decided by statements rather than by an expression gets written, and
    /// four of the seven things `runtime/node/path` still could not compile
    /// were this.
    ///
    /// The name has to *be* something from here on. Every block below reads it
    /// as a carried name, a merge takes it as a parameter, and a name with no
    /// binding is not one -- so the whole of this feature is having a value to
    /// bind, and the rest of the lowering was already able to cope.
    ///
    /// # Why a placeholder is not a guess
    ///
    /// Where the type admits no absence the checker has already proved the
    /// assignment comes first: `let path: string;` read before it is written is
    /// "used before being assigned", and the program does not reach here. So
    /// what the placeholder is cannot be observed.
    ///
    /// Where the type *does* admit one it can be observed, and then the
    /// placeholder is the answer node gives. `let joined: string | undefined;`
    /// is read before it is written -- that is the point of writing it -- and
    /// `undefined` is what it holds. One absence on a reference is the null
    /// pointer, so `ConstNull` is that `undefined` rather than a stand-in for
    /// it; a scalar union is erased, where it is spelled out.
    pub(super) fn unwritten(
        &mut self,
        name: NodeId,
        declaration: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        // **A name neither source can type is one nothing ever writes**, and
        // `undefined` is the whole of what it holds.
        //
        // `var g;` with no annotation and no assignment is `any` to the checker,
        // which has no representation, so both sources declined and the
        // declaration was refused -- including where `g` is never mentioned
        // again. `var g; g = 2;` lowered, and so did `var g: number;`: the
        // refusal was exactly the case with the *least* in it.
        //
        // Erased is the honest slot rather than a guess. If nothing writes the
        // name then `undefined` is what every read sees, which is node's answer;
        // and if something does write it after all, an erased slot holds
        // whatever that is, so being wrong about the premise costs a
        // representation and not an answer. `evolved_type` answering is what
        // keeps a narrower slot where one is provable -- this is reached only
        // when it does not.
        let ty = in_a_slot(
            self.type_of(name)
                .or_else(|| self.evolved_type(name))
                .unwrap_or(HirType::Erased),
        );
        let origin = self.origin(declaration);
        let kind = match &ty {
            HirType::Bool => OpKind::ConstBool(false),
            HirType::Erased => OpKind::ConstUndefined,
            HirType::Managed(_) => OpKind::ConstNull,
            HirType::Float { .. } => OpKind::ConstFloat(0.0),
            // An integer here would be `specialize`'s doing, and it has not run
            // yet; anything else is a type with no zero to name.
            //
            // `Void` is not among them any more: it arrives for `var g;` that
            // nothing assigns -- the checker types it `any` and the
            // representation is "nothing" -- and `in_a_slot` above is the one
            // place that maps a widthless representation to the one that can
            // hold an `undefined`. Its doc carries why a carried binding is a
            // slot and a result is not.
            //
            // **Named, because the sentence without it is about the wrong
            // thing.** "A declaration without an initializer" describes every
            // `let x;` in the language, and the ones that reach here are the
            // subset whose *type* has no zero -- which is what a reader has to
            // act on and what a census row has to rank by.
            _ => {
                let named = representation_word(&ty);
                return Err(self.unsupported(
                    declaration,
                    &format!("a declaration with no initializer, of {named}, which has no zero"),
                ));
            }
        };
        Ok(self.push(kind, ty, origin))
    }

    /// The type an *evolving* declaration settles on, read back from a use.
    ///
    /// `const parts = []` is `never[]` where it is written: with no elements and
    /// no annotation the checker has nothing to infer from *yet*, and it fills
    /// that in from the pushes as it walks. `let device;` is the same thing
    /// spelled without a literal. Both are ordinary TypeScript and both were
    /// refused here, because the type at the declaration is the one that says
    /// nothing.
    ///
    /// Every later mention of the name carries what it evolved to, and the
    /// checker has already done the work. So this reads one back rather than
    /// repeating the inference -- which would be a second answer to a question
    /// that already has one, and the two would agree until they did not.
    ///
    /// **Every** use has to agree, and `None` where they do not. A use before
    /// the first assignment sees a narrower type than one after it, and picking
    /// whichever came first in the node list would be picking arbitrarily.
    pub(super) fn evolved_type(&self, name: NodeId) -> Option<HirType> {
        let symbol = self.node(name).symbol?;
        let mut settled: Option<HirType> = None;
        for &id in self.snapshot.mentions_of(symbol) {
            if id == name {
                continue;
            }
            let Some(ty) = self.type_of(id) else {
                continue;
            };
            // An unsettled observation is not a disagreement. `var xs = []`
            // leaves `never[]` on the declaration *and* on every reference the
            // checker had not yet widened, and letting one of those veto a
            // settled sibling is what kept `var bases = []; bases[0] = 1`
            // without a type at module scope -- 26 files of the slice-1
            // `test/language` population.
            if is_an_unsettled_array(&ty) {
                continue;
            }
            match &settled {
                Some(known) if *known != ty => return None,
                Some(_) => {}
                None => settled = Some(ty),
            }
        }
        settled
    }

    /// What a name's initializer settles about which function the name holds.
    ///
    /// The test is the initializer's **shape**, not how many functions it could
    /// have meant: by the time a signature reaches here the checker has already
    /// collapsed identical candidates into one type, so counting them here would
    /// count one. A single identifier names exactly what it names; a call, or a
    /// member read, is a choice made at run time, and a declaration the checker
    /// kept is not the answer to it.
    ///
    /// **A conditional the checker has already decided is a name.** `const jsx =
    /// isDevelopment ? jsxDEV : jsxProd` with `export const isDevelopment =
    /// false` is one function, statically -- the checker types the condition as
    /// the *literal* `false`, which is the same fact [`Self::statically_decided`]
    /// folds an `if` on. Reading only the shape counted it as a choice, so every
    /// `isDevelopment ?` in a program was distrusted and the call fell through to
    /// the value path, where `storable` refuses it. That is one arm of React's
    /// jsx runtime and, by their count, of every compiled component with it.
    ///
    /// Three answers rather than a bool, because the caller has two different
    /// questions and the middle one is the trap: `Unsettled` means *distrust the
    /// checker's callee*, and `Names` means *use this one instead of it*. A
    /// predicate could only say the first, which is why the decided case could
    /// not be expressed as "not a choice" -- the arm has to come back with it.
    ///
    /// See [`Self::direct_callee`] for what this costs and why it is shaped this
    /// way.
    pub(super) fn initializer_settles(&self, symbol: u32) -> Settled {
        let Some(record) = self.aliased_to(symbol) else {
            return Settled::NotAVariable;
        };
        let mut settled = Settled::NotAVariable;
        for at in &record.declarations {
            if self.kind_of(*at) != Some(syntax::VARIABLE_DECLARATION) {
                continue;
            }
            let Some(initializer) = self
                .children(*at)
                .into_iter()
                .skip(1)
                .rfind(|child| self.kind_of(*child) != Some(syntax::QUESTION_TOKEN))
            else {
                continue;
            };
            // Two declarations of one name cannot both settle it, and a name
            // reassigned elsewhere is not settled by either -- `reassigned_anywhere`
            // is what asks that, one caller up. `Unsettled` wins a disagreement
            // for the reason the whole guard exists: it is the answer that
            // refuses rather than the one that emits.
            // **A name something else writes is not settled by its
            // initializer.** `let f = flag ? a : b; f = c;` has an initializer
            // that names one function and a slot that holds another by the time
            // it is called, and a static call to the arm would be a wrong answer
            // of exactly the kind this guard exists to prevent. `const` cannot
            // be written again, which is the cheap answer and the common one;
            // the walk is only paid for a `let`, and it is the same walk
            // `closure_typed_global` makes for the same reason one scope out.
            let writable = matches!(self.variable_kind(*at), Some(kind) if kind != nts_semantic_schema::VariableKind::Const);
            if writable
                && self
                    .children(*at)
                    .first()
                    .is_none_or(|name| reassigned_anywhere(self, *name))
            {
                return Settled::Unsettled;
            }
            match self.named_function(self.decided_arm(initializer)) {
                Some(declaration) if matches!(settled, Settled::NotAVariable) => {
                    settled = Settled::Names(declaration);
                }
                _ => return Settled::Unsettled,
            }
        }
        settled
    }

    /// `const`, `let` or `var`, read where a *declaration* is in hand.
    ///
    /// The kind is on the declaration **list**, not on the declaration -- the same
    /// read `lower_variable_statement` and `hoists_out_of` make, which is why this
    /// exists rather than a second walk to find the flags.
    ///
    /// **Not the immediate parent.** A declaration's parent is the list's
    /// `NodeKind::List` of children, and `kind_of` answers `None` for a list -- so
    /// the first version of this returned `None` for every declaration, which read
    /// as "not writable" and let a reassigned `let` be static-called. The probe
    /// that found it (`let f = yes ? a : b; f = b;`) answered `call a` and
    /// disagreed with node on 27 of 29 cases, where the compiler before this
    /// change *refused*. A guard that cannot fire is worse than no guard: it is a
    /// sentence claiming protection.
    pub(super) fn variable_kind(
        &self,
        declaration: NodeId,
    ) -> Option<nts_semantic_schema::VariableKind> {
        self.binding_parents(declaration).find_map(|parent| {
            (self.kind_of(parent) == Some(syntax::VARIABLE_DECLARATION_LIST))
                .then(|| nts_semantic_schema::VariableKind::from_flags(self.node(parent).flags))
        })
    }

    /// A symbol, through any import or re-export that stands for it.
    ///
    /// **Without this hop the guard in [`Self::direct_callee`] stops at the module
    /// boundary, and the wrong answer it exists to prevent survives there.**
    /// Measured, on this compiler before the hop:
    ///
    /// ```ts
    /// // pick.ts
    /// export const flag = false;
    /// export const pick = flag ? first : second;
    /// // reexport.ts -- export { pick } from "./pick.ts";
    /// // main.ts
    /// import { pick } from "./reexport.ts";
    /// export function use(x: number): number { return pick(x); }
    /// ```
    ///
    /// `use` emitted `call first(%0)` and **27 of 29 cases disagreed with node**.
    /// `97584f66`'s doc says an import is deliberately untouched, "so a
    /// cross-module call keeps its direct callee" -- which is right for an
    /// imported *function*, whose alias target is a function declaration, and
    /// wrong for an imported *variable*, whose target is the very thing that has
    /// to be asked about. Following the alias keeps the first and repairs the
    /// second: the question is asked of whatever declares the name, wherever that
    /// is.
    ///
    /// It is also the shape that matters most in practice. React's jsx runtime
    /// publishes `jsx` through `export { jsx, jsxs } from "./jsx/ReactJSXElement.ts"`
    /// and every compiled component calls it through that re-export, so the
    /// same-module case the guard already covered is the one nobody writes.
    ///
    /// One hop is enough -- the frontend follows re-export chains to the end, as
    /// `entry_exports` says a few hundred lines up. Bounded anyway, because a
    /// precondition that lives in a comment expires without anything failing.
    pub(super) fn aliased_to(&self, symbol: u32) -> Option<&nts_semantic_schema::SymbolRecord> {
        let mut at = symbol;
        for _ in 0..8 {
            let record = self.snapshot.symbols.get(at as usize)?;
            match record.aliased {
                Some(to) if to.0 != at => at = to.0,
                _ => return Some(record),
            }
        }
        self.snapshot.symbols.get(at as usize)
    }

    pub(super) fn lower_identifier(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        if let Some(symbol) = self.node(id).symbol
            && let Some(declaration) = self.initialization.uninitialized_local(id, symbol.0)
        {
            self.check_initialized(id, symbol.0)?;
            return self.unwritten(id, declaration);
        }
        // `Infinity`, `NaN` and `undefined` are global bindings that no scope in
        // the program declares, and each is a constant. Resolving them by name
        // is safe for a reason worth stating: all three are non-writable,
        // non-configurable properties of the global object, so unlike an
        // ordinary global they cannot have been reassigned. A local named
        // `NaN` would shadow them, and is caught before this by the binding
        // lookup below coming first.
        if let Some(symbol) = self.node(id).symbol
            && let Some(value) = self.bindings.get(&symbol.0).copied()
        {
            // A name something captured *and* writes to is bound to its cell,
            // so reading it is a load rather than the binding itself.
            let value = self.read_cell(symbol.0, value, id)?.unwrap_or(value);
            return self.narrowed(id, value);
        }
        let origin = self.origin(id);
        match self.builtin_binding_at(id) {
            Some(nts_semantic_schema::BuiltinBinding::Infinity) => {
                return Ok(self.push(OpKind::ConstFloat(f64::INFINITY), HirType::NUMBER, origin));
            }
            Some(nts_semantic_schema::BuiltinBinding::NaN) => {
                return Ok(self.push(OpKind::ConstFloat(f64::NAN), HirType::NUMBER, origin));
            }
            // `undefined` is not a keyword in an expression -- it is an
            // identifier bound to a non-writable property of the global object.
            // A local of that name would shadow it, and the binding lookup
            // above is what catches one.
            Some(nts_semantic_schema::BuiltinBinding::Undefined) => return self.lower_absent(id),
            _ => {}
        }

        let symbol = self
            .node(id)
            .symbol
            .ok_or_else(|| self.unsupported(id, "an unresolved name"))?;
        self.lower_named_value(id, symbol)
    }

    /// The symbol a shorthand property's name refers to, found by name.
    ///
    /// The only lookup in this file that is not the checker's, and it exists
    /// because the checker cannot answer this one from the node: `{ x }` is a
    /// single node whose symbol is the *property's*, and the value's symbol
    /// comes from `getShorthandAssignmentValueSymbol`, which the snapshot does
    /// not carry. So the name is matched against what a name can denote, in the
    /// order a scope chain would: a local first, because a local shadows.
    ///
    /// A shadowed name is refused rather than guessed at. Two bindings of one
    /// name in scope means this lookup cannot tell which the checker chose, and
    /// picking either is a coin toss that compiles.
    ///
    /// Module scope is every map a module-scope symbol can be in -- a constant,
    /// a global, one whose initializer was refused, one still deferred -- plus
    /// the named functions, which are in none of them because a function is not
    /// a variable. Leaving the last group out is what made `{ lowers }` read as
    /// naming nothing in scope while `lowers` on its own lowered fine.
    pub(super) fn shorthand_value_symbol(
        &mut self,
        at: NodeId,
        text: &str,
    ) -> Result<nts_semantic_schema::SymbolId, Diagnostic> {
        let spelled = |snapshot: &SemanticSnapshot, symbol: u32| {
            snapshot
                .symbols
                .get(symbol as usize)
                .is_some_and(|record| record.name.is_name(text.as_ref()))
        };

        let mut local = self
            .bindings
            .keys()
            .copied()
            .filter(|symbol| spelled(self.snapshot, *symbol));
        match (local.next(), local.next()) {
            (Some(symbol), None) => return Ok(nts_semantic_schema::SymbolId(symbol)),
            (Some(_), Some(_)) => {
                return Err(self.unsupported(at, "a shorthand naming a shadowed binding"));
            }
            _ => {}
        }

        let module = self
            .module
            .constants
            .keys()
            .chain(self.module.binding_constants.keys())
            .chain(self.module.variables.keys())
            .chain(self.module.unsupported.keys())
            .chain(self.module.deferred.keys())
            .copied()
            .find(|symbol| spelled(self.snapshot, *symbol));
        if let Some(symbol) = module {
            return Ok(nts_semantic_schema::SymbolId(symbol));
        }

        // A named function used as a value. Matched the way `lower_named_value`
        // matches it -- from the symbol to its declarations, not the other way
        // -- because a `FUNCTION_DECLARATION` node does not carry the symbol;
        // its name child does, and the symbol is what holds the list.
        let function = self
            .snapshot
            .symbols
            .iter()
            .enumerate()
            .find(|(_index, record)| {
                record.flags.contains(SymbolFlags::FUNCTION)
                    && record.name.is_name(text.as_ref())
                    && record.declarations.iter().any(|declaration| {
                        self.closures
                            .iter()
                            .any(|closure| closure.source.wraps() && closure.node == *declaration)
                    })
            });
        if let Some((index, _)) = function {
            return Ok(nts_semantic_schema::SymbolId(
                u32::try_from(index).unwrap_or(u32::MAX),
            ));
        }

        Err(self.unsupported(at, "a shorthand naming nothing in scope"))
    }

    /// Everything a name can denote, keyed by the symbol rather than by the
    /// node that spells it.
    ///
    /// Split out because one node kind cannot get its symbol from itself. A
    /// shorthand property -- `{ x }` -- is a single node serving as both the
    /// property name and a reference to a variable, and the checker gives it
    /// the *property's* symbol; `getShorthandAssignmentValueSymbol` answers the
    /// other one and the snapshot does not carry it. So that path resolves the
    /// name by hand and arrives here with what it found, and everything after
    /// the lookup -- the narrowing, the imports, the constants, the refused
    /// initializers, the globals, the functions used as values, the provided
    /// classes -- is shared rather than written twice.
    ///
    /// Written twice is what it was. The shorthand path had its own two-line
    /// lookup against the local bindings, which found a narrowed local and
    /// handed it over **unnarrowed** -- `{ first }` refused where
    /// `{ first: first }` compiled, on the same value in the same function --
    /// and did not look at module scope at all, so `{ lowers }` naming a
    /// function declared twenty lines above read as "a shorthand naming nothing
    /// in scope".
    #[expect(
        clippy::too_many_lines,
        reason = "keep semantic text and key projection beside its existing dispatch"
    )]
    pub(super) fn lower_named_value(
        &mut self,
        id: NodeId,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Result<ValueId, Diagnostic> {
        if let Some(value) = self.bindings.get(&symbol.0).copied() {
            let value = self.read_cell(symbol.0, value, id)?.unwrap_or(value);
            return self.narrowed(id, value);
        }
        // An imported name, resolved to what it imports. Below the local
        // lookup because an import binds nothing a function body can shadow.
        let symbol = self.denoted_symbol(symbol);
        self.check_initialized(id, symbol.0)?;
        if let Some(class) = self.objc_class_object(id, symbol)? {
            return Ok(class);
        }

        // Declared at module scope. A constant is its value; a variable is a
        // load.
        // A global a binding implements is a call of the function it names,
        // made at every read: `document` is `document()`, as page script's
        // `document` is a getter on the global object.
        if let Some((function, name)) = self.module.bound.get(&symbol.0).cloned() {
            return self.call_foreign_declaration(id, function, &name, Vec::new());
        }
        // `location`: a property of the global object.
        if let Some((function, name, window)) = self.window_global(id) {
            let property = &self.snapshot.symbols[symbol.0 as usize].name;
            if let Some(getter) = property
                .public_name()
                .and_then(|name| crate::hir::native::schema::property(self.snapshot, window, name))
                .and_then(|property| {
                    self.node(property.declaration?)
                        .native
                        .as_deref()?
                        .get
                        .clone()
                })
            {
                let receiver = self.call_foreign_declaration(id, function, &name, Vec::new())?;
                return self.lower_accessor_on(id, receiver, window, &getter, None);
            }
        }
        if let Some(value) = self.constant_name(id, symbol) {
            return value;
        }
        let origin = self.origin(id);
        if let Some(constant) = self.module.constants.get(&symbol.0).copied() {
            // **At the name's own representation, and it was always a float.**
            // `constant_value` folds `true` to `1.0` -- correct, since "a
            // boolean's storage is its truth value" -- and the *global* path
            // keeps the type beside it in `Global::ty`. This path lost it, so
            //
            //     const flag = true;
            //     function pick(p: boolean): number { return p ? 1 : 2; }
            //     pick(flag);
            //
            // lowered `const 1 : f64` into a `bool` parameter and the program
            // did not verify at all:
            // `CallArgumentType { callee: "pick", at: 0, expected: Bool, found:
            // Float }`. `pick(true)` verifies, which is the control that says the
            // fold rather than the boolean is at fault.
            //
            // Reported by the React lane, where it stopped their native probe
            // emitting anything: **invalid HIR costs the whole program**, so one
            // folded flag took out every function beside it.
            //
            // `Bool` alone, because `constant_value` folds only numbers, booleans
            // and arithmetic over them -- and an integer-typed name keeps the
            // float it had, which every coercion already expects.
            let kind = if matches!(self.type_of(id), Some(HirType::Bool)) {
                return Ok(self.push(OpKind::ConstBool(constant != 0.0), HirType::Bool, origin));
            } else {
                OpKind::ConstFloat(constant)
            };
            return Ok(self.push(kind, HirType::NUMBER, origin));
        }
        // Declared at module scope and not usable. Saying which is worth more
        // than "a name declared outside this function", and it is only said for
        // a name something actually reads.
        //
        // Asked *before* the global slot, because a variable can have both: a
        // representable type, so a slot exists, and an initializer that was
        // refused, so nothing ever writes it. Reading the slot would answer
        // with the zero it still holds.
        if let Some(reason) = self.module.unsupported.get(&symbol.0) {
            return Err(self.unsupported(id, reason));
        }
        if let Some(global) = self.module.variables.get(&symbol.0) {
            // The third of the three reads of a global, and the one this was
            // missing from: the branch above for a global *member* narrows, and
            // the local-binding branch at the top of this function narrows, and
            // this returned the slot's declared representation whatever the
            // checker had established about it.
            let ty = self.module.types[*global as usize].clone();
            let read = self.push(OpKind::GlobalGet(*global), ty, origin);
            return self.narrowed(id, read);
        }
        // A named function used as a value. One static instance per
        // declaration, so two mentions of it are the same object.
        if let Some(record) = self.snapshot.symbols.get(symbol.0 as usize)
            && record.flags.contains(SymbolFlags::FUNCTION)
            && let Some(index) = record.declarations.iter().find_map(|declaration| {
                self.closures
                    .iter()
                    .position(|closure| closure.source.wraps() && closure.node == *declaration)
            })
        {
            self.used_closures.push(index);
            // The same layout the body's side builds, pushed here too: the two
            // are lowered by different builders and `collect_layouts` merges
            // them, so the type is known wherever it is used.
            self.layouts.push(self.closure_layout(index, Vec::new()));
            let ty = HirType::Managed(ManagedType::Object(closure_type(index)));
            return Ok(self.push(OpKind::ClosureStatic, ty, origin));
        }
        // A class this compiler provides, used as a **value**.
        //
        // `err.constructor === TypeError` is how a program asks which error it
        // caught, and `runtime/node` writes it 88 times -- 64 of them as
        // `override get ["constructor"](): unknown { return TypeError; }`, so
        // that code checking the built-in agrees about a subclass. Every one of
        // those 88 was refused with "`TypeError` used as a value rather than as
        // a type", which was true and was not a capability question.
        //
        // What a value of it has to be: one object per class, the same one
        // wherever the name is written, `typeof` `"function"`, and comparable.
        // That is a named function used as a value with a different source, so
        // it is the same operation -- `ClosureStatic` at a type in the token
        // band, which `is_closure_type` answers yes to and which is therefore
        // tagged `FUNCTION` without a special case anywhere.
        //
        // Empty, because nothing reads a field of it. **Calling** it is a
        // different feature and is refused by name: `TypeError(m)` is
        // `new TypeError(m)` in JavaScript and would need the token to carry a
        // `call` that constructs, which nothing in the profile asks for.
        if let Some(record) = self.snapshot.symbols.get(symbol.0 as usize)
            && self.member_read_from(id).is_none()
            && let Some(record_name) = record.name.public_name()
            && let Some(index) = crate::hir::builtin::error_index(record_name)
        {
            let ty = crate::hir::constructor_token(index);
            let base = self.token_base(id);
            self.layouts.push(Layout {
                types: vec![ty],
                name: crate::hir::builtin::constructor_name(
                    record
                        .name
                        .public_name()
                        .expect("a builtin constructor has a public name"),
                ),
                interfaces: Vec::new(),
                fields: Vec::new(),
                methods: Vec::new(),
                base,
            });
            let ty = HirType::Managed(ManagedType::Object(ty));
            return Ok(self.push(OpKind::ClosureStatic, ty, origin));
        }
        // A class **this program declares**, used as a value.
        //
        // Everything the arm above says applies unchanged; the only difference
        // is where the token's index comes from. A provided error's is its
        // position in `builtin::ERRORS`, which is a compile-time list. A user
        // class's is `Naming::class_tokens`, because there is no list -- and it
        // has to be decided once for the whole program, since a builder is made
        // fresh per function and the value must be the same object in each.
        //
        //     this.#IncomingMessage = opts.IncomingMessage ?? IncomingMessage;
        //
        // is node's documented `createServer({ IncomingMessage })` option, a
        // caller substituting the message class. It is the single NTS1001 in
        // `http.Server`'s constructor, which is what `createServer` waits on,
        // which the Node lane ranks at **274 failing test files** -- the
        // largest item on the compiled axis.
        //
        // **`new` through such a value is a separate feature and still
        // refuses**, as "a computed constructor". This produces the class
        // object; constructing through one needs the token to carry something
        // that allocates and runs a constructor, which is the closure-base
        // dispatch of record 0096 with a different member. Both refusals are
        // visible on one probe, so this is not a cleared root revealing another
        // -- it is half of a known two.
        if let Some(record) = self.snapshot.symbols.get(symbol.0 as usize)
            && self.member_read_from(id).is_none()
            && record.flags.contains(SymbolFlags::CLASS)
            && let Some(index) = self.class_tokens.get(&symbol.0).copied()
        {
            let ty = crate::hir::class_token(index);
            let base = self.token_base(id);
            self.layouts.push(Layout {
                types: vec![ty],
                name: crate::hir::builtin::constructor_name(
                    record
                        .name
                        .public_name()
                        .expect("a builtin constructor has a public name"),
                ),
                interfaces: Vec::new(),
                fields: Vec::new(),
                methods: Vec::new(),
                base,
            });
            let ty = HirType::Managed(ManagedType::Object(ty));
            return Ok(self.push(OpKind::ClosureStatic, ty, origin));
        }
        Err(self.refuse_nameless(id, &self.describe_name(id, symbol)))
    }
}
