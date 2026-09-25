//! Operations and terminators: the mechanical half of the body emitter.
//!
//! Every operation leaves its value on the operand stack and the caller stores
//! it into the value's slot, so the stack is empty between operations and
//! therefore empty at every block boundary -- which is the invariant the stack
//! map design rests on and which `Code::bind` checks.
//!
//! The exception is a comparison, because the JVM has no instruction that
//! leaves a boolean on the stack: it has a *branch*. So a comparison either
//! feeds the block's own terminator, where the branch is what was wanted
//! anyway, or writes 0 or 1 through a scratch slot.

use nts_codegen_common::Copy;
use nts_core::hir::{BinOp, BlockId, Callee, HirType, ManagedType, OpKind, Terminator, UnOp, ValueId};
use nts_diagnostics::Diagnostic;
use nts_jvm_emitter::code::{Code, Label};
use nts_jvm_emitter::{Compare, Kind, Pool, insn};

use crate::body::{Emitter, Placed, RUNTIME, comparison, refuse};
use crate::types;

/// A map call re-spelled to take its key unboxed: the arguments to push, and
/// the owner, member and descriptor to invoke. See `Body::object_key`.
type ObjectKeyCall = (Vec<ValueId>, (&'static str, &'static str, String));


/// The runtime helpers this backend can call, and how each is spelled on the JVM.
///
/// A table rather than a naming rule, because `hir::runtime` is the single
/// answer about what a helper *takes* and this has to agree with it exactly. The
/// C lane's trap is a `static inline` invisible to other backends; the inverse
/// trap here is a name the middle end emits in one spelling and the runtime
/// provides in another, so a missing entry is a refusal by name and never a
/// call to something that does not exist.
///
/// The `fill` family is three entry points rather than one taking a width, for
/// the reason `nts_runtime.h` gives about its own: the compiler knows the
/// element type, and a runtime that had to be told it would be told it wrongly
/// one day.
/// One comparison, as the four things that decide which instructions it becomes.
///
/// A struct rather than four parameters because `negate` and `compare` are not
/// independent on floats -- the comparison chooses the `dcmp` form and the
/// negation chooses only the branch, since `!(a > b)` is not `a <= b` when
/// `NaN` makes both false. Keeping them together is a reminder that they are
/// read as a pair.
#[derive(Clone, Copy)]
pub(crate) struct Test {
    pub compare: Compare,
    pub negate: bool,
    pub lhs: ValueId,
    pub rhs: ValueId,
}

/// The one conversion instruction between two computational kinds, or none when
/// they are already the same. `None` means there is no such instruction --
/// which is every case involving a reference.
fn convert_kind(
    code: &mut Code,
    origin: &nts_semantic_schema::Origin,
    from: Kind,
    to: Kind,
) -> Option<()> {
    if from == to {
        return Some(());
    }
    let opcode = match (from, to) {
        (Kind::Int, Kind::Long) => insn::I2L,
        (Kind::Int, Kind::Float) => insn::I2F,
        (Kind::Int, Kind::Double) => insn::I2D,
        (Kind::Long, Kind::Int) => insn::L2I,
        (Kind::Long, Kind::Float) => insn::L2F,
        (Kind::Long, Kind::Double) => insn::L2D,
        (Kind::Float, Kind::Int) => insn::F2I,
        (Kind::Float, Kind::Long) => insn::F2L,
        (Kind::Float, Kind::Double) => insn::F2D,
        (Kind::Double, Kind::Int) => insn::D2I,
        (Kind::Double, Kind::Long) => insn::D2L,
        (Kind::Double, Kind::Float) => insn::D2F,
        _ => return None,
    };
    code.convert(origin, opcode, from, to);
    Some(())
}

/// A binary operation between two bigints, as the runtime method that does it.
///
/// `Eq` and `Ne` share one -- `Ne` is `eq` and an `ixor` with 1, the same shape
/// the string and erased comparisons use. Ordering is not here: it goes through
/// `compare` and a branch, because a comparison that feeds a branch should not
/// materialize a boolean first.
fn bigint_operation(op: BinOp) -> Option<(&'static str, &'static str)> {
    const BINARY: &str = "(Lnts/rt/NtsBigInt;Lnts/rt/NtsBigInt;)Lnts/rt/NtsBigInt;";
    const PREDICATE: &str = "(Lnts/rt/NtsBigInt;Lnts/rt/NtsBigInt;)Z";
    Some(match op {
        BinOp::Add => ("add", BINARY),
        BinOp::Sub => ("sub", BINARY),
        BinOp::Mul => ("mul", BINARY),
        BinOp::Div => ("div", BINARY),
        BinOp::Rem => ("rem", BINARY),
        BinOp::BitAnd => ("and", BINARY),
        BinOp::BitOr => ("or", BINARY),
        BinOp::BitXor => ("xor", BINARY),
        BinOp::Shl => ("shl", BINARY),
        BinOp::Shr => ("shr", BINARY),
        BinOp::Eq | BinOp::Ne => ("eq", PREDICATE),
        _ => return None,
    })
}

/// The array helpers, as calls on a growable array's wrapper.
///
/// The element kind is already in the *name*: `_ref`, `_str` and `_value` all
/// mean the elements are references, and a bare name means they are doubles.
/// So this is a rule rather than a table, and a helper the middle end adds with
/// the same convention needs one line rather than three.
///
/// `_value` and `_ref` both land on `NtsArrayL` because an `NtsValue` *is* a
/// reference here -- what differs is the static type the caller reads back,
/// which the `checkcast` in `call` restores from the HIR result type.
#[must_use]
pub fn growable_external(name: &str, holds: &str) -> Option<(String, &'static str, String)> {
    const VALUE: &str = "Lnts/rt/NtsValue;";
    let stem = name.strip_prefix("nts_array_")?;
    let (class, element) = match holds {
        "D" => ("nts/rt/NtsArrayD", "D"),
        "Z" => ("nts/rt/NtsArrayZ", "Z"),
        _ => ("nts/rt/NtsArrayL", "Ljava/lang/Object;"),
    };

    // The suffix says which variant, and it says three different things.
    //
    //   `_value`  the **return** is an erased value, because `T | undefined`
    //             has no bit pattern in a double. The elements may be numbers.
    //   `_ref`, `_str`  the **argument** is a reference rather than a double.
    //   `join_str`      the *separator* is a string, over an array of anything.
    //
    // Reading `_value` as "the elements are references" put `NtsArrayD.pop`
    // where an `NtsValue` was wanted, and the stack was one short from there
    // on. So the class comes from the argument's type -- which cannot be
    // wrong -- and the suffix only chooses among the forms.
    let (method, signature) = match stem {
        // `push_value` too: an `NtsValue` element is a reference here, so the
        // class is `NtsArrayL` and `Object` is the parameter it takes. See the
        // suffix note above -- this is the *element* sense of `_value`, and
        // `pop_value` two lines down is the *result* sense.
        "push" | "push_ref" | "push_value" => ("push", format!("(L{class};{element})D")),
        "pop" => ("pop", format!("(L{class};){element}")),
        "pop_value" | "pop_ref" => ("popValue", format!("(L{class};){VALUE}")),
        "shift" => ("shift", format!("(L{class};){element}")),
        "shift_value" | "shift_ref" => ("shiftValue", format!("(L{class};){VALUE}")),
        "unshift" | "unshift_ref" => ("unshift", format!("(L{class};{element})D")),
        "at" => ("at", format!("(L{class};D){element}")),
        "at_value" | "at_ref" => ("atValue", format!("(L{class};D){VALUE}")),
        // `_ref` and `_str` are not the same helper: `===` between two objects
        // is identity and between two strings is value, and two equal strings
        // need not be one object.
        "index_of" | "index_of_ref" => ("indexOf", format!("(L{class};{element})D")),
        "index_of_str" => ("indexOfStr", format!("(L{class};{element})D")),
        "last_index_of" | "last_index_of_ref" => {
            ("lastIndexOf", format!("(L{class};{element})D"))
        }
        "last_index_of_str" => ("lastIndexOfStr", format!("(L{class};{element})D")),
        "includes" | "includes_ref" => ("includes", format!("(L{class};{element})Z")),
        "includes_str" => ("includesStr", format!("(L{class};{element})Z")),
        // The same pair on a growable array -- see `array_external`.
        "index_of_str_value" => ("indexOfStrValue", format!("(L{class};{VALUE})D")),
        "includes_str_value" => ("includesStrValue", format!("(L{class};{VALUE})Z")),
        "fill" | "fill_ref" | "fill_bool" => ("fill", format!("(L{class};{element})L{class};")),
        // **Void**, with `keep_first` below the only other one here. Most
        // growable helpers answer something -- a new length, an element, the
        // array back for chaining -- because most are expressions in
        // JavaScript. `xs.length = n` is a *statement*, so there is nothing to
        // leave on the stack, and a `D` written out of habit would leave one
        // value unconsumed at every call site: a verifier failure rather than a
        // miscompile, which is the good direction to be wrong in.
        //
        // The class comes from the argument as it does above, so `_ref` needs
        // no separate method -- `NtsArrayL.setLength` is the one that clears
        // the dropped slots.
        // **`_value` is the same Java method too.** In C the three differ only
        // in what they release from the dropped slots -- nothing, a reference,
        // an `NtsValue` -- and under a tracing collector there is nothing to
        // release: `setLength` nulls them for the same reason `pop` does, which
        // is that a stale reference in the backing store outlives its element.
        // So the suffix chooses nothing here, exactly as it does not for `_ref`.
        //
        // It was absent, and `xs.length = n` on an `unknown[]` or a plain
        // `(number | string)[]` reaches it -- no `any` required, so none of the
        // narrowing that hides the erased-needle helpers applies. C and LLVM
        // have had it since the lowering emitted it.
        "set_length" | "set_length_ref" | "set_length_value" => {
            ("setLength", format!("(L{class};D)V"))
        }
        "reverse" | "reverse_ref" => ("reverse", format!("(L{class};)L{class};")),
        // **A growable array's `sort` needs its own row, and that is the whole
        // finding.** `array_external` gained `nts_array_sort_str` when the
        // helper landed and this table did not, so `xs.sort()` worked and
        // `xs.push(v); xs.sort()` declined — and, worse, so did a program that
        // pushed a *different* reference array anywhere, because growability is
        // decided for reference arrays together. The JVM is the only backend
        // that names its methods, so it is the only one that could say so.
        "sort_str" => ("sortStr", format!("(L{class};)L{class};")),
        "slice" | "slice_ref" => ("slice", format!("(L{class};DD)L{class};")),
        // `_value` joins the two above rather than needing a third method:
        // the class comes from what the array *holds*, and an `NtsValue` is a
        // reference here, so all three are `NtsArrayL.concat`. The C lane needs
        // the width in the name because it retains the reference elements and
        // has to know which they are; under `NoGc` there is nothing to retain,
        // so the tag never has to be consulted and the copy is the whole
        // operation.
        "concat" | "concat_ref" | "concat_value" => {
            ("concat", format!("(L{class};L{class};)L{class};"))
        }
        "extend" | "extend_ref" => ("extend", format!("(L{class};L{class};)L{class};")),
        "splice" | "splice_ref" => ("splice", format!("(L{class};DD)L{class};")),
        "keep_first" => ("keepFirst", format!("(L{class};D)V")),
        // `join_num` and `join_str` are one Java method. The C lane needs two
        // entry points because the element width changes what it reads; here
        // the receiver's class already carries that, so `NtsArrayD.joinStr` and
        // `NtsArrayL.joinStr` are the two and the stem picks neither.
        "join_str" | "join_num" => {
            ("joinStr", format!("(L{class};Ljava/lang/String;)Ljava/lang/String;"))
        }
        "new" | "new_uninitialized" => ("of", format!("(D)L{class};")),
        _ => return None,
    };
    Some((class.to_owned(), method, signature))
}

/// The array helpers, which need one entry point per element width.
///
/// `element` is `"D"`, `"Z"` or `"L"` -- the two primitive widths that appear
/// and everything else. Separate from `external` because the *name* is not
/// enough here: `nts_array_slice` on numbers and on references are different
/// Java methods, and picking between them is reading the array's type rather
/// than reading the call.
#[must_use]
pub fn array_external(name: &str, element: &str) -> Option<(&'static str, &'static str, String)> {
    let (array, result, one) = match element {
        "D" => ("[D", "[D", "D"),
        "Z" => ("[Z", "[Z", "Z"),
        _ => (
            "[Ljava/lang/Object;",
            "[Ljava/lang/Object;",
            "Ljava/lang/Object;",
        ),
    };
    Some(match name {
        // `Promise.all`'s *values* array is the one the compiler allocated, and
        // its element type is what says whether a payload is a double or a
        // reference -- so this dispatches on the second argument rather than
        // the first, which is why it is here rather than in `external`.
        "nts_promise_all" => (
            types::PROMISE,
            "all",
            format!("([Lnts/rt/NtsPromise;{array})Lnts/rt/NtsPromise;"),
        ),
        "nts_array_index_of" | "nts_array_index_of_ref" => {
            (RUNTIME, "arrayIndexOf", format!("({array}{one})D"))
        }
        "nts_array_index_of_str" => (RUNTIME, "arrayIndexOfStr", format!("({array}{one})D")),
        "nts_array_last_index_of" | "nts_array_last_index_of_ref" => {
            (RUNTIME, "arrayLastIndexOf", format!("({array}{one})D"))
        }
        "nts_array_last_index_of_str" => {
            (RUNTIME, "arrayLastIndexOfStr", format!("({array}{one})D"))
        }
        "nts_array_includes" | "nts_array_includes_ref" => {
            (RUNTIME, "arrayIncludes", format!("({array}{one})Z"))
        }
        "nts_array_includes_str" => (RUNTIME, "arrayIncludesStr", format!("({array}{one})Z")),
        // **The erased-needle forms, which this backend had in neither table.**
        // `validateOneOf(value: unknown, …, oneOf: string[])` is the shape, and
        // C and LLVM have carried it since it first became reachable. Nothing
        // here reached it because three of the four routes to an erased needle
        // are closed -- `any` is refused as a parameter and at module scope, and
        // a local `any` with a concrete initialiser narrows to that initialiser
        // -- so it takes two branches of different types in one local, which no
        // example in this corpus writes.
        "nts_array_index_of_str_value" => {
            (RUNTIME, "arrayIndexOfStrValue", format!("({array}Lnts/rt/NtsValue;)D"))
        }
        "nts_array_includes_str_value" => {
            (RUNTIME, "arrayIncludesStrValue", format!("({array}Lnts/rt/NtsValue;)Z"))
        }
        "nts_array_join_num" => {
            (RUNTIME, "arrayJoinNum", format!("({array}Ljava/lang/String;)Ljava/lang/String;"))
        }
        "nts_array_at" => (RUNTIME, "arrayAt", format!("({array}D)D")),
        "nts_array_at_value" => {
            (RUNTIME, "arrayAtValue", format!("({array}D)Lnts/rt/NtsValue;"))
        }
        "nts_array_at_ref" => {
            (RUNTIME, "arrayAtRef", format!("({array}D)Ljava/lang/Object;"))
        }
        // **The `_ref` spelling too, which is the same Java method.** C has one
        // entry point per element width and names the reference one
        // `nts_array_slice_ref`; this table picks the method by reading the
        // array's type, so it wants the base name -- and never saw the other.
        // `arraySlice(Object[], double, double)` has existed all along, so
        // `["a"].slice(0, 1)` declined on this backend for want of a table row,
        // which is what the diagnostic predicts in so many words: "the helper
        // may exist in `runtime/jvm` already and be missing from the tables
        // `external` consults".
        "nts_array_slice" | "nts_array_slice_ref" => {
            (RUNTIME, "arraySlice", format!("({array}DD){result}"))
        }
        // All three widths, and one method each. The bare path had no concat at
        // all until `nts_array_concat_value` arrived on a program that grows no
        // array -- so `_ref` and the plain form were refused here too, and had
        // been for as long as they have existed.
        "nts_array_concat" | "nts_array_concat_ref" | "nts_array_concat_value" => {
            (RUNTIME, "arrayConcat", format!("({array}{array}){result}"))
        }
        // The same, and `arrayReverse(Object[])` was likewise already there.
        "nts_array_reverse" | "nts_array_reverse_ref" => {
            (RUNTIME, "arrayReverse", format!("({array}){result}"))
        }
        // Only ever reached with a string array: the lowering refuses every
        // other element type by name, because the default order converts each
        // element to a string first and that conversion is the identity only
        // here.
        "nts_array_sort_str" => (RUNTIME, "arraySortStr", format!("({array}){result}")),
        "nts_array_join_str" => (
            RUNTIME,
            "arrayJoinStr",
            format!("({array}Ljava/lang/String;)Ljava/lang/String;"),
        ),
        _ => return None,
    })
}

/// A class name that outlives this call.
///
/// The externals tables hand back `&'static str` owners because almost every
/// one is a literal; the growable wrapper's name is computed from the element
/// type, so it is interned here rather than changing every other signature.
/// Two class names per program, both immortal by construction.
fn leak(name: String) -> &'static str {
    Box::leak(name.into_boxed_str())
}

const D_TO_D: &str = "(D)D";
const STRING_TO_STRING: &str = "(Ljava/lang/String;)Ljava/lang/String;";
const STRING_D_TO_STRING: &str = "(Ljava/lang/String;D)Ljava/lang/String;";
const MAP_KEY_TO_VALUE: &str = "(Lnts/rt/NtsTable;Lnts/rt/NtsValue;)Lnts/rt/NtsValue;";
const MAP_AT_TO_VALUE: &str = "(Lnts/rt/NtsTable;D)Lnts/rt/NtsValue;";
/// The `int` cursor forms, for a walk `narrow` has proved stays in range.
const CURSOR_NEXT: &str = "(Lnts/rt/NtsTable;I)I";
const CURSOR_KEY: &str = "(Lnts/rt/NtsTable;I)Lnts/rt/NtsValue;";
const BIGINT_BINARY: &str = "(Lnts/rt/NtsBigInt;Lnts/rt/NtsBigInt;)Lnts/rt/NtsBigInt;";
const BIGINT_BITS: &str = "(DLnts/rt/NtsBigInt;)Lnts/rt/NtsBigInt;";
const STRING_STRING_TO_D: &str = "(Ljava/lang/String;Ljava/lang/String;)D";
const STRING_STRING_TO_STRING: &str =
    "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;";
const STRING_STRING_TO_Z: &str = "(Ljava/lang/String;Ljava/lang/String;)Z";
const STRING_DD_TO_STRING: &str = "(Ljava/lang/String;DD)Ljava/lang/String;";
const STRING_STRING_STRING_TO_STRING: &str =
    "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;";

/// The helpers that are the runtime itself: stopping, filling, coercing,
/// and turning a number into its characters.
/// The helpers that take or answer an erased value.
///
/// Split out of `core_external` because that function crossed a hundred lines
/// when `nts_array_element` landed, and `too_many_lines` there has blocked all
/// three sessions' gates twice tonight already. Grouped by what they have in
/// common rather than cut at an arbitrary line: every one of these is
/// The global functions: `parseInt`, `parseFloat`, `encodeURI`, `decodeURI`.
///
/// Split from `core_external` when the two URI entries took it past the line
/// limit, and they are a family rather than an arbitrary cut: each is a global
/// the language defines, each takes a string, and **each exists because the
/// JDK's nearest equivalent is a different function.** `Integer.parseInt`
/// throws where `parseInt` answers `NaN`; `Double.parseDouble` reads `0x10` as
/// 16; `URLDecoder` decodes `+` as a space and is lenient where `Decode`
/// refuses. That is the whole reason this table has rows for them at all.
fn global_external(name: &str) -> Option<(&'static str, &'static str, &'static str)> {
    Some(match name {
        // `Integer.parseInt` is not this function -- it throws where this
        // answers `NaN`, refuses a trailing non-digit, and cannot exceed a
        // `long`. Transliterated; see the method.
        "nts_parse_int" => (RUNTIME, "parseInt", "(Ljava/lang/String;D)D"),
        // The longest admitted prefix, then a parse of that -- `parseDouble` on
        // the whole string reads `0x10` as 16 where JavaScript answers 0.
        "nts_parse_float" => (RUNTIME, "parseFloat", "(Ljava/lang/String;)D"),
        // `component` is 1 for the `*URIComponent` pair and 0 for the bare one,
        // a `double` because that is the argument shape the tables already
        // carry. `null` is a `URIError` the lowering raises, so neither throws.
        "nts_encode_uri" => {
            (RUNTIME, "encodeURI", "(Ljava/lang/String;D)Ljava/lang/String;")
        }
        "nts_decode_uri" => {
            (RUNTIME, "decodeURI", "(Ljava/lang/String;D)Ljava/lang/String;")
        }
        _ => return None,
    })
}

/// `NtsValue` in, or `NtsValue` out, or both.
fn value_external(name: &str) -> Option<(&'static str, &'static str, &'static str)> {
    Some(match name {
        "nts_value_to_string" => {
            (types::VALUE, "valueToString", "(Lnts/rt/NtsValue;)Ljava/lang/String;")
        }
        // `Number(v)` on an erased union of primitives, and `+v` since unary
        // plus became the same operation. The helper has existed for as long as
        // `Number` has; no example on this lane reached it until
        // `a-unary-plus-is-a-conversion` asked, so the missing row was an old
        // question newly asked rather than a regression.
        "nts_value_to_number" => (types::VALUE, "valueToNumber", "(Lnts/rt/NtsValue;)D"),
        "nts_is_buffer" => (types::VALUE, "isBuffer", "(Lnts/rt/NtsValue;)Z"),
        "nts_is_data_view" => (types::VALUE, "isDataView", "(Lnts/rt/NtsValue;)Z"),
        // `ArrayBuffer.isView(x)`, which is a typed array *or* a `DataView`.
        // Distinct from `nts_is_data_view` beside it, and it was missing here
        // because nothing had asked: `instanceof` never needed it, and the
        // callers are `ArrayBuffer.isView` and now `"buffer" in v`.
        "nts_value_is_view" => (types::VALUE, "isView", "(Lnts/rt/NtsValue;)Z"),
        // Not `ToNumber`: absent takes the fallback, a boolean is 0 or 1, and
        // everything else is `NaN` rather than converted. See the method.
        "nts_value_number_or" => (types::VALUE, "numberOr", "(Lnts/rt/NtsValue;D)D"),
        "nts_is_date" => (types::VALUE, "isDate", "(Lnts/rt/NtsValue;)Z"),
        // One class serves both, so these two read a bit rather than test a
        // type; see `NtsValue.isMap`. The C lane spells it the same way --
        // `nts_is_map_like(value, holds_values)` -- for the same reason.
        // The class is the element kind on this lane, so no descriptor
        // field was needed -- see `NtsValue.arrayElement`.
        "nts_array_element" => {
            (types::VALUE, "arrayElement", "(Lnts/rt/NtsValue;D)Lnts/rt/NtsValue;")
        }
        "nts_is_map" => (types::VALUE, "isMap", "(Lnts/rt/NtsValue;)Z"),
        "nts_is_set" => (types::VALUE, "isSet", "(Lnts/rt/NtsValue;)Z"),
        "nts_is_promise" => (types::VALUE, "isPromise", "(Lnts/rt/NtsValue;)Z"),
        "nts_view_join" => {
            (types::VIEW_BASE, "join", "(Lnts/rt/NtsView;Ljava/lang/String;)Ljava/lang/String;")
        }
        "nts_is_view_kind" => (types::VALUE, "isViewKind", "(Lnts/rt/NtsValue;D)Z"),
        _ => return None,
    })
}

fn core_external(name: &str) -> Option<(&'static str, &'static str, &'static str)> {
    if let Some(found) = value_external(name) {
        return Some(found);
    }
    Some(match name {
        "nts_uncaught" => (RUNTIME, "uncaught", "(Lnts/rt/NtsValue;Ljava/lang/String;)V"),
        // The end of a lowering-built dispatch chain, which this lane reaches by
        // the same call the native lanes do rather than by an emitter's own
        // `unreachable`: the chain is control flow the lowering wrote, so there
        // is nothing backend-specific about how it ends.
        "nts_no_arm_of" => (RUNTIME, "noArm", "(Lnts/rt/NtsValue;Ljava/lang/String;)V"),
        "nts_raise" => (RUNTIME, "raise", "(Lnts/rt/NtsValue;)V"),
        "nts_raising" => (RUNTIME, "raising", "()I"),
        "nts_raise_take" => (RUNTIME, "raiseTake", "()Lnts/rt/NtsValue;"),
        // Every parameter a `double`, because `hir::runtime` says so. The
        // `slot` is spent already on this lane -- the callback declares
        // `NtsCallback` and is reached by name -- and is still in the
        // signature, because disagreeing with that table about an entry point
        // is how one backend gets a conversion the others do not.
        //
        // **The callback is typed, and used to be `Object`.** The runtime asked
        // `instanceof NtsCallback` and killed the process when the answer was
        // no, which is a check that can only run once the program is already
        // wrong -- and one that had to exist because the descriptor promised
        // nothing. Declaring the interface moves the same question to the
        // verifier, where it is answered for every call before any of them
        // runs, and deletes the check rather than adding a second one.
        "nts_set_timeout" => (RUNTIME, "setTimeout", "(Lnts/rt/NtsCallback;DDZ)D"),
        "nts_clear_timeout" => (RUNTIME, "clearTimeout", "(D)V"),
        // `ArrayBuffer`. One class for fixed and resizable both, and the
        // maximum reserved at construction -- the same shape the C runtime
        // keeps, for the same reason: a reserved block makes `resize` an
        // assignment rather than a reallocation, so a view never has to ask
        // where the bytes went.
        //
        // `byteLength` on a detached buffer answers zero rather than refusing,
        // because that is what the specification reports and `detached` is the
        // question with the answer.
        // `Array.isArray` of a value whose static type is open. A question
        // about the value, and the one place a tuple and an object differ on
        // this lane.
        "nts_is_array" => (types::VALUE, "isArray", "(Lnts/rt/NtsValue;)Z"),
        // `instanceof ArrayBuffer` and `instanceof Uint8Array`. One class and
        // nine classes, so both are an `instanceof` rather than a descriptor
        // read followed by a field read -- see `NtsValue.isViewKind`.
        // The environment's platform slot. Three of the eight `nts_environment_*`
        // entry points, and the three that matter here: the other five --
        // `create`, `destroy`, `enter`, `leave`, `current` -- are declared in no
        // TypeScript and are the C harness's own, one of them returning a struct
        // by value that has no analogue here.
        //
        // Without these, everything reaching the environment was refused on this
        // lane: `Event`'s constructor, `File`'s, and whatever else the shared
        // provider hangs off the slot.
        "nts_environment_install_platform" => (types::ENV, "installPlatform", "(Ljava/lang/Object;)V"),
        "nts_environment_platform" => (types::ENV, "platform", "()Ljava/lang/Object;"),
        "nts_environment_has_platform" => (types::ENV, "hasPlatform", "()Z"),
        "nts_to_index" => (types::BUFFER, "toIndexNumber", "(D)D"),
        "nts_buffer_new" => (types::BUFFER, "allocate", "(D)Lnts/rt/NtsBuffer;"),
        "nts_buffer_new_resizable" => {
            (types::BUFFER, "allocateResizable", "(DD)Lnts/rt/NtsBuffer;")
        }
        "nts_buffer_byte_length" => (types::BUFFER, "byteLength", "(Lnts/rt/NtsBuffer;)D"),
        "nts_buffer_max_byte_length" => {
            (types::BUFFER, "maxByteLength", "(Lnts/rt/NtsBuffer;)D")
        }
        "nts_buffer_resizable" => (types::BUFFER, "resizable", "(Lnts/rt/NtsBuffer;)Z"),
        "nts_buffer_detached" => (types::BUFFER, "detached", "(Lnts/rt/NtsBuffer;)Z"),
        "nts_buffer_slice" => {
            (types::BUFFER, "slice", "(Lnts/rt/NtsBuffer;DD)Lnts/rt/NtsBuffer;")
        }
        "nts_buffer_resize" => (types::BUFFER, "resize", "(Lnts/rt/NtsBuffer;D)V"),
        // `DataView`. The width and the signedness are in the *name* rather
        // than in the type -- one class, sixteen accessors -- so this is a
        // table rather than an overload set, and `NtsDataView` already carries
        // every one of them.
        "nts_dataview_over" => (types::VIEW, "over", "(Lnts/rt/NtsBuffer;D)Lnts/rt/NtsDataView;"),
        "nts_dataview_part" => {
            (types::VIEW, "part", "(Lnts/rt/NtsBuffer;DD)Lnts/rt/NtsDataView;")
        }
        "nts_dataview_buffer" => (types::VIEW, "buffer", "(Lnts/rt/NtsDataView;)Lnts/rt/NtsBuffer;"),
        "nts_dataview_byte_offset" => (types::VIEW, "byteOffset", "(Lnts/rt/NtsDataView;)D"),
        "nts_dataview_byte_length" => (types::VIEW, "byteLength", "(Lnts/rt/NtsDataView;)D"),
        "nts_dataview_get_int8" => (types::VIEW, "getInt8", "(Lnts/rt/NtsDataView;D)D"),
        "nts_dataview_get_uint8" => (types::VIEW, "getUint8", "(Lnts/rt/NtsDataView;D)D"),
        "nts_dataview_get_int16" => (types::VIEW, "getInt16", "(Lnts/rt/NtsDataView;DZ)D"),
        "nts_dataview_get_uint16" => (types::VIEW, "getUint16", "(Lnts/rt/NtsDataView;DZ)D"),
        "nts_dataview_get_int32" => (types::VIEW, "getInt32", "(Lnts/rt/NtsDataView;DZ)D"),
        "nts_dataview_get_uint32" => (types::VIEW, "getUint32", "(Lnts/rt/NtsDataView;DZ)D"),
        "nts_dataview_get_float32" => (types::VIEW, "getFloat32", "(Lnts/rt/NtsDataView;DZ)D"),
        // The bigint pair. A bigint is `NtsBigInt` on this lane and 128 bits
        // wide where the element is 64, so the read chooses what lands in the
        // high word and the write keeps the low one.
        "nts_dataview_get_bigint64" => {
            (types::VIEW, "getBigInt64", "(Lnts/rt/NtsDataView;DZ)Lnts/rt/NtsBigInt;")
        }
        "nts_dataview_get_biguint64" => {
            (types::VIEW, "getBigUint64", "(Lnts/rt/NtsDataView;DZ)Lnts/rt/NtsBigInt;")
        }
        "nts_dataview_set_bigint64" => {
            (types::VIEW, "setBigInt64", "(Lnts/rt/NtsDataView;DLnts/rt/NtsBigInt;Z)V")
        }
        "nts_dataview_set_biguint64" => {
            (types::VIEW, "setBigUint64", "(Lnts/rt/NtsDataView;DLnts/rt/NtsBigInt;Z)V")
        }
        "nts_dataview_get_float64" => (types::VIEW, "getFloat64", "(Lnts/rt/NtsDataView;DZ)D"),
        "nts_dataview_set_int8" => (types::VIEW, "setInt8", "(Lnts/rt/NtsDataView;DD)V"),
        "nts_dataview_set_uint8" => (types::VIEW, "setUint8", "(Lnts/rt/NtsDataView;DD)V"),
        "nts_dataview_set_int16" => (types::VIEW, "setInt16", "(Lnts/rt/NtsDataView;DDZ)V"),
        "nts_dataview_set_uint16" => (types::VIEW, "setUint16", "(Lnts/rt/NtsDataView;DDZ)V"),
        "nts_dataview_set_int32" => (types::VIEW, "setInt32", "(Lnts/rt/NtsDataView;DDZ)V"),
        "nts_dataview_set_uint32" => (types::VIEW, "setUint32", "(Lnts/rt/NtsDataView;DDZ)V"),
        "nts_dataview_set_float32" => (types::VIEW, "setFloat32", "(Lnts/rt/NtsDataView;DDZ)V"),
        "nts_dataview_set_float64" => (types::VIEW, "setFloat64", "(Lnts/rt/NtsDataView;DDZ)V"),
        "nts_buffer_transfer" => {
            (types::BUFFER, "transfer", "(Lnts/rt/NtsBuffer;DZ)Lnts/rt/NtsBuffer;")
        }
        // A symbol is a description and an identity. `keyFor` walks the
        // registry rather than keeping a reverse index, which is `runtime/c`'s
        // choice and its reason: `Symbol.keyFor` is the rare direction and a
        // second index would cost every `Symbol.for` a write.
        "nts_symbol_new" => (types::SYMBOL, "newSymbol", "(Ljava/lang/String;)Lnts/rt/NtsSymbol;"),
        "nts_symbol_for" => (types::SYMBOL, "forKey", "(Ljava/lang/String;)Lnts/rt/NtsSymbol;"),
        "nts_symbol_key_for" => (types::SYMBOL, "keyFor", "(Lnts/rt/NtsSymbol;)Ljava/lang/String;"),
        "nts_symbol_description" => {
            (types::SYMBOL, "description", "(Lnts/rt/NtsSymbol;)Ljava/lang/String;")
        }
        "nts_symbol_to_string" => {
            (types::SYMBOL, "describe", "(Lnts/rt/NtsSymbol;)Ljava/lang/String;")
        }
        // A `Date` is a `double` and an identity, and these are all of it.
        "nts_date_new" => (types::DATE, "newDate", "(D)Lnts/rt/NtsDate;"),
        "nts_date_value" => (types::DATE, "value", "(Lnts/rt/NtsDate;)D"),
        "nts_array_fill" => (RUNTIME, "arrayFill", "([DD)[D"),
        "nts_array_fill_bool" => (RUNTIME, "arrayFillBool", "([ZZ)[Z"),
        "nts_array_fill_ref" => (
            RUNTIME,
            "arrayFillRef",
            "([Ljava/lang/Object;Ljava/lang/Object;)[Ljava/lang/Object;",
        ),

        // The coercions. Already in the runtime and simply not named here,
        // which is the inverse of the C lane's `static inline` trap: there the
        // definition is invisible to other backends, here the definition was
        // present and the *name* was missing, and both spell as a refusal.
        "nts_to_int8" => (RUNTIME, "toInt8", "(D)I"),
        "nts_to_int16" => (RUNTIME, "toInt16", "(D)I"),
        "nts_to_int32" => (RUNTIME, "toInt32", "(D)I"),
        "nts_to_uint8" => (RUNTIME, "toUint8", "(D)I"),
        "nts_to_uint16" => (RUNTIME, "toUint16", "(D)I"),
        "nts_to_uint32" => (RUNTIME, "toUint32", "(D)I"),

        "nts_number_to_string" => (RUNTIME, "numberToString", "(D)Ljava/lang/String;"),
        // `Long.toString(long, int)` is not this: it handles integers, and the
        // fraction is the whole difficulty. See `numberToStringRadix`.
        "nts_number_to_string_radix" => {
            (RUNTIME, "numberToStringRadix", "(DD)Ljava/lang/String;")
        }
        // `String.format("%.2f", x)` is not this either: it rounds half to
        // even and the specification rounds half away from zero. See
        // `numberToFixed`.
        "nts_number_to_fixed" => (RUNTIME, "numberToFixed", "(DD)Ljava/lang/String;"),
        _ => return None,
    })
}

