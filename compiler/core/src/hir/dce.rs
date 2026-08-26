//! Removing operations nothing reads.
//!
//! # Why a compiler that emits C still needs this
//!
//! Not for speed — clang deletes dead code perfectly well. For *correctness of
//! the output as a C program*: the emitter declares a local for every value it
//! assigns, and a local that is assigned and never read is
//! `-Wunused-but-set-variable`, which is an error under the flags the generated
//! file is compiled with.
//!
//! Specialization creates these deliberately. When it folds `(int32_t)1.0` into
//! the constant `1`, the original `1.0` is left with no readers. Rather than
//! have that pass track what it orphaned, everything it orphans is collected
//! here.

use rustc_hash::FxHashSet;

use super::{Func, OpKind, ValueId};

/// Drop operations whose results nothing reads, and report how many.
pub fn eliminate(func: &mut Func) -> usize {
    let mut live: FxHashSet<ValueId> = FxHashSet::default();

    // Seeds: anything a terminator reads, and every call. A call's result may
    // be unused while the call itself still has to happen.
    for block in &func.blocks {
        for operand in super::verify::terminator_operands(&block.terminator) {
            live.insert(operand);
        }
        for value in &block.ops {
            if matches!(func.values[value.0 as usize].kind, OpKind::Call { .. }) {
                live.insert(*value);
            }
        }
    }

    // Reaching a fixpoint rather than one backward sweep: a loop body can read a
    // value defined in a block that comes later in the arena, so one pass in any
    // fixed order can miss it.
    loop {
        let before = live.len();
        for block in &func.blocks {
            for value in &block.ops {
                if !live.contains(value) {
                    continue;
                }
                for operand in super::verify::operands(&func.values[value.0 as usize].kind) {
                    live.insert(operand);
                }
            }
        }
        if live.len() == before {
            break;
        }
    }

    let mut removed = 0;
    for block in &mut func.blocks {
        let before = block.ops.len();
        block.ops.retain(|value| live.contains(value));
        removed += before - block.ops.len();
    }
    removed
}
