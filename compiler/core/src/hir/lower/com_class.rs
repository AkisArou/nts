//! Register COM classes and lower their constructor, activation, member, and super routes.

use super::{
    Callee, Diagnostic, Func, FuncBuilder, HirType, Lowered, LoweringSnapshot, MadeBy, ManagedType,
    NodeId, OpKind, Origin, Terminator, TypeId, ValueId, foreign_class_name, instance_type_of,
    note_uncompiled, syntax,
};

/// An override of a composable Windows Runtime class, called through its
/// adapter -- which, where the method answers a record by value, passes the
/// slot's result pointer last to write it through (`record_out`).
#[derive(Clone, Copy)]
pub(super) struct ComEntry {
    pub(super) returns_record: bool,
    /// The parameters, by index (`this` is 0), that are an `HSTRING` the
    /// Windows Runtime lends: each arrives as its handle and is bound to a
    /// string holding its text.
    pub(super) hstrings: u64,
}

/// A class the program writes over a composable Windows Runtime class,
/// recorded as the runtime will compose it (`Program::foreign_classes`): its
/// overrides, by interface and slot, and the factory of the class it extends.
pub(super) fn register_com_class(
    snapshot: &LoweringSnapshot<'_>,
    class: NodeId,
    mut composition: crate::hir::native::Composable,
    methods: Vec<crate::hir::ForeignMethod>,
    state: Option<String>,
    lowered: &mut Lowered,
) {
    let probe = FuncBuilder::probe(snapshot);
    // An interface answered by the class's own table answers all of its
    // methods there: each one the class does not override is forwarded to the
    // base's own, and one that cannot be is refused by name, not left a gap.
    match probe.forwarded(class, &methods) {
        Ok(forwarded) => composition.forwarded = forwarded,
        Err((missing, why)) => {
            let diagnostic = probe.unsupported(
                class,
                &format!("a class written over a composable Windows Runtime class that overrides some of an interface's methods and not `{missing}`, whose base's is forwarded to and cannot be: {why}"),
            );
            note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
            lowered.diagnostics.push(diagnostic);
            return;
        }
    }
    let Some(name) = probe.children(class).into_iter().find_map(|child| {
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
    }) else {
        return;
    };
    lowered
        .program
        .foreign_classes
        .push(crate::hir::ForeignClass {
            family: crate::hir::native::Family::Com,
            name,
            type_name: None,
            superclass: composition.class.clone().into(),
            methods,
            protocols: Vec::new(),
            state,
            composition: Some(composition),
            signals: Vec::new(),
            properties: Vec::new(),
            template: None,
        });
}

