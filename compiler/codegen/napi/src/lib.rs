//! The Node-API wrapper: how a compiled program is called from JavaScript.
//!
//! # Why this exists, and why it is not a backend
//!
//! Node's test suite is the only conformance oracle for a `node:*` module that
//! we did not write ourselves, and it is JavaScript: it does `require('path')`
//! and asserts. To run it against a compiled program, the program has to be
//! *callable from JavaScript*.
//!
//! The alternative — running our TypeScript on node and hand-writing a JS
//! stand-in for every native binding — tests neither the C nor the compiler,
//! and each stand-in is a second implementation free to drift from the one that
//! ships. This tests the artifact.
//!
//! Node is a test harness here, not a runtime. Nothing this emits enters a
//! shipped binary, and a shipped binary still links no engine.
//!
//! # What it emits
//!
//! More C, calling the C that [`nts_codegen_c`] already emitted. Symbol
//! spellings come from that crate's [`c_identifier`] rather than being spelled
//! again here, because two spellings of one name is how a linker finds out the
//! two disagree.

use nts_codegen_c::{c_global, c_identifier, c_member};
use std::fmt::Write as _;

use nts_core::hir::{self, HirType, ManagedType};
use rustc_hash::FxHashSet;

/// A wrapper this cannot write, and why.
#[derive(Debug)]
pub struct Skipped {
    pub function: String,
    pub reason: String,
}

/// The generated addon, and what it left out.
#[derive(Debug)]
pub struct Addon {
    pub source: String,
    pub skipped: Vec<Skipped>,
}

/// The file name the addon source is conventionally written to.
pub const ADDON_SOURCE_NAME: &str = "addon.c";

/// How a value of this type crosses the boundary.
enum Cross {
    Number,
    Bool,
    Str,
    /// An array, by how its elements cross. A JavaScript array, copied.
    ///
    /// It was `Numbers` and it was `number[]` only, which made it the shape of
    /// the whole boundary rather than one case in it: **`number[]` was the only
    /// array that could return at all**, across 71 signatures in ten of node's
    /// modules -- `fs` 18, `util` 11, `stream` 10 -- where the elements differ
    /// in nothing but their type.
    ///
    /// A copy in both directions, for the reason the old comment gave: a handle
    /// would mean deciding who owns the storage afterwards, which is the
    /// question `ArrayBuffer` is refused over.
    Elements(Box<Cross>),
    /// A record, by index into the program's layouts. Crosses as a plain
    /// JavaScript object of its fields.
    Object(usize),
    /// A typed array. Crosses **outward only**, as a copy, for the reason
    /// [`Cross::Elements`] is copied: a handle would hand out this heap's
    /// storage and make ownership a question both sides answer. Copying does
    /// not ask it.
    ///
    /// Inbound is the direction that cannot be copied into, because the storage
    /// would have to be allocated here -- the same asymmetry [`Cross::Object`]
    /// has, and refused in the same place with the same words.
    Bytes,
    /// A string-keyed table, crossing outward as a plain JavaScript object.
    ///
    /// Carries nothing, and the absence is the point. `Elements` carries its
    /// element crossing because an array's C representation differs per element
    /// type and the wrapper has to spell one. A table's does not: entries are
    /// erased values, so `nts_to_napi_entries` reads the tag at run time and
    /// one conversion serves every value kind.
    ///
    /// The value's crossing still *decides* whether a table may cross at all --
    /// `cross` computes it and refuses a table whose values cannot go -- but
    /// that is an admission test, and a variant that stored its answer would be
    /// claiming to carry data no wrapper ever reads. Clippy said so before a
    /// person did.
    Entries,
    /// A value whose type the declaration did not fix.
    ///
    /// `unknown` crossing in either direction, carrying its tag. Primitives
    /// only: an object has no representation on this side and a reference on
    /// the way out has an identity the far side cannot reproduce, so both are
    /// refused loudly rather than answered with `undefined`.
    Erased,
    Void,
}

/// Which array-building helper an element kind uses.
///
/// One per kind rather than one generic loop taking a function pointer: the
/// slots differ in *width* -- a `double` array and a reference array are not
/// the same memory -- so a shared loop would need the width as data anyway and
/// would read each slot through a cast the compiler could not check.
fn elements_helper(inner: &Cross, layouts: &[hir::Layout]) -> String {
    match inner {
        Cross::Str => "nts_to_napi_strings".to_owned(),
        Cross::Bool => "nts_to_napi_booleans".to_owned(),
        Cross::Object(at) => format!("nts_to_napi_array_of_{}", c_identifier(&layouts[*at].name)),
        // Every other kind is refused in `cross`, so reaching one is a bug
        // there rather than a shape to handle here.
        _ => "nts_to_napi_numbers".to_owned(),
    }
}

// Several types answer `None` and each answers it for its own reason. Merged
// into one arm the reasons would be gone, and the next type to arrive would
// join a list rather than be decided about -- which is what the wildcard this
// replaced was doing.
#[allow(clippy::match_same_arms)]
/// Whether an object layout can be copied out to JavaScript as a plain object.
///
/// Lifted out of [`cross`]'s object arm when it stopped being one level deep.
/// Everything it refuses, it refused there first.
///
/// A class instance is more than its fields: its methods are how it is used, and
/// a plain object of the data would answer `stats.isDirectory` with `undefined`
/// rather than with an error. Better to have no wrapper than a wrapper that
/// loses behaviour.
///
/// `any(is_some)` rather than `!is_empty()`, and the difference is not pedantic:
/// `Layout::methods` is one slot per *dispatch slot* and `None` is "this layout
/// implements that slot" -- so a table can be six entries long and hold nothing.
/// `path`'s `ParsedPath` is exactly that, `[None, None, None, None, None, None]`
/// over five string fields and no methods of its own, and the length test
/// refused it as though copying it would lose behaviour there is none of. That
/// refusal was `parse` -- 26 of the 54 remaining divergences in `path`'s edge
/// table, declined by a table of nulls.
///
/// A **table** field is a plain object on the other side and so is no more
/// nested than a string is: its entries are erased values and
/// `nts_to_napi_entries` needs nothing but the table. `os.constants` is a number
/// and four of them.
///
/// A nested **object** field used to be the wall, and is not one any more.
/// `os.cpus()` returns `CpuInfo[]`, and `CpuInfo` holds a `CpuTimes` -- so the
/// refusal was one level of nesting, on the last function keeping `os` from
/// whole. `emit_object_helper` already calls itself for an array of objects;
/// a field is the same call without the loop.
fn object_crosses(
    at: usize,
    layouts: &[hir::Layout],
    classes: &FxHashSet<String>,
    path: &mut Vec<usize>,
) -> bool {
    // The cycle guard, and it is the current *chain* rather than a visited set
    // on purpose. A layout reached twice down two different fields is fine and
    // has to stay allowed; a layout that reaches itself has no finite JavaScript
    // object to build and no terminating helper to emit. Only the chain tells
    // those apart, and a visited set would refuse the first as though it were
    // the second.
    //
    // A `Vec` because these chains are two or three deep -- `CpuInfo` ->
    // `CpuTimes` and stop -- and scanning three is cheaper than hashing one.
    if path.contains(&at) {
        return false;
    }
    let layout = &layouts[at];
    if classes.contains(&layout.name)
        || layout.base.is_some()
        || layout.methods.iter().any(Option::is_some)
    {
        return false;
    }
    // A layout with no fields at all, which is refused for a reason the class
    // rule above should have covered and cannot.
    //
    // `export const ucs2 = { decode, encode }` gives each function-typed field
    // an ordinary layout with a `Fn2__2#call`, and `classes` is built from the
    // `#` in that name -- so the class rule is exactly right about it. But
    // nothing calls `Fn2__2#call`, so **it is dead-code eliminated before this
    // runs**, and `class_names` over the prepared program has never heard of it.
    // The only evidence that the layout was callable is a function that is gone.
    //
    // So this is conservative rather than precise, and the imprecision is worth
    // naming: a genuinely empty object would cross as `{}` correctly and is
    // refused here too. What it buys is that a layout with nothing to copy can
    // never be copied, and a function crossing as `{}` -- publishing `ucs2`
    // whose `decode` is an empty object -- is exactly the wrong-value failure
    // the boundary refuses everywhere else. Losing `{}` is not a loss; shipping
    // a callable as a plain object is.
    //
    // The precise rule wants a `Layout` that says whether its type is callable,
    // which survives elimination because it is a property of the type rather
    // than of a function body. That is a `compiler/core` change every backend
    // reads, so it is coordinated rather than taken here.
    if layout.fields.is_empty() {
        return false;
    }
    path.push(at);
    let crosses = layout.fields.iter().all(|field| match &field.ty {
        HirType::Bool | HirType::Float { .. } | HirType::Int { .. } => true,
        HirType::Managed(ManagedType::String | ManagedType::Table(_, _)) => true,
        // A closure is a synthetic object layout whose JavaScript value is a
        // function, excluded here for the reason `cross` excludes it one level
        // up: copying captured fields into a plain object would silently change
        // what the value is.
        HirType::Managed(ManagedType::Object(id)) if !hir::is_closure_type(*id) => layouts
            .iter()
            .position(|nested| nested.types.contains(id))
            .is_some_and(|nested| object_crosses(nested, layouts, classes, path)),
        _ => false,
    });
    path.pop();
    crosses
}
// Nine arms answer `None`, and they stay nine rather than becoming one.
//
// Each carries the reason its own type cannot cross -- a `Date` would have to
// become a JavaScript date and lose identity, a `Promise` has no settled value
// to hand over, a `Map` is not a plain object. Folding them into an or-pattern
// keeps the behaviour and deletes the only place any of that is written down,
// and the next person to ask "why not a Date?" would have nowhere to look.
//
// The lint began firing when the object arm shrank from fifty lines to three,
// which is to say it is a distance heuristic and not a claim about the code.
#[allow(clippy::match_same_arms)]
fn cross(ty: &HirType, layouts: &[hir::Layout], classes: &FxHashSet<String>) -> Option<Cross> {
    match ty {
        HirType::Void => Some(Cross::Void),
        HirType::Bool => Some(Cross::Bool),
        HirType::Float { .. } | HirType::Int { .. } => Some(Cross::Number),
        HirType::Managed(ManagedType::String) => Some(Cross::Str),
        // A symbol's identity is the address of a cell in *this* runtime, so
        // handing one across the boundary would hand out an address whose
        // meaning the other side cannot reproduce -- `Symbol.for` on the far
        // side is a different registry. Refused rather than marshalled.
        HirType::Managed(ManagedType::Symbol) => None,
        // A `Date` crossing the boundary would have to become a JavaScript
        // `Date`, which is a construction on the other side rather than a
        // handle to this one. Refused rather than marshalled as its number.
        HirType::Managed(ManagedType::Date) => None,
        // An `ArrayBuffer`'s bytes could cross -- N-API has
        // `napi_create_external_arraybuffer` for exactly this shape -- but
        // handing them over means deciding who owns them afterwards, and a
        // buffer that both sides may resize or detach is a lifetime question
        // rather than a marshalling one. Refused until that is answered, not
        // because it is hard to convert.
        HirType::Managed(
            ManagedType::Buffer
            | ManagedType::DataView
            // And one whose element the declaration did not name, for the same
            // unanswered question plus a second: the wrapper would have to
            // decide what to hand back without knowing the width.
            | ManagedType::AnyView,
        ) => None,
        // A view crosses outward, as a copy. The lifetime question the buffer
        // is still refused over is a question about a *shared* block; a copy
        // does not share one, so it does not have to answer it. Inbound stays
        // refused, where the storage would have to be allocated on this side.
        //
        // This is not a `string_decoder` accommodation. 66 signatures across
        // nine of node's modules return a view, and `buffer`, `stream`, `fs`
        // and `zlib` are largely made of them -- so it is a boundary primitive
        // that four large modules cannot cross without, and the narrow version
        // of it would have been the same work at a worse scope.
        HirType::Managed(ManagedType::View(_)) => Some(Cross::Bytes),
        // A `number[]` crosses as a copy. `Param::shape` carries `Rest` now, so
        // the reason this used to refuse -- that HIR did not distinguish
        // `...args: number[]` from `args: number[]`, and treating both as rest
        // made an ordinary array parameter swallow every remaining argument --
        // no longer holds; `wrapper` asks the shape instead.
        //
        // Only `number[]`. An array of references is a copy whose elements each
        // need marshalling and whose ownership question is per element, and an
        // array of anything narrower than a double is the same work again with
        // a width; neither is answered by the same rule.
        HirType::Managed(ManagedType::Array(element)) => {
            // The elements decide it, which is the whole of the change: an
            // array crosses when the thing in it does. An element this cannot
            // marshal one at a time still refuses -- an object needs its
            // layout's descriptor to rebuild and a view has the ownership
            // question -- but the refusal is now the element's rather than the
            // array's, so it moves when the element does.
            let inner = cross(element, layouts, classes)?;
            matches!(
                inner,
                Cross::Number | Cross::Bool | Cross::Str | Cross::Object(_)
            )
            .then(|| Cross::Elements(Box::new(inner)))
        }
        // A promise has no synchronous crossing: its value does not exist yet.
        // Handing one to JavaScript means creating a napi deferred and resolving
        // it when the promise settles, which is a threadsafe-function design
        // rather than a marshalling rule.
        HirType::Managed(ManagedType::Promise(_)) => None,
        // Node-API has `napi_create_bigint_words`, so a `bigint` *can* cross --
        // but it crosses as an arbitrary-precision value, and this compiler's
        // is 128 bits. Answering `None` keeps the boundary honest until the two
        // agree about what a `bigint` is.
        HirType::BigInt => None,
        // A `Map` or a `Set` crossing is a copy, not a handle: JavaScript's are
        // engine objects with their own storage, so there is no wrapping a
        // runtime table in one. Every entry would have to be built on the other
        // side -- and each key and value is an `NtsValue`, so it is the erased
        // case below repeated per entry.
        //
        // Answering `None` leaves that decision where the erased one is, rather
        // than half-making it here.
        HirType::Managed(ManagedType::Map(_, _) | ManagedType::Set(_)) => None,
        // A **table** is not a `Map`, and this is the whole reason the two are
        // separate types. `Record<string, V>` is a plain JavaScript object on
        // the other side, so it crosses outward as one: `napi_create_object`
        // and a named property per entry, in insertion order.
        //
        // Outward only. Building one inward means allocating a table on this
        // side and reading a JavaScript object's own enumerable keys, which is
        // a different feature -- and the one place the profile needs a table to
        // cross, `os.constants`, needs it going out.
        //
        // Only what the value's own crossing can carry, which is what makes an
        // element of an unrepresentable type a refusal here rather than a
        // property missing from the object at run time.
        HirType::Managed(ManagedType::Table(key, value)) => {
            if !matches!(**key, HirType::Managed(ManagedType::String)) {
                return None;
            }
            let inner = cross(value, layouts, classes)?;
            matches!(
                inner,
                Cross::Number | Cross::Bool | Cross::Str | Cross::Erased
            )
            .then_some(Cross::Entries)
        }
        // A closure is represented by a synthetic object layout, but its
        // JavaScript value is a function. Copying captured fields into a plain
        // object would silently change its kind at the boundary.
        HirType::Managed(ManagedType::Object(id)) if hir::is_closure_type(*id) => None,
        HirType::Managed(ManagedType::Object(id)) => {
            let at = layouts.iter().position(|l| l.types.contains(id))?;
            object_crosses(at, layouts, classes, &mut Vec::new()).then_some(Cross::Object(at))
        }
        // A `never` return means the call does not come back, so there is
        // nothing for a wrapper to hand back.
        HirType::Never => None,
        // An erased value is a tag beside a payload, and crossing it is the
        // switch that decision was deferred over. It is here now because
        // `unknown` is the parameter type that makes a module's own validation
        // live: 23 exported functions in the profile call `validateString` or a
        // sibling on a parameter their declaration types as `string`, and the
        // check folds to nothing because `typeof path !== "string"` is
        // statically false. The wrapper's arity error stands in for a guard the
        // declaration deleted.
        HirType::Erased => Some(Cross::Erased),
    }
}

fn spell(ty: &HirType) -> String {
    match ty {
        HirType::Void => "void".to_owned(),
        HirType::Bool => "bool".to_owned(),
        HirType::Erased => "unknown".to_owned(),
        HirType::BigInt => "bigint".to_owned(),
        HirType::Int { bits, signed } => format!("{}{bits}", if *signed { 'i' } else { 'u' }),
        HirType::Float { bits } => format!("f{bits}"),
        HirType::Managed(ManagedType::String) => "string".to_owned(),
        HirType::Managed(ManagedType::Symbol) => "symbol".to_owned(),
        HirType::Managed(ManagedType::Date) => "Date".to_owned(),
        HirType::Managed(ManagedType::Buffer) => "ArrayBuffer".to_owned(),
        HirType::Managed(ManagedType::View(_)) => "TypedArray".to_owned(),
        HirType::Managed(ManagedType::AnyView) => "ArrayBufferView".to_owned(),
        HirType::Managed(ManagedType::DataView) => "DataView".to_owned(),
        HirType::Managed(ManagedType::Array(e)) => format!("{}[]", spell(e)),
        HirType::Managed(ManagedType::Object(id)) if hir::is_closure_type(*id) => {
            "a function".to_owned()
        }
        HirType::Managed(ManagedType::Object(_)) => "an object".to_owned(),
        HirType::Managed(ManagedType::Promise(payload)) => {
            format!("Promise<{}>", spell(payload))
        }
        HirType::Managed(ManagedType::Table(key, value)) => {
            format!("Record<{}, {}>", spell(key), spell(value))
        }
        HirType::Managed(ManagedType::Map(key, value)) => {
            format!("Map<{}, {}>", spell(key), spell(value))
        }
        HirType::Managed(ManagedType::Set(element)) => format!("Set<{}>", spell(element)),
        HirType::Never => "never".to_owned(),
    }
}

/// The C spelling of a type in the emitted program's signatures.
///
/// An object is the struct `nts_codegen_c` emitted for its layout, which is why
/// the name is built from the same [`c_identifier`] rather than spelled again.
fn c_type(ty: &HirType, layouts: &[hir::Layout]) -> String {
    match ty {
        // Neither has a value to marshal: `void` is a function that returned
        // nothing, `never` one that did not return.
        HirType::Void | HirType::Never => "void".to_owned(),
        HirType::Bool => "bool".to_owned(),
        // By value, and not a pointer as every managed type above is. Those
        // carry an `NtsHeader` and are reference-counted, so what crosses is a
        // handle; an `NtsValue` is sixteen bytes with no header, so what
        // crosses is the value. The promise is the closest thing to it in this
        // list and is the wrong precedent for exactly that reason.
        //
        // Nothing reaches this arm today: all three call sites run after
        // `cross`, which refuses an erased type, so a struct field or a
        // parameter of one is skipped before it is spelled. Whoever teaches
        // `cross` to cross an erased value should check this spelling against
        // what the C emitter actually produces rather than inherit it -- it is
        // reasoned, but it has never been compiled.
        HirType::Erased => "NtsValue".to_owned(),
        HirType::BigInt => "__int128".to_owned(),
        HirType::Managed(ManagedType::String) => "NtsString *".to_owned(),
        HirType::Managed(ManagedType::Symbol) => "NtsSymbol *".to_owned(),
        HirType::Managed(ManagedType::Date) => "NtsDate *".to_owned(),
        HirType::Managed(ManagedType::Buffer) => "NtsBuffer *".to_owned(),
        HirType::Managed(ManagedType::View(_) | ManagedType::AnyView) => "NtsView *".to_owned(),
        HirType::Managed(ManagedType::DataView) => "NtsDataView *".to_owned(),
        HirType::Managed(ManagedType::Array(_)) => "NtsArray *".to_owned(),
        // The fixed runtime layout, not a generated struct: the payload's
        // representation is in the type for the compiler's benefit, and the C
        // sees one tagged union whatever it carries.
        HirType::Managed(ManagedType::Promise(_)) => "NtsPromise *".to_owned(),
        // One runtime struct for both, and whatever the key and value
        // represent as: the table stores `NtsValue`s, so nothing about the type
        // arguments reaches the C spelling.
        HirType::Managed(
            ManagedType::Map(_, _) | ManagedType::Table(_, _) | ManagedType::Set(_),
        ) => {
            "NtsMap *".to_owned()
        }
        HirType::Managed(ManagedType::Object(id)) => {
            layouts.iter().find(|l| l.types.contains(id)).map_or_else(
                || "void *".to_owned(),
                |l| format!("NtsObj_{} *", c_identifier(&l.name)),
            )
        }
        HirType::Float { bits: 32 } => "float".to_owned(),
        HirType::Float { .. } => "double".to_owned(),
        HirType::Int {
            bits: 8,
            signed: true,
        } => "int8_t".to_owned(),
        HirType::Int {
            bits: 8,
            signed: false,
        } => "uint8_t".to_owned(),
        HirType::Int {
            bits: 16,
            signed: true,
        } => "int16_t".to_owned(),
        HirType::Int {
            bits: 16,
            signed: false,
        } => "uint16_t".to_owned(),
        HirType::Int {
            bits: 32,
            signed: true,
        } => "int32_t".to_owned(),
        HirType::Int {
            bits: 32,
            signed: false,
        } => "uint32_t".to_owned(),
        HirType::Int { signed: true, .. } => "int64_t".to_owned(),
        HirType::Int { signed: false, .. } => "uint64_t".to_owned(),
    }
}

