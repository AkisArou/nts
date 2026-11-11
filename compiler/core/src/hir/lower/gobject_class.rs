//! Register `GObject` classes and emit their constructors, vfunc entries, and signal calls.

use super::{
    BinOp, Callee, Copy, Diagnostic, Facts, Func, FuncBuilder, HirType, LayoutCollector, Lent,
    LiteralValue, Lowered, LoweredMember, LoweringSnapshot, MadeBy, NodeId, OpKind, Param,
    ParamShape, ParameterTags, SemanticSnapshot, Shared, StaticValue, Terminator, TypeId, TypeKind,
    ValueId, describe, foreign_class_name, gobject_template, instance_type_of, is_override_name,
    known_handlers, note_uncompiled, property_fields, static_value, syntax, synthesized,
};

/// A class the program writes over a `GObject` class, recorded as the backend
/// will register it (`Program::foreign_classes`): its own name, the function
/// answering its parent's `GType`, the class struct slot each override fills,
/// and the maker of the object holding its fields (`{Class}#state`), which
/// the support file's `instance_init` calls and `finalize` releases.
pub(super) fn register_gobject_class(
    snapshot: &LoweringSnapshot<'_>,
    class: NodeId,
    parent: crate::hir::native::GType,
    (methods, properties): (
        Vec<crate::hir::ForeignMethod>,
        Vec<crate::hir::ForeignProperty>,
    ),
    state: Option<String>,
    lowered: &mut Lowered,
) {
    let Some(name) = foreign_class_name(snapshot, class) else {
        return;
    };
    let refuse = |lowered: &mut Lowered, why: &str| {
        let diagnostic = FuncBuilder::probe(snapshot).unsupported(class, why);
        note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
        lowered.diagnostics.push(diagnostic);
    };
    for field in ["GTypeName", "template"] {
        if matches!(
            static_value(snapshot, class, field),
            Some(StaticValue::Unrepresentable)
        ) {
            return refuse(
                lowered,
                &format!(
                    "a `static {field}` containing unpaired UTF-16 code units, which GTK's UTF-8 boundary cannot represent"
                ),
            );
        }
    }
    let type_name = match static_value(snapshot, class, "GTypeName") {
        None => format!("Nts_{name}"),
        Some(StaticValue::Literal(type_name)) => type_name,
        Some(StaticValue::Computed) => {
            return refuse(
                lowered,
                "a `static GTypeName` that is not a string literal: a class's type name is known when it compiles",
            );
        }
        Some(StaticValue::Unrepresentable) => {
            unreachable!("the GTK text boundary was checked above")
        }
    };
    // A template's handlers are reached through the template, not a slot.
    let (callbacks, methods): (
        Vec<crate::hir::ForeignMethod>,
        Vec<crate::hir::ForeignMethod>,
    ) = methods
        .into_iter()
        .partition(|method| method.selector().starts_with("callback "));
    let mut template = gobject_template(snapshot, class);
    if let Some(template) = &mut template {
        template.callbacks = callbacks;
        let missing = known_handlers(template)
            .unwrap_or_default()
            .into_iter()
            .find(|handler| {
                !template
                    .callbacks
                    .iter()
                    .any(|callback| callback.selector() == format!("callback {handler}"))
            });
        if let Some(handler) = missing {
            let diagnostic = FuncBuilder::probe(snapshot).unsupported(
                class,
                &format!("a template whose handler `{handler}` is no method of the class"),
            );
            note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
            lowered.diagnostics.push(diagnostic);
            return;
        }
    }
    // Signals are declared on the class over a binding's (`extends
    // GtkButton<{ ... }>`); one over a class the program wrote inherits its
    // parent's, which `emit` finds by name on the instance's type.
    let signals = if parent.program_class().is_some() {
        Vec::new()
    } else {
        match gobject_signals(snapshot, class) {
            Ok(signals) => signals,
            Err(why) => {
                let diagnostic = FuncBuilder::probe(snapshot).unsupported(class, &why);
                note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
                lowered.diagnostics.push(diagnostic);
                return;
            }
        }
    };
    lowered
        .program
        .foreign_classes
        .push(crate::hir::ForeignClass {
            family: crate::hir::native::Family::GObject,
            name,
            type_name: Some(type_name),
            superclass: crate::hir::native::ForeignParent::GObject(parent),
            methods,
            protocols: gobject_interfaces(snapshot, class),
            state,
            composition: None,
            signals,
            properties,
            template,
        });
}

/// The signature a binding declares a virtual function with: a class's is a
/// method, an interface's an optional one (`vfunc_get_item?(...)`, as C leaves
/// a slot it does not fill to the default), typed with `undefined` beside it.
fn vfunc_declaration_signature(
    snapshot: &SemanticSnapshot,
    declaration: NodeId,
) -> Option<&nts_semantic_schema::SignatureRecord> {
    if let Some(signature) = crate::hir::generics::declared_signature(snapshot, declaration) {
        return Some(signature);
    }
    let kind = |ty: nts_semantic_schema::TypeId| {
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind)
    };
    let Some(TypeKind::Union(parts)) = snapshot
        .node_types
        .get(&declaration)
        .and_then(|ty| kind(*ty))
    else {
        return None;
    };
    let mut functions = parts.iter().filter_map(|part| match kind(*part) {
        Some(TypeKind::Function(signature)) => Some(*signature),
        _ => None,
    });
    let signature = functions.next()?;
    if functions.next().is_some()
        || !parts.iter().all(|part| {
            matches!(
                kind(*part),
                Some(TypeKind::Function(_) | TypeKind::Undefined)
            )
        })
    {
        return None;
    }
    snapshot.signatures.get(signature.0 as usize)
}

