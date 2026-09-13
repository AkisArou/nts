//! A parsed class file as TypeScript declarations.
//!
//! The other half of `nts bind`: [`crate::read`] turns bytes into a
//! [`ClassFile`], and this turns one into the `.d.ts` a program imports.
//!
//! # Why the type mapping is not a preference
//!
//! Every row below is forced by something measured rather than chosen:
//!
//! - **`J` is `bigint`, not `number`.** A Java `long` exceeds 2^53, so a
//!   `number` would round it silently. The friction of not being able to add it
//!   to a `number` is the type system refusing to lose the value.
//! - **`I` is a branded `int`.** Measured: a brand in a **declared** signature
//!   lowers cleanly and the checker rejects a plain `number` against it with
//!   `TS2345`, which is the entire mechanism that keeps `find(int)` apart from
//!   `find(double)` when both collapse to one TypeScript name. The same brand
//!   in one of *our* parameters is refused by the lowering -- so it belongs
//!   here, in a declaration, and nowhere else.
//! - **`[I` is `Int32Array`, not `int[]`.** Also measured: a branded array does
//!   not lower at all, while `Int32Array` gives a real `managed<view<i32>>`
//!   with `i32` element reads. The element type *is* the TypeScript type, so a
//!   branded array cannot narrow and a typed array already does.
//! - **`Ljava/lang/Object;` is `unknown`, never `any`.** Refuse rather than
//!   miscompile, the same rule as an unannotated reference return.
//!
//! # What this slice does not do
//!
//! Generic signatures are read but not yet rendered: a `List<String>` still
//! surfaces as `java.util.List<unknown>` here, with the erased descriptor
//! driving the name. The `Signature` attribute is parsed and carried by
//! [`crate::read::Member`], so this is a rendering gap rather than a missing
//! input, and it is the next thing to close.

use crate::read::ClassFile;
use std::fmt::Write as _;

/// `ACC_PUBLIC`, `ACC_STATIC`, `ACC_FINAL`. JVMS table 4.5-A.
const ACC_PUBLIC: u16 = 0x0001;
const ACC_STATIC: u16 = 0x0008;
const ACC_FINAL: u16 = 0x0010;
/// On a class it means "this is an enum"; on a field, "this is one of its
/// constants". JVMS table 4.5-A.
const ACC_ENUM: u16 = 0x4000;
/// `ACC_INTERFACE`, and `ACC_ABSTRACT` on a method. JVMS table 4.5-A/4.6-A.
const ACC_INTERFACE: u16 = 0x0200;
const ACC_ABSTRACT: u16 = 0x0400;
/// The method's last parameter is a varargs one. At the ABI it is still an
/// array -- `javac` packs the arguments at the **call site** -- but a caller
/// writes `sum(1, 2, 3)`, so the declaration has to spread or it reads
/// `Expected 1 arguments, but got 3`.
const ACC_VARARGS: u16 = 0x0080;

/// One Java type, as TypeScript.
///
/// Takes a descriptor slice and returns the rendered type plus how many bytes
/// it consumed, so an arg list can be walked without a second parser.
fn type_of(descriptor: &str) -> Option<(String, usize)> {
    let bytes = descriptor.as_bytes();
    match *bytes.first()? {
        b'V' => Some(("void".to_owned(), 1)),
        b'Z' => Some(("boolean".to_owned(), 1)),
        // **Every integral width is `number`, and the brands are gone.**
        //
        // Measured 2026-09-13, and it refutes the earlier design. A branded
        // intersection lowers in exactly one position -- a **free** declared
        // function's parameter -- and is refused as a return, as a class
        // property, and as a class *method's* parameter. Bindings are classes,
        // so the brand does not survive anywhere this generator emits one. The
        // first measurement used `declare function`, which is the one shape a
        // binding never takes.
        //
        // What the brand was for -- telling `f(int)` from `f(double)` when both
        // collapse to one TypeScript name -- is done by `disambiguate` below
        // instead, by giving the lossy overloads different names.
        b'B' | b'S' | b'C' | b'I' | b'F' | b'D' => Some(("number".to_owned(), 1)),
        // A `long` exceeds 2^53. `number` would be a lie.
        b'J' => Some(("bigint".to_owned(), 1)),
        // `float` is branded because passing a `number` to it loses precision,
        // and that is worth a cast at the call site. `double` IS `number` and
        // gets no brand -- a brand that is never the distinguishing one is
        // noise everywhere it appears.
        b'[' => {
            let (inner, used) = type_of(&descriptor[1..])?;
            // A Java primitive array IS the matching typed array: same object,
            // no copy, and the element type narrows.
            // An array keeps its exact width, because a typed array IS a
            // distinct TypeScript type -- this is the one place the element
            // width survives without a brand, which is cost 10a's whole point.
            let rendered = typed_array(&descriptor[1..], &inner);
            Some((rendered, used + 1))
        }
        b'L' => {
            let end = descriptor.find(';')?;
            let binary = &descriptor[1..end];
            Some((reference(binary), end + 1))
        }
        _ => None,
    }
}

