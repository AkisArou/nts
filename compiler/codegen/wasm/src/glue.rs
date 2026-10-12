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
            function(&[STRING], None),
            "name => { throw new WasmInputDecline(name, 'internal typed value contract', 'operation in'); }".into(),
        ),
        "uncaughtDecline" => (
            function(&[STRING], None),
            "name => { throw new WasmInputDecline(name, 'uncaught compiled object or function needs an identity bridge', 'throw from'); }".into(),
        ),
        "toNumber" => (function(&[F64], Some(STRING)), "value => value".into()),
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
        BoundaryType::Void | BoundaryType::Float { .. } => {
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
    let read = format!("x[{}].value", quote(&global.symbol));
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
    let _ = writeln!(
        out,
        "function create() {{\n  const x = new {instance_}(module, imports).exports;"
    );
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
