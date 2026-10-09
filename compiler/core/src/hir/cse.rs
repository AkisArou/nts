//! An erased value read as its representation once, wherever it is read.
//!
//! **A guard reads one value and the use another, unless something says they
//! are one.** `const x: any = n; if (typeof x === "number" && x >= 0 && x <=
//! 255) take(x)` reads `x` four times, and the lowering unerases it four times,
//! each read its own value. The guard narrowed three of them and the call
//! passed the fourth, so the strict check found nothing proven about it ("it
//! could be any number"), and no guard the program could write would have
//! helped (`docs/scalar-numbers.md`, Q1: an `any` into a written kind is a store
//! like any other, so it has to be provable like any other).
//!
//! An `unerase` of one erased value is that value read as its representation:
//! it has no effect, and every one of them answers the same. So an `unerase`
//! whose identical twin dominates it is replaced by the twin, and what was
//! proven about the twin is about every use. The emitted program reads the
//! value once instead of once per mention, which every pass after this one
//! and every backend also pays less for.
//!
//! **As the lowering's last step**, so the program every reader gets -- the
//! strict check, `prepare`, `nts facts` -- is this one, and the obligations the
//! lowering recorded are renamed with the values they name. The replaced
//! operations are left in place with no reader, as [`super::simplify`] leaves
//! an identity, for the passes that remove what nothing reads.

use rustc_hash::{FxHashMap, FxHashSet};

use super::simplify::{substitute, substitute_terminator};
use super::{BlockId, Func, HirType, OpKind, ValueId};

/// An erased value read as one representation: what makes two `unerase`s one.
type Read = (ValueId, HirType);

/// The dominator-tree walk, one block at a time: entering a block, and leaving
/// it with the reads it made, which then stop dominating.
enum Step {
    Enter(BlockId),
    Leave(Vec<Read>),
}

/// Replace each `unerase` dominated by an identical one, returning how many.
pub fn unerase_once(func: &mut Func) -> usize {
    if !func
        .values
        .iter()
        .any(|op| matches!(op.kind, OpKind::Unerase { .. }))
    {
        return 0;
    }
    let reachable = super::verify::reachable_blocks(func);
    let idom = super::verify::dominators(func, &reachable);
    // The dominator tree, walked from the entry with one scope per block: a
    // twin found in an enclosing scope dominates the operation.
    let mut children: Vec<Vec<BlockId>> = vec![Vec::new(); func.blocks.len()];
    for (index, parent) in idom.iter().enumerate().skip(1) {
        if let (Some(parent), Ok(index)) = (parent, u32::try_from(index)) {
            children[parent.0 as usize].push(BlockId(index));
        }
    }
    let mut first: FxHashMap<Read, ValueId> = FxHashMap::default();
    let mut replaced: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    let mut walk = vec![Step::Enter(BlockId(0))];
    let mut visited: FxHashSet<BlockId> = FxHashSet::default();
    while let Some(step) = walk.pop() {
        let block = match step {
            // Leaving a block: what it read no longer dominates.
            Step::Leave(made) => {
                for read in made {
                    first.remove(&read);
                }
                continue;
            }
            Step::Enter(block) => block,
        };
        if !reachable.contains(&block) || !visited.insert(block) {
            continue;
        }
        let mut made = Vec::new();
        for &op in &func.blocks[block.0 as usize].ops {
            let value = &func.values[op.0 as usize];
            let OpKind::Unerase { value: erased } = value.kind else {
                continue;
            };
            let read = (erased, value.ty.clone());
            if let Some(&twin) = first.get(&read) {
                replaced.insert(op, twin);
            } else {
                first.insert(read.clone(), op);
                made.push(read);
            }
        }
        walk.push(Step::Leave(made));
        for &child in children[block.0 as usize].iter().rev() {
            walk.push(Step::Enter(child));
        }
    }
    if replaced.is_empty() {
        return 0;
    }
    let of = |value: ValueId| replaced.get(&value).copied().unwrap_or(value);
    for index in 0..func.values.len() {
        let mut kind = func.values[index].kind.clone();
        substitute(&mut kind, of);
        func.values[index].kind = kind;
    }
    for block in &mut func.blocks {
        substitute_terminator(&mut block.terminator, of);
    }
    for obligation in &mut func.obligations {
        obligation.value = of(obligation.value);
    }
    replaced.len()
}