/// What names the `emit` thunk of a binding's own signal: `g`, then each
/// parameter's C type -- `p` a pointer, `B` a `bool`, a scalar by its name
/// (`Int32`) -- where a program's signal is named by its kinds (`d`, `b`, `s`,
/// `o`); then, for a signal that answers, `R` and its result's the same way
/// (`gUInt...RInt`). A record passed by value has no place in
/// `g_signal_emit`'s varargs.
fn binding_signal_kinds(
    parameters: &[crate::hir::native::Type],
    result: &crate::hir::native::Type,
) -> Result<String, String> {
    use std::fmt::Write as _;
    let code = |kinds: &mut String, ty: &crate::hir::native::Type| -> Result<(), String> {
        match ty {
            crate::hir::native::Type::Pointer(_) => kinds.push('p'),
            crate::hir::native::Type::Bool => kinds.push('B'),
            crate::hir::native::Type::Scalar(scalar) => {
                let _ = write!(kinds, "{scalar:?}");
            }
            other => {
                return Err(format!(
                    "`emit` of a signal with a value of C type {other:?}"
                ));
            }
        }
        Ok(())
    };
    let mut kinds = String::from("g");
    for parameter in parameters {
        code(&mut kinds, parameter)?;
    }
    if !matches!(result, crate::hir::native::Type::Void) {
        kinds.push('R');
        code(&mut kinds, result)?;
    }
    Ok(kinds)
}

/// The interfaces a class implements (`extends GObject<{}, GListModelImplementation>`),
/// read off its instance type's `__c_ifaces` (see `Signalled` in `c:types`):
/// each as its interface struct and `GType` function, `GListModelInterface
/// g_list_model_get_type`, sorted. A subclass carries its parent's, and adds
/// them again, which `GLib` answers with a copy of the parent's table for it
/// to override in.
fn gobject_interfaces(snapshot: &SemanticSnapshot, class: NodeId) -> Vec<String> {
    let kind = |ty: nts_semantic_schema::TypeId| {
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind)
    };
    let Some(instance) = instance_type_of(snapshot, class) else {
        return Vec::new();
    };
    let Some(declared) = crate::hir::native::schema::property(snapshot, instance, "__c_ifaces")
    else {
        return Vec::new();
    };
    // Optional, so `"A" | "B" | undefined`.
    let parts = match kind(declared.ty) {
        Some(TypeKind::Union(parts)) => parts.clone(),
        _ => vec![declared.ty],
    };
    let mut interfaces: Vec<String> = parts
        .into_iter()
        .filter_map(|part| match kind(part) {
            Some(TypeKind::Literal(LiteralValue::String(text))) => {
                text.as_utf8().map(str::to_owned)
            }
            _ => None,
        })
        .collect();
    interfaces.sort();
    interfaces.dedup();
    interfaces
}

/// The class the program wrote that `class` extends (`class Wide extends
/// Panel`): `None` over a binding's class, or none.
pub(super) fn program_superclass(snapshot: &LoweringSnapshot<'_>, class: NodeId) -> Option<NodeId> {
    let probe = FuncBuilder::probe(snapshot);
    let base = probe
        .children(class)
        .into_iter()
        .filter(|child| probe.kind_of(*child) == Some(syntax::HERITAGE_CLAUSE))
        .flat_map(|clause| probe.children(clause))
        .find_map(|expression| probe.children(expression).first().copied())?;
    crate::hir::native::schema::class_declaration(snapshot, probe.node(base).symbol?)
}

/// The names a template's `<signal>` elements give as their handlers, in the
/// order they appear.
pub(super) fn template_handlers(xml: &str) -> Vec<String> {
    let mut handlers = Vec::new();
    for (at, _) in xml.match_indices("handler=\"") {
        let rest = &xml[at + "handler=\"".len()..];
        if let Some(end) = rest.find('"') {
            let handler = rest[..end].to_owned();
            if !handlers.contains(&handler) {
                handlers.push(handler);
            }
        }
    }
    handlers
}

/// Each property a class declares, with the compiled functions reading and
/// writing its field (`{Class}#get_{name}`, `{Class}#set_{name}`), which the
/// backend's registration hands `get_property` and `set_property`. Empty for a
/// class with none; a refusal is reported, and the class registers without.
pub(super) fn gobject_properties(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    class: NodeId,
    shared: &Shared,
    lowered: &mut Lowered,
) -> Vec<crate::hir::ForeignProperty> {
    let refuse = |lowered: &mut Lowered, diagnostic: Diagnostic| {
        note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
        lowered.diagnostics.push(diagnostic);
    };
    let fields = match property_fields(snapshot, class) {
        Ok(fields) => fields,
        Err(why) => {
            refuse(
                lowered,
                FuncBuilder::probe(snapshot).unsupported(class, &why),
            );
            return Vec::new();
        }
    };
    let Some(name) = foreign_class_name(snapshot, class) else {
        return Vec::new();
    };
    let Some(&(index, class_ty)) = shared.hierarchy.objc_states.get(&name) else {
        return Vec::new();
    };
    let mut properties = Vec::new();
    for (field, kind) in fields {
        let mut accessors = Vec::new();
        for setter in [false, true] {
            let mut builder = shared.builder(snapshot, foreign, Copy::default());
            match builder.lower_gobject_property_accessor(
                class,
                &name,
                (index, class_ty),
                &field,
                setter,
            ) {
                Ok(func) => {
                    accessors.push(func.name.clone());
                    lowered.program.funcs.push(func);
                    layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
                }
                Err(diagnostic) => {
                    refuse(lowered, diagnostic);
                    return Vec::new();
                }
            }
        }
        let [getter, setter] = <[String; 2]>::try_from(accessors).unwrap_or_default();
        properties.push(crate::hir::ForeignProperty {
            name: field,
            kind,
            getter,
            setter,
        });
    }
    properties
}

/// The signals a class declares, read off its instance type's
/// `__c_signals` (see `WithSignals` in `c:types`), in the order it writes
/// them. A parameter is a `number` (`d`), a `boolean` (`b`), a `string`
/// (`s`) or a `GObject` handle (`o`); anything else is refused by name.
fn gobject_signals(
    snapshot: &SemanticSnapshot,
    class: NodeId,
) -> Result<Vec<crate::hir::ForeignSignal>, String> {
    let Some(instance) = instance_type_of(snapshot, class) else {
        return Ok(Vec::new());
    };
    signals_of_type(snapshot, instance)
}

