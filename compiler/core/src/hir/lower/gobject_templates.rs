//! Read `GObject` template and property declarations and emit their callback/accessor bodies.

use super::{
    Callee, Copy, Diagnostic, Facts, Func, FuncBuilder, HirType, LiteralValue, Lowered,
    LoweringSnapshot, ManagedType, MemberKind, NodeId, OpKind, Origin, Param, ParamShape, Place,
    SemanticSnapshot, Shared, Terminator, TypeId, TypeKind, ValueId, describe, foreign_class_name,
    instance_type_of, is_static_member, note_uncompiled, program_superclass, syntax, synthesized,
    template_handlers,
};

/// A class's own `static` field `name`: `None` when it has none.
fn static_field(snapshot: &LoweringSnapshot<'_>, class: NodeId, name: &str) -> Option<NodeId> {
    let probe = FuncBuilder::probe(snapshot);
    probe.children(class).into_iter().find(|&member| {
        probe.kind_of(member) == Some(syntax::PROPERTY_DECLARATION)
            && is_static_member(snapshot, member)
            && probe.children(member).into_iter().any(|child| {
                probe.kind_of(child) == Some(syntax::IDENTIFIER)
                    && probe
                        .node(child)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        == Some(name)
            })
    })
}

/// What a class's `static` field holds, as GJS's registration reads
/// `GTypeName` and `Template`.
pub(super) enum StaticValue {
    /// A string literal: the field's type, which the checker keeps for a
    /// `readonly` one, or its initialiser -- written `template: string`, as a
    /// class over one with a template has to, since its literal type would
    /// not extend the parent's.
    Literal(String),
    /// Anything else, known only once the module has run.
    Computed,
    /// GTK requires Unicode UTF-8, unlike JavaScript's UTF-16 strings.
    Unrepresentable,
}

/// What a class's own `static` field `name` holds: `None` when it has none.
pub(super) fn static_value(
    snapshot: &LoweringSnapshot<'_>,
    class: NodeId,
    name: &str,
) -> Option<StaticValue> {
    let member = static_field(snapshot, class, name)?;
    if let Some(TypeKind::Literal(LiteralValue::String(text))) = snapshot
        .node_types
        .get(&member)
        .and_then(|ty| snapshot.types.get(ty.0 as usize))
        .map(|record| &record.kind)
    {
        return Some(text.as_utf8().map_or(StaticValue::Unrepresentable, |text| {
            StaticValue::Literal(text.to_owned())
        }));
    }
    let probe = FuncBuilder::probe(snapshot);
    let literal = probe.children(member).into_iter().find_map(|child| {
        matches!(
            probe.kind_of(child),
            Some(syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL | syntax::STRING_LITERAL)
        )
        .then(|| probe.node(child).text.clone())
        .flatten()
    });
    Some(literal.map_or(StaticValue::Computed, |text| {
        text.as_utf8().map_or(StaticValue::Unrepresentable, |text| {
            StaticValue::Literal(text.to_owned())
        })
    }))
}

/// The template a class is built from, `static readonly template`, and the
/// children it names: each `declare`d field of a `GObject` handle type, by
/// its name as the child's id. Its text is the literal, or -- a value known
/// only at run time, GJS's `Template: workbench.template` -- what the class's
/// reader answers (`template_reader`). `None` for a class with no template.
pub(super) fn gobject_template(
    snapshot: &LoweringSnapshot<'_>,
    class: NodeId,
) -> Option<crate::hir::Template> {
    let text = match static_value(snapshot, class, "template")? {
        StaticValue::Literal(text) => crate::hir::TemplateText::Literal(text),
        StaticValue::Computed => crate::hir::TemplateText::Read(format!(
            "{}#template",
            foreign_class_name(snapshot, class)?
        )),
        StaticValue::Unrepresentable => return None, // refused by register_gobject_class
    };
    Some(crate::hir::Template {
        text,
        children: template_children(snapshot, class)
            .into_iter()
            .map(|(name, _)| name)
            .collect(),
        callbacks: Vec::new(),
    })
}

/// The handlers a template names, where the compiler can read them: from XML
/// written as a literal. `None` for a template known only at run time, or
/// one loaded from a URI, whose names GTK resolves when it builds an
/// instance, as it does for GJS.
pub(super) fn known_handlers(template: &crate::hir::Template) -> Option<Vec<String>> {
    match &template.text {
        crate::hir::TemplateText::Literal(text)
            if !text.starts_with("resource:///") && !text.starts_with("file:///") =>
        {
            Some(template_handlers(text))
        }
        _ => None,
    }
}

