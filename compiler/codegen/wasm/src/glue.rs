//! The generated JS host module: the module's import object, written out for
//! exactly the imports it has, and one straight-line wrapper per export with
//! only the checks its declared signature needs.
//!
//! There is no runtime manifest. The same compiler emits the module and its
//! glue, so their agreement is a compile-time fact; the engine's own compile
//! and link errors catch anything else. A call costs one JS frame and the
//! `typeof` tests of its parameters, with no argument arrays.

use crate::{BoundaryType, FunctionExport, GlobalExport, ImportType, Manifest, NumberBound};
use std::{collections::BTreeMap, fmt::Write as _};

/// How the generated module obtains its bytes; everything else is shared.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Host {
    Node,
    Browser,
}

/// The JS value a host import provides, captured when the glue loads, before
/// any compiled code runs, so later changes to globals cannot redirect it.
fn host_value(name: &str, captures: &mut Vec<String>) -> Option<String> {
    if let Some(math) = name.strip_prefix("nts_math_") {
        captures.push(format!("const math_{math} = Math.{math};"));
        return Some(format!("math_{math}"));
    }
    Some(match name {
        "remainder" => "(left, right) => left % right".into(),
        "nts_number_to_string" => {
            captures.push("const apply = Reflect.apply;".into());
            captures.push("const numberToString = Number.prototype.toString;".into());
            "value => apply(numberToString, value, [])".into()
        }
        "nts_parse_float" => {
            captures.push("const parseFloat_ = Number.parseFloat;".into());
            "parseFloat_".into()
        }
        "nts_parse_int" => {
            captures.push("const parseInt_ = Number.parseInt;".into());
            "parseInt_".into()
        }
        "inputDecline" => {
            "name => { throw new WasmInputDecline(name, 'internal typed value contract', 'operation in'); }"
                .into()
        }
        "uncaughtDecline" => {
            "name => { throw new WasmInputDecline(name, 'uncaught compiled object or function needs an identity bridge', 'throw from'); }"
                .into()
        }
        "toNumber" => "value => value".into(),
        "undefined" => "new WebAssembly.Global({ value: 'externref' }, undefined)".into(),
        "true" => "true".into(),
        "false" => "false".into(),
        _ => return None,
    })
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
/// expression that passes the accepted value to wasm.
fn parameter(export: &FunctionExport, at: usize, out: &mut String) -> Result<String, String> {
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
            refuse(out, format!("typeof {arg} !== 'number'"), "expected number");
            refuse(
                out,
                format!("!Object.is(Math.fround({arg}), {arg})"),
                "number does not fit f32 exactly",
            );
            arg.clone()
        }
        BoundaryType::Int { bits, signed } => {
            refuse(out, format!("typeof {arg} !== 'number'"), "expected number");
            let limit = 2_f64.powi(i32::from(*bits) - i32::from(*signed));
            let low = if *signed { -limit } else { 0.0 };
            refuse(
                out,
                format!(
                    "!Number.isInteger({arg}) || Object.is({arg}, -0) || {arg} < {low:?} || {arg} >= {limit:?}"
                ),
                &format!(
                    "number does not fit {}{bits}",
                    if *signed { 'i' } else { 'u' }
                ),
            );
            if *bits == 64 {
                refuse(
                    out,
                    format!("!Number.isSafeInteger({arg})"),
                    "64-bit input exceeds the safe-number boundary",
                );
                format!("BigInt({arg})")
            } else {
                arg.clone()
            }
        }
        BoundaryType::Void | BoundaryType::Float { .. } => {
            return Err(format!(
                "public parameter {at} of `{}` has no JS boundary type",
                export.name
            ));
        }
    };
    if let Some(guard) = &parameter.guard {
        let mut violated = Vec::new();
        if !guard.maybe_nan {
            violated.push(format!("Number.isNaN({arg})"));
        }
        if !guard.maybe_negative_zero {
            violated.push(format!("Object.is({arg}, -0)"));
        }
        if guard.whole {
            violated.push(format!(
                "(Number.isFinite({arg}) && !Number.isInteger({arg}))"
            ));
        }
        violated.push(format!("{arg} < {}", number(&guard.minimum)));
        violated.push(format!("{arg} > {}", number(&guard.maximum)));
        refuse(
            out,
            violated.join(" || "),
            "number violates the parameter facts used for specialization",
        );
    }
    Ok(passed)
}

/// The statement returning the wasm result `value` at its logical type.
fn result(export: &FunctionExport, value: &str) -> String {
    let name = quote(&export.name);
    match &export.result {
        BoundaryType::Void => format!("{value};"),
        BoundaryType::Bool => format!("return {value} !== 0;"),
        BoundaryType::String => format!(
            "const result = {value};\n      if (typeof result !== 'string') declineResult({name}, 'result is outside primitive-string boundary');\n      return result;"
        ),
        BoundaryType::Int { bits: 64, signed } => format!(
            "const result = Number({});\n      if (!Number.isSafeInteger(result)) declineResult({name}, '64-bit result exceeds the safe-number boundary');\n      return result;",
            if *signed {
                value.to_owned()
            } else {
                format!("BigInt.asUintN(64, {value})")
            }
        ),
        BoundaryType::Int {
            bits: 32,
            signed: false,
        } => format!("return {value} >>> 0;"),
        BoundaryType::Int { .. } | BoundaryType::Float { .. } => format!("return {value};"),
    }
}

