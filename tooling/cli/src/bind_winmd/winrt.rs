//! Windows Runtime namespaces: `nts bind-winmd Windows.Data.Json`.
//!
//! **No header answers anything here, and none is asked.** The Windows
//! Runtime's ABI is defined by its metadata alone: every interface method is
//! slot `6 + i` of the interface's table (after `IUnknown`'s three and
//! `IInspectable`'s three), returns an HRESULT, and writes its result through
//! a last parameter. So a binding is read straight off the contract `.winmd`s
//! (`Microsoft.Windows.SDK.Contracts`), where the Win32 half of this binder
//! needs clang for the C types the metadata does not record.
//!
//! What a namespace becomes, in `winrt:<namespace>`:
//! - an interface is a `ComClass` beside its methods, each tagged with its
//!   slot and the method the metadata gives that slot;
//! - a runtime class is its default interface, and a namespace of the same
//!   name holds its statics, each called on the class's activation factory
//!   as the static interface that declares it (`JsonValue.Parse(text)`);
//! - an enum is a `const enum`, crossing as its 32-bit underlying type.
//!
//! What is not bound yet is refused into `<namespace>.refused.txt` with the
//! reason, one line each: generic interfaces and their instantiations
//! (`IVector<T>`, whose IID is computed rather than read), structs, arrays,
//! `out` parameters, and events.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use anyhow::{Context, Result};
use camino::{Utf8Path, Utf8PathBuf};
use windows_metadata::reader::{File, HasAttributes, Index, TypeCategory, TypeDef};
use windows_metadata::{Type, Value};

/// The Windows Runtime metadata: `Microsoft.Windows.SDK.Contracts`, one `.winmd` per API
/// contract (`Windows.Foundation.UniversalApiContract.winmd` holds most of
/// `Windows.*`). A released version, unlike the Win32 package.
pub(crate) const WINRT_METADATA_VERSION: &str = "10.0.28000.2705";

/// Where `tooling/windows/fetch-winrt-metadata.sh` puts the metadata: a
/// directory of contract `.winmd`s.
pub(crate) fn default_metadata() -> Utf8PathBuf {
    if let Ok(path) = std::env::var("NTS_WINRT_METADATA") {
        return Utf8PathBuf::from(path);
    }
    crate::windows_root().join("metadata").join(format!("winrt-{WINRT_METADATA_VERSION}"))
}

/// Whether a namespace is the Windows Runtime's rather than Win32's.
pub(crate) fn is_winrt(namespace: &str) -> bool {
    namespace.starts_with("Windows.") && !namespace.starts_with("Windows.Win32.")
}

/// Every contract `.winmd` in `directory`, as one index.
pub(crate) fn index(directory: &Utf8Path) -> Result<&'static Index> {
    let mut files = Vec::new();
    let entries = std::fs::read_dir(directory).with_context(|| {
        format!("reading {directory}: fetch it with tooling/windows/fetch-winrt-metadata.sh")
    })?;
    for entry in entries {
        let path = entry?.path();
        if path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("winmd")) {
            files.push(File::read(&path).with_context(|| format!("reading {}", path.display()))?);
        }
    }
    anyhow::ensure!(!files.is_empty(), "no .winmd in {directory}: fetch it with tooling/windows/fetch-winrt-metadata.sh");
    Ok(Index::new(files).leak())
}

/// Bind `namespaces` into `out`: `<namespace>.d.ts`, and beside it
/// `<namespace>.refused.txt` naming each item not bound and why. One summary
/// line each.
pub(crate) fn write(namespaces: &[String], metadata: &Utf8Path, out: &Utf8Path, command: &str) -> Result<Vec<String>> {
    let index = index(metadata)?;
    std::fs::create_dir_all(out).with_context(|| format!("creating {out}"))?;
    let mut lines = Vec::new();
    for namespace in namespaces {
        anyhow::ensure!(
            index.contains_namespace(namespace),
            "the Windows Runtime metadata in {metadata} has no namespace `{namespace}`"
        );
    }
    // **What the namespaces asked for reach, and no more.** A namespace asked
    // for is bound whole; one its declarations only name -- `Windows.
    // Foundation.Collections` for `IVectorView<T>` -- gets the types named,
    // and whatever those name in turn, to a fixed point. Closing over whole
    // namespaces instead reached most of the SDK from `Windows.Globalization`.
    let mut wanted: std::collections::BTreeMap<String, Option<BTreeSet<String>>> =
        namespaces.iter().map(|namespace| (namespace.clone(), None)).collect();
    let modules = loop {
        let mut modules = Vec::new();
        let mut grew = false;
        let current = wanted.clone();
        for (namespace, only) in &current {
            let module = bind(index, namespace, only.as_ref(), command);
            for (other, names) in &module.references {
                match wanted.entry(other.clone()).or_insert_with(|| Some(BTreeSet::new())) {
                    None => {}
                    Some(set) => {
                        for name in names {
                            grew |= set.insert(name.clone());
                        }
                    }
                }
            }
            modules.push(module);
        }
        if !grew && wanted.len() == current.len() {
            break modules;
        }
    };
    for module in modules {
        let namespace = &module.namespace.clone();
        let path = out.join(format!("{namespace}.d.ts"));
        std::fs::write(&path, &module.text).with_context(|| format!("writing {path}"))?;
        let refused = module.refused.iter().fold(String::new(), |mut text, (what, why)| {
            let _ = writeln!(text, "{what}\t{why}");
            text
        });
        let refused_path = out.join(format!("{namespace}.refused.txt"));
        std::fs::write(&refused_path, refused).with_context(|| format!("writing {refused_path}"))?;
        lines.push(format!(
            "winrt:{}: {} interfaces, {} classes, {} methods; {} refused (see {namespace}.refused.txt)",
            module.namespace,
            module.interfaces,
            module.classes,
            module.methods,
            module.refused.len()
        ));
    }
    Ok(lines)
}

