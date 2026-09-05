//! Which erased values need no box on this platform.
//!
//! # The measurement this exists for
//!
//! `benches/cases/in-narrowing` narrows `Circle | Square | Wide` with
//! `"radius" in shape`. That union is [`HirType::Erased`], so every shape was
//! boxed into an `NtsValue` and unboxed again one instruction later for the
//! `instanceof`. Record 0108: **15.48us against hand-written Java's 1.42us,
//! and 212,944 bytes per operation against zero** -- and putting the same box
//! into the reference reproduced our allocation *to the byte*.
//!
//! Two objects are allocated per iteration where the reference allocates none,
//! and only one of them is the box: storing the shape into the box makes the
//! shape escape, so C2 stops scalar-replacing an object that would otherwise
//! have been free.
//!
//! # Why the JVM does not need it
//!
//! `NtsValue` carries a tag beside a reference because C has no way to ask a
//! pointer what it points at. The JVM does: `java/lang/Object` holds any
//! reference and `instanceof` reads the class word that is already there. A
//! union whose arms are *all objects* therefore needs no box at all -- the
//! plan says as much for absence, where "`T | null | undefined` over a
//! reference needs no tag", and this is the same argument one step wider.
//!
//! # What this pass may not assume
//!
//! [`HirType::Erased`] does not say what its arms are, so the answer has to be
//! recovered from the operations. A value is unboxable only if **every**
//! definition erases an object and **every** use is one that a bare reference
//! can serve. Anything else -- a `TagOf`, a call, a return, a field store, a
//! number reaching the same merge -- disqualifies it, because the box is the
//! only representation that can carry those.
//!
//! Values are joined into classes by block-parameter edges first, for the
//! reason `hir::specialize` joins them: a parameter and its arguments are one
//! storage location seen from different edges, and deciding them separately
//! would let a header be a bare reference while a back edge hands it a box.

use nts_codegen_common::destruct::outgoing;
use nts_core::hir::{Func, HirType, ManagedType, OpKind, Terminator, ValueId, operands_of};
use rustc_hash::FxHashSet;

/// Disjoint sets over `ValueId`, by index.
struct Classes {
    parent: Vec<u32>,
}

impl Classes {
    fn new(count: usize) -> Self {
        Self { parent: (0..u32::try_from(count).unwrap_or(u32::MAX)).collect() }
    }

    fn find(&mut self, at: u32) -> u32 {
        let mut root = at;
        while self.parent[root as usize] != root {
            root = self.parent[root as usize];
        }
        let mut walk = at;
        while self.parent[walk as usize] != root {
            let next = self.parent[walk as usize];
            self.parent[walk as usize] = root;
            walk = next;
        }
        root
    }

    fn union(&mut self, a: u32, b: u32) {
        let (a, b) = (self.find(a), self.find(b));
        if a != b {
            self.parent[b as usize] = a;
        }
    }
}

/// The verification type an erased value is held as.
///
/// Split out so `body::Emitter::new` reads one call rather than a branch: the
/// decision belongs here, and a second place that knew about it would be a
/// second place that could disagree.
#[must_use]
pub(crate) fn held_as(unboxed: &FxHashSet<ValueId>, value: ValueId) -> Option<nts_jvm_emitter::VType> {
    unboxed
        .contains(&value)
        .then(|| nts_jvm_emitter::VType::Object("java/lang/Object".to_owned()))
}

/// Erased values that can be held as a bare `java/lang/Object`.
#[must_use]
pub(crate) fn unboxable(func: &Func) -> FxHashSet<ValueId> {
    let count = func.values.len();
    let mut classes = Classes::new(count);

    // A block parameter and every argument that reaches it are one location.
    for block in &func.blocks {
        for (target, args) in outgoing(&block.terminator) {
            let Some(params) = func.blocks.get(target.0 as usize).map(|it| &it.params) else {
                continue;
            };
            for (param, arg) in params.iter().zip(&args) {
                classes.union(param.0, arg.0);
            }
        }
    }

    // A class survives only if every member is erased, every definition erases
    // an object, and every use is one a bare reference can serve.
    let mut refused: FxHashSet<u32> = FxHashSet::default();
    let erased = |value: ValueId| {
        matches!(func.values.get(value.0 as usize).map(|it| &it.ty), Some(HirType::Erased))
    };

    for (at, op) in func.values.iter().enumerate() {
        let value = ValueId(u32::try_from(at).unwrap_or(0));
        if !matches!(op.ty, HirType::Erased) {
            // A non-erased value joined to an erased one by an edge means the
            // two disagree about representation, which nothing here can fix.
            if classes.find(value.0) != value.0 {
                refused.insert(classes.find(value.0));
            }
            continue;
        }
        match &op.kind {
            // The only definition a bare reference can stand in for.
            OpKind::Erase { value: source } => {
                if !matches!(
                    func.values.get(source.0 as usize).map(|it| &it.ty),
                    Some(HirType::Managed(ManagedType::Object(_)))
                ) {
                    refused.insert(classes.find(value.0));
                }
            }
            // Arrives on an edge; its arguments carry the obligation.
            OpKind::BlockParam(_) => {}
            _ => {
                refused.insert(classes.find(value.0));
            }
        }
    }

    // Uses. Anything not listed here needs the box, including every operation
    // this backend has not thought about -- which is the right default for a
    // representation change.
    for (at, op) in func.values.iter().enumerate() {
        let user = ValueId(u32::try_from(at).unwrap_or(0));
        match &op.kind {
            OpKind::InstanceOf { .. } => {}
            OpKind::Unerase { value } if erased(*value) => {
                // Only to an object: unerasing to a number reads the box's
                // `num`, which a bare reference does not have.
                if !matches!(op.ty, HirType::Managed(ManagedType::Object(_))) {
                    refused.insert(classes.find(value.0));
                }
            }
            other => {
                for operand in operands_of(other) {
                    if erased(operand) {
                        refused.insert(classes.find(operand.0));
                    }
                }
            }
        }
        let _ = user;
    }

    // A terminator's operands leave the function or cross an edge. Edges are
    // already joined; a return is a signature and the signature says `NtsValue`.
    for block in &func.blocks {
        if let Terminator::Return(Some(value)) = &block.terminator
            && erased(*value)
        {
            refused.insert(classes.find(value.0));
        }
    }

    let mut keep = FxHashSet::default();
    for (at, op) in func.values.iter().enumerate() {
        let value = ValueId(u32::try_from(at).unwrap_or(0));
        if matches!(op.ty, HirType::Erased) && !refused.contains(&classes.find(value.0)) {
            keep.insert(value);
        }
    }
    keep
}
