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

use std::collections::{BTreeMap, BTreeSet};
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
        // Written where there is one and removed where there is not, so a
        // namespace that stopped declaring a `then` leaves no function behind
        // for a stale `@ntsCall` to find.
        let values_path = out.join(format!("{namespace}.values.ts"));
        match &module.values {
            Some(values) => std::fs::write(&values_path, values).with_context(|| format!("writing {values_path}"))?,
            None if values_path.is_file() => std::fs::remove_file(&values_path).with_context(|| format!("removing {values_path}"))?,
            None => {}
        }
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

/// The brands `c:types` declares, beside its `c_` scalars.
const C_BRANDS: &[&str] = &["CEnum", "CNumber", "Struct", "ByValue", "Fields", "Counted", "CBytes", "CElements", "CHandles", "ConstPtr"];
/// The brands `winrt:types` declares.
const WINRT_BRANDS: &[&str] = &["ComClass", "HString", "Copied", "IInspectable", "Inspectable", "Delegate", "Event", "EventRegistrationToken", "Guid"];

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
    /// The values module beside it, where it declares a `then`: the functions
    /// those `then`s name.
    pub(crate) values: Option<String>,
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
        arguments: None,
        specialized: std::collections::BTreeMap::new(),
        thens: std::collections::BTreeMap::new(),
        refused: Vec::new(),
        methods: 0,
        bases: default_interface_bases(index, namespace),
        other_bases: BTreeMap::new(),
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
            TypeCategory::Delegate => writer.delegate_type(*def, &mut body),
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
        writer.brands.iter().copied().filter(|brand| brand.starts_with("c_") || C_BRANDS.contains(brand)).collect();
    if !c_types.is_empty() {
        let _ = writeln!(text, "  import type {{ {} }} from \"c:types\";", c_types.join(", "));
    }
    let winrt: Vec<&str> = writer.brands.iter().copied().filter(|brand| WINRT_BRANDS.contains(brand)).collect();
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
    for specialized in writer.specialized.values() {
        text.push_str(specialized);
    }
    text.push_str("}\n");
    let values = writer.values(command);
    Module {
        namespace: namespace.to_owned(),
        references: writer.references,
        text,
        values,
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
    /// Each class's default interface in this namespace, by name, and its base
    /// class's default interface, `(namespace, name)`: the interface it
    /// extends, as the class extends its base (`IButton`, `IButtonBase`).
    bases: BTreeMap<String, (String, String)>,
    /// The same for other namespaces, read once each as a chain reaches them.
    other_bases: BTreeMap<String, BTreeMap<String, (String, String)>>,
    references: std::collections::BTreeMap<String, BTreeSet<String>>,
    /// How this module spells each type another namespace declares: its own
    /// name, or -- where that name is also declared here or imported from a
    /// third namespace -- the namespace's path in front of it, imported `as`
    /// that. Decided at the first reference and kept, so every reference to
    /// one type reads the same.
    spelled: std::collections::BTreeMap<(String, String), String>,
    /// The type parameters of the generic interface being written, by name.
    generics: Vec<String>,
    /// The type arguments of the instantiation being specialized, which a
    /// method's signature is read with in place of its parameters.
    arguments: Option<Vec<Type>>,
    /// Each instantiation this module names whose interface has members
    /// that depend on its arguments -- `IAsyncOperation<StorageFile>`'s
    /// `put_Completed`, whose handler's IID is computed from `StorageFile` --
    /// by the name it is declared as here, with the declaration. Empty while
    /// it is being written, which is what its own members naming it find.
    specialized: std::collections::BTreeMap<String, String>,
    /// Each async operation this module declares a `then` for, by its
    /// specialisation's name, with its result as this module spells it --
    /// `None` for an action, which completes with nothing: what the values
    /// module's function for it is written from.
    thens: std::collections::BTreeMap<String, Option<String>>,
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
        // A class's default interface extends its base class's: `IButton` is
        // an `IButtonBase`, whose methods it has and whose place it takes --
        // the compiler asks the object for that interface where it does.
        let base = self.bases.get(name).cloned().map(|(namespace, interface)| self.named(&namespace, &interface));
        // Its base interfaces' methods, flat -- `IButtonBaseMethods &
        // IContentControlMethods & ...` -- rather than the base types, whose
        // chains would intersect and cost the checker a nested intersection
        // per class.
        let mut inherited = Vec::new();
        let mut at = self.bases.get(name).cloned();
        let mut depth = 0;
        while let Some((namespace, interface)) = at.take().filter(|_| depth < 32) {
            inherited.push(self.named(&namespace, &format!("{interface}Methods")));
            at = self.base_of(&namespace, &interface);
            depth += 1;
        }
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
        // it answers: `reference.as_IClosable()`. A generic interface's that
        // are themselves generic depend on its parameters, whose IIDs are not
        // known here; one that is not has its own IID whatever the arguments
        // are -- `IAsyncOperation<T>` answers `IAsyncInfo` -- and is declared.
        {
            // Read with the interface's own parameters in place, which is
            // what an `IIterable<T>` required of `IVector<T>` refers to.
            let own = self.signature_arguments();
            let required: Vec<Type> = def
                .interface_impls()
                .map(|implemented| implemented.interface(&own))
                .filter(|interface| self.generics.is_empty() || matches!(interface, Type::ClassName(named) if named.generics.is_empty()))
                .collect();
            methods.push_str(&self.queries(name, &this, &required));
        }
        // `IAsyncAction` is not generic, so no specialisation declares its
        // `then`: it is declared on the interface itself.
        if self.namespace == "Windows.Foundation" && name == "IAsyncAction" {
            methods.push_str(&self.then_declaration(name, None));
        }
        self.brands.insert("ComClass");
        // A generic interface's IID is its instantiation's, computed where
        // one is specialized; any other's is the interface's own, which its
        // type declares below.
        if !self.generics.is_empty() {
            let _ = writeln!(body, "  /** IID {iid} */");
        }
        let _ = writeln!(body, "  export interface {name}Methods{parameters} {{");
        body.push_str(&methods);
        let _ = writeln!(body, "  }}");
        // A generic interface's idiomatic surface is its own: no class's
        // surface declares it, and an `IVector<T>` -- a panel's children, a
        // list's items -- is its instantiation's table, which no query asks.
        let surface = if self.generics.is_empty() {
            String::new()
        } else {
            let _ = writeln!(body, "  export interface {name}Members{parameters} {{");
            body.push_str(&self.generic_members(def, &this));
            let _ = writeln!(body, "  }}");
            format!(" & {name}Members{parameters}")
        };
        // The tag is the C struct a handle points at, so a C identifier: the
        // namespace kept, since two namespaces may name an interface alike.
        let tag = format!("{}_{name}", self.namespace.replace('.', "_"));
        // The IID the interface is asked for by, which a query, a
        // conversion and an `instanceof` of a class whose default it is ask.
        if self.generics.is_empty() {
            let _ = writeln!(body, "  /**\n   * @ntsQuery {iid}\n   */");
        }
        if let Some(base) = &base {
            let _ = write!(body, "  export type {this} = ComClass<\"{tag}\", {base}> & {name}Methods{parameters}");
            for methods in &inherited {
                let _ = write!(body, " & {methods}");
            }
            let _ = writeln!(body, ";");
        } else {
            // Every Windows Runtime interface is an `IInspectable`, so one
            // with no base class's interface above it has that as its
            // parent: any object goes where any object is taken
            // (`button.content = textBlock`).
            self.brands.insert("IInspectable");
            let _ = writeln!(body, "  export type {this} = ComClass<\"{tag}\", IInspectable> & {name}Methods{parameters}{surface};");
        }
        self.generics.clear();
        true
    }

    /// A generic interface's members as a class's surface declares its own
    /// ([`Self::interface_members`]): a property from each `get_X` and its
    /// `put_X`, each other method under its camelCase name -- on the
    /// interface itself, whose value is the instantiation's table, so none
    /// is asked for. Events are left to its `add_`/`remove_`: their
    /// listener's delegate is itself an instantiation.
    fn generic_members(&mut self, def: TypeDef, this: &str) -> String {
        let methods: Vec<(usize, windows_metadata::reader::MethodDef)> = def.methods().enumerate().map(|(index, method)| (6 + index, method)).collect();
        let slot_of = |wanted: &str| methods.iter().find(|(_, method)| method_name(*method) == wanted).map(|(slot, method)| (*slot, *method));
        let mut out = String::new();
        for &(slot, method) in &methods {
            let abi = method_name(method);
            if abi.starts_with("add_") || abi.starts_with("remove_") || abi.starts_with("put_") {
                continue;
            }
            if let Some(property) = abi.strip_prefix("get_") {
                if let Some(text) = self.property(method, slot, slot_of(&format!("put_{property}")), None) {
                    out.push_str(&text);
                }
                continue;
            }
            let js = nts_core::hir::native::js_name(&abi);
            if let Ok(text) = self.method_named(method, slot, Receiver::Instance(this), Some(&js), None) {
                out.push_str(&text);
            }
        }
        // A vector -- `IVector<T>`, `IVectorView<T>` -- is walked by count, as
        // an array is: `for (const child of panel.children)`; any other
        // iterable by its iterator.
        if let (Some(_), Some((_, at))) = (slot_of("get_Size"), slot_of("GetAt"))
            && let Ok(element) = self.spell(&at.signature(&self.signature_arguments()).return_type, false)
        {
            let _ = writeln!(out, "    /**\n     * @ntsIterate get_Size GetAt\n     */\n    [Symbol.iterator](): Iterator<{element}>;");
        } else if let Some((_, first)) = slot_of("First")
            // Any other iterable -- `IIterable<T>` -- by the iterator its
            // `First` makes: `get_Current`, then `MoveNext`, as C# walks one.
            && let Type::ClassName(iterator) = first.signature(&self.signature_arguments()).return_type
            && let Some(element) = iterator.generics.first()
            && let Ok(element) = self.spell(element, false)
        {
            let _ = writeln!(out, "    /**\n     * @ntsIterate First\n     */\n    [Symbol.iterator](): Iterator<{element}>;");
        }
        out
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
    /// The base default interface of the default interface `interface` in
    /// `namespace`: one step of the chain [`Self::bases`] holds the first of.
    fn base_of(&mut self, namespace: &str, interface: &str) -> Option<(String, String)> {
        if namespace == self.namespace {
            return self.bases.get(interface).cloned();
        }
        let index = self.index;
        self.other_bases.entry(namespace.to_owned()).or_insert_with(|| default_interface_bases(index, namespace)).get(interface).cloned()
    }

    /// A static of a class, and its idiomatic name beside it:
    /// `StorageFolder.GetFolderFromPathAsync` and
    /// `StorageFolder.getFolderFromPathAsync`, one slot.
    fn static_member(&mut self, class: &str, method: windows_metadata::reader::MethodDef, slot: usize, receiver: Receiver<'_>, statics: &mut String) {
        match self.method(method, slot, receiver) {
            Ok(text) => {
                statics.push_str(&text);
                self.methods += 1;
                let js = nts_core::hir::native::js_name(&method_name(method));
                if js != method_name(method)
                    && let Ok(alias) = self.method_named(method, slot, receiver, Some(&js), None)
                {
                    statics.push_str(&alias);
                }
            }
            Err(why) => self.refuse(&format!("{class}.{}", method_name(method)), &why),
        }
    }

    /// A class's static property, from its statics' `get_X` and `put_X`: a
    /// variable of the class's namespace, read and written through the
    /// factory's slots (`@ntsGet`, `@ntsSet`, `@ntsFactory`) -- `let` where
    /// the setter takes what the getter answers, `const` where there is no
    /// setter or it takes another type, which its `put_X()` still writes.
    /// `None` for one whose type this cannot spell.
    fn static_property(
        &mut self,
        getter: windows_metadata::reader::MethodDef,
        get_slot: usize,
        setter: Option<(usize, windows_metadata::reader::MethodDef)>,
        factory: &str,
    ) -> Option<String> {
        let read = getter.signature(&[]);
        if !read.types.is_empty() {
            return None;
        }
        let answered = self.answered(&read.return_type).ok()?;
        let writable = setter.and_then(|(slot, put)| {
            let written = put.signature(&[]);
            let [ty] = written.types.as_slice() else { return None };
            (self.spell(ty, true).ok()? == answered).then_some(slot)
        });
        let property = method_name(getter);
        let property = property.strip_prefix("get_")?.to_owned();
        let name = nts_core::hir::native::js_name(&property);
        if is_reserved(&name) {
            return None;
        }
        let mut text = format!("    /**\n     * @ntsGet {get_slot} get_{property}\n");
        if let Some(slot) = writable {
            let _ = writeln!(text, "     * @ntsSet {slot} put_{property}");
        }
        let _ = writeln!(text, "     * @ntsFactory {factory}\n     */");
        let keyword = if writable.is_some() { "let" } else { "const" };
        let _ = writeln!(text, "    {keyword} {name}: {answered};");
        Some(text)
    }

    /// The idiomatic surface of a class, as the Windows Runtime's JavaScript
    /// projection wrote it: `{Class}Members`, extending its base class's, with
    /// every member of the interfaces the class itself declares in camelCase
    /// -- a `get_X`/`put_X` pair as the property `x` (`button.content`),
    /// read-only without a setter, each other method under its camelCase name.
    /// Declared once, on the class that implements the interface, and
    /// inherited, as C#'s projection inherits them: every class repeating
    /// every base's members made winui-hello's bindings 2.6 times the size and
    /// its build 17 s longer.
    ///
    /// Each is called through its interface (`@ntsVia`), since a subclass's
    /// instance is not that interface; a member of the class's default
    /// interface names that interface's handle tag too (`@ntsVia <IID>
    /// Microsoft_UI_Xaml_Controls_IButton`), so a receiver whose handle is
    /// that interface -- the class's own instance, or one of a class the
    /// program writes over it -- is not asked again. The ABI's own names stay on each interface, reached by
    /// `as_I…()`.
    ///
    /// Events follow as the DOM declares them: a `{Class}EventMap` extending
    /// its base's, and `addEventListener` over it where the class raises
    /// events of its own.
    ///
    /// Not yet: generic interfaces (`IVector<T>`). A name two interfaces give
    /// is left out and reported, not given to whichever came first.
    fn members(&mut self, class: &str, def: TypeDef, default: Option<&Type>) -> String {
        let mut declared: BTreeMap<String, usize> = BTreeMap::new();
        let mut texts: Vec<(String, String)> = Vec::new();
        let mut raised: BTreeMap<String, usize> = BTreeMap::new();
        let mut events: Vec<(String, String)> = Vec::new();
        let own = def
            .interface_impls()
            .filter(|implemented| !implemented.has_attribute("ProtectedAttribute") && !implemented.has_attribute("OverridableAttribute"))
            .filter(|implemented| !implemented.has_attribute("DefaultAttribute"))
            .map(|implemented| implemented.interface(&[]));
        for (interface, is_default) in default.cloned().map(|ty| (ty, true)).into_iter().chain(own.map(|ty| (ty, false))) {
            let Type::ClassName(named) = &interface else { continue };
            if !named.generics.is_empty() {
                continue;
            }
            let Some(interface_def) = self.index.get(&named.namespace, &named.name).next() else { continue };
            let Some(iid) = iid(interface_def) else { continue };
            // The default interface's handle tag, which an instance of the
            // class -- or of a class the program writes over it -- carries.
            let via = if is_default { format!("{iid} {}_{}", named.namespace.replace('.', "_"), named.name) } else { iid };
            for (name, text) in self.interface_members(interface_def, &via) {
                *declared.entry(name.clone()).or_default() += 1;
                texts.push((name, text));
            }
            for (name, text) in self.interface_events(interface_def) {
                *raised.entry(name.clone()).or_default() += 1;
                events.push((name, text));
            }
        }
        let base = def
            .extends()
            .filter(|base| self.index.get(base.namespace(), base.name()).next().is_some_and(|parent| parent.category() == TypeCategory::Class))
            .map(|base| {
                // The class itself too, so that a namespace bound only for the
                // names it is asked for declares the base -- and its surface --
                // this one extends.
                self.named(base.namespace(), base.name());
                let events = self.named(base.namespace(), &format!("{}EventMap", base.name()));
                (self.named(base.namespace(), &format!("{}Members", base.name())), events)
            });
        // A name a base's surface gives already: C# hides the base's member
        // behind the class's (`new`), and TypeScript's `extends` refuses the
        // two when their types differ, so the base's stands and the class's
        // is reached through its interface.
        let inherited = self.inherited_member_names(def);
        for name in declared.keys() {
            if inherited.contains(name) {
                self.refuse(&format!("{class}.{name}"), "an idiomatic name a base class's surface declares already; reached through its interface");
            }
        }
        declared.retain(|name, _| !inherited.contains(name));
        let inherited = self.inherited_event_names(def);
        for (name, count) in &raised {
            if inherited.contains(name) {
                self.refuse(&format!("{class}.{name}"), "an event a base class raises already; added through its interface's `add_`");
            } else if *count > 1 {
                self.refuse(&format!("{class}.{name}"), "an event two of the class's interfaces raise; each is added through its interface's `add_`");
            }
        }
        raised.retain(|name, count| *count == 1 && !inherited.contains(name));
        let mut out = String::new();
        let (members_base, events_base) = base.unzip();
        let extends = members_base.map(|base| format!(" extends {base}")).unwrap_or_default();
        let _ = writeln!(out, "  export interface {class}Members{extends} {{");
        for (name, text) in texts {
            if declared.get(&name) == Some(&1) {
                out.push_str(&text);
            }
        }
        // `addEventListener` over the events the class raises and those its
        // bases do: declared where a class adds events of its own, and
        // inherited where it adds none.
        if !raised.is_empty() {
            for direction in ["add", "remove"] {
                let _ = writeln!(
                    out,
                    "    /**\n     * @ntsListener {direction}\n     */\n    {direction}EventListener<K extends keyof {class}EventMap>(type: K, listener: {class}EventMap[K]): void;"
                );
            }
        }
        let _ = writeln!(out, "  }}");
        for (name, count) in declared {
            if count > 1 {
                self.refuse(&format!("{class}.{name}"), "an idiomatic name two of the class's interfaces give; each is reached through its interface");
            }
        }
        // The events, by the name `addEventListener` takes -- the metadata's,
        // lower-cased, as the Windows Runtime's JavaScript projection named
        // them (`click`, `pointerentered`) -- each the listener it takes.
        let extends = events_base.map(|base| format!(" extends {base}")).unwrap_or_default();
        let _ = writeln!(out, "  export interface {class}EventMap{extends} {{");
        for (name, text) in events {
            if raised.contains_key(&name) {
                out.push_str(&text);
            }
        }
        let _ = writeln!(out, "  }}");
        out
    }

    /// The events of one interface, as [`Self::members`] maps them: `(name,
    /// text)` for each `add_X` with its `remove_X`, whose listener is its
    /// `add_`'s delegate as an `Event` (`winrt:types`) naming the interface
    /// and the two slots, which the runtime calls.
    fn interface_events(&mut self, def: TypeDef) -> Vec<(String, String)> {
        let Some(iid) = iid(def) else { return Vec::new() };
        let methods: Vec<(usize, windows_metadata::reader::MethodDef)> = def.methods().enumerate().map(|(index, method)| (6 + index, method)).collect();
        let mut events = Vec::new();
        for &(add, method) in &methods {
            let abi = method_name(method);
            let Some(event) = abi.strip_prefix("add_") else { continue };
            let Some(remove) = methods.iter().find(|(_, method)| method_name(*method) == format!("remove_{event}")).map(|(slot, _)| *slot) else {
                continue;
            };
            let signature = method.signature(&[]);
            let [handler] = signature.types.as_slice() else { continue };
            let Ok(delegate) = self.spell(handler, true) else { continue };
            let Some(function) = delegate.strip_prefix("Delegate<").and_then(|rest| rest.strip_suffix('>')) else { continue };
            self.brands.insert("Event");
            let name = event.to_lowercase();
            events.push((name.clone(), format!("    {name}: Event<{function}, \"{iid} {add} {remove}\">;\n")));
        }
        events
    }

    /// Every event name the event maps of `def`'s base classes declare.
    fn inherited_event_names(&self, def: TypeDef) -> BTreeSet<String> {
        let mut names = BTreeSet::new();
        let mut base = def.extends();
        for _ in 0..32 {
            let Some(parent) = base.and_then(|parent| self.index.get(parent.namespace(), parent.name()).next()) else { break };
            if parent.category() != TypeCategory::Class {
                break;
            }
            let public = parent
                .interface_impls()
                .filter(|implemented| !implemented.has_attribute("ProtectedAttribute") && !implemented.has_attribute("OverridableAttribute"));
            for implemented in public {
                let Type::ClassName(declared) = implemented.interface(&[]) else { continue };
                let Some(interface) = self.index.get(&declared.namespace, &declared.name).next() else { continue };
                names.extend(interface.methods().filter_map(|method| method_name(method).strip_prefix("add_").map(str::to_lowercase)));
            }
            base = parent.extends();
        }
        names
    }

    /// Every idiomatic name the surfaces of `def`'s base classes declare,
    /// from the interfaces' method names alone -- nothing spelled, so nothing
    /// is imported for it.
    fn inherited_member_names(&self, def: TypeDef) -> BTreeSet<String> {
        let mut names = BTreeSet::new();
        let mut base = def.extends();
        for _ in 0..32 {
            let Some(parent) = base.and_then(|parent| self.index.get(parent.namespace(), parent.name()).next()) else { break };
            if parent.category() != TypeCategory::Class {
                break;
            }
            let public = parent
                .interface_impls()
                .filter(|implemented| !implemented.has_attribute("ProtectedAttribute") && !implemented.has_attribute("OverridableAttribute"));
            for implemented in public {
                let Type::ClassName(declared) = implemented.interface(&[]) else { continue };
                let Some(interface) = self.index.get(&declared.namespace, &declared.name).next() else { continue };
                for method in interface.methods() {
                    let abi = method_name(method);
                    if abi.starts_with("add_") || abi.starts_with("remove_") {
                        continue;
                    }
                    let member = abi.strip_prefix("get_").or_else(|| abi.strip_prefix("put_")).unwrap_or(&abi);
                    names.insert(nts_core::hir::native::js_name(member));
                }
            }
            base = parent.extends();
        }
        names
    }

    /// One interface's members as [`Self::members`] declares them: `(name,
    /// text)` for each property and method it can declare.
    fn interface_members(&mut self, def: TypeDef, via: &str) -> Vec<(String, String)> {
        let methods: Vec<(usize, windows_metadata::reader::MethodDef)> = def.methods().enumerate().map(|(index, method)| (6 + index, method)).collect();
        let slot_of = |wanted: &str| methods.iter().find(|(_, method)| method_name(*method) == wanted).map(|(slot, method)| (*slot, *method));
        let mut members = Vec::new();
        for &(slot, method) in &methods {
            let abi = method_name(method);
            if abi.starts_with("add_") || abi.starts_with("remove_") || abi.starts_with("put_") {
                continue;
            }
            if let Some(property) = abi.strip_prefix("get_") {
                let setter = slot_of(&format!("put_{property}"));
                if let Some(text) = self.property(method, slot, setter, Some(via)) {
                    members.push((nts_core::hir::native::js_name(property), text));
                }
                continue;
            }
            let js = nts_core::hir::native::js_name(&abi);
            if let Ok(text) = self.method_named(method, slot, Receiver::Member, Some(&js), Some(via)) {
                members.push((js, text));
            }
        }
        members
    }

    /// A property from its getter, and its setter where it has one. One
    /// declaration where both spell one type (`width: number`), and a `get`/
    /// `set` pair where they differ -- the getter answering the class it
    /// returns (`get resources(): ResourceDictionary`, with its members), the
    /// setter taking what the ABI passes, which may be `null` (`set
    /// resources(value: IResourceDictionary | null)`). `None` for one whose
    /// type this cannot spell, which the interface's own methods report.
    fn property(
        &mut self,
        getter: windows_metadata::reader::MethodDef,
        get_slot: usize,
        setter: Option<(usize, windows_metadata::reader::MethodDef)>,
        via: Option<&str>,
    ) -> Option<String> {
        let arguments = self.signature_arguments();
        let read = getter.signature(&arguments);
        if !read.types.is_empty() {
            return None;
        }
        let answered = self.answered(&read.return_type).ok()?;
        let taken = match setter {
            Some((_, put)) => {
                let written = put.signature(&arguments);
                let [ty] = written.types.as_slice() else { return None };
                Some(self.spell(ty, true).ok()?)
            }
            None => None,
        };
        let property = method_name(getter);
        let property = property.strip_prefix("get_")?.to_owned();
        let name = nts_core::hir::native::js_name(&property);
        let tags = |lines: &[String]| {
            let mut text = String::from("    /**\n");
            for line in lines {
                let _ = writeln!(text, "     * {line}");
            }
            if let Some(iid) = via {
                let _ = writeln!(text, "     * @ntsVia {iid}");
            }
            text.push_str("     */\n");
            text
        };
        let get_tag = format!("@ntsGet {get_slot} get_{property}");
        Some(match (setter, taken) {
            (Some((set_slot, _)), Some(taken)) if taken == answered => {
                format!("{}    {name}: {answered};\n", tags(&[get_tag, format!("@ntsSet {set_slot} put_{property}")]))
            }
            (Some((set_slot, _)), Some(taken)) => format!(
                "{}    get {name}(): {answered};\n{}    set {name}(value: {taken});\n",
                tags(&[get_tag]),
                tags(&[format!("@ntsSet {set_slot} put_{property}")])
            ),
            _ => format!("{}    readonly {name}: {answered};\n", tags(&[get_tag])),
        })
    }

    /// A class's other interfaces, each reached by `QueryInterface`, and
    /// every interface of each class it derives from: a `Button` is its
    /// `ButtonBase`'s `IButtonBase`, its `UIElement`'s `IUIElement`. Not the
    /// protected and overridable ones, which are a subclass's contract with
    /// its base rather than what the object answers to anyone.
    fn answered_interfaces(&self, def: TypeDef) -> Vec<Type> {
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
        others
    }

    fn class(&mut self, def: TypeDef, body: &mut String) -> bool {
        let name = def.name();
        let default = def.interface_impls().find(|implemented| implemented.has_attribute("DefaultAttribute"));
        // Before anything that can refuse the class: a subclass's surface
        // extends this one whether or not the class itself is declared.
        let default_interface = default.map(|implemented| implemented.interface(&[]));
        let members = self.members(name, def, default_interface.as_ref());
        body.push_str(&members);
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
            let methods: Vec<(usize, windows_metadata::reader::MethodDef)> = statics_def.methods().enumerate().map(|(index, method)| (6 + index, method)).collect();
            for &(slot, method) in &methods {
                let receiver = if composable {
                    Receiver::Composable { class: &class_name, iid: &iid }
                } else {
                    Receiver::Factory { class: &class_name, iid: &iid }
                };
                // A property of the class itself, `ApplicationLanguages.
                // languages`: a variable of its namespace, beside the ABI's
                // `get_Languages()`, and in place of a camelCase alias of it.
                let abi = method_name(method);
                if !composable && (abi.starts_with("get_") || abi.starts_with("put_")) {
                    if let Ok(text) = self.method(method, slot, receiver) {
                        statics.push_str(&text);
                        self.methods += 1;
                    }
                    if let Some(property) = abi.strip_prefix("get_") {
                        let setter = methods.iter().find(|(_, m)| method_name(*m) == format!("put_{property}")).copied();
                        if let Some(text) = self.static_property(method, slot, setter, &format!("{class_name} {iid}")) {
                            statics.push_str(&text);
                        }
                    }
                    continue;
                }
                self.static_member(name, method, slot, receiver, &mut statics);
            }
        }
        let others = self.answered_interfaces(def);
        let queries = self.queries(name, name, &others);

        if !queries.is_empty() {
            let _ = writeln!(body, "  export interface {name}Interfaces {{");
            body.push_str(&queries);
            let _ = writeln!(body, "  }}");
        }
        // A class a program may write a class over (`class App extends
        // Application`): a TypeScript class, so `extends` names a value, with
        // the members a subclass may override, merged with the interface its
        // instances are.
        if !spelled.is_empty()
            && let Some(subclassing) = self.subclassing(def, &class_name)
        {
            body.push_str(&subclassing);
            let interfaces = if queries.is_empty() { String::new() } else { format!(", {name}Interfaces") };
            let _ = writeln!(body, "  export interface {name} extends {spelled}{interfaces}, {name}Members {{}}");
        } else if !spelled.is_empty() {
            let interfaces = if queries.is_empty() { String::new() } else { format!(" & {name}Interfaces") };
            let _ = writeln!(body, "  export type {name} = {spelled}{interfaces} & {name}Members;");
        }
        if !statics.is_empty() {
            let _ = writeln!(body, "  export namespace {name} {{");
            body.push_str(&statics);
            let _ = writeln!(body, "  }}");
        }
        !spelled.is_empty() || !statics.is_empty()
    }

    /// `Point`: a `Struct` of its fields in the metadata's order, camel-cased,
    /// tagged with
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
                // Camel-cased, as the Windows Runtime's JavaScript
                // projection named a struct's fields (`size.width`,
                // `measure({ width: 100, height: 40 })`): nothing but the
                // compiler defines the struct, so the C names are its own.
                Ok(spelled) => fields.push(format!("{}: {spelled}", nts_core::hir::native::js_name(field.name()))),
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
                // A string makes the struct one the program holds as a plain
                // object, copied at the call (`Copied<T>`).
                Type::I8 | Type::U8 | Type::I16 | Type::U16 | Type::Char | Type::I32 | Type::U32 | Type::I64 | Type::U64 | Type::F32 | Type::F64 | Type::String => None,
                Type::ValueName(named) if is_guid(named) => None,
                Type::ValueName(named) => match self.find(&named.namespace, &named.name) {
                    Ok(inner) if inner.category() == TypeCategory::Enum => None,
                    // A struct holds its structs, so the graph has no cycle;
                    // the bound is against a malformed file.
                    Ok(inner) if inner.category() == TypeCategory::Struct && depth < 8 => self.struct_refusal(inner, depth + 1),
                    Ok(_) => Some(format!("`{}`", named.name)),
                    Err(why) => Some(why),
                },
                Type::Bool => Some("a `boolean`".to_owned()),
                other => Some(format!("{other:?}")),
            };
            if let Some(why) = why {
                return Some(format!("a struct with a field `{}` that is {why}", field.name()));
            }
        }
        None
    }

    /// A struct field's type: a C scalar, an enum, a string, or another
    /// struct, held inside the record rather than pointed at.
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
            Type::ValueName(named) if is_guid(named) => {
                self.brands.insert("Guid");
                Ok("Guid".to_owned())
            }
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
            Type::String => {
                self.brands.insert("HString");
                Ok("HString".to_owned())
            }
            other => Err(format!("{other:?}")),
        }
    }

    /// Whether a struct holds a string, itself or in a struct it holds: one
    /// the program holds as a plain object, copied at the call, and never
    /// as storage (`Copied<T>`).
    fn holds_string(&self, def: TypeDef, depth: u32) -> bool {
        def.fields().any(|field| match field.ty() {
            Type::String => true,
            Type::ValueName(named) if !is_guid(&named) => self
                .find(&named.namespace, &named.name)
                .is_ok_and(|inner| inner.category() == TypeCategory::Struct && depth < 8 && self.holds_string(inner, depth + 1)),
            _ => false,
        })
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
        self.method_named(method, slot, receiver, None, None)
    }

    /// The arguments a signature is read with: an instantiation's, or a
    /// generic interface's own parameters, which stand for themselves -- the
    /// signature reads `T` by its index, and is spelled back by name.
    fn signature_arguments(&self) -> Vec<Type> {
        self.arguments.clone().unwrap_or_else(|| {
            self.generics
                .iter()
                .enumerate()
                .map(|(at, name)| Type::Generic(name.clone(), u16::try_from(at).unwrap_or(u16::MAX)))
                .collect()
        })
    }

    /// [`Self::method`], declared under `display` where the idiomatic surface
    /// names it (`getFolderFromPathAsync`), and called through the interface
    /// `via` names where a class declares it from one of its others.
    fn method_named(
        &mut self,
        method: windows_metadata::reader::MethodDef,
        slot: usize,
        receiver: Receiver<'_>,
        display: Option<&str>,
        via: Option<&str>,
    ) -> Result<String, String> {
        let signature = method.signature(&self.signature_arguments());
        let named = method.params_by_sequence(signature.types.len()).map_err(|_| "a method whose parameters the metadata numbers wrongly".to_owned())?;
        let out = |at: usize| named.params().get(at).copied().flatten().is_some_and(|row| row.flags().contains(windows_metadata::ParamAttributes::Out));
        let declared = declared_parameters(&signature.types, out, &receiver)?;
        let mut parameters: Vec<String> = Vec::new();
        if let Receiver::Instance(this) = receiver {
            parameters.push(format!("this: {this}"));
        }
        // `[out]` parameters are the result's fields, as the Windows
        // Runtime's JavaScript projection returned them: `TryParse(input)`
        // answers `{ result: JsonValue; returnValue: boolean }`. They follow
        // every `[in]` one, which is where C takes them too.
        let mut outs: Vec<String> = Vec::new();
        // Arrays and `ref const` structs lent for the call, which the Windows
        // Runtime's ABI forbids the callee to keep: it copies what it needs
        // before it returns.
        let mut lent: Vec<String> = Vec::new();
        for (at, ty) in signature.types.iter().enumerate().take(declared) {
            let row = named.params().get(at).copied().flatten();
            let name = row.map_or_else(|| format!("param{at}"), |row| safe(row.name()));
            // An array lent in place, its `UINT32` count before it.
            if let Type::Array(element) = ty
                && let Some(lent_as) = self.lent_array(element, out(at))?
            {
                if !outs.is_empty() {
                    return Err("an `in` parameter after an `out` one".to_owned());
                }
                parameters.push(format!("{name}: Counted<{lent_as}, CNumber<\"uint32\">, \"before\">"));
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
                if name == "returnValue" {
                    return Err("an `out` parameter named `returnValue`".to_owned());
                }
                if let Some(copied) = self.copied_out(written)? {
                    outs.push(format!("{name}: {copied}"));
                    continue;
                }
                // An object may be null where the method wrote none: a failed
                // `TryParse`'s `result`. An array written through the pointer
                // is one the callee allocated (`ReceiveArray`).
                let spelled = match &**written {
                    Type::Array(element) => self.received(element)?,
                    _ => self.spell(written, false)?,
                };
                outs.push(if matches!(**written, Type::Object | Type::ClassName(_)) {
                    format!("{name}: {spelled} | null")
                } else {
                    format!("{name}: {spelled}")
                });
            } else if !outs.is_empty() {
                return Err("an `in` parameter after an `out` one".to_owned());
            } else {
                parameters.push(format!("{name}: {}", self.parameter(ty, &receiver)?));
                // `ref const T` is a pointer to the caller's storage, lent
                // for the call as an array is.
                if matches!(ty, Type::RefConst(_)) {
                    lent.push(name);
                }
            }
        }
        // An override's result is what the program hands Windows, not what
        // it reads: an object stays one.
        let overriding = matches!(receiver, Receiver::Override { .. });
        let result = match &signature.return_type {
            Type::Void if outs.is_empty() => "void".to_owned(),
            Type::Void => format!("{{ {} }}", outs.join("; ")),
            other if outs.is_empty() && overriding => self.spell(other, false)?,
            other if outs.is_empty() => self.answered(other)?,
            other => format!("{{ {}; returnValue: {} }}", outs.join("; "), self.spell(other, false)?),
        };
        let mut text = String::new();
        let _ = writeln!(text, "    /**");
        if let Receiver::Override { iid } = receiver {
            let _ = writeln!(text, "     * @ntsOverride {iid} {slot} {}", method_name(method));
            let _ = writeln!(text, "     */");
            // Written in camelCase as every member of the surface is
            // (`onLaunched`); the tag keeps the slot's own name.
            let _ = writeln!(text, "    {}({}): {result};", nts_core::hir::native::js_name(&method_name(method)), parameters.join(", "));
            return Ok(text);
        }
        let _ = writeln!(text, "     * @ntsVtable {slot} {}", method_name(method));
        for name in &lent {
            let _ = writeln!(text, "     * @ntsNoEscape {name}");
        }
        receiver_tags(&mut text, receiver, !outs.is_empty());
        if let Some(iid) = via {
            let _ = writeln!(text, "     * @ntsVia {iid}");
        }
        let _ = writeln!(text, "     */");
        let keyword = if matches!(receiver, Receiver::Instance(_) | Receiver::Member) { "" } else { "function " };
        let name = display.map_or_else(|| method_name(method), str::to_owned);
        let _ = writeln!(text, "    {keyword}{name}({}): {result};", parameters.join(", "));
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
                    let instantiation = format!("{base}<{}>", arguments.join(", "));
                    if def.category() == TypeCategory::Interface {
                        self.specialize(def, name, &instantiation).unwrap_or(instantiation)
                    } else {
                        instantiation
                    }
                };
                // An object may be null where it is passed, as WinRT's
                // projections all allow; a result is what C wrote.
                Ok(if argument { format!("{spelled} | null") } else { spelled })
            }
            Type::ValueName(name) if is_guid(name) => {
                self.brands.insert("Guid");
                self.brands.insert("ByValue");
                Ok("ByValue<Guid>".to_owned())
            }
            // `ref const T`: a struct passed as a pointer to the caller's
            // storage, `const T *`, which C reads and does not keep.
            Type::RefConst(inner) if argument && matches!(&**inner, Type::ValueName(_)) => {
                let by_value = self.spell(inner, true)?;
                if by_value.starts_with("Copied<") {
                    return Err(format!("{ty:?}, a reference to a struct holding a string, which is copied only by value"));
                }
                let Some(record) = by_value.strip_prefix("ByValue<").and_then(|rest| rest.strip_suffix('>')) else {
                    return Err(format!("{ty:?}, a reference to something other than a struct"));
                };
                self.brands.insert("ConstPtr");
                Ok(format!("ConstPtr<{record}>"))
            }
            Type::ValueName(name) => self.spell_value(name),
            // Any object: `IInspectable`, which is what the ABI passes -- and
            // taken as `Inspectable`, which a string, number or boolean is
            // boxed into, as the Windows Runtime's JavaScript projection
            // boxed one (`button.content = "Press"`).
            Type::Object => {
                if argument {
                    self.brands.insert("Inspectable");
                    Ok("Inspectable | null".to_owned())
                } else {
                    self.brands.insert("IInspectable");
                    Ok("IInspectable".to_owned())
                }
            }
            Type::Array(_) => Err("an array".to_owned()),
            Type::RefMut(_) => Err("an `out` parameter".to_owned()),
            other => Err(format!("{other:?}, a type WinRT does not use here")),
        }
    }
}

