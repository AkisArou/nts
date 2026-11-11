//! Resolve contextual and narrowed expression types.

#[cfg(test)]
use super::view_class_tests;
use super::{
    Absent, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, Program, TypeId,
    TypeKind, ValueId, ViewClass, declares_a_class, interfaces, named, named_class_source,
    readable_back, syntax,
};

/// The program's view classes ([`ViewClass`]): each class extending a typed
/// array that a view is made as or an `instanceof` asks about, with the view
/// class it extends where it extends one rather than the builtin.
pub(super) fn collect_view_classes(
    probe: &FuncBuilder<'_>,
    program: &Program,
) -> crate::hir::ViewClasses {
    let mut pending: Vec<TypeId> = program
        .funcs
        .iter()
        .flat_map(|func| &func.values)
        .flat_map(crate::hir::described_classes)
        .collect();
    let mut visited = rustc_hash::FxHashSet::default();
    let mut views = Vec::new();
    // Include every ancestor, even one no operation directly names. Shared
    // ancestry is visited once; publication is sorted by semantic class id.
    while let Some(class) = pending.pop() {
        #[cfg(test)]
        view_class_tests::note_class();
        if !visited.insert(class) {
            continue;
        }
        let Some(declaration) = declared_view_class(probe, class) else {
            continue;
        };
        let Some(HirType::Managed(ManagedType::View(element))) = probe.represent(class) else {
            continue;
        };
        let base = probe
            .snapshot
            .base_types
            .get(&class)
            .and_then(|bases| bases.first().copied())
            .filter(|base| declared_view_class(probe, *base).is_some());
        pending.extend(base);
        let Some(name) = probe.class_name(declaration) else {
            continue;
        };
        views.push(ViewClass {
            class,
            name,
            source: probe
                .snapshot
                .types
                .get(class.0 as usize)
                .and_then(|ty| ty.symbol)
                .and_then(|symbol| named_class_source(probe.snapshot, declaration, symbol.0)),
            element: *element,
            base,
            species: None,
        });
    }
    views.into()
}

/// The declaration of `ty` where it is a class the program declares whose
/// instances are views: a class extending a typed array, not the builtin.
fn declared_view_class(probe: &FuncBuilder<'_>, ty: TypeId) -> Option<NodeId> {
    let symbol = probe.snapshot.types.get(ty.0 as usize)?.symbol?;
    let declaration = probe
        .snapshot
        .symbols
        .get(symbol.0 as usize)?
        .declarations
        .iter()
        .copied()
        .find(|at| probe.kind_of(*at).is_some_and(declares_a_class))?;
    matches!(
        probe.represent(ty),
        Some(HirType::Managed(ManagedType::View(_)))
    )
    .then_some(declaration)
}

