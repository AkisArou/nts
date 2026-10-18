//! A [`Binding`] as files: the declaration module -- its constants among
//! its declarations, each the number its metadata gives (`@ntsConstant`) --
//! and what was refused.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use anyhow::{Context, Result};
use camino::Utf8Path;

use super::map::{Binding, ComMethod, TypeDecl};

/// Every name of the C vocabulary a binding may use: `c:types`' and the
/// scalars of `@nts/scalars`, each imported from its own module.
const BRANDS: &[&str] = &[
    "ByValue",
    "CArray",
    "CEnum",
    "Class",
    "ConstPtr",
    "Erased",
    "Opaque",
    "Packed",
    "Ptr",
    "Struct",
    "Typedef",
    "Union",
    "Utf16String",
    "c_char",
    "Float64",
    "Float32",
    "c_int",
    "Int16",
    "BigInt64",
    "Int8",
    "c_long",
    "c_long32",
    "c_uint",
    "Uint16",
    "BigUint64",
    "Uint8",
    "c_ulong",
    "c_ulong32",
];

/// The identifiers `text` uses, which decides what it imports.
fn identifiers(text: &str) -> BTreeSet<&str> {
    text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|w| !w.is_empty())
        .collect()
}

fn imports(body: &str, own: &str, owners: &BTreeMap<String, String>) -> String {
    let used = identifiers(body);
    let mut out = String::new();
    let brands: Vec<&str> = BRANDS
        .iter()
        .copied()
        .filter(|brand| used.contains(brand))
        .collect();
    out.push_str(&crate::bind::vocabulary_imports(
        brands.iter().copied(),
        "  ",
    ));
    let com: Vec<_> = ["ComClass", "Guid"]
        .into_iter()
        .filter(|name| used.contains(name))
        .collect();
    if !com.is_empty() {
        let _ = writeln!(
            out,
            "  import type {{ {} }} from \"winrt:types\";",
            com.join(", ")
        );
    }
    let mut foreign: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for name in &used {
        if let Some(namespace) = owners.get(*name).or_else(|| {
            name.strip_suffix("Methods")
                .or_else(|| name.strip_suffix("Members"))
                .and_then(|base| owners.get(base))
        }) && namespace != own
        {
            foreign.entry(namespace.as_str()).or_default().push(name);
        }
    }
    for (namespace, names) in foreign {
        let _ = writeln!(
            out,
            "  import type {{ {} }} from \"c:{namespace}\";",
            names.join(", ")
        );
    }
    out
}

/// The ABI name stays available beside its camelCase member. An inherited
/// member asks for the declaring interface rather than using a derived table.
fn com_method(method: &ComMethod, interface: &str, via: Option<(&str, &str)>) -> String {
    let signature = &method.signature;
    let mut out = String::from("    /**\n");
    if let Some(page) = &signature.documentation {
        let _ = writeln!(out, "     * {page}");
    }
    let _ = writeln!(out, "     * @ntsVtable {} {}", method.slot, signature.name);
    if method.hresult {
        out.push_str("     * @ntsHresult\n");
    }
    if let Some((iid, tag)) = via {
        let _ = writeln!(out, "     * @ntsVia {iid} {tag}");
    }
    for parameter in &signature.no_escape {
        let _ = writeln!(out, "     * @ntsNoEscape {parameter}");
    }
    out.push_str("     */\n");
    let name = via.map_or_else(
        || signature.name.clone(),
        |_| nts_core::hir::native::js_name(&signature.name),
    );
    let mut parameters = vec![format!("this: {interface}")];
    parameters.extend(
        signature
            .parameters
            .iter()
            .map(|(name, ts)| format!("{}: {ts}", safe(name))),
    );
    let _ = writeln!(
        out,
        "    {name}({}): {};",
        parameters.join(", "),
        signature.result
    );
    out
}

/// The header a documentation page names: `.../api/winuser/nf-winuser-...`.
pub(crate) fn header_of(documentation: Option<&str>) -> Option<String> {
    let path = documentation?.split("/api/").nth(1)?;
    Some(format!("{}.h", path.split('/').next()?))
}

/// One namespace's module as text: its declarations, and what was refused,
/// a line each.
pub(crate) struct Rendered {
    pub(crate) namespace: String,
    pub(crate) declarations: String,
    pub(crate) refused: String,
}

/// [`render`]ed into `out`: `<namespace>.d.ts` and `.refused.txt`.
pub(crate) fn write(
    binding: &Binding,
    out: &Utf8Path,
    command: &str,
    owners: &BTreeMap<String, String>,
) -> Result<()> {
    let rendered = render(binding, command, owners);
    let stem = &rendered.namespace;
    write_file(&out.join(format!("{stem}.d.ts")), &rendered.declarations)?;
    // The values file an older `nts` wrote beside, which a program would
    // still find and import by path.
    let values = out.join(format!("{stem}.values.ts"));
    if values.is_file() {
        std::fs::remove_file(&values).with_context(|| format!("removing {values}"))?;
    }
    write_file(&out.join(format!("{stem}.refused.txt")), &rendered.refused)
}