// The package a rendering is happening inside, so a sibling class can be named
// unqualified.
//
// **Without this the output does not compile.** Inside
// `declare module "java:com.example"`, a field rendered as `com.example.Kind`
// refers to a `com` namespace that does not exist -- the module's own members
// are in scope under their simple names. Found by running the generator and
// reading the output, not by reasoning about it.
thread_local! {
    static PACKAGE: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

/// The typed array for a Java array's element descriptor.
///
/// Keyed on the **descriptor** rather than on the rendered name, because every
/// integral width renders as `number` now and only the descriptor still says
/// which one. `[I` is an `Int32Array` and `[B` a `Uint8Array`; getting that from
/// the rendered type would be impossible.
fn typed_array(element: &str, rendered: &str) -> String {
    match element.as_bytes().first() {
        Some(b'B') => "Uint8Array".to_owned(),
        Some(b'S') => "Int16Array".to_owned(),
        Some(b'C') => "Uint16Array".to_owned(),
        Some(b'I') => "Int32Array".to_owned(),
        Some(b'F') => "Float32Array".to_owned(),
        Some(b'D') => "Float64Array".to_owned(),
        Some(b'J') => "BigInt64Array".to_owned(),
        // `boolean[]` has no typed array, and an array of references is an
        // ordinary TypeScript array.
        _ => format!("{rendered}[]"),
    }
}

/// A reference type's binary name, as TypeScript.
fn reference(binary: &str) -> String {
    match binary {
        "java/lang/String" | "java/lang/CharSequence" => "string".to_owned(),
        // Refuse rather than miscompile: `any` would silence every later error.
        "java/lang/Object" => "unknown".to_owned(),
        // A nested class is `Outer$Inner` in the class file and `Outer.Inner`
        // in a namespace, which is how `Catalog.Entry` reads at a call site.
        other => {
            let dotted = other.replace(['/', '$'], ".");
            // A class in the package being generated is in scope unqualified.
            PACKAGE.with(|package| {
                let package = package.borrow();
                if package.is_empty() {
                    return dotted.clone();
                }
                let prefix = format!("{package}.");
                dotted.strip_prefix(&prefix).map_or_else(|| dotted.clone(), str::to_owned)
            })
        }
    }
}

/// The parameter types and return type of a method descriptor.
fn signature_of(descriptor: &str) -> Option<(Vec<String>, String)> {
    let open = descriptor.find('(')?;
    let close = descriptor.find(')')?;
    let mut parameters = Vec::new();
    let mut rest = &descriptor[open + 1..close];
    while !rest.is_empty() {
        let (rendered, used) = type_of(rest)?;
        parameters.push(rendered);
        rest = &rest[used..];
    }
    let (returns, _) = type_of(&descriptor[close + 1..])?;
    Some((parameters, returns))
}

/// Whether a member is annotated `@Nullable`, in either annotation table.
fn nullable(annotations: &[String]) -> bool {
    annotations.iter().any(|it| it.ends_with("/Nullable"))
}

fn nonnull(annotations: &[String]) -> bool {
    annotations.iter().any(|it| it.ends_with("/NonNull"))
}

/// Is this type one a `null` can inhabit?
fn is_reference(rendered: &str) -> bool {
    !matches!(
        rendered,
        "void" | "boolean" | "byte" | "short" | "char" | "int" | "bigint" | "float" | "number"
    )
}

/// A return type with its nullability applied.
///
/// **An unannotated reference return becomes `T | null`.** That is the
/// refuse-rather-than-miscompile rule and the reason Kotlin had to invent
/// platform types: the class file genuinely does not say, and guessing
/// non-null produces an NPE the type system promised could not happen. An
/// overrides file is how a jar with no annotations gets cleaned up.
fn returns(rendered: &str, annotations: &[String]) -> String {
    if !is_reference(rendered) || nonnull(annotations) {
        return rendered.to_owned();
    }
    format!("{rendered} | null")
}

fn simple_name(binary: &str) -> String {
    let after_package = binary.rsplit('/').next().unwrap_or(binary);
    after_package.rsplit('$').next().unwrap_or(after_package).to_owned()
}

/// How the generator finds a class it does not hold.
///
/// **A callback rather than a jar reader, deliberately.** A jar is a zip, and
/// the **workspace** `Cargo.toml` says of the external ones: *"External. Deliberately
/// small; every addition is a maintenance obligation."* Taking a zip and a
/// deflate crate to resolve a superclass would be two, for a job the caller can
/// already do -- it has the jar open. So the crate stays dependency-free and
/// the caller answers questions about names.
///
/// Returning `None` is always allowed and always safe: the generator emits what
/// it can see and nothing it cannot, which is how a partially-resolvable jar
/// still produces usable declarations.
pub trait Resolve {
    /// The class with this binary name, e.g. `java/lang/Enum`.
    fn find(&self, binary_name: &str) -> Option<ClassFile>;
}

/// A resolver that knows nothing, for the single-class case.
#[derive(Debug)]
pub struct Alone;

impl Resolve for Alone {
    fn find(&self, _binary_name: &str) -> Option<ClassFile> {
        None
    }
}

/// Every member a class inherits and does not itself declare.
///
/// Walks `super_name` upward, skipping `java/lang/Object` -- whose members
/// (`toString`, `wait`, `notify`) are noise on every generated class and are
/// not what a caller is reaching for.
///
/// **Overridden members are not duplicated**, matched on name *and* erased
/// descriptor: a subclass narrowing a return type declares a bridge method with
/// the same name and a different descriptor, and treating those as distinct is
/// what keeps a covariant override from vanishing.
fn inherited(class: &ClassFile, resolve: &dyn Resolve) -> Vec<crate::read::Member> {
    let mut seen: Vec<(String, String)> = class
        .methods
        .iter()
        .map(|m| (m.name.clone(), m.descriptor.clone()))
        .collect();
    let mut found = Vec::new();
    let mut next = class.super_name.clone();
    // A bound rather than a visited-set: a class hierarchy cannot be cyclic
    // (the verifier rejects it at load), so this only guards a malformed jar.
    for _ in 0..32 {
        let Some(name) = next.take() else { break };
        if name == "java/lang/Object" {
            break;
        }
        let Some(parent) = resolve.find(&name) else { break };
        for method in &parent.methods {
            if method.access & ACC_PUBLIC == 0 || method.name.starts_with('<') {
                continue;
            }
            let key = (method.name.clone(), method.descriptor.clone());
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            found.push(method.clone());
        }
        next.clone_from(&parent.super_name);
    }
    found
}

/// How lossy it is to receive a TypeScript `number` as this Java type.
///
/// Lower is better. A `number` **is** an f64, so `double` receives it without
/// loss and is the only non-lossy choice; everything below truncates or rounds.
/// This is the same order `find(1.5)` resolving to `find(double)` rests on, and
/// it is the rule a Java programmer already expects.
fn lossiness(descriptor: &str) -> u8 {
    match descriptor.as_bytes().first() {
        Some(b'D') => 0,
        Some(b'J') => 1,
        Some(b'F') => 2,
        Some(b'I') => 3,
        Some(b'S') => 4,
        Some(b'C') => 5,
        Some(b'B') => 6,
        _ => 7,
    }
}

/// A short suffix naming a method's Java parameter types, for the overloads
/// that collapse onto one TypeScript signature.
///
/// **This is what replaced the brands.** `f(int)`, `f(long)` and `f(double)`
/// all take a `number` now, so two of the three need different *names* or the
/// declaration has duplicate members. `find$int` is greppable, needs no
/// compiler change, and says at the call site which one you meant -- which is
/// exactly the job the brand was doing, done with a mechanism that lowers.
fn suffix(descriptor: &str) -> String {
    let Some(open) = descriptor.find('(') else { return String::new() };
    let Some(close) = descriptor.find(')') else { return String::new() };
    let mut names = Vec::new();
    let mut rest = &descriptor[open + 1..close];
    while !rest.is_empty() {
        let used = match rest.as_bytes()[0] {
            b'L' => rest.find(';').map_or(rest.len(), |it| it + 1),
            b'[' => {
                let mut at = 0;
                while rest.as_bytes().get(at) == Some(&b'[') {
                    at += 1;
                }
                if rest.as_bytes().get(at) == Some(&b'L') {
                    rest[at..].find(';').map_or(rest.len(), |it| at + it + 1)
                } else {
                    at + 1
                }
            }
            _ => 1,
        };
        let part = &rest[..used];
        names.push(match part.as_bytes()[0] {
            b'B' => "byte".to_owned(),
            b'S' => "short".to_owned(),
            b'C' => "char".to_owned(),
            b'I' => "int".to_owned(),
            b'J' => "long".to_owned(),
            b'F' => "float".to_owned(),
            b'D' => "double".to_owned(),
            b'Z' => "boolean".to_owned(),
            _ => simple_name(part.trim_start_matches(['[', 'L']).trim_end_matches(';')),
        });
        rest = &rest[used..];
    }
    format!("${}", names.join("$"))
}

/// The binary name of a method descriptor's parameter at `index`, if it is a
/// reference type. Needed because the *rendered* type has already lost it.
fn parameter_binary(descriptor: &str, index: usize) -> Option<String> {
    let open = descriptor.find('(')?;
    let close = descriptor.find(')')?;
    let mut rest = &descriptor[open + 1..close];
    let mut at = 0usize;
    while !rest.is_empty() {
        let (_, used) = type_of(rest)?;
        if at == index {
            let part = &rest[..used];
            return part.strip_prefix('L').and_then(|it| it.strip_suffix(';')).map(str::to_owned);
        }
        rest = &rest[used..];
        at += 1;
    }
    None
}

/// A Java **functional interface** as a TypeScript function type.
///
/// A single-abstract-method interface -- `Runnable`, `OnTouchListener`,
/// `OnBytes` -- is what a Java caller passes a lambda to, and it is what a
/// TypeScript caller wants to pass an arrow function to. Surfaced as the
/// interface type instead, `setOnTouch` would demand an object with an
/// `onTouch` property, which is not what anybody writes and not what `javac`
/// accepts either.
///
/// This is cost 8 in docs/jvm-interop.md -- *"Closure to Java functional
/// interface, eliminated"* -- and it is eliminated here rather than at the call
/// site: a closure already IS an object with one method on this backend, so
/// there is nothing to convert, only something to *declare correctly*.
///
/// Returns `None` unless the resolver finds the class **and** it is an
/// interface with exactly one abstract method. Default and static methods do
/// not count against it, which is what makes `Comparator` still a SAM.
fn functional_interface(binary: &str, resolve: &dyn Resolve) -> Option<String> {
    let class = resolve.find(binary)?;
    if class.access & ACC_INTERFACE == 0 {
        return None;
    }
    let mut abstracts = class
        .methods
        .iter()
        .filter(|m| m.access & ACC_ABSTRACT != 0 && m.access & ACC_STATIC == 0);
    let only = abstracts.next()?;
    if abstracts.next().is_some() {
        return None;
    }
    let (parameters, result) = signature_of(&only.descriptor)?;
    let arguments = parameters
        .iter()
        .enumerate()
        .map(|(index, rendered)| format!("a{index}: {rendered}"))
        .collect::<Vec<_>>()
        .join(", ");
    Some(format!("({arguments}) => {result}"))
}

/// The name a method is emitted under, renaming it when an overload collapses.
///
/// If another public method of the class renders the same name with the same
/// TypeScript parameter list, the two are indistinguishable and one must be
/// renamed. The **least lossy** keeps the plain name, because a caller writing
/// `find(x)` with a `number` means the overload that does not truncate.
fn emitted_name(
    class: &ClassFile,
    method: &crate::read::Member,
    collapsed: &[(String, String)],
) -> String {
    let key = |descriptor: &str| {
        signature_of(descriptor).map(|(parameters, _)| parameters.join(",")).unwrap_or_default()
    };
    let mine = key(&method.descriptor);
    let twins =
        collapsed.iter().filter(|(name, other)| name == &method.name && other == &mine).count();
    if twins <= 1 {
        return method.name.clone();
    }
    let best = class
        .methods
        .iter()
        .filter(|other| {
            other.access & ACC_PUBLIC != 0 && other.name == method.name && key(&other.descriptor) == mine
        })
        .min_by_key(|other| lossiness(&other.descriptor[1..]))
        .map(|other| other.descriptor.clone());
    if best.as_deref() == Some(method.descriptor.as_str()) {
        method.name.clone()
    } else {
        format!("{}{}", method.name, suffix(&method.descriptor))
    }
}

/// Append every public field, with its nullability and constant-ness.
fn render_fields(out: &mut String, class: &ClassFile) -> Result<(), String> {
    let is_enum_class = class.access & ACC_ENUM != 0;

    for field in class.fields.iter().filter(|f| f.access & ACC_PUBLIC != 0) {
        let Some((rendered, _)) = field
            .signature
            .as_deref()
            .and_then(|it| generic_type(it).map(|(rendered, _)| (rendered, 0)))
            .or_else(|| type_of(&field.descriptor))
        else {
            return Err(format!("{}.{}: {}", class.binary_name, field.name, field.descriptor));
        };
        let is_static = field.access & ACC_STATIC != 0;
        let is_final = field.access & ACC_FINAL != 0;
        // **Two fields are provably never null, and the default would have
        // made both `| null` for no reason.**
        //
        // A `ConstantValue` field IS its constant -- the value is in the class
        // file and the JVM resolves the read to an `ldc`, so there is no
        // execution in which it is null. And an enum's own constants are
        // created by its `<clinit>` before any of them is observable, which
        // the JLS guarantees; `ACC_ENUM` on both the class and the field is
        // how the class file says so.
        //
        // Without this, `Catalog.NAME` reads `string | null` for a compile-time
        // string literal, and every use of it needs a null check that can
        // never fire. That is the kind of noise that makes a generated binding
        // unpleasant enough to hand-edit.
        let provably_present = field.constant || (is_enum_class && field.access & ACC_ENUM != 0);
        // `ConstantValue` is what decides `ldc` against `getstatic`, and it is
        // worth saying at the declaration because it decides whether touching
        // the member loads the class at all.
        let note = if field.constant {
            "    /** Inlined at the call site: the class is never loaded for this. */\n"
        } else if is_static {
            "    /** A real `getstatic`, and it runs the owner's `<clinit>`. */\n"
        } else {
            ""
        };
        out.push_str(note);
        let _ = writeln!(
            out,
            "    {}{}{}: {};",
            if is_static { "static " } else { "" },
            if is_final { "readonly " } else { "" },
            field.name,
            if provably_present { rendered.clone() } else { returns(&rendered, &field.annotations) },
        );
    }
    Ok(())
}

/// Render one class as a `declare class` body.
///
/// # Errors
///
/// Returns the member's name when a descriptor cannot be rendered, rather than
/// emitting a declaration with a hole in it. **Refuse by name, never
/// half-emit**: a `.d.ts` that silently drops a method is one a caller trusts.
pub fn declarations(class: &ClassFile) -> Result<String, String> {
    declarations_with(class, &Alone)
}

/// Render one class, resolving inherited members through `resolve`.
///
/// # Errors
///
/// As [`declarations`].
pub fn declarations_with(class: &ClassFile, resolve: &dyn Resolve) -> Result<String, String> {
    // The package this class lives in, so its siblings render unqualified.
    let package = class
        .binary_name
        .rsplit_once('/')
        .map_or_else(String::new, |(package, _)| package.replace('/', "."));
    PACKAGE.with(|it| it.replace(package));

    let mut out = String::new();
    let name = simple_name(&class.binary_name);

    let is_interface = class.access & ACC_INTERFACE != 0;
    let _ = writeln!(out, "  /** {} */", class.binary_name.replace('/', "."));
    // **An interface is emitted as an interface, so it can be implemented.**
    // Without this a Java callback type is not nameable at all -- it only ever
    // appeared inlined at a parameter as a function type -- and a TypeScript
    // class could not declare that it implements one. Java accepts both a
    // lambda and an implementing object for a functional interface; the
    // TypeScript surface has to offer both for the same reason.
    let _ = writeln!(
        out,
        "  export {} {name} {{",
        if is_interface { "interface" } else { "class" }
    );

    render_fields(&mut out, class)?;

    // Which methods collapse onto one TypeScript signature. Computed before
    // rendering, because the decision is about the *set*: a name is only
    // ambiguous relative to its siblings.
    let mut collapsed: Vec<(String, String)> = Vec::new();
    for method in class.methods.iter().filter(|m| m.access & ACC_PUBLIC != 0) {
        if let Some((parameters, _)) = signature_of(&method.descriptor) {
            collapsed.push((method.name.clone(), parameters.join(",")));
        }
    }

    for method in class.methods.iter().filter(|m| m.access & ACC_PUBLIC != 0) {
        // The `Signature` attribute first, because it is the one that still has
        // the type arguments; the erased descriptor is the fallback, so an
        // exotic signature loses its generics rather than losing the method.
        let Some((parameters, result)) = method
            .signature
            .as_deref()
            .and_then(generic_signature)
            .or_else(|| signature_of(&method.descriptor))
        else {
            return Err(format!("{}.{}: {}", class.binary_name, method.name, method.descriptor));
        };
        let variadic = method.access & ACC_VARARGS != 0;
        let last = parameters.len().saturating_sub(1);
        let arguments = parameters
            .iter()
            .enumerate()
            .map(|(index, rendered)| {
                // A parameter annotated `@Nullable` accepts null; an
                // unannotated one does NOT get `| null` added, because the
                // rule for an argument runs the other way from a return -- a
                // caller passing null where the callee did not say it accepts
                // one is the error this keeps.
                let annotated = method
                    .parameter_annotations
                    .get(index)
                    .is_some_and(|it| nullable(it));
                let ty = if annotated && is_reference(rendered) {
                    format!("{rendered} | null")
                } else {
                    rendered.clone()
                };
                // A functional interface parameter takes a closure, not an
                // object with a method on it.
                if let Some(binary) = parameter_binary(&method.descriptor, index)
                    && let Some(signature) = functional_interface(&binary, resolve)
                {
                    // Both forms, because Java accepts both: a lambda, and an
                    // object that implements the interface. Surfacing only the
                    // function type makes `class Handler implements OnTouch`
                    // inexpressible; surfacing only the interface makes an
                    // arrow function inexpressible.
                    return format!("a{index}: {rendered} | ({signature})");
                }
                if variadic && index == last {
                    // The ABI type is the array; the call site spreads. A
                    // typed array is not spreadable as elements, so the
                    // element type comes back out of it.
                    let element = match ty.as_str() {
                        // Every integral width is `number` now, so the element
                        // type of a numeric typed array is `number` -- the
                        // width lives in the typed array, and a spread has no
                        // typed array to live in.
                        "Int32Array" | "Uint8Array" | "Int16Array" | "Uint16Array"
                        | "Float32Array" | "Float64Array" => "number[]".to_owned(),
                        "BigInt64Array" => "bigint[]".to_owned(),
                        other => other.to_owned(),
                    };
                    return format!("...a{index}: {element}");
                }
                format!("a{index}: {ty}")
            })
            .collect::<Vec<_>>()
            .join(", ");

        if method.name == "<init>" {
            if !is_interface {
                let _ = writeln!(out, "    constructor({arguments});");
            }
            continue;
        }

        let emitted = emitted_name(class, method, &collapsed);
        if method.name == "<clinit>" {
            continue;
        }
        if !method.throws.is_empty() {
            let _ = writeln!(
                out,
                "    /** Throws {}. Caught at the call site and raised as an `NtsRefusal`; not \
                 catchable by a TypeScript `try` yet. */",
                method.throws.iter().map(|it| it.replace('/', ".")).collect::<Vec<_>>().join(", ")
            );
        }
        let _ = writeln!(
            out,
            "    {}{}{}({arguments}): {};",
            if method.access & ACC_STATIC != 0 { "static " } else { "" },
            emitted,
            type_parameters(method.signature.as_deref()),
            returns(&result, &method.annotations),
        );
    }

    render_inherited(&mut out, class, resolve);

    out.push_str("  }\n");
    Ok(out)
}

/// Every **field** this class inherits and does not itself declare.
///
/// A separate walk from the methods, and it was missing: `Panel extends View
/// extends Widget` could not read `panel.right`, because `right` is a public
/// field on `Widget` and only methods were being inherited. `android.graphics.
/// Rect`-shaped geometry is *exactly* this -- public mutable fields read
/// through a subclass -- so a generator that inherits methods only cannot
/// express the Android surface it exists for.
///
/// Shadowing is by name alone, because a field cannot be overloaded: a subclass
/// declaring `left` hides the parent's, and the subclass's is the one in scope.
fn inherited_fields(class: &ClassFile, resolve: &dyn Resolve) -> Vec<crate::read::Member> {
    let mut seen: Vec<String> = class.fields.iter().map(|f| f.name.clone()).collect();
    let mut found = Vec::new();
    let mut next = class.super_name.clone();
    for _ in 0..32 {
        let Some(name) = next.take() else { break };
        if name == "java/lang/Object" {
            break;
        }
        let Some(parent) = resolve.find(&name) else { break };
        for field in &parent.fields {
            if field.access & ACC_PUBLIC == 0 || seen.contains(&field.name) {
                continue;
            }
            seen.push(field.name.clone());
            found.push(field.clone());
        }
        next.clone_from(&parent.super_name);
    }
    found
}

/// Append every member this class inherits and does not redeclare.
///
/// Separate from [`declarations_with`] because that function was over a hundred
/// lines with it inline, and the two halves answer different questions: what
/// this class says, and what it gets for free.
fn render_inherited(out: &mut String, class: &ClassFile, resolve: &dyn Resolve) {
    for field in inherited_fields(class, resolve) {
        let Some((rendered, _)) = type_of(&field.descriptor) else { continue };
        let _ = writeln!(
            out,
            "    /** Inherited. */\n    {}{}: {};",
            if field.access & ACC_FINAL != 0 { "readonly " } else { "" },
            field.name,
            if field.constant { rendered.clone() } else { returns(&rendered, &field.annotations) },
        );
    }
    for method in inherited(class, resolve) {
        let Some((parameters, result)) = method
            .signature
            .as_deref()
            .and_then(generic_signature)
            .or_else(|| signature_of(&method.descriptor))
        else {
            // Skipped rather than refused: an inherited member this subset
            // cannot render is one the caller never asked for by name, where a
            // declared one is.
            continue;
        };
        let arguments = parameters
            .iter()
            .enumerate()
            .map(|(index, rendered)| format!("a{index}: {rendered}"))
            .collect::<Vec<_>>()
            .join(", ");
        let _ = writeln!(
            out,
            "    /** Inherited. */\n    {}{}({arguments}): {};",
            if method.access & ACC_STATIC != 0 { "static " } else { "" },
            method.name,
            returns(&result, &method.annotations),
        );
    }
}

/// Wrap classes in the ambient module a program imports, nesting the nested
/// ones.
///
/// Takes `(binary_name, body)` because nesting is decided by the binary name:
/// `com/example/Catalog$Cursor` belongs inside `Catalog`. Emitting it top-level
/// as `Cursor` is what the first version did, and it does not compile --
/// `cursorAt` returns `Catalog.Cursor`, which then refers to nothing.
///
/// A `$` in a binary name is the separator `javac` uses for both static nested
/// and true inner classes, and both nest the same way here; the difference
/// between them is in the *constructor descriptor*, which already carries the
/// outer instance for an inner one.
#[must_use]
pub fn module_of(package: &str, classes: &[(String, String)]) -> String {
    let mut out = String::new();
    out.push_str("// GENERATED by `nts bind`. Do not edit.\n//\n");
    out.push_str("// Every comment below is emitted, not written by hand: where a member costs an\n");
    out.push_str("// allocation or loads a class, the declaration is where a reader is looking.\n//\n");
    // **No top-level `import` here, and that is load-bearing rather than
    // stylistic.** A `.d.ts` containing a top-level import or export is a
    // *module*, and a `declare module "x"` inside a module file is a module
    // **augmentation** -- it adds to a module that must already exist, and
    // declares nothing on its own. The result is
    // `TS2307 Cannot find module 'java:com.example'` at every import site.
    //
    // With no top-level import the file is a global script and the block is an
    // ambient declaration, which is what an import can resolve to. The brands
    // and the `java.*` namespace come from `java.d.ts`, which is global for the
    // same reason.
    //
    // Found by compiling the output. Reading it three times did not.
    out.push_str("// The brands and the `java.*` namespace come from java.d.ts, which is global --\n");
    out.push_str("// this file must NOT import them, or it becomes a module and declares nothing.\n\n");
    let _ = writeln!(out, "declare module \"java:{package}\" {{");

    // Outer classes first, each followed by a namespace holding whatever nests
    // inside it -- TypeScript wants the class before the namespace that merges
    // with it.
    for (binary, body) in classes.iter().filter(|(binary, _)| !binary.contains('$')) {
        out.push_str(body);

        let simple = simple_name(binary);
        let prefix = format!("{binary}$");
        let nested: Vec<&String> = classes
            .iter()
            .filter(|(inner, _)| inner.starts_with(&prefix))
            .map(|(_, body)| body)
            .collect();
        if nested.is_empty() {
            out.push('\n');
            continue;
        }
        let _ = writeln!(out, "\n  export namespace {simple} {{");
        for body in nested {
            // Two more spaces, because the body was written for one level.
            for line in body.lines() {
                if line.is_empty() {
                    out.push('\n');
                } else {
                    let _ = writeln!(out, "  {line}");
                }
            }
        }
        out.push_str("  }\n\n");
    }

    out.push_str("}\n");
    out
}


// ---------------------------------------------------------------------------
// Generic signatures
// ---------------------------------------------------------------------------
//
// The `Signature` attribute (JVMS 4.7.9.1) carries what erasure removed, so
// `names()` can surface `List<string>` rather than `List<unknown>`. Surfacing
// it is right because **Java erases generics at runtime and so does
// TypeScript**: a `List<String>` is a `List` in both, the parameter is a
// compile-time claim in both, and surfacing promises exactly what Java promises
// and no more. Erasing to `unknown` would throw away a guarantee we can keep,
// at the cost of a cast on every element access.

/// One type from a generic signature, and how many bytes it consumed.
fn generic_type(signature: &str) -> Option<(String, usize)> {
    let bytes = signature.as_bytes();
    match *bytes.first()? {
        // A type variable: `TT;` is the parameter named `T`.
        b'T' => {
            let end = signature.find(';')?;
            Some((signature[1..end].to_owned(), end + 1))
        }
        b'[' => {
            let (inner, used) = generic_type(&signature[1..])?;
            let rendered = match inner.as_str() {
                "byte" => "Uint8Array".to_owned(),
                "short" => "Int16Array".to_owned(),
                "char" => "Uint16Array".to_owned(),
                "int" => "Int32Array".to_owned(),
                "float" => "Float32Array".to_owned(),
                "number" => "Float64Array".to_owned(),
                "bigint" => "BigInt64Array".to_owned(),
                other => format!("{other}[]"),
            };
            Some((rendered, used + 1))
        }
        b'L' => {
            let mut at = 1usize;
            let mut name = String::new();
            let mut arguments: Vec<String> = Vec::new();
            while at < signature.len() {
                match signature.as_bytes()[at] {
                    b';' => {
                        at += 1;
                        break;
                    }
                    b'<' => {
                        at += 1;
                        // Type arguments, until the matching `>`.
                        while at < signature.len() && signature.as_bytes()[at] != b'>' {
                            match signature.as_bytes()[at] {
                                // `*` is an unbounded wildcard: `List<?>`.
                                b'*' => {
                                    arguments.push("unknown".to_owned());
                                    at += 1;
                                }
                                // `+X` is `? extends X`, covariant and so
                                // read-only; `-X` is `? super X`, which a
                                // caller may pass any `X` to. Both render as
                                // the bound -- TypeScript has no wildcard, and
                                // the variance shows up in whether the position
                                // is readable or writable rather than in a
                                // syntax of its own.
                                b'+' | b'-' => {
                                    let (rendered, used) = generic_type(&signature[at + 1..])?;
                                    arguments.push(rendered);
                                    at += used + 1;
                                }
                                _ => {
                                    let (rendered, used) = generic_type(&signature[at..])?;
                                    arguments.push(rendered);
                                    at += used;
                                }
                            }
                        }
                        at += 1; // the `>`
                    }
                    b'.' => {
                        // A nested class inside a parameterised outer.
                        name.push('.');
                        at += 1;
                    }
                    other => {
                        name.push(other as char);
                        at += 1;
                    }
                }
            }
            let base = reference(&name);
            if arguments.is_empty() || base == "string" || base == "unknown" {
                Some((base, at))
            } else {
                Some((format!("{base}<{}>", arguments.join(", ")), at))
            }
        }
        _ => type_of(signature),
    }
}

/// Split a signature's leading `<...>` type-parameter block from the rest.
///
/// Returns the remainder and the parameter **names**. The names matter: a
/// method declaring `<T>` and using `T` must render as `repeat<T>(...)`, or the
/// `T` in its body refers to nothing and the generated file does not compile.
/// That was the first thing running the generator on a real jar exposed.
fn split_type_parameters(signature: &str) -> (&str, Vec<String>) {
    if !signature.starts_with('<') {
        return (signature, Vec::new());
    }
    let mut depth = 0usize;
    let mut end = 0usize;
    for (index, byte) in signature.bytes().enumerate() {
        match byte {
            b'<' => depth += 1,
            b'>' => {
                depth -= 1;
                if depth == 0 {
                    end = index + 1;
                    break;
                }
            }
            _ => {}
        }
    }
    // Inside, each parameter is `Name:Bound` and the bounds are ignored -- a
    // TypeScript `extends` clause for a Java bound is a separate decision and
    // an unbounded parameter is never *wrong*, only looser.
    let inside = &signature[1..end.saturating_sub(1)];
    let mut names = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();
    for ch in inside.chars() {
        match ch {
            '<' => {
                depth += 1;
                current.clear();
            }
            '>' => depth -= 1,
            ':' if depth == 0 => {
                if !current.is_empty() {
                    names.push(std::mem::take(&mut current));
                }
            }
            ';' if depth == 0 => current.clear(),
            _ if depth == 0 => current.push(ch),
            _ => {}
        }
    }
    (&signature[end..], names)
}

/// The type parameters a method declares, as a rendered `<T, U>` or empty.
fn type_parameters(signature: Option<&str>) -> String {
    let Some(signature) = signature else { return String::new() };
    let (_, names) = split_type_parameters(signature);
    if names.is_empty() {
        String::new()
    } else {
        format!("<{}>", names.join(", "))
    }
}

/// The parameter and return types of a **generic** method signature.
///
/// Returns `None` for anything this subset does not handle, and every caller
/// falls back to the erased descriptor -- so an exotic signature loses its type
/// arguments rather than losing the method.
fn generic_signature(signature: &str) -> Option<(Vec<String>, String)> {
    let (rest, _) = split_type_parameters(signature);
    let open = rest.find('(')?;
    let close = rest.rfind(')')?;
    let mut parameters = Vec::new();
    let mut inside = &rest[open + 1..close];
    while !inside.is_empty() {
        let (rendered, used) = generic_type(inside)?;
        if used == 0 || used > inside.len() {
            return None;
        }
        parameters.push(rendered);
        inside = &inside[used..];
    }
    // The return type, stopping before any `^ThrowsSignature`.
    let after = &rest[close + 1..];
    let end = after.find('^').unwrap_or(after.len());
    let (returns, _) = generic_type(&after[..end])?;
    Some((parameters, returns))
}
