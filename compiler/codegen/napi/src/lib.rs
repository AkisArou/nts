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

use nts_codegen_c::{c_global, c_identifier};
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
        // A closure is represented by a synthetic object layout, but its
        // JavaScript value is a function. Copying captured fields into a plain
        // object would silently change its kind at the boundary.
        HirType::Managed(ManagedType::Object(id)) if hir::is_closure_type(*id) => None,
        HirType::Managed(ManagedType::Object(id)) => {
            let at = layouts.iter().position(|l| l.types.contains(id))?;
            // A class instance is more than its fields: its methods are how it
            // is used, and a plain object of the data would answer
            // `stats.isDirectory` with `undefined` rather than with an error.
            // Better to have no wrapper than a wrapper that loses behaviour.
            if classes.contains(&layouts[at].name)
                || layouts[at].base.is_some()
                || !layouts[at].methods.is_empty()
            {
                return None;
            }
            // One level. A field that is itself a record needs the same
            // treatment recursively, and the wrapper does not implement that
            // recursive object construction yet.
            layouts[at]
                .fields
                .iter()
                .all(|f| {
                    matches!(
                        f.ty,
                        HirType::Bool
                            | HirType::Float { .. }
                            | HirType::Int { .. }
                            | HirType::Managed(ManagedType::String)
                    )
                })
                .then_some(Cross::Object(at))
        }
        // A `never` return means the call does not come back, so there is
        // nothing for a wrapper to hand back.
        HirType::Never => None,
        // An erased value is a tag beside a payload, and crossing it would mean
        // building whichever JS value the tag currently names -- a switch, not
        // a conversion. Answering `None` keeps that decision out of this file
        // until an erased value can actually reach a boundary.
        HirType::Erased => None,
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
        HirType::Managed(ManagedType::Map(_, _) | ManagedType::Set(_)) => {
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
    napi_status made = napi_generic_failure;
    napi_value error = NULL;
    if (class_name != NULL && strcmp(class_name, "RangeError") == 0) {
        made = napi_create_range_error(env, NULL, message, &error);
    } else if (class_name != NULL && strcmp(class_name, "TypeError") == 0) {
        made = napi_create_type_error(env, NULL, message, &error);
    } else {
        made = napi_create_error(env, NULL, message, &error);
    }
    if (made != napi_ok) {
        napi_throw_error(env, NULL, "compiled code threw");
        return;
    }
    /* The name for everything else -- a `SyntaxError`, an `EvalError`, a user
     * subclass -- which Node-API has no constructor for. `e.name` and
     * `String(e)` are then right and `instanceof` is not, and that is the
     * honest limit of what this boundary can express. */
    if (class_name != NULL && made == napi_ok
        && strcmp(class_name, "RangeError") != 0
        && strcmp(class_name, "TypeError") != 0) {
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
    if let Some(parameter) = func
        .params
        .iter()
        .find(|parameter| parameter.shape == hir::ParamShape::Rest)
    {
        return Err(Skipped {
            function: func.name.clone(),
            reason: format!("takes a rest parameter `{}`", parameter.name),
        });
    }
    if let Some(parameter) = func
        .params
        .iter()
        .zip(&crossings)
        .find_map(|(parameter, crossing)| {
            matches!(
                crossing,
                Cross::Object(_) | Cross::Bytes | Cross::Void
            )
            .then_some(parameter)
            .or_else(|| {
                // An array of *references* has to be allocated on this side to
                // be filled, and allocation needs a descriptor `program.c`
                // keeps -- the same wall an object parameter meets. A
                // `number[]` is the one that does not: `nts_from_napi_numbers`
                // takes its descriptor from the runtime.
                matches!(crossing, Cross::Elements(inner) if !matches!(**inner, Cross::Number))
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


/// One `napi_create_function` per exported name, beside the class fragments.
///
/// One wrapper can publish under several names: `export const upper = impl.upper`
/// and `export const alias = impl.upper` are one function and two properties,
/// and a loop that asked each function for *a* name published it once under
/// whichever came first.
fn publish_functions(wrapped: &[(&str, &str)]) -> String {
    let mut out = String::new();
    for (name, publish) in wrapped {
        let symbol = c_identifier(name);
        let property = c_string_literal(publish);
        let _ = write!(
            out,
            "    {{\n        napi_value fn;\n        if (!nts_napi_check(env, napi_create_function(env, {property}, NAPI_AUTO_LENGTH, nts_napi_{symbol}, NULL, &fn), \"could not create an exported function\")) return NULL;\n        if (!nts_napi_check(env, napi_set_named_property(env, exports, {property}, fn), \"could not export a function\")) return NULL;\n    }}\n"
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
        out.push_str(&unmarshal(crossing, &parameter.ty, layouts, name, index));
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
        out.push_str(&unmarshal(crossing, &parameter.ty, layouts, name, index));
    }
    let _ = write!(
        out,
        "    {instance} *nts_self = ({instance} *)nts_construct_{instance}();\n    if (nts_self == NULL) {{\n        napi_throw_error(env, NULL, \"could not allocate the instance\");\n        goto nts_napi_cleanup;\n    }}\n    if (setjmp(nts_landing.frame) != 0) {{\n        nts_napi_raise(env, &nts_landing);\n        nts_release((NtsHeader *)nts_self);\n        goto nts_napi_cleanup;\n    }}\n    nts_landing_push(&nts_landing);\n    {ctor_symbol}({});\n    if (!nts_napi_check(env, napi_wrap(env, self, nts_self, nts_finalize_{instance}, NULL, NULL), \"could not attach the instance\")) {{\n        nts_release((NtsHeader *)nts_self);\n        goto nts_napi_cleanup;\n    }}\n    out = self;\nnts_napi_cleanup:\n    nts_landing_pop(&nts_landing);\n",
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
        skipped.push(Skipped {
            function: class.to_owned(),
            reason: "is a class whose constructor was not compiled".to_owned(),
        });
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

    let mut out = format!("typedef struct {instance} {instance};\nNtsHeader *nts_construct_{instance}(void);\n");

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

/// One function's wrapper. Every refusal is [`crossings_of`]'s.
fn wrapper(
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
    if func.params.is_empty() {
        out.push_str("    (void)info;\n");
    } else {
        let count = func.params.len();
        let _ = write!(
            out,
            "    size_t argc = {count};\n    napi_value argv[{count}];\n    if (!nts_napi_check(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL), \"could not read callback arguments\")) return NULL;\n    if (argc < {count}) {{\n        napi_throw_type_error(env, \"ERR_MISSING_ARGS\", \"the compiled function requires {count} arguments\");\n        return NULL;\n    }}\n"
        );
    }

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
        out.push_str(&unmarshal(crossing, &parameter.ty, layouts, name, index));
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
) -> String {
    match crossing {
        Cross::Number if matches!(ty, HirType::Float { bits: 64 }) => format!(
            "    if (!nts_napi_expect(env, napi_get_value_double(env, argv[{index}], &{name}), \"expected a number argument\")) goto nts_napi_cleanup;\n"
        ),
        Cross::Number => format!(
            "    if (!nts_napi_expect(env, napi_get_value_double(env, argv[{index}], &{name}_number), \"expected a number argument\")) goto nts_napi_cleanup;\n{}    {name} = ({}){name}_number;\n",
            numeric_guard(ty, name),
            c_type(ty, layouts)
        ),
        Cross::Bool => format!(
            "    if (!nts_napi_expect(env, napi_get_value_bool(env, argv[{index}], &{name}), \"expected a boolean argument\")) goto nts_napi_cleanup;\n"
        ),
        Cross::Str => format!(
            "    if (!nts_napi_expect(env, nts_from_napi_string(env, argv[{index}], &{name}), \"expected a string argument\")) goto nts_napi_cleanup;\n"
        ),
        // A `number[]` is copied element by element. The descriptor comes from
        // the runtime rather than from `program.c`, which keeps its own to
        // itself -- see `nts_array_of_numbers`.
        Cross::Elements(_) => format!(
            "    if (!nts_napi_expect(env, nts_from_napi_numbers(env, argv[{index}], &{name}), \"expected an array of numbers\")) goto nts_napi_cleanup;\n"
        ),
        // An object argument would have to be *allocated*, and allocation needs
        // the layout's descriptor, which `program.c` keeps to itself. Reading a
        // returned object needs no descriptor, which is why one direction works
        // and the other is refused in `cross`. A view is the same story with
        // bytes in place of fields.
        Cross::Object(_) | Cross::Bytes | Cross::Void => String::new(),
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
        Cross::Bool => format!(
            "    bool result = {call};\n{after_call}    if (!nts_napi_check(env, napi_get_boolean(env, result, &out), \"could not create a boolean\")) goto nts_napi_cleanup;\n"
        ),
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
            _ => unreachable!("nested object layouts are refused by cross"),
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
fn emit_module_init_prototype(program: &hir::Program, out: &mut String) -> bool {
    let runs = program
        .funcs
        .iter()
        .any(|func| func.name == nts_core::hir::lower::MODULE_INIT);
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
        let mut whole = true;
        for (property, name_of) in properties {
            if !emitted.contains(&name_of.as_str()) {
                whole = false;
                skipped.push(Skipped {
                    function: format!("{name}.{property}"),
                    reason: "is a namespace member whose function has no wrapper".to_owned(),
                });
                continue;
            }
            let symbol = c_identifier(name_of);
            let key = c_string_literal(property);
            let _ = write!(
                out,
                "    {{\n        napi_value fn;\n        if (!nts_napi_check(env, napi_create_function(env, {key}, NAPI_AUTO_LENGTH, nts_napi_{symbol}, NULL, &fn), \"could not create a namespace function\")) return NULL;\n        if (!nts_napi_check(env, napi_set_named_property(env, {object}, {key}, fn), \"could not add to a namespace\")) return NULL;\n    }}\n"
            );
        }
        if whole {
            let key = c_string_literal(name);
            let _ = writeln!(
                out,
                "    if (!nts_napi_check(env, napi_set_named_property(env, exports, {key}, {object}), \"could not export a namespace\")) return NULL;"
            );
        }
    }
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
    let mut published = Vec::new();
    for (emitted, name) in &program.public_api {
        if program.public_functions.iter().any(|at| at == name) {
            continue;
        }
        let Some(global) = program
            .globals
            .iter()
            .find(|global| global.name == *emitted && global.exported)
        else {
            continue;
        };
        // The same crossing a return value gets, and for the same reason: what
        // leaves is a copy, so nothing has to decide who owns the storage.
        let Some(crossing) = cross(&global.ty, &program.layouts, &FxHashSet::default()) else {
            continue;
        };
        if matches!(crossing, Cross::Object(_) | Cross::Void) {
            continue;
        }
        published.push((global, name.as_str(), crossing));
    }
    published
}

fn report_unrepresentable_exports(
    program: &hir::Program,
    wrapped: &[(&str, &str)],
    published_classes: &[&str],
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
                "is exported and no function of that name was compiled".to_owned()
            } else {
                "is exported and is not a function this backend can name".to_owned()
            },
        });
    }
}

/// The `extern` declarations, at file scope, which is where one belongs.
fn declare_value_exports(
    values: &[(&hir::Global, &str, Cross)],
    layouts: &[hir::Layout],
    functions: &[String],
) -> String {
    let mut out = String::new();
    for (global, _, _) in values {
        let _ = writeln!(
            out,
            "extern {} {};",
            c_type(&global.ty, layouts),
            c_global(&global.name, functions.iter().map(String::as_str))
        );
    }
    if !values.is_empty() {
        out.push('\n');
    }
    out
}

/// The publication, which goes *after* `module__init()` and the ordering is the
/// whole of it: a deferred global holds its zero until module evaluation
/// assigns it, and for a reference that zero is a null pointer rather than a
/// default.
fn publish_value_exports(
    values: &[(&hir::Global, &str, Cross)],
    functions: &[String],
    layouts: &[hir::Layout],
) -> String {
    let mut out = String::new();
    for (global, publish, crossing) in values {
        let symbol = c_global(&global.name, functions.iter().map(String::as_str));
        let key = c_string_literal(publish);
        let make = match crossing {
            Cross::Bool => format!("napi_get_boolean(env, {symbol}, &value)"),
            Cross::Number => format!("napi_create_double(env, (double){symbol}, &value)"),
            Cross::Str => format!("nts_to_napi_string(env, {symbol}, &value)"),
            Cross::Elements(inner) => {
                format!("{}(env, {symbol}, &value)", elements_helper(inner, layouts))
            }
            Cross::Bytes => format!("nts_to_napi_view(env, {symbol}, &value)"),
            // `value_exports` refuses these, so reaching one is a bug in it
            // rather than a shape to handle here.
            Cross::Object(_) | Cross::Void => continue,
        };
        let _ = write!(
            out,
            "    {{\n        napi_value value;\n        if (!nts_napi_check(env, {make}, \"could not create an exported value\")) return NULL;\n        if (!nts_napi_check(env, napi_set_named_property(env, exports, {key}, value), \"could not export a value\")) return NULL;\n    }}\n"
        );
    }
    out
}

#[must_use]
pub fn emit(program: &hir::Program) -> Addon {
    let mut out = String::from("/* Generated by nts. Do not edit. */\n");
    out.push_str(
        "#include <node_api.h>\n#include <string.h>\n#include <float.h>\n#include <math.h>\n#include <stdlib.h>\n#include \"nts_runtime.h\"\n",
    );
    out.push_str(SUPPORT);
    out.push('\n');

    // A layout whose name appears before a `#` in some function is a class:
    // it has methods, and its behaviour is not carried by its fields.
    let classes: FxHashSet<String> = program
        .funcs
        .iter()
        .filter_map(|f| f.name.split_once('#').map(|(owner, _)| owner.to_owned()))
        .collect();
    let ownership = hir::own::summarize(program, &program.layouts);
    let release_managed = program.provider == hir::Provider::ReferenceCounting;

    // The structs the wrappers read fields out of. `program.c` defines these
    // too, and both derive them from the same `Layout` -- which is what that
    // type is for: "the compiler's answer to where is this field, decided once
    // and consumed by every backend". A header emitted by `codegen/c` would be
    // better still, and would remove this repetition entirely.
    let mut needed: Vec<usize> = program
        .funcs
        .iter()
        .filter(|f| !published(program, f).is_empty())
        .flat_map(|f| std::iter::once(&f.return_type).chain(f.params.iter().map(|p| &p.ty)))
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
    needed.sort_unstable();
    needed.dedup();
    for at in needed {
        let layout = &program.layouts[at];
        let name = format!("NtsObj_{}", c_identifier(&layout.name));
        let _ = writeln!(out, "typedef struct {name} {name};\nstruct {name} {{");
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
        emit_object_helper(&mut out, layout, &program.layouts);
    }

    let runs_module_init = emit_module_init_prototype(program, &mut out);

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
        match wrapper(
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

    let values = value_exports(program);
    let functions: Vec<String> =
        program.funcs.iter().map(|func| func.name.clone()).collect();
    out.push_str(&declare_value_exports(&values, &program.layouts, &functions));

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
    out.push_str(&publish_functions(&wrapped));
    out.push_str(&class_inits);
    emit_namespaces(program, &emitted, &mut skipped, &mut out);
    out.push_str(&publish_value_exports(&values, &functions, &program.layouts));
    out.push_str("    return exports;\n}\n");

    report_unrepresentable_exports(program, &wrapped, &published_classes, &mut skipped);

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
        let conversion = unmarshal(&Cross::Number, &ty, &layouts, "a0", 0);
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
}
