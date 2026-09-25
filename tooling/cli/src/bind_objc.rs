//! Derive an Objective-C binding from a framework's headers: `nts bind-objc`.
//!
//! The surface is Swift's: what an `AppKit` programmer writes in Swift, written
//! in TypeScript.
//!
//! ```text
//! /** @ntsClass NSTimer */
//! export class Timer extends NSObject {
//!   /** @ntsSelector scheduledTimerWithTimeInterval:target:selector:userInfo:repeats: */
//!   static scheduledTimer(labels: { timeInterval: TimeInterval; target: NSObject; ... }): Timer;
//! }
//! export namespace NSWindow { export const enum StyleMask { titled = 1, ... } }
//! ```
//!
//! **Two sources, joined by clang's USR.** The headers are the ABI: selectors,
//! C types, record layouts, enum widths and values. Swift's symbol graphs
//! (`tooling/apple/symbolgraph.sh`, run once per SDK on a Mac) are the names:
//! each symbol carries the USR of the declaration it imports, so
//! `c:objc(cs)NSWindow(im)setFrame:display:` is `setFrame(_:display:)` by
//! Apple's own importer, and nothing here guesses one. A member Swift does not
//! import -- `alloc`, `new`, what it marks unavailable -- is not bound.
//!
//! Swift's arguments map one way: the unlabelled ones positional, and every
//! labelled one in one trailing object the call writes as a literal, which the
//! compiler passes field by field and never builds. An initializer is a
//! constructor, a class factory's included, sent as its `@ntsSelector` says.
//!
//! # Reading the headers
//!
//! **One translation unit importing each framework, dumped whole.** Clang's
//! `-ast-dump-filter` matches a declaration's own name, and a category is named
//! for itself: filtering on `NSWindow` finds none of `NSWindow (NSEvent)`,
//! `(NSDrag)` or `(NSDisplayLink)`, and does find `NSWindowTabbing`, a
//! category on `NSResponder`. A binding built on it silently misses methods.
//!
//! The whole dump of `AppKit` is 388 MB, so it is streamed and never held: each
//! top-level declaration is read up to its `inner`, where clang writes the
//! body last, and the body is kept only for what is asked for. Two passes --
//! the first learns every class's superclass, every enum's width and every
//! struct's members; the second keeps the requested classes, their ancestors,
//! and their categories.
//!
//! # What is skipped, and said
//!
//! A member whose type this cannot write is left out with a comment naming it
//! and why: a block, a collection, a pointer other than to an object, a
//! method Swift throws or awaits, one deprecated by the deployment target or
//! introduced after it. The binding is a claim either way; the comment is so a
//! gap is found by reading rather than by an `unrecognized selector`.

use anyhow::{Context, Result, bail};
use serde::de::{DeserializeSeed, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::io::BufReader;
use std::process::{Command, Stdio};

/// What to bind, and from where.
pub(crate) struct Request {
    /// Frameworks to import, and to link: `AppKit`, `Foundation`.
    pub(crate) frameworks: Vec<String>,
    /// The module the declaration file declares: `objc:AppKit`.
    pub(crate) module: String,
    /// The classes to bind. Their ancestors are bound too, since a method a
    /// class inherits is one a program calls on it.
    pub(crate) classes: Vec<String>,
    /// The protocols to declare, each an interface a class the program writes
    /// can adopt: `NSWindowDelegate`.
    pub(crate) protocols: Vec<String>,
    /// The macOS SDK.
    pub(crate) sdk: String,
    /// The clang target, `x86_64-apple-macos13`, whose version is the
    /// deployment target members are bound for.
    pub(crate) target: String,
    /// Where `tooling/apple/symbolgraph.sh` wrote Swift's symbol graphs for
    /// this SDK. By default, `symbolgraph/<SDK version>` beside the SDK.
    pub(crate) symbols: Option<std::path::PathBuf>,
}

/// What `nts bind-objc` writes: the binding, and the witness that checks it.
pub(crate) struct Output {
    pub(crate) binding: String,
    /// A C program that asks the Objective-C runtime, on a Mac, for every
    /// message the binding sends, with its arity, and fails naming each one
    /// the runtime does not have. The headers say what a class declares, and
    /// only the running runtime says what it implements.
    pub(crate) witness: String,
    /// The values module beside the binding: Swift's `async` forms, each a
    /// function its `@ntsCall` overload names. Empty when nothing is `async`.
    pub(crate) values: String,
}

pub(crate) fn run(request: &Request) -> Result<Output> {
    if !request.module.starts_with("objc:") {
        bail!("`nts bind-objc` writes an `objc:` module, and `{}` is not one", request.module);
    }
    let unit = translation_unit(request)?;
    let headers = dump(request, &unit, &Wanted::Headers)?;
    let bound = closure(&request.classes, &headers.supers)?;
    let protocols: BTreeSet<String> = request.protocols.iter().cloned().collect();
    let bodies = dump(request, &unit, &Wanted::Bodies(&bound, &protocols))?;
    let symbols = match &request.symbols {
        Some(directory) => directory.clone(),
        None => default_symbols(&request.sdk)?,
    };
    let swift = Swift::read(&symbols, &request.frameworks)?;
    let model = Model::read(&swift, &headers, &bodies, &bound, deployment_target(&request.target)?);
    Ok(Output { binding: render(request, &model), witness: witness(request, &model), values: render_values(request, &model) })
}

/// The witness program for `model` (see [`Output::witness`]). Plain C over
/// the runtime's own functions, so it builds with the SDK's clang and nothing
/// of this compiler's.
fn witness(request: &Request, model: &Model) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "// Generated by `nts bind-objc --witness` beside {}. Do not edit: regenerate.", request.module);
    out.push_str(
        "#include <objc/runtime.h>\n#include <stdio.h>\n\n\
         static int checked, missing;\n\n\
         static void check(const char *name, const char *selector, int class_side, unsigned arguments) {\n\
         \x20 checked++;\n\
         \x20 Class class = objc_getClass(name);\n\
         \x20 Method method = !class ? 0 : class_side ? class_getClassMethod(class, sel_registerName(selector))\n\
         \x20                                          : class_getInstanceMethod(class, sel_registerName(selector));\n\
         \x20 if (!method) {\n\
         \x20   printf(\"missing %c[%s %s]\\n\", class_side ? '+' : '-', name, selector);\n\
         \x20   missing++;\n\
         \x20 } else if (method_getNumberOfArguments(method) != arguments) {\n\
         \x20   printf(\"arity %c[%s %s]: %u, not %u\\n\", class_side ? '+' : '-', name, selector,\n\
         \x20          method_getNumberOfArguments(method), arguments);\n\
         \x20   missing++;\n\
         \x20 }\n\
         }\n\nint main(void) {\n",
    );
    for class in &model.classes {
        for sent in &class.sent {
            // `self` and `_cmd`, then one per colon.
            let arguments = 2 + sent.selector.bytes().filter(|&byte| byte == b':').count();
            let _ = writeln!(out, "  check(\"{}\", \"{}\", {}, {arguments});", class.objc, sent.selector, u8::from(sent.class_side));
        }
    }
    out.push_str("  printf(\"%d messages checked, %d the runtime does not have\\n\", checked, missing);\n  return missing != 0;\n}\n");
    out
}

/// `symbolgraph/26.5` beside the SDK, for the SDK's own version: a graph of
/// another SDK names members this one may not have.
fn default_symbols(sdk: &str) -> Result<std::path::PathBuf> {
    let sdk = std::path::Path::new(sdk);
    let settings = sdk.join("SDKSettings.json");
    let text = std::fs::read(&settings).with_context(|| format!("reading {}", settings.display()))?;
    let settings: Value = serde_json::from_slice(&text).with_context(|| format!("reading {}", settings.display()))?;
    let version = settings.get("Version").and_then(Value::as_str).context("SDKSettings.json names no `Version`")?;
    Ok(sdk.parent().unwrap_or(sdk).join("symbolgraph").join(version))
}

/// `x86_64-apple-macos13` is macOS 13.0.
fn deployment_target(target: &str) -> Result<Version> {
    let version = target.rsplit_once("macos").map(|(_, v)| v).with_context(|| format!("`{target}` is not a macOS target"))?;
    let mut parts = version.split('.').map(str::parse::<u32>);
    match (parts.next(), parts.next()) {
        (Some(Ok(major)), None) => Ok(Version { major, minor: 0 }),
        (Some(Ok(major)), Some(Ok(minor))) => Ok(Version { major, minor }),
        _ => bail!("`{target}` names no macOS version"),
    }
}

fn translation_unit(request: &Request) -> Result<tempfile_path::TempFile> {
    let mut text = String::new();
    for framework in &request.frameworks {
        let _ = writeln!(text, "#import <{framework}/{framework}.h>");
    }
    tempfile_path::TempFile::with(".m", &text)
}

/// Each requested class and every ancestor, root first.
fn closure(classes: &[String], supers: &BTreeMap<String, Option<String>>) -> Result<BTreeSet<String>> {
    let mut bound = BTreeSet::new();
    for class in classes {
        let mut at = Some(class.clone());
        while let Some(name) = at.take() {
            let Some(parent) = supers.get(&name) else {
                bail!("`{name}` is not an Objective-C class these frameworks declare");
            };
            at.clone_from(parent);
            bound.insert(name);
        }
    }
    Ok(bound)
}

/// What a pass keeps the bodies of.
enum Wanted<'a> {
    /// Headers only: supers, enum widths, and struct definitions.
    Headers,
    /// The bodies of these classes, and of the categories on them, and of
    /// these protocols.
    Bodies(&'a BTreeSet<String>, &'a BTreeSet<String>),
}

/// What one pass read.
#[derive(Default)]
struct Dumped {
    /// Every class, and the class it inherits from.
    supers: BTreeMap<String, Option<String>>,
    /// Every enum with a fixed width, and that width's C spelling.
    enums: BTreeMap<String, String>,
    /// Each enum's constants and their values, in declaration order.
    constants: BTreeMap<String, Vec<(String, i128)>>,
    /// Every struct definition, and its members' names and C types.
    records: BTreeMap<String, Vec<(String, String)>>,
    /// Interfaces and categories, by class, in header order.
    bodies: BTreeMap<String, Vec<Value>>,
    /// The `NSObject` protocol's methods, which `NSObject` adopts.
    root_protocol: Vec<Value>,
    /// The requested protocols' methods, by protocol.
    protocols: BTreeMap<String, Vec<Value>>,
    /// Every typedef, and the type it names with its sugar taken off: what a
    /// block's parameter spelled `NSModalResponse` is, since a block's type
    /// arrives as one string clang did not desugar.
    typedefs: BTreeMap<String, String>,
}

fn dump(request: &Request, unit: &tempfile_path::TempFile, wanted: &Wanted<'_>) -> Result<Dumped> {
    let mut child = Command::new("clang")
        .args(["-target", &request.target, "-isysroot", &request.sdk, "-x", "objective-c", "-fsyntax-only"])
        .args(["-Xclang", "-ast-dump=json"])
        .arg(unit.path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("running clang for `nts bind-objc`")?;
    let stdout = child.stdout.take().context("clang's output")?;
    let mut dumped = Dumped::default();
    let mut deserializer = serde_json::Deserializer::from_reader(BufReader::with_capacity(1 << 20, stdout));
    let read = UnitSeed { wanted, out: &mut dumped }.deserialize(&mut deserializer);
    let finished = child.wait_with_output().context("waiting for clang")?;
    if !finished.status.success() {
        bail!("clang could not read the frameworks:\n{}", String::from_utf8_lossy(&finished.stderr));
    }
    read.context("reading clang's AST dump")?;
    Ok(dumped)
}

/// The translation unit: an object whose `inner` is every top-level
/// declaration.
struct UnitSeed<'a, 'w> {
    wanted: &'a Wanted<'w>,
    out: &'a mut Dumped,
}

impl<'de> DeserializeSeed<'de> for UnitSeed<'_, '_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        deserializer.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for UnitSeed<'_, '_> {
    type Value = ();
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a translation unit")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        while let Some(key) = map.next_key::<String>()? {
            if key == "inner" {
                map.next_value_seed(Declarations { wanted: self.wanted, out: &mut *self.out })?;
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        Ok(())
    }
}

struct Declarations<'a, 'w> {
    wanted: &'a Wanted<'w>,
    out: &'a mut Dumped,
}

impl<'de> DeserializeSeed<'de> for Declarations<'_, '_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        deserializer.deserialize_seq(self)
    }
}

