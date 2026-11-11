//! Lower instanceof and descriptor/class tests, then expand and prune their class sets after layout collection.

use super::{
    BinOp, Builtin, Callee, Diagnostic, FuncBuilder, HirType, LiteralValue, ManagedType, Native,
    NodeId, OpKind, Origin, Program, Terminator, TypeId, TypeKind, UnOp, ValueId, construction,
    syntax, synthesized,
};

/// Each layout test (`OpKind::InstanceOf::by_layout`), widened to every
/// identity laid out where one of its types is.
///
/// A `this:` type is where the body reads its object, so every object laid
/// out there passes: a literal and a class that shares its shape with no
/// other answer with the shape's descriptor, and each class with an identity
/// of its own (`Program::distinct_identities`) with its own. Lowering named
/// the type and the classes under it; which other types share their layouts
/// is settled only after `canonicalize_objects`. Before this, `new Box()`
/// given to a `function (this: Valued)` stopped by name wherever a second
/// class, or a literal typed as `Box`, shared `Box`'s shape
/// (`tests/programs/a-function-that-reads-its-own-this`).
pub(super) fn expand_layout_tests(program: &mut Program) {
    let index = crate::hir::fields::LayoutIndex::build(program);
    let mut widened: rustc_hash::FxHashMap<TypeId, Vec<TypeId>> = rustc_hash::FxHashMap::default();
    for op in program.funcs.iter().flat_map(|func| &func.values) {
        let OpKind::InstanceOf {
            classes,
            by_layout: true,
            ..
        } = &op.kind
        else {
            continue;
        };
        for class in classes {
            if widened.contains_key(class) {
                continue;
            }
            let Some(at) = index.of_class(*class) else {
                continue;
            };
            let layout = &program.layouts[at];
            // One type per descriptor: each identity's own, and one plain
            // record for the shape's.
            let mut sharing: Vec<TypeId> = program
                .distinct_identities(layout)
                .iter()
                .filter_map(|identity| {
                    identity
                        .types
                        .iter()
                        .copied()
                        .find(|ty| layout.types.contains(ty))
                })
                .collect();
            sharing.extend(
                layout
                    .types
                    .iter()
                    .copied()
                    .find(|ty| program.plain_records.contains(ty)),
            );
            widened.insert(*class, sharing);
        }
    }
    if widened.is_empty() {
        return;
    }
    for op in program.funcs.iter_mut().flat_map(|func| &mut func.values) {
        let OpKind::InstanceOf {
            classes,
            by_layout: true,
            ..
        } = &mut op.kind
        else {
            continue;
        };
        let more: Vec<TypeId> = classes
            .iter()
            .filter_map(|class| widened.get(class))
            .flatten()
            .copied()
            .collect();
        classes.extend(more);
        classes.sort_unstable_by_key(|ty| ty.0);
        classes.dedup();
    }
}

/// Every `InstanceOf` names classes this program has a layout for, and no
/// `InstanceOf` names none.
///
/// The test is a descriptor comparison, so a class with no layout has no
/// descriptor to compare against and contributes nothing but its name. Whole
/// sets of them arrive that way: `"byteLength" in value` over an `object` asks
/// which types declare the name, and `lib.d.ts` declares it on `ArrayBuffer`,
/// on a `DataView` and on nine typed arrays -- object types in the snapshot,
/// natively represented here, allocated by nothing and laid out as nothing.
///
/// **Here rather than in a backend, because the two backends disagreed about
/// it and only one of them was visibly wrong.** The C emitter resolved each id
/// to a layout and dropped the ones that had none, silently, so an `InstanceOf`
/// naming four absent classes emitted `= false` and read as correct. The JVM
/// emitter said `an instanceof against no class at all` and declined the
/// function. Neither behaviour is the bug: the operation is, and it should not
/// have been built. Dropping it in one pass over the finished program is the
/// only place the question can be answered, because a layout is discovered by
/// whichever function first needs it and the set is not complete until every
/// function has been lowered.
///
/// The operand is left where it is. It is an already-computed value in the same
/// block, and the ops that produced it keep whatever effects they had; only the
/// test itself goes.
pub(super) fn prune_class_tests(program: &mut Program) {
    // A class extending a typed array has a descriptor and no layout.
    let laid_out: std::collections::HashSet<TypeId> = program
        .layouts
        .iter()
        .flat_map(|layout| layout.types.iter().copied())
        .chain(program.view_classes.iter().map(|view| view.class))
        .collect();
    for func in &mut program.funcs {
        for op in &mut func.values {
            let OpKind::InstanceOf { classes, .. } = &mut op.kind else {
                continue;
            };
            classes.retain(|class| laid_out.contains(class));
            if classes.is_empty() {
                op.kind = OpKind::ConstBool(false);
            }
        }
    }
}