/// One UTF-8 byte string as a C literal. Octal escapes have a fixed width, so
/// a following hexadecimal-looking source byte cannot accidentally extend an
/// escape and change the exported JavaScript name.
fn c_string_literal(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for byte in value.bytes() {
        match byte {
            b'"' => out.push_str("\\\""),
            b'\\' => out.push_str("\\\\"),
            0x20..=0x7e => out.push(char::from(byte)),
            _ => {
                let _ = write!(out, "\\{byte:03o}");
            }
        }
    }
    out.push('"');
    out
}

/// Set a JavaScript object's string property without confusing an embedded NUL
/// for the end of its name. Ordinary names retain Node-API's direct named path;
/// only a name that cannot use that API pays for a separate key value.
fn set_property_call(name: &str) -> String {
    let literal = c_string_literal(name);
    if name.contains('\0') {
        format!(
            "nts_napi_set_utf8_property(env, out, {literal}, {}u, value)",
            name.len()
        )
    } else {
        format!("napi_set_named_property(env, out, {literal}, value)")
    }
}

/// Everything the per-function wrappers call. Written once, not per function,
/// so a marshalling decision has one home.
const SUPPORT: &str = r#"
/* Give a published function the `length` node's has.
 *
 * `napi_create_function` takes no arity at all -- the `NAPI_AUTO_LENGTH` beside
 * the name is the *name string's* length -- so every function this addon
 * published reported `length` 0. The Node lane measured 95 of them across
 * sixteen modules, including everything one level in like `path.posix.join`,
 * and the only three with a real arity were JavaScript wrappers a `shape.mjs`
 * builds.
 *
 * `writable: false, enumerable: false, configurable: true` is what a function's
 * own `length` is in the specification, so this is `napi_configurable` and
 * nothing else. A descriptor that added `napi_writable` would produce a
 * `length` that assignment can change, which no ordinary function has.
 *
 * Failure is reported and not fatal: a function with the wrong `length` is a
 * worse export than one with the right one and a far better export than none. */
static bool nts_napi_set_length(napi_env env, napi_value fn, uint32_t arity) {
    napi_value length = NULL;
    if (napi_create_uint32(env, arity, &length) != napi_ok) return false;
    napi_property_descriptor descriptor = {
        "length", NULL, NULL, NULL, NULL, length, napi_configurable, NULL
    };
    return napi_define_properties(env, fn, 1, &descriptor) == napi_ok;
}

/* Turn a Node-API failure into a pending JavaScript exception. Node-API reports
 * conversion failures as status values; ignoring one silently substituted a
 * zero, false, or empty string for an invalid JavaScript argument. */
static inline bool nts_napi_check(napi_env env, napi_status status,
                                  const char *fallback) {
    if (status == napi_ok) return true;

    bool pending = false;
    if (napi_is_exception_pending(env, &pending) == napi_ok && pending) return false;

    const napi_extended_error_info *info = NULL;
    const char *message = fallback;
    if (napi_get_last_error_info(env, &info) == napi_ok &&
        info != NULL && info->error_message != NULL) {
        message = info->error_message;
    }
    napi_throw_error(env, NULL, message);
    return false;
}

static inline bool nts_napi_expect(napi_env env, napi_status status,
                                   const char *expected) {
    if (status == napi_ok) return true;

    bool pending = false;
    if (napi_is_exception_pending(env, &pending) == napi_ok && pending) return false;
    napi_throw_type_error(env, "ERR_INVALID_ARG_TYPE", expected);
    return false;
}

static inline bool nts_napi_expect_integer(napi_env env, double value,
                                           double minimum, double maximum) {
    if (isfinite(value) && trunc(value) == value &&
        (value != 0.0 || !signbit(value)) &&
        value >= minimum && value <= maximum) {
        return true;
    }
    napi_throw_range_error(env, "ERR_OUT_OF_RANGE",
                           "number is outside the compiled integer range");
    return false;
}

static inline bool nts_napi_expect_float32(napi_env env, double value) {
    if (isfinite(value) && value >= -FLT_MAX && value <= FLT_MAX &&
        (double)(float)value == value) return true;
    napi_throw_range_error(env, "ERR_OUT_OF_RANGE",
                           "number is outside the compiled float32 range");
    return false;
}

static inline napi_status nts_napi_set_utf8_property(
        napi_env env, napi_value object, const char *name, size_t name_length,
        napi_value value) {
    napi_value key = NULL;
    napi_status status =
        napi_create_string_utf8(env, name, name_length, &key);
    if (status != napi_ok) return status;
    return napi_set_property(env, object, key, value);
}

/* A JavaScript string is UTF-16 and so is an `NtsString`. Going through UTF-8
 * changes an unpaired surrogate into U+FFFD, which is observable in JavaScript
 * and wrong for a string boundary. */
static inline napi_status nts_from_napi_string(napi_env env, napi_value value,
                                               NtsString **out) {
    *out = NULL;
    size_t len = 0;
    napi_status status = napi_get_value_string_utf16(env, value, NULL, 0, &len);
    if (status != napi_ok) return status;
    if (len > UINT32_MAX ||
        len > (SIZE_MAX / sizeof(uint16_t)) - 1u) {
        napi_throw_range_error(env, NULL, "string is too long for the native runtime");
        return napi_pending_exception;
    }
    if (len == 0) {
        *out = nts_str_alloc(NULL, 0);
        return napi_ok;
    }

    uint16_t *units = (uint16_t *)malloc((len + 1) * sizeof(uint16_t));
    if (units == NULL) {
        napi_throw_error(env, NULL, "out of memory crossing a JavaScript string");
        return napi_pending_exception;
    }
    size_t copied = 0;
    status = napi_get_value_string_utf16(env, value, (char16_t *)units,
                                         len + 1, &copied);
    if (status == napi_ok) *out = nts_str_alloc(units, (uint32_t)copied);
    free(units);
    return status;
}

/* A value whose type the declaration did not fix, arriving from JavaScript.
 *
 * `unknown` is the one parameter type where node's runtime contract and
 * `@types/node`'s declaration usually disagree, and the disagreement is not
 * academic: 23 exported functions in the profile validate a parameter at run
 * time with a check the *declaration* deletes. `validateString(path, "path")`
 * inside a function whose parameter is declared `string` folds to nothing,
 * because `typeof path !== "string"` is statically false. Declaring the
 * parameter `unknown` is what makes those guards live again, and this is what
 * lets one cross.
 *
 * Primitives only, and the refusal is loud. An object, a function, a symbol or
 * a bigint has no representation on this side, and answering `undefined` for
 * one would be a wrong value where the caller passed a real thing -- the
 * failure mode this compiler refuses everywhere else. `napi_pending_exception`
 * after a thrown `TypeError` is the same shape every other conversion failure
 * takes here. */
static napi_status nts_from_napi_value(napi_env env, napi_value value,
                                       NtsValue *out) {
    *out = nts_value_of_undefined();
    napi_valuetype kind;
    napi_status status = napi_typeof(env, value, &kind);
    if (status != napi_ok) return status;
    switch (kind) {
    case napi_undefined:
        return napi_ok;
    case napi_null:
        *out = nts_value_of_null();
        return napi_ok;
    case napi_boolean: {
        bool flag = false;
        status = napi_get_value_bool(env, value, &flag);
        if (status == napi_ok) *out = nts_value_of_boolean(flag);
        return status;
    }
    case napi_number: {
        double number = 0;
        status = napi_get_value_double(env, value, &number);
        if (status == napi_ok) *out = nts_value_of_number(number);
        return status;
    }
    case napi_string: {
        NtsString *text = NULL;
        status = nts_from_napi_string(env, value, &text);
        if (status == napi_ok) {
            *out = nts_value_of_reference((NtsHeader *)text, NTS_TAG_STRING);
        }
        return status;
    }
    default:
        break;
    }
    napi_throw_type_error(
        env, NULL,
        "an argument of this type has no representation in the compiled runtime");
    return napi_pending_exception;
}

static inline napi_status nts_to_napi_string(napi_env env, const NtsString *s,
                                             napi_value *out) {
    if (s == NULL) {
        return napi_get_undefined(env, out);
    }
    if (s->length == 0) {
        return napi_create_string_utf16(env, NULL, 0, out);
    }
    if ((s->flags & NTS_TWO_BYTE) != 0) {
        return napi_create_string_utf16(
            env, (const char16_t *)NTS_ELEMENTS(s, uint16_t),
            (size_t)s->length, out);
    }
    return napi_create_string_latin1(
        env, (const char *)NTS_ELEMENTS(s, unsigned char),
        (size_t)s->length, out);
}

/* The same crossing outward: whichever JavaScript value the tag names.
 *
 * A reference that is not a string is refused rather than handed over as an
 * opaque number, for the reason `cross` refuses one everywhere else -- an
 * object's identity on this side is an address, and the far side cannot
 * reproduce what it means. */
static napi_status nts_to_napi_value(napi_env env, NtsValue value,
                                     napi_value *out) {
    switch (nts_value_tag(value)) {
    case NTS_TAG_UNDEFINED:
        return napi_get_undefined(env, out);
    case NTS_TAG_NULL:
        return napi_get_null(env, out);
    case NTS_TAG_BOOLEAN:
        return napi_get_boolean(env, nts_value_boolean(value), out);
    case NTS_TAG_NUMBER:
        return napi_create_double(env, nts_value_number(value), out);
    case NTS_TAG_STRING:
        return nts_to_napi_string(env, (const NtsString *)nts_value_reference(value),
                                  out);
    default:
        break;
    }
    napi_throw_type_error(
        env, NULL,
        "the compiled function returned a value with no JavaScript representation");
    return napi_pending_exception;
}


/* A JavaScript array of numbers, copied into a `number[]` compiled code can
 * read. Rejects a non-array and a non-numeric element rather than coercing:
 * `punycode.ucs2.encode(["a"])` is a caller mistake and silently reading zero
 * would make it look like a compiler one. */
/* A `napi_status` and not a `bool`, because that is what `nts_napi_expect`
 * takes -- and `true` reaching it as a status is `napi_invalid_arg`, so a
 * bool-returning version reported every array as the wrong type while looking
 * exactly right at the call site. */
static napi_status nts_from_napi_numbers(napi_env env, napi_value value,
                                         NtsArray **out) {
    bool is_array = false;
    napi_status status = napi_is_array(env, value, &is_array);
    if (status != napi_ok) return status;
    if (!is_array) return napi_array_expected;

    uint32_t length = 0;
    status = napi_get_array_length(env, value, &length);
    if (status != napi_ok) return status;

    NtsArray *array = nts_array_of_numbers((double)length);
    if (array == NULL) return napi_generic_failure;

    /* NTS_ITEMS, not NTS_ELEMENTS: an array's storage is behind the
     * `elements` pointer so that growing one can move it, and only a string
     * keeps its data inline right after the header. Writing through the string
     * macro put the first three elements over the array's own header. */
    double *slots = NTS_ITEMS(array, double);
    for (uint32_t at = 0; at < length; at++) {
        napi_value element = NULL;
        status = napi_get_element(env, value, at, &element);
        if (status == napi_ok) {
            /* Not a coercion: `napi_get_value_double` fails on anything that is
             * not a number, so `["1"]` is refused rather than silently read as
             * `[1]`. A compiled `number[]` parameter says what it takes. */
            status = napi_get_value_double(env, element, &slots[at]);
        }
        if (status != napi_ok) {
            nts_release((NtsHeader *)array);
            return status;
        }
    }
    *out = array;
    return napi_ok;
}

/* And back: a `number[]` as a JavaScript array. A copy, because a handle would
 * mean deciding who owns the storage afterwards -- the question `ArrayBuffer`
 * is refused over, and the reason to answer it once rather than per type. */
static napi_status nts_to_napi_numbers(napi_env env, const NtsArray *array,
                                       napi_value *out) {
    if (array == NULL) return napi_get_undefined(env, out);

    uint32_t length = array->header.length;
    napi_status status = napi_create_array_with_length(env, (size_t)length, out);
    if (status != napi_ok) return status;

    const double *slots = NTS_ITEMS(array, double);
    for (uint32_t at = 0; at < length; at++) {
        napi_value element = NULL;
        status = napi_create_double(env, slots[at], &element);
        if (status != napi_ok) return status;
        status = napi_set_element(env, *out, at, element);
        if (status != napi_ok) return status;
    }
    return napi_ok;
}

/* A typed array as a JavaScript one, copied, for the reason the numbers above
 * are copied. Outward only: an inbound view would need storage allocated on
 * this side, which is the half `cross` still refuses.
 *
 * **A `u8` view becomes a node `Buffer`, not a `Uint8Array`.** `Buffer` erases
 * to `view<u8>` in lowering and the runtime kind is `NTS_ELEMENT_U8` either
 * way, so nothing here can tell node's own return type from a bare
 * `Uint8Array`. `Buffer` is a `Uint8Array` subclass, so guessing it keeps
 * `instanceof Uint8Array` true and keeps `.equals`, `.readUInt32BE` and the
 * rest of node's surface; guessing the other way loses them and passes nothing
 * extra. On a boundary that exists to talk to node, that is the direction to be
 * wrong in.
 *
 * The kind comes from the *value* rather than the type, which is why this works
 * at all: HIR erases the element for `Buffer`, and `NtsView` carries it. */
static napi_status nts_to_napi_view(napi_env env, const NtsView *view,
                                    napi_value *out) {
    if (view == NULL) return napi_get_undefined(env, out);

    /* A detached view is length zero, and `bytes` is NULL once the block is
     * gone -- so the source pointer is never handed to `memcpy` or to N-API
     * as null with a length that would make reading it legal. */
    size_t bytes = (size_t)nts_view_byte_length(view);
    static const unsigned char nothing = 0;
    const unsigned char *from =
        bytes == 0 ? &nothing : view->buffer->bytes + view->byte_offset;

    if (view->kind == NTS_ELEMENT_U8) {
        void *into = NULL;
        return napi_create_buffer_copy(env, bytes, from, &into, out);
    }

    napi_typedarray_type kind;
    switch (view->kind) {
        case NTS_ELEMENT_I8: kind = napi_int8_array; break;
        case NTS_ELEMENT_U8_CLAMPED: kind = napi_uint8_clamped_array; break;
        case NTS_ELEMENT_I16: kind = napi_int16_array; break;
        case NTS_ELEMENT_U16: kind = napi_uint16_array; break;
        case NTS_ELEMENT_I32: kind = napi_int32_array; break;
        case NTS_ELEMENT_U32: kind = napi_uint32_array; break;
        case NTS_ELEMENT_F32: kind = napi_float32_array; break;
        case NTS_ELEMENT_F64: kind = napi_float64_array; break;
        /* Every kind the runtime defines is named above, so this is a kind the
         * runtime grew without telling the boundary. Failing is right: the
         * alternative is handing back the wrong width silently. */
        default: return napi_generic_failure;
    }

    void *into = NULL;
    napi_value buffer = NULL;
    napi_status status = napi_create_arraybuffer(env, bytes, &into, &buffer);
    if (status != napi_ok) return status;
    if (bytes > 0) memcpy(into, from, bytes);
    return napi_create_typedarray(env, kind, (size_t)nts_view_length(view),
                                  buffer, 0, out);
}

/* The trailing arguments a rest parameter names, gathered into an array.
 *
 * A rest parameter is not handed an array -- JavaScript gives it the arguments
 * one at a time -- so the wrapper reads however many arrived and builds the
 * array the compiled body expects. The count is not known at emit time, hence
 * the two-phase `napi_get_cb_info`: the first call asks only how many there
 * are, the second reads them.
 *
 * Eight on the stack because `path.join(a, b)` is the shape callers write, and
 * a heap buffer past that rather than a cap: silently dropping the ninth
 * argument would be a wrong answer, and `join` is exactly the function someone
 * calls with a spread. */
/* A string-keyed table as a plain JavaScript object.
 *
 * This is what makes a `Record<string, V>` different from a `Map<string, V>` at
 * the boundary, and the reason the two are separate types: node's
 * `os.constants.signals` is an object with thirty-three named properties, not a
 * `Map`, and a crossing that could not tell them apart would hand back the
 * wrong kind of thing for one of them.
 *
 * Insertion order, because that is the order `Object.keys` is specified to give
 * for string keys that are not array indices, and the order the table already
 * holds.
 *
 * One conversion for every value kind, because a table stores its values
 * *erased* -- `nts_map_set` takes `NtsValue`s -- so `nts_to_napi_value` is
 * already the right switch and there is nothing per-type to emit. `cross`
 * still asks what the value type is, because deciding whether a table may
 * cross is a different question from converting one entry.
 *
 * The keys are strings by construction: `hir::lower` admits only a string index
 * signature, and a numeric one is what an array is. */
static napi_status nts_to_napi_entries(napi_env env, const NtsMap *table,
                                       napi_value *out) {
    if (table == NULL) return napi_get_undefined(env, out);
    napi_status status = napi_create_object(env, out);
    if (status != napi_ok) return status;
    for (double at = nts_map_next(table, 0); at >= 0;
         at = nts_map_next(table, at + 1)) {
        napi_value name = NULL;
        status = nts_to_napi_string(
            env, (const NtsString *)nts_value_reference(nts_map_key_at(table, at)),
            &name);
        if (status != napi_ok) return status;
        napi_value carried = NULL;
        status = nts_to_napi_value(env, nts_map_value_at(table, at), &carried);
        if (status != napi_ok) return status;
        status = napi_set_property(env, *out, name, carried);
        if (status != napi_ok) return status;
    }
    return napi_ok;
}

/* The type of a value, spelled the way node's `ERR_INVALID_ARG_TYPE` spells it.
 *
 * Node's message is `The "path" argument must be of type string. Received type
 * number`, and its tests assert the *code* and the name rather than the text --
 * so the code is what has to be right and the text is what makes the failure
 * readable.
 *
 * **The whole tail after `Received `, including the word `type` or its
 * absence.** Node builds that tail with `determineSpecificType`, which answers
 * `"null"` and `"undefined"` bare and everything else as `type <t>`:
 *
 *     path.join(null)   node  ... must be of type string. Received null
 *                       here  ... must be of type string. Received type null
 *
 * `Received type null` is not a spelling node ever produces, because `typeof
 * null` is `"object"` and node never reaches the `typeof` arm for it. Returning
 * the tail rather than the type name puts the two cases where the language puts
 * them and leaves one place that knows the rule -- the alternative is a
 * conditional at each of the two call sites, which is the same rule written
 * twice.
 *
 * Node appends the value for the `type` forms -- `Received type string ('x')` --
 * and this does not, for the reason both call sites give: rendering an arbitrary
 * value is `util.inspect`'s job and a wrong rendering is worse than an absent
 * one. */
/* A JavaScript string as ASCII, for a diagnostic and nothing else.
 *
 * **UTF-16, because every string crossing this boundary is** -- a JavaScript
 * string is a sequence of UTF-16 code units and the UTF-8 reader replaces a
 * lone surrogate, which is why `strings_cross_as_utf16` asserts that spelling
 * appears nowhere -- including in a comment, which is how this sentence came to
 * be phrased around it. A message is not program data and could survive the
 * lossy read, but an invariant with one exemption is an invariant nobody can
 * check, so this reads what everything else reads.
 *
 * Above 127 becomes `?`. The callers are a constructor's name, a symbol's
 * description and a coerced number or boolean: the first is an identifier, the
 * last two are ASCII by construction, and only a description can be anything
 * else. Approximating it in an error message beats carrying a UTF-8 encoder
 * here. */
static void nts_napi_ascii(napi_env env, napi_value value, char *out,
                           size_t cap) {
    uint16_t units[64];
    size_t written = 0;
    out[0] = 0;
    if (napi_get_value_string_utf16(env, value, units,
                                    sizeof units / sizeof units[0],
                                    &written) != napi_ok) {
        return;
    }
    size_t at = 0;
    for (size_t i = 0; i < written && at + 1 < cap; i++) {
        out[at++] = units[i] < 128u ? (char)units[i] : '?';
    }
    out[at] = 0;
}

