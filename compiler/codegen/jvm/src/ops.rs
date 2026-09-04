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

use crate::body::{Emitter, PROGRAM, Placed, RUNTIME, comparison, refuse};
use crate::types;

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
fn growable_external(name: &str, holds: &str) -> Option<(String, &'static str, String)> {
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
        "push" | "push_ref" => ("push", format!("(L{class};{element})D")),
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
        "fill" | "fill_ref" | "fill_bool" => ("fill", format!("(L{class};{element})L{class};")),
        "reverse" | "reverse_ref" => ("reverse", format!("(L{class};)L{class};")),
        "slice" | "slice_ref" => ("slice", format!("(L{class};DD)L{class};")),
        "concat" | "concat_ref" => ("concat", format!("(L{class};L{class};)L{class};")),
        "extend" | "extend_ref" => ("extend", format!("(L{class};L{class};)L{class};")),
        "splice" | "splice_ref" => ("splice", format!("(L{class};DD)L{class};")),
        "keep_first" => ("keepFirst", format!("(L{class};D)V")),
        "join_str" => ("joinStr", format!("(L{class};Ljava/lang/String;)Ljava/lang/String;")),
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
fn array_external(name: &str, element: &str) -> Option<(&'static str, &'static str, String)> {
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
        "nts_array_at" => (RUNTIME, "arrayAt", format!("({array}D)D")),
        "nts_array_at_value" => {
            (RUNTIME, "arrayAtValue", format!("({array}D)Lnts/rt/NtsValue;"))
        }
        "nts_array_at_ref" => {
            (RUNTIME, "arrayAtRef", format!("({array}D)Ljava/lang/Object;"))
        }
        "nts_array_slice" => (RUNTIME, "arraySlice", format!("({array}DD){result}")),
        "nts_array_reverse" => (RUNTIME, "arrayReverse", format!("({array}){result}")),
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
const MAP_KEY_TO_VALUE: &str = "(Lnts/rt/NtsMap;Lnts/rt/NtsValue;)Lnts/rt/NtsValue;";
const MAP_AT_TO_VALUE: &str = "(Lnts/rt/NtsMap;D)Lnts/rt/NtsValue;";
const BIGINT_BINARY: &str = "(Lnts/rt/NtsBigInt;Lnts/rt/NtsBigInt;)Lnts/rt/NtsBigInt;";
const BIGINT_BITS: &str = "(DLnts/rt/NtsBigInt;)Lnts/rt/NtsBigInt;";
const STRING_STRING_TO_D: &str = "(Ljava/lang/String;Ljava/lang/String;)D";
const STRING_STRING_TO_Z: &str = "(Ljava/lang/String;Ljava/lang/String;)Z";
const STRING_DD_TO_STRING: &str = "(Ljava/lang/String;DD)Ljava/lang/String;";
const STRING_STRING_STRING_TO_STRING: &str =
    "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;";

/// The helpers that are the runtime itself: stopping, filling, coercing,
/// and turning a number into its characters.
fn core_external(name: &str) -> Option<(&'static str, &'static str, &'static str)> {
    Some(match name {
        "nts_uncaught" => (RUNTIME, "uncaught", "(Lnts/rt/NtsValue;Ljava/lang/String;)V"),
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

        "nts_str_at" => (RUNTIME, "strAt", STRING_D_TO_STRING),
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
        "nts_str_index_of" => (RUNTIME, "strIndexOf", STRING_STRING_TO_D),
        "nts_str_last_index_of" => (RUNTIME, "strLastIndexOf", STRING_STRING_TO_D),
        "nts_str_includes" => (RUNTIME, "strIncludes", STRING_STRING_TO_Z),
        "nts_str_starts_with" => (RUNTIME, "strStartsWith", STRING_STRING_TO_Z),
        "nts_str_ends_with" => (RUNTIME, "strEndsWith", STRING_STRING_TO_Z),
        "nts_str_point_width" => (RUNTIME, "strPointWidth", "(Ljava/lang/String;D)D"),
        "nts_str_trim" => (RUNTIME, "strTrim", "(Ljava/lang/String;)Ljava/lang/String;"),
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
        "nts_promise_is_rejected" => (types::PROMISE, "isRejected", "(Lnts/rt/NtsPromise;)Z"),
        "nts_promise_number" => (types::PROMISE, "number", "(Lnts/rt/NtsPromise;)D"),
        "nts_promise_reference" => {
            (types::PROMISE, "reference", "(Lnts/rt/NtsPromise;)Ljava/lang/Object;")
        }
        "nts_promise_value" => {
            (types::PROMISE, "value", "(Lnts/rt/NtsPromise;)Lnts/rt/NtsValue;")
        }

        "nts_map_new" => (types::MAP, "newMap", "(D)Lnts/rt/NtsMap;"),
        "nts_set_new" => (types::MAP, "newSet", "(D)Lnts/rt/NtsMap;"),
        "nts_map_get" => (types::MAP, "get", MAP_KEY_TO_VALUE),
        "nts_map_has" => (types::MAP, "has", "(Lnts/rt/NtsMap;Lnts/rt/NtsValue;)Z"),
        "nts_map_set" => (
            types::MAP,
            "set",
            "(Lnts/rt/NtsMap;Lnts/rt/NtsValue;Lnts/rt/NtsValue;)Lnts/rt/NtsMap;",
        ),
        "nts_set_add" => (
            types::MAP,
            "add",
            "(Lnts/rt/NtsMap;Lnts/rt/NtsValue;)Lnts/rt/NtsMap;",
        ),
        "nts_map_delete" => (types::MAP, "delete", "(Lnts/rt/NtsMap;Lnts/rt/NtsValue;)Z"),
        "nts_map_clear" => (types::MAP, "clear", "(Lnts/rt/NtsMap;)V"),
        "nts_map_size" => (types::MAP, "size", "(Lnts/rt/NtsMap;)D"),
        "nts_map_next" => (types::MAP, "next", "(Lnts/rt/NtsMap;D)D"),
        "nts_map_key_at" => (types::MAP, "keyAt", MAP_AT_TO_VALUE),
        "nts_map_value_at" => (types::MAP, "valueAt", MAP_AT_TO_VALUE),

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
fn external(name: &str) -> Option<(&'static str, &'static str, String)> {
    let found = core_external(name)
        .or_else(|| math_external(name))
        .or_else(|| string_external(name))
        .or_else(|| collection_external(name))?;
    Some((found.0, found.1, found.2.to_owned()))
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
        let placed = match &op.kind {
            // Already in a slot: a parameter by the calling convention, a block
            // parameter because every edge into this block wrote it.
            OpKind::Param(_) | OpKind::BlockParam(_) => return Ok(()),

            OpKind::ConstBool(_) | OpKind::ConstInt(_) | OpKind::ConstFloat(_) => {
                self.constant(code, pool, &op.kind, &op.ty, &origin)?
            }
            OpKind::ConstString(_) | OpKind::Length(_) | OpKind::StringUnitAt { .. } => {
                self.string_operation(code, pool, &op.kind, &op.ty, &origin)?
            }
            OpKind::ArrayNew { .. } | OpKind::ArrayGet { .. } | OpKind::ArraySet { .. } => {
                self.array_operation(code, pool, &op.kind, &op.ty, &origin)?
            }
            OpKind::Erase { .. } | OpKind::TagOf { .. } | OpKind::Unerase { .. } => {
                self.erasure(code, pool, &op.kind, &op.ty, &origin)?
            }
            // The one instance, read back. Built in `<clinit>`; see
            // `closure_singletons`.
            OpKind::ClosureStatic => {
                let class = self.object_class(&op.ty)?;
                let field = format!("closure${}", class.rsplit('/').next().unwrap_or(&class));
                code.get_static(&origin, pool, PROGRAM, &field, &format!("L{class};"));
                Placed::OnStack
            }
            OpKind::ConstNull | OpKind::ConstUndefined => {
                self.absence(code, pool, &op.kind, &op.ty, &origin)?
            }
            OpKind::Binary { op: bin, lhs, rhs } => self.binary(code, pool, &op.ty, *bin, *lhs, *rhs)?,
            OpKind::Unary { op: un, operand } => self.unary(code, pool, &op.ty, *un, *operand)?,
            OpKind::Convert(operand) => {
                self.load(code, *operand)?;
                let from = self.ty(*operand).clone();
                self.convert(code, pool, &from, &op.ty, &origin)?;
                Placed::OnStack
            }

            OpKind::GlobalGet(_) | OpKind::GlobalSet { .. } => {
                self.global(code, pool, &op.kind, &origin)?
            }

            OpKind::Call { callee, args, .. } => self.call(code, pool, &op.ty, callee, args, &origin)?,

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
            OpKind::ObjectNew { .. } => self.object_new(code, pool, &op.ty, &origin)?,
            OpKind::FieldGet { object, field } => {
                let (class, name, descriptor) = self.field_ref(*object, *field)?;
                self.load(code, *object)?;
                code.get_field(&origin, pool, &class, &name, &descriptor);
                Placed::OnStack
            }
            OpKind::FieldSet { object, field, value: stored } => {
                let (class, name, descriptor) = self.field_ref(*object, *field)?;
                self.load(code, *object)?;
                self.load(code, *stored)?;
                code.put_field(&origin, pool, &class, &name, &descriptor);
                return Ok(());
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
                self.load(code, *value)?;
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
                if *self.ty(*value) == HirType::Erased {
                    code.get_field(
                        &origin,
                        pool,
                        types::VALUE,
                        "ref",
                        "Ljava/lang/Object;",
                    );
                }
                code.instance_of(&origin, pool, &types::class_name(layout));
                Placed::OnStack
            }

            // Everything the managed and erased slices bring, refused by name
            // rather than half-emitted -- a backend that writes *something* for
            // every input is one nobody can trust the output of.
            other => return Err(refuse(self.func, &unsupported(other))),
        };

        if placed == Placed::OnStack {
            if let Some(slot) = self.slot(value) {
                let kind = self.kind_of(value)?;
                code.store(&origin, kind, slot);
            } else {
                // Nothing reads it. Discard rather than leave the stack dirty,
                // which `Code::bind` would refuse at the end of the block.
                let words = types::kind(&op.ty).map_or(0, Kind::words);
                if words > 0 {
                    code.pop(&origin, words);
                }
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
        let Some(stored) = storing else {
            code.get_static(origin, pool, PROGRAM, &name, &descriptor);
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
        self.load(code, stored)?;
        code.put_static(origin, pool, PROGRAM, &name, &descriptor);
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
        self.load(code, promise)?;
        self.load(code, frame)?;
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
    fn assignable(&self, from: ValueId, to: ValueId) -> Result<(), Diagnostic> {
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
        let wanted = types::class_name(target_layout);
        if crate::hierarchy::ancestry(self.program, source_layout)
            .iter()
            .any(|ancestor| types::class_name(ancestor) == wanted)
        {
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
            self.load(code, value)?;
            // Unbox before asking for a class; see the single-class arm.
            if *self.ty(value) == HirType::Erased {
                code.get_field(origin, pool, types::VALUE, "ref", "Ljava/lang/Object;");
            }
            code.instance_of(origin, pool, &types::class_name(layout));
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
            return self.load(code, value);
        }
        self.erase(code, pool, value, origin)?;
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
        Err(refuse(self.func, "an absent value with no reference to be"))
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
        kind: &OpKind,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        match kind {
            OpKind::Erase { value } => self.erase(code, pool, *value, origin),
                // A `Void` erases to `undefined` and has nothing to load.
            OpKind::TagOf { value } => {
                self.load(code, *value)?;
                code.get_field(origin, pool, types::VALUE, "tag", "I");
                self.adapt(code, Kind::Int, ty, origin)?;
                Ok(Placed::OnStack)
            }
            OpKind::Unerase { value } => {
                self.load(code, *value)?;
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
                        // Unchecked by construction upstream, but the verifier
                        // needs the narrowing spelled: the field is `Object`.
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
        value: ValueId,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        let from = self.ty(value).clone();
        // A `Void` erases to `undefined` and has nothing to load.
        if matches!(from, HirType::Void) {
            code.get_static(origin, pool, types::VALUE, "UNDEFINED_VALUE", types::VALUE_DESCRIPTOR);
            return Ok(Placed::OnStack);
        }
        self.load(code, value)?;
        let (name, signature) = match &from {
            HirType::Bool => ("ofBoolean", "(Z)Lnts/rt/NtsValue;"),
            HirType::Managed(ManagedType::String) => {
                ("ofString", "(Ljava/lang/String;)Lnts/rt/NtsValue;")
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
    fn array_operation(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        match kind {
            // The wrapper, where the program grows an array anywhere. Every
            // index is a `double` across this boundary, matching the C ABI:
            // that is how it passes a number the compiler knew all along, and
            // it saves a narrowing at each site.
            OpKind::ArrayNew { length, .. } if self.shape.grows => {
                let class = self.growable_class(ty)?;
                self.push_as(code, *length, Kind::Double, origin)?;
                code.invoke_static(origin, pool, &class, "of", &format!("(D)L{class};"));
                Ok(Placed::OnStack)
            }
            OpKind::ArrayGet { array, index, .. } if self.shape.grows => {
                let class = self.growable_class(&self.ty(*array).clone())?;
                let (element, holds) = self.growable_element(&self.ty(*array).clone())?;
                self.load(code, *array)?;
                self.push_as(code, *index, Kind::Double, origin)?;
                code.invoke_static(
                    origin,
                    pool,
                    &class,
                    "get",
                    &format!("(L{class};D){element}"),
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
            OpKind::ArraySet { array, index, value, .. } if self.shape.grows => {
                let class = self.growable_class(&self.ty(*array).clone())?;
                let (element, holds) = self.growable_element(&self.ty(*array).clone())?;
                self.load(code, *array)?;
                self.push_as(code, *index, Kind::Double, origin)?;
                if holds == Kind::Ref {
                    self.load(code, *value)?;
                } else {
                    self.push_as(code, *value, holds, origin)?;
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
                self.subscript(code, *length, origin)?;
                code.new_array(origin, pool, &element);
                Ok(Placed::OnStack)
            }
            OpKind::ArrayGet { array, index, checked } => {
                let element = self.element_descriptor(&self.ty(*array).clone())?;
                self.load(code, *array)?;
                self.checked_subscript(code, pool, *array, *index, *checked, origin)?;
                code.array_load(origin, &element);
                Ok(Placed::OnStack)
            }
            OpKind::ArraySet { array, index, value, checked } => {
                let element = self.element_descriptor(&self.ty(*array).clone())?;
                self.load(code, *array)?;
                self.checked_subscript(code, pool, *array, *index, *checked, origin)?;
                self.load(code, *value)?;
                code.array_store(origin, &element);
                Ok(Placed::Stored)
            }
            _ => Err(refuse(self.func, "an array operation this backend does not spell")),
        }
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
        array: ValueId,
        index: ValueId,
        checked: bool,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        if !checked {
            return self.subscript(code, index, origin);
        }
        self.push_as(code, index, Kind::Double, origin)?;
        // The length, which `bounds` needs and which is one instruction here.
        self.load(code, array)?;
        code.array_length(origin);
        code.convert(origin, insn::I2D, Kind::Int, Kind::Double);
        code.invoke_static(origin, pool, RUNTIME, "bounds", "(DD)I");
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
        value: ValueId,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        self.push_as(code, value, Kind::Int, origin)
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
        value: ValueId,
        wanted: Kind,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        self.load(code, value)?;
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
    fn string_operation(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
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
                code.const_string(origin, pool, text);
                Ok(Placed::OnStack)
            }
            // `String.length()` is an `int`; the middle end types a length as a
            // double, having been told once that it is a `uint32_t` and worth
            // 4.0x to say so. The widening is explicit here for the same reason
            // the coercion's is: the slot the middle end chose is the slot.
            OpKind::Length(of) if matches!(self.ty(*of), HirType::Managed(ManagedType::String)) => {
                self.load(code, *of)?;
                code.invoke_virtual(origin, pool, types::STRING, "length", "()I");
                self.adapt(code, Kind::Int, ty, origin)?;
                Ok(Placed::OnStack)
            }
            // `map.size` and `set.size` are the same operation on the same
            // class, and neither is an `arraylength` -- which is what every
            // non-string `Length` used to become, silently, until the verifier
            // said "invalid type NtsMap".
            OpKind::Length(of)
                if matches!(
                    self.ty(*of),
                    HirType::Managed(ManagedType::Map(..) | ManagedType::Set(_))
                ) =>
            {
                self.load(code, *of)?;
                code.invoke_static(origin, pool, types::MAP, "size", "(Lnts/rt/NtsMap;)D");
                self.adapt(code, Kind::Double, ty, origin)?;
                Ok(Placed::OnStack)
            }
            OpKind::Length(of)
                if self.shape.grows
                    && matches!(self.ty(*of), HirType::Managed(ManagedType::Array(_))) =>
            {
                let class = self.growable_class(&self.ty(*of).clone())?;
                self.load(code, *of)?;
                code.invoke_static(origin, pool, &class, "length", &format!("(L{class};)D"));
                self.adapt(code, Kind::Double, ty, origin)?;
                Ok(Placed::OnStack)
            }
            OpKind::Length(of) if matches!(self.ty(*of), HirType::Managed(ManagedType::Array(_))) => {
                self.load(code, *of)?;
                code.array_length(origin);
                self.adapt(code, Kind::Int, ty, origin)?;
                Ok(Placed::OnStack)
            }
            // Anything else has no length this backend knows how to take, and
            // saying so beats reaching for the array instruction.
            OpKind::Length(of) => Err(refuse(
                self.func,
                &format!("the length of {}", types::describe(&self.ty(*of).clone())),
            )),
            // Out of range JavaScript answers `NaN` where `charAt` throws, and a
            // fractional index truncates rather than being an error. Where the
            // compiler proved the index in range neither applies, so `charAt`
            // is called directly and the helper is not in the program.
            OpKind::StringUnitAt { string, index, checked } => {
                self.load(code, *string)?;
                if *checked {
                    self.push_as(code, *index, Kind::Double, origin)?;
                    code.invoke_static(origin, pool, RUNTIME, "charCodeAt", "(Ljava/lang/String;D)D");
                    self.adapt(code, Kind::Double, ty, origin)?;
                } else {
                    self.push_as(code, *index, Kind::Int, origin)?;
                    code.invoke_virtual(origin, pool, types::STRING, "charAt", "(I)C");
                    self.adapt(code, Kind::Int, ty, origin)?;
                }
                Ok(Placed::OnStack)
            }

            _ => Err(refuse(self.func, "a string operation this backend does not spell")),
        }
    }

    /// A literal, in whichever width the middle end gave it.
    fn constant(
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
        Ok(types::class_name(layout))
    }

    /// The owning class, member name and descriptor of one field.
    ///
    /// Read from the *object's* layout by index, because `FieldSet`/`FieldGet`
    /// carry a position rather than a name -- the position `codegen_common`'s
    /// layout decided, so that no two backends can disagree about which field
    /// is which.
    fn field_ref(&self, object: ValueId, field: u32) -> Result<(String, String, String), Diagnostic> {
        let ty = self.ty(object).clone();
        let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = ty else {
            return Err(refuse(self.func, "a field of something that is not an object"));
        };
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
        let Some(descriptor) = types::descriptor(self.shape, &entry.ty) else {
            return Err(refuse(
                self.func,
                &format!("a field of unrepresentable type: {}", types::describe(&entry.ty)),
            ));
        };
        Ok((
            types::class_name(owner),
            crate::body::method_name(&entry.name),
            descriptor,
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
            self.load(code, lhs)?;
            self.load(code, rhs)?;
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
                self.load(code, lhs)?;
                self.load(code, rhs)?;
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
        self.load(code, lhs)?;
        self.load(code, rhs)?;
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

    fn binary(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        result: &HirType,
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

        let kind = types::kind(result)
            .ok_or_else(|| refuse(self.func, "an arithmetic result of unrepresentable type"))?;
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
        // The narrowing is exact rather than a conversion: `|` applies
        // `ToInt32` to both operands first, so what reaches here is an integral
        // value that was *widened* to a double, and `d2i` undoes the widening.
        // Same reason C's cast is exact.
        if matches!(
            op,
            BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr
        ) && matches!(kind, Kind::Double | Kind::Float)
        {
            self.push_as(code, lhs, Kind::Int, &origin)?;
            self.push_as(code, rhs, Kind::Int, &origin)?;
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
        self.load(code, lhs)?;
        self.load(code, rhs)?;
        match op {
            BinOp::Add => code.arithmetic(&origin, insn::ADD, kind),
            BinOp::Sub => code.arithmetic(&origin, insn::SUB, kind),
            BinOp::Mul => code.arithmetic(&origin, insn::MUL, kind),
            BinOp::Div | BinOp::Rem if matches!(kind, Kind::Int | Kind::Long) => {
                // `idiv` throws on a zero divisor where C is undefined, and
                // nothing upstream proves the divisor non-zero. One helper
                // rather than a guard at every site.
                let (name, signature) = match (op, kind) {
                    (BinOp::Div, Kind::Long) => ("ldiv", "(JJ)J"),
                    (BinOp::Rem, Kind::Long) => ("lrem", "(JJ)J"),
                    (BinOp::Div, _) => ("idiv", "(II)I"),
                    (_, _) => ("irem", "(II)I"),
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
            self.load(code, lhs)?;
            self.load(code, rhs)?;
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
            self.load(code, lhs)?;
            self.load(code, rhs)?;
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
            self.load(code, lhs)?;
            self.load(code, rhs)?;
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
        self.load(code, lhs)?;
        self.load(code, rhs)?;
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
                self.load(code, operand)?;
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
                self.push_as(code, operand, kind, &origin)?;
                code.negate(&origin, kind);
                kind
            }
            // `!x` on a boolean, which is an `int` that is 0 or 1.
            UnOp::Not => {
                self.push_as(code, operand, Kind::Int, &origin)?;
                code.const_int(&origin, pool, 1);
                code.bitwise(&origin, insn::XOR, Kind::Int);
                Kind::Int
            }
            UnOp::ToInt32 | UnOp::ToUint32 => {
                self.load(code, operand)?;
                self.coercion(code, pool, op, from, result, &origin)?;
                // `coercion` lands the value in the result's own kind, having
                // been told what it is.
                kind
            }
            UnOp::Floor | UnOp::Ceil | UnOp::Sqrt | UnOp::Trunc | UnOp::Round => {
                self.push_as(code, operand, Kind::Double, &origin)?;
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
                self.push_as(code, operand, kind, &origin)?;
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
            self.load(code, operand)?;
            return Ok(Placed::OnStack);
        }
        // Emptiness, not nullness -- and a null one is falsy too, so a length
        // check alone throws on the case it is meant to answer.
        if matches!(self.ty(operand), HirType::Managed(ManagedType::String)) {
            self.load(code, operand)?;
            code.invoke_static(&origin, pool, RUNTIME, "stringTruthy", "(Ljava/lang/String;)Z");
            return Ok(Placed::OnStack);
        }
        if *self.ty(operand) == HirType::Erased {
            self.load(code, operand)?;
            code.invoke_static(&origin, pool, types::VALUE, "truthy", "(Lnts/rt/NtsValue;)Z");
            return Ok(Placed::OnStack);
        }
        // Every other reference is truthy exactly when it is there. An empty
        // array is truthy and so is an object with no fields -- emptiness is a
        // string rule and only a string rule, which is why that case is above
        // this one rather than folded into it.
        if kind == Kind::Ref {
            self.load(code, operand)?;
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
                self.load(code, operand)?;
                code.branch_zero(&origin, Compare::Eq, falsy);
            }
            Kind::Long => {
                self.load(code, operand)?;
                code.const_long(&origin, pool, 0);
                code.compare(&origin, insn::LCMP, Kind::Long);
                code.branch_zero(&origin, Compare::Eq, falsy);
            }
            Kind::Float | Kind::Double => {
                // `x != x` is the NaN test, and it must come first: `NaN != 0`
                // is true, so testing against zero alone calls NaN truthy.
                self.load(code, operand)?;
                self.load(code, operand)?;
                code.branch_float(&origin, Compare::Ne, kind, falsy);
                self.load(code, operand)?;
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
            _ => return Err(refuse(self.func, "a conversion this backend has no opcode for")),
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

    fn call(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        result: &HirType,
        callee: &Callee,
        args: &[ValueId],
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        let name = match callee {
            Callee::Direct(name) => name,
            Callee::External(name) => {
                // The array whose element type picks the overload. For most
                // helpers that is the first argument; `Promise.all` takes the
                // promises first and the values second, and it is the values
                // that carry the payload representation.
                let which = usize::from(name == "nts_promise_all");
                let subject = args.get(which).map(|&first| self.ty(first).clone());
                let element = subject
                    .as_ref()
                    .and_then(|ty| self.array_element_descriptor(ty));
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
                let Some((owner, member, descriptor)) = found else {
                    return Err(refuse(
                        self.func,
                        &format!("a call to `{name}`, which needs a runtime this slice has not built"),
                    ));
                };
                for &arg in args {
                    self.load(code, arg)?;
                }
                code.invoke_static(origin, pool, owner, member, &descriptor);
                let returns = descriptor.rsplit(')').next().unwrap_or("").to_owned();
                let returns = returns.as_str();
                if matches!(result, HirType::Void) {
                    // A helper whose answer nothing wants. `nts_map_set`
                    // returns the map, because that is what `m.set(k, v)`
                    // evaluates to, and a statement that ignores it leaves a
                    // reference on the stack. C discards a return value for
                    // free; the JVM has to say so.
                    let words = nts_jvm_emitter::descriptor::words(returns);
                    if words > 0 {
                        code.pop(origin, words);
                    }
                    return Ok(Placed::Stored);
                }
                // A helper that takes an array of references has to declare
                // `Object[]`, and Java arrays are covariant so passing a
                // `Foo[]` to it verifies -- but the result comes back declared
                // `Object[]` and the slot it is stored into is a `Foo[]`. The
                // narrowing the middle end already proved has to be spelled for
                // the verifier, which knows only what the descriptor said.
                if let Some(want) = types::descriptor(self.shape, result)
                    && want != returns
                    && types::kind(result) == Some(Kind::Ref)
                {
                    code.check_cast(origin, pool, &want);
                }
                return Ok(Placed::OnStack);
            }
            // `invokevirtual` on the receiver's *static* class, by name. The
            // slot is unused: the JVM has its own vtable, and naming the method
            // is what lets C2 devirtualise through class-hierarchy analysis --
            // which is why this lane is expected to win the `dispatch` row
            // rather than merely match it.
            Callee::Virtual { declared, .. } => {
                let Some(&receiver) = args.first() else {
                    return Err(refuse(self.func, "a virtual call with no receiver"));
                };
                let owner = self.object_class(&self.ty(receiver).clone())?;
                let Some(target) = self.program.funcs.iter().find(|f| &f.name == declared) else {
                    return Err(refuse(
                        self.func,
                        &format!("a virtual call to `{declared}`, which is not in this program"),
                    ));
                };
                let Some(descriptor) = crate::instance_descriptor(self.program, target) else {
                    return Err(refuse(
                        self.func,
                        &format!("a virtual call to `{declared}`, whose signature has no representation"),
                    ));
                };
                for &arg in args {
                    self.load(code, arg)?;
                }
                let member = crate::hierarchy::member_name(declared);
                code.invoke_virtual(origin, pool, &owner, &member, &descriptor);
                return Ok(if matches!(result, HirType::Void) {
                    Placed::Stored
                } else {
                    Placed::OnStack
                });
            }
            Callee::Closure { .. } => {
                return Err(refuse(self.func, "a call through a closure"));
            }
        };
        let Some(target) = self.program.funcs.iter().find(|func| &func.name == name) else {
            return Err(refuse(self.func, &format!("a call to `{name}`, which is not in this program")));
        };
        let Some(signature) = crate::body::signature(self.program, target) else {
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
            self.load(code, arg)?;
        }
        let method = crate::body::method_name(name);
        code.invoke_static(origin, pool, PROGRAM, &method, &signature);
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
                        self.load(code, *value)?;
                        let kind = self.kind_of(*value)?;
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
                self.apply(code, else_copies)?;
                code.goto(&origin, else_label);
                code.bind(arm);
                self.apply(code, then_copies)?;
                code.goto(&origin, then_label);
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
        self.load(code, cond)?;
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
        self.apply(code, copies)
    }

    /// A sequenced parallel copy, as loads and stores.
    ///
    /// The sequencing is `nts_codegen_common`'s, not this backend's -- two
    /// emitters ordering a swap independently is exactly the drift that crate
    /// exists to prevent.
    fn apply(&mut self, code: &mut Code, copies: Vec<Copy>) -> Result<(), Diagnostic> {
        for copy in copies {
            match copy {
                Copy::Move { to, from } => {
                    self.assignable(from, to)?;
                    let kind = self.kind_of(from)?;
                    let origin = self.func.values[from.0 as usize].origin.clone();
                    self.load(code, from)?;
                    let Some(slot) = self.slot(to) else {
                        return Err(refuse(self.func, "a block parameter with no storage"));
                    };
                    code.store(&origin, kind, slot);
                }
                Copy::Save { temp, from } => {
                    let kind = self.kind_of(from)?;
                    let origin = self.func.values[from.0 as usize].origin.clone();
                    self.load(code, from)?;
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
        OpKind::Return(_) => "a return operation".to_owned(),
        other => format!("{other:?}"),
    }
}