fn render_type(decl: &TypeDecl, body: &mut String) {
    match decl {
        TypeDecl::Alias { name, ts, .. } | TypeDecl::Record { name, ts, .. } => {
            let _ = writeln!(body, "  export type {name} = {ts};");
        }
        TypeDecl::Interface {
            name,
            iid,
            tag,
            bases,
            methods,
            ..
        } => {
            let _ = writeln!(body, "  export interface {name}Methods {{");
            for method in methods {
                body.push_str(&com_method(method, name, None));
            }
            body.push_str("  }\n");
            let _ = writeln!(body, "  export interface {name}Members {{");
            for method in methods {
                body.push_str(&com_method(method, name, Some((iid, tag))));
            }
            body.push_str("  }\n");
            let _ = writeln!(
                body,
                "  /**\n   * @ntsQuery {iid}\n   * Explicit void** results remain raw Ptr<void>; no COM ownership is inferred.\n   */"
            );
            let parent = bases
                .first()
                .map_or_else(String::new, |base| format!(", {}", base.1));
            let _ = write!(
                body,
                "  export type {name} = ComClass<\"{tag}\"{parent}> & {name}Methods & {name}Members"
            );
            for base in bases {
                let _ = write!(body, " & {}Methods & {}Members", base.1, base.1);
            }
            body.push_str(";\n");
        }
        TypeDecl::Enum { name, members } => {
            let _ = writeln!(body, "  export const enum {name} {{");
            for (member, value) in members {
                let _ = writeln!(body, "    {member} = {value},");
            }
            body.push_str("  }\n");
        }
    }
}

/// One binding's module, as text.
pub(crate) fn render(
    binding: &Binding,
    command: &str,
    owners: &BTreeMap<String, String>,
) -> Rendered {
    let stem = &binding.namespace;
    let mut body = String::new();
    for decl in &binding.types {
        render_type(decl, &mut body);
    }
    if !binding.types.is_empty() {
        body.push('\n');
    }
    // A constant is declared with its value: a read folds to that number or
    // native handle. A module needs no values file, and one from the platform
    // store needs no path.
    for constant in &binding.constants {
        let _ = writeln!(
            body,
            "  /** @ntsConstant {} */\n  export const {}: {};",
            constant.value, constant.name, constant.ts
        );
    }
    if !binding.constants.is_empty() {
        body.push('\n');
    }
    for function in &binding.functions {
        body.push_str("  /**\n");
        if let Some(page) = &function.documentation {
            let _ = writeln!(body, "   * {page}");
        }
        let header =
            header_of(function.documentation.as_deref()).unwrap_or_else(|| "windows.h".into());
        let _ = writeln!(
            body,
            "   * Imported from `{}`; declared in `<{header}>`.",
            function.library
        );
        // The import library mingw names after the DLL: `USER32.dll` is
        // `-luser32`. A program links it only if it calls this.
        let library = function.library.to_ascii_lowercase();
        let _ = writeln!(
            body,
            "   * @ntsLibrary {}",
            library.strip_suffix(".dll").unwrap_or(&library)
        );
        for parameter in &function.no_escape {
            let _ = writeln!(body, "   * @ntsNoEscape {parameter}");
        }
        body.push_str("   */\n");
        let parameters: Vec<String> = function
            .parameters
            .iter()
            .map(|(name, ts)| format!("{}: {ts}", safe(name)))
            .collect();
        let _ = writeln!(
            body,
            "  export function {}({}): {};",
            function.name,
            parameters.join(", "),
            function.result
        );
    }
    let mut declarations = String::new();
    let _ = writeln!(
        declarations,
        "// Generated by `{command}`. Edit the command, not this file."
    );
    declarations.push_str(
        "//\n// Each declaration's meaning is from Windows metadata and its C type from the\n\
         // Windows headers, and every one compiled against those headers before it\n\
         // was written.\n/**\n * @ntsHeader <windows.h>\n */\n",
    );
    let _ = writeln!(declarations, "declare module \"{}\" {{", binding.module);
    declarations.push_str(&imports(&body, stem, owners));
    declarations.push('\n');
    declarations.push_str(&body);
    declarations.push_str("}\n");
    let mut refused = String::new();
    for (name, why) in &binding.refused {
        let _ = writeln!(refused, "{name}\t{why}");
    }
    Rendered {
        namespace: stem.clone(),
        declarations,
        refused,
    }
}

/// A parameter name TypeScript reserves, renamed.
pub(crate) fn safe(name: &str) -> String {
    const RESERVED: &[&str] = &[
        "function",
        "default",
        "in",
        "new",
        "class",
        "var",
        "this",
        "delete",
        "void",
        "with",
        "case",
        "enum",
        "export",
        "import",
        "switch",
        "typeof",
        "yield",
        "package",
        "interface",
        "private",
        "protected",
        "public",
        "static",
        "let",
    ];
    if RESERVED.contains(&name) {
        format!("{name}_")
    } else {
        name.to_owned()
    }
}

fn write_file(path: &Utf8Path, text: &str) -> Result<()> {
    std::fs::write(path, text).with_context(|| format!("writing {path}"))
}