/// For a class whose template is known only at run time, the function
/// answering it (`{Class}#template`), lowered into the program: `false` when
/// it is refused, and reported, so the class is not registered with a
/// template it cannot read. `true` for every other class.
pub(super) fn template_reader(
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    class: NodeId,
    shared: &Shared,
    lowered: &mut Lowered,
) -> bool {
    let Some(crate::hir::Template {
        text: crate::hir::TemplateText::Read(reader),
        ..
    }) = gobject_template(snapshot, class)
    else {
        return true;
    };
    let Some(member) = static_field(snapshot, class, "template") else {
        return true;
    };
    let mut builder = shared.builder(snapshot, foreign, Copy::default());
    match builder.lower_template_reader(member, &reader) {
        Ok(func) => {
            lowered.program.funcs.push(func);
            true
        }
        Err(diagnostic) => {
            note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
            lowered.diagnostics.push(diagnostic);
            false
        }
    }
}

/// The children a class's template names: its own `declare`d fields of a
/// `GObject` handle type, with each one's type.
fn template_children(
    snapshot: &SemanticSnapshot,
    class: NodeId,
) -> Vec<(String, nts_semantic_schema::TypeId)> {
    let Some(instance) = instance_type_of(snapshot, class) else {
        return Vec::new();
    };
    let Some(TypeKind::Object { properties }) = snapshot
        .types
        .get(instance.0 as usize)
        .map(|record| &record.kind)
    else {
        return Vec::new();
    };
    properties
        .iter()
        .filter(|field| field.own && field.kind == MemberKind::Field)
        .filter(|field| {
            field.declaration.and_then(|node| snapshot.nodes.get(node.0 as usize)).is_some_and(|node| {
                node.modifiers.contains(nts_semantic_schema::DeclarationModifiers::DECLARE)
            })
        })
        .filter(|field| {
            matches!(crate::hir::native::pointer(snapshot, field.ty), Some(crate::hir::native::Pointee::Opaque(ref handle)) if handle.family == crate::hir::native::Family::GObject)
        })
        .filter_map(|field| field.name.public_name().map(|name| (name.to_owned(), field.ty)))
        .collect()
}

/// The fields a class declares as `GObject` properties (`Property<T>` in
/// `c:types`), in the order it writes them, each with its kind: a `number`
/// (`d`), a `boolean` (`b`), a `string` (`s`) or a `GObject` handle (`o`).
/// Anything else marked is refused by name.
pub(super) fn property_fields(
    snapshot: &SemanticSnapshot,
    class: NodeId,
) -> Result<Vec<(String, char)>, String> {
    let Some(instance) = instance_type_of(snapshot, class) else {
        return Ok(Vec::new());
    };
    let kind = |ty: nts_semantic_schema::TypeId| {
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind)
    };
    let marked = |ty: nts_semantic_schema::TypeId| {
        crate::hir::native::schema::property(snapshot, ty, "__c_property").is_some()
    };
    let Some(TypeKind::Object { properties }) = kind(instance) else {
        return Ok(Vec::new());
    };
    let mut fields = Vec::new();
    for field in properties
        .iter()
        .filter(|p| p.own && p.kind == MemberKind::Field)
    {
        // `Property<boolean>` distributes: `(true & P) | (false & P)`.
        let parts: Vec<nts_semantic_schema::TypeId> = match kind(field.ty) {
            Some(TypeKind::Union(parts)) => parts.clone(),
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => vec![field.ty],
            _ => vec![field.ty],
        };
        if !parts.iter().all(|part| marked(*part)) {
            continue;
        }
        let under = |part: nts_semantic_schema::TypeId| -> Vec<nts_semantic_schema::TypeId> {
            match kind(part) {
                Some(TypeKind::Intersection(pieces)) => pieces.clone(),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => vec![part],
                _ => vec![part],
            }
        };
        let pieces: Vec<nts_semantic_schema::TypeId> =
            parts.iter().flat_map(|part| under(*part)).collect();
        let has =
            |want: fn(&TypeKind) -> bool| pieces.iter().any(|piece| kind(*piece).is_some_and(want));
        let property_kind = if has(|k| matches!(k, TypeKind::Number)) {
            'd'
        } else if has(|k| matches!(k, TypeKind::String)) {
            's'
        } else if has(|k| {
            matches!(
                k,
                TypeKind::Boolean | TypeKind::Literal(LiteralValue::Boolean(_))
            )
        }) {
            'b'
        } else if matches!(
            crate::hir::native::pointer(snapshot, field.ty),
            Some(crate::hir::native::Pointee::Opaque(ref handle)) if handle.family == crate::hir::native::Family::GObject
        ) {
            'o'
        } else {
            return Err(format!(
                "a property `{}` of type {}, where a property is a `number`, a `boolean`, a `string` or a GObject",
                field.name,
                describe(snapshot, field.ty)
            ));
        };
        fields.push((
            field
                .name
                .public_name()
                .ok_or_else(|| format!("a native property `{}` without a string key", field.name))?
                .to_owned(),
            property_kind,
        ));
    }
    Ok(fields)
}

