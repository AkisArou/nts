//! Refuse observable typed holes, which Wasm's typed storage cannot hold: a
//! `fill: Holes` allocation holds zeros where JavaScript holds `undefined`.
//! Which ops may observe one is the core's analysis (`hir::holes`); this
//! refuses the first by name, at its origin.

use crate::{EmitError, error::Failure};
use nts_core::hir::Func;

pub(crate) fn check(func: &Func) -> Result<(), EmitError> {
    match nts_core::hir::holes::observations(func).first() {
        Some(&id) => Err(Failure::Unsupported(
            "typed array holes: observed slots are not proven initialized".into(),
        )
        .at(&func.name, &func.value(id).origin)),
        None => Ok(()),
    }
}