impl FuncBuilder<'_> {
    /// The member being read, when this name is the target of a property access.
    /// Why a member of `Object` or `Reflect` cannot be built, where the reason
    /// is the representation rather than the calendar.
    ///
    /// `None` for the members that are simply not written yet -- `freeze`,
    /// `fromEntries` -- which keep the generic sentence, because for those it is
    /// true: they are absent and a fixed layout can answer them.
    ///
    /// # Why this is a category and not a list of members
    ///
    /// Every name here fails for **one** reason: a value's shape is fixed when
    /// it is laid out, so there is no prototype object to hold a property, no
    /// descriptor object to describe one, and no way to give a value a different
    /// shape at run time. A census that sees thirteen member names sees thirteen
    /// items of work; a census that sees one sentence sees a boundary, and the
    /// boundary is what is true.
    pub(super) fn reflection_of_a_layout(global: &str, member: &str) -> Option<String> {
        // `Reflect`'s whole surface is this question. `apply` and `construct`
        // are a call through a value rather than a shape question, and they are
        // here anyway: both take their arguments as an array, which is a spread
        // at every call, and neither is nearer than the rest of the family.
        let reflecting = global == "Reflect"
            || matches!(
                member,
                "defineProperty"
                    | "defineProperties"
                    | "getOwnPropertyDescriptor"
                    | "getOwnPropertyDescriptors"
                    | "getPrototypeOf"
                    | "setPrototypeOf"
                    | "prototype"
                    | "seal"
                    | "isSealed"
                    | "preventExtensions"
                    | "isExtensible"
            );
        if reflecting {
            return Some(format!(
                "`{global}.{member}`, which is prototype and descriptor reflection: a value's \
                 shape is fixed when it is laid out, so there is no prototype object to hold a \
                 property, no descriptor to redefine one with, and nothing that can be given a \
                 different shape at run time"
            ));
        }
        // **Absent, not impossible, and saying so is what keeps it findable.**
        // A layout knows its own names -- `Object.keys` answers from them
        // already -- and these two differ from `keys` only by the
        // non-enumerable and symbol-keyed properties a fixed layout does not
        // have. The reason to name it separately is the opposite of the usual
        // one: this is the *largest* item in the family by occurrences and
        // building it clears nothing, because every occurrence is the first line
        // of a descriptor loop that cannot work whatever it returns.
        if matches!(member, "getOwnPropertyNames" | "getOwnPropertySymbols") {
            return Some(format!(
                "`{global}.{member}`, a list of a layout's own names -- which `Object.keys` \
                 answers already, so this is absent rather than impossible, and every use of it \
                 in this corpus is the first line of a prototype-descriptor loop that cannot \
                 work whatever it returns"
            ));
        }
        // `Object.create(null)` **is built now**, by `decide_object_create`, and
        // this text used to promise it: "is a dictionary and is a different,
        // buildable thing". A promise in a diagnostic is a claim with an expiry
        // date, and leaving it here after building it would send a reader to
        // add a feature that exists.
        //
        // So what is left for this to say is the case the dispatch does *not*
        // take: a prototype argument that is not `null`, and the two-argument
        // form with a descriptor map. Prototype reflection is a boundary rather
        // than a gap -- `runtime/web-platform`'s `idlIteratorPrototype` is
        // `Object.create(ITERATOR_PROTOTYPE)`, and 30 of the corpus's top-level
        // cuts rest on it -- so this says boundary rather than "not yet".
        if member == "create" {
            return Some(format!(
                "`{global}.create` of a prototype object -- a fixed layout has no prototype slot \
                 to put one in, which is a representation boundary rather than a missing feature. \
                 `Object.create(null)` is a dictionary and does lower"
            ));
        }
        None
    }

    /// Every distinct native base, nearest first. A finite base chain has no
    /// depth cutoff; a malformed cycle visits all of its members once.
    pub(super) fn native_bases(&self, class: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        let mut seen = rustc_hash::FxHashSet::default();
        std::iter::successors(
            crate::hir::native::superclass(self.snapshot, class),
            |base| crate::hir::native::superclass(self.snapshot, *base),
        )
        .take_while(move |base| seen.insert(*base))
    }

    /// `"k" in value`.
    ///
    /// The same operation as `instanceof` with a different question in front of
    /// it. `instanceof` asks whether the value's class is one of a set the
    /// compiler computed from the hierarchy; this asks whether it is one of the
    /// set that *declares a property* -- and the set is computed the same way,
    /// from the static type, so it needs no new operation, no runtime helper,
    /// and nothing added to a descriptor.
    ///
    /// That is the whole design, and the reason it is small. A property table
    /// in the descriptor was the first plan: names in rodata beside the
    /// reference map, and a `nts_has_property` that walks them. It would have
    /// been an ABI change in three backends to answer a question the compiler
    /// already knows the answer to.
    ///
    /// # What it declines
    ///
    /// A key the compiler cannot see -- `k in o` for a variable `k` -- because
    /// the set cannot be computed without the name.
    ///
    /// An **optional** property, which is the decision `docs/conformance`
    /// recorded as the blocker for this row. The slot exists here whether or
    /// not the program ever wrote it, and JavaScript distinguishes `{}` from
    /// `{ a: undefined }`: `"a" in` the first is false and in the second is
    /// true. Nothing in this representation separates them, so the honest
    /// answer is a refusal rather than a slot that is always there.
    ///
    /// A union arm that is not an object type, because `"a" in 5` throws.
    /// TypeScript's `object`: not a primitive, and nothing further.
    ///
    /// The semantic `NonPrimitive` category, independent of checker flags
    /// with that one flag. It is what `typeof value === "object"` narrows an
    /// `unknown` to, and it is the type at 67 of the `in` sites in
    /// `runtime/node` and 36 more where it is a parameter.
    pub(super) fn is_the_object_type(&self, ty: TypeId) -> bool {
        matches!(
            self.snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind),
            Some(TypeKind::NonPrimitive)
        )
    }

    /// Which **natively represented** types answer `in` for a name.
    ///
    /// The boundary of the whole-program answer below, and the reason it is a
    /// list rather than a rule: `object` includes an array, a `Map`, a `Set`, a
    /// `Promise` and a `Date`, none of which has a layout in `program.layouts`
    /// -- so a set built from the layouts alone answers *false* for them, and
    /// for these names JavaScript answers true.
    ///
    /// This was a `bool` and a refusal for two months, which was the honest
    /// answer while the set was all it knew. What changed is that none of these
    /// needs a layout: each is one descriptor comparison the runtime already
    /// performs for `instanceof`, and a function is its *tag*. So the names
    /// below stopped being the boundary of the answer and became part of it --
    /// 31 of the 50 refusals across `runtime/node`, of which 27 are `then`.
    ///
    /// Named individually, and conservatively. A name missing from this list is
    /// a wrong answer -- the whole-program set answers `false` for a native and
    /// nothing says so -- and a name here that need not be costs one comparison.
    ///
    /// **What is deliberately absent, and is a stated limit rather than an
    /// oversight**: the names every object answers for through its prototype.
    /// `"toString" in x`, `"constructor" in x` and `"hasOwnProperty" in x` are
    /// `true` in JavaScript for every object including a plain class instance,
    /// and this compiler folds each to `false`. Measured, not assumed --
    /// `v2 = false` in the emitted C. Left as it is because a compiled program
    /// has no prototype chain to consult and the corpus asks it **zero** times,
    /// where an entry here would answer `true` unconditionally and be a wrong
    /// answer at the one site that ever writes `"toString" in x` meaning it.
    pub(super) fn natives_declaring(key: &str) -> &'static [Native] {
        match key {
            // An array, a tuple, a typed array and a function. Not a `DataView`,
            // which has `byteLength` and no `length`, and not a string -- a
            // string is not `object` in TypeScript, so one cannot arrive here.
            "length" => &[Native::Array, Native::TypedArray, Native::Function],
            // A `Map` and a `Set`, which are one struct here and one descriptor,
            // told apart by whether the entries hold values.
            "size" => &[Native::Map, Native::Set],
            // A `Promise`, and how every thenable test in the corpus is written.
            "then" | "catch" | "finally" => &[Native::Promise],
            // A typed array *and* a `DataView`: both sit on a buffer at an
            // offset, and both answer for all three names.
            "buffer" | "byteOffset" => &[Native::View],
            // The one of the three an `ArrayBuffer` answers for too -- it is the
            // block, so it has a length in bytes and no buffer under it.
            "byteLength" => &[Native::View, Native::ArrayBuffer],
            // A function, which `typeof v === "function"` admits beside
            // `object` at several of these sites.
            "name" | "call" | "apply" | "bind" => &[Native::Function],
            _ => &[],
        }
    }

    /// `"k" in v` where the representation already says what `v` is.
    ///
    /// `"length" in xs` with `xs` a `number[]` was refused as **"an `in` on
    /// something that is not an object"** -- a sentence about an array, which is
    /// an object in every sense the language has. The union path asks which of a
    /// type's *declared members* have the name; an array declares none, and
    /// `TypeKind::Array` is not `TypeKind::Object`, so it fell through to the arm
    /// written for primitives and borrowed their message. A refusal that told the
    /// reader their program was wrong.
    ///
    /// The answer is a constant and [`Self::natives_declaring`] already holds it:
    /// an array has a `length`, a `Map` has a `size`, a `Promise` has a `then`.
    ///
    /// **Only the `true` direction.** A name the table does not list is not
    /// therefore absent -- `push`, `slice` and `forEach` are all `true` in
    /// JavaScript and live on a prototype a compiled program does not have -- so
    /// the other direction stays a refusal, and now says which of the two it is.
    ///
    /// `Ok(None)` where the representation says nothing, which is every ordinary
    /// object and every union: the whole-program path answers those.
    pub(super) fn in_on_a_native(
        &mut self,
        id: NodeId,
        rhs: NodeId,
        key: &str,
        ty: TypeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(native) = self.native_receiver(ty) else {
            return Ok(None);
        };
        let origin = self.origin(id);
        if Self::natives_declaring(key)
            .iter()
            .any(|listed| std::mem::discriminant(listed) == std::mem::discriminant(&native))
        {
            // The operand is still evaluated: `in` has no short circuit, and the
            // left side of the `&&` chains these sit in has an effect often
            // enough to matter.
            self.lower_expression(rhs)?;
            return Ok(Some(self.push(
                OpKind::ConstBool(true),
                HirType::Bool,
                origin,
            )));
        }
        Err(self.unsupported(
            rhs,
            &format!(
                "an `in` naming `{key}` on a value this compiler represents natively, which \
                 answers for its own methods through a prototype a compiled program does not have"
            ),
        ))
    }

    /// What a receiver **is**, where its representation says so outright.
    ///
    /// The mirror of [`Self::natives_declaring`]: that one asks which natively
    /// represented things answer for a name, and this asks which one the value
    /// in front of us already is. Where the two meet, `in` is a constant — an
    /// array has a `length` and nothing has to be tested to find out.
    ///
    /// `String` is deliberately absent. `"length" in "abc"` **throws** in
    /// JavaScript, because `in` requires an object and a string primitive is
    /// not one, so the answer here is a refusal rather than `true`.
    ///
    /// `Date` is absent because nothing it answers for is in the table: every
    /// `Date` member is on a prototype this compiler does not have.
    fn native_receiver(&self, ty: TypeId) -> Option<Native> {
        Some(match self.represent(ty)? {
            HirType::Managed(ManagedType::Array(_)) => Native::Array,
            HirType::Managed(ManagedType::View(_)) => Native::TypedArray,
            // Either of the two, so only the names both answer for are
            // constant -- which is exactly what `View` means in the table.
            HirType::Managed(ManagedType::AnyView | ManagedType::DataView) => Native::View,
            HirType::Managed(ManagedType::Map(_, _)) => Native::Map,
            HirType::Managed(ManagedType::Set(_)) => Native::Set,
            HirType::Managed(ManagedType::Promise(_)) => Native::Promise,
            HirType::Managed(ManagedType::Buffer) => Native::ArrayBuffer,
            _ => return None,
        })
    }

    /// One natively represented test, as the runtime already spells it.
    ///
    /// Every one of these is a predicate `instanceof` emits, on the same erased
    /// value and by the same descriptor comparison -- so this adds no runtime
    /// surface, and the LLVM and JVM lanes already carry the signatures.
    pub(super) fn native_test(
        &mut self,
        native: Native,
        value: ValueId,
        origin: &Origin,
    ) -> ValueId {
        let call = |lower: &mut Self, name: &str| {
            lower.call_runtime(name, vec![value], HirType::Bool, origin)
        };
        match native {
            Native::Array => call(self, "nts_is_array"),
            Native::View => call(self, "nts_value_is_view"),
            // A typed array is a view that is not a `DataView`. Two tests
            // rather than nine `nts_is_view_kind` calls, and a subtraction
            // rather than an enumeration: a tenth typed array would join this
            // one for free and would have to be remembered in the other.
            Native::TypedArray => {
                let view = call(self, "nts_value_is_view");
                let data_view = call(self, "nts_is_data_view");
                let not = self.push(
                    OpKind::Unary {
                        op: UnOp::Not,
                        operand: data_view,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                self.bool_join(view, not, false, origin)
            }
            Native::ArrayBuffer => call(self, "nts_is_buffer"),
            Native::Map => call(self, "nts_is_map"),
            Native::Set => call(self, "nts_is_set"),
            Native::Promise => call(self, "nts_is_promise"),
            // The tag, and no call at all: a closure's erased form carries
            // `tags::FUNCTION`, which is what `typeof f === "function"` already
            // compiles to two hundred lines above.
            Native::Function => {
                let unsigned = HirType::Int {
                    bits: 32,
                    signed: false,
                };
                let tag = self.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
                let function = self.push(
                    OpKind::ConstInt(i128::from(crate::hir::tags::FUNCTION)),
                    unsigned,
                    origin.clone(),
                );
                self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: tag,
                        rhs: function,
                    },
                    HirType::Bool,
                    origin.clone(),
                )
            }
        }
    }

    /// The ES builtin an `instanceof`'s right side names, authenticated by what
    /// it references: a program's own `Promise` is its own class whatever it
    /// is called, and goes the ordinary class path. A `const` alias of a
    /// builtin does too, until its read is checked here.
    fn instanceof_global(&self, rhs: NodeId) -> Option<construction::CheckedGlobalReference> {
        self.checked_global_reference(rhs).filter(|global| {
            global.library == nts_semantic_schema::Library::Es && global.bindings.is_empty()
        })
    }

    fn instanceof_native(
        &mut self,
        id: NodeId,
        lhs: NodeId,
        rhs: NodeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(global) = self.instanceof_global(rhs) else {
            return Ok(None);
        };
        let name = global.name.clone();
        // A weak collection has **no representation**, so nothing a compiled
        // program can hold is one: `representation_within` gives `Map` and
        // `Set` a `ManagedType` and gives `WeakMap` and `WeakSet` none, no
        // constructor can produce one, and the Node-API boundary lets four
        // types inward of which none is a collection. So the test is not
        // unanswerable -- it is answerable, and the answer is `false`.
        //
        // Guarded on the fact rather than asserting it, because the day
        // `WeakMap` gains a representation this stops being true and a constant
        // `false` becomes a wrong answer. If it ever represents, this falls
        // through to the refusal it has today.
        //
        // Two of the ten classes in `internal/errors.ts`'s `staticObjectName`,
        // which reports **one refusal per function** -- so it named `DataView`
        // until `DataView` landed and then named `WeakMap`, and nothing in the
        // output ever said how many remained.
        //
        // `WeakRef` is the same case and is named beside them rather than
        // folded by a general rule. "Any unrepresentable type answers false"
        // would be true today and is a much larger claim than the evidence --
        // it would quietly fold a class this compiler has simply not learned
        // yet, where a refusal is the honest answer. These are named because
        // each was checked: `new WeakMap()`, `new WeakSet()`, `new WeakRef()`
        // and `new FinalizationRegistry()` all refuse as unrepresentable, and
        // `util`'s `inspect.ts` asks `value instanceof WeakRef` at :870 and
        // `value instanceof FinalizationRegistry` at :873, of real values.
        //
        // **`FinalizationRegistry` was missing from this list for as long as it
        // existed**, three lines from a `WeakRef` test that folded, so
        // `inspect`'s two adjacent branches answered differently: one a constant
        // `false`, the other `an instanceof against something this compiler has
        // no class for`. Nothing went red when it was added, because a refusal
        // does not fail when it expires.
        //
        // **Two functions decide this.** [`Self::instanceof_builtin`] makes the
        // same argument for `RegExp` and routes it through `Builtin::Never`
        // instead of answering here, because it shares a path with `Array`,
        // `Object` and `Function`. The *guard* is one fact, so it is written
        // once in [`Self::has_no_representation`] and consulted from both --
        // the lists differ because the dispatch does, and that is the only
        // thing about them that should.
        if matches!(
            name.as_str(),
            "WeakMap" | "WeakSet" | "WeakRef" | "FinalizationRegistry"
        ) && self.has_no_representation(&global)
        {
            let origin = self.origin(id);
            let _ = self.lower_expression(lhs)?;
            return Ok(Some(self.push(
                OpKind::ConstBool(false),
                HirType::Bool,
                origin,
            )));
        }
        let kind = crate::hir::builtin::typed_array_element(&name)
            .as_ref()
            .and_then(crate::hir::builtin::element_kind);
        let helper = match (name.as_str(), kind) {
            (_, Some(_)) => "nts_is_view_kind",
            ("ArrayBuffer", _) => "nts_is_buffer",
            // One struct and one descriptor, so no per-class layout exists to
            // find and the runtime answers it -- the same reason a typed array
            // is not a class here, without the kind, because there is only one.
            ("DataView", _) => "nts_is_data_view",
            // A `Date` likewise: one struct and one descriptor, and its whole
            // contents are the specification's time value.
            //
            ("Date", _) => "nts_is_date",
            // One struct serves both -- a Set is a Map that holds no values --
            // so `holds_values` is the whole of the difference and the two
            // predicates are one test and its negation. Two independent tests
            // could drift into both answering true, which is a wrong answer
            // rather than a refusal.
            //
            // Held back a batch on the JVM lane's word: their `newMap` and
            // `newSet` both returned a bare `NtsMap` and dropped the kind, so
            // `instanceof Set` would have been true for a `Map` with no example
            // to catch it. Their class carries the bit now, at a measured zero
            // bytes per operation.
            ("Map", _) => "nts_is_map",
            ("Set", _) => "nts_is_set",
            ("Promise", _) => "nts_is_promise",
            _ => return Ok(None),
        };
        let value = self.lower_expression(lhs)?;
        let origin = self.origin(id);
        let erased = self.erased_from(value, lhs, &origin);
        let mut args = vec![erased];
        if let Some(kind) = kind {
            args.push(self.push(
                OpKind::ConstFloat(f64::from(kind)),
                HirType::NUMBER,
                origin.clone(),
            ));
        }
        Ok(Some(self.call_runtime(
            helper,
            args,
            HirType::Bool,
            &origin,
        )))
    }

    pub(super) fn lower_instanceof(
        &mut self,
        id: NodeId,
        lhs: NodeId,
        rhs: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let Some(symbol) = self.node(rhs).symbol else {
            return Err(self.unsupported(rhs, "an `instanceof` whose right side is not a class"));
        };
        // Through the import alias, because a reference to an imported name
        // resolves to a symbol declared at the *import site* and the class's
        // type is filed under the declaration's. `chunk instanceof Buffer` in
        // `net`, where `Buffer` is `buffer`'s class, searched the type table for
        // the alias's symbol, found nothing, and reported it as a class this
        // compiler does not have -- of a class it had laid out.
        let symbol = self.denoted_symbol(symbol);
        if let Some(sent) = self.lower_objc_instanceof(id, lhs, rhs, symbol)? {
            return Ok(sent);
        }
        if let Some(asked) = self.lower_gobject_instanceof(id, lhs, symbol)? {
            return Ok(asked);
        }
        if let Some(asked) = self.lower_bound_instanceof(id, lhs, symbol)? {
            return Ok(asked);
        }
        if let Some(asked) = self.lower_com_instanceof(id, lhs, symbol)? {
            return Ok(asked);
        }
        if let Some(asked) = self.lower_boxed_instanceof(id, lhs, symbol)? {
            return Ok(asked);
        }
        // The class's *instance* type. The right operand names the constructor,
        // whose type is not the type of what `new` produces, so it is found by
        // the symbol both share -- and by the symbol rather than by the name,
        // because two modules may each declare a `Point`.
        let mut named: Vec<TypeId> = self
            .snapshot
            .types
            .iter()
            .enumerate()
            .filter(|(_, record)| {
                record.symbol == Some(symbol)
                    && matches!(record.kind, nts_semantic_schema::TypeKind::Object { .. })
            })
            .filter_map(|(at, _)| u32::try_from(at).ok().map(TypeId))
            .collect();
        named.sort_unstable_by_key(|ty| ty.0);
        // **Whether the class has one instance type or several**, which decides
        // whether a narrowing has a single answer. A generic class has one record
        // per instantiation, all sharing the symbol, so `named.first()` below is an
        // arbitrary one of them -- the *test* expands every one (`classes` below),
        // and it is wrong as a *type* to re-type a binding to. Recording it anyway typed a
        // narrowed value as one instantiation where the use wanted another: +46
        // refusals over the two corpora, at two sites in web-platform's streams,
        // reading `a ReadableStreamDefaultReader where a ReadableStreamDefaultReader
        // is wanted`, which is the same name printed for two type ids.
        let one_instance_type = named.len() == 1;
        // A provided error class is found by *name*. `lib.d.ts` declares
        // `TypeError` as a variable of type `TypeErrorConstructor`, so the
        // symbol the right operand resolves to is the constructor's and never
        // the instance's -- there is no symbol the two share. Name is what
        // [`super::builtin`] identifies these four by everywhere else, and they
        // are global, so there is nothing else they could be.
        let class = named.first().copied().or_else(|| {
            let global = self.instanceof_global(rhs)?;
            self.provided_error_class(&global)
        });
        // A typed array is not a class here and never will be: all nine share
        // one struct and one descriptor, differing only in how their bytes are
        // read, so there is no per-class layout for the search above to find.
        // The runtime answers it instead, by descriptor *and* kind -- the
        // descriptor says "some typed array" and the kind says which, and a
        // test of the descriptor alone would call a `Float32Array` a
        // `Uint8Array`.
        //
        // Before the refusal rather than after the class search, because the
        // search cannot succeed and the message it produces -- "something this
        // compiler has no class for" -- is true and useless: it describes the
        // representation rather than the question.
        if let Some(answer) = self.instanceof_native(id, lhs, rhs)? {
            return Ok(answer);
        }
        if let Some(answer) = self.instanceof_builtin(id, lhs, rhs)? {
            return Ok(answer);
        }
        let Some(class) = class else {
            return Err(self.unsupported(
                rhs,
                "an `instanceof` against something this compiler has no class for",
            ));
        };

        // Every type the class's symbol names is that class at run time: a
        // generic class's instantiations are each an instance of it, and so
        // are their subclasses.
        let mut classes: Vec<TypeId> = std::iter::once(class)
            .chain(named.iter().copied())
            .flat_map(|ty| self.classes_under(ty))
            .collect();
        classes.sort_unstable_by_key(|ty| ty.0);
        classes.dedup();

        let value = self.lower_expression(lhs)?;
        let origin = self.origin(id);
        // Erased first, whatever it arrived as. The operation asks an object
        // for its class, and a value that might not be an object has to say so
        // -- which is what a tag is. An erase of something already known to be
        // an object is one inline word.
        let value = self.erased_from(value, lhs, &origin);
        // **Which binding was asked about, for the arm that runs when the answer
        // is yes.** The test is the licence a narrowing needs, and it was being
        // discarded here: `lower_if` saw only a `Bool`, so each use inside the
        // branch re-derived the narrowing from `node_types` -- which works for a
        // member read and has no path for an assignment, so `const alias = b`
        // inside `if (b instanceof Leaf)` was refused and its statement cut.
        //
        // Read straight off the operand's node, the way the identifier path reads
        // a binding (`self.node(id).symbol` then `bindings.get(&symbol.0)`), so
        // the key is the one the map is keyed by.
        if let Some(symbol) = self.node(lhs).symbol
            && one_instance_type
        {
            self.tested_by_instanceof.insert(id, (symbol.0, class));
        }
        Ok(self.push(
            OpKind::InstanceOf {
                value,
                classes,
                by_layout: false,
            },
            HirType::Bool,
            origin,
        ))
    }

    /// `e instanceof Array` and `e instanceof Object`.
    ///
    /// **Neither is a class here and neither can be.** An array is a runtime
    /// object with a length and no layout, and `Object` is not a declaration at
    /// all -- so the class search in [`Self::lower_instanceof`] has nothing to
    /// find, and the refusal that followed, *"an `instanceof` against something
    /// this compiler has no class for"*, was true about the representation and
    /// useless about the question. The same argument `instanceof_native` makes
    /// for a typed array, where all nine share one struct and one descriptor.
    ///
    /// **`Array` is `decide_is_array`**, the function `Array.isArray` already
    /// asks, rather than a second rule beside it. Two answers to "is this an
    /// array" would be two things to keep right, and the existing one is right
    /// about two cases a representation test gets wrong: a **tuple** is an
    /// `Array` in the language however this compiler lays it out, and a *typed*
    /// array is not one although it shares the representation. It also answers
    /// an **erased** operand at run time from the descriptor's kind, so
    /// `instanceof Array` inherits that for free.
    ///
    /// `Object` is the other half and is not a class test at all: it asks
    /// whether a value is an object, and a **string** and a **symbol** are
    /// managed values here and *primitives* in the language. That arm looks
    /// unreachable and is not. TypeScript rejects a primitive left operand
    /// outright -- `TS2358 The left-hand side of an 'instanceof' expression
    /// must be of type 'any', an object type or a type parameter` -- so no
    /// direct spelling reaches it; **a type parameter does**, since a generic
    /// is specialized per instantiation and `isObject("text")` arrives with a
    /// `Managed(String)` operand. Node answers `false` for it.
    ///
    /// An erased `Object` operand keeps refusing: the tag says "a reference"
    /// and a string is one too, so the tag alone does not draw this line.
    ///
    /// 16 files of the slice-1 `test/language` population reach the refusal --
    /// 7 `Array`, 7 `Object`, and one each of `RegExp` and `Function`, which
    /// stay refused.
    fn instanceof_builtin(
        &mut self,
        id: NodeId,
        lhs: NodeId,
        rhs: NodeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let global = self.instanceof_global(rhs);
        let wanted = match global.as_ref().map(|global| global.name.as_str()) {
            Some("Array") => Builtin::Array,
            Some("Object") => Builtin::Object,
            Some("Function") => Builtin::Function,
            // **Nothing a compiled program holds is a `RegExp`**, which is the
            // argument `instanceof_native` already makes for `WeakMap`,
            // `WeakSet` and `WeakRef`: the test is not unanswerable, it is
            // answerable and the answer is `false`. Guarded on the fact rather
            // than asserting it, so the day a regular expression represents
            // this falls through to the refusal it has today.
            Some("RegExp")
                if global
                    .as_ref()
                    .is_some_and(|it| self.has_no_representation(it)) =>
            {
                Builtin::Never
            }
            _ => return Ok(None),
        };
        if matches!(wanted, Builtin::Array) {
            return self.decide_is_array(id, lhs).map(Some);
        }
        let value = self.lower_expression(lhs)?;
        let ty = self.values[value.0 as usize].ty.clone();
        // A function value is an object with one method, so it is an `Object`
        // as well as a `Function` -- which is what JavaScript says, and is why
        // this is one test over the same representation rather than two.
        if matches!(wanted, Builtin::Function) {
            let answer = match &ty {
                HirType::Managed(ManagedType::Object(at)) => {
                    crate::hir::is_closure_type(*at)
                        || matches!(
                            self.snapshot.types.get(at.0 as usize).map(|r| &r.kind),
                            Some(TypeKind::Function(_))
                        )
                }
                HirType::Erased | HirType::NativePointer(_) => return Ok(None),
                _ => false,
            };
            let origin = self.origin(id);
            return Ok(Some(self.push(
                OpKind::ConstBool(answer),
                HirType::Bool,
                origin,
            )));
        }
        if matches!(wanted, Builtin::Never) {
            let origin = self.origin(id);
            return Ok(Some(self.push(
                OpKind::ConstBool(false),
                HirType::Bool,
                origin,
            )));
        }
        let answer = match &ty {
            // The primitive/object line.
            HirType::Managed(ManagedType::String | ManagedType::Symbol) => false,
            HirType::Managed(_) => true,
            // An erased value's tag says "a reference", and a string is one
            // too, so the tag does not draw this line. A native pointer is not
            // a JavaScript value at all. Both are refused rather than guessed
            // at, and they share an arm because they share an answer -- which
            // is *nothing to say*, not a `false`.
            HirType::Erased | HirType::NativePointer(_) => return Ok(None),
            // Every scalar. Unreachable through a direct spelling (TS2358) and
            // reachable through a type parameter, which is why it is here.
            _ => false,
        };
        let origin = self.origin(id);
        Ok(Some(self.push(
            OpKind::ConstBool(answer),
            HirType::Bool,
            origin,
        )))
    }

    /// The class a polymorphic `this` stands for, or the type unchanged.
    ///
    /// TypeScript models `this` as a type parameter named after its class and
    /// constrained to it. Anything keyed by the *class* -- the method
    /// hierarchy, a layout -- has to be asked about the class rather than about
    /// the parameter, and this is the one place that unwrapping is spelled.
    ///
    /// A genuine type parameter passes through untouched: `<T extends Buffer>`
    /// is named `T`, and this is named `Buffer`.
    /// `C` and everything that extends it, sorted: the class list an
    /// [`OpKind::InstanceOf`] tests.
    ///
    /// Sorted because the sources are hash maps and a list that varied between
    /// runs would emit a different program from one input.
    ///
    /// The provided error classes are in it, and they are not declarations in
    /// this program -- the hierarchy has never heard of them, and `TypeError
    /// extends Error` all the same. `e instanceof Error` inside a `catch` is the
    /// reason `instanceof` is worth having, so the relation is spelled here
    /// rather than left to a hierarchy that cannot see it.
    ///
    /// **Extracted so the dispatch chain [`Self::open_call`] builds asks the same
    /// question `x instanceof C` does.** A second derivation of "which classes
    /// answer yes" would agree on every fixture either author would write and
    /// differ exactly where a subclass arrives -- which is the case that makes a
    /// chain fall through to its abort on a value it should have recognised.
    pub(super) fn classes_under(&self, class: TypeId) -> Vec<TypeId> {
        let mut classes: Vec<TypeId> = vec![class];
        classes.extend(
            self.hierarchy
                .name
                .keys()
                .copied()
                .filter(|ty| *ty != class && self.descends_from(*ty, class)),
        );
        classes.extend(self.provided_errors_under(class));
        classes.sort_unstable_by_key(|ty| ty.0);
        classes.dedup();
        classes
    }

    /// A brand is a type-level ABI marker, not storage on a boxed number.
    /// TypeScript permits reading its string-named key even when the key's
    /// value type is `unique symbol`; erasure would return `undefined`.
    pub(super) fn check_native_brand_read(&self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        if let Some(pointee) = children
            .first()
            .and_then(|object| self.snapshot.node_types.get(object))
            .and_then(|ty| crate::hir::native::pointer(self.snapshot, *ty))
        {
            let numeric_index = self.kind_of(id) == Some(syntax::ELEMENT_ACCESS_EXPRESSION)
                && children.len() == 2
                && children
                    .last()
                    .and_then(|index| self.type_of(*index))
                    .is_some_and(|ty| matches!(ty, HirType::Int { .. } | HirType::Float { .. }));
            // A record, or the record made `const` -- what a `ConstPtr` points
            // at, whose fields are the same fields and only read.
            let record = match &pointee {
                crate::hir::native::Pointee::Record(layout) => Some(layout),
                crate::hir::native::Pointee::Const(inner) => match inner.as_ref() {
                    crate::hir::native::Pointee::Record(layout) => Some(layout),
                    _ => None,
                },
                _ => None,
            };
            let named_field = record.is_some_and(|layout| {
                children
                    .last()
                    .and_then(|member| self.native_member_key(id, *member))
                    .is_some_and(|name| layout.fields.iter().any(|f| f.name == name))
            });
            // A binding's property, read through the method its tag names.
            let accessor = self.kind_of(id) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
                && children.last().is_some_and(|member| {
                    self.is_accessor_property(*member)
                        || children.first().is_some_and(|object| {
                            self.delegated_accessor(*object, *member, false).is_some()
                                || self.delegated_named(*object, *member).is_some()
                        })
                });
            // An Objective-C property, read with its getter -- here only as
            // `a?.b`, whose arm sends it; the plain read is sent before this.
            let accessor = accessor
                || self.kind_of(id) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
                    && children
                        .first()
                        .zip(children.last())
                        .is_some_and(|(object, member)| {
                            self.objc_property(*object, *member).is_some()
                        });
            // A field of a class the program writes over an Objective-C class,
            // which `program_objc_instance_place` reads from its ivar's object.
            let field = self.kind_of(id) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
                && children
                    .last()
                    .and_then(|member| self.literal_name(*member))
                    .is_some_and(|name| {
                        self.is_program_objc_field(&pointee, &name)
                            || self
                                .state_by_type(id)
                                .is_some_and(|(_, class_ty, _)| self.chain_stores(class_ty, &name))
                    });
            if !(numeric_index && !matches!(pointee, crate::hir::native::Pointee::Opaque(_))
                || named_field
                || accessor
                || field)
            {
                return Err(self.unsupported(id, "a property read through a native pointer"));
            }
        }
        if let (Some(object), Some(member)) = (children.first(), children.last())
            && let Some(ty) = self.snapshot.node_types.get(object)
            && crate::hir::native::scalar(self.snapshot, *ty).is_some()
            && let Some(name) = self
                .snapshot
                .node_types
                .get(member)
                .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
                .and_then(|record| match &record.kind {
                    TypeKind::Literal(LiteralValue::String(text)) => {
                        text.as_utf8().map(str::to_owned)
                    }
                    #[expect(
                        clippy::match_same_arms,
                        reason = "keep audited semantic type variants explicit"
                    )]
                    TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
                    _ => None,
                })
                .or_else(|| self.literal_name(*member))
            && (crate::hir::native::Scalar::from_label(&name).is_some() || name == "__AsNumber")
        {
            return Err(
                self.unsupported(id, "reading a native ABI brand, which has no runtime value")
            );
        }
        Ok(())
    }

    /// `object instanceof C` for an Objective-C class `C`: `isKindOfClass:`,
    /// which asks the runtime, so a subclass the program never names answers
    /// as it does in Objective-C. A nil object answers `NO`, as any message to
    /// nil does.
    fn lower_objc_instanceof(
        &mut self,
        id: NodeId,
        lhs: NodeId,
        rhs: NodeId,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let is_objc = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)
            .is_some_and(|record| {
                record.declarations.iter().any(|declaration| {
                    self.kind_of(*declaration) == Some(syntax::CLASS_DECLARATION)
                        && crate::hir::native::is_objc_class(self.snapshot, *declaration)
                })
            });
        if !is_objc {
            return Ok(None);
        }
        let object = self.lower_expression(lhs)?;
        let HirType::NativePointer(pointee) = self.values[object.0 as usize].ty.clone() else {
            return Err(self.unsupported(id, "an `instanceof` of an Objective-C class on something that is not an Objective-C object"));
        };
        let class = self.lower_expression(rhs)?;
        let class_type = self.values[class.0 as usize].ty.clone();
        let HirType::NativePointer(class_pointee) = class_type else {
            return Err(self.unsupported(rhs, "an Objective-C class that is not a class object"));
        };
        let is_kind = synthesized(
            "isKindOfClass:",
            vec![
                crate::hir::native::Type::Pointer(pointee),
                crate::hir::native::Type::Pointer(class_pointee),
            ],
            crate::hir::native::Type::Bool,
            Some(crate::hir::native::Send {
                selector: "isKindOfClass:".to_owned(),
                class: None,
                super_of: None,
            }),
            Vec::new(),
        );
        let origin = self.origin(id);
        Ok(Some(self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(is_kind)),
                args: vec![object, class],
                frame: None,
            },
            HirType::Bool,
            origin,
        )))
    }

    /// `object instanceof C` for a `GObject` class `C` -- one a binding
    /// declares, or one the program wrote over one: `g_type_check_instance_is_a`
    /// against `C`'s `GType`, so a subclass answers as it does in GJS, and a
    /// NULL handle answers `false` without being asked.
    ///
    /// **A handle is not an object of the program's**, so the class search
    /// below cannot answer for one: it compared the handle's descriptor, which
    /// it does not have, and `new Task({}) instanceof Task` was `false` on both
    /// backends while `instanceof GtkLabel` was refused.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn lower_gobject_instanceof(
        &mut self,
        id: NodeId,
        lhs: NodeId,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(gtype) = crate::hir::native::gtype_function(self.snapshot, symbol) else {
            return Ok(None);
        };
        let object = self.lower_expression(lhs)?;
        let origin = self.origin(id);
        // An `unknown` holds a `GObject` exactly when it carries that family's
        // tag, and then the payload is the handle the test asks about -- read
        // back where the tag licensed it, as a narrowing reads one.
        let object = if self.values[object.0 as usize].ty == HirType::Erased {
            let root = crate::hir::native::gobject_root();
            let unsigned = HirType::Int {
                bits: 32,
                signed: false,
            };
            let tag = self.push(
                OpKind::TagOf { value: object },
                unsigned.clone(),
                origin.clone(),
            );
            let gobject = self.push(
                OpKind::ConstInt(i128::from(crate::hir::tags::HANDLE_GOBJECT)),
                unsigned,
                origin.clone(),
            );
            let is_one = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: tag,
                    rhs: gobject,
                },
                HirType::Bool,
                origin.clone(),
            );
            let (read, joined) = (self.new_block(), self.new_block());
            let handle =
                self.push_block_param(joined, HirType::NativePointer(root.clone()), origin.clone());
            let none = self.push(
                OpKind::ConstNull,
                HirType::NativePointer(root.clone()),
                origin.clone(),
            );
            self.terminate(Terminator::Branch {
                cond: is_one,
                then_target: read,
                then_args: Vec::new(),
                else_target: joined,
                else_args: vec![none],
            });
            self.switch_to(read);
            let read_back = self.push(
                OpKind::unerase(object),
                HirType::NativePointer(root),
                origin.clone(),
            );
            self.terminate(Terminator::Jump {
                target: joined,
                args: vec![read_back],
            });
            self.switch_to(joined);
            handle
        } else {
            object
        };
        let object_ty = self.values[object.0 as usize].ty.clone();
        if !matches!(object_ty, HirType::NativePointer(_)) {
            return Err(self.unsupported(
                id,
                "an `instanceof` of a `GObject` class on something that is not a handle",
            ));
        }
        let null = self.push(OpKind::ConstNull, object_ty, origin.clone());
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: object,
                rhs: null,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (asked, answered) = (self.new_block(), self.new_block());
        let answer = self.push_block_param(answered, HirType::Bool, origin.clone());
        let no = self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: answered,
            then_args: vec![no],
            else_target: asked,
            else_args: Vec::new(),
        });
        self.switch_to(asked);
        let class = self.call_gtype(id, &gtype)?;
        let is_a =
            self.call_foreign_named(id, "g_type_check_instance_is_a", vec![object, class])?;
        let is_a = if self.values[is_a.0 as usize].ty == HirType::Bool {
            is_a
        } else {
            let ty = self.values[is_a.0 as usize].ty.clone();
            let zero = self.push(crate::hir::zero_of(&ty), ty, origin.clone());
            self.push(
                OpKind::Binary {
                    op: BinOp::Ne,
                    lhs: is_a,
                    rhs: zero,
                },
                HirType::Bool,
                origin.clone(),
            )
        };
        self.terminate(Terminator::Jump {
            target: answered,
            args: vec![is_a],
        });
        self.switch_to(answered);
        Ok(Some(answer))
    }

    /// `value instanceof GdkRGBA` for a boxed record a binding declares: the
    /// record its value's `[Symbol.hasInstance]` predicate names, by
    /// `schema::boxed` -- the reading the result path's boxing uses. Of an erased value, the runtime answers
    /// (`nts_gobject_is_boxed`: a box that `nts_gobject_boxed_free` frees, of
    /// this `GType`);
    /// of one already held as the box, it is whether it is there. `None` for
    /// any other class.
    /// `x instanceof HTMLElement` against a class a binding implements: the
    /// test its overlay's `@ntsIs` names, `nts_dom_is(x, 5)` -- Blink's own
    /// wrapper-type test, which is how page script's `instanceof` answers, for
    /// every interface and not only those with a downcast. A null handle is no
    /// instance of anything, and is not asked.
    ///
    /// The function is synthesized from the tag, `bool f(const void *,
    /// uint32_t)`, and declared by the header the binding's module names: the
    /// tag is the whole contract, with no TypeScript declaration to keep beside it.
    fn lower_bound_instanceof(
        &mut self,
        id: NodeId,
        lhs: NodeId,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some((function, test, module)) = self.bound_instance_test(symbol) else {
            return Ok(None);
        };
        let object = self.lower_expression(lhs)?;
        let object_ty = self.values[object.0 as usize].ty.clone();
        if !matches!(object_ty, HirType::NativePointer(_)) {
            return Err(self.unsupported(id, "an `instanceof` of a class a binding implements, on something that is not a handle"));
        }
        let origin = self.origin(id);
        let null = self.push(OpKind::ConstNull, object_ty, origin.clone());
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: object,
                rhs: null,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (asked, answered) = (self.new_block(), self.new_block());
        let answer = self.push_block_param(answered, HirType::Bool, origin.clone());
        let no = self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: answered,
            then_args: vec![no],
            else_target: asked,
            else_args: Vec::new(),
        });
        self.switch_to(asked);
        let object_pointer =
            crate::hir::native::Pointee::Const(Box::new(crate::hir::native::Pointee::Void));
        let erased = self.push(
            OpKind::Convert(object),
            HirType::NativePointer(object_pointer.clone()),
            origin.clone(),
        );
        let unsigned = HirType::Int {
            bits: 32,
            signed: false,
        };
        let interface = self.push(OpKind::ConstInt(i128::from(test)), unsigned, origin.clone());
        let mut is = synthesized(
            &function,
            vec![
                crate::hir::native::Type::Pointer(object_pointer),
                crate::hir::native::Type::Scalar(crate::hir::native::Scalar::UInt32),
            ],
            crate::hir::native::Type::Bool,
            None,
            Vec::new(),
        );
        is.declared_at = module;
        let is_a = self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(is)),
                args: vec![erased, interface],
                frame: None,
            },
            HirType::Bool,
            origin,
        );
        self.terminate(Terminator::Jump {
            target: answered,
            args: vec![is_a],
        });
        self.switch_to(answered);
        Ok(Some(answer))
    }

    /// The `@ntsIs <function> <id>` on a class's declarations, and the module
    /// whose header declares that function: the one its binding names.
    fn bound_instance_test(
        &self,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Option<(String, u32, Option<NodeId>)> {
        let record = self.snapshot.symbols.get(symbol.0 as usize)?;
        let (tag, binding) = record.declarations.iter().find_map(|declaration| {
            let native = self.node(*declaration).native.as_deref()?;
            Some((native.is.clone()?, native.bound_by.clone()))
        })?;
        let [function, test] = tag.split_whitespace().collect::<Vec<_>>()[..] else {
            return None;
        };
        let test = test.parse().ok()?;
        let module = binding
            .as_deref()
            .and_then(nts_semantic_schema::binding::parse)
            .and_then(|(module, name)| {
                nts_semantic_schema::binding::declared_in(
                    self.snapshot,
                    module,
                    name,
                    syntax::TYPE_ALIAS_DECLARATION,
                )
            })
            .and_then(|alias| self.declaring_module(alias));
        Some((function.to_owned(), test, module))
    }

    fn lower_boxed_instanceof(
        &mut self,
        id: NodeId,
        lhs: NodeId,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(record) = self.boxed_asked(symbol) else {
            return Ok(None);
        };
        let value = self.lower_expression(lhs)?;
        let origin = self.origin(id);
        match self.values[value.0 as usize].ty.clone() {
            HirType::Erased => {
                let gtype = self.call_foreign_named(id, &record.get_type, Vec::new())?;
                Ok(Some(self.runtime_call(
                    "nts_gobject_is_boxed",
                    vec![value, gtype],
                    HirType::Bool,
                    origin,
                )))
            }
            HirType::Managed(ManagedType::Object(layout))
                if layout == self.boxed_record_layout() =>
            {
                let null = self.push(
                    OpKind::ConstNull,
                    HirType::Managed(ManagedType::Object(layout)),
                    origin.clone(),
                );
                Ok(Some(self.push(
                    OpKind::Binary {
                        op: BinOp::Ne,
                        lhs: value,
                        rhs: null,
                    },
                    HirType::Bool,
                    origin,
                )))
            }
            _ => Err(self.unsupported(
                id,
                "an `instanceof` of a boxed record on a value that is neither erased nor a box",
            )),
        }
    }

    /// The boxed record a binding's value answers `instanceof` for
    /// (`export const PangoAttrList: { [Symbol.hasInstance](value: unknown):
    /// value is PangoAttrList }`): the type its predicate names, when that is
    /// a boxed record. Every boxed record's value has one, a record with no
    /// constructor too. `None` for anything else.
    fn boxed_asked(
        &self,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Option<crate::hir::native::schema::BoxedRecord> {
        let value = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .copied()
            .find(|declaration| self.kind_of(*declaration) == Some(syntax::VARIABLE_DECLARATION))?;
        let mut pending = vec![value];
        while let Some(at) = pending.pop() {
            // `value is PangoAttrList`: the one child whose recorded type is
            // a boxed record, beside the parameter's name.
            if self.kind_of(at) == Some(syntax::TYPE_PREDICATE) {
                return self.children(at).into_iter().find_map(|child| {
                    let ty = *self.snapshot.node_types.get(&child)?;
                    crate::hir::native::schema::boxed(self.snapshot, ty)
                });
            }
            pending.extend(self.children(at));
        }
        None
    }

    /// `x instanceof Button` for a Windows Runtime class: whether `x` is a COM
    /// object that answers the class's default interface, asked by
    /// `QueryInterface` (`nts_winrt_is`) of the value erased -- whatever
    /// interface it was stored as, since a COM object is one object behind
    /// all of them. `None` for a class that is not a Windows Runtime one.
    fn lower_com_instanceof(
        &mut self,
        id: NodeId,
        lhs: NodeId,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(declarations) = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)
            .map(|record| record.declarations.clone())
        else {
            return Ok(None);
        };
        if !declarations
            .iter()
            .any(|decl| self.kind_of(*decl) == Some(syntax::CLASS_DECLARATION))
        {
            return Ok(None);
        }
        // A binding's class is ambient, so its instance type is the one its
        // merged interface (`interface Button extends IButton, …`) declares:
        // the handle `new` makes and a narrowing reads.
        let handle = declarations
            .iter()
            .filter(|decl| self.kind_of(**decl) == Some(syntax::INTERFACE_DECLARATION))
            .filter_map(|decl| self.name_node(*decl))
            .filter_map(|name| self.snapshot.node_types.get(&name).copied())
            .find_map(
                |instance| match crate::hir::native::pointer(self.snapshot, instance) {
                    Some(crate::hir::native::Pointee::Opaque(handle)) => Some(handle),
                    _ => None,
                },
            );
        // A Windows Runtime class this cannot resolve is refused, never
        // handed on: the general `instanceof` below finds no class of the
        // program's by that name and answers `false` for every value.
        let composable = declarations.iter().any(|decl| {
            self.node(*decl)
                .native
                .as_ref()
                .is_some_and(|n| n.composable.is_some())
        });
        let Some(handle) = handle else {
            if composable {
                return Err(self.unsupported(id, "an `instanceof` of a Windows Runtime class whose instance type names no interface"));
            }
            return Ok(None);
        };
        if handle.family != crate::hir::native::Family::Com {
            return Ok(None);
        }
        let Some(iid) = self.hierarchy.com_iids.get(&handle.tag).cloned() else {
            return Err(self.unsupported(id, &format!("an `instanceof` of a Windows Runtime class whose interface `{}` no binding asks for by IID", handle.tag)));
        };
        let object = self.lower_expression(lhs)?;
        let erased = self.coerce(object, &HirType::Erased, id)?;
        let origin = self.origin(id);
        let [low, high] = self.iid_arguments(&iid, &origin);
        Ok(Some(self.runtime_call(
            "nts_winrt_is",
            vec![erased, low, high],
            HirType::Bool,
            origin,
        )))
    }
}
