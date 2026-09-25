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

/// The Windows App SDK release whose metadata `Microsoft.*` is bound from,
/// and whose runtime a program using it bootstraps (`MddBootstrapInitialize2`
/// for its major and minor version): `WinUI` 3 and what it stands on.
pub(crate) const WINAPPSDK_VERSION: &str = "1.8.260804001";

/// The packages of that release read, as `id=version`: the metadata of
/// `Microsoft.Windows.*` and the bootstrap DLL (`Foundation`), `WinUI`'s
/// (`WinUI`), and `Microsoft.UI`'s windowing and dispatching
/// (`InteractiveExperiences`). The metapackage names these exact versions.
/// `tooling/windows/fetch-winappsdk.sh` reads this line.
pub(crate) const WINAPPSDK_PACKAGES: &str = "foundation=1.8.260803002 winui=1.8.260803003 interactiveexperiences=1.8.260708001";

/// The directories of `.winmd`s bound from: the Windows SDK's contracts, which
/// `tooling/windows/fetch-winrt-metadata.sh` puts there, and the Windows App
/// SDK's once `tooling/windows/fetch-winappsdk.sh` has. `NTS_WINRT_METADATA`
/// names them instead, as a path list.
pub(crate) fn default_metadata() -> Vec<Utf8PathBuf> {
    if let Some(paths) = std::env::var_os("NTS_WINRT_METADATA") {
        return std::env::split_paths(&paths).filter_map(|path| Utf8PathBuf::from_path_buf(path).ok()).collect();
    }
    let mut directories = vec![crate::windows_root().join("metadata").join(format!("winrt-{WINRT_METADATA_VERSION}"))];
    let sdk = winappsdk();
    if sdk.is_dir() {
        directories.push(sdk);
    }
    directories
}

/// Where `tooling/windows/fetch-winappsdk.sh` puts the Windows App SDK: its
/// `.winmd`s, and `native/` holding the bootstrap DLL a program ships beside
/// itself.
pub(crate) fn winappsdk() -> Utf8PathBuf {
    crate::windows_root().join("metadata").join(format!("winappsdk-{WINAPPSDK_VERSION}"))
}

/// The Windows App SDK's bootstrapper: what an unpackaged program loads to
/// find the SDK's runtime, shipped beside it.
pub(crate) const BOOTSTRAPPER: &str = "Microsoft.WindowsAppRuntime.Bootstrap.dll";

/// Where `tooling/windows/fetch-winappsdk.sh` put the bootstrapper.
pub(crate) fn bootstrapper() -> Utf8PathBuf {
    winappsdk().join("native").join(BOOTSTRAPPER)
}

/// Whether `program` activates a Windows App SDK class -- a `Microsoft.*`
/// class name reaching the runtime's factory lookup -- and so needs the
/// bootstrapper beside it. Read from the calls, so a program that only
/// imports the SDK's types ships nothing.
pub(crate) fn uses_winappsdk(program: &nts_core::hir::Program) -> bool {
    use nts_core::hir::{Callee, OpKind};
    program.funcs.iter().any(|func| {
        func.values.iter().any(|op| match &op.kind {
            OpKind::Call { callee: Callee::External(name), args, .. }
                if matches!(name.as_str(), "nts_winrt_factory" | "nts_winrt_activate") =>
            {
                args.first().is_some_and(|class| {
                    matches!(&func.values[class.0 as usize].kind, OpKind::ConstString(text) if text.starts_with("Microsoft."))
                })
            }
            _ => false,
        })
    })
}

/// Whether a namespace is the Windows Runtime's rather than Win32's.
pub(crate) fn is_winrt(namespace: &str) -> bool {
    // `Microsoft.*` is the Windows App SDK's: WinUI 3 (`Microsoft.UI.Xaml`),
    // its windowing and dispatching (`Microsoft.UI`), described the same way.
    (namespace.starts_with("Windows.") && !namespace.starts_with("Windows.Win32.")) || namespace.starts_with("Microsoft.")
}

/// Every `.winmd` in `directories`, as one index.
pub(crate) fn index(directories: &[Utf8PathBuf]) -> Result<&'static Index> {
    let mut files = Vec::new();
    for directory in directories {
        let entries = std::fs::read_dir(directory).with_context(|| {
            format!("reading {directory}: fetch it with tooling/windows/fetch-winrt-metadata.sh")
        })?;
        for entry in entries {
            let path = entry?.path();
            if path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("winmd")) {
                files.push(File::read(&path).with_context(|| format!("reading {}", path.display()))?);
            }
        }
    }
    anyhow::ensure!(!files.is_empty(), "no .winmd in {directories:?}: fetch it with tooling/windows/fetch-winrt-metadata.sh");
    Ok(Index::new(files).leak())
}