static const char *nts_napi_received(napi_env env, napi_value value, char *out,
                                     size_t cap) {
    napi_valuetype kind;
    if (napi_typeof(env, value, &kind) != napi_ok) return "a value";
    napi_value text;
    /* Zeroed, because the object arm below reads it after a call chain that may
     * not have written it -- a constructor lookup can fail on a null-prototype
     * object, which is exactly the case node spells differently anyway. */
    char spelled[64] = {0};
    size_t written = 0;
    switch (kind) {
    case napi_undefined: return "undefined";
    case napi_null: return "null";
    /* `String(x)` is the spelling for all three, and it is the engine's own --
     * so a float prints with node's shortest round-trip rather than a `%g` that
     * is close. `-0` is the one exception: JavaScript's `String(-0)` is `"0"`
     * and `determineSpecificType` says `-0`, which is the distinction the
     * message exists to draw. */
    case napi_boolean:
    case napi_number:
    case napi_bigint: {
        double number = 0.0;
        if (kind == napi_number
            && napi_get_value_double(env, value, &number) == napi_ok
            && number == 0.0 && signbit(number)) {
            snprintf(out, cap, "type number (-0)");
            return out;
        }
        if (napi_coerce_to_string(env, value, &text) != napi_ok) {
            return kind == napi_boolean ? "type boolean"
                   : kind == napi_number ? "type number"
                                         : "type bigint";
        }
        nts_napi_ascii(env, text, spelled, sizeof spelled);
        snprintf(out, cap, "type %s (%s%s)",
                 kind == napi_boolean  ? "boolean"
                 : kind == napi_number ? "number"
                                       : "bigint",
                 spelled, kind == napi_bigint ? "n" : "");
        return out;
    }
    /* Node truncates at 28 to 25 plus an ellipsis, and quotes with `'` unless
     * the value contains one. A string reaching a *string* parameter's error is
     * only possible for a `Cross::Str` that rejected it for another reason, so
     * this is the rarest arm and it is here for completeness rather than for a
     * case in the corpus. */
    case napi_string: {
        nts_napi_ascii(env, value, spelled, sizeof spelled);
        written = strlen(spelled);
        if (written > 28) {
            spelled[25] = 0;
            snprintf(out, cap, "type string ('%s...')", spelled);
        } else {
            snprintf(out, cap, "type string ('%s')", spelled);
        }
        return out;
    }
    /* `String(sym)` throws by 13.15.3, so the description is read directly.
     * `Symbol()` with none has `undefined` there and prints `Symbol()`. */
    case napi_symbol: {
        napi_value description;
        if (napi_get_named_property(env, value, "description", &description)
                != napi_ok) {
            return "type symbol";
        }
        nts_napi_ascii(env, description, spelled, sizeof spelled);
        snprintf(out, cap, "type symbol (Symbol(%s))", spelled);
        return out;
    }
    /* Node's own spelling, trailing space and all: a function's `.name` is what
     * would follow it, and a compiled function pointer has none to discover --
     * so the separator stays and the name is absent, which is exactly what node
     * prints for an anonymous one. */
    case napi_function: return "function ";
    /* `an instance of X`, not `type object`. Node reads the constructor's name;
     * a null-prototype object has none and node prints an inspection instead,
     * which is `util.inspect`'s job and not this one -- `Object` is the closer
     * of the two answers available here and is said to be an approximation. */
    default: {
        napi_value constructor;
        napi_value name;
        if (napi_get_named_property(env, value, "constructor", &constructor)
                == napi_ok
            && napi_get_named_property(env, constructor, "name", &name)
                   == napi_ok) {
            nts_napi_ascii(env, name, spelled, sizeof spelled);
        }
        if (spelled[0] != 0) {
            snprintf(out, cap, "an instance of %s", spelled);
            return out;
        }
        return "an instance of Object";
    }
    }
}

/* A rest element that is not what the declaration says it is.
 *
 * Thrown *here* rather than reported as a status, so the module's own error
 * shape survives the boundary. `path.resolve(42)` answered
 *
 *     Error: could not gather the rest arguments        code undefined
 *
 * where node answers a `TypeError` carrying `ERR_INVALID_ARG_TYPE` -- and the
 * module's own `validateString` cannot run, because a rest parameter declared
 * `string[]` folds `typeof x !== "string"` to false before the body sees it.
 * The boundary is standing in for a guard the declaration deleted, which is the
 * same trade the arity check makes, so it has to stand in with node's code and
 * not with a message about the gatherer's internals.
 *
 * Two of `path`'s nine remaining failures are this one line. */
/* The same, for an ordinary parameter rather than a gathered one.
 *
 * `nts_napi_expect` threw `expected a number argument`, which carries the right
 * code and the right error class and names neither the parameter nor what
 * arrived. Node says
 *
 *     The "priority" argument must be of type number. Received type string
 *
 * and the module's own validator would have said exactly that -- except that the
 * wrapper's conversion fails first, so `validateInt32`'s `typeof` check is never
 * reached. The boundary is standing in for a guard the declaration deleted,
 * which is `nts_napi_rest_type_error`'s argument one shape along, and a scalar
 * parameter is much the commoner shape.
 *
 * Node appends the value -- `Received type string ('x')` -- and this does not,
 * for the same reason the rest form does not: rendering an arbitrary value is
 * `util.inspect`'s job, and a wrong rendering would be worse than an absent
 * one. */
static void nts_napi_argument_type_error(napi_env env, const char *what,
                                         napi_value value, const char *expected) {
    bool pending = false;
    if (napi_is_exception_pending(env, &pending) == napi_ok && pending) return;
    char message[192];
    char received[96];
    snprintf(message, sizeof message,
             "The \"%s\" argument must be of type %s. Received %s", what,
             expected, nts_napi_received(env, value, received, sizeof received));
    napi_throw_type_error(env, "ERR_INVALID_ARG_TYPE", message);
}

static void nts_napi_rest_type_error(napi_env env, const char *what, size_t at,
                                     napi_value value, const char *expected) {
    char message[192];
    char received[96];
    snprintf(message, sizeof message,
             "The \"%s[%zu]\" argument must be of type %s. Received %s", what,
             at, expected, nts_napi_received(env, value, received, sizeof received));
    napi_throw_type_error(env, "ERR_INVALID_ARG_TYPE", message);
}

/* Read an *optional* scalar argument, rejecting a value its type does not admit.
 *
 * An optional parameter whose body observes the absence crosses as an erased
 * value, and `nts_from_napi_value` accepts every JavaScript value -- so
 * `os.getPriority(pid?: number)` took `null` and `false` and returned where node
 * throws, and `setPriority(1, "y")` handed the compiled function a string that
 * `unerase` read as a double.
 *
 * `undefined` and `null` are both the absence: node's optional parameters treat
 * an explicit `undefined` as omitted, and `null` fails the same `typeof` check
 * that a string does -- except that a parameter typed `T | null` is a different
 * declaration and does not reach here.
 *
 * The kind is passed rather than switched on a type name so the caller decides
 * once, at emit time, from the declaration. */
static bool nts_napi_optional_scalar(napi_env env, napi_value value, const char *what,
                                     const char *expected, NtsValue *into) {
    napi_valuetype kind = napi_undefined;
    if (napi_typeof(env, value, &kind) != napi_ok) return false;
    if (kind == napi_undefined) {
        *into = nts_value_of_undefined();
        return true;
    }
    if (expected[0] == 'n') { /* number */
        double number = 0;
        if (napi_get_value_double(env, value, &number) != napi_ok) {
            nts_napi_argument_type_error(env, what, value, expected);
            return false;
        }
        *into = nts_value_of_number(number);
        return true;
    }
    if (expected[0] == 'b') { /* boolean */
        bool flag = false;
        if (napi_get_value_bool(env, value, &flag) != napi_ok) {
            nts_napi_argument_type_error(env, what, value, expected);
            return false;
        }
        *into = nts_value_of_boolean(flag);
        return true;
    }
    /* string */
    NtsString *text = NULL;
    if (nts_from_napi_string(env, value, &text) != napi_ok) {
        nts_napi_argument_type_error(env, what, value, expected);
        return false;
    }
    *into = nts_value_of_reference((NtsHeader *)text, NTS_TAG_STRING);
    return true;
}

static napi_status nts_napi_rest(napi_env env, napi_callback_info info,
                                 size_t from, bool strings, const char *what,
                                 NtsArray **out) {
    size_t argc = 0;
    napi_status status = napi_get_cb_info(env, info, &argc, NULL, NULL, NULL);
    if (status != napi_ok) return status;

    napi_value inline_argv[8];
    napi_value *argv = inline_argv;
    napi_value *heap = NULL;
    if (argc > 8) {
        heap = (napi_value *)calloc(argc, sizeof(napi_value));
        if (heap == NULL) return napi_generic_failure;
        argv = heap;
    }
    status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (status != napi_ok) {
        free(heap);
        return status;
    }

    const size_t rest = argc > from ? argc - from : 0;
    NtsArray *array = strings ? nts_array_new(&nts_desc_ref, (double)rest)
                              : nts_array_of_numbers((double)rest);
    if (array == NULL) {
        free(heap);
        return napi_generic_failure;
    }

    for (size_t at = 0; at < rest; at++) {
        if (strings) {
            NtsString *text = NULL;
            status = nts_from_napi_string(env, argv[from + at], &text);
            if (status != napi_ok) {
                nts_napi_rest_type_error(env, what, at, argv[from + at], "string");
                status = napi_pending_exception;
                break;
            }
            NTS_ITEMS(array, NtsString *)[at] = text;
        } else {
            double number = 0;
            status = napi_get_value_double(env, argv[from + at], &number);
            if (status != napi_ok) {
                nts_napi_rest_type_error(env, what, at, argv[from + at], "number");
                status = napi_pending_exception;
                break;
            }
            NTS_ITEMS(array, double)[at] = number;
        }
    }
    free(heap);
    if (status != napi_ok) return status;
    *out = array;
    return napi_ok;
}

/* And inward: a JavaScript array of strings as a `string[]`.
 *
 * This was refused, and the reason given was wrong. "An array of references has
 * to be allocated on this side, and allocation needs a descriptor `program.c`
 * keeps" is true of an *object* array, whose layout is per program -- and false
 * here. `nts_desc_ref` is declared `extern` in `nts_runtime.h` and
 * `nts_array_new` takes it, so a reference array's descriptor comes from the
 * runtime exactly as `number[]`'s does through `nts_array_of_numbers`.
 *
 * The wall an object parameter meets is a real wall. I put a `string[]` behind
 * it by generalising from one case to a family, which is the same error as
 * reading three colliding names as a libc collision because one of them was. */
static napi_status nts_from_napi_strings(napi_env env, napi_value value,
                                         NtsArray **out) {
    bool is_array = false;
    napi_status status = napi_is_array(env, value, &is_array);
    if (status != napi_ok) return status;
    if (!is_array) return napi_array_expected;

    uint32_t length = 0;
    status = napi_get_array_length(env, value, &length);
    if (status != napi_ok) return status;

    NtsArray *array = nts_array_new(&nts_desc_ref, (double)length);
    if (array == NULL) return napi_generic_failure;

    NtsString **slots = NTS_ITEMS(array, NtsString *);
    for (uint32_t at = 0; at < length; at++) {
        napi_value element = NULL;
        status = napi_get_element(env, value, at, &element);
        if (status != napi_ok) return status;
        NtsString *text = NULL;
        status = nts_from_napi_string(env, element, &text);
        if (status != napi_ok) return status;
        slots[at] = text;
    }
    *out = array;
    return napi_ok;
}

/* A `string[]` as a JavaScript array of strings. The same copy the numbers
 * above are, one level in: the array is copied and so is each element, so
 * nothing on either side holds storage the other can free. */
static napi_status nts_to_napi_strings(napi_env env, const NtsArray *array,
                                       napi_value *out) {
    if (array == NULL) return napi_get_undefined(env, out);

    uint32_t length = array->header.length;
    napi_status status = napi_create_array_with_length(env, (size_t)length, out);
    if (status != napi_ok) return status;

    NtsString *const *slots = NTS_ITEMS(array, NtsString *);
    for (uint32_t at = 0; at < length; at++) {
        napi_value element = NULL;
        status = nts_to_napi_string(env, slots[at], &element);
        if (status != napi_ok) return status;
        status = napi_set_element(env, *out, at, element);
        if (status != napi_ok) return status;
    }
    return napi_ok;
}

/* A `boolean[]`. Its slots are one byte each, not a double and not a pointer,
 * which is the whole reason this is a third function rather than a width
 * passed to one loop. */
static napi_status nts_to_napi_booleans(napi_env env, const NtsArray *array,
                                        napi_value *out) {
    if (array == NULL) return napi_get_undefined(env, out);

    uint32_t length = array->header.length;
    napi_status status = napi_create_array_with_length(env, (size_t)length, out);
    if (status != napi_ok) return status;

    const bool *slots = NTS_ITEMS(array, bool);
    for (uint32_t at = 0; at < length; at++) {
        napi_value element = NULL;
        status = napi_get_boolean(env, slots[at], &element);
        if (status != napi_ok) return status;
        status = napi_set_element(env, *out, at, element);
        if (status != napi_ok) return status;
    }
    return napi_ok;
}

/* Raise what compiled code threw as a catchable JavaScript exception.
 *
 * A compiled program's own `try` is fully lowered, so this is reached only at
 * the outer edge -- where control leaves compiled code and returns to
 * JavaScript. Before it existed the runtime printed `nts: uncaught RangeError`
 * and terminated the process, so `punycode.decode("-")` killed node instead of
 * throwing something `assert.throws` could see.
 *
 * The name comes from the thrown object's descriptor, which does record the
 * class it describes; the message comes from the throw site, because a
 * descriptor records where an object's references are and not what they are
 * called. That is the same split `nts_uncaught` works from. */
/* Defined in `runtime/node/internal/process.c`, which every addon links.
 * `void *` rather than `napi_env` so the same declaration serves a standalone
 * build with no Node-API headers on its include path. Declared here as well as
 * in `nts_node.h` so this translation unit is well-formed on its own rather
 * than only under `build.sh`'s `-include`. */
void nts_napi_set_env(void *env);

static void nts_napi_raise(napi_env env, const NtsLanding *landing) {
    NtsValue thrown = nts_landing_thrown(landing);
    const NtsString *detail = nts_landing_detail(landing);
    const char *class_name = nts_thrown_class(thrown);

    /* Through the same conversion every returned string goes through, so a
     * two-byte message crosses as one rather than as mojibake. */
    napi_value message = NULL;
    if (detail == NULL || nts_to_napi_string(env, detail, &message) != napi_ok) {
        if (napi_create_string_utf8(env, "", 0, &message) != napi_ok) {
            napi_throw_error(env, NULL, "compiled code threw");
            return;
        }
    }

    /* The CONSTRUCTOR, not a generic error with the name set afterwards.
     *
     * Node-API has `napi_create_range_error` and `napi_create_type_error`
     * beside `napi_create_error`, and they produce genuine `RangeError` and
     * `TypeError` -- so `e instanceof RangeError` holds and the prototype chain
     * is node's own. Setting `.name` on a generic error gets `e.name`,
     * `String(e)` and a regex against the string form right and leaves
     * `instanceof` and `getPrototypeOf` wrong, which is the shape of a class
     * that has been flattened rather than raised.
     *
     * Found by an identity test in the Node lane written *because* the
     * compiler had nearly shipped the same flattening in `instanceof Error`:
     * node's own `test-punycode.js` asserts by regex on the string form, so it
     * passed against the flattened error. An oracle cannot test an invariant
     * that cannot fail in the implementation it was written against. */
    /* The class's own name is `ERR_OUT_OF_RANGE`, not `RangeError`, so the two
     * comparisons below miss for every one of node's error classes -- and the
     * `else` then set `name` to the class, giving `name` the string node puts
     * in `code` and leaving `instanceof RangeError` false.
     *
     * `nts_napi_error_classes` is emitted per program from what each
     * constructor actually assigns, because six of `internal/errors.ts`'s
     * ninety-four classes have a `code` that is not their name. */
    const char *base = class_name;
    napi_value code = NULL;
    if (class_name != NULL) {
        for (const NtsNapiErrorClass *entry = nts_napi_error_classes;
             entry->name != NULL; entry++) {
            if (strcmp(entry->name, class_name) != 0) continue;
            base = entry->base;
            if (napi_create_string_utf8(env, entry->code, NAPI_AUTO_LENGTH, &code) != napi_ok) {
                code = NULL;
            }
            break;
        }
    }

    napi_status made = napi_generic_failure;
    napi_value error = NULL;
    if (base != NULL && strcmp(base, "RangeError") == 0) {
        made = napi_create_range_error(env, NULL, message, &error);
    } else if (base != NULL && strcmp(base, "TypeError") == 0) {
        made = napi_create_type_error(env, NULL, message, &error);
    } else {
        made = napi_create_error(env, NULL, message, &error);
    }
    if (made == napi_ok && code != NULL) {
        napi_set_named_property(env, error, "code", code);
    }
    if (made != napi_ok) {
        napi_throw_error(env, NULL, "compiled code threw");
        return;
    }
    /* The name for everything else -- a `SyntaxError`, an `EvalError`, a user
     * subclass -- which Node-API has no constructor for. `e.name` and
     * `String(e)` are then right and `instanceof` is not, and that is the
     * honest limit of what this boundary can express. */
    if (base != NULL && made == napi_ok && base == class_name
        && strcmp(base, "RangeError") != 0
        && strcmp(base, "TypeError") != 0) {
        napi_value name = NULL;
        if (napi_create_string_utf8(env, class_name, NAPI_AUTO_LENGTH, &name) == napi_ok) {
            napi_set_named_property(env, error, "name", name);
        }
    }
    napi_throw(env, error);
}

"#;

/// Every reason a function gets no wrapper, or what crosses if it does.
///
/// Separated from [`wrapper`] because they are two things: this one only ever
/// says no, and everything below it only ever writes C. Reading a refusal meant
/// scrolling past forty lines of `format!` to find the next one.
fn crossings_of(
    func: &hir::Func,
    layouts: &[hir::Layout],
    classes: &FxHashSet<String>,
) -> Result<(Cross, Vec<Cross>), Skipped> {
    // A constructor or a method is reached through its class, and the class is
    // not something this can hand to JavaScript yet.
    if func.name.contains('#') {
        return Err(Skipped {
            function: func.name.clone(),
            reason: "a class member".to_owned(),
        });
    }
    let ret = cross(&func.return_type, layouts, classes).ok_or_else(|| Skipped {
        function: func.name.clone(),
        reason: format!("returns {}", spell(&func.return_type)),
    })?;
    let crossings: Vec<Cross> = func
        .params
        .iter()
        .map(|p| {
            cross(&p.ty, layouts, classes).ok_or_else(|| Skipped {
                function: func.name.clone(),
                reason: format!("takes {}", spell(&p.ty)),
            })
        })
        .collect::<Result<_, _>>()?;

    // `cross` answers for a *type*, and the two directions differ. Reading an
    // object out of a call needs no descriptor; building one to pass *in* does,
    // and `program.c` keeps the descriptors -- so `unmarshal` has nothing to
    // emit for an object parameter and returns an empty string.
    //
    // The loop below pushed `a{index}` into the call regardless, so a wrapper
    // came out as `setCompose(a0)` with no `a0` anywhere: uncompilable C from a
    // wrapper the emitter believed it had written, and the first thing the
    // conformance build hits once it can find its headers. Three exports in
    // `fs` alone, each taking a closure.
    //
    // Refused here rather than repaired, because the repair is the descriptor
    // question and that is a design rather than a patch. `void` joins it: a
    // parameter with no value to read has no name to give either.
    // A rest parameter is an array the CALL gathers, so a wrapper handed one
    // JavaScript array would have to decide whether it is the array or the
    // first of the gathered arguments -- and treating every array parameter as
    // rest is what made an ordinary one swallow the remaining arguments. The
    // shape is on the parameter now, so the two are told apart rather than
    // refused together.
    // A rest parameter is gathered rather than refused now: it is not handed a
    // JavaScript array, it is handed the trailing arguments, and
    // `nts_napi_rest` builds the array the body expects. What is still refused
    // is a rest parameter this cannot *fill* -- an array of objects or views,
    // for the reasons those elements are refused anywhere.
    //
    // `resolve` and `join` are how node spells `path`'s two most-reached
    // functions and there is no fixed-arity spelling of either, so this is the
    // difference between the module publishing them and not.
    if let Some((at, parameter)) = func
        .params
        .iter()
        .enumerate()
        .find(|(_, parameter)| parameter.shape == hir::ParamShape::Rest)
    {
        let fillable = matches!(
            crossings.get(at),
            Some(Cross::Elements(inner)) if matches!(**inner, Cross::Number | Cross::Str)
        );
        if !fillable {
            return Err(Skipped {
                function: func.name.clone(),
                reason: format!(
                    "takes a rest parameter `{}` this cannot gather",
                    parameter.name
                ),
            });
        }
        if at + 1 != func.params.len() {
            return Err(Skipped {
                function: func.name.clone(),
                reason: format!("takes a rest parameter `{}` that is not last", parameter.name),
            });
        }
    }
    if let Some(parameter) = func
        .params
        .iter()
        .zip(&crossings)
        .find_map(|(parameter, crossing)| {
            matches!(
                crossing,
                // A table inward would mean allocating one on this side and
                // reading a JavaScript object's own enumerable keys, which is a
                // different feature from handing one over.
                Cross::Object(_) | Cross::Bytes | Cross::Entries | Cross::Void
            )
            .then_some(parameter)
            .or_else(|| {
                // An array of *references* has to be allocated on this side to
                // be filled, and allocation needs a descriptor `program.c`
                // keeps -- the same wall an object parameter meets. A
                // `number[]` is the one that does not: `nts_from_napi_numbers`
                // takes its descriptor from the runtime.
                matches!(
                    crossing,
                    Cross::Elements(inner)
                        if !matches!(**inner, Cross::Number | Cross::Str)
                )
                .then_some(parameter)
            })
        })
    {
        return Err(Skipped {
            function: func.name.clone(),
            reason: format!("takes {}, which crosses outward only", spell(&parameter.ty)),
        });
    }

    Ok((ret, crossings))
}


