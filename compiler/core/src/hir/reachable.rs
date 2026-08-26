//! Dropping functions nothing can call.
//!
//! # The roots depend on the product
//!
//! RFC §6.8 lists `executable` and `shared-library` as different products, and
//! they have different public surfaces — so "what can be called from outside"
//! is a different question for each, and using one answer for both is either
//! unsound or wasteful.
//!
//! - An **executable** has no outside. Nothing but its entry point can be
//!   called, and a module's `export` means only "visible to another module of
//!   this program". Exports are *not* roots.
//! - A **library** can have any of its exports called by a caller this
//!   compilation cannot see. Every export is a root (RFC §27.1).
//! - A library with a **declared surface** narrows that. This is what the
//!   `exports: [...]` list in `nts.config.ts` is for: naming fewer than the
//!   source exports shrinks the ABI *and* the binary, which is the only reason
//!   declaring them is worth the trouble.
//!
//! Treating every export as a root regardless is the safe default and a poor
//! one for an executable — it keeps every exported function of every module,
//! whether the program can reach it or not.
//!
//! # Why this is exact rather than heuristic
//!
//! A JavaScript bundler tree-shaking has to guess whether importing a module
//! has side effects. This walks a call graph the checker already resolved, so
//! the root set is exact.
//!
//! # Why here and not left to the linker
//!
//! The linker does drop unreferenced functions, given `--gc-sections`, and it
//! should still be asked to. But it can only drop what survives compilation,
//! and everything that survives compilation was first *analyzed*: an unreachable
//! function costs interprocedural analysis, specialization, bounds proofs and
//! codegen before anything discards it. Dropping it here is the difference
//! between compiling a library's public surface and compiling the library.

use rustc_hash::FxHashSet;

use super::{Callee, OpKind, Program};

/// Where a walk over the call graph starts.
#[derive(Debug, Clone, Copy)]
pub enum Roots<'a> {
    /// An executable: only these entry points. A module's exports are not
    /// roots, because nothing outside the program can call them — there is no
    /// outside.
    Entry(&'a [String]),
    /// A library whose whole export surface is public. The safe default, and
    /// the correct one whenever the product is not known.
    EveryExport,
    /// A library with a declared surface (RFC §27.1). Names that are not
    /// actually exported are reported rather than ignored: a manifest that
    /// names a function the source does not export is a mistake in the
    /// manifest, and silently exporting nothing is the worst way to find out.
    Declared(&'a [String]),
}

/// Names in a declared surface that the program does not export.
#[must_use]
pub fn undeclared<'a>(program: &Program, declared: &'a [String]) -> Vec<&'a str> {
    declared
        .iter()
        .filter(|name| {
            !program
                .funcs
                .iter()
                .any(|func| func.exported && func.name == **name)
        })
        .map(String::as_str)
        .collect()
}

/// Remove every function the roots cannot reach, and report how many.
pub fn prune(program: &mut Program, roots: Roots<'_>) -> usize {
    let mut reached: FxHashSet<&str> = FxHashSet::default();
    let mut pending: Vec<&str> = match roots {
        Roots::Entry(names) | Roots::Declared(names) => program
            .funcs
            .iter()
            .filter(|func| names.contains(&func.name))
            .map(|func| func.name.as_str())
            .collect(),
        Roots::EveryExport => program
            .funcs
            .iter()
            .filter(|func| func.exported)
            .map(|func| func.name.as_str())
            .collect(),
    };
    reached.extend(pending.iter().copied());

    while let Some(name) = pending.pop() {
        let Some(func) = program.funcs.iter().find(|func| func.name == name) else {
            continue;
        };
        for op in &func.values {
            // An external callee is not in this program, so there is nothing to
            // keep — the linker supplies it.
            if let OpKind::Call {
                callee: Callee::Direct(target),
                ..
            } = &op.kind
                && let Some(callee) = program.funcs.iter().find(|f| f.name == *target)
                && reached.insert(callee.name.as_str())
            {
                pending.push(callee.name.as_str());
            }
        }
    }

    let keep: FxHashSet<String> = reached.into_iter().map(str::to_owned).collect();
    let before = program.funcs.len();
    program.funcs.retain(|func| keep.contains(&func.name));
    before - program.funcs.len()
}