impl FuncBuilder<'_> {
    fn narrowed_collection_view(&mut self, id: NodeId, value: ValueId) -> Option<ValueId> {
        let have = &self.values[value.0 as usize].ty;
        if !matches!(
            have,
            HirType::Managed(ManagedType::Map(..) | ManagedType::Set(_))
        ) {
            return None;
        }
        // An untyped allocation and the choice passing it on already share
        // their contextual destination. Preserve that chosen view rather
        // than restoring the library overload's unconstrained arguments.
        let want = self.instead_of_an_unchosen_collection(id, self.type_of(id)?);
        if *have == want || !Self::tagged_collection_view(have, &want) {
            return None;
        }
        Some(self.collection_view(id, value, want))
    }

    /// Same-family `Convert` views carry no check, layout change or effect.
    /// They all name the carrier directly, keeping identity, escape and
    /// callback queries independent of the number of preceding views.
    /// Projections such as `Unerase` and control-flow joins remain real links.
    pub(super) fn collection_view(&mut self, id: NodeId, value: ValueId, want: HirType) -> ValueId {
        // Both view producers use this constructor, so a view's source is
        // already canonical. Keep the new source view and its own origin.
        let carrier = match self.values[value.0 as usize].kind {
            OpKind::Convert(source)
                if Self::tagged_collection_view(
                    &self.values[source.0 as usize].ty,
                    &self.values[value.0 as usize].ty,
                ) =>
            {
                source
            }
            _ => value,
        };
        self.push(OpKind::Convert(carrier), want, self.origin(id))
    }

    /// Map and Set arguments describe a source view of tagged entries. They
    /// never change the carrier's layout or identity. Array arguments also
    /// choose physical element storage and cannot use this rule.
    pub(super) fn tagged_collection_view(have: &HirType, want: &HirType) -> bool {
        matches!(
            (have, want),
            (
                HirType::Managed(ManagedType::Map(..)),
                HirType::Managed(ManagedType::Map(..))
            ) | (
                HirType::Managed(ManagedType::Set(_)),
                HirType::Managed(ManagedType::Set(_))
            )
        )
    }

    /// A read of an erased binding at the type the checker narrowed it to.
    ///
    /// This is the whole of `Unerase`, and it is one function on purpose. The
    /// binding is `unknown`; the *use* inside `if (typeof v === "number")` has
    /// static type `number`, because the checker narrowed it. Lowering notices
    /// that disagreement and reads the payload.
    ///
    /// Unchecked, and safe for one reason: the checker only narrows on a path
    /// where the test succeeded. Emitting it anywhere the checker did not
    /// narrow would read a payload the tag does not describe -- a double out of
    /// a pointer -- which is silent. So the licence comes from `node_types` and
    /// from nothing else, at every one of the call sites: each passes the node
    /// whose narrowed type it wants, and none of them names a type itself.
    ///
    /// [`FuncBuilder::present_of`] is the one read-back that does *not* come
    /// from here, because its licence is different -- see it for why.
    pub(super) fn narrowed(&mut self, id: NodeId, value: ValueId) -> Result<ValueId, Diagnostic> {
        if let Some(want @ HirType::NativePointer(_)) = self.type_of(id)
            && self.values[value.0 as usize].ty != want
        {
            // One Objective-C object as another class of object: what
            // `instanceof` narrowed it to after asking `isKindOfClass:`, or
            // what an `as` asserts -- unchecked, as every TypeScript assertion
            // is, and the object is the one it was. Objective-C code writes
            // the same cast of the `id` a collection hands back. Any other
            // pointer stays refused: its bytes are what its type says they are.
            let objc = |ty: &HirType| matches!(ty, HirType::NativePointer(crate::hir::native::Pointee::Opaque(handle)) if handle.family == crate::hir::native::Family::Objc);
            if objc(&want) && objc(&self.values[value.0 as usize].ty) {
                let origin = self.origin(id);
                return Ok(self.push(OpKind::Convert(value), want, origin));
            }
            // A `GObject` handle the checker narrowed to one of its subclasses
            // -- after `w instanceof GtkLabel`, which asked the type system
            // (`lower_gobject_instanceof`). Only a narrowing: an `as` asserts
            // unchecked, and stays refused (`a_class_downcast_by_assertion_is_refused`).
            //
            // And a host's handle on the same ground: `el instanceof
            // HTMLElement` against a class a binding implements asked Blink's
            // own wrapper-type test (`lower_bound_instanceof`).
            let handle = |ty: &HirType| match ty {
                HirType::NativePointer(crate::hir::native::Pointee::Opaque(handle))
                    if matches!(
                        handle.family,
                        crate::hir::native::Family::GObject | crate::hir::native::Family::Host(_)
                    ) =>
                {
                    Some(handle.clone())
                }
                _ => None,
            };
            if !matches!(
                self.kind_of(id),
                Some(syntax::AS_EXPRESSION | syntax::NON_NULL_EXPRESSION)
            ) && let (Some(narrow), Some(held)) =
                (handle(&want), handle(&self.values[value.0 as usize].ty))
                && narrow.upcasts_to(&held)
            {
                let origin = self.origin(id);
                return Ok(self.push(OpKind::Convert(value), want, origin));
            }
            // An `unknown` the checker narrowed to a handle -- after
            // `x instanceof GtkButton`, or `map.get(k)` of a `Map<K, GtkButton>`
            // -- read back as its family's tag, which `Unerase` checks. An `as`
            // is not a narrowing and stays refused.
            if !matches!(self.kind_of(id), Some(syntax::AS_EXPRESSION))
                && self.values[value.0 as usize].ty == HirType::Erased
                && matches!(&want, HirType::NativePointer(pointee) if crate::hir::tags::erased_handle_tag(pointee).is_some())
            {
                let origin = self.origin(id);
                let read = self.push(OpKind::unerase(value), want.clone(), origin.clone());
                // A COM object is stored as whichever of its interfaces it
                // was erased as -- the `IInspectable` a getter answered, or a
                // `Button` -- and each interface is its own pointer. So the
                // one the narrowing wants is asked for (`nts_com_query`, a
                // reference of its own), where a binding says its IID;
                // reading the stored pointer as another interface would call
                // through the wrong table.
                if let HirType::NativePointer(crate::hir::native::Pointee::Opaque(handle)) = &want
                    && handle.family == crate::hir::native::Family::Com
                    && let Some(iid) = self.hierarchy.com_iids.get(&handle.tag).cloned()
                {
                    let [low, high] = self.iid_arguments(&iid, &origin);
                    return Ok(self.runtime_call(
                        "nts_com_query",
                        vec![read, low, high],
                        want,
                        origin,
                    ));
                }
                return Ok(read);
            }
            return Err(self.unsupported(id, "a value asserted to be an opaque C pointer"));
        }
        // A view narrowed to its element type, which is the other direction of
        // `AnyView` and the one that makes it a representation rather than a
        // trapdoor.
        //
        // `ArrayBufferView` carries no element type -- that is the whole of why
        // it has a variant of its own -- and `view instanceof Uint8Array` is the
        // program supplying one. Both are a single `NtsView *` at run time, so
        // nothing is read and nothing is converted: the element type goes back
        // to being a fact the compiler carries.
        //
        // Spelled as erase-then-unerase because those two already mean "put it
        // in the representation everything shares" and "read it back as this
        // one". An op that reinterprets one pointer as another would be a second
        // answer to a question `Unerase` answers, and `Unerase` additionally
        // knows to materialize the class it lands in.
        //
        // Without this the discrimination lowers and the *reconstruction* does
        // not, which is worse than refusing both: the web-platform lane's BYOB
        // path tests thirteen ways and rebuilds thirteen ways, because
        // `ReadableStreamBYOBRequest.respond` has to hand back a view of the
        // type the caller passed. Half of a round trip is not a queue position,
        // it is "cannot be expressed".
        if self.values[value.0 as usize].ty == HirType::Managed(ManagedType::AnyView)
            && let Some(want @ HirType::Managed(ManagedType::View(_))) = self.type_of(id)
        {
            let origin = self.origin(id);
            let erased = self.push(
                OpKind::Erase {
                    value,
                    absent: Absent::Impossible,
                    slots: Absent::Impossible,
                },
                HirType::Erased,
                origin.clone(),
            );
            return Ok(self.push(OpKind::unerase(erased), want, origin));
        }
        if self.values[value.0 as usize].ty != HirType::Erased {
            return Ok(self.narrowed_collection_view(id, value).unwrap_or(value));
        }
        let Some(want) = self.type_of(id) else {
            return Ok(value);
        };
        if want == HirType::Erased {
            return self.cast_family_alias_result(id, value);
        }
        // **An array of `any` is not a narrowing**, and the emphasis is on `any`
        // rather than on the erasure.
        //
        // `Array.isArray(x)` on an `unknown` narrows it to `any[]`. Reading that
        // back as `Managed(Array(Erased))` is a **reinterpretation**, not a read:
        // what `nts_is_array` proved is that the value is an array, and the *width
        // of its elements* is a fact the runtime descriptor holds and `any` does
        // not. `tests/programs/dynamic-element` is that program, and its header is the
        // reason it exists -- *"Read as the wrong one, 8589934592 is
        // 4.2439915819305446e-314 -- finite, and `typeof` still says "number", so
        // nothing downstream can catch it."* It caught exactly this: 2 of its 9
        // cases answered the function's own `-1`, because the erased tag read out
        // of an `i64` slot is not a number tag.
        //
        // **Asked of the checker's element type and not of the representation**,
        // which is the correction: `Array(Erased)` has two sources and only one of
        // them says nothing. An element that is a *union* is erased because
        // `NtsValue` is genuinely what those slots hold -- `os`'s
        // `NetworkInterfaceMap` is `{ [k: string]: NetworkInterfaceInfo[] }` with a
        // two-shape union for the element, so unerasing to an array of erased
        // elements there is right, and refusing it cost `networkInterfaces`.
        //
        // The control distinguished the two by accident: `any[]` had no
        // representation at all, so this fell through to leaving the value erased,
        // while a union-elemented array had one and unerased. Reading the element's
        // *kind* is that same distinction made on purpose.
        //
        // Left erased, the reads that serve it are the dynamic ones -- `Length`'s
        // erased arm through the header, and `nts_array_element`, which asks the
        // descriptor what it holds. They are *more* capable here rather than a
        // fallback. A concrete element (`v as string[]`) still unerases below,
        // because there the program has supplied a width.
        if self.element_says_nothing(id) {
            return Ok(value);
        }
        // Narrowed to an absence, which is not a payload to read. After `v =
        // undefined` the checker types every later read of `v` as `undefined`,
        // whose representation is `Void` -- nothing at all. The erased value
        // already *is* that answer, tag and all, so the read stands as it is.
        //
        // Widening rather than narrowing, and safe for the same reason the
        // narrowing was: an erased value describes itself. `String(v)` reads
        // the tag and spells "undefined", which is what node does.
        //
        // `Never` is *not* this, and letting it through here emitted C that
        // would not compile. Inside `if (v !== undefined)` on a `v` the checker
        // already knows is `undefined`, the narrowed type is `never` -- the
        // branch is unreachable, and `never` is assignable to everything, so
        // the erased value flowed into a multiplication typed `f64` and the
        // backend cast a struct to a double. Refused instead, by the arm below.
        if want == HirType::Void {
            return Ok(value);
        }
        // Narrowed to `{}`, which is the checker saying *not null and not
        // undefined* rather than naming a shape. There is nothing to read
        // through it -- it declares no member -- so the narrowing buys nothing,
        // and it is not free: an unerase is a claim that the value *is* one of
        // these, and `{}` is a type no object belongs to.
        //
        // On a lane with pointers that claim is unchecked and invisible. The
        // JVM says it out loud:
        //
        //     java.lang.ClassCastException: class nts.gen.Messaged cannot be
        //     cast to class nts.gen.Type117
        //
        // where `Type117` is `{}`. Third time this project has recorded a lie
        // about a type that only the checked-cast backend could see.
        //
        // Anonymous, because a *named* empty class is a real class with real
        // instances -- `class Empty {}` -- and narrowing to one is ordinary.
        if let HirType::Managed(ManagedType::Object(object)) = &want
            && self.declares_nothing(*object)
            && named(self.snapshot, *object).is_none()
        {
            return Ok(value);
        }
        // Narrowed to `never`, which is the checker saying this code cannot run.
        //
        // Refused here until now, and the reason given was real: `never` is
        // assignable to everything, so an erased value returned from this
        // flowed into a multiplication typed `f64` and the backend cast a
        // struct to a double. But that is a fact about the *use*, and refusing
        // at the read refuses every use including the ones that are fine.
        //
        // Handed back unchanged instead. A consumer that wants a representation
        // asks `coerce` for one and gets `an erased value where a concrete
        // representation is wanted` -- the same refusal, at the site that
        // actually cannot be compiled, naming the operation rather than the
        // narrowing. A consumer that wants `unknown` needs nothing and gets it.
        //
        // `string_decoder` is the shape: `write(buf: ArrayBufferView | string)`
        // guards with `typeof buf === "string"` and then with
        // `!ArrayBuffer.isView(buf)`, which the checker knows is false -- so the
        // throw branch is `never`, and all it does with the value is hand it to
        // `ERR_INVALID_ARG_TYPE`, whose parameter is `unknown`.
        if want == HirType::Never {
            return Ok(value);
        }
        if !readable_back(&want) {
            return Err(self.unsupported(
                id,
                &format!("an `unknown` narrowed to {want:?}, which it cannot be read back as"),
            ));
        }
        // An unerase is where an erased value acquires a class, so this is one
        // of the places a layout has to exist and nothing else asks for one.
        // `materialize` covers a function's *signature* types, and a value read
        // out of a container is named by no signature: a local
        // `Map<string, Step>` refused with `NTS2006 an object type with no
        // layout` at `steps.get`, where the same map at module scope did not,
        // because a module global's type is represented and a local's is not.
        // Same repair as the closure-call path a few thousand lines down, at
        // the other end of the same question.
        self.materialize(id, &want)?;
        let origin = self.origin(id);
        self.refuse_a_foreign_layout(id, value, &want, &origin)?;
        Ok(self.push(OpKind::unerase(value), want, origin))
    }

    /// Whether every arm of this node's union type is the given class or below
    /// it.
    ///
    /// False for a node whose type is not a union, and deliberately: a single
    /// type that needed widening would already have the target's
    /// representation, so reaching here with one means something else is going
    /// on and the refusal should say so.
    pub(super) fn every_arm_descends_from(&mut self, id: NodeId, target: TypeId) -> bool {
        // The node whose type is the union. For a call argument or a return
        // that is `id` itself; for a variable declaration it is the
        // *initializer*, because the declaration's own type is the declared one
        // -- which is the target, so asking it would compare `Shape` with
        // `Shape` and answer nothing. Found by kind rather than by trying `id`
        // and falling back, so the two cases stay distinguishable.
        let id = if self.kind_of(id) == Some(syntax::VARIABLE_DECLARATION) {
            let children = self.children(id);
            let Some(initializer) = children.iter().rev().find(|child| {
                !syntax::is_type_node(self.kind_of(**child).unwrap_or_default())
                    && self.kind_of(**child) != Some(syntax::IDENTIFIER)
            }) else {
                return false;
            };
            *initializer
        } else {
            id
        };
        let Some(ty) = self.snapshot.node_types.get(&id).copied() else {
            return false;
        };
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        let TypeKind::Union(members) = &record.kind else {
            return false;
        };
        let members = members.clone();
        // `all` rather than `any`, and it is defence in depth rather than a
        // check a program can reach. TypeScript's own assignability already
        // requires every arm to satisfy the target, so no well-typed source can
        // tell the two apart -- weakening this to `any` fails no test and leaves
        // the corpus at `invalid HIR 0`, which was verified rather than assumed.
        //
        // It stays because the lowering should not depend on the checker having
        // run: `Unerase` is the one operation here whose being wrong is silent
        // rather than loud, and its other emitter is licensed by a tag test on
        // the path. This one is licensed by a claim about types, and the claim
        // is cheap to make locally.
        //
        // An empty union cannot license anything.
        !members.is_empty()
            && members
                .iter()
                .all(|member| *member == target || self.descends_from(*member, target))
    }

    /// The type a `new` should allocate at, which is the declaration's where
    /// that widens what is being constructed.
    ///
    /// Allocate at the type the DECLARATION says, where that is a widening
    /// of what is being constructed.
    ///
    /// ```text
    /// interface Tagged extends Error { code?: string }
    /// const warning: Tagged = new Error(m);
    /// warning.code = c;                       // refused
    /// ```
    ///
    /// TypeScript accepts this -- `code` is optional, so an `Error` is
    /// assignable -- and the binding coerced to `Tagged`, which for two
    /// managed types is an upcast and leaves the value's type alone. So the
    /// receiver stayed an `Error`, which declares no `code`, and the write
    /// was refused. A factory with a declared RETURN type compiled, because
    /// there the constructed type is the declared one: the same value under
    /// the same annotation, differing only in how the annotation arrives.
    ///
    /// Allocating the wider layout is what makes the write real, and it is
    /// sound rather than a cast: `put_bases_first` guarantees the base's
    /// fields are the prefix, so the constructor writes `message` and `name`
    /// at the offsets it always did and `code` is the zero a fresh field
    /// has. Nothing else holds the object -- it was allocated a moment ago.
    ///
    /// The Node session isolated this to one root blocking all of
    /// `node:punycode`, and to the same shape as twenty-one sites in
    /// `internal/errors.ts` that gate twenty of twenty-two modules.
    pub(super) fn widened(&mut self, id: NodeId, ty: HirType) -> HirType {
        let HirType::Managed(ManagedType::Object(built)) = ty else {
            return ty;
        };
        // Every position the checker gives a `new` a contextual type, which is
        // the declaration, the `return` and the argument alike. Asking only
        // about a declaration was one syntactic position short, and the one it
        // missed produced a heap write past the end of an allocation:
        //
        // ```text
        // function make(m: string): Tagged { return new Error(m); }
        // const w = make(m); w.code = c;
        // ```
        //
        // `make` allocated two fields and returned them as three, and the
        // caller then wrote field 2 -- invisible on a pointer-cast backend,
        // where `tests/programs/declared-wider` agreed with node on both C and LLVM
        // and raised a floor. The JVM lane refused it: `Type 'Error' is not
        // assignable to 'Tagged'`. The fourth time that lane has been the only
        // instrument able to see a lie about a type, and the first where what
        // it saw was a memory-safety defect rather than a wrong answer.
        let Some(HirType::Managed(ManagedType::Object(wanted))) = self.contextual_type(id, 0)
        else {
            return ty;
        };
        if wanted != built && self.hierarchy.descends_from(wanted, built) {
            HirType::Managed(ManagedType::Object(wanted))
        } else {
            ty
        }
    }

    /// What a value written where `ty` is expected is lowered as: `ty`'s own
    /// representation, or -- for a `CStrings` or `CBytes` a C function is lent,
    /// which has none of its own, only the `string[]` or `Uint8Array` the
    /// program holds -- that array's. So `gtk_string_list_new(null)` and
    /// `new GtkStringList({ strings: null })` have a `null` of the array's
    /// type to pass, which a C call lends as NULL.
    pub(super) fn represent_passed(&self, ty: TypeId) -> Option<HirType> {
        self.represent(ty)
            .or_else(|| crate::hir::native::native_array_argument(self.snapshot, ty))
    }

    /// What an operator that *picks a side* is heading for.
    ///
    /// `a || b`, `a ?? b`, `a && b` and `c ? a : b` choose no type of their own:
    /// the result is one operand or the other, so what each operand is heading
    /// for is what the whole expression is. Both arms of `contextual_type` asked
    /// this and asked it separately, which is two derivations of one sentence.
    ///
    /// The `null` step is the reason they are one now. `c ? null : null` and
    /// `false || null` have no representation and are exactly `null`, so the
    /// node's own type answers nothing and the operands were refused for want of
    /// a reference to stand in for -- while the expression one level up had
    /// already decided. `lower_branching_value` gives that merge an erased slot,
    /// and this is what tells the operands so. See [`Self::holds_only_absences`].
    fn what_the_whole_expression_is(&self, parent: NodeId, depth: u32) -> Option<HirType> {
        // The same answer the choice itself lowers at, so that every arm of it
        // agrees: see [`Self::instead_of_an_unchosen_collection`].
        self.type_of(parent)
            .map(|ty| self.instead_of_an_unchosen_collection(parent, ty))
            .or_else(|| {
                let ty = self.snapshot.node_types.get(&parent).copied()?;
                self.holds_only_absences(ty).then_some(HirType::Erased)
            })
            .or_else(|| self.contextual_type(parent, depth + 1))
    }

    /// The type an expression is expected to have, from where it sits.
    ///
    /// Only for the literals that have no type of their own. The checker types
    /// `null` as `null`, which is true and useless: what a backend needs is the
    /// reference type the absence is standing in for, and that is a property of
    /// the position rather than of the token.
    /// The storage a declaration gives the absence written as its initializer.
    ///
    /// Three sources, in order, and the order is the whole of it.
    ///
    /// **The written annotation first.** Not the *name's* type: the checker
    /// narrows the name by the initializer, so `let head: Element | null = null`
    /// types `head` as `null` right there -- true, and not what the storage is.
    ///
    /// **Then the name's own type**, for a declaration that has no annotation
    /// to read.
    ///
    /// **Then what the references settled on**, which is the step that was
    /// missing. `var x = null; x = 2` has no annotation and no representable
    /// type at the name, so both sources above decline and the `null` was
    /// refused for standing in for something that is not a reference -- while
    /// the binding one node up was a `number` by then.
    ///
    /// That last source needs widening, and the reason is worth stating because
    /// it is not obvious: [`Self::evolved_type`] walks the nodes carrying the
    /// symbol and **skips the declaration's own name**, so it answers `f64` for
    /// `var x = null; x = 2` -- every *reference* is a number. The `null` the
    /// slot carries until the assignment is not a reference and is nowhere in
    /// that answer, so the slot has to be the erased value that holds both. The
    /// annotated spelling reaches exactly that through the first source and
    /// lowered the whole time.
    ///
    /// **Scalars only, and the arm that says so is a native pointer.**
    /// `let held: Ptr<c_int> | null = null` is refused because a module-scope
    /// variable has no storage for a native pointer, and that refusal is what
    /// `local_addresses_cannot_outlive_or_free_their_storage` depends on:
    /// widening it to erased let a stack address escape into a global. A
    /// nullable *reference* needs nothing either -- a pointer already holds the
    /// absence, which is why `string | null` is one pointer and not a tag. Only
    /// a `bool`, an integer or a double has no room for an absence beside it.
    fn what_the_declaration_holds(&self, parent: NodeId, id: NodeId) -> Option<HirType> {
        let annotated = self
            .children(parent)
            .into_iter()
            .filter(|child| *child != id && self.kind_of(*child) != Some(syntax::IDENTIFIER))
            .find_map(|child| self.type_of(child));
        if let Some(ty) = annotated {
            return Some(ty);
        }
        let name = self
            .children(parent)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))?;
        if let Some(ty) = self.type_of(name) {
            return Some(ty);
        }
        self.evolved_type(name)
            .map(|ty| if ty.is_scalar() { HirType::Erased } else { ty })
    }

    pub(super) fn contextual_type(&self, id: NodeId, depth: u32) -> Option<HirType> {
        if depth > 8 {
            return None;
        }
        let parent = self.syntactic_parent(id)?;
        match self.kind_of(parent) {
            Some(syntax::ARRAY_LITERAL_EXPRESSION) => {
                self.contextual_array_element(id, parent, depth)
            }
            // **A `throw` erases whatever it is given**, which `lower_throw`
            // says in its own words: "`catch (e)` is `unknown`. That is the
            // language's own answer to what a handler receives, and taking it
            // means `throw "text"` and `throw new Error(m)` are one operation at
            // one representation". So the context here is erased, and that is
            // enough for `lower_absent` -- an erased slot has a tag for each
            // absence, so it takes the early return there and never asks for a
            // reference to stand in for.
            //
            // `throw undefined` and `throw null` are ordinary JavaScript and
            // were refused as ``null` or `undefined` where what it stands in for
            // is not a reference``: true of the node and false of the program,
            // because the statement one level up had already decided.
            Some(syntax::THROW_STATEMENT) => Some(HirType::Erased),
            // `return null` — whatever the enclosing function promised.
            Some(syntax::RETURN_STATEMENT) => {
                let owner = self.enclosing_callable(parent)?;
                self.declared_return(owner)
            }
            // `const x: Element | null = null`, `next: Element | null = null`,
            // and a parameter default. The declaration names the type.
            Some(
                syntax::VARIABLE_DECLARATION | syntax::PROPERTY_DECLARATION | syntax::PARAMETER,
            ) => self.what_the_declaration_holds(parent, id),
            // `x = null`, `p.next = null` — what the left side holds. And
            // `at !== null` — whatever the other side is, since a comparison
            // against the absent value is a comparison in that side's type.
            Some(syntax::BINARY_EXPRESSION) => {
                let parts = self.children(parent);
                let [left, operator, right] = parts.as_slice() else {
                    return None;
                };
                match self.kind_of(*operator) {
                    Some(syntax::EQUALS_TOKEN) => self.type_of(*left),
                    Some(
                        syntax::EQUALS_EQUALS_TOKEN
                        | syntax::EQUALS_EQUALS_EQUALS_TOKEN
                        | syntax::EXCLAMATION_EQUALS_TOKEN
                        | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN,
                    ) => {
                        let other = if *left == id { *right } else { *left };
                        self.type_of(other)
                    }
                    // `a || undefined`, `a ?? null`. Neither operator chooses a
                    // type: the result is one side or the other, so the whole
                    // expression's type is what each operand is heading for.
                    // Without this an `undefined` written as the right of a
                    // `||` had nothing to ask and was refused for standing in
                    // for something that is not a reference.
                    //
                    // **`+` is here for a different reason and the same
                    // answer.** A string `+` does not pick one side, it
                    // *converts* both -- and `as_string` already emits the
                    // literal text for an absence whose type is a string, which
                    // is what makes `undefined + ""` into `"undefined"`. What
                    // it needs is for the operand to have that type, and a bare
                    // `undefined` has none of its own. Inside a `return` the
                    // declared result supplied it; inside `if (undefined + ""
                    // !== "undefined")` nothing did.
                    //
                    // Safe for the arithmetic `+` because only an absence and a
                    // literal ask this, and `1 + null` is `TS2365` before the
                    // compiler sees it.
                    Some(
                        syntax::BAR_BAR_TOKEN
                        | syntax::AMPERSAND_AMPERSAND_TOKEN
                        | syntax::QUESTION_QUESTION_TOKEN
                        | syntax::PLUS_TOKEN,
                    ) => self.what_the_whole_expression_is(parent, depth),
                    _ => None,
                }
            }
            // `cond ? a : null` — the same argument the `||` arm above makes,
            // one syntax over: a conditional picks one arm or the other and
            // chooses no type of its own, so what the whole expression is is
            // what each arm is heading for.
            //
            // `(false ? true : null) !== null` is the shape the corpus writes,
            // and without this the `null` arm had nothing to ask. The condition
            // is a child too and never reaches here, because only an absence
            // and a literal consult this and a condition is neither.
            Some(syntax::CONDITIONAL_EXPRESSION) => {
                self.what_the_whole_expression_is(parent, depth)
            }
            // `f(null)` and `new Element(v, null)` — the parameter it fills.
            // The signature is the checker's answer after overload resolution,
            // so this is exact rather than a guess at which overload.
            Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION) => {
                let at = self
                    .children(parent)
                    .iter()
                    .position(|child| *child == id)?;
                // The callee rather than an argument: `new Array(6).fill(0)`
                // reaches here from the `new`, and what the whole call is
                // expected to be is what its receiver is expected to be. A
                // fallback only -- a caller that asked for something specific
                // rejects an answer that is not it.
                let Some(argument) = at.checked_sub(1) else {
                    return self.contextual_type(parent, depth + 1);
                };
                let signature = self
                    .snapshot
                    .call_targets
                    .get(&parent)
                    .map(|target| target.signature)
                    // A call through a *value* has no resolved target:
                    // `(callback as Callback<string>)(null, resolved)` names no
                    // declaration for the checker to point at. The callee's own
                    // type is a signature, which is the same answer reached from
                    // the other end, and it is how a node-style callback is
                    // always invoked -- seven of the sites in the profile.
                    .or_else(|| {
                        let callee = *self.children(parent).first()?;
                        let ty = *self.snapshot.node_types.get(&callee)?;
                        match self.snapshot.types.get(ty.0 as usize)?.kind {
                            TypeKind::Function(signature) => Some(signature),
                            #[expect(
                                clippy::match_same_arms,
                                reason = "keep audited semantic type variants explicit"
                            )]
                            TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
                            _ => None,
                        }
                    })?;
                let signature = self.snapshot.signatures.get(signature.0 as usize)?;
                let parameter = signature.parameters.get(argument)?;
                self.represent_passed(parameter.ty)
            }
            // The receiver of `x.m()`, for the same reason.
            // `{ signals: {} }` -- an object literal's property value, whose
            // type is the *field's* and is written down nowhere else.
            //
            // Without this arm the inner literal fell back to its own type,
            // which for `{}` is an anonymous object with no members. That was
            // harmless while every such field was an object: an empty layout
            // stored into a field expecting a layout is the same pointer. It
            // stopped being harmless the moment a field could be a **table** --
            // `os.constants` has four `Record<string, number>` fields, each
            // written `{}`, and each became an `NtsObj_Type9` stored into an
            // `NtsMap *` slot. `nts_map_set` on one segfaulted node during
            // `require`, with nothing on stdout, for every `os` test at once.
            //
            // The layout is not consulted -- `contextual_type` takes `&self`
            // and layouts are built as functions are lowered -- so the field's
            // declared type comes from the schema, which is where it was
            // written.
            Some(syntax::PROPERTY_ASSIGNMENT) => self.declared_field_type(parent, depth),
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => {
                if self.children(parent).first() != Some(&id) {
                    return None;
                }
                self.contextual_type(parent, depth + 1)
            }
            // Grouping and assertions carry the context through unchanged.
            //
            // **A conditional was in this list and is not any more.** It is not
            // grouping: `cond ? a : b` has a type of its own, the union of its
            // arms, and skipping straight to the *parent's* context threw that
            // away. `(false ? true : null) !== null` then asked the comparison,
            // whose other side is `null`, which has no representation -- so the
            // arm was refused for standing in for something that is not a
            // reference while the node one level up said exactly what it was.
            // Its own arm is above, beside `||` and `??`, which is the company
            // it belongs in: an operator that picks one side and names no type.
            Some(
                syntax::PARENTHESIZED_EXPRESSION
                | syntax::AS_EXPRESSION
                | syntax::SATISFIES_EXPRESSION,
            ) => self.contextual_type(parent, depth + 1),
            _ => None,
        }
    }

    /// The slot an array or tuple literal supplies, also available to the
    /// literal-method collector before any allocation is lowered.
    fn contextual_array_element(&self, id: NodeId, array: NodeId, depth: u32) -> Option<HirType> {
        let ty = self
            .contextual_type(array, depth + 1)
            .or_else(|| self.type_of(array))?;
        match ty {
            HirType::Managed(ManagedType::Array(element)) => Some(*element),
            HirType::Managed(ManagedType::Object(tuple)) => {
                let at = self.children(array).iter().position(|child| *child == id)?;
                let positions = self.fixed_arity_positions(tuple)?;
                self.represent_passed(*positions.get(at)?)
            }
            _ => None,
        }
    }

    /// A comparison against an absent literal whose answer is in the *type*.
    ///
    /// A pointer carries one absence, so comparing it against the other absent
    /// literal is a question its representation cannot be asked -- the null
    /// pointer would answer yes to both.
    ///
    /// ```ts
    /// const v: string | null = ...;
    /// v === null        // the pointer test
    /// v === undefined   // false, whatever the pointer holds
    /// ```
    ///
    /// Strictly, because `v == undefined` is the loose question and a null
    /// answers it. Answered from the type, which still knows which absence it
    /// has even though the representation does not.
    ///
    /// A type carrying *no* absence answers both operators the same way, and
    /// `==` no less than `===`: abstract equality returns false as soon as one
    /// side is absent and the other is not, before any conversion. `v == null`
    /// on a `number` needs no `ToPrimitive` and never did -- it was refused
    /// only because lowering the `null` came first and a double has nowhere to
    /// put one. Thirty-two sites in the profile, and `x == null` is how
    /// TypeScript spells the nullish check.
    ///
    /// `None` leaves it to the caller: a pointer asked about the absence it
    /// does carry is a real test and not a constant.
    /// The type of the value a name is bound to, where the checker's type for
    /// it has no representation of its own -- `NSObject | undefined` is held
    /// as the pointer whose null is the `undefined`.
    pub(super) fn bound_type(&self, node: NodeId) -> Option<HirType> {
        if self.kind_of(node) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let symbol = self.node(node).symbol?;
        self.bindings
            .get(&symbol.0)
            .map(|value| self.values[value.0 as usize].ty.clone())
            .or_else(|| {
                // A global read uses its declared storage representation too.
                // In particular, `null | undefined` has no pointer type, but
                // the global's tagged slot distinguishes both absences.
                let symbol = self.denoted_symbol(symbol);
                let global = self.module.variables.get(&symbol.0)?;
                self.module.types.get(*global as usize).cloned()
            })
    }

    /// Whether a node's type is an absence and nothing else.
    ///
    /// `undefined` on its own, or `null` on its own -- what the checker leaves
    /// a binding at once it has seen the assignment that set it. Distinct from
    /// [`Self::absences_of`] being non-empty, which only says the type *admits*
    /// one beside something real.
    pub(super) fn only_absences(&self, node: NodeId) -> bool {
        self.read_type(node)
            .is_some_and(|ty| self.holds_only_absences(ty))
    }

    /// The type of what a read at `node` can produce, for the questions that
    /// ask whether it is absent: the checker's type, except for a read
    /// through a getter.
    ///
    /// **A getter answers what it answers, whatever was assigned.** The checker
    /// narrows a property by assignment -- after `div.nodeValue = "x"`,
    /// `div.nodeValue` is `string` -- which is sound for a field and not for a
    /// getter: an element's `nodeValue` is null whatever is assigned. Asked of
    /// the narrowed type, `"" + div.nodeValue` built no `null` arm and handed
    /// the NULL the getter returned to `nts_concat` -- a SEGV in the browser,
    /// the Chromium lane's compiler request 9. A read through a native
    /// `@ntsGet` or a `get` accessor is the property's type as the receiver's
    /// type declares it.
    pub(super) fn read_type(&self, node: NodeId) -> Option<TypeId> {
        if self.kind_of(node) == Some(syntax::IDENTIFIER)
            && let Some(declaration) = self
                .node(node)
                .symbol
                .and_then(|symbol| self.parameter_body_functions.get(&symbol.0))
        {
            return self.snapshot.node_types.get(declaration).copied();
        }
        if let Some(read) = self.actual_field_read(node) {
            return read.schema();
        }
        let narrowed = self.snapshot.node_types.get(&node).copied();
        if self.kind_of(node) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return narrowed;
        }
        let [object, member] = self.children(node)[..] else {
            return narrowed;
        };
        let getter = self.is_accessor_property(member)
            || self
                .accessor_nodes(member)
                .iter()
                .any(|decl| self.kind_of(*decl) == Some(syntax::GET_ACCESSOR));
        if !getter {
            return narrowed;
        }
        let declared = (|| {
            let receiver = *self.snapshot.node_types.get(&object)?;
            let receiver = self.present_part(receiver).unwrap_or(receiver);
            let key = self.property_key(member)?;
            Some(interfaces::property(self.snapshot, self.class_behind(receiver), &key)?.ty)
        })();
        declared.or(narrowed)
    }
}