impl<'de> Visitor<'de> for Declarations<'_, '_> {
    type Value = ();
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("top-level declarations")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        while seq.next_element_seed(Declaration { wanted: self.wanted, out: &mut *self.out })?.is_some() {}
        Ok(())
    }
}

/// One top-level declaration, read up to its body and the body kept only when
/// it is wanted.
struct Declaration<'a, 'w> {
    wanted: &'a Wanted<'w>,
    out: &'a mut Dumped,
}

impl<'de> DeserializeSeed<'de> for Declaration<'_, '_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        deserializer.deserialize_map(self)
    }
}

/// `{"name": ...}`, which is how clang refers to another declaration.
fn named(value: &Value) -> Option<String> {
    value.get("name").and_then(Value::as_str).map(str::to_owned)
}

impl<'de> Visitor<'de> for Declaration<'_, '_> {
    type Value = ();
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a declaration")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        let (mut kind, mut name, mut interface, mut parent, mut width) = (String::new(), None, None, None, None);
        let mut complete = false;
        let mut body = None;
        let mut aliased = None;
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "kind" => kind = map.next_value()?,
                "name" => name = Some(map.next_value::<String>()?),
                "interface" => interface = named(&map.next_value::<Value>()?),
                "super" => parent = named(&map.next_value::<Value>()?),
                "completeDefinition" => complete = map.next_value()?,
                "fixedUnderlyingType" => {
                    width = desugared(&map.next_value::<Value>()?);
                }
                "type" if kind == "TypedefDecl" && matches!(self.wanted, Wanted::Headers) => {
                    aliased = desugared(&map.next_value::<Value>()?);
                }
                "inner" => {
                    let keep = match self.wanted {
                        Wanted::Headers => (kind == "RecordDecl" && complete) || kind == "EnumDecl",
                        Wanted::Bodies(bound, protocols) => match kind.as_str() {
                            "ObjCInterfaceDecl" => name.as_ref().is_some_and(|n| bound.contains(n)),
                            // A category on NSObject is every framework's
                            // extension of every object, hundreds of methods;
                            // the root is bound as the runtime declares it.
                            "ObjCCategoryDecl" => interface.as_ref().is_some_and(|n| bound.contains(n) && n != "NSObject"),
                            "ObjCProtocolDecl" => name.as_ref().is_some_and(|n| {
                                (n == "NSObject" && bound.contains("NSObject")) || protocols.contains(n)
                            }),
                            _ => false,
                        },
                    };
                    if keep {
                        body = Some(map.next_value::<Value>()?);
                    } else {
                        map.next_value::<IgnoredAny>()?;
                    }
                }
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        let out = self.out;
        if let (Some(name), Some(aliased)) = (name.as_ref(), aliased) {
            out.typedefs.entry(name.clone()).or_insert(aliased);
        }
        match (kind.as_str(), name) {
            ("ObjCInterfaceDecl", Some(name)) => {
                // A forward `@class` has no super; the definition's wins.
                let entry = out.supers.entry(name.clone()).or_insert(None);
                if parent.is_some() {
                    *entry = parent;
                }
                if let Some(Value::Array(members)) = body {
                    out.bodies.entry(name).or_default().extend(members);
                }
            }
            ("ObjCCategoryDecl", _) => {
                if let (Some(class), Some(Value::Array(members))) = (interface, body) {
                    out.bodies.entry(class).or_default().extend(members);
                }
            }
            ("ObjCProtocolDecl", Some(name)) => {
                if let Some(Value::Array(members)) = body {
                    if name == "NSObject" {
                        out.root_protocol.extend(members.iter().cloned());
                    }
                    if matches!(self.wanted, Wanted::Bodies(_, protocols) if protocols.contains(&name)) {
                        out.protocols.entry(name).or_default().extend(members);
                    }
                }
            }
            ("EnumDecl", Some(name)) => {
                if let Some(Value::Array(members)) = &body {
                    out.constants.insert(name.clone(), enum_constants(members));
                }
                if let Some(width) = width {
                    out.enums.insert(name, width);
                }
            }
            ("RecordDecl", Some(name)) => {
                if let Some(Value::Array(members)) = body {
                    let fields = members
                        .iter()
                        .filter(|m| m.get("kind").and_then(Value::as_str) == Some("FieldDecl"))
                        .filter_map(|m| Some((named(m)?, desugared(m.get("type")?)?)))
                        .collect();
                    out.records.insert(name, fields);
                }
            }
            _ => {}
        }
        Ok(())
    }
}

/// An enum's constants, each at the value clang evaluated for it (the
/// `ConstantExpr` its initializer holds) or, with none written, one past the
/// one before it, as C counts.
fn enum_constants(members: &[Value]) -> Vec<(String, i128)> {
    fn evaluated(node: &Value) -> Option<i128> {
        if node.get("kind").and_then(Value::as_str) == Some("ConstantExpr") {
            return node.get("value").and_then(Value::as_str)?.parse().ok();
        }
        node.get("inner")?.as_array()?.iter().find_map(evaluated)
    }
    let mut next = 0i128;
    members
        .iter()
        .filter(|m| m.get("kind").and_then(Value::as_str) == Some("EnumConstantDecl"))
        .filter_map(|m| {
            let value = evaluated(m).unwrap_or(next);
            next = value + 1;
            Some((named(m)?, value))
        })
        .collect()
}

/// A type's spelling with every typedef expanded, which is what decides how
/// it crosses.
fn desugared(ty: &Value) -> Option<String> {
    ty.get("desugaredQualType").or_else(|| ty.get("qualType")).and_then(Value::as_str).map(str::to_owned)
}

/// The spelling as written, which is where nullability is.
fn written(ty: &Value) -> String {
    ty.get("qualType").and_then(Value::as_str).unwrap_or_default().to_owned()
}

/// A type as the binding writes it, or why it cannot.
type Spelled = std::result::Result<String, String>;

/// One symbol of a symbol graph: how Swift imports the declaration whose
/// clang USR it carries.
#[derive(serde::Deserialize, Clone)]
struct Symbol {
    identifier: Identifier,
    kind: Identifier,
    names: Names,
    #[serde(rename = "pathComponents")]
    path: Vec<String>,
    #[serde(default)]
    availability: Vec<Availability>,
    #[serde(default, rename = "declarationFragments")]
    fragments: Vec<Fragment>,
}

/// See [`Symbol::optionality`].
#[derive(Clone, Copy, PartialEq, Eq)]
enum Optionality {
    Optional,
    Unwrapped,
    Neither,
}

/// One piece of Swift's declaration of a symbol, as its graph spells it.
#[derive(serde::Deserialize, Clone)]
struct Fragment {
    spelling: String,
}

impl Symbol {
    /// How Swift's declaration gives the value -- a property's type, or a
    /// method's result: optional (`T?`), implicitly unwrapped (`T!`, a
    /// `null_resettable` property, read never nil and written nil to reset),
    /// or neither. Clang's printed type drops `_Nullable` behind an
    /// availability macro (`API_UNAVAILABLE(watchos) __kindof NSTextElement
    /// *`), and a weak property is optional in Swift whatever its header says.
    fn optionality(&self) -> Optionality {
        let text: String = self.fragments.iter().map(|fragment| fragment.spelling.as_str()).collect();
        let value = match text.rsplit_once("->") {
            Some((_, result)) => result,
            None => text.split_once(':').map_or("", |(_, ty)| ty),
        };
        let value = value.split('{').next().unwrap_or_default().trim();
        if value.ends_with('?') {
            Optionality::Optional
        } else if value.ends_with('!') {
            Optionality::Unwrapped
        } else {
            Optionality::Neither
        }
    }

    /// Whether this is Swift's `async` import of a method: the one Swift makes
    /// from a completion handler, beside the one taking it, under one USR.
    fn is_async(&self) -> bool {
        self.fragments.iter().any(|fragment| fragment.spelling.split_whitespace().any(|word| word == "async"))
    }
}

#[derive(serde::Deserialize, Clone)]
struct Identifier {
    #[serde(alias = "precise")]
    identifier: String,
}

#[derive(serde::Deserialize, Clone)]
struct Names {
    title: String,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Availability {
    #[serde(default)]
    domain: Option<String>,
    #[serde(default)]
    introduced: Option<Version>,
    #[serde(default)]
    deprecated: Option<Version>,
    #[serde(default)]
    is_unconditionally_deprecated: bool,
}

#[derive(serde::Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Version {
    major: u32,
    #[serde(default)]
    minor: u32,
}

#[derive(serde::Deserialize)]
struct Graph {
    symbols: Vec<Symbol>,
    #[serde(default)]
    relationships: Vec<Relationship>,
}

/// One relationship of a symbol graph: `optionalRequirementOf` says a
/// protocol's member is `@optional`, which clang's dump does not.
#[derive(serde::Deserialize)]
struct Relationship {
    kind: String,
    source: String,
}

/// Swift's names, by the clang USR of the declaration each names -- read from
/// `tooling/apple/symbolgraph.sh`'s files, so every name is the importer's own.
pub(crate) struct Swift {
    by_usr: BTreeMap<String, Symbol>,
    /// Swift's `async` import of a method, by the USR it shares with the one
    /// taking the completion handler.
    asynchronous: BTreeMap<String, Symbol>,
    /// The protocol members Swift marks optional, by USR.
    optional: BTreeSet<String>,
}

impl Swift {
    /// The graphs of `modules` and of `ObjectiveC`, which declares `NSObject`.
    pub(crate) fn read(directory: &std::path::Path, modules: &[String]) -> Result<Self> {
        let mut by_usr = BTreeMap::new();
        let mut asynchronous = BTreeMap::new();
        let mut optional = BTreeSet::new();
        let mut modules: Vec<&str> = modules.iter().map(String::as_str).collect();
        modules.push("ObjectiveC");
        for module in modules {
            let path = directory.join(format!("{module}.symbols.json"));
            let text = std::fs::read(&path)
                .with_context(|| format!("reading {} -- run tooling/apple/symbolgraph.sh {module}", path.display()))?;
            let graph: Graph = serde_json::from_slice(&text).with_context(|| format!("reading {}", path.display()))?;
            // Clang's declarations only: an `s:` symbol is Swift's own, which
            // an Objective-C message cannot reach.
            for symbol in graph.symbols.into_iter().filter(|s| s.identifier.identifier.starts_with("c:")) {
                let into = if symbol.is_async() { &mut asynchronous } else { &mut by_usr };
                into.insert(symbol.identifier.identifier.clone(), symbol);
            }
            optional.extend(graph.relationships.into_iter().filter(|r| r.kind == "optionalRequirementOf").map(|r| r.source));
        }
        Ok(Self { by_usr, asynchronous, optional })
    }

    fn get(&self, usr: &str) -> Option<&Symbol> {
        self.by_usr.get(usr)
    }

    /// The name Swift gives Objective-C class `class`: `Timer` for `NSTimer`.
    fn class(&self, class: &str) -> String {
        self.get(&format!("c:objc(cs){class}")).map_or_else(|| class.to_owned(), |s| s.names.title.clone())
    }
}

/// One bound class, as TypeScript declares it.
struct Class {
    objc: String,
    swift: String,
    parent: Option<String>,
    members: Vec<String>,
    skipped: Vec<String>,
    /// Every message a bound member sends, for the witness.
    sent: Vec<Sent>,
}

/// One requested protocol, as the interface a TypeScript class implements:
/// its methods are the ones the class writes and Objective-C sends.
struct Protocol {
    objc: String,
    swift: String,
    members: Vec<String>,
    skipped: Vec<String>,
}