/// The scalar an optional parameter admits, where the surface recorded one.
///
/// `number`, `boolean` or `string`, spelled as node spells it in
/// `ERR_INVALID_ARG_TYPE`, because that string is both the check to emit and the
/// word the message uses.
fn optional_scalar(program: &hir::Program, func: &str, at: usize) -> Option<&'static str> {
    let at = u32::try_from(at).ok()?;
    program
        .optional_scalars
        .iter()
        .find(|(name, index, _)| name == func && *index == at)
        .and_then(|(_, _, ty)| match ty {
            HirType::Float { .. } | HirType::Int { .. } => Some("number"),
            HirType::Bool => Some("boolean"),
            HirType::Managed(ManagedType::String) => Some("string"),
            _ => None,
        })
}

/// The `length` a published wrapper should report.
///
/// The specification counts parameters before the first one with a **default
/// value** or a rest element. A TypeScript `?` is neither: `suffix?: string`
/// compiles to a plain parameter, and node's own `basename(path, ext)` reports
/// `length` 2 with the second one optional in its `.d.ts`.
///
/// That is why this counts `Optional` and stops only at `Defaulted` and `Rest`,
/// and the first version did not -- `take_while(Ordinary)` gave `basename` a
/// `length` of 1 against node's 2, which was the one row of eleven that
/// disagreed after the fix and the reason to check rather than to ship.
fn published_arity(func: &hir::Func) -> u32 {
    u32::try_from(
        func.params
            .iter()
            .take_while(|p| {
                matches!(p.shape, hir::ParamShape::Ordinary | hir::ParamShape::Optional)
            })
            .count(),
    )
    .unwrap_or(0)
}

/// One `napi_create_function` per exported name, beside the class fragments.
///
/// One wrapper can publish under several names: `export const upper = impl.upper`
/// and `export const alias = impl.upper` are one function and two properties,
/// and a loop that asked each function for *a* name published it once under
/// whichever came first.
fn publish_functions(program: &hir::Program, wrapped: &[(&str, &str)]) -> String {
    let mut out = String::new();
    for (name, publish) in wrapped {
        let symbol = c_identifier(name);
        let property = c_string_literal(publish);
        let arity = program
            .funcs
            .iter()
            .find(|func| func.name == *name)
            .map_or(0, published_arity);
        let _ = write!(
            out,
            "    {{\n        napi_value fn;\n        if (!nts_napi_check(env, napi_create_function(env, {property}, NAPI_AUTO_LENGTH, nts_napi_{symbol}, NULL, &fn), \"could not create an exported function\")) return NULL;\n        nts_napi_set_length(env, fn, {arity}u);\n        if (!nts_napi_check(env, napi_set_named_property(env, exports, {property}, fn), \"could not export a function\")) return NULL;\n    }}\n"
        );
    }
    out
}

/// Every published class, emitted after the free functions so a class's member
/// callbacks sit below the ordinary wrappers in the file.
///
/// Returns the `NAPI_MODULE_INIT` fragments that define them and the names they
/// publish under, the second so `report_unrepresentable_exports` stops calling
/// a class "not a function this backend can name" once it is one.
fn emit_classes<'a>(
    program: &'a hir::Program,
    classes: &FxHashSet<String>,
    ownership: &hir::own::Summaries,
    release_managed: bool,
    skipped: &mut Vec<Skipped>,
    out: &mut String,
) -> (String, Vec<&'a str>) {
    let mut class_inits = String::new();
    let mut published_classes: Vec<&str> = Vec::new();
    for (emitted, publish) in &program.public_api {
        // `classes` is every name before a `#`, which includes the owner of a
        // *specialization* -- `digits#whole` made the ordinary function
        // `digits` look like a class, and it was refused as one with "is a
        // class whose constructor was not compiled". A regression the fixtures
        // caught on the first run.
        //
        // A class has a **layout**; a specialized function does not. That is
        // the test, and it is the one thing here the `#` cannot fake.
        if !classes.contains(emitted)
            || !program.layouts.iter().any(|layout| layout.name == *emitted)
        {
            continue;
        }
        if let Some((code, init)) = class_definition(
            emitted,
            publish,
            program,
            classes,
            ownership,
            release_managed,
            skipped,
        ) {
            out.push_str(&code);
            class_inits.push_str(&init);
            published_classes.push(publish.as_str());
        }
    }
    (class_inits, published_classes)
}

/// The crossings of a class member, whose receiver is not an argument.
///
/// [`crossings_of`] refuses anything with a `#` in its name, which was right
/// for as long as a class could not be published at all. A member differs from
/// a free function in exactly one way: its first parameter is the instance, and
/// the instance arrives as the callback's `this` rather than in `argv`.
fn member_crossings(
    func: &hir::Func,
    layouts: &[hir::Layout],
    classes: &FxHashSet<String>,
) -> Result<(Cross, Vec<Cross>), Skipped> {
    let ret = cross(&func.return_type, layouts, classes).ok_or_else(|| Skipped {
        function: func.name.clone(),
        reason: format!("returns {}", spell(&func.return_type)),
    })?;
    let mut crossings = Vec::new();
    for parameter in func.params.iter().skip(1) {
        let crossing = cross(&parameter.ty, layouts, classes).ok_or_else(|| Skipped {
            function: func.name.clone(),
            reason: format!("takes {}", spell(&parameter.ty)),
        })?;
        if matches!(crossing, Cross::Object(_) | Cross::Bytes | Cross::Void) {
            return Err(Skipped {
                function: func.name.clone(),
                reason: format!(
                    "takes {}, which crosses outward only",
                    spell(&parameter.ty)
                ),
            });
        }
        crossings.push(crossing);
    }
    Ok((ret, crossings))
}

/// The member name a class function publishes under, and whether it is an
/// accessor.
///
/// The lowering spells a getter `Class#get lastChar`, so the space is the whole
/// of the distinction and `split_once` on it is the test. Node exposes these
/// three as prototype *accessors* -- `decoder.lastChar`, not
/// `decoder.lastChar()` -- so publishing them as methods would satisfy the name
/// and answer a function where a `Buffer` belongs.
fn member_kind(member: &str) -> (&str, Option<&'static str>) {
    if let Some(rest) = member.strip_prefix("get ") {
        return (rest, Some("getter"));
    }
    if let Some(rest) = member.strip_prefix("set ") {
        return (rest, Some("setter"));
    }
    (member, None)
}

/// One member's callback: the instance out of `this`, then the ordinary
/// argument path.
fn member_callback(
    func: &hir::Func,
    instance: &str,
    layouts: &[hir::Layout],
    classes: &FxHashSet<String>,
    release_managed: bool,
    return_is_borrowed: bool,
) -> Result<String, Skipped> {
    let (ret, crossings) = member_crossings(func, layouts, classes)?;
    let symbol = c_identifier(&func.name);
    let params: Vec<String> = func.params.iter().map(|p| c_type(&p.ty, layouts)).collect();
    let mut out = format!(
        "{} {symbol}({});\nstatic napi_value nts_napi_{symbol}(napi_env env, napi_callback_info info) {{\n",
        c_type(&func.return_type, layouts),
        params.join(", ")
    );
    let count = crossings.len();
    if count == 0 {
        out.push_str("    napi_value self;\n    if (!nts_napi_check(env, napi_get_cb_info(env, info, NULL, NULL, &self, NULL), \"could not read callback arguments\")) return NULL;\n");
    } else {
        let _ = write!(
            out,
            "    size_t argc = {count};\n    napi_value argv[{count}];\n    napi_value self;\n    if (!nts_napi_check(env, napi_get_cb_info(env, info, &argc, argv, &self, NULL), \"could not read callback arguments\")) return NULL;\n    if (argc < {count}) {{\n        napi_throw_type_error(env, \"ERR_MISSING_ARGS\", \"the compiled method requires {count} arguments\");\n        return NULL;\n    }}\n"
        );
    }
    let _ = write!(
        out,
        "    {instance} *nts_self = NULL;\n    if (!nts_napi_check(env, napi_unwrap(env, self, (void **)&nts_self), \"could not read the instance\")) return NULL;\n"
    );

    let mut args: Vec<String> = vec!["nts_self".to_owned()];
    for (index, (crossing, parameter)) in crossings.iter().zip(func.params.iter().skip(1)).enumerate() {
        let name = format!("a{index}");
        out.push_str(&declare_argument(crossing, &parameter.ty, layouts, &name));
        args.push(name);
    }
    out.push_str("    napi_value out = NULL;\n");
    for (index, ((crossing, parameter), name)) in crossings
        .iter()
        .zip(func.params.iter().skip(1))
        .zip(args.iter().skip(1))
        .enumerate()
    {
        out.push_str(&unmarshal(crossing, &parameter.ty, layouts, name, index, &parameter.name));
    }
    out.push_str(
        "    NtsLanding nts_landing;\n    if (setjmp(nts_landing.frame) != 0) {\n        nts_napi_raise(env, &nts_landing);\n        out = NULL;\n        goto nts_napi_cleanup;\n    }\n    nts_landing_push(&nts_landing);\n",
    );
    let call = format!("{symbol}({})", args.join(", "));
    out.push_str(&marshal(
        &ret,
        &func.return_type,
        &call,
        "",
        layouts,
        release_managed,
        return_is_borrowed,
    ));
    out.push_str("nts_napi_cleanup:\n    nts_landing_pop(&nts_landing);\n");
    if release_managed {
        for (crossing, name) in crossings.iter().zip(args.iter().skip(1)) {
            if matches!(crossing, Cross::Str | Cross::Elements(_)) {
                let _ = writeln!(
                    out,
                    "    if ({name} != NULL) nts_release((NtsHeader *){name});"
                );
            }
        }
    }
    out.push_str("    return out;\n}\n\n");
    Ok(out)
}

/// The `new` callback: allocate through the factory, run the constructor, and
/// hand the instance to the JavaScript object that will own it.
///
/// Split from [`class_definition`] because it is the only part that is about
/// *lifetime* rather than about signatures. A constructor that cannot cross
/// takes the class with it -- unlike a member's refusal, which only omits that
/// member -- because without one there is no instance for anything else to be
/// called on.
fn constructor_callback(
    constructor: &hir::Func,
    instance: &str,
    layouts: &[hir::Layout],
    classes: &FxHashSet<String>,
    release_managed: bool,
    skipped: &mut Vec<Skipped>,
) -> Option<String> {
    let mut out = String::new();
    let (ctor_ret, ctor_crossings) = match member_crossings(constructor, layouts, classes) {
        Ok(both) => both,
        Err(why) => {
            skipped.push(why);
            return None;
        }
    };
    let _ = ctor_ret;
    let ctor_symbol = c_identifier(&constructor.name);
    let ctor_params: Vec<String> = constructor
        .params
        .iter()
        .map(|p| c_type(&p.ty, layouts))
        .collect();
    let count = ctor_crossings.len();
    let _ = write!(
        out,
        "void {ctor_symbol}({});\nstatic napi_value nts_napi_new_{instance}(napi_env env, napi_callback_info info) {{\n",
        ctor_params.join(", ")
    );
    if count == 0 {
        out.push_str("    napi_value self;\n    if (!nts_napi_check(env, napi_get_cb_info(env, info, NULL, NULL, &self, NULL), \"could not read callback arguments\")) return NULL;\n");
    } else {
        let _ = write!(
            out,
            "    size_t argc = {count};\n    napi_value argv[{count}];\n    napi_value self;\n    if (!nts_napi_check(env, napi_get_cb_info(env, info, &argc, argv, &self, NULL), \"could not read callback arguments\")) return NULL;\n    if (argc < {count}) {{\n        napi_throw_type_error(env, \"ERR_MISSING_ARGS\", \"the constructor requires {count} arguments\");\n        return NULL;\n    }}\n"
        );
    }
    let mut args: Vec<String> = vec!["nts_self".to_owned()];
    for (index, (crossing, parameter)) in ctor_crossings
        .iter()
        .zip(constructor.params.iter().skip(1))
        .enumerate()
    {
        let name = format!("a{index}");
        out.push_str(&declare_argument(crossing, &parameter.ty, layouts, &name));
        args.push(name);
    }
    // The same shape every other wrapper has, and it has to be: `unmarshal`
    // emits `goto nts_napi_cleanup`, so a callback without that label does not
    // compile. The first version returned early instead and clang stopped at
    // `use of undeclared label` -- found by linking the addon, which no
    // emit-only check would have caught.
    out.push_str("    napi_value out = NULL;\n    NtsLanding nts_landing;\n");
    for (index, ((crossing, parameter), name)) in ctor_crossings
        .iter()
        .zip(constructor.params.iter().skip(1))
        .zip(args.iter().skip(1))
        .enumerate()
    {
        out.push_str(&unmarshal(crossing, &parameter.ty, layouts, name, index, &parameter.name));
    }
    let _ = write!(
        out,
        "    {instance} *nts_self = ({instance} *)nts_construct_{instance}();\n    if (nts_self == NULL) {{\n        napi_throw_error(env, NULL, \"could not allocate the instance\");\n        goto nts_napi_cleanup;\n    }}\n    if (setjmp(nts_landing.frame) != 0) {{\n        nts_napi_raise(env, &nts_landing);\n        nts_release((NtsHeader *)nts_self);\n        goto nts_napi_cleanup;\n    }}\n    nts_landing_push(&nts_landing);\n    {ctor_symbol}({});\n    if (!nts_napi_check(env, napi_wrap(env, self, nts_self, nts_finalize_{instance}, NULL, NULL), \"could not attach the instance\")) {{\n        nts_release((NtsHeader *)nts_self);\n        goto nts_napi_cleanup;\n    }}\n    if (!nts_napi_define_{instance}_fields(env, self)) {{\n        goto nts_napi_cleanup;\n    }}\n    out = self;\nnts_napi_cleanup:\n    nts_landing_pop(&nts_landing);\n",
        args.join(", ")
    );
    if release_managed {
        for (crossing, name) in ctor_crossings.iter().zip(args.iter().skip(1)) {
            if matches!(crossing, Cross::Str | Cross::Elements(_)) {
                let _ = writeln!(
                    out,
                    "    if ({name} != NULL) nts_release((NtsHeader *){name});"
                );
            }
        }
    }
    out.push_str("    return out;\n}\n\n");
    Some(out)
}

/// A published class: a constructor that allocates, a prototype carrying the
/// members, and a finalizer that releases.
///
/// Returns the callbacks and the `NAPI_MODULE_INIT` fragment that defines the
/// class, plus every member left out and why. **A member that cannot cross is
/// omitted rather than failing the class**, and each omission is reported --
/// which is a departure from `cross`'s "better to have no wrapper than a
/// wrapper that loses behaviour", and deliberate. That rule is about an object
/// copied as plain data, where the methods vanish *silently*; here the surface
/// is named at build time, so a caller learns what is missing from the build
/// rather than from `undefined is not a function`.
/// Why a name has no function, where the program recorded a reason.
///
/// **One lookup, three call sites.** A plain export, a namespace member and a
/// class constructor all ask the same question -- *was this name refused, and
/// why* -- and until now only the first consulted `program.uncompiled`; the
/// other two answered with their own search, which states the effect and sends
/// the reader nowhere. 76 namespace members and 40 constructors across the 26
/// modules, against 100 plain exports that had just learned to say it.
///
/// `stream`'s 43 are one family -- `consumers.blob`, `.arrayBuffer`, `.buffer`,
/// `.bytes`, `.text`, `.json` -- which is one cause reported member by member,
/// and the reason a line count and a cause count are different units here.
fn why_uncompiled(program: &hir::Program, name: &str, absent: &str) -> String {
    program
        .uncompiled
        .iter()
        .find(|(at, _)| at == name)
        .map_or_else(|| absent.to_owned(), |(_, why)| format!("{absent}: {why}"))
}

fn class_definition(
    class: &str,
    publish: &str,
    program: &hir::Program,
    classes: &FxHashSet<String>,
    ownership: &hir::own::Summaries,
    release_managed: bool,
    skipped: &mut Vec<Skipped>,
) -> Option<(String, String)> {
    let layouts = &program.layouts;
    let prefix = format!("{class}#");
    let Some(constructor) = program
        .funcs
        .iter()
        .find(|func| func.name == format!("{class}#constructor"))
    else {
        // Silent `?` here cost an hour: the class fell back to the export
        // pass's generic "is not a function this backend can name", which is
        // the message that exists for a class and so read as unchanged.
        let absent = "is a class whose constructor was not compiled";
        let reason = why_uncompiled(program, &format!("{class}#constructor"), absent);
        skipped.push(Skipped { function: class.to_owned(), reason });
        return None;
    };
    // The receiver's C type is the struct the factory allocates. Taken from the
    // signature rather than rebuilt from the layout name, so the two cannot
    // disagree about spelling.
    let Some(receiver) = constructor.params.first() else {
        skipped.push(Skipped {
            function: class.to_owned(),
            reason: "is a class whose constructor takes no receiver".to_owned(),
        });
        return None;
    };
    let instance = c_type(&receiver.ty, layouts)
        .trim_end_matches(" *")
        .to_owned();

    // The field definer is emitted below the constructor and called from it, so
    // its prototype goes here with the other two.
    let mut out = format!(
        "typedef struct {instance} {instance};\nNtsHeader *nts_construct_{instance}(void);\nstatic bool nts_napi_define_{instance}_fields(napi_env env, napi_value self);\n"
    );

    // The finalizer, which is the whole of the ownership story: the instance is
    // this heap's, the JavaScript object merely points at it, and when that
    // object dies the reference goes with it.
    let _ = write!(
        out,
        "static void nts_finalize_{instance}(napi_env env, void *data, void *hint) {{\n    (void)env;\n    (void)hint;\n    if (data != NULL) nts_release((NtsHeader *)data);\n}}\n"
    );

    out.push_str(&constructor_callback(
        constructor,
        &instance,
        layouts,
        classes,
        release_managed,
        skipped,
    )?);

    // The members, in declaration order, so the emitted file reads like the
    // class does.
    let mut descriptors: Vec<String> = Vec::new();
    for func in &program.funcs {
        let Some(member) = func.name.strip_prefix(&prefix) else {
            continue;
        };
        if member == "constructor" {
            continue;
        }
        // `#` separates a class from its member *and* a function from its
        // specialization variant, so `Holder#constructor#whole` splits to the
        // member `constructor#whole` and sailed past the test above. It was
        // published as a prototype method under that literal name.
        //
        // A specialization is an internal shape, never a published one: the
        // surface is what the class declares. Skipped by the `#`, which is the
        // only thing that distinguishes the two here.
        if member.contains('#') {
            continue;
        }
        match member_callback(
            func,
            &instance,
            layouts,
            classes,
            release_managed,
            ownership.hands_back(&func.name),
        ) {
            Ok(text) => {
                out.push_str(&text);
                let symbol = c_identifier(&func.name);
                let (name, accessor) = member_kind(member);
                let property = c_string_literal(name);
                descriptors.push(match accessor {
                    Some("getter") => format!(
                        "{{ {property}, NULL, NULL, nts_napi_{symbol}, NULL, NULL, napi_default, NULL }}"
                    ),
                    Some("setter") => format!(
                        "{{ {property}, NULL, NULL, NULL, nts_napi_{symbol}, NULL, napi_default, NULL }}"
                    ),
                    _ => format!(
                        "{{ {property}, NULL, nts_napi_{symbol}, NULL, NULL, NULL, napi_default, NULL }}"
                    ),
                });
            }
            Err(why) => skipped.push(why),
        }
    }

    // The data, which is not in `program.funcs` and so was never reached by the
    // loop above. Appended after the methods so a class reads the way it is
    // declared: behaviour first, then state.
    if let Some(at) = layouts
        .iter()
        .position(|candidate| c_type_is(candidate, &instance))
    {
        let (bodies, fields) = field_accessors(&layouts[at], &instance, layouts, classes, skipped);
        out.push_str(&bodies);
        descriptors.extend(fields);
    }

    let property = c_string_literal(publish);
    let init = if descriptors.is_empty() {
        format!(
            "    {{\n        napi_value ctor;\n        if (!nts_napi_check(env, napi_define_class(env, {property}, NAPI_AUTO_LENGTH, nts_napi_new_{instance}, NULL, 0, NULL, &ctor), \"could not define a class\")) return NULL;\n        if (!nts_napi_check(env, napi_set_named_property(env, exports, {property}, ctor), \"could not export a class\")) return NULL;\n    }}\n"
        )
    } else {
        format!(
            "    {{\n        napi_property_descriptor members[] = {{\n            {}\n        }};\n        napi_value ctor;\n        if (!nts_napi_check(env, napi_define_class(env, {property}, NAPI_AUTO_LENGTH, nts_napi_new_{instance}, NULL, sizeof(members) / sizeof(members[0]), members, &ctor), \"could not define a class\")) return NULL;\n        if (!nts_napi_check(env, napi_set_named_property(env, exports, {property}, ctor), \"could not export a class\")) return NULL;\n    }}\n",
            descriptors.join(",\n            ")
        )
    };
    Some((out, init))
}