impl Writer<'_> {
    /// An `[in]` parameter as a method of `receiver` declares it: see
    /// [`Self::or_fields`].
    fn parameter(&mut self, ty: &Type, receiver: &Receiver<'_>) -> Result<String, String> {
        if matches!(receiver, Receiver::Override { .. }) {
            // What an override is handed rather than what a call passes: an
            // object is one, never a primitive the runtime boxed.
            if matches!(ty, Type::Object) {
                self.brands.insert("IInspectable");
                return Ok("IInspectable | null".to_owned());
            }
            return self.spell(ty, true);
        }
        let spelled = self.spell(ty, true)?;
        Ok(self.or_fields(spelled))
    }

    /// A record a call takes by value, which the program may also write as
    /// its fields -- `{ Width: 100, Height: 50 }`, `ByValue<Size> |
    /// Fields<Size>` -- as bind-objc spells one. Not an override's, whose slot
    /// is called with the record and whose declaration its adapter reads the
    /// ABI type from, and not a `Guid`, which nobody writes as its four
    /// fields. Any other type is itself.
    fn or_fields(&mut self, spelled: String) -> String {
        match spelled.strip_prefix("ByValue<").and_then(|rest| rest.strip_suffix('>')) {
            Some(record) if record != "Guid" => {
                self.brands.insert("Fields");
                format!("{spelled} | Fields<{record}>")
            }
            _ => spelled,
        }
    }

    /// A value type by name: an enum as its 32-bit underlying type, a struct
    /// by value, or an `EventRegistrationToken`.
    fn spell_value(&mut self, name: &windows_metadata::TypeName) -> Result<String, String> {
        let Some(def) = self.index.get(&name.namespace, &name.name).next() else {
            return Err(format!("`{}`, not in the metadata read", name.name));
        };
        // One `int64`, passed as the integer is (`winrt:types`).
        if name.namespace == "Windows.Foundation" && name.name == "EventRegistrationToken" {
            self.brands.insert("EventRegistrationToken");
            return Ok("EventRegistrationToken".to_owned());
        }
        // A struct crosses by value: the program holds its storage, a
        // `Ptr` to it, and C copies it in or writes it out -- or, for one
        // holding a string, a plain object copied in and out at the call.
        if def.category() == TypeCategory::Struct {
            if let Some(why) = self.struct_refusal(def, 0) {
                return Err(format!("`{}`, {why}", name.name));
            }
            let record = self.named(&name.namespace, &name.name);
            if self.holds_string(def, 0) {
                self.brands.insert("Copied");
                return Ok(format!("Copied<{record}>"));
            }
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

    /// What a method or a property answers, as the program reads it: any
    /// object as `Inspectable`, which the call unboxes into the string,
    /// number or boolean a boxed `IPropertyValue` holds -- `button.content`
    /// reads back the `"Press"` it was given -- and everything else as
    /// [`Self::spell`] spells it.
    fn answered(&mut self, ty: &Type) -> Result<String, String> {
        if matches!(ty, Type::Object) {
            self.brands.insert("Inspectable");
            return Ok("Inspectable".to_owned());
        }
        if let Type::Array(element) = ty {
            return self.received(element);
        }
        self.spell(ty, false)
    }

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

    /// An array the callee allocated (`ReceiveArray`), as the program reads
    /// it: numbers as the typed array that holds them, a copy; objects --
    /// a class, an interface, any object -- as an array of the program's
    /// owning each, `null` where the Windows Runtime wrote none.
    fn received(&mut self, element: &Type) -> Result<String, String> {
        if let Ok(typed) = typed_array(element) {
            return Ok(typed);
        }
        let object = match element {
            Type::ClassName(named) if self.index.get(&named.namespace, generic_base(&named.name)).next().is_some_and(|def| def.category() != TypeCategory::Delegate) => {
                self.spell(element, false)?
            }
            Type::Object => {
                self.brands.insert("IInspectable");
                "IInspectable".to_owned()
            }
            other => return typed_array(other),
        };
        Ok(format!("({object} | null)[]"))
    }

    /// How an array parameter is lent in place, `None` where it is not one
    /// of these. `written` is an `[out]` array, which the caller allocates
    /// and the callee fills where it is -- so it is an argument too, the
    /// program's buffer.
    ///
    /// - Bytes: a `Uint8Array`'s, read (`const`) or filled.
    /// - Numbers: a typed array's elements, read or filled as bytes are.
    /// - Objects: an array of the program's, whose block of handles is lent
    ///   in place where each is the interface C takes, and asked for it
    ///   element by element otherwise. `[in]` only: a buffer the callee fills
    ///   (`GetMany`) is not built.
    fn lent_array(&mut self, element: &Type, written: bool) -> Result<Option<String>, String> {
        let lent_as = if matches!(element, Type::U8) {
            self.brands.insert("CBytes");
            let pointee = if written { "uint8_t" } else { "const uint8_t" };
            format!("CBytes<\"{pointee}\">")
        } else if let Some((array, spelled)) = elements_of(element) {
            self.brands.insert("CElements");
            let spelled = if written { spelled.to_owned() } else { format!("const {spelled}") };
            format!("CElements<{array}, \"{spelled}\">")
        } else if !written && let Some(handle) = self.handle_element(element)? {
            self.brands.insert("CHandles");
            format!("CHandles<{handle}>")
        } else {
            return Ok(None);
        };
        self.brands.insert("Counted");
        self.brands.insert("CNumber");
        Ok(Some(lent_as))
    }

    /// The interface an array of objects passes each element as: a class's
    /// default interface, an interface itself, or `IInspectable` for any
    /// object. `None` for anything else.
    fn handle_element(&mut self, element: &Type) -> Result<Option<String>, String> {
        Ok(match element {
            Type::ClassName(named)
                if self.index.get(&named.namespace, generic_base(&named.name)).next().is_some_and(|def| def.category() != TypeCategory::Delegate) =>
            {
                Some(self.type_argument(element)?)
            }
            Type::Object => {
                self.brands.insert("IInspectable");
                Some("IInspectable".to_owned())
            }
            _ => None,
        })
    }

    /// A struct an `[out]` parameter writes, which is a field of the call's
    /// value and so no storage: copied out into an object of its own
    /// (`Copied<T>`), as `TryGetVector2`'s `value` is. Not a `Guid`, which
    /// nobody reads as its four fields. `None` for anything else.
    fn copied_out(&mut self, written: &Type) -> Result<Option<String>, String> {
        let Type::ValueName(value) = written else { return Ok(None) };
        if is_guid(value) {
            return Err("a `Guid` `out` parameter".to_owned());
        }
        let Some(def) = self.index.get(&value.namespace, &value.name).next().filter(|def| def.category() == TypeCategory::Struct) else {
            return Ok(None);
        };
        if let Some(why) = self.struct_refusal(def, 0) {
            return Err(format!("`{}`, {why}", value.name));
        }
        self.brands.insert("Copied");
        Ok(Some(format!("Copied<{}>", self.named(&value.namespace, &value.name))))
    }

    /// `DragCompletedEventHandler`: the delegate as a parameter taking one
    /// spells it, under its own name, so a program can name a handler's
    /// type as C# does. A generic one's IID is its instantiation's, so it
    /// has no one type, and is refused before this.
    fn delegate_type(&mut self, def: TypeDef, body: &mut String) {
        let name = def.name();
        let ty = Type::ClassName(windows_metadata::TypeName { namespace: self.namespace.to_owned(), name: name.to_owned(), generics: Vec::new() });
        match self.delegate(&ty, def, true) {
            Ok(spelled) => {
                let _ = writeln!(body, "  export type {name} = {spelled};");
            }
            Err(why) => self.refuse(name, &why),
        }
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

impl Writer<'_> {
    /// `IAsyncOperation<StorageFile>` with the members its generic interface
    /// could not declare, because they depend on its arguments -- a handler
    /// whose IID is computed from them (`put_Completed`) -- declared for these
    /// arguments as `IAsyncOperationOfStorageFile`, the instantiation and
    /// those members together. `None` where every member was declared
    /// generically, and the instantiation is spelled as it is.
    fn specialize(&mut self, def: TypeDef, named: &windows_metadata::TypeName, instantiation: &str) -> Option<String> {
        // Only for arguments that are types: a parameter standing for one
        // (`IAsyncOperation<TResult>` inside the generic interface) decides
        // nothing yet.
        if !named.generics.iter().all(concrete) {
            return None;
        }
        let base = generic_base(&named.name);
        let alias = format!("{base}Of{}", named.generics.iter().map(word).collect::<String>());
        if self.specialized.contains_key(&alias) {
            return Some(alias);
        }
        // Marked before anything is spelled: a member naming the
        // instantiation -- the handler's `asyncInfo` -- finds the name.
        self.specialized.insert(alias.clone(), String::new());
        let generics = std::mem::replace(&mut self.generics, def.generic_params().map(|param| param.name().to_owned()).collect());
        let arguments = self.arguments.take();
        let this = format!("{base}<{}>", self.generics.join(", "));
        let generic: Vec<bool> =
            def.methods().enumerate().map(|(at, method)| self.method(method, 6 + at, Receiver::Instance(&this)).is_ok()).collect();
        let mut text = String::new();
        if generic.contains(&false) {
            self.generics.clear();
            self.arguments = Some(named.generics.clone());
            for (at, method) in def.methods().enumerate().filter(|(at, _)| !generic[*at]) {
                if let Ok(declared) = self.method(method, 6 + at, Receiver::Instance(&alias)) {
                    text.push_str(&declared);
                    self.methods += 1;
                }
            }
        }
        self.generics = generics;
        self.arguments = arguments;
        if text.is_empty() {
            self.specialized.remove(&alias);
            return None;
        }
        if let Some(then) = self.then(def, named, &alias) {
            text.push_str(&then);
        }
        let mut declaration = String::new();
        let _ = writeln!(declaration, "  /** `{instantiation}`, with the members that depend on its arguments. */");
        let _ = writeln!(declaration, "  export interface {alias}Methods {{");
        declaration.push_str(&text);
        let _ = writeln!(declaration, "  }}");
        let _ = writeln!(declaration, "  export type {alias} = {instantiation} & {alias}Methods;");
        self.specialized.insert(alias.clone(), declaration);
        Some(alias)
    }
}

impl Writer<'_> {
    /// `then` for an async operation's specialisation, which makes the
    /// operation itself awaitable: `await StorageFolder.getFolderFromPathAsync(p)`
    /// is the folder, and the operation keeps its `IAsyncInfo` -- status, id,
    /// cancel -- as C#'s `await` on one does, where a separate call returning a
    /// promise would lose it.
    ///
    /// Named with `@ntsCall`, to the function the values module declares for
    /// this specialisation, which subscribes `Completed`: only it can, because
    /// the handler's IID is computed from the result type. The compiler
    /// resolves a promise with the operation through it, as the specification
    /// resolves any thenable. `None` for every other instantiation, and for an
    /// operation whose result could not be spelled.
    fn then(&mut self, def: TypeDef, named: &windows_metadata::TypeName, alias: &str) -> Option<String> {
        let base = generic_base(&named.name);
        if def.namespace() != "Windows.Foundation" {
            return None;
        }
        match base {
            "IAsyncOperation" | "IAsyncOperationWithProgress" => {}
            // An action's progress is its only argument; it completes with
            // nothing.
            "IAsyncActionWithProgress" => return Some(self.then_declaration(alias, None)),
            _ => return None,
        }
        let argument = named.generics.first()?;
        // A struct result is read into a native local, whose address a
        // callback cannot be handed: the compiler refuses the escape, so no
        // `then` is declared that it would refuse, and the refusal says why.
        if let Type::ValueName(result) = argument
            && self.find(&result.namespace, &result.name).is_ok_and(|def| def.category() == TypeCategory::Struct)
        {
            self.refuse(
                &format!("{alias}.then"),
                "an operation whose result is a struct, which is read into a native local that a callback cannot be handed",
            );
            return None;
        }
        let result = self.type_argument(argument).ok()?;
        Some(self.then_declaration(alias, Some(result)))
    }

    /// The `then` declaration itself, recorded for the values module. An
    /// action's callback takes `void`, which is what `await` on it is -- as
    /// on a `Promise<void>`.
    fn then_declaration(&mut self, alias: &str, result: Option<String>) -> String {
        let value = result.clone().unwrap_or_else(|| "void".to_owned());
        self.thens.insert(alias.to_owned(), result);
        let mut text = String::new();
        let _ = writeln!(text, "    /**");
        let _ = writeln!(text, "     * `await operation`: its result, or the error it completes with.");
        let _ = writeln!(text, "     * @ntsCall {}", then_function(alias));
        let _ = writeln!(text, "     */");
        let _ = writeln!(
            text,
            "    then(this: {alias}, onFulfilled: (value: {value}) => unknown, onRejected: (reason: unknown) => unknown): void;"
        );
        text
    }

    /// The values module: one function for each `then` this module declares,
    /// importing exactly the names its functions spell, spelled as the
    /// declarations spell them. `None` where it declares none.
    fn values(&self, command: &str) -> Option<String> {
        if self.thens.is_empty() {
            return None;
        }
        // Decided by the status the handler is given, as C++/WinRT's and C#'s
        // awaiters decide it: `Completed` fulfils with `GetResults`; `Canceled`
        // rejects with an `Error` named "Canceled", which is what the Windows
        // Runtime's JavaScript projection rejects a cancelled operation with --
        // `GetResults` would answer E_ILLEGAL_METHOD_CALL, which describes the
        // call rather than the cancellation (measured); and `Error` rejects
        // with what `GetResults` fails with, the operation's own error, thrown
        // as every failed HRESULT is. The
        // callbacks are function values, so neither is called inside a `try`:
        // a throw from one could not reach its handler.
        let mut functions = String::new();
        for (alias, result) in &self.thens {
            let function = then_function(alias);
            let value = result.as_deref().unwrap_or("void");
            // An action has no result to read: it completed, and that is all.
            let fulfilled = if result.is_some() { "completed.GetResults()" } else { "undefined" };
            let _ = writeln!(functions);
            let _ = writeln!(functions, "export function {function}(");
            let _ = writeln!(functions, "  operation: {alias},");
            let _ = writeln!(functions, "  onFulfilled: (value: {value}) => unknown,");
            let _ = writeln!(functions, "  onRejected: (reason: unknown) => unknown,");
            let _ = writeln!(functions, "): void {{");
            let _ = writeln!(functions, "  nts_pending_begin();");
            let _ = writeln!(functions, "  try {{");
            let _ = writeln!(functions, "    operation.put_Completed((completed, status) => {{");
            let _ = writeln!(functions, "      nts_pending_end();");
            let _ = writeln!(functions, "      if (status === AsyncStatus.Completed) {{");
            let _ = writeln!(functions, "        onFulfilled({fulfilled});");
            let _ = writeln!(functions, "        return;");
            let _ = writeln!(functions, "      }}");
            let _ = writeln!(functions, "      if (status === AsyncStatus.Canceled) {{");
            let _ = writeln!(functions, "        const canceled = new Error(\"Canceled\");");
            let _ = writeln!(functions, "        canceled.name = \"Canceled\";");
            let _ = writeln!(functions, "        onRejected(canceled);");
            let _ = writeln!(functions, "        return;");
            let _ = writeln!(functions, "      }}");
            let _ = writeln!(functions, "      try {{");
            let _ = writeln!(functions, "        completed.GetResults();");
            let _ = writeln!(functions, "      }} catch (error) {{");
            let _ = writeln!(functions, "        onRejected(error);");
            let _ = writeln!(functions, "        return;");
            let _ = writeln!(functions, "      }}");
            let _ = writeln!(functions, "      onRejected(new Error(\"the operation ended \" + String(status) + \" and GetResults did not fail\"));");
            let _ = writeln!(functions, "    }});");
            let _ = writeln!(functions, "  }} catch (error) {{");
            let _ = writeln!(functions, "    nts_pending_end();");
            let _ = writeln!(functions, "    onRejected(error);");
            let _ = writeln!(functions, "  }}");
            let _ = writeln!(functions, "}}");
        }
        // The names the functions use, as identifiers: only these are
        // imported, from wherever the declarations import them.
        // `AsyncStatus` is imported as a value below, since the functions read
        // it at run time, so it is not one of these.
        let used: BTreeSet<&str> = functions
            .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .filter(|word| word.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_'))
            .filter(|word| *word != "AsyncStatus")
            .collect();
        let mut text = String::new();
        let _ = writeln!(text, "// Generated by `{command}` beside the binding of `winrt:{}`. Edit the command, not this file.", self.namespace);
        let _ = writeln!(text, "//");
        let _ = writeln!(text, "// Each async operation's `then`, which its binding names with `@ntsCall`:");
        let _ = writeln!(text, "// `Completed` subscribed, and the result or the failure handed on. Pending");
        let _ = writeln!(text, "// from the subscription to the completion, so the event loop waits for it.");
        let _ = writeln!(text, "// Subscribing twice is refused by the operation (E_ILLEGAL_DELEGATE_ASSIGNMENT),");
        let _ = writeln!(text, "// so a second `await` of one operation rejects with that.");
        let _ = writeln!(text, "import {{ nts_pending_begin, nts_pending_end }} from \"c:pending\";");
        let _ = writeln!(text, "import {{ AsyncStatus }} from \"winrt:Windows.Foundation\";");
        for (module, brands) in [("c:types", C_BRANDS), ("winrt:types", WINRT_BRANDS)] {
            let scalars = used.iter().copied().filter(|word| module == "c:types" && word.starts_with("c_"));
            let names: Vec<&str> = brands.iter().copied().filter(|brand| used.contains(brand)).chain(scalars).collect();
            if !names.is_empty() {
                let _ = writeln!(text, "import type {{ {} }} from \"{module}\";", names.join(", "));
            }
        }
        // The specialisations are this module's own declarations, imported
        // with the other names it declares.
        let mut own: BTreeSet<String> = self.thens.keys().cloned().collect();
        own.extend(self.references.get(self.namespace).into_iter().flatten().filter(|name| used.contains(name.as_str())).cloned());
        for (namespace, names) in self.references.iter().filter(|(namespace, _)| namespace.as_str() != self.namespace) {
            let names: Vec<String> = names
                .iter()
                .filter_map(|name| {
                    let spelled = self.spelled.get(&(namespace.clone(), name.clone())).cloned().unwrap_or_else(|| name.clone());
                    used.contains(spelled.as_str()).then(|| if &spelled == name { spelled } else { format!("{name} as {spelled}") })
                })
                .collect();
            if !names.is_empty() {
                let _ = writeln!(text, "import type {{ {} }} from \"winrt:{namespace}\";", names.join(", "));
            }
        }
        let own: Vec<String> = own.into_iter().collect();
        let _ = writeln!(text, "import type {{ {} }} from \"winrt:{}\";", own.join(", "), self.namespace);
        text.push_str(&functions);
        Some(text)
    }
}

/// An array the callee allocates and hands back (`ReceiveArray`), as the
/// typed array the program receives it as: a copy of its elements, the block
/// freed. Numbers only; the element kinds a typed array has no class for --
/// 64-bit integers, which are `bigint`, `boolean`, characters, strings,
/// objects and structs -- are refused by name.
fn typed_array(element: &Type) -> Result<String, String> {
    Ok(match element {
        Type::U8 => "Uint8Array",
        Type::I16 => "Int16Array",
        Type::U16 => "Uint16Array",
        Type::I32 => "Int32Array",
        Type::U32 => "Uint32Array",
        Type::F32 => "Float32Array",
        Type::F64 => "Float64Array",
        other => return Err(format!("an array of {}, which no typed array holds", element_name(other))),
    }
    .to_owned())
}

/// A numeric array element other than a byte, as the typed array that holds
/// it and C's spelling of the element (`CElements`). Bytes are `CBytes`.
fn elements_of(element: &Type) -> Option<(&'static str, &'static str)> {
    Some(match element {
        Type::I16 => ("Int16Array", "int16_t"),
        Type::U16 => ("Uint16Array", "uint16_t"),
        Type::I32 => ("Int32Array", "int32_t"),
        Type::U32 => ("Uint32Array", "uint32_t"),
        Type::F32 => ("Float32Array", "float"),
        Type::F64 => ("Float64Array", "double"),
        _ => return None,
    })
}

/// An element type as a refusal names it: a type by its full name, and the
/// rest as the metadata's primitives are called.
fn element_name(ty: &Type) -> String {
    match ty {
        Type::ClassName(named) | Type::ValueName(named) => format!("`{}.{}`", named.namespace, named.name),
        Type::String => "strings".to_owned(),
        Type::Object => "objects".to_owned(),
        Type::Bool => "booleans".to_owned(),
        Type::Char => "characters".to_owned(),
        Type::I64 | Type::U64 => "64-bit integers, which are `bigint`".to_owned(),
        other => format!("{other:?}"),
    }
}

/// The values module's function for one specialisation's `then`.
fn then_function(alias: &str) -> String {
    format!("nts_then_{alias}")
}

impl Writer<'_> {
    /// The class declaration a subclass extends, for a composable class with a
    /// constructor a subclass can call -- its factory's `CreateInstance(outer,
    /// out inner)`, public or protected (a protected one exists for
    /// subclasses alone) -- tagged with that factory, and declaring each
    /// method of an interface it or a class it derives from lets a subclass
    /// override (`IApplicationOverrides.OnLaunched`), tagged with the
    /// interface and slot. `xaml` marks `Microsoft.UI.Xaml.Application`, whose
    /// subclass answers `WinUI`'s metadata provider. `None` for any other class.
    fn subclassing(&mut self, def: TypeDef, class_name: &str) -> Option<String> {
        let (factory, slot, create, public) = def
            .attributes()
            .filter(|attribute| attribute.ctor().parent().name() == "ComposableAttribute")
            .find_map(|attribute| {
                let values: Vec<Value> = attribute.value().into_iter().map(|(_, value)| value).collect();
                let Some(Value::TypeName(interface)) = values.first() else { return None };
                let public = matches!(values.get(1), Some(Value::EnumValue(_, kind)) if **kind == Value::I32(2));
                let factory = self.index.get(&interface.namespace, &interface.name).next()?;
                let iid = iid(factory)?;
                // The parameterless one: the outer object and the inner, nothing else.
                let (slot, create) = factory.methods().enumerate().find(|(_, method)| method.signature(&[]).types.len() == 2)?;
                Some((iid, 6 + slot, method_name(create), public))
            })?;
        let mut overrides = String::new();
        let mut at = Some(def);
        let mut depth = 0;
        while let Some(class) = at.filter(|class| class.category() == TypeCategory::Class && depth < 16) {
            for implemented in class.interface_impls().filter(|implemented| implemented.has_attribute("OverridableAttribute")) {
                let Type::ClassName(named) = implemented.interface(&[]) else { continue };
                let Some(interface) = self.index.get(&named.namespace, &named.name).next() else { continue };
                let Some(interface_iid) = iid(interface) else { continue };
                for (index, method) in interface.methods().enumerate() {
                    match self.method(method, 6 + index, Receiver::Override { iid: &interface_iid }) {
                        Ok(text) => overrides.push_str(&text),
                        Err(why) => self.refuse(&format!("{} override {}", def.name(), method_name(method)), &why),
                    }
                }
            }
            at = class.extends().and_then(|parent| self.index.get(parent.namespace(), parent.name()).next());
            depth += 1;
        }
        let xaml = if class_name == "Microsoft.UI.Xaml.Application" { " xaml" } else { "" };
        let mut text = String::new();
        let _ = writeln!(text, "  /**");
        let _ = writeln!(text, "   * @ntsComposable {class_name} {factory} {slot}{xaml}");
        let _ = writeln!(text, "   */");
        let _ = writeln!(text, "  export class {} {{", def.name());
        // `new Window()`: the factory's parameterless `CreateInstance`, as the
        // static of that name is, with no outer object.
        let _ = writeln!(
            text,
            "    /**\n     * @ntsVtable {slot} {create}\n     * @ntsHresult composable\n     * @ntsFactory {class_name} {factory}\n     */"
        );
        let _ = writeln!(text, "    {}constructor();", if public { "" } else { "protected " });
        text.push_str(&overrides);
        let _ = writeln!(text, "  }}");
        Some(text)
    }
}

/// A type as a word in a specialization's name, as the metadata names it:
/// `IAsyncOperation<IVectorView<StorageFile>>` is
/// `IAsyncOperationOfIVectorViewStorageFile`.
fn word(ty: &Type) -> String {
    match ty {
        Type::ClassName(named) => format!("{}{}", generic_base(&named.name), named.generics.iter().map(word).collect::<String>()),
        Type::ValueName(named) => named.name.clone(),
        Type::String => "String".to_owned(),
        Type::Object => "Object".to_owned(),
        Type::Bool => "Boolean".to_owned(),
        Type::Char => "Char16".to_owned(),
        Type::I8 => "Int8".to_owned(),
        Type::U8 => "UInt8".to_owned(),
        Type::I16 => "Int16".to_owned(),
        Type::U16 => "UInt16".to_owned(),
        Type::I32 => "Int32".to_owned(),
        Type::U32 => "UInt32".to_owned(),
        Type::I64 => "Int64".to_owned(),
        Type::U64 => "UInt64".to_owned(),
        Type::F32 => "Single".to_owned(),
        Type::F64 => "Double".to_owned(),
        other => format!("{other:?}").chars().filter(char::is_ascii_alphanumeric).collect(),
    }
}

/// Whether `ty` names no type parameter anywhere in it.
fn concrete(ty: &Type) -> bool {
    match ty {
        Type::Generic(..) => false,
        Type::ClassName(named) => named.generics.iter().all(concrete),
        Type::RefMut(inner) | Type::RefConst(inner) | Type::Array(inner) => concrete(inner),
        _ => true,
    }
}

/// `System.Guid`, which the metadata names and no `.winmd` defines:
/// `winrt:types` declares it.
fn is_guid(name: &windows_metadata::TypeName) -> bool {
    name.namespace == "System" && name.name == "Guid"
}

/// ``IVectorView`1`` as TypeScript names it: `IVectorView`.
fn generic_base(name: &str) -> &str {
    name.split('`').next().unwrap_or(name)
}

#[derive(Clone, Copy)]
enum Receiver<'a> {
    Instance(&'a str),
    /// A member of a class's idiomatic surface (`{Class}Members`): an
    /// instance method with no `this` parameter, called on whichever class's
    /// instance it is inherited by, through the interface its `@ntsVia`
    /// names.
    Member,
    Factory { class: &'a str, iid: &'a str },
    /// A method of an interface a composable class lets a subclass override
    /// (`IApplicationOverrides.OnLaunched`), declared on the class for a
    /// subclass to write: no `this` parameter, and the interface and slot the
    /// subclass's table answers it at.
    Override { iid: &'a str },
    /// A composable class's factory: the method's last two parameters are the
    /// outer object and the inner one it answers, which the compiler supplies
    /// (`@ntsHresult composable`) -- a class constructed as itself has no
    /// outer object, and nothing of the program holds the inner.
    Composable { class: &'a str, iid: &'a str },
}

/// The name the metadata gives a method's slot: its `OverloadAttribute` where
/// it has one, which is unique within the interface, and otherwise its name.
/// For each class in `namespace`, its default interface and its base
/// class's: see `Writer::bases`. A base outside the metadata read, or one with
/// no default interface, gives none.
fn default_interface_bases(index: &Index, namespace: &str) -> BTreeMap<String, (String, String)> {
    let default_of = |class: TypeDef| {
        class.interface_impls().find(|implemented| implemented.has_attribute("DefaultAttribute")).and_then(|implemented| match implemented.interface(&[]) {
            Type::ClassName(named) if named.generics.is_empty() => Some((named.namespace.clone(), named.name.clone())),
            _ => None,
        })
    };
    let mut bases = BTreeMap::new();
    for class in index.types().filter(|def| def.namespace() == namespace && def.category() == TypeCategory::Class) {
        let Some((own_namespace, own)) = default_of(class) else { continue };
        if own_namespace != namespace {
            continue;
        }
        let base = class
            .extends()
            .and_then(|base| index.get(base.namespace(), base.name()).next())
            .filter(|base| base.category() == TypeCategory::Class)
            .and_then(default_of);
        if let Some(base) = base {
            bases.insert(own, base);
        }
    }
    bases
}

/// The tags a method's receiver adds: how its HRESULT is read, and the
/// factory a static is called on.
fn receiver_tags(text: &mut String, receiver: Receiver<'_>, outs: bool) {
    match receiver {
        Receiver::Composable { class, iid } => {
            let _ = writeln!(text, "     * @ntsHresult composable");
            let _ = writeln!(text, "     * @ntsFactory {class} {iid}");
        }
        Receiver::Factory { class, iid } => {
            let _ = writeln!(text, "     * @ntsHresult{}", if outs { " out" } else { "" });
            let _ = writeln!(text, "     * @ntsFactory {class} {iid}");
        }
        Receiver::Instance(_) | Receiver::Member if outs => {
            let _ = writeln!(text, "     * @ntsHresult out");
        }
        Receiver::Instance(_) | Receiver::Member => {
            let _ = writeln!(text, "     * @ntsHresult");
        }
        Receiver::Override { .. } => {}
    }
}

/// How many of a method's parameters the program passes: all of them, or for
/// a composable factory's `CreateInstance(..., outer, out inner)` all but the
/// two objects the runtime composes with.
fn declared_parameters(types: &[Type], out: impl Fn(usize) -> bool, receiver: &Receiver<'_>) -> Result<usize, String> {
    let count = types.len();
    let composed = count >= 2
        && matches!(types[count - 2], Type::Object)
        && matches!(&types[count - 1], Type::Object | Type::RefMut(_) if match &types[count - 1] { Type::RefMut(inner) => matches!(**inner, Type::Object), _ => true })
        && !out(count - 2)
        && out(count - 1);
    if matches!(receiver, Receiver::Composable { .. }) {
        if !composed {
            return Err("a composable factory method not ending in the outer and inner objects".to_owned());
        }
        Ok(count - 2)
    } else if composed && matches!(receiver, Receiver::Instance(_) | Receiver::Member) {
        // A factory interface's own method, which the class it makes calls as
        // its constructor (`Receiver::Composable`): as an interface method it
        // would hand the program an inner object.
        Err("a composable factory method, called as its class's constructor".to_owned())
    } else {
        Ok(count)
    }
}

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
    if is_reserved(name) { format!("{name}_") } else { name.to_owned() }
}

/// A word no binding may be named: JavaScript's reserved words, and the
/// strict-mode ones a module is always in. A parameter so named is renamed
/// ([`safe`]); a static property so named stays its `get_X()`, since the
/// program reads it by that name.
fn is_reserved(name: &str) -> bool {
    matches!(
        name,
        "break" | "case" | "catch" | "class" | "const" | "continue" | "debugger" | "default" | "delete" | "do" | "else" | "enum"
            | "export" | "extends" | "false" | "finally" | "for" | "function" | "if" | "import" | "in" | "instanceof" | "new"
            | "null" | "return" | "super" | "switch" | "this" | "throw" | "true" | "try" | "typeof" | "var" | "void" | "while"
            | "with" | "implements" | "interface" | "let" | "package" | "private" | "protected" | "public" | "static" | "yield"
            | "await"
    )
}
