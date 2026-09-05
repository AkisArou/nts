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
/// A closure. `typeof` answers `"function"` for one, so it has a tag of its
/// own — and it sits *below* [`OBJECT`] because "object" is the range test
/// `tag >= OBJECT` and a function must fall outside it.
pub const FUNCTION: u32 = 4;
pub const OBJECT: u32 = 5;
/// `null`, which is a different *value* from `undefined` and needs a tag to say
/// so — `null === undefined` is false.
///
/// Last, and adjacent to [`OBJECT`], on purpose: `typeof null` is `"object"`,
/// so the two tags share a spelling and `typeof x === "object"` stays the one
/// comparison `tag >= OBJECT` instead of becoming a pair.
pub const NULL: u32 = 6;

/// The orderings the numbering above rests on, checked where it is written.
///
/// Both are prose in `nts_runtime.h` and both are load-bearing, and a
/// renumbering that kept every name would satisfy any table comparison while
/// making `typeof f` answer `"object"` in every program. `codegen/jvm` states
/// two of these for its own emitter; these are the table's own, so that a
/// change here fails here.
///
/// Adjacency is the one worth spelling out. `typeof x === "object"` is emitted
/// as `tag >= OBJECT`, which is only equivalent to "`OBJECT` or `NULL`" while
/// nothing sits between them -- a tag inserted there would answer `"object"`
/// to `typeof` whatever it actually held.
const _: () = assert!(
    NULL == OBJECT + 1,
    "`typeof x === \"object\"` is `tag >= OBJECT`, so NULL must be the next tag and the last"
);
const _: () = assert!(
    FUNCTION < OBJECT && FUNCTION >= STRING,
    "a closure answers \"function\", so it is a reference below the object range"
);
/// Every reference tag inside `STRING ..= OBJECT`, which is what
/// `NTS_TAG_IS_REFERENCE` tests and what the tracer, retain, release and both
/// emitters read.
const _: () = assert!(
    STRING < FUNCTION && FUNCTION < OBJECT,
    "the reference tags are the contiguous range STRING ..= OBJECT"
);
const _: () = assert!(
    NUMBER < STRING && BOOLEAN < STRING && UNDEFINED < STRING,
    "and every tag whose payload is not a reference falls outside it"
);

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
        ManagedType::Object(ty) if super::is_closure_type(*ty) => FUNCTION,
        _ => OBJECT,
    }
}

/// The tag a value of this machine type carries once erased.
///
/// The inverse of what `Erase` emits, and it is here rather than beside that
/// emission for the reason the rest of this module exists: one table.
#[must_use]
pub fn of_representation(ty: &super::HirType) -> u32 {
    use super::HirType;
    match ty {
        HirType::Bool => BOOLEAN,
        HirType::Managed(managed) => of_reference(managed),
        HirType::Void => UNDEFINED,
        _ => NUMBER,
    }
}

/// The tag a `typeof` comparison against this literal is asking about.
///
/// `None` for a spelling no tag can produce — `"bigint"`, `"symbol"`. Those
/// comparisons are *not* rewritten: left alone they compare a string the
/// runtime never returns and are correctly false, where folding them to a tag
/// this compiler does not have would be inventing one.
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
        // A closure carries its own tag, so this is answerable now. It used to
        // be left alone deliberately -- comparing against a spelling no tag
        // could produce is correctly false -- and that stopped being true the
        // moment a function became a value something could erase.
        "function" => Some(TagTest::Is(FUNCTION)),
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