/// The signals an instance type carries -- its own and its ancestors', since
/// `__c_signals` is inherited -- with each parameter's kind. One reading for
/// the registration and for `emit`, so the two cannot spell a signal apart.
/// A type parameter (the polymorphic `this` of a method) is read through its
/// constraint.
pub(super) fn signals_of_type(
    snapshot: &SemanticSnapshot,
    instance: nts_semantic_schema::TypeId,
) -> Result<Vec<crate::hir::ForeignSignal>, String> {
    let kind = |ty: nts_semantic_schema::TypeId| {
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind)
    };
    let mut instance = instance;
    let mut seen = rustc_hash::FxHashSet::default();
    loop {
        if !seen.insert(instance) {
            return Err(
                "a cyclic type-parameter constraint while discovering C signals".to_owned(),
            );
        }
        match kind(instance) {
            Some(TypeKind::TypeParameter {
                constraint: Some(constraint),
                ..
            }) => {
                instance = *constraint;
            }
            _ => break,
        }
    }
    let Some(declared) = crate::hir::native::schema::property(snapshot, instance, "__c_signals")
    else {
        return Ok(Vec::new());
    };
    // Optional, so `Sig | undefined`.
    let map = match kind(declared.ty) {
        Some(TypeKind::Union(parts)) => parts
            .iter()
            .copied()
            .find(|part| !matches!(kind(*part), Some(TypeKind::Undefined))),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => Some(declared.ty),
        _ => Some(declared.ty),
    };
    let Some(TypeKind::Object { properties, .. }) = map.and_then(kind) else {
        return Ok(Vec::new());
    };
    let mut signals = Vec::new();
    for signal in properties {
        let Some(TypeKind::Tuple(elements)) = kind(signal.ty) else {
            return Err(format!(
                "a signal `{}` whose parameters are not written as a tuple",
                signal.name
            ));
        };
        let elements = &elements.elements;
        let mut kinds = String::new();
        for element in elements {
            let is_boolean = match kind(*element) {
                Some(TypeKind::Boolean) => true,
                Some(TypeKind::Union(parts)) => parts.iter().all(|part| {
                    matches!(
                        kind(*part),
                        Some(TypeKind::Literal(LiteralValue::Boolean(_)))
                    )
                }),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => false,
                _ => false,
            };
            kinds.push(match kind(*element) {
                Some(TypeKind::Number) => 'd',
                Some(TypeKind::String) => 's',
                _ if is_boolean => 'b',
                _ if matches!(
                    crate::hir::native::pointer(snapshot, *element),
                    Some(crate::hir::native::Pointee::Opaque(ref handle)) if handle.family == crate::hir::native::Family::GObject
                ) => 'o',
                _ => {
                    return Err(format!(
                        "a signal `{}` with a parameter of type {}, where a signal takes a `number`, a `boolean`, a `string` or a GObject",
                        signal.name,
                        describe(snapshot, *element)
                    ));
                }
            });
        }
        signals.push(crate::hir::ForeignSignal {
            name: signal
                .name
                .public_name()
                .ok_or_else(|| format!("a native signal `{}` without a string key", signal.name))?
                .to_owned(),
            kinds,
        });
    }
    Ok(signals)
}

/// A member of a class over a foreign one, lowered by its family's own
/// method: its function joins the program and its record the family's list,
/// or its refusal is noted and reported.
/// A member of a class over a `GObject` class, with the wrapper of its
/// slot's C shape where it is an override answering its outs as a tuple
/// (`VfuncSlot`), which is lowered here and kept beside it -- or refuses the
/// member where the wrapper cannot be made.
pub(super) fn with_vfunc_slot(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    shared: &Shared,
    (lowered_member, slot): (LoweredMember, Option<VfuncSlot>),
    lowered: &mut Lowered,
) -> LoweredMember {
    let Some(slot) = slot else {
        return lowered_member;
    };
    let (func, method) = lowered_member?;
    let mut wrapper = shared.builder(snapshot, foreign, Copy::default());
    let built = wrapper.lower_vfunc_slot(&slot, &func);
    layout_collector.collect(&mut lowered.program, wrapper.layouts.into_layouts());
    lowered.program.funcs.push(built?);
    Ok((func, method))
}

/// An override answering its out parameters as GJS does, as a tuple
/// (`vfunc_measure(o, s): [min, nat, …]`), reached through a wrapper of its
/// slot's C shape: `name`, taking the override's parameters and then a
/// pointer per out, and answering the slot's result (`lower_vfunc_slot`).
pub(super) struct VfuncSlot {
    name: String,
    entry: crate::hir::native::FnPointer,
    /// Per out, in the slot's order: whether GTK may pass NULL for it.
    outs: Vec<bool>,
    /// Whether the tuple's first element is the slot's own C result.
    has_result: bool,
    member: NodeId,
}

