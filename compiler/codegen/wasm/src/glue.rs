//! The generated JS host: the module's import object, written out for exactly
//! the imports it has, and one straight-line wrapper per export with only the
//! checks its declared signature needs.
//!
//! Two files, so that no name the glue needs can collide with a name the
//! program exports:
//! - `program.mjs` exports exactly the program's names, from one instance made
//!   when it is imported, as importing the TS module runs it;
//! - `program.instance.mjs` exports `instantiate()`, which makes a fresh
//!   instance, and `WasmInputDecline`, the class every refusal throws.
//!
//! There is no runtime manifest. The same compiler emits the module and its
//! glue, and every host import's type is checked against the glue's own table
//! when the glue is generated; the engine's compile and link errors catch the
//! rest. A call costs one JS frame and the tests its parameters need, with no
//! argument arrays. Every primitive a wrapper calls is captured when the glue
//! loads, before any compiled code runs, so later changes to globals cannot
//! redirect a check.

use crate::{
    BoundaryType, FunctionExport, GlobalExport, ImportType, Manifest, NumberBound, NumberGuard,
    ValueType,
};
use std::{collections::BTreeMap, fmt::Write as _};

/// How the generated module obtains its bytes; everything else is shared.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Host {
    Node,
    Browser,
}

/// The generated JS for one program.
#[derive(Debug, Clone)]
pub struct Glue {
    /// `program.mjs`: the program's exports and nothing else.
    pub program: String,
    /// `program.instance.mjs`: `instantiate()` and `WasmInputDecline`.
    pub instance: String,
}

/// The file `Glue::program` is written to.
pub const PROGRAM_FILE: &str = "program.mjs";
/// The file `Glue::instance` is written to; `program.mjs` imports it by name.
pub const INSTANCE_FILE: &str = "program.instance.mjs";

/// Primitives captured when the glue loads: local name to definition.
#[derive(Debug, Default)]
struct Captures(BTreeMap<&'static str, &'static str>);

impl Captures {
    fn get(&mut self, local: &'static str, source: &'static str) -> &'static str {
        self.0.insert(local, source);
        local
    }
}

const UNARY_MATH: &[&str] = &[
    "acos", "asin", "atan", "cbrt", "cos", "cosh", "exp", "expm1", "fround", "log", "log10",
    "log1p", "log2", "sign", "sin", "sinh", "tan", "tanh",
];
const BINARY_MATH: &[&str] = &["atan2", "hypot", "imul", "pow"];

fn function(params: &[ValueType], result: Option<ValueType>) -> ImportType {
    ImportType::Function {
        params: params.to_vec(),
        result,
    }
}

/// A number or string method the host applies as node does, wrapped to C's
/// contract where C's differs from a bare call.
fn method_import(name: &str, captures: &mut Captures) -> Option<(ImportType, String)> {
    use ValueType::F64;
    const STRING: ValueType = ValueType::Externref { nullable: true };
    Some(match name {
        // `Number.prototype.toString(radix)` and `toFixed(digits)`, applied as
        // node applies them; and `Number(text)`, which C's nts_str_to_number
        // mirrors.
        "nts_number_to_string_radix" | "nts_number_to_fixed" => {
            let apply = captures.get("apply", "Reflect.apply");
            let method = if name == "nts_number_to_fixed" {
                captures.get("numberToFixed", "Number.prototype.toFixed")
            } else {
                captures.get("numberToString", "Number.prototype.toString")
            };
            // node throws a RangeError for a radix or digits out of range,
            // and C refuses there. A host exception must not unwind through
            // compiled frames, so it becomes the same named refusal.
            let what = if name == "nts_number_to_fixed" {
                "Number.prototype.toFixed"
            } else {
                "Number.prototype.toString"
            };
            (
                function(&[F64, F64], Some(STRING)),
                format!(
                    "(value, argument) => {{ try {{ return {apply}({method}, value, [argument]); }} catch (error) {{ throw new WasmInputDecline('{what}', String(error), 'operation in'); }} }}"
                ),
            )
        }
        // String methods node applies, each wrapped to C's contract where
        // C's differs from a bare call: `repeat` counts NaN and negatives as
        // zero, a relative `at` past either end and `codePointAt` past the
        // end answer absent (null, and NaN), as C's helpers do.
        "nts_str_to_upper_case" | "nts_str_to_lower_case" => {
            let apply = captures.get("apply", "Reflect.apply");
            let method = if name == "nts_str_to_upper_case" {
                captures.get("stringToUpperCase", "String.prototype.toUpperCase")
            } else {
                captures.get("stringToLowerCase", "String.prototype.toLowerCase")
            };
            (
                function(&[STRING], Some(STRING)),
                format!("text => {apply}({method}, text, [])"),
            )
        }
        "nts_str_repeat" => {
            let apply = captures.get("apply", "Reflect.apply");
            let repeat = captures.get("stringRepeat", "String.prototype.repeat");
            let floor = captures.get("mathFloor", "Math.floor");
            (
                function(&[STRING, F64], Some(STRING)),
                format!(
                    "(text, times) => times !== times || times < 0 ? '' : {apply}({repeat}, text, [{floor}(times)])"
                ),
            )
        }
        "nts_str_relative_at" => {
            let apply = captures.get("apply", "Reflect.apply");
            let at = captures.get("stringAt", "String.prototype.at");
            (
                function(&[STRING, F64], Some(STRING)),
                format!("(text, index) => {apply}({at}, text, [index]) ?? null"),
            )
        }
        "nts_str_code_point_at" => {
            let apply = captures.get("apply", "Reflect.apply");
            let code_point = captures.get("stringCodePointAt", "String.prototype.codePointAt");
            (
                function(&[STRING, F64], Some(F64)),
                format!("(text, index) => {apply}({code_point}, text, [index]) ?? NaN"),
            )
        }
        "nts_str_to_number" => (
            function(&[STRING], Some(F64)),
            captures.get("Number_", "Number").into(),
        ),
        _ => return None,
    })
}