/// The addon's fixed head: the includes every wrapper needs, and the support
/// helpers they call.
/// Each thrown class, the error it descends from, and the `code` its
/// constructor assigns.
///
/// `nts_thrown_class` answers with the *class's own* name, which for node's
/// error classes is `ERR_OUT_OF_RANGE` rather than `RangeError` -- so the
/// boundary's `strcmp` against the two Node-API constructors missed, it built a
/// generic error, and it set `name` to the class. Node has `name` `"RangeError"`
/// and `code` `"ERR_OUT_OF_RANGE"`; this had the two swapped, with the right
/// string under the wrong property and `instanceof RangeError` false.
///
/// **The code is read from the constructor, not from the class name.** Six of
/// `internal/errors.ts`'s ninety-four classes disagree with their own name --
/// `AbortError` is `ABORT_ERR`, `ConnResetException` is `ECONNRESET`,
/// `ERR_INVALID_ARG_VALUE_RANGE` is `ERR_INVALID_ARG_VALUE` -- so the name would
/// have been a wrong value for those six, which is what this boundary refuses
/// everywhere else.
///
/// A class whose constructor does not assign a constant `code` is left out and
/// keeps the old behaviour: `name` set to the class, and no code. That is the
/// honest answer for a class this cannot read one from.
fn error_classes(program: &hir::Program) -> Vec<(String, String, String)> {
    let roots = hir::PROVIDED_ERROR_NAMES;
    let mut found = Vec::new();
    for layout in &program.layouts {
        if roots.contains(&layout.name.as_str()) {
            continue;
        }
        // The root of the chain, walked rather than named: a class two or three
        // deep -- `ERR_OUT_OF_RANGE extends NodeRangeError extends RangeError`
        // is the shape -- reaches it the same way as one directly above it.
        let mut at = layout.base;
        let mut root = None;
        for _ in 0..16 {
            let Some(ty) = at else { break };
            let Some(above) = program.layout(ty) else { break };
            if roots.contains(&above.name.as_str()) {
                root = Some(above.name.clone());
                break;
            }
            at = above.base;
        }
        let Some(root) = root else { continue };
        let Some(field) = layout.index_of("code") else {
            continue;
        };
        // At the **`new`** site, not in the constructor. A class field
        // initialiser is emitted by `initialize_fields` where the object is
        // allocated -- which is where JavaScript runs it -- so
        // `ERR_OUT_OF_RANGE#constructor` contains stores for `message` and
        // `name` and none for `code`, and looking there found nothing.
        //
        // Every allocation of one class agrees about a constant initialiser, so
        // the first is the answer and the scan stops at it.
        let code = program.funcs.iter().find_map(|func| {
            func.values.iter().find_map(|op| match &op.kind {
                hir::OpKind::FieldSet {
                    object,
                    field: at,
                    value,
                } if *at == field
                    && matches!(
                        &func.values[object.0 as usize].ty,
                        HirType::Managed(ManagedType::Object(ty)) if layout.types.contains(ty)
                    ) =>
                {
                    match &func.values[value.0 as usize].kind {
                        hir::OpKind::ConstString(text) => Some(text.clone()),
                        _ => None,
                    }
                }
                _ => None,
            })
        });
        if let Some(code) = code {
            found.push((layout.name.clone(), root, code));
        }
    }
    found.sort_unstable();
    found.dedup();
    found
}

/// That table, as C, ahead of the support code that reads it.
fn error_class_table(program: &hir::Program) -> String {
    let mut out = String::from(
        "typedef struct { const char *name; const char *base; const char *code; } NtsNapiErrorClass;
static const NtsNapiErrorClass nts_napi_error_classes[] = {
",
    );
    for (name, base, code) in error_classes(program) {
        let _ = writeln!(
            out,
            "    {{ {}, {}, {} }},",
            c_string_literal(&name),
            c_string_literal(&base),
            c_string_literal(&code)
        );
    }
    // A sentinel, because a zero-length array is not C and a program with no
    // error classes at all is an ordinary program.
    out.push_str("    { 0, 0, 0 }
};

");
    out
}

fn preamble(program: &hir::Program) -> String {
    let mut out = String::from("/* Generated by nts. Do not edit. */\n");
    out.push_str(
        "#include <node_api.h>\n#include <string.h>\n#include <float.h>\n#include <math.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include \"nts_runtime.h\"\n",
    );
    out.push_str(&error_class_table(program));
    out.push_str(SUPPORT);
    out.push('\n');
    out
}

/// Every layout that is a class, by name.
///
/// A name appearing before a `#` in some function is one: it has methods, and
/// its behaviour is not carried by its fields.
fn class_names(program: &hir::Program) -> FxHashSet<String> {
    program
        .funcs
        .iter()
        .filter_map(|f| f.name.split_once('#').map(|(owner, _)| owner.to_owned()))
        .collect()
}

/// Why a function whose erased slot the boundary cannot satisfy gets no wrapper.
///
/// `Uint8Array | ArrayBuffer` erases, and no argument node can offer would
/// build one -- so a wrapper for it accepts everything and throws for
/// everything. `buffer.isUtf8` went from `typeof` being `"undefined"` to
/// `"function"` with every call throwing, which is worse than absent: a
/// presence check that used to fail now passes, and only a call finds out.
///
/// `hir::lower::opaque_signature` decides it, because the declaration is the
/// only place that still knows which union erased.
fn opaque_slot(program: &hir::Program, name: &str) -> Option<Skipped> {
    program
        .opaque_signatures
        .iter()
        .any(|at| at == name)
        .then(|| Skipped {
            function: name.to_owned(),
            reason: "takes or returns a union that erases and whose members the boundary \
                     cannot build, so no argument would satisfy it"
                .to_owned(),
        })
}

/// Why a function the C backend dropped gets no wrapper.
///
/// A refused body leaves its `Func` in place, so every question the wrapper
/// pass can ask -- does the signature cross, is it a class, is it published --
/// answers yes for a symbol that will not exist. The wrapper it wrote was
/// well-formed C that fails at the linker, and worse: lazy binding means the
/// addon *loads*, publishes the name, and dies on the first call with
/// `undefined symbol`, at whatever later moment somebody calls it.
fn refused_body(refused: &[String], name: &str) -> Option<Skipped> {
    refused.iter().any(|at| at == name).then(|| Skipped {
        function: name.to_owned(),
        reason: "its body was refused by the backend, so there is no symbol to call".to_owned(),
    })
}

/// One function's wrapper. Every refusal is [`crossings_of`]'s.
fn wrapper(
    program: &hir::Program,
    func: &hir::Func,
    layouts: &[hir::Layout],
    classes: &FxHashSet<String>,
    release_managed: bool,
    return_is_borrowed: bool,
    consumed_parameters: Option<&FxHashSet<u32>>,
) -> Result<String, Skipped> {
    let (ret, crossings) = crossings_of(func, layouts, classes)?;

    let symbol = c_identifier(&func.name);
    let params: Vec<String> = func.params.iter().map(|p| c_type(&p.ty, layouts)).collect();
    let signature = if params.is_empty() {
        "void".to_owned()
    } else {
        params.join(", ")
    };

    let mut out = format!(
        "{} {symbol}({signature});\nstatic napi_value nts_napi_{symbol}(napi_env env, napi_callback_info info) {{\n",
        c_type(&func.return_type, layouts)
    );
    // A rest parameter is not one of the arguments a caller must supply, so it
    // is out of the count and read separately. `join()` with nothing is legal.
    let gathered = func
        .params
        .iter()
        .position(|parameter| parameter.shape == hir::ParamShape::Rest);
    let positional = gathered.unwrap_or(func.params.len());
    // How many a caller must actually supply.
    //
    // `basename(path: string, suffix?: string)` published with **two** required
    // arguments, so `path.basename("/a/b.txt")` -- the way that function is
    // almost always called -- threw `ERR_MISSING_ARGS` where node returns
    // `"b"`. Not a corner: 316 exported functions in the node profile take an
    // optional or defaulted parameter, among them `net.createServer` and
    // `dgram.createSocket`, whose own tests call them with fewer arguments
    // seventeen times over. It was found by the first differential ever run
    // against a compiled addon, and by nothing in node's own test files, which
    // call each function the way their author wrote them.
    //
    // A **defaulted** parameter stays required, and that is not an oversight.
    // `ParamShape::Defaulted`'s contract is that "the initializer is evaluated
    // by each caller that omits the argument" -- the lowering inlines it at
    // every call site and the HIR does not carry the expression. A wrapper is a
    // caller with nowhere to get it from, so passing a zero would be inventing
    // a value the source never wrote.
    let required = func
        .params
        .iter()
        .take(positional)
        .rposition(|parameter| parameter.shape != hir::ParamShape::Optional)
        .map_or(0, |at| at + 1);
    out.push_str(&read_arguments(func.params.len(), positional, required));

    let mut args: Vec<String> = Vec::new();
    for (index, (crossing, parameter)) in crossings.iter().zip(&func.params).enumerate() {
        let name = format!("a{index}");
        out.push_str(&declare_argument(crossing, &parameter.ty, layouts, &name));
        args.push(name);
    }
    out.push_str("    napi_value out = NULL;\n");
    for (index, ((crossing, parameter), name)) in crossings
        .iter()
        .zip(&func.params)
        .zip(&args)
        .enumerate()
    {
        if gathered == Some(index) {
            let strings = matches!(
                crossing,
                Cross::Elements(inner) if matches!(**inner, Cross::Str)
            );
            let _ = writeln!(
                out,
                "    if (!nts_napi_check(env, nts_napi_rest(env, info, {index}, {strings}, {}, &{name}), \"could not gather the rest arguments\")) goto nts_napi_cleanup;",
                c_string_literal(&parameter.name)
            );
            continue;
        }
        // An optional parameter that is one scalar and `undefined`, whose
        // admissible type only `program.optional_scalars` knows -- `parameter.ty`
        // is `Erased` and `parameter.shape` says optional, and neither says what
        // the optional half was.
        let read = match optional_scalar(program, &func.name, index) {
            Some(expected) if matches!(crossing, Cross::Erased) => format!(
                "    if (!nts_napi_optional_scalar(env, argv[{index}], {}, \"{expected}\", &{name})) goto nts_napi_cleanup;\n",
                c_string_literal(&parameter.name)
            ),
            _ => unmarshal(crossing, &parameter.ty, layouts, name, index, &parameter.name),
        };
        if index < required {
            out.push_str(&read);
            continue;
        }
        // An argument the caller may have left out. Absent is `undefined`,
        // spelled the way the callee's parameter type spells it: a reference
        // parameter tests against the null pointer already -- that is how
        // `suffix === undefined` compiles inside `basename` -- and an erased one
        // carries the tag, which is why the lowering types an optional `number`
        // parameter `erased` and an optional `string` parameter as an ordinary
        // pointer.
        out.push_str(&optional_argument(&read, &absent_argument(crossing, name), index));
    }

    // The landing pad, so a `throw` that reaches the edge becomes a catchable
    // JavaScript exception instead of taking the process down. Set up after the
    // arguments are unmarshalled, because those have their own failure path and
    // nothing compiled has run yet.
    out.push_str(
        "    NtsLanding nts_landing;\n    if (setjmp(nts_landing.frame) != 0) {\n        nts_napi_raise(env, &nts_landing);\n        out = NULL;\n        goto nts_napi_cleanup;\n    }\n    nts_landing_push(&nts_landing);\n",
    );

    let call = format!("{symbol}({})", args.join(", "));
    let after_call = forget_consumed_arguments(
        &crossings,
        &args,
        release_managed,
        consumed_parameters,
    );
    out.push_str(&marshal(
        &ret,
        &func.return_type,
        &call,
        &after_call,
        layouts,
        release_managed,
        return_is_borrowed,
    ));
    // Popped at the one place every path reaches. `nts_landing_pop` names the
    // frame rather than popping blindly, so the throw path -- which pops on the
    // way out -- and this one cannot between them remove somebody else's.
    out.push_str("nts_napi_cleanup:\n    nts_landing_pop(&nts_landing);\n");
    if release_managed {
        for (crossing, name) in crossings.iter().zip(&args) {
            if matches!(crossing, Cross::Str | Cross::Elements(_)) {
                let _ = writeln!(
                    out,
                    "    if ({name} != NULL) nts_release((NtsHeader *){name});"
                );
            }
        }
    }
    out.push_str("    return out;\n}\n\n");
    Ok(out)
}

/// The preamble that reads the callback's arguments and checks how many there
/// are.
///
/// `positional` is how many the wrapper can receive, `required` how many the
/// caller must supply. They differ by the optional tail, and the check is
/// omitted entirely when nothing is required -- a function of only optional
/// parameters is legal to call with none.
fn read_arguments(declared: usize, positional: usize, required: usize) -> String {
    if declared == 0 || positional == 0 {
        // No parameters, or only a rest one: nothing to read positionally, and
        // `nts_napi_rest` does its own `napi_get_cb_info`.
        return "    (void)info;\n".to_owned();
    }
    let mut out = format!(
        "    size_t argc = {positional};\n    napi_value argv[{positional}];\n    if (!nts_napi_check(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL), \"could not read callback arguments\")) return NULL;\n"
    );
    if required > 0 {
        let plural = if required == 1 { "" } else { "s" };
        let _ = write!(
            out,
            "    if (argc < {required}) {{\n        napi_throw_type_error(env, \"ERR_MISSING_ARGS\", \"the compiled function requires {required} argument{plural}\");\n        return NULL;\n    }}\n"
        );
    }
    out
}

/// One argument read, guarded by whether the caller supplied it.
///
/// Split out because `wrapper` is already at the line limit and this is the
/// only part of it that is a shape rather than a decision.
fn optional_argument(read: &str, absent: &str, index: usize) -> String {
    let mut out = format!("    if (argc > {index}) {{\n");
    for line in read.lines() {
        let _ = writeln!(out, "    {line}");
    }
    let _ = write!(out, "    }} else {{\n        {absent}\n    }}\n");
    out
}

/// What an omitted argument is, in C.
///
/// Every crossing but the two reference-shaped ones is unreachable rather than
/// approximate: a *scalar* parameter that may be omitted is `erased` in the
/// HIR, because `undefined` is a tag and not a zero, so `Number` and `Bool`
/// never arrive here optional. They answer anyway, and separately, so that the
/// next crossing to be added is decided about instead of joining a list.
fn absent_argument(crossing: &Cross, name: &str) -> String {
    match crossing {
        Cross::Str
        | Cross::Bytes
        | Cross::Elements(_)
        | Cross::Entries
        | Cross::Object(_) => format!("{name} = NULL;"),
        Cross::Number => format!("{name} = 0.0;"),
        Cross::Bool => format!("{name} = false;"),
        // The one crossing that can *say* absent rather than stand in for it.
        Cross::Erased => format!("{name} = nts_value_of_undefined();"),
        Cross::Void => "(void)0;".to_owned(),
    }
}

/// Stop cleanup from releasing references whose ownership the compiled callee
/// accepted. The nulling belongs immediately after the call: conversion
/// failures happen before it and still own every allocated argument, while
/// every path after it must regard a consumed argument as moved.
fn forget_consumed_arguments(
    crossings: &[Cross],
    args: &[String],
    release_managed: bool,
    consumed_parameters: Option<&FxHashSet<u32>>,
) -> String {
    if !release_managed {
        return String::new();
    }
    let Some(consumed_parameters) = consumed_parameters else {
        return String::new();
    };

    let mut out = String::new();
    for (index, (crossing, name)) in crossings.iter().zip(args).enumerate() {
        let Ok(slot) = u32::try_from(index) else {
            continue;
        };
        if consumed_parameters.contains(&slot) && matches!(crossing, Cross::Str) {
            let _ = writeln!(out, "    {name} = NULL;");
        }
    }
    out
}

/// Declare every argument before converting any of them, so a conversion
/// failure can jump to one cleanup block without observing an uninitialized
/// managed pointer.
fn declare_argument(
    crossing: &Cross,
    ty: &HirType,
    layouts: &[hir::Layout],
    name: &str,
) -> String {
    match crossing {
        // Undefined until read, which is also what an omitted optional argument
        // leaves it as -- so the two paths need no separate initialisation.
        Cross::Erased => format!("    NtsValue {name} = nts_value_of_undefined();\n"),
        // Outward only, so this is never read -- declared for the same reason
        // every other crossing is, and never filled.
        Cross::Entries => format!("    NtsMap *{name} = NULL;\n"),
        Cross::Number if matches!(ty, HirType::Float { bits: 64 }) => {
            format!("    double {name} = 0;\n")
        }
        Cross::Number => format!(
            "    double {name}_number = 0;\n    {} {name} = 0;\n",
            c_type(ty, layouts)
        ),
        Cross::Bool => format!("    bool {name} = false;\n"),
        Cross::Str => format!("    NtsString *{name} = NULL;\n"),
        Cross::Elements(_) => format!("    NtsArray *{name} = NULL;\n"),
        Cross::Bytes => format!("    NtsView *{name} = NULL;\n"),
        Cross::Object(_) | Cross::Void => String::new(),
    }
}

/// Reading one argument out of JavaScript.
fn unmarshal(
    crossing: &Cross,
    ty: &HirType,
    layouts: &[hir::Layout],
    name: &str,
    index: usize,
    declared: &str,
) -> String {
    match crossing {
        Cross::Erased => format!(
            "    if (!nts_napi_expect(env, nts_from_napi_value(env, argv[{index}], &{name}), \"could not read an argument of unknown type\")) goto nts_napi_cleanup;\n"
        ),
        Cross::Number if matches!(ty, HirType::Float { bits: 64 }) => format!(
            "    if (napi_get_value_double(env, argv[{index}], &{name}) != napi_ok) {{\n        nts_napi_argument_type_error(env, \"{declared}\", argv[{index}], \"number\");\n        goto nts_napi_cleanup;\n    }}\n"
        ),
        Cross::Number => format!(
            "    if (napi_get_value_double(env, argv[{index}], &{name}_number) != napi_ok) {{\n        nts_napi_argument_type_error(env, \"{declared}\", argv[{index}], \"number\");\n        goto nts_napi_cleanup;\n    }}\n{}    {name} = ({}){name}_number;\n",
            numeric_guard(ty, name),
            c_type(ty, layouts)
        ),
        // **The same message a number gets.** These two read
        // `expected a boolean argument` and `expected a string argument` --
        // which name neither the parameter nor what arrived, and are not
        // sentences node ever produces. The number arm beside them has said
        // node's since `nts_napi_argument_type_error` was written; the other
        // two were never moved across, and a string parameter is much the
        // commonest of the three.
        //
        //     path.normalize(null)
        //       node  The "path" argument must be of type string. Received null
        //       here  expected a string argument
        //
        // Four of `path`'s six single-argument entry points answered the second
        // one, and node's suite asserts messages as well as codes.
        Cross::Bool => format!(
            "    if (napi_get_value_bool(env, argv[{index}], &{name}) != napi_ok) {{\n        nts_napi_argument_type_error(env, \"{declared}\", argv[{index}], \"boolean\");\n        goto nts_napi_cleanup;\n    }}\n"
        ),
        Cross::Str => format!(
            "    if (nts_from_napi_string(env, argv[{index}], &{name}) != napi_ok) {{\n        nts_napi_argument_type_error(env, \"{declared}\", argv[{index}], \"string\");\n        goto nts_napi_cleanup;\n    }}\n"
        ),
        // A `number[]` is copied element by element. The descriptor comes from
        // the runtime rather than from `program.c`, which keeps its own to
        // itself -- see `nts_array_of_numbers`.
        Cross::Elements(inner) => {
            let (helper, wanted) = match **inner {
                Cross::Str => ("nts_from_napi_strings", "an array of strings"),
                _ => ("nts_from_napi_numbers", "an array of numbers"),
            };
            format!(
                "    if (!nts_napi_expect(env, {helper}(env, argv[{index}], &{name}), \"expected {wanted}\")) goto nts_napi_cleanup;\n"
            )
        }
        // An object argument would have to be *allocated*, and allocation needs
        // the layout's descriptor, which `program.c` keeps to itself. Reading a
        // returned object needs no descriptor, which is why one direction works
        // and the other is refused in `cross`. A view is the same story with
        // bytes in place of fields.
        // Nothing to read. `crossings_of` refuses a table *parameter* before a
        // wrapper is written, so `Entries` reaching here would be a bug in that
        // guard rather than a shape to handle -- and the empty string it shares
        // with the other three is the same emptiness for a different reason,
        // which is why the comment is here and not in the arm's absence.
        Cross::Object(_) | Cross::Bytes | Cross::Void | Cross::Entries => String::new(),
    }
}

/// The dynamic boundary must establish the invariant which allowed HIR to
/// narrow a JavaScript number before C performs the conversion. In particular,
/// converting an out-of-range `double` to an integer is undefined C behaviour.
fn numeric_guard(ty: &HirType, name: &str) -> String {
    let range = match ty {
        HirType::Int {
            bits: 8,
            signed: true,
        } => Some(("-128.0", "127.0")),
        HirType::Int {
            bits: 8,
            signed: false,
        } => Some(("0.0", "255.0")),
        HirType::Int {
            bits: 16,
            signed: true,
        } => Some(("-32768.0", "32767.0")),
        HirType::Int {
            bits: 16,
            signed: false,
        } => Some(("0.0", "65535.0")),
        HirType::Int {
            bits: 32,
            signed: true,
        } => Some(("-2147483648.0", "2147483647.0")),
        HirType::Int {
            bits: 32,
            signed: false,
        } => Some(("0.0", "4294967295.0")),
        HirType::Int { signed: true, .. } => {
            Some(("-9007199254740991.0", "9007199254740991.0"))
        }
        HirType::Int { signed: false, .. } => Some(("0.0", "9007199254740991.0")),
        HirType::Float { bits: 32 } => {
            return format!(
                "    if (!nts_napi_expect_float32(env, {name}_number)) goto nts_napi_cleanup;\n"
            );
        }
        HirType::Float { .. } => None,
        _ => unreachable!("only a numeric type reaches a numeric crossing"),
    };
    range.map_or_else(String::new, |(minimum, maximum)| {
        format!(
            "    if (!nts_napi_expect_integer(env, {name}_number, {minimum}, {maximum})) goto nts_napi_cleanup;\n"
        )
    })
}

/// Handing the result back to JavaScript.
fn marshal(
    ret: &Cross,
    return_type: &HirType,
    call: &str,
    after_call: &str,
    layouts: &[hir::Layout],
    release_managed: bool,
    return_is_borrowed: bool,
) -> String {
    let release_result = should_release_result(release_managed, return_is_borrowed);
    match ret {
        Cross::Void => format!(
            "    {call};\n{after_call}    if (!nts_napi_check(env, napi_get_undefined(env, &out), \"could not create undefined\")) goto nts_napi_cleanup;\n"
        ),
        // A table hands back a plain object built from its entries. The table
        // itself is released like any other reference result: what leaves is a
        // copy the far side owns.
        Cross::Entries => {
            let mut text = format!(
                "    NtsMap *result = {call};\n{after_call}    napi_status result_status = nts_to_napi_entries(env, result, &out);\n"
            );
            if release_result {
                text.push_str("    if (result != NULL) nts_release((NtsHeader *)result);\n");
            }
            text.push_str(
                "    if (!nts_napi_check(env, result_status, \"could not create an object from a table\")) goto nts_napi_cleanup;\n",
            );
            text
        }
        Cross::Bool => format!(
            "    bool result = {call};\n{after_call}    if (!nts_napi_check(env, napi_get_boolean(env, result, &out), \"could not create a boolean\")) goto nts_napi_cleanup;\n"
        ),
        // A reference inside an erased result is released the same way a
        // `Cross::Str` one is: the callee handed back a count, and the value
        // that leaves is a copy the far side owns.
        Cross::Erased => {
            let mut text = format!(
                "    NtsValue result = {call};\n{after_call}    napi_status result_status = nts_to_napi_value(env, result, &out);\n"
            );
            if release_result {
                text.push_str(
                    "    if (NTS_TAG_IS_REFERENCE(nts_value_tag(result)) && nts_value_reference(result) != NULL) nts_release(nts_value_reference(result));\n",
                );
            }
            text.push_str(
                "    if (!nts_napi_check(env, result_status, \"could not create a value of unknown type\")) goto nts_napi_cleanup;\n",
            );
            text
        }
        Cross::Number => format!(
            "    {} result = {call};\n{after_call}    if (!nts_napi_check(env, napi_create_double(env, (double)result, &out), \"could not create a number\")) goto nts_napi_cleanup;\n",
            c_type(return_type, layouts)
        ),
        Cross::Str => {
            let mut text = format!(
                "    NtsString *result = {call};\n{after_call}    napi_status result_status = nts_to_napi_string(env, result, &out);\n"
            );
            if release_result {
                text.push_str("    nts_release((NtsHeader *)result);\n");
            }
            text.push_str(
                "    if (!nts_napi_check(env, result_status, \"could not create a string\")) goto nts_napi_cleanup;\n",
            );
            text
        }
        Cross::Bytes => {
            let mut text = format!(
                "    NtsView *result = {call};\n{after_call}    napi_status result_status = nts_to_napi_view(env, result, &out);\n"
            );
            if release_result {
                text.push_str("    nts_release((NtsHeader *)result);\n");
            }
            text.push_str(
                "    if (!nts_napi_check(env, result_status, \"could not create a typed array\")) goto nts_napi_cleanup;\n",
            );
            text
        }
        Cross::Elements(inner) => {
            let helper = elements_helper(inner, layouts);
            let mut text = format!(
                "    NtsArray *result = {call};\n{after_call}    napi_status result_status = {helper}(env, result, &out);\n"
            );
            if release_result {
                text.push_str("    nts_release((NtsHeader *)result);\n");
            }
            text.push_str(
                "    if (!nts_napi_check(env, result_status, \"could not create an array\")) goto nts_napi_cleanup;\n",
            );
            text
        }
        Cross::Object(at) => {
            let layout = &layouts[*at];
            let struct_name = format!("NtsObj_{}", c_identifier(&layout.name));
            let helper = object_helper(layout);
            let mut text = format!(
                "    {struct_name} *result = {call};\n{after_call}    napi_status result_status = {helper}(env, result, &out);\n"
            );
            if release_result {
                text.push_str("    nts_release((NtsHeader *)result);\n");
            }
            text.push_str(
                "    if (!nts_napi_check(env, result_status, \"could not create an object\")) goto nts_napi_cleanup;\n",
            );
            text
        }
    }
}

/// The name of the function that builds one of these as a JavaScript object.
fn object_helper(layout: &hir::Layout) -> String {
    format!("nts_to_napi_obj_{}", c_identifier(&layout.name))
}

/// That function.
///
/// The field loop used to be written **inline against `result`** in `marshal`,
/// which is why an array of objects could not be built: there was nothing for a
/// loop to call. Factored out, an object return and an object element are the
/// same code, and the return arm becomes the same shape as every other one --
/// call, status, check.
///
/// The locals keep the names the inline version used, `result` and `out`, so
/// `set_property_call` and the `result->member` reads are unchanged; what
/// changes is the failure path, which returns a status where the inline form
/// jumped to the wrapper's cleanup label.
fn emit_object_helper(out: &mut String, layout: &hir::Layout, layouts: &[hir::Layout]) {
    let struct_name = format!("NtsObj_{}", c_identifier(&layout.name));
    let name = object_helper(layout);
    let _ = write!(
        out,
        "static napi_status {name}(napi_env env, const {struct_name} *result, napi_value *into) {{\n    napi_value out;\n    napi_status status = napi_create_object(env, &out);\n    if (status != napi_ok) return status;\n"
    );
    for field in &layout.fields {
        let member = c_identifier(&field.name);
        let set_property = set_property_call(&field.name);
        let make = match field.ty {
            HirType::Managed(ManagedType::String) => {
                format!("nts_to_napi_string(env, result->{member}, &value)")
            }
            HirType::Bool => format!("napi_get_boolean(env, result->{member}, &value)"),
            HirType::Float { .. } | HirType::Int { .. } => {
                format!("napi_create_double(env, (double)result->{member}, &value)")
            }
            HirType::Managed(ManagedType::Table(_, _)) => {
                format!("nts_to_napi_entries(env, result->{member}, &value)")
            }
            // A nested object: the same call this function is, one level down.
            // `object_crosses` has already proved the chain is acyclic and that
            // every layout on it can be built, so the only thing left is to find
            // the layout and name its helper.
            //
            // `unreachable!` below is load-bearing and stays: the two functions
            // have to agree about what crosses, and a field shape that reached
            // here without an arm is a disagreement rather than a shape to
            // approximate.
            HirType::Managed(ManagedType::Object(id)) => {
                let nested = layouts
                    .iter()
                    .find(|l| l.types.contains(&id))
                    .expect("a nested object layout cross checked without a layout");
                format!(
                    "{}(env, result->{member}, &value)",
                    object_helper(nested)
                )
            }
            _ => unreachable!("a field shape `object_crosses` admits and this does not build"),
        };
        let _ = write!(
            out,
            "    {{\n        napi_value value;\n        status = {make};\n        if (status != napi_ok) return status;\n        status = {set_property};\n        if (status != napi_ok) return status;\n    }}\n"
        );
    }
    let _ = write!(out, "    *into = out;\n    return napi_ok;\n}}\n\n");

    // And the loop over an array of them, which is why the above is a function
    // at all. Emitted beside it rather than on demand: an unused static is
    // already what `nts_to_napi_view` and `nts_to_napi_numbers` are in most
    // modules, and deciding per program which of the two are wanted is more
    // machinery than the bytes it saves.
    let array_name = format!("nts_to_napi_array_of_{}", c_identifier(&layout.name));
    let _ = write!(
        out,
        "static napi_status {array_name}(napi_env env, const NtsArray *array, napi_value *out) {{\n    if (array == NULL) return napi_get_undefined(env, out);\n\n    uint32_t length = array->header.length;\n    napi_status status = napi_create_array_with_length(env, (size_t)length, out);\n    if (status != napi_ok) return status;\n\n    {struct_name} *const *slots = NTS_ITEMS(array, {struct_name} *);\n    for (uint32_t at = 0; at < length; at++) {{\n        napi_value element = NULL;\n        status = {name}(env, slots[at], &element);\n        if (status != napi_ok) return status;\n        status = napi_set_element(env, *out, at, element);\n        if (status != napi_ok) return status;\n    }}\n    return napi_ok;\n}}\n\n"
    );
    let _ = layouts;
}

fn should_release_result(release_managed: bool, return_is_borrowed: bool) -> bool {
    release_managed && !return_is_borrowed
}

/// Generate the addon for a program's exported functions.
///
/// A function whose signature cannot cross is skipped rather than approximated:
/// a wrapper that silently coerces would make the conformance suite grade
/// something other than the program.
///
/// # The export table is the entry module's, not the program's
///
/// [`hir::Func::exported`] means "the declaration carries `export`", and that
/// is all it can mean: it is set from a modifier and the modifier does not know
/// which file it is in. An addon built from that flag alone publishes every
/// `export` in the whole linked program, internals of imported modules
/// included -- so `os.node` exported `normalizeEncodingName`, `byteLengthIn`
/// and `revokeObjectURL`, three private helpers inside `node:buffer`, and
/// `string_decoder.node` exported the same three and none of its own
/// `StringDecoder`.
///
/// The flag is not wrong and is not changed here: it also marks a reachability
/// root, and a helper reached by an import is genuinely a root. What was
/// missing is the second half of the question -- whose surface is this? --
/// which [`hir::Program::entry_sources`] now answers.
/// The name this function is published under, if the entry modules publish it.
///
/// [`hir::Program::public_api`] is the entry modules' export list, so this is
/// a lookup rather than a rule. `exported` is still required: a name the entry
/// re-exports whose declaration was refused has no function to publish, and
/// the lookup would otherwise name one that is not there.
///
/// A program with no entry module at all -- every module imported by some
/// other, which a cycle produces -- yields an empty list, and then nothing is
/// published. That is the honest answer rather than a fallback to the old
/// rule: an addon is a module's surface, and a program with no entry has none.
/// It reports as `built-but-dead` with an empty table, which is what it is.
fn published<'a>(program: &'a hir::Program, func: &hir::Func) -> Vec<&'a str> {
    // `exported` is NOT asked. It means "the declaration carries `export`",
    // and a module-private function published under an alias --
    // `export const localAlias = local` -- carries none while being part of the
    // surface. `public_api` is the authority on that question and this was a
    // second one that disagreed. A name whose declaration was refused has no
    // function in `funcs` for the lookup to find, which is what the flag was
    // standing in for.
    program
        .public_api
        .iter()
        .filter(|(emitted, _)| *emitted == func.name)
        .map(|(_, name)| name.as_str())
        .collect()
}