/// One method a protocol requires or offers, before it is named.
struct Requirement {
    selector: String,
    base: String,
    labels: Vec<String>,
    optional: bool,
    /// The parameter list and result, as the TypeScript method is written.
    parameters: String,
    result: String,
}

/// One message the binding sends, as the witness checks it against the
/// running runtime: to the class or to an instance, with its arity.
struct Sent {
    selector: String,
    class_side: bool,
}

/// An enum a signature names, and where Swift puts it.
struct Enum {
    /// `["NSWindow", "StyleMask"]`.
    path: Vec<String>,
    /// Each case's Swift name and value.
    cases: Vec<(String, i128)>,
}

/// What a member name is on a class, so a descendant does not redeclare it as
/// the other kind -- which TypeScript refuses, and Swift never does.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Named {
    Property,
    Method,
}

/// A declaration, and the class or protocol whose USR it is under.
#[derive(Clone)]
struct Origin<'v> {
    decl: &'v Value,
    /// `c:objc(cs)NSWindow` or `c:objc(pl)NSObject`.
    container: String,
}

/// The classes, enums and structs the binding describes.
struct Model<'a> {
    swift: &'a Swift,
    headers: &'a Dumped,
    bound: &'a BTreeSet<String>,
    /// The deployment target: a member Swift marks as introduced after it, or
    /// deprecated by it, is not bound.
    target: Version,
    classes: Vec<Class>,
    protocols: Vec<Protocol>,
    /// Classes a signature names that are not bound, by Objective-C name,
    /// with their nearest bound ancestor's.
    mentioned: BTreeMap<String, Option<String>>,
    records: BTreeSet<String>,
    enums: BTreeMap<String, Enum>,
    /// What each module the binding imports from provides it, by module.
    imports: BTreeMap<&'static str, BTreeSet<&'static str>>,
    /// Swift's `async` imports, each a function of the values module.
    promises: Vec<Promise>,
}

/// A method's `async` form: a function of the values module, which the
/// binding's `@ntsCall` overload names, returning a promise the completion
/// handler settles.
struct Promise {
    function: String,
    /// The TypeScript class the method is on: the function's first parameter.
    receiver: String,
    /// The method taking the handler, as TypeScript calls it.
    method: String,
    /// The parameters after the receiver, as the overload declares them, and
    /// their names, as the call passes them on.
    parameters: String,
    names: Vec<String>,
    /// What the promise resolves with: `void`, the handler's one value, or
    /// the tuple of its several.
    value: String,
    /// How many values the handler is given before any error.
    arity: usize,
    /// Whether the handler is also given an `NSError`, which rejects the
    /// promise when it is set, as Swift's `async throws` throws it; and
    /// whether the value is spelled nullable, which it is not once the error
    /// is not set.
    throws: bool,
    nullable: bool,
}

/// Per class, while it is read.
struct Reading<'v> {
    /// Selectors and properties already bound, the class's own first.
    seen: BTreeSet<String>,
    /// Member names, the ancestors' included, by `static` and name.
    names: BTreeMap<(bool, String), Named>,
    /// What a descendant repeats at its own type: initializers and
    /// `instancetype` methods, which TypeScript would otherwise type at this
    /// class, or hide behind the descendant's own constructors.
    repeated: Vec<Origin<'v>>,
    /// Every method bound under a name, the ancestors' included. Swift
    /// overloads across a hierarchy -- `NSObject`'s `isEqual(_:)` beside
    /// `NSString`'s `isEqual(to:)` -- and TypeScript takes a class's
    /// overloads of a name as all it has, so a class declaring a name repeats
    /// its ancestors' overloads of it, or it would not be their subtype.
    overloads: BTreeMap<(bool, String), Vec<Origin<'v>>>,
    /// The names this class binds a method under itself.
    own: BTreeSet<(bool, String)>,
}

impl<'a> Model<'a> {
    fn read(swift: &'a Swift, headers: &'a Dumped, bodies: &'a Dumped, bound: &'a BTreeSet<String>, target: Version) -> Self {
        let mut model = Model {
            swift,
            headers,
            bound,
            target,
            classes: Vec::new(),
            protocols: Vec::new(),
            mentioned: BTreeMap::new(),
            records: BTreeSet::new(),
            enums: BTreeMap::new(),
            imports: BTreeMap::new(),
            promises: Vec::new(),
        };
        let mut read: BTreeMap<String, Reading<'a>> = BTreeMap::new();
        for (class, parent) in root_first(bound, &headers.supers) {
            let container = format!("c:objc(cs){class}");
            let mut decls: Vec<Origin<'a>> = bodies
                .bodies
                .get(&class)
                .map(|b| b.iter().map(|decl| Origin { decl, container: container.clone() }).collect())
                .unwrap_or_default();
            if class == "NSObject" {
                decls.extend(bodies.root_protocol.iter().map(|decl| Origin { decl, container: "c:objc(pl)NSObject".to_owned() }));
            }
            decls.sort_by_key(|origin| origin.decl.get("kind").and_then(Value::as_str) != Some("ObjCPropertyDecl"));
            let (inherited, names, overloads) = parent
                .as_ref()
                .and_then(|p| read.get(p))
                .map(|r| (r.repeated.clone(), r.names.clone(), r.overloads.clone()))
                .unwrap_or_default();
            let mut reading =
                Reading { seen: BTreeSet::new(), names, repeated: Vec::new(), overloads: overloads.clone(), own: BTreeSet::new() };
            let mut bound = Class {
                swift: swift.class(&class),
                parent: parent.as_ref().map(|p| swift.class(p)),
                objc: class.clone(),
                members: Vec::new(),
                skipped: Vec::new(),
                sent: Vec::new(),
            };
            for origin in decls.into_iter().chain(inherited) {
                model.member(&mut bound, origin, &mut reading);
            }
            for name in reading.own.clone() {
                for origin in overloads.get(&name).into_iter().flatten() {
                    model.member(&mut bound, origin.clone(), &mut reading);
                }
            }
            read.insert(class, reading);
            model.classes.push(bound);
        }
        for (name, decls) in &bodies.protocols {
            let protocol = model.protocol(name, decls);
            model.protocols.push(protocol);
        }
        model
    }

    /// A protocol as Swift imports it: an interface of the methods a class
    /// adopting it implements, each tagged with the selector it answers and
    /// marked `?` where Swift marks it `optional`. Delegate protocols name
    /// most methods alike -- `parser(_:didStartElement:...)`,
    /// `parser(_:foundCharacters:)` -- and TypeScript one member per name, so
    /// a shared base name takes its first label: `parserDidStartElement`.
    fn protocol(&mut self, objc: &str, decls: &[Value]) -> Protocol {
        let container = format!("c:objc(pl){objc}");
        let swift = self.swift.get(&container).map_or_else(|| objc.to_owned(), |s| s.names.title.clone());
        let adopter = Class { objc: objc.to_owned(), swift: swift.clone(), parent: None, members: Vec::new(), skipped: Vec::new(), sent: Vec::new() };
        let mut requirements = Vec::new();
        let mut skipped = Vec::new();
        for decl in decls.iter().filter(|d| d.get("isImplicit").and_then(Value::as_bool) != Some(true)) {
            let Some(name) = named(decl) else { continue };
            match decl.get("kind").and_then(Value::as_str) {
                Some("ObjCMethodDecl") if decl.get("instance").and_then(Value::as_bool) == Some(false) => {
                    skipped.push(format!("+{name}: a class-side requirement, which a TypeScript class cannot write"));
                }
                Some("ObjCMethodDecl") => {
                    let usr = format!("{container}(im){name}");
                    let Some(symbol) = self.swift.get(&usr).cloned() else { continue };
                    match self.available(&symbol).and_then(|()| self.requirement(&adopter, decl, &symbol, self.swift.optional.contains(&usr))) {
                        Ok(requirement) => requirements.push(requirement),
                        Err(why) => skipped.push(format!("-{name}: {why}")),
                    }
                }
                Some("ObjCPropertyDecl") => skipped.push(format!("@property {name}: a property requirement, which a class implements as accessors")),
                _ => {}
            }
        }
        let mut bases: BTreeMap<&str, usize> = BTreeMap::new();
        for requirement in &requirements {
            *bases.entry(requirement.base.as_str()).or_default() += 1;
        }
        // Swift's own names are reserved before any is derived, so a derived
        // `applicationDidUpdate` (`application(_:didUpdate:)`) never takes
        // the name of the method Swift calls that.
        let unique = |requirement: &Requirement| bases.get(requirement.base.as_str()) == Some(&1);
        let mut taken: BTreeSet<String> = requirements.iter().filter(|r| unique(r)).map(|r| r.base.clone()).collect();
        let mut members = Vec::new();
        for requirement in &requirements {
            let name = if unique(requirement) {
                requirement.base.clone()
            } else {
                let first = requirement.labels.iter().find(|l| *l != "_").map(|l| format!("{}{}", requirement.base, capitalized(l)));
                first.filter(|name| !taken.contains(name)).unwrap_or_else(|| selector_name(&requirement.selector))
            };
            if !unique(requirement) && !taken.insert(name.clone()) {
                skipped.push(format!("-{}: named `{name}` as another requirement is", requirement.selector));
                continue;
            }
            members.push(format!(
                "    /** @ntsSelector {} */\n    {}{}({}): {};",
                requirement.selector,
                quoted(&name),
                if requirement.optional { "?" } else { "" },
                requirement.parameters,
                requirement.result
            ));
        }
        Protocol { objc: objc.to_owned(), swift, members, skipped }
    }

    /// A protocol method as the adopting class writes it: every argument
    /// positional, as Objective-C hands it over -- an object as itself, a
    /// string as the `NSString` it is.
    fn requirement(&mut self, adopter: &Class, decl: &Value, symbol: &Symbol, optional: bool) -> std::result::Result<Requirement, String> {
        if decl.get("variadic").and_then(Value::as_bool) == Some(true) {
            return Err("variadic".to_owned());
        }
        let (base, labels) = swift_name(&symbol.names.title);
        let mut parameters = Vec::new();
        for (at, parameter) in parameters_of(decl).into_iter().enumerate() {
            let spelled = self.spell(adopter, parameter.get("type").ok_or("a parameter with no type")?, Position::Block)?;
            let name = named(parameter).filter(|n| !n.is_empty() && !reserved(n)).unwrap_or_else(|| format!("arg{at}"));
            parameters.push(format!("{name}: {spelled}"));
        }
        let result = self.spell(adopter, decl.get("returnType").ok_or("no return type")?, Position::Block)?;
        Ok(Requirement { selector: named(decl).unwrap_or_default(), base, labels, optional, parameters: parameters.join(", "), result })
    }

    fn import(&mut self, module: &'static str, name: &'static str) {
        self.imports.entry(module).or_default().insert(name);
    }