/// The namespace a `winrt:` module names.
pub(crate) fn namespace_of(module: &str) -> Option<String> {
    module.strip_prefix("winrt:").filter(|namespace| is_winrt(namespace)).map(str::to_owned)
}

/// The file whose fingerprint stands for the metadata in a stamp.
pub(crate) fn metadata_marker(directory: &Utf8Path) -> Utf8PathBuf {
    directory.join("Windows.Foundation.UniversalApiContract.winmd")
}

/// One bound namespace: the module text, what was refused and why, and the
/// counts the summary line reports.
pub(crate) struct Module {
    pub(crate) namespace: String,
    /// Every type this module names, by the namespace declaring it -- its own
    /// included, which a module bound only in part must then declare.
    pub(crate) references: std::collections::BTreeMap<String, BTreeSet<String>>,
    pub(crate) text: String,
    pub(crate) refused: Vec<(String, String)>,
    pub(crate) interfaces: usize,
    pub(crate) classes: usize,
    pub(crate) methods: usize,
}

/// `namespace` as a `winrt:` module.
/// `namespace` as a `winrt:` module: every type in it, or only those `only`
/// names.
pub(crate) fn bind(index: &Index, namespace: &str, only: Option<&BTreeSet<String>>, command: &str) -> Module {
    let mut writer = Writer {
        index,
        namespace,
        brands: BTreeSet::new(),
        references: std::collections::BTreeMap::new(),
        generics: Vec::new(),
        refused: Vec::new(),
        methods: 0,
    };
    let mut body = String::new();
    let mut interfaces = 0;
    let mut classes = 0;
    let mut defs: Vec<TypeDef> = index
        .types()
        .filter(|def| def.namespace() == namespace)
        .filter(|def| only.is_none_or(|names| names.contains(generic_base(def.name()))))
        .collect();
    defs.sort_by_key(TypeDef::name);
    for def in &defs {
        let name = def.name();
        if def.generic_params().next().is_some() && def.category() != TypeCategory::Interface {
            writer.refuse(name, "a generic delegate");
            continue;
        }
        match def.category() {
            TypeCategory::Interface => {
                if writer.interface(*def, &mut body) {
                    interfaces += 1;
                }
            }
            TypeCategory::Class => {
                if writer.class(*def, &mut body) {
                    classes += 1;
                }
            }
            TypeCategory::Enum => Writer::enumeration(*def, &mut body),
            TypeCategory::Struct => writer.refuse(name, "a struct"),
            TypeCategory::Delegate => writer.refuse(name, "a delegate"),
            TypeCategory::Attribute => {}
        }
    }
    let mut text = String::new();
    let _ = writeln!(text, "// Generated by `{command}` from the Windows Runtime's metadata");
    let _ = writeln!(text, "// (Microsoft.Windows.SDK.Contracts {WINRT_METADATA_VERSION}). Edit the command, not this file.");
    let _ = writeln!(text, "//");
    let _ = writeln!(text, "// Each method is the slot of its interface's table the metadata gives it, named");
    let _ = writeln!(text, "// as the metadata names that slot; the compiler refuses the two disagreeing.");
    let _ = writeln!(text, "declare module \"winrt:{namespace}\" {{");
    let c_types: Vec<&str> =
        writer.brands.iter().copied().filter(|brand| brand.starts_with("c_") || matches!(*brand, "CEnum" | "CNumber")).collect();
    if !c_types.is_empty() {
        let _ = writeln!(text, "  import type {{ {} }} from \"c:types\";", c_types.join(", "));
    }
    let winrt: Vec<&str> = writer.brands.iter().copied().filter(|brand| matches!(*brand, "ComClass" | "HString")).collect();
    if !winrt.is_empty() {
        let _ = writeln!(text, "  import type {{ {} }} from \"winrt:types\";", winrt.join(", "));
    }
    for (other, names) in writer.references.iter().filter(|(other, _)| other.as_str() != namespace) {
        let names: Vec<&str> = names.iter().map(String::as_str).collect();
        let _ = writeln!(text, "  import type {{ {} }} from \"winrt:{other}\";", names.join(", "));
    }
    text.push('\n');
    text.push_str(&body);
    text.push_str("}\n");
    Module {
        namespace: namespace.to_owned(),
        references: writer.references,
        text,
        refused: writer.refused,
        interfaces,
        classes,
        methods: writer.methods,
    }
}

