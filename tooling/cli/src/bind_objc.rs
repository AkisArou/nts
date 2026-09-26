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

mod cf;

/// What to bind, and from where.
#[derive(Clone)]
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
    /// C functions Swift imports as free functions, to declare as it does:
    /// `CGColorSpaceCreateDeviceRGB`. A Core Foundation class's own -- its
    /// methods and initializers -- come with the class.
    pub(crate) functions: Vec<String>,
    /// Names as a program imports them from the module, which are Swift's:
    /// `Timer`, `UIApplicationDelegate`, `UIApplicationMain`. Each is found in
    /// Swift's graphs and bound as the class, protocol or function it is. A
    /// record, an enum or a type alias comes with the class that names it.
    pub(crate) names: Vec<String>,
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
    let symbols = match &request.symbols {
        Some(directory) => directory.clone(),
        None => default_symbols(&request.sdk)?,
    };
    let swift = Swift::read(&symbols, &request.frameworks)?;
    let request = &swift.resolved(request)?;
    // A Core Foundation class is not an Objective-C one: its members are C
    // functions, which the second pass keeps the declarations of.
    let cf_types = cf::requested(&swift, &headers.typedefs, &request.classes);
    let objc: Vec<String> = request.classes.iter().filter(|c| !cf_types.values().any(|name| name == *c)).cloned().collect();
    let bound = closure(&objc, &headers.supers)?;
    let protocols: BTreeSet<String> = request.protocols.iter().cloned().collect();
    let constants = swift.constants(&bound);
    let mut symbols = cf::functions(&swift, &cf_types, &request.functions);
    symbols.extend(constants.keys().cloned());
    let bodies = dump(request, &unit, &Wanted::Bodies(&bound, &protocols, &symbols))?;
    let (platform, target) = deployment_target(&request.target)?;
    let mut model = Model::read(&swift, &headers, &bodies, &bound, cf_types, target);
    model.platform = platform;
    model.read_cf(&bodies.functions, &request.functions);
    model.read_constants(&constants, &bodies.variables);
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
/// Where `tooling/apple/symbolgraph.sh` put the graphs for `sdk`: beside it,
/// under the SDK's version for macOS (`symbolgraph/26.5`), and under its
/// canonical name for any other platform (`symbolgraph/iphonesimulator26.5`),
/// since iOS and macOS number their SDKs alike.
fn default_symbols(sdk: &str) -> Result<std::path::PathBuf> {
    let sdk = std::path::Path::new(sdk);
    let settings = sdk.join("SDKSettings.json");
    let text = std::fs::read(&settings).with_context(|| format!("reading {}", settings.display()))?;
    let settings: Value = serde_json::from_slice(&text).with_context(|| format!("reading {}", settings.display()))?;
    let version = settings.get("Version").and_then(Value::as_str).context("SDKSettings.json names no `Version`")?;
    let canonical = settings.get("CanonicalName").and_then(Value::as_str).unwrap_or("macosx");
    let directory = if canonical.starts_with("macosx") { version } else { canonical };
    Ok(sdk.parent().unwrap_or(sdk).join("symbolgraph").join(directory))
}