    /// Bind one member of `class`: a method, or a property.
    fn member(&mut self, class: &mut Class, origin: Origin<'a>, reading: &mut Reading<'a>) {
        let decl = origin.decl;
        if decl.get("isImplicit").and_then(Value::as_bool) == Some(true) {
            return;
        }
        let (usr, key, shown) = match decl.get("kind").and_then(Value::as_str) {
            Some("ObjCMethodDecl") => {
                let Some(selector) = named(decl) else { return };
                let instance = decl.get("instance").and_then(Value::as_bool).unwrap_or(true);
                let sign = if instance { "-" } else { "+" };
                (format!("{}({}){selector}", origin.container, if instance { "im" } else { "cm" }), format!("{sign}{selector}"), format!("{sign}{selector}"))
            }
            Some("ObjCPropertyDecl") => {
                let Some(name) = named(decl) else { return };
                let class_property = decl.get("class").and_then(Value::as_bool) == Some(true);
                let tag = if class_property { "cpy" } else { "py" };
                (format!("{}({tag}){name}", origin.container), format!("{tag} {name}"), format!("@property {name}"))
            }
            _ => return,
        };
        if !reading.seen.insert(key) {
            return;
        }
        // Swift does not import it -- `alloc`, `new`, what it marks
        // unavailable -- so there is no such member to bind, and nothing to say.
        let Some(symbol) = self.swift.get(&usr).cloned() else { return };
        let bound = self.available(&symbol).and_then(|()| {
            let text = if decl.get("kind").and_then(Value::as_str) == Some("ObjCMethodDecl") {
                self.method(class, decl, &symbol)?
            } else {
                self.property(class, decl, &symbol)?
            };
            // Swift has `menu` and `menu(for:)` on one class, and TypeScript
            // one member per name: the first bound keeps it, and properties
            // are read first.
            let (is_static, name, named_as) = Self::shape(&symbol);
            if let Some(name) = name {
                match reading.names.get(&(is_static, name.clone())) {
                    Some(&existing) if existing != named_as => {
                        return Err(format!("Swift's `{name}` is also a {} here", if existing == Named::Property { "property" } else { "method" }));
                    }
                    _ => {
                        if named_as == Named::Method {
                            reading.overloads.entry((is_static, name.clone())).or_default().push(origin.clone());
                            reading.own.insert((is_static, name.clone()));
                        }
                        reading.names.insert((is_static, name), named_as);
                    }
                }
            }
            Ok(text)
        });
        let is_method = decl.get("kind").and_then(Value::as_str) == Some("ObjCMethodDecl");
        match bound {
            Ok(text) => {
                class.members.push(text);
                class.sent.extend(sent_by(decl));
                if let Some(asynchronous) = self.swift.asynchronous.get(&usr).filter(|_| is_method).cloned() {
                    match self.promise(class, decl, &symbol, &asynchronous) {
                        Ok(overload) => class.members.push(overload),
                        Err(why) => class.skipped.push(format!("{shown} as Swift's `async` form: {why}")),
                    }
                }
            }
            Err(why) => class.skipped.push(format!("{shown}: {why}")),
        }
        let initializer = symbol.kind.identifier == "swift.init";
        let instancetype = decl.get("returnType").map(written).is_some_and(|t| strip_availability(&t).starts_with("instancetype"));
        if initializer || instancetype {
            reading.repeated.push(origin);
        }
    }

    /// Whether the member exists at the deployment target: introduced by it,
    /// and not deprecated by it -- Swift warns at every use of one that is.
    fn available(&self, symbol: &Symbol) -> std::result::Result<(), String> {
        for availability in &symbol.availability {
            if availability.is_unconditionally_deprecated {
                return Err("deprecated".to_owned());
            }
            if !matches!(availability.domain.as_deref(), Some("macOS")) {
                continue;
            }
            if let Some(introduced) = availability.introduced.filter(|v| *v > self.target) {
                return Err(format!("introduced in macOS {}.{}", introduced.major, introduced.minor));
            }
            if let Some(deprecated) = availability.deprecated.filter(|v| *v <= self.target) {
                return Err(format!("deprecated in macOS {}.{}", deprecated.major, deprecated.minor));
            }
        }
        Ok(())
    }

    /// Whether a symbol is a static member, its TypeScript name (none for an
    /// initializer), and which kind of member that name is.
    fn shape(symbol: &Symbol) -> (bool, Option<String>, Named) {
        let kind = symbol.kind.identifier.as_str();
        let is_static = kind.starts_with("swift.type.");
        let named_as = if kind.ends_with("property") { Named::Property } else { Named::Method };
        let name = (kind != "swift.init").then(|| swift_name(&symbol.names.title).0);
        (is_static, name, named_as)
    }

    /// A method, under Swift's name: an initializer (a factory's too) as a
    /// constructor, and a getter Swift imports as a property as one.
    fn method(&mut self, class: &Class, decl: &Value, symbol: &Symbol) -> std::result::Result<String, String> {
        let selector = named(decl).unwrap_or_default();
        let instance = decl.get("instance").and_then(Value::as_bool).unwrap_or(true);
        if decl.get("variadic").and_then(Value::as_bool) == Some(true) {
            return Err("variadic".to_owned());
        }
        let parameters = parameters_of(decl);
        let result = decl.get("returnType").ok_or("no return type")?;
        let (base, labels) = swift_name(&symbol.names.title);
        let kind = symbol.kind.identifier.as_str();
        let modifier = if instance { "" } else { "static " };
        if kind.ends_with("property") {
            let spelled = self.spell(class, result, Position::Result)?;
            return Ok(format!("    /** @ntsSelector {selector} */\n    {modifier}get {}(): {spelled};", quoted_key(&base)));
        }
        // Swift took an argument away: the `NSError **` it throws instead of
        // passing, which the call leaves out and the compiler supplies.
        let throws = labels.len() + 1 == parameters.len()
            && parameters.last().and_then(|p| p.get("type")).and_then(desugared).is_some_and(|ty| unqualified(&ty) == "NSError**");
        let parameters = if throws { &parameters[..labels.len()] } else { &parameters[..] };
        if labels.len() != parameters.len() {
            return Err(format!("Swift's `{}` awaits a completion handler it passes as `async` (S5)", symbol.names.title));
        }
        let (arguments, _) = self.arguments(class, parameters, &labels)?;
        let mut tags = vec![format!("@ntsSelector {}", if kind == "swift.init" && !instance { format!("+{selector}") } else { selector })];
        if throws {
            tags.push("@ntsThrows error nts_nserror_message".to_owned());
        }
        let doc = documented(&tags);
        if kind == "swift.init" {
            return Ok(format!("{doc}    constructor({arguments});"));
        }
        // What Swift returns from a throwing method: nothing for `BOOL`, whose
        // `NO` is the error, and the object itself for a nullable one, whose
        // nil is.
        let result = match self.spell(class, result, Position::Result)? {
            _ if throws && written(result).starts_with("BOOL") => "void".to_owned(),
            spelled if throws => spelled.trim_end_matches(" | null").to_owned(),
            spelled => optional_as_swift(spelled, symbol.optionality() == Optionality::Optional),
        };
        Ok(format!("{doc}    {modifier}{}({arguments}): {result};", quoted(&base)))
    }

    /// Swift's `async` form of a method taking a completion handler, as the
    /// overload the binding declares beside it: the same arguments without
    /// the handler, returning a promise of what the handler is given. The
    /// promise is a function of the values module, which calls the method
    /// with a handler that settles it.
    fn promise(&mut self, class: &Class, decl: &Value, symbol: &Symbol, asynchronous: &Symbol) -> std::result::Result<String, String> {
        if decl.get("instance").and_then(Value::as_bool) == Some(false) {
            return Err("a class method, whose `async` form is not bound yet".to_owned());
        }
        let parameters = parameters_of(decl);
        let Some((handler, leading)) = parameters.split_last() else {
            return Err("no completion handler".to_owned());
        };
        let (base, labels) = swift_name(&asynchronous.names.title);
        let (method, method_labels) = swift_name(&symbol.names.title);
        if labels.len() != leading.len() || method_labels.get(..leading.len()) != Some(&labels[..]) {
            return Err("its arguments are labelled otherwise than the handler's method's".to_owned());
        }
        let written = strip_availability(&written(handler.get("type").ok_or("a handler with no type")?));
        if !written.contains("(^") {
            return Err("a last parameter that is not a block".to_owned());
        }
        let (given, result) = self.block_parts(class, &written)?;
        if result != "void" {
            return Err("a completion handler that returns a value".to_owned());
        }
        let is_error = |spelled: &String| spelled.starts_with("NSError");
        // The values the promise resolves with, and whether an `NSError`
        // comes after them: Swift's `async throws`.
        let (values, throws) = match given.split_last() {
            Some((error, values)) if is_error(error) => (values.to_vec(), true),
            _ => (given.clone(), false),
        };
        if values.iter().any(is_error) {
            return Err("a handler given an `NSError` before its last argument".to_owned());
        }
        let arity = values.len();
        // Swift returns what a throwing handler is given as not optional once
        // there is no error.
        let values: Vec<String> = values.iter().map(|v| if throws { v.trim_end_matches(" | null").to_owned() } else { v.clone() }).collect();
        // Several values are Swift's tuple: `async -> (Data, URLResponse)`.
        let value = match values.as_slice() {
            [] => "void".to_owned(),
            [one] => one.clone(),
            many => format!("[{}]", many.join(", ")),
        };
        // Swift's `throws` rejects with the error's description, which is
        // read through the binding's `NSError`.
        if throws && !self.bound.contains("NSError") {
            return Err("a handler given an `NSError`, whose description the promise rejects with: bind `NSError` too (`--class NSError`)".to_owned());
        }
        let nullable = given.iter().take(arity).any(|v| v.ends_with(" | null"));
        let (arguments, names) = self.arguments(class, leading, &labels)?;
        let mut function = format!("nts_async_{}_{base}", class.objc);
        while self.promises.iter().any(|promise| promise.function == function) {
            function.push('_');
        }
        let overload = format!("    /** @ntsCall {function} */\n    {}({arguments}): Promise<{value}>;", quoted(&base));
        self.promises.push(Promise {
            function,
            receiver: class.swift.rsplit('.').next().unwrap_or_default().to_owned(),
            method: quoted(&method),
            parameters: arguments,
            names,
            value,
            arity,
            throws,
            nullable,
        });
        Ok(overload)
    }

    /// Swift's rule for the arguments: the unlabelled ones first, positional,
    /// and every one from the first label on in one object, keyed by its
    /// label, which the call passes as a literal the compiler never builds.
    fn arguments(&mut self, class: &Class, parameters: &[&Value], labels: &[String]) -> std::result::Result<(String, Vec<String>), String> {
        let mut positional = Vec::new();
        let mut labelled = Vec::new();
        let mut trailing = None;
        for (at, (parameter, label)) in parameters.iter().zip(labels).enumerate() {
            let spelled = self.spell(class, parameter.get("type").ok_or("a parameter with no type")?, Position::Parameter)?;
            let name = named(parameter).filter(|n| !n.is_empty() && !reserved(n) && n != "labels").unwrap_or_else(|| format!("arg{at}"));
            // Swift's trailing closure: a block last is passed after the
            // labels, unlabelled, as `sort { a, b in ... }` is written.
            if at + 1 == parameters.len() && spelled.contains(") => ") {
                trailing = Some(format!("{name}: {spelled}"));
            } else if label == "_" && labelled.is_empty() {
                positional.push(format!("{name}: {spelled}"));
            } else {
                labelled.push(format!("{}: {spelled}", quoted_key(if label == "_" { &name } else { label })));
            }
        }
        let mut keys = BTreeSet::new();
        if let Some(repeated) = labelled.iter().map(|l| l.split_once(": ").map_or(l.as_str(), |(k, _)| k)).find(|k| !keys.insert(*k)) {
            return Err(format!("Swift repeats the label `{repeated}`, which one object cannot"));
        }
        if !labelled.is_empty() {
            positional.push(format!("labels: {{ {} }}", labelled.join("; ")));
        }
        positional.extend(trailing);
        let names = positional.iter().map(|p| p.split_once(':').map_or(p.as_str(), |(name, _)| name).to_owned()).collect();
        Ok((positional.join(", "), names))
    }

    /// A property, under Swift's name, as the accessors an Objective-C
    /// property is: `get title(): string` and `set title(value: string)`,
    /// each tagged where its selector is not the one the name implies --
    /// `isHidden` is read with `isHidden` and written with `setHidden:`.
    /// Accessors and not a field, so a subclass the program writes overrides
    /// one (`override var isFlipped: Bool`) as TypeScript allows an accessor
    /// to override an accessor, and refuses it to override a field.
    fn property(&mut self, class: &Class, decl: &Value, symbol: &Symbol) -> std::result::Result<String, String> {
        let name = named(decl).unwrap_or_default();
        let clang = self.spell(class, decl.get("type").ok_or("no type")?, Position::Result)?;
        let spelled = optional_as_swift(clang.clone(), symbol.optionality() == Optionality::Optional);
        // What the setter takes: `null` too for a `null_resettable` property,
        // which Swift writes `T!`.
        let written = optional_as_swift(spelled.clone(), symbol.optionality() != Optionality::Neither);
        let readonly = decl.get("readonly").and_then(Value::as_bool) == Some(true);
        let swift_name = symbol.names.title.clone();
        let getter = decl.get("getter").and_then(named).unwrap_or_else(|| name.clone());
        let setter = decl.get("setter").and_then(named).unwrap_or_else(|| format!("set{}:", capitalized(&name)));
        let is_static = if decl.get("class").and_then(Value::as_bool) == Some(true) { "static " } else { "" };
        let key = quoted_key(&swift_name);
        let mut text = String::new();
        if getter != swift_name {
            let _ = writeln!(text, "    /** @ntsSelector {getter} */");
        }
        let _ = write!(text, "    {is_static}get {key}(): {spelled};");
        if !readonly {
            let _ = writeln!(text);
            if setter != format!("set{}:", capitalized(&swift_name)) {
                let _ = writeln!(text, "    /** @ntsSet {setter} */");
            }
            let _ = write!(text, "    {is_static}set {key}(value: {written});");
        }
        Ok(text)
    }