struct Writer<'a> {
    index: &'a Index,
    namespace: &'a str,
    brands: BTreeSet<&'static str>,
    references: std::collections::BTreeMap<String, BTreeSet<String>>,
    /// The type parameters of the generic interface being written, by name.
    generics: Vec<String>,
    refused: Vec<(String, String)>,
    methods: usize,
}

impl Writer<'_> {
    fn refuse(&mut self, what: &str, why: &str) {
        self.refused.push((what.to_owned(), why.to_owned()));
    }

    /// `IJsonValue`: a `ComClass` and its methods, slot by slot.
    fn interface(&mut self, def: TypeDef, body: &mut String) -> bool {
        // ``IVectorView`1`` is `IVectorView<T>`: a method call goes through the
        // object's own table, whichever `T` it was made for, so the
        // TypeScript generic is the whole of it here. The instantiation's own
        // IID is computed (`iid::parameterized`) only where one is asked for.
        let name = generic_base(def.name());
        self.generics = def.generic_params().map(|param| param.name().to_owned()).collect();
        let parameters = if self.generics.is_empty() { String::new() } else { format!("<{}>", self.generics.join(", ")) };
        let this = format!("{name}{parameters}");
        let Some(iid) = iid(def) else {
            self.refuse(name, "an interface with no GuidAttribute");
            return false;
        };
        let mut methods = String::new();
        for (index, method) in def.methods().enumerate() {
            let slot = 6 + index;
            match self.method(method, slot, Receiver::Instance(&this)) {
                Ok(text) => {
                    methods.push_str(&text);
                    self.methods += 1;
                }
                Err(why) => self.refuse(&format!("{name}.{}", method_name(method)), &why),
            }
        }
        self.brands.insert("ComClass");
        let _ = writeln!(body, "  /** IID {iid} */");
        let _ = writeln!(body, "  export interface {name}Methods{parameters} {{");
        body.push_str(&methods);
        let _ = writeln!(body, "  }}");
        // The tag is the C struct a handle points at, so a C identifier: the
        // namespace kept, since two namespaces may name an interface alike.
        let tag = format!("{}_{name}", self.namespace.replace('.', "_"));
        let _ = writeln!(body, "  export type {this} = ComClass<\"{tag}\"> & {name}Methods{parameters};");
        self.generics.clear();
        true
    }

    /// `JsonValue`: its default interface, and its statics in a namespace of
    /// the same name.
    fn class(&mut self, def: TypeDef, body: &mut String) -> bool {
        let name = def.name();
        let default = def.interface_impls().find(|implemented| implemented.has_attribute("DefaultAttribute"));
        let spelled = match default.map(|implemented| implemented.interface(&[])) {
            Some(Type::ClassName(interface)) if interface.generics.is_empty() => self.named(&interface.namespace, &interface.name),
            Some(_) => {
                self.refuse(name, "a runtime class whose default interface is generic");
                return false;
            }
            // A static-only class (`Windows.Globalization.ApplicationLanguages`)
            // has no instances, only its namespace of statics.
            None => String::new(),
        };
        let class_name = format!("{}.{name}", self.namespace);
        let mut statics = String::new();
        for attribute in def.attributes().filter(|attribute| attribute.ctor().parent().name() == "StaticAttribute") {
            let Some((_, Value::TypeName(interface))) = attribute.value().into_iter().next() else { continue };
            let Some(statics_def) = self.index.get(&interface.namespace, &interface.name).next() else {
                self.refuse(&format!("{name} statics"), &format!("`{}` is not in the metadata read", interface.name));
                continue;
            };
            let Some(iid) = iid(statics_def) else { continue };
            for (index, method) in statics_def.methods().enumerate() {
                match self.method(method, 6 + index, Receiver::Factory { class: &class_name, iid: &iid }) {
                    Ok(text) => {
                        statics.push_str(&text);
                        self.methods += 1;
                    }
                    Err(why) => self.refuse(&format!("{name}.{}", method_name(method)), &why),
                }
            }
        }
        if !spelled.is_empty() {
            let _ = writeln!(body, "  export type {name} = {spelled};");
        }
        if !statics.is_empty() {
            let _ = writeln!(body, "  export namespace {name} {{");
            body.push_str(&statics);
            let _ = writeln!(body, "  }}");
        }
        !spelled.is_empty() || !statics.is_empty()
    }

    /// `JsonValueType`: a `const enum` of its members.
    fn enumeration(def: TypeDef, body: &mut String) {
        let _ = writeln!(body, "  export const enum {} {{", def.name());
        for field in def.fields() {
            let Some(constant) = field.constant() else { continue };
            let value = match constant.value() {
                Value::I32(value) => i64::from(value),
                Value::U32(value) => i64::from(value),
                _ => continue,
            };
            let _ = writeln!(body, "    {} = {value},", field.name());
        }
        body.push_str("  }\n");
    }

    /// One method as a binding declares it, or why it cannot be one yet.
    fn method(
        &mut self,
        method: windows_metadata::reader::MethodDef,
        slot: usize,
        receiver: Receiver<'_>,
    ) -> Result<String, String> {
        // A generic interface's own parameters stand for themselves: the
        // signature reads `T` by its index, and is spelled back by name.
        let parameters: Vec<Type> = self
            .generics
            .iter()
            .enumerate()
            .map(|(at, name)| Type::Generic(name.clone(), u16::try_from(at).unwrap_or(u16::MAX)))
            .collect();
        let signature = method.signature(&parameters);
        let named = method.params_by_sequence(signature.types.len()).map_err(|_| "a method whose parameters the metadata numbers wrongly".to_owned())?;
        let mut parameters: Vec<String> = Vec::new();
        if let Receiver::Instance(this) = receiver {
            parameters.push(format!("this: {this}"));
        }
        for (at, ty) in signature.types.iter().enumerate() {
            let row = named.params().get(at).copied().flatten();
            if row.is_some_and(|row| row.flags().contains(windows_metadata::ParamAttributes::Out)) {
                return Err("an `out` parameter".to_owned());
            }
            let name = row.map_or_else(|| format!("param{at}"), |row| safe(row.name()));
            parameters.push(format!("{name}: {}", self.spell(ty, true)?));
        }
        let result = match &signature.return_type {
            Type::Void => "void".to_owned(),
            other => self.spell(other, false)?,
        };
        let mut text = String::new();
        let _ = writeln!(text, "    /**");
        let _ = writeln!(text, "     * @ntsVtable {slot} {}", method_name(method));
        let _ = writeln!(text, "     * @ntsHresult");
        if let Receiver::Factory { class, iid } = receiver {
            let _ = writeln!(text, "     * @ntsFactory {class} {iid}");
        }
        let _ = writeln!(text, "     */");
        let keyword = if matches!(receiver, Receiver::Factory { .. }) { "function " } else { "" };
        let _ = writeln!(text, "    {keyword}{}({}): {result};", method_name(method), parameters.join(", "));
        Ok(text)
    }

    /// The TypeScript for one Windows Runtime type, as a parameter (`argument`) or a
    /// result.
    fn spell(&mut self, ty: &Type, argument: bool) -> Result<String, String> {
        let scalar = |brand: &'static str, writer: &mut Self| {
            writer.brands.insert(brand);
            Ok(brand.to_owned())
        };
        // A plain `number` wherever a double holds every value, as `bind-gir`
        // spells them; a 64-bit integer keeps its exact `bigint` brand.
        let number = |c: &str, writer: &mut Self| {
            writer.brands.insert("CNumber");
            Ok(format!("CNumber<\"{c}\">"))
        };
        match ty {
            Type::I8 => number("int8", self),
            Type::U8 => number("uint8", self),
            Type::I16 => number("int16", self),
            Type::U16 | Type::Char => number("uint16", self),
            Type::I32 => number("int32", self),
            Type::U32 => number("uint32", self),
            Type::I64 => scalar("c_int64", self),
            Type::U64 => scalar("c_uint64", self),
            Type::F32 => number("float", self),
            Type::F64 => number("double", self),
            Type::String => {
                self.brands.insert("HString");
                Ok("HString".to_owned())
            }
            // One byte, 0 or 1: C's `bool`.
            Type::Bool => Ok("boolean".to_owned()),
            // A parameter of the generic interface being written, by name.
            Type::Generic(name, _) if self.generics.iter().any(|known| known == name) => Ok(name.clone()),
            Type::Generic(name, _) => Err(format!("`{name}`, a type parameter of something not being written")),
            Type::ClassName(name) => {
                // The index keys a generic type by its name without the tick:
                // ``IVectorView`1`` is found as `IVectorView`.
                let Some(def) = self.index.get(&name.namespace, generic_base(&name.name)).next() else {
                    return Err(format!("`{}`, not in the metadata read", name.name));
                };
                if def.category() == TypeCategory::Delegate {
                    return Err(format!("`{}`, a delegate", generic_base(&name.name)));
                }
                let base = self.named(&name.namespace, generic_base(&name.name));
                // An instantiation, `IVectorView<HString>`: each argument as
                // it is inside the type, which is never `null`.
                let spelled = if name.generics.is_empty() {
                    base
                } else {
                    let arguments = name.generics.iter().map(|argument| self.spell(argument, false)).collect::<Result<Vec<_>, _>>()?;
                    format!("{base}<{}>", arguments.join(", "))
                };
                // An object may be null where it is passed, as WinRT's
                // projections all allow; a result is what C wrote.
                Ok(if argument { format!("{spelled} | null") } else { spelled })
            }
            Type::ValueName(name) => {
                let Some(def) = self.index.get(&name.namespace, &name.name).next() else {
                    return Err(format!("`{}`, not in the metadata read", name.name));
                };
                if def.category() != TypeCategory::Enum {
                    return Err(format!("`{}`, a struct", name.name));
                }
                let enumeration = self.named(&name.namespace, &name.name);
                let underlying = match def.underlying_type() {
                    Some(Type::U32) => "c_uint32",
                    _ => "c_int32",
                };
                self.brands.insert("CEnum");
                self.brands.insert(underlying);
                Ok(format!("CEnum<{enumeration}, {underlying}>"))
            }
            Type::Object => Err("an `Object`, which is `IInspectable` of any class".to_owned()),
            Type::Array(_) => Err("an array".to_owned()),
            Type::RefMut(_) => Err("an `out` parameter".to_owned()),
            other => Err(format!("{other:?}, a type WinRT does not use here")),
        }
    }
}