const NULLABLE_STRING: ValueType = ValueType::Externref { nullable: true };

/// String methods applied as they are: (import, capture, the method's
/// source, parameters, result).
const STRING_METHODS: &[(&str, &str, &str, &[ValueType], ValueType)] = &[
    (
        "nts_str_index_of",
        "string_indexOf",
        "String.prototype.indexOf",
        &[NULLABLE_STRING, NULLABLE_STRING],
        ValueType::F64,
    ),
    (
        "nts_str_index_of_from",
        "string_indexOf",
        "String.prototype.indexOf",
        &[NULLABLE_STRING, NULLABLE_STRING, ValueType::F64],
        ValueType::F64,
    ),
    (
        "nts_str_last_index_of",
        "string_lastIndexOf",
        "String.prototype.lastIndexOf",
        &[NULLABLE_STRING, NULLABLE_STRING],
        ValueType::F64,
    ),
    (
        "nts_str_includes",
        "string_includes",
        "String.prototype.includes",
        &[NULLABLE_STRING, NULLABLE_STRING],
        ValueType::I32,
    ),
    (
        "nts_str_starts_with",
        "string_startsWith",
        "String.prototype.startsWith",
        &[NULLABLE_STRING, NULLABLE_STRING],
        ValueType::I32,
    ),
    (
        "nts_str_ends_with",
        "string_endsWith",
        "String.prototype.endsWith",
        &[NULLABLE_STRING, NULLABLE_STRING],
        ValueType::I32,
    ),
    (
        "nts_str_trim",
        "string_trim",
        "String.prototype.trim",
        &[NULLABLE_STRING],
        NULLABLE_STRING,
    ),
    (
        "nts_str_trim_start",
        "string_trimStart",
        "String.prototype.trimStart",
        &[NULLABLE_STRING],
        NULLABLE_STRING,
    ),
    (
        "nts_str_trim_end",
        "string_trimEnd",
        "String.prototype.trimEnd",
        &[NULLABLE_STRING],
        NULLABLE_STRING,
    ),
    (
        "nts_str_is_well_formed",
        "string_isWellFormed",
        "String.prototype.isWellFormed",
        &[NULLABLE_STRING],
        ValueType::I32,
    ),
    (
        "nts_str_to_well_formed",
        "string_toWellFormed",
        "String.prototype.toWellFormed",
        &[NULLABLE_STRING],
        NULLABLE_STRING,
    ),
    (
        "nts_str_replace",
        "string_replace",
        "String.prototype.replace",
        &[NULLABLE_STRING, NULLABLE_STRING, NULLABLE_STRING],
        NULLABLE_STRING,
    ),
    (
        "nts_str_replace_all",
        "string_replaceAll",
        "String.prototype.replaceAll",
        &[NULLABLE_STRING, NULLABLE_STRING, NULLABLE_STRING],
        NULLABLE_STRING,
    ),
];