    fn spell(&mut self, class: &Class, ty: &Value, position: Position) -> Spelled {
        let written = strip_availability(&written(ty));
        let desugared = desugared(ty).unwrap_or_default();
        let or_null = |text: String| if written.contains("_Nullable") { format!("{text} | null") } else { text };
        if written.contains("(^") || desugared.contains("(^") {
            return match position {
                Position::Parameter => self.block(class, &written),
                Position::Block => Err("a block that takes or returns a block".to_owned()),
                // A block the program is handed has no closure to be.
                Position::Result => Err("a block as a result or a property".to_owned()),
            };
        }
        // A typedef clang left unexpanded -- a block's parameters are only
        // ever spelled: an enum by its name.
        if let Some(name) = written.split_whitespace().next().filter(|name| desugared == written && self.headers.enums.contains_key(*name)) {
            return self.enumeration(name);
        }
        if (written.starts_with("BOOL") && !written.contains('*')) || desugared == "bool" || desugared == "_Bool" {
            return Ok("boolean".to_owned());
        }
        if desugared == "void" {
            return Ok("void".to_owned());
        }
        if written.starts_with("instancetype") {
            return Ok(or_null(class.swift.clone()));
        }
        if written.starts_with("SEL") {
            self.import("objc:runtime", "Selector");
            return Ok("Selector".to_owned());
        }
        if written.starts_with("Class") {
            self.import("objc:runtime", "ClassObject");
            return Ok(or_null("ClassObject".to_owned()));
        }
        if desugared == "id" || desugared.starts_with("id<") {
            return Ok(or_null(self.object("NSObject")));
        }
        if let Some(number) = swift_number(&written, &desugared) {
            self.import("objc:types", number);
            return Ok(number.to_owned());
        }
        if let Some(name) = desugared.strip_prefix("enum ") {
            return self.enumeration(name);
        }
        if let Some(pointee) = desugared.strip_suffix(" *") {
            let pointee = pointee.trim_start_matches("__kindof ");
            let base = pointee.split('<').next().unwrap_or_default().trim();
            if base == "NSString" && position != Position::Block {
                return Ok(or_null("string".to_owned()));
            }
            // Swift's `[T]`: an `NSArray` is copied into a TypeScript array and
            // out of one, its elements objects or strings. Not a mutable one,
            // which Swift keeps as the object it is.
            if base == "NSArray" && position != Position::Block {
                // Swift's `[T]?` where the header says `_Nullable`.
                return self.array_element(pointee).map(|element| or_null(format!("{element}[]")));
            }
            if position != Position::Block
                && matches!(base, "NSMutableArray" | "NSDictionary" | "NSMutableDictionary" | "NSSet" | "NSMutableSet" | "NSOrderedSet")
            {
                return Err(format!("a collection, `{base}`, which crosses as an object when it is bound"));
            }
            if self.headers.supers.contains_key(base) {
                return Ok(or_null(self.object(base)));
            }
            if position == Position::Parameter && (pointee == "const char" || pointee == "char") {
                self.import("objc:types", "CString");
                return Ok("CString".to_owned());
            }
            return Err(format!("a `{desugared}`"));
        }
        if let Some(name) = desugared.strip_prefix("struct ").filter(|name| !name.ends_with('*')) {
            self.record(name)?;
            self.import("c:types", "ByValue");
            return Ok(format!("ByValue<{name}>"));
        }
        Err(format!("a `{desugared}`"))
    }

    /// A block as the function type a TypeScript closure passed for it has:
    /// `void (^)(NSTimer *)` is `(arg0: Timer) => void`. Clang writes a
    /// block's type as one spelling, which is read apart here: the result
    /// before `(^`, and the parameters in the last parentheses.
    fn block(&mut self, class: &Class, written: &str) -> Spelled {
        let (given, result) = self.block_parts(class, written)?;
        let given: Vec<String> = given.iter().enumerate().map(|(at, ty)| format!("arg{at}: {ty}")).collect();
        Ok(format!("({}) => {result}", given.join(", ")))
    }

    /// A block's parameters and result, each spelled as a block's are.
    fn block_parts(&mut self, class: &Class, written: &str) -> std::result::Result<(Vec<String>, String), String> {
        let (result, rest) = written.split_once("(^").ok_or("a block clang spells another way")?;
        let open = rest.find(")(").ok_or("a block clang spells another way")? + 1;
        let parameters = rest[open..].trim().strip_prefix('(').and_then(|p| p.strip_suffix(')')).ok_or("a block clang spells another way")?;
        let mut spelled = Vec::new();
        let mut depth = 0usize;
        let mut start = 0;
        let mut pieces = Vec::new();
        for (at, c) in parameters.char_indices() {
            match c {
                '(' | '<' => depth += 1,
                ')' | '>' => depth = depth.saturating_sub(1),
                ',' if depth == 0 => {
                    pieces.push(&parameters[start..at]);
                    start = at + 1;
                }
                _ => {}
            }
        }
        pieces.push(&parameters[start..]);
        for piece in pieces.iter().map(|p| p.trim()).filter(|p| !p.is_empty() && *p != "void") {
            spelled.push(self.spell(class, &block_part(piece, &self.headers.typedefs), Position::Block)?);
        }
        let result = match result.trim() {
            "void" => "void".to_owned(),
            result => self.spell(class, &block_part(result, &self.headers.typedefs), Position::Block)?,
        };
        Ok((spelled, result))
    }

    /// What an `NSArray<T *>` holds, as the element of a TypeScript array:
    /// a class's objects, strings for `NSString`, and `NSObject` where the
    /// header says only `id`.
    fn array_element(&mut self, pointee: &str) -> Spelled {
        let argument = pointee.split_once('<').map_or("id", |(_, rest)| rest.trim_end_matches('>').trim());
        let argument = argument.trim_start_matches("__kindof ").trim();
        if argument == "id" || argument.starts_with("id<") {
            return Ok(self.object("NSObject"));
        }
        // `NSView<NSCollectionViewElement> *`: the class, whose protocols a
        // TypeScript array element does not carry.
        let class = argument.trim_end_matches('*').trim();
        let class = class.split_once('<').map_or(class, |(class, _)| class.trim());
        // `NSPasteboardType`, a typedef of `NSString *` Swift wraps as a
        // struct of statics: a string here, as it is outside an array.
        if let Some(aliased) = self.headers.typedefs.get(class).cloned()
            && aliased.trim_end_matches('*').trim() != class
        {
            return self.array_element(&format!("NSArray<{aliased}>"));
        }
        if class == "NSString" {
            return Ok("string".to_owned());
        }
        if self.headers.supers.contains_key(class) {
            return Ok(self.object(class));
        }
        Err(format!("an array of `{argument}`"))
    }

    /// A C enum as the Swift type it is imported as, carrying its width:
    /// `CEnum<NSWindow.StyleMask, UInt>`. One Swift does not name crosses as
    /// its width alone.
    fn enumeration(&mut self, name: &str) -> Spelled {
        let width = self.headers.enums.get(name).ok_or_else(|| format!("enum `{name}`, which has no fixed width"))?;
        let brand = swift_number(width, width).ok_or_else(|| format!("enum `{name}`, as wide as a `{width}`"))?;
        self.import("objc:types", brand);
        let Some(symbol) = self.swift.get(&format!("c:@E@{name}")).cloned() else { return Ok(brand.to_owned()) };
        if !self.enums.contains_key(name) {
            let mut titles = BTreeSet::new();
            let cases = self
                .headers
                .constants
                .get(name)
                .into_iter()
                .flatten()
                .filter_map(|(constant, value)| {
                    let case = self.swift.get(&format!("c:@E@{name}@{constant}"))?;
                    // A renamed case keeps its old spelling as a second,
                    // deprecated symbol of the same title.
                    let title = case.path.last()?.clone();
                    (self.available(case).is_ok() && titles.insert(title.clone())).then_some((title, *value))
                })
                .collect();
            self.enums.insert(name.to_owned(), Enum { path: symbol.path.clone(), cases });
        }
        self.import("c:types", "CEnum");
        // An `NS_OPTIONS` is Swift's `OptionSet`, whose empty set is `[]`:
        // here `0`, which is no case of the enum.
        let empty = if symbol.kind.identifier == "swift.struct" { " | 0" } else { "" };
        Ok(format!("CEnum<{}{empty}, {brand}>", symbol.path.join(".")))
    }

    /// Objective-C class `name` as a signature names it: by its Swift name,
    /// and declared as a class with no members when it is not bound.
    fn object(&mut self, name: &str) -> String {
        if !self.bound.contains(name) && !self.mentioned.contains_key(name) {
            let mut parent = self.headers.supers.get(name).cloned().flatten();
            while let Some(p) = parent.clone() {
                if self.bound.contains(&p) {
                    break;
                }
                parent = self.headers.supers.get(&p).cloned().flatten();
            }
            self.mentioned.insert(name.to_owned(), parent);
        }
        self.swift.class(name)
    }

    /// Record `name` as one a signature passes by value, and every record it
    /// holds, so each is declared.
    fn record(&mut self, name: &str) -> std::result::Result<(), String> {
        let fields = self.headers.records.get(name).ok_or_else(|| format!("struct `{name}`, which no header here defines"))?.clone();
        if self.records.contains(name) {
            return Ok(());
        }
        for (field, ty) in &fields {
            if let Some(inner) = ty.strip_prefix("struct ") {
                self.record(inner)?;
            } else if let Some(number) = swift_number(ty, ty) {
                self.import("objc:types", number);
            } else {
                return Err(format!("struct `{name}`, whose member `{field}` is a `{ty}`"));
            }
        }
        self.import("c:types", "Struct");
        self.records.insert(name.to_owned());
        Ok(())
    }
}

/// The messages a bound declaration sends: a method's selector, or a
/// property's getter and, unless it is read-only, its setter.
/// A value's spelling, made nullable where Swift's declaration is optional
/// and clang's printed type lost it. Only an object or a string, which is
/// what can be nil; a number Swift makes optional is another matter.
fn optional_as_swift(spelled: String, optional: bool) -> String {
    let object = !matches!(spelled.as_str(), "boolean" | "void") && !spelled.starts_with("CEnum<") && !spelled.starts_with("ByValue<");
    let numeric = spelled.chars().next().is_some_and(|c| c.is_ascii_uppercase()) && spelled.len() <= 7 && !spelled.contains('<');
    if object && !numeric && !spelled.ends_with(" | null") && optional {
        format!("{spelled} | null")
    } else {
        spelled
    }
}

/// A method declaration's parameters, in order.
fn parameters_of(decl: &Value) -> Vec<&Value> {
    decl.get("inner")
        .and_then(Value::as_array)
        .map(|inner| inner.iter().filter(|p| p.get("kind").and_then(Value::as_str) == Some("ParmVarDecl")).collect())
        .unwrap_or_default()
}

/// A selector as one name, each piece after the first capitalized:
/// `parser:didStartElement:` is `parserDidStartElement`.
fn selector_name(selector: &str) -> String {
    let mut pieces = selector.split(':').filter(|p| !p.is_empty());
    let first = pieces.next().unwrap_or_default().to_owned();
    pieces.fold(first, |name, piece| name + &capitalized(piece))
}

