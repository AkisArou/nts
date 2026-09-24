//! Derive an Objective-C binding from a framework's headers: `nts bind-objc`.
//!
//! The surface it writes is the one the lowering reads, and nothing else:
//!
//! ```text
//! export interface NSWindowOwnMethods { ...instance methods and properties }
//! export type NSWindow = ObjcClass<"NSWindow", NSResponder> & NSWindowOwnMethods & ...;
//! export interface NSWindowStatics { ...class methods and class properties }
//! export type NSWindowMeta = ObjcMeta<"NSWindow"> & NSWindowStatics;
//! export const NSWindow: NSWindowMeta;
//! ```
//!
//! A method is named as `NativeScript` names one -- the selector's pieces joined,
//! each after the first capitalized, so `initWithContentRect:styleMask:backing:defer:`
//! is `initWithContentRectStyleMaskBackingDefer` -- and carries its selector as
//! `@ntsSelector`, which is what is sent. A property is a property: the
//! lowering sends its getter and `set...:`.
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
//! and why: a block, a C array, a pointer other than to an object or a scalar,
//! a variadic method. The binding is a claim either way; the comment is so a
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
    /// The macOS SDK.
    pub(crate) sdk: String,
    /// The clang target, `x86_64-apple-macos13`.
    pub(crate) target: String,
}