/// The platform a clang target is for, as a symbol graph's availability names
/// it, and its deployment version: `x86_64-apple-macos13` is macOS 13.0, and
/// `x86_64-apple-ios17.0-simulator` iOS 17.0.
fn deployment_target(target: &str) -> Result<(&'static str, Version)> {
    let target = target.trim_end_matches("-simulator");
    let (platform, version) = if let Some((_, version)) = target.rsplit_once("macos") {
        ("macOS", version)
    } else if let Some((_, version)) = target.rsplit_once("ios") {
        ("iOS", version)
    } else {
        bail!("`{target}` is not a macOS or an iOS target");
    };
    let mut parts = version.split('.').map(str::parse::<u32>);
    match (parts.next(), parts.next()) {
        (Some(Ok(major)), None) => Ok((platform, Version { major, minor: 0 })),
        (Some(Ok(major)), Some(Ok(minor))) => Ok((platform, Version { major, minor })),
        _ => bail!("`{target}` names no {platform} version"),
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
    /// these protocols; and the declarations of these C functions and extern
    /// variables.
    Bodies(&'a BTreeSet<String>, &'a BTreeSet<String>, &'a BTreeSet<String>),
}

/// What one pass read.
#[derive(Default)]
struct Dumped {
    /// Every class, and the class it inherits from.
    supers: BTreeMap<String, Option<String>>,
    /// The protocols each class adopts (in its interface or a category) and
    /// each protocol refines, by the class's or protocol's name.
    adopts: BTreeMap<String, BTreeSet<String>>,
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
    /// The requested C functions' declarations: their type and parameters.
    functions: BTreeMap<String, Value>,
    /// The type of each requested extern variable, by its C name.
    variables: BTreeMap<String, Value>,
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

/// What one declaration of a dump said, as its keys were read: the fields
/// [`file`] puts where the model looks for them.
struct Declared {
    kind: String,
    name: Option<String>,
    interface: Option<String>,
    parent: Option<String>,
    width: Option<String>,
    body: Option<Value>,
    aliased: Option<String>,
    function: Option<Value>,
    variable: Option<Value>,
    adopted: Vec<String>,
}

/// File one declaration where the model reads it: a class's body and
/// superclass, a protocol's requirements, conformances, a function's or a
/// variable's type, an enum, a record, a typedef.
fn file(out: &mut Dumped, wanted: &Wanted<'_>, declared: Declared) {
    let Declared { kind, name, interface, parent, width, body, aliased, function, variable, adopted } = declared;
    if let (Some(name), Some(aliased)) = (name.as_ref(), aliased) {
        out.typedefs.entry(name.clone()).or_insert(aliased);
    }
    // Whose conformances these are: a category's class, or the
    // interface or protocol itself.
    let conforming = match kind.as_str() {
        "ObjCCategoryDecl" => interface.clone(),
        "ObjCInterfaceDecl" | "ObjCProtocolDecl" => name.clone(),
        _ => None,
    };
    if let Some(conforming) = conforming.filter(|_| !adopted.is_empty()) {
        out.adopts.entry(conforming).or_default().extend(adopted);
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
                if matches!(wanted, Wanted::Bodies(_, protocols, _) if protocols.contains(&name)) {
                    out.protocols.entry(name).or_default().extend(members);
                }
            }
        }
        ("VarDecl", Some(name)) => {
            if let Some(ty) = variable {
                out.variables.entry(name).or_insert(ty);
            }
        }
        ("FunctionDecl", Some(name)) => {
            if let (Some(ty), Some(inner)) = (function, body) {
                out.functions.insert(name, serde_json::json!({ "type": ty, "inner": inner }));
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
        let mut function = None;
        let mut variable = None;
        let mut adopted: Vec<String> = Vec::new();
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "kind" => kind = map.next_value()?,
                "name" => name = Some(map.next_value::<String>()?),
                "interface" => interface = named(&map.next_value::<Value>()?),
                "super" => parent = named(&map.next_value::<Value>()?),
                "protocols" => {
                    let listed = map.next_value::<Value>()?;
                    adopted = listed.as_array().map(|list| list.iter().filter_map(named).collect()).unwrap_or_default();
                }
                "completeDefinition" => complete = map.next_value()?,
                "fixedUnderlyingType" => {
                    width = desugared(&map.next_value::<Value>()?);
                }
                "type" if kind == "TypedefDecl" && matches!(self.wanted, Wanted::Headers) => {
                    aliased = desugared(&map.next_value::<Value>()?);
                }
                "type" if kind == "FunctionDecl" => function = Some(map.next_value::<Value>()?),
                "type" if kind == "VarDecl" && matches!(self.wanted, Wanted::Bodies(_, _, wanted) if name.as_ref().is_some_and(|n| wanted.contains(n))) => {
                    variable = Some(map.next_value::<Value>()?);
                }
                "inner" => {
                    let keep = match self.wanted {
                        Wanted::Headers => (kind == "RecordDecl" && complete) || kind == "EnumDecl",
                        Wanted::Bodies(bound, protocols, functions) => match kind.as_str() {
                            "ObjCInterfaceDecl" => name.as_ref().is_some_and(|n| bound.contains(n)),
                            // A category on NSObject is every framework's
                            // extension of every object, hundreds of methods;
                            // the root is bound as the runtime declares it.
                            "ObjCCategoryDecl" => interface.as_ref().is_some_and(|n| bound.contains(n) && n != "NSObject"),
                            "ObjCProtocolDecl" => name.as_ref().is_some_and(|n| {
                                (n == "NSObject" && bound.contains("NSObject")) || protocols.contains(n)
                            }),
                            "FunctionDecl" => name.as_ref().is_some_and(|n| functions.contains(n)),
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
        file(self.out, self.wanted, Declared { kind, name, interface, parent, width, body, aliased, function, variable, adopted });
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
            for path in graphs(directory, module)? {
                let text = std::fs::read(&path)
                    .with_context(|| format!("reading {} -- run tooling/apple/symbolgraph.sh {module}", path.display()))?;
                let graph: Graph =
                    serde_json::from_slice(&text).with_context(|| format!("reading {}", path.display()))?;
            // Clang's declarations only: an `s:` symbol is Swift's own, which
            // an Objective-C message cannot reach.
                for symbol in graph.symbols.into_iter().filter(|s| s.identifier.identifier.starts_with("c:")) {
                    let into = if symbol.is_async() { &mut asynchronous } else { &mut by_usr };
                    into.insert(symbol.identifier.identifier.clone(), symbol);
                }
                optional.extend(
                    graph.relationships.into_iter().filter(|r| r.kind == "optionalRequirementOf").map(|r| r.source),
                );
            }
        }
        Ok(Self { by_usr, asynchronous, optional })
    }

    fn get(&self, usr: &str) -> Option<&Symbol> {
        self.by_usr.get(usr)
    }

    /// `request`, with each of its `names` bound as what Swift imports it as:
    /// a class, a protocol or a function, by the name Objective-C and C know
    /// it by. A name Swift declares nowhere in the frameworks is an error that
    /// says so; one that is a record, an enum or a type alias is bound with
    /// the class that names it, and adds nothing here.
    fn resolved(&self, request: &Request) -> Result<Request> {
        let mut resolved = request.clone();
        for name in &request.names {
            let mut found = false;
            for usr in self.by_usr.iter().filter(|(_, symbol)| symbol.path.len() == 1 && symbol.path[0] == *name).map(|(usr, _)| usr) {
                found = true;
                let (list, declared) = if let Some(class) = usr.strip_prefix("c:objc(cs)") {
                    (&mut resolved.classes, class)
                } else if let Some(protocol) = usr.strip_prefix("c:objc(pl)") {
                    (&mut resolved.protocols, protocol)
                } else if let Some(function) = usr.strip_prefix("c:@F@") {
                    (&mut resolved.functions, function)
                } else {
                    continue;
                };
                if !list.iter().any(|known| known == declared) {
                    list.push(declared.to_owned());
                }
            }
            if !found {
                bail!("`{name}` is not a name Swift imports from {}", request.frameworks.join(", "));
            }
        }
        Ok(resolved)
    }

    /// The extern constants Swift imports as static properties of one of
    /// `classes` -- `UITextFieldTextDidChangeNotification` as
    /// `UITextField.textDidChangeNotification` -- by their C name, with the
    /// Objective-C class each belongs to and its symbol. A global's USR is
    /// `c:@` and its C name, with no `@` after it.
    fn constants(&self, classes: &BTreeSet<String>) -> BTreeMap<String, (String, Symbol)> {
        let by_swift: BTreeMap<String, &String> = classes.iter().map(|objc| (self.class(objc), objc)).collect();
        self.by_usr
            .iter()
            .filter(|(usr, symbol)| {
                usr.strip_prefix("c:@").is_some_and(|rest| !rest.contains('@')) && symbol.kind.identifier == "swift.type.property"
            })
            .filter_map(|(usr, symbol)| {
                let [class, _] = symbol.path.as_slice() else { return None };
                let objc = by_swift.get(class)?;
                Some((usr["c:@".len()..].to_owned(), ((*objc).clone(), symbol.clone())))
            })
            .collect()
    }

    /// The name Swift gives Objective-C class `class`: `Timer` for `NSTimer`.
    fn class(&self, class: &str) -> String {
        self.get(&format!("c:objc(cs){class}")).map_or_else(|| class.to_owned(), |s| s.names.title.clone())
    }
}

/// `module`'s graph, then the graphs of its categories on other modules'
/// classes: Swift writes `UIKit`'s `row` on Foundation's `NSIndexPath` to
/// `UIKit@Foundation.symbols.json`, not to `UIKit.symbols.json`.
fn graphs(directory: &std::path::Path, module: &str) -> Result<Vec<std::path::PathBuf>> {
    let prefix = format!("{module}@");
    let mut extensions = Vec::new();
    for entry in std::fs::read_dir(directory).with_context(|| format!("reading {}", directory.display()))? {
        let name = entry?.file_name();
        if name.to_str().is_some_and(|n| n.starts_with(&prefix) && n.ends_with(".symbols.json")) {
            extensions.push(directory.join(name));
        }
    }
    extensions.sort();
    let mut paths = vec![directory.join(format!("{module}.symbols.json"))];
    paths.extend(extensions);
    Ok(paths)
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
    /// What the interface extends: `NSObject`, as every Objective-C protocol
    /// Swift imports refines `NSObjectProtocol`, and every class adopting one
    /// is an object -- so a property typed as the protocol is still one where
    /// a base class's is typed `NSObject`.
    base: String,
    /// The declared protocols it refines, by Swift name: `UITextInput`
    /// refines `UIKeyInput`, so the interface extends it.
    refines: Vec<String>,
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
    /// The headers' typedefs, and each generic class's type parameters as
    /// what they stand for: `ItemIdentifierType` in
    /// `NSDiffableDataSourceSnapshot<SectionIdentifierType, ItemIdentifierType>`
    /// is an `id`, so an object.
    typedefs: BTreeMap<String, String>,
    bound: &'a BTreeSet<String>,
    /// The deployment target: a member Swift marks as introduced after it, or
    /// deprecated by it, is not bound.
    target: Version,
    /// The platform the target is for, as availability names it: `macOS`.
    platform: &'static str,
    classes: Vec<Class>,
    protocols: Vec<Protocol>,
    /// Set while a C function's parameters and result are spelled
    /// ([`Self::in_c_function`]): there an `NSString *` is a
    /// `BridgedString`, since a plain `string` is a C string outside a
    /// message, and a collection is refused, since only a message copies one.
    c_function: bool,
    /// The protocols this binding declares, by Objective-C name: an `id<P>`
    /// of one is spelled `P`, Swift's `any P`.
    declared_protocols: BTreeSet<String>,
    /// Classes a signature names that are not bound, by Objective-C name,
    /// with their nearest bound ancestor's.
    mentioned: BTreeMap<String, Option<String>>,
    records: BTreeSet<String>,
    enums: BTreeMap<String, Enum>,
    /// What each module the binding imports from provides it, by module.
    imports: BTreeMap<&'static str, BTreeSet<&'static str>>,
    /// Swift's `async` imports, each a function of the values module.
    promises: Vec<Promise>,
    /// The Core Foundation classes requested, by the C pointer type their
    /// `Ref` is (`struct CGContext *`): what a signature naming one spells.
    cf_types: BTreeMap<String, String>,
    cf_classes: Vec<cf::CfClass>,
    /// The free functions requested, as the binding declares each.
    functions: Vec<String>,
}

/// A method's `async` form: a function of the values module, which the
/// binding's `@ntsCall` overload names, returning a promise the completion
/// handler settles.
struct Promise {
    function: String,
    /// A class method's: the function takes no receiver, and calls the
    /// method on the class.
    is_static: bool,
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
    /// Each parameter of the handler, as the block's type spells it. The
    /// closure the function passes declares them, so that of a method's
    /// overloads with a handler each -- `NSDocument`'s `lock` taking a
    /// `(Bool) -> Void` beside one taking an `(Error?) -> Void` --
    /// TypeScript picks the one this is the promise of.
    given: Vec<String>,
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
    /// Each property bound, the ancestors' included, by `static` and name,
    /// with the getter it is read by. An override is read by the same one;
    /// another property Swift gives the same name is not.
    getters: BTreeMap<(bool, String), String>,
}

impl<'a> Model<'a> {
    fn read(
        swift: &'a Swift,
        headers: &'a Dumped,
        bodies: &'a Dumped,
        bound: &'a BTreeSet<String>,
        cf_types: BTreeMap<String, String>,
        target: Version,
    ) -> Self {
        let mut typedefs = headers.typedefs.clone();
        for decl in bodies.bodies.values().flatten() {
            if decl.get("kind").and_then(Value::as_str) == Some("ObjCTypeParamDecl")
                && let Some(name) = named(decl)
            {
                let bound = decl.get("type").and_then(desugared).unwrap_or_else(|| "id".to_owned());
                typedefs.entry(name).or_insert(bound);
            }
        }
        let mut model = Model {
            swift,
            headers,
            typedefs,
            bound,
            target,
            platform: "macOS",
            classes: Vec::new(),
            protocols: Vec::new(),
            declared_protocols: bodies.protocols.keys().cloned().collect(),
            c_function: false,
            mentioned: BTreeMap::new(),
            records: BTreeSet::new(),
            enums: BTreeMap::new(),
            imports: BTreeMap::new(),
            promises: Vec::new(),
            cf_types,
            cf_classes: Vec::new(),
            functions: Vec::new(),
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
            let (inherited, names, overloads, getters) = parent
                .as_ref()
                .and_then(|p| read.get(p))
                .map(|r| (r.repeated.clone(), r.names.clone(), r.overloads.clone(), r.getters.clone()))
                .unwrap_or_default();
            let mut reading = Reading {
                seen: BTreeSet::new(),
                names,
                repeated: Vec::new(),
                overloads: overloads.clone(),
                own: BTreeSet::new(),
                getters,
            };
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
                    model.repeat_overload(&mut bound, origin.clone(), &mut reading);
                }
            }
            read.insert(class, reading);
            prefer_doubles(&mut bound.members);
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
        let mut properties = Vec::new();
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
                Some("ObjCPropertyDecl") if decl.get("class").and_then(Value::as_bool) == Some(true) => {
                    skipped.push(format!("@property (class) {name}: a class-side requirement, which a TypeScript class cannot write"));
                }
                Some("ObjCPropertyDecl") => {
                    let usr = format!("{container}(py){name}");
                    let Some(symbol) = self.swift.get(&usr).cloned() else { continue };
                    let optional = self.swift.optional.contains(&usr);
                    match self.available(&symbol).and_then(|()| self.property_requirement(&adopter, decl, &symbol, optional)) {
                        Ok(property) => properties.push(property),
                        Err(why) => skipped.push(format!("@property {name}: {why}")),
                    }
                }
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
        // A property first, by its Swift name, which a method's derived name
        // then steers clear of: `window` is `UIApplicationDelegate`'s.
        for (name, text) in properties {
            if !taken.insert(name.clone()) {
                skipped.push(format!("@property {name}: named as a method of the protocol is"));
                continue;
            }
            members.push(text);
        }
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
        let base = self.object("NSObject");
        let refines = self
            .headers
            .adopts
            .get(objc)
            .into_iter()
            .flatten()
            .filter(|parent| self.declared_protocols.contains(*parent))
            .map(|parent| self.protocol_name(parent))
            .collect();
        Protocol { objc: objc.to_owned(), swift, base, refines, members, skipped }
    }

    /// A protocol's property requirement, as Swift imports it -- `var window:
    /// UIWindow? { get set }` -- and as the adopting class meets it: a field
    /// or an accessor of that name. Its Swift name, and the member's text: a
    /// property signature, `?` where Swift marks it `optional`, `readonly`
    /// where the header does, and tagged with its getter and setter where
    /// they are not the ones its name gives.
    fn property_requirement(&mut self, adopter: &Class, decl: &Value, symbol: &Symbol, optional: bool) -> std::result::Result<(String, String), String> {
        let name = named(decl).unwrap_or_default();
        let ty = decl.get("type").ok_or("no type")?;
        if written(ty).contains("(^") || desugared(ty).is_some_and(|d| d.contains("(^")) {
            return Err("a block property requirement, which a field holding a closure cannot answer".to_owned());
        }
        let spelled = optional_as_swift(self.spell(adopter, ty, Position::Result)?, symbol.optionality() != Optionality::Neither);
        let readonly = decl.get("readonly").and_then(Value::as_bool) == Some(true);
        let swift_name = symbol.names.title.clone();
        let getter = decl.get("getter").and_then(named).unwrap_or_else(|| name.clone());
        let setter = decl.get("setter").and_then(named).unwrap_or_else(|| format!("set{}:", capitalized(&name)));
        let mut tags = Vec::new();
        if getter != swift_name {
            tags.push(format!("@ntsSelector {getter}"));
        }
        if !readonly && setter != format!("set{}:", capitalized(&swift_name)) {
            tags.push(format!("@ntsSet {setter}"));
        }
        let mut text = String::new();
        if !tags.is_empty() {
            let _ = writeln!(text, "    /** {} */", tags.join("\n     * "));
        }
        let _ = write!(
            text,
            "    {}{}{}: {spelled};",
            if readonly { "readonly " } else { "" },
            quoted_key(&swift_name),
            if optional { "?" } else { "" }
        );
        Ok((swift_name, text))
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
            let spelled = swift_string(spelled);
            let name = named(parameter).filter(|n| !n.is_empty() && !reserved(n)).unwrap_or_else(|| format!("arg{at}"));
            parameters.push(format!("{name}: {spelled}"));
        }
        let result = swift_string(self.spell(adopter, decl.get("returnType").ok_or("no return type")?, Position::Block)?);
        Ok(Requirement { selector: named(decl).unwrap_or_default(), base, labels, optional, parameters: parameters.join(", "), result })
    }

    fn import(&mut self, module: &'static str, name: &'static str) {
        self.imports.entry(module).or_default().insert(name);
    }

    /// Bind one member of `class`: a method, or a property.
    /// An ancestor's overload of a name this class declares, repeated so the
    /// class is its subtype. Where the class redeclares the same selector at
    /// other types -- `DistributedNotificationCenter`'s
    /// `addObserver:selector:name:object:` takes a `String?` object where
    /// `NotificationCenter`'s takes an `NSObject?` -- the ancestor's is kept
    /// beside it, since TypeScript holds a subclass's overloads to its
    /// base's, and both send the one selector.
    fn repeat_overload(&mut self, class: &mut Class, origin: Origin<'a>, reading: &mut Reading<'a>) {
        let decl = origin.decl;
        let Some(selector) = named(decl) else { return };
        let instance = decl.get("instance").and_then(Value::as_bool).unwrap_or(true);
        let key = format!("{}{selector}", if instance { "-" } else { "+" });
        if !reading.seen.contains(&key) {
            self.member(class, origin, reading);
            return;
        }
        let usr = format!("{}({}){selector}", origin.container, if instance { "im" } else { "cm" });
        let Some(mut symbol) = self.swift.get(&usr).cloned() else { return };
        Self::fold_clashing(&mut symbol, reading);
        // Still a property's name after folding: the property keeps it.
        let (is_static, name, _) = Self::shape(&symbol);
        if name.is_some_and(|name| reading.names.get(&(is_static, name)) == Some(&Named::Property)) {
            return;
        }
        // The same overload up to its parameters' names -- `cView` in one
        // header, `clipView` in the other -- is the one already there.
        if let Ok(text) = self.available(&symbol).and_then(|()| self.method(class, decl, &symbol))
            && !class.members.iter().any(|member| unnamed(member) == unnamed(&text))
        {
            class.members.push(text);
        }
    }

    /// Swift has `var menu` and `func menu(for:)` on one class, and
    /// TypeScript one member per name. Properties are read first and keep
    /// theirs; the method takes its first label into its name, as the
    /// selector does: `menuFor(event)`, `frameForAlignmentRect(rect)`.
    fn fold_clashing(symbol: &mut Symbol, reading: &Reading<'_>) {
        let (is_static, name, named_as) = Self::shape(symbol);
        if let Some(name) = name
            && named_as == Named::Method
            && reading.names.get(&(is_static, name)) == Some(&Named::Property)
            && let Some(renamed) = folded_label(&symbol.names.title)
        {
            symbol.names.title = renamed;
        }
    }

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
        let Some(mut symbol) = self.swift.get(&usr).cloned() else { return };
        Self::fold_clashing(&mut symbol, reading);
        let bound = self.available(&symbol).and_then(|()| {
            let text = if decl.get("kind").and_then(Value::as_str) == Some("ObjCMethodDecl") {
                self.method(class, decl, &symbol)?
            } else {
                // `NSScriptClassDescription`'s `superclass` is Swift's name for
                // `superclassDescription`, and `NSObject`'s `superclass` is
                // another property at another type: the ancestor's keeps it.
                let (is_static, name, _) = Self::shape(&symbol);
                let getter = decl.get("getter").and_then(named).or_else(|| named(decl)).unwrap_or_default();
                if let Some(name) = name {
                    match reading.getters.get(&(is_static, name.clone())) {
                        Some(theirs) if *theirs != getter => {
                            return Err(format!("Swift's `{name}` is an ancestor's property read with `{theirs}`, not this one"));
                        }
                        _ => {
                            reading.getters.insert((is_static, name), getter);
                        }
                    }
                }
                self.property(class, decl, &symbol)?
            };
            // A clash the first label could not settle -- `menu(_:)` -- is
            // skipped: the first bound keeps the name.
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
        let instancetype = decl.get("returnType").map(written).is_some_and(|t| strip_attributes(&t).starts_with("instancetype"));
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
            if availability.domain.as_deref() != Some(self.platform) {
                continue;
            }
            if let Some(introduced) = availability.introduced.filter(|v| *v > self.target) {
                return Err(format!("introduced in {} {}.{}", self.platform, introduced.major, introduced.minor));
            }
            if let Some(deprecated) = availability.deprecated.filter(|v| *v <= self.target) {
                return Err(format!("deprecated in {} {}.{}", self.platform, deprecated.major, deprecated.minor));
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
        // A class method's form is a static member, and its function takes
        // no receiver: `NSAnimationContext.runAnimationGroup(changes)`.
        let is_static = decl.get("instance").and_then(Value::as_bool) == Some(false);
        let parameters = parameters_of(decl);
        let Some((handler, leading)) = parameters.split_last() else {
            return Err("no completion handler".to_owned());
        };
        let (base, labels) = swift_name(&asynchronous.names.title);
        let (method, method_labels) = swift_name(&symbol.names.title);
        if labels.len() != leading.len() || method_labels.get(..leading.len()) != Some(&labels[..]) {
            return Err("its arguments are labelled otherwise than the handler's method's".to_owned());
        }
        let written = strip_attributes(&written(handler.get("type").ok_or("a handler with no type")?));
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
        // Swift's `throws` rejects with the error's description, read through
        // the binding's `NSError` -- the class, or where it is not bound, the
        // stub a signature naming it makes, which declares that property.
        let nullable = given.iter().take(arity).any(|v| v.ends_with(" | null"));
        let (arguments, names) = self.arguments_shaped(class, leading, &labels, false)?;
        let mut function = format!("nts_async_{}_{base}", class.objc);
        while self.promises.iter().any(|promise| promise.function == function) {
            function.push('_');
        }
        let modifier = if is_static { "static " } else { "" };
        let overload = format!("    /** @ntsCall {function} */\n    {modifier}{}({arguments}): Promise<{value}>;", quoted(&base));
        self.promises.push(Promise {
            function,
            is_static,
            receiver: class.swift.rsplit('.').next().unwrap_or_default().to_owned(),
            method: quoted(&method),
            parameters: arguments,
            names,
            value,
            arity,
            given,
            throws,
            nullable,
        });
        Ok(overload)
    }

    /// Swift's rule for the arguments: the unlabelled ones first, positional,
    /// and every one from the first label on in one object, keyed by its
    /// label, which the call passes as a literal the compiler never builds.
    fn arguments(&mut self, class: &Class, parameters: &[&Value], labels: &[String]) -> std::result::Result<(String, Vec<String>), String> {
        self.arguments_shaped(class, parameters, labels, true)
    }

    /// The same, told whether a block last may be the trailing closure. It
    /// may not in an `async` form: the method it calls takes the completion
    /// handler last, so a block before it -- `animateKeyframes`'s
    /// `animations` -- is one of the labels there, and has to be here.
    fn arguments_shaped(
        &mut self,
        class: &Class,
        parameters: &[&Value],
        labels: &[String],
        trailing_closure: bool,
    ) -> std::result::Result<(String, Vec<String>), String> {
        let mut positional = Vec::new();
        let mut labelled = Vec::new();
        let mut keys = BTreeSet::new();
        let mut trailing = None;
        for (at, (parameter, label)) in parameters.iter().zip(labels).enumerate() {
            let spelled = self.spell(class, parameter.get("type").ok_or("a parameter with no type")?, Position::Parameter)?;
            let name = named(parameter).filter(|n| !n.is_empty() && !reserved(n) && n != "labels").unwrap_or_else(|| format!("arg{at}"));
            // Swift's trailing closure: a block last is passed after the
            // labels, unlabelled, as `sort { a, b in ... }` is written.
            if trailing_closure && at + 1 == parameters.len() && spelled.contains(") => ") {
                trailing = Some(format!("{name}: {spelled}"));
            } else if label == "_" && labelled.is_empty() {
                positional.push(format!("{name}: {spelled}"));
            } else {
                // Swift repeats a label -- `NSLayoutConstraint(item:attribute:
                // relatedBy:toItem:attribute:multiplier:constant:)` -- which one
                // object cannot hold twice: the repeat takes its parameter's own
                // name, the header's (`attr2`, `endRadius`, `newParent`).
                let key = if label == "_" { name.clone() } else { label.clone() };
                let key = if keys.contains(&key) { name.clone() } else { key };
                if !keys.insert(key.clone()) {
                    return Err(format!("Swift repeats the label `{key}`, which one object cannot"));
                }
                labelled.push(format!("{}: {spelled}", quoted_key(&key)));
            }
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
        let ty = decl.get("type").ok_or("no type")?;
        // A block: a closure the program sets -- Swift's `var completionBlock:
        // (() -> Void)?` -- and not one it reads back, which would make a
        // function of a block. So only the setter.
        if written(ty).contains("(^") || desugared(ty).is_some_and(|d| d.contains("(^")) {
            return self.block_property(class, decl, symbol, ty);
        }
        let clang = self.spell(class, ty, Position::Result)?;
        let spelled = optional_as_swift(clang.clone(), symbol.optionality() == Optionality::Optional);
        // What the setter takes: `null` too for a `null_resettable` property,
        // which Swift writes `T!`.
        let written = optional_as_swift(self.or_fields(spelled.clone()), symbol.optionality() != Optionality::Neither);
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

    /// A block property as its setter alone: `set completionBlock(value: (()
    /// => void) | null)`. A read-only one has nothing to set.
    fn block_property(&mut self, class: &Class, decl: &Value, symbol: &Symbol, ty: &Value) -> std::result::Result<String, String> {
        if decl.get("readonly").and_then(Value::as_bool) == Some(true) {
            return Err("a block as a result or a read-only property".to_owned());
        }
        let name = named(decl).unwrap_or_default();
        let closure = self.spell(class, ty, Position::Parameter)?;
        let optional = written(ty).contains("_Nullable") || symbol.optionality() != Optionality::Neither;
        // A nullable block is spelled optional already (`spell`).
        let value = if optional && !closure.ends_with(" | null") { format!("({closure}) | null") } else { closure };
        let swift_name = symbol.names.title.clone();
        let setter = decl.get("setter").and_then(named).unwrap_or_else(|| format!("set{}:", capitalized(&name)));
        let is_static = if decl.get("class").and_then(Value::as_bool) == Some(true) { "static " } else { "" };
        let mut text = String::new();
        if setter != format!("set{}:", capitalized(&swift_name)) {
            let _ = writeln!(text, "    /** @ntsSet {setter} */");
        }
        let _ = write!(text, "    {is_static}set {}(value: {value});", quoted_key(&swift_name));
        Ok(text)
    }

    fn spell(&mut self, class: &Class, ty: &Value, position: Position) -> Spelled {
        let written = strip_attributes(&written(ty));
        let desugared = desugared(ty).unwrap_or_default();
        let or_null = |text: String| if written.contains("_Nullable") { format!("{text} | null") } else { text };
        if written.contains("(^") || desugared.contains("(^") {
            // A block type the header names by a typedef --
            // `NSTableViewDiffableDataSourceCellProvider` -- is read from what
            // the typedef spells.
            let spelled = if written.contains("(^") { written.clone() } else { desugared.clone() };
            return match position {
                // Swift's `((Bool) -> Void)?`: the block pointer's own
                // nullability, `(^ _Nullable)`, not one of its parameters'.
                Position::Parameter => self.block(class, &spelled).map(|closure| {
                    if block_is_nullable(&spelled) { format!("({closure}) | null") } else { closure }
                }),
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
            // `id<UITableViewDataSource>`: the protocol, where this binding
            // declares it -- Swift's `(any UITableViewDataSource)?`. An object
            // of a class conforming to more than one is an object.
            if let Some(protocol) = self.declared_protocol(&desugared) {
                return Ok(or_null(protocol));
            }
            return Ok(or_null(self.object("NSObject")));
        }
        // Not a pointer: `NSUInteger *` is written starting `NSUInteger`, and
        // read as that number it passed an integer where the message writes
        // through an address.
        if !desugared.contains('*')
            && let Some(number) = swift_number(&written, &desugared)
        {
            self.import("objc:types", number);
            return Ok(number.to_owned());
        }
        if let Some(name) = desugared.strip_prefix("enum ") {
            return self.enumeration(name);
        }
        // A Core Foundation class: `CGContextRef` is `CGContext`.
        if let Some(name) = self.cf_types.get(desugared.as_str()).cloned() {
            self.import("objc:types", "ObjcClass");
            return Ok(or_null(name));
        }
        if let Some(pointee) = desugared.strip_suffix(" *") {
            let pointee = pointee.trim_start_matches("__kindof ");
            let base = pointee.split('<').next().unwrap_or_default().trim();
            if base == "NSString" && position != Position::Block {
                if self.c_function {
                    self.import("objc:types", "BridgedString");
                    return Ok(or_null("BridgedString".to_owned()));
                }
                return Ok(or_null("string".to_owned()));
            }
            if self.c_function && position != Position::Block && matches!(base, "NSArray" | "NSDictionary" | "NSSet") {
                return Err(format!("a collection, `{base}`, which a C function passes as the object it is and only a message copies"));
            }
            // Swift's `[T]`: an `NSArray` is copied into a TypeScript array and
            // out of one, its elements objects or strings. Not a mutable one,
            // which Swift keeps as the object it is.
            if base == "NSArray" && position != Position::Block {
                // Swift's `[T]?` where the header says `_Nullable`.
                return self.array_element(pointee).map(|element| or_null(format!("{element}[]")));
            }
            // Swift's `[String: V]`: a map of string keys, copied into the
            // `NSDictionary` a message takes and out of the one it answers.
            if base == "NSDictionary" && position != Position::Block {
                return self.dictionary(pointee).map(&or_null);
            }
            // Swift's `Set<T>`: copied into a TypeScript `Set` and out of one,
            // its elements objects -- hashed and compared by `-hash` and
            // `-isEqual:`, as Swift's are -- or strings.
            if base == "NSSet" && position != Position::Block {
                return self.array_element(pointee).map(|element| or_null(format!("Set<{element}>")));
            }
            if position != Position::Block
                && matches!(base, "NSMutableArray" | "NSDictionary" | "NSMutableDictionary" | "NSSet" | "NSMutableSet" | "NSOrderedSet")
            {
                return Err(format!("a collection, `{base}`, which crosses as an object when it is bound"));
            }
            if self.headers.supers.contains_key(base) {
                return Ok(or_null(self.object(base)));
            }
            return self.unsafe_pointer(&written, pointee, &desugared, position);
        }
        if let Some(name) = desugared.strip_prefix("struct ").filter(|name| !name.ends_with('*')) {
            return self.by_value(name, position);
        }
        Err(format!("a `{desugared}`"))
    }

    /// A pointer to something that is not an object: Swift's `Unsafe...Pointer`
    /// types, each as the address a program passes or is handed.
    fn unsafe_pointer(&mut self, written: &str, pointee: &str, desugared: &str, position: Position) -> Spelled {
        let or_null = |text: String| if written.contains("_Nullable") { format!("{text} | null") } else { text };
        if position == Position::Parameter && (pointee == "const char" || pointee == "char") {
            self.import("objc:types", "CString");
            return Ok("CString".to_owned());
        }
        // Swift's `UnsafePointer<CChar>` result -- `utf8String`,
        // `fileSystemRepresentation` -- which a Swift program reads with
        // `String(cString:)`: the text, copied when the message answers, so an
        // inner pointer (`NS_RETURNS_INNER_POINTER`) is read while it holds.
        if position == Position::Result && pointee == "const char" {
            self.import("objc:types", "CString");
            return Ok(or_null("CString".to_owned()));
        }
        // Swift's `UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>`, a
        // `char **` such as `UIApplicationMain`'s `argv`: an address, as
        // Swift has it. Not a `CStrings`, which says C gives the array back
        // when the call returns -- a claim no header makes.
        if position == Position::Parameter {
            let strings = pointee.replace("_Nullable", "").replace("_Nonnull", "");
            if matches!(strings.split_whitespace().collect::<Vec<_>>().join(" ").as_str(), "char *" | "const char *" | "const char *const") {
                self.import("c:types", "Ptr");
                return Ok(or_null("Ptr<unknown>".to_owned()));
            }
        }
        // Swift's `UnsafeMutablePointer<ObjCBool>`: a `BOOL *`, like
        // `fileExists(atPath:isDirectory:)`'s, whose byte is read as `[0]`
        // -- or a block's `stop`, which the closure writes.
        if matches!(position, Position::Parameter | Position::Block) && written.trim_start_matches("const ").starts_with("BOOL") {
            self.import("objc:types", "ObjCBool");
            self.import("c:types", "Ptr");
            return Ok(or_null("Ptr<ObjCBool>".to_owned()));
        }
        // Swift's `UnsafeMutablePointer<CGFloat>`, an out parameter like
        // `getRed(_:green:blue:alpha:)`'s: the address of the number, which
        // a program passes as `local<CGFloat>()` and reads as `[0]`.
        if position == Position::Parameter
            && !pointee.contains('*')
            && let Some(number) = swift_number(
                written.split('*').next().unwrap_or_default().trim().trim_start_matches("const ").trim(),
                pointee.trim_start_matches("const "),
            )
        {
            self.import("objc:types", number);
            self.import("c:types", "Ptr");
            return Ok(or_null(format!("Ptr<{number}>")));
        }
        // Swift's `UnsafeMutablePointer<NSRange>` -- an out parameter, or
        // a record read in place -- as the address a program passes:
        // `local<NSRange>()`.
        if position == Position::Parameter
            && let Some(name) = struct_through_typedefs(&self.typedefs, pointee.trim_start_matches("const "))
            && self.headers.records.contains_key(&name)
        {
            let name = name.as_str();
            self.record(name)?;
            self.import("c:types", "Ptr");
            return Ok(or_null(format!("Ptr<{}>", record_name(&self.typedefs, name))));
        }
        // Swift's `UnsafeMutableRawPointer`: an address the program
        // passes, or is handed, and does not read as any type.
        if pointee.trim_start_matches("const ") == "void" && position != Position::Block {
            self.import("c:types", "Ptr");
            return Ok(or_null("Ptr<unknown>".to_owned()));
        }
        // `struct CGColor *`, the pointer a Core Foundation class's `Ref`
        // typedef names: a class Swift imports, which this binding binds
        // only when asked to.
        if let Some(tag) = desugared.strip_prefix("struct ").and_then(|rest| rest.strip_suffix(" *"))
            && self.typedefs.get(&format!("{tag}Ref")).is_some_and(|aliased| aliased.trim_start_matches("const ") == desugared)
        {
            return Err(format!("`{tag}`, a Core Foundation class this binding does not bind (`--class {tag}`)"));
        }
        Err(format!("a `{desugared}`"))
    }

    /// A record C passes by value: `ByValue<CGRect>`, which a parameter also
    /// takes written as its fields.
    fn by_value(&mut self, name: &str, position: Position) -> Spelled {
        self.record(name)?;
        self.import("c:types", "ByValue");
        let spelled = format!("ByValue<{}>", record_name(&self.typedefs, name));
        Ok(if position == Position::Parameter { self.or_fields(spelled) } else { spelled })
    }

    /// What a program passes where C takes a record by value: the record's
    /// storage, or its fields written as a literal, as Swift writes
    /// `NSRect(origin:size:)` -- `ByValue<CGRect> | Fields<CGRect>`. Any
    /// other type is itself.
    fn or_fields(&mut self, spelled: String) -> String {
        let Some(record) = spelled.strip_prefix("ByValue<").and_then(|rest| rest.strip_suffix('>')) else { return spelled };
        self.import("c:types", "Fields");
        format!("{spelled} | Fields<{record}>")
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
            spelled.push(self.spell(class, &block_part(piece, &self.typedefs), Position::Block)?);
        }
        // `NS_SWIFT_UI_ACTOR void (^)(BOOL)`: an attribute of the block, not
        // part of its result's type.
        let result = match strip_attributes(result).as_str() {
            "void" => "void".to_owned(),
            result => self.spell(class, &block_part(result, &self.typedefs), Position::Block)?,
        };
        Ok((spelled, result))
    }

    /// What an `NSArray<T *>` holds, as the element of a TypeScript array:
    /// a class's objects, strings for `NSString`, and `NSObject` where the
    /// header says only `id`.
    /// `NSDictionary<NSString *, V> *` as `Map<string, V>`: keys that are
    /// strings, through any typedef (`NSAttributedStringKey`), and a value
    /// that is an object -- `id` is `NSObject` -- or a string.
    fn dictionary(&mut self, pointee: &str) -> Spelled {
        let arguments = pointee.split_once('<').map(|(_, rest)| rest.trim_end().trim_end_matches('>').trim());
        let Some((key, value)) = arguments.and_then(|arguments| arguments.split_once(',')) else {
            return Err("a dictionary whose key type the header does not name".to_owned());
        };
        let key = key.trim().trim_end_matches('*').trim();
        let key_is_string = key == "NSString"
            || self.typedefs.get(key).is_some_and(|aliased| aliased.trim().trim_end_matches('*').trim() == "NSString");
        if !key_is_string {
            return Err(format!("a dictionary keyed by `{key}`, which a map of strings cannot be"));
        }
        let value = value.trim().trim_start_matches("__kindof ").trim();
        let value = if value == "id" || value.starts_with("id<") {
            self.object("NSObject")
        } else {
            let class = value.trim_end_matches('*').trim();
            let class = class.split_once('<').map_or(class, |(class, _)| class.trim());
            if class == "NSString" {
                "string".to_owned()
            } else if self.headers.supers.contains_key(class) {
                self.object(class)
            } else {
                return Err(format!("a dictionary of `{value}`"));
            }
        };
        Ok(format!("Map<string, {value}>"))
    }

    /// Each constant Swift imports as a static property of a bound class --
    /// `UITextField.textDidChangeNotification` -- as a static getter of that
    /// class tagged with the C variable it reads (`@ntsSymbol`). Its type is
    /// spelled as a C function's result is, so an `NSString *` is a
    /// `BridgedString`. A constant clang did not declare, or one the target
    /// does not have, is listed with its reason.
    pub(super) fn read_constants(&mut self, constants: &BTreeMap<String, (String, Symbol)>, variables: &BTreeMap<String, Value>) {
        for (name, (objc, symbol)) in constants {
            let Some(at) = self.classes.iter().position(|class| &class.objc == objc) else { continue };
            let spelling = Class {
                objc: self.classes[at].objc.clone(),
                swift: self.classes[at].swift.clone(),
                parent: None,
                members: Vec::new(),
                skipped: Vec::new(),
                sent: Vec::new(),
            };
            let spelled = self.available(symbol).and_then(|()| {
                let ty = without_top_const(variables.get(name).ok_or("no header here declares it")?);
                self.in_c_function(|model| model.spell(&spelling, &ty, Position::Result))
            });
            let class = &mut self.classes[at];
            match spelled {
                Ok(ty) => class.members.push(format!(
                    "    /** @ntsSymbol {name} */\n    static get {}(): {ty};",
                    quoted_key(&symbol.names.title)
                )),
                Err(why) => class.skipped.push(format!("{name}: {why}")),
            }
        }
    }

    /// `spell` a C function's parameters or result: `c_function` for the
    /// span of `body`, and restored after it whatever it answers.
    pub(super) fn in_c_function<T>(&mut self, body: impl FnOnce(&mut Self) -> T) -> T {
        let outer = std::mem::replace(&mut self.c_function, true);
        let answer = body(self);
        self.c_function = outer;
        answer
    }

    /// The Swift name of protocol `objc`, as its graph gives it.
    fn protocol_name(&self, objc: &str) -> String {
        self.swift.get(&format!("c:objc(pl){objc}")).map_or_else(|| objc.to_owned(), |s| s.names.title.clone())
    }

    /// The declared protocols class `objc` conforms to, by Swift name: those
    /// it adopts, in its interface or a category, and those they refine, as
    /// far as the chain goes. What Swift's `extension UITextField:
    /// UITextInput` gives it: `textField.insertText(_:)`.
    fn conformances(&self, objc: &str) -> Vec<String> {
        let mut seen = BTreeSet::new();
        let mut pending: Vec<&String> = self.headers.adopts.get(objc).into_iter().flatten().collect();
        while let Some(protocol) = pending.pop() {
            if seen.insert(protocol.clone()) {
                pending.extend(self.headers.adopts.get(protocol).into_iter().flatten());
            }
        }
        seen.iter().filter(|protocol| self.declared_protocols.contains(*protocol)).map(|protocol| self.protocol_name(protocol)).collect()
    }

    /// The Swift name of the one protocol `id<P>` names, where this binding
    /// declares `P`.
    fn declared_protocol(&self, desugared: &str) -> Option<String> {
        let inner = desugared.strip_prefix("id<")?.split_once('>')?.0.trim();
        if inner.contains(',') || !self.declared_protocols.contains(inner) {
            return None;
        }
        Some(self.swift.get(&format!("c:objc(pl){inner}")).map_or_else(|| inner.to_owned(), |s| s.names.title.clone()))
    }

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
        if let Some(aliased) = self.typedefs.get(class).cloned()
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
    if object && !SWIFT_NUMBERS.contains(&spelled.as_str()) && !spelled.ends_with(" | null") && optional {
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
/// Overloads of one name in the order TypeScript should try them: a
/// JavaScript number is a double, and TypeScript takes the first overload a
/// call fits, so where Swift tells `set(_: Int, forKey:)` from `set(_:
/// Double, forKey:)` by the literal's type, a `number` must reach the
/// `Double` one -- lossless -- and not the `Int` one declared before it,
/// which truncated `set(1.5, ...)` without a word. Among one name's members,
/// those taking a double come first, then a float, then an integer; members
/// of different names keep the header's order.
fn prefer_doubles(members: &mut Vec<String>) {
    let name = |member: &str| {
        let declaration = member.lines().last().unwrap_or_default().trim();
        let declaration = declaration.trim_start_matches("static ").trim_start_matches("get ").trim_start_matches("set ");
        declaration.split('(').next().unwrap_or_default().to_owned()
    };
    let rank = |member: &str| {
        let parameters = member.lines().last().unwrap_or_default().split_once('(').map_or("", |(_, rest)| rest);
        let parameters = parameters.rsplit_once("):").map_or(parameters, |(parameters, _)| parameters);
        let has = |names: &[&str]| names.iter().any(|ty| parameters.contains(&format!(": {ty}")) || parameters.contains(&format!(": {ty};")));
        if has(&["Double", "CGFloat", "TimeInterval"]) {
            0
        } else if has(&["Float"]) {
            1
        } else if has(&["Int", "UInt", "Int8", "UInt8", "Int16", "UInt16", "Int32", "UInt32", "Int64", "UInt64"]) {
            2
        } else {
            0
        }
    };
    let mut order: Vec<String> = Vec::new();
    let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for member in members.drain(..) {
        let key = name(&member);
        if !groups.contains_key(&key) {
            order.push(key.clone());
        }
        groups.entry(key).or_default().push(member);
    }
    for key in order {
        let mut group = groups.remove(&key).unwrap_or_default();
        group.sort_by_key(|member| rank(member));
        members.extend(group);
    }
}

/// The struct a type names, through as many typedefs as it takes: `NSRect`
/// is `CGRect`, which is `struct CGRect`.
fn struct_through_typedefs(typedefs: &BTreeMap<String, String>, spelled: &str) -> Option<String> {
    let mut at = spelled.trim().to_owned();
    for _ in 0..8 {
        if let Some(tag) = at.strip_prefix("struct ") {
            return Some(tag.trim().to_owned());
        }
        at = typedefs.get(&at)?.trim().to_owned();
    }
    None
}

/// The name a record is written under: Swift's, which for a struct whose tag
/// is underscored is the typedef beside it (`_NSRange` is `NSRange`), and
/// otherwise the tag.
fn record_name(typedefs: &BTreeMap<String, String>, tag: &str) -> String {
    let plain = tag.trim_start_matches('_');
    if plain != tag && typedefs.get(plain).is_some_and(|aliased| aliased.trim() == format!("struct {tag}")) {
        return plain.to_owned();
    }
    tag.to_owned()
}

/// A method's Swift name with its first label moved into the base name:
/// `menu(for:inRect:)` is `menuFor(_:inRect:)`, and where the first argument
/// has none, the first label there is -- `splitView(_:canCollapseSubview:)`
/// is `splitViewCanCollapseSubview(_:_:)`. None when no argument has one.
fn folded_label(title: &str) -> Option<String> {
    let (base, rest) = title.split_once('(')?;
    let mut labels: Vec<String> = rest.trim_end_matches(')').split(':').filter(|l| !l.is_empty()).map(str::to_owned).collect();
    let at = labels.iter().position(|label| label != "_")?;
    let folded = std::mem::replace(&mut labels[at], "_".to_owned());
    Some(format!("{base}{}({}:)", capitalized(&folded), labels.join(":")))
}

/// A method's declaration with its positional parameters' names taken out:
/// `f(cView: NSClipView)` and `f(clipView: NSClipView)` are one overload. A
/// label object's keys are not names, and stay.
fn unnamed(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let (mut parens, mut nested) = (0usize, 0usize);
    let mut at_parameter = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '(' => {
                parens += 1;
                at_parameter = parens == 1 && nested == 0;
                out.push(c);
                continue;
            }
            ')' => parens = parens.saturating_sub(1),
            '{' | '<' | '[' => nested += 1,
            '}' | '>' | ']' => nested = nested.saturating_sub(1),
            ',' if parens == 1 && nested == 0 => {
                out.push(c);
                at_parameter = true;
                continue;
            }
            _ => {}
        }
        if at_parameter && (c.is_alphanumeric() || c == '_' || c == '$') {
            // The name, up to its colon.
            while chars.peek().is_some_and(|next| next.is_alphanumeric() || *next == '_' || *next == '$') {
                chars.next();
            }
            out.push(if chars.peek() == Some(&':') { '_' } else { c });
            at_parameter = false;
            continue;
        }
        if !c.is_whitespace() {
            at_parameter = false;
        }
        out.push(c);
    }
    out
}

fn swift_name(title: &str) -> (String, Vec<String>) {
    let Some((base, rest)) = title.split_once('(') else { return (title.to_owned(), Vec::new()) };
    let labels = rest.trim_end_matches(')').split(':').filter(|l| !l.is_empty()).map(str::to_owned).collect();
    (base.to_owned(), labels)
}

/// Every name [`swift_number`] answers: a number, which no `?` makes
/// nullable.
const SWIFT_NUMBERS: [&str; 14] = [
    "CGFloat", "TimeInterval", "Int", "UInt", "Double", "Float", "Int8", "UInt8", "Int16", "UInt16", "Int32", "UInt32",
    "Int64", "UInt64",
];

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

/// A requirement's `NSString` as Swift's `String`: the entry point copies a
/// parameter in (`lent_ns_string`) and makes a result's `NSString`
/// (`answered_ns_string`). An array or a dictionary still crosses as the
/// object it is.
fn swift_string(spelled: String) -> String {
    match spelled.as_str() {
        "NSString" => "string".to_owned(),
        "NSString | null" => "string | null".to_owned(),
        _ => spelled,
    }
}

/// Whether the block pointer itself is nullable -- `void (^ _Nullable)(BOOL)`
/// -- read from the marker between `(^` and its `)`, where one of the
/// block's parameters being nullable (`(NSError * _Nullable)`) says nothing.
fn block_is_nullable(written: &str) -> bool {
    written.split_once("(^").and_then(|(_, rest)| rest.split_once(')')).is_some_and(|(marker, _)| {
        marker.split_whitespace().any(|word| word == "_Nullable" || word == "__nullable" || word == "_Null_unspecified")
    })
}

/// A variable's type without its own top-level `const` -- `NSString *const`
/// is an `NSString *` the program cannot reassign, which says nothing about
/// how its value crosses. Only a variable has one: a parameter's or result's
/// is dropped by C itself.
fn without_top_const(ty: &Value) -> Value {
    let mut ty = ty.clone();
    if let Value::Object(fields) = &mut ty {
        for key in ["qualType", "desugaredQualType"] {
            if let Some(Value::String(text)) = fields.get_mut(key)
                && let Some(stripped) = text.trim_end().strip_suffix("const").map(str::trim_end)
                && stripped.ends_with('*')
            {
                *text = stripped.to_owned();
            }
        }
    }
    ty
}

/// A type without the attributes clang writes before it: availability
/// (`API_AVAILABLE(macos(11.0)) NSString *`) and Swift's own
/// (`NS_SWIFT_UI_ACTOR void`). Neither says anything about how it crosses.
fn strip_attributes(written: &str) -> String {
    let mut text = written.trim().to_owned();
    // Swift's attributes, which name no type: `NS_SWIFT_UI_ACTOR`,
    // `NS_SWIFT_SENDABLE`, `NS_REFINED_FOR_SWIFT`, each with no arguments.
    let bare = |text: &str| {
        let word = text.split(|c: char| c.is_whitespace() || c == '(').next().unwrap_or_default();
        (word.starts_with("NS_SWIFT_") || word == "NS_REFINED_FOR_SWIFT") && !text[word.len()..].trim_start().starts_with('(')
    };
    while bare(&text) || text.starts_with("API_") || text.starts_with("NS_SWIFT_") {
        if bare(&text) {
            let word = text.split_whitespace().next().unwrap_or_default().len();
            text = text[word..].trim().to_owned();
            continue;
        }
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

/// A protocol as the interface a class the program writes implements, and
/// the type a value of it has: nested where Swift nests it.
fn render_protocol(out: &mut String, protocol: &Protocol) {
    let path: Vec<String> = protocol.swift.split('.').map(str::to_owned).collect();
    let mut text = String::new();
    let _ = writeln!(
        text,
        "  /** @ntsProtocol {} */\n  export interface {} extends {} {{",
        protocol.objc,
        path.last().map_or("", String::as_str),
        std::iter::once(protocol.base.as_str()).chain(protocol.refines.iter().map(String::as_str)).collect::<Vec<_>>().join(", ")
    );
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
    nest(out, &path, &text);
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
            .chain(request.functions.iter().map(|f| format!("--function {f}")))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let _ = writeln!(out, "/**");
    for framework in &request.frameworks {
        let _ = writeln!(out, " * @ntsFramework {framework}");
    }
    // A module of C frameworks alone -- Core Graphics -- names their headers,
    // which C can include: the records are theirs, and the witness compares
    // each function's prototype with the header's. An Objective-C header
    // cannot be included from C, so a module binding a class names none.
    if model.classes.is_empty() {
        for framework in &request.frameworks {
            let _ = writeln!(out, " * @ntsHeader <{framework}/{framework}.h>");
        }
    }
    let _ = writeln!(out, " */\ndeclare module \"{}\" {{", request.module);
    for (module, names) in &model.imports {
        let _ = writeln!(out, "  import type {{ {} }} from \"{module}\";", names.iter().copied().collect::<Vec<_>>().join(", "));
    }
    for name in &model.records {
        let fields = model.headers.records.get(name).map(Vec::as_slice).unwrap_or_default();
        let typedefs = &model.typedefs;
        let members: Vec<String> = fields
            .iter()
            .map(|(field, ty)| {
                let spelled = ty
                    .strip_prefix("struct ")
                    .map_or_else(|| swift_number(ty, ty).unwrap_or("never").to_owned(), |inner| record_name(typedefs, inner));
                format!("{field}: {spelled}")
            })
            .collect();
        // Under Swift's name, and C's struct tag in the brand, which is what
        // the backends spell: `NSRange` is `struct _NSRange`.
        let _ = writeln!(out, "\n  export type {} = Struct<{{ {} }}, \"{name}\">;", record_name(typedefs, name), members.join("; "));
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
        // Its conformances, merged into the class as TypeScript merges an
        // interface of the same name: the protocols' methods are its own.
        let conformances = model.conformances(&class.objc);
        if !conformances.is_empty() {
            let _ = writeln!(text, "  export interface {} extends {} {{}}", path.last().map_or("", String::as_str), conformances.join(", "));
        }
        nest(&mut out, &path, &text);
    }
    for protocol in &model.protocols {
        render_protocol(&mut out, protocol);
    }
    for class in &model.cf_classes {
        cf::render(&mut out, class);
    }
    for function in &model.functions {
        let _ = writeln!(out, "{function}");
    }
    for (name, parent) in &model.mentioned {
        let extends = parent.as_ref().map(|p| format!(" extends {}", model.swift.class(p))).unwrap_or_default();
        let swift = model.swift.class(name);
        let path: Vec<String> = swift.split('.').map(str::to_owned).collect();
        // An `NSError` a completion handler is given: what an `async throws`
        // form rejects with is its description.
        let members = if name == "NSError" { "\n    get localizedDescription(): string;\n  " } else { "" };
        let text = format!(
            "  /** Named by a signature here, and not bound: its ancestors' members only.\n   * @ntsClass {name} */\n  export class {}{extends} {{{members}}}\n",
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
        // The operation is outstanding from before the message -- a handler
        // Cocoa calls at once, inside it, ends what was begun -- until the
        // handler's first statement, so a program with nothing else to do
        // waits for it (`c:pending`). The message itself cannot throw: a
        // method taking a completion handler reports through the handler.
        let mut handler = names.clone();
        if promise.throws {
            handler.push("error".to_owned());
        }
        let typed: Vec<String> = handler.iter().zip(&promise.given).map(|(name, ty)| format!("{name}: {ty}")).collect();
        let executor = if promise.throws {
            arguments.push(format!(
                "({}) => {{\n      nts_pending_end();\n      if (error !== null) {{\n        reject(new Error(error.localizedDescription));\n      }} else {{\n        resolve({settled});\n      }}\n    }}",
                typed.join(", ")
            ));
            "(resolve, reject)"
        } else {
            arguments.push(format!("({}) => {{\n      nts_pending_end();\n      resolve({settled});\n    }}", typed.join(", ")));
            "(resolve)"
        };
        // An instance method's function takes the receiver first; a class
        // method's sends to the class.
        let (parameters, target) = if promise.is_static {
            (promise.parameters.clone(), promise.receiver.clone())
        } else if promise.parameters.is_empty() {
            (format!("self: {}", promise.receiver), "self".to_owned())
        } else {
            (format!("self: {}, {}", promise.receiver, promise.parameters), "self".to_owned())
        };
        let _ = write!(
            bodies,
            "\nexport function {}({parameters}): Promise<{}> {{\n  return new Promise({executor} => {{\n    nts_pending_begin();\n    {target}.{}({});\n  }});\n}}\n",
            promise.function,
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
    own.extend(model.records.iter().map(|name| record_name(&model.typedefs, name)));
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
    out.push_str("import { nts_pending_begin, nts_pending_end } from \"c:pending\";\n");
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

    /// Files made so far by this process. The process id alone named one
    /// file for every binding a process makes, so two made at once -- a build
    /// binding two modules, or two tests -- wrote over each other's.
    static MADE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    impl TempFile {
        pub(crate) fn with(suffix: &str, text: &str) -> Result<Self> {
            let made = MADE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!("nts-bind-objc-{}-{made}{suffix}", std::process::id()));
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
        // `SWIFT_NUMBERS` is every name `swift_number` answers, and nothing
        // else: the two say one thing, and a name missing from the list is
        // a number given a `| null`.
        let c_types = [
            ("CGFloat", "double"),
            ("NSTimeInterval", "double"),
            ("NSInteger", "long"),
            ("NSUInteger", "unsigned long"),
            ("double", "double"),
            ("float", "float"),
            ("int", "int"),
            ("unsigned int", "unsigned int"),
            ("long", "long"),
            ("unsigned long", "unsigned long"),
            ("long long", "long long"),
            ("unsigned long long", "unsigned long long"),
            ("short", "short"),
            ("unsigned short", "unsigned short"),
            ("char", "char"),
            ("unsigned char", "unsigned char"),
        ];
        let answered: std::collections::BTreeSet<&str> = c_types.iter().filter_map(|(w, d)| swift_number(w, d)).collect();
        let listed: std::collections::BTreeSet<&str> = SWIFT_NUMBERS.iter().copied().collect();
        assert_eq!(answered, listed);
        // A class whose name is as short as a number's is still an object.
        assert_eq!(optional_as_swift("UILabel".to_owned(), true), "UILabel | null");
        assert_eq!(optional_as_swift("UInt64".to_owned(), true), "UInt64");
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
typedef struct _Span { NSUInteger location; NSUInteger length; } Span;
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
@interface NSDictionary<KeyType, ObjectType> : Root
@end
@interface NSSet<ObjectType> : Root
@end
typedef NSString *ShapeKind;
@protocol ShapeDelegate;
@interface Root (Continued)
- (instancetype)init;
- (BOOL)isEqual:(Root *)other;
@end
@class Shape;
typedef Shape * _Nonnull (^ShapeMaker)(NSInteger count);
NS_ASSUME_NONNULL_BEGIN
@interface Shape<TagType> : Root
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
- (Shape *)twinOfShape:(Shape *)other;
- (BOOL)twinShape:(Shape *)shape canJoin:(Shape *)other;
- (void)measure:(Span *)span;
- (void)linkFrom:(Shape *)start to:(Shape *)middle to:(Shape *)end;
- (void)countInto:(NSUInteger *)count;
- (BOOL)holdsAt:(NSString *)name inside:(BOOL *)inside;
- (void)setInteger:(NSInteger)value forKey:(NSString *)key;
- (void)setDouble:(double)value forKey:(NSString *)key;
- (void)placeShapes:(NSDictionary<ShapeKind, Shape *> *)shapes;
- (NSDictionary<NSString *, NSString *> *)labels;
- (void)fillWith:(ShapeMaker)maker;
- (NSArray<TagType> *)tags;
@property (readonly) Shape *twin;
@property (readonly) CGPoint origin;
@property CGPoint center;
@property (getter=isHidden) BOOL hidden;
@property (class, readonly) Shape *unit;
@property (readonly, weak) Shape *owner;
@property (null_resettable, copy) NSString *label;
@property (nullable, copy) void (^onChange)(Shape *shape);
@end
@interface Shape (Named)
- (void)paint:(Shape *)other;
@property (readonly) Shape *peer;
- (void)renameTo:(Shape *)other count:(NSInteger)count;
- (NSSet<Shape *> *)neighboursNamed:(NSSet<NSString *> *)names;
@end
typedef NSInteger Response;
@interface Shape (Async)
- (void)settleWith:(Shape *)other completionHandler:(void (^)(Response))handler;
- (void)fetchNamed:(NSString *)name completionHandler:(void (^)(Shape * _Nullable, NSError * _Nullable))handler;
- (void)pairWithCompletionHandler:(void (^)(Shape * _Nullable, NSString * _Nullable, NSError * _Nullable))handler;
+ (void)runGroup:(void (^)(Shape *))changes completionHandler:(void (^)(void))handler;
@end
@interface Circle : Shape
- (void)paint:(Circle *)other;
@property (readonly) Circle *peerCircle;
@end
@protocol ShapeDelegate
- (void)shapeDidMove:(Shape *)shape;
@property (nullable) Shape *partner;
@optional
@property (readonly, getter=isVisible) BOOL visible;
- (void)shapeDidRename:(Shape *)shape;
- (void)shape:(Shape *)shape didRenameTo:(NSString *)name;
- (BOOL)shape:(Shape *)shape shouldHide:(BOOL)hide;
+ (void)classSide;
@property int size;
@end
NS_ASSUME_NONNULL_END
typedef struct Pen *PenRef;
PenRef PenCreate(CGFloat width);
void PenStroke(PenRef pen, CGPoint at);
CGFloat PenGetWidth(PenRef pen);
PenRef _Nullable PenCopyTwin(PenRef pen, PenRef other);
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
            // A subclass redeclaring its base's selector at a narrower type,
            // and a property Swift names as an ancestor's other one.
            symbol("c:objc(cs)Shape(im)paint:", "swift.method", "paint(_:)", &["Shape", "paint(_:)"], ""),
            symbol("c:objc(cs)Circle(im)paint:", "swift.method", "paint(_:)", &["Round", "paint(_:)"], ""),
            symbol("c:objc(cs)Shape(py)peer", "swift.property", "peer", &["Shape", "peer"], ""),
            symbol("c:objc(cs)Circle(py)peerCircle", "swift.property", "peer", &["Round", "peer"], ""),
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
            symbol("c:objc(cs)Shape(im)neighboursNamed:", "swift.method", "neighbours(named:)", &["Shape", "neighbours(named:)"], ""),
            symbol("c:objc(cs)Shape(im)names", "swift.method", "names()", &["Shape", "names()"], ""),
            symbol("c:objc(cs)Shape(im)maybe", "swift.method", "maybe()", &["Shape", "maybe()"], ""),
            symbol("c:objc(cs)Shape(im)adopt:", "swift.method", "adopt(_:)", &["Shape", "adopt(_:)"], ""),
            symbol("c:objc(cs)Shape(im)registerTypes:", "swift.method", "register(_:)", &["Shape", "register(_:)"], ""),
            symbol("c:objc(cs)Shape(im)delegates", "swift.method", "delegates()", &["Shape", "delegates()"], ""),
            symbol("c:objc(cs)Shape(im)twinOfShape:", "swift.method", "twin(of:)", &["Shape", "twin(of:)"], ""),
            symbol("c:objc(cs)Shape(im)twinShape:canJoin:", "swift.method", "twin(_:canJoin:)", &["Shape", "twin(_:canJoin:)"], ""),
            symbol("c:objc(cs)Shape(im)measure:", "swift.method", "measure(_:)", &["Shape", "measure(_:)"], ""),
            symbol("c:objc(cs)Shape(im)linkFrom:to:to:", "swift.method", "link(from:to:to:)", &["Shape", "link(from:to:to:)"], ""),
            symbol("c:objc(cs)Shape(im)countInto:", "swift.method", "count(into:)", &["Shape", "count(into:)"], ""),
            symbol("c:objc(cs)Shape(im)holdsAt:inside:", "swift.method", "holds(at:inside:)", &["Shape", "holds(at:inside:)"], ""),
            symbol("c:objc(cs)Shape(im)setInteger:forKey:", "swift.method", "set(_:forKey:)", &["Shape", "set(_:forKey:)"], ""),
            symbol("c:objc(cs)Shape(im)setDouble:forKey:", "swift.method", "set(_:forKey:)", &["Shape", "set(_:forKey:)"], ""),
            symbol("c:objc(cs)Shape(im)placeShapes:", "swift.method", "place(_:)", &["Shape", "place(_:)"], ""),
            symbol("c:objc(cs)Shape(im)labels", "swift.method", "labels()", &["Shape", "labels()"], ""),
            symbol("c:objc(cs)Shape(im)fillWith:", "swift.method", "fill(with:)", &["Shape", "fill(with:)"], ""),
            symbol("c:objc(cs)Shape(py)onChange", "swift.property", "onChange", &["Shape", "onChange"], ""),
            symbol("c:objc(cs)Shape(im)tags", "swift.method", "tags()", &["Shape", "tags()"], ""),
            symbol("c:objc(cs)Shape(py)twin", "swift.property", "twin", &["Shape", "twin"], ""),
            symbol("c:objc(cs)Shape(py)origin", "swift.property", "origin", &["Shape", "origin"], ""),
            symbol("c:objc(cs)Shape(py)center", "swift.property", "center", &["Shape", "center"], ""),
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
            r#"{"identifier":{"precise":"c:objc(pl)ShapeDelegate(py)partner","interfaceLanguage":"swift"},"kind":{"identifier":"swift.property"},"names":{"title":"partner"},"pathComponents":["ShapeWatching","partner"],"availability":[],"declarationFragments":[{"kind":"text","spelling":"var partner: Shape? { get set }"}]}"#.to_owned(),
            symbol("c:objc(pl)ShapeDelegate(py)visible", "swift.property", "isVisible", &["ShapeWatching", "isVisible"], ""),
            symbol("c:objc(pl)ShapeDelegate(py)size", "swift.property", "size", &["ShapeWatching", "size"], ""),
            symbol("c:objc(cs)Shape(im)settleWith:completionHandler:", "swift.method", "settle(with:completionHandler:)", &["Shape", "settle(with:completionHandler:)"], ""),
            asynchronous.to_owned(),
            symbol("c:objc(cs)Shape(im)fetchNamed:completionHandler:", "swift.method", "fetch(named:completionHandler:)", &["Shape", "fetch(named:completionHandler:)"], ""),
            throwing.to_owned(),
            symbol("c:objc(cs)NSError", "swift.class", "NSError", &["NSError"], ""),
            // A Core Foundation class: its `Ref` is a class, and the functions
            // Swift makes its members are its initializer, method and property.
            symbol("c:@T@PenRef", "swift.class", "Pen", &["Pen"], ""),
            symbol("c:@F@PenCreate", "swift.init", "init(width:)", &["Pen", "init(width:)"], ""),
            symbol("c:@F@PenStroke", "swift.method", "stroke(at:)", &["Pen", "stroke(at:)"], ""),
            symbol("c:@F@PenGetWidth", "swift.property", "width", &["Pen", "width"], ""),
            symbol("c:@F@PenCopyTwin", "swift.method", "twin(_:)", &["Pen", "twin(_:)"], ""),
            symbol("c:objc(cs)Shape(im)pairWithCompletionHandler:", "swift.method", "pair(completionHandler:)", &["Shape", "pair(completionHandler:)"], ""),
            symbol("c:objc(cs)Shape(cm)runGroup:completionHandler:", "swift.type.method", "runGroup(_:completionHandler:)", &["Shape", "runGroup(_:completionHandler:)"], ""),
            r#"{"identifier":{"precise":"c:objc(cs)Shape(cm)runGroup:completionHandler:","interfaceLanguage":"swift"},"kind":{"identifier":"swift.type.method"},"names":{"title":"runGroup(_:)"},"pathComponents":["Shape","runGroup(_:)"],"availability":[],"declarationFragments":[{"kind":"text","spelling":"class func runGroup(_ changes: (Shape) -> Void) async"}]}"#.to_owned(),
            r#"{"identifier":{"precise":"c:objc(cs)Shape(im)pairWithCompletionHandler:","interfaceLanguage":"swift"},"kind":{"identifier":"swift.method"},"names":{"title":"pair()"},"pathComponents":["Shape","pair()"],"availability":[],"declarationFragments":[{"kind":"text","spelling":"func pair() async throws -> (Shape, String)"}]}"#.to_owned(),
        ];
        let optional = ["(im)shapeDidRename:", "(im)shape:didRenameTo:", "(im)shape:shouldHide:", "(py)visible", "(py)size"].map(|member| {
            format!(r#"{{"kind":"optionalRequirementOf","source":"c:objc(pl)ShapeDelegate{member}","target":"c:objc(pl)ShapeDelegate"}}"#)
        });
        let required = r#"{"kind":"requirementOf","source":"c:objc(pl)ShapeDelegate(im)shapeDidMove:","target":"c:objc(pl)ShapeDelegate"}"#;
        format!(r#"{{"symbols":[{}],"relationships":[{},{required}]}}"#, symbols.join(","), optional.join(","))
    }

    /// The synthetic framework's SDK and graphs, written under a directory of
    /// this test's own, and a request of it with nothing asked for yet.
    fn fake_request(test: &str) -> Request {
        let root = std::env::temp_dir().join(format!("nts-bind-objc-{test}-{}", std::process::id()));
        let headers = root.join("System/Library/Frameworks/Fake.framework/Headers");
        let symbols = root.join("symbolgraph");
        std::fs::create_dir_all(&headers).unwrap();
        std::fs::create_dir_all(&symbols).unwrap();
        std::fs::write(headers.join("Fake.h"), FAKE).unwrap();
        std::fs::write(symbols.join("Fake.symbols.json"), graph()).unwrap();
        std::fs::write(symbols.join("ObjectiveC.symbols.json"), r#"{"symbols":[]}"#).unwrap();
        Request {
            frameworks: vec!["Fake".to_owned()],
            module: "objc:Fake".to_owned(),
            classes: Vec::new(),
            protocols: Vec::new(),
            functions: Vec::new(),
            names: Vec::new(),
            sdk: root.to_string_lossy().into_owned(),
            target: "x86_64-apple-macos13".to_owned(),
            symbols: Some(symbols),
        }
    }

    /// A program's import names what it binds, as Swift names it: `Round`
    /// is class `Circle` and `ShapeWatching` protocol `ShapeDelegate`, and
    /// the binding is the one those flags give. A name Swift does not
    /// declare is an error that says which.
    #[test]
    fn a_program_names_what_it_binds_as_swift_does() {
        let by_objc = Request { classes: vec!["Circle".to_owned()], protocols: vec!["ShapeDelegate".to_owned()], ..fake_request("objc-names") };
        let by_swift = Request { names: vec!["Round".to_owned(), "ShapeWatching".to_owned()], ..fake_request("swift-names") };
        let (objc, swift) = match (run(&by_objc), run(&by_swift)) {
            (Ok(objc), Ok(swift)) => (objc.binding, swift.binding),
            (Err(error), _) | (_, Err(error)) if Command::new("clang").arg("--version").output().is_err() => {
                eprintln!("skipped: no clang ({error})");
                return;
            }
            (Err(error), _) | (_, Err(error)) => panic!("{error:#}"),
        };
        assert_eq!(objc, swift);
        let missing = Request { names: vec!["Round".to_owned(), "Square".to_owned()], ..fake_request("missing-name") };
        let error = run(&missing).err().map(|error| format!("{error:#}")).unwrap_or_default();
        assert!(error.contains("`Square` is not a name Swift imports from Fake"), "{error}");
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
            classes: vec!["Circle".to_owned(), "Pen".to_owned()],
            protocols: vec!["ShapeDelegate".to_owned()],
            functions: Vec::new(),
            names: Vec::new(),
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
            "    /** @ntsSelector initWithOrigin:mode: */\n    constructor(labels: { origin: ByValue<CGPoint> | Fields<CGPoint>; mode: CEnum<Shape.Mode, UInt> });",
            // Unlabelled, positional; a declared `nullable` may be null.
            "    /** @ntsSelector next */\n    next(): Shape | null;",
            // A category is found by the class it extends; labels by Swift.
            "    /** @ntsSelector renameTo:count: */\n    rename(labels: { to: Shape; count: Int }): void;",
            // Swift's `Set<T>`, of objects and of strings.
            "    /** @ntsSelector neighboursNamed: */\n    neighbours(labels: { named: Set<string> }): Set<Shape>;",
            // A getter Swift imports as a property is one.
            "    /** @ntsSelector describe */\n    get describe(): string;",
            // Properties: read-only, a Swift name whose setter is not implied,
            // and a class property as a static.
            // As the accessors an Objective-C property is, so a subclass can
            // override one.
            "    get origin(): ByValue<CGPoint>;",
            // A record is read as its storage and written as that or as its
            // fields, Swift's `CGPoint(x:y:)`.
            "    get center(): ByValue<CGPoint>;\n    set center(value: ByValue<CGPoint> | Fields<CGPoint>);",
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
            // Swift's `var twin` beside `func twin(of:)`: the method takes its
            // first label into its name.
            "    get twin(): Shape;",
            "    /** @ntsSelector twinOfShape: */\n    twinOf(other: Shape): Shape;",
            // And where the first argument has no label, the first label there is.
            "    /** @ntsSelector twinShape:canJoin: */\n    twinCanJoin(shape: Shape, other: Shape): boolean;",
            // Swift's `UnsafeMutablePointer<Span>` as the address a program
            // passes, and the record under its typedef's name, its tag the C
            // one.
            "    /** @ntsSelector measure: */\n    measure(span: Ptr<Span>): void;",
            // A label Swift repeats: the repeat keyed by its parameter's name.
            "    /** @ntsSelector linkFrom:to:to: */\n    link(labels: { from: Shape; to: Shape; end: Shape }): void;",
            // A pointer to a number is not the number: `NSUInteger *` is the
            // number's address, Swift's `UnsafeMutablePointer<UInt>`.
            "    /** @ntsSelector countInto: */\n    count(labels: { into: Ptr<UInt> }): void;",
            // And `BOOL *`, Swift's `UnsafeMutablePointer<ObjCBool>`.
            "    /** @ntsSelector holdsAt:inside: */\n    holds(labels: { at: string; inside: Ptr<ObjCBool> }): boolean;",
            // A `number` reaches the `Double` overload, which comes first.
            "    /** @ntsSelector setDouble:forKey: */\n    set(value: Double, labels: { forKey: string }): void;\n    /** @ntsSelector setInteger:forKey: */\n    set(value: Int, labels: { forKey: string }): void;",
            // Swift's `[ShapeKind: Shape]`: string keys through their typedef.
            "    /** @ntsSelector placeShapes: */\n    place(shapes: Map<string, Shape>): void;",
            "    /** @ntsSelector labels */\n    labels(): Map<string, string>;",
            // A block type the header names by a typedef, read from what it spells.
            "    /** @ntsSelector fillWith: */\n    fill(maker: (arg0: Int) => Shape): void;",
            // A block property: its setter alone, a closure or `null`.
            "    set onChange(value: ((arg0: Shape) => void) | null);",
            // A generic class's type parameter is what it stands for: `id`.
            "    /** @ntsSelector tags */\n    tags(): NSObject[];",
            // `NSError`, not bound but named by a throwing handler: what the
            // promise rejects with is its description, which its stub reads.
            "   * @ntsClass NSError */\n  export class NSError extends Root {\n    get localizedDescription(): string;\n  }",
            "export type Span = Struct<{ location: UInt; length: UInt }, \"_Span\">;",
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
            // A property requirement is a property signature under Swift's
            // name, which a field meets: `?` where Swift says `optional`, and
            // `readonly` with no setter where the header says so.
            "  /** @ntsProtocol ShapeDelegate */\n  export interface ShapeWatching extends NSObject {\n\
             \x20   partner: Shape | null;\n\
             \x20   readonly isVisible?: boolean;\n\
             \x20   size?: Int32;\n\
             \x20   /** @ntsSelector shapeDidMove: */\n    shapeDidMove(shape: Shape): void;\n\
             \x20   /** @ntsSelector shapeDidRename: */\n    shapeDidRename?(shape: Shape): void;\n\
             \x20   /** @ntsSelector shape:didRenameTo: */\n    shapeDidRenameTo?(shape: Shape, name: string): void;\n\
             \x20   /** @ntsSelector shape:shouldHide: */\n    shapeShouldHide?(shape: Shape, hide: boolean): boolean;\n",
            "+classSide: a class-side requirement",
        ] {
            assert!(text.contains(expected), "no `{expected}` in:\n{text}");
        }
        // What Swift does not import has no member here: `alloc`, and Swift's
        // own methods.
        assert!(!text.contains("alloc") && !text.contains("swifty"), "{text}");
        assert_async(&text, &values);
        assert_cf(&text);
        // A subclass keeps its base's overload beside its own of the same
        // selector, since TypeScript holds it to its base's; and a property
        // named as an ancestor's other one is left to the ancestor.
        let round = text.split("export class Round extends Shape {").nth(1).and_then(|rest| rest.split("\n  }").next()).unwrap_or_default();
        for expected in [
            "    /** @ntsSelector paint: */\n    paint(other: Round): void;",
            "    /** @ntsSelector paint: */\n    paint(other: Shape): void;",
            "    //   @property peerCircle: Swift's `peer` is an ancestor's property read with `peer`, not this one",
        ] {
            assert!(round.contains(expected), "no `{expected}` in Round:\n{round}");
        }
    }

    /// A Core Foundation class, as Swift imports it: a handle the program
    /// counts, its members the C functions taking it, `self` found by type.
    fn assert_cf(text: &str) {
        for expected in [
            "  export interface PenOwnMethods {",
            "    /** @ntsSymbol PenStroke */\n    stroke(this: Pen, labels: { at: ByValue<CGPoint> | Fields<CGPoint> }): void;",
            // A property is read through its function, which is declared
            // beside it for `@ntsGet` to name.
            "    /** @ntsSymbol PenGetWidth */\n    PenGetWidth(this: Pen): CGFloat;\n    /** @ntsGet PenGetWidth */\n    readonly width: CGFloat;",
            "  export type Pen = ObjcClass<\"Pen\"> & PenOwnMethods;",
            // An initializer is the class's name, and `Create` hands over a
            // reference the program owns.
            "  /** @ntsSymbol PenCreate */\n  export function Pen(labels: { width: CGFloat }): Owned<Pen>;",
            // Two parameters of the class's type: no telling which is `self`.
            "    //   PenCopyTwin: more than one parameter of the class's type",
        ] {
            assert!(text.contains(expected), "no `{expected}` in:\n{text}");
        }
    }

    /// Swift's `async` import, as `a_framework_is_bound_as_swift_imports_it`
    /// bound it.
    fn assert_async(text: &str, values: &str) {
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
            // A class method's: a static, as Swift's `class func` is.
            "    /** @ntsCall nts_async_Shape_runGroup */\n    static runGroup(changes: (arg0: Shape) => void): Promise<void>;",
        ] {
            assert!(text.contains(expected), "no `{expected}` in:\n{text}");
        }
        for expected in [
            "import { NSError, NSString, Shape } from \"objc:Fake\";",
            "import type { Int } from \"objc:types\";",
            "import { nts_pending_begin, nts_pending_end } from \"c:pending\";",
            // Outstanding from before the message until the handler's first
            // statement, so a program with nothing else to do waits for it.
            "export function nts_async_Shape_settle(self: Shape, labels: { with: Shape }): Promise<Int> {\n  \
             return new Promise((resolve) => {\n    nts_pending_begin();\n    \
             self.settle(labels, (value: Int) => {\n      nts_pending_end();\n      resolve(value);\n    });\n  });\n}",
            // Swift's `async throws`: the error rejects, with its description,
            // and the value, not optional once there is no error, resolves.
            "export function nts_async_Shape_fetch(self: Shape, labels: { named: string }): Promise<Shape> {\n  \
             return new Promise((resolve, reject) => {\n    nts_pending_begin();\n    \
             self.fetch(labels, (value: Shape | null, error: NSError | null) => {\n      nts_pending_end();\n      \
             if (error !== null) {\n        reject(new Error(error.localizedDescription));\n      \
             } else {\n        resolve(value!);\n      }\n    });\n  });\n}",
            // Sent to the class, which the wrapper names, having no `self`.
            "export function nts_async_Shape_runGroup(changes: (arg0: Shape) => void): Promise<void> {\n  \
             return new Promise((resolve) => {\n    nts_pending_begin();\n    \
             Shape.runGroup(changes, () => {\n      nts_pending_end();\n      resolve();\n    });\n  });\n}",
        ] {
            assert!(values.contains(expected), "no `{expected}` in:\n{values}");
        }
    }

    #[test]
    fn a_target_names_its_platform_and_deployment_version() {
        let (platform, version) = deployment_target("x86_64-apple-macos13").unwrap();
        assert_eq!((platform, version.major, version.minor), ("macOS", 13, 0));
        let (platform, version) = deployment_target("x86_64-apple-ios17.2-simulator").unwrap();
        assert_eq!((platform, version.major, version.minor), ("iOS", 17, 2));
        assert!(deployment_target("x86_64-linux-gnu").is_err());
    }

    #[test]
    fn an_overload_is_the_same_whatever_its_parameters_are_called() {
        assert_eq!(unnamed("f(cView: NSClipView): void;"), unnamed("f(clipView: NSClipView): void;"));
        assert_ne!(unnamed("f(a: Shape): void;"), unnamed("f(a: Round): void;"));
        // A label object's keys are the call's, not names.
        assert_ne!(unnamed("f(labels: { at: Int }): void;"), unnamed("f(labels: { to: Int }): void;"));
        assert_eq!(unnamed("f(x: Int, labels: { at: Int }): void;"), unnamed("f(y: Int, labels: { at: Int }): void;"));
    }

    #[test]
    fn an_availability_annotation_is_not_part_of_the_type() {
        assert_eq!(strip_attributes("API_AVAILABLE(macos(11.0)) NSString *"), "NSString *");
        assert_eq!(strip_attributes("NSString * _Nonnull"), "NSString * _Nonnull");
        assert_eq!(strip_attributes("NS_SWIFT_UI_ACTOR void"), "void");
        assert_eq!(strip_attributes("NS_SWIFT_NAME(x) API_AVAILABLE(ios(2.0)) BOOL"), "BOOL");
        assert_eq!(strip_attributes("BOOL"), "BOOL");
        let constant = serde_json::json!({ "qualType": "NSNotificationName", "desugaredQualType": "NSString *const" });
        assert_eq!(without_top_const(&constant)["desugaredQualType"], "NSString *");
        assert_eq!(without_top_const(&serde_json::json!({ "qualType": "const char *" }))["qualType"], "const char *");
        assert!(block_is_nullable("void (^ _Nullable)(BOOL)"));
        assert!(!block_is_nullable("void (^)(NSError * _Nullable)"));
        assert!(!block_is_nullable("void (^ _Nonnull)(NSString * _Nullable)"));
    }
}
