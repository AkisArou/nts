//! Core Foundation types, as Swift imports them: `CGContextRef` is a class,
//! `CGContext`, and the C functions that take one are its members --
//! `CGContextFillRect(c, rect)` is `context.fill(rect)`,
//! `CGColorCreateGenericRGB(r, g, b, a)` is `CGColor(red:green:blue:alpha:)`.
//!
//! **Swift's importer names them, as it names every message.** Each C
//! function's symbol carries its clang USR, `c:@F@CGContextFillRect`, under the
//! class Swift puts it in, with the labels it gives it -- from the SDK's API
//! notes (`CGContext.fill(self:_:)`), which say where `self` goes. Which
//! parameter that is, is the one whose type is the class's: the importer
//! requires it, so it is read from the types and not guessed.
//!
//! A class is a handle the program counts (`ObjcClass<Tag>`): a Core
//! Foundation object is an Objective-C object on Apple's platforms, which
//! `objc_retain` and `objc_release` count. Its methods are an interface of C
//! functions taking it, `CGContextOwnMethods`, whose `this` is the instance --
//! the shape every C handle a binding declares has -- and its initializers are
//! a function of its name, `CGColor({ red, green, blue, alpha })`, which is
//! how Swift writes `CGColor(red:green:blue:alpha:)`.
//!
//! A function whose name has `Create` or `Copy` in it hands over a reference
//! (Core Foundation's create rule), so it returns `Owned<T>`; any other
//! returns one the caller does not own.

use super::{Class, Model, Position, Symbol, Value, quoted_key, swift_name, written};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

/// A Core Foundation class the request names, as the binding declares it.
pub(super) struct CfClass {
    /// Swift's name, and the TypeScript type's: `CGContext`.
    pub(super) swift: String,
    /// The struct tag the handle carries, which is how C spells it:
    /// `CGContextRef` is `struct CGContext *`.
    pub(super) tag: String,
    /// The members of `{swift}OwnMethods`.
    pub(super) members: Vec<String>,
    /// The overloads of the function named for the class: its initializers.
    pub(super) inits: Vec<String>,
    /// Swift's `static func`s on the class, as functions of a namespace of
    /// its name: `CGEventSource.keyState(_:key:)`.
    pub(super) statics: Vec<String>,
    pub(super) skipped: Vec<String>,
}

/// The classes among `names` that are Core Foundation types -- Swift imports
/// `{name}Ref` as a class -- by the C pointer type their `Ref` names, which
/// is how a signature spells one: `struct CGContext *`.
pub(super) fn requested(
    swift: &super::Swift,
    typedefs: &BTreeMap<String, String>,
    names: &[String],
) -> BTreeMap<String, String> {
    names
        .iter()
        .filter(|name| {
            swift
                .get(&format!("c:@T@{name}Ref"))
                .is_some_and(|symbol| symbol.kind.identifier == "swift.class")
        })
        .filter_map(|name| Some((typedefs.get(&format!("{name}Ref"))?.clone(), name.clone())))
        .collect()
}

/// The C functions Swift makes members of `classes`, and the free functions
/// named in `functions`: what the second pass keeps the declarations of.
pub(super) fn functions(
    swift: &super::Swift,
    classes: &BTreeMap<String, String>,
    functions: &[String],
) -> BTreeSet<String> {
    let members: BTreeSet<&str> = classes.values().map(String::as_str).collect();
    swift
        .by_usr
        .iter()
        .filter_map(|(usr, symbol)| {
            let name = usr.strip_prefix("c:@F@")?;
            let owner = symbol.path.first().map(String::as_str)?;
            (members.contains(owner) && symbol.path.len() == 2
                || functions.iter().any(|f| f == name))
            .then(|| name.to_owned())
        })
        .collect()
}

/// A C function's parameters and result, as the dump gives them.
struct Declared<'v> {
    parameters: Vec<&'v Value>,
    /// The result type, with its sugar and without: `CGColorRef _Nullable`
    /// and `struct CGColor *`.
    result: Value,
}

