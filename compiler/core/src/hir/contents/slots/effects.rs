//! Fixed transfer inputs, built once per function before the CFG fixpoint.

use super::Aliases;
use crate::hir::{Func, Global, HirType, Layout, ManagedType, OpKind, ValueId};

#[derive(Debug)]
pub(in crate::hir) struct Inputs {
    pub(super) aliases: Aliases,
    stores: Vec<(bool, bool)>,
}

impl Inputs {
    pub(in crate::hir) fn of(func: &Func, layouts: &[Layout], globals: &[Global]) -> Self {
        let stores = func
            .values
            .iter()
            .map(|op| store_effects(func, layouts, globals, &op.kind))
            .collect();
        Self {
            aliases: Aliases::of(func),
            stores,
        }
    }

    pub(in crate::hir) fn retain(&self, value: ValueId) -> bool {
        self.stores[value.0 as usize].0
    }

    pub(in crate::hir) fn cleanup(&self, value: ValueId) -> bool {
        self.stores[value.0 as usize].1
    }

    pub(in crate::hir) fn store_reenters(func: &Func, layouts: &[Layout], kind: &OpKind) -> bool {
        let (retain, cleanup) = store_effects(func, layouts, &[], kind);
        retain || cleanup
    }
}

fn foreign(ty: &HirType) -> bool {
    match ty {
        HirType::Erased => true,
        HirType::PossiblyUndefined(payload) => foreign(payload),
        _ => ty.counting().is_some(),
    }
}

/// rc reads the declared slot type, which can be wider than the new value.
/// An erased slot may previously have held a foreign handle even when the
/// value now being stored is a managed object or null.
fn store_effects(
    func: &Func,
    layouts: &[Layout],
    globals: &[Global],
    kind: &OpKind,
) -> (bool, bool) {
    let (stored, old) = match kind {
        OpKind::FieldSet {
            object,
            field,
            value,
        } => {
            let old = match &func.value(*object).ty {
                HirType::Managed(ManagedType::Object(ty)) => layouts
                    .iter()
                    .find(|layout| layout.types.contains(ty))
                    .and_then(|layout| layout.fields.get(*field as usize))
                    .map(|field| &field.ty),
                _ => None,
            };
            (*value, old)
        }
        OpKind::ArraySet { array, value, .. } => {
            let old = match &func.value(*array).ty {
                HirType::Managed(ManagedType::Array(element) | ManagedType::View(element)) => {
                    Some(element.as_ref())
                }
                _ => None,
            };
            (*value, old)
        }
        OpKind::GlobalSet { global, value } => (
            *value,
            globals.get(*global as usize).map(|global| &global.ty),
        ),
        _ => return (false, false),
    };
    let new = &func.value(stored).ty;
    (foreign_value(func, stored), foreign(old.unwrap_or(new)))
}

fn foreign_value(func: &Func, mut value: ValueId) -> bool {
    // An explicit erasure preserves its payload's known counting family.
    while let OpKind::Erase { value: payload, .. } = func.value(value).kind {
        value = payload;
    }
    !matches!(
        func.value(value).kind,
        OpKind::ConstNull | OpKind::ConstUndefined
    ) && foreign(&func.value(value).ty)
}