impl FuncBuilder<'_> {
    /// A method of a class the program writes over an Objective-C class: the
    /// compiled function, and how the runtime reaches it -- the selector
    /// `@ntsSelector` names or Swift's `@objc` rule makes of its name
    /// (`pressed(sender)` is `pressed:`), and the C signature it is called
    /// with.
    /// One member of a class the program writes over a composable Windows
    /// Runtime class: a method overriding one its base declares for
    /// overriding (`@ntsOverride`), compiled as the program's function taking
    /// the instance and the arguments, and recorded with the adapter
    /// signature its interface's table calls it by. Anything else is refused
    /// by name: the runtime makes the object, so it has no constructor of the
    /// program's, and no room for a field.
    pub(super) fn lower_com_member(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<(Func, Option<crate::hir::ForeignMethod>), Diagnostic> {
        match self.kind_of(member) {
            Some(syntax::METHOD_DECLARATION) => {}
            Some(syntax::CONSTRUCTOR) => return Ok((self.lower_com_constructor(class, member, instance)?, None)),
            _ => return Err(self.unsupported(member, "a member of a class written over a composable Windows Runtime class that is not a method")),
        }
        let name = self
            .member_name(member)
            .ok_or_else(|| self.unsupported(member, "a member whose name the program computes"))?;
        // A method that overrides nothing is the program's own, called with
        // the instance as any class's method is; no table answers it.
        let Some((iid, slot, overridden)) = self.overridden_slot(class, &name) else {
            return Ok((self.lower_method_of(class, member, instance)?, None));
        };
        // The table's slot is called as the binding declares it -- an
        // `int32` is an `int32` however the override spells its parameter --
        // and the adapter converts to what the compiled method takes.
        let signature = crate::hir::generics::declared_signature(self.snapshot, overridden)
            .cloned()
            .ok_or_else(|| {
                self.unsupported(member, "an override whose binding declares no signature")
            })?;
        let adapter = crate::hir::native::override_signature(self.snapshot, &signature)
            .map_err(|why| self.unsupported(member, &format!("an override's {why}")))?;
        let hstrings = signature
            .parameters
            .iter()
            .enumerate()
            .filter(|(_, parameter)| crate::hir::native::is_hstring(self.snapshot, parameter.ty))
            .fold(0u64, |mask, (at, _)| mask | (1u64 << (at + 1).min(63)));
        self.com_entry = Some(ComEntry {
            returns_record: matches!(*adapter.result, crate::hir::native::Type::Record(_)),
            hstrings,
        });
        let func = self.lower_method_of(class, member, instance);
        self.com_entry = None;
        let func = func?;
        let method = crate::hir::ForeignMethod {
            dispatch: crate::hir::Dispatch::Slot { iid, slot },
            function: func.name.clone(),
            signature: std::sync::Arc::new(adapter),
            declared_at: None,
        };
        Ok((func, Some(method)))
    }

    /// The slots of the interfaces the class overrides some of that it does
    /// not override, each with the signature it is called with: the base
    /// declares it overridable at the same IID, and no method of the class
    /// answers its slot. A binding lists an overridable interface on every
    /// class deriving from its declarer, so a slot is taken once, nearest
    /// base first. `Err` names the first that cannot be forwarded, and why.
    fn forwarded(
        &self,
        class: NodeId,
        methods: &[crate::hir::ForeignMethod],
    ) -> Result<Vec<crate::hir::native::Forwarded>, (String, String)> {
        let mut answered: Vec<(String, u32)> = methods
            .iter()
            .filter_map(|method| match &method.dispatch {
                crate::hir::Dispatch::Slot { iid, slot } => Some((iid.clone(), *slot)),
                crate::hir::Dispatch::Selector(_) => None,
            })
            .collect();
        let used: Vec<String> = answered.iter().map(|(iid, _)| iid.clone()).collect();
        let mut forwarded = Vec::new();
        let mut at = crate::hir::native::superclass(self.snapshot, class);
        while let Some(base) = at {
            for member in self.children(base) {
                let Some(tag) = self
                    .node(member)
                    .native
                    .as_ref()
                    .and_then(|native| native.overridable.clone())
                else {
                    continue;
                };
                let words: Vec<&str> = tag.split_whitespace().collect();
                let [iid, slot, name, ..] = words.as_slice() else {
                    continue;
                };
                let Ok(slot) = slot.parse::<u32>() else {
                    continue;
                };
                if !used.iter().any(|used| used == iid)
                    || answered.iter().any(|(done, at)| done == iid && *at == slot)
                {
                    continue;
                }
                let signature = crate::hir::generics::declared_signature(self.snapshot, member)
                    .ok_or_else(|| {
                        (
                            (*name).to_owned(),
                            "its binding declares no signature".to_owned(),
                        )
                    })?;
                let signature = crate::hir::native::forward_signature(self.snapshot, signature)
                    .map_err(|why| ((*name).to_owned(), why))?;
                answered.push(((*iid).to_owned(), slot));
                forwarded.push(crate::hir::native::Forwarded {
                    iid: (*iid).to_owned(),
                    slot,
                    signature: std::sync::Arc::new(signature),
                });
            }
            at = crate::hir::native::superclass(self.snapshot, base);
        }
        Ok(forwarded)
    }

    /// The interface and slot a base the program's class extends declares a
    /// method of this name overridable at (`@ntsOverride <IID> <slot> <name>`),
    /// nearest base first, and the binding's declaration of it.
    fn overridden_slot(&self, class: NodeId, name: &str) -> Option<(String, u32, NodeId)> {
        let mut at = crate::hir::native::superclass(self.snapshot, class);
        while let Some(base) = at {
            for member in self.children(base) {
                let tagged = self
                    .node(member)
                    .native
                    .as_ref()
                    .and_then(|native| native.overridable.clone());
                if let Some(tag) = tagged
                    && self.member_name(member).as_deref() == Some(name)
                {
                    let words: Vec<&str> = tag.split_whitespace().collect();
                    if let [iid, slot, ..] = words.as_slice() {
                        return Some(((*iid).to_owned(), slot.parse().ok()?, member));
                    }
                }
            }
            at = crate::hir::native::superclass(self.snapshot, base);
        }
        None
    }

    /// Whether a constructor body opens with its `super(...)`: `this` is one
    /// object for the whole body, and one made in a branch is not.
    pub(super) fn opens_with_super(&self, body: NodeId) -> bool {
        self.children(body).first().is_some_and(|first| {
            self.kind_of(*first) == Some(syntax::EXPRESSION_STATEMENT)
                && self.children(*first).first().is_some_and(|call| {
                    self.kind_of(*call) == Some(syntax::CALL_EXPRESSION)
                        && self.children(*call).first().is_some_and(|callee| {
                            self.kind_of(*callee) == Some(syntax::SUPER_KEYWORD)
                        })
                })
        })
    }

    /// A constructor of a class the program writes over a composable Windows
    /// Runtime class, as C#'s `public App() { ... }`: `{Class}#new`, taking
    /// the constructor's parameters and answering the instance (+1). Its
    /// `super()` composes the instance (`com_super`), whose fields the runtime
    /// has made already, and the body runs with `this`.
    fn lower_com_constructor(
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
                    "a constructor of a composed class with no instance type",
                )
            })?;
        let Some(ty @ HirType::NativePointer(_)) = self.represent(instance) else {
            return Err(self.unsupported(
                member,
                "a constructor of a composed class whose instances are not its base's handle",
            ));
        };
        let body = self.method_body(member, false)?.ok_or_else(|| {
            self.unsupported(member, "a composed class's constructor with no body")
        })?;
        if !self.opens_with_super(body) {
            return Err(self.unsupported(member, "a constructor of a class over a composable Windows Runtime class that does not open with its `super()`"));
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
                return Err(self.unsupported(child, "a constructor parameter that declares a field of a class over a composable Windows Runtime class"));
            }
            let index = u32::try_from(params.len()).unwrap_or(0);
            params.extend(self.lower_param(child, index)?);
        }
        self.made_by = Some(MadeBy::Com(name.clone()));
        self.returns = ty.clone();
        self.lower_block(body)?;
        if !self.is_terminated() {
            let made = self.this.ok_or_else(|| {
                self.unsupported(
                    member,
                    "a composed class's constructor that made no instance",
                )
            })?;
            self.terminate(Terminator::Return(Some(made)));
        }
        Ok(self.finish(format!("{name}#new"), params, ty, origin, false))
    }

    /// `super()` in such a constructor: the instance, composed by the runtime
    /// by the class's name, and `this` from here on. The base's composable
    /// factory takes nothing of the program's, so neither does `super`.
    pub(super) fn com_super(
        &mut self,
        id: NodeId,
        name: &str,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if !arguments.is_empty() {
            return Err(self.unsupported(id, "a `super(...)` with arguments in a class over a composable Windows Runtime class, whose factory takes none"));
        }
        let Some(ty @ HirType::NativePointer(_)) = self.represent(self.this_instance_type(id)?)
        else {
            return Err(self.unsupported(
                id,
                "a composed class whose instances are not its base's handle",
            ));
        };
        let made = self.compose_named(name, ty, &self.origin(id));
        self.this = Some(made);
        Ok(made)
    }

    /// The runtime's composition of the class registered as `name` (+1).
    fn compose_named(&mut self, name: &str, ty: HirType, origin: &Origin) -> ValueId {
        let name = self.push(
            OpKind::ConstString(name.to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        self.runtime_call("nts_com_compose_named", vec![name], ty, origin.clone())
    }

    /// What a declaration's `@ntsFactory` names: the runtime class whose
    /// activation factory, as the interface the IID names, is a static's
    /// receiver.
    pub(super) fn factory_of(
        &self,
        call: NodeId,
        decl: NodeId,
    ) -> Result<Option<crate::hir::native::Factory>, Diagnostic> {
        let Some(text) = self
            .node(decl)
            .native
            .as_deref()
            .and_then(|n| n.factory.as_deref())
        else {
            return Ok(None);
        };
        let words: Vec<&str> = text.split_whitespace().collect();
        let [class, iid] = words.as_slice() else {
            return Err(self.unsupported(call, "@ntsFactory names the runtime class and the interface ID, as in `@ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C`"));
        };
        if !crate::hir::native::is_interface_id(iid) {
            return Err(self.unsupported(
                call,
                "@ntsFactory with an interface ID that is not 8-4-4-4-12 hexadecimal digits",
            ));
        }
        Ok(Some(crate::hir::native::Factory {
            class: (*class).to_owned(),
            iid: iid.trim_matches(['{', '}']).to_owned(),
        }))
    }

    /// `@ntsQuery`: the receiver as the COM interface the IID names, which is
    /// `QueryInterface` -- a table of the object's own, not a conversion of
    /// the pointer the program has. What comes back is a reference of its own,
    /// released when the program is done with it, as a runtime call's result
    /// is; an object without the interface ends the process naming it, since
    /// the binding said the class implements it.
    pub(super) fn lower_query(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        iid: &str,
        result: nts_semantic_schema::TypeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if !arguments.is_empty() {
            return Err(self.unsupported(
                id,
                "@ntsQuery on a method that takes arguments beside `this`",
            ));
        }
        if !crate::hir::native::is_interface_id(iid) {
            return Err(self.unsupported(
                id,
                "@ntsQuery with an interface ID that is not 8-4-4-4-12 hexadecimal digits",
            ));
        }
        let ty = self
            .represent(result)
            .ok_or_else(|| self.unrepresentable(id, "the interface @ntsQuery answers"))?;
        let origin = self.origin(id);
        let [low, high] = self.iid_arguments(iid, &origin);
        Ok(self.runtime_call("nts_com_query", vec![receiver, low, high], ty, origin))
    }

    /// The call at `id`, when its callee is an `@ntsActivate` constructor.
    pub(super) fn activation_call(
        &mut self,
        id: NodeId,
        target: &nts_semantic_schema::CallTarget,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        let activate = self
            .node(target.callee?)
            .native
            .as_ref()
            .and_then(|n| n.activate.clone())?;
        let result = self.snapshot.signatures[target.signature.0 as usize].return_type;
        Some(self.lower_activation(id, &activate, result, arguments))
    }

    /// `@ntsActivate`: a runtime class made by its default constructor
    /// (`IActivationFactory::ActivateInstance` on the class's cached factory)
    /// and answered as its default interface -- a reference of the program's
    /// own, as a runtime call's result is.
    fn lower_activation(
        &mut self,
        id: NodeId,
        activate: &str,
        result: nts_semantic_schema::TypeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let words: Vec<&str> = activate.split_whitespace().collect();
        let [class, iid] = words.as_slice() else {
            return Err(self.unsupported(
                id,
                "@ntsActivate names the runtime class and its default interface's IID",
            ));
        };
        if !arguments.is_empty() {
            return Err(self.unsupported(id, "@ntsActivate on a function that takes arguments; a constructor that does is a factory method"));
        }
        if !crate::hir::native::is_interface_id(iid) {
            return Err(self.unsupported(
                id,
                "@ntsActivate with an interface ID that is not 8-4-4-4-12 hexadecimal digits",
            ));
        }
        let ty = self
            .represent(result)
            .ok_or_else(|| self.unrepresentable(id, "the object @ntsActivate makes"))?;
        let origin = self.origin(id);
        let text = HirType::Managed(ManagedType::String);
        let class = self.push(
            OpKind::ConstString((*class).to_owned().into()),
            text,
            origin.clone(),
        );
        let [low, high] = self.iid_arguments(iid, &origin);
        Ok(self.runtime_call("nts_winrt_activate", vec![class, low, high], ty, origin))
    }

    /// The receiver of a runtime class's static: its activation factory as the
    /// interface the binding names, activated once and cached by the runtime.
    pub(super) fn factory_receiver(
        &mut self,
        factory: &crate::hir::native::Factory,
        id: NodeId,
    ) -> ValueId {
        let origin = self.origin(id);
        let text = HirType::Managed(ManagedType::String);
        let class = self.push(
            OpKind::ConstString(factory.class.clone().into()),
            text,
            origin.clone(),
        );
        let [low, high] = self.iid_arguments(&factory.iid, &origin);
        self.runtime_call(
            "nts_winrt_factory",
            vec![class, low, high],
            HirType::NativePointer(crate::hir::native::Pointee::Void),
            origin,
        )
    }

    /// `new C(...)` for an Objective-C class: `+alloc` sent to the class, then
    /// the constructor's `init...` sent to what it answered, which is ARC's
    /// own pair -- the first hands over an object, the second consumes it and
    /// hands over one. A constructor whose selector is a class method
    /// (`@ntsSelector +buttonWithTitle:target:action:`, which Swift imports as
    /// an `init`) is that one message instead.
    /// `new App()` for a class the program writes over a composable Windows
    /// Runtime class: the runtime composes it (`nts_com_compose_named`, by the
    /// name the class is registered under) and answers the base's default
    /// interface on the aggregate, +1. It takes no arguments: the class has
    /// no constructor of its own, and the base's is its factory's
    /// parameterless one.
    pub(super) fn lower_com_new(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        let Some(class) = self.constructed_class(id) else {
            return Ok(None);
        };
        // A runtime class a binding declares, made by the constructor the
        // checker chose: composable or sealed, a factory's method or the
        // default activation. Only the class's own constructor: one a class
        // of the program's inherits from its base would make the base, not
        // the class written over it.
        let own = self
            .snapshot
            .call_targets
            .get(&id)
            .and_then(|target| target.callee)
            .is_some_and(|constructor| self.enclosing_class(constructor) == Some(class));
        if own && let Some(object) = self.lower_com_construct(id)? {
            return Ok(Some(object));
        }
        if crate::hir::native::is_com_class(self.snapshot, class) {
            return Ok(None);
        }
        if !crate::hir::native::extends_com(self.snapshot, class) {
            return Ok(None);
        }
        let Some(name) = foreign_class_name(self.snapshot, class) else {
            return Err(self.unsupported(
                id,
                "a `new` of an anonymous class written over a composable Windows Runtime class",
            ));
        };
        // A class with a constructor is made by it: `{Class}#new`, whose
        // `super()` composes the instance.
        if let Some(constructor) = self
            .children(class)
            .into_iter()
            .find(|member| self.kind_of(*member) == Some(syntax::CONSTRUCTOR))
        {
            let callee = Callee::Direct(format!("{name}#new"));
            let arguments = self.arguments_of(id);
            let (args, lent) = self.lower_call_arguments(id, &callee, &arguments, None)?;
            return self
                .finish_call(id, callee, args, lent, Some(constructor))
                .map(Some);
        }
        if !self.arguments_of(id).is_empty() {
            return Err(self.unsupported(id, "a `new` with arguments of a class written over a composable Windows Runtime class that declares no constructor"));
        }
        let Some(ty @ HirType::NativePointer(_)) = self.type_of(id) else {
            return Err(self.unsupported(id, "a class written over a composable Windows Runtime class whose instances are not its base's handle"));
        };
        Ok(Some(self.compose_named(&name, ty, &self.origin(id))))
    }

    /// `new Window()`: a composable Windows Runtime class a binding declares,
    /// made as itself -- its constructor is its factory's `CreateInstance`,
    /// tagged as the static is (`@ntsVtable`, `@ntsHresult composable`,
    /// `@ntsFactory`), and called as the static is, with no outer object.
    /// `None` for a constructor with no slot, which nothing lowers.
    fn lower_com_construct(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        let Some(target) = self.snapshot.call_targets.get(&id).copied() else {
            return Ok(None);
        };
        let Some(declaration) = target.callee else {
            return Ok(None);
        };
        // `new PropertySet()`: the default constructor, activated.
        if let Some(activate) = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.activate.clone())
        {
            let result = self.snapshot.signatures[target.signature.0 as usize].return_type;
            let arguments = self.arguments_of(id);
            return self
                .lower_activation(id, &activate, result, &arguments)
                .map(Some);
        }
        let Some(method) = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.vtable.as_deref())
            .and_then(|v| v.split_whitespace().nth(1))
            .map(str::to_owned)
        else {
            return Ok(None);
        };
        // The constructor is the factory's method, answering the instance:
        // a call, not a construct signature, to the function it lowers to.
        let mut signature = self.snapshot.signatures[target.signature.0 as usize].clone();
        signature.is_construct = false;
        let callee = self.native_callee(id, Some(declaration), method, &signature)?;
        // Called on the class's factory, as the static is.
        let factory = match &callee {
            Callee::Native(target) => target
                .vtable
                .as_ref()
                .and_then(|vtable| vtable.factory.clone()),
            _ => None,
        };
        let receiver = factory.map(|factory| self.factory_receiver(&factory, id));
        let arguments = self.arguments_of(id);
        let (args, lent) = self.lower_call_arguments(id, &callee, &arguments, receiver)?;
        self.finish_call(id, callee, args, lent, Some(declaration))
            .map(Some)
    }

    /// The class declaration a `new` constructs, through its expression's
    /// symbol: `App` in `new App()`.
    fn constructed_class(&self, id: NodeId) -> Option<NodeId> {
        let expression = *self.children(id).first()?;
        let symbol = self.denoted_symbol(self.node(expression).symbol?);
        self.snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .copied()
            .find(|declaration| self.kind_of(*declaration) == Some(syntax::CLASS_DECLARATION))
    }
}