fn sent_by(decl: &Value) -> Vec<Sent> {
    let Some(name) = named(decl) else { return Vec::new() };
    match decl.get("kind").and_then(Value::as_str) {
        Some("ObjCMethodDecl") => {
            vec![Sent { selector: name, class_side: decl.get("instance").and_then(Value::as_bool) == Some(false) }]
        }
        Some("ObjCPropertyDecl") => {
            let class_side = decl.get("class").and_then(Value::as_bool) == Some(true);
            let getter = decl.get("getter").and_then(named).unwrap_or_else(|| name.clone());
            let mut sent = vec![Sent { selector: getter, class_side }];
            if decl.get("readonly").and_then(Value::as_bool) != Some(true) {
                let setter = decl.get("setter").and_then(named).unwrap_or_else(|| format!("set{}:", capitalized(&name)));
                sent.push(Sent { selector: setter, class_side });
            }
            sent
        }
        _ => Vec::new(),
    }
}

/// Each class of `bound` with its superclass, every class after its own.
fn root_first(bound: &BTreeSet<String>, supers: &BTreeMap<String, Option<String>>) -> Vec<(String, Option<String>)> {
    let mut placed = BTreeSet::new();
    let mut order = Vec::new();
    while placed.len() < bound.len() {
        for name in bound {
            let parent = supers.get(name).cloned().flatten();
            if !placed.contains(name) && parent.as_ref().is_none_or(|p| placed.contains(p)) {
                order.push((name.clone(), parent));
                placed.insert(name.clone());
            }
        }
    }
    order
}

/// One part of a block's spelling as clang's type record would give it: the
/// spelling as written, and without its nullability and ownership qualifiers
/// as the type it is.
fn block_part(spelling: &str, typedefs: &BTreeMap<String, String>) -> Value {
    let bare: Vec<&str> = spelling
        .split_whitespace()
        .filter(|word| !matches!(*word, "_Nullable" | "_Nonnull" | "_Null_unspecified" | "__strong" | "__autoreleasing" | "__unsafe_unretained"))
        .collect();
    let mut bare = bare.join(" ");
    // A typedef, as far down as it goes: `NSModalResponse` is `NSInteger`,
    // which is `long`. An enum's name is kept, since the enum is what Swift
    // names it by.
    for _ in 0..8 {
        match typedefs.get(&bare) {
            Some(aliased) if !aliased.starts_with("enum ") => bare = aliased.clone(),
            _ => break,
        }
    }
    serde_json::json!({ "qualType": spelling, "desugaredQualType": bare })
}

/// A pointer type's spelling with its qualifiers and spaces gone:
/// `NSError * _Nullable * _Nullable` is `NSError**`.
fn unqualified(ty: &str) -> String {
    ty.split_whitespace()
        .filter(|word| !matches!(*word, "_Nullable" | "_Nonnull" | "_Null_unspecified" | "__autoreleasing" | "__strong" | "const"))
        .collect::<String>()
}

/// A member's doc comment carrying `tags`, each on a line of its own where
/// there is more than one, as the tag reader wants them.
fn documented(tags: &[String]) -> String {
    if let [one] = tags {
        return format!("    /** {one} */\n");
    }
    let mut doc = "    /**\n".to_owned();
    for tag in tags {
        let _ = writeln!(doc, "     * {tag}");
    }
    doc.push_str("     */\n");
    doc
}

/// `setFrame(_:display:)` as its base name and its labels, `_` for none.
fn swift_name(title: &str) -> (String, Vec<String>) {
    let Some((base, rest)) = title.split_once('(') else { return (title.to_owned(), Vec::new()) };
    let labels = rest.trim_end_matches(')').split(':').filter(|l| !l.is_empty()).map(str::to_owned).collect();
    (base.to_owned(), labels)
}

/// The name Swift gives a C number: by its written spelling where that is a
/// name Swift keeps (`CGFloat`, `NSInteger` as `Int`), and otherwise by its C
/// type.
fn swift_number(written: &str, desugared: &str) -> Option<&'static str> {
    Some(match written.split_whitespace().next().unwrap_or_default() {
        "CGFloat" => "CGFloat",
        "NSTimeInterval" => "TimeInterval",
        "NSInteger" => "Int",
        "NSUInteger" => "UInt",
        _ => match desugared {
            "double" => "Double",
            "float" => "Float",
            "int" => "Int32",
            "unsigned int" => "UInt32",
            "long" => "Int",
            "unsigned long" => "UInt",
            "long long" => "Int64",
            "unsigned long long" => "UInt64",
            "short" => "Int16",
            "unsigned short" => "UInt16",
            "char" | "signed char" => "Int8",
            "unsigned char" => "UInt8",
            _ => return None,
        },
    })
}

/// A member or label name as TypeScript accepts it in a type.
fn quoted_key(name: &str) -> String {
    let identifier = name.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
    if identifier { name.to_owned() } else { format!("\"{name}\"") }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Position {
    Parameter,
    Result,
    /// A parameter or result of a block: an object as it is, since a block
    /// bridges no string or array.
    Block,
}

/// `API_AVAILABLE(macos(11.0)) NSString *` is how clang writes an annotated
/// type; the annotation says nothing about how it crosses.
fn strip_availability(written: &str) -> String {
    let mut text = written.trim().to_owned();
    while text.starts_with("API_") {
        let Some(open) = text.find('(') else { break };
        let mut depth = 0usize;
        let mut end = None;
        for (at, c) in text[open..].char_indices() {
            match c {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(open + at + 1);
                        break;
                    }
                }
                _ => {}
            }
        }
        let Some(end) = end else { break };
        text = text[end..].trim().to_owned();
    }
    text
}

fn capitalized(text: &str) -> String {
    let mut letters = text.chars();
    letters.next().map(|c| c.to_ascii_uppercase()).into_iter().chain(letters).collect()
}

/// `new` opens a construct signature where a method name is written, so it is
/// quoted; the rest are names a member may have.
fn quoted(name: &str) -> String {
    if name == "new" { "\"new\"".to_owned() } else { name.to_owned() }
}

/// Names a parameter may not have.
fn reserved(name: &str) -> bool {
    matches!(
        name,
        "break" | "case" | "catch" | "class" | "const" | "continue" | "debugger" | "default" | "delete" | "do" | "else"
            | "enum" | "export" | "extends" | "false" | "finally" | "for" | "function" | "if" | "import" | "in"
            | "instanceof" | "new" | "null" | "return" | "super" | "switch" | "this" | "throw" | "true" | "try"
            | "typeof" | "var" | "void" | "while" | "with" | "yield" | "let" | "static" | "implements" | "interface"
            | "package" | "private" | "protected" | "public" | "await"
    )
}

/// A declaration written at the top of the module, `text`, placed where Swift
/// nests the type it declares: `NSWindow.StyleMask` inside `namespace
/// NSWindow`, which merges with the class.
fn nest(out: &mut String, path: &[String], text: &str) {
    let owners = path.split_last().map_or(&[][..], |(_, owners)| owners);
    out.push('\n');
    for (depth, owner) in owners.iter().enumerate() {
        let _ = writeln!(out, "{}export namespace {owner} {{", "  ".repeat(depth + 1));
    }
    let indent = "  ".repeat(owners.len());
    for line in text.lines() {
        let _ = writeln!(out, "{indent}{line}");
    }
    for depth in (0..owners.len()).rev() {
        let _ = writeln!(out, "{}}}", "  ".repeat(depth + 1));
    }
}

fn render(request: &Request, model: &Model) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "// Generated by `nts bind-objc` from the macOS SDK and Swift's symbol graphs. Do not edit: regenerate.\n//\n\
         // nts bind-objc --module {} {} {}",
        request.module,
        request.frameworks.iter().map(|f| format!("--framework {f}")).collect::<Vec<_>>().join(" "),
        request
            .classes
            .iter()
            .map(|c| format!("--class {c}"))
            .chain(request.protocols.iter().map(|p| format!("--protocol {p}")))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let _ = writeln!(out, "/**");
    for framework in &request.frameworks {
        let _ = writeln!(out, " * @ntsFramework {framework}");
    }
    let _ = writeln!(out, " */\ndeclare module \"{}\" {{", request.module);
    for (module, names) in &model.imports {
        let _ = writeln!(out, "  import type {{ {} }} from \"{module}\";", names.iter().copied().collect::<Vec<_>>().join(", "));
    }
    for name in &model.records {
        let fields = model.headers.records.get(name).map(Vec::as_slice).unwrap_or_default();
        let members: Vec<String> = fields
            .iter()
            .map(|(field, ty)| {
                let spelled = ty.strip_prefix("struct ").map_or_else(|| swift_number(ty, ty).unwrap_or("never").to_owned(), str::to_owned);
                format!("{field}: {spelled}")
            })
            .collect();
        let _ = writeln!(out, "\n  export type {name} = Struct<{{ {} }}, \"{name}\">;", members.join("; "));
    }
    for enumeration in model.enums.values() {
        let mut text = String::new();
        let name = enumeration.path.last().map_or("", String::as_str);
        let _ = writeln!(text, "  export const enum {name} {{");
        for (case, value) in &enumeration.cases {
            let _ = writeln!(text, "    {} = {value},", quoted_key(case));
        }
        let _ = writeln!(text, "  }}");
        nest(&mut out, &enumeration.path, &text);
    }
    for class in &model.classes {
        let extends = class.parent.as_ref().map(|p| format!(" extends {p}")).unwrap_or_default();
        let path: Vec<String> = class.swift.split('.').map(str::to_owned).collect();
        let mut text = String::new();
        let _ = writeln!(text, "  /** @ntsClass {} */\n  export class {}{extends} {{", class.objc, path.last().map_or("", String::as_str));
        for line in &class.members {
            let _ = writeln!(text, "{line}");
        }
        if !class.skipped.is_empty() {
            let _ = writeln!(text, "    // Not bound, each for the reason given:");
            for line in &class.skipped {
                let _ = writeln!(text, "    //   {line}");
            }
        }
        let _ = writeln!(text, "  }}");
        nest(&mut out, &path, &text);
    }
    for protocol in &model.protocols {
        let path: Vec<String> = protocol.swift.split('.').map(str::to_owned).collect();
        let mut text = String::new();
        let _ = writeln!(text, "  /** @ntsProtocol {} */\n  export interface {} {{", protocol.objc, path.last().map_or("", String::as_str));
        for line in &protocol.members {
            let _ = writeln!(text, "{line}");
        }
        if !protocol.skipped.is_empty() {
            let _ = writeln!(text, "    // Not bound, each for the reason given:");
            for line in &protocol.skipped {
                let _ = writeln!(text, "    //   {line}");
            }
        }
        let _ = writeln!(text, "  }}");
        nest(&mut out, &path, &text);
    }
    for (name, parent) in &model.mentioned {
        let extends = parent.as_ref().map(|p| format!(" extends {}", model.swift.class(p))).unwrap_or_default();
        let swift = model.swift.class(name);
        let path: Vec<String> = swift.split('.').map(str::to_owned).collect();
        let text = format!(
            "  /** Named by a signature here, and not bound: its ancestors' members only.\n   * @ntsClass {name} */\n  export class {}{extends} {{}}\n",
            path.last().map_or("", String::as_str)
        );
        nest(&mut out, &path, &text);
    }
    out.push_str("}\n");
    out
}