impl FuncBuilder<'_> {
    /// A member of a class the program writes over a `GObject` class: the
    /// compiled function, and -- for an override (`is_override_name`) -- the class struct
    /// slot it fills and the C signature the slot is called with, which are
    /// the overridden declaration's (`@ntsVfunc`). A constructor is refused:
    /// the instance is made by `new` with its properties, and a body run
    /// after that has no `super(...)` to open with yet.
    pub(super) fn lower_gobject_member(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<(Func, Option<crate::hir::ForeignMethod>), Diagnostic> {
        if self.kind_of(member) == Some(syntax::CONSTRUCTOR) {
            return Ok((
                self.lower_gobject_constructor(class, member, instance)?,
                None,
            ));
        }
        let name = self
            .member_name(member)
            .ok_or_else(|| self.unsupported(member, "a member whose name the program computes"))?;
        // A handler the class's template names (`<signal handler="...">`):
        // GTK calls it with the signal's arguments and the instance last. A
        // template the compiler cannot read may name any method, so each one
        // a handler could be -- its parameters all C's -- is bound by name,
        // and GTK resolves the template's names against them, as in GJS.
        if let Some(template) = gobject_template(self.snapshot, class) {
            match known_handlers(&template) {
                Some(handlers) => {
                    if handlers.contains(&name) {
                        return self.lower_template_callback(class, member, instance, &name);
                    }
                }
                None => {
                    if !is_override_name(&name)
                        && self.kind_of(member) == Some(syntax::METHOD_DECLARATION)
                        && let Ok(entry) =
                            self.template_callback_entry(class, member, instance, &name)
                    {
                        return self
                            .lower_template_callback_with(class, member, instance, &name, entry);
                    }
                }
            }
        }
        if !is_override_name(&name) {
            return Ok((self.lower_method_of(class, member, instance)?, None));
        }
        // `finalize` is where a class's fields are given back, and the
        // registration installs its own for a class with fields; an override
        // would be written over, and one without chaining up would leak the
        // parent's. `dispose` is the one to override.
        if name == "vfunc_finalize" || name == "vfuncFinalize" {
            return Err(self.unsupported(member, &format!("an override of `{name}`, which gives the class's fields back; override `vfunc_dispose`")));
        }
        let receiver = instance
            .or_else(|| instance_type_of(self.snapshot, class))
            .and_then(|ty| crate::hir::native::pointer(self.snapshot, ty));
        let Some(crate::hir::native::Pointee::Opaque(handle)) = receiver else {
            return Err(self.unsupported(
                member,
                "a virtual function of a class whose instances are not a GObject handle",
            ));
        };
        let interfaces = gobject_interfaces(self.snapshot, class);
        let (declaration, slot) = self.overridden_vfunc(&handle, &interfaces, &name).ok_or_else(|| {
            let implemented = if interfaces.is_empty() { "" } else { ", the interfaces it implements," };
            self.unsupported(member, &format!("`{name}`, which overrides no virtual function of `{}`{implemented} or its ancestors", handle.tag))
        })?;
        let signature = vfunc_declaration_signature(self.snapshot, declaration)
            .cloned()
            .ok_or_else(|| self.unsupported(member, "a virtual function with no signature"))?;
        let this = signature
            .this_type
            .and_then(|ty| crate::hir::native::pointer(self.snapshot, ty))
            .ok_or_else(|| {
                self.unsupported(member, "a virtual function whose instance is not a handle")
            })?;
        // The declaration's tags, read as a call of it reads them: a slot
        // reporting through `GError **error` is `@ntsThrows error`, and its
        // `error?` is that slot rather than an optional some `@ntsDefault` fills.
        let tags = self.parameter_tags(member, Some(declaration))?;
        let outs = self.vfunc_outs(declaration);
        let (entry, has_result) = self.vfunc_entry(member, &this, signature, &tags, &outs)?;
        let func = self.lower_method_of(class, member, instance)?;
        // An override answering its out parameters as a tuple is reached
        // through a wrapper of the slot's C shape, built beside it.
        let function = if outs.is_empty() {
            func.name.clone()
        } else {
            let wrapper = format!("{}#slot", func.name);
            self.vfunc_slot = Some(VfuncSlot {
                name: wrapper.clone(),
                entry: entry.clone(),
                outs,
                has_result,
                member,
            });
            wrapper
        };
        let method = crate::hir::ForeignMethod {
            dispatch: crate::hir::Dispatch::Selector(slot),
            function,
            signature: std::sync::Arc::new(entry),
            declared_at: self.declaring_module(declaration),
        };
        Ok((func, Some(method)))
    }

    /// The out parameters a virtual function's declaration answers as a
    /// tuple (`@ntsVfuncOut minimum? natural?`), each by whether GTK may pass
    /// NULL for it. None for a slot whose outs its declaration takes.
    fn vfunc_outs(&self, declaration: NodeId) -> Vec<bool> {
        self.node(declaration)
            .native
            .as_ref()
            .and_then(|native| native.vfunc_out.as_deref())
            .map(|outs| {
                outs.split_whitespace()
                    .map(|out| out.ends_with('?'))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The C signature of an override's slot, and whether a tuple the
    /// declaration answers starts with the slot's own result. Where the
    /// declaration answers its outs as a tuple, the slot takes a pointer to
    /// each element's C scalar after the ins, and returns the tuple's first
    /// element where there is one more than the outs.
    fn vfunc_entry(
        &self,
        member: NodeId,
        this: &crate::hir::native::Pointee,
        mut signature: nts_semantic_schema::SignatureRecord,
        tags: &ParameterTags,
        outs: &[bool],
    ) -> Result<(crate::hir::native::FnPointer, bool), Diagnostic> {
        let throws = tags
            .throws
            .as_ref()
            .map(|(slot, converter)| (slot.as_str(), converter.as_str()));
        let spell = |signature: &nts_semantic_schema::SignatureRecord| {
            crate::hir::native::vfunc_signature(
                self.snapshot,
                this.clone(),
                signature,
                throws,
                &tags.defaults,
            )
            .map_err(|why| self.unsupported(member, &format!("a virtual function's {why}")))
        };
        if outs.is_empty() {
            return Ok((spell(&signature)?, false));
        }
        let (elements, has_result) = self.vfunc_answer(member, signature.return_type, outs)?;
        signature.return_type = if has_result {
            elements[0]
        } else {
            self.void_type()?
        };
        let entry = spell(&signature)?;
        let mut parameters = entry.parameters.clone();
        for element in &elements[usize::from(has_result)..] {
            match crate::hir::native::abi_type(self.snapshot, *element) {
                Some(crate::hir::native::Type::Scalar(scalar)) => parameters.push(
                    crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Scalar(scalar)),
                ),
                _ => {
                    return Err(self.unsupported(
                        member,
                        "a virtual function's out parameter that is not a C scalar",
                    ));
                }
            }
        }
        Ok((
            crate::hir::native::FnPointer::spell(parameters, (*entry.result).clone()),
            has_result,
        ))
    }

    /// The elements of a tuple a virtual function's declaration answers its
    /// outs as, and whether the first of them is the slot's own C result:
    /// one element more than the outs. A single out with no result is the
    /// value itself, as a call's values form answers one.
    fn vfunc_answer(
        &self,
        id: NodeId,
        answer: TypeId,
        outs: &[bool],
    ) -> Result<(Vec<TypeId>, bool), Diagnostic> {
        let elements = match self
            .snapshot
            .types
            .get(answer.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Tuple(tuple)) if outs.len() > 1 || tuple.elements.len() == 2 => {
                tuple.elements.clone()
            }
            _ => vec![answer],
        };
        let has_result = match elements.len().checked_sub(outs.len()) {
            Some(0) => false,
            Some(1) => true,
            _ => return Err(self.unsupported(
                id,
                "a virtual function whose answer does not match the out parameters its slot takes",
            )),
        };
        Ok((elements, has_result))
    }

    /// The wrapper an override answering its outs as a tuple is reached
    /// through: the slot's C shape -- the override's own parameters, then a
    /// pointer per out -- calling the override, storing each tuple element
    /// through its pointer (where GTK passed one, for an out it may leave
    /// NULL), and answering the slot's result, the tuple's first element.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn lower_vfunc_slot(&mut self, slot: &VfuncSlot, func: &Func) -> Result<Func, Diagnostic> {
        let origin = self.origin(slot.member);
        let mut params = Vec::new();
        let mut arguments = Vec::new();
        for (at, param) in func.params.iter().enumerate() {
            let value = self.push(
                OpKind::Param(u32::try_from(at).unwrap_or(0)),
                param.ty.clone(),
                origin.clone(),
            );
            // C's own argument, so the override's written kind: C passes the
            // type its slot declares, which the override's parameter is.
            params.push(Param {
                name: param.name.clone(),
                shape: ParamShape::Ordinary,
                ty: param.ty.clone(),
                origin: origin.clone(),
                known: Facts::TOP,
                written: param.written,
            });
            arguments.push(value);
        }
        self.this = arguments.first().copied();
        let mut pointers = Vec::new();
        for (at, ty) in slot
            .entry
            .parameters
            .iter()
            .enumerate()
            .skip(func.params.len())
        {
            let ty = ty.representation();
            let value = self.push(
                OpKind::Param(u32::try_from(at).unwrap_or(0)),
                ty.clone(),
                origin.clone(),
            );
            params.push(Param {
                name: format!("out{at}"),
                shape: ParamShape::Ordinary,
                ty: ty.clone(),
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
            pointers.push((value, ty));
        }
        let answer_ty = func.return_type.clone();
        let answer = self.push(
            OpKind::Call {
                callee: Callee::Direct(func.name.clone()),
                args: arguments,
                frame: None,
            },
            answer_ty.clone(),
            origin.clone(),
        );
        let count = slot.outs.len() + usize::from(slot.has_result);
        let zero = self.push(
            OpKind::ConstInt(0),
            HirType::Int {
                bits: 64,
                signed: true,
            },
            origin.clone(),
        );
        for (at, ((pointer, ty), nullable)) in pointers
            .into_iter()
            .zip(slot.outs.iter().copied())
            .enumerate()
        {
            let HirType::NativePointer(crate::hir::native::Pointee::Scalar(scalar)) = ty.clone()
            else {
                return Err(self.unsupported(
                    slot.member,
                    "a virtual function's out parameter that is not a pointer to a C scalar",
                ));
            };
            let element = self.tuple_element(
                slot.member,
                answer,
                &answer_ty,
                count,
                at + usize::from(slot.has_result),
            )?;
            let value = self.coerce(
                element,
                &crate::hir::native::Type::Scalar(scalar).representation(),
                slot.member,
            )?;
            // GTK passes NULL for an output it does not want.
            let after = nullable.then(|| {
                let null = self.push(OpKind::ConstNull, ty.clone(), origin.clone());
                let absent = self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: pointer,
                        rhs: null,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                let (store, after) = (self.new_block(), self.new_block());
                self.terminate(Terminator::Branch {
                    cond: absent,
                    then_target: after,
                    then_args: Vec::new(),
                    else_target: store,
                    else_args: Vec::new(),
                });
                self.switch_to(store);
                after
            });
            self.push(
                OpKind::NativeStore {
                    pointer,
                    index: zero,
                    value,
                },
                HirType::Void,
                origin.clone(),
            );
            if let Some(after) = after {
                self.terminate(Terminator::Jump {
                    target: after,
                    args: Vec::new(),
                });
                self.switch_to(after);
            }
        }
        let result = slot.entry.result.representation();
        self.returns = result.clone();
        if slot.has_result {
            let element = self.tuple_element(slot.member, answer, &answer_ty, count, 0)?;
            let value = self.coerce(element, &result, slot.member)?;
            self.terminate(Terminator::Return(Some(value)));
        } else {
            self.terminate(Terminator::Return(None));
        }
        Ok(self.finish(slot.name.clone(), params, result, origin, false))
    }

    /// The virtual function `name` (`vfunc_clicked`) a class whose instances
    /// are `handle` inherits: the declaration a binding writes on the nearest
    /// ancestor that has one, and its slot (`GtkButtonClass clicked`). A
    /// binding declares a class as a type, not a class, so this is found by
    /// the method's own `this`, whose tag is on the handle's chain -- or by
    /// its slot, one of an interface's the class implements (`interfaces`,
    /// `GListModelInterface g_list_model_get_type`), which wins over a
    /// class's slot of the same name.
    fn overridden_vfunc(
        &self,
        handle: &crate::hir::native::Handle,
        interfaces: &[String],
        name: &str,
    ) -> Option<(NodeId, String)> {
        let chain: Vec<&str> = handle
            .ancestors
            .iter()
            .map(String::as_str)
            .chain(std::iter::once(handle.tag.as_str()))
            .collect();
        self.snapshot
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| {
                node.kind == nts_semantic_schema::NodeKind::Syntax(syntax::METHOD_SIGNATURE)
            })
            .filter_map(|(at, node)| {
                let slot = node.native.as_ref()?.vfunc.clone()?;
                let declaration = NodeId(u32::try_from(at).ok()?);
                if self.member_name(declaration).as_deref() != Some(name) {
                    return None;
                }
                let structure = slot.split_whitespace().next()?;
                if interfaces
                    .iter()
                    .any(|interface| interface.split_whitespace().next() == Some(structure))
                {
                    return Some((chain.len(), declaration, slot));
                }
                let this = crate::hir::generics::declared_signature(self.snapshot, declaration)?
                    .this_type?;
                let Some(crate::hir::native::Pointee::Opaque(owner)) =
                    crate::hir::native::pointer(self.snapshot, this)
                else {
                    return None;
                };
                let depth = chain.iter().position(|tag| *tag == owner.tag)?;
                Some((depth, declaration, slot))
            })
            .max_by_key(|(depth, ..)| *depth)
            .map(|(_, declaration, slot)| (declaration, slot))
    }

    /// `super(...)` and `super.vfunc_x()` in a class the program writes over
    /// a `GObject` class: its constructor's instance, or the parent's
    /// implementation of a virtual function it overrides. `None` for any
    /// other `super`.
    pub(super) fn gobject_super_call(
        &mut self,
        id: NodeId,
        member: &str,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if member == "constructor" {
            return None;
        }
        let target = self.snapshot.call_targets.get(&id).copied()?;
        let declaration = target.callee?;
        let slot = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.vfunc.clone())?;
        Some(self.lower_gobject_chain_up(id, (declaration, target.signature), &slot, arguments))
    }

    /// `super.vfunc_clicked()` in a method of a class the program writes over
    /// a `GObject` class: the parent class's implementation, read from its
    /// class struct at the slot's offset when the call is made
    /// (`nts_gobject_chain_{Class}_{offset}`, which each backend defines
    /// beside the registration), and nothing where the parent leaves the
    /// slot empty -- `GObject`'s own convention for chaining up. The call is
    /// typed as the overridden declaration is, with `this` first.
    fn lower_gobject_chain_up(
        &mut self,
        id: NodeId,
        (declaration, signature): (NodeId, nts_semantic_schema::SignatureId),
        slot: &str,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let receiver = self
            .this
            .ok_or_else(|| self.unsupported(id, "`super` outside a method"))?;
        let class = std::iter::successors(self.node(id).parent, |at| self.node(*at).parent)
            .find(|at| self.kind_of(*at) == Some(syntax::CLASS_DECLARATION))
            .ok_or_else(|| self.unsupported(id, "`super` outside a class"))?;
        let name = foreign_class_name(self.snapshot, class)
            .filter(|_| crate::hir::native::gobject_parent(self.snapshot, class).is_some())
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    "chaining up to a virtual function outside a class over a GObject class",
                )
            })?;
        let offset = slot
            .split_whitespace()
            .nth(2)
            .ok_or_else(|| self.unsupported(id, "a virtual function whose slot has no offset"))?;
        let mut with_this = self.snapshot.signatures[signature.0 as usize].clone();
        let this = with_this
            .this_type
            .ok_or_else(|| self.unsupported(id, "a virtual function with no `this` type"))?;
        with_this.parameters.insert(
            0,
            nts_semantic_schema::ParameterRecord {
                name: "this".to_owned(),
                ty: this,
                optional: false,
                rest: false,
            },
        );
        // A slot whose outs the declaration answers as a tuple: the thunk
        // is called with the ins, then an address per out, and answers the
        // slot's own result; the tuple is made from them after.
        let outs = self.vfunc_outs(declaration);
        let answer = with_this.return_type;
        let shape = if outs.is_empty() {
            None
        } else {
            Some(self.vfunc_answer(id, answer, &outs)?)
        };
        if let Some((elements, has_result)) = &shape {
            with_this.return_type = if *has_result {
                elements[0]
            } else {
                self.void_type()?
            };
        }
        self.chaining_up = Some(id);
        let built = self.native_callee(id, Some(declaration), name.clone(), &with_this);
        self.chaining_up = None;
        let Callee::Native(mut target) = built? else {
            return Err(self.unsupported(id, "a virtual function that is not foreign"));
        };
        // The thunk, not the declaration's name (which the callee takes from
        // it); defined beside the registration and declared by no header, so
        // the witness has nothing to compare it with.
        let thunk = std::sync::Arc::make_mut(&mut target);
        thunk.name = format!("nts_gobject_chain_{name}_{offset}");
        thunk.thunk = Some(crate::hir::native::GObjectThunk::Chain {
            class: name,
            slot: offset.parse().map_err(|_| {
                self.unsupported(id, "a virtual function whose slot offset is not an integer")
            })?,
        });
        thunk.declared_at = None;
        let callee = Callee::Native(target);
        let (args, lent) = self.lower_call_arguments(id, &callee, arguments, Some(receiver))?;
        match shape {
            None => self.finish_call(id, callee, args, lent, Some(declaration)),
            Some((elements, has_result)) => self.chain_up_answering_a_tuple(
                id,
                (callee, args, lent),
                declaration,
                answer,
                (&elements, has_result),
            ),
        }
    }

    /// `super.vfunc_measure(o, s)` where the declaration answers the slot's
    /// outs as a tuple: a local per out, its address passed after the ins,
    /// and the tuple made from the slot's result and what C wrote to them.
    fn chain_up_answering_a_tuple(
        &mut self,
        id: NodeId,
        (callee, mut args, lent): (Callee, Vec<ValueId>, Vec<Lent>),
        declaration: NodeId,
        answer: TypeId,
        (elements, has_result): (&[TypeId], bool),
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let Callee::Native(mut target) = callee else {
            return Err(self.unsupported(id, "a virtual function that is not foreign"));
        };
        let mut locals = Vec::new();
        for element in &elements[usize::from(has_result)..] {
            let Some(crate::hir::native::Type::Scalar(scalar)) =
                crate::hir::native::abi_type(self.snapshot, *element)
            else {
                return Err(self.unsupported(
                    id,
                    "a virtual function's out parameter that is not a C scalar",
                ));
            };
            let pointee = crate::hir::native::Pointee::Scalar(scalar);
            let thunk = std::sync::Arc::make_mut(&mut target);
            thunk
                .parameters
                .push(crate::hir::native::Type::Pointer(pointee.clone()));
            thunk
                .retention
                .push(crate::hir::native::Retention::NotRetained);
            let local = self.push(
                OpKind::NativeLocal { count: 1 },
                HirType::NativePointer(pointee),
                origin.clone(),
            );
            args.push(local);
            locals.push(local);
        }
        let result_ty = target.call_result();
        let result = self.finish_call_typed(
            id,
            Callee::Native(target),
            args,
            lent,
            Some(declaration),
            Some(result_ty),
        )?;
        let zero = self.push(
            OpKind::ConstInt(0),
            HirType::Int {
                bits: 64,
                signed: true,
            },
            origin.clone(),
        );
        let mut values = Vec::new();
        if has_result {
            values.push(result);
        }
        for local in locals {
            values.push(self.native_load(id, local, zero)?);
        }
        self.make_tuple(id, answer, values)
    }

    /// A constructor of a class the program writes over a `GObject` class, as
    /// the function `new` calls: `{Class}#new`, taking the constructor's
    /// parameters and answering the instance (one reference, the caller's).
    /// Its `super({ ... })` makes the instance of the class's own `GType` and
    /// sets the literal's properties (`gobject_super`); the fields are the
    /// instance's already, made by `instance_init`. An instance GTK makes
    /// itself -- a builder file -- runs `instance_init` and none of this, as
    /// an Objective-C instance a nib makes runs its superclass's `init`.
    fn lower_gobject_constructor(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<Func, Diagnostic> {
        let name = foreign_class_name(self.snapshot, class)
            .ok_or_else(|| self.unsupported(member, "a constructor of a class with no name"))?;
        let instance = instance
            .or_else(|| instance_type_of(self.snapshot, class))
            .ok_or_else(|| {
                self.unsupported(
                    member,
                    "a constructor of a GObject class with no instance type",
                )
            })?;
        let Some(ty @ HirType::NativePointer(_)) = self.represent(instance) else {
            return Err(self.unsupported(
                member,
                "a constructor of a GObject class whose instances are not a handle",
            ));
        };
        let body = self
            .method_body(member, false)?
            .ok_or_else(|| self.unsupported(member, "a GObject constructor with no body"))?;
        if !self.opens_with_super(body) {
            return Err(self.unsupported(member, "a constructor of a class extending a GObject class that does not open with its `super(...)`"));
        }
        let origin = self.origin(member);
        self.this = None;
        self.in_constructor = true;
        let mut params = Vec::new();
        for child in self.children(member) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            if self.declares_a_field(child) {
                return Err(self.unsupported(child, "a constructor parameter that declares a field of a class extending a GObject class"));
            }
            let index = u32::try_from(params.len()).unwrap_or(0);
            params.extend(self.lower_param(child, index)?);
        }
        self.made_by = Some(MadeBy::Gobject(name.clone()));
        self.returns = ty.clone();
        self.lower_block(body)?;
        if !self.is_terminated() {
            let made = self.this.ok_or_else(|| {
                self.unsupported(member, "a GObject constructor that made no instance")
            })?;
            self.terminate(Terminator::Return(Some(made)));
        }
        Ok(self.finish(format!("{name}#new"), params, ty, origin, false))
    }

    /// `super({ label })` in such a constructor: the instance, made as `new`
    /// without a constructor makes one -- its own `GType`, then a setter per
    /// property -- and `this` from here on. The properties are a literal's,
    /// set without building an object, or a props object's passed through,
    /// each set where it was given (`passed_properties`); a class's own
    /// `Property<T>` among them is written through its state's field
    /// (`constructed_setter`).
    pub(super) fn gobject_super(&mut self, id: NodeId, name: &str) -> Result<ValueId, Diagnostic> {
        let instance = self.this_instance_type(id)?;
        let made = self.lower_gobject_made(id, name, instance)?;
        self.this = Some(made);
        Ok(made)
    }

    /// `new Counter({ label })`, where `Counter` is a class the program writes
    /// over a `GObject` class: an instance of its own `GType`, made by the
    /// function its backend emits beside the registration
    /// (`nts_gobject_new_Counter`, one reference the caller owns, floating or
    /// not), then a setter for each property. `None` for any other `new`.
    pub(super) fn gobject_new(&mut self, id: NodeId) -> Option<Result<ValueId, Diagnostic>> {
        let callee = *self.children(id).first()?;
        // Through an import: `new EntryView()` of a class another module
        // wrote names the import's symbol, not the class's.
        let class = crate::hir::native::schema::class_declaration(
            self.snapshot,
            self.node(callee).symbol?,
        )?;
        if crate::hir::native::gobject_parent(self.snapshot, class).is_none() {
            // A class of the program's over a handle that nothing registers
            // (`lower_class` refuses it): its `new` would resolve to the
            // parent's construct signature and make a parent.
            let registered = crate::hir::native::registered_by_a_runtime(self.snapshot, class);
            let handle = instance_type_of(self.snapshot, class).and_then(|ty| self.represent(ty));
            return (!registered && matches!(handle, Some(HirType::NativePointer(_)))).then(|| {
                Err(self.unsupported(
                    id,
                    "`new` of a class extending a C handle's class that nothing registers",
                ))
            });
        }
        let name = foreign_class_name(self.snapshot, class)?;
        // A class with a constructor is made by it: `{Class}#new`, whose
        // `super(...)` makes the instance.
        if let Some(constructor) = self
            .children(class)
            .into_iter()
            .find(|member| self.kind_of(*member) == Some(syntax::CONSTRUCTOR))
        {
            let callee = Callee::Direct(format!("{name}#new"));
            let arguments = self.arguments_of(id);
            return Some(
                self.lower_call_arguments(id, &callee, &arguments, None)
                    .and_then(|(args, lent)| {
                        self.finish_call(id, callee, args, lent, Some(constructor))
                    }),
            );
        }
        let ty = self.snapshot.node_types.get(&id).copied()?;
        Some(self.lower_gobject_made(id, &name, ty))
    }

    /// An instance of the class `name`, a class the program writes over a
    /// `GObject` class, typed `ty`, with the properties the call at `id`
    /// writes in its literal: `nts_gobject_new_{name}` -- one owned reference
    /// -- then a setter for each. The literal's values first, in its order.
    fn lower_gobject_made(
        &mut self,
        id: NodeId,
        name: &str,
        ty: TypeId,
    ) -> Result<ValueId, Diagnostic> {
        let Some(HirType::NativePointer(pointee @ crate::hir::native::Pointee::Opaque(_))) =
            self.represent(ty)
        else {
            return Err(self.unsupported(
                id,
                "an instance of a class extending a GObject class that is not a handle",
            ));
        };
        let represented = HirType::NativePointer(pointee.clone());
        let written = self.constructed_properties(id)?;
        let make = crate::hir::native::Function {
            thunk: Some(crate::hir::native::GObjectThunk::New {
                class: name.to_owned(),
            }),
            name: format!("nts_gobject_new_{name}"),
            convention: crate::hir::native::Convention::C,
            parameters: Vec::new(),
            result: crate::hir::native::Type::Pointer(pointee.clone()),
            retention: Vec::new(),
            variadic: None,
            declared_at: None,
            roles: Vec::new(),
            returns_string: None,
            returns_array: None,
            returns_dictionary: None,
            returns_set: None,
            send: None,
            returns_owned: true,
            consumes: Vec::new(),
            frameworks: Vec::new(),
            libraries: Vec::new(),
            defaults: Vec::new(),
            result_as: None,
            vtable: None,
            hresult: false,
            result_as_number: false,
        };
        let origin = self.origin(id);
        let handle = self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(make)),
                args: Vec::new(),
                frame: None,
            },
            represented,
            origin,
        );
        self.set_constructed(id, handle, ty, &written, &[])?;
        Ok(handle)
    }

    /// `emit(name, ...args)` of a signal a `GObject` class the program writes
    /// declares: a call of `nts_gobject_emit_{kinds}__{name}`, which each
    /// backend defines beside the registration as `g_signal_emit` by the
    /// signal's id, found on the instance's type and kept for the next call.
    /// No variadic call, and no name parsed per emit: the name is the
    /// thunk's, and the arguments are its parameters, typed as the handler
    /// receives them (`SignalArgs`).
    pub(super) fn lower_gobject_emit(
        &mut self,
        id: NodeId,
        (receiver, receiver_node): (ValueId, NodeId),
        declaration: NodeId,
        mut with_this: nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let (name_node, rest) = arguments
            .split_first()
            .ok_or_else(|| self.unsupported(id, "`emit` with no signal"))?;
        let signal = self.constant_member_name(*name_node).ok_or_else(|| {
            self.unsupported(*name_node, "`emit` of a signal whose name is not a literal")
        })?;
        // The receiver's type as the method call has it: the declared `this`,
        // or the class the receiver is an instance of.
        let this_ty = with_this
            .this_type
            .or_else(|| {
                self.snapshot
                    .node_types
                    .get(&receiver_node)
                    .map(|ty| self.class_behind(self.present_part(*ty).unwrap_or(*ty)))
            })
            .ok_or_else(|| self.unsupported(id, "`emit` with no receiver type"))?;
        let declared =
            signals_of_type(self.snapshot, this_ty).map_err(|why| self.unsupported(id, &why))?;
        let kinds = declared
            .iter()
            .find(|declared| declared.name == signal)
            .map(|declared| declared.kinds.clone());
        // `this`, then each of the signal's parameters in place of the name
        // and the rest: the thunk's own signature. A signal a class the
        // program wrote declares has them as `WithSignals`'s rest; a
        // binding's own (`button.emit("clicked")`) as its view's parameters
        // after the name.
        let rest_ty = with_this.parameters.last().filter(|p| p.rest).map(|p| p.ty);
        let elements = match rest_ty
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .map(|record| &record.kind)
        {
            Some(TypeKind::Tuple(tuple)) if kinds.is_some() => tuple.elements.clone(),
            _ if kinds.is_none() && rest_ty.is_none() => {
                with_this.parameters.iter().skip(1).map(|p| p.ty).collect()
            }
            _ if kinds.is_none() => {
                return Err(self.unsupported(*name_node, &format!("`emit` of `{signal}`, which neither a class the program wrote nor a binding declares")));
            }
            _ => {
                return Err(
                    self.unsupported(id, "`emit` whose arguments are not a signal's parameters")
                );
            }
        };
        with_this.parameters = vec![nts_semantic_schema::ParameterRecord {
            name: "this".to_owned(),
            ty: this_ty,
            optional: false,
            rest: false,
        }];
        for (at, element) in elements.iter().enumerate() {
            with_this
                .parameters
                .push(nts_semantic_schema::ParameterRecord {
                    name: format!("a{at}"),
                    ty: *element,
                    optional: false,
                    rest: false,
                });
        }
        let Callee::Native(mut target) =
            self.native_callee(id, Some(declaration), signal.clone(), &with_this)?
        else {
            return Err(self.unsupported(id, "`emit` that is not foreign"));
        };
        let thunk = std::sync::Arc::make_mut(&mut target);
        // A binding's signal, named by its parameters' C types, so two
        // classes' same-named signals of different shapes are two thunks --
        // and every pointer is `void *`, so every call of one prints one
        // prototype, whichever class it names.
        let kinds = if let Some(kinds) = kinds {
            kinds
        } else {
            for parameter in &mut thunk.parameters {
                if matches!(parameter, crate::hir::native::Type::Pointer(_)) {
                    *parameter =
                        crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Void);
                }
            }
            binding_signal_kinds(&thunk.parameters[1..], &thunk.result)
                .map_err(|why| self.unsupported(id, &why))?
        };
        thunk.name = crate::hir::ForeignSignal::emit_thunk(&signal, &kinds);
        thunk.thunk = Some(crate::hir::native::GObjectThunk::Signal {
            name: signal.clone(),
            kinds,
        });
        thunk.declared_at = None;
        // Each argument as written, then converted to the thunk's parameter
        // (`native_arguments`): not `lower_call_arguments`, which reads the
        // call's own signature by position, where the name comes first.
        let mut written = Vec::with_capacity(rest.len());
        for argument in rest {
            written.push(self.lower_expression(*argument)?);
        }
        let (args, lent) =
            self.native_arguments(id, &target.clone(), written, rest.len(), Some(receiver))?;
        let callee = Callee::Native(target);
        self.finish_call(id, callee, args, lent, Some(declaration))
    }

    /// A class's `GType`, from the function `gtype_function` named: a program
    /// class's own, which its backend defines and registers it in, or the
    /// binding's `get_type`.
    pub(super) fn call_gtype(
        &mut self,
        id: NodeId,
        gtype: &crate::hir::native::GType,
    ) -> Result<ValueId, Diagnostic> {
        let crate::hir::native::GType::ProgramClass(class) = gtype else {
            return self.call_foreign_named(id, &gtype.symbol(), Vec::new());
        };
        let size = crate::hir::native::Type::Scalar(crate::hir::native::Scalar::Size);
        let ty = size.representation();
        let mut function = synthesized(&gtype.symbol(), Vec::new(), size, None, Vec::new());
        function.thunk = Some(crate::hir::native::GObjectThunk::Type {
            class: class.clone(),
        });
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(function)),
                args: Vec::new(),
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// `Task.$gtype`, GJS's name for a `GObject` class's `GType`: the one
    /// `gtype_function` names for the class the member is read from -- so a
    /// class the program wrote answers its own, not its parent's, whose
    /// declaration it inherited. `None` for any other read.
    pub(super) fn gtype_read(
        &mut self,
        id: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.literal_name(member).as_deref() != Some("$gtype") {
            return None;
        }
        let symbol = self.denoted_symbol(self.node(object).symbol?);
        let gtype = crate::hir::native::gtype_function(self.snapshot, symbol)?;
        Some(self.call_gtype(id, &gtype))
    }
}