/// Bind `namespaces` into `out`: `<namespace>.d.ts`, and beside it
/// `<namespace>.refused.txt` naming each item not bound and why. One summary
/// line each.
pub(crate) fn write(namespaces: &[String], metadata: &[Utf8PathBuf], out: &Utf8Path, command: &str) -> Result<Vec<String>> {
    let index = index(metadata)?;
    std::fs::create_dir_all(out).with_context(|| format!("creating {out}"))?;
    let mut lines = Vec::new();
    for namespace in namespaces {
        let fetch = if namespace.starts_with("Microsoft.") {
            " -- it is the Windows App SDK's, which tooling/windows/fetch-winappsdk.sh fetches"
        } else {
            ""
        };
        anyhow::ensure!(
            index.contains_namespace(namespace),
            "the Windows Runtime metadata in {metadata:?} has no namespace `{namespace}`{fetch}"
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

/// The files whose fingerprints stand for the metadata in a stamp: one per
/// directory, the contract or package that holds most of it.
pub(crate) fn metadata_markers(directories: &[Utf8PathBuf]) -> Vec<Utf8PathBuf> {
    directories
        .iter()
        .map(|directory| {
            ["Windows.Foundation.UniversalApiContract.winmd", "Microsoft.UI.Xaml.winmd"]
                .iter()
                .map(|marker| directory.join(marker))
                .find(|marker| marker.is_file())
                .unwrap_or_else(|| directory.clone())
        })
        .collect()
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
        spelled: std::collections::BTreeMap::new(),
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
            TypeCategory::Struct => writer.structure(*def, &mut body),
            TypeCategory::Delegate => writer.refuse(name, "a delegate"),
            TypeCategory::Attribute => {}
        }
    }
    let mut text = String::new();
    let _ = writeln!(text, "// Generated by `{command}` from the Windows Runtime's metadata");
    if namespace.starts_with("Microsoft.") {
        let _ = writeln!(text, "// (Microsoft.WindowsAppSDK {WINAPPSDK_VERSION}: {WINAPPSDK_PACKAGES}). Edit the command, not this file.");
    } else {
        let _ = writeln!(text, "// (Microsoft.Windows.SDK.Contracts {WINRT_METADATA_VERSION}). Edit the command, not this file.");
    }
    let _ = writeln!(text, "//");
    let _ = writeln!(text, "// Each method is the slot of its interface's table the metadata gives it, named");
    let _ = writeln!(text, "// as the metadata names that slot; the compiler refuses the two disagreeing.");
    let _ = writeln!(text, "declare module \"winrt:{namespace}\" {{");
    let c_types: Vec<&str> =
        writer.brands.iter().copied().filter(|brand| brand.starts_with("c_") || matches!(*brand, "CEnum" | "CNumber" | "Struct" | "ByValue" | "Counted" | "CBytes")).collect();
    if !c_types.is_empty() {
        let _ = writeln!(text, "  import type {{ {} }} from \"c:types\";", c_types.join(", "));
    }
    let winrt: Vec<&str> = writer.brands.iter().copied().filter(|brand| matches!(*brand, "ComClass" | "HString" | "IInspectable" | "Delegate" | "EventRegistrationToken")).collect();
    if !winrt.is_empty() {
        let _ = writeln!(text, "  import type {{ {} }} from \"winrt:types\";", winrt.join(", "));
    }
    for (other, names) in writer.references.iter().filter(|(other, _)| other.as_str() != namespace) {
        let names: Vec<String> = names
            .iter()
            .map(|name| match writer.spelled.get(&(other.clone(), name.clone())) {
                Some(spelled) if spelled != name => format!("{name} as {spelled}"),
                _ => name.clone(),
            })
            .collect();
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
    /// How this module spells each type another namespace declares: its own
    /// name, or -- where that name is also declared here or imported from a
    /// third namespace -- the namespace's path in front of it, imported `as`
    /// that. Decided at the first reference and kept, so every reference to
    /// one type reads the same.
    spelled: std::collections::BTreeMap<(String, String), String>,
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
        // The interfaces this one requires, which every object implementing
        // it answers: `reference.as_IClosable()`. A generic interface's
        // depend on its parameters, whose IIDs are not known here.
        if self.generics.is_empty() {
            let required: Vec<Type> = def.interface_impls().map(|implemented| implemented.interface(&[])).collect();
            methods.push_str(&self.queries(name, &this, &required));
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

    /// `as_X()` for each of `interfaces` that `this` answers by
    /// `QueryInterface`: `list.as_IVector()` is a `JsonArray` as its
    /// `IVector<IJsonValue>`, whose table is the object's own. An
    /// instantiation's IID is computed. `owner` names what is refused.
    fn queries(&mut self, owner: &str, this: &str, interfaces: &[Type]) -> String {
        let mut queries = String::new();
        let mut asked: BTreeSet<String> = BTreeSet::new();
        for interface in interfaces {
            let Type::ClassName(named) = interface else { continue };
            let base = generic_base(&named.name).to_owned();
            let spelled = match self.spell(interface, false).and_then(|spelled| Ok((spelled, self.interface_iid(interface)?))) {
                Ok(spelled) => spelled,
                Err(why) => {
                    self.refuse(&format!("{owner} as {base}"), &why);
                    continue;
                }
            };
            let (spelled, iid) = spelled;
            let mut method = format!("as_{base}");
            let mut again = 2;
            while !asked.insert(method.clone()) {
                method = format!("as_{base}{again}");
                again += 1;
            }
            let _ = writeln!(queries, "    /**\n     * @ntsQuery {iid}\n     */");
            let _ = writeln!(queries, "    {method}(this: {this}): {spelled};");
        }
        queries
    }

    /// `JsonValue`: its default interface, and its statics in a namespace of
    /// the same name.
    fn class(&mut self, def: TypeDef, body: &mut String) -> bool {
        let name = def.name();
        let default = def.interface_impls().find(|implemented| implemented.has_attribute("DefaultAttribute"));
        // An instantiation as any other type is (`UIElementCollection` is
        // `IVector<UIElement>`), its imports with it.
        let spelled = match default.map(|implemented| implemented.interface(&[])) {
            Some(interface @ Type::ClassName(_)) => match self.spell(&interface, false) {
                Ok(spelled) => spelled,
                Err(why) => {
                    self.refuse(name, &format!("a runtime class whose default interface is {why}"));
                    return false;
                }
            },
            Some(_) => {
                self.refuse(name, "a runtime class whose default interface is not an interface");
                return false;
            }
            // A static-only class (`Windows.Globalization.ApplicationLanguages`)
            // has no instances, only its namespace of statics.
            None => String::new(),
        };
        let class_name = format!("{}.{name}", self.namespace);
        let mut statics = String::new();
        // A default constructor, `PropertySet.create()`: activated, then
        // answered as the default interface.
        let constructible = def.attributes().any(|attribute| {
            attribute.ctor().parent().name() == "ActivatableAttribute"
                && !matches!(attribute.value().into_iter().next(), Some((_, Value::TypeName(_))))
        });
        if constructible
            && let Some(Type::ClassName(interface)) = default.map(|implemented| implemented.interface(&[]))
            && let Ok(default_iid) = self.interface_iid(&Type::ClassName(interface))
        {
            let _ = writeln!(statics, "    /**\n     * @ntsActivate {class_name} {default_iid}\n     */");
            let _ = writeln!(statics, "    function create(): {name};");
            self.methods += 1;
        }
        // Statics, and constructors that take arguments: both are methods of
        // an interface the class's factory answers as.
        for attribute in def.attributes().filter(|attribute| {
            matches!(attribute.ctor().parent().name(), "StaticAttribute" | "ActivatableAttribute" | "ComposableAttribute")
        }) {
            let values: Vec<Value> = attribute.value().into_iter().map(|(_, value)| value).collect();
            let Some(Value::TypeName(interface)) = values.first() else { continue };
            // A composable class's factory: `CreateInstance(..., outer, out
            // inner)`, which a subclass calls with itself as the outer object.
            // Only a public one constructs the class as it is; a protected one
            // is for subclasses alone.
            let composable = attribute.ctor().parent().name() == "ComposableAttribute";
            // `CompositionType.Public` is 2.
            if composable && !matches!(values.get(1), Some(Value::EnumValue(_, public)) if **public == Value::I32(2)) {
                continue;
            }
            let Some(statics_def) = self.index.get(&interface.namespace, &interface.name).next() else {
                self.refuse(&format!("{name} statics"), &format!("`{}` is not in the metadata read", interface.name));
                continue;
            };
            let Some(iid) = iid(statics_def) else { continue };
            for (index, method) in statics_def.methods().enumerate() {
                let receiver = if composable {
                    Receiver::Composable { class: &class_name, iid: &iid }
                } else {
                    Receiver::Factory { class: &class_name, iid: &iid }
                };
                match self.method(method, 6 + index, receiver) {
                    Ok(text) => {
                        statics.push_str(&text);
                        self.methods += 1;
                    }
                    Err(why) => self.refuse(&format!("{name}.{}", method_name(method)), &why),
                }
            }
        }
        // The class's other interfaces, each reached by `QueryInterface`, and
        // every interface of each class it derives from: a `Button` is its
        // `ButtonBase`'s `IButtonBase`, its `UIElement`'s `IUIElement`. Not
        // the protected and overridable ones, which are a subclass's contract
        // with its base rather than what the object answers to anyone.
        let public = |implemented: &windows_metadata::reader::InterfaceImpl| {
            !implemented.has_attribute("ProtectedAttribute") && !implemented.has_attribute("OverridableAttribute")
        };
        let mut others: Vec<Type> = def
            .interface_impls()
            .filter(|implemented| !implemented.has_attribute("DefaultAttribute") && public(implemented))
            .map(|implemented| implemented.interface(&[]))
            .collect();
        let mut base = def.extends();
        let mut depth = 0;
        while let Some(parent) = base.and_then(|parent| self.index.get(parent.namespace(), parent.name()).next()) {
            if parent.category() != TypeCategory::Class || depth > 16 {
                break;
            }
            others.extend(parent.interface_impls().filter(public).map(|implemented| implemented.interface(&[])));
            base = parent.extends();
            depth += 1;
        }
        let queries = self.queries(name, name, &others);
        if !queries.is_empty() {
            let _ = writeln!(body, "  export interface {name}Interfaces {{");
            body.push_str(&queries);
            let _ = writeln!(body, "  }}");
        }
        if !spelled.is_empty() {
            if queries.is_empty() {
                let _ = writeln!(body, "  export type {name} = {spelled};");
            } else {
                let _ = writeln!(body, "  export type {name} = {spelled} & {name}Interfaces;");
            }
        }
        if !statics.is_empty() {
            let _ = writeln!(body, "  export namespace {name} {{");
            body.push_str(&statics);
            let _ = writeln!(body, "  }}");
        }
        !spelled.is_empty() || !statics.is_empty()
    }

    /// `Point`: a `Struct` of its fields in the metadata's order, tagged with
    /// the C name the compiler defines it by -- nothing declares a Windows
    /// Runtime struct in a C header -- with the namespace kept, as an
    /// interface's tag keeps it. What a field cannot be yet refuses the struct.
    fn structure(&mut self, def: TypeDef, body: &mut String) {
        let name = def.name();
        // One `int64`, spelled as the integer it is passed as (`winrt:types`).
        if def.namespace() == "Windows.Foundation" && name == "EventRegistrationToken" {
            return;
        }
        // An API contract is described as a struct with no fields, and is no
        // type a program holds.
        if def.fields().next().is_none() {
            return;
        }
        if let Some(why) = self.struct_refusal(def, 0) {
            self.refuse(name, &why);
            return;
        }
        let mut fields = Vec::new();
        for field in def.fields() {
            match self.field(&field.ty()) {
                Ok(spelled) => fields.push(format!("{}: {spelled}", field.name())),
                Err(why) => {
                    self.refuse(name, &format!("a struct with a field `{}` that is {why}", field.name()));
                    return;
                }
            }
        }
        self.brands.insert("Struct");
        let tag = format!("{}_{name}", self.namespace.replace('.', "_"));
        let _ = writeln!(body, "  export type {name} = Struct<{{ {} }}, \"{tag}\">;", fields.join("; "));
    }

    /// Why `structure` refuses a struct, if it does: a field that is not a C
    /// scalar, an enum, or a struct it does not refuse. Asked of every
    /// reference too, so that nothing names a struct that is not declared.
    fn struct_refusal(&self, def: TypeDef, depth: u32) -> Option<String> {
        for field in def.fields() {
            let ty = field.ty();
            let why = match &ty {
                Type::I8 | Type::U8 | Type::I16 | Type::U16 | Type::Char | Type::I32 | Type::U32 | Type::I64 | Type::U64 | Type::F32 | Type::F64 => None,
                Type::ValueName(named) => match self.find(&named.namespace, &named.name) {
                    Ok(inner) if inner.category() == TypeCategory::Enum => None,
                    // A struct holds its structs, so the graph has no cycle;
                    // the bound is against a malformed file.
                    Ok(inner) if inner.category() == TypeCategory::Struct && depth < 8 => self.struct_refusal(inner, depth + 1),
                    Ok(_) => Some(format!("`{}`", named.name)),
                    Err(why) => Some(why),
                },
                Type::Bool => Some("a `boolean`".to_owned()),
                Type::String => Some("a string".to_owned()),
                other => Some(format!("{other:?}")),
            };
            if let Some(why) = why {
                return Some(format!("a struct with a field `{}` that is {why}", field.name()));
            }
        }
        None
    }

    /// A struct field's type: a C scalar, an enum, or another struct, held
    /// inside the record rather than pointed at.
    fn field(&mut self, ty: &Type) -> Result<String, String> {
        let brand = |brand: &'static str, writer: &mut Self| {
            writer.brands.insert(brand);
            Ok(brand.to_owned())
        };
        match ty {
            Type::I8 => brand("c_int8", self),
            Type::U8 => brand("c_uint8", self),
            Type::I16 => brand("c_int16", self),
            Type::U16 | Type::Char => brand("c_uint16", self),
            Type::I32 => brand("c_int32", self),
            Type::U32 => brand("c_uint32", self),
            Type::I64 => brand("c_int64", self),
            Type::U64 => brand("c_uint64", self),
            Type::F32 => brand("c_float", self),
            Type::F64 => brand("c_double", self),
            Type::ValueName(named) => {
                let def = self.find(&named.namespace, &named.name).map_err(|_| format!("`{}`, not in the metadata read", named.name))?;
                match def.category() {
                    TypeCategory::Enum => {
                        let underlying = if matches!(def.underlying_type(), Some(Type::U32)) { "c_uint32" } else { "c_int32" };
                        let enumeration = self.named(&named.namespace, &named.name);
                        self.brands.insert("CEnum");
                        self.brands.insert(underlying);
                        Ok(format!("CEnum<{enumeration}, {underlying}>"))
                    }
                    TypeCategory::Struct => match self.struct_refusal(def, 0) {
                        None => Ok(self.named(&named.namespace, &named.name)),
                        Some(why) => Err(why),
                    },
                    other => Err(format!("a {other:?}")),
                }
            }
            Type::Bool => Err("a `boolean`".to_owned()),
            Type::String => Err("a string".to_owned()),
            other => Err(format!("{other:?}")),
        }
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
        let out = |at: usize| named.params().get(at).copied().flatten().is_some_and(|row| row.flags().contains(windows_metadata::ParamAttributes::Out));
        let count = signature.types.len();
        let composed = count >= 2
            && matches!(signature.types[count - 2], Type::Object)
            && matches!(&signature.types[count - 1], Type::Object | Type::RefMut(_) if match &signature.types[count - 1] { Type::RefMut(inner) => matches!(**inner, Type::Object), _ => true })
            && !out(count - 2)
            && out(count - 1);
        let declared = if matches!(receiver, Receiver::Composable { .. }) {
            if !composed {
                return Err("a composable factory method not ending in the outer and inner objects".to_owned());
            }
            count - 2
        } else if composed && matches!(receiver, Receiver::Instance(_)) {
            // A factory interface's own method, which the class it makes
            // calls as its constructor (`Receiver::Composable`): as an
            // interface method it would hand the program an inner object.
            return Err("a composable factory method, called as its class's constructor".to_owned());
        } else {
            count
        };
        let mut parameters: Vec<String> = Vec::new();
        if let Receiver::Instance(this) = receiver {
            parameters.push(format!("this: {this}"));
        }
        // `[out]` parameters are the result's fields, as the Windows
        // Runtime's JavaScript projection returned them: `TryParse(input)`
        // answers `{ result: JsonValue; returnValue: boolean }`. They follow
        // every `[in]` one, which is where C takes them too.
        let mut outs: Vec<String> = Vec::new();
        // Arrays lent for the call, which the Windows Runtime's ABI forbids
        // the callee to keep: it copies what it needs before it returns.
        let mut lent: Vec<String> = Vec::new();
        for (at, ty) in signature.types.iter().enumerate().take(declared) {
            let row = named.params().get(at).copied().flatten();
            let name = row.map_or_else(|| format!("param{at}"), |row| safe(row.name()));
            // Bytes: a `Uint8Array` borrowed in place, its length the
            // `UINT32` C takes before it. An `[in]` array is read (`const`); an
            // `[out]` one the caller allocates, and the callee fills it where
            // it is -- so it is an argument too, the program's buffer.
            if let Type::Array(element) = ty
                && matches!(**element, Type::U8)
            {
                if !outs.is_empty() {
                    return Err("an `in` parameter after an `out` one".to_owned());
                }
                for brand in ["Counted", "CBytes", "CNumber"] {
                    self.brands.insert(brand);
                }
                let pointee = if out(at) { "uint8_t" } else { "const uint8_t" };
                parameters.push(format!("{name}: Counted<CBytes<\"{pointee}\">, CNumber<\"uint32\">, \"before\">"));
                lent.push(name);
                continue;
            }
            if out(at) {
                let written = match ty {
                    Type::RefMut(written) => written,
                    // `GetMany`'s buffer, which the caller allocates and the
                    // callee fills.
                    Type::Array(_) => return Err("an array".to_owned()),
                    _ => return Err("an `out` parameter not written through a pointer".to_owned()),
                };
                if let Type::ValueName(value) = &**written
                    && self.index.get(&value.namespace, &value.name).next().is_some_and(|def| def.category() == TypeCategory::Struct)
                {
                    return Err("a struct `out` parameter".to_owned());
                }
                if name == "returnValue" {
                    return Err("an `out` parameter named `returnValue`".to_owned());
                }
                // An object may be null where the method wrote none: a failed
                // `TryParse`'s `result`.
                let spelled = self.spell(written, false)?;
                outs.push(if matches!(**written, Type::Object | Type::ClassName(_)) {
                    format!("{name}: {spelled} | null")
                } else {
                    format!("{name}: {spelled}")
                });
            } else if !outs.is_empty() {
                return Err("an `in` parameter after an `out` one".to_owned());
            } else {
                parameters.push(format!("{name}: {}", self.spell(ty, true)?));
            }
        }
        let result = match &signature.return_type {
            Type::Void if outs.is_empty() => "void".to_owned(),
            Type::Void => format!("{{ {} }}", outs.join("; ")),
            other if outs.is_empty() => self.spell(other, false)?,
            other => format!("{{ {}; returnValue: {} }}", outs.join("; "), self.spell(other, false)?),
        };
        let mut text = String::new();
        let _ = writeln!(text, "    /**");
        let _ = writeln!(text, "     * @ntsVtable {slot} {}", method_name(method));
        for name in &lent {
            let _ = writeln!(text, "     * @ntsNoEscape {name}");
        }
        match receiver {
            Receiver::Composable { class, iid } => {
                let _ = writeln!(text, "     * @ntsHresult composable");
                let _ = writeln!(text, "     * @ntsFactory {class} {iid}");
            }
            Receiver::Factory { class, iid } => {
                let _ = writeln!(text, "     * @ntsHresult{}", if outs.is_empty() { "" } else { " out" });
                let _ = writeln!(text, "     * @ntsFactory {class} {iid}");
            }
            Receiver::Instance(_) if !outs.is_empty() => {
                let _ = writeln!(text, "     * @ntsHresult out");
            }
            Receiver::Instance(_) => {
                let _ = writeln!(text, "     * @ntsHresult");
            }
        }
        let _ = writeln!(text, "     */");
        let keyword = if matches!(receiver, Receiver::Instance(_)) { "" } else { "function " };
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
                    return self.delegate(ty, def, argument);
                }
                // A class `class` refuses is not declared, so nothing may
                // name it: one whose default interface does not spell.
                if def.category() == TypeCategory::Class
                    && let Some(interface @ Type::ClassName(_)) = def
                        .interface_impls()
                        .find(|implemented| implemented.has_attribute("DefaultAttribute"))
                        .map(|implemented| implemented.interface(&[]))
                    && let Err(why) = self.spell(&interface, false)
                {
                    return Err(format!("`{}`, a runtime class whose default interface is {why}", name.name));
                }
                // A class where one is taken is its default interface, which is
                // what the ABI passes: so an instance of it, or of a class
                // derived from it once asked as that interface
                // (`button.as_IUIElement()`), is accepted.
                if argument
                    && def.category() == TypeCategory::Class
                    && let Some(interface @ Type::ClassName(_)) = def
                        .interface_impls()
                        .find(|implemented| implemented.has_attribute("DefaultAttribute"))
                        .map(|implemented| implemented.interface(&[]))
                {
                    return Ok(format!("{} | null", self.spell(&interface, false)?));
                }
                let base = self.named(&name.namespace, generic_base(&name.name));
                // An instantiation, `IVectorView<HString>`: each argument as
                // it is inside the type, which is never `null`.
                let spelled = if name.generics.is_empty() {
                    base
                } else {
                    let arguments = name.generics.iter().map(|argument| self.type_argument(argument)).collect::<Result<Vec<_>, _>>()?;
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
                // One `int64`, passed as the integer is (`winrt:types`).
                if name.namespace == "Windows.Foundation" && name.name == "EventRegistrationToken" {
                    self.brands.insert("EventRegistrationToken");
                    return Ok("EventRegistrationToken".to_owned());
                }
                // A struct crosses by value: the program holds its storage, a
                // `Ptr` to it, and C copies it in or writes it out.
                if def.category() == TypeCategory::Struct {
                    if let Some(why) = self.struct_refusal(def, 0) {
                        return Err(format!("`{}`, {why}", name.name));
                    }
                    let record = self.named(&name.namespace, &name.name);
                    self.brands.insert("ByValue");
                    return Ok(format!("ByValue<{record}>"));
                }
                if def.category() != TypeCategory::Enum {
                    return Err(format!("`{}`, a {:?}", name.name, def.category()));
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
            // Any object: `IInspectable`, which is what the ABI passes.
            Type::Object => {
                self.brands.insert("IInspectable");
                Ok(if argument { "IInspectable | null".to_owned() } else { "IInspectable".to_owned() })
            }
            Type::Array(_) => Err("an array".to_owned()),
            Type::RefMut(_) => Err("an `out` parameter".to_owned()),
            other => Err(format!("{other:?}, a type WinRT does not use here")),
        }
    }
}

impl Writer<'_> {
    /// A delegate where a method takes one: `Delegate<(sender: S, args: A) =>
    /// void, "IID">`, the function its `Invoke` calls and the interface the
    /// object is -- an instantiation's computed, as an interface's is.
    ///
    /// Only as an argument: a delegate a method answers is one someone else
    /// made, and calling one is not built. Nor is an `Invoke` taking a string,
    /// which would reach the function as an `HSTRING` the bridge does not
    /// convert.
    fn delegate(&mut self, ty: &Type, def: TypeDef, argument: bool) -> Result<String, String> {
        let Type::ClassName(named) = ty else { return Err("not a delegate".to_owned()) };
        let what = generic_base(&named.name);
        if !argument {
            return Err(format!("`{what}`, a delegate as a result"));
        }
        let invoke = def.methods().find(|method| method.name() == "Invoke").ok_or_else(|| format!("`{what}`, a delegate with no `Invoke`"))?;
        let signature = invoke.signature(&named.generics);
        if !matches!(signature.return_type, Type::Void) {
            return Err(format!("`{what}`, a delegate that returns a value"));
        }
        let rows = invoke.params_by_sequence(signature.types.len()).map_err(|_| format!("`{what}`, whose `Invoke` the metadata numbers wrongly"))?;
        let mut parameters = Vec::new();
        for (at, parameter) in signature.types.iter().enumerate() {
            if matches!(parameter, Type::String) {
                return Err(format!("`{what}`, a delegate taking a string"));
            }
            let name = rows.params().get(at).copied().flatten().map_or_else(|| format!("param{at}"), |row| safe(row.name()));
            parameters.push(format!("{name}: {}", self.spell(parameter, false)?));
        }
        let iid = self.interface_iid(ty)?;
        self.brands.insert("Delegate");
        Ok(format!("Delegate<({}) => void, \"{iid}\">", parameters.join(", ")))
    }

    /// A type argument of an instantiation, `T` in `IVector<T>`: as a value,
    /// except that a class is its default interface -- what the ABI passes
    /// either way, and a `T` a method takes as well as answers. So
    /// `IVector<ResourceDictionary>.Append` takes an `IResourceDictionary`,
    /// which a derived class asked as that interface is.
    fn type_argument(&mut self, ty: &Type) -> Result<String, String> {
        if let Type::ClassName(named) = ty
            && named.generics.is_empty()
            && let Ok(def) = self.find(&named.namespace, &named.name)
            && def.category() == TypeCategory::Class
            && let Some(Type::ClassName(interface)) = def
                .interface_impls()
                .find(|implemented| implemented.has_attribute("DefaultAttribute"))
                .map(|implemented| implemented.interface(&[]))
            && interface.generics.is_empty()
        {
            return Ok(self.named(&interface.namespace, &interface.name));
        }
        self.spell(ty, false)
    }

    /// The IID of an interface or an instantiation of one: the metadata's
    /// `GuidAttribute`, or the Windows Runtime's hash of the instantiation's
    /// signature (`iid::parameterized`).
    fn interface_iid(&self, ty: &Type) -> Result<String, String> {
        let Type::ClassName(named) = ty else { return Err("not an interface".to_owned()) };
        if named.generics.is_empty() {
            let def = self.find(&named.namespace, &named.name)?;
            return iid(def).ok_or_else(|| format!("`{}`, an interface with no GuidAttribute", named.name));
        }
        Ok(super::iid::parameterized(&self.signature(ty)?))
    }

    /// A type's signature as a parameterized IID is computed from it:
    /// `pinterface({faa585ea-6214-4217-afda-7f46de5869b3};string)`.
    fn signature(&self, ty: &Type) -> Result<String, String> {
        Ok(match ty {
            Type::Bool => "b1".to_owned(),
            Type::Char => "c2".to_owned(),
            Type::I8 => "i1".to_owned(),
            Type::U8 => "u1".to_owned(),
            Type::I16 => "i2".to_owned(),
            Type::U16 => "u2".to_owned(),
            Type::I32 => "i4".to_owned(),
            Type::U32 => "u4".to_owned(),
            Type::I64 => "i8".to_owned(),
            Type::U64 => "u8".to_owned(),
            Type::F32 => "f4".to_owned(),
            Type::F64 => "f8".to_owned(),
            Type::String => "string".to_owned(),
            Type::Object => "cinterface(IInspectable)".to_owned(),
            Type::ValueName(named) if named.namespace == "System" && named.name == "Guid" => "g16".to_owned(),
            Type::ValueName(named) => {
                let def = self.find(&named.namespace, &named.name)?;
                if def.category() == TypeCategory::Enum {
                    let underlying = if matches!(def.underlying_type(), Some(Type::U32)) { "u4" } else { "i4" };
                    format!("enum({}.{};{underlying})", named.namespace, named.name)
                } else {
                    let fields: Vec<String> =
                        def.fields().map(|field| self.signature(&field.ty())).collect::<Result<_, _>>()?;
                    format!("struct({}.{};{})", named.namespace, named.name, fields.join(";"))
                }
            }
            Type::ClassName(named) => {
                let def = self.find(&named.namespace, &named.name)?;
                let own = || iid(def).map(|iid| format!("{{{}}}", iid.to_lowercase())).ok_or_else(|| format!("`{}` has no IID", named.name));
                if named.generics.is_empty() {
                    match def.category() {
                        TypeCategory::Interface => own()?,
                        TypeCategory::Delegate => format!("delegate({})", own()?),
                        TypeCategory::Class => {
                            let default = def
                                .interface_impls()
                                .find(|implemented| implemented.has_attribute("DefaultAttribute"))
                                .ok_or_else(|| format!("`{}`, a class with no default interface", named.name))?;
                            format!("rc({}.{};{})", named.namespace, named.name, self.signature(&default.interface(&[]))?)
                        }
                        _ => return Err(format!("`{}`, which has no signature", named.name)),
                    }
                } else {
                    let arguments: Vec<String> = named.generics.iter().map(|argument| self.signature(argument)).collect::<Result<_, _>>()?;
                    format!("pinterface({};{})", own()?, arguments.join(";"))
                }
            }
            other => return Err(format!("{other:?}, which has no signature")),
        })
    }

    fn find(&self, namespace: &str, name: &str) -> Result<TypeDef<'_>, String> {
        self.index.get(namespace, generic_base(name)).next().ok_or_else(|| format!("`{name}`, not in the metadata read"))
    }

    /// A type's name as this module spells it: its own, imported from the
    /// module of the namespace declaring it when that is another.
    fn named(&mut self, namespace: &str, name: &str) -> String {
        self.references.entry(namespace.to_owned()).or_default().insert(name.to_owned());
        if namespace == self.namespace {
            return name.to_owned();
        }
        let key = (namespace.to_owned(), name.to_owned());
        if let Some(spelled) = self.spelled.get(&key) {
            return spelled.clone();
        }
        // `Microsoft.UI.Xaml.LaunchActivatedEventArgs` beside
        // `Windows.ApplicationModel.Activation.LaunchActivatedEventArgs`: one
        // name, two types.
        let declared_here = self.index.get(self.namespace, name).next().is_some();
        let imported_already = self.spelled.iter().any(|((other, taken), spelled)| other != namespace && taken == name && spelled == name);
        let spelled = if declared_here || imported_already { format!("{}_{name}", namespace.replace('.', "_")) } else { name.to_owned() };
        self.spelled.insert(key, spelled.clone());
        spelled
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
    /// A composable class's factory: the method's last two parameters are the
    /// outer object and the inner one it answers, which the compiler supplies
    /// (`@ntsHresult composable`) -- a class constructed as itself has no
    /// outer object, and nothing of the program holds the inner.
    Composable { class: &'a str, iid: &'a str },
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