/// `Math`, which is mostly `java.lang.StrictMath` and occasionally not.
fn math_external(name: &str) -> Option<(&'static str, &'static str, &'static str)> {
    Some(match name {
        "nts_math_pow" => (RUNTIME, "mathPow", "(DD)D"),
        "nts_math_sin" => (RUNTIME, "mathSin", D_TO_D),
        "nts_math_cos" => (RUNTIME, "mathCos", D_TO_D),
        "nts_math_tan" => (RUNTIME, "mathTan", D_TO_D),
        "nts_math_asin" => (RUNTIME, "mathAsin", D_TO_D),
        "nts_math_acos" => (RUNTIME, "mathAcos", D_TO_D),
        "nts_math_atan" => (RUNTIME, "mathAtan", D_TO_D),
        "nts_math_atan2" => (RUNTIME, "mathAtan2", "(DD)D"),
        "nts_math_exp" => (RUNTIME, "mathExp", D_TO_D),
        "nts_math_log" => (RUNTIME, "mathLog", D_TO_D),
        "nts_math_log2" => (RUNTIME, "mathLog2", D_TO_D),
        "nts_math_log10" => (RUNTIME, "mathLog10", D_TO_D),
        "nts_math_cosh" => (RUNTIME, "mathCosh", D_TO_D),
        "nts_math_tanh" => (RUNTIME, "mathTanh", D_TO_D),
        "nts_math_cbrt" => (RUNTIME, "mathCbrt", D_TO_D),
        "nts_math_hypot" => (RUNTIME, "mathHypot", "(DD)D"),
        "nts_math_sign" => (RUNTIME, "mathSign", D_TO_D),
        "nts_math_fround" => (RUNTIME, "mathFround", D_TO_D),
        "nts_math_expm1" => (RUNTIME, "mathExpm1", D_TO_D),
        "nts_math_log1p" => (RUNTIME, "mathLog1p", D_TO_D),

        "nts_is_integer" => (RUNTIME, "isInteger", "(D)Z"),
        "nts_is_safe_integer" => (RUNTIME, "isSafeInteger", "(D)Z"),
        "nts_bool_to_string" => (RUNTIME, "boolToString", "(Z)Ljava/lang/String;"),
        "nts_tag_name" => (RUNTIME, "tagName", "(I)Ljava/lang/String;"),

        // `s[i]`, which stops outside the string. **Not `strAt`**, which is
        // `String.prototype.at` -- relative indexing and `null` outside -- and
        // which this named until `"abc"[5]` returned a null that reached
        // `String.length()` and killed the program, where C and LLVM declined
        // the case. One HIR name, two meanings, and the JVM had the other one.
        "nts_str_at" => (RUNTIME, "strIndex", STRING_D_TO_STRING),
        // `String.prototype.at`: relative indexing, and `null` -- undefined --
        // outside. The method was already here and already right; it was
        // `nts_str_at` that was pointing at it, which is how `"abc"[5]`
        // returned an undefined where C and LLVM stopped. C declares the
        // helper `NTS_ALLOCATES_OR_NULL`, so the absence is part of its
        // contract rather than a failure, and a Java reference carries it with
        // no tag.
        "nts_str_relative_at" => (RUNTIME, "strAt", STRING_D_TO_STRING),
        "nts_str_char_at" => (RUNTIME, "strCharAt", STRING_D_TO_STRING),
        "nts_str_code_point_at" => (RUNTIME, "strCodePointAt", "(Ljava/lang/String;D)D"),
        "nts_str_index_of_from" => (
            RUNTIME,
            "strIndexOfFrom",
            "(Ljava/lang/String;Ljava/lang/String;D)D",
        ),
        "nts_str_trim_start" => (RUNTIME, "strTrimStart", STRING_TO_STRING),
        "nts_str_trim_end" => (RUNTIME, "strTrimEnd", STRING_TO_STRING),
        "nts_str_pad_end" => (
            RUNTIME,
            "strPadEnd",
            "(Ljava/lang/String;DLjava/lang/String;)Ljava/lang/String;",
        ),
        "nts_str_to_lower_case" => (RUNTIME, "strToLowerCase", STRING_TO_STRING),
        "nts_str_to_upper_case" => (RUNTIME, "strToUpperCase", STRING_TO_STRING),
        "nts_str_to_well_formed" => (RUNTIME, "strToWellFormed", STRING_TO_STRING),
        "nts_str_is_well_formed" => (RUNTIME, "strIsWellFormed", "(Ljava/lang/String;)Z"),
        "nts_math_sinh" => (RUNTIME, "mathSinh", "(D)D"),
        "nts_is_finite" => (RUNTIME, "isFinite", "(D)Z"),
        _ => return None,
    })
}

/// The string methods -- mostly `java.lang.String`, and occasionally
/// something written out because Java's answer is not JavaScript's.
fn string_external(name: &str) -> Option<(&'static str, &'static str, &'static str)> {
    Some(match name {
        "nts_concat" => (RUNTIME, "concat", STRING_STRING_TO_STRING),
        "nts_str_index_of" => (RUNTIME, "strIndexOf", STRING_STRING_TO_D),
        "nts_str_last_index_of" => (RUNTIME, "strLastIndexOf", STRING_STRING_TO_D),
        "nts_str_includes" => (RUNTIME, "strIncludes", STRING_STRING_TO_Z),
        "nts_str_starts_with" => (RUNTIME, "strStartsWith", STRING_STRING_TO_Z),
        "nts_str_ends_with" => (RUNTIME, "strEndsWith", STRING_STRING_TO_Z),
        "nts_str_point_width" => (RUNTIME, "strPointWidth", "(Ljava/lang/String;D)D"),
        "nts_str_trim" => (RUNTIME, "strTrim", "(Ljava/lang/String;)Ljava/lang/String;"),
        // `Number(s)`. Not `Double.parseDouble`, which throws where JavaScript
        // answers `NaN` and throws on `""` where `Number("")` is +0; see
        // `NtsRuntime.strToNumber`, which is a transliteration of the C.
        "nts_str_to_number" => (RUNTIME, "strToNumber", "(Ljava/lang/String;)D"),
        "nts_str_repeat" => (
            RUNTIME,
            "strRepeat",
            "(Ljava/lang/String;D)Ljava/lang/String;",
        ),
        "nts_str_pad_start" => (
            RUNTIME,
            "strPadStart",
            "(Ljava/lang/String;DLjava/lang/String;)Ljava/lang/String;",
        ),
        "nts_str_substring" => (RUNTIME, "strSubstring", STRING_DD_TO_STRING),
        "nts_str_slice" => (RUNTIME, "strSlice", STRING_DD_TO_STRING),
        "nts_str_split" => (
            RUNTIME,
            "strSplit",
            "(Ljava/lang/String;Ljava/lang/String;)[Ljava/lang/String;",
        ),
        "nts_str_replace" => (RUNTIME, "strReplace", STRING_STRING_STRING_TO_STRING),
        "nts_str_replace_all" => (RUNTIME, "strReplaceAll", STRING_STRING_STRING_TO_STRING),
        _ => return None,
    })
}

/// `Map`, `Set` and `bigint`: the three types with a class of their own.
fn collection_external(name: &str) -> Option<(&'static str, &'static str, &'static str)> {
    Some(match name {
        // One class for `Map` and `Set`. `kind` is accepted and ignored: in C
        // it selects a specialised hash and comparison, which is an
        // optimisation rather than a semantic, and taking the parameter keeps
        // `hir::runtime` the single answer about the signature.
        "nts_promise_new" => (types::PROMISE, "newPromise", "()Lnts/rt/NtsPromise;"),
        "nts_promise_race" => {
            (types::PROMISE, "race", "([Lnts/rt/NtsPromise;)Lnts/rt/NtsPromise;")
        }
        "nts_promise_fulfill_void" => (types::PROMISE, "fulfillVoid", "(Lnts/rt/NtsPromise;)V"),
        "nts_promise_fulfill_number" => {
            (types::PROMISE, "fulfillNumber", "(Lnts/rt/NtsPromise;D)V")
        }
        "nts_promise_fulfill_reference" => {
            (types::PROMISE, "fulfillReference", "(Lnts/rt/NtsPromise;Ljava/lang/Object;)V")
        }
        "nts_promise_fulfill_tagged" => {
            (types::PROMISE, "fulfillTagged", "(Lnts/rt/NtsPromise;Ljava/lang/Object;I)V")
        }
        "nts_promise_fulfill_value" => {
            (types::PROMISE, "fulfillValue", "(Lnts/rt/NtsPromise;Lnts/rt/NtsValue;)V")
        }
        "nts_promise_reject" => {
            (types::PROMISE, "reject", "(Lnts/rt/NtsPromise;Ljava/lang/Object;)V")
        }
        "nts_promise_reject_with" => {
            (types::PROMISE, "rejectWith", "(Lnts/rt/NtsPromise;Lnts/rt/NtsPromise;)V")
        }
        "nts_promise_adopt" => {
            (types::PROMISE, "adopt", "(Lnts/rt/NtsPromise;Lnts/rt/NtsPromise;)V")
        }
        "nts_promise_is_rejected" => (types::PROMISE, "isRejected", "(Lnts/rt/NtsPromise;)Z"),
        "nts_promise_number" => (types::PROMISE, "number", "(Lnts/rt/NtsPromise;)D"),
        "nts_promise_reference" => {
            (types::PROMISE, "reference", "(Lnts/rt/NtsPromise;)Ljava/lang/Object;")
        }
        "nts_promise_value" => {
            (types::PROMISE, "value", "(Lnts/rt/NtsPromise;)Lnts/rt/NtsValue;")
        }
        "nts_promise_reason" => {
            (types::PROMISE, "reason", "(Lnts/rt/NtsPromise;)Lnts/rt/NtsValue;")
        }
        "nts_promise_reject_value" => {
            (types::PROMISE, "rejectValue", "(Lnts/rt/NtsPromise;Lnts/rt/NtsValue;)V")
        }

        // **Three owners, and the name says which.** A helper that does not care
        // which kind it was handed lives on `NtsTable` and takes one; the ones
        // whose result is stored into a slot the HIR types are declared on the
        // subclass, because `NtsTable` would need a checkcast at every call.
        //
        // `nts_map_copy` is Map-only for a reason that had to be measured rather
        // than assumed: it is reachable only from a record spread, because
        // `new Map(contents)` and `new Set(contents)` are both refused for want
        // of the iteration protocol. If that refusal lifts, this needs a Set arm.
        "nts_map_new" => (types::MAP, "newMap", "(D)Lnts/rt/NtsMap;"),
        "nts_set_new" => (types::SET, "newSet", "(D)Lnts/rt/NtsSet;"),
        "nts_map_get" => (types::TABLE, "get", MAP_KEY_TO_VALUE),
        "nts_map_has" => (types::TABLE, "has", "(Lnts/rt/NtsTable;Lnts/rt/NtsValue;)Z"),
        "nts_map_set" => (
            types::MAP,
            "set",
            "(Lnts/rt/NtsMap;Lnts/rt/NtsValue;Lnts/rt/NtsValue;)Lnts/rt/NtsMap;",
        ),
        "nts_set_add" => (
            types::SET,
            "add",
            "(Lnts/rt/NtsSet;Lnts/rt/NtsValue;)Lnts/rt/NtsSet;",
        ),
        "nts_map_delete" => (types::TABLE, "delete", "(Lnts/rt/NtsTable;Lnts/rt/NtsValue;)Z"),
        "nts_map_clear" => (types::TABLE, "clear", "(Lnts/rt/NtsTable;)V"),
        "nts_map_size" => (types::TABLE, "size", "(Lnts/rt/NtsTable;)D"),
        "nts_map_copy" => (types::MAP, "copy", "(Lnts/rt/NtsMap;)Lnts/rt/NtsMap;"),
        // `Object.assign` between two dictionaries. Map-only for the same reason
        // `nts_map_copy` above is: a table reaches it from an index signature,
        // and a `Set` has no entries to assign.
        "nts_map_extend" => (
            types::MAP,
            "extend",
            "(Lnts/rt/NtsMap;Lnts/rt/NtsMap;)Lnts/rt/NtsMap;",
        ),
        "nts_map_keys_str" => {
            (types::TABLE, "keysStr", "(Lnts/rt/NtsTable;)[Ljava/lang/Object;")
        }
        "nts_map_next" => (types::TABLE, "next", "(Lnts/rt/NtsTable;D)D"),
        "nts_map_key_at" => (types::TABLE, "keyAt", MAP_AT_TO_VALUE),
        "nts_map_value_at" => (types::TABLE, "valueAt", MAP_AT_TO_VALUE),

        "nts_bigint_from_number" => (types::BIGINT, "fromNumber", "(D)Lnts/rt/NtsBigInt;"),
        "nts_bigint_to_string" => (types::BIGINT, "toText", "(Lnts/rt/NtsBigInt;)Ljava/lang/String;"),
        "nts_bigint_shl" => (types::BIGINT, "shl", BIGINT_BINARY),
        "nts_bigint_shr" => (types::BIGINT, "shr", BIGINT_BINARY),
        "nts_bigint_as_intn" => (types::BIGINT, "asIntN", BIGINT_BITS),
        "nts_bigint_as_uintn" => (types::BIGINT, "asUintN", BIGINT_BITS),
        "nts_string_from_char_code" => {
            (RUNTIME, "stringFromCharCode", "(D)Ljava/lang/String;")
        }
        "nts_string_from_code_point" => {
            (RUNTIME, "stringFromCodePoint", "(D)Ljava/lang/String;")
        }
        _ => return None,
    })
}

/// The runtime helpers this backend can call, and how each is spelled here.
///
/// Split by family rather than kept as one table, because the families
/// answer to different sources: `core_external` is `runtime/c`'s own
/// behaviour, `math_external` is where `java.lang.Math` agrees with the
/// language and where it does not, `string_external` likewise for
/// `java.lang.String`.
///
/// A table rather than a naming rule, because `hir::runtime` is the single
/// answer about what a helper *takes*. A missing entry is a refusal by name
/// and never a call to something that does not exist.
/// One of the fixed networking intrinsics: the typed boundary a *program*
/// crosses to reach a provider.
///
/// `declared` is what TypeScript writes; the rest is what the call becomes.
/// Both halves are here because they are the thing that can disagree -- the
/// declarations live in `runtime/jvm/web-platform/intrinsics.d.ts` and the
/// Java lives in `runtime/jvm`, and this table is the only place the two are
/// named together.
#[derive(Debug)]
pub struct Intrinsic {
    /// The `declare function` name, as a program writes it.
    pub declared: &'static str,
    /// The runtime class the call lands on.
    pub owner: &'static str,
    /// The static method's name there.
    pub member: &'static str,
    /// Its descriptor, which is what the *declaration* says: `number` is `D`
    /// and `void` is `V`. Not restated from the Java --
    /// `runtime_agrees_with_hir`'s rule applies here too, and a `(D)V` where
    /// the Java takes an `int` would be a wrong conversion in one backend only.
    pub descriptor: &'static str,
}

/// The fixed networking intrinsics, as a table rather than a match, because a
/// test reads it.
///
/// Public for exactly that reason. Three things state this ABI -- the
/// declarations, this, and the Java -- and the alternative to exposing the
/// middle one was a test that parsed Rust source to find out what the compiler
/// believes, which is a fourth statement wearing a check's clothing.
///
/// Separate from `core_external` because the source of truth is different.
/// Those names come from `runtime/c`'s header and the middle end emits them;
/// these are written by the program itself, as `declare function`, and reach
/// here as `Callee::External` for the same reason `nts_uv_err_name` does in
/// `runtime/node`. Nothing in `hir` knows they exist, and nothing should:
/// inventing a middle-end concept for four static methods would be a second
/// answer to a question the FFI path already answers.
///
/// **All of them, now.** This said "four of nine" for as long as five
/// declarations were gated on a byte-view type that did not exist; `ManagedType::View`
/// supplied it and they landed, so the table and the declarations are the same
/// set and a test asserts it rather than a comment claiming it.
pub const WEB_INTRINSICS: &[Intrinsic] = &[
    Intrinsic {
        declared: "nts_jvm_web_system_proxy_for",
        owner: types::WEB,
        member: "systemProxyFor",
        descriptor: "(Ljava/lang/String;)Ljava/lang/String;",
    },
    // ----- the durable byte store ------------------------------------------
    //
    // Views both ways, matching the three networking entries below that already
    // take a caller's window: a store that allocated here would be the only
    // entry that does, and would copy every value twice. `append` takes no
    // offset or length beside the view because a view carries both.
    Intrinsic { declared: "nts_jvm_store_configure", owner: types::WEB, member: "storeConfigure", descriptor: "(Ljava/lang/String;)V" },
    Intrinsic { declared: "nts_jvm_store_close", owner: types::WEB, member: "storeClose", descriptor: "()V" },
    Intrinsic { declared: "nts_jvm_store_open", owner: types::WEB, member: "storeOpen", descriptor: "(Ljava/lang/String;Ljava/lang/String;)D" },
    Intrinsic { declared: "nts_jvm_store_append", owner: types::WEB, member: "storeAppend", descriptor: "(DLnts/rt/NtsViewU8;)V" },
    Intrinsic { declared: "nts_jvm_store_commit", owner: types::WEB, member: "storeCommit", descriptor: "(D)V" },
    Intrinsic { declared: "nts_jvm_store_discard", owner: types::WEB, member: "storeDiscard", descriptor: "(D)V" },
    Intrinsic { declared: "nts_jvm_store_read", owner: types::WEB, member: "storeRead", descriptor: "(Ljava/lang/String;Ljava/lang/String;Lnts/rt/NtsViewU8;)D" },
    Intrinsic { declared: "nts_jvm_store_delete", owner: types::WEB, member: "storeDelete", descriptor: "(Ljava/lang/String;Ljava/lang/String;)Z" },
    Intrinsic { declared: "nts_jvm_store_list", owner: types::WEB, member: "storeList", descriptor: "(Ljava/lang/String;Lnts/rt/NtsViewU8;)D" },
    Intrinsic { declared: "nts_jvm_store_size", owner: types::WEB, member: "storeSize", descriptor: "(Ljava/lang/String;)D" },
    Intrinsic { declared: "nts_jvm_store_source_open", owner: types::WEB, member: "storeSourceOpen", descriptor: "(Ljava/lang/String;Ljava/lang/String;DD)D" },
    Intrinsic { declared: "nts_jvm_store_source_read", owner: types::WEB, member: "storeSourceRead", descriptor: "(DLnts/rt/NtsViewU8;)D" },
    Intrinsic { declared: "nts_jvm_store_source_close", owner: types::WEB, member: "storeSourceClose", descriptor: "(D)V" },
    Intrinsic { declared: "nts_jvm_store_source_size", owner: types::WEB, member: "storeSourceSize", descriptor: "(Ljava/lang/String;Ljava/lang/String;)D" },

    Intrinsic {
        declared: "nts_jvm_web_connect",
        owner: types::WEB,
        member: "connect",
        descriptor: "(Ljava/lang/String;DZDLjava/lang/String;DDLnts/rt/NtsNumberCallback;\
                     Lnts/rt/NtsTextPairCallback;)D",
    },
    Intrinsic {
        declared: "nts_jvm_web_connect_alpn",
        owner: types::WEB,
        member: "connectAlpn",
        descriptor: "(Ljava/lang/String;DZDLjava/lang/String;DDLjava/lang/String;\
                     Lnts/rt/NtsNumberCallback;Lnts/rt/NtsTextPairCallback;)D",
    },
    Intrinsic {
        declared: "nts_jvm_web_protocol",
        owner: types::WEB,
        member: "protocolOf",
        descriptor: "(D)Ljava/lang/String;",
    },
    Intrinsic {
        declared: "nts_jvm_web_cancel_connect",
        owner: types::WEB,
        member: "cancelConnect",
        descriptor: "(D)V",
    },
    Intrinsic {
        declared: "nts_jvm_web_read",
        owner: types::WEB,
        member: "read",
        descriptor: "(DLnts/rt/NtsViewU8;Lnts/rt/NtsNumberCallback;\
                     Lnts/rt/NtsTextPairCallback;)V",
    },
    Intrinsic {
        declared: "nts_jvm_web_write",
        owner: types::WEB,
        member: "write",
        descriptor: "(DLnts/rt/NtsViewU8;Lnts/rt/NtsNumberCallback;\
                     Lnts/rt/NtsTextPairCallback;)V",
    },
    Intrinsic {
        declared: "nts_jvm_web_close",
        owner: types::WEB,
        member: "close",
        descriptor: "(D)V",
    },
    Intrinsic {
        declared: "nts_jvm_web_network_changed",
        owner: types::WEB,
        member: "networkChanged",
        descriptor: "()D",
    },
    Intrinsic {
        declared: "nts_jvm_web_open_count",
        owner: types::WEB,
        member: "openCount",
        descriptor: "()D",
    },
    Intrinsic {
        declared: "nts_jvm_web_random_fill",
        owner: types::WEB,
        member: "randomFill",
        descriptor: "(Lnts/rt/NtsViewU8;)V",
    },
];

fn web_external(name: &str) -> Option<(&'static str, &'static str, &'static str)> {
    WEB_INTRINSICS
        .iter()
        .find(|it| it.declared == name)
        .map(|it| (it.owner, it.member, it.descriptor))
}

/// The rest of the refusal when `external` has no entry for a name.
///
/// A const rather than a literal at the site because it is five lines of
/// explanation inside a function clippy already thinks is long, and because the
/// two ways it has been reached -- the coercions and the networking intrinsics
/// -- are worth naming: both times the helper was in `runtime/jvm` and only the
/// table was missing, which is the failure this message exists to shorten.
const NO_NAME_FOR: &str = "which this backend has no name for -- the helper may \
                           exist in `runtime/jvm` already and be missing from \
                           the tables `external` consults, which is how the \
                           coercions were refused and how the networking \
                           intrinsics were";

/// The typed-array helpers.
///
/// Split from `external` for the reason `array_external` is: one of these needs
/// to know which class, and the name alone does not say. `nts_view_new` returns
/// a view, so the class comes from the call's **result** type rather than from
/// an argument -- which is the one place this differs from the array family,
/// where the subject is always something passed in.
///
/// Everything else takes a view and is declared on the base class, so a
/// `NtsViewU8` reaches `NtsView.length` without a per-element entry. That is
/// not laziness about performance: these are the property reads, which happen
/// once per expression, and record 0182's measurement is about *indexing*,
/// which does not come through here at all -- `ArrayGet` and `ArraySet` are ops
/// and are emitted inline, exactly as the C header says they must be.
/// The typed-array helper for a call, if its subject or its result is a view.
///
/// The subject first, then the result: every helper but one takes a view, and
/// the one that does not -- `nts_view_new` -- takes a buffer and *answers* a
/// view, so its class is only knowable from where the value is going.
fn view_helper(
    name: &str,
    subject: Option<&HirType>,
    result: &HirType,
) -> Option<(&'static str, &'static str, String)> {
    // A subject whose kind the declaration did not state resolves on
    // `NtsAnyView` instead, and only for the three properties both kinds have.
    // **Not `NtsView`**, which is what every other view helper names: a
    // `DataView` extends `NtsAnyView` directly and not `NtsView`, so naming the
    // typed-array base would verify and then fail at run time on exactly the
    // half of the union that motivated the type.
    if matches!(subject, Some(HirType::Managed(ManagedType::AnyView))) {
        return any_view_external(name);
    }
    let of = |ty: &HirType| match ty {
        HirType::Managed(ManagedType::View(element)) => types::view_class(element),
        _ => None,
    };
    view_external(name, subject.and_then(of).or_else(|| of(result))?)
}

/// The helpers an `ArrayBufferView` can reach, which are the three properties
/// the specification's union declares and nothing else.
///
/// `length` is absent on purpose: it is measured in *elements* and a `DataView`
/// has none, which is why `NtsAnyView` does not carry it either. A program that
/// wants it has to discriminate first, and `instanceof` is how -- which the
/// middle end now spells as `Erase`/`Unerase` back to the concrete view, so the
/// element accessors come back with it.
///
/// Anything else returns `None` and is refused by name, which keeps the list of
/// what this union supports in one place rather than spread across arms.
fn any_view_external(name: &str) -> Option<(&'static str, &'static str, String)> {
    let any = types::ANY_VIEW;
    Some(match name {
        "nts_view_byte_length" => (any, "byteLength", format!("(L{any};)D")),
        "nts_view_byte_offset" => (any, "byteOffset", format!("(L{any};)D")),
        "nts_view_buffer" => (any, "buffer", format!("(L{any};)L{};", types::BUFFER)),
        _ => return None,
    })
}

/// The accessor that reads an element, and what it answers in.
///
/// Not `getAt`, which answers in a `double` because that is what the *language*
/// reads out of a typed array. HIR types `array.get xs[i]` as the element --
/// `u8`, an `I` here -- so `getAt` would mean a widening in the runtime and a
/// narrowing in the emitted code, per element, to arrive back where it started.
///
/// `None` for the 64-bit elements. `view_class` already refuses those, so this
/// is unreachable through it and is here so that the two lists cannot drift
/// into disagreeing about which elements exist.
fn view_read(element: &HirType) -> Option<(&'static str, &'static str)> {
    Some(match element {
        HirType::Int { bits: 64, .. } | HirType::BigInt => return None,
        HirType::Int { .. } => ("getInt", "I"),
        HirType::Float { bits: 32 } => ("getFloat", "F"),
        HirType::Float { .. } => ("getAt", "D"),
        _ => return None,
    })
}

/// The accessor that writes one, and what it takes.
fn view_write(element: &HirType) -> Option<(&'static str, &'static str)> {
    Some(match view_read(element)? {
        ("getInt", _) => ("setInt", "I"),
        ("getFloat", _) => ("setFloat", "F"),
        _ => ("setAt", "D"),
    })
}

fn view_external(name: &str, class: &str) -> Option<(&'static str, &'static str, String)> {
    Some(match name {
        "nts_view_new" => (
            leak(class.to_owned()),
            "create",
            format!("(L{};DDDZ)L{class};", types::BUFFER),
        ),
        "nts_view_length" => (types::VIEW_BASE, "length", format!("(L{};)D", types::VIEW_BASE)),
        "nts_view_byte_length" => {
            (types::VIEW_BASE, "byteLength", format!("(L{};)D", types::VIEW_BASE))
        }
        "nts_view_byte_offset" => {
            (types::VIEW_BASE, "byteOffset", format!("(L{};)D", types::VIEW_BASE))
        }
        "nts_view_buffer" => (
            types::VIEW_BASE,
            "buffer",
            format!("(L{};)L{};", types::VIEW_BASE, types::BUFFER),
        ),
        // A window onto the same bytes, and a copy. The whole difference
        // between a view and an array is that these two are not the same
        // operation, so they are the entries most worth getting right: the
        // class is the *subject's*, because both answer a view of the element
        // type they were given.
        "nts_view_subarray" => {
            (leak(class.to_owned()), "subarray", format!("(L{class};DD)L{class};"))
        }
        "nts_view_slice" => (leak(class.to_owned()), "slice", format!("(L{class};DD)L{class};")),
        // `set` and `copyWithin` are declared on the base and take a base-typed
        // receiver, so they need no per-element entry -- and both are correct
        // only when the ranges intersect, which is why the runtime's `set`
        // snapshots when the two views share a buffer and `copyWithin` goes
        // through `System.arraycopy` for its memmove semantics.
        "nts_view_copy_within" => (
            types::VIEW_BASE,
            "copyWithin",
            format!("(L{};DDD)V", types::VIEW_BASE),
        ),
        "nts_view_set" => (
            types::VIEW_BASE,
            "set",
            format!("(L{};L{};D)V", types::VIEW_BASE, types::VIEW_BASE),
        ),
        // The generic pair, which exists for `set` across two element kinds and
        // for `DataView`. Not the indexing path.
        "nts_view_get" => {
            (types::VIEW_BASE, "getElement", format!("(L{};D)D", types::VIEW_BASE))
        }
        "nts_view_put" => {
            (types::VIEW_BASE, "putElement", format!("(L{};DD)V", types::VIEW_BASE))
        }
        // A loop over the per-element write, so each store keeps its own
        // coercion -- a byte fill would answer 44 for a `Uint8ClampedArray`
        // where the language says 255.
        "nts_view_fill" => {
            (types::VIEW_BASE, "fill", format!("(L{};DDD)V", types::VIEW_BASE))
        }
        _ => return None,
    })
}

#[must_use]
pub fn external(name: &str) -> Option<(&'static str, &'static str, String)> {
    let found = core_external(name)
        .or_else(|| global_external(name))
        .or_else(|| math_external(name))
        .or_else(|| string_external(name))
        .or_else(|| collection_external(name))
        .or_else(|| web_external(name))?;
    Some((found.0, found.1, found.2.to_owned()))
}


/// The boxing a bound parameter wants, as `(class, the primitive it takes)`.
///
/// `java.lang.Integer` renders as `number`, so a value reaching one of these is
/// a `double` on the stack and has to be narrowed before it is boxed --
/// `toInt32` and not `d2i`, the same rule as everywhere else at this boundary.
fn boxed_primitive(want: &str) -> Option<(&'static str, &'static str)> {
    Some(match want {
        "Ljava/lang/Integer;" => ("java/lang/Integer", "I"),
        "Ljava/lang/Double;" => ("java/lang/Double", "D"),
        "Ljava/lang/Short;" => ("java/lang/Short", "S"),
        "Ljava/lang/Byte;" => ("java/lang/Byte", "B"),
        "Ljava/lang/Character;" => ("java/lang/Character", "C"),
        "Ljava/lang/Float;" => ("java/lang/Float", "F"),
        "Ljava/lang/Long;" => ("java/lang/Long", "J"),
        "Ljava/lang/Boolean;" => ("java/lang/Boolean", "Z"),
        _ => return None,
    })
}

/// The `NtsForeign` conversion from a growable array to the Java array a bound
/// parameter declared.
///
/// Two, and each is here because a program reaches it. `[Z` is the one
/// primitive a *declared* parameter binds as a plain `T[]`, since `boolean` has
/// no typed array and every other primitive array binds to a view that
/// `arrays_can_grow` does not touch. `[I` arrives the other way: a **varargs
/// pack**, which the compiler builds itself out of plain numbers, so the
/// binder's mapping says nothing about it.
///
/// The rest -- `grownJ`, `grownB` and the siblings this obviously wants -- were
/// written once and deleted for compiling, linking and being unreachable. They
/// stay absent until a program asks: the refusal below names the descriptor it
/// wanted, which is how `[I` was found.
///
/// Returns `(member, the wrapper it takes)`. The wrapper is part of the answer
/// rather than a constant at the call sites: a growable `boolean[]` is an
/// `NtsArrayZ` and a growable `number[]` is an `NtsArrayD`, and the descriptor
/// was written `(Lnts/rt/NtsArrayZ;)` in both of the places that build it --
/// true while `[Z` was the only entry and a `NoSuchMethodError` the moment it
/// was not.
fn grown_array(want: &str) -> Option<(&'static str, &'static str)> {
    match want {
        "[Z" => Some(("grownZ", "Lnts/rt/NtsArrayZ;")),
        "[I" => Some(("grownI", "Lnts/rt/NtsArrayD;")),
        _ => None,
    }
}

/// The `NtsForeign` conversion from a typed array to the Java array a bound
/// parameter declared, if there is one.
///
/// Paired by *both* sides: `[B` is served by a `Uint8Array` and by nothing
/// else, so a `Float64Array` handed to a `byte[]` parameter falls through to
/// the refusal rather than silently taking the wrong reinterpretation.
fn view_to_array(want: &str, held: Option<&str>) -> Option<(&'static str, String)> {
    let held = held?;
    let (member, view) = match (want, held) {
        ("[B", "Lnts/rt/NtsViewU8;") => ("bytes", "Lnts/rt/NtsViewU8;"),
        ("[I", "Lnts/rt/NtsViewI32;") => ("ints", "Lnts/rt/NtsViewI32;"),
        ("[S", "Lnts/rt/NtsViewI16;") => ("shorts", "Lnts/rt/NtsViewI16;"),
        ("[C", "Lnts/rt/NtsViewU16;") => ("chars", "Lnts/rt/NtsViewU16;"),
        ("[F", "Lnts/rt/NtsViewF32;") => ("floats", "Lnts/rt/NtsViewF32;"),
        ("[D", "Lnts/rt/NtsViewF64;") => ("doubles", "Lnts/rt/NtsViewF64;"),
        _ => return None,
    };
    Some((member, format!("({view}){want}")))
}


/// What every arm of a field-access chain shares: where it came from, what it
/// reads through, and whether that arrives erased.
///
/// A bundle rather than three more parameters on `arm_test`, because the three
/// are one fact about the op and are read together at every arm.
struct Chain {
    origin: nts_semantic_schema::Origin,
    receiver: ValueId,
    erased: bool,
}

