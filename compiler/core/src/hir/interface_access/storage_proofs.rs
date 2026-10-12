//! A dominating class test can leave only the receiver's exact layout.
//! Such a stored access stays direct. Equal layouts remain equal after numeric
//! storage decisions; a prefix comparison made before those decisions cannot
//! grant that permission. User getters are never pending stored accesses.

use rustc_hash::FxHashSet;

use crate::hir::fields::LayoutIndex;
use crate::hir::{
    BlockId, Func, HirType, ManagedType, OpKind, Program, Terminator, TypeId, ValueId,
};

struct Proof<'a> {
    program: &'a Program,
    layouts: LayoutIndex,
    nominal: FxHashSet<usize>,
}

pub(super) fn direct_sites(program: &Program) -> Vec<FxHashSet<ValueId>> {
    let layouts = LayoutIndex::build(program);
    let nominal = program
        .classes
        .iter()
        .flat_map(|class| &class.types)
        .filter_map(|ty| layouts.of_class(*ty))
        .collect();
    let proof = Proof {
        program,
        layouts,
        nominal,
    };
    program
        .funcs
        .iter()
        .map(|func| proof.direct(func))
        .collect()
}

impl Proof<'_> {
    fn direct(&self, func: &Func) -> FxHashSet<ValueId> {
        let sites: Vec<_> = func
            .blocks
            .iter()
            .enumerate()
            .flat_map(|(at, block)| {
                block.ops.iter().filter_map(move |value| {
                    let kind = &func.value(*value).kind;
                    self.program.interface_access.stored_entry(func, kind)?;
                    let object = match kind {
                        OpKind::FieldGet { object, .. } | OpKind::FieldSet { object, .. } => {
                            *object
                        }
                        _ => return None,
                    };
                    Some((*value, BlockId(u32::try_from(at).ok()?), object))
                })
            })
            .collect();
        if sites.is_empty() {
            return FxHashSet::default();
        }
        let reached = crate::hir::verify::reachable_blocks(func);
        let idom = crate::hir::verify::dominators(func, &reached);
        sites
            .into_iter()
            .filter_map(|(value, block, object)| {
                self.same_layout(func, &idom, block, object, value)
                    .then_some(value)
            })
            .collect()
    }

    fn same_layout(
        &self,
        func: &Func,
        idom: &[Option<BlockId>],
        block: BlockId,
        object: ValueId,
        value: ValueId,
    ) -> bool {
        let HirType::Managed(ManagedType::Object(face)) = func.value(object).ty else {
            return false;
        };
        let (OpKind::FieldGet { field, .. } | OpKind::FieldSet { field, .. }) =
            func.value(value).kind
        else {
            return false;
        };
        let Some(at) = self.program.interface_access.by_field.get(&(face, field)) else {
            return false;
        };
        let Some(layout) = self.layouts.of_class(face) else {
            return false;
        };
        let subject = identity(func, object);
        if matches!(func.value(subject).kind, OpKind::ObjectNew { .. })
            && let HirType::Managed(ManagedType::Object(owner)) = func.value(subject).ty
        {
            return self.layouts.of_class(owner) == Some(layout);
        }
        let family = &self.program.interface_access.families[*at];
        let mut owners = family.owners.clone();
        let mut child = block;
        while let Some(parent) = idom[child.0 as usize] {
            if parent == child {
                break;
            }
            if let Terminator::Branch {
                cond,
                then_target,
                else_target,
                ..
            } = &func.blocks[parent.0 as usize].terminator
                && then_target != else_target
                && (*then_target == child || *else_target == child)
                && let OpKind::InstanceOf { value, classes } = &func.value(*cond).kind
                && identity(func, *value) == subject
            {
                let positive = *then_target == child;
                owners.retain(|owner| {
                    self.matches(*owner, classes)
                        .is_none_or(|yes| yes == positive)
                });
            }
            child = parent;
        }
        !owners.is_empty()
            && owners
                .iter()
                .all(|owner| self.layouts.of_class(*owner) == Some(layout))
    }

    // Nominal identities can share storage. An ambiguous identity never grants
    // a permission to remove a supplier from the candidate set.
    fn matches(&self, owner: TypeId, classes: &[TypeId]) -> Option<bool> {
        let owner = self.layouts.of_class(owner)?;
        if self.nominal.contains(&owner) {
            return None;
        }
        let mut unknown = false;
        for class in classes {
            let Some(layout) = self.layouts.of_class(*class) else {
                unknown = true;
                continue;
            };
            if self.nominal.contains(&layout) {
                unknown = true;
                continue;
            }
            if layout == owner {
                return Some(true);
            }
        }
        (!unknown).then_some(false)
    }
}

fn identity(func: &Func, mut value: ValueId) -> ValueId {
    for _ in 0..func.values.len() {
        match func.value(value).kind {
            OpKind::Convert(source)
            | OpKind::FieldView { value: source, .. }
            | OpKind::Erase { value: source, .. }
            | OpKind::Unerase { value: source } => value = source,
            _ => return value,
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_frontend_ts::{SemanticSource, TsgoApi};

    #[test]
    fn removing_the_class_test_removes_the_direct_storage_permission() {
        let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
            return;
        };
        let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/programs/accessor-layout-proof/tsconfig.json");
        let snapshot = TsgoApi::for_compilation(tsgo)
            .snapshot(&config)
            .unwrap_or_else(|error| panic!("snapshot failed: {error:?}"));
        let mut program = crate::hir::lower::lower(&snapshot).program;
        let at = program
            .funcs
            .iter()
            .position(|func| func.name == "guarded")
            .unwrap_or_else(|| panic!("guarded is lowered"));
        let reads: FxHashSet<_> = direct_sites(&program)[at]
            .iter()
            .filter(|value| {
                matches!(
                    program.funcs[at].value(**value).kind,
                    OpKind::FieldGet { .. }
                )
            })
            .copied()
            .collect();
        assert!(!reads.is_empty());
        for op in &mut program.funcs[at].values {
            if matches!(op.kind, OpKind::InstanceOf { .. }) {
                op.kind = OpKind::ConstBool(false);
            }
        }
        assert!(direct_sites(&program)[at].is_disjoint(&reads));
    }
}