/// Report every export the addon could not represent, rather than dropping it.
///
/// Silence here is expensive in a way a refusal is not: a missing export costs
/// a test failure that names nothing -- `punycode.encode is not a function` --
/// and a day finding out why, where a diagnostic costs a reader one line. Six
/// of seven exports in one fixture were absent with no warning anywhere.
/// Exported object literals of functions, built on the JavaScript side out of
/// the wrappers above.
///
/// `punycode` publishes `ucs2 = { decode, encode }` and node's own tests call
/// `punycode.ucs2.encode`, so this is the shape between a compiled module and
/// its suite rather than a convenience.
///
/// A property whose function has no wrapper is left out and reported, and the
/// namespace itself is then not exported at all: a half-built one looks exactly
/// like a whole one from the far side.
/// Declare `module#init` where the program has one, and say whether it does.
///
/// The addon is a separate translation unit from `program.c`, so it declares
/// everything it calls -- `wrapper` emits one per wrapped function and this is
/// the one function the addon calls that nothing wraps.
///
/// **`refused` is consulted for the same reason every wrapper consults it, and
/// this one did not.** A refused body leaves the `Func` in the program, so
/// asking `program.funcs` answers *the program has top-level code*, which is a
/// different question from *the C file defines a function to call*. When the
/// two disagreed the addon declared `module__init`, called it from
/// `NAPI_MODULE_INIT`, and nothing defined it.
///
/// That artefact **links**: a shared object resolves undefined symbols at load,
/// so `clang` is content and `node` is not --
/// `undefined symbol: module__init`, at `require` time, with `emit-c` having
/// exited 0 and printed `wrote program.c`. The whole pipeline green and the
/// artefact unloadable.
///
/// It cost a real number quietly. `process` read **92 failed** in the compiled
/// axis and the truth was one load failure counted 92 times; the Node lane
/// bracketed it between two pinned compilers and handed it over, because from
/// their end it is a module that fails every test.
fn emit_module_init_prototype(
    program: &hir::Program,
    refused: &[String],
    out: &mut String,
) -> bool {
    let runs = program
        .funcs
        .iter()
        .any(|func| func.name == nts_core::hir::lower::MODULE_INIT)
        && !refused
            .iter()
            .any(|name| name == nts_core::hir::lower::MODULE_INIT);
    if runs {
        let _ = writeln!(
            out,
            "void {}(void);\n",
            c_identifier(nts_core::hir::lower::MODULE_INIT)
        );
    }
    runs
}

fn emit_namespaces(
    program: &hir::Program,
    emitted: &[&str],
    skipped: &mut Vec<Skipped>,
    out: &mut String,
) {
    for (name, properties) in &program.public_namespaces {
        let object = format!("nts_ns_{}", c_identifier(name));
        let _ = writeln!(
            out,
            "    napi_value {object};\n    if (!nts_napi_check(env, napi_create_object(env, &{object}), \"could not create an exported namespace\")) return NULL;"
        );
        // Published with the members that crossed, rather than withheld until
        // every member does.
        //
        // It used to be all-or-nothing, and that is a rule the *top level* does
        // not apply to itself: `path` publishes twelve of its own exports and
        // declines five, and nobody argues it should therefore publish none.
        // A namespace is the same export table one level down, and holding back
        // twelve working functions because `format` takes an object and
        // `matchesGlob` was refused in the lowering means `path.win32` stays
        // `undefined` -- which is what eight of that module's test files
        // dereference before they reach anything else.
        //
        // The half that made all-or-nothing look right is real and is kept:
        // every absent member is still named, one line each, so the namespace
        // is never quietly smaller than it looks. What changes is that a
        // reader gets `path.win32.join` *and* the list of what is missing,
        // instead of neither.
        let mut carried = 0usize;
        for (property, name_of) in properties {
            if !emitted.contains(&name_of.as_str()) {
                // A member that is a *value* rather than a function.
                // `export const sep = "/"` is a global, and a namespace built
                // only out of wrappers had neither `sep` nor `delimiter` --
                // which is the one place `posix` and `win32` differ in a way
                // callers depend on, `"/"` against `"\\"`.
                //
                // Read after `module__init()`, for the reason the top-level
                // value exports are: a deferred global holds its zero until
                // module evaluation assigns it.
                if let Some(text) = namespace_value(program, name_of, property) {
                    out.push_str(&text.replace("__NTS_NS__", &object));
                    carried += 1;
                    continue;
                }
                // **The reason is already known; this used to re-derive a
                // worse one.**
                //
                // A member with no wrapper has no wrapper for a *reason*, and
                // `crossings_of` computed it when it declined to make one --
                // `takes an object`, `returns Map<f64, string[]>`, `a class
                // member`. Answering "is neither a wrapped function nor a
                // value this backend can carry" instead throws that away and
                // tells the reader only that the pass looked and did not find
                // one, which they could see from the absence.
                //
                // Fifteen of the forty-eight declines across six modules said
                // it, against seven that named a type -- so the generic form
                // was the *commonest* thing the surface report said, and it is
                // the one sentence in it carrying no information.
                //
                // Searched by the underlying function's name rather than the
                // member path, because that is the key `crossings_of` records
                // under: `path.posix.format` is the member and `format@posix`
                // is the function that declined.
                let known = skipped
                    .iter()
                    .find(|earlier| earlier.function == *name_of)
                    .map(|earlier| earlier.reason.clone());
                skipped.push(Skipped {
                    function: format!("{name}.{property}"),
                    reason: known.unwrap_or_else(|| {
                        why_uncompiled(
                            program,
                            name_of,
                            "is a namespace member whose function was not compiled",
                        )
                    }),
                });
                continue;
            }
            carried += 1;
            let symbol = c_identifier(name_of);
            let key = c_string_literal(property);
            // A namespace member is where the arity count tripled: `path.posix`
            // and `path.win32` hold most of `path`, `util.types` most of
            // `util`, and a walk that stopped at the top level never saw them.
            let arity = program
                .funcs
                .iter()
                .find(|func| func.name == *name_of)
                .map_or(0, published_arity);
            let _ = write!(
                out,
                "    {{\n        napi_value fn;\n        if (!nts_napi_check(env, napi_create_function(env, {key}, NAPI_AUTO_LENGTH, nts_napi_{symbol}, NULL, &fn), \"could not create a namespace function\")) return NULL;\n        nts_napi_set_length(env, fn, {arity}u);\n        if (!nts_napi_check(env, napi_set_named_property(env, {object}, {key}, fn), \"could not add to a namespace\")) return NULL;\n    }}\n"
            );
        }
        // Not an empty one, though. A namespace object with no members at all
        // is a name bound to `{}`, which answers every presence check and no
        // call -- the same wrong-answer shape as a binding published as
        // `undefined`, and worse for being harder to see.
        if carried > 0 {
            let key = c_string_literal(name);
            let _ = writeln!(
                out,
                "    if (!nts_napi_check(env, napi_set_named_property(env, exports, {key}, {object}), \"could not export a namespace\")) return NULL;"
            );
        }
    }
}

/// The `extern` declarations a namespace's value members need.
///
/// Skips anything `declare_value_exports` already wrote: `path.sep` and
/// `path.posix.sep` are the same global under two names, and declaring it twice
/// is a redefinition rather than a duplicate.
fn declare_namespace_values(
    program: &hir::Program,
    values: &[(&hir::Global, &str, Cross)],
    functions: &[String],
) -> String {
    let mut out = String::new();
    let mut written: FxHashSet<&str> =
        values.iter().map(|(global, _, _)| global.name.as_str()).collect();
    for (_, properties) in &program.public_namespaces {
        for (property, emitted) in properties {
            if !written.insert(emitted.as_str())
                || namespace_value(program, emitted, property).is_none()
            {
                continue;
            }
            let Some(global) = program.globals.iter().find(|g| g.name == *emitted) else {
                continue;
            };
            declare_one_value(
                &mut out,
                &c_type(&global.ty, &program.layouts),
                &c_global(&global.name, functions.iter().map(String::as_str)),
            );
        }
    }
    if !out.is_empty() {
        out.push('\n');
    }
    out
}

