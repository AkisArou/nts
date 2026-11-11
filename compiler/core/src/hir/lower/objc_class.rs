//! Register Objective-C classes, lower their methods and constructors, and emit their instance state.

use super::{
    Copy, Diagnostic, Facts, Func, FuncBuilder, HirType, Layout, LayoutCollector, Lowered,
    LoweringSnapshot, MadeBy, ManagedType, NodeId, OpKind, Param, ParamShape, Place, Shared,
    Terminator, TypeId, TypeKind, ValueId, accessor_signature, declares_stored, default_setter,
    foreign_class_name, instance_type_of, is_static_member, note_uncompiled, opaque_handle, syntax,
};

/// The constructor being lowered of a class the program writes over an
/// Objective-C class: the class its `super(...)` makes an instance of,
/// whether it has fields to make with it, and the parameters that are fields
/// too, stored once there is an instance to store them in.
#[derive(Clone)]
pub(super) struct ObjcConstruct {
    handle: crate::hir::native::Handle,
    fields: bool,
    parameter_properties: Vec<(NodeId, u32)>,
}

/// A method the Objective-C runtime calls, through an entry point that
/// passes each label as an argument of its own, and -- where the method
/// returns a record by value -- the address to write it to.
#[derive(Clone, Copy)]
pub(super) struct ObjcEntry {
    pub(super) returns_record: bool,
}

/// Swift's `@objc` selector for a method of `count` parameters: its name,
/// with a colon for each (`pressed(sender)` is `pressed:`).
fn objc_selector(name: &str, count: usize) -> String {
    format!("{name}{}", ":".repeat(count))
}

/// A class the program writes over an Objective-C class, recorded as the
/// runtime will register it (`Program::foreign_classes`). Its fields live in a
/// state object the runtime keeps in the instance's `nts_state` ivar
/// (`nts_objc_state`).
pub(super) fn register_objc_class(
    snapshot: &LoweringSnapshot<'_>,
    class: NodeId,
    methods: Vec<crate::hir::ForeignMethod>,
    state: Option<String>,
    lowered: &mut Lowered,
) {
    let probe = FuncBuilder::probe(snapshot);
    let (Some(name), Some(superclass)) = (
        crate::hir::native::objc_name(snapshot, class),
        crate::hir::native::superclass(snapshot, class)
            .and_then(|base| crate::hir::native::objc_name(snapshot, base)),
    ) else {
        return;
    };
    // By the runtime's name: the one `@ntsProtocol` gives, else the
    // interface's own.
    let protocols = probe
        .objc_protocols(class)
        .into_iter()
        .filter_map(|protocol| {
            probe
                .node(protocol)
                .native
                .as_ref()
                .and_then(|native| native.protocol.clone())
                .or_else(|| {
                    probe.children(protocol).into_iter().find_map(|child| {
                        (probe.kind_of(child) == Some(syntax::IDENTIFIER))
                            .then(|| {
                                probe
                                    .node(child)
                                    .text
                                    .as_ref()
                                    .and_then(|text| text.as_utf8())
                                    .map(str::to_owned)
                            })
                            .flatten()
                    })
                })
        })
        .collect();
    lowered
        .program
        .foreign_classes
        .push(crate::hir::ForeignClass {
            family: crate::hir::native::Family::Objc,
            name,
            type_name: None,
            superclass: superclass.into(),
            methods,
            protocols,
            state,
            composition: None,
            signals: Vec::new(),
            properties: Vec::new(),
            template: None,
        });
}

/// The fields of a class the program writes over an Objective-C class that
/// meet a property requirement of a protocol it adopts: Swift's
/// `var window: UIWindow?` in an application delegate, which `UIKit` reads
/// with `window` and writes with `setWindow:`. Each is a getter and, unless
/// the field is `readonly`, a setter the runtime calls, which read and write
/// the field of the instance's state as the program's own `this.window` does.
/// A field no protocol asks for is the program's alone, as Swift's
/// non-`@objc` one is.
pub(super) fn objc_field_properties(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    class: NodeId,
    shared: &Shared,
    lowered: &mut Lowered,
) -> Vec<crate::hir::ForeignMethod> {
    let probe = FuncBuilder::probe(snapshot);
    let Some(name) = foreign_class_name(snapshot, class) else {
        return Vec::new();
    };
    let Some(&(index, class_ty)) = shared.hierarchy.objc_states.get(&name) else {
        return Vec::new();
    };
    let mut methods = Vec::new();
    for field in probe.children(class) {
        if probe.kind_of(field) != Some(syntax::PROPERTY_DECLARATION)
            || is_static_member(snapshot, field)
        {
            continue;
        }
        let Some(property) = probe.member_name(field) else {
            continue;
        };
        let Some(requirement) = probe.property_requirement(class, &property) else {
            continue;
        };
        let (getter, setter) = probe.property_selectors(requirement, &property);
        let readonly = probe
            .node(field)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::READONLY);
        for (selector, writes) in [(Some(getter), false), (setter.filter(|_| !readonly), true)] {
            let Some(selector) = selector else { continue };
            let mut builder = shared.builder(snapshot, foreign, Copy::default());
            match builder.lower_objc_field_accessor(
                class,
                &name,
                (index, class_ty),
                (field, &property),
                writes,
            ) {
                Ok((func, imp)) => {
                    methods.push(crate::hir::ForeignMethod {
                        dispatch: crate::hir::Dispatch::Selector(selector),
                        function: func.name.clone(),
                        signature: std::sync::Arc::new(imp),
                        declared_at: None,
                    });
                    lowered.program.funcs.push(func);
                    layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
                }
                Err(diagnostic) => {
                    note_uncompiled(snapshot, &mut lowered.program, field, None, &diagnostic);
                    lowered.diagnostics.push(diagnostic);
                    break;
                }
            }
        }
    }
    methods
}

