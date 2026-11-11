//! Select and emit Objective-C message and property dispatch, including optional selectors and class receivers.

use super::{
    BinOp, BlockId, Branch, Callee, Diagnostic, FuncBuilder, HirType, LinkTag, NodeId, OpKind,
    Origin, PropertyKey, Terminator, TypeId, TypeKind, UnOp, ValueId, absence_of_member,
    default_setter, instance_type_of, is_static_member, syntax, synthesized,
};

#[derive(Clone)]
pub(super) struct ObjcProperty {
    declaration: NodeId,
    /// A class property, sent to the class.
    pub(super) is_static: bool,
    getter: String,
    setter: Option<String>,
}

/// The signature one accessor sends with: the receiver first, as
/// `lower_native_method_call` puts a method's `this` -- none for a class
/// property, which is sent to the class -- then the value for a setter, and
/// what it returns.
pub(super) fn accessor_signature(
    receiver: Option<TypeId>,
    value: Option<TypeId>,
    result: TypeId,
) -> nts_semantic_schema::SignatureRecord {
    let parameter = |name: &str, ty| nts_semantic_schema::ParameterRecord {
        name: name.to_owned(),
        ty,
        optional: false,
        rest: false,
    };
    nts_semantic_schema::SignatureRecord {
        parameters: receiver
            .map(|ty| parameter("this", ty))
            .into_iter()
            .chain(value.map(|ty| parameter("value", ty)))
            .collect(),
        return_type: result,
        type_parameters: Vec::new(),
        is_construct: false,
        type_predicate: None,
        this_type: receiver,
    }
}

/// A member of an Objective-C class a binding declares.
pub(super) struct ObjcClassMember {
    /// The class's Objective-C name.
    class: String,
    pub(super) is_static: bool,
}