/// One namespace member that is a global rather than a function.
///
/// `__NTS_NS__` stands in for the namespace object, which the caller
/// substitutes: the same text is written once per namespace and the object's
/// C name is the only thing that differs.
///
/// `None` when the name is not an exported global this backend can carry, which
/// is what makes the caller's decline honest rather than a guess.
fn namespace_value(program: &hir::Program, emitted: &str, property: &str) -> Option<String> {
    let at = program
        .globals
        .iter()
        .position(|global| global.name == *emitted && global.exported)?;
    let global = &program.globals[at];
    // The same rule the top-level value exports take: a global nothing writes
    // has no value to publish, and publishing it binds the name to `undefined`.
    if global.deferred && !program.global_is_initialized(u32::try_from(at).unwrap_or(u32::MAX)) {
        return None;
    }
    // `class_names(program)` and not an empty set, which is what this passed
    // until an object value export could publish. `cross` refuses a layout whose
    // name owns a `#` function, because such a value is more than its fields --
    // and with the set empty that guard is simply off.
    //
    // `export const ucs2 = { decode, encode }` is the case: a declared function
    // type gets an ordinary layout with a `Fn2__2#call`, so it is caught by the
    // class rule and by nothing else. `is_closure_type` does not see it -- that
    // asks about the synthetic band and this id is a declared type. With the set
    // empty the wrapper published `ucs2` whose `decode` was `{}`: an empty
    // JavaScript object where a function belongs, which is the wrong-value
    // failure the refusal exists to prevent, arriving as a *new export*.
    let crossing = cross(&global.ty, &program.layouts, &class_names(program))?;
    if matches!(crossing, Cross::Object(_) | Cross::Void) {
        return None;
    }
    // From `program` rather than from an empty iterator, which is what stood
    // here. A global colliding with one of the program's own functions is
    // spelled with a trailing underscore at the other four call sites and was
    // spelled without one here -- the two would have disagreed about the same
    // global, and the reader generated for it would have named a symbol that
    // does not exist.
    let symbol = format!(
        "{}()",
        value_reader(&c_global(
            &global.name,
            program.funcs.iter().map(|func| func.name.as_str())
        ))
    );
    let key = c_string_literal(property);
    let make = match crossing {
        Cross::Bool => format!("napi_get_boolean(env, {symbol}, &value)"),
        Cross::Number => format!("napi_create_double(env, (double){symbol}, &value)"),
        Cross::Str => format!("nts_to_napi_string(env, {symbol}, &value)"),
        Cross::Bytes => format!("nts_to_napi_view(env, {symbol}, &value)"),
        Cross::Erased => format!("nts_to_napi_value(env, {symbol}, &value)"),
        Cross::Entries => format!("nts_to_napi_entries(env, {symbol}, &value)"),
        Cross::Elements(inner) => format!(
            "{}(env, {symbol}, &value)",
            elements_helper(&inner, &program.layouts)
        ),
        Cross::Object(_) | Cross::Void => return None,
    };
    // **A value that cannot cross is left off the surface, not fatal.**
    //
    // An erased export goes through `nts_to_napi_value`, which refuses a
    // reference that is not a string -- an object's identity here is an address
    // and the far side cannot reproduce it. That refusal is right for a
    // *function's return*, where it is a call-time error the caller asked for.
    // At registration it killed the module: `http`'s addon answered
    // `TypeError: the compiled function returned a value with no JavaScript
    // representation` from `require`, and nothing loaded at all.
    //
    // Omitting the name is what the boundary already does for a function it
    // cannot wrap -- `no wrapper for X` -- and it is the same trade: a smaller
    // surface rather than none. The pending exception is cleared, because a
    // pending one makes every later napi call fail and the next export would
    // report this one's failure as its own.
    //
    // Reachable only once module evaluation runs: with `module#init` dropped
    // every global sat at its zero, which is the `undefined` tag and crosses
    // fine. Fixing the initializer is what made an object arrive here.
    Some(format!(
        "    {{\n        napi_value value;\n        if ({make} == napi_ok) {{\n            if (!nts_napi_check(env, napi_set_named_property(env, __NTS_NS__, {key}, value), \"could not add a value to a namespace\")) return NULL;\n        }} else {{\n            bool pending = false;\n            if (napi_is_exception_pending(env, &pending) == napi_ok && pending) {{\n                napi_value ignored;\n                napi_get_and_clear_last_exception(env, &ignored);\n            }}\n        }}\n    }}\n"
    ))
}

/// A value export: a module-scope binding published by its *value*.
///
/// `export const version = "2.1.0"` is not a function and the addon has no
/// wrapper to make for it. What it has is the global, which `lower::public_api`
/// now resolves by name and marks exported so `emit_globals` does not make it
/// `static` -- because `addon.c` is a different translation unit from
/// `program.c` and a static is invisible across one.
///
/// Read after `module__init()`, never before. A deferred global sits at its
/// zero until module evaluation runs, and for a reference that zero is a null
/// pointer rather than a default -- the same ordering that had `punycode`'s
/// `const delimiter = "-"` null when `decode` read it.
fn value_exports(program: &hir::Program) -> Vec<(&hir::Global, &str, Cross)> {
    let classes = class_names(program);
    let mut published = Vec::new();
    for (emitted, name) in &program.public_api {
        if program.public_functions.iter().any(|at| at == name) {
            continue;
        }
        let Some((at, global)) = program
            .globals
            .iter()
            .enumerate()
            .find(|(_, global)| global.name == *emitted && global.exported)
        else {
            continue;
        };
        // A global nothing writes has no value to publish, and publishing it
        // anyway binds the name to `undefined`. `excise_from_initializer`
        // removes the statements that depend on a refused call so the rest of a
        // module's evaluation still runs -- deliberately, and it reports each
        // one -- but the binding survives, zeroed.
        //
        // **A name bound to `undefined` is worse than an absent one.** It
        // satisfies "the module publishes something", it makes any export check
        // that asks only for presence agree, and it is exactly as incapable of
        // being a test's subject. `http` published `METHODS` and `methods` that
        // way, and node's `methods !== METHODS` while ours compared equal
        // because both were nothing.
        //
        // Reported rather than dropped silently: `report_unrepresentable_exports`
        // says which name and why, so the reader is sent to the refusal that
        // took the initializer instead of to an export table.
        // `deferred` is the half that makes this precise, and without it this
        // refused `literal-const-export`: a `const` whose value is a literal
        // carries it in `initial` and is never stored to, so "nothing writes
        // it" is true and means the opposite. `Global::deferred`'s own doc
        // draws the line -- `let x: number;` at zero is what the source asked
        // for, `const delimiter = "-"` at zero is a null pointer.
        if global.deferred
            && !program.global_is_initialized(u32::try_from(at).unwrap_or(u32::MAX))
        {
            continue;
        }
        // The same crossing a return value gets, and for the same reason: what
        // leaves is a copy, so nothing has to decide who owns the storage.
        let Some(crossing) = cross(&global.ty, &program.layouts, &classes) else {
            continue;
        };
        // An object *value* export publishes now: `os.constants` is a number
        // and four tables, and it is the one export that would make `os` the
        // second whole module. `Cross::Void` still cannot -- there is no value.
        if matches!(crossing, Cross::Void) {
            continue;
        }
        published.push((global, name.as_str(), crossing));
    }
    published
}

/// Modules whose exports were never considered, said out loud, once.
///
/// Every other decline in this file names something the backend *saw* and could
/// not carry. This names lists that never arrived: `hir::lower::public_api`
/// skipped those modules, so there is no export to have an opinion about and no
/// amount of reading `program.public_api` would reveal one.
///
/// It has to be here rather than left to a reader, because absence is what it
/// reports and absence is exactly what a reader cannot see. `fs` emitted an
/// addon with no publication section at all and no line about any of its 303
/// exports; the Node lane spent an evening establishing that the list had never
/// been passed in, which is a fact the compiler knew and did not say.
///
/// # One line, not one per module
///
/// The first version reported each excluded module. That is right for `fs`,
/// where the excluded module *is* the product, and it is noise everywhere
/// else: with no `files` array, every helper module a project has is excluded
/// by exactly this rule working correctly, and a project with thirty of them
/// gets thirty lines saying so. Worse, the noisy version cannot be read as a
/// warning at all, which is the failure mode it was written to fix.
///
/// So it says how many and shows the largest few. The count is the signal --
/// "the tsconfig named no roots and this is what that cost" -- and the names
/// are there to start from rather than to be complete.
///
/// Silent whenever the project named its root files. That is the fix; this is
/// the diagnostic for a project that has not.
/// Everything the surface walk did not carry, in the two forms it takes.
///
/// One call because they answer one question -- "why is this name not here" --
/// and a reader who gets the first without the second is told about the exports
/// that were considered and nothing about the lists that were not.
fn report_missing(
    program: &hir::Program,
    wrapped: &[(&str, &str)],
    published_classes: &[&str],
    refused: &[String],
    skipped: &mut Vec<Skipped>,
) {
    report_unrepresentable_exports(program, wrapped, published_classes, refused, skipped);
    report_unpublished_modules(program, skipped);
}

fn report_unpublished_modules(program: &hir::Program, skipped: &mut Vec<Skipped>) {
    if program.unpublished_modules.is_empty() {
        return;
    }
    let mut ranked: Vec<&(String, String, usize)> = program.unpublished_modules.iter().collect();
    // Largest first: the module that lost the most exports is the one most
    // likely to have been the product.
    ranked.sort_by(|left, right| right.2.cmp(&left.2).then_with(|| left.0.cmp(&right.0)));
    let total: usize = ranked.iter().map(|(_, _, exports)| exports).sum();
    let named: Vec<String> = ranked
        .iter()
        .take(3)
        .map(|(module, importer, exports)| {
            format!("{module} ({exports}, imported by {importer})")
        })
        .collect();
    let more = ranked.len().saturating_sub(named.len());
    let tail = if more == 0 {
        String::new()
    } else {
        format!(" and {more} more")
    };
    skipped.push(Skipped {
        function: format!("{} module(s)", ranked.len()),
        reason: format!(
            "declare {total} export(s) that were never considered: {}{tail}. With no \
             `files` array in the tsconfig, a module something imports is taken for a \
             library rather than the product -- which is wrong for any module its own \
             dependency imports back. Name the entry in `files` to decide it",
            named.join(", ")
        ),
    });
}

fn report_unrepresentable_exports(
    program: &hir::Program,
    wrapped: &[(&str, &str)],
    published_classes: &[&str],
    refused: &[String],
    skipped: &mut Vec<Skipped>,
) {
    let values = value_exports(program);
    let already: FxHashSet<String> = skipped.iter().map(|s| s.function.clone()).collect();
    for (emitted, name) in &program.public_api {
        // A specific reason already given is the better one, and this pass
        // cannot improve on it. Re-deriving from the symbol produced *two*
        // lines for one export -- "is a class whose constructor was not
        // compiled", which says what to fix, followed by "is not a function
        // this backend can name", which says the thing that has been true of
        // every class since before either message existed.
        if already.contains(emitted)
            || published_classes.contains(&name.as_str())
            || wrapped.iter().any(|(_, published)| published == name)
            || program.public_namespaces.iter().any(|(at, _)| at == name)
            || values.iter().any(|(_, published, _)| published == name)
        {
            continue;
        }
        skipped.push(Skipped {
            function: name.clone(),
            // Two different causes, and they send a reader to different
            // places: one is "teach the backend this export shape" and the
            // other is "fix the lowering upstream". Saying "is not a function"
            // for both cost the Node session a build looking at export shapes
            // for three `export function` declarations that had simply been
            // refused.
            // Three causes, and each sends a reader somewhere different: fix
            // the signature, fix the lowering, or teach the backend a shape.
            // Told apart by what the SYMBOL declares rather than by whether a
            // function of that name survived -- inferring from absence made a
            // string constant read as a refused function.
            reason: if program.funcs.iter().any(|func| func.name == *emitted) {
                "is exported and its signature does not cross".to_owned()
            } else if program.public_functions.iter().any(|at| at == name) {
                // **The effect, and now the cause beside it.** This said only
                // that no function of that name was compiled -- true, and 228
                // of the profile's declined exports, each one telling a reader
                // that a name is absent and sending them nowhere.
                //
                // The refusal that took it is carried on the program because
                // the two are decided in one place. Where it is a cascade --
                // `calls X, which was refused above` -- it names the callee
                // rather than the root, which is still somewhere to go and is
                // exactly what the cascade was built to say.
                program
                    .uncompiled
                    .iter()
                    .find(|(at, _)| at == emitted || at == name)
                    .map_or_else(
                        || {
                            // **Two causes wore one sentence.** `uncompiled`
                            // carries the *lowering's* refusals; a body the
                            // **backend** dropped is not in it, so every one of
                            // those read "no function of that name was
                            // compiled" -- which states the effect and sends
                            // the reader nowhere. The Node lane counted 105 of
                            // them across 26 modules, against 257 declines that
                            // do name a reason.
                            //
                            // `refused` tells them apart, and it can only do so
                            // since it started recording what
                            // `drop_orphaned_bodies` removes: before that, a
                            // cascade drop was absent from both lists and this
                            // arm was the only thing left to say.
                            if refused.iter().any(|at| at == emitted || at == name) {
                                "is exported and this backend refused its body, which is \
                                 reported above as an NTS2xxx against the function"
                                    .to_owned()
                            } else {
                                "is exported and no function of that name was compiled"
                                    .to_owned()
                            }
                        },
                        |(_, why)| format!("is exported and was not compiled: {why}"),
                    )
            // **A value export whose type does not cross**, which the last arm
            // called "not a function" -- false for half the names it covered.
            //
            // `export const deepStrictEqual = looseAssertions.deepStrictEqual`
            // *is* a function, read off an instance as a value. It is a global,
            // it is exported, `value_exports` finds it and `cross` declines its
            // type, so it fell to a sentence that sends a reader to look at
            // export *shapes* when what is wanted is a crossing for the type.
            //
            // 44 of `assert`'s declined exports are this, and the Node lane
            // reported the message as wrong twice before it was. Saying which
            // type is the whole of the fix: "a closure" and "an object" go to
            // different places.
            } else if let Some(global) = program
                .globals
                .iter()
                .find(|global| global.name == *emitted && global.exported)
                && cross(&global.ty, &program.layouts, &class_names(program)).is_none()
            {
                format!(
                    "is exported as a value of type `{}`, which does not cross",
                    spell(&global.ty)
                )
            } else {
                "is exported and is not a function this backend can name".to_owned()
            },
        });
    }
}

/// The name of the file-scope reader for a value export.
///
/// A value export is read inside `NAPI_MODULE_INIT`, whose parameter is named
/// `env` -- and `process.env` is a global whose C name is `env`. The extern at
/// file scope was shadowed by the parameter, so the wrapper compiled
/// `nts_to_napi_entries(env, env, &value)` and clang reported a `napi_env` where
/// an `NtsMap *` belonged. `process` and `readline` stopped building the day
/// object and table value exports started publishing.
///
/// Read through a function defined where the global is visible, and the
/// shadowing cannot happen for `env` or for any other name the wrapper
/// introduces -- `exports`, `out`, `value`, `status`, `argv`. Naming them all in
/// a reserved list would be the same fix minus the guarantee, and it would go
/// stale the next time a wrapper gains a local.
///
/// `nts_` is reserved to this backend, so a user global cannot collide with the
/// reader itself; `a_name_this_backend_generates_is_also_reserved` is what keeps
/// that true.
fn value_reader(symbol: &str) -> String {
    format!("nts_export_{symbol}")
}

/// The extern and its reader, which are always written together.
fn declare_one_value(out: &mut String, spelling: &str, symbol: &str) {
    let reader = value_reader(symbol);
    let _ = writeln!(out, "extern {spelling} {symbol};");
    let _ = writeln!(
        out,
        "static {spelling} {reader}(void) {{ return {symbol}; }}"
    );
}
/// The `extern` declarations, at file scope, which is where one belongs.
fn declare_value_exports(
    values: &[(&hir::Global, &str, Cross)],
    layouts: &[hir::Layout],
    functions: &[String],
) -> String {
    let mut out = String::new();
    for (global, _, _) in values {
        declare_one_value(
            &mut out,
            &c_type(&global.ty, layouts),
            &c_global(&global.name, functions.iter().map(String::as_str)),
        );
    }
    if !values.is_empty() {
        out.push('\n');
    }
    out
}

/// Whether this layout is the one whose C struct is named `instance`.
///
/// By the emitted spelling rather than by the layout's own name, because the
/// class emitter takes `instance` from the *constructor's receiver type* --
/// deliberately, so the struct the factory allocates and the struct the wrapper
/// unwraps cannot disagree about spelling. Matching on `layout.name` would
/// reintroduce exactly the disagreement that was designed out.
fn c_type_is(layout: &hir::Layout, instance: &str) -> bool {
    format!("NtsObj_{}", c_identifier(&layout.name)) == instance
}

/// A getter per instance field, and the descriptors that publish them.
///
/// A class crossed with its prototype methods and **none of its data**:
/// `napi_define_class` was handed a descriptor list built only from
/// `program.funcs`, and a field is not a function, so `Object.keys(instance)`
/// was `[]` and every declared field read `undefined`. The methods that read
/// those fields answered correctly the whole time -- the fields were populated
/// and unreachable, not unset, which is why nothing noticed.
///
/// The Node lane measured it twice rather than once, on `fs.Stats` and on a
/// three-field reduction, so `Stats` could not be peculiar. `stats.size` is the
/// point of the object and `isFile()` is the convenience; 24 of node's
/// `test-fs-*.js` read a field off a stat.
///
/// **Getters, not data properties, and not setters.** The value lives in this
/// heap and the JavaScript object only points at it, so a data property would be
/// a copy taken at construction that stops tracking the object it came from --
/// wrong for anything a method mutates. A setter is the inbound direction, which
/// for a reference field has no representation at all; a scalar one could be
/// written and is deliberately not, because publishing setters for the scalars
/// and not the references would make the same class writable in some fields and
/// silently not in others. `stats.size = 1` is a no-op here and throws in strict
/// mode under node, and that difference is named rather than papered over.
///
/// A field whose type cannot cross is skipped rather than refusing the class:
/// the alternative loses the methods too, and a class with most of its data is
/// worth more than no class. `Skipped` records each one, so `sweep.mjs` can
/// still say what is missing.
fn field_accessors(
    layout: &hir::Layout,
    instance: &str,
    layouts: &[hir::Layout],
    classes: &FxHashSet<String>,
    skipped: &mut Vec<Skipped>,
) -> (String, Vec<String>) {
    let mut out = String::new();
    let mut descriptors = Vec::new();
    for field in &layout.fields {
        let Some(crossing) = cross(&field.ty, layouts, classes) else {
            skipped.push(Skipped {
                function: format!("{}.{}", layout.name, field.name),
                reason: format!("is a field of type {} and does not cross", spell(&field.ty)),
            });
            continue;
        };
        let member = c_member(&field.name);
        let symbol = format!(
            "nts_napi_get_{}_{}",
            c_identifier(&layout.name),
            c_identifier(&field.name)
        );
        let Some(make) = conversion(&crossing, &format!("nts_self->{member}"), layouts) else {
            continue;
        };
        let _ = write!(
            out,
            "static napi_value {symbol}(napi_env env, napi_callback_info info) {{\n                 napi_value self;\n                 if (!nts_napi_check(env, napi_get_cb_info(env, info, NULL, NULL, &self, NULL), \"could not read callback arguments\")) return NULL;\n                 {instance} *nts_self = NULL;\n                 if (!nts_napi_check(env, napi_unwrap(env, self, (void **)&nts_self), \"could not read the instance\")) return NULL;\n                 napi_value value = NULL;\n                 if (!nts_napi_check(env, {make}, \"could not read a field\")) return NULL;\n                 return value;\n}}\n"
        );
        let property = c_string_literal(&field.name);
        descriptors.push(format!(
            "{{ {property}, NULL, NULL, {symbol}, NULL, NULL, napi_enumerable, NULL }}"
        ));
    }
    // Defined on the *instance* as well as on the prototype, which is the
    // difference between reading and behaving.
    //
    // `napi_define_class` puts its descriptors on the prototype, so the fields
    // read correctly and `Object.keys(stat)` was still `[]`, `JSON.stringify`
    // still `{}`, and `Object.hasOwn(stat, "size")` still false -- against
    // node's fourteen own enumerable properties. Node's `Stats` constructor
    // assigns fourteen own fields, so this is the same work in the same place
    // rather than an extra pass: the cost is per construction either way.
    //
    // Accessors rather than values, for the reason the prototype ones are
    // accessors: the data lives in this heap and a snapshot taken at
    // construction would stop tracking whatever a method does to it.
    let _ = writeln!(
        out,
        "static bool nts_napi_define_{instance}_fields(napi_env env, napi_value self) {{"
    );
    if descriptors.is_empty() {
        let _ = write!(out, "    (void)env;\n    (void)self;\n    return true;\n}}\n");
    } else {
        let _ = write!(
            out,
            "    napi_property_descriptor own[] = {{\n        {}\n    }};\n    return nts_napi_check(env, napi_define_properties(env, self, sizeof(own) / sizeof(own[0]), own), \"could not define the instance fields\");\n}}\n",
            descriptors.join(",\n        ")
        );
    }

    (out, descriptors)
}

/// Turning one already-read C value into a `napi_value` called `value`.
///
/// The same expression a value export needs and a class field needs, written
/// once. They were one `match` inside `publish_value_exports` until a field
/// wanted it too, and two copies of a per-crossing table is how the erasure
/// pair in `lower.rs` and `emit.rs` drifted seven times.
///
/// `Cross::Void` has no expression, which is why this answers `Option` rather
/// than `String`: a value with nothing to read has nothing to convert.
fn conversion(crossing: &Cross, symbol: &str, layouts: &[hir::Layout]) -> Option<String> {
    Some(match crossing {
        Cross::Bool => format!("napi_get_boolean(env, {symbol}, &value)"),
        Cross::Number => format!("napi_create_double(env, (double){symbol}, &value)"),
        Cross::Str => format!("nts_to_napi_string(env, {symbol}, &value)"),
        Cross::Elements(inner) => {
            format!("{}(env, {symbol}, &value)", elements_helper(inner, layouts))
        }
        Cross::Bytes => format!("nts_to_napi_view(env, {symbol}, &value)"),
        Cross::Erased => format!("nts_to_napi_value(env, {symbol}, &value)"),
        Cross::Entries => format!("nts_to_napi_entries(env, {symbol}, &value)"),
        Cross::Object(at) => format!("{}(env, {symbol}, &value)", object_helper(&layouts[*at])),
        Cross::Void => return None,
    })
}

