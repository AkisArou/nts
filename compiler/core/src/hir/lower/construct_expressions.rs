//! Dispatch new and super expressions and emit ordinary class constructor calls and instance field initialization.

use super::{
    Callee, DeclarationModifiers, Diagnostic, FuncBuilder, HirType, Layout, ManagedType, MemberKey,
    NodeId, OpKind, PRESENCE_INDEX, Place, TypeId, TypeKind, ValueId, class_symbol,
    declares_a_class, is_static_member, provided, syntax,
};

/// The member key a constructor is known by.
///
/// A constructor has no `IDENTIFIER` child -- `constructor` is a keyword -- so
/// every place that names a member from its children has to special-case it,
/// and the two that must agree are [`FuncBuilder::member_key`], which decides
/// whether a signature is an overload of one, and the emitted name
/// `format!("{owner}#constructor")` that a call is built against. A third
/// spelling in `qualified_name` names the same member in a diagnostic.
///
/// `"constructor"` also appears in this file as a *JavaScript property name* --
/// `"constructor" in x`, beside `hasOwnProperty` -- and that is a different
/// concept that happens to share the text. It is deliberately not this.
pub(super) const CONSTRUCTOR_KEY: &str = "constructor";

impl FuncBuilder<'_> {
    pub(super) fn store_parameter_properties(
        &mut self,
        declared: &[(NodeId, u32)],
    ) -> Result<(), Diagnostic> {
        for (child, index) in declared.iter().copied() {
            let name = self
                .name_node(child)
                .and_then(|node| self.literal_name(node))
                .ok_or_else(|| {
                    self.unsupported(child, "a parameter property whose name is not a literal")
                })?;
            let receiver = self
                .this
                .ok_or_else(|| self.unsupported(child, "a parameter property outside a class"))?;
            // An instance of a class over an Objective-C class: the field is
            // in the object its ivar holds.
            if matches!(
                self.values[receiver.0 as usize].ty,
                HirType::NativePointer(_)
            ) {
                self.store_objc_parameter_property(child, index, receiver, &name)?;
                continue;
            }
            let HirType::Managed(ManagedType::Object(owner)) =
                self.values[receiver.0 as usize].ty.clone()
            else {
                return Err(
                    self.unsupported(child, "a parameter property on a receiver with no layout")
                );
            };
            let layout = self.layout_of(child, owner)?;
            let field = layout
                .index_of(&name)
                .ok_or_else(|| self.absent_member(child, owner, &name))?;
            let value = self
                .values
                .iter()
                .position(|op| matches!(op.kind, OpKind::Param(at) if at == index))
                .map(|at| ValueId(u32::try_from(at).unwrap_or(0)))
                .ok_or_else(|| self.unsupported(child, "a parameter property with no parameter"))?;
            // **A parameter property declares two names for one value**, and
            // only one of them was bound. TypeScript gives the property its own
            // symbol and the parameter another; the *name node* carries the
            // property's, which `lower_param` binds, while a bare `base` in the
            // constructor body resolves to the **parameter's** and found
            // nothing. It was refused as ``base`, a name from an enclosing
            // scope`` -- a sentence about a scope, for a name declared three
            // tokens earlier in this one.
            //
            // The parameter's symbol is not on any node: the PARAMETER node
            // itself carries none, and the symbol is found by looking for the
            // one whose *declarations* name it. That is a scan, and it is over
            // the symbols of one program rather than per reference -- a
            // parameter property is a handful per class.
            //
            // `this.base` always worked, which is what kept this narrow enough
            // to go unnoticed: the field half was never the broken one.
            let property = self
                .name_node(child)
                .and_then(|node| self.node(node).symbol);
            if let Some(parameter) = self.symbol_declared_by(child, property.map(|s| s.0)) {
                self.bindings.insert(parameter, value);
            }
            let want = layout.fields[field as usize].ty.clone();
            let value = self.coerce(value, &want, child)?;
            let origin = self.origin(child);
            self.field_set(receiver, field, value, &origin);
        }
        Ok(())
    }

    /// `store_parameter_properties` for an instance of a class the program
    /// writes over an Objective-C class: the parameter's value, bound under
    /// the parameter's own symbol too, set in the field of the object the
    /// instance's ivar holds.
    fn store_objc_parameter_property(
        &mut self,
        child: NodeId,
        index: u32,
        receiver: ValueId,
        name: &str,
    ) -> Result<(), Diagnostic> {
        let value = self
            .values
            .iter()
            .position(|op| matches!(op.kind, OpKind::Param(at) if at == index))
            .map(|at| ValueId(u32::try_from(at).unwrap_or(0)))
            .ok_or_else(|| self.unsupported(child, "a parameter property with no parameter"))?;
        let property = self
            .name_node(child)
            .and_then(|node| self.node(node).symbol);
        if let Some(parameter) = self.symbol_declared_by(child, property.map(|s| s.0)) {
            self.bindings.insert(parameter, value);
        }
        let Some(Place::Field { object, field }) =
            self.program_objc_instance_place(child, receiver, name)?
        else {
            return Err(self.unsupported(
                child,
                "a parameter property with no field in its Objective-C instance",
            ));
        };
        let HirType::Managed(ManagedType::Object(state)) =
            self.values[object.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(
                child,
                "a parameter property of an Objective-C instance with no fields",
            ));
        };
        let want = self.layout_of(child, state)?.fields[field as usize]
            .ty
            .clone();
        let value = self.coerce(value, &want, child)?;
        let origin = self.origin(child);
        self.field_set(object, field, value, &origin);
        Ok(())
    }

    /// Whether a class declares instance fields: a property that is not
    /// `static`, or a constructor parameter that is one too.
    pub(super) fn declares_instance_fields(&self, class: NodeId) -> bool {
        self.children(class)
            .into_iter()
            .any(|member| match self.kind_of(member) {
                Some(syntax::PROPERTY_DECLARATION) => !is_static_member(self.snapshot, member),
                Some(syntax::CONSTRUCTOR) => self.children(member).into_iter().any(|child| {
                    self.kind_of(child) == Some(syntax::PARAMETER) && self.declares_a_field(child)
                }),
                _ => false,
            })
    }

    /// Whether a parameter also declares a field.
    ///
    /// `constructor(private x: number)` is two things wearing one syntax: a
    /// parameter, and a member of the class initialised from it. TypeScript
    /// permits the modifier nowhere else, and the checker already reports the
    /// member -- so the layout has the field and what was missing was the
    /// store.
    pub(super) fn declares_a_field(&self, id: NodeId) -> bool {
        let modifiers = self.node(id).modifiers;
        [
            DeclarationModifiers::PRIVATE,
            DeclarationModifiers::PROTECTED,
            DeclarationModifiers::PUBLIC,
            DeclarationModifiers::READONLY,
        ]
        .into_iter()
        .any(|flag| modifiers.contains(flag))
    }

    /// The field initializers a construction runs.
    ///
    /// `class Counter { value: number = 5 }` has no constructor, and the
    /// allocation is zeroed -- so `new Counter().value` read `0`. Silently: a
    /// zeroed field and an initialized one are the same bytes whenever the
    /// initializer happens to be the zero value, which is why the only field
    /// initializer in the whole example corpus (`code: string = ""`) never
    /// disagreed with node and this survived.
    ///
    /// Base first, because a derived class's initializer may overwrite an
    /// inherited field and the source order says which wins.
    ///
    /// # Where this is not yet node's order
    ///
    /// Node runs a derived class's initializers *after* `super()` returns.
    /// These run before the constructor is entered at all, so a base
    /// constructor that calls an overridden method which reads a derived field
    /// sees the initialized value where node sees `undefined`. That is a real
    /// difference and a narrow one; the shape it needs is a base constructor
    /// calling a virtual method, which this compiler does not lower yet.
    /// Set the presence bits for the optional fields a class *declares*.
    ///
    /// One store rather than one per field: the set is known at compile time, so
    /// it is a constant mask and `nts_presence_init` is a single `or` into a
    /// word the allocation just wrote. Nothing is emitted at all when the mask
    /// is empty, which is every class with no optional field -- and every frame,
    /// cell and closure environment, none of which come through here.
    ///
    /// `declare` and `abstract` members are excluded because they define
    /// nothing; see [`Self::defined_at_construction`].
    fn initialize_presence(&mut self, at: NodeId, object: ValueId, ty: TypeId, layout: &Layout) {
        let Some(properties) = self
            .snapshot
            .types
            .get(crate::hir::generics::concrete(self.snapshot, ty).0 as usize)
            .and_then(|record| match &record.kind {
                TypeKind::Object { properties } => Some(properties.clone()),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                TypeKind::NonPrimitive | TypeKind::UniqueSymbol => None,
                _ => None,
            })
        else {
            return;
        };
        let mut mask = 0u32;
        for property in &properties {
            // **Own properties only.** This runs inside each class's own
            // constructor now, so a base's optional fields are that base's
            // constructor's to record -- and it runs for every class in the
            // chain, so the union is unchanged. Taking the flattened list here
            // would have each constructor set its ancestors' bits as well,
            // which is harmless and is also three classes writing one word for
            // no reason.
            if !property.own
                || !property.optional
                || !self.defined_at_construction(property)
                || !property
                    .name
                    .public_name()
                    .is_some_and(|name| self.presence_keys.contains(name))
            {
                continue;
            }
            if let crate::hir::presence::Presence::Bit(bit) = crate::hir::presence::of(
                layout,
                |candidate| {
                    properties
                        .iter()
                        .any(|other| other.name == *candidate && other.optional)
                },
                &property.name,
            ) {
                mask |= 1u32 << bit;
            }
        }
        if mask == 0 {
            return;
        }
        let origin = self.origin(at);
        let value = self.push(
            OpKind::ConstInt(i128::from(mask)),
            PRESENCE_INDEX,
            origin.clone(),
        );
        self.call_runtime(
            "nts_presence_init",
            vec![object, value],
            HirType::Void,
            &origin,
        );
    }

    /// Every class from `type_id` up to the root, base-first.
    ///
    /// The order construction runs in, and the order a layout lays its fields
    /// out in -- which is why an index taken against one class's layout is
    /// valid against any subclass's.
    fn construction_chain(&self, type_id: TypeId) -> Vec<TypeId> {
        let mut chain = vec![type_id];
        let mut ty = type_id;
        while let Some(base) = self.snapshot.base_types.get(&ty).and_then(|b| b.first()) {
            if chain.contains(base) {
                break;
            }
            chain.push(*base);
            ty = *base;
        }
        chain.reverse();
        chain
    }

    /// Run the field initialisers `classes` declare, against an object of
    /// `type_id`.
    ///
    /// **Which classes is the caller's,** because where they run is not one
    /// answer. JavaScript runs a class's field initialisers inside its own
    /// constructor, immediately after `super()` returns -- so
    /// `class D extends B { y = this.x + 10 }` sees the `x` that `B`'s
    /// constructor wrote. Emitting the whole chain at the allocation site
    /// instead ran every initialiser before any constructor, and `y` read a
    /// field nobody had written yet: **28 of 29 cases against node**, answering
    /// `nan`.
    ///
    /// So a class that declares a constructor initialises its own fields in it,
    /// and the allocation site is left with the classes *below* the one whose
    /// constructor it calls -- those declare none of their own, so nothing else
    /// will run them, and after the call is where the language puts them.
    fn initialize_fields(
        &mut self,
        at: NodeId,
        object: ValueId,
        type_id: TypeId,
        classes: &[TypeId],
    ) -> Result<(), Diagnostic> {
        let layout = self.layout_of(at, type_id)?;
        // **Under the instance's substitution.** The initialisers are the
        // class's, written in terms of `T`, and this runs at the `new` site in
        // the caller's builder: `head: Link<T> | null = null` in
        // `List<number>` read `Link<T>` as the *form* here, while the slot it
        // fills is `Link<number>` -- a `Link` where a `Link` is wanted. The
        // copy's own methods read `T` through their substitution; the
        // initialisers get the same one for as long as they are lowered.
        let outer = self
            .class_instances
            .get(&type_id)
            .cloned()
            .map(|substitution| std::mem::replace(&mut self.substitution, substitution));
        let result = self.initialize_declared_fields(at, object, classes, &layout);
        if let Some(outer) = outer {
            self.substitution = outer;
        }
        result
    }

    pub(super) fn initialize_declared_fields(
        &mut self,
        at: NodeId,
        object: ValueId,
        classes: &[TypeId],
        layout: &Layout,
    ) -> Result<(), Diagnostic> {
        for &class in classes {
            // The presence bits this class's *declarations* set, in one store,
            // before its initialisers run. A field declaration defines its
            // property even with no initialiser -- ES2022 class-field
            // semantics, and the reason `"maybe" in new Box()` is true -- so
            // this records writes that happened rather than exempting the
            // question. An initialiser sets its own bit through `field_set`,
            // and setting a bit twice is setting it once.
            self.initialize_presence(at, object, class, layout);
            let Some(declaration) = self
                .snapshot
                .types
                .get(class.0 as usize)
                .and_then(|record| record.symbol)
                .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
                .and_then(|record| record.declarations.first().copied())
            else {
                continue;
            };
            for member in self.children(declaration) {
                if self.kind_of(member) != Some(syntax::PROPERTY_DECLARATION) {
                    continue;
                }
                // Slots rather than positions: a property declaration is
                // `modifiers, name, ?/!, type, initializer`, and which of them
                // are present is recorded in the node's `present` bitmask. A
                // first version took the *last* child and checked it had a
                // type, which matched the type annotation of `name: number;`
                // and lowered `number` as an expression -- six functions in
                // `tests/programs/inheritance` vanished, and the refusal landed in
                // the anonymous bucket that had just been emptied.
                let Some([_, Some(name), _, _, initializer]) = self.child_slots::<5>(member) else {
                    continue;
                };
                let Some(initializer) = initializer else {
                    continue;
                };
                // **`literal_name`, not `.text`.** A quoted or numeric property
                // name carries no text on its node -- the decoder does not put
                // one there -- so this skipped it with a `continue` and the
                // field was never initialized. `{ "a b": 1, "x+y": 2,
                // ordinary: 3 }` wrote only `ordinary`, and `use` returned
                // `3 + n` where node returns `6 + n`.
                //
                // A silent wrong answer, and it was masked: the C emitter
                // refused a layout holding a name it could not spell, so the
                // whole program was refused before anything could observe the
                // missing stores. Escaping the name -- which is right, and
                // which `http`'s `{ 100: "Continue" }` needs -- removed the
                // mask and the defect underneath was two `continue`s.
                // **The third spelling of one member name.** A quoted name and
                // a numeric one carry no `text` and are resolved by
                // `literal_name`; a *computed* one -- `[kTag] = 7` -- is not a
                // literal at all, and the layout holds it under the generated
                // `__@kTag@2` that `symbol_member_name` produces.
                //
                // Each of the three was skipped here by a `continue`, and each
                // skip is a field that keeps its zero while every read of it
                // answers. `class Keyed { [kTag] = 7 }` answered **0** where
                // node answers 7, with nothing refused and nothing emitted --
                // found by an example written for something else entirely.
                let Some(text) = self.property_key(name) else {
                    continue;
                };
                // **By declaring class, not by name.** A field initializer runs
                // where the object is *allocated*, so a base's `#count = 0`
                // executes against the derived layout -- where `#count` names
                // the derived's field, because a `#` name is per class and both
                // are there. Both initializers wrote one offset and the other
                // stayed zero.
                //
                // `index_of` is the fallback for every field that is not a
                // shadowed private one, which is all of them but this.
                let Some(field) = layout
                    .index_of_declared(&text, class)
                    .or_else(|| layout.index_of_key(&text))
                else {
                    continue;
                };
                // **`this` is the object being constructed.**
                //
                // A field initializer is lowered here, at the allocation site,
                // rather than in a constructor -- so `self.this` holds whatever
                // receiver the *enclosing* function had, which for `new
                // Readable()` written in a free function is nothing at all. An
                // initializer that captures `this` was therefore refused with
                // "`this` outside a method", a sentence about the source that is
                // false: the initializer is inside a class body and its `this`
                // is the instance, which is `object`, which is in hand.
                //
                // Saved and restored rather than set, because a `new` can be
                // written inside a method and the receiver has to come back.
                //
                // This is what stood behind the per-instance method idiom --
                // `this._read = options.read`, the extension mechanism of all
                // four stream classes -- because the field that idiom needs
                // holds an arrow, and an arrow in a class body captures `this`
                // almost always.
                // At the field's type, like every other slot. `xs: Opts[] =
                // [{ a: 1 }]` built the literal at its own element type and met
                // a conversion one line down that it never had to make; the
                // want is already in hand here, and was being used only to
                // coerce afterwards.
                if self.initializing_fields.contains(&initializer) {
                    return Err(self.unsupported(
                        initializer,
                        "a class field initializer that recursively initializes itself",
                    ));
                }
                let want = layout.fields[field as usize].ty.clone();
                self.initializing_fields.push(initializer);
                let outer = self.this.replace(object);
                let value = self.lower_expecting(initializer, &want);
                self.this = outer;
                self.initializing_fields.pop();
                let value = value?;
                // The layouts the field's own type needs, which used to be
                // somebody else's doing. An initialiser was lowered at the
                // allocation site, so a `Map<Conn, Entry>` built there got its
                // key and value layouts from the function that wrote `new`;
                // lowered inside the constructor it is the first mention of
                // them anywhere, and the backend refused `an object type with
                // no layout: type 4706`. One root, six cascaded functions, and
                // `module#init` among them -- which is an addon that builds and
                // does not load.
                //
                // Through containers rather than through fields, which is what
                // `materialize` already walks: demanding a layout per field type
                // refused 81 functions for holding a `Map` they never touch.
                self.materialize(initializer, &want)?;
                let value = self.coerce(value, &want, initializer)?;
                let origin = self.origin(initializer);
                self.field_set(object, field, value, &origin);
            }
        }
        Ok(())
    }

    /// Which classes' field initialisers the allocation site has to run.
    ///
    /// The ones no constructor will. A class that declares a constructor
    /// initialises its own fields inside it -- at the top when it has no base,
    /// after `super()` when it has one -- so what is left is the classes
    /// *below* the one whose constructor is called. Those declare none of their
    /// own, and they go **after** the call, because an implicit constructor is
    /// `super(...args)` followed by this class's initialisers.
    ///
    /// Base-first, which is the order they run in.
    fn initialisers_this_site_owes(&self, type_id: TypeId) -> Vec<TypeId> {
        let chain = self.construction_chain(type_id);
        let Some(declaring) = self.hierarchy.constructor(type_id) else {
            // Nothing in the chain declares one, so no constructor runs at all
            // and every class's initialisers are this site's.
            return chain;
        };
        let mut owed: Vec<TypeId> = chain
            .iter()
            .rev()
            .take_while(|class| **class != declaring)
            .copied()
            .collect();
        owed.reverse();
        owed
    }

    pub(super) fn lower_new(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let callee = *children
            .first()
            .ok_or_else(|| self.unsupported(id, "a `new` with no callee"))?;
        // **A bound Java class is constructed on the other side, and this has
        // to come before the name is required.** Everything below -- the
        // layout, the allocation, the constructor call -- describes building an
        // object of ours. A foreign class has none of it: `layout_of` would
        // emit a stub that then *shadows the real class on the classpath*, and
        // `ObjectNew` would allocate a second object the `<init>` never
        // touches.
        //
        // Above the `text` read, because `new Catalog.Entry("k")` names its
        // class with a property access and a property access has no text -- so
        // a nested bound class was refused as "a computed constructor" when the
        // binding table can name it exactly. The table is keyed by the
        // declaration the checker resolved to, not by how the call site spelled
        // it, which is the whole reason that key was chosen.
        if let Some(bound) = self
            .snapshot
            .call_targets
            .get(&id)
            .and_then(|it| it.callee)
            .filter(|declaration| self.references_the_class_of(callee, *declaration))
            .map(|declaration| self.location(declaration))
            .and_then(|at| self.foreign.get(&(at.file.0, at.span.end)))
            .map(|row| row.key.clone())
            // **The class being constructed must itself be bound, not merely
            // inherit a bound constructor.** `class Panel extends View` is
            // ours and `View` is the jar's, so overload resolution hands back
            // `View.<init>` -- which has a row, and taking it emitted `new
            // com/example/ui/View` for `new Panel()`. A `Panel` field then held
            // a `View` and the class did not load.
            //
            // Asked of the constructed *type* rather than of the resolved
            // declaration, because the declaration is the base's in exactly
            // the case that must not take this path.
            .filter(|_| {
                self.type_of(id)
                    .and_then(|ty| match self.widened(id, ty) {
                        HirType::Managed(ManagedType::Object(id)) => Some(id),
                        _ => None,
                    })
                    .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
                    .is_some_and(|record| self.foreign_owner(record).is_some())
            })
        {
            let ty = self.type_of(id);
            let ty = self.widened(id, ty.ok_or_else(|| self.unrepresentable(id, "a `new`"))?);
            let arguments = self.arguments_of(id);
            let args = self.lower_arguments(id, &arguments)?;
            let origin = self.origin(id);
            return Ok(self.push(
                OpKind::Call {
                    callee: Callee::External(bound),
                    args,
                    frame: None,
                },
                ty,
                origin,
            ));
        }
        if let Some(construction) = self.lower_referenced_construction(id, callee) {
            return construction;
        }

        let class = self
            .node(callee)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
            .ok_or_else(|| self.unsupported(callee, "a computed constructor"))?;

        // **Before the provided-error path, not after it.**
        //
        // This check has been here since `a-new-through-a-class-value` landed
        // and it sat *below* `lower_new_provided`, so a provided error class
        // reached through a value never met it:
        //
        //     const C = (n & 1) === 0 ? TypeError : RangeError;
        //     new C("x").name.length        // node 9 for a TypeError, this 10
        //
        // 13 of 87 cases disagreed on C *and* LLVM. The class comes from
        // `type_of(id)` -- the type of the `new` expression -- which the checker
        // gives as a union and `widened` turns into one arm, and the other is
        // built as it. A user class was refused for exactly this a day earlier;
        // the provided ones have no constructor to call, so they took a
        // different route to the same gap and arrived below the guard.
        //
        // The ledger row reads "comparison agrees on C and LLVM ... so checking
        // those two reads as the feature working", and it does:
        // `tests/programs/a-class-stored-and-compared` binds, returns and compares
        // tokens and never calls `new` on one. Token comparison works. What
        // shares the row with it does not.
        self.constructed_from_a_value(id, callee, &class)?;

        let arguments = self.arguments_of(id);
        if self.references_what_it_builds(callee, id)
            && let Some(constructor) = self.delegated_constructor(id, &arguments)
        {
            return self.lower_delegated_construction(id, constructor, &arguments);
        }
        // Nothing the callee references is a constructor this compiler knows,
        // so the site's type says only why: not an object, a body nothing
        // wrote, or a class reached through a value whose reference does not
        // name its constructor.
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `new`"))?;
        let HirType::Managed(ManagedType::Object(type_id)) = self.widened(id, ty) else {
            return Err(self.unsupported(id, "a `new` that does not produce an object"));
        };
        self.require_an_implemented_constructor(id, type_id)?;
        Err(self.unsupported(
            id,
            &format!("a `new` through `{class}`, which does not name the constructor it holds"),
        ))
    }

    /// Allocate a class instance and run what constructs it.
    pub(super) fn lower_new_object(
        &mut self,
        id: NodeId,
        ty: HirType,
        type_id: TypeId,
        callee: NodeId,
        class: String,
    ) -> Result<ValueId, Diagnostic> {
        // Laying the class out here is what makes its fields addressable; the
        // constructor is about to write every one of them.
        self.layout_of(id, type_id)?;

        let origin = self.origin(id);
        let object = self.push(OpKind::ObjectNew { frame: false }, ty, origin);

        let owed = self.initialisers_this_site_owes(type_id);

        self.run_the_constructor(id, object, type_id, callee, class, &owed)
    }

    /// Whether a `new` producing `type_id` has something to run: a class the program
    /// implements, or an `Error` this compiler builds.
    ///
    /// **Not every object type a `new` can produce.** `declare class Missing { value:
    /// number }` and `declare const Missing: { new(): { value: number } }` both
    /// typecheck at `new Missing()`, and neither has a body anywhere. Both compiled
    /// to an object no constructor wrote -- a stack frame whose `value` was never
    /// stored -- and answered with it, where node throws a `ReferenceError` because
    /// `Missing` does not exist. Re-derived from Codex 1218798d5.
    pub(super) fn require_an_implemented_constructor(
        &self,
        id: NodeId,
        type_id: TypeId,
    ) -> Result<(), Diagnostic> {
        // **Not "a type the hierarchy knows".** That holds interfaces too:
        // `declare const TextEncoder: { new (): StreamTextEncoder }` constructs an
        // interface no constructor writes, and dispatch then runs web-platform's
        // `encode` -- which implements it structurally -- on that unwritten object.
        let implemented = if let Some(symbol) = class_symbol(self.snapshot, type_id) {
            self.an_implemented_class(symbol)
        } else {
            provided(self.snapshot, type_id).is_some_and(crate::hir::builtin::is_error)
                || self.provided_error_base(type_id).is_some()
        };
        if implemented {
            return Ok(());
        }
        Err(self.unsupported(
            id,
            "a `new` of something this program declares but does not implement: a \
             `declare class`, or a value typed with a construct signature",
        ))
    }

    /// Whether some declaration of this class symbol is a body the program wrote:
    /// not `declare`d, not bound to native code, not in a declaration file.
    pub(super) fn an_implemented_class(&self, symbol: u32) -> bool {
        self.snapshot
            .symbols
            .get(symbol as usize)
            .is_some_and(|record| {
                record.declarations.iter().any(|declaration| {
                    let node = self.node(*declaration);
                    self.kind_of(*declaration).is_some_and(declares_a_class)
                        && node.native.is_none()
                        && !node
                            .modifiers
                            .contains(nts_semantic_schema::DeclarationModifiers::DECLARE)
                        && !self
                            .snapshot
                            .sources
                            .get(node.origin.location.file.0 as usize)
                            .is_some_and(|source| {
                                [".d.ts", ".d.mts", ".d.cts"]
                                    .iter()
                                    .any(|suffix| source.uri.as_str().ends_with(suffix))
                            })
                })
            })
    }

    /// Call the constructor that runs for this type, and then the field
    /// initialisers no constructor owns.
    ///
    /// Split out of [`Self::lower_new`] because it is where the construction
    /// stops being uniform: everything above it is true of any class a token
    /// could hold, and everything in it names a declared constructor.
    fn run_the_constructor(
        &mut self,
        id: NodeId,
        object: ValueId,
        type_id: TypeId,
        callee: NodeId,
        class: String,
        owed: &[TypeId],
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        // The nearest declared constructor, which may be a base's: a class
        // that declares none has an implicit one that forwards, and forwarding
        // to it directly is the same call with one frame fewer. A class with no
        // constructor anywhere in its chain has only its field initializers to
        // run, which the line above emitted.
        let arguments = self.arguments_of(id);
        let Some(declaring) = self.hierarchy.constructor(type_id) else {
            // A provided error class, or one descending from one and declaring
            // no constructor of its own. There is no function to call: this
            // compiler is the constructor, and it is emitted inline.
            let provided = provided(self.snapshot, type_id)
                .filter(|name| crate::hir::builtin::is_error(name))
                .map(str::to_owned)
                .or_else(|| self.provided_error_base(type_id));
            if let Some(provided) = provided {
                self.initialize_error(id, object, &provided, &arguments)?;
                // **And then this site's own declarations**, which the sibling
                // below already says it owes: "nothing runs but this, so this
                // site owes the whole chain". A provided error is built inline
                // rather than by a constructor, so a class descending from one
                // and declaring none of its own has no function anywhere that
                // would run its field initialisers -- and this arm used to
                // return before reaching them.
                //
                // `class Coded extends Error { code = 5 }` read `code` as **0**
                // where node reads 5, and `"code" in new Coded("b")` was false
                // where node says true: not one defect about presence but the
                // declarations never running at all. An explicit constructor hid
                // it, because then `hierarchy.constructor` answers the subclass
                // and the ordinary path runs.
                //
                // After the inline construction, because that is where the
                // language puts a subclass's field initialisers: `super(...)`
                // first, then its own.
                self.initialize_fields(id, object, type_id, owed)?;
                return Ok(object);
            }
            if !arguments.is_empty() {
                return Err(self.unsupported(id, "a `new` with arguments and no constructor"));
            }
            // Nothing runs but this, so this site owes the whole chain.
            self.initialize_fields(id, object, type_id, owed)?;
            return Ok(object);
        };
        // Past this point the construction is **class-specific**: a declared
        // constructor is about to be named from the type the checker gave the
        // expression. Everything above is uniform across the classes a token
        // could hold -- a provided error is built inline by this compiler, and a
        // class with no constructor anywhere in its chain has only the field
        // initializers that already ran -- which is why `class-as-value` can
        // construct through a token whose class `extends Error` and be right.
        // The same qualification the *definition* side already applies.
        // `class_name_for` names a member `Frame@a#constructor` whenever the
        // class name is declared in more than one file -- its own comment says
        // why, because `dgram` and `net` both export a `Socket`. This named the
        // callee from the **source text of the identifier**, which is `Frame`,
        // so the call matched no function at all and `drop_callers_of_refused`
        // dropped the caller as calling something refused. Nothing was refused.
        //
        // Only where the class written at `new` is the one declaring the
        // constructor. Where it is inherited the definition is named for the
        // base, and this identifier is the derived class: qualifying by it
        // would swap one wrong name for another.
        let owner = Some(declaring)
            .filter(|declaring| *declaring == type_id)
            .and_then(|_| self.qualified_class_name(callee))
            .or_else(|| self.hierarchy.name.get(&declaring).cloned())
            .unwrap_or(class);

        let mut args = vec![object];
        args.extend(self.lower_arguments_on(id, &arguments, object)?);
        // **A TypeScript class extending a bound Java one.** `class Panel
        // extends View` allocates a `Panel` -- ours, and a real subclass of
        // `com/example/ui/View` -- and then has to run the *jar's* constructor
        // on it. Naming `View#constructor` names a function of ours that does
        // not exist, because a bound member contributes none.
        //
        // Receiver first, which is the shape the backend already has for every
        // other bound instance call. It is told apart from constructing a
        // bound class by arity: there `args` is exactly the descriptor's
        // parameters, here it is those plus the object.
        // **A bound base's constructor has already run.** `class Panel extends
        // View` emits `nts/gen/Panel extends com/example/ui/View`, and the
        // generated `<init>` chains to `View.<init>()V` the way javac would --
        // that is what makes the class load at all. So the `super()` the
        // TypeScript writes has nothing left to do, and emitting a call for it
        // was `invokespecial` on an already-initialised reference, which the
        // JVM rejects by name: "Bad operand type when invoking <init>".
        //
        // Arguments are the case this does not cover, and it says so rather
        // than dropping them: the generated `<init>` takes none, so there is
        // nowhere for `super(x)` to put one.
        let inherited = self
            .snapshot
            .call_targets
            .get(&id)
            .and_then(|it| it.callee)
            .map(|declaration| self.location(declaration))
            .and_then(|at| self.foreign.get(&(at.file.0, at.span.end)))
            .is_some();
        if inherited {
            if args.len() > 1 {
                return Err(self.unsupported(
                    id,
                    "a `super(...)` with arguments into a bound Java class, whose generated constructor takes none",
                ));
            }
            self.initialize_fields(id, object, type_id, owed)?;
            return Ok(object);
        }
        // **A `new` names its constructor directly, so its raising copy is reached by
        // naming it** -- exactly as a method's is where no subclass overrides it. The
        // sentence this boundary carried for a week, *"`new` names no function to
        // suffix"*, was false the whole time: the line below has always spelled
        // `{owner}#constructor`, and I repeated the claim in four commit messages
        // without reading it.
        //
        // The flag test goes *after* the call, where `lower_static_call` puts it. The
        // instance is already allocated -- `new` allocates, then calls -- so there is no
        // ordering problem to solve, which is the other half of what that sentence
        // asserted.
        let suffix = self.raising_suffix_of(id);
        let copy = self.constructed_copy(id);
        self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{owner}#constructor{copy}{suffix}")),
                args,
                frame: None,
            },
            HirType::Void,
            origin,
        );
        self.test_for_a_raise(id);
        // And the classes below it, which declare no constructor of their own.
        // After the call, because an implicit constructor is `super(...args)`
        // followed by this class's initialisers -- so they see what the
        // constructor wrote, which is the whole point.
        self.initialize_fields(id, object, type_id, owed)?;
        Ok(object)
    }

    /// `new Map`, `new Set` and `new Promise`, which the runtime builds.
    ///
    /// `None` when the type is a class, whose `new` is a call to a constructor
    /// the program declares.
    pub(super) fn lower_new_provided(
        &mut self,
        id: NodeId,
        ty: &HirType,
    ) -> Option<Result<ValueId, Diagnostic>> {
        match ty {
            HirType::Managed(ManagedType::Map(key, _) | ManagedType::Set(key)) => {
                let key = key.as_ref().clone();
                Some(self.lower_new_table(id, ty, &key))
            }
            HirType::Managed(ManagedType::Promise(payload)) => {
                let payload = payload.as_ref().clone();
                Some(self.lower_new_promise(id, ty, &payload))
            }
            HirType::Managed(ManagedType::Date) => Some(self.lower_new_date(id)),
            HirType::Managed(ManagedType::Buffer) => Some(self.lower_new_buffer(id)),
            HirType::Managed(ManagedType::DataView) => Some(self.lower_new_data_view(id)),
            _ => None,
        }
    }

    /// Whether a binding's initializer is a class expression, which is
    /// evaluated here: its static fields and blocks run, in order, as a class
    /// declaration's do where it stands.
    ///
    /// The binding holds nothing (see `lower_variable_statement`), and both
    /// sites that lower one -- a local and a module-scope declaration -- once
    /// skipped it, so nothing evaluated the class: `const E = class { static {
    /// bump(); } }` never called `bump`, silently.
    pub(super) fn evaluate_a_class_initializer(
        &mut self,
        initializer: Option<NodeId>,
    ) -> Result<bool, Diagnostic> {
        let Some(class) =
            initializer.filter(|node| self.kind_of(*node) == Some(syntax::CLASS_EXPRESSION))
        else {
            return Ok(false);
        };
        self.lower_static_fields(class)?;
        Ok(true)
    }

    /// A `static` member's `super`, which has no receiver to find a base type from.
    ///
    /// Static dispatch has no slot and nothing to override, so the base's name is the whole
    /// answer: a direct call, which is exactly what the source means. Writing `Base.make()`
    /// instead would say the same thing and stop saying it the moment the class is renamed,
    /// which is why the language has the word.
    ///
    /// Split out of [`Self::lower_super`] for that function's line limit, the reason
    /// [`Self::foreign_owner`] was split out of [`Self::layout_of`] -- and because "a
    /// `super` with no receiver" is its own question, answered before any of the base-type
    /// machinery below it runs.
    fn lower_static_super(
        &mut self,
        id: NodeId,
        base: &str,
        member: &str,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let args = self.lower_arguments(id, arguments)?;
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `super` call in a static member"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{base}.{member}")),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// A call into the base class, with `this` as the receiver.
    pub(super) fn lower_super(
        &mut self,
        id: NodeId,
        member: &str,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        // A constructor whose base makes the instance: `super(...)` is where
        // `this` comes from.
        if member == "constructor"
            && let Some(made_by) = self.made_by.clone()
        {
            return self.make_the_instance(id, &made_by, arguments);
        }
        if let Some(call) = self.gobject_super_call(id, member, arguments) {
            return call;
        }
        if let Some(call) = self.com_super_call(id, member, arguments) {
            return call;
        }
        let base = self
            .base
            .clone()
            .ok_or_else(|| self.unsupported(id, "`super` outside a derived class"))?;
        if self.this.is_none() {
            return self.lower_static_super(id, &base, member, arguments);
        }
        let receiver = self
            .this
            .ok_or_else(|| self.unsupported(id, "`super` outside a method"))?;

        // A superclass a binding declares, an Objective-C class: `[super m]`,
        // the message sent past this class's own implementation.
        if member != "constructor"
            && let Some(target) = self.snapshot.call_targets.get(&id).copied()
            && let Some(declaration) = target.callee
            && self.objc_class_member(declaration).is_some()
        {
            return self.lower_objc_super(id, receiver, (declaration, target.signature), arguments);
        }

        // A base that is a typed array. `Buffer extends Uint8Array` and
        // declares no storage, so `this` inside `Buffer#fill` is already a
        // `view<u8>` -- and there is no compiled `Uint8Array#fill` for the name
        // built below to find, nor will there ever be: the method is the
        // runtime's.
        //
        // `subarray` was already implemented and `Buffer#subarray` still
        // refused, which is what says this is about the *spelling* of the call
        // rather than the method. Three of `buffer`'s methods stopped here, and
        // behind them `Buffer.alloc`, and behind that
        // `StringDecoder#constructor` and a module with no exports at all.
        //
        // Before the name is built rather than after, so a base class that
        // happens to share a method name with the runtime's cannot be shadowed:
        // if the receiver is a view, the base *is* the typed array.
        if matches!(
            self.values[receiver.0 as usize].ty,
            HirType::Managed(ManagedType::View(_))
        ) && member != "constructor"
        {
            return self.lower_view_builtin(id, receiver, member, arguments);
        }

        // Which class above this one actually has the thing being called. Not
        // necessarily the immediate base: a method declared on a grandparent
        // and inherited through the parent is the grandparent's function, and a
        // constructor a base does not declare is one further up still.
        let above = match self.values[receiver.0 as usize].ty {
            HirType::Managed(ManagedType::Object(ty)) => self.hierarchy.base.get(&ty).copied(),
            _ => None,
        };
        let declaring = above.and_then(|base| {
            if member == "constructor" {
                self.hierarchy.constructor(base)
            } else {
                self.hierarchy.declaring(base, &MemberKey::named(member))
            }
        });
        let base = match declaring.and_then(|ty| self.hierarchy.name.get(&ty)) {
            Some(name) => name.clone(),
            // Nothing above *declares* it, which is not the same as nothing
            // above having anything to run. The receiver stands in as the
            // expression's value, which no `super()` statement looks at.
            //
            // Except when the base is a class this compiler *provides*: there
            // the constructor exists and is emitted inline. Before that it fell
            // through here and did nothing, so the message a subclass passed up
            // was silently dropped.
            None if member == "constructor" => {
                let provided = match self.values[receiver.0 as usize].ty {
                    HirType::Managed(ManagedType::Object(ty)) => self.provided_error_base(ty),
                    _ => None,
                };
                if let Some(provided) = provided {
                    self.initialize_error(id, receiver, &provided, arguments)?;
                }
                // **A base with no constructor still has field initialisers,
                // and they are what `super()` was supposed to run.** The
                // comment here used to say "a base class with only methods has
                // none, and `super()` in a derived one has nothing to run",
                // which is true of a base with only methods and false of every
                // base whose fields have defaults:
                //
                //     class Base { tag = 1 }
                //     class Derived extends Base { constructor() { super() } }
                //     new Derived().tag        // 1 in node, 0 here
                //
                // A **silent wrong answer**, on every backend, and only when the
                // derived class writes a constructor: without one it gets a
                // synthesised constructor that walks the whole chain, which is
                // why `class Derived extends Base {}` was right and this was
                // not. Giving the base an explicit constructor also hid it,
                // because then `hierarchy.constructor` finds one and this arm is
                // never reached.
                //
                // Every ancestor, base-first, because that is the order
                // JavaScript runs them in and because *none* of them has a
                // constructor — `hierarchy.constructor` walks up, so reaching
                // here means the whole chain above is constructorless.
                let ancestors = self.constructorless_ancestors(above);
                if !ancestors.is_empty()
                    && let HirType::Managed(ManagedType::Object(class)) =
                        self.values[receiver.0 as usize].ty
                {
                    self.initialize_fields(id, receiver, class, &ancestors)?;
                }
                self.initialize_own_fields(id, receiver)?;
                return Ok(receiver);
            }
            None => base,
        };

        let mut args = vec![receiver];
        args.extend(self.lower_arguments_on(id, arguments, receiver)?);
        let origin = self.origin(id);
        // A `super(...)` produces nothing; `super.m()` produces whatever `m`
        // does, and the checker typed the call node accordingly.
        let ty = if member == "constructor" {
            HirType::Void
        } else {
            self.type_of(id).unwrap_or(HirType::Void)
        };
        // **A `super(…)` names the base's raising copy, like every other direct call.**
        // This is the fourth site to need the suffix after `lower_static_call`, `lower_new`
        // and the accessor pair, and it went unnoticed because a `super` call carries no
        // symbol: `a_raising_callee_of` answered `None`, so `raising_suffix_of` answered
        // `""` -- silently an unsuffixed name rather than a refusal -- and
        // `a_raising_body_carries_this_call` could not object either, since
        // `calls_compiled_code` asks a symbol this call does not have.
        //
        // The result was a raising copy that called the base's **ordinary** constructor:
        // `func Calls#constructor@raises { %2 = call Base#constructor(%0, %1) }`, so the
        // base's `throw` ended the program from inside a `try` that had compiled. 10 of 29
        // cases, and `tests/programs/a-throw-that-stays-in-its-function` carries both arms now --
        // an inherited constructor and an explicit `super`.
        let suffix = self.raising_suffix_of(id);
        let copy = if member == "constructor" {
            self.constructed_copy(id)
        } else {
            String::new()
        };
        let call = self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{base}#{member}{copy}{suffix}")),
                args,
                frame: None,
            },
            ty,
            origin,
        );
        // **Before this class's own initialisers**, because a `super()` that raised did not
        // finish building the base and the fields below it must not run on a half-built
        // object. The test branches to the handler, so the initialisers are simply not
        // reached -- which is the ordering `initialize_own_fields`' own doc describes as
        // "immediately after `super()` returns", with the raise being the case where it
        // does not return.
        self.test_for_a_raise(id);
        if member == "constructor" {
            self.initialize_own_fields(id, receiver)?;
        }
        Ok(call)
    }

    /// A class's own field initialisers, inside its own constructor: at the top
    /// when it has no base, and immediately after `super()` returns when it
    /// does.
    ///
    /// Where JavaScript puts them, and the reason they are not at the
    /// allocation site: `class D extends B { y = this.x + 10 }` reads the `x`
    /// that `B`'s constructor wrote, and running every class's initialisers
    /// before any constructor made that read find a field nobody had written --
    /// **28 of 29 cases against node**, answering `nan`.
    ///
    /// The class comes from the **receiver's type** rather than from the
    /// `instance` the caller passes, which is `None` for a constructor. Inside
    /// a constructor that type is the class the constructor belongs to rather
    /// than whatever subclass is being built, and that is what makes the field
    /// index right: the index comes from this class's layout, and base-first
    /// layout makes it the same index in every subclass's.
    /// The classes above this one, outermost first, when none of them declares
    /// a constructor.
    ///
    /// Only called from the arm that established that: `Hierarchy::constructor`
    /// walks up, so a `None` from it means the whole chain is constructorless
    /// and every one of their field initialisers is this `super()`'s to run.
    ///
    /// Outermost first because that is the order the constructors would have
    /// run in, and a derived initialiser is allowed to read what a base one
    /// stored.
    pub(super) fn constructorless_ancestors(&self, base: Option<TypeId>) -> Vec<TypeId> {
        let mut chain: Vec<_> = base
            .into_iter()
            .flat_map(|ty| self.hierarchy.ancestors(ty))
            .collect();
        chain.reverse();
        chain
    }

    /// A class's own fields, made where JavaScript makes them, and then the
    /// parameter properties its constructor declares: under define semantics
    /// each is a field holding `undefined` until the constructor assigns it,
    /// after every field initialiser has run.
    pub(super) fn initialize_own_fields(
        &mut self,
        id: NodeId,
        receiver: ValueId,
    ) -> Result<(), Diagnostic> {
        let HirType::Managed(ManagedType::Object(class)) = self.values[receiver.0 as usize].ty
        else {
            return Ok(());
        };
        self.initialize_fields(id, receiver, class, &[class])?;
        let pending = std::mem::take(&mut self.pending_parameter_properties);
        self.store_parameter_properties(&pending)
    }

    /// `super.m(args)` in a method of a class the program writes over an
    /// Objective-C class: the superclass's method, sent as a message from the
    /// superclass (`objc_msgSendSuper`), since the method is the runtime's
    /// and not one of the program's own to call directly.
    fn lower_objc_super(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        method: (NodeId, nts_semantic_schema::SignatureId),
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let [object, member] = self.children(self.children(id).first().copied().unwrap_or(id))[..]
        else {
            return Err(self.unsupported(id, "a `super` call of unexpected shape"));
        };
        let class = self
            .enclosing_class(id)
            .and_then(|class| crate::hir::native::objc_name(self.snapshot, class))
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    "`super` outside a class the program writes over an Objective-C class",
                )
            })?;
        self.super_send = Some(class);
        let sent = self.lower_native_method_call(id, (receiver, object), method, member, arguments);
        self.super_send = None;
        sent
    }

    /// `super()` and `super.OnGotFocus(e)` in a class the program writes over
    /// a composable Windows Runtime class: its constructor's composition, or
    /// the base's own implementation of a method it overrides, through the
    /// method's slot past this class's override. `None` for any other
    /// `super`.
    fn com_super_call(
        &mut self,
        id: NodeId,
        member: &str,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if member == "constructor" {
            return None;
        }
        let (method, tag) = self.overridable_target(id, member)?;
        let Some(receiver) = self.this else {
            return Some(Err(self.unsupported(id, "`super` outside a method")));
        };
        Some(self.lower_com_super(id, receiver, method, &tag, arguments))
    }

    /// The method a `super.m(...)` calls and its `@ntsOverride` tag, where
    /// the base is a composable Windows Runtime class declaring `m`
    /// overridable.
    fn overridable_target(
        &self,
        id: NodeId,
        member: &str,
    ) -> Option<((NodeId, nts_semantic_schema::SignatureId), String)> {
        if member == "constructor" {
            return None;
        }
        let target = self.snapshot.call_targets.get(&id).copied()?;
        let declaration = target.callee?;
        let tag = self
            .node(declaration)
            .native
            .as_ref()?
            .overridable
            .clone()?;
        Some(((declaration, target.signature), tag))
    }

    /// `super.m(...)` in a class over a composable Windows Runtime class,
    /// where the base declares `m` overridable (`@ntsOverride <IID> <slot>
    /// <name>`): the base's own implementation of the interface, from the
    /// runtime (`nts_com_base`), called through the slot as any Windows
    /// Runtime method is.
    fn lower_com_super(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        method: (NodeId, nts_semantic_schema::SignatureId),
        tag: &str,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let [object, member] = self.children(self.children(id).first().copied().unwrap_or(id))[..]
        else {
            return Err(self.unsupported(id, "a `super` call of unexpected shape"));
        };
        let words: Vec<&str> = tag.split_whitespace().collect();
        let [iid, slot, name, ..] = words.as_slice() else {
            return Err(self.unsupported(id, "@ntsOverride names the interface ID, the slot and the method, as in `@ntsOverride A33E81EF-C665-503B-8827-D27EF1720A06 6 OnLaunched`"));
        };
        let slot: u32 = slot
            .parse()
            .map_err(|_| self.unsupported(id, "@ntsOverride naming a slot that is not a number"))?;
        if !crate::hir::native::is_interface_id(iid) {
            return Err(self.unsupported(
                id,
                "@ntsOverride with an interface ID that is not 8-4-4-4-12 hexadecimal digits",
            ));
        }
        let origin = self.origin(id);
        let [low, high] = self.iid_arguments(iid, &origin);
        let ty = self.values[receiver.0 as usize].ty.clone();
        let base = self.runtime_call("nts_com_base", vec![receiver, low, high], ty, origin);
        self.forced_slot = Some((slot, (*name).to_owned()));
        let called = self.lower_native_method_call(id, (base, object), method, member, arguments);
        self.forced_slot = None;
        called
    }
}
