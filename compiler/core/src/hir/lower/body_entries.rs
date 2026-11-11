//! Build plain function and member bodies and dispatch each statement or expression to its owner.

use super::{
    AsyncResult, Copy, Diagnostic, Facts, Func, FuncBuilder, HirType, ImportPhase, LayoutCollector,
    Lowered, LoweringSnapshot, ManagedType, NodeId, OpKind, Over, Param, ParamShape, Shared,
    Substitution, Terminator, TypeId, ValueId, assertions, instance_type_of, is_static_member,
    member_name_of, members_of, note_member, raising_method, receiving_function_name, spell,
    syntax,
};

pub(super) fn lower_object_literal_members(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    literal: NodeId,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let mut owner = shared.builder(snapshot, foreign, Copy::default());
    let Some(instance) = owner.literal_member_owner(literal) else {
        return;
    };
    for member in members_of(snapshot, foreign, literal) {
        let mut builder = shared.builder(snapshot, foreign, Copy::default());
        // **A literal's accessor gets a raising copy too**, and the omission showed up
        // as a cascade with no root: `Closure0#call@raises` blaming `Type1#set y@raises`
        // in the conformance lane's `blockers/a-setter-throwing-inside-a-function-value`,
        // whose own header says it "moves back to a passing example when an accessor has
        // a raising copy". A literal is where the shape test262 uses lives -- `{ set y(v)
        // { throw … } }` with `attempt(() => { x.y = 23 })` -- so leaving it out would
        // have cleared the refusal for classes and left the files that actually need it
        // naming a function nothing defines.
        //
        // Before the `members_of` filter below and before `lower_method_of`, for the
        // reason `lower_class` gives: the call site names the copy from `naming.raising`
        // whether or not the ordinary body lowered.
        raising_method(
            snapshot,
            foreign,
            shared,
            lowered,
            literal,
            member,
            Some(instance),
            &Substitution::default(),
            &crate::hir::generics::Sources::default(),
            wanted,
        );
        // A member the type lays out as storage is a closure, emitted through
        // `used_closures` from the literal that builds it like every other;
        // there is no `T#read` to define, and so nothing for a second literal
        // to collide with.
        if builder
            .member_key(member)
            .is_some_and(|name| builder.literal_member_is_storage(instance, &name))
        {
            continue;
        }
        match builder.lower_method_of(literal, member, Some(instance)) {
            // **A member's function is named after the type the literal is
            // built at**, so two literals built at one *named* type each
            // declaring it produce two functions called `T2#twice`.
            //
            // That is invalid HIR, and invalid HIR is the worst way for this to
            // fail: `emit-c` prints `refusing to emit code from invalid HIR`,
            // writes nothing and **exits 0**, and the only diagnostic a reader
            // sees is the cascade — ``f` cannot be compiled because it calls
            // `T2#twice`, which was refused above` — with nothing above it,
            // because nothing was. A false sentence and a silently unbuilt
            // program.
            //
            // Refused here by name instead. The refusal is honest about what it
            // is: this needs *dispatch*, because two literals at one interface
            // are two implementations of it, and the call site has only the
            // interface. The anonymous case was solved on 2026-09-17 by giving
            // each literal its own identity — `__object` is not a nominal name —
            // and the named case is the same question with the answer already
            // taken by the interface. `blockers/two-literals-at-one-interface`
            // carries it.
            Ok(func)
                if lowered
                    .program
                    .funcs
                    .iter()
                    .any(|known| known.name == func.name) =>
            {
                let diagnostic = builder.unsupported(
                    member,
                    &format!(
                        "a second object literal declaring `{}` at one type, which would be two \
                         functions named `{}` — the two are different implementations and the call \
                         site has only the interface",
                        member_name_of(snapshot, member).unwrap_or_else(|| "a member".to_owned()),
                        func.name,
                    ),
                );
                note_member(
                    &mut builder,
                    lowered,
                    literal,
                    member,
                    Some(instance),
                    &diagnostic,
                );
                lowered.diagnostics.push(diagnostic);
            }
            Ok(func) => lowered.program.funcs.push(func),
            Err(diagnostic) => {
                note_member(
                    &mut builder,
                    lowered,
                    literal,
                    member,
                    Some(instance),
                    &diagnostic,
                );
                lowered.diagnostics.push(diagnostic);
            }
        }
        builder.harvest(wanted, &mut lowered.arrivals);
        layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
    }
}