/// A `String.prototype` method the host applies to the receiver, as node
/// does, wrapped to C's contract where it differs from a bare call: a null
/// pad is the default one, a malformed URI answers null (C's NULL, which the
/// lowering raises as a `URIError`), a code point the guard let through is
/// the empty string, and a point's width is C's.
fn string_import(name: &str, captures: &mut Captures) -> Option<(ImportType, String)> {
    if let Some((_, local, source, params, result)) =
        STRING_METHODS.iter().find(|entry| entry.0 == name)
    {
        let apply = captures.get("apply", "Reflect.apply");
        let method = captures.get(local, source);
        let names = ["receiver", "a", "b"];
        return Some((
            function(params, Some(result.clone())),
            format!(
                "({}) => {apply}({method}, receiver, [{}])",
                names[..params.len()].join(", "),
                names[1..params.len()].join(", ")
            ),
        ));
    }
    wrapped_string_import(name, captures)
}

/// The string methods wrapped to C's contract: padding, URIs, a code point,
/// and a point's width.
fn wrapped_string_import(name: &str, captures: &mut Captures) -> Option<(ImportType, String)> {
    use ValueType::F64;
    const STRING: ValueType = ValueType::Externref { nullable: true };
    Some(match name {
        "nts_str_pad_start" | "nts_str_pad_end" => {
            let apply = captures.get("apply", "Reflect.apply");
            let method = if name == "nts_str_pad_start" {
                captures.get("string_padStart", "String.prototype.padStart")
            } else {
                captures.get("string_padEnd", "String.prototype.padEnd")
            };
            (
                function(&[STRING, F64, STRING], Some(STRING)),
                format!("(text, length, pad) => {apply}({method}, text, [length, pad ?? undefined])"),
            )
        }
        "nts_decode_uri" | "nts_encode_uri" => {
            let (whole, component) = if name == "nts_decode_uri" {
                (captures.get("decodeURI_", "decodeURI"), captures.get("decodeURIComponent_", "decodeURIComponent"))
            } else {
                (captures.get("encodeURI_", "encodeURI"), captures.get("encodeURIComponent_", "encodeURIComponent"))
            };
            (
                function(&[STRING, F64], Some(STRING)),
                format!("(text, part) => {{ try {{ return part ? {component}(text) : {whole}(text); }} catch {{ return null; }} }}"),
            )
        }
        "nts_string_from_code_point" => {
            let from = captures.get("fromCodePoint", "String.fromCodePoint");
            (
                function(&[F64], Some(STRING)),
                format!("point => point >= 0 && point <= 0x10FFFF && point === Math.trunc(point) ? {from}(point) : ''"),
            )
        }
        "nts_str_point_width" => (
            function(&[STRING, F64], Some(F64)),
            "(text, at) => { if (!(at >= 0) || at + 1 >= text.length) return 1; const high = text.charCodeAt(at), low = text.charCodeAt(at + 1); return high >= 0xD800 && high <= 0xDBFF && low >= 0xDC00 && low <= 0xDFFF ? 2 : 1; }".into(),
        ),
        _ => return None,
    })
}

/// A host method service as a named refusal: whatever the host's method
/// throws (node's `RangeError: Invalid string length` for `"ab".repeat(2 **
/// 28)`, say) becomes the refusal C gives, never an exception unwinding
/// through compiled frames. The service is made once; the wrapper names each
/// parameter, so a call allocates nothing.
fn guarded(name: &str, ty: &ImportType, service: &str) -> String {
    let ImportType::Function { params, .. } = ty else {
        return service.to_owned();
    };
    let list = (0..params.len())
        .map(|at| format!("a{at}"))
        .collect::<Vec<_>>()
        .join(", ");
    let what = name.strip_prefix("nts_").unwrap_or(name);
    format!(
        "(service => ({list}) => {{ try {{ return service({list}); }} catch (error) {{ if (error instanceof WasmInputDecline) throw error; throw new WasmInputDecline('{what}', String(error), 'operation in'); }} }})({service})"
    )
}