impl FuncBuilder<'_> {
    /// The selector of `member` where it names a method of an Objective-C
    /// protocol a binding declares: what `delegate?.m?.()` asks the object
    /// whether it answers.
    pub(super) fn objc_optional_selector(&self, member: NodeId) -> Option<String> {
        let symbol = self
            .snapshot
            .symbols
            .get(self.node(member).symbol?.0 as usize)?;
        symbol
            .declarations
            .iter()
            .copied()
            .find(|declaration| self.objc_protocol_member(*declaration))
            .and_then(|declaration| {
                self.node(declaration)
                    .native
                    .as_ref()
                    .and_then(|native| native.selector.clone())
            })
    }

    /// `delegate?.tableViewDidSelectRowAt?.(table, path)`: Swift's
    /// `delegate?.tableView?(table, didSelectRowAt: path)`. The object is asked
    /// `respondsToSelector:` -- which the runtime answers `NO` for a nil
    /// object, so one test covers an absent receiver too -- and sent the
    /// message only where it answered `YES`. The class the program sees says
    /// nothing here: the object is any class that conforms, and whether it
    /// implements an optional requirement is its class's, at run time.
    pub(super) fn objc_optional_call(
        &mut self,
        id: NodeId,
        (object, member): (NodeId, NodeId),
        selector: &str,
    ) -> Result<ValueId, Diagnostic> {
        let receiver = self.lower_expression(object)?;
        if !matches!(
            self.values[receiver.0 as usize].ty,
            HirType::NativePointer(_)
        ) {
            return Err(self.unsupported(id, "an optional requirement of an Objective-C protocol on something that is not an object"));
        }
        let origin = self.origin(id);
        let present = self.responds_to(receiver, selector, origin);
        self.lower_branching_value(
            id,
            present,
            Branch::MethodOn(receiver, object, member, None),
            Branch::Absent,
        )
    }

    /// `[receiver respondsToSelector:@selector(selector)]`, which the runtime
    /// answers `NO` for a nil receiver.
    fn responds_to(&mut self, receiver: ValueId, selector: &str, origin: Origin) -> ValueId {
        let HirType::NativePointer(pointee) = self.values[receiver.0 as usize].ty.clone() else {
            unreachable!("`respondsToSelector:` is sent only to an object")
        };
        let selector_pointee = crate::hir::native::Pointee::Opaque("objc_selector".into());
        let selector_value = self.push(
            OpKind::ObjcSelector {
                name: selector.to_owned(),
            },
            HirType::NativePointer(selector_pointee.clone()),
            origin.clone(),
        );
        let responds = synthesized(
            "respondsToSelector:",
            vec![
                crate::hir::native::Type::Pointer(pointee),
                crate::hir::native::Type::Pointer(selector_pointee),
            ],
            crate::hir::native::Type::Bool,
            Some(crate::hir::native::Send {
                selector: "respondsToSelector:".to_owned(),
                class: None,
                super_of: None,
            }),
            Vec::new(),
        );
        self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(responds)),
                args: vec![receiver, selector_value],
                frame: None,
            },
            HirType::Bool,
            origin,
        )
    }

    /// Whether `ty` declares `key` as a method *and* optionally.
    ///
    /// Both halves matter. A required method is a plain virtual call and never
    /// reaches here; an optional **property** holding a closure is a field with
    /// a representation already, and stealing it would replace a working
    /// lowering with a class test.
    pub(super) fn declares_an_optional_method(&self, ty: TypeId, key: &PropertyKey) -> bool {
        let ty = crate::hir::generics::concrete(self.snapshot, ty);
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        match &record.kind {
            TypeKind::Object { .. } => self.declares_it_optionally(ty, key),
            // **`a?.b?.()` — the receiver is optional too.** Its type is then a
            // union with an absence in it rather than an object, and asking an
            // object question of a union answered `false`: the callee fell
            // through to being lowered as a *value*, and the refusal was
            // ``a union of a function type | undefined``, about the member, for
            // a program whose difference is in the receiver.
            //
            // **One test still, not two.** Both absences produce `undefined`
            // and the `InstanceOf` below already answers for both: an absent
            // receiver is an instance of no class, so the arm that calls is
            // exactly the arm where the receiver is present *and* its class
            // has the slot. What the second `?.` adds is the narrowing --
            // `present_of` on the receiver, which a singly-optional call has
            // nothing to do for and which this one cannot omit.
            //
            // **Every** present member has to declare it, not any: a union
            // where one arm has the method and another does not is a program
            // whose receiver may be an object with no slot at all, and the
            // class test would send it to the calling arm.
            TypeKind::Union(members) => {
                let present: Vec<TypeId> = members
                    .iter()
                    .filter(|member| absence_of_member(self.snapshot, **member).is_none())
                    .copied()
                    .collect();
                !present.is_empty()
                    && present.iter().all(|member| {
                        self.declares_it_optionally(
                            crate::hir::generics::concrete(self.snapshot, *member),
                            key,
                        )
                    })
            }
            _ => false,
        }
    }

    /// Whether this *object* type declares `key` as a method, optionally.
    ///
    /// One level, deliberately: a union member that is itself a union is not
    /// something the checker hands back, and recursing would buy a shape that
    /// does not occur at the cost of a depth this cannot bound.
    fn declares_it_optionally(&self, ty: TypeId, key: &PropertyKey) -> bool {
        if self.projected_callable(ty, key).is_some() {
            return true;
        }
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        let TypeKind::Object { properties } = &record.kind else {
            return false;
        };
        properties.iter().any(|property| {
            property.name == *key
                && property.optional
                && property.kind == nts_semantic_schema::MemberKind::Method
        })
    }

    pub(super) fn objc_protocol_member(&self, declaration: NodeId) -> bool {
        self.kind_of(declaration) == Some(syntax::METHOD_SIGNATURE)
            && self.declaring_protocol(declaration).is_some()
    }

    /// The Objective-C protocol a binding declares (`@ntsProtocol`) that
    /// declares `member`, a method or a property requirement.
    fn declaring_protocol(&self, member: NodeId) -> Option<NodeId> {
        let mut owner = self.node(member).parent;
        while let Some(at) = owner.filter(|at| self.kind_of(*at).is_none()) {
            owner = self.node(at).parent;
        }
        owner.filter(|at| {
            self.kind_of(*at) == Some(syntax::INTERFACE_DECLARATION)
                && self
                    .node(*at)
                    .native
                    .as_ref()
                    .is_some_and(|native| native.protocol.is_some())
        })
    }

    /// Whether a binding's method is called on an instance: an interface
    /// method declaring `this: T`, or a member of a Windows Runtime class's
    /// idiomatic surface, which declares no `this` -- it is inherited by every
    /// subclass and called on whichever instance the call names, through the
    /// interface its `@ntsVia` asks for. The one answer `native_method` and
    /// `vtable_of` both ask.
    pub(super) fn is_native_instance_method(
        &self,
        declaration: NodeId,
        signature: &nts_semantic_schema::SignatureRecord,
    ) -> bool {
        let via = self
            .node(declaration)
            .native
            .as_ref()
            .is_some_and(|n| n.via.is_some() || n.listener.is_some());
        self.kind_of(declaration) == Some(syntax::METHOD_SIGNATURE)
            && (signature.this_type.is_some() || via)
    }

    /// `handle.method(args)` as `function(handle, args)`, for an `@ntsCall`
    /// method: the receiver is the function's first argument, converted to
    /// its type, and the rest are the method's.
    /// The method a call reaches, where it is a method of an Objective-C
    /// class the program writes (`Program::foreign_classes`).
    pub(super) fn program_objc_method(&self, id: NodeId) -> Option<NodeId> {
        let declaration = self.snapshot.call_targets.get(&id)?.callee?;
        if self.kind_of(declaration) != Some(syntax::METHOD_DECLARATION)
            || is_static_member(self.snapshot, declaration)
        {
            return None;
        }
        let class = self.enclosing_class(declaration)?;
        crate::hir::native::extends_objc(self.snapshot, class).then_some(declaration)
    }

    /// A call from TypeScript to a method of an Objective-C class the program
    /// writes: the compiled method itself, called directly, as a call to one
    /// of the program's own class methods is. The runtime reaches the same
    /// function through the entry point the backend builds for it; a call
    /// the program writes needs no message.
    pub(super) fn lower_program_objc_call(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        method: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let class = self
            .enclosing_class(method)
            .ok_or_else(|| self.unsupported(id, "a method outside a class"))?;
        let member = self
            .member_name(method)
            .ok_or_else(|| self.unsupported(id, "a member whose name the program computes"))?;
        let name = format!("{}#{member}", self.class_name_for(class, None, false)?);
        let parameters: Vec<NodeId> = self
            .children(method)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
            .collect();
        if arguments.len() != parameters.len() {
            return Err(self.unsupported(
                id,
                "a call to an Objective-C method of the program's with a default or rest parameter",
            ));
        }
        // A subclass's instance, seen as the class that declares the method:
        // `derived.bumpA()` passes a `Derived` where `Base#bumpA` takes a
        // `Base`, which is one pointer, converted as a handle is.
        let this = instance_type_of(self.snapshot, class)
            .and_then(|ty| self.represent(ty))
            .ok_or_else(|| self.unrepresentable(id, "a method's receiver"))?;
        let mut args = vec![self.coerce(receiver, &this, id)?];
        for (argument, parameter) in arguments.iter().zip(&parameters) {
            // Labels, which the method takes as the runtime passes them: a
            // literal's properties, never built, or an object's fields.
            let declared = self.snapshot.node_types.get(parameter).copied();
            if let Some(labels) = declared
                .filter(|ty| crate::hir::native::abi_type(self.snapshot, *ty).is_none())
                .and_then(|ty| crate::hir::native::labels_of(self.snapshot, ty))
            {
                if self.kind_of(*argument) == Some(syntax::OBJECT_LITERAL_EXPRESSION) {
                    self.labels_pending.insert(*argument);
                }
                let given = self.lower_expression(*argument)?;
                for (key, ty) in labels {
                    let value = self.label_value(*argument, Some(given), &key)?;
                    let want = self
                        .represent(ty)
                        .ok_or_else(|| self.unrepresentable(*argument, "a label"))?;
                    args.push(self.coerce(value, &want, *argument)?);
                }
                continue;
            }
            let ty = self
                .type_of(*parameter)
                .ok_or_else(|| self.unrepresentable(*parameter, "a method parameter"))?;
            let value = self.lower_expecting(*argument, &ty)?;
            args.push(self.coerce(value, &ty, *argument)?);
        }
        let Some(dispatch) = self.objc_dispatch(class, method, &member) else {
            return self.push_call(id, Callee::Direct(name), args, Some(method), None);
        };
        self.dispatch_objc_call(id, &member, &dispatch, &args)
    }

    /// The method named `member` that `class` itself implements: a method
    /// with a body, not an overload signature or a static one.
    fn own_method(&self, class: NodeId, member: &str) -> Option<NodeId> {
        self.children(class).into_iter().find(|child| {
            self.kind_of(*child) == Some(syntax::METHOD_DECLARATION)
                && !is_static_member(self.snapshot, *child)
                && self.member_name(*child).as_deref() == Some(member)
                && self
                    .children(*child)
                    .into_iter()
                    .any(|part| self.kind_of(part) == Some(syntax::BLOCK))
        })
    }

    /// How a call to `method`, `class`'s method named `member`, dispatches
    /// over the classes the program writes from `class` down -- the whole
    /// world a class of the program's is subclassed in, since a binding's
    /// classes are Objective-C's and never extend one of the program's.
    /// `None` where no subclass overrides it, and the call is direct.
    pub(super) fn objc_dispatch(
        &self,
        class: NodeId,
        method: NodeId,
        member: &str,
    ) -> Option<ObjcDispatch> {
        let chain = |from: NodeId| {
            let mut seen = rustc_hash::FxHashSet::default();
            std::iter::successors(Some(from), |at| {
                crate::hir::native::superclass(self.snapshot, *at)
            })
            .take_while(move |at| seen.insert(*at))
        };
        let mut exact = Vec::new();
        let mut overriders = Vec::new();
        for tested in self
            .hierarchy
            .objc_classes
            .iter()
            .copied()
            .filter(|c| chain(*c).any(|at| at == class))
        {
            // The nearest class from `tested` up to `class` that implements
            // it: `tested`'s own method, or the one it inherits.
            let (owner, answering) = chain(tested).find_map(|at| {
                if at == class {
                    Some((class, method))
                } else {
                    self.own_method(at, member).map(|own| (at, own))
                }
            })?;
            let arm = ObjcArm {
                tested,
                owner,
                method: answering,
            };
            if owner == tested && tested != class {
                overriders.push((chain(tested).count(), arm));
            }
            exact.push(arm);
        }
        if overriders.is_empty() {
            return None;
        }
        // Deepest first: of two overriders a receiver is a kind of, the
        // deeper is nearer its class, and its method is the one it has.
        overriders.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.tested.0.cmp(&b.1.tested.0)));
        let base = ObjcArm {
            tested: class,
            owner: class,
            method,
        };
        Some(ObjcDispatch {
            exact,
            overriders: overriders.into_iter().map(|(_, arm)| arm).collect(),
            base,
        })
    }

    /// A call to a method some of the program's subclasses override, at a
    /// vtable's cost. First the receiver's own class, read once
    /// (`object_getClass`) and compared with each class the program writes
    /// below the method's: a load and a compare each, then a direct call of
    /// the method that class has. Then a class the runtime made below one of
    /// the program's -- key-value observing's `NSKVONotifying_` subclass --
    /// asked `isKindOfClass:` of each overrider, deepest first. Then the
    /// method itself. Every arm is a direct call, so a method no message
    /// could carry (`g(s: string)`) dispatches as a registered one does.
    fn dispatch_objc_call(
        &mut self,
        id: NodeId,
        member: &str,
        dispatch: &ObjcDispatch,
        args: &[ValueId],
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let receiver = args[0];
        let HirType::NativePointer(pointee) = self.values[receiver.0 as usize].ty.clone() else {
            return Err(self.unsupported(id, "a method of an Objective-C class the program writes on something that is not an object"));
        };
        let class_pointee = crate::hir::native::Pointee::Opaque("objc_class".into());
        let class_ty = HirType::NativePointer(class_pointee.clone());
        let get_class = synthesized(
            "object_getClass",
            vec![crate::hir::native::Type::Pointer(pointee.clone())],
            crate::hir::native::Type::Pointer(class_pointee.clone()),
            None,
            Vec::new(),
        );
        let is_kind = std::sync::Arc::new(synthesized(
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
        ));
        let joined = self.new_block();
        let mut result = None;
        let isa = self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(get_class)),
                args: vec![receiver],
                frame: None,
            },
            class_ty.clone(),
            origin.clone(),
        );
        for arm in &dispatch.exact {
            let class = self.objc_class_value(id, arm.tested, &class_ty)?;
            let same = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: isa,
                    rhs: class,
                },
                HirType::Bool,
                origin.clone(),
            );
            self.objc_arm(id, member, Some(same), arm, args, (joined, &mut result))?;
        }
        for arm in &dispatch.overriders {
            let class = self.objc_class_value(id, arm.tested, &class_ty)?;
            let kind = self.push(
                OpKind::Call {
                    callee: Callee::Native(is_kind.clone()),
                    args: vec![receiver, class],
                    frame: None,
                },
                HirType::Bool,
                origin.clone(),
            );
            self.objc_arm(id, member, Some(kind), arm, args, (joined, &mut result))?;
        }
        self.objc_arm(
            id,
            member,
            None,
            &dispatch.base,
            args,
            (joined, &mut result),
        )?;
        self.switch_to(joined);
        // A method returning nothing: the placeholder a statement-level call
        // leaves, as every void expression here is.
        Ok(result.unwrap_or_else(|| self.push(OpKind::ConstFloat(0.0), HirType::Void, origin)))
    }

    /// The class object of `class`, a class the program writes, by the name
    /// the runtime registered it under.
    fn objc_class_value(
        &mut self,
        id: NodeId,
        class: NodeId,
        ty: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let name = crate::hir::native::objc_name(self.snapshot, class)
            .ok_or_else(|| self.unsupported(id, "a class the runtime knows by no name"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::ObjcClass {
                name,
                frameworks: Vec::new(),
            },
            ty.clone(),
            origin,
        ))
    }

    /// One arm of [`Self::dispatch_objc_call`]: where `test` holds -- or
    /// unconditionally, with none -- the receiver as the answering class's
    /// handle (the test just said it is one, as `instanceof` narrows) and a
    /// direct call of its method, whose value joins the others at `joined`.
    fn objc_arm(
        &mut self,
        id: NodeId,
        member: &str,
        test: Option<ValueId>,
        arm: &ObjcArm,
        args: &[ValueId],
        (joined, result): (BlockId, &mut Option<ValueId>),
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let next = test.map(|cond| {
            let (taken, next) = (self.new_block(), self.new_block());
            self.terminate(Terminator::Branch {
                cond,
                then_target: taken,
                then_args: Vec::new(),
                else_target: next,
                else_args: Vec::new(),
            });
            self.switch_to(taken);
            next
        });
        let this_ty = instance_type_of(self.snapshot, arm.owner)
            .and_then(|ty| self.represent(ty))
            .ok_or_else(|| self.unrepresentable(id, "an overriding method's receiver"))?;
        let mut args = args.to_vec();
        if this_ty != self.values[args[0].0 as usize].ty {
            args[0] = self.push(OpKind::Convert(args[0]), this_ty, origin.clone());
        }
        let callee = format!("{}#{member}", self.class_name_for(arm.owner, None, false)?);
        let value = self.push_call(id, Callee::Direct(callee), args, Some(arm.method), None)?;
        let ty = self.values[value.0 as usize].ty.clone();
        let passed = if ty == HirType::Void {
            Vec::new()
        } else {
            if result.is_none() {
                *result = Some(self.push_block_param(joined, ty, origin));
            }
            vec![value]
        };
        self.terminate(Terminator::Jump {
            target: joined,
            args: passed,
        });
        if let Some(next) = next {
            self.switch_to(next);
        }
        Ok(())
    }

    /// A message the lowering sends itself, as a value of `result`'s type.
    pub(super) fn send_bridge(
        &mut self,
        message: crate::hir::native::Function,
        args: Vec<ValueId>,
        origin: &Origin,
    ) -> ValueId {
        let ty = message.result.representation();
        self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(message)),
                args,
                frame: None,
            },
            ty,
            origin.clone(),
        )
    }

    /// `NSWindow` as a value: a constant an `objc:` module declares with the
    /// type `ObjcMeta<"NSWindow">`, which is that class object.
    ///
    /// Only a declaration inside `declare module "objc:..."`, where a constant
    /// can have no initializer and so can mean nothing else. The class name is
    /// the brand's, not the constant's, so a binding may name the constant as
    /// it likes. Asked before module scope is, which refuses a native pointer
    /// at module scope for having no storage -- right for a variable, and this
    /// is not one.
    pub(super) fn objc_class_object(
        &mut self,
        id: NodeId,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        // A class a binding declares with `@ntsClass`, named as a value.
        if let Some(class) = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)
            .and_then(|record| {
                record.declarations.iter().copied().find(|declaration| {
                    self.kind_of(*declaration) == Some(syntax::CLASS_DECLARATION)
                        && crate::hir::native::is_objc_class(self.snapshot, *declaration)
                })
            })
        {
            let name = self
                .node(class)
                .native
                .as_ref()
                .and_then(|n| n.class.clone())
                .unwrap_or_default();
            let frameworks = self.declared_names(id, class, LinkTag::FRAMEWORK)?;
            let ty =
                HirType::NativePointer(crate::hir::native::Pointee::Opaque("objc_class".into()));
            return Ok(Some(self.push(
                OpKind::ObjcClass { name, frameworks },
                ty,
                self.origin(id),
            )));
        }
        let Some(ty) = self.snapshot.node_types.get(&id).copied() else {
            return Ok(None);
        };
        let Some(name) = crate::hir::native::objc_meta(self.snapshot, ty) else {
            return Ok(None);
        };
        let Some(declaration) = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)
            .and_then(|record| {
                record.declarations.iter().copied().find(|declaration| {
                    self.kind_of(*declaration)
                        == Some(nts_semantic_schema::syntax::VARIABLE_DECLARATION)
                })
            })
        else {
            return Ok(None);
        };
        if !self.in_objc_module(declaration) {
            return Ok(None);
        }
        if !crate::hir::native::is_c_identifier(&name) {
            return Err(self.unsupported(
                id,
                &format!(
                    "`ObjcMeta<\"{name}\">` names a class by its name, and `{name}` is not one"
                ),
            ));
        }
        let frameworks = self.declared_names(id, declaration, LinkTag::FRAMEWORK)?;
        let ty = HirType::NativePointer(crate::hir::native::Pointee::Opaque("objc_class".into()));
        Ok(Some(self.push(
            OpKind::ObjcClass { name, frameworks },
            ty,
            self.origin(id),
        )))
    }

    /// The Objective-C property `member` names: one an `objc:` module
    /// declares as a property signature of an interface, read with its getter
    /// and written with its setter.
    ///
    /// The getter is the property's name, or the selector `@ntsSelector`
    /// gives it, since a `getter=isVisible` property is read with another.
    /// The setter is the one `@ntsSet` names, or `set` and the name
    /// capitalized, with a colon, which is the one Cocoa's `@property` makes
    /// unless it says `setter=`. Swift's `isHidden` is written with
    /// `setHidden:`, so a binding names it. A `readonly` property has none.
    pub(super) fn objc_property(&self, object: NodeId, member: NodeId) -> Option<ObjcProperty> {
        // A property signature of an `objc:` interface, or a property of an
        // Objective-C class a binding declares -- a class property when
        // `static`, whose accessors are sent to the class.
        let objc = |declaration: &NodeId| match self.kind_of(*declaration) {
            // Not one read through a function (`@ntsGet`): a Core Foundation
            // class's property is a C function of the instance, which is not
            // an Objective-C message.
            Some(syntax::PROPERTY_SIGNATURE) => {
                self.in_objc_module(*declaration)
                    && self.declared_by_an_interface(*declaration)
                    && !self
                        .node(*declaration)
                        .native
                        .as_deref()
                        .is_some_and(|n| n.get.is_some() || n.set.is_some())
            }
            Some(syntax::PROPERTY_DECLARATION) => self.objc_class_member(*declaration).is_some(),
            // A binding's property, as the accessors an Objective-C property
            // is; or an accessor of a class the program writes over one,
            // which is sent as the runtime would send it, to its own entry.
            Some(syntax::GET_ACCESSOR | syntax::SET_ACCESSOR) => {
                self.objc_class_member(*declaration).is_some()
                    || self.program_objc_accessor(*declaration)
            }
            _ => false,
        };
        let name = self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)?;
        // By the member's symbol, and otherwise by name on the receiver's
        // type: a property *written* is given a symbol with no declarations,
        // while the type still lists the property it names.
        let declaration = self
            .node(member)
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .and_then(|record| record.declarations.iter().copied().find(objc))
            .or_else(|| {
                // Through the absences of an optional receiver: `w?.contentView`
                // reads it on `NSWindow | null`. And through `this` in a
                // method of a class the program writes, whose type is the
                // class's polymorphic `this`: `this.title` is the class's.
                let ty =
                    self.class_behind(self.present_part(*self.snapshot.node_types.get(&object)?)?);
                let TypeKind::Object { properties } = &self.snapshot.types.get(ty.0 as usize)?.kind
                else {
                    return None;
                };
                properties
                    .iter()
                    .find(|p| p.name.is_name(name.as_ref()))
                    .and_then(|p| p.declaration)
                    .filter(objc)
            })?;
        let is_static = self
            .objc_class_member(declaration)
            .is_some_and(|member| member.is_static);
        let (getter, setter) = self.property_selectors(declaration, &name);
        Some(ObjcProperty {
            declaration,
            is_static,
            getter,
            setter,
        })
    }

    /// Whether a member is declared by an `interface` rather than by an
    /// anonymous type literal.
    ///
    /// **A property signature inside an `objc:` module is not automatically an
    /// Objective-C property**, and `in_objc_module` alone says it is. A C record
    /// declared in the same module is a type literal of field signatures:
    ///
    /// ```ts
    /// declare module "objc:Foundation" {
    ///   export type Size = Struct<{ width: Float64; height: Float64 }, "Size">;
    /// ```
    ///
    /// `width` is a field of a struct read by offset, not a selector sent to an
    /// object -- and reading it as a message made `dirtyRect.size.width` build a
    /// *foreign function* called `width`, which then refused for having a return
    /// with no native ABI. An Objective-C class or protocol arrives as a `class`
    /// or an `interface`; nothing read by selector is an anonymous literal.
    ///
    /// **This was latent, and it is the fill in `symbols::Deferred` that
    /// published it.** `objc_property` looks the declaration up by the member's
    /// symbol and falls back to the receiver's type, and the fallback only
    /// considers a `TypeKind::Object` -- a `Struct<…>` is an intersection, so it
    /// found nothing and answered "not an objc property", correctly and for the
    /// wrong reason. While those members had no declarations recorded, only the
    /// fallback could run.
    ///
    /// Bounded rather than a full ascent, and `TYPE_LITERAL` is a *stop* rather
    /// than something to walk past: a property signature nested inside a literal
    /// inside an interface belongs to the literal, which is the case the bound
    /// alone would get wrong.
    ///
    /// **Both answers are held by a test**, which is worth saying because the
    /// corpus holds neither: forcing this to `false` leaves all 50
    /// `tests/interop` refusal counts byte-identical, and breaks
    /// `a_property_reads_and_writes_by_message` in `codegen/c/tests/objc.rs` --
    /// an `objc:` interface's property, read as a message. The `false` side is
    /// `an_override_takes_the_selector_it_replaces_and_a_record_by_value`, whose
    /// `Struct` field this exists for. So the whole arm lives in those two tests
    /// and nothing in `examples` would notice it going wrong.
    fn declared_by_an_interface(&self, declaration: NodeId) -> bool {
        let mut at = self.node(declaration).parent;
        for _ in 0..8 {
            let Some(parent) = at else { return false };
            match self.kind_of(parent) {
                Some(syntax::INTERFACE_DECLARATION) => return true,
                Some(syntax::TYPE_LITERAL) => return false,
                _ => at = self.node(parent).parent,
            }
        }
        false
    }

    /// `ty` without its absences, where one type is left: `NSWindow` of
    /// `NSWindow | null | undefined`, the receiver `a?.b` reads `b` on in the
    /// arm where `a` is present.
    pub(super) fn present_part(&self, ty: TypeId) -> Option<TypeId> {
        match &self.snapshot.types.get(ty.0 as usize)?.kind {
            TypeKind::Union(members) => {
                let mut present = members
                    .iter()
                    .filter(|m| absence_of_member(self.snapshot, **m).is_none());
                let only = present.next()?;
                present.next().is_none().then_some(*only)
            }
            _ => Some(ty),
        }
    }

    /// A property's getter and setter selectors, the setter `None` when it is
    /// read-only: a field declared `readonly`, or accessors with no `set`.
    /// Each is its tag where the binding gave one, else the name's -- `title`
    /// and `setTitle:`. An accessor of a class the program writes over an
    /// Objective-C class answers the selectors of the property it overrides,
    /// so `get isFlipped()` is sent `isFlipped`, as `AppKit` sends it.
    pub(super) fn property_selectors(
        &self,
        declaration: NodeId,
        name: &str,
    ) -> (String, Option<String>) {
        if self.program_objc_accessor(declaration)
            && let Some(overridden) = self.overridden_property(declaration, name)
        {
            return self.property_selectors(overridden, name);
        }
        let tag =
            |node: NodeId, pick: fn(&nts_semantic_schema::NativeAttributes) -> Option<String>| {
                self.node(node)
                    .native
                    .as_ref()
                    .and_then(|native| pick(native))
            };
        if self.kind_of(declaration) == Some(syntax::PROPERTY_DECLARATION)
            || self.kind_of(declaration) == Some(syntax::PROPERTY_SIGNATURE)
        {
            let getter =
                tag(declaration, |n| n.selector.clone()).unwrap_or_else(|| name.to_owned());
            let setter = (!self
                .node(declaration)
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::READONLY))
            .then(|| tag(declaration, |n| n.set.clone()).unwrap_or_else(|| default_setter(name)));
            return (getter, setter);
        }
        // Accessors: the pair declared beside this one, in the same class.
        let pair: Vec<NodeId> = self
            .node(declaration)
            .parent
            .map(|list| self.children(list))
            .unwrap_or_default()
            .into_iter()
            .filter(|member| {
                matches!(
                    self.kind_of(*member),
                    Some(syntax::GET_ACCESSOR | syntax::SET_ACCESSOR)
                ) && self.member_name(*member).as_deref() == Some(name)
            })
            .collect();
        let get = pair
            .iter()
            .copied()
            .find(|m| self.kind_of(*m) == Some(syntax::GET_ACCESSOR));
        let set = pair
            .iter()
            .copied()
            .find(|m| self.kind_of(*m) == Some(syntax::SET_ACCESSOR));
        let getter = get
            .and_then(|g| tag(g, |n| n.selector.clone()))
            .unwrap_or_else(|| name.to_owned());
        let setter = set.map(|s| tag(s, |n| n.set.clone()).unwrap_or_else(|| default_setter(name)));
        (getter, setter)
    }

    /// A read or write, from TypeScript, of an accessor of a class the
    /// program writes over an Objective-C class: the compiled accessor,
    /// called directly, as a method of it is (`lower_program_objc_call`).
    fn call_program_accessor(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        kind: &str,
        args: Vec<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let class = self
            .enclosing_class(declaration)
            .ok_or_else(|| self.unsupported(id, "an accessor outside a class"))?;
        let name = self
            .member_name(declaration)
            .ok_or_else(|| self.unsupported(id, "an accessor whose name the program computes"))?;
        let owner = self.class_name_for(class, None, false)?;
        let ty = if kind == "set" {
            HirType::Void
        } else {
            self.type_of(id)
                .ok_or_else(|| self.unrepresentable(id, "a property"))?
        };
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{owner}#{kind} {name}")),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// Whether `declaration` is an accessor of a class the program writes over
    /// an Objective-C class.
    fn program_objc_accessor(&self, declaration: NodeId) -> bool {
        matches!(
            self.kind_of(declaration),
            Some(syntax::GET_ACCESSOR | syntax::SET_ACCESSOR)
        ) && self
            .enclosing_class(declaration)
            .is_some_and(|class| crate::hir::native::extends_objc(self.snapshot, class))
    }

    /// The property of a superclass a binding declares that an accessor of
    /// the program's class overrides: its accessor, or its field.
    pub(super) fn overridden_property(&self, declaration: NodeId, name: &str) -> Option<NodeId> {
        let class = self.enclosing_class(declaration)?;
        for here in self.native_bases(class) {
            if let Some(found) = self.children(here).into_iter().find(|member| {
                matches!(
                    self.kind_of(*member),
                    Some(
                        syntax::GET_ACCESSOR | syntax::SET_ACCESSOR | syntax::PROPERTY_DECLARATION
                    )
                ) && self.objc_class_member(*member).is_some()
                    && self.member_name(*member).as_deref() == Some(name)
            }) {
                return Some(found);
            }
        }
        None
    }

    /// `object.property` as a message: the getter, sent to the object.
    pub(super) fn lower_objc_property_get(
        &mut self,
        id: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(property) = self.objc_property(object, member) else {
            return Ok(None);
        };
        let receiver = if property.is_static {
            None
        } else {
            Some(self.lower_expression(object)?)
        };
        self.read_objc_property(id, object, &property, receiver)
    }

    /// The getter of `property`, sent to `receiver` (lowered already, which
    /// is how `a?.b` reads it in the arm where `a` is present), or to the
    /// class for a class property.
    pub(super) fn read_objc_property(
        &mut self,
        id: NodeId,
        object: NodeId,
        property: &ObjcProperty,
        receiver: Option<ValueId>,
    ) -> Result<Option<ValueId>, Diagnostic> {
        // The access's type is the property's: the checker gives the member's
        // symbol none of its own.
        let (Some(_), Some(ty)) = (
            self.snapshot.node_types.get(&object).copied(),
            self.snapshot.node_types.get(&id).copied(),
        ) else {
            return Ok(None);
        };
        if self.program_objc_accessor(property.declaration) {
            let receiver = receiver.ok_or_else(|| {
                self.unsupported(
                    id,
                    "a static accessor of a class extending an Objective-C class",
                )
            })?;
            return self
                .call_program_accessor(id, property.declaration, "get", vec![receiver])
                .map(Some);
        }
        // A class's constant: a static getter tagged with the extern variable
        // it reads (`@ntsSymbol UITextFieldTextDidChangeNotification`), which
        // is no message but a load of that variable.
        if receiver.is_none()
            && self
                .node(property.declaration)
                .native
                .as_ref()
                .is_some_and(|native| native.symbol.is_some())
        {
            return self
                .read_native_variable(id, property.declaration, ty)
                .map(Some);
        }
        if let Some(receiver) = receiver
            && self.optional_requirement(property.declaration)
        {
            // Swift's `delegate?.window`, where `window` is an `optional`
            // requirement: sent only to an object that implements it, and
            // absent from one that does not.
            let origin = self.origin(id);
            let present = self.responds_to(receiver, &property.getter, origin);
            return self
                .lower_branching_value(
                    id,
                    present,
                    Branch::ObjcGetter(receiver, object, property.clone()),
                    Branch::Absent,
                )
                .map(Some);
        }
        self.send_objc_getter(id, object, property, receiver)
            .map(Some)
    }

    /// Whether `declaration` is an `optional` property requirement of an
    /// Objective-C protocol a binding declares: `window?: UIWindow | null`.
    fn optional_requirement(&self, declaration: NodeId) -> bool {
        self.kind_of(declaration) == Some(syntax::PROPERTY_SIGNATURE)
            && self
                .children(declaration)
                .iter()
                .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_TOKEN))
            && self.declaring_protocol(declaration).is_some()
    }

    /// The getter of `property`, sent: to `receiver`, or to the class for a
    /// class property.
    pub(super) fn send_objc_getter(
        &mut self,
        id: NodeId,
        object: NodeId,
        property: &ObjcProperty,
        receiver: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let (Some(receiver_ty), Some(ty)) = (
            self.snapshot.node_types.get(&object).copied(),
            self.snapshot.node_types.get(&id).copied(),
        ) else {
            return Err(self.unrepresentable(id, "an Objective-C property"));
        };
        // An `optional` requirement's `?` adds an `undefined` the getter does
        // not answer: the one absence is the branch around it, and the getter
        // answers what the declaration writes, `UIWindow | null`.
        let ty = if self.optional_requirement(property.declaration) {
            self.children(property.declaration)
                .last()
                .and_then(|annotation| self.snapshot.node_types.get(annotation).copied())
                .unwrap_or(ty)
        } else {
            ty
        };
        let chained = self.without_chain_absence(id, ty);
        // The receiver is present where the getter is sent: `a?.b?.c` sends
        // `c` to `a.b` as a `B`, not as the `B | null | undefined` the
        // checker gives the expression `a?.b`.
        let receiver_ty = self.class_behind(self.present_part(receiver_ty).unwrap_or(receiver_ty));
        let signature = accessor_signature(receiver.map(|_| receiver_ty), None, chained);
        let callee =
            self.native_callee_sending(id, property.declaration, &property.getter, &signature)?;
        let (args, lent) = self.lower_call_arguments(id, &callee, &[], receiver)?;
        // In a chain, the getter's value is the property's type; the branch
        // around it makes the chain's.
        let typed = if chained == ty {
            None
        } else {
            self.represent(chained)
        };
        self.finish_call_typed(id, callee, args, lent, Some(property.declaration), typed)
    }

    /// `object.property = value` as a message: the setter, sent to the
    /// object, with the value its one argument. The assignment's own value is
    /// that argument, read back at the expression's type.
    pub(super) fn lower_objc_property_set(
        &mut self,
        id: NodeId,
        target: NodeId,
        source: NodeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        if self.kind_of(target) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return Ok(None);
        }
        let [object, member] = self.children(target)[..] else {
            return Ok(None);
        };
        let Some(property) = self.objc_property(object, member) else {
            return Ok(None);
        };
        // Defensive: TypeScript refuses the assignment first (TS2540), and a
        // cast to write it anyway names a different property, which is not
        // this one. Kept because a binding could still be wrong about which
        // properties are `readonly`, and sending a setter that does not exist
        // would answer `unrecognized selector` at run time.
        let Some(setter) = property.setter.clone() else {
            return Err(self.unsupported(id, "an assignment to a readonly Objective-C property"));
        };
        let (Some(receiver_ty), Some(ty)) = (
            self.snapshot.node_types.get(&object).copied(),
            self.snapshot.node_types.get(&target).copied(),
        ) else {
            return Ok(None);
        };
        let receiver = if property.is_static {
            None
        } else {
            Some(self.lower_expression(object)?)
        };
        if self.program_objc_accessor(property.declaration) {
            let receiver = receiver.ok_or_else(|| {
                self.unsupported(
                    id,
                    "a static accessor of a class extending an Objective-C class",
                )
            })?;
            let value_ty = self
                .type_of(target)
                .ok_or_else(|| self.unrepresentable(target, "a property"))?;
            let value = self.lower_expecting(source, &value_ty)?;
            self.call_program_accessor(id, property.declaration, "set", vec![receiver, value])?;
            return Ok(Some(value));
        }
        // `this.title = ...` in a method of a class the program writes: the
        // class, not its polymorphic `this`.
        let receiver_ty = self.class_behind(receiver_ty);
        let signature =
            accessor_signature(receiver.map(|_| receiver_ty), Some(ty), self.void_type()?);
        let callee = self.native_callee_sending(id, property.declaration, &setter, &signature)?;
        let (args, lent) = self.lower_call_arguments(id, &callee, &[source], receiver)?;
        let written = *args
            .get(usize::from(receiver.is_some()))
            .ok_or_else(|| self.unsupported(id, "a property setter with no value"))?;
        self.finish_call(id, callee, args, lent, Some(property.declaration))?;
        let want = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "an assignment"))?;
        if self.values[written.0 as usize].ty == want {
            return Ok(Some(written));
        }
        let origin = self.origin(id);
        Ok(Some(self.push(OpKind::Convert(written), want, origin)))
    }

    /// A member of an Objective-C class a binding declares (`@ntsClass`):
    /// the class Objective-C knows it by, and whether the member is `static`.
    pub(super) fn objc_class_member(&self, declaration: NodeId) -> Option<ObjcClassMember> {
        // Past the member list, which is a node of its own with no syntax kind.
        let mut class = self.node(declaration).parent?;
        while self.kind_of(class).is_none() {
            class = self.node(class).parent?;
        }
        let name = match self.kind_of(class) {
            Some(syntax::CLASS_DECLARATION) => self.node(class).native.as_ref()?.class.clone()?,
            // An interface merging into one -- a Swift extension, as AppKit
            // adds `boolValue` to Foundation's `NSString` in a second `declare
            // module "objc:Foundation"` block -- declares members of that
            // class.
            Some(syntax::INTERFACE_DECLARATION) if self.in_objc_module(class) => {
                self.merged_objc_class(class)?
            }
            _ => return None,
        };
        let is_static = self
            .node(declaration)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::STATIC);
        Some(ObjcClassMember {
            class: name,
            is_static,
        })
    }

    /// The Objective-C class an interface merges into: the `@ntsClass` of a
    /// class declaration of the same symbol.
    fn merged_objc_class(&self, interface: NodeId) -> Option<String> {
        let name = self
            .children(interface)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))?;
        let record = self
            .snapshot
            .symbols
            .get(self.node(name).symbol?.0 as usize)?;
        record
            .declarations
            .iter()
            .find(|declaration| self.kind_of(**declaration) == Some(syntax::CLASS_DECLARATION))
            .and_then(|class| self.node(*class).native.as_ref()?.class.clone())
    }

    /// Whether `declaration` sits inside `declare module "objc:..."`.
    pub(super) fn in_objc_module(&self, declaration: NodeId) -> bool {
        let mut at = self.node(declaration).parent;
        while let Some(id) = at {
            // The checker names an ambient module by its specifier, quotes
            // and all: `"objc:AppKit"`. The node carries no symbol, so the
            // module's is found by its declaration; this is asked only of a
            // constant already typed `ObjcMeta`, so the scan is rare.
            if self.kind_of(id) == Some(nts_semantic_schema::syntax::MODULE_DECLARATION) {
                return self
                    .snapshot
                    .symbols
                    .iter()
                    .find(|record| record.declarations.contains(&id))
                    .is_some_and(|record| {
                        record
                            .name
                            .public_name()
                            .is_some_and(|name| name.trim_matches('"').starts_with("objc:"))
                    });
            }
            at = self.node(id).parent;
        }
        false
    }

    /// The Objective-C message a declaration tagged `@ntsSelector` sends.
    ///
    /// Refused here, where the declaration is in hand, for everything the call
    /// could not honour:
    /// - A method sends to `this`, and a function to the class `@ntsClass`
    ///   names. A function with no class has no receiver.
    /// - One argument per colon, because the selector is the method's
    ///   signature. `initWithUTF8String` with an argument would send a message
    ///   the class answers with a different method, or with none.
    /// - No variadic tail and no managed ABI, since the send is a cast to one
    ///   exact C function type. No closures either, because a callback crosses
    ///   into Objective-C as a block, which is A2.
    pub(super) fn objc_send(
        &self,
        call: NodeId,
        declaration: NodeId,
        native: &crate::hir::native::Function,
        selector: String,
        class_send: Option<String>,
    ) -> Result<crate::hir::native::Send, Diagnostic> {
        let attributes = self.node(declaration).native.as_deref();
        if attributes.is_some_and(|n| n.symbol.is_some()) {
            return Err(self.unsupported(call, "a declaration that is both an Objective-C message (`@ntsSelector`) and a C function (`@ntsSymbol`)"));
        }
        if !crate::hir::native::Send::is_selector(&selector) {
            return Err(self.unsupported(
                call,
                "@ntsSelector names one selector, as in `@ntsSelector initWithUTF8String:`",
            ));
        }
        // A property's accessors send to `this` as a method does. A member of
        // an Objective-C class a binding declares sends to its instance, or
        // to its class when it is `static`; and an explicit class send -- the
        // `alloc` of a `new` -- goes to the class it names.
        let (method, class) = match (class_send, self.objc_class_member(declaration)) {
            (Some(class), _) => (false, Some(class)),
            (None, Some(member)) if member.is_static => (false, Some(member.class)),
            (None, Some(_)) => (true, None),
            (None, None) => (
                matches!(
                    self.kind_of(declaration),
                    Some(syntax::METHOD_SIGNATURE | syntax::PROPERTY_SIGNATURE)
                ),
                attributes.and_then(|n| n.class.clone()),
            ),
        };
        match (method, &class) {
            (true, Some(_)) => {
                return Err(self.unsupported(
                    call,
                    "@ntsClass on a method, whose receiver is already `this`",
                ));
            }
            (false, None) => {
                return Err(self.unsupported(call, "an Objective-C message with no receiver: `this` on a method, or `@ntsClass` on a function"));
            }
            (false, Some(name)) if !crate::hir::native::is_c_identifier(name) => {
                return Err(self.unsupported(
                    call,
                    "@ntsClass names one Objective-C class, as in `@ntsClass NSString`",
                ));
            }
            _ => {}
        }
        if native.variadic.is_some() || native.convention != crate::hir::native::Convention::C {
            return Err(self.unsupported(call, "an Objective-C message with a variadic tail or a managed ABI, which a cast to one C function type cannot carry"));
        }
        if native.roles.iter().any(|role| {
            let role = match role {
                crate::hir::native::Role::Label { inner, .. } => inner.as_ref(),
                role => role,
            };
            !matches!(
                role,
                crate::hir::native::Role::Plain
                    | crate::hir::native::Role::String(_)
                    | crate::hir::native::Role::Block { .. }
                    | crate::hir::native::Role::Label { .. }
                    | crate::hir::native::Role::NSString
                    | crate::hir::native::Role::NSArray(_)
                    | crate::hir::native::Role::NSDictionary(_)
                    | crate::hir::native::Role::NSSet(_)
                    | crate::hir::native::Role::ErrorSlot { .. }
            )
        }) {
            return Err(self.unsupported(call, "an Objective-C message taking a C callback, an array or an error slot; a callback crosses as a `Block<F>`"));
        }
        // The *message's* arguments: the declared parameters less the
        // receiver. Not the C arity, which also counts `self` and `_cmd` --
        // `uppercaseString` has no colon and a two-parameter C signature.
        let arguments = native.parameters.len() - usize::from(method);
        if crate::hir::native::Send::arity(&selector) != arguments {
            return Err(self.unsupported(
                call,
                &format!(
                    "an Objective-C message whose selector `{selector}` takes {} argument(s) where the declaration passes {arguments}: one colon per argument",
                    crate::hir::native::Send::arity(&selector)
                ),
            ));
        }
        // An object the program counts is ARC's to retain and release. A
        // binding that still declares `release` (as A1a's had to) would
        // release behind the count's back: a use-after-free in a program that
        // compiled the day before.
        let counted_receiver = method
            && matches!(&native.parameters[0], crate::hir::native::Type::Pointer(pointee) if pointee.counting().is_some());
        if counted_receiver && crate::hir::native::ARC_OWNED_SELECTORS.contains(&selector.as_str())
        {
            return Err(self.unsupported(
                call,
                &format!("`{selector}` sent to an Objective-C object the program counts, which ARC reserves: the compiler retains and releases it"),
            ));
        }
        Ok(crate::hir::native::Send {
            selector,
            class,
            super_of: self.super_send.clone(),
        })
    }

    pub(super) fn optional_method_presence(
        &mut self,
        id: NodeId,
        operator: u16,
        lhs: NodeId,
        rhs: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        if !matches!(
            operator,
            syntax::EQUALS_EQUALS_TOKEN
                | syntax::EQUALS_EQUALS_EQUALS_TOKEN
                | syntax::EXCLAMATION_EQUALS_TOKEN
                | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
        ) {
            return None;
        }
        let positive = matches!(
            operator,
            syntax::EQUALS_EQUALS_TOKEN | syntax::EQUALS_EQUALS_EQUALS_TOKEN
        );
        // Either order: `o.m !== undefined` and `undefined !== o.m` ask the
        // same thing, as do both orders of the `typeof` form.
        let (access, present) = self
            .presence_operand(lhs, rhs, positive)
            .or_else(|| self.presence_operand(rhs, lhs, positive))?;
        if self.kind_of(access) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(access);
        let (Some(&object), Some(&member)) = (parts.first(), parts.last()) else {
            return None;
        };
        if object == member {
            return None;
        }
        let key = self.property_key(member)?;
        let receiver_ty = *self.snapshot.node_types.get(&object)?;
        if !self.declares_an_optional_method(receiver_ty, &key) {
            return None;
        }
        // **`present` and not the operator from here on.** Four comparisons
        // reach this and two of each pair mean the same thing, so the token was
        // being normalised back into a token and re-read twice -- one fact with
        // three spellings inside twenty lines, which is the shape of every
        // defect found today.
        Some((|| {
            let Some((_, has_it)) = self.has_the_slot(id, object, &key)? else {
                // Nothing in the program defines it, so no runtime value can
                // carry the slot and the answer is a constant: absent.
                let origin = self.origin(id);
                return Ok(self.push(OpKind::ConstBool(!present), HirType::Bool, origin));
            };
            // `InstanceOf` answers *present*, so a test asking for absent is
            // its negation.
            if !present {
                let origin = self.origin(id);
                return Ok(self.push(
                    OpKind::Unary {
                        op: UnOp::Not,
                        operand: has_it,
                    },
                    HirType::Bool,
                    origin,
                ));
            }
            Ok(has_it)
        })())
    }
}

/// How a call to a method of a class the program writes over an
/// Objective-C class dispatches, where a subclass overrides it
/// (`FuncBuilder::objc_dispatch`).
pub(super) struct ObjcDispatch {
    /// Each of the program's classes from the method's class down, compared
    /// with the receiver's own class.
    pub(super) exact: Vec<ObjcArm>,
    /// Each class that overrides the method, deepest first, asked
    /// `isKindOfClass:` for a class the runtime made below it.
    pub(super) overriders: Vec<ObjcArm>,
    /// The method itself, where nothing else answered.
    base: ObjcArm,
}

/// One arm of an [`ObjcDispatch`]: where the receiver is a `tested`, the
/// method `method` that `owner` implements answers.
#[derive(Clone, Copy)]
pub(super) struct ObjcArm {
    pub(super) tested: NodeId,
    owner: NodeId,
    method: NodeId,
}
