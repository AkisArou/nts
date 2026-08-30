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
    Double,
    Bool,
    Str,
    /// A rest parameter: every remaining JavaScript argument, as one array.
    StrArray,
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
        HirType::Float { .. } | HirType::Int { .. } => Some(Cross::Double),
        HirType::Managed(ManagedType::String) => Some(Cross::Str),
        HirType::Managed(ManagedType::Array(element))
            if matches!(**element, HirType::Managed(ManagedType::String)) =>
        {
            Some(Cross::StrArray)
        }
        // A promise has no synchronous crossing: its value does not exist yet.
        // Handing one to JavaScript means creating a napi deferred and resolving
        // it when the promise settles, which is a threadsafe-function design
        // rather than a marshalling rule.
        HirType::Managed(ManagedType::Promise(_)) => None,
        // A `Map` or a `Set` crossing is a copy, not a handle: JavaScript's are
        // engine objects with their own storage, so there is no wrapping a
        // runtime table in one. Every entry would have to be built on the other
        // side -- and each key and value is an `NtsValue`, so it is the erased
        // case below repeated per entry.
        //
        // Answering `None` leaves that decision where the erased one is, rather
        // than half-making it here.
        HirType::Managed(ManagedType::Map(_, _) | ManagedType::Set(_)) => None,
        HirType::Managed(ManagedType::Object(id)) => {
            let at = layouts.iter().position(|l| l.types.contains(id))?;
            // A class instance is more than its fields: its methods are how it
            // is used, and a plain object of the data would answer
            // `stats.isDirectory` with `undefined` rather than with an error.
            // Better to have no wrapper than a wrapper that loses behaviour.
            if classes.contains(&layouts[at].name) {
                return None;
            }
            // One level. A field that is itself a record would need the same
            // treatment recursively, and nothing needs it yet.
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
        // An array of anything but strings. The runtime holds one
        // representation per element type and only the string case has a
        // conversion written; the others would each need their own.
        HirType::Managed(ManagedType::Array(_)) => None,
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
        HirType::Int { bits, signed } => format!("{}{bits}", if *signed { 'i' } else { 'u' }),
        HirType::Float { bits } => format!("f{bits}"),
        HirType::Managed(ManagedType::String) => "string".to_owned(),
        HirType::Managed(ManagedType::Array(e)) => format!("{}[]", spell(e)),
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
        // Every numeric width is a `double` across this boundary: JavaScript
        // has one number type, so a wrapper that received an `i32` would have
        // to widen it anyway.
        HirType::Int { .. } | HirType::Float { .. } => "double".to_owned(),
    }
}

/// Everything the per-function wrappers call. Written once, not per function,
/// so a marshalling decision has one home.
const SUPPORT: &str = r#"
/* A JavaScript string is UTF-16 and so is an `NtsString`, so the conversion out
 * is exact and needs no encoder. The conversion in goes through UTF-8 because
 * that is the shape the runtime's constructor takes. */
static NtsString *nts_from_napi_string(napi_env env, napi_value v) {
    size_t len = 0;
    if (napi_get_value_string_utf8(env, v, NULL, 0, &len) != napi_ok) {
        return nts_string_from_utf8("", 0);
    }
    char *buf = (char *)malloc(len + 1);
    napi_get_value_string_utf8(env, v, buf, len + 1, &len);
    NtsString *s = nts_string_from_utf8(buf, len);
    free(buf);
    return s;
}

static napi_value nts_to_napi_string(napi_env env, NtsString *s) {
    napi_value out;
    if (s == NULL) {
        napi_get_undefined(env, &out);
        return out;
    }
    uint16_t *units = (uint16_t *)malloc((size_t)s->length * sizeof(uint16_t) + 2);
    for (uint32_t i = 0; i < s->length; i++) {
        units[i] = nts_unit(s, i);
    }
    units[s->length] = 0;
    napi_create_string_utf16(env, units, (size_t)s->length, &out);
    free(units);
    return out;
}

/* A rest parameter: every remaining JavaScript argument becomes one array.
 * `nts_desc_ref` is the runtime's descriptor for an array of references, which
 * is what an array of strings is. */
static NtsArray *nts_rest_strings(napi_env env, napi_value *argv, size_t from, size_t argc) {
    size_t n = argc > from ? argc - from : 0;
    NtsArray *a = nts_array_new(&nts_desc_ref, (double)n);
    for (size_t i = 0; i < n; i++) {
        NTS_ITEMS(a, void *)[i] = nts_from_napi_string(env, argv[from + i]);
    }
    return a;
}
"#;