/// A host import the glue provides: the Wasm type its JS value implements,
/// and that value. Checked against the module's own import type, because an
/// engine converts a JS function's arguments and result silently: a wrong
/// declared type would coerce rather than fail.
fn host_import(name: &str, captures: &mut Captures) -> Option<(ImportType, String)> {
    use ValueType::F64;
    const STRING: ValueType = ValueType::Externref { nullable: true };
    let number = |n: usize| function(&vec![F64; n], Some(F64));
    if let Some(math) = name.strip_prefix("nts_math_") {
        let arity = if UNARY_MATH.contains(&math) {
            1
        } else if BINARY_MATH.contains(&math) {
            2
        } else {
            return None;
        };
        // `Math` itself is captured; each member is read from it at load.
        let math_ = captures.get("math", "Math");
        return Some((number(arity), format!("{math_}.{math}")));
    }
    if let Some((ty, method)) =
        method_import(name, captures).or_else(|| string_import(name, captures))
    {
        let guarded = guarded(name, &ty, &method);
        return Some((ty, guarded));
    }
    Some(match name {
        "remainder" => (number(2), "(left, right) => left % right".into()),
        "nts_number_to_string" => {
            let apply = captures.get("apply", "Reflect.apply");
            let to_string = captures.get("numberToString", "Number.prototype.toString");
            (
                function(&[F64], Some(STRING)),
                format!("value => {apply}({to_string}, value, [])"),
            )
        }
        "nts_parse_float" => (
            function(&[STRING], Some(F64)),
            captures.get("parseFloat_", "Number.parseFloat").into(),
        ),
        "nts_parse_int" => (
            function(&[STRING, F64], Some(F64)),
            captures.get("parseInt_", "Number.parseInt").into(),
        ),
        "inputDecline" => (
            function(&[STRING, STRING], None),
            "(name, reason) => { throw new WasmInputDecline(name, reason, 'operation in'); }".into(),
        ),
        "uncaughtDecline" => (
            function(&[STRING], None),
            "name => { throw new WasmInputDecline(name, 'uncaught compiled object or function needs an identity bridge', 'throw from'); }".into(),
        ),
        "toNumber" => (function(&[F64], Some(STRING)), "value => value".into()),
        // An open value's kind and number, as `boundary` reads them.
        "valueKind" => (
            function(&[STRING], Some(ValueType::I32)),
            crate::boundary::VALUE_KIND.into(),
        ),
        "valueNumber" => (function(&[STRING], Some(F64)), "value => value".into()),
        "resultDecline" => (
            function(&[STRING], None),
            "name => { throw new WasmInputDecline(name, 'an object, a function, a symbol or a bigint returned as an open value, which this boundary does not convert', 'result from'); }".into(),
        ),
        // A bigint crosses as its two 64-bit lanes, which JS receives as
        // BigInts; the host's own BigInt formats and parses, as node does.
        "bigintText" => (
            function(&[ValueType::I64, ValueType::I64], Some(STRING)),
            "(low, high) => String((high << 64n) | BigInt.asUintN(64, low))".into(),
        ),
        "bigintCompareString" => (
            function(&[ValueType::I64, ValueType::I64, STRING], Some(F64)),
            "(low, high, text) => { let other; try { other = BigInt(text); } catch { return NaN; } const value = (high << 64n) | BigInt.asUintN(64, low); return value < other ? -1 : value > other ? 1 : 0; }".into(),
        ),
        "promiseSettled" => (function(&[ValueType::I32], None), "promiseSettled".into()),
        // Supplied per instance by `create`, which knows the instance a timer
        // fires into; typed here so the check below still holds them.
        "setTimer" => (
            function(&[ValueType::I32, F64, ValueType::I32], None),
            "undefined".into(),
        ),
        "clearTimer" => (function(&[ValueType::I32], None), "undefined".into()),
        "nts_console_write" => {
            let log = captures.get("consoleLog", "console.log.bind(console)");
            let error = captures.get("consoleError", "console.error.bind(console)");
            (
                function(&[STRING, ValueType::I32], None),
                format!("(line, toStderr) => (toStderr ? {error} : {log})(line)"),
            )
        }
        // An import value of `undefined` reads as a missing import, so it
        // travels inside a Global object.
        "undefined" => (
            ImportType::Global {
                ty: STRING,
                mutable: false,
            },
            "new WebAssembly.Global({ value: 'externref' }, undefined)".into(),
        ),
        "true" | "false" => (
            ImportType::Global {
                ty: STRING,
                mutable: false,
            },
            name.into(),
        ),
        _ => return None,
    })
}

fn same(found: &ImportType, wanted: &ImportType) -> bool {
    match (found, wanted) {
        (
            ImportType::Function { params, result },
            ImportType::Function {
                params: p,
                result: r,
            },
        ) => params == p && result == r,
        (ImportType::Global { ty, mutable }, ImportType::Global { ty: t, mutable: m }) => {
            ty == t && mutable == m
        }
        (ImportType::Tag, ImportType::Tag) => true,
        _ => false,
    }
}

fn quote(text: &str) -> String {
    serde_json::to_string(text).expect("a string serializes")
}

fn number(bound: &NumberBound) -> String {
    match bound {
        NumberBound::Finite(value) => format!("{value:?}"),
        NumberBound::Infinite(crate::InfiniteBound::Positive) => "Infinity".into(),
        NumberBound::Infinite(crate::InfiniteBound::Negative) => "-Infinity".into(),
    }
}