pub(crate) fn run(request: &Request) -> Result<String> {
    if !request.module.starts_with("objc:") {
        bail!("`nts bind-objc` writes an `objc:` module, and `{}` is not one", request.module);
    }
    let unit = translation_unit(request)?;
    let headers = dump(request, &unit, &Wanted::Headers)?;
    let bound = closure(&request.classes, &headers.supers)?;
    let bodies = dump(request, &unit, &Wanted::Bodies(&bound))?;
    let model = Model::read(&headers, &bodies, &bound);
    Ok(render(request, &model))
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
    /// The bodies of these classes, and of the categories on them.
    Bodies(&'a BTreeSet<String>),
}

/// What one pass read.
#[derive(Default)]
struct Dumped {
    /// Every class, and the class it inherits from.
    supers: BTreeMap<String, Option<String>>,
    /// Every enum with a fixed width, and that width's C spelling.
    enums: BTreeMap<String, String>,
    /// Every struct definition, and its members' names and C types.
    records: BTreeMap<String, Vec<(String, String)>>,
    /// Interfaces and categories, by class, in header order.
    bodies: BTreeMap<String, Vec<Value>>,
    /// The `NSObject` protocol's methods, which `NSObject` adopts.
    root_protocol: Vec<Value>,
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
                "inner" => {
                    let keep = match self.wanted {
                        Wanted::Headers => kind == "RecordDecl" && complete,
                        Wanted::Bodies(bound) => match kind.as_str() {
                            "ObjCInterfaceDecl" => name.as_ref().is_some_and(|n| bound.contains(n)),
                            // A category on NSObject is every framework's
                            // extension of every object, hundreds of methods;
                            // the root is bound as the runtime declares it.
                            "ObjCCategoryDecl" => interface.as_ref().is_some_and(|n| bound.contains(n) && n != "NSObject"),
                            "ObjCProtocolDecl" => name.as_deref() == Some("NSObject") && bound.contains("NSObject"),
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
            ("ObjCProtocolDecl", Some(_)) => {
                if let Some(Value::Array(members)) = body {
                    out.root_protocol.extend(members);
                }
            }
            ("EnumDecl", Some(name)) => {
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

/// The classes, enums and structs the binding describes.
struct Model {
    /// Bound classes, root first, each with its parent.
    classes: Vec<(String, Option<String>)>,
    members: BTreeMap<String, Members>,
    enums: BTreeMap<String, String>,
    records: BTreeMap<String, Vec<(String, String)>>,
    /// Classes a signature names that are not bound, with the nearest bound
    /// ancestor, declared as handles with no methods.
    mentioned: BTreeMap<String, Option<String>>,
    /// Records a signature passes by value.
    used_records: BTreeSet<String>,
}

#[derive(Default)]
struct Members {
    instance: Vec<String>,
    statics: Vec<String>,
    /// Instance methods returning `instancetype`, which each descendant gets
    /// again at its own type.
    instancetype: Vec<Value>,
    /// Class methods, which each descendant's statics repeat.
    class_methods: Vec<Value>,
    skipped: Vec<String>,
}

impl Model {
    fn read(headers: &Dumped, bodies: &Dumped, bound: &BTreeSet<String>) -> Self {
        let mut classes = Vec::new();
        let mut placed = BTreeSet::new();
        while placed.len() < bound.len() {
            for name in bound {
                let parent = headers.supers.get(name).cloned().flatten();
                if !placed.contains(name) && parent.as_ref().is_none_or(|p| placed.contains(p)) {
                    classes.push((name.clone(), parent));
                    placed.insert(name.clone());
                }
            }
        }
        let mut model = Model {
            classes,
            members: BTreeMap::new(),
            enums: headers.enums.clone(),
            records: headers.records.clone(),
            mentioned: BTreeMap::new(),
            used_records: BTreeSet::new(),
        };
        let supers = headers.supers.clone();
        let order: Vec<(String, Option<String>)> = model.classes.clone();
        for (class, parent) in &order {
            let mut members = Members::default();
            let mut decls: Vec<&Value> = bodies.bodies.get(class).map(|b| b.iter().collect()).unwrap_or_default();
            if class == "NSObject" {
                decls.extend(bodies.root_protocol.iter());
            }
            // What an ancestor declares, which a descendant repeats at its own
            // type: `init` is an `NSWindow` on `NSWindow`.
            let inherited: Vec<Value> = parent
                .as_ref()
                .and_then(|p| model.members.get(p))
                .map(|m| m.instancetype.iter().chain(&m.class_methods).cloned().collect())
                .unwrap_or_default();
            let mut names = BTreeSet::new();
            for decl in decls.into_iter().chain(inherited.iter()) {
                model.member(class, decl, &supers, bound, &mut members, &mut names);
            }
            model.members.insert(class.clone(), members);
        }
        model
    }

    fn member(
        &mut self,
        class: &str,
        decl: &Value,
        supers: &BTreeMap<String, Option<String>>,
        bound: &BTreeSet<String>,
        members: &mut Members,
        seen: &mut BTreeSet<String>,
    ) {
        let kind = decl.get("kind").and_then(Value::as_str).unwrap_or_default();
        if decl.get("isImplicit").and_then(Value::as_bool) == Some(true) {
            return;
        }
        match kind {
            "ObjCMethodDecl" => {
                let Some(selector) = named(decl) else { return };
                let instance = decl.get("instance").and_then(Value::as_bool).unwrap_or(true);
                let key = format!("{}{selector}", if instance { "-" } else { "+" });
                if !seen.insert(key) {
                    return;
                }
                let returns_instancetype =
                    decl.get("returnType").map(written).is_some_and(|t| t.starts_with("instancetype"));
                if instance && returns_instancetype {
                    members.instancetype.push(decl.clone());
                }
                if !instance {
                    members.class_methods.push(decl.clone());
                }
                match self.method(class, decl, &selector, instance, supers, bound) {
                    Ok(text) if instance => members.instance.push(text),
                    Ok(text) => members.statics.push(text),
                    Err(why) => members.skipped.push(format!("{}{selector}: {why}", if instance { "-" } else { "+" })),
                }
            }
            "ObjCPropertyDecl" => {
                let Some(name) = named(decl) else { return };
                let class_property = decl.get("class").and_then(Value::as_bool) == Some(true);
                if !seen.insert(format!("property {class_property} {name}")) {
                    return;
                }
                match self.property(class, decl, &name, supers, bound) {
                    Ok(text) if class_property => members.statics.push(text),
                    Ok(text) => members.instance.push(text),
                    Err(why) => members.skipped.push(format!("@property {name}: {why}")),
                }
            }
            _ => {}
        }
    }

    fn method(
        &mut self,
        class: &str,
        decl: &Value,
        selector: &str,
        instance: bool,
        supers: &BTreeMap<String, Option<String>>,
        bound: &BTreeSet<String>,
    ) -> Spelled {
        if decl.get("variadic").and_then(Value::as_bool) == Some(true) {
            return Err("variadic".to_owned());
        }
        let parameters: Vec<&Value> =
            decl.get("inner").and_then(Value::as_array).map(|inner| {
                inner.iter().filter(|p| p.get("kind").and_then(Value::as_str) == Some("ParmVarDecl")).collect()
            }).unwrap_or_default();
        let receiver = if instance { class.to_owned() } else { format!("{class}Meta") };
        let mut spelled = vec![format!("this: {receiver}")];
        for (at, parameter) in parameters.iter().enumerate() {
            let ty = parameter.get("type").ok_or("a parameter with no type")?;
            let name = named(parameter).filter(|n| !n.is_empty() && !reserved(n)).unwrap_or_else(|| format!("arg{at}"));
            spelled.push(format!("{name}: {}", self.spell(class, ty, Position::Parameter, supers, bound)?));
        }
        let result = decl.get("returnType").ok_or("no return type")?;
        let result = self.spell(class, result, Position::Result, supers, bound)?;
        let name = method_name(selector);
        Ok(format!(
            "    /** @ntsSelector {selector} */\n    {}({}): {result};",
            quoted(&name),
            spelled.join(", ")
        ))
    }

    fn property(
        &mut self,
        class: &str,
        decl: &Value,
        name: &str,
        supers: &BTreeMap<String, Option<String>>,
        bound: &BTreeSet<String>,
    ) -> Spelled {
        let ty = decl.get("type").ok_or("no type")?;
        let spelled = self.spell(class, ty, Position::Result, supers, bound)?;
        let readonly = decl.get("readonly").and_then(Value::as_bool) == Some(true);
        let getter = decl.get("getter").and_then(named);
        let setter = decl.get("setter").and_then(named);
        let default_setter = format!("set{}:", capitalized(name));
        if !readonly && setter.as_ref().is_some_and(|s| *s != default_setter) {
            return Err("a custom setter".to_owned());
        }
        let mut text = String::new();
        if let Some(getter) = getter.filter(|g| g != name) {
            let _ = writeln!(text, "    /** @ntsSelector {getter} */");
        }
        let _ = write!(text, "    {}{}: {spelled};", if readonly { "readonly " } else { "" }, quoted(name));
        Ok(text)
    }

    fn spell(
        &mut self,
        class: &str,
        ty: &Value,
        position: Position,
        supers: &BTreeMap<String, Option<String>>,
        bound: &BTreeSet<String>,
    ) -> Spelled {
        let written = written(ty);
        let written = strip_availability(&written);
        let desugared = desugared(ty).unwrap_or_default();
        // Only a declared `_Nullable` may be null here. An unannotated pointer
        // is what Swift imports as implicitly unwrapped -- used as an object,
        // and `+alloc` in objc/NSObject.h is one -- and a message to nil
        // answers nil, so treating it as present is what Cocoa code does.
        let nullable = written.contains("_Nullable");
        let or_null = |text: String| if nullable { format!("{text} | null") } else { text };
        if written.contains("(^") || desugared.contains("(^") {
            return Err("a block".to_owned());
        }
        if written.starts_with("BOOL") || desugared == "bool" || desugared == "_Bool" {
            return Ok("boolean".to_owned());
        }
        if desugared == "void" {
            return Ok("void".to_owned());
        }
        if written.starts_with("instancetype") {
            return Ok(or_null(class.to_owned()));
        }
        if written.starts_with("SEL") {
            return Ok("Selector".to_owned());
        }
        if written.starts_with("Class") {
            return Ok(or_null("ClassObject".to_owned()));
        }
        if desugared == "id" || desugared.starts_with("id<") {
            return Ok(or_null(self.object("NSObject", supers, bound)));
        }
        if let Some(scalar) = scalar(&desugared) {
            return Ok(scalar.to_owned());
        }
        if let Some(name) = desugared.strip_prefix("enum ") {
            let width = self.enums.get(name).ok_or_else(|| format!("enum `{name}` with no fixed width"))?;
            return scalar(width).map(str::to_owned).ok_or_else(|| format!("enum `{name}` of width `{width}`"));
        }
        // A pointer before a struct: `struct __CGEvent *` is an address, and
        // read as a struct it would have crossed by value.
        if let Some(name) = desugared.strip_prefix("struct ").filter(|name| !name.ends_with('*')) {
            if !self.records.contains_key(name) {
                return Err(format!("struct `{name}`, which no header here defines"));
            }
            self.record(name)?;
            return Ok(format!("ByValue<{name}>"));
        }
        if let Some(pointee) = desugared.strip_suffix(" *") {
            let pointee = pointee.trim_start_matches("__kindof ");
            let base = pointee.split('<').next().unwrap_or_default().trim();
            if supers.contains_key(base) {
                return Ok(or_null(self.object(base, supers, bound)));
            }
            // A C string in a message is `CString`: there a plain `string` is
            // an `NSString`, as Swift's `String` is.
            if position == Position::Parameter && (pointee == "const char" || pointee == "char") {
                return Ok("CString".to_owned());
            }
            return Err(format!("a `{desugared}`"));
        }
        Err(format!("a `{desugared}`"))
    }

    /// The name a signature uses for class `name`: its own when it is bound,
    /// and otherwise a handle declared with no methods, whose parent is the
    /// nearest bound ancestor.
    fn object(&mut self, name: &str, supers: &BTreeMap<String, Option<String>>, bound: &BTreeSet<String>) -> String {
        if !bound.contains(name) && !self.mentioned.contains_key(name) {
            let mut parent = supers.get(name).cloned().flatten();
            while let Some(p) = parent.clone() {
                if bound.contains(&p) {
                    break;
                }
                parent = supers.get(&p).cloned().flatten();
            }
            self.mentioned.insert(name.to_owned(), parent);
        }
        name.to_owned()
    }

    /// Record `name` as one a signature passes by value, and every record it
    /// holds, so each is declared.
    fn record(&mut self, name: &str) -> std::result::Result<(), String> {
        if !self.used_records.insert(name.to_owned()) {
            return Ok(());
        }
        let fields = self.records.get(name).cloned().unwrap_or_default();
        for (field, ty) in fields {
            if let Some(inner) = ty.strip_prefix("struct ") {
                self.record(inner)?;
            } else if scalar(&ty).is_none() {
                return Err(format!("struct `{name}`, whose member `{field}` is a `{ty}`"));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Position {
    Parameter,
    Result,
}

/// A C scalar's brand in `c:types`, for its desugared spelling.
fn scalar(spelling: &str) -> Option<&'static str> {
    Some(match spelling {
        "char" => "c_char",
        "signed char" => "c_int8",
        "unsigned char" => "c_uint8",
        "short" => "c_int16",
        "unsigned short" => "c_uint16",
        "int" => "c_int",
        "unsigned int" => "c_uint",
        "long" => "c_long",
        "unsigned long" => "c_ulong",
        "long long" => "c_int64",
        "unsigned long long" => "c_uint64",
        "float" => "c_float",
        "double" => "c_double",
        _ => return None,
    })
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

/// `NativeScript`'s name for a selector: the pieces joined, each after the first
/// capitalized. `initWithContentRect:styleMask:backing:defer:` is
/// `initWithContentRectStyleMaskBackingDefer`.
pub(crate) fn method_name(selector: &str) -> String {
    let mut pieces = selector.split(':').filter(|p| !p.is_empty());
    let mut name = pieces.next().unwrap_or_default().to_owned();
    for piece in pieces {
        name.push_str(&capitalized(piece));
    }
    name
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

fn render(request: &Request, model: &Model) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "// Generated by `nts bind-objc` from the macOS SDK. Do not edit: regenerate.\n//\n\
         // nts bind-objc --module {} {} {}",
        request.module,
        request.frameworks.iter().map(|f| format!("--framework {f}")).collect::<Vec<_>>().join(" "),
        request.classes.iter().map(|c| format!("--class {c}")).collect::<Vec<_>>().join(" ")
    );
    let _ = writeln!(out, "/**");
    for framework in &request.frameworks {
        let _ = writeln!(out, " * @ntsFramework {framework}");
    }
    let _ = writeln!(out, " */\ndeclare module \"{}\" {{", request.module);
    let _ = writeln!(
        out,
        "  import type {{ ByValue, Struct, c_char, c_double, c_float, c_int, c_int8, c_int16, c_int64, c_long, c_uint, c_uint8, c_uint16, c_uint64, c_ulong }} from \"c:types\";"
    );
    let _ = writeln!(out, "  import type {{ CString, ObjcClass, ObjcMeta }} from \"objc:types\";");
    let _ = writeln!(out, "  import type {{ ClassObject, Selector }} from \"objc:runtime\";");
    for name in &model.used_records {
        let fields = model.records.get(name).map(Vec::as_slice).unwrap_or_default();
        let members: Vec<String> = fields
            .iter()
            .map(|(field, ty)| {
                let spelled = ty.strip_prefix("struct ").map_or_else(|| scalar(ty).unwrap_or("never").to_owned(), str::to_owned);
                format!("{field}: {spelled}")
            })
            .collect();
        let _ = writeln!(out, "\n  export type {name} = Struct<{{ {} }}, \"{name}\">;", members.join("; "));
    }
    for (name, parent) in &model.mentioned {
        let parent = parent.as_ref().map(|p| format!(", {p}")).unwrap_or_default();
        let _ = writeln!(out, "\n  /** Named by a signature here, and not bound: a handle with no methods. */");
        let _ = writeln!(out, "  export type {name} = ObjcClass<\"{name}\"{parent}>;");
    }
    let parents: BTreeMap<&str, Option<&str>> =
        model.classes.iter().map(|(c, p)| (c.as_str(), p.as_deref())).collect();
    for (class, parent) in &model.classes {
        let members = &model.members[class];
        let _ = writeln!(out, "\n  export interface {class}OwnMethods {{");
        for line in &members.instance {
            let _ = writeln!(out, "{line}");
        }
        let _ = writeln!(out, "  }}");
        let mut chain = vec![format!("{class}OwnMethods")];
        let mut at = parent.as_deref();
        while let Some(ancestor) = at {
            chain.push(format!("{ancestor}OwnMethods"));
            at = parents.get(ancestor).copied().flatten();
        }
        let parent = parent.as_ref().map(|p| format!(", {p}")).unwrap_or_default();
        let _ = writeln!(out, "  export type {class} = ObjcClass<\"{class}\"{parent}> & {};", chain.join(" & "));
        let _ = writeln!(out, "  export interface {class}Statics {{");
        for line in &members.statics {
            let _ = writeln!(out, "{line}");
        }
        let _ = writeln!(out, "  }}");
        let _ = writeln!(out, "  export type {class}Meta = ObjcMeta<\"{class}\"> & {class}Statics;");
        let _ = writeln!(out, "  export const {class}: {class}Meta;");
        if !members.skipped.is_empty() {
            let _ = writeln!(out, "  // Not bound on {class}, each for the reason given:");
            for line in &members.skipped {
                let _ = writeln!(out, "  //   {line}");
            }
        }
    }
    out.push_str("}\n");
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
    fn a_selector_is_named_as_nativescript_names_it() {
        assert_eq!(method_name("initWithContentRect:styleMask:backing:defer:"), "initWithContentRectStyleMaskBackingDefer");
        assert_eq!(method_name("alloc"), "alloc");
        assert_eq!(method_name("performClick:"), "performClick");
        assert_eq!(method_name("setFrame:display:"), "setFrameDisplay");
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
enum Mode : NSUInteger { ModeA = 1 };
struct Opaque;
@interface Root
+ (instancetype)alloc;
- (instancetype)init;
@end
NS_ASSUME_NONNULL_BEGIN
@interface Shape : Root
- (instancetype)initWithOrigin:(CGPoint)origin mode:(Mode)mode;
- (nullable Shape *)next;
- (void)each:(void (^)(Shape *))block;
- (void)take:(struct Opaque *)pointer;
@property (readonly) CGPoint origin;
@property (getter=isHidden) BOOL hidden;
@property (class, readonly) Shape *unit;
@end
@interface Shape (Named)
- (void)renameTo:(Shape *)other count:(NSInteger)count;
@end
@interface Circle : Shape
@end
NS_ASSUME_NONNULL_END
"#;

    /// Every rule the binding applies, on real clang output.
    #[test]
    fn a_framework_is_bound_as_the_lowering_reads_it() {
        let root = std::env::temp_dir().join(format!("nts-bind-objc-test-{}", std::process::id()));
        let headers = root.join("System/Library/Frameworks/Fake.framework/Headers");
        std::fs::create_dir_all(&headers).unwrap();
        std::fs::write(headers.join("Fake.h"), FAKE).unwrap();
        let request = Request {
            frameworks: vec!["Fake".to_owned()],
            module: "objc:Fake".to_owned(),
            classes: vec!["Circle".to_owned()],
            sdk: root.to_string_lossy().into_owned(),
            target: "x86_64-apple-macos13".to_owned(),
        };
        let text = match run(&request) {
            Ok(text) => text,
            Err(error) if Command::new("clang").arg("--version").output().is_err() => {
                eprintln!("skipped: no clang ({error})");
                return;
            }
            Err(error) => panic!("{error:#}"),
        };
        let _ = std::fs::remove_dir_all(&root);
        for expected in [
            // The ancestors are bound, root first, each with its chain.
            "export type Circle = ObjcClass<\"Circle\", Shape> & CircleOwnMethods & ShapeOwnMethods & RootOwnMethods;",
            "export const Circle: CircleMeta;",
            // `instancetype` is the class it is called on, including what a
            // descendant inherits.
            "alloc(this: CircleMeta): Circle;",
            "init(this: Circle): Circle;",
            "initWithOriginMode(this: Circle, origin: ByValue<CGPoint>, mode: c_ulong): Circle;",
            // A declared `nullable` may be null.
            "next(this: Shape): Shape | null;",
            // A category is found by the class it extends.
            "/** @ntsSelector renameTo:count: */",
            "renameToCount(this: Shape, other: Shape, count: c_long): void;",
            // Properties, a getter that is not the name, and a class property.
            "readonly origin: ByValue<CGPoint>;",
            "/** @ntsSelector isHidden */",
            "hidden: boolean;",
            "readonly unit: Shape;",
            // A struct passed by value is declared.
            "export type CGPoint = Struct<{ x: c_double; y: c_double }, \"CGPoint\">;",
            // And what cannot be written is said.
            "-each:: a block",
            "-take:: a `struct Opaque *`",
        ] {
            assert!(text.contains(expected), "no `{expected}` in:\n{text}");
        }
        // The class property is a static, not an instance member.
        let statics = text.split("export interface ShapeStatics {").nth(1).and_then(|rest| rest.split('}').next()).unwrap_or_default();
        assert!(statics.contains("readonly unit: Shape;"), "{text}");
    }

    #[test]
    fn an_availability_annotation_is_not_part_of_the_type() {
        assert_eq!(strip_availability("API_AVAILABLE(macos(11.0)) NSString *"), "NSString *");
        assert_eq!(strip_availability("NSString * _Nonnull"), "NSString * _Nonnull");
    }
}