fn declared<'v>(decl: &'v Value, typedefs: &BTreeMap<String, String>) -> Option<Declared<'v>> {
    let parameters = decl
        .get("inner")
        .and_then(Value::as_array)
        .map(|inner| {
            inner
                .iter()
                .filter(|p| p.get("kind").and_then(Value::as_str) == Some("ParmVarDecl"))
                .collect()
        })
        .unwrap_or_default();
    // `void (CGContextRef _Nullable, CGRect)`: the result is what comes before
    // the parameter list, which is the last parenthesised group.
    let function = decl
        .get("type")
        .and_then(|ty| ty.get("qualType"))
        .and_then(Value::as_str)?;
    let mut depth = 0usize;
    let mut open = None;
    for (at, c) in function.char_indices().rev() {
        match c {
            ')' => depth += 1,
            '(' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    open = Some(at);
                    break;
                }
            }
            _ => {}
        }
    }
    let result = function[..open?].trim().to_owned();
    let words = |also: &[&str]| {
        result
            .split_whitespace()
            .filter(|word| {
                !matches!(*word, "_Nullable" | "_Nonnull" | "_Null_unspecified")
                    && !also.contains(word)
            })
            .collect::<Vec<_>>()
            .join(" ")
    };
    // A typedef's name, found without its `const`, which then qualifies the
    // pointer (`const CGColorRef`) and not what it points to; anything else
    // keeps it: `const CGFloat *` is a read-only buffer.
    let bare = words(&["const"]);
    let desugared = typedefs.get(&bare).cloned().unwrap_or_else(|| words(&[]));
    Some(Declared {
        parameters,
        result: serde_json::json!({ "qualType": result, "desugaredQualType": desugared }),
    })
}

/// Whether a C function hands over a reference to what it returns: Core
/// Foundation's create rule.
fn creates(function: &str) -> bool {
    function.contains("Create") || function.contains("Copy")
}