/// The values module: each `async` form as a function wrapping the method
/// that takes a completion handler in a promise the handler settles, which is
/// the import Swift itself makes. What each imports is only what it names.
fn render_values(request: &Request, model: &Model) -> String {
    if model.promises.is_empty() {
        return String::new();
    }
    let mut bodies = String::new();
    for promise in &model.promises {
        let mut arguments = promise.names.clone();
        // The handler's values, named, and what resolves with them: nothing,
        // the one, or the tuple of several -- each not optional once a
        // throwing handler has no error.
        let names: Vec<String> = match promise.arity {
            1 => vec!["value".to_owned()],
            n => (0..n).map(|at| format!("value{at}")).collect(),
        };
        let unwrap = if promise.throws && promise.nullable { "!" } else { "" };
        let settled = match names.as_slice() {
            [] => String::new(),
            [one] => format!("{one}{unwrap}"),
            many => format!("[{}]", many.iter().map(|n| format!("{n}{unwrap}")).collect::<Vec<_>>().join(", ")),
        };
        let executor = if promise.throws {
            let mut given = names.clone();
            given.push("error".to_owned());
            arguments.push(format!(
                "({}) => {{\n      if (error !== null) {{\n        reject(new Error(error.localizedDescription));\n      }} else {{\n        resolve({settled});\n      }}\n    }}",
                given.join(", ")
            ));
            "(resolve, reject)"
        } else {
            arguments.push(format!("({}) => resolve({settled})", names.join(", ")));
            "(resolve)"
        };
        let parameters = if promise.parameters.is_empty() { String::new() } else { format!(", {}", promise.parameters) };
        let _ = write!(
            bodies,
            "\nexport function {}(self: {}{parameters}): Promise<{}> {{\n  return new Promise({executor} => self.{}({}));\n}}\n",
            promise.function,
            promise.receiver,
            promise.value,
            promise.method,
            arguments.join(", ")
        );
    }
    let words: BTreeSet<&str> = bodies.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).collect();
    let mut own: BTreeSet<String> = BTreeSet::new();
    for class in &model.classes {
        own.extend(class.swift.split('.').next().map(str::to_owned));
    }
    for enumeration in model.enums.values() {
        own.extend(enumeration.path.first().cloned());
    }
    own.extend(model.records.iter().cloned());
    for name in model.mentioned.keys() {
        own.extend(model.swift.class(name).split('.').next().map(str::to_owned));
    }
    let mut out = format!(
        "// Generated by `nts bind-objc` beside the binding of `{}`. Do not edit: regenerate.\n//\n\
         // Swift's `async` imports: each method taking a completion handler, as a\n\
         // function returning a promise the handler settles, which the binding's\n\
         // `@ntsCall` overload names.\n",
        request.module
    );
    let used: Vec<&str> = own.iter().map(String::as_str).filter(|name| words.contains(name)).collect();
    if !used.is_empty() {
        let _ = writeln!(out, "import {{ {} }} from \"{}\";", used.join(", "), request.module);
    }
    for (module, names) in &model.imports {
        let used: Vec<&str> = names.iter().copied().filter(|name| words.contains(name)).collect();
        if !used.is_empty() {
            let _ = writeln!(out, "import type {{ {} }} from \"{module}\";", used.join(", "));
        }
    }
    out.push_str(&bodies);
    out
}

/// A temporary file that removes itself.
mod tempfile_path {
    use anyhow::{Context, Result};

    pub(crate) struct TempFile(std::path::PathBuf);

    impl TempFile {
        pub(crate) fn with(suffix: &str, text: &str) -> Result<Self> {
            let path = std::env::temp_dir().join(format!("nts-bind-objc-{}{suffix}", std::process::id()));
            std::fs::write(&path, text).with_context(|| format!("writing {}", path.display()))?;
            Ok(Self(path))
        }
        pub(crate) fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn a_swift_title_is_a_base_name_and_labels() {
        assert_eq!(swift_name("setFrame(_:display:)"), ("setFrame".to_owned(), vec!["_".to_owned(), "display".to_owned()]));
        assert_eq!(swift_name("init()"), ("init".to_owned(), Vec::new()));
        assert_eq!(swift_name("shared"), ("shared".to_owned(), Vec::new()));
    }

    #[test]
    fn a_number_is_named_as_swift_names_it() {
        assert_eq!(swift_number("CGFloat", "double"), Some("CGFloat"));
        assert_eq!(swift_number("NSInteger", "long"), Some("Int"));
        assert_eq!(swift_number("double", "double"), Some("Double"));
        assert_eq!(swift_number("uint16_t", "unsigned short"), Some("UInt16"));
        assert_eq!(swift_number("void *", "void *"), None);
    }

    /// A framework small enough to read, with one of each thing the binding
    /// has a rule for, run through clang exactly as an SDK's would be.
    const FAKE: &str = r#"
#define NS_ASSUME_NONNULL_BEGIN _Pragma("clang assume_nonnull begin")
#define NS_ASSUME_NONNULL_END _Pragma("clang assume_nonnull end")
typedef signed char BOOL;
typedef long NSInteger;
typedef unsigned long NSUInteger;
typedef double CGFloat;
struct CGPoint { CGFloat x; CGFloat y; };
typedef struct CGPoint CGPoint;
typedef enum Mode : NSUInteger Mode;
enum Mode : NSUInteger { ModeA = 1, ModeB };
struct Opaque;
@interface Root
+ (instancetype)alloc;
@end
@interface NSString : Root
@end
@interface NSArray<ObjectType> : Root
@end
@interface NSError : Root
@end
typedef NSString *ShapeKind;
@protocol ShapeDelegate;
@interface Root (Continued)
- (instancetype)init;
- (BOOL)isEqual:(Root *)other;
@end
NS_ASSUME_NONNULL_BEGIN
@interface Shape : Root
- (instancetype)initWithOrigin:(CGPoint)origin mode:(Mode)mode;
- (nullable Shape *)next;
- (void)each:(void (^)(Shape *))block;
- (void)take:(struct Opaque *)pointer;
- (void)old;
- (BOOL)saveTo:(Shape *)other error:(NSError * _Nullable * _Nullable)error;
- (BOOL)isEqualToShape:(Shape *)other;
- (NSString *)describe;
- (NSArray<NSString *> *)names;
- (nullable NSArray *)maybe;
- (void)adopt:(NSArray<Shape *> *)shapes;
- (void)registerTypes:(NSArray<ShapeKind> *)kinds;
- (NSArray<Shape<ShapeDelegate> *> *)delegates;
@property (readonly) CGPoint origin;
@property (getter=isHidden) BOOL hidden;
@property (class, readonly) Shape *unit;
@property (readonly, weak) Shape *owner;
@property (null_resettable, copy) NSString *label;
@end
@interface Shape (Named)
- (void)renameTo:(Shape *)other count:(NSInteger)count;
@end
typedef NSInteger Response;
@interface Shape (Async)
- (void)settleWith:(Shape *)other completionHandler:(void (^)(Response))handler;
- (void)fetchNamed:(NSString *)name completionHandler:(void (^)(Shape * _Nullable, NSError * _Nullable))handler;
- (void)pairWithCompletionHandler:(void (^)(Shape * _Nullable, NSString * _Nullable, NSError * _Nullable))handler;
@end
@interface Circle : Shape
@end
@protocol ShapeDelegate
- (void)shapeDidMove:(Shape *)shape;
@optional
- (void)shapeDidRename:(Shape *)shape;
- (void)shape:(Shape *)shape didRenameTo:(NSString *)name;
- (BOOL)shape:(Shape *)shape shouldHide:(BOOL)hide;
+ (void)classSide;
@property int size;
@end
NS_ASSUME_NONNULL_END
"#;