/// One function's wrapper, or why it has none.
fn wrapper(
    func: &hir::Func,
    layouts: &[hir::Layout],
    classes: &FxHashSet<String>,
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
        "{} {symbol}({signature});\nstatic napi_value nts_napi_{symbol}(napi_env env, napi_callback_info info) {{\n    size_t argc = 16;\n    napi_value argv[16];\n    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);\n",
        c_type(&func.return_type, layouts)
    );

    let mut args: Vec<String> = Vec::new();
    for (index, crossing) in crossings.iter().enumerate() {
        let name = format!("a{index}");
        out.push_str(&unmarshal(crossing, &name, index));
        args.push(name);
    }

    let call = format!("{symbol}({})", args.join(", "));
    out.push_str("    napi_value out;\n");
    out.push_str(&marshal(&ret, &call, layouts));
    out.push_str("    return out;\n}\n\n");
    Ok(out)
}

/// Reading one argument out of JavaScript.
fn unmarshal(crossing: &Cross, name: &str, index: usize) -> String {
    match crossing {
        Cross::Double => format!(
            "    double {name} = 0;\n    if (argc > {index}) napi_get_value_double(env, argv[{index}], &{name});\n"
        ),
        Cross::Bool => format!(
            "    bool {name} = false;\n    if (argc > {index}) napi_get_value_bool(env, argv[{index}], &{name});\n"
        ),
        Cross::Str => format!(
            "    NtsString *{name} = argc > {index} ? nts_from_napi_string(env, argv[{index}]) : nts_string_from_utf8(\"\", 0);\n"
        ),
        Cross::StrArray => {
            format!("    NtsArray *{name} = nts_rest_strings(env, argv, {index}, argc);\n")
        }
        // An object argument would have to be *allocated*, and allocation needs
        // the layout's descriptor, which `program.c` keeps to itself. Reading a
        // returned object needs no descriptor, which is why one direction works
        // and the other is refused in `cross`.
        Cross::Object(_) | Cross::Void => String::new(),
    }
}

/// Handing the result back to JavaScript.
fn marshal(ret: &Cross, call: &str, layouts: &[hir::Layout]) -> String {
    match ret {
        Cross::Void => format!("    {call};\n    napi_get_undefined(env, &out);\n"),
        Cross::Bool => format!("    napi_get_boolean(env, {call}, &out);\n"),
        Cross::Double => format!("    napi_create_double(env, {call}, &out);\n"),
        Cross::Str => format!("    out = nts_to_napi_string(env, {call});\n"),
        Cross::StrArray => "    napi_get_undefined(env, &out);\n".to_owned(),
        Cross::Object(at) => {
            let layout = &layouts[*at];
            let struct_name = format!("NtsObj_{}", c_identifier(&layout.name));
            let mut text =
                format!("    {struct_name} *r = {call};\n    napi_create_object(env, &out);\n");
            for field in &layout.fields {
                let name = &field.name;
                let value = match field.ty {
                    HirType::Managed(ManagedType::String) => {
                        format!("nts_to_napi_string(env, r->{name})")
                    }
                    HirType::Bool => {
                        let _ = writeln!(
                            text,
                            "    {{ napi_value v; napi_get_boolean(env, r->{name}, &v); napi_set_named_property(env, out, \"{name}\", v); }}"
                        );
                        continue;
                    }
                    _ => {
                        format!("({{ napi_value v; napi_create_double(env, r->{name}, &v); v; }})")
                    }
                };
                let _ = writeln!(
                    text,
                    "    napi_set_named_property(env, out, \"{name}\", {value});"
                );
            }
            text
        }
    }
}

/// Generate the addon for a program's exported functions.
///
/// A function whose signature cannot cross is skipped rather than approximated:
/// a wrapper that silently coerces would make the conformance suite grade
/// something other than the program.
#[must_use]
pub fn emit(program: &hir::Program) -> Addon {
    let mut out = String::from("/* Generated by nts. Do not edit. */\n");
    out.push_str("#include <node_api.h>\n#include <stdlib.h>\n#include \"nts_runtime.h\"\n");
    out.push_str(SUPPORT);
    out.push('\n');

    // A layout whose name appears before a `#` in some function is a class:
    // it has methods, and its behaviour is not carried by its fields.
    let classes: FxHashSet<String> = program
        .funcs
        .iter()
        .filter_map(|f| f.name.split_once('#').map(|(owner, _)| owner.to_owned()))
        .collect();

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
                field.name
            );
        }
        out.push_str("};\n\n");
    }

    let mut skipped = Vec::new();
    let mut wrapped: Vec<&str> = Vec::new();
    for func in program.funcs.iter().filter(|f| f.exported) {
        match wrapper(func, &program.layouts, &classes) {
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
        let _ = write!(
            out,
            "    {{\n        napi_value fn;\n        napi_create_function(env, \"{name}\", NAPI_AUTO_LENGTH, nts_napi_{symbol}, NULL, &fn);\n        napi_set_named_property(env, exports, \"{name}\", fn);\n    }}\n"
        );
    }
    out.push_str("    return exports;\n}\n");

    Addon {
        source: out,
        skipped,
    }
}