/// Statements that refuse an argument outside its declared type, and the
/// expression that passes the accepted value to wasm. A missing argument is
/// `undefined`, which no boundary type holds, so it is refused; an extra one
/// is ignored, as JS ignores it.
fn parameter(
    export: &FunctionExport,
    at: usize,
    captures: &mut Captures,
    out: &mut String,
) -> Result<String, String> {
    let name = quote(&export.name);
    let arg = format!("a{at}");
    let parameter = &export.params[at];
    let refuse = |out: &mut String, condition: String, why: &str| {
        let _ = writeln!(
            out,
            "      if ({condition}) decline({name}, {});",
            quote(why)
        );
    };
    let passed = match &parameter.ty {
        BoundaryType::String => {
            refuse(
                out,
                format!("typeof {arg} !== 'string'"),
                "expected primitive string",
            );
            arg.clone()
        }
        BoundaryType::Bool => {
            refuse(
                out,
                format!("typeof {arg} !== 'boolean'"),
                "expected boolean",
            );
            arg.clone()
        }
        BoundaryType::Float { bits: 64 } => {
            refuse(out, format!("typeof {arg} !== 'number'"), "expected number");
            arg.clone()
        }
        BoundaryType::Float { bits: 32 } => {
            let is = captures.get("objectIs", "Object.is");
            let fround = captures.get("fround", "Math.fround");
            refuse(out, format!("typeof {arg} !== 'number'"), "expected number");
            refuse(
                out,
                format!("!{is}({fround}({arg}), {arg})"),
                "number does not fit f32 exactly",
            );
            arg.clone()
        }
        BoundaryType::Int { bits, signed } => {
            let is = captures.get("objectIs", "Object.is");
            let integer = captures.get("isInteger", "Number.isInteger");
            refuse(out, format!("typeof {arg} !== 'number'"), "expected number");
            let limit = 2_f64.powi(i32::from(*bits) - i32::from(*signed));
            let low = if *signed { -limit } else { 0.0 };
            refuse(
                out,
                format!(
                    "!{integer}({arg}) || {is}({arg}, -0) || {arg} < {low:?} || {arg} >= {limit:?}"
                ),
                &format!(
                    "number does not fit {}{bits}",
                    if *signed { 'i' } else { 'u' }
                ),
            );
            if *bits == 64 {
                let safe = captures.get("isSafeInteger", "Number.isSafeInteger");
                let big = captures.get("toBigInt", "BigInt");
                refuse(
                    out,
                    format!("!{safe}({arg})"),
                    "64-bit input exceeds the safe-number boundary",
                );
                format!("{big}({arg})")
            } else {
                arg.clone()
            }
        }
        // A primitive crosses by value; nothing yet says how anything else
        // would, so it is refused here, by name.
        BoundaryType::Value => {
            refuse(
                out,
                format!(
                    "({arg} !== null && typeof {arg} === 'object') || typeof {arg} === 'function' || typeof {arg} === 'symbol' || typeof {arg} === 'bigint'"
                ),
                "an object, a function, a symbol or a bigint as an open value, which this boundary does not convert",
            );
            arg.clone()
        }
        BoundaryType::Void | BoundaryType::Float { .. } | BoundaryType::Promise => {
            return Err(format!(
                "public parameter {at} of `{}` has no JS boundary type",
                export.name
            ));
        }
    };
    if let Some(guard) = &parameter.guard {
        refuse(
            out,
            violations(&arg, guard, captures),
            "number violates the parameter facts used for specialization",
        );
    }
    Ok(passed)
}

/// The condition under which `arg` violates the facts specialization assumed.
fn violations(arg: &str, guard: &NumberGuard, captures: &mut Captures) -> String {
    let mut violated = Vec::new();
    if !guard.maybe_nan {
        let nan = captures.get("numberIsNaN", "Number.isNaN");
        violated.push(format!("{nan}({arg})"));
    }
    if !guard.maybe_negative_zero {
        let is = captures.get("objectIs", "Object.is");
        violated.push(format!("{is}({arg}, -0)"));
    }
    if guard.whole {
        let finite = captures.get("numberIsFinite", "Number.isFinite");
        let integer = captures.get("isInteger", "Number.isInteger");
        violated.push(format!("({finite}({arg}) && !{integer}({arg}))"));
    }
    violated.push(format!("{arg} < {}", number(&guard.minimum)));
    violated.push(format!("{arg} > {}", number(&guard.maximum)));
    violated.join(" || ")
}