    /// What Swift's importer says of `FAKE`, in a symbol graph's shape.
    fn graph() -> String {
        let symbol = |usr: &str, kind: &str, title: &str, path: &[&str], availability: &str| {
            format!(
                r#"{{"identifier":{{"precise":"{usr}","interfaceLanguage":"swift"}},"kind":{{"identifier":"{kind}"}},"names":{{"title":"{title}"}},"pathComponents":{path:?},"availability":[{availability}]}}"#
            )
        };
        // Swift's two imports of one completion-handler method, under one USR.
        let asynchronous = r#"{"identifier":{"precise":"c:objc(cs)Shape(im)settleWith:completionHandler:","interfaceLanguage":"swift"},"kind":{"identifier":"swift.method"},"names":{"title":"settle(with:)"},"pathComponents":["Shape","settle(with:)"],"availability":[],"declarationFragments":[{"kind":"keyword","spelling":"func"},{"kind":"text","spelling":" settle(with other: Shape) "},{"kind":"keyword","spelling":"async"},{"kind":"text","spelling":" -> Int"}]}"#;
        let throwing = r#"{"identifier":{"precise":"c:objc(cs)Shape(im)fetchNamed:completionHandler:","interfaceLanguage":"swift"},"kind":{"identifier":"swift.method"},"names":{"title":"fetch(named:)"},"pathComponents":["Shape","fetch(named:)"],"availability":[],"declarationFragments":[{"kind":"keyword","spelling":"func"},{"kind":"text","spelling":" fetch(named name: String) "},{"kind":"keyword","spelling":"async"},{"kind":"text","spelling":" "},{"kind":"keyword","spelling":"throws"},{"kind":"text","spelling":" -> Shape"}]}"#;
        let old = r#"{"domain":"macOS","introduced":{"major":10,"minor":0},"deprecated":{"major":10,"minor":10}}"#;
        let symbols = [
            symbol("c:objc(cs)Root", "swift.class", "Root", &["Root"], ""),
            symbol("c:objc(cs)Shape", "swift.class", "Shape", &["Shape"], ""),
            // Renamed, as `NSTimer` is `Timer`.
            symbol("c:objc(cs)Circle", "swift.class", "Round", &["Round"], ""),
            symbol("c:objc(cs)Root(im)init", "swift.init", "init()", &["Root", "init()"], ""),
            symbol("c:objc(cs)Root(im)isEqual:", "swift.method", "isEqual(_:)", &["Root", "isEqual(_:)"], ""),
            symbol("c:objc(cs)Shape(im)initWithOrigin:mode:", "swift.init", "init(origin:mode:)", &["Shape", "init(origin:mode:)"], ""),
            symbol("c:objc(cs)Shape(im)next", "swift.method", "next()", &["Shape", "next()"], ""),
            symbol("c:objc(cs)Shape(im)each:", "swift.method", "each(_:)", &["Shape", "each(_:)"], ""),
            symbol("c:objc(cs)Shape(im)take:", "swift.method", "take(_:)", &["Shape", "take(_:)"], ""),
            symbol("c:objc(cs)Shape(im)old", "swift.method", "old()", &["Shape", "old()"], old),
            symbol("c:objc(cs)Shape(im)saveTo:error:", "swift.method", "save(to:)", &["Shape", "save(to:)"], ""),
            symbol("c:objc(cs)Shape(im)isEqualToShape:", "swift.method", "isEqual(to:)", &["Shape", "isEqual(to:)"], ""),
            symbol("c:objc(cs)Shape(im)describe", "swift.property", "describe", &["Shape", "describe"], ""),
            symbol("c:objc(cs)Shape(im)renameTo:count:", "swift.method", "rename(to:count:)", &["Shape", "rename(to:count:)"], ""),
            symbol("c:objc(cs)Shape(im)names", "swift.method", "names()", &["Shape", "names()"], ""),
            symbol("c:objc(cs)Shape(im)maybe", "swift.method", "maybe()", &["Shape", "maybe()"], ""),
            symbol("c:objc(cs)Shape(im)adopt:", "swift.method", "adopt(_:)", &["Shape", "adopt(_:)"], ""),
            symbol("c:objc(cs)Shape(im)registerTypes:", "swift.method", "register(_:)", &["Shape", "register(_:)"], ""),
            symbol("c:objc(cs)Shape(im)delegates", "swift.method", "delegates()", &["Shape", "delegates()"], ""),
            symbol("c:objc(cs)Shape(py)origin", "swift.property", "origin", &["Shape", "origin"], ""),
            symbol("c:objc(cs)Shape(py)hidden", "swift.property", "isHidden", &["Shape", "isHidden"], ""),
            symbol("c:objc(cs)Shape(cpy)unit", "swift.type.property", "unit", &["Shape", "unit"], ""),
            // What Swift makes of two properties clang's printed type does not
            // say: a weak one is optional, a `null_resettable` one unwrapped.
            r#"{"identifier":{"precise":"c:objc(cs)Shape(py)owner","interfaceLanguage":"swift"},"kind":{"identifier":"swift.property"},"names":{"title":"owner"},"pathComponents":["Shape","owner"],"availability":[],"declarationFragments":[{"kind":"text","spelling":"weak var owner: Shape? { get }"}]}"#.to_owned(),
            r#"{"identifier":{"precise":"c:objc(cs)Shape(py)label","interfaceLanguage":"swift"},"kind":{"identifier":"swift.property"},"names":{"title":"label"},"pathComponents":["Shape","label"],"availability":[],"declarationFragments":[{"kind":"text","spelling":"var label: String! { get set }"}]}"#.to_owned(),
            symbol("c:@E@Mode", "swift.enum", "Shape.Mode", &["Shape", "Mode"], ""),
            symbol("c:@E@Mode@ModeA", "swift.enum.case", "Shape.Mode.a", &["Shape", "Mode", "a"], ""),
            symbol("c:@E@Mode@ModeB", "swift.enum.case", "Shape.Mode.b", &["Shape", "Mode", "b"], ""),
            // Swift's own, which no message reaches.
            symbol("s:4Fake5ShapeC5swiftyyF", "swift.method", "swifty()", &["Shape", "swifty()"], ""),
            // A protocol, renamed; `shape:didRenameTo:` renamed as
            // `NS_SWIFT_NAME` renames, onto a name a sibling derives.
            symbol("c:objc(pl)ShapeDelegate", "swift.protocol", "ShapeWatching", &["ShapeWatching"], ""),
            symbol("c:objc(pl)ShapeDelegate(im)shapeDidMove:", "swift.method", "shapeDidMove(_:)", &["ShapeWatching", "shapeDidMove(_:)"], ""),
            symbol("c:objc(pl)ShapeDelegate(im)shapeDidRename:", "swift.method", "shapeDidRename(_:)", &["ShapeWatching", "shapeDidRename(_:)"], ""),
            symbol("c:objc(pl)ShapeDelegate(im)shape:didRenameTo:", "swift.method", "shape(_:didRename:)", &["ShapeWatching", "shape(_:didRename:)"], ""),
            symbol("c:objc(pl)ShapeDelegate(im)shape:shouldHide:", "swift.method", "shape(_:shouldHide:)", &["ShapeWatching", "shape(_:shouldHide:)"], ""),
            symbol("c:objc(cs)Shape(im)settleWith:completionHandler:", "swift.method", "settle(with:completionHandler:)", &["Shape", "settle(with:completionHandler:)"], ""),
            asynchronous.to_owned(),
            symbol("c:objc(cs)Shape(im)fetchNamed:completionHandler:", "swift.method", "fetch(named:completionHandler:)", &["Shape", "fetch(named:completionHandler:)"], ""),
            throwing.to_owned(),
            symbol("c:objc(cs)NSError", "swift.class", "NSError", &["NSError"], ""),
            symbol("c:objc(cs)Shape(im)pairWithCompletionHandler:", "swift.method", "pair(completionHandler:)", &["Shape", "pair(completionHandler:)"], ""),
            r#"{"identifier":{"precise":"c:objc(cs)Shape(im)pairWithCompletionHandler:","interfaceLanguage":"swift"},"kind":{"identifier":"swift.method"},"names":{"title":"pair()"},"pathComponents":["Shape","pair()"],"availability":[],"declarationFragments":[{"kind":"text","spelling":"func pair() async throws -> (Shape, String)"}]}"#.to_owned(),
        ];
        let optional = ["shapeDidRename:", "shape:didRenameTo:", "shape:shouldHide:"].map(|selector| {
            format!(r#"{{"kind":"optionalRequirementOf","source":"c:objc(pl)ShapeDelegate(im){selector}","target":"c:objc(pl)ShapeDelegate"}}"#)
        });
        let required = r#"{"kind":"requirementOf","source":"c:objc(pl)ShapeDelegate(im)shapeDidMove:","target":"c:objc(pl)ShapeDelegate"}"#;
        format!(r#"{{"symbols":[{}],"relationships":[{},{required}]}}"#, symbols.join(","), optional.join(","))
    }

    /// Every rule the binding applies, on real clang output.
    #[test]
    fn a_framework_is_bound_as_swift_imports_it() {
        let root = std::env::temp_dir().join(format!("nts-bind-objc-test-{}", std::process::id()));
        let headers = root.join("System/Library/Frameworks/Fake.framework/Headers");
        let symbols = root.join("symbolgraph");
        std::fs::create_dir_all(&headers).unwrap();
        std::fs::create_dir_all(&symbols).unwrap();
        std::fs::write(headers.join("Fake.h"), FAKE).unwrap();
        std::fs::write(symbols.join("Fake.symbols.json"), graph()).unwrap();
        std::fs::write(symbols.join("ObjectiveC.symbols.json"), r#"{"symbols":[]}"#).unwrap();
        let request = Request {
            frameworks: vec!["Fake".to_owned()],
            module: "objc:Fake".to_owned(),
            // `NSError`, for the throwing `async` form's description.
            classes: vec!["Circle".to_owned(), "NSError".to_owned()],
            protocols: vec!["ShapeDelegate".to_owned()],
            sdk: root.to_string_lossy().into_owned(),
            target: "x86_64-apple-macos13".to_owned(),
            symbols: Some(symbols),
        };
        let (text, values) = match run(&request) {
            Ok(output) => (output.binding, output.values),
            Err(error) if Command::new("clang").arg("--version").output().is_err() => {
                eprintln!("skipped: no clang ({error})");
                return;
            }
            Err(error) => panic!("{error:#}"),
        };
        let _ = std::fs::remove_dir_all(&root);
        for expected in [
            // A class is a class, under Swift's name, sent by its own.
            "/** @ntsClass Circle */\n  export class Round extends Shape {",
            "/** @ntsClass Shape */\n  export class Shape extends Root {",
            // An initializer is a constructor, its labels one object; and a
            // descendant repeats it, since TypeScript hides a base's
            // constructors behind a class's own.
            "    /** @ntsSelector initWithOrigin:mode: */\n    constructor(labels: { origin: ByValue<CGPoint>; mode: CEnum<Shape.Mode, UInt> });",
            // Unlabelled, positional; a declared `nullable` may be null.
            "    /** @ntsSelector next */\n    next(): Shape | null;",
            // A category is found by the class it extends; labels by Swift.
            "    /** @ntsSelector renameTo:count: */\n    rename(labels: { to: Shape; count: Int }): void;",
            // A getter Swift imports as a property is one.
            "    /** @ntsSelector describe */\n    get describe(): string;",
            // Properties: read-only, a Swift name whose setter is not implied,
            // and a class property as a static.
            // As the accessors an Objective-C property is, so a subclass can
            // override one.
            "    get origin(): ByValue<CGPoint>;",
            "    get isHidden(): boolean;\n    /** @ntsSet setHidden: */\n    set isHidden(value: boolean);",
            "    static get unit(): Shape;",
            // Nullable as Swift makes them: a weak property both ways, and a
            // `null_resettable` one only when written.
            "    get owner(): Shape | null;",
            "    get label(): string;\n    set label(value: string | null);",
            // Swift's overloads across the hierarchy: a class declaring
            // `isEqual` repeats its ancestor's, or it is not their subtype.
            "    /** @ntsSelector isEqualToShape: */\n    isEqual(labels: { to: Shape }): boolean;",
            "    /** @ntsSelector isEqual: */\n    isEqual(other: Root): boolean;",
            // The enum, nested where Swift nests it, with clang's values.
            "  export namespace Shape {\n    export const enum Mode {\n      a = 1,\n      b = 2,\n    }\n  }",
            // Swift's `[T]`: an `NSArray` of strings or of a class's objects.
            "    /** @ntsSelector names */\n    names(): string[];",
            "    /** @ntsSelector adopt: */\n    adopt(shapes: Shape[]): void;",
            // Swift's `[T]?`: the array, or `null` for a nil one.
            "    /** @ntsSelector maybe */\n    maybe(): NSObject[] | null;",
            // Elements through a typedef of `NSString *`, as `[NSPasteboard.PasteboardType]`,
            // and a class qualified by a protocol, which the element drops.
            "    /** @ntsSelector registerTypes: */\n    register(kinds: string[]): void;",
            "    /** @ntsSelector delegates */\n    delegates(): Shape[];",
            // A struct passed by value is declared, in Swift's numbers.
            "export type CGPoint = Struct<{ x: Double; y: Double }, \"CGPoint\">;",
            // And what is not bound is said, with why.
            // Swift's closure: a block, and a trailing one passed last.
            "    /** @ntsSelector each: */\n    each(block: (arg0: Shape) => void): void;",
            "-take:: a `struct Opaque *`",
            "-old: deprecated in macOS 10.10",
            // Swift's `throws`: the `NSError **` left out, and `BOOL` nothing.
            "    /**\n     * @ntsSelector saveTo:error:\n     * @ntsThrows error nts_nserror_message\n     */\n    save(labels: { to: Shape }): void;",
            // A protocol is an interface under Swift's name, its methods as
            // the adopting class writes them: required, or `?` where Swift
            // says `optional`, every argument positional and an object as
            // itself. A shared base name takes its first label, and one that
            // still collides with a name Swift gave is named by its selector.
            "  /** @ntsProtocol ShapeDelegate */\n  export interface ShapeWatching {\n\
             \x20   /** @ntsSelector shapeDidMove: */\n    shapeDidMove(shape: Shape): void;\n\
             \x20   /** @ntsSelector shapeDidRename: */\n    shapeDidRename?(shape: Shape): void;\n\
             \x20   /** @ntsSelector shape:didRenameTo: */\n    shapeDidRenameTo?(shape: Shape, name: NSString): void;\n\
             \x20   /** @ntsSelector shape:shouldHide: */\n    shapeShouldHide?(shape: Shape, hide: boolean): boolean;\n",
            "+classSide: a class-side requirement",
            "@property size: a property requirement",
        ] {
            assert!(text.contains(expected), "no `{expected}` in:\n{text}");
        }
        // What Swift does not import has no member here: `alloc`, and Swift's
        // own methods.
        assert!(!text.contains("alloc") && !text.contains("swifty"), "{text}");
        // Swift's `async` import: the method taking the handler, whose block's
        // typedef'd parameter is its width, and beside it the form returning a
        // promise, whose body is the values module's.
        for expected in [
            "    /** @ntsSelector settleWith:completionHandler: */\n    settle(labels: { with: Shape }, handler: (arg0: Int) => void): void;",
            "    /** @ntsCall nts_async_Shape_settle */\n    settle(labels: { with: Shape }): Promise<Int>;",
            "    /** @ntsCall nts_async_Shape_fetch */\n    fetch(labels: { named: string }): Promise<Shape>;",
            // Several values are Swift's tuple; a handler's values cross as
            // the objects they are, as a block's do.
            "    /** @ntsCall nts_async_Shape_pair */\n    pair(): Promise<[Shape, NSString]>;",
        ] {
            assert!(text.contains(expected), "no `{expected}` in:\n{text}");
        }
        for expected in [
            "import { NSString, Shape } from \"objc:Fake\";",
            "import type { Int } from \"objc:types\";",
            "export function nts_async_Shape_settle(self: Shape, labels: { with: Shape }): Promise<Int> {\n  return new Promise((resolve) => self.settle(labels, (value) => resolve(value)));\n}",
            // Swift's `async throws`: the error rejects, with its description,
            // and the value, not optional once there is no error, resolves.
            "export function nts_async_Shape_fetch(self: Shape, labels: { named: string }): Promise<Shape> {\n  \
             return new Promise((resolve, reject) => self.fetch(labels, (value, error) => {\n      \
             if (error !== null) {\n        reject(new Error(error.localizedDescription));\n      \
             } else {\n        resolve(value!);\n      }\n    }));\n}",
        ] {
            assert!(values.contains(expected), "no `{expected}` in:\n{values}");
        }
    }

    #[test]
    fn an_availability_annotation_is_not_part_of_the_type() {
        assert_eq!(strip_availability("API_AVAILABLE(macos(11.0)) NSString *"), "NSString *");
        assert_eq!(strip_availability("NSString * _Nonnull"), "NSString * _Nonnull");
    }
}