impl Model<'_> {
    /// Each requested Core Foundation class, and the free functions asked
    /// for, from the functions the second pass kept.
    pub(super) fn read_cf(&mut self, functions: &BTreeMap<String, Value>, wanted: &[String]) {
        let classes: Vec<(String, String)> = self
            .cf_types
            .iter()
            .map(|(pointer, name)| (pointer.clone(), name.clone()))
            .collect();
        for (pointer, name) in classes {
            let tag = pointer
                .trim_start_matches("const ")
                .trim_start_matches("struct ")
                .trim_end_matches(" *")
                .trim()
                .to_owned();
            let mut class = CfClass {
                swift: name.clone(),
                tag,
                members: Vec::new(),
                inits: Vec::new(),
                statics: Vec::new(),
                skipped: Vec::new(),
            };
            let mut symbols: Vec<(&String, &Value, &Symbol)> = functions
                .iter()
                .filter_map(|(function, decl)| {
                    let symbol = self.swift.get(&format!("c:@F@{function}"))?;
                    (symbol.path.first() == Some(&name) && symbol.path.len() == 2)
                        .then_some((function, decl, symbol))
                })
                .collect();
            symbols.sort_by(|a, b| a.2.names.title.cmp(&b.2.names.title));
            for (function, decl, symbol) in symbols {
                let kind = symbol.kind.identifier.as_str();
                let bound = self.available(symbol).and_then(|()| match kind {
                    "swift.method" => self.cf_method(&class, &pointer, function, decl, symbol),
                    "swift.init" => self.cf_init(&class, function, decl, symbol),
                    "swift.property" => self.cf_property(&class, &pointer, function, decl, symbol),
                    "swift.type.method" => self.cf_static(&class, function, decl, symbol),
                    // `static var typeID`: a class property is read without a
                    // call, and a function with no receiver is only a call.
                    "swift.type.property" => Err("a class property, which is a call with no receiver and no property of any value".to_owned()),
                    kind => Err(format!("a `{kind}`, which is not bound yet")),
                });
                match bound {
                    Ok(text) if kind == "swift.init" => class.inits.push(text),
                    Ok(text) if kind == "swift.type.method" => class.statics.push(text),
                    Ok(text) => class.members.push(text),
                    Err(why) => class.skipped.push(format!("{function}: {why}")),
                }
            }
            self.cf_classes.push(class);
        }
        for function in wanted {
            let text = functions
                .get(function)
                .ok_or_else(|| "no header here declares it".to_owned())
                .and_then(|decl| self.cf_function(function, decl));
            match text {
                Ok(text) => self.functions.push(text),
                Err(why) => self
                    .functions
                    .push(format!("  // Not bound: {function}: {why}")),
            }
        }
    }

    /// The class the spelling of a member's types is read against.
    fn cf_spelling_class(class: &CfClass) -> Class {
        Class {
            objc: class.swift.clone(),
            swift: class.swift.clone(),
            parent: None,
            members: Vec::new(),
            extensions: Vec::new(),
            skipped: Vec::new(),
            sent: Vec::new(),
        }
    }

    /// The parameters of a function Swift makes a member, less `self`: the
    /// parameter of the class's own type. Where there are several --
    /// `CGPathEqualToPath(path1, path2)` -- Swift's declaration names the
    /// ones it keeps, and `self` is the one it does not.
    ///
    /// `self` must come first: a `this:` method's receiver is the C
    /// function's first argument, so any other would pass the arguments out
    /// of order.
    fn without_self<'v>(
        parameters: &[&'v Value],
        pointer: &str,
        symbol: &Symbol,
    ) -> std::result::Result<Vec<&'v Value>, String> {
        let is_self = |parameter: &Value| {
            parameter
                .get("type")
                .and_then(super::desugared)
                .is_some_and(|ty| ty == pointer)
        };
        let candidates: Vec<usize> = (0..parameters.len())
            .filter(|&at| is_self(parameters[at]))
            .collect();
        let at = match candidates.as_slice() {
            [] => return Err("no parameter of the class's type to be `self`".to_owned()),
            [one] => *one,
            several => {
                let kept = symbol.parameter_names();
                let unkept: Vec<usize> = several
                    .iter()
                    .copied()
                    .filter(|&at| {
                        parameters[at]
                            .get("name")
                            .and_then(Value::as_str)
                            .is_some_and(|name| !kept.contains(&name))
                    })
                    .collect();
                match unkept.as_slice() {
                    [one] => *one,
                    _ => return Err("more than one parameter of the class's type, and no way to tell which is `self`".to_owned()),
                }
            }
        };
        if at != 0 {
            return Err(
                "`self` is not the first parameter, and a method's receiver is passed first"
                    .to_owned(),
            );
        }
        Ok(parameters[1..].to_vec())
    }

    /// A Core Foundation class as C declares its reference: `CGPathRef` is
    /// `const struct CGPath *`, which is `Const<CGPath>` -- the prototype says
    /// `const`, as the header does and the witness compares -- and
    /// `CGMutablePathRef`, the same struct without it, is `CGMutablePath`.
    pub(super) fn cf_handle(&mut self, pointer: &str, name: String) -> String {
        if pointer.starts_with("const ") {
            self.import("c:types", "Const");
            format!("Const<{name}>")
        } else {
            name
        }
    }

    /// The result, as a member or a function returns it.
    fn cf_result(
        &mut self,
        class: &Class,
        function: &str,
        result: &Value,
        symbol: Option<&Symbol>,
    ) -> std::result::Result<String, String> {
        // A toll-free object the create rule hands over is a +1 reference,
        // and a Foundation object's result is read as borrowed: copied into
        // the program's string or held as the object, never released.
        if creates(function)
            && let Some(pointee) = super::desugared(result)
                .as_deref()
                .and_then(|text| text.strip_suffix(" *").map(str::to_owned))
            && let Some(object) = super::toll_free(&pointee)
        {
            return Err(format!(
                "a `{object}` the create rule hands over, which a borrowed result would never release"
            ));
        }
        let spelled = self.in_c_function(|model| model.spell(class, result, Position::Result))?;
        // Swift's word on whether it is optional, where there is one: the
        // SDK's API notes give Swift nullability the header leaves loose, as
        // `CGColorSpaceCreateDeviceRGB`'s `_Nullable` result is `CGColorSpace`.
        let value = spelled
            .strip_suffix(" | null")
            .map_or_else(|| spelled.clone(), str::to_owned);
        let null = match symbol {
            Some(symbol) => symbol.optionality() == super::Optionality::Optional,
            None => spelled.ends_with(" | null") || written(result).contains("_Nullable"),
        };
        let class_valued = self.cf_types.iter().any(|(pointer, name)| {
            value == name.as_str()
                || pointer.starts_with("const ") && value == format!("Const<{name}>")
        });
        let owned = if creates(function) && class_valued {
            self.import("c:types", "Owned");
            format!("Owned<{value}>")
        } else {
            value
        };
        Ok(if null {
            format!("{owned} | null")
        } else {
            owned
        })
    }

    /// `fill(this: CGContext, rect: ...): void`, tagged with its function.
    fn cf_method(
        &mut self,
        class: &CfClass,
        pointer: &str,
        function: &str,
        decl: &Value,
        symbol: &Symbol,
    ) -> std::result::Result<String, String> {
        let declared =
            declared(decl, &self.typedefs).ok_or("a function type this does not read")?;
        let parameters = Self::without_self(&declared.parameters, pointer, symbol)?;
        let (base, labels) = swift_name(&symbol.names.title);
        let spelling = Self::cf_spelling_class(class);
        let arguments = self.cf_arguments(&spelling, &symbol.names.title, &parameters, &labels)?;
        let result = self.cf_result(&spelling, function, &declared.result, Some(symbol))?;
        let receiver = self.cf_handle(pointer, class.swift.clone());
        let this = if arguments.is_empty() {
            format!("this: {receiver}")
        } else {
            format!("this: {receiver}, {arguments}")
        };
        Ok(format!(
            "    /** @ntsSymbol {function} */\n    {}({this}): {result};",
            quoted_key(&base)
        ))
    }

    /// `export function CGColor(labels: { red: CGFloat; ... }): Owned<CGColor>`:
    /// Swift's `CGColor(red:green:blue:alpha:)`, as TypeScript calls it.
    /// A `static func` Swift gives the class: the C function it is, as a
    /// function of the class's namespace, every parameter an argument.
    fn cf_static(
        &mut self,
        class: &CfClass,
        function: &str,
        decl: &Value,
        symbol: &Symbol,
    ) -> std::result::Result<String, String> {
        let declared =
            declared(decl, &self.typedefs).ok_or("a function type this does not read")?;
        let (name, labels) = swift_name(&symbol.names.title);
        let spelling = Self::cf_spelling_class(class);
        let arguments = self.cf_arguments(
            &spelling,
            &symbol.names.title,
            &declared.parameters,
            &labels,
        )?;
        let result = self.cf_result(&spelling, function, &declared.result, Some(symbol))?;
        Ok(format!(
            "    /** @ntsSymbol {function} */\n    export function {name}({arguments}): {result};"
        ))
    }

    fn cf_init(
        &mut self,
        class: &CfClass,
        function: &str,
        decl: &Value,
        symbol: &Symbol,
    ) -> std::result::Result<String, String> {
        let declared =
            declared(decl, &self.typedefs).ok_or("a function type this does not read")?;
        let (_, labels) = swift_name(&symbol.names.title);
        let spelling = Self::cf_spelling_class(class);
        let arguments = self.cf_arguments(
            &spelling,
            &symbol.names.title,
            &declared.parameters,
            &labels,
        )?;
        let result = self.cf_result(&spelling, function, &declared.result, Some(symbol))?;
        // `init?(...)`: Swift's failable initializer, which answers nil.
        let failable = symbol
            .fragments
            .iter()
            .any(|f| f.spelling.contains("init?"));
        let result = if failable && !result.ends_with(" | null") {
            format!("{result} | null")
        } else {
            result
        };
        // The class itself, handed over and perhaps `const`: `Owned<Const<CGPath>>`.
        let unwrap = |text: &'_ str, brand: &str| {
            text.strip_prefix(brand)
                .and_then(|inner| inner.strip_suffix('>'))
                .map_or_else(|| text.to_owned(), str::to_owned)
        };
        if unwrap(
            &unwrap(result.trim_end_matches(" | null"), "Owned<"),
            "Const<",
        ) != class.swift
        {
            return Err(format!(
                "an initializer answering a `{result}`, not a `{}`",
                class.swift
            ));
        }
        Ok(format!(
            "  /** @ntsSymbol {function} */\n  export function {}({arguments}): {result};",
            class.swift
        ))
    }

    /// `readonly alpha: CGFloat`: a property Swift reads through a function
    /// of the instance, which is declared beside it under its C name for the
    /// property's `@ntsGet` to name.
    fn cf_property(
        &mut self,
        class: &CfClass,
        pointer: &str,
        function: &str,
        decl: &Value,
        symbol: &Symbol,
    ) -> std::result::Result<String, String> {
        let declared =
            declared(decl, &self.typedefs).ok_or("a function type this does not read")?;
        if !Self::without_self(&declared.parameters, pointer, symbol)?.is_empty() {
            return Err(
                "a property read through a function taking more than the instance".to_owned(),
            );
        }
        let spelling = Self::cf_spelling_class(class);
        let result = self.cf_result(&spelling, function, &declared.result, Some(symbol))?;
        let name = quoted_key(&symbol.names.title);
        let receiver = self.cf_handle(pointer, class.swift.clone());
        Ok(format!(
            "    /** @ntsSymbol {function} */\n    {function}(this: {receiver}): {result};\n    /** @ntsGet {function} */\n    readonly {name}: {result};"
        ))
    }

    /// A free function Swift imports as one: `CGColorSpaceCreateDeviceRGB()`.
    fn cf_function(&mut self, function: &str, decl: &Value) -> std::result::Result<String, String> {
        let symbol = self
            .swift
            .get(&format!("c:@F@{function}"))
            .ok_or("no Swift import of it")?;
        if symbol.kind.identifier != "swift.func" {
            return Err(format!(
                "Swift imports it as a `{}`, not a function",
                symbol.kind.identifier
            ));
        }
        self.available(symbol)?;
        let declared =
            declared(decl, &self.typedefs).ok_or("a function type this does not read")?;
        let (base, labels) = swift_name(&symbol.names.title);
        let spelling = Class {
            objc: String::new(),
            swift: String::new(),
            parent: None,
            members: Vec::new(),
            extensions: Vec::new(),
            skipped: Vec::new(),
            sent: Vec::new(),
        };
        let arguments = self.cf_arguments(
            &spelling,
            &symbol.names.title,
            &declared.parameters,
            &labels,
        )?;
        let result = self.cf_result(&spelling, function, &declared.result, Some(symbol))?;
        Ok(format!(
            "  /** @ntsSymbol {function} */\n  export function {base}({arguments}): {result};"
        ))
    }

    /// The arguments as Swift labels them, one label per C parameter.
    fn cf_arguments(
        &mut self,
        class: &Class,
        title: &str,
        parameters: &[&Value],
        labels: &[String],
    ) -> std::result::Result<String, String> {
        if labels.len() != parameters.len() {
            return Err(format!(
                "Swift's `{title}` labels {} argument(s) where C takes {}",
                labels.len(),
                parameters.len()
            ));
        }
        Ok(self
            .in_c_function(|model| model.arguments(class, parameters, labels))?
            .0)
    }
}

/// The interface of a class's members, its type, and its initializers.
pub(super) fn render(out: &mut String, class: &CfClass) {
    let _ = writeln!(out, "\n  export interface {}OwnMethods {{", class.swift);
    for line in &class.members {
        let _ = writeln!(out, "{line}");
    }
    if !class.skipped.is_empty() {
        let _ = writeln!(out, "    // Not bound, each for the reason given:");
        for line in &class.skipped {
            let _ = writeln!(out, "    //   {line}");
        }
    }
    let _ = writeln!(out, "  }}");
    let _ = writeln!(
        out,
        "  export type {0} = ObjcClass<\"{1}\"> & {0}OwnMethods;",
        class.swift, class.tag
    );
    for line in &class.inits {
        let _ = writeln!(out, "{line}");
    }
    if !class.statics.is_empty() {
        let _ = writeln!(out, "  export namespace {} {{", class.swift);
        for line in &class.statics {
            let _ = writeln!(out, "{line}");
        }
        let _ = writeln!(out, "  }}");
    }
}