impl Emitter<'_> {
    /// One block: its operations, then its terminator.
    pub(crate) fn block(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        block: BlockId,
        next: Option<BlockId>,
    ) -> Result<(), Diagnostic> {
        let ops = self.func.blocks[block.0 as usize].ops.clone();
        let terminator = self.func.blocks[block.0 as usize].terminator.clone();

        // A comparison whose only reader is this block's own branch never
        // becomes a value: the branch reads the comparison directly.
        let fused = self.fusable(&ops, &terminator);

        for &value in &ops {
            if Some(value) == fused {
                continue;
            }
            // An erasure whose every use is a map key the helper now reads
            // unboxed; see `fuse::object_keys`. Substituting the call was not
            // enough on its own -- the `Erase` is a separate operation and went
            // on emitting `ofObject` into a slot nothing read, so the box was
            // still built and the measurement did not move. The call is the
            // producer in `fuse`'s other direction, which is why that one
            // needed no equivalent.
            if self.object_keys.contains_key(&value) {
                continue;
            }
            // The one-character string an `appendCharCode` makes unnecessary.
            // Same omission as the object key above and older: the fusion was
            // emitted and the call was too, so the string was built, stored and
            // never read. C2 deleted it, which is why it measured as a saving
            // on HotSpot and cost two objects a character on ART.
            if self.char_codes.contains(&value) {
                continue;
            }
            // Every operation loads its operands, operates, and stores or
            // discards the result -- so the depth after must be the depth
            // before. That is not an incidental property: it is the reason
            // `nts_jvm_emitter::frames` can write a StackMapTable in eighty
            // lines instead of three thousand, since it makes the operand stack
            // empty at every block boundary and leaves nothing to merge.
            //
            // Checked here because it cost an hour when it broke. `ArraySet`
            // emitted `d2i` on an index specialization had already made an
            // `int`, popping two words where the load pushed one; the stack ran
            // one short per subscript and reported an underflow at whichever
            // instruction hundreds of bytes later finally hit zero -- in a
            // function whose bytecode could not be printed *because* it had
            // been refused. Bisecting from TypeScript found it. This names the
            // operation, before anything downstream is emitted.
            let before = code.depth();
            self.operation(code, pool, value)?;
            if code.depth() != before {
                return Err(refuse(
                    self.func,
                    &format!(
                        "emitting %{} moved the operand stack from {} to {}, and \
                         an operation must leave it as it found it -- the emitter \
                         and its own accounting disagree about this one",
                        value.0,
                        before,
                        code.depth()
                    ),
                ));
            }
        }
        self.terminator(code, pool, block, &terminator, next, fused)?;
        // And the block as a whole. `Code::bind` refuses a non-empty stack at
        // the *next* block, which reports a byte offset and the wrong block;
        // this names the one that left it. The operand stack being empty at
        // every boundary is what `frames.rs` depends on, so it is worth two
        // checks rather than one.
        if code.depth() != 0 {
            return Err(refuse(
                self.func,
                &format!(
                    "block b{} ended with {} word(s) on the operand stack, and \
                     every block must leave it empty",
                    block.0,
                    code.depth()
                ),
            ));
        }
        Ok(())
    }

    /// The value a branch can consume in place, if there is one.
    pub(crate) fn fusable(&self, ops: &[ValueId], terminator: &Terminator) -> Option<ValueId> {
        let Terminator::Branch { cond, .. } = terminator else {
            return None;
        };
        if ops.last() != Some(cond) || self.uses.get(cond.0 as usize).copied() != Some(1) {
            return None;
        }
        let OpKind::Binary { op, lhs, .. } = self.func.values[cond.0 as usize].kind else {
            return None;
        };
        // A string comparison is a call that leaves a boolean, not a branch, so
        // there is nothing to fuse into.
        if matches!(self.ty(lhs), HirType::Managed(ManagedType::String)) {
            return None;
        }
        comparison(op).map(|_| *cond)
    }

    fn operation(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
    ) -> Result<(), Diagnostic> {
        let op = self.func.values[value.0 as usize].clone();
        let origin = op.origin.clone();
        // Pushed at each use instead; see `body::rematerialised`.
        if crate::body::rematerialised(self.func, value) {
            return Ok(());
        }
        let placed = match &op.kind {
            // Already in a slot: a parameter by the calling convention, a block
            // parameter because every edge into this block wrote it.
            OpKind::Param(_) | OpKind::BlockParam(_) => return Ok(()),

            OpKind::ConstBool(_) | OpKind::ConstInt(_) | OpKind::ConstFloat(_) => {
                self.constant(code, pool, &op.kind, &op.ty, &origin)?
            }
            OpKind::ConstString(_) | OpKind::Length(_) | OpKind::StringUnitAt { .. } => {
                self.string_operation(code, pool, value, &op.kind, &op.ty, &origin)?
            }
            OpKind::ArrayNew { .. } | OpKind::ArrayGet { .. } | OpKind::ArraySet { .. } => {
                self.array_operation(code, pool, &op.kind, &op.ty, &origin)?
            }
            OpKind::Erase { .. } | OpKind::TagOf { .. } | OpKind::Unerase { .. } => {
                self.erasure(code, pool, value, &op.kind, &op.ty, &origin)?
            }
            // `let` read before its declaration ran, inside a closure that
            // captured it. One predictable branch on the cells that have the
            // window and no others -- which is `is_guarded`, upstream, so a
            // cell without a `ready` field never reaches here.
            OpKind::CellReady { cell, name } => {
                self.cell_ready(code, pool, *cell, name, &origin)?;
                Placed::Stored
            }
            // The one instance, read back. Built in `<clinit>`; see
            // `closure_singletons`.
            OpKind::ClosureStatic => {
                let class = self.object_class(&op.ty)?;
                let field = format!("closure${}", class.rsplit('/').next().unwrap_or(&class));
                code.get_static(&origin, pool, &crate::body::program_class(self.shape.package), &field, &format!("L{class};"));
                Placed::OnStack
            }
            OpKind::ConstNull | OpKind::ConstUndefined => {
                self.absence(code, pool, &op.kind, &op.ty, &origin)?
            }
            OpKind::Binary { op: bin, lhs, rhs } => self.binary(code, pool, value, *bin, *lhs, *rhs)?,
            OpKind::Unary { op: un, operand } => self.unary(code, pool, &op.ty, *un, *operand)?,
            OpKind::Convert(operand) => {
                self.conversion(code, pool, value, *operand, &op.ty, &origin)?
            }

            OpKind::GlobalGet(_) | OpKind::GlobalSet { .. } => {
                self.global(code, pool, &op.kind, &origin)?
            }

            OpKind::Call { callee, args, .. } => self.call(code, pool, value, &op.ty, callee, args, &origin)?,

            // `new; dup; invokespecial <init>()V`, and then the lowering calls
            // the TypeScript constructor as an ordinary method on the result --
            // which is what `Func::initializes_receiver` already promises: a
            // freshly allocated receiver with every field zero, which is
            // exactly what the JVM hands back.
            //
            // `frame` is ignored. It is escape analysis asking for stack
            // placement, and there is nothing here to place: HotSpot decides
            // that at run time from the same evidence. On ART, whose escape
            // analysis is much weaker, honouring the hint may be worth
            // something -- and that is a measurement for when a DEX pipeline
            // exists, not a guess now.
            OpKind::SharedFieldGet { value: receiver, arms, field } => {
                self.shared_field_get(code, pool, value, *receiver, arms, *field)?
            }
            OpKind::OpenFieldGet { object, arms } => {
                self.chain_field_get(code, pool, value, *object, arms)?
            }
            OpKind::OpenFieldSet { object, arms, value: stored } => {
                self.chain_field_set(code, pool, value, *object, arms, *stored)?
            }
            OpKind::ObjectNew { .. } => self.object_new(code, pool, &op.ty, &origin)?,
            OpKind::FieldGet { .. } | OpKind::FieldSet { .. } => {
                match self.field_op(code, pool, &op.kind, &origin)? {
                    Some(placed) => placed,
                    None => return Ok(()),
                }
            }

        // A closed set of classes, so `instanceof` answers it directly --
        // one instruction against the C backend's chain of descriptor
        // pointer comparisons, and a fixed few when the set is larger.
        // Subscribe the frame to the promise. The `Return` that follows is
        // the suspension itself -- this operation only records who to come
        // back to.
        //
        // The frame's class implements `NtsResumable`, which is the one
        // nominal relationship this backend *creates* rather than recovers:
        // `Suspend` names a frame and a function, and both are emitted
        // here, so nothing upstream has to carry it.
        // A retain under a tracing collector has nothing to do, and the
        // guard was never about the operation -- it was about not knowing
        // why it was there.
        //
        // `hir::suspend` emits one regardless of provider, because a frame
        // outliving its function is a lifetime question the provider does
        // not answer: the resume *consumes* a reference, so the runtime
        // holds one until the resumption runs. Here that reference is the
        // frame sitting in the promise's waiting list, which is a strong
        // reference and is the whole of what keeps it alive.
        //
        // So this refuses only under `ReferenceCounting`, where a retain
        // means the middle end expects *this backend* to be counting and it
        // is not. Under `NoGc` the pair is dropped, both halves together --
        // `suspend.rs` emits the matching `Release` and ignoring one
        // without the other is not a thing.
            OpKind::Retain(_) | OpKind::Release(_)
                if self.program.provider != nts_core::hir::Provider::ReferenceCounting =>
            {
                Placed::Stored
            }
            OpKind::Suspend { promise, frame, .. } => {
                self.suspend(code, pool, *promise, *frame, &origin)?
            }
            OpKind::InstanceOf { value, classes } if classes.len() != 1 => {
                self.instance_of_any(code, pool, *value, classes, &origin)?
            }
            OpKind::InstanceOf { value, classes } => {
                let [only] = classes.as_slice() else {
                    return Err(refuse(self.func, "an `instanceof` against no class at all"));
                };
                let Some(layout) = self.program.layout(*only) else {
                    return Err(refuse(self.func, "an `instanceof` against an unknown class"));
                };
                self.load(code, pool, *value)?;
                // **Unbox before asking for a class.** An erased operand is the
                // common case, and `InstanceOf`'s own doc says the operand may
                // be erased and that the lowering emits the tag test -- which
                // reads as a note about the tag, and is also a note about the
                // payload. `NtsValue instanceof Circle` is always false.
                //
                // Which is exactly what it was. `benches/cases/instanceof`
                // returned 3 per iteration where node returns an average of 2:
                // every test false, every `else` taken, and a plausible number
                // out the end. The benchmark's cross-variant checksum caught
                // it; nothing in the emitter did.
                if *self.ty(*value) == HirType::Erased && !self.unboxed.contains(value) {
                    code.get_field(
                        &origin,
                        pool,
                        types::VALUE,
                        "ref",
                        "Ljava/lang/Object;",
                    );
                }
                // The class this test *names*, which is not always the
                // layout's: see `hierarchy::identities`. Testing the layout's
                // class asks "does it have this shape", and `instanceof` asks
                // "is it this class" -- the same question only while one class
                // owns the layout.
                let wanted = crate::hierarchy::identity_of(self.program, *only)
                    .map_or_else(|| types::class_name(self.shape.package, layout), |class| {
                        types::identity_class_name(self.shape.package, layout, class)
                    });
                code.instance_of(&origin, pool, &wanted);
                Placed::OnStack
            }

            // Everything the managed and erased slices bring, refused by name
            // rather than half-emitted -- a backend that writes *something* for
            // every input is one nobody can trust the output of.
            other => return Err(refuse(self.func, &unsupported(other))),
        };

        if placed == Placed::OnStack {
            self.place(code, value, &op.ty, &origin)?;
        }
        Ok(())
    }

    /// Put an operation's result where the rest of the function will find it.
    ///
    /// A value nothing reads is discarded rather than left on the stack, which
    /// `Code::bind` would refuse at the end of the block.
    ///
    fn place(
        &self,
        code: &mut Code,
        value: ValueId,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        if let Some(slot) = self.slot(value) {
            let kind = self.kind_of(value)?;
            code.store(origin, kind, slot);
        } else {
            // **`kind_of` here too, not the declared type.** A discard has to
            // pop what is actually on the stack, and for a value this backend
            // holds in another representation those differ: an `f64` held as an
            // `int` is one word and `types::kind` says two. Nothing reached it
            // until cursors, because `intcall`'s values are all used and only
            // an unused one takes this branch -- so the declared type was right
            // by accident for as long as the only narrowing was of results
            // somebody wanted.
            let words = self.kind_of(value).map_or_else(
                |_| types::kind(ty).map_or(0, Kind::words),
                Kind::words,
            );
            if words > 0 {
                code.pop(origin, words);
            }
        }
        Ok(())
    }

    /// Module-scope storage, which is a static field on the program class.
    fn global(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        let (index, storing) = match kind {
            OpKind::GlobalGet(global) => (*global, None),
            OpKind::GlobalSet { global, value } => (*global, Some(*value)),
            _ => return Err(refuse(self.func, "a global operation that is neither a read nor a write")),
        };
        let Some(entry) = self.program.globals.get(index as usize) else {
            return Err(refuse(self.func, "a global this program does not declare"));
        };
        let Some(descriptor) = types::descriptor(self.shape, &entry.ty) else {
            return Err(refuse(self.func, "a global of unrepresentable type"));
        };
        let name = crate::body::method_name(&entry.name);
        // **A bound static is the jar's field, not a copy in our class.**
        // `Kind.SMALL` arrives here as one of our globals -- the declaration
        // says `static readonly SMALL: Kind` and nothing distinguishes it from
        // a module-scope constant of ours -- so it was read from
        // `nts/gen/Program.Kind$SMALL`, which nothing ever writes. Null at run
        // time, and an enum constant is the one thing a caller is told needs
        // no null check.
        //
        // Reading the jar's field instead also runs the owner's `<clinit>`,
        // which is the whole reason a reference static is a real `getstatic`
        // and not an `ldc`: the constant does not exist until the class is
        // initialised.
        //
        // Matched by simple name and member, because that is what the global
        // carries. Two bound classes with one simple name would be ambiguous,
        // and ambiguity is refused rather than guessed -- picking the first
        // would be a wrong field that loads.
        let foreign_static = {
            let (class, member) = entry.name.split_once('.').unwrap_or(("", ""));
            let mut hits = self.program.foreign.iter().filter(|(key, row)| {
                matches!(row.kind, nts_core::hir::runtime::ForeignKind::StaticField)
                    && key.split_once(':').is_some_and(|(head, _)| {
                        head.rsplit_once('.').is_some_and(|(owner, name)| {
                            name == member
                                && (owner == class || owner.ends_with(&format!("/{class}")))
                        })
                    })
            });
            match (hits.next(), hits.next()) {
                (Some((key, _)), None) => Some(key.clone()),
                (Some(_), Some(_)) => {
                    return Err(refuse(
                        self.func,
                        &format!("the bound static `{}`, which more than one binding row names", entry.name),
                    ));
                }
                _ => None,
            }
        };
        if let Some(key) = foreign_static {
            let Some((head, field)) = key.split_once(':') else {
                return Err(refuse(self.func, &format!("a malformed binding row `{key}`")));
            };
            let Some((owner, member)) = head.rsplit_once('.') else {
                return Err(refuse(self.func, &format!("a malformed binding row `{key}`")));
            };
            let field = field.to_owned();
            if storing.is_some() {
                return Err(refuse(
                    self.func,
                    &format!("a write to the bound static `{}`", entry.name),
                ));
            }
            code.get_static(origin, pool, owner, member, &field);
            self.convert_field(code, pool, &field, &entry.ty.clone(), true, origin)?;
            return Ok(Placed::OnStack);
        }
        let Some(stored) = storing else {
            code.get_static(origin, pool, &crate::body::program_class(self.shape.package), &name, &descriptor);
            return Ok(Placed::OnStack);
        };
        // The value's type and the global's have to be the same type, and on
        // this backend that is a *descriptor*, checked at load.
        //
        // They can differ. Specialization narrowed an array of integer literals
        // to `managed<[i32]>` and did not narrow the global it was stored into,
        // so `const arr = [1, 2]` at module scope produced `array.new :
        // managed<[i32]>` feeding a `global.set` on a `managed<[f64]>`. Neither
        // other backend could see it -- C spells every array `NtsArray *` and
        // LLVM spells every reference `ptr` -- and here it was a `VerifyError`
        // at class load. Fixed upstream in `hir::elements` since, and the check
        // stays: it is the only place in this compiler where the two types have
        // to be *identical* rather than merely both pointers.
        let held = self.ty(stored).clone();
        if types::descriptor(self.shape, &held).as_deref() != Some(descriptor.as_str()) {
            // **Identical descriptors, unless both sides are objects.** The
            // array case above is a `VerifyError` and stays refused: `[I` and
            // `[D` are unrelated types to the verifier and no relation between
            // their elements makes one assignable to the other.
            //
            // A *reference* is the opposite. `putstatic` on a field declared
            // `LLeaf;` accepts a `Bigger` off the stack with no `checkcast` and
            // no widening, because reference assignment on the JVM is
            // covariant -- so refusing it was this backend being stricter than
            // its own instruction set. `examples/upcast-to-base` is exactly
            // that store and it was refused for a reason that was never true
            // of it, having been written about arrays.
            //
            // `assignable_types` is the predicate rather than a second one: it
            // already asks the question in the JVM's terms, walking
            // `Layout.base` and the interfaces, and it is what `Return` uses
            // for the same store-to-a-declared-type question. Reached only
            // when both sides are objects, because for anything else it
            // answers `Ok` by falling through and would let the array case
            // past.
            let both_objects = matches!(
                (&held, &entry.ty),
                (
                    HirType::Managed(ManagedType::Object(_)),
                    HirType::Managed(ManagedType::Object(_))
                )
            );
            if !both_objects {
                return Err(refuse(
                    self.func,
                    &format!(
                        "a store of {} into the global `{}`, which is {} -- the middle \
                         end narrowed one and not the other, and the JVM would refuse \
                         the class rather than the store",
                        types::describe(&held),
                        entry.name,
                        types::describe(&entry.ty)
                    ),
                ));
            }
            self.assignable_types(&held, &entry.ty)?;
        }
        self.load(code, pool, stored)?;
        code.put_static(origin, pool, &crate::body::program_class(self.shape.package), &name, &descriptor);
        Ok(Placed::Stored)
    }

    /// A comparison where one side is erased and the other may not be.
    ///
    /// Lifted out because it is a *decision* rather than a step: the erased
    /// side cannot be unboxed without knowing what it holds, so the other side
    /// is boxed instead and `strictEq` decides -- which is the language's `===`
    /// between a value of unknown type and a known one, tags before payloads.
    fn branch_on_erased(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        test: Test,
        target: Label,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let Test { compare, negate, lhs, rhs } = test;
        if !matches!(compare, Compare::Eq | Compare::Ne) {
            return Err(refuse(
                self.func,
                "an ordering comparison against an erased value, which needs the \
                 coercion `<` does and this backend does not spell yet",
            ));
        }
        self.push_erased(code, pool, lhs, origin)?;
        self.push_erased(code, pool, rhs, origin)?;
        code.invoke_static(
            origin,
            pool,
            types::VALUE,
            "strictEq",
            "(Lnts/rt/NtsValue;Lnts/rt/NtsValue;)Z",
        );
        // `strictEq` leaves 1 for equal, so the branch is against zero and the
        // negation flips which way it goes.
        let branch = match (compare, negate) {
            (Compare::Eq, false) | (Compare::Ne, true) => Compare::Ne,
            _ => Compare::Eq,
        };
        code.branch_zero(origin, branch, target);
        Ok(())
    }

    /// `new; dup; invokespecial <init>()V`, after which the lowering calls the
    /// TypeScript constructor as an ordinary method on the result.
    ///
    /// That is what `Func::initializes_receiver` already promises: a freshly
    /// allocated receiver with every field zero, which is exactly what the JVM
    /// hands back. It also dodges the verifier's `uninitializedThis` state,
    /// which is the single most error-prone region of the specification and the
    /// one that would otherwise infect the frame table.
    ///
    /// `frame` is ignored. It is escape analysis asking for stack placement,
    /// and there is nothing here to place: `HotSpot` decides that at run time
    /// from the same evidence. On ART, whose escape analysis is much weaker,
    /// honouring it may be worth something -- a measurement for when a DEX
    /// pipeline exists, not a guess now.
    /// Reconcile a call's declared return with the type the middle end proved.
    ///
    /// Two different things wear the same shape here and only one of them is a
    /// cast.
    ///
    /// **A supertype.** A helper taking an array of references declares
    /// `Object[]`, so its result comes back `Object[]` where a `Foo[]` was
    /// proved. The value *is* a `Foo[]`; only the descriptor forgot, and a
    /// `checkcast` is exactly right.
    ///
    /// **A wrapper.** A helper answering "the element, or nothing" returns an
    /// `NtsValue`, which is not a supertype of anything -- it *contains* the
    /// reference. Casting it is a `ClassCastException` at the first call, and
    /// it was: `NtsArrayL.atValue` returning an `NtsValue` followed by
    /// `checkcast java/lang/String`, seventeen times in `examples/callbacks`.
    ///
    /// The unboxing here is the same sequence `Unerase` already emits for a
    /// boxed value, which is the argument for it being right: the two paths
    /// disagreed about the same representation, and only one of them had been
    /// asked to run.
    fn narrow_result(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        result: &HirType,
        returns: &str,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let Some(want) = types::descriptor(self.shape, result) else {
            return Ok(());
        };
        if want == returns {
            return Ok(());
        }
        if returns == types::VALUE_DESCRIPTOR {
            return match result {
                HirType::Bool => {
                    code.invoke_static(origin, pool, types::VALUE, "asBoolean", "(Lnts/rt/NtsValue;)Z");
                    Ok(())
                }
                HirType::Int { .. } | HirType::Float { .. } => {
                    code.get_field(origin, pool, types::VALUE, "num", "D");
                    let target = types::kind(result)
                        .ok_or_else(|| refuse(self.func, "narrowing to an unrepresentable number"))?;
                    if target != Kind::Double {
                        let opcode = match target {
                            Kind::Long => insn::D2L,
                            Kind::Float => insn::D2F,
                            _ => insn::D2I,
                        };
                        code.convert(origin, opcode, Kind::Double, target);
                    }
                    Ok(())
                }
                HirType::Managed(_) => {
                    code.get_field(origin, pool, types::VALUE, "ref", "Ljava/lang/Object;");
                    code.check_cast(origin, pool, &want);
                    Ok(())
                }
                other => Err(refuse(
                    self.func,
                    &format!("a helper answering `NtsValue` where {} was proved", types::describe(other)),
                )),
            };
        }
        if types::kind(result) == Some(Kind::Ref) {
            code.check_cast(origin, pool, &want);
        }
        Ok(())
    }

    /// The arguments of an external call, each brought to the type the
    /// descriptor declares for it.
    fn push_arguments(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        args: &[ValueId],
        descriptor: &str,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let parameters = nts_jvm_emitter::descriptor::parameters(descriptor);
        for (at, &arg) in args.iter().enumerate() {
            self.load(code, pool, arg)?;
            if let Some(want) = parameters.as_ref().and_then(|list| list.get(at)).copied() {
                self.coerce_callback(code, pool, arg, want, origin)?;
            }
        }
        Ok(())
    }



    /// A `number` on the stack, as the boxed primitive a bound parameter
    /// declared.
    ///
    /// Narrowed first and by the same rule as everywhere else at this boundary
    /// -- `toInt32`, not `d2i` -- and then `valueOf`, which is what `javac`
    /// emits at the same place and is the cached box for the small integers.
    fn box_primitive(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        want: &str,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        use nts_jvm_emitter::insn::{self, Kind};
        let Some((class, from)) = boxed_primitive(want) else {
            return Err(refuse(self.func, "a boxed primitive this lane cannot build"));
        };
        match from {
            "I" => code.invoke_static(origin, pool, RUNTIME, "toInt32", "(D)I"),
            "S" => code.invoke_static(origin, pool, RUNTIME, "toInt16", "(D)I"),
            "B" => code.invoke_static(origin, pool, RUNTIME, "toInt8", "(D)I"),
            "C" => code.invoke_static(origin, pool, RUNTIME, "toUint16", "(D)I"),
            "J" => code.get_field(origin, pool, types::BIGINT, "lo", "J"),
            "F" => code.convert(origin, insn::D2F, Kind::Double, Kind::Float),
            _ => {}
        }
        code.invoke_static(origin, pool, class, "valueOf", &format!("({from}){want}"));
        Ok(())
    }

    /// One argument, brought to the width the jar declared.
    ///
    /// Split out of [`Self::push_foreign_arguments`], which is a loop and a
    /// dispatch and was over its line limit as both. Every width decision lives
    /// here; the loop above only walks the descriptor.
    fn narrow_one(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        arg: ValueId,
        want: &str,
        integral: bool,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        use nts_jvm_emitter::insn::{self, Kind};
    match (want, integral) {
        // Already the width the jar asked for.
        ("I" | "Z", true) | ("D", false) => {}
        // The JavaScript conversions, one helper per width.
        ("I", false) => code.invoke_static(origin, pool, RUNTIME, "toInt32", "(D)I"),
        ("S", false) => code.invoke_static(origin, pool, RUNTIME, "toInt16", "(D)I"),
        ("B", false) => code.invoke_static(origin, pool, RUNTIME, "toInt8", "(D)I"),
        ("C", false) => code.invoke_static(origin, pool, RUNTIME, "toUint16", "(D)I"),
        // Already an `int`, so the JVM's own narrowing is the same
        // truncation `ToInt32` would do from here and is one byte.
        ("S", true) => code.convert(origin, insn::I2S, Kind::Int, Kind::Int),
        ("B", true) => code.convert(origin, insn::I2B, Kind::Int, Kind::Int),
        ("C", true) => code.convert(origin, insn::I2C, Kind::Int, Kind::Int),
        ("F", false) => code.convert(origin, insn::D2F, Kind::Double, Kind::Float),
        ("D", true) => code.convert(origin, insn::I2D, Kind::Int, Kind::Double),
        // **A `bigint` into a `long` is its low 64 bits**, which is
        // what `BigInt.asIntN(64, v)` specifies and what node does:
        // `2**63` arrives as `-2**63` and `2**64` as `0`. Wrapping
        // rather than refusing is the same rule the integral widths
        // above follow, and the same one `ToInt32` follows -- a
        // boundary conversion takes the low bits.
        //
        // `lo` *is* that value by construction: `fromLong` builds a
        // bigint as `of(value >> 63, value)`, so `hi` is the sign
        // extension and `lo` is the 64 bits. Reading it is the whole
        // conversion, and it is one instruction.
        ("J", _) if matches!(self.ty(arg), HirType::BigInt) => {
            code.get_field(origin, pool, types::BIGINT, "lo", "J");
        }
        // A reference parameter: the callback coercion already owns
        // this question and answers it for interfaces as well.
        // **A `number[]` meeting a Java primitive array.** Ours is a
        // `[D`; `sum(int...)` wants `[I`, and the two are unrelated
        // types to the verifier however alike the values look. The
        // elements move and each takes the narrowing a scalar would
        // take here -- the same `ToInt32` rule, not `d2i`.
        (other, _)
            if matches!(other, "[I" | "[J" | "[S" | "[B" | "[C" | "[F")
                && matches!(
                    types::descriptor(self.shape, self.ty(arg)).as_deref(),
                    Some("[D")
                ) =>
        {
            let to = match other {
                "[I" => "toI",
                "[J" => "toJ",
                "[S" => "toS",
                "[B" => "toB",
                "[C" => "toC",
                _ => "toF",
            };
            code.invoke_static(origin, pool, types::ARRAYS, to, &format!("([D){other}"));
        }
        // **Under `arrays_can_grow` the wrapper's `items` is longer
        // than its `length`**, so even the same-element case cannot be
        // handed over: the callee would see trailing slots the program
        // does not consider part of the array. A copy, which is what
        // the cost table has always said this costs and what this
        // refused to do until now.
        //
        // The reference case passes an **empty array of the wanted
        // type** and lets `Arrays.copyOf` preserve it -- no class
        // constant and no reflection, and the verifier checks the
        // result really is a `String[]`.
        (other, _) if other.starts_with('[') && self.shape.grows => {
            if let Some(element) = other.strip_prefix('[').filter(|it| it.starts_with('L'))
            {
                code.const_int(origin, pool, 0);
                // The *element descriptor*, `Ljava/lang/String;` --
                // `new_array` spells a reference element the way the
                // descriptor does, not the way `checkcast` spells a
                // class.
                code.new_array(origin, pool, element);
                code.invoke_static(
                    origin,
                    pool,
                    types::ARRAYS,
                    "objects",
                    "(Lnts/rt/NtsArrayL;[Ljava/lang/Object;)[Ljava/lang/Object;",
                );
                code.check_cast(origin, pool, other);
            } else if let Some((member, from)) = grown_array(other) {
                code.invoke_static(
                    origin,
                    pool,
                    types::ARRAYS,
                    member,
                    &format!("({from}){other}"),
                );
            } else {
                return Err(refuse(
                    self.func,
                    &format!(
                        "a bound member wanting `{other}` from a growable array, whose \
                         element this lane has no conversion for"
                    ),
                ));
            }
        }
        // Any array crossing to Java; see `push_foreign_array`.
        (other, _)
            if other.starts_with('[')
                && self.crosses_as_array(other, arg) =>
        {
            self.push_foreign_array(code, pool, arg, other, origin)?;
        }
            // **A number meeting a boxed primitive.** `nts bind` renders
            // `java.lang.Double` as `number`, so the value on the stack is a
            // `double` where a reference is declared -- two words where one is
            // wanted, which the emitter's own accounting catches before the
            // verifier does. `valueOf` is what `javac` emits at the same place,
            // and it is the cached box for the small integers, so the common
            // case allocates nothing.
            (other, _)
                if boxed_primitive(other).is_some()
                    && !matches!(self.ty(arg), HirType::Erased) =>
            {
                self.box_primitive(code, pool, other, origin)?;
            }
        // **An erased value meeting a bound reference parameter.**
        // `setOnTouch(View.OnTouch | ((x, y) => boolean))` is a union,
        // so the argument is an `NtsValue` -- and handing that to Java
        // is `IncompatibleClassChangeError` at the first dispatch:
        // `NtsValue does not implement View$OnTouch`.
        //
        // `coerce_callback` answers this for *our* callback interfaces
        // and does not recognise a jar's, so the unboxing is done here
        // against the descriptor the jar declared. The `checkcast` is
        // what makes a wrong binding a `ClassCastException` at the call
        // rather than a corrupt frame.
        (other, _)
            if other.starts_with('L')
                && matches!(self.ty(arg), HirType::Erased)
                && !self.unboxed.contains(&arg) =>
        {
            code.get_field(origin, pool, types::VALUE, "ref", "Ljava/lang/Object;");
            code.check_cast(origin, pool, &other[1..other.len() - 1]);
        }
        (other, _) if other.starts_with('L') || other.starts_with('[') => {
            self.coerce_callback(code, pool, arg, other, origin)?;
        }
        // **`J` lands here deliberately.** A `bigint` is an
        // `NtsBigInt`, not a `long`, and the conversion between them is
        // a decision this lane has not made. Refusing by name is the
        // rule; emitting `d2l` would be a wrong number at every
        // magnitude a `long` exists for.
        (other, held) => {
            return Err(refuse(
                self.func,
                &format!(
                    "a bound member wanting `{other}` for {}",
                    if held { "an integer" } else { "a number" }
                ),
            ));
        }
    }
        Ok(())
    }

    /// Whether this argument is an array shape [`Self::push_foreign_array`]
    /// knows how to hand over.
    fn crosses_as_array(&self, want: &str, arg: ValueId) -> bool {
        let held = types::descriptor(self.shape, self.ty(arg));
        view_to_array(want, held.as_deref()).is_some()
            || (self.shape.grows
                && (want.starts_with("[L") || grown_array(want).is_some()))
    }

    /// An array of ours, as the Java array a bound parameter declared.
    ///
    /// Three shapes and each costs something different, which is why they are
    /// together: a whole-buffer view hands over the buffer's own storage, a
    /// `subarray` copies because an offset is something a Java array has
    /// nowhere to put, and a growable array copies because its `items` is
    /// longer than its `length`.
    fn push_foreign_array(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        arg: ValueId,
        want: &str,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let held = types::descriptor(self.shape, self.ty(arg));
        if let Some((member, signature)) = view_to_array(want, held.as_deref()) {
            code.invoke_static(origin, pool, types::ARRAYS, member, &signature);
            return Ok(());
        }
        if let Some(element) = want.strip_prefix('[').filter(|it| it.starts_with('L')) {
            code.const_int(origin, pool, 0);
            // The *element descriptor*, `Ljava/lang/String;` -- `new_array`
            // spells a reference element the way the descriptor does, not the
            // way `checkcast` spells a class.
            code.new_array(origin, pool, element);
            code.invoke_static(
                origin,
                pool,
                types::ARRAYS,
                "objects",
                "(Lnts/rt/NtsArrayL;[Ljava/lang/Object;)[Ljava/lang/Object;",
            );
            code.check_cast(origin, pool, want);
            return Ok(());
        }
        let Some((member, from)) = grown_array(want) else {
            return Err(refuse(
                self.func,
                &format!("a bound member wanting `{want}`, which this lane cannot hand over"),
            ));
        };
        code.invoke_static(origin, pool, types::ARRAYS, member, &format!("({from}){want}"));
        Ok(())
    }

    /// Arguments to a **bound Java member**, narrowed to the widths the jar
    /// declared.
    ///
    /// Separate from [`Self::push_arguments`] because that one walks a
    /// descriptor *this repository wrote*, where the declared width is already
    /// the width the value is held in. Here the descriptor comes from a jar and
    /// the value is a JavaScript `number` -- an `f64` -- so every integral
    /// parameter needs a conversion, and it must be the one **JavaScript**
    /// specifies rather than the one the JVM would do.
    ///
    /// **`d2i` is the wrong instruction and it is wrong quietly.** Java
    /// saturates: `2**31` becomes `2147483647`. `ToInt32` wraps modulo `2^32`:
    /// it becomes `-2147483648`, which is what node prints, and node is the
    /// oracle. The two agree on every value anyone tries by hand and disagree
    /// on exactly the ones a boundary is tested with, so the difference does
    /// not fail to verify -- it prints a different number.
    ///
    /// Java's `char` is **unsigned** where its `byte` and `short` are not, so
    /// they cannot share a helper. Passing `-1` is what shows it: `65535` into
    /// a `char`, `-1` into a `short`.
    fn push_foreign_arguments(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        args: &[ValueId],
        descriptor: &str,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let Some(parameters) = nts_jvm_emitter::descriptor::parameters(descriptor) else {
            return Err(refuse(
                self.func,
                &format!("a bound member whose descriptor `{descriptor}` this compiler cannot read"),
            ));
        };
        if parameters.len() != args.len() {
            return Err(refuse(
                self.func,
                &format!(
                    "a bound member given {} argument(s) against `{descriptor}`",
                    args.len()
                ),
            ));
        }
        for (&arg, want) in args.iter().zip(parameters) {
            self.load(code, pool, arg)?;
            // What the value *is*, not what its signature says: `intcall`
            // holds some helper answers in an `int` slot, and starting from
            // the declared `f64` would emit a conversion from a double that is
            // not on the stack.
            let integral = self.narrowed.contains(&arg)
                || matches!(self.ty(arg), HirType::Int { .. } | HirType::Bool);
            self.narrow_one(code, pool, arg, want, integral, origin)?;
            // **After the narrowing, which is where every crossing converges.**
            //
            // A closure reaching a jar's interface arrives by two different
            // paths -- erased, where the binding renders the parameter as a
            // union and the code reads `.ref` and casts, and typed, where it is
            // already the class. Only the second knows which closure class it
            // is, and the first is the common one. Both end here with the value
            // on the stack as the interface, so the lane is recorded here and
            // the `instanceof` is `NtsForeign.bind`'s rather than the emitter's.
            //
            // A first attempt put this in `coerce_callback` and emitted nothing
            // at all: that function is not on the erased path.
            //
            // **Only where a closure could be the argument**, which means a jar
            // interface and not any reference. `is_foreign_layout_name` is
            // `contains('/')`, so the first version of this fired on
            // `java/lang/String` too -- `new Catalog("widgets")` emitted a
            // `bind` on its own string argument, which did nothing and claimed
            // the lane on the way. Harmless and wrong, and invisible from the
            // floor because `bind` ignores what it cannot use.
            if self.is_foreign_interface(want) {
                code.dup(origin);
                code.invoke_static(
                    origin,
                    pool,
                    types::FOREIGN,
                    "bind",
                    "(Ljava/lang/Object;)V",
                );
            }
        }
        Ok(())
    }

    /// Whether a descriptor names a jar interface a *closure* could satisfy and
    /// the inbox could deliver.
    ///
    /// Three narrowings, each one a version of this that was too wide:
    ///
    /// - not "a class with a `/` in its name", which `is_foreign_layout_name`
    ///   tests and which is every reference type on the platform. That version
    ///   put a `bind` on the string argument of `new Catalog("widgets")`.
    /// - not "any interface the binding table knows", because `java.util.Map` is
    ///   one and `weigh(Map)` is not a callback registration.
    /// - **functional**, meaning the jar declares exactly one member on it. A
    ///   closure implements one method; an interface with several is not
    ///   something a closure was handed to.
    ///
    /// And that member has to be one the inbox can carry, which is the same
    /// question `carries_env` asks of the closure at the other end. Asking it
    /// here too is what keeps a `bind` off a crossing that could never use one.
    fn is_foreign_interface(&self, want: &str) -> bool {
        let Some(class) = want.strip_prefix('L').and_then(|it| it.strip_suffix(';')) else {
            return false;
        };
        let members: Vec<&str> = self
            .shape
            .program
            .foreign
            .iter()
            .filter(|(_, row)| row.kind == nts_core::hir::runtime::ForeignKind::Interface)
            .filter_map(|(key, _)| {
                let (head, want) = key.split_once(':')?;
                let (owner, _) = head.rsplit_once('.')?;
                (owner == class).then_some(want)
            })
            .collect();
        members.len() == 1 && types::deliverable(members[0]).is_some()
    }

    /// The argument a fixed intrinsic declared as a callback interface,
    /// brought to that type on the stack.
    ///
    /// **The verifier is no help here and it is worth saying why.** JVMS
    /// 4.10.1.2 makes every class assignable to every interface without
    /// loading either -- interface conformance is checked at the *call*, by
    /// `invokeinterface`, not at the boundary. So a descriptor naming
    /// `NtsCallback` is a statement of intent that nothing enforces, and a
    /// program handing a `Point` to `setTimeout` would verify, link, and fail
    /// with an `IncompatibleClassChangeError` from inside the runtime.
    ///
    /// That error is the one the differential cannot read: `stopped()` finds a
    /// refusal by its `nts:` line, so a JVM stack trace out of a helper is a
    /// **defect** on a case the other lanes decline cleanly. So the check is
    /// here, at build time, where it is a refusal naming the type.
    ///
    /// An erased argument is the one shape that needs instructions: the
    /// reference is inside the box, and a `checkcast` on the way out puts the
    /// failure at the boundary with the class in the message rather than at
    /// the first invocation with neither.
    fn coerce_callback(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        arg: ValueId,
        want: &str,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        if !types::is_callback_interface(want) {
            return Ok(());
        }
        let ty = self.ty(arg).clone();
        if let HirType::Erased = ty {
            code.get_field(origin, pool, types::VALUE, "ref", "Ljava/lang/Object;");
            code.check_cast(origin, pool, &want[1..want.len() - 1]);
            return Ok(());
        }
        let implements = types::descriptor(self.shape, &ty)
            .and_then(|descriptor| {
                let class = descriptor.strip_prefix('L')?.strip_suffix(';')?.to_owned();
                self.shape
                    .program
                    .layouts
                    .iter()
                    .find(|layout| types::class_name(self.shape.package, layout) == class)
            })
            .is_some_and(|layout| {
                layout.methods.iter().flatten().any(|name| {
                    crate::hierarchy::member_name(name) == "call"
                        && self
                            .shape
                            .program
                            .funcs
                            .iter()
                            .find(|func| &func.name == name)
                            .and_then(|func| {
                                crate::instance_descriptor(self.shape.package, self.shape.program, func)
                            })
                            .and_then(|descriptor| types::callback_interface(&descriptor))
                            == Some(&want[1..want.len() - 1])
                })
            });
        if implements {
            return Ok(());
        }
        Err(refuse(
            self.func,
            &format!(
                "{} where a callback of shape `{}` was declared",
                types::describe(&ty),
                &want[1..want.len() - 1]
            ),
        ))
    }

    /// A field every arm of a union puts in the same place.
    ///
    /// **The C lane reads it with a pointer cast and this one cannot.** A cast
    /// there is a reinterpretation against a coarse tag; here it is a
    /// `CHECKCAST` and the class is checked, so `Unerase` to one arm and read
    /// threw `ClassCastException` on every value that was a different arm. The
    /// op states the fact instead -- these arms agree about this field -- and
    /// each backend picks its own instruction from it.
    ///
    /// One `instanceof` per arm, in the union's order, each falling to the
    /// next. Measured against the alternative before it was specified: a
    /// synthesised interface with an accessor is **3.5x slower** -- 6,213ns
    /// against 1,759ns over three arms -- because every read becomes a
    /// megamorphic `invokeinterface` whose itable lookup defeats inline
    /// caching, where a chain stays branch-predictable and the loads inline.
    ///
    /// The result goes to the value's own slot rather than through the scratch
    /// one a comparison uses: a field has a type and the scratch slot is an
    /// `int`. That also keeps the operand stack empty at every label, which is
    /// what lets the stack map stay the universal frame.
    ///
    /// **The last arm is tested too, rather than falling through.** Falling
    /// through would be a `CHECKCAST` that can fail, which is the exception
    /// this op exists to delete. A value outside every arm is a program the
    /// checker should have rejected, and it gets a named refusal.
    /// What every arm of one chain shares; see [`Chain`].
    fn chain_of(&self, op: ValueId, receiver: ValueId) -> Chain {
        Chain {
            // Cloned rather than borrowed: every arm emits through `&mut self`,
            // and a borrow of the function's own values would not survive that.
            origin: self.func.values[op.0 as usize].origin.clone(),
            receiver,
            erased: self.arrives_erased(receiver),
        }
    }

    /// One arm's test, leaving the receiver cast to that arm on the stack.
    ///
    /// Load, unwrap an erased value's reference, `instanceof` the arm's
    /// **identity** class, branch to `next` on a miss, then load and cast again.
    /// The identity class and the declaring class are two different names: a
    /// class that shares a layout has an empty subclass, so `instanceof` names
    /// that and the field lives on the base.
    fn arm_test(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        chain: &Chain,
        arm: nts_semantic_schema::TypeId,
        owner: &str,
        next: Label,
    ) -> Result<(), Diagnostic> {
        let (origin, receiver, erased) = (&chain.origin, chain.receiver, chain.erased);
        let Some(layout) = self.program.layout(arm) else {
            return Err(refuse(self.func, "a field read over an arm with no layout"));
        };
        let tested = crate::hierarchy::identity_of(self.program, arm)
            .map_or_else(|| types::class_name(self.shape.package, layout), |class| {
                types::identity_class_name(self.shape.package, layout, class)
            });
        self.load(code, pool, receiver)?;
        if erased {
            code.get_field(origin, pool, types::VALUE, "ref", "Ljava/lang/Object;");
        }
        code.instance_of(origin, pool, &tested);
        code.branch_zero(origin, Compare::Eq, next);
        self.load(code, pool, receiver)?;
        if erased {
            code.get_field(origin, pool, types::VALUE, "ref", "Ljava/lang/Object;");
        }
        code.check_cast(origin, pool, owner);
        Ok(())
    }

    /// Whether a receiver arrives as an erased value that has to be unwrapped.
    fn arrives_erased(&self, receiver: ValueId) -> bool {
        *self.ty(receiver) == HirType::Erased && !self.unboxed.contains(&receiver)
    }

    /// The chain a field read through several possible layouts becomes.
    ///
    /// Each arm carries **its own** index, which is the whole of what separates
    /// `OpenFieldGet` from `SharedFieldGet` -- the latter passes the same index
    /// in every arm and is otherwise this function.
    ///
    /// A value matching no arm is a program the checker should have rejected, so
    /// the last arm still takes its test and the fall-through throws rather than
    /// reaching a cast nobody chose.
    fn chain_field_get(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        receiver: ValueId,
        arms: &[nts_core::hir::FieldArm],
    ) -> Result<Placed, Diagnostic> {
        // Taken from the value rather than passed: one argument over the limit,
        // and this is the one the caller had only just read off the same op.
        let origin = &self.func.values[value.0 as usize].origin.clone();
        if arms.is_empty() {
            return Err(refuse(self.func, "a field read over no arms at all"));
        }
        let Some(slot) = self.slot(value) else {
            return Err(refuse(self.func, "a field read whose result has no slot"));
        };
        let kind = self.kind_of(value)?;
        let chain = self.chain_of(value, receiver);
        let done = code.label();
        for arm in arms {
            let next = code.label();
            let (owner, name, descriptor, _) = self.field_ref_of(arm.ty, arm.field)?;
            self.arm_test(code, pool, &chain, arm.ty, &owner, next)?;
            code.get_field(origin, pool, &owner, &name, &descriptor);
            code.store(origin, kind, slot);
            code.goto(origin, done);
            code.bind(next);
        }
        code.invoke_static(origin, pool, RUNTIME, "unreachable", "()Ljava/lang/Error;");
        code.athrow(origin);
        code.bind(done);
        Ok(Placed::Stored)
    }

    /// The same chain, storing instead of loading.
    ///
    /// The stored value is loaded **inside** each arm rather than once before the
    /// chain: a `putfield` wants the reference underneath the value, and the
    /// reference is what the test produces. Hoisting it would leave a value on
    /// the stack across a branch, which is the shape the verifier rejects and the
    /// emitter's own accounting catches first.
    fn chain_field_set(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        op: ValueId,
        receiver: ValueId,
        arms: &[nts_core::hir::FieldArm],
        stored: ValueId,
    ) -> Result<Placed, Diagnostic> {
        let origin = &self.func.values[op.0 as usize].origin.clone();
        if arms.is_empty() {
            return Err(refuse(self.func, "a field write over no arms at all"));
        }
        let chain = self.chain_of(op, receiver);
        let done = code.label();
        for arm in arms {
            let next = code.label();
            let (owner, name, descriptor, _) = self.field_ref_of(arm.ty, arm.field)?;
            self.arm_test(code, pool, &chain, arm.ty, &owner, next)?;
            self.load(code, pool, stored)?;
            code.put_field(origin, pool, &owner, &name, &descriptor);
            code.goto(origin, done);
            code.bind(next);
        }
        code.invoke_static(origin, pool, RUNTIME, "unreachable", "()Ljava/lang/Error;");
        code.athrow(origin);
        code.bind(done);
        Ok(Placed::Stored)
    }

    fn shared_field_get(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        receiver: ValueId,
        arms: &[nts_semantic_schema::TypeId],
        field: u32,
    ) -> Result<Placed, Diagnostic> {
        // One index in every arm, which is this op's precondition spelled as
        // data: the chain is the same chain, told that the arms agree.
        let arms: Vec<nts_core::hir::FieldArm> = arms
            .iter()
            .map(|ty| nts_core::hir::FieldArm { ty: *ty, field })
            .collect();
        self.chain_field_get(code, pool, value, receiver, &arms)
    }

    fn object_new(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        let class = self.object_class(ty)?;
        code.new_object(origin, pool, &class);
        code.dup(origin);
        code.invoke_special(origin, pool, &class, "<init>", "()V");
        Ok(Placed::OnStack)
    }

    /// Subscribe a frame to the promise it is waiting on.
    ///
    /// The `Return` that follows is the suspension itself; this only records
    /// who to come back to. The frame's class implements `NtsResumable`, which
    /// is the one nominal relationship this backend *creates* rather than
    /// recovers -- `Suspend` names a frame and a function and both are emitted
    /// here, so nothing upstream has to carry it.
    fn suspend(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        promise: ValueId,
        frame: ValueId,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        self.load(code, pool, promise)?;
        self.load(code, pool, frame)?;
        code.invoke_static(
            origin,
            pool,
            types::PROMISE,
            "subscribe",
            "(Lnts/rt/NtsPromise;Lnts/rt/NtsResumable;)V",
        );
        Ok(Placed::Stored)
    }

    /// Whether a value may be stored into another's slot, as the *verifier*
    /// asks it: by class, not by representation.
    ///
    /// Every other backend can skip this. C stores through a pointer cast and
    /// LLVM's `ptr` is opaque, so an edge copy from a `TypeError` into a slot
    /// the IR types `Error` is a no-op in both. Here the slot's frame entry
    /// names a class, and the JVM refuses the whole class file if the value is
    /// not that class or one below it.
    ///
    /// It fires today on the four provided error classes, which are not
    /// declarations in the compiled program -- so `Hierarchy::base` never hears
    /// of them and `Layout.base` is `None` for all four. They are structurally
    /// identical, and record 0074 gives them a *nominal* guard for
    /// `instanceof`; what they do not have is a base, so `nts/gen/TypeError`
    /// extends `Object` here and is not assignable to `nts/gen/Error`.
    ///
    /// Refused by name rather than emitted. `VerifyError: inconsistent
    /// stackmap frames` names a slot index and a bytecode offset; this names
    /// the two classes.
    /// A `checkcast` whose target no reaching class can be.
    ///
    /// **"Unchecked by construction upstream" is what the call site said, and it
    /// was a precondition rather than a fact.** `interface C { seen: number;
    /// m(): void }` with `class A implements C` is ordinary TypeScript and has
    /// no JVM spelling: `C` carries state so it cannot be an interface, and
    /// `implements` is not `extends` so `Layout.base` relates nothing. `A`
    /// extends `Object`, and reading an erased `A` back as `C` compiles, loads,
    /// and throws `ClassCastException: class nts.gen.A cannot be cast to class
    /// nts.gen.C`.
    ///
    /// A **wrong answer** rather than a refusal, which is the worse kind and is
    /// invisible to every refusal count in the tree -- so it took a new example
    /// dispatching through an interface type to surface a gap that had always
    /// been there.
    ///
    /// Asked at both casts. The `unboxed` arm emits one too, and checking only
    /// the general arm left the failing program failing unchanged -- two sites
    /// spelling one narrowing, and a guard on one of them is not a guard.
    fn refuse_impossible_cast(&self, ty: &HirType) -> Result<(), Diagnostic> {
        let HirType::Managed(ManagedType::Object(id)) = ty else { return Ok(()) };
        let Some(target) = self.program.layout(*id) else { return Ok(()) };
        if !crate::hierarchy::claimed_without_extending(self.program, target) {
            return Ok(());
        }
        Err(refuse(
            self.func,
            &format!(
                "reading an erased value back as `{}`, which other classes declare they \
                 implement without extending -- it carries state, so this backend emits it \
                 as a class rather than an interface, and the cast would throw",
                target.name
            ),
        ))
    }

    fn assignable(&self, from: ValueId, to: ValueId) -> Result<(), Diagnostic> {
        // A block parameter that merges closures of differing classes is
        // declared as the interface all of them implement, and JVMS 4.10.1.2
        // makes a class assignable to any interface without checking. So there
        // is nothing here to refuse: the destination is not either closure's
        // class, whatever the IR calls it. `closures` says why the IR calls it
        // one of them.
        if self.joined.contains_key(&to) {
            return Ok(());
        }
        let (source, target) = (self.ty(from).clone(), self.ty(to).clone());
        self.assignable_types(&source, &target)
    }

    /// The same question between two types rather than two values.
    fn assignable_types(&self, source: &HirType, target: &HirType) -> Result<(), Diagnostic> {
        let (
            HirType::Managed(ManagedType::Object(source_id)),
            HirType::Managed(ManagedType::Object(target_id)),
        ) = (source, target)
        else {
            return Ok(());
        };
        if source_id == target_id {
            return Ok(());
        }
        let (Some(source_layout), Some(target_layout)) = (
            self.program.layout(*source_id),
            self.program.layout(*target_id),
        ) else {
            return Ok(());
        };
        let wanted = types::class_name(self.shape.package, target_layout);
        if crate::hierarchy::ancestry(self.program, source_layout)
            .iter()
            .any(|ancestor| types::class_name(self.shape.package, ancestor) == wanted)
        {
            return Ok(());
        }
        // Or the target is an interface the source declares. The JVM would
        // accept this store without being told -- JVMS 4.10.1.2 makes any class
        // assignable to any interface without checking, so the verifier is not
        // what this guards against. What it guards against is emitting a store
        // the *program* does not license, which would then fail at the call
        // with an `IncompatibleClassChangeError` on whichever path reached it
        // first. So the check is kept and widened rather than skipped for
        // interfaces.
        if crate::hierarchy::implements(self.program, source_layout, *target_id) {
            return Ok(());
        }
        Err(refuse(
            self.func,
            &format!(
                "storing a `{}` where a `{}` is declared, and the first does not \
                 extend the second here -- the IR relates them and `Layout.base` \
                 does not, so the JVM would refuse the class",
                source_layout.name, target_layout.name
            ),
        ))
    }

    /// `x instanceof C` where the closed set of classes satisfying it has more
    /// than one member.
    ///
    /// The set is closed at compile time -- `C` and everything that extends it,
    /// which the hierarchy already knows -- so this is a fixed number of tests
    /// with no chain to walk and no prototype to consult.
    ///
    /// `ior` rather than branches. `instanceof` leaves 0 or 1, so the tests
    /// combine arithmetically and there is no label, no scratch slot and
    /// nothing for the frame table to describe. A short-circuit would be fewer
    /// instructions on the true path and would need both.
    fn instance_of_any(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        classes: &[nts_semantic_schema::TypeId],
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        if classes.is_empty() {
            return Err(refuse(self.func, "an `instanceof` against no class at all"));
        }
        for (at, class) in classes.iter().enumerate() {
            let Some(layout) = self.program.layout(*class) else {
                return Err(refuse(self.func, "an `instanceof` against an unknown class"));
            };
            self.load(code, pool, value)?;
            // Unbox before asking for a class; see the single-class arm. A
            // value `unbox` kept as a bare reference is already the thing to
            // ask, and has no field to read.
            if *self.ty(value) == HirType::Erased && !self.unboxed.contains(&value) {
                code.get_field(origin, pool, types::VALUE, "ref", "Ljava/lang/Object;");
            }
            // The identity class, as in the single-class arm: a shared layout
            // cannot tell two classes apart, and a set member is a class rather
            // than a shape. Checked rather than assumed -- this arm resolved the
            // layout's class and would have kept answering `true` for a sibling
            // while the single-class arm was already right.
            let wanted = crate::hierarchy::identity_of(self.program, *class)
                .map_or_else(|| types::class_name(self.shape.package, layout), |owner| {
                    types::identity_class_name(self.shape.package, layout, owner)
                });
            code.instance_of(origin, pool, &wanted);
            if at > 0 {
                code.bitwise(origin, insn::OR, Kind::Int);
            }
        }
        Ok(Placed::OnStack)
    }

    /// The wrapper class for a growable array, by its element type.
    fn growable_class(&self, ty: &HirType) -> Result<String, Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = ty else {
            return Err(refuse(self.func, "an array operation on something that is not an array"));
        };
        types::wrapper(element).map(str::to_owned).ok_or_else(|| {
            refuse(
                self.func,
                &format!("a growable array of {}", types::describe(element)),
            )
        })
    }

    /// What a growable array holds, as its wrapper spells it: the descriptor
    /// and the computational kind that goes with it.
    ///
    /// The two can differ from the *element's* own kind. A `managed<[i32]>`
    /// lives in `NtsArrayD`, because the wrapper is chosen by storage width
    /// and an `i32` fits a `double` exactly -- so the element converts on the
    /// way in and back on the way out, which is the both-ends rule these arms
    /// keep everywhere else.
    fn growable_element(&self, ty: &HirType) -> Result<(String, Kind), Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = ty else {
            return Err(refuse(self.func, "an array operation on something that is not an array"));
        };
        Ok(match types::kind(element) {
            Some(Kind::Double | Kind::Int | Kind::Long | Kind::Float)
                if !matches!(**element, HirType::Bool) =>
            {
                ("D".to_owned(), Kind::Double)
            }
            Some(Kind::Int) => ("Z".to_owned(), Kind::Int),
            _ => ("Ljava/lang/Object;".to_owned(), Kind::Ref),
        })
    }

    /// The descriptor of what an array holds, or `None` if this is not one.
    ///
    /// Used to pick between overloads: `arraySlice(double[], ..)` and
    /// `arraySlice(Object[], ..)` are different methods, and a bare `double[]`
    /// is not an `Object[]`, so there is no generic version to fall back to
    /// even if one were wanted.
    fn array_element_descriptor(&self, ty: &HirType) -> Option<String> {
        let HirType::Managed(ManagedType::Array(element)) = ty else {
            return None;
        };
        let descriptor = types::descriptor(self.shape, element)?;
        // Three overloads cover every element type: the two primitive widths
        // that appear, and references. `Object[]` accepts any reference array
        // by Java's array covariance, and the result is `checkcast` back.
        Some(match descriptor.as_str() {
            "D" => "D".to_owned(),
            "Z" => "Z".to_owned(),
            _ => "L".to_owned(),
        })
    }

    /// Load a value as an `NtsValue`, boxing it if it is not already one.
    ///
    /// `map.get(k) === n` compares an erased value with a raw `f64`, and the
    /// IR says so: `eq %26, %27` with one operand `erased` and the other
    /// `f64`. Comparing them as references answers by identity and leaves the
    /// double's second word on the stack; comparing them as doubles cannot be
    /// done at all, because the erased side may not hold a number.
    ///
    /// So the scalar side is erased and `strictEq` decides, which is the
    /// language's `===` between a value of unknown type and a known one: the
    /// tags must match before the payloads are looked at.
    fn push_erased(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        if *self.ty(value) == HirType::Erased {
            return self.load(code, pool, value);
        }
        // `Impossible`, which is this site's standing behaviour and not a
        // claim: an on-the-fly erasure for an argument has no op to read
        // `Absent` from. A nullable reference crossing here is the same hazard
        // `OpKind::Erase` documents and is **not** fixed by this commit; it
        // needs the argument's declared type, which this function is not given.
        self.erase(code, pool, None, value, nts_core::hir::Absent::Impossible, origin)?;
        Ok(())
    }

    /// `null` and `undefined`, which are one value or two depending on where
    /// they land.
    ///
    /// Erased they are interned singletons: they carry no payload, so every one
    /// is the same one, and a compiled program mentions `undefined` constantly.
    /// As a reference they are both the null pointer, which is what makes
    /// `T | null` cost nothing -- one absence fits in a pointer and two do not,
    /// which is why `T | null | undefined` erases instead.
    fn absence(
        &self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        if *ty == HirType::Erased {
            let which = if matches!(kind, OpKind::ConstNull) {
                "NULL_VALUE"
            } else {
                "UNDEFINED_VALUE"
            };
            code.get_static(origin, pool, types::VALUE, which, types::VALUE_DESCRIPTOR);
            return Ok(Placed::OnStack);
        }
        if matches!(ty, HirType::Managed(_)) {
            code.const_null(origin);
            return Ok(Placed::OnStack);
        }
        // A scalar. `o?.level` where `o` is never absent still lowers the
        // absence the optional chain admits, and its type is the one the
        // narrowing left -- a `double`, with no reference for a null to be and
        // no tag for an `undefined` to sit in.
        //
        // The C lane answers `(ty)0` here on the reasoning that the value
        // cannot be read: the branch that produces it is the one the receiver
        // never takes. Same answer, same reasoning, and the zero is a constant
        // rather than a helper so nothing is paid for a value nothing reads.
        let Some(kind) = types::kind(ty) else {
            return Err(refuse(self.func, "an absent value with no representation"));
        };
        match kind {
            Kind::Double => code.const_double(origin, pool, 0.0),
            Kind::Float => code.const_float(origin, pool, 0.0),
            Kind::Long => code.const_long(origin, pool, 0),
            Kind::Int => code.const_int(origin, pool, 0),
            Kind::Ref => code.const_null(origin),
        }
        Ok(Placed::OnStack)
    }

    /// Putting a tag on a value, reading it off, and taking it back.
    ///
    /// `TagOf` **is** `typeof`: the tag numbering is chosen so that
    /// `typeof x === "object"` is the single comparison `tag >= OBJECT`, which
    /// is why the erased value is this three-field class rather than a bare
    /// `Object` tested with `instanceof`.
    fn erasure(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        result: ValueId,
        kind: &OpKind,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        match kind {
            OpKind::Erase { value, absent } => {
                self.erase(code, pool, Some(result), *value, *absent, origin)
            }
                // A `Void` erases to `undefined` and has nothing to load.
            OpKind::TagOf { value } => {
                self.load(code, pool, *value)?;
                code.get_field(origin, pool, types::VALUE, "tag", "I");
                self.adapt_to(code, Kind::Int, result, origin)?;
                Ok(Placed::OnStack)
            }
            OpKind::Unerase { value } if self.fused.contains(value) => {
                self.load(code, pool, *value)?;
                let target = types::kind(ty)
                    .ok_or_else(|| refuse(self.func, "unerasing to an unrepresentable type"))?;
                if target != Kind::Double {
                    let opcode = match target {
                        Kind::Long => insn::D2L,
                        Kind::Float => insn::D2F,
                        _ => insn::D2I,
                    };
                    code.convert(origin, opcode, Kind::Double, target);
                }
                Ok(Placed::OnStack)
            }
            OpKind::Unerase { value } if self.unboxed.contains(value) => {
                // The reference is already the value; the narrowing the middle
                // end proved still has to be spelled for the verifier.
                self.load(code, pool, *value)?;
                self.refuse_impossible_cast(ty)?;
                if let Some(want) = types::descriptor(self.shape, ty) {
                    code.check_cast(origin, pool, &want);
                }
                Ok(Placed::OnStack)
            }
            OpKind::Unerase { value } => {
                self.load(code, pool, *value)?;
                match ty {
                    HirType::Bool => code.invoke_static(
                        origin,
                        pool,
                        types::VALUE,
                        "asBoolean",
                        "(Lnts/rt/NtsValue;)Z",
                    ),
                    HirType::Int { .. } | HirType::Float { .. } => {
                        code.get_field(origin, pool, types::VALUE, "num", "D");
                        let target = types::kind(ty)
                            .ok_or_else(|| refuse(self.func, "unerasing to an unrepresentable type"))?;
                        if target != Kind::Double {
                            let opcode = match target {
                                Kind::Long => insn::D2L,
                                Kind::Float => insn::D2F,
                                _ => insn::D2I,
                            };
                            code.convert(origin, opcode, Kind::Double, target);
                        }
                    }
                    HirType::Managed(_) => {
                        code.get_field(origin, pool, types::VALUE, "ref", "Ljava/lang/Object;");
                        let descriptor = types::descriptor(self.shape, ty).ok_or_else(|| {
                            refuse(self.func, "unerasing to an unrepresentable reference")
                        })?;
                        self.refuse_impossible_cast(ty)?;
                        // The verifier needs the narrowing spelled: the field is
                        // `Object`.
                        code.check_cast(origin, pool, &descriptor);
                    }
                    other => {
                        return Err(refuse(
                            self.func,
                            &format!("unerasing to {}", types::describe(other)),
                        ));
                    }
                }
                Ok(Placed::OnStack)
            }
            _ => Err(refuse(self.func, "an erasure this backend does not spell")),
        }
    }

    /// Putting a tag on a value.
    ///
    /// The payload is a `double` whatever the number was, which is what lets one
    /// erased value hold any of them -- so the widening happens here rather than
    /// being a second representation to keep in step with the first.
    fn erase(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        // The value this erasure defines, where it defines one. `None` at a
        // site that erases on the fly for an argument, which always needs the
        // box because nothing names the result to decide otherwise.
        result: Option<ValueId>,
        value: ValueId,
        // What a **null** operand means. This lane had `T | null` right by
        // construction -- `NtsValue.ofObject` answers `null` for a null
        // reference -- and `T | undefined` wrong for the same reason, which is
        // the opposite of the C lane's error. See `OpKind::Erase`.
        absent: nts_core::hir::Absent,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        let from = self.ty(value).clone();
        // A `Void` erases to `undefined` and has nothing to load.
        if matches!(from, HirType::Void) {
            code.get_static(origin, pool, types::VALUE, "UNDEFINED_VALUE", types::VALUE_DESCRIPTOR);
            return Ok(Placed::OnStack);
        }
        // A closure erases to `function`, not `object`. `hir::tags` already
        // says so -- `of_reference` answers `FUNCTION` for a synthetic closure
        // type -- and flattening every managed reference to `ofObject` threw
        // that away: `examples/absent` computed 42 where node computes 45,
        // because `typeof f === "function"` was false and `typeof f ===
        // "object"` was true for the same arrow.
        //
        // The tag goes on the stack *before* the value, because `ofTagged`
        // takes it first, which is why this is a branch here rather than one
        // more row in the table below.
        if let HirType::Managed(managed) = &from {
            let tag = nts_core::hir::tags::of_reference(managed);
            if tag != nts_core::hir::tags::OBJECT
                && !matches!(managed, ManagedType::String)
            {
                // A closure singleton erased is itself a constant: the tag is
                // `FUNCTION` and the reference is the one instance. Building it
                // per use allocated 1.6 MB/op on `optional-chain`, for a value
                // that could not change. `<clinit>` builds it once.
                if matches!(
                    self.func.values[value.0 as usize].kind,
                    nts_core::hir::OpKind::ClosureStatic
                ) && let HirType::Managed(ManagedType::Object(id)) = &from
                    && let Some(layout) = self.program.layout(*id)
                {
                    let field = crate::erased_field(&types::class_name(self.shape.package, layout));
                    code.get_static(
                        origin,
                        pool,
                        crate::PROGRAM,
                        &field,
                        types::VALUE_DESCRIPTOR,
                    );
                    return Ok(Placed::OnStack);
                }
                code.const_int(origin, pool, i32::try_from(tag).unwrap_or(0));
                self.load(code, pool, value)?;
                code.invoke_static(
                    origin,
                    pool,
                    types::VALUE,
                    "ofTagged",
                    "(ILjava/lang/Object;)Lnts/rt/NtsValue;",
                );
                return Ok(Placed::OnStack);
            }
        }
        // An erased value a bare reference can carry: the reference is the
        // value, and `ofObject` would only wrap it to be unwrapped again. See
        // `unbox`, and record 0108 for what the wrapper costs.
        if result.is_some_and(|it| self.unboxed.contains(&it)) {
            self.load(code, pool, value)?;
            return Ok(Placed::OnStack);
        }
        self.load(code, pool, value)?;
        let (name, signature) = match &from {
            HirType::Bool => ("ofBoolean", "(Z)Lnts/rt/NtsValue;"),
            HirType::Managed(ManagedType::String) => {
                ("ofString", "(Ljava/lang/String;)Lnts/rt/NtsValue;")
            }
            HirType::Managed(_) if absent == nts_core::hir::Absent::Undefined => {
                ("ofObjectOrUndefined", "(Ljava/lang/Object;)Lnts/rt/NtsValue;")
            }
            HirType::Managed(_) => ("ofObject", "(Ljava/lang/Object;)Lnts/rt/NtsValue;"),
            HirType::Int { .. } | HirType::Float { .. } => {
                let source = types::kind(&from)
                    .ok_or_else(|| refuse(self.func, "erasing an unrepresentable value"))?;
                if source != Kind::Double {
                    let opcode = match source {
                        Kind::Long => insn::L2D,
                        Kind::Float => insn::F2D,
                        _ => insn::I2D,
                    };
                    code.convert(origin, opcode, source, Kind::Double);
                }
                ("ofNumber", "(D)Lnts/rt/NtsValue;")
            }
            // Already erased, so this is identity: the value on the stack is
            // an `NtsValue` and wrapping it in another would be a second tag
            // over the first.
            //
            // The lowering emits it because `throw` in an `async` function
            // erases its reason on the way to `nts_promise_reject_value`, and
            // it does not ask first whether the reason was erased to begin
            // with -- `throw someUnknown` is. Refusing here made the first
            // program to write that line uncompilable on this lane, which is a
            // backend declining a shape the IR is entitled to produce.
            HirType::Erased => {
                return Ok(Placed::OnStack);
            }
            other => {
                return Err(refuse(self.func, &format!("erasing {}", types::describe(other))));
            }
        };
        code.invoke_static(origin, pool, types::VALUE, name, signature);
        Ok(Placed::OnStack)
    }

    /// Allocation, load and store on a bare JVM array.
    ///
    /// # `checked` cannot mean what it means in C
    ///
    /// The JVM bounds-checks every access whether or not the compiler proved
    /// the index in range, so `checked: false` is not a licence to skip
    /// anything -- there is nothing to skip. It means the range analysis found
    /// the same proof C2's range-check elimination will find in a counted loop,
    /// and the instruction is identical either way.
    ///
    /// `checked: true` is the one that needs care, and not for speed. An
    /// escaping `ArrayIndexOutOfBoundsException` would reach the differential as
    /// a Java stack trace with no `nts:` line, and `stopped()` classifies that
    /// as a **defect** -- so every case the C lane legitimately *declines* would
    /// be counted as a failure here. The runtime turns it into the same refusal
    /// the C lane prints.
    /// A growable-array read the middle end proved in range, as the storage
    /// access it is.
    ///
    /// The point is not the call, which C2 inlines either way. It is the test.
    /// `get` bounds by `a.length`, a mutable field, and a loop whose limit is
    /// reloaded every iteration is not a counted loop: no range-check
    /// elimination, no unrolling, no vectorisation, and no hoisting of
    /// `a.items` either. The same walk written nine ways puts this at 25% of
    /// `array-predicates` -- 137,478 instructions an operation against 104,001
    /// -- and hoisting the field by hand on top of it buys a further 2%, which
    /// is how the measurement separates the test from the load. C2 hoists the
    /// load itself once the test is gone.
    ///
    /// This is also what the C lane does: `index_expression` returns a bare
    /// `(uint32_t)index` for `checked: false`, with no `nts_check`. Reading a
    /// slot between the length and the capacity is a stale value on both lanes
    /// rather than a refusal on one of them.
    #[allow(clippy::too_many_arguments, reason = "the call site has all of it and computes none of it")]
    fn proved_growable_read(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        array: ValueId,
        index: ValueId,
        ty: &HirType,
        class: &str,
        element: &str,
        holds: Kind,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        self.load(code, pool, array)?;
        code.get_field(origin, pool, class, "items", &format!("[{element}"));
        self.subscript(code, pool, index, origin)?;
        code.array_load(origin, element);
        if holds != Kind::Ref {
            self.adapt(code, holds, ty, origin)?;
        }
        // `NtsArrayL` stores `Object`, so an array of strings hands back an
        // `Object` where the slot wants a `String` -- the same restoration the
        // helper path spells out for the same reason.
        if let Some(want) = types::descriptor(self.shape, ty)
            && want != element
            && types::kind(ty) == Some(Kind::Ref)
        {
            code.check_cast(origin, pool, &want);
        }
        Ok(Placed::OnStack)
    }

    /// A growable-array store the middle end proved in range, as the store it
    /// is.
    ///
    /// The counterpart of [`Self::proved_growable_read`], and it declines more
    /// than that one does: `set` tests the index against `a.length` and
    /// *grows* the array when it is past the end, so a proved index was paying
    /// for a check, a branch and a reallocation it could not reach.
    ///
    /// The same C lane, too. `index_expression` returns a bare
    /// `(uint32_t)index` for `checked: false` and `NTS_ITEMS(a)[slot] = v`
    /// stores through it, so the two lanes write the same slot or refuse the
    /// same program.
    #[allow(clippy::too_many_arguments, reason = "the call site has all of it and computes none of it")]
    fn proved_growable_store(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        array: ValueId,
        index: ValueId,
        value: ValueId,
        class: &str,
        element: &str,
        holds: Kind,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        self.load(code, pool, array)?;
        code.get_field(origin, pool, class, "items", &format!("[{element}"));
        self.subscript(code, pool, index, origin)?;
        if holds == Kind::Ref {
            self.load(code, pool, value)?;
        } else {
            self.push_as(code, pool, value, holds, origin)?;
        }
        code.array_store(origin, element);
        Ok(Placed::Stored)
    }

    fn array_operation(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        match kind {
            // A typed array. Its elements are bytes in a buffer something else
            // may also be looking at, so a subscript is a call on the element's
            // own class rather than an `aaload`.
            //
            // Eleven classes rather than one with a kind field, and the call is
            // monomorphic because of it: record 0182 measured 0.177 ns/element
            // through a class-specific accessor against 0.924 through one that
            // switches on a kind. The C header says the same thing from the
            // other side -- "ordinary indexed access is emitted inline by the
            // backends, because a call per element is not a price a typed array
            // can pay" -- and an `invokestatic` that inlines to a shift and a
            // load is that inlining, on this lane.
            //
            // Before the growable arms, and not after: `arrays_can_grow` is a
            // fact about *arrays*. A view cannot grow, its length comes from
            // the buffer it names, and a program that pushes somewhere must not
            // put its typed arrays behind a wrapper that has no storage to
            // wrap.
            OpKind::ArrayGet { array, .. } | OpKind::ArraySet { array, .. }
                if self.view_receiver(*array).is_some() =>
            {
                self.view_element(code, pool, kind, origin)
            }
            // The wrapper, where the program grows an array anywhere. Every
            // index is a `double` across this boundary, matching the C ABI:
            // that is how it passes a number the compiler knew all along, and
            // it saves a narrowing at each site.
            OpKind::ArrayNew { length, .. } if self.shape.grows => {
                let class = self.growable_class(ty)?;
                // By the length's own kind, for the reason `ArrayGet` picks its
                // subscript's: an `i64` length reached the `double` overload
                // through `d2l; l2d` so that `of` could narrow it back.
                let size = match self.kind_of(*length)? {
                    Kind::Int => Kind::Int,
                    Kind::Long => Kind::Long,
                    _ => Kind::Double,
                };
                self.push_as(code, pool, *length, size, origin)?;
                let n = match size {
                    Kind::Int => "I",
                    Kind::Long => "J",
                    _ => "D",
                };
                code.invoke_static(origin, pool, &class, "of", &format!("({n})L{class};"));
                Ok(Placed::OnStack)
            }
            OpKind::ArrayGet { array, index, checked } if self.shape.grows => {
                let class = self.growable_class(&self.ty(*array).clone())?;
                let (element, holds) = self.growable_element(&self.ty(*array).clone())?;
                if !*checked {
                    return self.proved_growable_read(
                        code, pool, *array, *index, ty, &class, &element, holds, origin,
                    );
                }
                self.load(code, pool, *array)?;
                // The subscript by its own kind, not widened to a `double`.
                //
                // This path always pushed a `double`, so an `i64` loop counter
                // became `lload; l2d` and the helper narrowed it straight back
                // with `(int) at`. `array-predicates` does that per element,
                // eight call sites of it. The bare-array subscript learned the
                // same lesson at `bounds` -- worth 4.56x there -- and the
                // growable wrapper was never given the overloads to learn it
                // with.
                // `I` or `D`, and no `J`. An `i64` subscript had an overload of
                // its own while `array.len` was an `i64` and every counter
                // bounded by one followed it -- record 0138, worth 4.56x when
                // the `double` form was the only way in. A length is an `i32`
                // now, so nothing in 109 examples or 50 bench cases reaches a
                // wide subscript, and one that did would take the `double` path
                // and answer identically: an array is at most `2^31 - 2` long,
                // so every `long` the rounding could disturb is one the bounds
                // check refuses anyway.
                let subscript =
                    if self.kind_of(*index)? == Kind::Int { Kind::Int } else { Kind::Double };
                self.push_as(code, pool, *index, subscript, origin)?;
                let at = if subscript == Kind::Int { "I" } else { "D" };
                code.invoke_static(
                    origin,
                    pool,
                    &class,
                    "get",
                    &format!("(L{class};{at}){element}"),
                );
                if holds != Kind::Ref {
                    self.adapt(code, holds, ty, origin)?;
                }
                // `NtsArrayL` stores `Object`, so an array of strings hands
                // back an `Object` and the slot wants a `String`. The narrowing
                // the middle end already proved has to be spelled for the
                // verifier, which knows only what the descriptor said -- the
                // same restoration the external-call path does.
                if let Some(want) = types::descriptor(self.shape, ty)
                    && want != element
                    && types::kind(ty) == Some(Kind::Ref)
                {
                    code.check_cast(origin, pool, &want);
                }
                Ok(Placed::OnStack)
            }
            OpKind::ArraySet { array, index, value, checked } if self.shape.grows => {
                let class = self.growable_class(&self.ty(*array).clone())?;
                let (element, holds) = self.growable_element(&self.ty(*array).clone())?;
                if !*checked {
                    return self.proved_growable_store(
                        code, pool, *array, *index, *value, &class, &element, holds, origin,
                    );
                }
                self.load(code, pool, *array)?;
                self.push_as(code, pool, *index, Kind::Double, origin)?;
                if holds == Kind::Ref {
                    self.load(code, pool, *value)?;
                } else {
                    self.push_as(code, pool, *value, holds, origin)?;
                }
                code.invoke_static(
                    origin,
                    pool,
                    &class,
                    "set",
                    &format!("(L{class};D{element})V"),
                );
                Ok(Placed::Stored)
            }
            OpKind::ArrayNew { length, .. } => {
                let element = self.element_descriptor(ty)?;
                self.subscript(code, pool, *length, origin)?;
                code.new_array(origin, pool, &element);
                Ok(Placed::OnStack)
            }
            OpKind::ArrayGet { array, index, checked } => {
                let element = self.element_descriptor(&self.ty(*array).clone())?;
                self.load(code, pool, *array)?;
                self.checked_subscript(code, pool, *index, *checked, origin)?;
                code.array_load(origin, &element);
                Ok(Placed::OnStack)
            }
            OpKind::ArraySet { array, index, value, checked } => {
                let element = self.element_descriptor(&self.ty(*array).clone())?;
                self.load(code, pool, *array)?;
                self.checked_subscript(code, pool, *index, *checked, origin)?;
                self.load(code, pool, *value)?;
                code.array_store(origin, &element);
                Ok(Placed::Stored)
            }
            _ => Err(refuse(self.func, "an array operation this backend does not spell")),
        }
    }

    /// One element of a typed array, read or written.
    ///
    /// Read and write in one method because they differ by two lines and agree
    /// on everything that is easy to get wrong: which class, which accessor,
    /// and what the subscript has to do first. Splitting them is how the
    /// growable array family ended up with two answers to "which wrapper", and
    /// that put `NtsArrayD.pop` where an `NtsValue` was wanted.
    fn view_element(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        let (array, index, value, checked) = match *kind {
            OpKind::ArrayGet { array, index, checked } => (array, index, None, checked),
            OpKind::ArraySet { array, index, value, checked } => {
                (array, index, Some(value), checked)
            }
            _ => return Err(refuse(self.func, "a view element operation that is neither")),
        };
        let (class, element) = self.view_receiver(array).expect("the arm tested this");
        let accessor = if value.is_some() { view_write(&element) } else { view_read(&element) };
        let Some((member, spelled)) = accessor else {
            return Err(refuse(
                self.func,
                "a typed array whose element this backend has no accessor for",
            ));
        };
        self.load(code, pool, array)?;
        self.view_subscript(code, pool, index, checked, origin)?;
        let Some(value) = value else {
            code.invoke_static(origin, pool, &class, member, &format!("(L{class};I){spelled}"));
            return Ok(Placed::OnStack);
        };
        // The value in the element's own representation, not in a `double`: the
        // middle end has already put it there -- `coerce_element` is what makes
        // `u8[i] = 300` store 44 -- and widening it here only to have the
        // runtime narrow it back is the round trip `getInt` exists to avoid on
        // the way out.
        self.load(code, pool, value)?;
        code.invoke_static(origin, pool, &class, member, &format!("(L{class};I{spelled})V"));
        Ok(Placed::Stored)
    }

    /// The class and element of a value that is a typed array, or `None`.
    fn view_receiver(&self, value: ValueId) -> Option<(String, HirType)> {
        match self.ty(value) {
            HirType::Managed(ManagedType::View(element)) => {
                types::view_class(element).map(|class| (class.to_owned(), (**element).clone()))
            }
            _ => None,
        }
    }

    /// An index for a typed array.
    ///
    /// The element accessor checks the range itself and refuses with the prefix
    /// the harness reads, so an integral index needs nothing here -- and
    /// `hir::specialize` turns a loop counter into an `i32`, which is the path
    /// that matters and the one that then pays for exactly one check.
    ///
    /// A `double` index can be **fractional**, which no range check catches:
    /// `xs[0.5]` is `undefined` in JavaScript and `xs[0]` after a `d2i`. That
    /// goes through `bounds`, the same helper the bare-array path uses, with
    /// the view's element count in place of `arraylength`. The accessor then
    /// checks again, which is a redundant compare on the path that was already
    /// the slow one.
    fn view_subscript(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        index: ValueId,
        checked: bool,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        if !checked || self.kind_of(index)? == Kind::Int {
            return self.subscript(code, pool, index, origin);
        }
        code.dup(origin);
        code.invoke_static(
            origin,
            pool,
            types::VIEW_BASE,
            "elements",
            &format!("(L{};)I", types::VIEW_BASE),
        );
        self.push_as(code, pool, index, Kind::Double, origin)?;
        code.invoke_static(origin, pool, RUNTIME, "bounds", "(ID)I");
        Ok(())
    }

    /// An index for a bare array, checked where the IR says it must be.
    ///
    /// `checked: false` means the middle end proved it in range, and the JVM's
    /// own bounds check is then the only one -- mandatory, and eliminated in a
    /// counted loop, which is where this lane is cheaper than the native one.
    ///
    /// `checked: true` means the program said `!` and the compiler did not
    /// believe it. The JVM's check would raise an
    /// `ArrayIndexOutOfBoundsException`, which is a *defect* to the harness
    /// rather than a refusal, and it would not fire at all for a **fractional**
    /// index -- `xs[0.5]` is `undefined` in JavaScript and `xs[0]` after a
    /// `d2i`. So both tests go through the runtime, which refuses with the
    /// prefix the harness reads.
    fn checked_subscript(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        index: ValueId,
        checked: bool,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        if !checked {
            return self.subscript(code, pool, index, origin);
        }
        // An index the middle end already keeps in an integer cannot be
        // fractional, so only the range is in question and the check is two
        // `int` compares -- which is what the JVM's own bounds check does, so
        // C2 folds them together in a counted loop.
        //
        // Routing this through the `double` form instead cost a widening, two
        // floating compares, a `Math.floor` and a narrowing per element, in
        // loops that previously emitted nothing at all.
        // An `i64` index is exactly as unable to be fractional as an `i32`, and
        // testing only for `Int` sent it through the `double` form: an `l2d`,
        // two floating compares and a whole-number test provably true of a
        // long, per element. `awfy-nbody` indexes with an `i64`, which is why
        // it sat at 39.28ms against hand-written Java's 7.97ms *after* the
        // integral path was built -- the fix existed and did not cover it.
        let kind = self.kind_of(index)?;
        let integral = kind == Kind::Int;
        // The array is already on the stack, so `dup` it for the length rather
        // than loading it again -- which is why `bounds` takes the length
        // first. The reloaded version emitted `aload 11; aload 11; arraylength`
        // per access.
        code.dup(origin);
        code.array_length(origin);
        self.push_as(code, pool, index, if integral { kind } else { Kind::Double }, origin)?;
        // The length stays an `int` in both forms: widening it only to compare
        // against a double costs an instruction per access and buys nothing --
        // `index < length` promotes the `int` for free.
        let descriptor = if integral { "(II)I" } else { "(ID)I" };
        code.invoke_static(origin, pool, RUNTIME, "bounds", descriptor);
        Ok(())
    }

    /// An index or a length, as the `int` the JVM's array instructions want.
    ///
    /// A JavaScript length is a double until something narrows it, so this
    /// emitted `d2i` unconditionally -- and that was wrong for the case the
    /// backend most wants to be good at. Specialization turns a loop counter
    /// into an `i32`, so `for (let i = 0; ...) v[i] = x` reaches here with an
    /// index already in an int slot; `d2i` then popped two words where the load
    /// had pushed one, and the operand stack went one short per subscript. The
    /// symptom was an underflow reported hundreds of bytes later, at whichever
    /// instruction finally ran out -- and only in loops, because a constant
    /// index stays a double.
    ///
    /// So the conversion comes from the value's own kind. That is the rule the
    /// coercions already keep and the one this backend keeps getting wrong in
    /// the same direction: **the slot the middle end chose is the slot**, and
    /// an emitter that assumes a representation instead of reading it is
    /// writing down a second answer to a question HIR already answered.
    fn subscript(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        self.push_as(code, pool, value, Kind::Int, origin)
    }

    /// Load a value and put it in the representation the *instruction* wants.
    ///
    /// The counterpart of [`Self::adapt`], and the two exist because there are
    /// two boundaries and this backend got both of them wrong by assuming. What
    /// a JVM instruction takes and what the middle end chose to keep a value in
    /// are separate facts, and neither is derivable from the other -- so every
    /// crossing reads both ends rather than one.
    fn push_as(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        wanted: Kind,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        self.load(code, pool, value)?;
        let have = self.kind_of(value)?;
        convert_kind(code, origin, have, wanted)
            .ok_or_else(|| refuse(self.func, &format!("a {have:?} where a {wanted:?} is needed")))
    }

    /// Adapt what an instruction *produced* to the representation the middle
    /// end chose for the value it defines.
    ///
    /// `arraylength` is an `int`, `String.length()` is an `int`, `charAt` is a
    /// `char`, and the tag field is an `int` -- and every one of those lands in
    /// whatever slot the middle end picked, which specialization makes an
    /// `i32`, an `i64` or an `f64` depending on the program. Three of these
    /// sites widened to `double` unconditionally, because a JavaScript length
    /// *is* a double until something narrows it, and something narrows it.
    ///
    /// The symptom is a `VerifyError` at the store, hundreds of bytes from the
    /// operation, naming a frame with a hundred and seventy locals in it.
    /// Convert what an instruction produced into what this value is *held* in.
    ///
    /// [`Self::adapt`] answers from the declared type, which is right wherever
    /// the two agree and wrong wherever this backend chose otherwise. A
    /// narrowed `array.len` is the case: `arraylength` produces an `int`, the
    /// declared type is `i64`, and the slot is an `int` -- so adapting to the
    /// declaration emits an `i2l` for a slot that wanted neither.
    fn adapt_to(
        &self,
        code: &mut Code,
        produced: Kind,
        value: ValueId,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let want = self.kind_of(value)?;
        convert_kind(code, origin, produced, want).ok_or_else(|| {
            refuse(self.func, &format!("a {produced:?} result in a {want:?} slot"))
        })
    }

    fn adapt(
        &self,
        code: &mut Code,
        produced: Kind,
        wanted: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let want = types::kind(wanted)
            .ok_or_else(|| refuse(self.func, "a result of unrepresentable type"))?;
        convert_kind(code, origin, produced, want).ok_or_else(|| {
            refuse(self.func, &format!("a {produced:?} result in a {want:?} slot"))
        })
    }

    /// The descriptor of what an array holds.
    fn element_descriptor(&self, ty: &HirType) -> Result<String, Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = ty else {
            return Err(refuse(self.func, "an array operation on something that is not an array"));
        };
        types::descriptor(self.shape, element)
            .ok_or_else(|| refuse(self.func, &format!("an array of {}", types::describe(element))))
    }

    /// The operations `java.lang.String` already is.
    ///
    /// Lifted out of `operation` because it went past a hundred lines, which in
    /// this repository has a habit of finding a real duplication rather than
    /// merely a long function. Here it found that all three arms want the
    /// string on the stack first and nothing else in common.
    /// How long a thing is, by what kind of thing it is.
    ///
    /// Five storages answer this and no two answer it the same way: a string
    /// has a method, a map has a size, a bare array has an instruction, a
    /// growable array has a field behind a helper, and a view computes it --
    /// its own count, which for a tracking view follows the buffer through a
    /// resize.
    ///
    /// Lifted out of `string_operation` when the view arm took it past a
    /// hundred lines. That function's own doc says the limit "has a habit of
    /// finding a real duplication rather than merely a long function", and here
    /// it found that these six arms have nothing to do with strings at all
    /// beyond having been written next to one.
    fn length_of(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        kind: &OpKind,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        match kind {
            OpKind::Length(of) if matches!(self.ty(*of), HirType::Managed(ManagedType::String)) => {
                self.load(code, pool, *of)?;
                code.invoke_virtual(origin, pool, types::STRING, "length", "()I");
                self.adapt_to(code, Kind::Int, value, origin)?;
                Ok(Placed::OnStack)
            }
            // `map.size` and `set.size` are the same operation on the same
            // class, and neither is an `arraylength` -- which is what every
            // non-string `Length` used to become, silently, until the verifier
            // said "invalid type NtsMap".
            OpKind::Length(of)
                if matches!(
                    self.ty(*of),
                    HirType::Managed(
                        ManagedType::Map(..) | ManagedType::Table(..) | ManagedType::Set(_),
                    )
                ) =>
            {
                self.load(code, pool, *of)?;
                code.invoke_static(origin, pool, types::TABLE, "size", "(Lnts/rt/NtsTable;)D");
                self.adapt_to(code, Kind::Double, value, origin)?;
                Ok(Placed::OnStack)
            }
            OpKind::Length(of)
                if self.shape.grows
                    && matches!(self.ty(*of), HirType::Managed(ManagedType::Array(_))) =>
            {
                let class = self.growable_class(&self.ty(*of).clone())?;
                self.load(code, pool, *of)?;
                // By what the length is *wanted* as. The field is an `int` and
                // `array.len` is an `i32` upstream now, so reaching it through
                // a `double`-returning helper emitted `i2d` inside and `d2i`
                // outside -- `array-predicates` does that five times a
                // specialization. The subscript and the constructor were given
                // integral overloads for the same round trip; this is the
                // third place it occurs and the last one that had none.
                let integral = matches!(self.kind_of(value)?, Kind::Int | Kind::Long);
                let (member, produced) =
                    if integral { ("count", Kind::Int) } else { ("length", Kind::Double) };
                let returns = if integral { "I" } else { "D" };
                code.invoke_static(origin, pool, &class, member, &format!("(L{class};){returns}"));
                self.adapt_to(code, produced, value, origin)?;
                Ok(Placed::OnStack)
            }
            // A view's length is not its buffer's and is not an
            // `arraylength`: a window onto part of a buffer has its own count,
            // and a *tracking* view's follows the buffer through a resize, so
            // it is computed rather than stored.
            //
            // Two members for the same reason the growable array has two:
            // `elements` answers an `int` and `length` a `double`, and reaching
            // the wrong one costs an `i2d` inside and a `d2i` outside at every
            // use. `hir::specialize` makes a loop bound integral, which is
            // exactly where a length is read most.
            OpKind::Length(of)
                if matches!(self.ty(*of), HirType::Managed(ManagedType::View(_))) =>
            {
                self.load(code, pool, *of)?;
                let integral = matches!(self.kind_of(value)?, Kind::Int | Kind::Long);
                let (member, produced, returns) = if integral {
                    ("elements", Kind::Int, "I")
                } else {
                    ("length", Kind::Double, "D")
                };
                code.invoke_static(
                    origin,
                    pool,
                    types::VIEW_BASE,
                    member,
                    &format!("(L{};){returns}", types::VIEW_BASE),
                );
                self.adapt_to(code, produced, value, origin)?;
                Ok(Placed::OnStack)
            }
            OpKind::Length(of) if matches!(self.ty(*of), HirType::Managed(ManagedType::Array(_))) => {
                self.load(code, pool, *of)?;
                code.array_length(origin);
                self.adapt_to(code, Kind::Int, value, origin)?;
                Ok(Placed::OnStack)
            }
            // Anything else has no length this backend knows how to take, and
            // saying so beats reaching for the array instruction.
            OpKind::Length(of) => Err(refuse(
                self.func,
                &format!("the length of {}", types::describe(&self.ty(*of).clone())),
            )),
            _ => Err(refuse(self.func, "a length operation that is not one")),
        }
    }

    fn string_operation(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        kind: &OpKind,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        match kind {
            // A literal is a constant pool entry, deduplicated by the pool and
            // free at the use -- better than the C backend, which emits a
            // static per literal and takes its address.
            OpKind::ConstString(text) => {
                if nts_jvm_emitter::Pool::utf8_length(text) > 65_535 {
                    return Err(refuse(self.func, "a string literal past the 65,535-byte constant limit"));
                }
                // The seed of a string accumulator. A `ConstString` is not
                // rematerialised -- it has a slot like any other value -- so
                // this is where the builder is constructed, and constructing it
                // *from* the seed rather than appending the seed afterwards
                // keeps the empty case, which is every case this has seen, to a
                // bare `new`.
                if self.accumulated.contains(&value) {
                    code.new_object(origin, pool, crate::builder::BUILDER);
                    code.dup(origin);
                    if text.is_empty() {
                        // **A capacity was priced here and refused.** Java's
                        // default is 16 and an accumulator that ends up long
                        // regrows several times; `new StringBuilder(128)` takes
                        // `node-utf8` from 98,472 bytes an operation to 79,528,
                        // a 19% cut, and moves no other row at all --
                        // `case-convert`, `number-format`, `json-serialize` and
                        // `substrings` are unchanged to the byte.
                        //
                        // It is not taken, because 128 is not a compiler's
                        // number: that case decodes to about 110 characters, and
                        // 512 makes the same row **worse** than the default at
                        // 153,256. A constant that helps exactly one row and
                        // was chosen by knowing that row's string length is
                        // fitted to the benchmark rather than derived from the
                        // program.
                        //
                        // What would justify one is a *bound*. The seed already
                        // supplies it when there is one -- a non-empty seed
                        // constructs from the string and Java sizes to
                        // `length + 16`. An accumulator with no seed has no
                        // hint here, and the place a hint could come from is
                        // the middle end knowing what the accumulator is built
                        // out of. If that ever exists, this is worth 19% of
                        // `node-utf8`'s allocation.
                        code.invoke_special(origin, pool, crate::builder::BUILDER, "<init>", "()V");
                    } else {
                        code.const_string(origin, pool, text);
                        code.invoke_special(
                            origin,
                            pool,
                            crate::builder::BUILDER,
                            "<init>",
                            "(Ljava/lang/String;)V",
                        );
                    }
                    return Ok(Placed::OnStack);
                }
                code.const_string(origin, pool, text);
                Ok(Placed::OnStack)
            }
            // `String.length()` is an `int`; the middle end types a length as a
            // double, having been told once that it is a `uint32_t` and worth
            // 4.0x to say so. The widening is explicit here for the same reason
            // the coercion's is: the slot the middle end chose is the slot.
            OpKind::Length(_) => self.length_of(code, pool, value, kind, origin),
            // Out of range JavaScript answers `NaN` where `charAt` throws, and a
            // fractional index truncates rather than being an error. Where the
            // compiler proved the index in range neither applies, so `charAt`
            // is called directly and the helper is not in the program.
            OpKind::StringUnitAt { string, index, checked } => {
                self.load(code, pool, *string)?;
                if *checked {
                    self.push_as(code, pool, *index, Kind::Double, origin)?;
                    code.invoke_static(origin, pool, RUNTIME, "charCodeAt", "(Ljava/lang/String;D)D");
                    self.adapt(code, Kind::Double, ty, origin)?;
                } else {
                    self.push_as(code, pool, *index, Kind::Int, origin)?;
                    code.invoke_virtual(origin, pool, types::STRING, "charAt", "(I)C");
                    self.adapt(code, Kind::Int, ty, origin)?;
                }
                Ok(Placed::OnStack)
            }

            _ => Err(refuse(self.func, "a string operation this backend does not spell")),
        }
    }

    /// A literal, in whichever width the middle end gave it.
    pub(crate) fn constant(
        &self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        match kind {
            OpKind::ConstBool(flag) => code.const_int(origin, pool, i32::from(*flag)),
            OpKind::ConstInt(number) if matches!(ty, HirType::BigInt) => {
                // The two halves, and the cast is the *point*: a 128-bit
                // literal is exactly a pair of `long`s in two's complement, and
                // truncating to the low 64 bits is how you get the low half.
                #[allow(
                    clippy::cast_possible_truncation,
                    reason = "the two halves of a 128-bit value are its low and high 64 bits"
                )]
                let (hi, lo) = ((*number >> 64) as i64, *number as i64);
                code.const_long(origin, pool, hi);
                code.const_long(origin, pool, lo);
                code.invoke_static(origin, pool, types::BIGINT, "of", "(JJ)Lnts/rt/NtsBigInt;");
            }
            OpKind::ConstInt(number) => match types::kind(ty) {
                Some(Kind::Long) => {
                    let Ok(narrow) = i64::try_from(*number) else {
                        return Err(refuse(self.func, "an integer literal wider than 64 bits"));
                    };
                    code.const_long(origin, pool, narrow);
                }
                Some(Kind::Int) => {
                    let Ok(narrow) = i32::try_from(*number) else {
                        return Err(refuse(self.func, "an integer literal wider than its slot"));
                    };
                    code.const_int(origin, pool, narrow);
                }
                _ => return Err(refuse(self.func, "an integer literal of unrepresentable type")),
            },
            OpKind::ConstFloat(number) => {
                if matches!(ty, HirType::Float { bits: 32 }) {
                    #[allow(
                        clippy::cast_possible_truncation,
                        reason = "the lowering typed this value `f32`, so it is one"
                    )]
                    code.const_float(origin, pool, *number as f32);
                } else {
                    code.const_double(origin, pool, *number);
                }
            }
            _ => return Err(refuse(self.func, "a literal this backend does not spell")),
        }
        Ok(Placed::OnStack)
    }

    /// The class a value of this type is an instance of.
    fn object_class(&self, ty: &HirType) -> Result<String, Diagnostic> {
        let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = ty else {
            return Err(refuse(self.func, "an object operation on something that is not one"));
        };
        let Some(layout) = self.program.layout(*id) else {
            return Err(refuse(self.func, "an object whose layout this program does not carry"));
        };
        // **The class this type *is*, which is not always the layout's.** Two
        // classes with identical fields share a layout on purpose, so the
        // layout's class cannot tell them apart -- `new B() instanceof A`
        // answered true where node says false. Where a layout is shared, each
        // class has an empty subclass and this is the one `new` allocates and
        // `instanceof` tests. A parameter or field keeps the base, which is
        // what leaves `readA(new B())` passing.
        Ok(crate::hierarchy::identity_of(self.program, *id)
            .map_or_else(|| types::class_name(self.shape.package, layout), |class| {
                types::identity_class_name(self.shape.package, layout, class)
            }))
    }

    /// The owning class, member name and descriptor of one field.
    ///
    /// Read from the *object's* layout by index, because `FieldSet`/`FieldGet`
    /// carry a position rather than a name -- the position `codegen_common`'s
    /// layout decided, so that no two backends can disagree about which field
    /// is which.
    /// The class, member name and descriptor an access names -- **and the type
    /// the layout declares**, because a store into a field is an assignment to
    /// that type and the descriptor has already lost what it needs to be
    /// checked against. Two classes can spell one descriptor, and `Object(id)`
    /// against `Object(id)` is the question `assignable_types` asks.
    ///
    /// Returned from here rather than looked up again beside the call: the
    /// layout walk is the same walk, and this file has been bitten before by
    /// two implementations of one question drifting apart.
    fn field_ref(
        &self,
        object: ValueId,
        field: u32,
    ) -> Result<(String, String, String, HirType), Diagnostic> {
        let ty = self.ty(object).clone();
        let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = ty else {
            return Err(refuse(self.func, "a field of something that is not an object"));
        };
        let resolved = self.field_ref_of(id, field)?;
        // **A bound class has no fields of ours, and this is where that stops
        // being true.** A foreign layout is deliberately field-less -- the
        // binding surfaces its members through the table rather than as our
        // field ops -- but a `hits: number` in the `.d.ts` still becomes a
        // layout field, and its descriptor is then *our* `D` rather than the
        // `I` the jar declared. `getfield com/example/Catalog.hits:D` against
        // a class whose field is `int` is `NoSuchFieldError` at run time, with
        // nothing said at compile time.
        //
        // Refused by name here. The fix is upstream and is the same one the
        // arrays want: the member's type should come from the binding row,
        // which carries `com/example/Catalog.hits:I`, rather than from the
        // TypeScript the declaration was rendered as.
        Ok(resolved)
    }

    /// The same, for a type named directly rather than carried by a value.
    ///
    /// `SharedFieldGet` names its arms as `TypeId`s, and each arm's access is
    /// resolved against that arm's own layout -- the field's *name* is per-arm
    /// even where the precondition makes them equal, which is why the op
    /// carries the index and not a name.
    fn field_ref_of(
        &self,
        id: nts_semantic_schema::TypeId,
        field: u32,
    ) -> Result<(String, String, String, HirType), Diagnostic> {
        let Some(layout) = self.program.layout(id) else {
            return Err(refuse(self.func, "a field of an object with no layout"));
        };
        let Some(entry) = layout.fields.get(field as usize) else {
            return Err(refuse(self.func, "a field this object's layout does not have"));
        };
        // Named on the class that *declares* it. A derived class does not
        // redeclare its base's fields, so `getfield nts/gen/Square.x` where `x`
        // came from `Shape` is a `NoSuchFieldError` at link time rather than
        // anything the verifier catches.
        let owner = crate::hierarchy::declares_field(self.program, layout, field as usize);
        // **Asked of the layout that *declares* the field, not the one the
        // receiver has.** `panel.right` reads a field of `com/example/ui/View`
        // through a `nts/gen/Panel`, and testing the receiver said "ours" -- so
        // the width stayed the `double` the declaration was rendered as and
        // the jar says `D`... or does not have the field at all.
        // `NoSuchFieldError` at run time, with nothing said at compile time.
        //
        // And the layout's own name, not `class_name`'s: that gives
        // `nts/gen/Point` for a class of ours, which contains a `/` and so
        // answered "foreign" for every class in the program.
        if nts_core::hir::runtime::is_foreign_layout_name(&owner.name) {
            let prefix = format!("{}.{}:", owner.name, entry.name);
            let Some(row) = self.program.foreign.keys().find(|key| key.starts_with(&prefix)) else {
                return Err(refuse(
                    self.func,
                    &format!(
                        "the field `{}` of the bound class `{}`, which has no binding row",
                        entry.name, owner.name
                    ),
                ));
            };
            let Some((_, descriptor)) = row.split_once(':') else {
                return Err(refuse(self.func, &format!("a malformed binding row `{row}`")));
            };
            return Ok((
                owner.name.clone(),
                entry.name.clone(),
                descriptor.to_owned(),
                entry.ty.clone(),
            ));
        }
        // A field this backend holds as a `double`; see `widen`. Keyed by the
        // *declaring* class and the field's name, which is the one identity the
        // declaration in `object_class` and this access can both compute.
        let held = if self.widened_fields.contains(&(types::class_name(self.shape.package, owner), entry.name.clone())) {
            HirType::Float { bits: 64 }
        } else {
            entry.ty.clone()
        };
        let Some(descriptor) = types::descriptor(self.shape, &held) else {
            return Err(refuse(
                self.func,
                &format!("a field of unrepresentable type: {}", types::describe(&entry.ty)),
            ));
        };
        Ok((
            types::class_name(self.shape.package, owner),
            crate::body::method_name(&entry.name),
            descriptor,
            held,
        ))
    }

    /// The binary operations whose operands are references, which is every one
    /// where the JVM's own instruction would compare or concatenate the wrong
    /// thing. `None` means this is ordinary scalar arithmetic.
    ///
    /// `===` on two strings compares by value, so it is a helper call and never
    /// `if_acmpeq`. Getting that wrong is silent wherever two equal strings
    /// happen to be one constant-pool entry, which is most of a test suite --
    /// record 0044 found exactly that in the LLVM backend.
    fn reference_binary(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<Option<Placed>, Diagnostic> {
        // A bigint is a reference on this backend, so every operation on one
        // is a call rather than an instruction. `hir::verify` has already
        // checked that both sides are bigints.
        if matches!(self.ty(lhs), HirType::BigInt) {
            let Some((name, signature)) = bigint_operation(op) else {
                return Err(refuse(
                    self.func,
                    &format!("a `{op:?}` between two bigints, which has no 128-bit form here"),
                ));
            };
            let origin = self.func.values[lhs.0 as usize].origin.clone();
            self.load(code, pool, lhs)?;
            self.load(code, pool, rhs)?;
            code.invoke_static(&origin, pool, types::BIGINT, name, signature);
            if op == BinOp::Ne {
                code.const_int(&origin, pool, 1);
                code.bitwise(&origin, insn::XOR, Kind::Int);
            }
            return Ok(Some(Placed::OnStack));
        }
        let equality = matches!(op, BinOp::Eq | BinOp::Ne);
        let (owner, name, signature) = match self.ty(lhs) {
            HirType::Managed(ManagedType::String) if equality => (
                RUNTIME,
                "stringEq",
                "(Ljava/lang/String;Ljava/lang/String;)Z",
            ),
            _ if equality
                && (*self.ty(lhs) == HirType::Erased || *self.ty(rhs) == HirType::Erased) =>
            {
                let origin = self.func.values[lhs.0 as usize].origin.clone();
                self.push_erased(code, pool, lhs, &origin)?;
                self.push_erased(code, pool, rhs, &origin)?;
                code.invoke_static(
                    &origin,
                    pool,
                    types::VALUE,
                    "strictEq",
                    "(Lnts/rt/NtsValue;Lnts/rt/NtsValue;)Z",
                );
                if op == BinOp::Ne {
                    code.const_int(&origin, pool, 1);
                    code.bitwise(&origin, insn::XOR, Kind::Int);
                }
                return Ok(Some(Placed::OnStack));
            }
            _ if op == BinOp::Concat => {
                let origin = self.func.values[lhs.0 as usize].origin.clone();
                // An accumulator is already a builder, and `append` returns the
                // same builder -- so the result of the concatenation is the
                // receiver and the store that follows writes the reference back
                // to its own slot. See `builder` for what makes that invisible.
                if self.accumulated.contains(&lhs) {
                    // `out += String.fromCharCode(c)` builds a one-character
                    // string, appends it, and drops it. Where nothing else
                    // reads that string it is the whole cost of the append: on
                    // `node-utf8` about a hundred allocations a decode, which
                    // is most of what the builder had not already removed.
                    //
                    // `appendCharCode` rather than a cast emitted here, so the
                    // coercion has one spelling; see its note in `NtsRuntime`.
                    if self.char_codes.contains(&rhs)
                        && let OpKind::Call { args, .. } =
                            &self.func.values[rhs.0 as usize].kind
                        && let [unit] = args.as_slice()
                    {
                        let unit = *unit;
                        self.load(code, pool, lhs)?;
                        self.push_as(code, pool, unit, Kind::Double, &origin)?;
                        code.invoke_static(
                            &origin,
                            pool,
                            RUNTIME,
                            "appendCharCode",
                            "(Ljava/lang/StringBuilder;D)Ljava/lang/StringBuilder;",
                        );
                        return Ok(Some(Placed::OnStack));
                    }
                    self.load(code, pool, lhs)?;
                    self.load(code, pool, rhs)?;
                    code.invoke_virtual(
                        &origin,
                        pool,
                        crate::builder::BUILDER,
                        "append",
                        "(Ljava/lang/String;)Ljava/lang/StringBuilder;",
                    );
                    return Ok(Some(Placed::OnStack));
                }
                self.load(code, pool, lhs)?;
                self.load(code, pool, rhs)?;
                code.invoke_virtual(
                    &origin,
                    pool,
                    types::STRING,
                    "concat",
                    "(Ljava/lang/String;)Ljava/lang/String;",
                );
                return Ok(Some(Placed::OnStack));
            }
            _ => return Ok(None),
        };
        let origin = self.func.values[lhs.0 as usize].origin.clone();
        self.load(code, pool, lhs)?;
        self.load(code, pool, rhs)?;
        code.invoke_static(&origin, pool, owner, name, signature);
        if op == BinOp::Ne {
            code.const_int(&origin, pool, 1);
            code.bitwise(&origin, insn::XOR, Kind::Int);
        }
        Ok(Some(Placed::OnStack))
    }

    /// A comparison whose result is a value rather than a branch: 0 or 1
    /// through the scratch slot, so the operand stack is empty at both labels
    /// and the frame stays the universal one.
    fn materialize_comparison(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        compare: Compare,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<Placed, Diagnostic> {
        let origin = self.func.origin.clone();
        let Some(scratch) = self.scratch else {
            return Err(refuse(self.func, "a comparison with no scratch slot"));
        };
        let taken = code.label();
        let done = code.label();
        self.compare_and_branch(code, pool, Test { compare, negate: false, lhs, rhs }, taken)?;
        code.const_int(&origin, pool, 0);
        code.store(&origin, Kind::Int, scratch);
        code.goto(&origin, done);
        code.bind(taken);
        code.const_int(&origin, pool, 1);
        code.store(&origin, Kind::Int, scratch);
        code.bind(done);
        code.load(&origin, Kind::Int, scratch);
        Ok(Placed::OnStack)
    }

    /// A value on the stack, replaced by JavaScript's truthiness of it.
    ///
    /// **A conversion to `Bool` is not a width change**, and treating it as one
    /// is how `!groups.length` came out wrong: the table below maps
    /// `(Int, Int)` to no opcode, so `convert i32 -> bool` left the length `2`
    /// on the stack, and `not` -- which is `ixor 1` -- turned it into `3`
    /// rather than `0`. Every later test then read `3` as true *and* as not
    /// false. A boolean here has to be canonically 0 or 1.
    ///
    /// That was a pre-existing defect with no case to expose it: any function
    /// reaching it also converted a managed value to a boolean, which this
    /// backend refused outright, so the whole function was declined before the
    /// integer conversion could answer wrongly. Fixing the refusal is what made
    /// it reachable.
    fn materialize_truth(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        from: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let Some(scratch) = self.scratch else {
            return Err(refuse(self.func, "a truthiness test with no scratch slot"));
        };
        let truthy = code.label();
        let done = code.label();
        match from {
            // A string's truthiness is `length != 0`, which is a different test
            // from every other reference's, and nothing has produced one here.
            HirType::Managed(ManagedType::String) => {
                return Err(refuse(self.func, "a string used as a boolean"));
            }
            // Only `null` and `undefined` are falsy among references: an empty
            // array is truthy, and so is every object.
            HirType::Managed(_) => code.branch_present(origin, true, truthy),
            HirType::Int { bits: 64, .. } => {
                code.const_long(origin, pool, 0);
                code.compare(origin, insn::LCMP, Kind::Long);
                code.branch_zero(origin, Compare::Ne, truthy);
            }
            HirType::Int { .. } => code.branch_zero(origin, Compare::Ne, truthy),
            // `0`, `-0` and `NaN` are the falsy numbers. `dcmpl` answers `-1`
            // for a NaN on either side, so a bare `!= 0` would call it truthy;
            // `branch_float` is the entry point that pairs the comparison with
            // the branch that answers `false` for one.
            HirType::Float { .. } => {
                let kind = types::kind(from)
                    .ok_or_else(|| refuse(self.func, "a float with no kind"))?;
                if kind == Kind::Float {
                    code.const_float(origin, pool, 0.0);
                } else {
                    code.const_double(origin, pool, 0.0);
                }
                code.branch_float(origin, Compare::Ne, kind, truthy);
            }
            _ => return Err(refuse(self.func, "a value this backend cannot test for truth")),
        }
        code.const_int(origin, pool, 0);
        code.store(origin, Kind::Int, scratch);
        code.goto(origin, done);
        code.bind(truthy);
        code.const_int(origin, pool, 1);
        code.store(origin, Kind::Int, scratch);
        code.bind(done);
        code.load(origin, Kind::Int, scratch);
        Ok(())
    }

    /// A `Convert`, which a widened operand makes into nothing at all.
    ///
    /// This is the instruction `widen` exists to delete: an `i32` held in a
    /// `double` slot is already the double the result wants, so there is
    /// nothing to widen. `generator`'s inner loop had two of these and they
    /// were the whole of its 3.41x.
    fn conversion(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        operand: ValueId,
        result: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        self.load(code, pool, operand)?;
        if self.widened.contains(&operand) && self.kind_of(value)? == Kind::Double {
            return Ok(Placed::OnStack);
        }
        // The same identity on the other side: an `f64` narrowed to an `i32`
        // that `widen` decided to hold in a `double` slot is already in it, so
        // the `d2i` this would emit is the one widening exists to remove.
        if self.widened.contains(&value)
            && types::kind(&self.ty(operand).clone()) == Some(Kind::Double)
        {
            return Ok(Placed::OnStack);
        }
        // A helper answer held as an `int`; see `intcall`. The conversion has
        // to start from what the value *is* rather than from what its signature
        // says, or the emitter pushes an `int` and pops a `double` -- which is
        // not a wrong number but a stack that stops balancing, caught by
        // `Code`'s own accounting at the operation rather than a block later.
        let from = if self.narrowed.contains(&operand) {
            HirType::Int { bits: 32, signed: true }
        } else {
            self.ty(operand).clone()
        };
        // And the same on the way out, for the same reason. An intermediate
        // `i64` that `intcall` holds as an `int` is asked for as one here, or
        // this emits the `i2l` that marking it exists to remove -- and then
        // stores a long into a slot the frame says is an int.
        let to = if self.narrowed.contains(&value) {
            HirType::Int { bits: 32, signed: true }
        } else {
            result.clone()
        };
        self.convert(code, pool, &from, &to, origin)?;
        Ok(Placed::OnStack)
    }

    fn binary(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<Placed, Diagnostic> {
        let origin = self.func.origin.clone();
        if let Some(placed) = self.reference_binary(code, pool, op, lhs, rhs)? {
            return Ok(placed);
        }
        if let Some(compare) = comparison(op) {
            return self.materialize_comparison(code, pool, compare, lhs, rhs);
        }

        // From `kind_of`, not from the type: a widened `i32` is a `double`
        // here, and reading the HIR type would emit `iadd` against two operands
        // the loader just pushed as doubles.
        let kind = self.kind_of(value)?;
        // The opcode and its stack effect come from the *result*, and the
        // operands are loaded by their own kinds. Those agree in every prepared
        // HIR seen so far -- and where they did not, the symptom was a stack
        // that stopped balancing several instructions later. So the agreement
        // is checked here rather than assumed, which is record 0077's rule: the
        // second place that must agree should assert rather than compute.
        let left = self.kind_of(lhs)?;
        let right = self.kind_of(rhs)?;
        let counts_as_shift = matches!(op, BinOp::Shl | BinOp::Shr | BinOp::UShr);
        if left != kind || (right != kind && !(counts_as_shift && right == Kind::Int)) {
            return Err(refuse(
                self.func,
                &format!(
                    "a `{op:?}` whose operands are {left:?} and {right:?} but whose \
                     result is {kind:?} -- the middle end usually agrees, and where \
                     it does not this backend would emit an unbalanced stack"
                ),
            ));
        }
        // An integral operator whose operands are being *kept* in a float.
        //
        // `n === 0 ? 0 / 0 : n | 0` joins a NaN with an int32, so the join is a
        // double and `|` arrives with `Float` operands. The C backend has
        // spelled that since it was written -- `(double)((int32_t)a | (int32_t)b)`
        // -- and this one emitted `ior` with two doubles on the stack, which is
        // an unloadable class.
        //
        // **The narrowing is not exact, and `d2i` is the wrong instruction --
        // this file says so twice elsewhere.**
        //
        // This used to read "`|` applies `ToInt32` to both operands first, so
        // what reaches here is an integral value that was *widened* to a
        // double", citing C's cast as the same argument. Both were wrong
        // together: `"".codePointAt(0) ?? (-1 >>> 4)` reaches here with
        // `4294967295.0`, which is integral and does **not** fit in an `int`.
        // `d2i` saturates to `Integer.MAX_VALUE` and the answer came back
        // 134217727 where node says 268435455; C's `(int32_t)` was undefined on
        // the same value.
        //
        // `toInt32` is ECMAScript's conversion --- wrap modulo 2^32 --- and is
        // what [`Self::adapt`] and the `ToInt32` unary already use at this
        // boundary. Via `Kind::Double` because the helper is `(D)I` and an
        // operand may be a `Float`.
        if matches!(
            op,
            BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr
        ) && matches!(kind, Kind::Double | Kind::Float)
        {
            self.push_as(code, pool, lhs, Kind::Double, &origin)?;
            code.invoke_static(&origin, pool, RUNTIME, "toInt32", "(D)I");
            self.push_as(code, pool, rhs, Kind::Double, &origin)?;
            code.invoke_static(&origin, pool, RUNTIME, "toInt32", "(D)I");
            match op {
                BinOp::BitAnd => code.bitwise(&origin, insn::AND, Kind::Int),
                BinOp::BitOr => code.bitwise(&origin, insn::OR, Kind::Int),
                BinOp::BitXor => code.bitwise(&origin, insn::XOR, Kind::Int),
                BinOp::Shl => code.shift(&origin, insn::SHL, Kind::Int),
                BinOp::Shr => code.shift(&origin, insn::SHR, Kind::Int),
                _ => code.shift(&origin, insn::USHR, Kind::Int),
            }
            // `>>>` is the one that is not sign-preserving: its result is a
            // `uint32`, so widening it as a signed `int` would answer negative
            // for anything with the top bit set.
            if op == BinOp::UShr {
                code.invoke_static(
                    &origin,
                    pool,
                    "java/lang/Integer",
                    "toUnsignedLong",
                    "(I)J",
                );
                convert_kind(code, &origin, Kind::Long, kind)
                    .ok_or_else(|| refuse(self.func, "an unsigned shift into an odd slot"))?;
            } else {
                convert_kind(code, &origin, Kind::Int, kind)
                    .ok_or_else(|| refuse(self.func, "an integral result into an odd slot"))?;
            }
            return Ok(Placed::OnStack);
        }
        self.load(code, pool, lhs)?;
        self.load(code, pool, rhs)?;
        // **A `long` shift takes an `int` count**, which is the one place the
        // JVM's arithmetic is not shaped like the IR's. HIR types a shift's
        // count to match the value being shifted, which is right for C -- where
        // `a >> b` is fine with both 64-bit -- and right for LLVM, whose `lshr`
        // requires the two to agree. `lushr` requires the opposite: a `long` and
        // an `int`.
        //
        // Emitting it without this pushed four words where the accounting
        // expected three, which `Code::shift` is right about and the operand
        // loading was wrong about. It showed up as the emitter's own balance
        // check -- "emitting %24 moved the operand stack from 0 to 1" -- in
        // `hpack-huffman.ts`, found by the shared lane compiling that module on
        // its own. It is invisible in the whole-project run, because the module
        // is refused at a language gap first.
        if matches!(op, BinOp::Shl | BinOp::Shr | BinOp::UShr) && kind == Kind::Long {
            code.convert(&origin, insn::L2I, Kind::Long, Kind::Int);
        }
        match op {
            BinOp::Add => code.arithmetic(&origin, insn::ADD, kind),
            BinOp::Sub => code.arithmetic(&origin, insn::SUB, kind),
            BinOp::Mul => code.arithmetic(&origin, insn::MUL, kind),
            BinOp::Div | BinOp::Rem if matches!(kind, Kind::Int | Kind::Long) => {
                // `idiv` throws on a zero divisor where C is undefined, and
                // nothing upstream proves the divisor non-zero. One helper
                // rather than a guard at every site.
                //
                // And the *unsigned* forms are correctness, not width. A `u32`
                // is held in an `int` slot, raw, because the JVM has no
                // unsigned type -- so every value above 2^31 is a negative
                // `int` and `irem` answers with the sign of a dividend that has
                // no sign. `benches/cases/absences` reached it with `i % 3`
                // where the counter passes 2^31, and the C lane agreed with
                // node because C has the type.
                let unsigned = matches!(self.ty(value), HirType::Int { signed: false, .. });
                let (name, signature) = match (op, kind, unsigned) {
                    (BinOp::Div, Kind::Long, false) => ("ldiv", "(JJ)J"),
                    (BinOp::Rem, Kind::Long, false) => ("lrem", "(JJ)J"),
                    (BinOp::Div, Kind::Long, true) => ("uldiv", "(JJ)J"),
                    (BinOp::Rem, Kind::Long, true) => ("ulrem", "(JJ)J"),
                    (BinOp::Div, _, false) => ("idiv", "(II)I"),
                    (BinOp::Div, _, true) => ("uidiv", "(II)I"),
                    (_, _, false) => ("irem", "(II)I"),
                    (_, _, true) => ("uirem", "(II)I"),
                };
                code.invoke_static(&origin, pool, RUNTIME, name, signature);
            }
            BinOp::Div => code.arithmetic(&origin, insn::DIV, kind),
            BinOp::Rem => code.arithmetic(&origin, insn::REM, kind),
            BinOp::BitAnd => code.bitwise(&origin, insn::AND, kind),
            BinOp::BitOr => code.bitwise(&origin, insn::OR, kind),
            BinOp::BitXor => code.bitwise(&origin, insn::XOR, kind),
            BinOp::Shl => code.shift(&origin, insn::SHL, kind),
            BinOp::Shr => code.shift(&origin, insn::SHR, kind),
            BinOp::UShr => code.shift(&origin, insn::USHR, kind),
            // `Math.min` and `Math.max` on doubles are JavaScript's, exactly:
            // NaN propagates and `-0.0` is less than `0.0`. C's `fmin`/`fmax`
            // are wrong on both, which is why the native runtime has its own.
            BinOp::Min | BinOp::Max => {
                let name = if op == BinOp::Min { "min" } else { "max" };
                let descriptor = kind.descriptor();
                let signature = format!("({descriptor}{descriptor}){descriptor}");
                code.invoke_static(&origin, pool, "java/lang/Math", name, &signature);
            }
            BinOp::Concat => return Err(refuse(self.func, "a string concatenation")),
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Eq | BinOp::Ne => {
                unreachable!("comparisons are handled above")
            }
        }
        Ok(Placed::OnStack)
    }

    /// Load two operands and branch when the comparison holds.
    /// `negate` asks for the branch taken when the comparison is false, which
    /// is what a fallthrough to the true arm needs. It is passed down rather
    /// than applied here: on a float, inverting the *comparison* changes which
    /// `dcmp` form is correct and gets `NaN` wrong -- see
    /// [`Code::branch_float_when`].
    pub(crate) fn compare_and_branch(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        test: Test,
        target: Label,
    ) -> Result<(), Diagnostic> {
        let Test { compare, negate, lhs, rhs } = test;
        let origin = self.func.values[lhs.0 as usize].origin.clone();
        let kind = self.kind_of(lhs)?;
        if *self.ty(lhs) == HirType::Erased || *self.ty(rhs) == HirType::Erased {
            return self.branch_on_erased(code, pool, test, target, &origin);
        }
        if matches!(self.ty(lhs), HirType::BigInt) {
            self.load(code, pool, lhs)?;
            self.load(code, pool, rhs)?;
            code.invoke_static(
                &origin,
                pool,
                types::BIGINT,
                "compare",
                "(Lnts/rt/NtsBigInt;Lnts/rt/NtsBigInt;)I",
            );
            let test = if negate { compare.inverted() } else { compare };
            code.branch_zero(&origin, test, target);
            return Ok(());
        }
        // `a < b` on two strings is lexicographic by UTF-16 code unit, and
        // `String.compareTo` is that rule exactly -- it compares `char` by
        // `char`, and a Java `char` is a code unit. So this is one of the
        // places the platform's own method *is* the language's semantics, like
        // `Math.min` and unlike `Math.round`.
        //
        // It is also a place a pointer comparison would be wrong quietly: the C
        // runtime compared addresses here for as long as both backends existed,
        // which is the failure that made ordering-on-references a refusal in
        // this backend rather than an `if_acmp`.
        if *self.ty(lhs) == HirType::Erased || *self.ty(rhs) == HirType::Erased {
            return self.branch_on_erased(code, pool, test, target, &origin);
        }
        if matches!(self.ty(lhs), HirType::BigInt) {
            self.load(code, pool, lhs)?;
            self.load(code, pool, rhs)?;
            code.invoke_static(
                &origin,
                pool,
                types::BIGINT,
                "compare",
                "(Lnts/rt/NtsBigInt;Lnts/rt/NtsBigInt;)I",
            );
            let test = if negate { compare.inverted() } else { compare };
            code.branch_zero(&origin, test, target);
            return Ok(());
        }
        if matches!(self.ty(lhs), HirType::Managed(ManagedType::String)) {
            self.load(code, pool, lhs)?;
            self.load(code, pool, rhs)?;
            code.invoke_virtual(
                &origin,
                pool,
                types::STRING,
                "compareTo",
                "(Ljava/lang/String;)I",
            );
            let test = if negate { compare.inverted() } else { compare };
            code.branch_zero(&origin, test, target);
            return Ok(());
        }
        self.load(code, pool, lhs)?;
        self.load(code, pool, rhs)?;
        // Integers are totally ordered, so inverting the comparison and
        // inverting the test are the same thing there. Floats are not, which is
        // why only this arm may do it.
        let test = if negate { compare.inverted() } else { compare };
        match kind {
            Kind::Int => code.branch_int(&origin, test, target),
            // No `if_lcmp`: a `long` comparison is `lcmp` and then a test
            // against zero, which is what `branch_zero` reads.
            Kind::Long => {
                code.compare(&origin, insn::LCMP, Kind::Long);
                code.branch_zero(&origin, test, target);
            }
            Kind::Float | Kind::Double => {
                code.branch_float_when(&origin, compare, negate, kind, target);
            }
            // `===` between two objects *is* reference identity, so this is the
            // one place `if_acmpeq` is right -- and the one place it must not
            // be reached for a string, which compares by value and is diverted
            // in `reference_binary` before it gets here.
            //
            // Ordering is refused rather than emitted: `a < b` on two objects
            // is `valueOf` and a coercion in the language, not a pointer
            // comparison, and answering it with one would be wrong quietly.
            Kind::Ref => match test {
                Compare::Eq => code.branch_ref(&origin, true, target),
                Compare::Ne => code.branch_ref(&origin, false, target),
                _ => {
                    return Err(refuse(
                        self.func,
                        "an ordering comparison between two references",
                    ));
                }
            },
        }
        Ok(())
    }

    fn unary(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        result: &HirType,
        op: UnOp,
        operand: ValueId,
    ) -> Result<Placed, Diagnostic> {
        let origin = self.func.values[operand.0 as usize].origin.clone();
        let from = self.kind_of(operand)?;
        if op == UnOp::Truthy {
            return self.truthy(code, pool, operand, from);
        }
        let kind = types::kind(result)
            .ok_or_else(|| refuse(self.func, "a unary result of unrepresentable type"))?;
        // Two ends again: what the *instruction* operates on and what the
        // middle end chose to keep the answer in. They agree in most prepared
        // HIR and they do not always -- `Math.abs` of an `i32` arrives with an
        // `i64` result in `examples/mathops`, and taking the signature from the
        // result called `Math.abs(J)J` with an `int` on the stack.
        //
        // So each arm names the kind it works in, the operand is pushed as
        // that, and the answer is adapted to the slot. The double-only ones say
        // `Kind::Double` twice rather than once, because `Math.floor` takes and
        // returns a double whatever the surrounding types are.
        let produced = match op {
            // Widened to the *result's* kind before operating, not the
            // operand's. `-x` and `abs(x)` are the two arithmetic operations
            // whose answer does not fit the type of their argument: `abs` of
            // `i32::MIN` is `2^31`, which is why the middle end gives it an
            // `i64` result over an `i32` operand. Doing the work in the
            // operand's width and widening afterwards returns `i32::MIN`
            // unchanged -- `Math.abs` is documented to, and it is the one
            // answer that is a plausible number rather than a crash.
            //
            // `examples/mathops` reported -32768 where node says 32768.
            // A bigint has no `ineg`; negation is a call like every other
            // operation on one.
            UnOp::Neg if matches!(result, HirType::BigInt) => {
                self.load(code, pool, operand)?;
                code.invoke_static(
                    &origin,
                    pool,
                    types::BIGINT,
                    "neg",
                    "(Lnts/rt/NtsBigInt;)Lnts/rt/NtsBigInt;",
                );
                Kind::Ref
            }
            UnOp::Neg => {
                self.push_as(code, pool, operand, kind, &origin)?;
                code.negate(&origin, kind);
                kind
            }
            // `!x` on a boolean, which is an `int` that is 0 or 1.
            UnOp::Not => {
                self.push_as(code, pool, operand, Kind::Int, &origin)?;
                code.const_int(&origin, pool, 1);
                code.bitwise(&origin, insn::XOR, Kind::Int);
                Kind::Int
            }
            UnOp::ToInt32 | UnOp::ToUint32 => {
                self.load(code, pool, operand)?;
                self.coercion(code, pool, op, from, result, &origin)?;
                // `coercion` lands the value in the result's own kind, having
                // been told what it is.
                kind
            }
            UnOp::Floor | UnOp::Ceil | UnOp::Sqrt | UnOp::Trunc | UnOp::Round => {
                self.push_as(code, pool, operand, Kind::Double, &origin)?;
                let (owner, name) = match op {
                    UnOp::Floor => ("java/lang/Math", "floor"),
                    UnOp::Ceil => ("java/lang/Math", "ceil"),
                    UnOp::Sqrt => ("java/lang/Math", "sqrt"),
                    // `java.lang.Math` has no `trunc`, and `Math.round` returns
                    // a `long`: it saturates, answers 0 for NaN, and cannot
                    // produce the `-0` that `Math.round(-0.4)` must.
                    UnOp::Trunc => (RUNTIME, "trunc"),
                    _ => (RUNTIME, "round"),
                };
                code.invoke_static(&origin, pool, owner, name, "(D)D");
                Kind::Double
            }
            UnOp::Abs => {
                self.push_as(code, pool, operand, kind, &origin)?;
                let descriptor = kind.descriptor();
                let signature = format!("({descriptor}){descriptor}");
                code.invoke_static(&origin, pool, "java/lang/Math", "abs", &signature);
                kind
            }
            UnOp::Truthy => unreachable!("handled above"),
        };
        self.adapt(code, produced, result, &origin)?;
        Ok(Placed::OnStack)
    }

    /// `ToInt32` and `ToUint32`: a reduction to thirty-two bits, and then a
    /// widening into whatever slot the middle end gave the result.
    ///
    /// # The widening is not optional, and the sign lives in it
    ///
    /// The prepared HIR for `h >>> 7` contains `touint32 %2 : i64` -- an `i32`
    /// operand and an `i64` result. The coercion *is* a reduction to thirty-two
    /// bits, and where it lands afterwards is a separate decision the middle
    /// end already made. Emitting the reduction alone leaves an `int` on the
    /// stack where the slot wants a `long`, which is not a wrong number: it is
    /// a stack that no longer balances, and `Code`'s tracking catches it at the
    /// next block boundary rather than at the cause.
    ///
    /// The LLVM backend records the same bug from the other side -- "producing
    /// `i32` and calling it the result's type made a value whose emitted width
    /// disagreed with its recorded one … the module stopped verifying several
    /// instructions away from the cause".
    ///
    /// And the sign belongs to the *widening*, not to the reduction: both
    /// coercions reduce to the same thirty-two bits and differ only in whether
    /// widening them keeps a negative number negative. `ToUint32` therefore
    /// widens through `Integer.toUnsignedLong`, which is the JVM's spelling of
    /// `zext` on a machine with no unsigned types.
    fn coercion(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        op: UnOp,
        from: Kind,
        result: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        // Step one: down to thirty-two bits.
        match from {
            Kind::Double | Kind::Float => {
                if from == Kind::Float {
                    code.convert(origin, insn::F2D, Kind::Float, Kind::Double);
                }
                // The ten-instruction reduction the runtime spells out, called
                // rather than reproduced: inlining it would be a second
                // implementation of `ToInt32` to keep in step with the first.
                let name = if op == UnOp::ToInt32 { "toInt32" } else { "toUint32" };
                code.invoke_static(origin, pool, RUNTIME, name, "(D)I");
            }
            Kind::Long => code.convert(origin, insn::L2I, Kind::Long, Kind::Int),
            Kind::Int => {}
            Kind::Ref => return Err(refuse(self.func, "a coercion of a reference")),
        }

        // Step two: back out to the slot the middle end chose.
        let signed = op == UnOp::ToInt32;
        let target = types::kind(result)
            .ok_or_else(|| refuse(self.func, "a coercion into an unrepresentable type"))?;
        if target == Kind::Int {
            return Ok(());
        }
        if signed {
            let opcode = match target {
                Kind::Long => insn::I2L,
                Kind::Float => insn::I2F,
                _ => insn::I2D,
            };
            code.convert(origin, opcode, Kind::Int, target);
            return Ok(());
        }
        // Unsigned: widen through `long` so the top bit does not sign-extend.
        code.invoke_static(origin, pool, "java/lang/Integer", "toUnsignedLong", "(I)J");
        match target {
            Kind::Long => {}
            Kind::Float => code.convert(origin, insn::L2F, Kind::Long, Kind::Float),
            _ => code.convert(origin, insn::L2D, Kind::Long, Kind::Double),
        }
        Ok(())
    }

    /// JavaScript truthiness for a scalar, which is not `!= 0`.
    ///
    /// `NaN` is falsy and `NaN != 0` is true, so a double needs both tests.
    fn truthy(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        operand: ValueId,
        kind: Kind,
    ) -> Result<Placed, Diagnostic> {
        let origin = self.func.values[operand.0 as usize].origin.clone();
        if matches!(self.ty(operand), HirType::Bool) {
            self.load(code, pool, operand)?;
            return Ok(Placed::OnStack);
        }
        // Emptiness, not nullness -- and a null one is falsy too, so a length
        // check alone throws on the case it is meant to answer.
        if matches!(self.ty(operand), HirType::Managed(ManagedType::String)) {
            self.load(code, pool, operand)?;
            code.invoke_static(&origin, pool, RUNTIME, "stringTruthy", "(Ljava/lang/String;)Z");
            return Ok(Placed::OnStack);
        }
        if *self.ty(operand) == HirType::Erased {
            self.load(code, pool, operand)?;
            code.invoke_static(&origin, pool, types::VALUE, "truthy", "(Lnts/rt/NtsValue;)Z");
            return Ok(Placed::OnStack);
        }
        // **`0n` is falsy, and a bigint is a reference on this lane.** So the
        // rule below -- every other reference is truthy exactly when it is
        // there -- is a rule about *objects*, and a bigint is not one.
        // `NtsBigInt.of(0, 0)` is a perfectly present object, so `isPresent`
        // answered `true` where node answers `false`, and `0n ? "T" : "F"`
        // came out `"T"`.
        //
        // Found by `tooling/sweep` driven with `NTS_BACKEND=jvm` -- 18 cases
        // in `big_truthy` and `big_truthy_param` -- against a C lane that
        // agreed with node on all 10,005. The comment below was true of every
        // reference anyone had considered, which is why it read as a rule.
        //
        // `eq` against `ZERO` rather than a new runtime entry point: both
        // already exist, so this needs no jar regeneration and no name the
        // other backends would have to learn.
        if matches!(self.ty(operand), HirType::BigInt) {
            self.load(code, pool, operand)?;
            code.get_static(&origin, pool, types::BIGINT, "ZERO", types::BIGINT_DESCRIPTOR);
            code.invoke_static(
                &origin,
                pool,
                types::BIGINT,
                "eq",
                "(Lnts/rt/NtsBigInt;Lnts/rt/NtsBigInt;)Z",
            );
            // `eq` answers "is zero", and truthiness is its negation.
            code.const_int(&origin, pool, 1);
            code.bitwise(&origin, insn::XOR, Kind::Int);
            return Ok(Placed::OnStack);
        }
        // Every other reference is truthy exactly when it is there. An empty
        // array is truthy and so is an object with no fields -- emptiness is a
        // string rule and only a string rule, which is why that case is above
        // this one rather than folded into it.
        if kind == Kind::Ref {
            self.load(code, pool, operand)?;
            code.invoke_static(&origin, pool, RUNTIME, "isPresent", "(Ljava/lang/Object;)Z");
            return Ok(Placed::OnStack);
        }
        let Some(scratch) = self.scratch else {
            return Err(refuse(self.func, "a truthiness test with no scratch slot"));
        };
        let falsy = code.label();
        let done = code.label();
        match kind {
            Kind::Int => {
                self.load(code, pool, operand)?;
                code.branch_zero(&origin, Compare::Eq, falsy);
            }
            Kind::Long => {
                self.load(code, pool, operand)?;
                code.const_long(&origin, pool, 0);
                code.compare(&origin, insn::LCMP, Kind::Long);
                code.branch_zero(&origin, Compare::Eq, falsy);
            }
            Kind::Float | Kind::Double => {
                // `x != x` is the NaN test, and it must come first: `NaN != 0`
                // is true, so testing against zero alone calls NaN truthy.
                self.load(code, pool, operand)?;
                self.load(code, pool, operand)?;
                code.branch_float(&origin, Compare::Ne, kind, falsy);
                self.load(code, pool, operand)?;
                if kind == Kind::Double {
                    code.const_double(&origin, pool, 0.0);
                } else {
                    code.const_float(&origin, pool, 0.0);
                }
                code.branch_float(&origin, Compare::Eq, kind, falsy);
            }
            Kind::Ref => return Err(refuse(self.func, "truthiness of a reference")),
        }
        code.const_int(&origin, pool, 1);
        code.store(&origin, Kind::Int, scratch);
        code.goto(&origin, done);
        code.bind(falsy);
        code.const_int(&origin, pool, 0);
        code.store(&origin, Kind::Int, scratch);
        code.bind(done);
        code.load(&origin, Kind::Int, scratch);
        Ok(Placed::OnStack)
    }

    /// A representation change the middle end decided, with the operand
    /// already on the stack.
    ///
    /// `d2i` is right *here* and wrong for `UnOp::ToInt32`: a `Convert` is
    /// emitted only where specialization proved the value integral and in
    /// range, which is the same proof the C backend's plain cast relies on.
    fn convert(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        from: &HirType,
        to: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        // A bigint is a reference here and a 128-bit integer everywhere else,
        // so neither direction is an opcode. `BigInt(x)` on a non-integer is a
        // `RangeError` in the language and a refusal here, which is why it goes
        // through the runtime rather than being a cast.
        if matches!(from, HirType::BigInt) || matches!(to, HirType::BigInt) {
            let (name, signature) = match (from, to) {
                (HirType::BigInt, HirType::Float { .. }) => {
                    ("toNumber", "(Lnts/rt/NtsBigInt;)D")
                }
                (HirType::Float { .. }, HirType::BigInt) => {
                    ("fromNumber", "(D)Lnts/rt/NtsBigInt;")
                }
                // A boolean is an `int` here and converts to `1n` or `0n`; an
                // integer of any width widens the same way.
                (HirType::Bool | HirType::Int { .. }, HirType::BigInt) => {
                    let have = types::kind(from)
                        .ok_or_else(|| refuse(self.func, "a conversion from an unrepresentable type"))?;
                    convert_kind(code, origin, have, Kind::Long).ok_or_else(|| {
                        refuse(self.func, "an integer that does not widen to 64 bits")
                    })?;
                    ("fromLong", "(J)Lnts/rt/NtsBigInt;")
                }
                _ => {
                    return Err(refuse(
                        self.func,
                        &format!(
                            "a conversion between {} and {}",
                            types::describe(from),
                            types::describe(to)
                        ),
                    ));
                }
            };
            // The operand arrives in whatever width the middle end chose; the
            // helper takes a `double`, which is the same both-ends rule the
            // subscripts and the lengths keep.
            if matches!(from, HirType::Float { bits: 32 }) {
                code.convert(origin, insn::F2D, Kind::Float, Kind::Double);
            }
            code.invoke_static(origin, pool, types::BIGINT, name, signature);
            return Ok(());
        }
        let source = types::kind(from)
            .ok_or_else(|| refuse(self.func, "a conversion from an unrepresentable type"))?;
        let target = types::kind(to)
            .ok_or_else(|| refuse(self.func, "a conversion to an unrepresentable type"))?;
        // A `uint32` fills its slot, so its top bit is a value bit and `i2d`
        // would read it as a sign: `storeU32` answered -2147483648 where node
        // said 2147483648, and -1 where node said 4294967294. The narrower
        // unsigned widths do not have this problem, because the mask below
        // leaves them zero-extended inside an `int` that is wider than they
        // are -- only a `uint32` has no room left to be zero-extended into.
        //
        // `Integer.toUnsignedLong` is the JVM's spelling of `zext`, and it is
        // the same route `ToUint32` already takes a few hundred lines up. This
        // is a case where the JVM's lack of unsigned types is a *correctness*
        // problem rather than the performance one the plan predicted: `Kind`
        // is the stack representation and has no signedness, so a table keyed
        // on it cannot see the difference and answers plausibly.
        let source = if matches!(from, HirType::Int { bits: 32, signed: false })
            && matches!(target, Kind::Long | Kind::Float | Kind::Double)
        {
            code.invoke_static(origin, pool, "java/lang/Integer", "toUnsignedLong", "(I)J");
            Kind::Long
        } else {
            source
        };
        // **A managed value becoming a boolean is truthiness, not an opcode.**
        // The table below is keyed on `Kind`, which has no arm for a reference,
        // so this refused -- `a conversion this backend has no opcode for: an
        // array of strings to a boolean`, found by the npm lane pointing a real
        // package at this backend rather than by any fixture here.
        //
        // For everything that is not a string, JavaScript truthiness of a
        // managed value is exactly "is it there": an array is truthy however
        // empty, an object is truthy, and only `null` and `undefined` are not.
        //
        // **A string is deliberately still refused.** Its truthiness is
        // `length != 0`, which is a different test, and nothing has produced
        // one here -- so it stays a refusal by name rather than a third arm
        // written against no case.
        if matches!(to, HirType::Bool) && !matches!(from, HirType::Bool) {
            return self.materialize_truth(code, pool, from, origin);
        }
        if matches!(from, HirType::Managed(_)) && matches!(to, HirType::Managed(_)) {
            return self.reinterpret_managed(code, pool, from, to, origin);
        }
        // Widen to the computational kind first, then narrow to the declared
        // width. Doing it in one step would need a case per pair.
        let opcode = match (source, target) {
            (a, b) if a == b => None,
            (Kind::Int, Kind::Long) => Some(insn::I2L),
            (Kind::Int, Kind::Float) => Some(insn::I2F),
            (Kind::Int, Kind::Double) => Some(insn::I2D),
            (Kind::Long, Kind::Int) => Some(insn::L2I),
            (Kind::Long, Kind::Float) => Some(insn::L2F),
            (Kind::Long, Kind::Double) => Some(insn::L2D),
            (Kind::Float, Kind::Int) => Some(insn::F2I),
            (Kind::Float, Kind::Long) => Some(insn::F2L),
            (Kind::Float, Kind::Double) => Some(insn::F2D),
            (Kind::Double, Kind::Int) => Some(insn::D2I),
            (Kind::Double, Kind::Long) => Some(insn::D2L),
            (Kind::Double, Kind::Float) => Some(insn::D2F),
            _ => {
                return Err(refuse(
                    self.func,
                    &format!(
                        "a conversion this backend has no opcode for: {} to {}",
                        types::describe(from),
                        types::describe(to)
                    ),
                ));
            }
        };
        if let Some(opcode) = opcode {
            code.convert(origin, opcode, source, target);
        }
        // An integer narrower than its slot keeps only its own bits, which is
        // observable: `(x | 0) & 0xff` and a `Uint8Array` element are the same
        // question. The JVM has no narrow slot, so the mask is explicit.
        if target == Kind::Int {
            match to {
                HirType::Int { bits: 8, signed: true } => {
                    code.convert(origin, insn::I2B, Kind::Int, Kind::Int);
                }
                HirType::Int { bits: 16, signed: true } => {
                    code.convert(origin, insn::I2S, Kind::Int, Kind::Int);
                }
                HirType::Int { bits: 16, signed: false } => {
                    code.convert(origin, insn::I2C, Kind::Int, Kind::Int);
                }
                HirType::Int { bits: 8, signed: false } => {
                    code.const_int(origin, pool, 0xFF);
                    code.bitwise(origin, insn::AND, Kind::Int);
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Reinterpret one managed representation as another, which is a `checkcast`.
    ///
    /// **Two managed types are both `Kind::Ref`, so the table below answers
    /// "same kind, no opcode" and emits nothing.** That is right when they
    /// are the same representation and silently wrong when they are not: a
    /// `Convert` is "reinterpret a value in a different representation, the
    /// one operation whose whole content is its result type", and on the JVM
    /// a reinterpretation between two reference types is a `checkcast`.
    ///
    /// Nothing produced one until now -- `Convert` reads as a numeric
    /// operation and its arms are numeric -- so this was a hole rather than
    /// a bug in anything that runs. It stops being a hole the moment an
    /// all-reference tuple is laid out as an array: `pair[1]` declared
    /// `managed<[string]>` arrives at the array's element type and is
    /// converted back, which in C is a pointer cast costing nothing and here
    /// must be checked. Emitting nothing would hand a `String[]` where a
    /// `double[]` is declared and let the verifier reject the class -- or
    /// not, which is worse.
    ///
    /// **The cast is emitted whenever the descriptors differ**, including
    /// where the target is a supertype and it cannot fail. A redundant
    /// `checkcast` is correct by construction and C2 removes one it can
    /// prove; a missing one is a wrong answer. That asymmetry is the whole
    /// argument for not consulting `assignable_types` here -- it answers
    /// `Ok` by falling through for arrays, which is exactly the case that
    /// needs the cast most.
    fn reinterpret_managed(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        from: &HirType,
        to: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let have = types::descriptor(self.shape, from).ok_or_else(|| {
            refuse(self.func, "a conversion from a managed type this backend cannot spell")
        })?;
        let want = types::descriptor(self.shape, to).ok_or_else(|| {
            refuse(self.func, "a conversion to a managed type this backend cannot spell")
        })?;
        if have != want {
            code.check_cast(origin, pool, &want);
        }
        Ok(())
    }

    /// A call through a dispatch table, by name rather than by slot.
    ///
    /// The slot is unused: the JVM has its own vtable, and naming the method is
    /// what lets C2 devirtualise through class-hierarchy analysis -- which is
    /// why this lane is expected to win the `dispatch` row rather than merely
    /// match it.
    fn virtual_call(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        declared: &str,
        args: &[ValueId],
        result: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
            let Some(&receiver) = args.first() else {
                return Err(refuse(self.func, "a virtual call with no receiver"));
            };
            let owner = self.object_class(&self.ty(receiver).clone())?;
            let Some(target) = self.program.funcs.iter().find(|f| f.name == declared) else {
                return Err(refuse(
                    self.func,
                    &format!("a virtual call to `{declared}`, which is not in this program"),
                ));
            };
            let Some(descriptor) = crate::instance_descriptor(self.shape.package, self.program, target) else {
                return Err(refuse(
                    self.func,
                    &format!("a virtual call to `{declared}`, whose signature has no representation"),
                ));
            };
            for &arg in args {
                self.load(code, pool, arg)?;
            }
            let member = crate::hierarchy::member_name(declared);
            // Which instruction, decided by what the receiver's static type
            // is emitted as. The two are not interchangeable: they resolve
            // through different constant-pool tags, and the wrong one is an
            // `IncompatibleClassChangeError` at the call rather than
            // anything the verifier reports at load.
            let through_interface = match self.ty(receiver) {
                HirType::Managed(ManagedType::Object(id)) => self
                    .program
                    .layout(*id)
                    .is_some_and(|at| crate::hierarchy::is_interface(self.program, at)),
                _ => false,
            };
            if through_interface {
                code.invoke_interface(origin, pool, &owner, &member, &descriptor);
            } else {
                code.invoke_virtual(origin, pool, &owner, &member, &descriptor);
            }
            Ok(if matches!(result, HirType::Void) {
                Placed::Stored
            } else {
                Placed::OnStack
            })
    }

    /// A map key the caller already holds as a reference; see
    /// `fuse::object_keys`.
    ///
    /// Answers the reference to pass, the member to call and its descriptor.
    /// The descriptor and the argument have to move together --
    /// `push_arguments` reads the descriptor to decide how to push each
    /// operand, so changing one without the other puts a box where an `Object`
    /// is declared, or the reverse, and the verifier is what finds out.
    fn object_key(
        &self,
        name: &str,
        args: &[ValueId],
    ) -> Option<ObjectKeyCall> {
        let (member, spelling) = crate::fuse::object_key_form(name)?;
        let key = *args.get(crate::fuse::KEY_AT)?;
        let source = *self.object_keys.get(&key)?;
        let mut swapped = args.to_vec();
        swapped[crate::fuse::KEY_AT] = source;
        Some((swapped, (types::MAP, member, spelling.to_owned())))
    }

    /// `String(n)` where `n` is provably an `i32`, answering whether it emitted.
    ///
    /// `hir::runtime` types `nts_number_to_string` as taking a `double`, so the
    /// middle end widens an `i32` on the way in -- `%93 = convert %13 : f64` --
    /// and this lane then answers with the Grisu port, which exists to print
    /// every double node can print. For a value that came from an `i32` two
    /// instructions ago, `Integer.toString` is exact on every input and is a
    /// JDK intrinsic.
    ///
    /// The third member of a family: the array subscript (record 0138, 4.56x),
    /// the growable length (0158), and this. Each is a helper whose only
    /// signature answers in a `double` reached from generated code that had an
    /// integer, and each is visible in a descriptor rather than in a profile.
    ///
    /// Priced before building rather than after, which is the rule 0163 arrived
    /// at: the replacement is a JDK method that formats an `int` in tens of
    /// instructions against a Grisu conversion in hundreds, so it is cheap
    /// *and* priceable, and an A/B was not what it needed.
    fn integer_to_string(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        name: &str,
        args: &[ValueId],
        origin: &nts_semantic_schema::Origin,
    ) -> Result<bool, Diagnostic> {
        if name != "nts_number_to_string" {
            return Ok(false);
        }
        let Some(&only) = args.first() else {
            return Ok(false);
        };
        let OpKind::Convert(inner) = self.func.values[only.0 as usize].kind else {
            return Ok(false);
        };
        if !matches!(self.ty(inner), HirType::Int { bits, signed: true } if *bits <= 32) {
            return Ok(false);
        }
        self.push_as(code, pool, inner, Kind::Int, origin)?;
        code.invoke_static(
            origin,
            pool,
            "java/lang/Integer",
            "toString",
            "(I)Ljava/lang/String;",
        );
        Ok(true)
    }



    /// A field read or write, ours or a bound class's.
    ///
    /// Split out of [`Self::operation`] because the two arms are one question
    /// -- which field, at which width -- and because a bound field's width is
    /// the jar's rather than the one its declaration was rendered as, which is
    /// several lines of its own.
    fn field_op(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Option<Placed>, Diagnostic> {
        Ok(match kind {
        OpKind::FieldGet { object, field } => {
            let (class, name, descriptor, declared) = self.field_ref(*object, *field)?;
            self.load(code, pool, *object)?;
            code.get_field(origin, pool, &class, &name, &descriptor);
            self.convert_field(code, pool, &descriptor, &declared, true, origin)?;
            Some(Placed::OnStack)
        }
        OpKind::FieldSet { object, field, value: stored } => {
            let (class, name, descriptor, declared) = self.field_ref(*object, *field)?;
            // **A store into a field is an assignment to its declared type,
            // and this was the last of the three that did not check.**
            // `Return` checks, and the global store checks; a `putfield`
            // did not, so a value the program could not license became a
            // `VerifyError` at class load instead of a refusal by name.
            //
            // `examples/function-in-an-object-literal` is the shape:
            // `const table = { doubled }` gives `Type5.doubled` the
            // *function type* as its descriptor and stores the *closure
            // class* into it, and with one closure of that signature
            // nothing relates the two -- so the verifier said "Type
            // 'nts/gen/Closure0' is not assignable to 'nts/gen/Fn2__2'"
            // and the emitter had said nothing at all. Two closures of one
            // signature and `Layout.base` relates them, which is why a
            // second function in any object literal made it disappear.
            //
            // This does not make that program work; the relation is the
            // middle end's to record. It makes the backend say so, which
            // is the whole of what `unverifiable class` being a hard zero
            // in the corpus is worth.
            self.assignable_types(&self.ty(*stored).clone(), &declared)?;
            self.load(code, pool, *object)?;
            self.load(code, pool, *stored)?;
            self.convert_field(code, pool, &descriptor, &declared, false, origin)?;
            code.put_field(origin, pool, &class, &name, &descriptor);
            // **`None`, not `Placed::Stored`.** A store produces no value, and
            // the original arm returned from `operation` early rather than
            // falling through to the code that puts a result in its slot.
            // Extracting it had to carry that: `Stored` would have run the
            // store-the-result path over a value that does not exist.
            None
        }
            _ => return Err(refuse(self.func, "a field operation that is neither")),
        })
    }

    /// Bring a **bound field** to and from the width the jar declared.
    ///
    /// The same mismatch a bound method's result has, one op over: the
    /// declaration renders `int hits` as `hits: number`, so the program holds
    /// a `double` and the class file says `I`. A read widens; a write narrows
    /// the way JavaScript narrows, which is `ToInt32` and not `d2i`.
    ///
    /// Silent when the two already agree, which is every field of ours.
    fn convert_field(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        descriptor: &str,
        declared: &HirType,
        reading: bool,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        use nts_jvm_emitter::insn::{self, Kind};
        if types::descriptor(self.shape, declared).as_deref() == Some(descriptor) {
            return Ok(());
        }
        if !matches!(declared, HirType::Float { bits: 64 }) {
            return Err(refuse(
                self.func,
                &format!("a bound field declared `{descriptor}` held as something other than a number"),
            ));
        }
        if reading {
            match descriptor {
                "I" | "S" | "B" | "C" | "Z" => {
                    code.convert(origin, insn::I2D, Kind::Int, Kind::Double);
                }
                "J" => code.convert(origin, insn::L2D, Kind::Long, Kind::Double),
                "F" => code.convert(origin, insn::F2D, Kind::Float, Kind::Double),
                other => {
                    return Err(refuse(
                        self.func,
                        &format!("a bound field returning `{other}` where a number is held"),
                    ));
                }
            }
            return Ok(());
        }
        match descriptor {
            "I" => code.invoke_static(origin, pool, RUNTIME, "toInt32", "(D)I"),
            "S" => code.invoke_static(origin, pool, RUNTIME, "toInt16", "(D)I"),
            "B" => code.invoke_static(origin, pool, RUNTIME, "toInt8", "(D)I"),
            "C" => code.invoke_static(origin, pool, RUNTIME, "toUint16", "(D)I"),
            "F" => code.convert(origin, insn::D2F, Kind::Double, Kind::Float),
            other => {
                return Err(refuse(
                    self.func,
                    &format!("a bound field taking `{other}` from a number"),
                ));
            }
        }
        Ok(())
    }

    /// Bring a bound member's result to the width and type the program holds
    /// it in.
    ///
    /// Three conversions live here and each is a different kind of mismatch:
    /// a Java integral width against our `f64`, a `long` against an
    /// `NtsBigInt`, and an erased generic return against its instantiation.
    /// Split out of [`Self::foreign_call`] to keep it under its line limit,
    /// and because "what does this call leave on the stack" is one question.
    fn narrow_foreign_return(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        descriptor: &str,
        result: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let returns = descriptor.rsplit(')').next().unwrap_or("");
        // **A Java array cannot take the representation a growing program
        // gives every array.** `arrays_can_grow` is whole-program: one `push`
        // anywhere puts every `ManagedType::Array` behind `NtsArrayL`. That
        // decision is about arrays *this compiler allocates*; a jar's array is
        // fixed and not ours to re-lay-out. So the frame said wrapper, the
        // value was a bare `[Ljava/lang/String;`, and the class did not load
        // -- with zero diagnostics on the way there, the verifier being the
        // only thing that noticed.
        //
        // Refused by name until a foreign array is its own type rather than
        // ours. That fix is upstream and written up; this is the difference
        // between a named refusal and a wrong answer.
        // **A Java array copied into a view, because a view is not an array.**
        // `[I` binds as `Int32Array`, and an `Int32Array` is a window onto a
        // `byte[]`-backed buffer so that two widths can share it and
        // `subarray` can alias. A Java `int[]` has no buffer, no byte offset
        // and nothing to alias against, so there is no store to adopt. The
        // copy is 0.04 ns per element, measured, which is why this is a copy
        // and not the refusal it used to be.
        if returns.starts_with('[')
            && matches!(result, HirType::Managed(ManagedType::View(_)))
        {
            let Some(want) = types::descriptor(self.shape, result) else {
                return Err(refuse(self.func, "a bound array whose view form has no name"));
            };
            let Some(view) = want.strip_prefix('L').and_then(|it| it.strip_suffix(';')) else {
                return Err(refuse(
                    self.func,
                    &format!("a bound member returning `{returns}` held as `{want}`"),
                ));
            };
            code.invoke_static(origin, pool, view, "from", &format!("({returns}){want}"));
            return Ok(());
        }
        if returns.starts_with('[')
            && matches!(result, HirType::Managed(ManagedType::Array(_)))
            && self.shape.grows
        {
            let Some(want) = types::descriptor(self.shape, result) else {
                return Err(refuse(self.func, "a bound array whose growable form has no name"));
            };
            let Some(wrapper) = want.strip_prefix('L').and_then(|it| it.strip_suffix(';')) else {
                return Err(refuse(
                    self.func,
                    &format!("a bound member returning `{returns}` held as `{want}`"),
                ));
            };
            // **The adopt overload is chosen by the JVM's rules, not ours.**
            // Method resolution is by exact descriptor, so a `[Ljava/lang/
            // String;` must call `adopt([Ljava/lang/Object;)` -- the one that
            // exists -- and array covariance is what makes the argument legal.
            // A primitive array names its own width, because `adopt([I)` and
            // `adopt([J)` are different methods that copy differently.
            let accepts = if returns.starts_with("[L") || returns.starts_with("[[") {
                "[Ljava/lang/Object;"
            } else {
                returns
            };
            code.invoke_static(origin, pool, wrapper, "adopt", &format!("({accepts}){want}"));
            return Ok(());
        }
        // **A Java reference arriving where a JavaScript value is held.**
        // `map.get(k)` is declared `number | null` now that a boxed primitive
        // renders as the value it boxes, and its class-file return is a plain
        // `Object`. The unboxing is by the value's *runtime* type, because the
        // declaration no longer says which it is -- which is the same trade
        // erasure already makes for the generic itself.
        if matches!(result, HirType::Erased) && returns.starts_with('L') {
            code.invoke_static(
                origin,
                pool,
                types::ARRAYS,
                "value",
                "(Ljava/lang/Object;)Lnts/rt/NtsValue;",
            );
            return Ok(());
        }
        if matches!(result, HirType::Float { bits: 64 }) {
            use nts_jvm_emitter::insn::{self, Kind};
            match returns {
                "I" | "S" | "B" | "C" | "Z" => {
                    code.convert(origin, insn::I2D, Kind::Int, Kind::Double);
                }
                "J" => code.convert(origin, insn::L2D, Kind::Long, Kind::Double),
                "F" => code.convert(origin, insn::F2D, Kind::Float, Kind::Double),
                _ => {}
            }
        }
        // **`long` is a `bigint` here, and it is two words becoming
        // one.** A Java `long` occupies two operand-stack slots; an
        // `NtsBigInt` is a single reference. Without this the value
        // left behind is the wrong width, which is not a wrong number
        // but a stack that stops balancing -- and it is what
        // `emitting %74 moved the operand stack from 0 to 1` was.
        //
        // The emitter's own accounting caught it at the operation
        // rather than at a block boundary or, worse, at class load in
        // somebody's program. That is the whole argument for keeping
        // the depth maintained by construction.
        if matches!(result, HirType::BigInt) {
            if returns != "J" {
                return Err(refuse(
                    self.func,
                    &format!(
                        "a bound member returning `{returns}` where the program wants a \
                         bigint; only `long` has a lossless spelling as one"
                    ),
                ));
            }
            code.invoke_static(
                origin,
                pool,
                types::BIGINT,
                "fromLong",
                "(J)Lnts/rt/NtsBigInt;",
            );
        }
        // **A bound generic method erases its return, and the
        // program's type is the instantiation.** `Map.get` is
        // `(Ljava/lang/Object;)Ljava/lang/Object;` in the class file
        // however the declaration is written, because that is what
        // erasure leaves; the `.d.ts` says `V | null` and the checker
        // resolved `V` to `Integer`. The verifier compares the
        // *declared* descriptor, so without narrowing here the frame
        // carries `java/lang/Object` where it promised
        // `java/lang/Integer` and the class does not load.
        //
        // This is the instruction `javac` emits at the same place for
        // the same reason, and it is checked rather than assumed: a
        // binding naming the wrong type throws `ClassCastException` at
        // the call instead of corrupting a frame.
        //
        // Not for `Erased`, which wants boxing into an `NtsValue` and
        // is a different operation; not to `Object`, which is the
        // no-op.
        if !matches!(result, HirType::Void | HirType::Erased)
            && returns.starts_with('L')
            && let Some(want) = types::descriptor(self.shape, result)
            && want.starts_with('L')
            && want != returns
            && want != "Ljava/lang/Object;"
        {
            code.check_cast(origin, pool, &want[1..want.len() - 1]);
        }
        Ok(())
    }

    /// A call to a **bound Java member**, which `external` will never have
    /// a row for: that table is this repository's own helpers and this name
    /// came out of a jar.
    ///
    /// Split out of [`Self::call`] because it is a second dispatch living
    /// inside the first -- six invocation kinds, a constructor that
    /// allocates, and a return width the jar chose -- and because `call`
    /// was 181 lines with it inlined.
    fn foreign_call(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        name: &str,
        args: &[ValueId],
        result: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        use nts_core::hir::runtime::ForeignKind;
                // Keyed by the foreign key, which is what a backend holds.
                // Scanning the rows instead was O(rows) per call site
                // against 78,948 of them for a bound Android SDK.
                let Some(bound) = self.program.foreign.get(name) else {
                    // Refused rather than guessed. `invokevirtual` on an
                    // interface is an `IncompatibleClassChangeError` at
                    // link time, in the user's program, which is far worse
                    // than a refusal here.
                    return Err(refuse(
                        self.func,
                        &format!(
                            "a call to the bound member `{name}`, whose binding table row is \
                             missing -- the `.bind` file beside the declaration says how to \
                             invoke it, and without it this backend would have to guess \
                             between `invokevirtual` and `invokeinterface`"
                        ),
                    ));
                };
                let Some((owner, member, descriptor)) =
                    nts_jvm_emitter::bind::split_key(name)
                else {
                    return Err(refuse(
                        self.func,
                        &format!("a call to `{name}`, which is not a well-formed foreign key"),
                    ));
                };
                // **A bound constructor allocates here, not in HIR.**
                // `new` on a foreign class is the JVM's own `new; dup;
                // invokespecial <init>`, so there is no layout of ours to
                // fill and no receiver to load: this is the one bound
                // member whose arguments are all of `args`. Lowering knows
                // the same thing and emits no `ObjectNew` -- doing it in
                // one place and not the other would either allocate twice
                // or verify against an uninitialised reference.
                if member == "<init>" {
                    // **Told apart by arity, which is the only thing that
                    // distinguishes them.** Constructing a bound class gives
                    // exactly the descriptor's parameters and this allocates;
                    // a TypeScript class extending a bound one gives those
                    // *plus the object it already allocated*, and this runs
                    // the jar's constructor on that object.
                    //
                    // `class Panel extends View` is the second shape. Taking
                    // the first for it emitted `new com/example/ui/View` where
                    // a `Panel` was wanted -- a field then held the base and
                    // the class did not load.
                    let declared =
                        nts_jvm_emitter::descriptor::parameters(descriptor).map_or(0, |it| it.len());
                    if args.len() == declared + 1 {
                        let Some((receiver, rest)) = args.split_first() else {
                            return Err(refuse(self.func, "a super-constructor with no receiver"));
                        };
                        self.load(code, pool, *receiver)?;
                        self.push_foreign_arguments(code, pool, rest, descriptor, origin)?;
                        code.invoke_special(origin, pool, owner, member, descriptor);
                        return Ok(Placed::Stored);
                    }
                    code.new_object(origin, pool, owner);
                    code.dup(origin);
                    self.push_foreign_arguments(code, pool, args, descriptor, origin)?;
                    code.invoke_special(origin, pool, owner, member, descriptor);
                    return Ok(Placed::OnStack);
                }
                // **The receiver is `args[0]` and the descriptor does not
                // mention it.** HIR gives a foreign instance call the same
                // shape every runtime helper has -- receiver first, then the
                // declared arguments -- because `Callee::External` has no
                // receiver of its own. A JVM instance invoke wants exactly
                // that on the stack, but `push_arguments` walks the
                // *descriptor*, which declares only the rest. Pushing all of
                // `args` against it left the stack one short and the
                // emitter's own accounting caught it.
                let rest = if matches!(bound.kind, ForeignKind::Static) {
                    args
                } else {
                    let Some((receiver, rest)) = args.split_first() else {
                        return Err(refuse(
                            self.func,
                            &format!("an instance call to `{name}` with no receiver"),
                        ));
                    };
                    self.load(code, pool, *receiver)?;
                    rest
                };
                self.push_foreign_arguments(code, pool, rest, descriptor, origin)?;
                match bound.kind {
                    ForeignKind::Static => {
                        code.invoke_static(origin, pool, owner, member, descriptor);
                    }
                    ForeignKind::Virtual => {
                        code.invoke_virtual(origin, pool, owner, member, descriptor);
                    }
                    ForeignKind::Interface => {
                        code.invoke_interface(origin, pool, owner, member, descriptor);
                    }
                    ForeignKind::Special => {
                        code.invoke_special(origin, pool, owner, member, descriptor);
                    }
                    ForeignKind::Field | ForeignKind::StaticField => {
                        return Err(refuse(
                            self.func,
                            &format!("`{name}` is a field, reached as a call"),
                        ));
                    }
                }
                // **Java's width is not TypeScript's.** `int size()` gives
                // an `I` and a `number` is a `double`, so the value on the
                // stack is one word where the accounting wants two -- which
                // is what `moved the operand stack from 0 to -1` was. The
                // conversion is the boundary rather than an optimisation:
                // `hir::runtime` is the single answer about conversions for
                // our own helpers, and a bound member needs the same rule
                // applied to the descriptor the jar declared.
                let returns = descriptor.rsplit(')').next().unwrap_or("");
                self.narrow_foreign_return(code, pool, descriptor, result, origin)?;
                if matches!(result, HirType::Void) {
                    let words = nts_jvm_emitter::descriptor::words(returns);
                    if words > 0 {
                        code.pop(origin, words);
                    }
                    return Ok(Placed::Stored);
                }
                Ok(Placed::OnStack)
    }

    // Adding a method here: put it above this attribute, not below it. An
    // attribute belongs to the declaration that follows, so a function inserted
    // between the two takes the allow with it and leaves `call` bare -- which
    // surfaces as `too many arguments (8/7)` on a change that altered no
    // signature. Happened once; the diff looked identical either way.
    #[allow(
        clippy::too_many_arguments,
        reason = "the result's own id joined seven that were already here, because \
                  `intcall` decides the descriptor from what the answer is used as"
    )]
    fn call(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        result: &HirType,
        callee: &Callee,
        args: &[ValueId],
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        let name = match callee {
            Callee::Native(target) => {
                return Err(Diagnostic::error(
                    "NTS4001",
                    format!(
                        "native C function `{}` cannot be called by the JVM backend",
                        target.name
                    ),
                    origin.location,
                ));
            }
            Callee::Direct(name) => name,
            Callee::External(name) => {
                // The presence bits are a *field* on this lane, not a header
                // word, so these four are emitted rather than called: a method
                // in `runtime/jvm` could not reach a generated class's field
                // without reflection. Six instructions each and no call.
                if name.starts_with("nts_presence_") {
                    return self.presence(code, pool, name, args, origin);
                }
                let name = &if self.fused.contains(&value) {
                    crate::fuse::scalar_form(name).unwrap_or(name).to_owned()
                } else {
                    name.clone()
                };
                // The array whose element type picks the overload. For most
                // helpers that is the first argument; `Promise.all` takes the
                // promises first and the values second, and it is the values
                // that carry the payload representation.
                let which = usize::from(name == "nts_promise_all");
                let subject = args.get(which).map(|&first| self.ty(first).clone());
                let element =
                    subject.as_ref().and_then(|ty| self.array_element_descriptor(ty));
                let found = if self.shape.grows {
                    // A growable program has no bare arrays, so every array
                    // helper is a method on a wrapper and the element-width
                    // overloads below do not apply.
                    growable_external(name, element.as_deref().unwrap_or("L"))
                        .map(|(class, member, signature)| (leak(class), member, signature))
                        .or_else(|| external(name))
                } else {
                    external(name)
                        .or_else(|| element.as_deref().and_then(|e| array_external(name, e)))
                };
                // The typed-array family, whose subject may be the *result*
                // rather than an argument -- `nts_view_new` takes a buffer and
                // answers a view. Tried after the tables above and before the
                // refusal, so a name in both would keep the older answer; there
                // is none, and this order makes adding one a visible decision
                // rather than a silent override.
                let found = found.or_else(|| view_helper(name, subject.as_ref(), self.ty(value)));
                if self.integer_to_string(code, pool, name, args, origin)? {
                    return Ok(Placed::OnStack);
                }
                // An index this backend holds as an `int`; see `intcall`. The
                // descriptor is the table's with its return replaced, so the
                // argument spelling stays the one place it is decided.
                // A cursor helper, and this **replaces** the table's answer
                // rather than filling in for it. `nts_map_next` is already in
                // `value_external`, so an `or_else` here never ran: the call
                // emitted the `(D)D` form while the value was held as an `int`
                // and `place` stored one word of the two it pushed. That is
                // exactly "moved the operand stack from 0 to 1", and it named
                // the operation rather than leaving it to be bisected -- which
                // is what that check was added for.
                let cursor_form = crate::intcall::cursor_helper(name).and_then(|(position, _, narrow)| {
                    let cursor_held = position
                        .and_then(|at| args.get(at))
                        .is_some_and(|arg| self.narrowed.contains(arg));
                    if !cursor_held && !self.narrowed.contains(&value) {
                        return None;
                    }
                    Some(match narrow {
                        "nextI" => (types::TABLE, "nextI", CURSOR_NEXT.to_owned()),
                        _ => (types::TABLE, "keyAtI", CURSOR_KEY.to_owned()),
                    })
                });
                let found = cursor_form.or(found);
                let (swapped, object_form) = self.object_key(name, args).unzip();
                let args = swapped.as_deref().unwrap_or(args);
                let found = object_form.or(found);
                // **The owner first, then the name it decides.** These were
                // the other way round, so the name came from one table and the
                // owner from another and nothing related them.
                if self.narrowed.contains(&value)
                    && let Some((owner, _, descriptor)) = &found
                    && let Some(narrow) = crate::intcall::integral_helper(name, owner)
                {
                    let arguments = descriptor.split(')').next().unwrap_or("(").to_owned();
                    for &arg in args {
                        self.load(code, pool, arg)?;
                    }
                    code.invoke_static(origin, pool, owner, narrow, &format!("{arguments})I"));
                    return Ok(Placed::OnStack);
                }
                // **A bound Java member**, which `external` will never have a
                // row for: that table is this repository's own helpers, and
                // this name came out of a jar. The kind travels with the rows
                // on `Program` rather than in the key, because a key that names
                // one method twice is not an identity -- `keeps` looks up the
                // same string.
                if found.is_none() && nts_core::hir::runtime::is_foreign_key(name) {
                    return self.foreign_call(code, pool, name, args, result, origin);
                }
                let Some((owner, member, descriptor)) = found else {
                    // The cause, which is that *this table* has no entry, and
                    // not the remedy, which would be to build the helper.
                    //
                    // Those are different and the difference has already cost
                    // this file once: the coercions were present in
                    // `NtsRuntime` and absent from `core_external`, and the
                    // message said the runtime had not built them. Somebody
                    // reading it goes and writes a method that is already
                    // there. A refusal naming a remedy reads like a plan, and
                    // a plausible plan is worse than no plan when it is wrong.
                    return Err(refuse(
                        self.func,
                        &format!(
                            "a call to `{name}`, {NO_NAME_FOR}"
                        ),
                    ));
                };
                self.push_arguments(code, pool, args, &descriptor, origin)?;
                code.invoke_static(origin, pool, owner, member, &descriptor);
                let returns = descriptor.rsplit(')').next().unwrap_or("").to_owned();
                let returns = returns.as_str();
                if matches!(result, HirType::Void) {
                    Self::drop_answer(code, returns, origin);
                    return Ok(Placed::Stored);
                }
                // A helper that takes an array of references has to declare
                // `Object[]`, and Java arrays are covariant so passing a
                // `Foo[]` to it verifies -- but the result comes back declared
                // `Object[]` and the slot it is stored into is a `Foo[]`. The
                // narrowing the middle end already proved has to be spelled for
                // the verifier, which knows only what the descriptor said.
                // **Not when the value is held as an `int`.** `narrow_result`
                // reconciles the descriptor's return with the HIR type, and a
                // cursor's HIR type is the `f64` `hir::runtime` declares -- so
                // it would widen `nextI`'s answer straight back to a double and
                // undo the representation this lane just chose. The same
                // asymmetry `conversion` had: the mark has to be honoured on
                // the way out as well as on the way in, or the emitter puts a
                // double where its own accounting says an int.
                // **Not when the value is held differently from its
                // declaration**, in either of the two ways this backend does
                // that. `narrow_result` reconciles the descriptor's return with
                // the HIR type, which is right whenever the two are talking
                // about the same representation and wrong when they are not:
                //
                //   a cursor is declared `f64` and held as an `int`, so this
                //   would widen `nextI`'s answer straight back
                //
                //   a fused answer is declared `Erased` and held as a `double`,
                //   so this emits `checkcast NtsValue` against a `double` on
                //   the stack -- which the verifier reports as `Type
                //   double_2nd is not assignable to 'java/lang/Object'` at the
                //   `checkcast`, and which is how `examples/arrays`' `nth`
                //   failed.
                //
                // Both were found the same way: read the listing at the offset
                // the verifier named, rather than reason about which pass had
                // claimed the value.
                if self.wrap_bare_array(code, pool, result, returns, origin) {
                    return Ok(Placed::OnStack);
                }
                let held_as_int = self.narrowed.contains(&value) && returns == "I";
                if !held_as_int && !self.fused.contains(&value) {
                    self.narrow_result(code, pool, result, returns, origin)?;
                }
                return Ok(Placed::OnStack);
            }
            // `invokevirtual` on the receiver's *static* class, by name. The
            // slot is unused: the JVM has its own vtable, and naming the method
            // is what lets C2 devirtualise through class-hierarchy analysis --
            // which is why this lane is expected to win the `dispatch` row
            // rather than merely match it.
            Callee::Virtual { declared, .. } => {
                return self.virtual_call(code, pool, declared, args, result, origin);
            }
            // A closure call is a dispatch like any other, and the only thing
            // that made it different was that there was nothing to dispatch
            // *to*: a function type's layout declared no method, so the base a
            // closure extends had an empty slot.
            //
            // With the signature carrying an `abstract_declaration` in that
            // slot, this is `Callee::Virtual` with the name looked up instead
            // of given -- and the descriptor comes from the declaration rather
            // than from the call's own argument types, so every closure of one
            // type agrees with the base about it by construction.
            Callee::Closure { slot } => {
                return self.closure_call(code, pool, result, *slot, args, origin);
            }
        };
        self.direct_call(code, pool, result, name, args, origin)
    }

    /// Discard a helper's answer where nothing wants it.
    ///
    /// `nts_map_set` returns the map, because that is what `m.set(k, v)`
    /// evaluates to, and a statement that ignores it leaves a reference on the
    /// stack. C discards a return value for free; the JVM has to say so.
    fn drop_answer(code: &mut Code, returns: &str, origin: &nts_semantic_schema::Origin) {
        let words = nts_jvm_emitter::descriptor::words(returns);
        if words > 0 {
            code.pop(origin, words);
        }
    }

    /// A helper that returns a **bare Java array**, in a program that grows one.
    ///
    /// Generated code there holds every array as a growable wrapper, so a
    /// `[Ljava/lang/String;` coming back from the runtime was stored into a
    /// slot typed as the wrapper and threw `ClassCastException:
    /// [Ljava/lang/String; cannot be cast to class nts.rt.NtsArrayL` — at run
    /// time, on a program C and LLVM both agree with node about.
    ///
    /// `nts_str_split` is the only helper this reaches, measured one at a time
    /// rather than reasoned about: `slice`, `concat`, `splice`, `reverse`,
    /// `map`, `filter`, `Array.from`, `Object.keys`, `Object.values`,
    /// `toReversed` and `toSorted` all already answer a wrapper under `grows`.
    ///
    /// The wrap is the one the **bound member** path already makes, with the
    /// same overload rule: method resolution is by exact descriptor, so a
    /// `[Ljava/lang/String;` calls `adopt([Ljava/lang/Object;)` and array
    /// covariance is what makes the argument legal. A primitive array names its
    /// own width, because those are different methods that copy differently.
    ///
    /// `false` where there is nothing to wrap, so the caller carries on.
    fn wrap_bare_array(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        result: &HirType,
        returns: &str,
        origin: &nts_semantic_schema::Origin,
    ) -> bool {
        if !returns.starts_with('[')
            || !self.shape.grows
            || !matches!(result, HirType::Managed(ManagedType::Array(_)))
        {
            return false;
        }
        let Some(want) = types::descriptor(self.shape, result) else {
            return false;
        };
        let Some(wrapper) = want.strip_prefix('L').and_then(|it| it.strip_suffix(';')) else {
            return false;
        };
        let accepts = if returns.starts_with("[L") || returns.starts_with("[[") {
            "[Ljava/lang/Object;"
        } else {
            returns
        };
        code.invoke_static(origin, pool, wrapper, "adopt", &format!("({accepts}){want}"));
        true
    }

    /// The optional-property presence bits, emitted inline.
    ///
    /// `runtime/c` keeps them in the object header's spare flags and reaches
    /// them through four `static inline` helpers. There is no header here, so
    /// they live in an `int` field on the hierarchy's root -- see
    /// `hierarchy::holds_presence` for why the root and not the class named.
    ///
    /// **No shift.** C adds `NTS_PRESENCE_SHIFT` because it shares the word with
    /// `NTS_COLOR_MASK` and three flags below it; nothing shares this field, so
    /// the zero-based index the lowering passes is the bit number directly. That
    /// also gives this lane 32 bits where C has 26.
    ///
    /// `has` answers with `(flags >>> index) & 1` rather than a compare against
    /// zero, because that is already a `Z` on the stack and needs no branch --
    /// the JVM has no instruction that leaves a boolean from a comparison, which
    /// is the whole reason `body.rs` fuses one into its branch.
    fn presence(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        name: &str,
        args: &[ValueId],
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        let [object, index] = args else {
            return Err(refuse(self.func, &format!("`{name}` with the wrong arity")));
        };
        // **The one whose receiver has no declared type to name.** `"k" in v`
        // where `v` is `object` asks about a value whose class arrives at run
        // time, so there is no owner for a `getfield` -- which is what the
        // other four have and what `runtime/c` does not need, its bits being in
        // a header every object carries. A call, through the interface a
        // presence-carrying root implements; see `types::PRESENCE_INTERFACE`.
        //
        // False for a primitive and for `null` alike, because `instanceof` is
        // false for both, which is what lets the lowering put a plain `and`
        // beside the class test instead of blocks for a short circuit.
        if name == "nts_presence_has_value" {
            self.load(code, pool, *object)?;
            if matches!(self.ty(*object), HirType::Erased) {
                code.get_field(origin, pool, types::VALUE, "ref", "Ljava/lang/Object;");
            }
            self.push_as(code, pool, *index, Kind::Int, origin)?;
            code.invoke_static(
                origin,
                pool,
                crate::body::RUNTIME,
                "presenceHas",
                "(Ljava/lang/Object;I)Z",
            );
            return Ok(Placed::OnStack);
        }
        let HirType::Managed(ManagedType::Object(id)) = self.ty(*object).clone() else {
            return Err(refuse(self.func, &format!("`{name}` on a value that is not an object")));
        };
        let Some(layout) = self.program.layout(id) else {
            return Err(refuse(self.func, &format!("`{name}` on a type with no layout")));
        };
        let owner = types::class_name(self.shape.package, crate::hierarchy::root(self.program, layout));
        let field = types::PRESENCE;
        match name {
            "nts_presence_has" | "nts_presence_has_fn" => {
                self.load(code, pool, *object)?;
                code.get_field(origin, pool, &owner, field, "I");
                self.load(code, pool, *index)?;
                code.bitwise(origin, insn::USHR, Kind::Int);
                code.const_int(origin, pool, 1);
                code.bitwise(origin, insn::AND, Kind::Int);
                Ok(Placed::OnStack)
            }
            "nts_presence_init" | "nts_presence_init_fn" => {
                self.load(code, pool, *object)?;
                code.dup(origin);
                code.get_field(origin, pool, &owner, field, "I");
                // A mask, not an index: every optional property a class
                // *declares* is present at construction, because a field
                // declaration defines the property under ES2022 even with no
                // initialiser. One `or` of a constant rather than a call each.
                self.load(code, pool, *index)?;
                code.bitwise(origin, insn::OR, Kind::Int);
                code.put_field(origin, pool, &owner, field, "I");
                Ok(Placed::Stored)
            }
            "nts_presence_set" | "nts_presence_set_fn" => {
                self.load(code, pool, *object)?;
                code.dup(origin);
                code.get_field(origin, pool, &owner, field, "I");
                code.const_int(origin, pool, 1);
                self.load(code, pool, *index)?;
                code.bitwise(origin, insn::SHL, Kind::Int);
                code.bitwise(origin, insn::OR, Kind::Int);
                code.put_field(origin, pool, &owner, field, "I");
                Ok(Placed::Stored)
            }
            "nts_presence_clear" | "nts_presence_clear_fn" => {
                self.load(code, pool, *object)?;
                code.dup(origin);
                code.get_field(origin, pool, &owner, field, "I");
                code.const_int(origin, pool, 1);
                self.load(code, pool, *index)?;
                code.bitwise(origin, insn::SHL, Kind::Int);
                code.const_int(origin, pool, -1);
                code.bitwise(origin, insn::XOR, Kind::Int);
                code.bitwise(origin, insn::AND, Kind::Int);
                code.put_field(origin, pool, &owner, field, "I");
                Ok(Placed::Stored)
            }
            other => Err(refuse(self.func, &format!("`{other}`, which is not a presence helper"))),
        }
    }

    /// `invokevirtual` on the function type's abstract declaration.
    ///
    /// See the note on the `Callee::Closure` arm above for why this is a
    /// dispatch like any other now.
    fn closure_call(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        result: &HirType,
        slot: u32,
        args: &[ValueId],
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        {
            {
                let Some(&receiver) = args.first() else {
                    return Err(refuse(self.func, "a closure call with no receiver"));
                };
                let ty = self.ty(receiver).clone();
                // A merged receiver is held as the base every arm extends, so
                // the call dispatches through that rather than through
                // whichever arm the IR named. Still `invokevirtual`: the base
                // declares the slot abstract, and dispatch resolves on the
                // receiver's real class.
                let owner = match self.joined.get(&receiver) {
                    Some(base) => base.clone(),
                    None => self.object_class(&ty)?,
                };
                let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = ty else {
                    return Err(refuse(self.func, "a closure call on something that is not an object"));
                };
                let Some(layout) = self.program.layout(id) else {
                    return Err(refuse(self.func, "a closure whose layout this program does not carry"));
                };
                let Some(Some(declared)) = layout.methods.get(slot as usize) else {
                    return Err(refuse(
                        self.func,
                        "a closure call through a slot its type declares nothing for",
                    ));
                };
                let Some(target) = self.program.funcs.iter().find(|f| &f.name == declared) else {
                    return Err(refuse(
                        self.func,
                        &format!("a closure call to `{declared}`, which is not in this program"),
                    ));
                };
                let Some(descriptor) = crate::instance_descriptor(self.shape.package, self.program, target) else {
                    return Err(refuse(
                        self.func,
                        &format!("a closure call to `{declared}`, whose signature has no representation"),
                    ));
                };
                let member = crate::hierarchy::member_name(declared);
                for &arg in args {
                    self.load(code, pool, arg)?;
                }
                code.invoke_virtual(origin, pool, &owner, &member, &descriptor);
                // The declaration says what the *type* returns; the call
                // site says what this call wants. `f?.(x)` in a statement asks
                // for nothing from a closure declared to return a double, and
                // a value left on the stack at a block boundary is a frame
                // this backend cannot describe. The external path already
                // reconciles the two; a closure call is the same shape.
                let returns = descriptor.rsplit(')').next().unwrap_or("");
                if matches!(result, HirType::Void) {
                    let words = nts_jvm_emitter::descriptor::words(returns);
                    if words > 0 {
                        code.pop(origin, words);
                    }
                    return Ok(Placed::Stored);
                }
                self.narrow_result(code, pool, result, returns, origin)?;
                Ok(Placed::OnStack)
            }
        }
    }

    /// `invokestatic` on `nts/gen/Program`, which is what most calls are.
    ///
    /// Split out of `call` because the three indirect forms return early and
    /// this one is the fallthrough, so it reads as a tail rather than as a
    /// fourth arm.
    fn direct_call(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        result: &HirType,
        name: &str,
        args: &[ValueId],
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        let Some(target) = self.program.funcs.iter().find(|func| func.name == name) else {
            return Err(refuse(self.func, &format!("a call to `{name}`, which is not in this program")));
        };
        // **A direct call to one closure's body, on a receiver that is not
        // necessarily that closure.**
        //
        // `devirtualize_closures` reads the receiver's declared type and turns
        // the call into a direct one. Where the receiver is a block parameter
        // merging two closures, that declared type is one of the two arms --
        // see `closures` -- so the direct call names one body and gets it wrong
        // whenever the other arm arrived.
        //
        // This is not a JVM problem being worked around. It is a **wrong
        // answer on the native lanes today**: for
        //
        //     let f: Mapper = (v) => v + k;
        //     if (pick) { f = (v) => v * k; }
        //     return f(5);
        //
        // node says 8 for `pick = false` and both C and LLVM say 15, because a
        // pointer cast makes calling the other closure's body with this
        // closure's receiver execute rather than fail. It survives only
        // because both capture one `f64` at offset 0; a pair capturing
        // different shapes would read whatever is there.
        //
        // So the direct call is not honoured. Dispatching through the base
        // every arm extends is what "call this closure, whichever it is"
        // means, and it is what the IR would have emitted had the merge been
        // typed at the signature -- which is a type it already has, with the
        // `call` slot already declared on it. The middle end owns that fix and
        // it is agreed; this is not it, and it must not be read as it -- when
        // the merge is typed correctly, `joined` finds nothing and this arm
        // stops firing on its own.
        let merged = args
            .first()
            .filter(|_| crate::hierarchy::member_name(name) == "call")
            .and_then(|receiver| self.joined.get(receiver).cloned());
        if let Some(base) = merged {
            let Some(descriptor) = crate::instance_descriptor(self.shape.package, self.program, target) else {
                return Err(refuse(
                    self.func,
                    &format!("a closure call to `{name}`, whose signature has no representation"),
                ));
            };
            for &arg in args {
                self.load(code, pool, arg)?;
            }
            code.invoke_virtual(origin, pool, &base, "call", &descriptor);
            let returns = descriptor.rsplit(')').next().unwrap_or("");
            if matches!(result, HirType::Void) {
                let words = nts_jvm_emitter::descriptor::words(returns);
                if words > 0 {
                    code.pop(origin, words);
                }
                return Ok(Placed::Stored);
            }
            self.narrow_result(code, pool, result, returns, origin)?;
            return Ok(Placed::OnStack);
        }
        // An abstract declaration has no static body -- it is `ACC_ABSTRACT`
        // with no `Code` on its class, reached only through `Callee::Virtual`.
        // A *direct* call to one would emit `invokestatic` at a name this
        // backend deliberately does not write, and that is a
        // `NoSuchMethodError` on whatever path first reaches it rather than a
        // verifier error at load: resolution is lazy, so `Verify` forcing
        // linkage over the corpus would not see it either.
        //
        // The C lane gets this check from `-Werror=unused-function` -- but
        // only in the benchmark build, and only in the direction of a body
        // nobody calls. This is the other direction, and it is the one this
        // backend can make loud.
        if target.abstract_declaration {
            return Err(refuse(
                self.func,
                &format!("a direct call to `{name}`, which is abstract and has no body to call"),
            ));
        }
        let Some(signature) = crate::body::signature(self.shape.package, self.program, target) else {
            return Err(refuse(self.func, &format!("a call to `{name}`, whose signature has no representation")));
        };
        // Every argument against the parameter it lands in. The IR relates
        // these types; the class file has to as well, and where `Layout.base`
        // does not say so the JVM refuses the class rather than the call.
        //
        // This is what `examples/absent` hits: a closure whose own layout is
        // `Closure3` passed where the *function type's* layout `Fn109` is
        // declared, with no base relating them because a closure has no
        // `extends` in the source.
        for (&arg, param) in args.iter().zip(&target.params) {
            self.assignable_types(&self.ty(arg).clone(), &param.ty)?;
        }
        for &arg in args {
            self.load(code, pool, arg)?;
        }
        let method = crate::body::method_name(name);
        code.invoke_static(origin, pool, &crate::body::program_class(self.shape.package), &method, &signature);
        // The callee's descriptor says what *it* returns; the IR says what this
        // call site gets, and for a method returning `this` those differ. A
        // `Counter.bump()` called on a `Labelled` is typed `Labelled` by the
        // frontend and emitted as `invokestatic Counter$bump` returning
        // `Counter`, so the verifier sees a `Counter` reaching the next call's
        // `Labelled` parameter and rejects the *class*.
        //
        // It rejected it at load, with a `VerifyError` the differential read as
        // seventeen declined cases and attributed to a bounds check the program
        // does not contain -- there is not one subscript in the file. A lane
        // that refuses loudly still has to be believed about *what* it refused.
        //
        // The narrowing is the same one the external path already spells, for
        // the same reason: the middle end proved it and the descriptor cannot
        // carry it.
        if let Some(want) = types::descriptor(self.shape, result)
            && types::kind(result) == Some(Kind::Ref)
            && signature.rsplit(')').next() != Some(want.as_str())
        {
            code.check_cast(origin, pool, &want);
        }
        Ok(if matches!(result, HirType::Void) {
            Placed::Stored
        } else {
            Placed::OnStack
        })
    }

    fn terminator(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        block: BlockId,
        terminator: &Terminator,
        next: Option<BlockId>,
        fused: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        let origin = self.func.blocks[block.0 as usize]
            .ops
            .last()
            .map_or_else(|| self.func.origin.clone(), |&value| {
                self.func.values[value.0 as usize].origin.clone()
            });
        match terminator {
            Terminator::Return(value) => {
                match value {
                    Some(value) => {
                        // **A return is an assignment to the declared return
                        // type, and it was the one place this was not checked.**
                        // `examples/declared-wider` returns an object allocated
                        // with the base's fields from a function declaring the
                        // wider type, and the JVM answered `VerifyError: Bad
                        // return type` at link -- correct, and a stack trace
                        // rather than the two class names.
                        //
                        // Worth being precise about what it catches, because
                        // the other lanes do not: the caller of that function
                        // writes the wider field on the narrower object, which
                        // on a pointer-cast backend is a heap write past the
                        // end of the allocation.
                        self.assignable_types(self.ty(*value), &self.func.return_type.clone())?;
                        // The *method descriptor's* kind, not the value's. They
                        // agree wherever this backend holds a value in its
                        // declared representation and they are exactly what
                        // `narrow` makes disagree -- and a `return` is one of
                        // the places that reads a value by its declaration, so
                        // it has to say which one it means. Falling back to the
                        // value's kind keeps the old behaviour for a return
                        // type with no `Kind`.
                        let kind = types::kind(&self.func.return_type)
                            .map_or_else(|| self.kind_of(*value), Ok)?;
                        // The one place an accumulator becomes a string. It is
                        // a return rather than any read because a return runs
                        // once per call by construction, and a `toString` that
                        // ran per iteration would reintroduce the quadratic
                        // this representation exists to remove.
                        if self.accumulated.contains(value) {
                            self.load(code, pool, *value)?;
                            code.invoke_virtual(
                                &origin,
                                pool,
                                crate::builder::BUILDER,
                                "toString",
                                "()Ljava/lang/String;",
                            );
                        } else {
                            self.push_as(code, pool, *value, kind, &origin)?;
                        }
                        code.ret(&origin, Some(kind));
                    }
                    None => code.ret(&origin, None),
                }
                Ok(())
            }
            // The JVM has no `__builtin_unreachable`, and its verifier requires
            // every path to end in a transfer. So a claim the compiler made and
            // got wrong becomes a stack trace rather than an optimizer licence
            // to compute anything -- the one place this backend is a better
            // instrument than the other two.
            Terminator::Unreachable | Terminator::FellThrough => {
                code.invoke_static(&origin, pool, RUNTIME, "unreachable", "()Ljava/lang/Error;");
                code.athrow(&origin);
                Ok(())
            }
            Terminator::Jump { target, args } => {
                self.edge(code, pool, *target, args)?;
                if next != Some(*target) {
                    let label = self.labels[target];
                    code.goto(&origin, label);
                }
                Ok(())
            }
            Terminator::Branch { cond, then_target, then_args, else_target, else_args } => {
                let then_copies = self.copies(*then_target, then_args);
                let else_copies = self.copies(*else_target, else_args);
                let then_label = self.labels[then_target];
                let else_label = self.labels[else_target];

                if then_copies.is_empty() && else_copies.is_empty() {
                    // The common shape: no block arguments, so the branch is
                    // one instruction and one arm falls through.
                    if next == Some(*else_target) {
                        self.branch_on(code, pool, *cond, fused, false, then_label)?;
                    } else if next == Some(*then_target) {
                        self.branch_on(code, pool, *cond, fused, true, else_label)?;
                    } else {
                        self.branch_on(code, pool, *cond, fused, false, then_label)?;
                        code.goto(&origin, else_label);
                    }
                    return Ok(());
                }

                // Arms with copies need somewhere to put them, so the true arm
                // gets a label of its own and the false arm falls through.
                let arm = code.label();
                self.branch_on(code, pool, *cond, fused, false, arm)?;
                self.apply(code, pool, else_copies)?;
                code.goto(&origin, else_label);
                code.bind(arm);
                self.apply(code, pool, then_copies)?;
                // The true arm is emitted last, so a jump to the block that
                // follows is a jump to the next instruction. The false arm's
                // `goto` above is *not* elidable the same way: the true arm's
                // code sits between it and its target, so falling through
                // there would run the wrong arm.
                //
                // Half the `goto`s in `Ball$bounce` were this -- seven of
                // fourteen, jumping to the instruction after themselves. The
                // no-copy path a few lines up has always checked; this path
                // never did, so a branch acquired a redundant jump exactly
                // when it carried block-parameter copies.
                if next != Some(*then_target) {
                    code.goto(&origin, then_label);
                }
                Ok(())
            }
        }
    }

    /// Branch on a condition, using the fused comparison where there is one.
    ///
    /// `invert` asks for the branch that is taken when the condition is
    /// *false*, which is what a fallthrough to the true arm needs.
    fn branch_on(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        cond: ValueId,
        fused: Option<ValueId>,
        invert: bool,
        target: Label,
    ) -> Result<(), Diagnostic> {
        let _ = pool;
        let origin = self.func.values[cond.0 as usize].origin.clone();
        if fused == Some(cond) {
            let OpKind::Binary { op, lhs, rhs } = self.func.values[cond.0 as usize].kind else {
                return Err(refuse(self.func, "a fused condition that is not a comparison"));
            };
            let Some(compare) = comparison(op) else {
                return Err(refuse(self.func, "a fused condition that is not a comparison"));
            };
            return self.compare_and_branch(code, pool, Test { compare, negate: invert, lhs, rhs }, target);
        }
        self.load(code, pool, cond)?;
        let compare = if invert { Compare::Eq } else { Compare::Ne };
        code.branch_zero(&origin, compare, target);
        Ok(())
    }

    fn copies(&self, target: BlockId, args: &[ValueId]) -> Vec<Copy> {
        let params = &self.func.blocks[target.0 as usize].params;
        nts_codegen_common::edge_copies(params, args)
    }

    fn edge(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        target: BlockId,
        args: &[ValueId],
    ) -> Result<(), Diagnostic> {
        let _ = pool;
        let copies = self.copies(target, args);
        self.apply(code, pool, copies)
    }

    /// A sequenced parallel copy, as loads and stores.
    ///
    /// The sequencing is `nts_codegen_common`'s, not this backend's -- two
    /// emitters ordering a swap independently is exactly the drift that crate
    /// exists to prevent.
    fn apply(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        copies: Vec<Copy>,
    ) -> Result<(), Diagnostic> {
        for copy in copies {
            match copy {
                Copy::Move { to, from } => {
                    self.assignable(from, to)?;
                    let kind = self.kind_of(from)?;
                    let origin = self.func.values[from.0 as usize].origin.clone();
                    self.load(code, pool, from)?;
                    let Some(slot) = self.slot(to) else {
                        return Err(refuse(self.func, "a block parameter with no storage"));
                    };
                    code.store(&origin, kind, slot);
                }
                Copy::Save { temp, from } => {
                    let kind = self.kind_of(from)?;
                    let origin = self.func.values[from.0 as usize].origin.clone();
                    self.load(code, pool, from)?;
                    let Some(&slot) = self.temps.get(&(temp, kind as u8)) else {
                        return Err(refuse(self.func, "a copy cycle with no scratch slot"));
                    };
                    code.store(&origin, kind, slot);
                }
                Copy::Restore { to, temp } => {
                    let kind = self.kind_of(to)?;
                    let origin = self.func.values[to.0 as usize].origin.clone();
                    let Some(&slot) = self.temps.get(&(temp, kind as u8)) else {
                        return Err(refuse(self.func, "a copy cycle with no scratch slot"));
                    };
                    code.load(&origin, kind, slot);
                    let Some(target) = self.slot(to) else {
                        return Err(refuse(self.func, "a block parameter with no storage"));
                    };
                    code.store(&origin, kind, target);
                }
            }
        }
        Ok(())
    }

    /// The temporal dead zone, as a call rather than a branch.
    ///
    /// The `ready` field is found by *name* in the cell's own layout rather
    /// than by the position `cell_layout` happens to put it in. A cell has one
    /// field when it is unguarded and two when it is guarded, so an index
    /// hard-coded here would read `value` as a boolean on the day an unguarded
    /// cell reached this -- which it cannot today, and "cannot today" is how
    /// index 1 becomes wrong later.
    fn cell_ready(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        cell: ValueId,
        name: &str,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let ty = self.ty(cell).clone();
        let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = ty else {
            return Err(refuse(self.func, "a cell that is not an object"));
        };
        let Some(layout) = self.program.layout(id) else {
            return Err(refuse(self.func, "a cell whose layout this program does not carry"));
        };
        let Some(at) = layout.fields.iter().position(|field| field.name == "ready") else {
            return Err(refuse(self.func, "a guarded cell with no `ready` field"));
        };
        let (owner, member, descriptor, _) = self.field_ref(cell, u32::try_from(at).unwrap_or(0))?;
        self.load(code, pool, cell)?;
        code.get_field(origin, pool, &owner, &member, &descriptor);
        code.const_string(origin, pool, name);
        code.invoke_static(
            origin,
            pool,
            crate::RUNTIME,
            "cellReady",
            "(ZLjava/lang/String;)V",
        );
        Ok(())
    }
}

/// What a refusal calls an operation this slice does not implement.
fn unsupported(kind: &OpKind) -> String {
    match kind {
        OpKind::ConstNull | OpKind::ConstUndefined => "an absent value".to_owned(),
        OpKind::ClosureStatic => "a function used as a value".to_owned(),
        OpKind::CellReady { .. } => "a captured binding".to_owned(),
        OpKind::Retain(_) | OpKind::Release(_) => {
            "reference counting, which the JVM lane must not see: build with the \
             default provider so the platform collector owns the heap"
                .to_owned()
        }
        OpKind::Await { .. } | OpKind::Suspend { .. } => "an `await`".to_owned(),
        OpKind::Yield { .. } => "a `yield`".to_owned(),
        OpKind::Return(_) => "a return operation".to_owned(),
        other => format!("{other:?}"),
    }
}

/// Does every runtime name this backend maps agree with `hir::runtime` about
/// its scalar kinds?
///
/// # Why this direction
///
/// `hir::runtime`'s own header says why the table exists: a helper's signature
/// is C's and fixed, something has to convert, and "one conversion, written in
/// two backends, is two chances to write it differently". The failure it guards
/// is a backend declaring `nts_array_new` takes an `int` where the table says
/// `double` -- the middle end then inserts the wrong conversion for that
/// backend only, and every test that runs the program still passes because the
/// answer is right until the value is large enough.
///
/// The plan asks for "every name in `hir::runtime` has a Java method". That
/// direction cannot be written: `SIGNATURES` is private and only `parameters`
/// and `result` are exported, so the table is queryable and not enumerable.
/// This is the reachable half and the one that catches the defect -- a name
/// this backend maps *wrongly* is worse than one it does not map, which is a
/// refusal.
///
/// # The names come from this file's own text
///
/// A hand-written list is a second copy of the match below and goes stale the
/// first time somebody adds an arm -- which this lane has four records about
/// tonight alone. `include_str!` reads the arms instead, so a new mapping is
/// checked the moment it is written.
#[cfg(test)]
mod agrees_with_hir {
    use super::core_external;
    use nts_core::hir::{self, HirType};

    /// Every `"nts_…"` literal in this file, which is every name the static
    /// tables can match. Prefix-stripped and `format!`-assembled names are
    /// invisible here and are not claimed.
    pub(super) fn mapped_names() -> Vec<&'static str> {
        const SOURCE: &str = include_str!("ops.rs");
        let mut found: Vec<&'static str> = Vec::new();
        let bytes = SOURCE.as_bytes();
        let mut at = 0;
        while let Some(start) = SOURCE[at..].find("\"nts_") {
            let open = at + start + 1;
            let Some(len) = SOURCE[open..].find('"') else { break };
            let name = &SOURCE[open..open + len];
            if name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
                found.push(name);
            }
            at = open + len;
            let _ = bytes;
        }
        found.sort_unstable();
        found.dedup();
        found
    }

    /// The parameter descriptors and the return descriptor of a JVM descriptor.
    fn split(descriptor: &str) -> Option<(Vec<String>, String)> {
        let body = descriptor.strip_prefix('(')?;
        let close = body.find(')')?;
        let (params, result) = (&body[..close], &body[close + 1..]);
        let mut out = Vec::new();
        let mut rest = params;
        while !rest.is_empty() {
            let take = one(rest)?;
            out.push(rest[..take].to_owned());
            rest = &rest[take..];
        }
        Some((out, result.to_owned()))
    }

    /// The length of the field descriptor starting at the front of `rest`.
    fn one(rest: &str) -> Option<usize> {
        let first = rest.as_bytes().first()?;
        Some(match first {
            b'[' => 1 + one(&rest[1..])?,
            b'L' => rest.find(';')? + 1,
            b'B' | b'C' | b'D' | b'F' | b'I' | b'J' | b'S' | b'Z' | b'V' => 1,
            _ => return None,
        })
    }

    /// What `declared` requires of a descriptor at one position, or `None` when
    /// the two are compatible.
    fn disagrees(declared: Option<&HirType>, actual: &str) -> Option<String> {
        let wanted: &[&str] = match declared {
            // Not a scalar: a pointer or an `NtsValue`, neither converted on
            // the way in. Anything that is not a JVM primitive will do.
            None => {
                return if actual.starts_with('L') || actual.starts_with('[') || actual == "V" {
                    None
                } else {
                    Some(format!("a reference, and this backend takes `{actual}`"))
                };
            }
            Some(HirType::Float { bits: 64 }) => &["D"],
            Some(HirType::Float { .. }) => &["F"],
            Some(HirType::Int { bits: 64, .. }) => &["J"],
            // Everything narrower is an `int` on the operand stack, and a
            // boolean is one too -- `types` says so and this must not be a
            // second opinion about it.
            Some(HirType::Int { .. } | HirType::Bool) => &["I", "Z", "B", "S", "C"],
            // A kind this check has no rule for. Silence rather than a guess:
            // asserting against a type nobody has thought about is how a test
            // starts being maintained instead of maintaining.
            Some(_) => return None,
        };
        if wanted.contains(&actual) {
            None
        } else {
            Some(format!("`{}`, and this backend takes `{actual}`", wanted[0]))
        }
    }

    #[test]
    fn every_mapped_name_agrees_about_scalar_kinds() {
        let mut checked = 0_usize;
        let mut wrong: Vec<String> = Vec::new();
        for name in mapped_names() {
            let Some((_, _, descriptor)) = core_external(name) else { continue };
            let Some(declared) = hir::runtime::parameters(name) else { continue };
            let Some((params, result)) = split(descriptor) else {
                wrong.push(format!("{name}: `{descriptor}` is not a descriptor"));
                continue;
            };
            checked += 1;
            if params.len() != declared.len() {
                wrong.push(format!(
                    "{name}: `hir::runtime` declares {} parameter(s) and this backend takes {}",
                    declared.len(),
                    params.len()
                ));
                continue;
            }
            for (at, (want, got)) in declared.iter().zip(params.iter()).enumerate() {
                if let Some(why) = disagrees(want.as_ref(), got) {
                    wrong.push(format!("{name}: parameter {at} should be {why}"));
                }
            }
            if let Some(why) = disagrees(hir::runtime::result(name), &result) {
                wrong.push(format!("{name}: the result should be {why}"));
            }
        }
        assert!(wrong.is_empty(), "{checked} name(s) checked:\n  {}", wrong.join("\n  "));
        // **A floor, because the interesting failure is this loop matching
        // nothing.** `continue` on a name the table does not declare is right
        // and is also how the whole test becomes vacuous -- a rename on either
        // side would leave it passing over zero names, which is the shape this
        // lane has a record about.
        // **30**, measured 2026-09-13, and exact rather than padded, which is
        // this repository's rule for a floor: a drop owes an explanation and
        // then a new number, rather than fitting under a margin somebody chose.
        // It was written as 40 first, from nothing, and the run said 30 -- so
        // the first version of this line was the guess `dexes.sh`'s own comment
        // forbids, in a test written to stop two tables guessing at each other.
        assert!(checked >= 30, "only {checked} name(s) reached the comparison");
    }
}

/// Does the jar actually declare every method this backend emits a call to?
///
/// # The failure this catches, which nothing else does
///
/// `core_external` names a class, a method and a descriptor. The JVM resolves a
/// call by all three, so a Java signature that changes without its row here
/// produces a class that verifies, loads, and throws `NoSuchMethodError` the
/// first time that path runs. Every host Java test stays green -- they call
/// `nts.rt` directly and never through an emitted class -- and the `jvm` gate
/// step only sees it if some example reaches that helper.
///
/// `intrinsics.rs` makes exactly this argument for the networking table and
/// found four refusals doing it. This is the same check for the table that
/// every other call goes through.
///
/// # Against the jar rather than against the sources
///
/// `javap -s` reads the artifact the compiler will actually link against, which
/// is the thing a `NoSuchMethodError` is about. Reading `NtsRuntime.java`
/// instead would agree with a stale jar and say nothing.
#[cfg(test)]
mod signatures {
    use super::core_external;
    use std::collections::BTreeSet;
    use std::path::PathBuf;
    use std::process::Command;

    fn repository() -> PathBuf {
        let from = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
        from.canonicalize().unwrap_or(from)
    }

    fn tool(name: &str) -> Option<PathBuf> {
        if let Ok(home) = std::env::var("JAVA_HOME") {
            let path = PathBuf::from(home).join("bin").join(name);
            if path.exists() {
                return Some(path);
            }
        }
        let found =
            Command::new("sh").arg("-c").arg(format!("command -v {name}")).output().ok()?;
        found.status.success().then(|| {
            PathBuf::from(String::from_utf8_lossy(&found.stdout).trim().to_owned())
        })
    }

    /// Every `(class, method, descriptor)` the jar declares, for the classes
    /// asked about.
    fn declared(javap: &PathBuf, jar: &PathBuf, classes: &BTreeSet<String>) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        let named: Vec<String> = classes.iter().map(|c| c.replace('/', ".")).collect();
        let Ok(dump) = Command::new(javap).arg("-p").arg("-s").arg("-cp").arg(jar).args(&named).output()
        else {
            return out;
        };
        let text = String::from_utf8_lossy(&dump.stdout);
        let (mut class, mut member) = (String::new(), String::new());
        for line in text.lines() {
            let trimmed = line.trim();
            if let Some(at) = trimmed.find(" class ").or_else(|| trimmed.find(" interface ")) {
                let rest = &trimmed[at..];
                if let Some(name) = rest.split_whitespace().nth(1) {
                    class = name.split('<').next().unwrap_or(name).replace('.', "/");
                }
            } else if let Some(rest) = trimmed.strip_prefix("descriptor: ") {
                if !class.is_empty() && !member.is_empty() {
                    out.insert(format!("{class}.{member}{rest}"));
                }
            } else if let Some(open) = trimmed.find('(') {
                // `public static void clearTimeout(double);` -- the identifier
                // immediately before the parenthesis. A constructor is `<init>`
                // in the descriptor line's own terms and is spelled as the class
                // here, which is why the name is taken from the *descriptor*
                // pairing rather than parsed into a signature.
                let head = &trimmed[..open];
                member = head.rsplit_once(' ').map_or(head, |(_, last)| last).to_owned();
            }
        }
        out
    }

    #[test]
    fn every_call_this_backend_emits_exists_in_the_jar() {
        let (Some(javap), jar) =
            (tool("javap"), repository().join("runtime/jvm/nts-runtime.jar"))
        else {
            return;
        };
        if !jar.exists() {
            return;
        }
        let names = super::agrees_with_hir::mapped_names();
        let wanted: Vec<(String, String, String)> = names
            .iter()
            .filter_map(|name| core_external(name))
            .map(|(class, member, descriptor)| {
                (class.to_owned(), member.to_owned(), descriptor.to_owned())
            })
            .collect();
        let classes: BTreeSet<String> = wanted.iter().map(|(c, _, _)| c.clone()).collect();
        let have = declared(&javap, &jar, &classes);
        assert!(!have.is_empty(), "javap named no methods -- this run compared nothing");

        let mut missing: Vec<String> = Vec::new();
        for (class, member, descriptor) in &wanted {
            let key = format!("{class}.{member}{descriptor}");
            if !have.contains(&key) {
                missing.push(key);
            }
        }
        missing.sort_unstable();
        missing.dedup();
        assert!(
            missing.is_empty(),
            "{} call(s) this backend emits are not in the jar:\n  {}",
            missing.len(),
            missing.join("\n  ")
        );
        // **A floor, because `filter_map` over a table that stopped matching is
        // an empty list and a green test.** Measured, not chosen.
        // **73**, measured 2026-09-13. Written as 150 first, from nothing, and
        // the run said 73 -- the second floor guessed in one sitting, in the
        // second test of a pair written to stop two tables guessing at each
        // other. The rule is `dexes.sh`'s and it is easier to quote than to
        // keep: a floor is a number a run produced.
        assert!(wanted.len() >= 73, "only {} call(s) were checked", wanted.len());
    }
}

#[cfg(test)]
mod set_length {
    /// The name `lower` emits resolves, and to a **void** method.
    ///
    /// Added with the entry rather than after it: the lowering that calls this
    /// landed separately, so between the two commits nothing exercised the row
    /// and a typo would have surfaced as `NoSuchMethodError` at run time in
    /// someone else's gate step.
    #[test]
    fn the_name_lower_emits_resolves_to_a_void_method() {
        for (holds, class) in
            [("D", "nts/rt/NtsArrayD"), ("Z", "nts/rt/NtsArrayZ"), ("L", "nts/rt/NtsArrayL")]
        {
            let (owner, method, descriptor) =
                super::growable_external("nts_array_set_length", holds)
                    .unwrap_or_else(|| panic!("no entry for a {holds} array"));
            assert_eq!(owner, class);
            assert_eq!(method, "setLength");
            assert_eq!(descriptor, format!("(L{class};D)V"));
        }

        // `_ref` is the same Java method: the class already came from the
        // argument, so the suffix chooses nothing here.
        assert_eq!(
            super::growable_external("nts_array_set_length_ref", "L"),
            super::growable_external("nts_array_set_length", "L"),
        );
        // And `_value`, which was missing entirely: `xs.length = n` on an
        // `unknown[]` refused with `NTS4001` while C and LLVM compiled it.
        assert_eq!(
            super::growable_external("nts_array_set_length_value", "L"),
            super::growable_external("nts_array_set_length", "L"),
        );

        // The control. A stem that is not in the table must still be `None`,
        // or the assertions above pass on a function that accepts anything.
        assert!(super::growable_external("nts_array_set_width", "D").is_none());
    }
}