/// For a class the program writes over an Objective-C class and gives
/// fields, the function making the object that holds them; `None` for one
/// without fields, or whose function is refused (and reported).
pub(super) fn objc_state_function(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    class: NodeId,
    shared: &Shared,
    lowered: &mut Lowered,
) -> Option<String> {
    let name = foreign_class_name(snapshot, class)?;
    let &(index, class_ty) = shared.hierarchy.objc_states.get(&name)?;
    let mut builder = shared.builder(snapshot, foreign, Copy::default());
    match builder.lower_objc_state(class, &name, index, class_ty) {
        Ok(func) => {
            let made = func.name.clone();
            lowered.program.funcs.push(func);
            layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
            Some(made)
        }
        Err(diagnostic) => {
            note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
            lowered.diagnostics.push(diagnostic);
            None
        }
    }
}

impl FuncBuilder<'_> {
    /// The selector a method of a class the program writes answers: the one
    /// `@ntsSelector` gives it, else the one a protocol the class adopts
    /// declares for a member of its name, else the one of the superclass's
    /// method it overrides -- `draw(_:)` is `drawRect:` -- else Swift's
    /// `@objc` rule for its name. What the runtime registers the method
    /// under, and what `selector(Class, "name")` answers.
    fn program_method_selector(
        &self,
        class: NodeId,
        member: NodeId,
        name: &str,
        arity: usize,
    ) -> String {
        self.node(member)
            .native
            .as_ref()
            .and_then(|native| native.selector.clone())
            .or_else(|| self.protocol_selector(class, name))
            .or_else(|| self.overridden_selector(class, name, arity))
            .unwrap_or_else(|| objc_selector(name, arity))
    }

    /// `selector(Notes, "add")`: Swift's `#selector(Notes.add(_:))`, the
    /// selector a method of an Objective-C class answers -- one the program
    /// writes, as the runtime registered it, or one a binding declares, as
    /// its `@ntsSelector` says. The method is looked for on the class and its
    /// ancestors; the checker has already said the name is one of its
    /// methods.
    pub(super) fn lower_selector(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let [class, method] = arguments else {
            return Err(self.unsupported(id, "`selector` takes a class and the name of its method"));
        };
        let name = self.literal_name(*method).ok_or_else(|| {
            self.unsupported(
                *method,
                "a method name `selector` is not given as a string literal",
            )
        })?;
        // Through an import's alias to the class it names: `NSWindow` from
        // `objc:AppKit` is an import specifier here.
        let mut record = self
            .node(*class)
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize));
        while let Some(aliased) = record.and_then(|r| r.aliased) {
            record = self.snapshot.symbols.get(aliased.0 as usize);
        }
        let mut at = record.and_then(|record| {
            record
                .declarations
                .iter()
                .copied()
                .find(|d| self.kind_of(*d) == Some(syntax::CLASS_DECLARATION))
        });
        if at.is_none() {
            return Err(self.unsupported(
                *class,
                "a `selector` whose first argument does not name a class",
            ));
        }
        while let Some(declaration) = at {
            let member = self.children(declaration).into_iter().find(|member| {
                self.kind_of(*member) == Some(syntax::METHOD_DECLARATION)
                    && self.member_name(*member).as_deref() == Some(name.as_str())
            });
            if let Some(member) = member {
                let arity = crate::hir::generics::declared_signature(self.snapshot, member)
                    .map_or(0, |signature| signature.parameters.len());
                let selector = if crate::hir::native::is_objc_class(self.snapshot, declaration) {
                    self.node(member)
                        .native
                        .as_ref()
                        .and_then(|native| native.selector.clone())
                        .unwrap_or_else(|| objc_selector(&name, arity))
                } else if crate::hir::native::extends_objc(self.snapshot, declaration) {
                    // A method the runtime is not told of answers no selector.
                    let unregistered =
                        crate::hir::generics::declared_signature(self.snapshot, member)
                            .is_some_and(|signature| {
                                crate::hir::native::imp_signature(
                                    self.snapshot,
                                    crate::hir::native::Pointee::Void,
                                    signature,
                                )
                                .is_err()
                            })
                            && !self.objc_requires(declaration, member, &name, arity);
                    if unregistered {
                        return Err(self.unsupported(
                            *method,
                            &format!("`selector` of `{name}`, a method no message could carry the arguments of, which the runtime is not told of"),
                        ));
                    }
                    self.program_method_selector(declaration, member, &name, arity)
                } else {
                    return Err(self.unsupported(
                        *class,
                        "a `selector` of a class that is not an Objective-C class",
                    ));
                };
                let ty = self
                    .type_of(id)
                    .ok_or_else(|| self.unrepresentable(id, "a selector"))?;
                let origin = self.origin(id);
                return Ok(self.push(
                    OpKind::ObjcSelector {
                        name: selector.trim_start_matches('+').to_owned(),
                    },
                    ty,
                    origin,
                ));
            }
            at = crate::hir::native::superclass(self.snapshot, declaration);
        }
        Err(self.unsupported(
            *method,
            &format!("`{name}`, which no class in the chain declares as a method"),
        ))
    }

    pub(super) fn lower_objc_method(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<(Func, Option<crate::hir::ForeignMethod>), Diagnostic> {
        // An accessor's is its property's getter or setter: the value out, or
        // the value in.
        let signature = match self.kind_of(member) {
            Some(syntax::GET_ACCESSOR) => self
                .snapshot
                .node_types
                .get(&member)
                .map(|value| accessor_signature(None, None, *value)),
            Some(syntax::SET_ACCESSOR) => {
                let value = self
                    .children(member)
                    .into_iter()
                    .find(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
                    .and_then(|parameter| self.snapshot.node_types.get(&parameter).copied());
                value
                    .map(|value| {
                        self.void_type()
                            .map(|void| accessor_signature(None, Some(value), void))
                    })
                    .transpose()?
            }
            _ => crate::hir::generics::declared_signature(self.snapshot, member).cloned(),
        }
        .ok_or_else(|| self.unsupported(member, "an Objective-C method with no signature"))?;
        let receiver = instance
            .or_else(|| instance_type_of(self.snapshot, class))
            .and_then(|ty| crate::hir::native::pointer(self.snapshot, ty))
            .ok_or_else(|| {
                self.unsupported(
                    member,
                    "an Objective-C method of a class that is not an Objective-C class",
                )
            })?;
        let name = self
            .member_name(member)
            .ok_or_else(|| self.unsupported(member, "a member whose name the program computes"))?;
        let imp = match crate::hir::native::imp_signature(self.snapshot, receiver, &signature) {
            Ok(imp) => imp,
            // Swift's method that is not `@objc`: one whose parameters no
            // message could carry -- `append(_ item: String)` -- and that no
            // protocol, override or tag asks the runtime for is the
            // program's alone. A call from the program reaches the compiled
            // method directly (`lower_program_objc_call`), so it is lowered
            // and never registered.
            Err(_) if !self.objc_requires(class, member, &name, signature.parameters.len()) => {
                return Ok((self.lower_method_of(class, member, instance)?, None));
            }
            Err(why) => {
                return Err(self.unsupported(member, &format!("an Objective-C method's {why}")));
            }
        };
        // The selector: the one `@ntsSelector` gives the method, else the one
        // a protocol the class adopts declares for a member of its name, else
        // the one of the superclass's method it overrides -- `draw(_:)` is
        // `drawRect:` -- else Swift's `@objc` rule for its name. An accessor
        // is its property's getter or setter: `get isFlipped()` is sent
        // `isFlipped`.
        let selector = match self.kind_of(member) {
            Some(syntax::GET_ACCESSOR) => self.property_selectors(member, &name).0,
            Some(syntax::SET_ACCESSOR) => self
                .property_selectors(member, &name)
                .1
                .unwrap_or_else(|| default_setter(&name)),
            _ => self.program_method_selector(class, member, &name, signature.parameters.len()),
        };
        self.objc_entry = Some(ObjcEntry {
            returns_record: matches!(*imp.result, crate::hir::native::Type::Record(_)),
        });
        let func = self.lower_method_of(class, member, instance)?;
        let method = crate::hir::ForeignMethod {
            dispatch: crate::hir::Dispatch::Selector(selector),
            function: func.name.clone(),
            signature: std::sync::Arc::new(imp),
            declared_at: None,
        };
        Ok((func, Some(method)))
    }

    /// Whether the runtime must be told of `member`, a method of class
    /// `class` the program writes: its binding tags its selector, a protocol
    /// the class adopts declares it, or it overrides a superclass's method --
    /// each a message something other than the program sends.
    fn objc_requires(&self, class: NodeId, member: NodeId, name: &str, arity: usize) -> bool {
        self.node(member)
            .native
            .as_ref()
            .is_some_and(|native| native.selector.is_some())
            || self.protocol_selector(class, name).is_some()
            || self.overridden_selector(class, name, arity).is_some()
    }

    /// A constructor of a class the program writes over an Objective-C class,
    /// as the function `new` calls: `{Class}#new`, taking the constructor's
    /// parameters and answering the instance (+1). Its `super(...)` is where
    /// the instance is made -- `+alloc` sent to this class, then the
    /// superclass constructor's `init...` -- so `this` is that object from
    /// there on, with its fields made at once, whichever `init` it was. Only
    /// a constructor opening with its `super(...)`: `this` is one object for
    /// the whole body, and one made in a branch is not. Not a method the
    /// runtime knows: an instance Objective-C makes itself (`[Counter new]`,
    /// a nib) runs its superclass's `init` and none of this.
    pub(super) fn lower_objc_constructor(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<Func, Diagnostic> {
        let instance = instance
            .or_else(|| instance_type_of(self.snapshot, class))
            .ok_or_else(|| {
                self.unsupported(
                    member,
                    "a constructor of an Objective-C class with no instance type",
                )
            })?;
        let Some(HirType::NativePointer(crate::hir::native::Pointee::Opaque(handle))) =
            self.represent(instance)
        else {
            return Err(self.unsupported(
                member,
                "a constructor of an Objective-C class that is not a handle",
            ));
        };
        let body = self
            .method_body(member, false)?
            .ok_or_else(|| self.unsupported(member, "an Objective-C constructor with no body"))?;
        if !self.opens_with_super(body) {
            return Err(self.unsupported(member, "a constructor of a class extending an Objective-C class that does not open with its `super(...)`"));
        }
        let fields = self.declares_instance_fields(class);
        let origin = self.origin(member);
        self.this = None;
        self.base = self.base_class(class);
        self.in_constructor = true;
        let mut params = Vec::new();
        let mut parameter_properties = Vec::new();
        for child in self.children(member) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            let index = u32::try_from(params.len()).unwrap_or(0);
            if self.declares_a_field(child) {
                parameter_properties.push((child, index));
            }
            params.extend(self.lower_param(child, index)?);
        }
        self.made_by = Some(MadeBy::Objc(ObjcConstruct {
            handle: handle.clone(),
            fields,
            parameter_properties,
        }));
        let ty = HirType::NativePointer(crate::hir::native::Pointee::Opaque(handle.clone()));
        self.returns = ty.clone();
        self.lower_block(body)?;
        if !self.is_terminated() {
            let made = self.this.ok_or_else(|| {
                self.unsupported(member, "an Objective-C constructor that made no instance")
            })?;
            self.terminate(Terminator::Return(Some(made)));
        }
        Ok(self.finish(format!("{}#new", handle.tag), params, ty, origin, false))
    }

    /// `super(...)` in such a constructor: `+alloc` sent to the program's
    /// class and the superclass constructor's `init...` to what it answered,
    /// ARC's pair as `new` sends it, and the answer `this`. A factory the
    /// binding imports as a constructor makes the superclass's own instance,
    /// not this class's, and is refused.
    pub(super) fn lower_objc_super_init(
        &mut self,
        id: NodeId,
        ObjcConstruct {
            handle,
            fields,
            parameter_properties,
        }: ObjcConstruct,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let target = self
            .snapshot
            .call_targets
            .get(&id)
            .copied()
            .ok_or_else(|| self.unresolved_call(id))?;
        let Some(constructor) = target
            .callee
            .filter(|c| self.objc_class_member(*c).is_some())
        else {
            return Err(self.unsupported(
                id,
                "a `super(...)` into a constructor the binding does not declare",
            ));
        };
        let Some(selector) = self
            .node(constructor)
            .native
            .as_ref()
            .and_then(|n| n.selector.clone())
        else {
            return Err(self.unsupported(id, "an Objective-C constructor with no `@ntsSelector`"));
        };
        if selector.starts_with('+') {
            return Err(self.unsupported(id, "a `super(...)` into a class method Swift imports as an initializer, which makes the superclass's instance"));
        }
        let instance = self.this_instance_type(id)?;
        let alloc = nts_semantic_schema::SignatureRecord {
            parameters: Vec::new(),
            return_type: instance,
            type_parameters: Vec::new(),
            is_construct: false,
            type_predicate: None,
            this_type: None,
        };
        // Typed as the instance, not as the `super(...)` expression, which
        // the checker has as `void`.
        let made_ty = HirType::NativePointer(crate::hir::native::Pointee::Opaque(handle.clone()));
        let callee = self.native_callee_with(
            id,
            Some(constructor),
            "alloc".to_owned(),
            &alloc,
            Some("alloc".to_owned()),
            Some(handle.tag.clone()),
        )?;
        let allocated = self.finish_call_typed(
            id,
            callee,
            Vec::new(),
            Vec::new(),
            Some(constructor),
            Some(made_ty.clone()),
        )?;
        let mut init = self.snapshot.signatures[target.signature.0 as usize].clone();
        init.is_construct = false;
        init.return_type = instance;
        init.parameters.insert(
            0,
            nts_semantic_schema::ParameterRecord {
                name: "this".to_owned(),
                ty: instance,
                optional: false,
                rest: false,
            },
        );
        let callee = self.native_callee_with(
            id,
            Some(constructor),
            selector.clone(),
            &init,
            Some(selector),
            None,
        )?;
        let (args, lent) = self.lower_call_arguments(id, &callee, arguments, Some(allocated))?;
        let made =
            self.finish_call_typed(id, callee, args, lent, Some(constructor), Some(made_ty))?;
        self.this = Some(made);
        // Its fields, made now: only `init` itself makes them on the way in.
        if fields && let Some(&(index, _)) = self.hierarchy.objc_states.get(&handle.tag) {
            let origin = self.origin(id);
            let state = HirType::Managed(ManagedType::Object(crate::hir::objc_state_type(index)));
            let _ = self.runtime_call("nts_objc_state", vec![made], state, origin);
        }
        // `constructor(private model: Model)`: the fields its parameters
        // declare, stored now that there is an instance.
        self.store_parameter_properties(&parameter_properties)?;
        Ok(made)
    }

    /// The classes whose fields the state of `class_ty` holds, root first.
    pub(super) fn objc_chain(&self, class_ty: TypeId) -> Vec<TypeId> {
        self.hierarchy
            .objc_chains
            .get(&class_ty)
            .cloned()
            .unwrap_or_else(|| vec![class_ty])
    }

    /// `{Class}#state`: a new object holding the fields of `class`, a class
    /// the program writes over an Objective-C class, and of the program's
    /// classes it descends from, with their initialisers run base first and
    /// in declaration order. The runtime calls it from the `init` it adds
    /// to the class, so the fields hold their initial values once `new`
    /// returns, as JavaScript's do. An initialiser has no `this` here -- the
    /// instance is still the superclass's `init`'s -- and one reading it is
    /// refused by the ordinary rule for a `this` there is none of.
    fn lower_objc_state(
        &mut self,
        class: NodeId,
        name: &str,
        index: usize,
        class_ty: TypeId,
    ) -> Result<Func, Diagnostic> {
        self.refuse_reaching_initializers(class)?;
        let layout = self.objc_state_layout(class, index, class_ty)?;
        let ty = HirType::Managed(ManagedType::Object(crate::hir::objc_state_type(index)));
        let origin = self.origin(class);
        self.this = None;
        self.returns = ty.clone();
        let state = self.push(
            OpKind::ObjectNew { frame: false },
            ty.clone(),
            origin.clone(),
        );
        let chain = self.objc_chain(class_ty);
        self.initialize_declared_fields(class, state, &chain, &layout)?;
        self.terminate(Terminator::Return(Some(state)));
        Ok(self.finish(format!("{name}#state"), Vec::new(), ty, origin, false))
    }

    /// Refuse a field initialiser that could run code: a call, a `new`, a
    /// member read (a getter, or a message), `this`. It runs inside `init`,
    /// before the instance's ivar holds its fields, and code it reaches could
    /// send the half-made instance a message that reads one -- a crash whose
    /// stack points nowhere near the initialiser. A function the initialiser
    /// *makes* is not run by it, so its body is not looked at.
    fn refuse_reaching_initializers(&self, class: NodeId) -> Result<(), Diagnostic> {
        for member in self.children(class) {
            if self.kind_of(member) != Some(syntax::PROPERTY_DECLARATION)
                || is_static_member(self.snapshot, member)
            {
                continue;
            }
            let Some([_, _, _, _, Some(initializer)]) = self.child_slots::<5>(member) else {
                continue;
            };
            let mut pending = vec![initializer];
            while let Some(node) = pending.pop() {
                match self.kind_of(node) {
                    Some(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION) => {}
                    // `title = property("")` runs nothing: it declares a
                    // property or a signal (`lower/gobject.rs`). What it is
                    // given is held to this rule all the same.
                    Some(syntax::CALL_EXPRESSION) if self.gobject_intrinsic(node).is_some() => {
                        pending.extend(self.arguments_of(node));
                    }
                    Some(
                        syntax::CALL_EXPRESSION
                        | syntax::NEW_EXPRESSION
                        | syntax::TAGGED_TEMPLATE_EXPRESSION
                        | syntax::PROPERTY_ACCESS_EXPRESSION
                        | syntax::ELEMENT_ACCESS_EXPRESSION
                        | syntax::THIS_KEYWORD
                        | syntax::AWAIT_EXPRESSION
                        | syntax::YIELD_EXPRESSION
                        | syntax::DELETE_EXPRESSION,
                    ) => {
                        return Err(self.unsupported(
                            node,
                            "a field initialiser of a class extending a foreign class (Objective-C, `GObject` or a composable Windows Runtime class) that calls, reads a member or reads `this`: it runs as the runtime makes the instance, before the instance holds its fields, so anything it reaches could reach the half-made instance",
                        ));
                    }
                    _ => pending.extend(self.children(node)),
                }
            }
        }
        Ok(())
    }

    /// Whether `name` is a field of the class the program writes over an
    /// Objective-C class that `pointee` points at: one it declares itself and
    /// stores, as the checker records it.
    pub(super) fn is_program_objc_field(
        &self,
        pointee: &crate::hir::native::Pointee,
        name: &str,
    ) -> bool {
        let Some(handle) = opaque_handle(pointee) else {
            return false;
        };
        let Some(&(_, class_ty)) = self.hierarchy.objc_states.get(&handle.tag) else {
            return false;
        };
        self.chain_stores(class_ty, name)
    }

    /// Whether `name` is a field some class of `class_ty`'s chain declares and
    /// stores: its own, or one it inherits from a class the program wrote --
    /// every one of them in the state object (`objc_state_layout`).
    pub(super) fn chain_stores(&self, class_ty: TypeId, name: &str) -> bool {
        self.objc_chain(class_ty)
            .into_iter()
            .any(|class| declares_stored(self.snapshot, class, name))
    }

    /// The layout of the object holding the fields of the `index`th
    /// Objective-C class with fields: those each class of its chain declares
    /// itself, root first, typed as any class's are (`fields_of`). So a
    /// subclass's state begins with its base's fields, at the base's indices.
    /// Nothing the runtime's classes declare is in it: their members are
    /// reached by message.
    pub(super) fn objc_state_layout(
        &mut self,
        id: NodeId,
        index: usize,
        class_ty: TypeId,
    ) -> Result<Layout, Diagnostic> {
        let ty = crate::hir::objc_state_type(index);
        if let Some(known) = self
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&ty))
        {
            return Ok(known.clone());
        }
        let chain = self.objc_chain(class_ty);
        let mut fields = Vec::new();
        for class in &chain {
            let Some(TypeKind::Object { properties }) = self
                .snapshot
                .types
                .get(class.0 as usize)
                .map(|record| &record.kind)
            else {
                return Err(self.unsupported(
                    id,
                    "the fields of an Objective-C class the checker did not decompose",
                ));
            };
            let own: Vec<_> = properties
                .iter()
                .filter(|property| property.own)
                .cloned()
                .collect();
            fields.extend(self.fields_of(id, *class, &own)?);
        }
        // **The parent's state is this one's prefix, and `verify` checks it.**
        // One object holds a chain's fields, and a parent's method reads its
        // own through the parent's layout: that is sound only while the
        // parent's fields lead this one's, in its order. The loop above
        // arranges that, and `base` is what makes it a checked fact
        // (`BrokenBase`) that `put_bases_first` keeps, not an ordering a field
        // added to one class could silently break.
        let parent = chain
            .len()
            .checked_sub(2)
            .and_then(|at| chain.get(at).copied());
        let base = match parent.and_then(|parent| {
            self.hierarchy
                .objc_states
                .values()
                .find(|(_, declared)| *declared == parent)
                .copied()
        }) {
            Some((parent_index, parent_ty)) => {
                self.objc_state_layout(id, parent_index, parent_ty)?;
                Some(crate::hir::objc_state_type(parent_index))
            }
            None => None,
        };
        let name = self.hierarchy.name.get(&class_ty).map_or_else(
            || format!("ObjcState{index}"),
            |name| format!("{name}_state"),
        );
        let layout = Layout {
            types: vec![ty],
            name,
            interfaces: Vec::new(),
            fields,
            // Not a class of this program's: nothing dispatches on it.
            methods: vec![None; self.hierarchy.table_size()],
            base,
        };
        self.layouts.push(layout.clone());
        Ok(layout)
    }

    /// The receiver kind **an instance of a class the program writes over an
    /// Objective-C class**: `recv.x`, where `x` is one of the class's fields,
    /// is that field of the object its ivar holds, which `nts_objc_state`
    /// lends for as long as `recv` lives. `None` for any other receiver, or a
    /// member that is not a field -- a property or a method is the runtime's,
    /// and the arms after this one answer it.
    pub(super) fn program_objc_instance_place(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: &str,
    ) -> Result<Option<Place>, Diagnostic> {
        let HirType::NativePointer(pointee) = &self.values[receiver.0 as usize].ty else {
            return Ok(None);
        };
        let Some(handle) = opaque_handle(pointee) else {
            return Ok(None);
        };
        // An Objective-C class's instances carry its own name as their tag; a
        // `GObject` subclass's carry the parent's struct, which says nothing
        // of which class this is, so its fields are found by the receiver's
        // type (`state_by_type`), as a composed Windows Runtime class's are.
        let (index, class_ty, reader) =
            if let Some(&(index, class_ty)) = self.hierarchy.objc_states.get(&handle.tag) {
                (index, class_ty, "nts_objc_state")
            } else if let Some((index, class_ty, reader)) = self.state_by_type(id) {
                (index, class_ty, reader)
            } else {
                return Ok(None);
            };
        self.state_place(id, receiver, (index, class_ty, reader), member)
    }

    /// `member` of the state `reader` lends for `receiver`, as a place: a
    /// write of it notifies where it is a `GObject` property (`notifying`).
    /// `None` where `member` is not one of the state's fields.
    pub(super) fn state_place(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        (index, class_ty, reader): (usize, TypeId, &'static str),
        member: &str,
    ) -> Result<Option<Place>, Diagnostic> {
        let layout = self.objc_state_layout(id, index, class_ty)?;
        let Some(field) = layout.index_of(member) else {
            return Ok(None);
        };
        let ty = HirType::Managed(ManagedType::Object(crate::hir::objc_state_type(index)));
        let origin = self.origin(id);
        let object = self.runtime_call(reader, vec![receiver], ty, origin);
        if reader == "nts_gobject_state"
            && let Some(thunk) = self.property_notify_thunk(class_ty, member)
        {
            self.notifying.insert((object, field), (receiver, thunk));
        }
        Ok(Some(Place::Field { object, field }))
    }

    /// The getter (`setter` false) or setter the runtime calls for a field of
    /// a class the program writes over an Objective-C class, which a protocol
    /// it adopts asks for as a property: the field of the instance's state,
    /// read and answered, or written. With the signature the entry point
    /// takes it by, which is the property's.
    fn lower_objc_field_accessor(
        &mut self,
        class: NodeId,
        name: &str,
        (index, class_ty): (usize, TypeId),
        (field, property): (NodeId, &str),
        setter: bool,
    ) -> Result<(Func, crate::hir::native::FnPointer), Diagnostic> {
        let origin = self.origin(field);
        let pointee = instance_type_of(self.snapshot, class)
            .and_then(|ty| crate::hir::native::pointer(self.snapshot, ty))
            .ok_or_else(|| self.unsupported(class, "an Objective-C class with no handle type"))?;
        let value = *self
            .snapshot
            .node_types
            .get(&field)
            .ok_or_else(|| self.unrepresentable(field, "a field"))?;
        let signature = if setter {
            accessor_signature(None, Some(value), self.void_type()?)
        } else {
            accessor_signature(None, None, value)
        };
        let imp = crate::hir::native::imp_signature(self.snapshot, pointee.clone(), &signature)
            .map_err(|why| {
                self.unsupported(
                    field,
                    &format!("a field meeting a protocol's property requirement, whose {why}"),
                )
            })?;
        if matches!(*imp.result, crate::hir::native::Type::Record(_)) {
            return Err(self.unsupported(field, "a record field meeting a protocol's property requirement, which is answered by value"));
        }
        let layout = self.objc_state_layout(class, index, class_ty)?;
        let at = layout.index_of(property).ok_or_else(|| {
            self.unsupported(
                field,
                &format!("`{property}`, which is not a field of the class's state"),
            )
        })?;
        let field_ty = layout.fields[at as usize].ty.clone();
        let instance = HirType::NativePointer(pointee);
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
        let written = setter.then(|| {
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
        let state = self.runtime_call("nts_objc_state", vec![receiver], state_ty, origin.clone());
        let func = if let Some(written) = written {
            self.returns = HirType::Void;
            self.write_place(
                field,
                &Place::Field {
                    object: state,
                    field: at,
                },
                written,
            )?;
            self.terminate(Terminator::Return(None));
            self.finish(
                format!("{name}#objc set {property}"),
                params,
                HirType::Void,
                origin,
                false,
            )
        } else {
            let read = self.push(
                OpKind::FieldGet {
                    object: state,
                    field: at,
                },
                field_ty.clone(),
                origin.clone(),
            );
            self.returns = field_ty.clone();
            self.terminate(Terminator::Return(Some(read)));
            self.finish(
                format!("{name}#objc get {property}"),
                params,
                field_ty,
                origin,
                false,
            )
        };
        Ok((func, imp))
    }

    /// The state of the class the program writes that the receiver of
    /// `access` (`this.count`, `counter.count`) is an instance of, found by
    /// the receiver's type -- for a `GObject` subclass or a composed Windows
    /// Runtime class, whose handles carry the parent's tag and so say nothing
    /// of which class this is: its index and class type, as `note_objc_state`
    /// numbered it, and the runtime call lending it. `None` for any other
    /// receiver.
    pub(super) fn state_by_type(&self, access: NodeId) -> Option<(usize, TypeId, &'static str)> {
        let receiver = *self.children(access).first()?;
        self.state_of_type(*self.snapshot.node_types.get(&receiver)?)
    }

    /// [`Self::state_by_type`] for an instance whose type is already known:
    /// the state of the class the program writes behind `ty`, and the reader
    /// that lends it.
    pub(super) fn state_of_type(&self, ty: TypeId) -> Option<(usize, TypeId, &'static str)> {
        let ty = self.class_behind(ty);
        let symbol = self.snapshot.types.get(ty.0 as usize)?.symbol?;
        let class = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .copied()
            .find(|d| self.kind_of(*d) == Some(syntax::CLASS_DECLARATION))?;
        let reader = if crate::hir::native::gobject_parent(self.snapshot, class).is_some() {
            "nts_gobject_state"
        } else if crate::hir::native::extends_com(self.snapshot, class) {
            "nts_com_state"
        } else {
            return None;
        };
        let name = foreign_class_name(self.snapshot, class)?;
        let &(index, class_ty) = self.hierarchy.objc_states.get(&name)?;
        Some((index, class_ty, reader))
    }

    /// The Objective-C protocols a class the program writes adopts: each
    /// interface its heritage names that an `objc:` module declares, by the
    /// name the runtime knows it by, which is the interface's.
    pub(super) fn objc_protocols(&self, class: NodeId) -> Vec<NodeId> {
        crate::hir::native::implemented(self.snapshot, class)
            .into_iter()
            .filter(|interface| self.in_objc_module(*interface))
            .collect()
    }

    /// The selector of the method a class the program writes overrides: the
    /// nearest superclass's instance method of `name` taking `arity`
    /// arguments, as its binding tags it. Swift's names are not selectors --
    /// `draw(_:)` is `drawRect:`, `value(forKey:)` is `valueForKey:` -- so an
    /// override answers the runtime by the selector it replaces.
    pub(super) fn overridden_selector(
        &self,
        class: NodeId,
        name: &str,
        arity: usize,
    ) -> Option<String> {
        for here in self.native_bases(class) {
            let found = self.children(here).into_iter().find_map(|member| {
                let arguments = self
                    .children(member)
                    .into_iter()
                    .filter(|c| self.kind_of(*c) == Some(syntax::PARAMETER))
                    .count();
                (self.kind_of(member) == Some(syntax::METHOD_DECLARATION)
                    && !is_static_member(self.snapshot, member)
                    && self.member_name(member).as_deref() == Some(name)
                    && arguments == arity)
                    .then(|| {
                        self.node(member)
                            .native
                            .as_ref()
                            .and_then(|native| native.selector.clone())
                    })
                    .flatten()
            });
            if found.is_some() {
                return found;
            }
        }
        None
    }

    /// The selector a protocol the class adopts declares for member `name`.
    fn protocol_selector(&self, class: NodeId, name: &str) -> Option<String> {
        self.objc_protocols(class).into_iter().find_map(|protocol| {
            self.children(protocol).into_iter().find_map(|member| {
                (self.kind_of(member) == Some(syntax::METHOD_SIGNATURE)
                    && self.member_name(member).as_deref() == Some(name))
                .then(|| {
                    self.node(member)
                        .native
                        .as_ref()
                        .and_then(|native| native.selector.clone())
                })
                .flatten()
            })
        })
    }
}