/// Statements that take the wasm value `value` to its logical JS type and
/// return it, refusing one outside that type. An export's result and a
/// global's read both use them, so the two cannot disagree.
fn deliver(ty: &BoundaryType, value: &str, name: &str, captures: &mut Captures) -> String {
    match ty {
        BoundaryType::Void => format!("{value};"),
        BoundaryType::Bool => format!(
            "const result = {value};\n      if (result !== 0 && result !== 1) declineResult({name}, 'boolean result is neither 0 nor 1');\n      return result === 1;"
        ),
        BoundaryType::String => format!(
            "const result = {value};\n      if (typeof result !== 'string') declineResult({name}, 'result is outside primitive-string boundary');\n      return result;"
        ),
        BoundaryType::Int { bits: 64, signed } => {
            let to_number = captures.get("toNumber", "Number");
            let safe = captures.get("isSafeInteger", "Number.isSafeInteger");
            let wide = if *signed {
                value.to_owned()
            } else {
                let unsigned = captures.get("asUintN", "BigInt.asUintN");
                format!("{unsigned}(64, {value})")
            };
            format!(
                "const result = {to_number}({wide});\n      if (!{safe}(result)) declineResult({name}, '64-bit result exceeds the safe-number boundary');\n      return result;"
            )
        }
        BoundaryType::Int { signed: false, .. } => format!("return {value} >>> 0;"),
        BoundaryType::Int { .. } | BoundaryType::Float { .. } | BoundaryType::Value => {
            format!("return {value};")
        }
        BoundaryType::Promise => format!("return toPromise(x, {value}, {name});"),
    }
}

