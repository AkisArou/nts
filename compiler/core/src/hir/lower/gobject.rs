//! What a class the program writes over a `GObject` class declares through
//! `c:types`' `GObject` intrinsics, each tagged `@ntsIntrinsic gobject.*` and
//! re-exported by `gi:gobject`:
//!
//! - `title = property("")`, a property, typed from its default and carrying
//!   `Property`'s brand, which is what makes the field one (`property_fields`);
//! - `readonly incremented = signal<[by: number]>()`, a signal, emitted and
//!   connected by its name as a binding's own are. Registered from the class's
//!   type (`WithSelf`'s `__c_signals`, read by `gobject_signals`); the field is
//!   only its declaration, holds nothing, and its type has no members.
//!
//! Each is a declaration, not a call: it runs nothing, so a field initialiser
//! may be one where it may not call (`refuse_reaching_initializers` looks
//! through it). Recognised by the tag's value, never by the function's name,
//! and refused by name anywhere but such a field.
use super::{
    Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, ValueId, instance_type_of,
    is_static_member,
};
use nts_semantic_schema::syntax;

/// A `GObject` intrinsic a call names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum GObjectIntrinsic {
    /// `@ntsIntrinsic gobject.property`.
    Property,
    /// `@ntsIntrinsic gobject.signal`.
    Signal,
}

impl GObjectIntrinsic {
    fn named(tag: &str) -> Option<Self> {
        match tag {
            "gobject.property" => Some(Self::Property),
            "gobject.signal" => Some(Self::Signal),
            _ => None,
        }
    }

    const fn spelled(self) -> &'static str {
        match self {
            Self::Property => "property",
            Self::Signal => "signal",
        }
    }

    /// What one declares, in a refusal's words.
    const fn declares(self) -> &'static str {
        match self {
            Self::Property => "properties",
            Self::Signal => "signals",
        }
    }
}

impl FuncBuilder<'_> {
    /// The `GObject` intrinsic `call` calls, if its callee is a declaration
    /// tagged `@ntsIntrinsic gobject.*` with no body.
    pub(super) fn gobject_intrinsic(&self, call: NodeId) -> Option<GObjectIntrinsic> {
        let decl = self.snapshot.call_targets.get(&call)?.callee?;
        if self.has_a_body(decl) {
            return None;
        }
        self.node(decl)
            .native
            .as_ref()?
            .intrinsic
            .as_deref()
            .and_then(GObjectIntrinsic::named)
    }

    /// A `property(...)` or `signal(...)`, as the initialiser of the field it
    /// declares.
    pub(super) fn lower_gobject_intrinsic(
        &mut self,
        id: NodeId,
        intrinsic: GObjectIntrinsic,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if !self.initialises_a_gobject_field(id) {
            let (name, declared) = (intrinsic.spelled(), intrinsic.declares());
            return Err(self.unsupported(
                id,
                &format!(
                    "a `{name}(...)` that is not the initialiser of a field of a class over a `GObject` class: it declares one of that class's {declared}, and is no value anywhere else"
                ),
            ));
        }
        let want = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `GObject` declaration"))?;
        match (intrinsic, arguments) {
            // The field holds its default, and is a property by its type.
            (GObjectIntrinsic::Property, [default]) => {
                let value = self.lower_expression(*default)?;
                self.coerce(value, &want, id)
            }
            // `readonly isbn = property<string>()`, which a construction must
            // give: its type's zero until it does. And a signal's field, which
            // holds nothing at all.
            (GObjectIntrinsic::Property | GObjectIntrinsic::Signal, []) => self.zero_of(id, want),
            (GObjectIntrinsic::Property, _) => Err(self.unsupported(
                id,
                "a `property` given options, which this compiler does not read yet",
            )),
            (GObjectIntrinsic::Signal, _) => Err(self.unsupported(
                id,
                "a `signal` given options, which this compiler does not read yet",
            )),
        }
    }

    /// The value a field of type `want` holds before anything is written to
    /// it.
    fn zero_of(&mut self, id: NodeId, want: HirType) -> Result<ValueId, Diagnostic> {
        let zero = match &want {
            HirType::Float { .. } => OpKind::ConstFloat(0.0),
            HirType::Bool => OpKind::ConstBool(false),
            HirType::Managed(ManagedType::String) => OpKind::ConstString(String::new()),
            HirType::NativePointer(_) | HirType::Managed(_) => OpKind::ConstNull,
            _ => {
                return Err(
                    self.unsupported(id, "a `GObject` declaration of a type with no zero here")
                );
            }
        };
        let origin = self.origin(id);
        Ok(self.push(zero, want, origin))
    }

    /// Whether `call` initialises an instance field of a class whose instances
    /// are `GObject` handles: where a `GObject` intrinsic declares something.
    fn initialises_a_gobject_field(&self, call: NodeId) -> bool {
        let Some(field) = self.node(call).parent else {
            return false;
        };
        if self.kind_of(field) != Some(syntax::PROPERTY_DECLARATION)
            || is_static_member(self.snapshot, field)
        {
            return false;
        }
        let Some(class) = self.enclosing_class(field) else {
            return false;
        };
        matches!(
            instance_type_of(self.snapshot, class).and_then(|ty| crate::hir::native::pointer(self.snapshot, ty)),
            Some(crate::hir::native::Pointee::Opaque(handle)) if handle.family == crate::hir::native::Family::GObject
        )
    }
}
