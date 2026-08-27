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
//! The linker does drop unreferenced functions, given `-ffunction-sections` and
//! `--gc-sections`, and it should still be asked to. But it runs last, and two
//! things follow from that.
//!
//! The smaller one is cost: everything the linker drops was first lowered,
//! analyzed interprocedurally, specialized, bounds-proven, emitted and compiled.
//! Using ten functions from a hundred means paying for a hundred to ship ten.
//!
//! The one that matters is **precision**, and no linker can undo it. Facts cross
//! function boundaries, so a call site widens what its callee's parameters are
//! known to be — including a call site that can never execute:
//!
//! ```text
//! function scale(v: number) { return v * 2; }        // called from `hot` with 0..99
//! function dead(v: number)  { return scale(v); }     // unreachable, `v` unbounded
//! ```
//!
//! With `dead` present, `scale`'s parameter is unbounded and it compiles to
//! `v0 * 2.0`. With `dead` pruned, it compiles to `(int64_t)v0 * 2`. Same
//! function, same body; the difference is a caller that cannot run. Dead code
//! does not merely cost bytes, it costs the surviving code its proofs — and by
//! the time the linker sees the program, the damage is in the object file.

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

/// The names something outside this compilation can call, as a set.
///
/// A named type rather than the set itself, because three passes take it and
/// each was otherwise spelling a concrete hasher into its public signature.
pub type RootNames = FxHashSet<String>;

/// The functions something outside this compilation can call.
///
/// Two passes need this and they need the *same* answer. Reachability starts
/// here; the interprocedural analysis stops here, because a root's parameters
/// are written by a caller it cannot see and are therefore as wide as their
/// declared types.
///
/// Using `exported` for the second question is what an executable gets wrong.
/// A class exported so another module can import it makes every one of its
/// methods exported -- and in an executable, none of them is callable from
/// outside, because there is no outside.
#[must_use]
pub fn root_names<'p>(program: &'p Program, roots: Roots<'_>) -> Vec<&'p str> {
    match roots {
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
    }
}

/// Remove every function the roots cannot reach, and report how many.
pub fn prune(program: &mut Program, roots: Roots<'_>) -> usize {
    let mut reached: FxHashSet<&str> = FxHashSet::default();
    let mut pending: Vec<&str> = root_names(program, roots);
    reached.extend(pending.iter().copied());

    while let Some(name) = pending.pop() {
        let Some(func) = program.funcs.iter().find(|func| func.name == name) else {
            continue;
        };
        for op in &func.values {
            // An external callee is not in this program, so there is nothing to
            // keep — the linker supplies it.
            let OpKind::Call { callee, .. } = &op.kind else {
                continue;
            };
            // A virtual call reaches *every* implementation of its slot, because
            // which one runs is decided by a receiver this cannot see. Keeping
            // only the one the static type names would prune an override that a
            // table still points at, and a table entry the linker cannot resolve
            // is a link error at best.
            let targets: Vec<&str> = match callee {
                Callee::Direct(target) => vec![target.as_str()],
                Callee::External(_) => Vec::new(),
                Callee::Virtual { slot, .. } | Callee::Closure { slot } => program
                    .layouts
                    .iter()
                    .filter_map(|layout| layout.methods.get(*slot as usize))
                    .filter_map(|method| method.as_deref())
                    .collect(),
            };
            for target in targets {
                if let Some(callee) = program.funcs.iter().find(|f| f.name == target)
                    && reached.insert(callee.name.as_str())
                {
                    pending.push(callee.name.as_str());
                }
            }
        }
    }

    let keep: FxHashSet<String> = reached.into_iter().map(str::to_owned).collect();
    let before = program.funcs.len();
    program.funcs.retain(|func| keep.contains(&func.name));

    // A table entry naming a function that is gone. It is unreachable by the
    // same argument that removed the function -- no call site dispatches
    // through this slot -- and leaving the name would ask the linker for a
    // definition that no longer exists.
    for layout in &mut program.layouts {
        for method in &mut layout.methods {
            if method.as_ref().is_some_and(|name| !keep.contains(name)) {
                *method = None;
            }
        }
    }
    before - program.funcs.len()
}