fn params(export: &FunctionExport) -> String {
    (0..export.params.len())
        .map(|at| format!("a{at}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// The wrapper of export `at`, calling the wasm function bound to `e{at}`.
fn wrapper(
    at: usize,
    export: &FunctionExport,
    captures: &mut Captures,
    out: &mut String,
) -> Result<(), String> {
    let _ = writeln!(out, "    {}({}) {{", quote(&export.name), params(export));
    let mut passed = Vec::new();
    for param in 0..export.params.len() {
        passed.push(parameter(export, param, captures, out)?);
    }
    let call = format!("e{at}({})", passed.join(", "));
    let _ = writeln!(
        out,
        "      {}",
        deliver(&export.result, &call, &quote(&export.name), captures)
    );
    out.push_str("    },\n");
    Ok(())
}

fn global(global: &GlobalExport, captures: &mut Captures, out: &mut String) -> Result<(), String> {
    if global.ty == BoundaryType::Void {
        return Err(format!("public global `{}` has no value", global.name));
    }
    let value = captures.get(
        "globalValue",
        "Function.prototype.call.bind(Object.getOwnPropertyDescriptor(WebAssembly.Global.prototype, 'value').get)",
    );
    let read = format!("{value}(x[{}])", quote(&global.symbol));
    let _ = writeln!(
        out,
        "    get {}() {{\n      {}\n    }},",
        quote(&global.name),
        deliver(&global.ty, &read, &quote(&global.name), captures)
    );
    Ok(())
}

/// The import object's entries, by module, each checked against the glue's
/// own table.
fn imports(
    manifest: &Manifest,
    captures: &mut Captures,
) -> Result<BTreeMap<String, Vec<String>>, String> {
    let mut imports: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for import in &manifest.imports {
        let value = match (import.module.as_str(), &import.ty) {
            ("js", ImportType::Tag) if import.name == "tag" => "WebAssembly.JSTag".to_owned(),
            ("nts:host/v1", found) => {
                let (wanted, value) = host_import(&import.name, captures)
                    .ok_or_else(|| format!("no JS host value for import `{}`", import.name))?;
                if !same(found, &wanted) {
                    return Err(format!(
                        "host import `{}` is declared {found:?}, but its JS value implements {wanted:?}",
                        import.name
                    ));
                }
                value
            }
            (module, _) => return Err(format!("no JS host for import module `{module}`")),
        };
        imports
            .entry(import.module.clone())
            .or_default()
            .push(format!("{}: {value}", quote(&import.name)));
    }
    Ok(imports)
}

/// The generated JS for `manifest`, loading its sibling `program.wasm`.
///
/// # Errors
/// An import or boundary the glue cannot express, or an import whose declared
/// type is not the one its JS value implements. Either is a compiler defect:
/// the emitter produced something no host adapter provides.
pub fn glue(manifest: &Manifest, host: Host) -> Result<Glue, String> {
    let mut captures = Captures::default();
    let imports = imports(manifest, &mut captures)?;
    let mut api = String::new();
    for (at, export) in manifest.exports.iter().enumerate() {
        let _ = writeln!(api, "  const e{at} = x[{}];", quote(&export.name));
    }
    let freeze = captures.get("freeze", "Object.freeze");
    let _ = writeln!(api, "  return {freeze}({{");
    for (at, export) in manifest.exports.iter().enumerate() {
        wrapper(at, export, &mut captures, &mut api)?;
    }
    for g in &manifest.globals {
        global(g, &mut captures, &mut api)?;
    }
    api.push_str("  });\n");
    let instance_ = captures.get("Instance", "WebAssembly.Instance");
    let exports = captures.get(
        "instanceExports",
        "Function.prototype.call.bind(Object.getOwnPropertyDescriptor(WebAssembly.Instance.prototype, 'exports').get)",
    );

    let mut out = String::from("// Generated by nts emit-wasm. Do not edit.\n");
    if host == Host::Node {
        out.push_str("import { readFileSync } from 'node:fs';\n");
    }
    for (local, source) in &captures.0 {
        let _ = writeln!(out, "const {local} = {source};");
    }
    out.push_str(
        "export class WasmInputDecline extends TypeError {\n  constructor(name, why, context = 'input to') { super(`NTS5001: wasm ${context} ${name}: ${why}`); this.code = 'NTS5001'; }\n}\n\
         function decline(name, why) { throw new WasmInputDecline(name, why); }\n\
         function declineResult(name, why) { throw new WasmInputDecline(name, why, 'result from'); }\n",
    );
    if manifest
        .exports
        .iter()
        .any(|export| export.result == BoundaryType::Promise)
    {
        out.push_str(PROMISES);
    }
    let options = "{ builtins: ['js-string'], importedStringConstants: \"'\" }";
    let _ = writeln!(
        out,
        "{};",
        match host {
            Host::Node => format!(
                "const module = await WebAssembly.compile(readFileSync(new URL('./program.wasm', import.meta.url)), {options})"
            ),
            Host::Browser => format!(
                "const module = await WebAssembly.compileStreaming(fetch(new URL('./program.wasm', import.meta.url)), {options})"
            ),
        }
    );
    out.push_str("const imports = {\n");
    for (module, values) in &imports {
        let _ = writeln!(out, "  {}: {{ {} }},", quote(module), values.join(", "));
    }
    out.push_str("};\n");
    let timers = manifest
        .imports
        .iter()
        .any(|import| import.module == "nts:host/v1" && import.name == "setTimer");
    if timers {
        // The host's timers call back into the instance that set them, so
        // each instance gets its own pair, closing over itself.
        let set_timeout = captures_line("setTimeout_", "setTimeout");
        let set_interval = captures_line("setInterval_", "setInterval");
        let clear_timeout = captures_line("clearTimeout_", "clearTimeout");
        let _ = writeln!(
            out,
            "{set_timeout}{set_interval}{clear_timeout}function create() {{\n  let self;\n  const timers = new Map();\n  const host = {{ ...imports['nts:host/v1'],\n    setTimer(id, ms, repeating) {{ const fire = () => {{ if (!repeating) timers.delete(id); self['$nts.timer.fire'](id, repeating); }}; timers.set(id, repeating ? setInterval_(fire, ms) : setTimeout_(fire, ms)); }},\n    clearTimer(id) {{ const handle = timers.get(id); if (handle !== undefined) {{ timers.delete(id); clearTimeout_(handle); }} }} }};\n  const x = {exports}(new {instance_}(module, {{ ...imports, 'nts:host/v1': host }}));\n  self = x;"
        );
    } else {
        let _ = writeln!(
            out,
            "function create() {{\n  const x = {exports}(new {instance_}(module, imports));"
        );
    }
    if let Some(init) = &manifest.init {
        let _ = writeln!(out, "  x[{}]();", quote(init));
    }
    out.push_str("  return x;\n}\nfunction api(x) {\n");
    out.push_str(&api);
    out.push_str("}\n");
    out.push_str("/** A fresh, independent instance of the program. */\nexport function instantiate() { return api(create()); }\n");
    Ok(Glue {
        program: program(manifest),
        instance: out,
    })
}

/// A captured global the timer pair uses, declared before `create`.
fn captures_line(local: &str, source: &str) -> String {
    format!("const {local} = {source};\n")
}

/// The promise boundary: an export's promise becomes a JS promise settled as
/// the program's is. One the export's own checkpoint settled resolves at once;
/// a pending one is watched, and the program's task that sees it settle calls
/// `promiseSettled`. A settlement is converted by its tag; a compiled object
/// or function is refused by name, since it needs an identity bridge.
const PROMISES: &str = "\
const settling = new Map();
let settlingNext = 0;
function erasedToJs(x, value, name) {
  switch (x['$nts.erased.tag'](value)) {
    case 0: return undefined;
    case 7: return null;
    case 1: return x['$nts.erased.boolean'](value) === 1;
    case 2: return x['$nts.erased.number'](value);
    case 3: return x['$nts.erased.string'](value);
    default: declineResult(name, 'a promise settled with a compiled object or function, which needs an identity bridge');
  }
}
function settledPromise(x, p, name, state) {
  try {
    const value = erasedToJs(x, x['$nts.promise.settlement'](p), name);
    return state === 1 ? Promise.resolve(value) : Promise.reject(value);
  } catch (error) {
    return Promise.reject(error);
  }
}
function toPromise(x, p, name) {
  const state = x['$nts.promise.state'](p);
  if (state !== 0) return settledPromise(x, p, name, state);
  return new Promise((resolve, reject) => {
    const id = settlingNext++;
    settling.set(id, { x, p, name, resolve, reject });
    x['$nts.promise.watch'](p, id);
  });
}
function promiseSettled(id) {
  const entry = settling.get(id);
  settling.delete(id);
  settledPromise(entry.x, entry.p, entry.name, entry.x['$nts.promise.state'](entry.p)).then(entry.resolve, entry.reject);
}
";

/// `program.mjs`: named ES exports of one instance, made on import. A global
/// another function can reassign is a live binding, refreshed after every
/// call that may write it. Every local here is the glue's own; the program's
/// names appear only as quoted export names, so none can collide.
fn program(manifest: &Manifest) -> String {
    let mut out = format!(
        "// Generated by nts emit-wasm. Do not edit.\nimport {{ instantiate }} from './{INSTANCE_FILE}';\nconst main = instantiate();\n"
    );
    let live: Vec<_> = manifest.globals.iter().filter(|g| g.live).collect();
    let mut names = Vec::new();
    for (at, export) in manifest.exports.iter().enumerate() {
        let name = quote(&export.name);
        if live.is_empty() {
            let _ = writeln!(out, "const f{at} = main[{name}];");
        } else {
            let params = params(export);
            let _ = writeln!(
                out,
                "function f{at}({params}) {{ try {{ return main[{name}]({params}); }} finally {{ sync(); }} }}"
            );
        }
        names.push(format!("f{at} as {name}"));
    }
    for (at, g) in manifest.globals.iter().enumerate() {
        let name = quote(&g.name);
        let keyword = if g.live { "let" } else { "const" };
        let _ = writeln!(out, "{keyword} g{at} = main[{name}];");
        names.push(format!("g{at} as {name}"));
    }
    if !live.is_empty() {
        out.push_str("function sync() {\n");
        for (at, g) in manifest.globals.iter().enumerate().filter(|(_, g)| g.live) {
            let _ = writeln!(out, "  g{at} = main[{}];", quote(&g.name));
        }
        out.push_str("}\n");
    }
    if !names.is_empty() {
        let _ = writeln!(out, "export {{ {} }};", names.join(", "));
    }
    out
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::{Host, glue};
    use crate::{Import, ImportType, Manifest, ValueType};

    fn generate(name: &str, ty: ImportType) -> Result<(), String> {
        let manifest = Manifest {
            abi: 3,
            host: "js".into(),
            exports: vec![],
            globals: vec![],
            init: None,
            imports: vec![Import {
                module: "nts:host/v1".into(),
                name: name.into(),
                ty,
            }],
            builtins: vec![],
            features: vec![],
            functions: vec![],
        };
        glue(&manifest, Host::Node).map(|_| ())
    }
    fn number(params: usize) -> ImportType {
        ImportType::Function {
            params: vec![ValueType::F64; params],
            result: Some(ValueType::F64),
        }
    }

    #[test]
    fn a_host_import_is_checked_against_the_value_that_provides_it() {
        generate("nts_math_sin", number(1)).unwrap();
        generate("nts_math_pow", number(2)).unwrap();
        // A declared type the JS value does not implement, which an engine
        // would coerce silently.
        let error = generate(
            "nts_math_sin",
            ImportType::Function {
                params: vec![ValueType::I32],
                result: Some(ValueType::F64),
            },
        )
        .unwrap_err();
        assert!(error.contains("`nts_math_sin` is declared"), "{error}");
        assert!(generate("nts_math_pow", number(1)).is_err());
        // A Math member outside the fixed list has no host value at all.
        let error = generate("nts_math_random", number(0)).unwrap_err();
        assert!(error.contains("no JS host value"), "{error}");
    }
}