impl Writer<'_> {
    /// A type's name as this module spells it: its own, imported from the
    /// module of the namespace declaring it when that is another.
    fn named(&mut self, namespace: &str, name: &str) -> String {
        self.references.entry(namespace.to_owned()).or_default().insert(name.to_owned());
        name.to_owned()
    }
}

/// ``IVectorView`1`` as TypeScript names it: `IVectorView`.
fn generic_base(name: &str) -> &str {
    name.split('`').next().unwrap_or(name)
}

#[derive(Clone, Copy)]
enum Receiver<'a> {
    Instance(&'a str),
    Factory { class: &'a str, iid: &'a str },
}

/// The name the metadata gives a method's slot: its `OverloadAttribute` where
/// it has one, which is unique within the interface, and otherwise its name.
fn method_name(method: windows_metadata::reader::MethodDef) -> String {
    method
        .find_attribute("OverloadAttribute")
        .and_then(|attribute| match attribute.value().into_iter().next() {
            Some((_, Value::Utf8(name))) => Some(name),
            _ => None,
        })
        .unwrap_or_else(|| method.name().to_owned())
}

/// `A3219ECB-F0B3-4DCD-BEEE-19D48CD3ED1E`, from `GuidAttribute`.
fn iid(def: TypeDef) -> Option<String> {
    let values: Vec<Value> = def.find_attribute("GuidAttribute")?.value().into_iter().map(|(_, value)| value).collect();
    let [Value::U32(a), Value::U16(b), Value::U16(c), Value::U8(d0), Value::U8(d1), Value::U8(d2), Value::U8(d3), Value::U8(d4), Value::U8(d5), Value::U8(d6), Value::U8(d7)] =
        values.as_slice()
    else {
        return None;
    };
    Some(format!("{a:08X}-{b:04X}-{c:04X}-{d0:02X}{d1:02X}-{d2:02X}{d3:02X}{d4:02X}{d5:02X}{d6:02X}{d7:02X}"))
}

/// A parameter name TypeScript accepts.
fn safe(name: &str) -> String {
    match name {
        "default" | "function" | "class" | "delete" | "new" | "in" | "var" | "this" | "enum" | "with" | "switch" | "case" => {
            format!("{name}_")
        }
        _ => name.to_owned(),
    }
}