/// The publication, which goes *after* `module__init()` and the ordering is the
/// whole of it: a deferred global holds its zero until module evaluation
/// assigns it, and for a reference that zero is a null pointer rather than a
/// default.
fn publish_value_exports(
    values: &[(&hir::Global, &str, Cross)],
    layouts: &[hir::Layout],
    functions: &[String],
) -> String {
    let mut out = String::new();
    for (global, publish, crossing) in values {
        let symbol = format!(
            "{}()",
            value_reader(&c_global(&global.name, functions.iter().map(String::as_str)))
        );
        let key = c_string_literal(publish);
        // `value_exports` refuses `Void`, so a `None` here is a bug in it
        // rather than a shape to handle.
        let Some(make) = conversion(crossing, &symbol, layouts) else {
            continue;
        };
        let _ = write!(
            out,
            // Left off the surface rather than fatal, for the reason the
            // namespace form beside it gives: an erased export whose value is
            // an object refuses at `nts_to_napi_value`, and killing the module
            // for one name is a worse trade than publishing the rest. This is
            // the pair -- top-level exports here, namespace members there --
            // and guarding one is guarding half.
            "    {{\n        napi_value value;\n        if ({make} == napi_ok) {{\n            if (!nts_napi_check(env, napi_set_named_property(env, exports, {key}, value), \"could not export a value\")) return NULL;\n        }} else {{\n            bool pending = false;\n            if (napi_is_exception_pending(env, &pending) == napi_ok && pending) {{\n                napi_value ignored;\n                napi_get_and_clear_last_exception(env, &ignored);\n            }}\n        }}\n    }}\n"
        );
    }
    out
}

/// As [`emit_with`], for a caller that has not run the C backend.
///
/// Every wrapper is written, which is right when nothing has been refused and
/// optimistic when something has. The CLI passes the backend's list; this exists
/// so a test or a probe need not.
#[must_use]
pub fn emit(program: &hir::Program) -> Addon {
    emit_with(program, &[])
}

/// Generate the addon.
///
/// `refused` is the C backend's list of functions whose bodies it declined to
/// emit. It has to be passed in because nothing in the program says so: a
/// refused body leaves the `Func` in place, so this pass saw a public export
/// with a signature that crosses and wrote a wrapper naming a symbol that does
/// not exist. The link then failed with an undefined symbol and the build
/// reported "no addon built" -- true, and reading as though the module were far
/// away rather than one function short.
#[must_use]
/// The two halves of a value export, which are written far apart.
///
/// A value export needs an `extern` at file scope and a `napi_set_named_property`
/// inside `NAPI_MODULE_INIT`, and the list of globals both halves walk has to be
/// the same list. Computing it twice invited them to disagree, so it is computed
/// once here and the caller places the two strings.
///
/// A namespace's value members are globals too, and they are not in `public_api`
/// -- `path.win32.sep` is published on the namespace object rather than on
/// `exports`. Without the extern the addon, a different translation unit from
/// `program.c`, reports `use of undeclared identifier 'sep17'`.
fn value_export_text(program: &hir::Program) -> (String, String) {
    let values = value_exports(program);
    let functions: Vec<String> =
        program.funcs.iter().map(|func| func.name.clone()).collect();
    let mut declarations = declare_value_exports(&values, &program.layouts, &functions);
    declarations.push_str(&declare_namespace_values(program, &values, &functions));
    let publishing = publish_value_exports(&values, &program.layouts, &functions);
    (declarations, publishing)
}

/// The structs the wrappers read fields out of, and the helpers that build them.
///
/// `program.c` defines these too, and both derive them from the same `Layout` --
/// which is what that type is for: "the compiler's answer to where is this
/// field, decided once and consumed by every backend". A header emitted by
/// `codegen/c` would be better still, and would remove this repetition entirely.
fn emit_layouts(
    out: &mut String,
    program: &hir::Program,
    mut needed: Vec<usize>,
    structs_only: &[usize],
) {
    // And every layout those reach through an object field. `os.cpus()` returns
    // `CpuInfo[]`, `CpuInfo` holds a `CpuTimes`, and nothing named `CpuTimes`:
    // the wrapper published `cpus`, emitted a helper that called
    // `nts_to_napi_obj_CpuTimes`, and declared neither the struct nor the
    // function. Text that names what it never defines, which is the shape
    // `addon-compiles` exists to catch and did.
    //
    // A queue rather than recursion because the closure is over a graph, and
    // `object_crosses` has already refused the cyclic ones -- so this
    // terminates for a reason stated somewhere else, and the `contains` check
    // is what makes that true here rather than assumed.
    let mut at = 0;
    while at < needed.len() {
        let layout = &program.layouts[needed[at]];
        let nested: Vec<usize> = layout
            .fields
            .iter()
            .filter_map(|field| match &field.ty {
                HirType::Managed(ManagedType::Object(id)) => {
                    program.layouts.iter().position(|l| l.types.contains(id))
                }
                _ => None,
            })
            .collect();
        for one in nested {
            if !needed.contains(&one) {
                needed.push(one);
            }
        }
        at += 1;
    }
    needed.sort_unstable();
    needed.dedup();

    // Three passes over the same list, because C reads forwards and this graph
    // does not. A struct whose field points at a layout declared later needs the
    // typedef first; a helper that calls a helper declared later needs its
    // prototype. Emitting each layout complete before the next worked only while
    // nothing nested.
    // A class's struct is needed too, and for a different reason: its field
    // getters dereference the instance. It gets no `nts_to_napi_obj_` helper --
    // a class does not cross as a plain object, which is what `object_crosses`
    // refuses it for -- so the two lists are separate and only the first two
    // passes see both.
    //
    // Without this the addon carried `typedef struct NtsObj_Reading
    // NtsObj_Reading;` and no body, and the getters were `incomplete definition
    // of type`. The class emitter wrote that typedef itself, which is why the
    // *methods* linked: they pass the pointer through without reading it.
    let mut structs: Vec<usize> = needed.iter().copied().chain(structs_only.iter().copied()).collect();
    structs.sort_unstable();
    structs.dedup();

    // Every struct any of these *mentions*, which needs a typedef and no body.
    //
    // A class's fields are the reason: `fs`'s `Stats` sits in a program whose
    // classes hold `Blob` and `ReadableStream` pointers, and emitting a body
    // that names a type nothing declared is `unknown type name
    // 'NtsObj_Blob5395'` -- nineteen of them in one module. A pointer field
    // needs the name to exist and never the layout, so the closure stops at one
    // step and does not recurse.
    let mut mentioned: Vec<usize> = structs
        .iter()
        .flat_map(|at| program.layouts[*at].fields.iter())
        .filter_map(|field| match &field.ty {
            HirType::Managed(ManagedType::Object(id)) => {
                program.layouts.iter().position(|l| l.types.contains(id))
            }
            _ => None,
        })
        .collect();
    mentioned.extend(structs.iter().copied());
    mentioned.sort_unstable();
    mentioned.dedup();

    for at in &mentioned {
        let name = format!("NtsObj_{}", c_identifier(&program.layouts[*at].name));
        let _ = writeln!(out, "typedef struct {name} {name};");
    }
    if !mentioned.is_empty() {
        out.push('\n');
    }
    for at in &structs {
        let layout = &program.layouts[*at];
        let name = format!("NtsObj_{}", c_identifier(&layout.name));
        let _ = writeln!(out, "struct {name} {{");
        out.push_str("    NtsHeader header;\n");
        for field in &layout.fields {
            let _ = writeln!(
                out,
                "    {} {};",
                c_type(&field.ty, &program.layouts),
                c_identifier(&field.name)
            );
        }
        out.push_str("};\n\n");
    }
    for at in &needed {
        let layout = &program.layouts[*at];
        let _ = writeln!(
            out,
            "static napi_status {}(napi_env env, const NtsObj_{} *result, napi_value *into);",
            object_helper(layout),
            c_identifier(&layout.name)
        );
    }
    if !needed.is_empty() {
        out.push('\n');
    }
    for at in &needed {
        emit_object_helper(out, &program.layouts[*at], &program.layouts);
    }
}

#[must_use]
pub fn emit_with(program: &hir::Program, refused: &[String]) -> Addon {
    let mut out = preamble(program);

    let classes = class_names(program);
    let ownership = hir::own::summarize(program, &program.layouts);
    let release_managed = program.provider == hir::Provider::ReferenceCounting;

    // The structs the wrappers read fields out of. `program.c` defines these
    // too, and both derive them from the same `Layout` -- which is what that
    // type is for: "the compiler's answer to where is this field, decided once
    // and consumed by every backend". A header emitted by `codegen/c` would be
    // better still, and would remove this repetition entirely.
    let needed: Vec<usize> = program
        .funcs
        .iter()
        .filter(|f| !published(program, f).is_empty())
        .flat_map(|f| std::iter::once(&f.return_type).chain(f.params.iter().map(|p| &p.ty)))
        // And the types of the *value* exports, which name no function at all --
        // `export const constants: OsConstants` is a global, and without this
        // its helper was never emitted and the publication named a function
        // nothing declared.
        .chain(value_exports(program).into_iter().map(|(global, _, _)| &global.ty))
        .filter_map(|ty| match cross(ty, &program.layouts, &classes) {
            Some(Cross::Object(at)) => Some(at),
            // An `object[]` needs the struct *and* the helper the element loop
            // calls, and without this the array named a type nothing declared.
            Some(Cross::Elements(inner)) => match *inner {
                Cross::Object(at) => Some(at),
                _ => None,
            },
            _ => None,
        })
        .collect();
    // Every class this addon defines, by the layout its constructor receives.
    // Taken from the receiver rather than from the name for the reason the class
    // emitter takes `instance` that way: the struct the factory allocates and
    // the struct the wrapper unwraps must not be able to disagree.
    let class_layouts: Vec<usize> = program
        .funcs
        .iter()
        .filter(|func| func.name.ends_with("#constructor"))
        .filter_map(|func| match &func.params.first()?.ty {
            HirType::Managed(ManagedType::Object(id)) => {
                program.layouts.iter().position(|l| l.types.contains(id))
            }
            _ => None,
        })
        .collect();
    emit_layouts(&mut out, program, needed, &class_layouts);

    let runs_module_init = emit_module_init_prototype(program, refused, &mut out);

    let mut skipped = Vec::new();
    // The emitted symbol and the name it goes out under, which differ wherever
    // two modules declared one name or a re-export renamed it.
    let mut wrapped: Vec<(&str, &str)> = Vec::new();
    // Every symbol that got a wrapper, published or not.
    let mut emitted: Vec<&str> = Vec::new();
    for func in &program.funcs {
        let names = published(program, func);
        // A namespace member needs a wrapper too, and is registered on the
        // object rather than on `exports`.
        let in_namespace = program.public_namespaces.iter().any(|(_, properties)| {
            properties.iter().any(|(_, emitted)| *emitted == func.name)
        });
        if names.is_empty() && !in_namespace {
            continue;
        }
        if let Some(missing) = refused_body(refused, &func.name) {
            skipped.push(missing);
            continue;
        }
        if let Some(missing) = opaque_slot(program, &func.name) {
            skipped.push(missing);
            continue;
        }
        match wrapper(
            program,
            func,
            &program.layouts,
            &classes,
            release_managed,
            ownership.hands_back(&func.name),
            ownership.consumes(&func.name),
        ) {
            Ok(text) => {
                out.push_str(&text);
                // One wrapper, one registration per name it is exported under:
                // `export const upper = impl.upper` and
                // `export const alias = impl.upper` are one function and two
                // properties, and a loop that asked each function for *a* name
                // published it once under whichever came first.
                // The symbol is recorded whether or not it is published under
                // a name of its own: a namespace member has no top-level name
                // and still has a wrapper, and looking it up in `wrapped`
                // reported the namespace as unbuildable while its wrapper sat
                // in the same file.
                emitted.push(func.name.as_str());
                for publish in names {
                    wrapped.push((func.name.as_str(), publish));
                }
            }
            Err(why) => skipped.push(why),
        }
    }

    let (class_inits, published_classes) =
        emit_classes(program, &classes, &ownership, release_managed, &mut skipped, &mut out);

    let (value_declarations, value_publishing) = value_export_text(program);
    out.push_str(&value_declarations);

    out.push_str("NAPI_MODULE_INIT() {\n");
    // Run the module's own top-level code before anything can call into it.
    //
    // Without this every module-scope value stays at its static initializer,
    // which for a reference is null -- `punycode`'s `const delimiter = "-"` was
    // null when `decode` read it, and the addon loaded, published all four
    // functions and then segfaulted inside `nts_str_find` on the first call
    // that touched one.
    //
    // The C backend's `--main` path has always done this; the addon path never
    // did, and nothing noticed because no module reached the point of being
    // called until this week. `module#init` exists whenever the file has a
    // module-scope declaration at all, and where it does not there is nothing
    // to run and nothing is emitted.
    // Hand the runtime the environment before anything can want it.
    //
    // A compiled program's diagnostics have nowhere to go in a standalone
    // binary, so `runtime/node/internal/process.c` writes a warning to stderr.
    // An addon is not standalone -- it is running *inside* node, where there is
    // a `process` to emit on -- and `process.emitWarning` is the faithful
    // route: node defers the `'warning'` event to a later tick, so an
    // expectation registered after the module loads still catches it, which is
    // what `common.expectWarning` in node's own tests needs and what a line on
    // stderr can never satisfy.
    //
    // Before `module__init()`, and that is the whole of the ordering argument:
    // `punycode`'s top-level code is where its `DEP0040` warning is emitted, so
    // an env set afterwards is set too late. Only `NAPI_MODULE_INIT` has one to
    // give.
    out.push_str("    nts_napi_set_env(env);\n");
    if runs_module_init {
        let _ = writeln!(
            out,
            "    {}();",
            c_identifier(nts_core::hir::lower::MODULE_INIT)
        );
    }
    out.push_str(&publish_functions(program, &wrapped));
    out.push_str(&class_inits);
    emit_namespaces(program, &emitted, &mut skipped, &mut out);
    out.push_str(&value_publishing);
    out.push_str("    return exports;\n}\n");

    report_missing(program, &wrapped, &published_classes, refused, &mut skipped);

    Addon {
        source: out,
        skipped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scalar_c_types_preserve_the_program_abi() {
        let layouts = [];
        assert_eq!(
            c_type(
                &HirType::Int {
                    bits: 32,
                    signed: true,
                },
                &layouts,
            ),
            "int32_t"
        );
        assert_eq!(c_type(&HirType::Float { bits: 32 }, &layouts), "float");
        assert_eq!(c_type(&HirType::Float { bits: 64 }, &layouts), "double");
    }

    #[test]
    fn numeric_arguments_cross_through_a_javascript_number() {
        let layouts = [];
        let ty = HirType::Int {
            bits: 64,
            signed: true,
        };
        assert_eq!(
            declare_argument(&Cross::Number, &ty, &layouts, "a0"),
            "    double a0_number = 0;\n    int64_t a0 = 0;\n"
        );
        let conversion = unmarshal(&Cross::Number, &ty, &layouts, "a0", 0, "value");
        assert!(conversion.contains("napi_get_value_double(env, argv[0], &a0_number)"));
        assert!(conversion.contains("a0 = (int64_t)a0_number"));
    }

    #[test]
    fn an_array_crosses_by_what_its_elements_are() {
        // Was `an_array_is_not_guessed_to_be_a_rest_parameter`, and it asserted
        // that `string[]` does not cross **at all** -- true while `number[]`
        // was the only array, and a far stronger claim than its name made. The
        // rest question belongs to `Param::shape`, which `wrapper` asks
        // directly; this test never reached it.
        let strings = HirType::Managed(ManagedType::Array(Box::new(HirType::Managed(
            ManagedType::String,
        ))));
        assert!(matches!(
            cross(&strings, &[], &FxHashSet::default()),
            Some(Cross::Elements(inner)) if matches!(*inner, Cross::Str)
        ));

        // The control, and the point of the change: an element that cannot be
        // marshalled one at a time still refuses, so the refusal is the
        // element's and moves when the element does.
        let views = HirType::Managed(ManagedType::Array(Box::new(HirType::Managed(
            ManagedType::View(Box::new(HirType::Int {
                bits: 8,
                signed: false,
            })),
        ))));
        assert!(cross(&views, &[], &FxHashSet::default()).is_none());
    }

    #[test]
    fn reference_counting_obeys_the_return_ownership_summary() {
        assert!(should_release_result(true, false));
        assert!(!should_release_result(true, true));
        assert!(!should_release_result(false, false));

        let string = HirType::Managed(ManagedType::String);
        let owned = marshal(&Cross::Str, &string, "make()", "", &[], true, false);
        assert!(owned.contains("nts_release((NtsHeader *)result)"));

        let borrowed = marshal(
            &Cross::Str,
            &string,
            "echo(a0)",
            "",
            &[],
            true,
            true,
        );
        assert!(!borrowed.contains("nts_release((NtsHeader *)result)"));
    }

    #[test]
    fn reference_counting_forgets_only_arguments_the_callee_consumes() {
        let crossings = [Cross::Str, Cross::Str, Cross::Number];
        let args = ["a0".to_owned(), "a1".to_owned(), "a2".to_owned()];
        let mut consumed = FxHashSet::default();
        consumed.insert(1);
        consumed.insert(2);

        assert_eq!(
            forget_consumed_arguments(&crossings, &args, true, Some(&consumed)),
            "    a1 = NULL;\n"
        );
        assert!(forget_consumed_arguments(&crossings, &args, false, Some(&consumed)).is_empty());
    }

    #[test]
    fn strings_cross_as_utf16() {
        assert!(SUPPORT.contains("napi_get_value_string_utf16"));
        assert!(SUPPORT.contains("napi_create_string_utf16"));
        assert!(SUPPORT.contains("napi_create_string_latin1"));
        assert!(!SUPPORT.contains("napi_get_value_string_utf8"));
        assert!(SUPPORT.contains("SIZE_MAX / sizeof(uint16_t)"));
    }

    #[test]
    fn javascript_names_are_safe_c_literals() {
        assert_eq!(c_string_literal("plain"), "\"plain\"");
        assert_eq!(c_string_literal("a\\\"b"), "\"a\\\\\\\"b\"");
        assert_eq!(c_string_literal("λ"), "\"\\316\\273\"");
        assert_eq!(
            set_property_call("plain"),
            "napi_set_named_property(env, out, \"plain\", value)"
        );
        assert_eq!(
            set_property_call("a\0b"),
            "nts_napi_set_utf8_property(env, out, \"a\\000b\", 3u, value)"
        );
    }

    /// A module whose exports were never considered is reported, once, with a
    /// count.
    ///
    /// The defect this guards is an *absence*, which is why it is tested here
    /// rather than left to a fixture: `fs` emitted an addon with no publication
    /// section and no decline naming any of its 303 exports, and every check
    /// anyone had asked "is what was emitted correct" rather than "was anything
    /// skipped before emission began". A silent skip passes all of them.
    #[test]
    fn a_module_that_was_never_considered_is_named_once() {
        let program = hir::Program {
            unpublished_modules: vec![
                (
                    "nts-workspace:///src/main.ts".to_owned(),
                    "nts-workspace:///src/back.ts".to_owned(),
                    303,
                ),
                (
                    "nts-workspace:///src/back.ts".to_owned(),
                    "nts-workspace:///src/main.ts".to_owned(),
                    1,
                ),
            ],
            ..hir::Program::default()
        };
        let mut skipped = Vec::new();
        report_unpublished_modules(&program, &mut skipped);
        assert_eq!(
            skipped.len(),
            1,
            "one line, not one per module: with no `files` array every helper a \
             project has is excluded by the rule working correctly, and a line \
             each makes the report unreadable exactly where it matters",
        );
        assert!(
            skipped[0].reason.contains("304 export(s)"),
            "the total is the signal and it is missing: {}",
            skipped[0].reason
        );
        assert!(
            skipped[0].reason.find("main.ts").unwrap_or(usize::MAX)
                < skipped[0].reason.find("back.ts").unwrap_or(0),
            "largest first, so the module most likely to have been the product \
             is the one a reader sees: {}",
            skipped[0].reason
        );
    }

    /// And says nothing at all when the project named its roots.
    ///
    /// The other half, and the one that keeps this from becoming noise: every
    /// tsconfig that names `files` should see none of this, so a regression
    /// that reported unconditionally would be caught here rather than by
    /// somebody reading twenty-two addons.
    #[test]
    fn a_project_that_named_its_roots_is_told_nothing() {
        let program = hir::Program::default();
        let mut skipped = Vec::new();
        report_unpublished_modules(&program, &mut skipped);
        assert!(skipped.is_empty(), "{skipped:?}");
    }
}