fn params(export: &FunctionExport) -> String {
    (0..export.params.len())
        .map(|at| format!("a{at}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// The wrapper of export `at`, calling the wasm function bound to `e{at}`.
fn wrapper(at: usize, export: &FunctionExport, out: &mut String) -> Result<(), String> {
    let _ = writeln!(out, "    {}({}) {{", quote(&export.name), params(export));
    let mut passed = Vec::new();
    for param in 0..export.params.len() {
        passed.push(parameter(export, param, out)?);
    }
    let call = format!("e{at}({})", passed.join(", "));
    let _ = writeln!(out, "      {}", result(export, &call));
    out.push_str("    },\n");
    Ok(())
}

fn global(global: &GlobalExport, out: &mut String) -> Result<(), String> {
    let read = format!("x[{}].value", quote(&global.symbol));
    let value = match &global.ty {
        BoundaryType::Bool => format!("{read} !== 0"),
        BoundaryType::Int {
            bits: 32,
            signed: false,
        } => format!("{read} >>> 0"),
        BoundaryType::Int { bits: 64, .. } => format!("Number({read})"),
        BoundaryType::String | BoundaryType::Int { .. } | BoundaryType::Float { .. } => read,
        BoundaryType::Void => {
            return Err(format!("public global `{}` has no value", global.name));
        }
    };
    let _ = writeln!(
        out,
        "    get {}() {{ return {value}; }},",
        quote(&global.name)
    );
    Ok(())
}

/// The generated ES module for `manifest`, loading its sibling `program.wasm`.
///
/// # Errors
/// An import or boundary the glue cannot express. This is a compiler defect:
/// the emitter produced something no host adapter provides.
pub fn glue(manifest: &Manifest, host: Host) -> Result<String, String> {
    let mut captures = Vec::new();
    let mut imports: BTreeMap<&str, Vec<String>> = BTreeMap::default();
    for import in &manifest.imports {
        let value = match (import.module.as_str(), &import.ty) {
            ("js", ImportType::Tag) if import.name == "tag" => "WebAssembly.JSTag".to_owned(),
            ("nts:host/v1", _) => host_value(&import.name, &mut captures)
                .ok_or_else(|| format!("no JS host value for import `{}`", import.name))?,
            (module, _) => return Err(format!("no JS host for import module `{module}`")),
        };
        imports
            .entry(import.module.as_str())
            .or_default()
            .push(format!("{}: {value}", quote(&import.name)));
    }
    captures.sort();
    captures.dedup();
    let mut out = String::from("// Generated by nts emit-wasm. Do not edit.\n");
    if host == Host::Node {
        out.push_str("import { readFileSync } from 'node:fs';\n");
    }
    for capture in &captures {
        let _ = writeln!(out, "{capture}");
    }
    out.push_str(
        "export class WasmInputDecline extends TypeError {\n  constructor(name, why, context = 'input to') { super(`NTS5001: wasm ${context} ${name}: ${why}`); this.code = 'NTS5001'; }\n}\n\
         function decline(name, why) { throw new WasmInputDecline(name, why); }\n\
         function declineResult(name, why) { throw new WasmInputDecline(name, why, 'result from'); }\n",
    );
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
    out.push_str(
        "function create() {\n  const x = new WebAssembly.Instance(module, imports).exports;\n",
    );
    if let Some(init) = &manifest.init {
        let _ = writeln!(out, "  x[{}]();", quote(init));
    }
    out.push_str("  return x;\n}\nfunction api(x) {\n");
    for (at, export) in manifest.exports.iter().enumerate() {
        let _ = writeln!(out, "  const e{at} = x[{}];", quote(&export.name));
    }
    out.push_str("  return Object.freeze({\n");
    for (at, export) in manifest.exports.iter().enumerate() {
        wrapper(at, export, &mut out)?;
    }
    for g in &manifest.globals {
        global(g, &mut out)?;
    }
    out.push_str("  });\n}\n");
    out.push_str("/** A fresh, independent instance of the program. */\nexport function instantiate() { return api(create()); }\n");
    out.push_str("const main = instantiate();\n");
    named_exports(manifest, &mut out);
    Ok(out)
}

/// Named ES exports of the default instance. A global another function can
/// reassign is a live binding, refreshed after every call that may write it.
fn named_exports(manifest: &Manifest, out: &mut String) {
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
        if g.live {
            let _ = writeln!(out, "let g{at} = main[{name}];");
        } else {
            let _ = writeln!(out, "const g{at} = main[{name}];");
        }
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
}
