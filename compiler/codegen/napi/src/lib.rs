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

use nts_codegen_c::c_identifier;
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
    /// A record, by index into the program's layouts. Crosses as a plain
    /// JavaScript object of its fields.
    Object(usize),
    Void,
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
        // HIR currently does not retain the distinction between a declared
        // `string[]` parameter and a `...strings: string[]` rest parameter.
        // Treating both as rest made an ordinary array parameter receive all
        // remaining JavaScript arguments instead of one array. Refuse both
        // directions until that source fact crosses the HIR boundary.
        HirType::Managed(ManagedType::Array(_)) => None,
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
"#;

/// One function's wrapper, or why it has none.
fn wrapper(
    func: &hir::Func,
    layouts: &[hir::Layout],
    classes: &FxHashSet<String>,
    release_managed: bool,
    return_is_borrowed: bool,
    consumed_parameters: Option<&FxHashSet<u32>>,
) -> Result<String, Skipped> {
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
    if let Some(parameter) = func
        .params
        .iter()
        .zip(&crossings)
        .find_map(|(parameter, crossing)| {
            matches!(crossing, Cross::Object(_) | Cross::Void).then_some(parameter)
        })
    {
        return Err(Skipped {
            function: func.name.clone(),
            reason: format!("takes {}, which crosses outward only", spell(&parameter.ty)),
        });
    }

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
    out.push_str("nts_napi_cleanup:\n");
    if release_managed {
        for (crossing, name) in crossings.iter().zip(&args) {
            if matches!(crossing, Cross::Str) {
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
        // An object argument would have to be *allocated*, and allocation needs
        // the layout's descriptor, which `program.c` keeps to itself. Reading a
        // returned object needs no descriptor, which is why one direction works
        // and the other is refused in `cross`.
        Cross::Object(_) | Cross::Void => String::new(),
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
        Cross::Object(at) => {
            let layout = &layouts[*at];
            let struct_name = format!("NtsObj_{}", c_identifier(&layout.name));
            let mut text = format!(
                "    {struct_name} *result = {call};\n{after_call}    if (!nts_napi_check(env, napi_create_object(env, &out), \"could not create an object\")) {{\n"
            );
            if release_result {
                text.push_str("        nts_release((NtsHeader *)result);\n");
            }
            text.push_str("        goto nts_napi_cleanup;\n    }\n");
            for field in &layout.fields {
                let name = &field.name;
                let member = c_identifier(name);
                let set_property = set_property_call(name);
                match field.ty {
                    HirType::Managed(ManagedType::String) => {
                        let _ = writeln!(
                            text,
                            "    {{ napi_value value; if (!nts_napi_check(env, nts_to_napi_string(env, result->{member}, &value), \"could not create an object string field\") || !nts_napi_check(env, {set_property}, \"could not set an object field\")) {{"
                        );
                    }
                    HirType::Bool => {
                        let _ = writeln!(
                            text,
                            "    {{ napi_value value; if (!nts_napi_check(env, napi_get_boolean(env, result->{member}, &value), \"could not create an object boolean field\") || !nts_napi_check(env, {set_property}, \"could not set an object field\")) {{"
                        );
                    }
                    HirType::Float { .. } | HirType::Int { .. } => {
                        let _ = writeln!(
                            text,
                            "    {{ napi_value value; if (!nts_napi_check(env, napi_create_double(env, (double)result->{member}, &value), \"could not create an object number field\") || !nts_napi_check(env, {set_property}, \"could not set an object field\")) {{"
                        );
                    }
                    _ => unreachable!("nested object layouts are refused by cross"),
                }
                if release_result {
                    text.push_str("        nts_release((NtsHeader *)result);\n");
                }
                text.push_str("        goto nts_napi_cleanup;\n    } }\n");
            }
            if release_result {
                text.push_str("    nts_release((NtsHeader *)result);\n");
            }
            text
        }
    }
}

fn should_release_result(release_managed: bool, return_is_borrowed: bool) -> bool {
    release_managed && !return_is_borrowed
}

/// Generate the addon for a program's exported functions.
///
/// A function whose signature cannot cross is skipped rather than approximated:
/// a wrapper that silently coerces would make the conformance suite grade
/// something other than the program.
#[must_use]
pub fn emit(program: &hir::Program) -> Addon {
    let mut out = String::from("/* Generated by nts. Do not edit. */\n");
    out.push_str(
        "#include <node_api.h>\n#include <float.h>\n#include <math.h>\n#include <stdlib.h>\n#include \"nts_runtime.h\"\n",
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
        .filter(|f| f.exported)
        .flat_map(|f| std::iter::once(&f.return_type).chain(f.params.iter().map(|p| &p.ty)))
        .filter_map(|ty| match cross(ty, &program.layouts, &classes) {
            Some(Cross::Object(at)) => Some(at),
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
    }

    let mut skipped = Vec::new();
    let mut wrapped: Vec<&str> = Vec::new();
    for func in program.funcs.iter().filter(|f| f.exported) {
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
                wrapped.push(&func.name);
            }
            Err(why) => skipped.push(why),
        }
    }

    out.push_str("NAPI_MODULE_INIT() {\n");
    for name in &wrapped {
        let symbol = c_identifier(name);
        let property = c_string_literal(name);
        let _ = write!(
            out,
            "    {{\n        napi_value fn;\n        if (!nts_napi_check(env, napi_create_function(env, {property}, NAPI_AUTO_LENGTH, nts_napi_{symbol}, NULL, &fn), \"could not create an exported function\")) return NULL;\n        if (!nts_napi_check(env, napi_set_named_property(env, exports, {property}, fn), \"could not export a function\")) return NULL;\n    }}\n"
        );
    }
    out.push_str("    return exports;\n}\n");

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
    fn an_array_is_not_guessed_to_be_a_rest_parameter() {
        let ty = HirType::Managed(ManagedType::Array(Box::new(HirType::Managed(
            ManagedType::String,
        ))));
        assert!(cross(&ty, &[], &FxHashSet::default()).is_none());
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
