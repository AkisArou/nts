//! What `typeof` answers, as the runtime numbers it.
//!
//! One table on this side of the boundary. The runtime has its own in
//! `nts_runtime.h` — that copy is unavoidable, since C cannot read this one —
//! but everything in the compiler that needs a tag comes here, so a second
//! answer cannot appear inside the compiler itself.
//!
//! The values are the spellings' order in `NtsTag`, and the spellings are what
//! `typeof` returns. That is not decoration: reading the tag *is* what `typeof`
//! means on an erased value, so a tag and its spelling are one fact and are
//! written down once.

use super::ManagedType;

pub const UNDEFINED: u32 = 0;
pub const BOOLEAN: u32 = 1;
pub const NUMBER: u32 = 2;
pub const STRING: u32 = 3;
pub const OBJECT: u32 = 4;
/// `null`, which is a different *value* from `undefined` and needs a tag to say
/// so — `null === undefined` is false.
///
/// Last, and adjacent to [`OBJECT`], on purpose: `typeof null` is `"object"`,
/// so the two tags share a spelling and `typeof x === "object"` stays the one
/// comparison `tag >= OBJECT` instead of becoming a pair.
pub const NULL: u32 = 5;

/// The tag a reference of this type carries.
///
/// Every object shares one tag: `typeof` answers "object" for a class
/// instance, an array and anything else with a header, and which one it is
/// comes from the header itself — where dispatch and the collector already
/// look.
#[must_use]
pub const fn of_reference(managed: &ManagedType) -> u32 {
    match managed {
        ManagedType::String => STRING,
        _ => OBJECT,
    }
}

/// The tag a value of this machine type carries once erased.
///
/// The inverse of what `Erase` emits, and it is here rather than beside that
/// emission for the reason the rest of this module exists: one table.
#[must_use]
pub fn of_representation(ty: &super::HirType) -> u32 {
    use super::{HirType, ManagedType};
    match ty {
        HirType::Bool => BOOLEAN,
        HirType::Managed(ManagedType::String) => STRING,
        HirType::Managed(_) => OBJECT,
        HirType::Void => UNDEFINED,
        _ => NUMBER,
    }
}

/// The tag a `typeof` comparison against this literal is asking about.
///
/// `None` for a spelling no tag can produce — `"function"`, `"bigint"`,
/// `"symbol"`. Those comparisons are *not* rewritten: left alone they compare
/// a string the runtime never returns and are correctly false, where folding
/// them to a tag this compiler does not have would be inventing one.
#[must_use]
pub fn of_spelling(text: &str) -> Option<TagTest> {
    match text {
        "undefined" => Some(TagTest::Is(UNDEFINED)),
        "boolean" => Some(TagTest::Is(BOOLEAN)),
        "number" => Some(TagTest::Is(NUMBER)),
        "string" => Some(TagTest::Is(STRING)),
        // Two tags, because `typeof null` is `"object"` as well. They are
        // adjacent so that this stays one comparison.
        "object" => Some(TagTest::AtLeast(OBJECT)),
        _ => None,
    }
}

/// What a `typeof` comparison against a spelling actually tests.
///
/// Every spelling but one names a single tag. `"object"` names two — a
/// reference's and `null`'s — and they are numbered adjacently so the test is
/// still a single comparison rather than a disjunction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagTest {
    /// Exactly this tag.
    Is(u32),
    /// This tag or any above it.
    AtLeast(u32),
}

/// Rewrite `typeof v === "number"` into an integer compare, and report how
/// many.
///
/// Lowering emits `typeof` on an erased value as `TagOf` followed by
/// `nts_tag_name`, which **allocates a string**, and then compares strings.
/// Almost every use in real code compares against a literal, so the allocation
/// is on the common path.
///
/// A peephole rather than a special case inside lowering, for one reason: doing
/// it there means matching on the *parent* of the `typeof` expression while
/// lowering it, and the shape of that parent is not lowering's business. Here
/// the pattern is already in the IR and says exactly what it is.
///
/// The comparison is left alone when the literal is a spelling no tag can
/// produce — `"function"`, `"bigint"` — because it is then correctly false
/// against a string the runtime never returns, and rewriting it would mean
/// inventing a tag.
pub fn fold_comparisons(func: &mut super::Func) -> usize {
    use super::{BinOp, Callee, OpKind};

    let tag_of =
        |func: &super::Func, value: super::ValueId| match &func.values[value.0 as usize].kind {
            OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } if name == "nts_tag_name" && args.len() == 1 => {
                // Through the conversion the external call convention inserts:
                // `nts_tag_name` takes a double like every runtime call, so the
                // `u32` tag is widened on the way in. Comparing the widened value
                // would be correct and would keep the conversion alive; the tag
                // itself is what the comparison is about.
                match &func.values[args[0].0 as usize].kind {
                    OpKind::Convert(inner) => Some(*inner),
                    _ => Some(args[0]),
                }
            }
            _ => None,
        };
    let spelling =
        |func: &super::Func, value: super::ValueId| match &func.values[value.0 as usize].kind {
            OpKind::ConstString(text) => of_spelling(text),
            _ => None,
        };

    let mut folded = 0;
    for index in 0..func.values.len() {
        let OpKind::Binary { op, lhs, rhs } = func.values[index].kind else {
            continue;
        };
        if !matches!(op, BinOp::Eq | BinOp::Ne) {
            continue;
        }
        // Either order: `typeof v === "number"` and `"number" === typeof v`
        // are the same comparison and the second is legal TypeScript.
        let Some((tag, wanted)) = tag_of(func, lhs)
            .zip(spelling(func, rhs))
            .or_else(|| tag_of(func, rhs).zip(spelling(func, lhs)))
        else {
            continue;
        };

        // `!=` against a range is the complement of the range, not a `>=` with
        // the operands kept: `typeof x !== "object"` is `tag < OBJECT`.
        let (op, wanted) = match (op, wanted) {
            (BinOp::Eq, TagTest::Is(tag)) => (BinOp::Eq, tag),
            (BinOp::Ne, TagTest::Is(tag)) => (BinOp::Ne, tag),
            (BinOp::Eq, TagTest::AtLeast(tag)) => (BinOp::Ge, tag),
            (BinOp::Ne, TagTest::AtLeast(tag)) => (BinOp::Lt, tag),
            _ => continue,
        };

        let origin = func.values[index].origin.clone();
        let constant = super::ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
        let ty = func.values[tag.0 as usize].ty.clone();
        func.values.push(super::Op {
            kind: OpKind::ConstInt(i128::from(wanted)),
            ty,
            origin: origin.clone(),
        });
        // The constant is defined after every existing value, so it has to be
        // *placed* before the comparison that reads it. The block holding the
        // comparison is the only one it can go in.
        for block in &mut func.blocks {
            if let Some(at) = block.ops.iter().position(|v| v.0 as usize == index) {
                block.ops.insert(at, constant);
                break;
            }
        }
        func.values[index].kind = OpKind::Binary {
            op,
            lhs: tag,
            rhs: constant,
        };
        folded += 1;
    }
    folded
}