/// Where `property` stands among the properties `class` declares: its id,
/// less one.
fn fields_index(snapshot: &SemanticSnapshot, class: NodeId, property: &str) -> usize {
    property_fields(snapshot, class)
        .ok()
        .and_then(|fields| fields.iter().position(|(name, _)| name == property))
        .unwrap_or(0)
}

impl FuncBuilder<'_> {
    /// A method a template names as a signal's handler: lowered as any method,
    /// with an entry point shaped as a virtual function's -- the instance
    /// first, then the method's own parameters in C -- which the backend's
    /// shim reaches with the instance moved from last, where GTK passes it.
    pub(super) fn lower_template_callback(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
        name: &str,
    ) -> Result<(Func, Option<crate::hir::ForeignMethod>), Diagnostic> {
        let entry = self.template_callback_entry(class, member, instance, name)?;
        self.lower_template_callback_with(class, member, instance, name, entry)
    }

    /// The method `name` lowered with `entry`, its entry point as a
    /// template's handler.
    pub(super) fn lower_template_callback_with(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
        name: &str,
        entry: crate::hir::native::FnPointer,
    ) -> Result<(Func, Option<crate::hir::ForeignMethod>), Diagnostic> {
        let func = self.lower_method_of(class, member, instance)?;
        let method = crate::hir::ForeignMethod {
            dispatch: crate::hir::Dispatch::Selector(format!("callback {name}")),
            function: func.name.clone(),
            signature: std::sync::Arc::new(entry),
            declared_at: None,
        };
        Ok((func, Some(method)))
    }

    /// The entry point a method has as a template's handler: the instance,
    /// then its own parameters, each in C. Refused, by name, for a parameter
    /// or a result with no C type.
    pub(super) fn template_callback_entry(
        &self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
        name: &str,
    ) -> Result<crate::hir::native::FnPointer, Diagnostic> {
        let receiver = instance
            .or_else(|| instance_type_of(self.snapshot, class))
            .and_then(|ty| crate::hir::native::pointer(self.snapshot, ty))
            .ok_or_else(|| {
                self.unsupported(
                    member,
                    "a template's handler on a class whose instances are not a GObject handle",
                )
            })?;
        let signature = crate::hir::generics::declared_signature(self.snapshot, member)
            .cloned()
            .ok_or_else(|| self.unsupported(member, "a template's handler with no signature"))?;
        let mut parameters = vec![crate::hir::native::Type::Pointer(receiver)];
        for parameter in &signature.parameters {
            parameters.push(
                crate::hir::native::abi_type(self.snapshot, parameter.ty).ok_or_else(|| {
                    self.unsupported(
                        member,
                        &format!(
                            "a template's handler `{name}` whose parameter `{}` has no C type",
                            parameter.name
                        ),
                    )
                })?,
            );
        }
        let result = crate::hir::native::abi_type(self.snapshot, signature.return_type)
            .ok_or_else(|| {
                self.unsupported(
                    member,
                    &format!("a template's handler `{name}` whose result has no C type"),
                )
            })?;
        Ok(crate::hir::native::FnPointer::spell(parameters, result))
    }

    /// `{Class}#template`: the string a class's `static template` holds, for
    /// a template known only at run time. `class_init` calls it when GTK
    /// first sets the class up, after the module has run the initialiser.
    fn lower_template_reader(&mut self, member: NodeId, name: &str) -> Result<Func, Diagnostic> {
        let origin = self.origin(member);
        // The symbol is the declaration's name's, as a read of it finds it.
        let symbol = self
            .children(member)
            .into_iter()
            .find(|&child| self.kind_of(child) == Some(syntax::IDENTIFIER))
            .and_then(|name| self.node(name).symbol)
            .ok_or_else(|| self.unsupported(member, "a `static template` with no symbol"))?;
        if let Some(reason) = self.module.unsupported.get(&symbol.0) {
            let reason = reason.clone();
            return Err(self.unsupported(member, &reason));
        }
        let global = self
            .module
            .variables
            .get(&symbol.0)
            .copied()
            .ok_or_else(|| {
                self.unsupported(member, "a `static template` the module does not store")
            })?;
        let ty = self.module.types[global as usize].clone();
        if ty != HirType::Managed(ManagedType::String) {
            return Err(self.unsupported(
                member,
                "a `static template` that is not a `string`: GJS's `Template` as XML or a URI",
            ));
        }
        self.this = None;
        self.returns = ty.clone();
        let read = self.push(OpKind::GlobalGet(global), ty.clone(), origin.clone());
        self.terminate(Terminator::Return(Some(read)));
        Ok(self.finish(name.to_owned(), Vec::new(), ty, origin, false))
    }

    /// The thunk a write of `member` notifies through, where `member` is a
    /// property (`Property<T>`) of a class in the chain of `class_ty`: the
    /// declaring class's own, numbered as its registration numbers them.
    pub(super) fn property_notify_thunk(
        &self,
        class_ty: TypeId,
        member: &str,
    ) -> Option<crate::hir::native::GObjectThunk> {
        for ty in self.objc_chain(class_ty) {
            let symbol = self.snapshot.types.get(ty.0 as usize)?.symbol?;
            let class = self
                .snapshot
                .symbols
                .get(symbol.0 as usize)?
                .declarations
                .iter()
                .copied()
                .find(|d| self.kind_of(*d) == Some(syntax::CLASS_DECLARATION))?;
            let fields = property_fields(self.snapshot, class).ok()?;
            if let Some(at) = fields.iter().position(|(name, _)| name == member) {
                let name = foreign_class_name(self.snapshot, class)?;
                return Some(crate::hir::native::GObjectThunk::Notify {
                    class: name,
                    index: at,
                });
            }
        }
        None
    }

    /// The function `get_property` (`setter` false) or `set_property` calls
    /// for one property of a `GObject` class the program writes: the field of
    /// the instance's state, read and answered, or written -- through
    /// `write_place`, so it notifies as any write of the field does.
    pub(super) fn lower_gobject_property_accessor(
        &mut self,
        class: NodeId,
        name: &str,
        (index, class_ty): (usize, TypeId),
        property: &str,
        setter: bool,
    ) -> Result<Func, Diagnostic> {
        let origin = self.origin(class);
        let instance = instance_type_of(self.snapshot, class)
            .and_then(|ty| self.represent(ty))
            .ok_or_else(|| self.unsupported(class, "a GObject class with no handle type"))?;
        let layout = self.objc_state_layout(class, index, class_ty)?;
        let field = layout.index_of(property).ok_or_else(|| {
            self.unsupported(
                class,
                &format!("a property `{property}` that is not a field of the class's state"),
            )
        })?;
        let field_ty = layout.fields[field as usize].ty.clone();
        // The parameters first: each is the value its position names.
        let receiver = self.push(OpKind::Param(0), instance.clone(), origin.clone());
        self.this = Some(receiver);
        let mut params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: instance,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        let value = setter.then(|| {
            params.push(Param {
                name: "value".to_owned(),
                shape: ParamShape::Ordinary,
                ty: field_ty.clone(),
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
            self.push(OpKind::Param(1), field_ty.clone(), origin.clone())
        });
        let state_ty = HirType::Managed(ManagedType::Object(crate::hir::objc_state_type(index)));
        let state = self.runtime_call(
            "nts_gobject_state",
            vec![receiver],
            state_ty,
            origin.clone(),
        );
        if let Some(value) = value {
            let at = fields_index(self.snapshot, class, property);
            self.notifying.insert(
                (state, field),
                (
                    receiver,
                    crate::hir::native::GObjectThunk::Notify {
                        class: name.to_owned(),
                        index: at,
                    },
                ),
            );
            self.returns = HirType::Void;
            self.write_place(
                class,
                &Place::Field {
                    object: state,
                    field,
                },
                value,
            )?;
            self.terminate(Terminator::Return(None));
            Ok(self.finish(
                format!("{name}#set_{property}"),
                params,
                HirType::Void,
                origin,
                false,
            ))
        } else {
            let value = self.push(
                OpKind::FieldGet {
                    object: state,
                    field,
                },
                field_ty.clone(),
                origin.clone(),
            );
            self.returns = field_ty.clone();
            self.terminate(Terminator::Return(Some(value)));
            Ok(self.finish(
                format!("{name}#get_{property}"),
                params,
                field_ty,
                origin,
                false,
            ))
        }
    }

    /// The property requirement named `name` of a protocol `class` adopts, or
    /// one that protocol refines: `UIWindowSceneDelegate`'s `window`.
    pub(super) fn property_requirement(&self, class: NodeId, name: &str) -> Option<NodeId> {
        let mut pending = self.objc_protocols(class);
        let mut seen = rustc_hash::FxHashSet::default();
        while let Some(protocol) = pending.pop() {
            if !seen.insert(protocol) {
                continue;
            }
            let found = self.children(protocol).into_iter().find(|member| {
                self.kind_of(*member) == Some(syntax::PROPERTY_SIGNATURE)
                    && self.member_name(*member).as_deref() == Some(name)
            });
            if found.is_some() {
                return found;
            }
            pending.extend(
                crate::hir::native::implemented(self.snapshot, protocol)
                    .into_iter()
                    .filter(|base| self.in_objc_module(*base)),
            );
        }
        None
    }

    /// `this.title`, where `title` is a child the template of the receiver's
    /// class, or of a class the program wrote below it, names (`declare
    /// readonly title: GtkLabel`): the template's own, which
    /// `nts_gobject_child_{Class}_{i}` lends -- the template holds it for as
    /// long as the widget lives. `None` for any other member.
    pub(super) fn template_child(
        &mut self,
        access: NodeId,
        receiver: ValueId,
        member: &str,
    ) -> Option<ValueId> {
        let HirType::NativePointer(pointee) = self.values[receiver.0 as usize].ty.clone() else {
            return None;
        };
        let node = *self.children(access).first()?;
        let ty = self.class_behind(*self.snapshot.node_types.get(&node)?);
        let symbol = self.snapshot.types.get(ty.0 as usize)?.symbol?;
        let class = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .copied()
            .find(|d| self.kind_of(*d) == Some(syntax::CLASS_DECLARATION))?;
        crate::hir::native::gobject_parent(self.snapshot, class)?;
        // The class whose template names it: `Wide extends Panel` reads
        // `title` from `Panel`'s. Bounded: a chain is as long as the classes
        // written.
        let mut class = class;
        let mut found = None;
        for _ in 0..64 {
            if gobject_template(self.snapshot, class).is_some() {
                let children = template_children(self.snapshot, class);
                if let Some(at) = children.iter().position(|(name, _)| name == member) {
                    found = Some((at, children[at].1));
                    break;
                }
            }
            class = program_superclass(self.snapshot, class)?;
        }
        let (at, child) = found?;
        let child = crate::hir::native::pointer(self.snapshot, child)?;
        let name = foreign_class_name(self.snapshot, class)?;
        let mut read = synthesized(
            &crate::hir::Template::child_thunk(&name, at),
            vec![crate::hir::native::Type::Pointer(pointee)],
            crate::hir::native::Type::Pointer(child.clone()),
            None,
            Vec::new(),
        );
        read.thunk = Some(crate::hir::native::GObjectThunk::Child {
            class: name,
            index: at,
        });
        let origin = self.origin(access);
        Some(self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(read)),
                args: vec![receiver],
                frame: None,
            },
            HirType::NativePointer(child),
            origin,
        ))
    }

    /// After a store into a `GObject` property's field (`notifying`): the
    /// change `GObject` announces (`notify::name`), by the property's spec.
    pub(super) fn notify_property(
        &mut self,
        id: NodeId,
        slot: (ValueId, u32),
        origin: Origin,
    ) -> Result<(), Diagnostic> {
        let Some((instance, thunk)) = self.notifying.get(&slot).cloned() else {
            return Ok(());
        };
        let void = HirType::NativePointer(crate::hir::native::Pointee::Void);
        let instance = self.coerce(instance, &void, id)?;
        let mut notify = synthesized(
            &thunk.symbol(),
            vec![crate::hir::native::Type::Pointer(
                crate::hir::native::Pointee::Void,
            )],
            crate::hir::native::Type::Void,
            None,
            Vec::new(),
        );
        notify.thunk = Some(thunk);
        self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(notify)),
                args: vec![instance],
                frame: None,
            },
            HirType::Void,
            origin,
        );
        Ok(())
    }
}
