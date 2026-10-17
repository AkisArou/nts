//! The core's local must-proof admits dense allocations without any change
//! to their representation. An incomplete typed allocation passed through a
//! field, call or CFG edge instead carries a runtime initialized prefix.
//! Every read through that representation checks the prefix; a genuine hole
//! still refuses rather than answering the typed backing's zero.

use crate::{EmitError, error::Failure};
use nts_core::hir::{ArrayFill, Func, HirType, ManagedType, OpKind, Program, ValueId};
use rustc_hash::FxHashMap;
use std::collections::BTreeSet;

pub(crate) const HOLE: &str = "typed array holes: observed slot is not proven initialized";

/// The core analysis remains the sole static proof. Its observations select
/// allocations needing a runtime contract, never establish a new core fact.
#[derive(Debug, Default)]
pub(crate) struct Plan {
    tracked: FxHashMap<String, BTreeSet<ValueId>>,
    blocked: FxHashMap<String, ValueId>,
}

impl Plan {
    pub(crate) fn build(program: &Program) -> Self {
        Self::with_prefixes(
            program,
            std::env::var_os("NTS_WASM_ARRAY_PREFIX").as_deref() != Some(std::ffi::OsStr::new("0")),
        )
    }

    fn with_prefixes(program: &Program, enabled: bool) -> Self {
        let mut plan = Self::default();
        for func in &program.funcs {
            let observations = nts_core::hir::holes::observations(func);
            for observed in observations {
                let kind = &func.value(observed).kind;
                // Keep the old direct-read and erasure floors. The new path
                // carries the wrapper across typed aliases, not an unchecked
                // erasure into consumers that cannot carry its contract.
                if !enabled || matches!(kind, OpKind::ArrayGet { .. } | OpKind::Erase { .. }) {
                    plan.blocked.entry(func.name.clone()).or_insert(observed);
                    continue;
                }
                let used = nts_core::hir::operands_of(kind);
                for &allocation in std::iter::once(&observed).chain(used.iter()) {
                    let value = func.value(allocation);
                    if matches!(
                        value.kind,
                        OpKind::ArrayNew {
                            fill: ArrayFill::Holes,
                            ..
                        }
                    ) && matches!(&value.ty, HirType::Managed(ManagedType::Array(element)) if **element != HirType::Erased)
                    {
                        plan.tracked
                            .entry(func.name.clone())
                            .or_default()
                            .insert(allocation);
                    }
                }
            }
        }
        plan
    }

    pub(crate) fn active(&self) -> bool {
        !self.tracked.is_empty()
    }

    pub(crate) fn tracks(&self, func: &Func, allocation: ValueId) -> bool {
        self.tracked
            .get(&func.name)
            .is_some_and(|values| values.contains(&allocation))
    }
}

pub(crate) fn check(func: &Func, plan: &Plan) -> Result<(), EmitError> {
    match plan.blocked.get(&func.name) {
        Some(&id) => Err(Failure::Unsupported(
            "typed array holes: observed slots are not proven initialized".into(),
        )
        .at(&func.name, &func.value(id).origin)),
        None => Ok(()),
    }
}