impl FuncBuilder<'_> {
    /// The name a member is declared under, for comparing two of them.
    ///
    /// **A constructor answers before the identifier walk**, because it has no
    /// `IDENTIFIER` child: `constructor` is a keyword. `qualified_name` already
    /// carries that fact in its own words -- "`declared_name` returns the text
    /// of the first `IDENTIFIER` child, and a constructor has none" -- and this
    /// function had the identical hole.
    ///
    /// What it cost: [`Self::is_an_overload_signature`] identifies a signature
    /// by finding a same-named sibling *with* a body, so a `None` key made
    /// every constructor overload answer `false`. The signature was then
    /// lowered like an implementation, and a class with
    ///
    /// ```text
    /// constructor();
    /// constructor(a: number);
    /// constructor(a?: number) { ... }
    /// ```
    ///
    /// produced **invalid HIR** -- `emit-c` wrote nothing and exited 0, which
    /// is the silently-unbuilt shape rather than a refusal. 36 sites in
    /// `runtime/node`, all of them `buffer`'s `Blob` and `Buffer`.
    /// The block a method's code is in, where it has one.
    ///
    /// An `abstract` method is the one declaration that is *meant* to have no
    /// body, and `None` says so. Anything else without one is a declaration
    /// whose code this lowering cannot see -- an overload signature, an ambient
    /// declaration -- and stays refused, because emitting an unreachable
    /// function for one of those would be a function that *can* be reached and
    /// does nothing. The call goes to the implementation below it.
    pub(super) fn method_body(
        &mut self,
        member: NodeId,
        is_abstract: bool,
    ) -> Result<Option<NodeId>, Diagnostic> {
        // The overload *signatures* do not reach here at all: `lower_class`
        // skips them. The **implementation** is lowered, and used to be refused
        // with them.
        //
        // Refusing only the signatures was tried first and left invalid HIR:
        // call sites resolved against the signature TypeScript picked, whose
        // parameter list is not the implementation's, so `pick(a: number)`
        // beside `pick(a: number, b?: number) { .. }` gave
        // `CallArgumentCount { expected: 3, found: 2 }`. The implementation was
        // then refused too, and the whole method disappeared.
        //
        // What was missing is at the *call* rather than here. `implementation_of`
        // walks from the signature the checker resolved to the declaration that
        // has the body, so a call is built against the parameter list the
        // emitted function actually has -- and the omitted arguments fill in
        // exactly as they do for any other optional parameter.
        let body = self
            .children(member)
            .into_iter()
            .rev()
            .find(|child| self.kind_of(*child) == Some(syntax::BLOCK));
        match (body, is_abstract) {
            (Some(body), _) => Ok(Some(body)),
            (None, true) => Ok(None),
            // An overload *signature* never reaches here: `lower_class` skips
            // it, because it is a declaration rather than a member whose code
            // is missing. What is left is a method this lowering could not find
            // the body of, which is a gap and says so.
            (None, false) => Err(self.unsupported(member, "a method without a body")),
        }
    }

    pub(super) fn lower_method_of(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<Func, Diagnostic> {
        let is_static = is_static_member(self.snapshot, member);
        let class_name = self.class_name_for(class, instance, is_static)?;

        // A static method has no receiver: it is a namespaced function, and its
        // call sites name the class rather than an instance. So it is lowered
        // without the `this` parameter, and without a slot -- nothing overrides
        // a static method, because a call site names the class it is written on.

        // An `abstract` method declares a dispatch slot and nothing else. It is
        // lowered rather than refused because the *signature* is needed: a call
        // through `Shape#area` on a `Shape` receiver is an indirect call, and
        // the backend takes the function-pointer type from the declaration --
        // `virtual_signature` looks the name up in `program.funcs` and said "no
        // declaration for `Shape#area` to take a signature from" when this was
        // refused.
        //
        // So it becomes a function with the declared parameters and return type
        // and no body. The block is left open, which `finish` terminates as
        // `Unreachable`, and that is the truth rather than a placeholder: an
        // abstract class is never instantiated, so its slot is never the one
        // dispatch lands on. Every reachable receiver is a subclass whose
        // override fills the slot.
        let is_abstract = self
            .node(member)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::ABSTRACT);

        let is_constructor = self.kind_of(member) == Some(syntax::CONSTRUCTOR);
        self.in_constructor = is_constructor;
        // An accessor shares its *name* with the property it presents, so the
        // emitted name has to say which it is: a class may declare `get x` and
        // `set x` together, and both are functions taking the receiver. The
        // space is punctuation no TypeScript identifier may contain, like the
        // `#` beside it.
        let name = self.emitted_member_name(class, member, instance)?.1;

        let origin = self.origin(member);
        let mut params = Vec::new();
        // A constructor whose builtin base makes the instance has no receiver
        // (`begin_made_constructor`).
        let made =
            self.begin_made_constructor(class, member, instance, is_constructor && !is_static)?;
        if is_static {
            // No receiver, so no `this`.
            //
            // **A base, though.** This used to clear that too, saying "reaching
            // either inside a static method is a TypeScript error, so there is
            // nothing to refuse here that the checker has not". Half right:
            // `this` is, and `super` is not. `static make() { return
            // super.make() * 3 }` is ordinary TypeScript calling the base
            // class's static member, and it was refused as ``super` outside a
            // derived class` -- inside a derived class.
            self.this = None;
            self.base = self.base_class(class);
        } else if made.is_none() {
            // `this` is parameter zero. Its type is the class's instance type
            // -- or, for one copy of a generic class, the instantiation's.
            //
            // Through [`instance_type_of`] rather than the class node's type
            // directly, because a class *expression* node carries its
            // constructor. Taking that one gave `func Type8#m(this:
            // managed<obj#2>)`: a method named for the instance type whose
            // receiver is the constructor type, which has no fields, so
            // `this.v` refused with ``v`, which `__class` does not declare`` --
            // a sentence about the source that is false, since the class
            // declares `v` three tokens earlier.
            let instance = match instance {
                Some(ty) => HirType::Managed(ManagedType::Object(ty)),
                None => instance_type_of(self.snapshot, class)
                    .and_then(|ty| self.represent(ty))
                    // Named rather than described. `unrepresentable` reads the
                    // *member*'s type, and the member is a getter returning a
                    // `string` -- so 38 sites in the node profile said "a class
                    // of unrepresentable type (a representable type)", which
                    // contradicts itself and points at the wrong thing. What
                    // has no representation is the class, and after generic
                    // classes lower this is reached by one that nothing
                    // instantiates: `Holder<T>` is dead, and `v: T` has no
                    // width.
                    .ok_or_else(|| {
                        self.unsupported(
                            member,
                            &format!(
                                "a member of `{class_name}`, a class this compiler has no type for"
                            ),
                        )
                    })?,
            };
            // `this` is a parameter like any other and needs its layout to
            // exist. Nothing else builds it for a class nothing constructs --
            // an abstract base whose only role is to be extended is exactly
            // that.
            //
            // Reported against the *member*, not the class. The failure is
            // about the class's layout and the thing being refused is this
            // method, so pointing at the class gave one identical diagnostic
            // per method at the same line -- and left each method looking as
            // though nothing had been said about it at all.
            self.materialize(member, &instance)?;
            let receiver = self.push(OpKind::Param(0), instance.clone(), origin.clone());
            self.this = Some(receiver);
            self.base = self.base_class(class);
            params.push(Param {
                name: "this".to_owned(),
                shape: ParamShape::Ordinary,
                ty: instance,
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
        }

        // **A generator declared as a *method*.** `begin_generator` had one
        // caller, `lower_function`, so a `*named()` or a `*[Symbol.iterator]()`
        // reached its body with no frame reserved and every `yield` in it said
        // "a `yield` outside a generator" -- true of the lowering and false of
        // the source. Not about symbol keys: a plainly named one said it too.
        //
        // This half was written and thrown away once, because the *call* site
        // could not name the frame and the method compiled unreachable. It is
        // back with `PropertyRecord::declaration`, which is the other half.
        let generated = self.begin_generator(member)?;
        let return_type = self.method_return_type(member, is_constructor, generated.as_ref())?;
        let return_type = made.clone().unwrap_or(return_type);
        // **Before the parameters, because a parameter's default can raise.** A
        // destructured parameter's element default -- `{ x = thrower() }` -- is
        // evaluated while the pattern is bound, which is the loop below; inside a
        // raising copy that call is tested for a raise, and the test's "return a dummy
        // of this function's type" reads `self.returns`. Set after the loop, it was
        // still `Void`, so the dummy was *absent*: `ReturnType { expected: Float,
        // found: None }`, invalid HIR, on a program `eb92ee8f9` had just started
        // compiling. The same move `lower_function` makes, for the same reason.
        //
        // `finish_params` stays below, because it needs the bound parameters.
        self.returns = return_type.clone();
        self.return_elements = self.written_tuple_return(member);
        // **And the promise before the parameters too**, as `lower_function`
        // allocates it: binding them is part of the call the promise answers, so
        // a pattern's TypeError rejects it rather than reaching `nts_uncaught`
        // before any promise exists.
        let asynchronous = self.begin_async(member, &return_type)?;

        let mut declared = Vec::new();
        for child in self.children(member) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            let index = u32::try_from(params.len()).unwrap_or(0);
            if self.declares_a_field(child) {
                declared.push((child, index));
            }
            params.extend(self.lower_param_or_labels(child, index)?);
        }

        self.start_bound_body(member)?;
        // Stored once the class's own fields are made, not here: before
        // `super()` a derived class's store was overwritten by the base's own
        // initialiser of the same name (`constructor(override readonly sides)`
        // over `sides = 0` answered 0), and before the field initialisers each
        // initialiser saw the parameter already assigned.
        //
        // A class over a native base keeps the order it had: its `super()` is
        // the native constructor's (`lower_objc_super_init`, `gobject_super`,
        // `com_super`), which makes none of this class's fields, so nothing
        // after it would store them.
        if self.made_by.is_some() {
            self.store_parameter_properties(&declared)?;
        } else {
            self.pending_parameter_properties = declared;
        }

        let body = self.method_body(member, is_abstract)?;

        // A constructor returns nothing. It could return the instance -- it has
        // one in hand -- but the caller allocated that instance and already
        // names it, so returning it hands the caller a second reference to an
        // object it is already holding. Under reference counting that is a
        // retain and a release per construction for no gain, and under any
        // provider it is a copy the C compiler has to see through.
        //
        // A setter likewise, and by the language's rule rather than by reading
        // the declaration: `set x(v)` may not annotate a return type and may
        // not return a value, so there is nothing to look up and nothing a
        // lookup could get wrong. Deriving it once gave `set ["size"](n:
        // number)` an `f64` return it never produces, and the emitter rendered
        // that honestly as a store followed by `__builtin_unreachable()` --
        // which the C compiler reads as a licence to compute anything at all
        // in the caller.
        let return_type = self.finish_params(&mut params, return_type, &origin)?;
        // A class with no base has no `super()`, so its own field initialisers
        // go at the top of its constructor. A derived class's go immediately
        // after the `super()` call, which `lower_super` emits -- the language
        // puts them there and `tests/programs/a-field-initialiser` is the difference.
        if is_constructor
            && self.base.is_none()
            && let Some(receiver) = self.this
        {
            self.initialize_own_fields(member, receiver)?;
        }
        if let Some(body) = body {
            self.lower_block(body)?;
            self.end_made_constructor(member, made.is_some())?;
            // Falling off the end of an `extends null` constructor returns a
            // `this` that was never bound: see `this_is_never_bound`.
            if is_constructor && !self.is_terminated() && self.this_is_never_bound(body) {
                self.throw_unbound_this(member)?;
            }
            if generated.is_some() {
                // Falling off the end is the end of the walk, and `return e` is
                // the `TReturn` a `for...of` discards, so both are one exit.
                // `end_method_body` settles a promise and a generator has none.
                if !self.is_terminated() {
                    self.terminate(Terminator::Return(None));
                }
            } else {
                self.end_method_body(member, asynchronous.as_ref(), &return_type)?;
            }
        }

        // A method is reachable from outside exactly when its class is, so the
        // class's `export` is what makes it a root.
        let exported = self
            .node(class)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::EXPORT);
        let mut func = self.finish(name, params, return_type, origin, exported);
        // A constructor runs over an object `new` allocated a moment ago, so
        // every field it writes is writing over a zero. One whose base made
        // the instance has no receiver.
        func.initializes_receiver = is_constructor && made.is_none();
        func.written_return = self.written_return(member);
        func.result_absent = self.result_absent(member);
        func.written_return_elements = self.written_tuple_return(member);
        // A signature and nothing else. `body` is `None` exactly when the
        // method is `abstract`, which `method_body` is the only decider of.
        func.abstract_declaration = body.is_none();
        Ok(func)
    }

    /// An expression evaluated for its effects, its value discarded. Expecting
    /// an erased value, because a discarded value may be any representation and
    /// `undefined` and `null` -- options' commonest values -- have one only where
    /// something expects it.
    pub(super) fn lower_for_its_effects(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        self.lower_expecting(id, &HirType::Erased).map(drop)
    }

    pub(super) fn lower_function(&mut self, id: NodeId) -> Result<Func, Diagnostic> {
        let children = self.children(id);
        if self.needs_parameter_entry(id) {
            self.parameter_entry = Some(id);
            self.prepare_parameter_cells(id);
        }

        let name = self
            .emitted_function_name(id)
            .ok_or_else(|| self.unsupported(id, "an anonymous function"))?;
        // A body that reads its own `this` takes the call's first, under a name
        // of its own; the emitted name is the entry passing `undefined`, which
        // the driver adds beside it ([`receiving_function_name`]).
        let reads_this = self.declaration_reads_this(id);
        let name = if reads_this {
            receiving_function_name(&name)
        } else {
            name
        };

        // The return type comes from the annotation when there is one. Without it
        // the checker's inferred type is on the signature, not on any node, so an
        // unannotated function is refused rather than guessed at.
        let body = children
            .iter()
            .rev()
            .find(|child| self.kind_of(**child) == Some(syntax::BLOCK))
            .copied()
            .ok_or_else(|| self.unsupported(id, "a function without a body"))?;

        // A generator's *declared* return type is `Generator<T, ...>`, which
        // has no representation and is not what the compiled function hands
        // back. What it hands back is the frame, so that is its return type
        // here -- reserved now, because the `for...of` that walks one has to
        // name the same type and `hir::suspend` has not run yet.
        let generated = self.begin_generator(id)?;
        let return_type = if let Some(frame) = &generated {
            HirType::Managed(ManagedType::Object(frame.ty))
        } else {
            let return_type = self.return_type_of(id)?;
            // A frame has no snapshot type to materialize a layout from:
            // `hir::suspend` builds its layout, and it is the only thing that
            // can, because what goes in one is what survives a suspension.
            self.materialize(id, &return_type)?;
            return_type
        };
        // **The return type before the parameters, because a parameter's default can
        // raise.** A destructured parameter's element default -- `{ x = thrower() }`
        // -- is evaluated while the pattern is bound, which is here; inside a raising
        // copy that call is tested for a raise, and the test's "return a dummy of this
        // function's type" reads `self.returns`. Set after the loop, it was still
        // `Void`, so the dummy was *absent*: `ReturnType { expected: Float, found:
        // None }`, invalid HIR, on a program `eb92ee8f9` had just started compiling.
        //
        // Moved rather than derived a second time, which is the trap this file keeps
        // falling into -- one answer for "what does this function return", read by the
        // body's `return`s and by the raise path alike. `begin_async` stays where it
        // is: it allocates the promise before the body runs and nothing above needs
        // it.
        self.returns = return_type.clone();
        self.return_elements = self.written_tuple_return(id);

        let mut params = Vec::new();
        let this_argument = reads_this.then(|| {
            let origin = self.origin(id);
            params.push(Param {
                name: "this_argument".to_owned(),
                shape: ParamShape::Ordinary,
                ty: HirType::Erased,
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
            self.push(OpKind::Param(0), HirType::Erased, origin)
        });
        if self.parameter_entry.is_some()
            && let Some(this_argument) = this_argument
        {
            self.this = Some(self.receive_this(id, this_argument)?);
        }
        // An `async` function allocates its promise before the body runs, so
        // that every `return` has one to settle -- and so that the allocation
        // happens once rather than on each path out.
        //
        // **And before its parameters are bound**, because binding them is part
        // of the call the promise answers: a pattern's TypeError, or a default
        // that throws, rejects the promise the call returns
        // (EvaluateAsyncFunctionBody), where binding first sent that throw to
        // `nts_uncaught` with no promise in existence to reject. A generator's
        // `begin_async` answers nothing, and its binding throws at the call.
        let asynchronous = self.begin_async(id, &return_type)?;
        for child in &children {
            if self.kind_of(*child) != Some(syntax::PARAMETER) {
                continue;
            }
            params.extend(self.lower_param(*child, u32::try_from(params.len()).unwrap_or(0))?);
        }

        self.start_bound_body(id)?;
        // **The body's `this` is the call's**, proven at the declared type, as a
        // closure's is ([`Self::receive_this`]).
        if self.parameter_entry.is_none()
            && let Some(this_argument) = this_argument
        {
            self.this = Some(self.receive_this(id, this_argument)?);
        }
        self.lower_block(body)?;

        if let Some(result) = asynchronous {
            // Falling off the end of an `async` function resolves it with
            // `undefined`, which is what `return;` does -- so the two are the
            // same path rather than the second being a special case.
            if !self.is_terminated() {
                self.settle_and_return(id, &result, None)?;
            }
        } else if generated.is_some() {
            // Falling off the end of a generator is the end of the walk, and
            // `return e` in one is the `TReturn` of `Generator<T, TReturn>`,
            // which a `for...of` discards. So both are the same exit, and
            // `hir::suspend` turns it into the *done* the resumption answers.
            if !self.is_terminated() {
                self.terminate(Terminator::Return(None));
            }
        } else {
            self.close_body(id, &return_type)?;
        }

        let origin = self.origin(id);
        // **Never a raising copy**, whatever the declaration says. The export
        // surface names the plain function, which is the one an importer calls
        // and the one whose uncaught throw ends the program; the copy is an
        // internal artifact that only a guarded call site may name.
        //
        // And `exported` is what keeps a function alive through `hir::dce`, so
        // inheriting it made every raising copy a root: 41 of them in
        // `runtime/node/fs` alone, each emitted twice -- a prototype and a
        // definition -- and called from nowhere. Copies a `try` does reach are
        // kept by the call, like any other function.
        let exported = !self.raises
            && self
                .node(id)
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::EXPORT);
        let mut func = self.finish(name, params, return_type, origin, exported);
        func.written_return = self.written_return(id);
        func.result_absent = self.result_absent(id);
        func.written_return_elements = self.written_tuple_return(id);
        Ok(func)
    }

    /// End a method's body: settle its promise where it is `async`.
    ///
    /// An `async` method allocates its promise before the body runs, exactly as
    /// an `async` function does, and for the same two reasons: every `return`
    /// needs one to settle, and the allocation belongs on the one path in
    /// rather than on each path out. Falling off the end resolves it with
    /// `undefined`, which is what `return;` does, so the two are one path.
    ///
    /// This was refused -- *"`Promise<T>` has no representation, so an `async`
    /// method resolved to `-> void` and returned an `f64` from it anyway"*.
    /// `ManagedType::Promise` has existed for some time and `async` *functions*
    /// worked throughout; the refusal outlived its reason by long enough to be
    /// **161 occurrences at 63 distinct sites** in `runtime/node`, the largest
    /// single language refusal there.
    ///
    /// Nothing here is new machinery. `begin_async` is the call
    /// `lower_function` makes, `hir::suspend` splits the result by the same
    /// rule, and a method's receiver is a parameter like any other -- so it
    /// goes in the frame beside the rest and comes back on resumption.
    ///
    /// Its own function because the caller was one line over clippy's limit
    /// with it inline, which is a poor reason and produced a good split: this
    /// is the only part of `lower_method_of` that is about `async` at all.
    fn end_method_body(
        &mut self,
        member: NodeId,
        asynchronous: Option<&AsyncResult>,
        return_type: &HirType,
    ) -> Result<(), Diagnostic> {
        match asynchronous {
            Some(result) => {
                if !self.is_terminated() {
                    let result = result.clone();
                    self.settle_and_return(member, &result, None)?;
                }
            }
            None => self.close_body(member, return_type)?,
        }
        Ok(())
    }

    pub(super) fn lower_block(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        // A narrowing an `if` in this list left for the statements after it ends
        // with the list. See [`Self::narrowed_past_an_if`] for the invalid HIR that
        // says so: the unerase lives where the `if` was, and a read outside the
        // list need not be dominated by it.
        let outer = std::mem::take(&mut self.narrowed_past_an_if);
        // **A function declaration is hoisted, so its closure is built before the
        // first statement rather than where it stands.** `run(inner); function
        // inner() { ... n ... }` is ordinary JavaScript and the reverse order
        // compiles today, so lowering the binding at the declaration's position
        // made the order load-bearing where the language does not: `inner`'s read
        // found no binding, fell through to the function-value wrapper, and that
        // wrapper forwarded to the declared name -- which for a capturing nested
        // function is not a function of this program. `Closure1#call` calling
        // `inner`, "which nothing in this program defines", with no root
        // diagnostic; the GTK lane found it porting Workbench's Box, one arm past
        // the shape `3cf606cea` closed.
        //
        // `bind_nested_function` stays on the statement arm and skips a symbol
        // already bound, so a declaration somewhere this does not reach -- a
        // `case` clause's statement list, a module's own top level -- keeps
        // today's behaviour rather than losing it to a hoist that only covers
        // blocks.
        let mut lowered = Ok(());
        for statement in self.children(id) {
            if self.kind_of(statement) == Some(syntax::FUNCTION_DECLARATION)
                && self.hoistable(id, statement)
                && let Err(error) = self.bind_nested_function(statement)
            {
                lowered = Err(error);
                break;
            }
        }
        if lowered.is_err() {
            self.narrowed_past_an_if = outer;
            return lowered;
        }
        for statement in self.children(id) {
            // Everything after a `return` in the same block is dead. Lowering it
            // would put operations in a block that has already ended.
            if self.is_terminated() {
                break;
            }
            if let Err(error) = self.lower_statement(statement) {
                lowered = Err(error);
                break;
            }
        }
        for (symbol, held, narrow) in std::mem::replace(&mut self.narrowed_past_an_if, outer)
            .into_iter()
            .rev()
        {
            if self.bindings.get(&symbol) == Some(&narrow) {
                self.bindings.insert(symbol, held);
            }
        }
        lowered
    }

    /// Source imports acquire a module's source object, not its evaluated
    /// exports. They must reach statement validation rather than disappear
    /// among declarations whose ordinary bindings the module linker handles.
    pub(super) fn is_source_import(&self, id: NodeId) -> bool {
        self.kind_of(id) == Some(syntax::IMPORT_DECLARATION)
            && self.children(id).into_iter().any(|child| {
                self.kind_of(child) == Some(syntax::IMPORT_CLAUSE)
                    && ImportPhase::from_data(self.node(child).data) == Some(ImportPhase::Source)
            })
    }

    pub(super) fn lower_statement(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        match self.kind_of(id) {
            Some(syntax::IMPORT_DECLARATION) if self.is_source_import(id) => {
                Err(self.unsupported(
                    id,
                    "an `import source` declaration, which loads a module's source rather than its bindings",
                ))
            }
            Some(syntax::RETURN_STATEMENT) => self.lower_return(id),
            Some(syntax::BLOCK) => self.lower_block(id),
            Some(syntax::IF_STATEMENT) => self.lower_if(id),
            Some(syntax::WHILE_STATEMENT) => self.lower_while(id),
            Some(syntax::DO_STATEMENT) => self.lower_do_while(id),
            Some(syntax::SWITCH_STATEMENT) => self.lower_switch(id),
            Some(syntax::FOR_STATEMENT) => self.lower_for(id),
            Some(syntax::FOR_OF_STATEMENT) => self.lower_for_of(id, Over::Elements),
            Some(syntax::FOR_IN_STATEMENT) => self.lower_for_of(id, Over::Keys),
            Some(syntax::BREAK_STATEMENT) => self.lower_break(id),
            Some(syntax::CONTINUE_STATEMENT) => self.lower_continue(id),
            // Two kinds with nothing to run, for two different reasons.
            //
            // `;` on its own has nothing to lower and nothing wrong with it.
            //
            // A function declared inside a body is lowered by the walk in
            // `lower`, which visits *every* `FUNCTION_DECLARATION` in the file
            // and not only the top-level ones -- so the statement is a
            // declaration here exactly as `is_module_declaration` says it is at
            // module scope: its body is its own business. Hoisting comes free
            // with that. The name is a function in the program before any
            // statement here executes, so a call above the declaration resolves
            // like any other.
            //
            // One that reads a local of the function around it is refused, and
            // by the walk rather than here: lowered on its own it has a free
            // name, and "`base`, a name from an enclosing scope" says which.
            // That is a closure, and this is not the path that builds one.
            // **Two statements that declare no value and do nothing at run
            // time.** An empty statement is obvious; a class declaration inside
            // a function is not, and needs nothing done here for a reason worth
            // writing down: the driver walks *every* `CLASS_DECLARATION` node
            // wherever it sits, so the layout and the members are already
            // lowered, and `new L()` resolves through the checker's type rather
            // than through a binding. The same reason `bind_nested_function`
            // answers `Ok(())` for a function nothing captures.
            //
            // A method that reads an enclosing local is not answered by this and
            // is not meant to be: the member is lowered by a builder with no
            // enclosing bindings, so it refuses inside the method and names the
            // name. `blockers/a-class-capturing-its-enclosing-scope` holds it.
            //
            // An `interface` or a `type` inside a body is the same statement
            // with even less to it: TypeScript erases both, and the hierarchy
            // walks every `INTERFACE_DECLARATION` wherever it sits, so a
            // literal built at a local interface is laid out like one built at
            // a module-scope one. Found by `fuzz-statements.mjs`, whose function
            // arm puts each shape's statements in a body: the two shapes that
            // declare an interface refused as "a `interface declaration`" and
            // measured nothing.
            Some(
                syntax::EMPTY_STATEMENT
                | syntax::INTERFACE_DECLARATION
                | syntax::TYPE_ALIAS_DECLARATION,
            ) => Ok(()),
            // **A class declaration does one thing at run time: it evaluates its
            // `static` initialisers and its `static { … }` blocks.** Which is the
            // one clause the paragraph above was missing -- it said such a
            // declaration "declares no value and does nothing at run time", true of
            // the layout and the members and false of the statics, and a class
            // declared inside **any** block therefore never ran its static block:
            //
            //     { class InBlock { static { order.push("in a block") } } }
            //     class AtModuleScope { static { order.push("at module scope") } }
            //
            // answered `at module scope` where node answers both, silently. The two
            // module-scope loops in `lower` already call this for exactly this
            // reason, each with a comment saying so; a class one block in reached
            // here instead and was answered `Ok(())`.
            //
            // Pinned by the conformance lane as
            // `outcomes/a-static-block-of-a-class-in-a-block`, and it is the cause
            // of `test262`'s `static-init-abrupt` as well: a bare block does it too,
            // not only a function body.
            //
            // **What this does not make exact, and cannot here.** A class declared
            // in a *function* body is a fresh class per call in the language, so
            // node runs its statics per call against new storage; this program has
            // one class and one set of statics, so running them per call re-runs
            // them against the same storage. Closer than never running them, and
            // still not the language -- a fresh class per call is a
            // monomorphisation question rather than a statement-lowering one.
            Some(syntax::CLASS_DECLARATION) => {
                self.lower_static_fields(id)?;
                if !self.is_terminated()
                    && let Some(symbol) = self
                        .children(id)
                        .into_iter()
                        .find(|at| self.kind_of(*at) == Some(syntax::IDENTIFIER))
                        .and_then(|name| self.node(name).symbol)
                {
                    if self.initialization.class_cell(symbol.0) {
                        let cell = self.open_class_cell(symbol.0, id)?;
                        let origin = self.origin(id);
                        let ready =
                            self.push(OpKind::ConstBool(true), HirType::Bool, origin.clone());
                        self.field_set(cell, 0, ready, &origin);
                    }
                    self.mark_initialized(id, symbol.0);
                }
                Ok(())
            }
            Some(syntax::FUNCTION_DECLARATION) => self.bind_nested_function(id),
            Some(syntax::THROW_STATEMENT) => self.lower_throw(id),
            Some(syntax::TRY_STATEMENT) => self.lower_try(id),
            Some(syntax::LABELED_STATEMENT) => self.lower_labeled(id),
            Some(syntax::EXPRESSION_STATEMENT) => {
                let Some(expression) = self.children(id).first().copied() else {
                    return Ok(());
                };
                // `window.contentView?.hitTest(point);`: a chain whose value
                // nothing reads, though its type -- `NSView | null |
                // undefined` -- has no representation to read it in.
                if self.ends_an_optional_chain(expression) && self.type_of(expression).is_none() {
                    return self.chain_for_effect(expression);
                }
                let value = self.lower_expression(expression)?;
                // `bytes[i];`: an element read whose value the program throws
                // away. Reading an array's or a typed array's element has no
                // effect JavaScript can observe, so the read is not evaluated --
                // its object and index were, as operations of their own. A read
                // whose value *is* used stays, and may stop the program out of
                // range (`hir::may_stop`); this one would only have stopped a
                // program node runs to the end.
                // **Only when the statement *is* the read**, asked of the syntax:
                // `offset = words[i]!` is an assignment whose value is the
                // read, emitted last, and dropping it left `offset` naming a
                // value nothing defines -- C that does not compile.
                let mut node = expression;
                while matches!(
                    self.kind_of(node),
                    Some(syntax::PARENTHESIZED_EXPRESSION | syntax::NON_NULL_EXPRESSION)
                ) && let Some(inner) = self.children(node).first().copied()
                {
                    node = inner;
                }
                let only_a_read = self.kind_of(node) == Some(syntax::ELEMENT_ACCESS_EXPRESSION);
                // The read, or the read converted to the expression's type
                // (`convert` of a byte to a number), as the last operations.
                let read = match self.values[value.0 as usize].kind {
                    OpKind::Convert(inner) => inner,
                    _ => value,
                };
                let block = &mut self.blocks[self.current.0 as usize].ops;
                let tail: &[ValueId] = if read == value {
                    &[value]
                } else {
                    &[read, value]
                };
                if only_a_read
                    && block.ends_with(tail)
                    && matches!(self.values[read.0 as usize].kind, OpKind::ArrayGet { .. })
                {
                    block.truncate(block.len() - tail.len());
                    return Ok(());
                }
                // A call to something declared `never` does not come back, and
                // saying so is what makes the rest of the block dead rather
                // than merely unreached. `boundsError(offset, last)` is the
                // last statement of `Buffer#at8`, which is declared `: number`
                // and returns from every other path -- TypeScript accepts it
                // *because* the call cannot return, and without that fact the
                // function looked like one that falls out of its end owing a
                // value.
                //
                // `Unreachable` and not `FellThrough`: this is a claim the
                // lowering can back, which is the whole difference between the
                // two terminators.
                if self.values[value.0 as usize].ty == HirType::Never {
                    self.terminate(Terminator::Unreachable);
                }
                Ok(())
            }
            Some(syntax::VARIABLE_STATEMENT) => self.lower_variable_statement(id),

            // Named, not "this statement". Five sites in the corpus shared
            // that message and no reader could rank them -- which is the
            // mistake `describe_name` exists to undo one field over, and the
            // one `docs/records/notebooks/typescript-ledger.md` §15 warns about in as many words: the first
            // move on a row is to name what it blocks on. `for...in` and
            // `try` are different features and a count that adds them together
            // ranks neither.
            _ => {
                let what = self
                    .kind_of(id)
                    .and_then(nts_semantic_schema::syntax::name_of)
                    .map_or_else(|| "this statement".to_owned(), |name| format!("a `{name}`"));
                Err(self.unsupported(id, &what))
            }
        }
    }

    pub(super) fn lower_expression(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        if self.kind_of(id) == Some(syntax::NEW_EXPRESSION)
            && let Some(callee) = self.children(id).first().copied()
        {
            self.check_class_binding(callee)?;
        }
        match self.kind_of(id) {
            Some(syntax::IDENTIFIER) => self.lower_identifier(id),
            Some(syntax::NUMERIC_LITERAL) => self.lower_number(id),
            Some(syntax::BIGINT_LITERAL) => self.lower_bigint(id),
            Some(syntax::STRING_LITERAL) => self.lower_string(id),
            Some(syntax::BINARY_EXPRESSION) => self.lower_binary(id),
            Some(syntax::CALL_EXPRESSION) => self.lower_call(id),
            // Parentheses group; they compute nothing. Lowering the inner
            // expression is the whole of it — the grouping already happened when
            // the parser built the tree this shape.
            Some(syntax::PARENTHESIZED_EXPRESSION) => {
                let children = self.children(id);
                let [inner] = children.as_slice() else {
                    return Err(
                        self.unsupported(id, "a parenthesized expression of unexpected shape")
                    );
                };
                self.lower_expression(*inner)
            }
            Some(syntax::CONDITIONAL_EXPRESSION) => self.lower_conditional(id),
            Some(syntax::ARRAY_LITERAL_EXPRESSION) => self.lower_array_literal(id),
            Some(syntax::OBJECT_LITERAL_EXPRESSION) => self.lower_object_literal(id),
            // A C constructor a binding declares, or an Objective-C class,
            // which is built by messages: neither is a layout of ours.
            Some(syntax::NEW_EXPRESSION) => match self.native_construct(id) {
                Some(constructed) => constructed,
                None => match self.lower_com_new(id)? {
                    Some(object) => Ok(object),
                    None => match self.lower_objc_new(id)? {
                        Some(object) => Ok(object),
                        None => self.lower_new(id),
                    },
                },
            },
            // A `function` expression is a closure like an arrow's, and one that
            // reads its own `this` takes the call's (`ClosureInfo::reads_this`).
            Some(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION) => self.lower_arrow(id),
            Some(syntax::NULL_KEYWORD) => self.lower_absent(id),
            // `this` is parameter zero of a method. Outside one there is no
            // receiver to name.
            Some(syntax::THIS_KEYWORD) => self.lower_this(id),
            Some(syntax::ELEMENT_ACCESS_EXPRESSION) => self.lower_element_access(id),
            Some(syntax::AWAIT_EXPRESSION) => self.lower_await(id),
            Some(syntax::YIELD_EXPRESSION) => self.lower_yield(id),
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => {
                let value = self.lower_property_access(id)?;
                assertions::dereferenced_getter_read(self, id, value)
            }
            // Assertions establish a native representation before reading its
            // payload; satisfies only checks the source without changing it.
            Some(
                syntax::NON_NULL_EXPRESSION | syntax::AS_EXPRESSION | syntax::SATISFIES_EXPRESSION,
            ) => self.lower_assertion(id),
            Some(syntax::PREFIX_UNARY_EXPRESSION) => self.lower_prefix_unary(id),
            Some(syntax::POSTFIX_UNARY_EXPRESSION) => self.lower_postfix_unary(id),
            Some(syntax::TRUE_KEYWORD) => {
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstBool(true), HirType::Bool, origin))
            }
            Some(syntax::FALSE_KEYWORD) => {
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstBool(false), HirType::Bool, origin))
            }
            // A template with nothing in it is a string literal written with
            // different quotes.
            Some(syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL) => {
                let text = self.node(id).text.clone().unwrap_or_default();
                let origin = self.origin(id);
                Ok(self.push(
                    OpKind::ConstString(text),
                    HirType::Managed(ManagedType::String),
                    origin,
                ))
            }
            Some(syntax::TEMPLATE_EXPRESSION) => self.lower_template(id),
            Some(syntax::TAGGED_TEMPLATE_EXPRESSION) => self.lower_tagged_template(id),
            Some(syntax::DELETE_EXPRESSION) => self.lower_delete(id),
            Some(syntax::TYPE_OF_EXPRESSION) => match self.intrinsic_typeof(id) {
                Some(provided) => Ok(provided),
                None => self.lower_typeof(id),
            },
            Some(syntax::VOID_EXPRESSION) => self.lower_void(id),
            Some(syntax::REGULAR_EXPRESSION_LITERAL) => Err(self.unsupported(
                id,
                "a regular expression literal, which needs a regular expression engine",
            )),
            // Named, because the fallthrough below does not name anything and a
            // refusal nobody can group by is a refusal nobody can rank. Every
            // `yield` in the node profile was reported as "this expression",
            // so a work-list built from these messages could not see generators
            // at all -- and node's `readline` key decoder is one.
            //
            // Refusing it is the whole of what this compiler can say today.
            // Carrying the kind, for the same reason `yield` got a name of its
            // own: a refusal nobody can group by is a refusal nobody can rank.
            // The number is not an explanation, but it is enough to sort a
            // work-list by and to find the one case that is worth naming next.
            kind => Err(self.unsupported(
                id,
                &kind.map_or_else(
                    || "a node list".to_owned(),
                    |kind| spell(kind, "an expression"),
                ),
            )),
        }
    }
}
