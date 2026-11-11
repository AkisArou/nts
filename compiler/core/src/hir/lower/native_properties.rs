//! Resolve native property places and variable reads and bridge their accessors.

use super::{
    Callee, Diagnostic, FuncBuilder, HirType, NodeId, Place, TypeId, ValueId, accessor_signature,
};

/// How a construction writes one property (`Lowerer::constructed_setter`).
pub(super) enum ConstructedSetter {
    /// A binding's, through the method its `@ntsSet` names.
    Method(String),
    /// A class the program writes, through its state's field.
    Field(Place),
}

/// One property a construction sets: its value, where it was written, and --
/// for one read from a props object passed through -- the test of whether it
/// was given at all.
pub(super) struct SetProperty {
    pub(super) name: String,
    pub(super) value: ValueId,
    pub(super) node: NodeId,
    pub(super) present: Option<ValueId>,
    /// What an erased value read from a props object is read back as where
    /// it was given: its type without the `undefined` that optional adds.
    pub(super) unerase: Option<HirType>,
}

impl FuncBuilder<'_> {
    /// A native handle's property as a place (`Place::NativeAccessor`):
    /// its methods, and the receiver, lowered once. A Windows Runtime
    /// property, reached through a slot rather than a method, is refused by
    /// name.
    pub(super) fn native_accessor_place(
        &mut self,
        target: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Result<Place, Diagnostic> {
        let setter = self.accessor(member, true).ok_or_else(|| {
            self.unsupported(
                target,
                "an assignment to a native property no @ntsSet names a method for",
            )
        })?;
        let getter = self.accessor(member, false);
        if setter.contains(char::is_whitespace)
            || getter
                .as_deref()
                .is_some_and(|getter| getter.contains(char::is_whitespace))
        {
            return Err(self.unsupported(
                target,
                "reading a Windows Runtime property as part of assigning to it",
            ));
        }
        let ty = self
            .snapshot
            .node_types
            .get(&object)
            .copied()
            .ok_or_else(|| {
                self.unsupported(
                    target,
                    &format!("a native property whose accessor `{setter}` has no receiver type"),
                )
            })?;
        let receiver = self.lower_expression(object)?;
        Ok(Place::NativeAccessor {
            receiver,
            ty,
            getter,
            setter,
            takes_value: true,
        })
    }

    /// A native property's value through its `@ntsGet` method, for a place
    /// read before it is written; refused by name for one only written.
    pub(super) fn read_native_accessor(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        ty: TypeId,
        getter: Option<&str>,
    ) -> Result<ValueId, Diagnostic> {
        let getter = getter.ok_or_else(|| {
            self.unsupported(id, "reading a native property no @ntsGet names a method for, as part of assigning to it")
        })?;
        self.lower_accessor_on(id, receiver, ty, getter, None)
    }

    /// A read an object system answers rather than a field: an Objective-C
    /// property, which is a message, and the one named read through a handle
    /// that is not refused in [`Self::lower_property_access`]; and
    /// `Task.$gtype`, a `GObject` class's `GType`.
    pub(super) fn foreign_property_read(
        &mut self,
        id: NodeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let [object, member] = self.children(id)[..] else {
            return Ok(None);
        };
        if let Some(value) = self.lower_objc_property_get(id, object, member)? {
            return Ok(Some(value));
        }
        self.gtype_read(id, object, member).transpose()
    }

    /// The value of the extern variable `declaration` names (`@ntsSymbol`),
    /// at the declared type: a native with no parameters whose convention
    /// is [`crate::hir::native::Convention::Variable`], which each backend reads
    /// rather than calls. An `NSString *` crosses as a C function's does,
    /// as a `BridgedString` copied into the program's string.
    pub(super) fn read_native_variable(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        ty: TypeId,
    ) -> Result<ValueId, Diagnostic> {
        let signature = accessor_signature(None, None, ty);
        let Callee::Native(target) =
            self.native_callee(id, Some(declaration), String::new(), &signature)?
        else {
            return Err(self.unsupported(id, "a constant whose binding names no C variable"));
        };
        if !target.parameters.is_empty()
            || matches!(
                target.result,
                crate::hir::native::Type::Record(_) | crate::hir::native::Type::Void
            )
        {
            return Err(self.unsupported(id, "a constant that is not one value a C variable holds"));
        }
        let mut variable = (*target).clone();
        variable.convention = crate::hir::native::Convention::Variable;
        let callee = Callee::Native(std::sync::Arc::new(variable));
        self.finish_call_typed(id, callee, Vec::new(), Vec::new(), Some(declaration), None)
    }
}
