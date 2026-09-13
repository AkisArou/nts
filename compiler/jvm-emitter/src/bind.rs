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

use crate::class::access;
use crate::read::ClassFile;
use std::fmt::Write as _;


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
    /// Packages this module referred to and does not itself declare, collected
    /// while rendering so `module_of` can import them.
    ///
    /// A thread-local for the same reason `PACKAGE` is one: `reference` is
    /// called from a dozen places through `type_of` and `generic_type`, and
    /// threading an accumulator through all of them to reach one writer would
    /// be a parameter on every signature in this file.
    static IMPORTS: std::cell::RefCell<std::collections::BTreeSet<String>> =
        const { std::cell::RefCell::new(std::collections::BTreeSet::new()) };
}

/// The package part of a binary name, in binary form.
///
/// **From the binary name, before `$` becomes `.`.** A package separator is `/`
/// and a nesting separator is `$`, and flattening them together first is what
/// made `android/view/accessibility/AccessibilityEvent` render as
/// `accessibility.AccessibilityEvent`: the bound package's prefix was stripped
/// off a *sub*-package, leaving a relative path to a namespace that does not
/// exist. 163 of the errors in `android.view` were that one line.
fn package_of(binary: &str) -> &str {
    binary.rsplit_once('/').map_or("", |(package, _)| package)
}

/// The alias an imported package takes: its full path, underscored.
///
/// **The last component was tried first and is wrong.** `accessibility` reads
/// better than `android_view_accessibility`, and on the real `android.view` two
/// packages collide on it immediately -- `android.animation` and
/// `android.view.animation` both want `animation`, and so do
/// `android.content.res` and one other. Detecting that in `module_of` does not
/// work either: references are rendered *before* the module is assembled, so by
/// the time the clash is visible the short name is already in the text and only
/// the import statement can be changed. That produces a file where the alias
/// bound by the import is not the alias the references use, which is worse than
/// either name.
///
/// The full path needs no global knowledge and cannot collide. It costs
/// `android_graphics.Canvas` where a Java programmer writes
/// `android.graphics.Canvas`, which is the same information and one character
/// different.
fn alias_of(package: &str) -> String {
    package.replace('/', "_")
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
            let owner = package_of(other);
            let simple = other.rsplit_once('/').map_or(other, |(_, it)| it).replace('$', ".");
            PACKAGE.with(|package| {
                let package = package.borrow().replace('.', "/");
                // A class in the package being generated is in scope unqualified.
                if owner == package {
                    return simple.clone();
                }
                // **`java.*` stays fully qualified and is not imported**, so a
                // reference reads `java.util.List<string>` exactly as a Java
                // programmer writes it. That is only sound because the prelude
                // is *generated* -- see `namespace_of`. While it was a
                // hand-written ten-type subset, this same line cost **2,637 of
                // 4,395 errors** over the transitive closure of `android.view`:
                // `java.util.List` resolved and
                // `java.util.concurrent.Executor` did not, because the jar's
                // bindings reference the library in full and the prelude
                // covered a corner of it.
                //
                // Importing them instead was measured and works -- it takes
                // that 2,637 to zero -- and renders `java_util.List`, which is
                // worse to read than Java. Generating the prelude gets both.
                //
                // A default package has nothing to import from and stays bare.
                // **`javax` too, and it is not a prefix accident.** A prelude
                // is a global namespace and therefore cannot import anything --
                // `namespace_of` has no import section by construction -- so a
                // `java.*` prelude referring to `javax.crypto.SecretKey` had no
                // way to name it and rendered an alias nothing declared. Every
                // remaining `Cannot find namespace` over the closure was that:
                // `javax_security_auth`, `javax_crypto`, and their siblings.
                //
                // `javax` is the JDK as much as `java` is, so it belongs on the
                // same side of this line. Note `starts_with("java/")` does not
                // already catch it: `javax/` is `j-a-v-a-x`, and the fifth byte
                // is not the slash.
                if owner.starts_with("java/") || owner.starts_with("javax/") || owner.is_empty() {
                    return other.replace(['/', '$'], ".");
                }
                IMPORTS.with(|it| it.borrow_mut().insert(owner.to_owned()));
                format!("{}.{simple}", alias_of(owner))
            })
        }
    }
}

/// The parameter types and return type of a method descriptor.
fn signature_of(descriptor: &str) -> Option<(Vec<String>, String)> {
    // Split with `descriptor::parameters`, which is the walker `call_effect`
    // uses. Three functions in this file used to find `(` and `)` and step the
    // types themselves, which is four derivations of "where does one parameter
    // end" in a crate that already had one -- and its own doc says that is
    // "the whole reason this module parses rather than being told".
    let split = crate::descriptor::parameters(descriptor)?;
    let mut parameters = Vec::with_capacity(split.len());
    for part in split {
        parameters.push(type_of(part)?.0);
    }
    let close = descriptor.rfind(')')?;
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
/// Which of a class's methods collapse onto one TypeScript signature.
///
/// Extracted so the declared path and the inherited path ask the same question.
/// They did not: `emitted_name` was reached only from the declared side, so an
/// inherited member rendered under its raw Java name while the class that
/// declared it rendered a mangled one -- caught by
/// `an_inherited_method_renders_exactly_as_its_declared_form`, which is the
/// fourth time that test has found this shape.
fn collapsed_of(class: &ClassFile) -> Vec<(String, String)> {
    class
        .methods
        .iter()
        .filter(|m| visible(m.access) && is_api(m))
        .filter_map(|m| {
            signature_of(&m.descriptor).map(|(parameters, _)| (m.name.clone(), parameters.join(",")))
        })
        .collect()
}

/// The type arguments a class binds on each supertype, keyed by the supertype's
/// own parameter name.
///
/// `class CursorLoader extends AsyncTaskLoader<Cursor>` inherits
/// `D onLoadInBackground()` from a parent declared `<D>`, and `D` means nothing
/// in `CursorLoader`. Rendering the inherited member verbatim produced
/// `onLoadInBackground(): D | null` on a class with no `D` -- **249 errors over
/// the closure**, the largest category left after nesting.
///
/// The substitution is done on the **JVM signature** rather than on the
/// rendered TypeScript. `()TD;` becomes `()Landroid/database/Cursor;` by an
/// exact grammar rule; rewriting `D` in `Loader.OnLoadCompleteListener<D>` as
/// text would need word boundaries in a language whose type names can contain
/// anything.
///
/// One level, from the class's own `Signature`. A grandparent's parameters
/// bound through an intermediate are not resolved -- those stay as they are and
/// are still wrong, which is why this returns a map rather than claiming to be
/// complete.
fn bindings_on_supertypes(class: &ClassFile) -> std::collections::BTreeMap<String, String> {
    let mut map = std::collections::BTreeMap::new();
    let Some(signature) = class.signature.as_deref() else { return map };
    // Skip this class's own parameters: what follows is the superclass and then
    // each interface, each possibly with type arguments.
    let (rest, _) = split_type_parameters(signature);
    let mut at = rest;
    while let Some(open) = at.find('<') {
        let Some(close) = matching_angle(&at[open..]) else { break };
        let owner = at[1..open].to_owned();
        let arguments: Vec<String> = arguments_of(&at[open + 1..open + close]);
        map.insert(owner, arguments.join(","));
        at = &at[open + close + 1..];
        // Step past the `;` that closes this supertype.
        if let Some(semi) = at.find(';') {
            at = &at[semi + 1..];
        } else {
            break;
        }
    }
    map
}

/// The index of the `>` matching the `<` at the start of `text`.
fn matching_angle(text: &str) -> Option<usize> {
    let mut depth = 0usize;
    for (at, byte) in text.bytes().enumerate() {
        match byte {
            b'<' => depth += 1,
            b'>' => {
                depth -= 1;
                if depth == 0 {
                    return Some(at);
                }
            }
            _ => {}
        }
    }
    None
}

/// The top-level type arguments inside a `<...>`, each as its own signature.
fn arguments_of(inside: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    let bytes = inside.as_bytes();
    let mut at = 0usize;
    while at < bytes.len() {
        match bytes[at] {
            b'<' => depth += 1,
            b'>' => depth = depth.saturating_sub(1),
            b';' if depth == 0 => {
                out.push(inside[start..=at].to_owned());
                start = at + 1;
            }
            _ => {}
        }
        at += 1;
    }
    if start < inside.len() {
        out.push(inside[start..].to_owned());
    }
    out
}

/// Replace a parent's type variables with what the child bound them to.
fn substitute(signature: &str, parent: &ClassFile, arguments: &str) -> String {
    let Some(declared) = parent.signature.as_deref() else { return signature.to_owned() };
    let (_, names) = split_type_parameters(declared);
    if names.is_empty() {
        return signature.to_owned();
    }
    let actual: Vec<String> = arguments_of(arguments);
    let mut out = signature.to_owned();
    for (index, name) in names.iter().enumerate() {
        let Some(replacement) = actual.get(index) else { continue };
        out = out.replace(&format!("T{name};"), replacement);
    }
    out
}

fn inherited(class: &ClassFile, resolve: &dyn Resolve) -> Vec<(ClassFile, crate::read::Member)> {
    let mut seen: Vec<(String, String)> = class
        .methods
        .iter()
        .map(|m| (m.name.clone(), m.descriptor.clone()))
        .collect();
    let mut found = Vec::new();
    for (parent, bound) in supertypes_bound(class, resolve) {
        let from_interface = parent.access & access::INTERFACE != 0;
        for method in &parent.methods {
            if !visible(method.access) || method.name.starts_with('<') || !is_api(method) {
                continue;
            }
            // **A static interface method is not inherited.** JLS 9.4.1:
            // neither a subinterface nor an implementor gets it, so
            // `Pressable.none()` is illegal Java and must be written
            // `Task.none()`. A class's statics *are* inherited --
            // `View.defaultPadding()` is legal -- which is why this turns on
            // the parent's kind rather than on the modifier alone.
            //
            // Found because emitting it produced `TS1070` on an interface. The
            // TypeScript error was the symptom; the Java rule is the reason,
            // and diverting it to a namespace would have made the declaration
            // compile while offering a call Java rejects.
            if from_interface && method.access & access::STATIC != 0 {
                continue;
            }
            let key = (method.name.clone(), method.descriptor.clone());
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            // Rebind the parent's type variables to what this class bound them
            // to, so `D onLoadInBackground()` inherited into
            // `CursorLoader extends AsyncTaskLoader<Cursor>` renders `Cursor`
            // rather than a name with nothing behind it.
            let mut method = method.clone();
            if let Some(arguments) = bound.get(&parent.binary_name) {
                method.signature =
                    method.signature.as_deref().map(|it| substitute(it, &parent, arguments));
            }
            found.push((parent.clone(), method));
        }
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
    let Some(split) = crate::descriptor::parameters(descriptor) else { return String::new() };
    let mut names = Vec::with_capacity(split.len());
    for part in split {
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
    }
    format!("${}", names.join("$"))
}

/// The binary name of a method descriptor's parameter at `index`, if it is a
/// reference type. Needed because the *rendered* type has already lost it.
fn parameter_binary(descriptor: &str, index: usize) -> Option<String> {
    let part = *crate::descriptor::parameters(descriptor)?.get(index)?;
    part.strip_prefix('L').and_then(|it| it.strip_suffix(';')).map(str::to_owned)
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
    if class.access & access::INTERFACE == 0 {
        return None;
    }
    // **Inherited abstract methods count.** `interface Pressable extends Task`
    // has one of its own and one from `Task`, so it is *not* a functional
    // interface and `javac` rejects a lambda for it. Counting only the declared
    // ones made it look like a SAM, which would have offered a closure where
    // Java accepts none.
    let inherited_abstracts = supertypes(&class, resolve);
    let mut abstracts = class
        .methods
        .iter()
        .chain(inherited_abstracts.iter().flat_map(|it| it.methods.iter()))
        .filter(|m| m.access & access::ABSTRACT != 0 && m.access & access::STATIC == 0);
    let only = abstracts.next()?.clone();
    if abstracts.next().is_some() {
        return None;
    }
    let only = &only;
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

    // **Mixed visibility across an overload set, which TypeScript cannot
    // express and Java allows.** `ViewGroup.getChildDrawingOrder(int)` is
    // public and `getChildDrawingOrder(int, int)` is protected; so are
    // `generateLayoutParams` and two arities of `LayoutInflater.onCreateView`.
    // TypeScript answers `TS2385 Overload signatures must all be public,
    // private or protected`, and the file does not compile.
    //
    // Found by pointing `bind.sh` at the real `android.jar` -- four sets in 191
    // classes of `android.view`, and **zero** in the nine-class fixture this
    // generator had been validated against until tonight. The `protected`
    // support that produced them landed hours earlier and looked clean.
    //
    // Neither uniform answer is right. Emitting them all public widens the
    // visibility of something Java keeps to the hierarchy, which is the error
    // the inherited-member fix already refused. Emitting them all protected
    // makes a legitimate public call a compile error.
    //
    // So the protected ones take a mangled name, which is the machinery already
    // here for overloads that erase alike. The name is a *surface* name: the
    // binding table row carries `getChildDrawingOrder:(II)I`, so an override
    // still emits the member Java declared. That is the same contract
    // `find$int` has had since brands were removed.
    if method.access & ACC_PROTECTED != 0
        && class.methods.iter().any(|other| {
            other.name == method.name
                && other.access & access::PUBLIC != 0
                && is_api(other)
                && other.descriptor != method.descriptor
        })
    {
        return format!("{}{}", method.name, suffix(&method.descriptor));
    }

    let twins =
        collapsed.iter().filter(|(name, other)| name == &method.name && other == &mine).count();
    if twins <= 1 {
        return method.name.clone();
    }
    let best = class
        .methods
        .iter()
        .filter(|other| {
            other.access & access::PUBLIC != 0 && other.name == method.name && key(&other.descriptor) == mine
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
/// Fields, with an interface's constants diverted to `constants`.
///
/// **A TypeScript `interface` cannot carry a `static` member** -- `TS1070
/// 'static' modifier cannot appear on a type member` -- and a Java interface's
/// fields are *implicitly* `public static final`, which is a standard idiom:
/// 10 of 109 interfaces in the sampled `android.jar` have one.
///
/// So they go in a `namespace` of the same name, which TypeScript merges with
/// the interface, and `Task.KIND` resolves exactly as it does in Java.
fn render_fields_into(
    out: &mut String,
    constants: &mut String,
    class: &ClassFile,
    table: &mut Vec<Bound>,
    constants_table: &mut Vec<Bound>,
) -> Result<(), String> {
    let is_enum_class = class.access & access::ENUM != 0;

    for field in class.fields.iter().filter(|f| visible(f.access)) {
        let Some((rendered, _)) = field
            .signature
            .as_deref()
            .and_then(|it| generic_type(it).map(|(rendered, _)| (rendered, 0)))
            .or_else(|| type_of(&field.descriptor))
        else {
            return Err(format!("{}.{}: {}", class.binary_name, field.name, field.descriptor));
        };
        let is_static = field.access & access::STATIC != 0;
        let is_final = field.access & access::FINAL != 0;
        // **Two fields are provably never null, and the default would have
        // made both `| null` for no reason.**
        //
        // A `ConstantValue` field IS its constant -- the value is in the class
        // file and the JVM resolves the read to an `ldc`, so there is no
        // execution in which it is null. And an enum's own constants are
        // created by its `<clinit>` before any of them is observable, which
        // the JLS guarantees; `access::ENUM` on both the class and the field is
        // how the class file says so.
        //
        // Without this, `Catalog.NAME` reads `string | null` for a compile-time
        // string literal, and every use of it needs a null check that can
        // never fire. That is the kind of noise that makes a generated binding
        // unpleasant enough to hand-edit.
        let provably_present = field.constant || (is_enum_class && field.access & access::ENUM != 0);
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
        if deprecated(&field.annotations) {
            into_note(out, constants, class, "    /** @deprecated */\n");
        }
        // An interface's fields cannot be members; they become the merged
        // namespace's constants instead.
        let interface = class.access & access::INTERFACE != 0;
        let into = if interface { &mut *constants } else { &mut *out };
        into.push_str(note);
        mark(
            if interface { &mut *constants_table } else { &mut *table },
            into,
            5,
            &class.binary_name,
            &field.name,
            &field.descriptor,
            if is_static { Call::StaticField } else { Call::Field },
        );
        // A namespace member is a `const`. `static readonly` is class syntax
        // and is `TS1128 Declaration or statement expected` here -- the second
        // thing wrong with an interface constant, after `static` on a member.
        let _ = writeln!(
            into,
            "    {}{}: {};",
            if interface {
                "const ".to_owned()
            } else {
                format!(
                    "{}{}",
                    if is_static { "static " } else { "" },
                    if is_final { "readonly " } else { "" }
                )
            },
            field.name,
            if provably_present { rendered.clone() } else { returns(&rendered, &field.annotations) },
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The binding table
// ---------------------------------------------------------------------------
//
// The second output `nts bind` produces, and the half that makes a foreign call
// an *instruction*. A `.d.ts` erases: it tells the checker that `canvas.drawText`
// takes a string, and says nothing about which of four `drawText` overloads the
// JVM should invoke. The table answers that, and it is keyed by **position in
// the generated file**.
//
// **Why position rather than a name.** A method name is not unique -- measured,
// not assumed: `android.graphics.Canvas` renders three same-name `drawText`
// overload signatures, because TypeScript can tell them apart, and mangles only
// the fourth, whose parameters erase to a signature already taken. Keying by
// `(class, name)` would therefore collide on exactly the overload-heavy classes
// that matter. Mangling *every* overload would make the key unique and is the
// cheaper change -- and it was rejected, because `drawText$String$float$float$Paint`
// at every call site is the DX the `$` in a generated name was already a
// complaint about.
//
// Position has a better property than uniqueness: **the checker has already done
// the overload resolution.** TypeScript picks a signature, `lower` walks to that
// declaration, and the declaration's position selects the row. Nothing upstream
// has to know what a JVM descriptor is, which is the point -- `hir` must not
// grow a second opinion about a type mapping this crate already owns.
//
// **Keyed by line, not by line and column**, and that is measured too: `lower`'s
// `location` reports a node's *end* -- five refusals in `com.example.d.ts` came
// back at columns 18, 29, 66, 44 and 33 against lines of length 17, 28, 65, 43
// and 32. A table keyed by a declaration's start column would miss every lookup,
// and the symptom would be indistinguishable from the foreign call simply still
// being refused. The column is recorded anyway, so a lookup can *assert* it
// landed on the row it meant to -- one declaration per line is what makes the
// line sufficient, and `every_bound_row_is_alone_on_its_line` is what keeps it
// true.

/// How a bound member is invoked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Call {
    /// `invokestatic` -- a `static` method, or an interface's `static`.
    Static,
    /// `invokevirtual` -- an instance method on a class.
    Virtual,
    /// `invokeinterface` -- an instance method reached through an interface.
    Interface,
    /// `invokespecial` -- a constructor.
    Special,
    /// `getfield` / `putfield`.
    Field,
    /// `getstatic` / `putstatic`.
    StaticField,
}

/// One row: a declaration's position in the generated file, and the JVM member
/// it names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bound {
    /// Byte offset just past the declaration's last character -- the value
    /// `lower`'s `location.span.end` carries for this declaration.
    ///
    /// **This is what a consumer matches on, and the line is not.** `SourceFile`
    /// carries `uri`, `digest` and `display_path` and *no text*, so the lowering
    /// cannot convert a byte offset into a line even if it wanted to. I keyed
    /// this table by line first and read the struct afterwards.
    ///
    /// `end` rather than `start` because tsgo's `pos` includes leading trivia:
    /// a declaration's `span.start` is the end of the *previous* token, which
    /// for a declaration on its own line is the previous line. `span.end` is the
    /// first offset past the `;` and is the same under either convention.
    pub end: usize,
    /// 1-based line in the assembled module file. For a person reading the
    /// table, and for the test that asserts the offset landed on the right
    /// declaration.
    pub line: usize,
    /// 1-based column of the declaration's first character. Recorded so a
    /// lookup can assert rather than trust; see the note above on why the line
    /// is what selects the row.
    pub column: usize,
    /// `owner.member:descriptor`, the shape `hir::runtime::foreign_key` builds.
    pub key: String,
    /// Which instruction this becomes.
    pub call: Call,
}

/// Record a row against the buffer it was just written into.
///
/// **The line comes from the text itself** rather than from a counter kept
/// beside it. A counter is a second derivation of the same fact and would drift
/// the first time a render path wrote two lines where the counter assumed one --
/// which is exactly what the `/** Inherited. */` prefix and the `@deprecated`
/// line both do. Counting the newlines already in the buffer cannot disagree
/// with the buffer.
fn mark(
    table: &mut Vec<Bound>,
    buf: &str,
    column: usize,
    owner: &str,
    member: &str,
    descriptor: &str,
    call: Call,
) {
    table.push(Bound {
        // Filled in by `module_of`, from the assembled text. A row's offset is
        // derived from the file it points into, so it cannot disagree with it.
        end: 0,
        line: buf.bytes().filter(|byte| *byte == b'\n').count() + 1,
        column,
        key: format!("{owner}.{member}:{descriptor}"),
        call,
    });
}

/// Move a table by the offset its text was moved by when it was merged into a
/// larger buffer. Called from the same loop that does the merging, so the two
/// cannot disagree.
fn shift(table: &mut [Bound], lines: usize, columns: usize) {
    for row in table {
        row.line += lines;
        row.column += columns;
    }
}

/// The number of lines already in a buffer, for use as a merge offset.
fn lines_in(buf: &str) -> usize {
    buf.bytes().filter(|byte| *byte == b'\n').count()
}

/// Render one class as a `declare class` body.
///
/// # Errors
///
/// Returns the member's name when a descriptor cannot be rendered, rather than
/// emitting a declaration with a hole in it. **Refuse by name, never
/// half-emit**: a `.d.ts` that silently drops a method is one a caller trusts.
pub fn declarations(class: &ClassFile) -> Result<(String, Vec<Bound>), String> {
    declarations_with(class, &Alone)
}

/// Render one class, resolving inherited members through `resolve`.
///
/// # Errors
///
/// As [`declarations`].
pub fn declarations_with(
    class: &ClassFile,
    resolve: &dyn Resolve,
) -> Result<(String, Vec<Bound>), String> {
    let mut table: Vec<Bound> = Vec::new();
    let mut constants_table: Vec<Bound> = Vec::new();
    // The package this class lives in, so its siblings render unqualified.
    let package = class
        .binary_name
        .rsplit_once('/')
        .map_or_else(String::new, |(package, _)| package.replace('/', "."));
    PACKAGE.with(|it| it.replace(package));

    let mut out = String::new();
    let name = simple_name(&class.binary_name);

    let is_interface = class.access & access::INTERFACE != 0;
    // **`final` is surfaced as prose because TypeScript cannot express it.**
    // 263 of 600 public classes in the sampled `android.jar` are final -- 44%
    // -- and extending one produces a class file the JVM rejects at load with
    // `VerifyError: Cannot inherit from final class`: a late failure naming the
    // JVM's rule, a long way from the TypeScript that caused it.
    //
    // The private-member trick was tried and does not work: a subclass simply
    // inherits the private field and `class A extends Sealed {}` typechecks
    // with no error. TypeScript has no `final` for classes at all.
    //
    // So the enforcement belongs at bind time, where the generator already
    // knows -- the same place a value-returning callback on a foreign thread is
    // refused. Until the binding lowers, this is the signal, and it is at least
    // where a reader is looking.
    let note = if class.access & access::FINAL != 0 {
        " Final: cannot be extended."
    } else {
        ""
    };
    let _ = writeln!(out, "  /** {}{note} */", class.binary_name.replace('/', "."));
    // **An interface is emitted as an interface, so it can be implemented.**
    // Without this a Java callback type is not nameable at all -- it only ever
    // appeared inlined at a parameter as a function type -- and a TypeScript
    // class could not declare that it implements one. Java accepts both a
    // lambda and an implementing object for a functional interface; the
    // TypeScript surface has to offer both for the same reason.
    // **`abstract` is enforceable where `final` was not.** TypeScript has
    // `abstract class`, so `new Drawable()` becomes a compile error instead of
    // an `InstantiationError` at run time. 26 of 491 public classes in the
    // sampled `android.jar` are abstract *and* carry a public constructor,
    // which is exactly the shape that typechecked and could not run.
    let kind = if is_interface {
        "interface"
    } else if class.access & access::ABSTRACT != 0 {
        "abstract class"
    } else {
        "class"
    };
    // **The class's own type parameters, which were never emitted.** The
    // `Signature` attribute carries `<E:Ljava/lang/Object;>...` for a generic
    // class, and it was read and dropped: every declaration came out as
    // `export interface List {` while every *reference* to it came out as
    // `java_util.List<string>`, because member signatures were surfaced and the
    // class header was not.
    //
    // Invisible for as long as the only inputs were a nine-class fixture with
    // no generic classes and a hand-written prelude whose generics I had typed
    // myself. Over the transitive closure of `android.view` it is **5,105
    // errors** of `TS2315 Type 'List' is not generic` -- the largest single
    // category once the prelude gaps stopped masking it.
    //
    // `= unknown` on each, for the reason the prelude already gave: a
    // pre-generics **raw** type reaches this with no `Signature` at all, and
    // without a default `java.util.List` is `TS2314 Generic type 'List<E>'
    // requires 1 type argument(s)` -- a hard error where the jar simply did not
    // say.
    let parameters = type_parameters(class.signature.as_deref())
        .replace('>', " = unknown>")
        .replace(", ", " = unknown, ");
    let _ = writeln!(out, "  export {kind} {name}{parameters} {{");

    let mut out_constants = String::new();
    render_fields_into(&mut out, &mut out_constants, class, &mut table, &mut constants_table)?;

    // Which methods collapse onto one TypeScript signature. Computed before
    // rendering, because the decision is about the *set*: a name is only
    // ambiguous relative to its siblings.
    // One derivation, shared with the inherited path -- see `collapsed_of`.
    let collapsed = collapsed_of(class);

    render_methods_into(
        &mut out,
        &mut out_constants,
        class,
        resolve,
        &collapsed,
        &mut table,
        &mut constants_table,
    )?;

    render_inherited(
        &mut out,
        class,
        resolve,
        &mut out_constants,
        &mut table,
        &mut constants_table,
    );

    out.push_str("  }\n");
    if !out_constants.is_empty() {
        // Declaration merging: `interface Task` and `namespace Task` are one
        // type to TypeScript, so `Task.KIND` resolves as it does in Java.
        let _ = writeln!(out, "  export namespace {name} {{");
        // The offset is taken here, in the loop that does the moving, and the
        // `  ` prefix below is the same two columns the shift adds.
        shift(&mut constants_table, lines_in(&out), 2);
        for line in out_constants.lines() {
            let _ = writeln!(out, "  {line}");
        }
        out.push_str("  }\n");
        table.append(&mut constants_table);
    }
    Ok((out, table))
}

/// Render this class's own methods, into the class body or the merged namespace.
///
/// Split out of [`declarations_with`] because that function was doing three
/// separate things and the clippy line limit is a fair proxy for it: fields,
/// methods, and what is inherited each answer a different question, and each
/// has its own reason for choosing a buffer.
fn render_methods_into(
    out: &mut String,
    out_constants: &mut String,
    class: &ClassFile,
    resolve: &dyn Resolve,
    collapsed: &[(String, String)],
    table: &mut Vec<Bound>,
    constants_table: &mut Vec<Bound>,
) -> Result<(), String> {
    let is_interface = class.access & access::INTERFACE != 0;
    for method in class.methods.iter().filter(|m| visible(m.access) && is_api(m)) {
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
    let rendered_arguments = arguments(method, &parameters, resolve);

        if method.name == "<init>" {
            if !is_interface {
                mark(
                    &mut *table,
                    out,
                    5,
                    &class.binary_name,
                    "<init>",
                    &method.descriptor,
                    Call::Special,
                );
                let _ = writeln!(out, "    constructor({rendered_arguments});");
            }
            continue;
        }

        let emitted = emitted_name(class, method, collapsed);
        if method.name == "<clinit>" {
            continue;
        }
        if deprecated(&method.annotations) {
            let target = if is_interface && method.access & access::STATIC != 0 {
                &mut *out_constants
            } else {
                &mut *out
            };
            target.push_str("    /** @deprecated */\n");
        }
        if !method.throws.is_empty() {
            let _ = writeln!(
                out,
                "    /** Throws {}. Caught at the call site and raised as an `NtsRefusal`; not \
                 catchable by a TypeScript `try` yet. */",
                method.throws.iter().map(|it| it.replace('/', ".")).collect::<Vec<_>>().join(", ")
            );
        }
        // **A static method on an interface goes to the namespace too.**
        // Java 8 allows them and TypeScript does not carry them on a type --
        // the same `TS1070` the constants gave, one member kind over, which the
        // fix for those did not cover. In a namespace it is a `function`.
        let is_static = method.access & access::STATIC != 0;
        if is_interface && is_static {
            mark(
                &mut *constants_table,
                out_constants,
                5,
                &class.binary_name,
                &method.name,
                &method.descriptor,
                Call::Static,
            );
            let _ = writeln!(
                &mut *out_constants,
                "    function {emitted}{}({rendered_arguments}): {};",
                type_parameters(method.signature.as_deref()),
                returns(&result, &method.annotations),
            );
            continue;
        }
        mark(
            &mut *table,
            out,
            5,
            &class.binary_name,
            &method.name,
            &method.descriptor,
            if is_static {
                Call::Static
            } else if is_interface {
                Call::Interface
            } else {
                Call::Virtual
            },
        );
        let _ = writeln!(
            out,
            "    {}{}{}{}({rendered_arguments}): {};",
            if method.access & ACC_PROTECTED != 0 { "protected " } else { "" },
            if is_static { "static " } else { "" },
            emitted,
            type_parameters(method.signature.as_deref()),
            returns(&result, &method.annotations),
        );
    }
    Ok(())
}

/// Push a note into whichever buffer this class's fields are going to.
fn into_note(out: &mut String, constants: &mut String, class: &ClassFile, note: &str) {
    if class.access & access::INTERFACE != 0 {
        constants.push_str(note);
    } else {
        out.push_str(note);
    }
}

/// Whether a member is reachable by a caller or by a subclass.
///
/// **`protected` was missing, and on Android it is the whole idiom.** 215
/// protected methods in the sampled `android.jar` sit on a class you can
/// extend, and `onDraw`, `onLayout` and `onSizeChanged` are all of them --
/// overriding one is the entire point of subclassing a `View`. A binding that
/// surfaces only `public` cannot express a custom view at all.
///
/// TypeScript has `protected`, so this is exact rather than prose: a subclass
/// may override it, and nothing outside the hierarchy may call it.
fn visible(access: u16) -> bool {
    access & (crate::class::access::PUBLIC | ACC_PROTECTED) != 0
}

/// `ACC_PROTECTED`. JVMS table 4.5-A.
const ACC_PROTECTED: u16 = 0x0004;

/// Whether a member carries `@Deprecated`.
///
/// **A signal this generator was reading and discarding.** 401 of 8,980 public
/// members in the sampled `android.jar` are deprecated -- 4.5% -- and a Java
/// developer sees every one of them struck through in an IDE while a TypeScript
/// caller of the generated binding saw nothing at all.
///
/// TypeScript has no modifier for it, but every editor honours `@deprecated` in
/// a doc comment, which is the same affordance reaching the same reader.
fn deprecated(annotations: &[String]) -> bool {
    annotations.iter().any(|it| it.ends_with("/Deprecated"))
}

/// Whether a member is something a Java *caller* can name.
///
/// `ACC_BRIDGE` and `ACC_SYNTHETIC` are compiler-generated. A bridge is the
/// erased twin `javac` emits beside a generic override -- `Rect implements
/// Comparable<Rect>` produces `compareTo(Rect)` and `compareTo(Object)` -- and
/// `javap -p` shows both, so a reader that trusts the class file offers both.
///
/// **`javac` does not**, which is the check that settles it:
///
/// ```text
/// r.compareTo((Object) "not a Rect")
/// error: incompatible types: Object cannot be converted to Rect
/// ```
///
/// Emitting the bridge was worse than noise. Its parameter is `unknown`, so
/// `rect.compareTo("hello")` typechecked and would have thrown
/// `ClassCastException` from inside a method the source never declared -- a
/// declaration that *widens* what the real signature narrows.
fn is_api(member: &crate::read::Member) -> bool {
    member.access & (access::BRIDGE | access::SYNTHETIC) == 0
}

/// Every supertype of a class, superclass and superinterfaces alike.
///
/// **Both, and the interfaces were missing.** `inherited` followed `super_name`
/// only, so `interface Pressable extends Task` surfaced `press()` and not
/// `run()` -- a declaration that *understates the contract*, letting a
/// TypeScript class claim `implements Pressable` while providing half of it.
/// Java would reject the same class.
///
/// `java/lang/Object` is skipped: `toString` and `wait` on every generated type
/// is noise nobody is reaching for.
fn supertypes(class: &ClassFile, resolve: &dyn Resolve) -> Vec<ClassFile> {
    supertypes_bound(class, resolve).into_iter().map(|(parent, _)| parent).collect()
}

/// Every supertype, each with the type arguments this class binds on it --
/// **through intermediates, not only directly**.
///
/// `A extends B<Cursor>` and `B<T> extends C<T>` means `C`'s `T` is `Cursor`
/// for `A`, and nothing in `A`'s own signature says so: it names `B<Cursor>`
/// and stops. The first version of this resolved one level and left 87
/// `Cannot find name` behind, all of them a parameter bound two steps up.
///
/// So the walk carries the substitution with it. Arriving at `P` from child `C`
/// with substitution `S`, `P`'s own supertype signature gives what `P` binds on
/// *its* parents in terms of `P`'s variables, and applying `S` to that rewrites
/// them in terms of the original class. One pass, and the chain composes.
fn supertypes_bound(
    class: &ClassFile,
    resolve: &dyn Resolve,
) -> Vec<(ClassFile, std::collections::BTreeMap<String, String>)> {
    let mut found: Vec<(ClassFile, std::collections::BTreeMap<String, String>)> = Vec::new();
    let direct = bindings_on_supertypes(class);
    let mut queue: Vec<(String, std::collections::BTreeMap<String, String>)> = class
        .super_name
        .iter()
        .chain(class.interfaces.iter())
        .map(|name| (name.clone(), direct.clone()))
        .collect();
    // A bound rather than a visited set: the verifier rejects a cyclic
    // hierarchy at load, so this only guards a malformed jar.
    for _ in 0..64 {
        let Some((name, inherited)) = queue.pop() else { break };
        if name == "java/lang/Object" || found.iter().any(|(it, _)| it.binary_name == name) {
            continue;
        }
        let Some(parent) = resolve.find(&name) else { continue };
        // What `parent` binds on its own supertypes, rewritten through what we
        // already know about `parent`'s variables.
        let mine = bindings_on_supertypes(&parent);
        let carried: std::collections::BTreeMap<String, String> = mine
            .iter()
            .map(|(owner, arguments)| {
                (owner.clone(), substitute(arguments, &parent, inherited.get(&name).map_or("", |it| it.as_str())))
            })
            .chain(inherited.clone())
            .collect();
        queue.extend(
            parent
                .super_name
                .iter()
                .chain(parent.interfaces.iter())
                .map(|it| (it.clone(), carried.clone())),
        );
        found.push((parent, inherited));
    }
    found
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
    for parent in supertypes(class, resolve) {
        for field in &parent.fields {
            if !visible(field.access) || seen.contains(&field.name) {
                continue;
            }
            seen.push(field.name.clone());
            found.push(field.clone());
        }
    }
    found
}

/// The rendered argument list of a method: nullability, functional interfaces
/// and varargs, all three.
///
/// **One function, because there were two and they drifted.** The declared path
/// and [`render_inherited`] each built this list, and the inherited copy was
/// the plain `a{index}: {rendered}` it started as -- so the *same method*
/// rendered two ways depending on whether you reached it through the class that
/// declares it or a subclass that inherits it:
///
/// ```text
/// setPadding(a0: Int32Array)                     inherited -- wrong
/// setPadding(...a0: number[])                    declared  -- right
/// post(a0: Widget.Task)                          inherited -- wrong
/// post(a0: Widget.Task | ((a0: number) => void)) declared  -- right
/// ```
///
/// `view.setPadding(1, 2, 3)` was a type error while `widget.setPadding(1, 2, 3)`
/// compiled. Nothing caught it because it needs a method that is *both*
/// inherited and variadic, and the fixture had none.
fn arguments(method: &crate::read::Member, parameters: &[String], resolve: &dyn Resolve) -> String {
    let variadic = method.access & access::VARARGS != 0;
    let last = parameters.len().saturating_sub(1);
    parameters
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
            // **Except on the variadic tail, where TypeScript forbids it.** A
            // rest parameter must *be* an array type, and `string[] | null` is
            // a union -- `TS2370 A rest parameter must be of an array type`.
            // `setAutofillHints(String... hints)` is annotated `@Nullable` and
            // rendered `...a0: string[] | null`, which does not compile.
            //
            // Dropping the union rather than the spread is the smaller loss:
            // `f(null)` on a Java varargs passes a null *array*, and there is
            // no rest syntax that expresses it either way. The spread is what a
            // caller actually writes.
            let ty = if annotated && is_reference(rendered) && !(variadic && index == last) {
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
        .join(", ")
}

/// Append every member this class inherits and does not redeclare.
///
/// Separate from [`declarations_with`] because that function was over a hundred
/// lines with it inline, and the two halves answer different questions: what
/// this class says, and what it gets for free.
fn render_inherited(
    out: &mut String,
    class: &ClassFile,
    resolve: &dyn Resolve,
    constants: &mut String,
    table: &mut Vec<Bound>,
    constants_table: &mut Vec<Bound>,
) {
    for field in inherited_fields(class, resolve) {
        let Some((rendered, _)) = type_of(&field.descriptor) else { continue };
        // An inherited interface constant is still static -- `Pressable.KIND`
        // is the same constant `Task.KIND` is -- so it goes to the namespace
        // too, and on a class it keeps its `static`.
        let is_interface = class.access & access::INTERFACE != 0;
        let into = if is_interface { &mut *constants } else { &mut *out };
        into.push_str("    /** Inherited. */\n");
        // The owner is **this** class, not the one that declared the field.
        // `getfield` names the static type the call site had, and the JVM walks
        // the hierarchy -- which is what `javac` emits and is why an inherited
        // member needs no separate resolution step here.
        mark(
            if is_interface { &mut *constants_table } else { &mut *table },
            into,
            5,
            &class.binary_name,
            &field.name,
            &field.descriptor,
            if field.access & access::STATIC != 0 { Call::StaticField } else { Call::Field },
        );
        let _ = writeln!(
            into,
            "    {}{}: {};",
            if is_interface {
                "const ".to_owned()
            } else {
                format!(
                    "{}{}",
                    if field.access & access::STATIC != 0 { "static " } else { "" },
                    if field.access & access::FINAL != 0 { "readonly " } else { "" }
                )
            },
            field.name,
            if field.constant { rendered.clone() } else { returns(&rendered, &field.annotations) },
        );
    }
    for (declaring, method) in inherited(class, resolve) {
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
        let rendered_arguments = arguments(&method, &parameters, resolve);
        out.push_str("    /** Inherited. */\n");
        mark(
            table,
            out,
            5,
            &class.binary_name,
            &method.name,
            &method.descriptor,
            if method.access & access::STATIC != 0 {
                Call::Static
            } else if class.access & access::INTERFACE != 0 {
                Call::Interface
            } else {
                Call::Virtual
            },
        );
        let _ = writeln!(
            out,
            "    {}{}{}{}({rendered_arguments}): {};",
            // The modifier travels with the member. Without this, `View`
            // inherited `Widget`'s protected `onDraw` as a *public* one --
            // widening the visibility of something Java keeps to the
            // hierarchy, which is the same class of error as the bridge.
            if method.access & ACC_PROTECTED != 0 { "protected " } else { "" },
            if method.access & access::STATIC != 0 { "static " } else { "" },
            emitted_name(&declaring, &method, &collapsed_of(&declaring)),
            // **The method's own type parameters, which this path dropped.**
            // `<T> T[] toArray(IntFunction<T[]>)` is declared on `Collection`
            // and inherited by `AbstractCollection`, and the inherited copy
            // rendered `toArray(a0: IntFunction<T[]>): T[]` with no `<T>` --
            // 328 of 516 `Cannot find name 'T'` over the closure.
            //
            // Fifth time the declared path and this one have disagreed: the
            // modifier, the argument list, the SAM expansion, the mangled name,
            // and now this. Four of them were caught by
            // `an_inherited_method_renders_exactly_as_its_declared_form`; this
            // one was not, because the fixture had no method with a type
            // parameter of its own until the test below added one.
            type_parameters(method.signature.as_deref()),
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
/// Emit one class and everything nested inside it, to any depth.
///
/// **Depth, which the first version did not have.** It collected every
/// `Outer$*` and flattened them all into one `export namespace Outer`, so
/// `AccessibilityService$MagnificationController$OnMagnificationChangedListener`
/// landed beside `MagnificationController` rather than inside it -- and the
/// reference `AccessibilityService.MagnificationController.OnMagnificationChangedListener`
/// then had nowhere to resolve. 247 errors over the closure, all of them
/// `Cannot access '...' because '...' is a type, but not a namespace`.
///
/// `$` separates each level, so direct children are the ones with no further
/// `$` after the prefix, and each recurses. Shared by `module_of` and
/// `namespace_of` rather than written twice: five defects in this file have
/// come from two paths rendering the same thing and drifting.
fn emit_tree(
    out: &mut String,
    bound: &mut Vec<Bound>,
    classes: &[(String, String, Vec<Bound>)],
    binary: &str,
    body: &str,
    rows: &[Bound],
    depth: usize,
) {
    let pad = "  ".repeat(depth);
    let mut mine = rows.to_vec();
    shift(&mut mine, lines_in(out), depth * 2);
    bound.append(&mut mine);
    for line in body.lines() {
        if line.is_empty() {
            out.push('\n');
        } else {
            let _ = writeln!(out, "{pad}{line}");
        }
    }

    let prefix = format!("{binary}$");
    let children: Vec<&(String, String, Vec<Bound>)> = classes
        .iter()
        .filter(|(inner, _, _)| {
            inner.starts_with(&prefix) && !inner[prefix.len()..].contains('$')
        })
        .collect();
    if children.is_empty() {
        out.push('\n');
        return;
    }
    // Declaration merging: the class above and this namespace are one name to
    // TypeScript, which is what makes `Outer.Inner` read as it does in Java.
    let _ = writeln!(out, "\n{pad}  export namespace {} {{", simple_name(binary));
    for (inner, inner_body, inner_rows) in children {
        emit_tree(out, bound, classes, inner, inner_body, inner_rows, depth + 1);
    }
    let _ = writeln!(out, "{pad}  }}");
    out.push('\n');
}

/// The same classes as a **global namespace** rather than an ambient module --
/// the prelude every other binding is written in.
///
/// `java.util.List` has to resolve without an import, because a `.d.ts` with a
/// top-level import is a *module* and then its `declare module` blocks are
/// augmentations that declare nothing. A global `declare namespace java.util`
/// is reachable from every binding with no import at all, which is why
/// `reference` leaves `java.*` fully qualified.
///
/// **This is what makes that sound.** The prelude was hand-written -- ten types
/// chosen by what the fixture happened to need -- and over the transitive
/// closure of `android.view` that cost 2,637 errors, 60% of everything wrong,
/// all of them `Namespace 'java.util' has no exported member`. A curated subset
/// cannot back a reference into a library the jar uses in full.
///
/// The class bodies are rendered by the same `declarations_with` the module
/// form uses; only the wrapper differs. Nested packages nest: `java.util` and
/// `java.util.concurrent` are separate calls and separate declarations, which
/// TypeScript merges because a namespace is open.
#[must_use]
pub fn namespace_of(package: &str, classes: &[(String, String, Vec<Bound>)]) -> (String, Vec<Bound>) {
    let mut out = String::new();
    out.push_str("// GENERATED by `nts bind`. Do not edit.\n//\n");
    out.push_str("// The prelude, as a **global namespace**: no top-level import anywhere in\n");
    out.push_str("// this file, or it becomes a module and every `java.util.List` in every\n");
    out.push_str("// binding stops resolving.\n\n");
    let _ = writeln!(out, "declare namespace {package} {{");

    // The imports this file would have needed are exactly the ones it must not
    // have. A prelude that referred out to a package it could not name would be
    // the problem it exists to solve, so anything outside `java.*` is dropped
    // on the floor by `reference` already -- and `IMPORTS` is drained here so
    // it does not leak into the next module generated in this process.
    let leaked = IMPORTS.with(|it| std::mem::take(&mut *it.borrow_mut()));
    for owner in &leaked {
        let _ = writeln!(out, "  // references {} , which a prelude cannot import", owner.replace('/', "."));
    }

    let mut bound: Vec<Bound> = Vec::new();
    for (binary, body, rows) in classes.iter().filter(|(binary, _, _)| !binary.contains('$')) {
        emit_tree(&mut out, &mut bound, classes, binary, body, rows, 0);
    }
    out.push_str("}\n");

    let mut starts = vec![0usize];
    for (at, byte) in out.bytes().enumerate() {
        if byte == b'\n' {
            starts.push(at + 1);
        }
    }
    for row in &mut bound {
        if row.line == 0 || row.line > starts.len() {
            continue;
        }
        row.end = starts.get(row.line).map_or(out.len(), |next| next - 1);
    }
    (out, bound)
}

#[must_use]
pub fn module_of(package: &str, classes: &[(String, String, Vec<Bound>)]) -> (String, Vec<Bound>) {
    let mut bound: Vec<Bound> = Vec::new();
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

    // **The imports, and they go inside the block.** A top-level import would
    // make this file a module and the block an augmentation that declares
    // nothing; an import *inside* `declare module` is module-scoped and leaves
    // the file a global script. Compiled before being believed: an ambient
    // module referring to another ambient module's types this way typechecks at
    // zero errors, and removing the line is `TS2304 Cannot find name`.
    //
    // Without these, a binding for one package emits references into twenty
    // others that resolve to nothing -- 1,103 of the 1,479 errors in
    // `android.view` were `Cannot find namespace 'android'`, and the file was
    // unusable on its own.
    let imports = IMPORTS.with(|it| std::mem::take(&mut *it.borrow_mut()));
    let mine = package.replace('.', "/");
    let wanted: Vec<&String> = imports.iter().filter(|it| **it != mine).collect();
    for owner in &wanted {
        let _ = writeln!(
            out,
            "  import * as {} from \"java:{}\";",
            alias_of(owner),
            owner.replace('/', ".")
        );
    }
    if !wanted.is_empty() {
        out.push('\n');
    }

    // Outer classes first, each followed by a namespace holding whatever nests
    // inside it -- TypeScript wants the class before the namespace that merges
    // with it.
    for (binary, body, rows) in classes.iter().filter(|(binary, _, _)| !binary.contains('$')) {
        emit_tree(&mut out, &mut bound, classes, binary, body, rows, 0);
    }

    out.push_str("}\n");

    // **The byte offsets, resolved from the assembled file itself.** Not
    // tracked through the merges beside the line numbers: re-indenting a nested
    // body adds two bytes to *every* line, so an offset carried along would
    // have to be shifted by a per-line amount, and the arithmetic is exactly
    // the kind that is wrong once and silent afterwards. Reading them back out
    // of the finished text is one derivation and cannot disagree with it.
    let mut starts = vec![0usize];
    for (at, byte) in out.bytes().enumerate() {
        if byte == b'\n' {
            starts.push(at + 1);
        }
    }
    for row in &mut bound {
        if row.line == 0 || row.line > starts.len() {
            continue;
        }
        // `starts[line]` is where the NEXT line begins, so one before it is the
        // newline that ends this one -- which is the first offset past the
        // declaration's `;`, and what `span.end` carries.
        row.end = starts.get(row.line).map_or(out.len(), |next| next - 1);
    }
    (out, bound)
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
            // `typed_array`, not a second copy of its table. The copy that was
            // here keyed on the *rendered* name -- `"int" => "Int32Array"` --
            // which was right while brands existed and became wrong the moment
            // they were removed, because every integral width renders as
            // `number` now. `[I` in a generic signature came out
            // `Float64Array`.
            //
            // Invisible until a method was both generic and took a primitive
            // array, which nothing in the fixture was: the non-generic renderer
            // got `counts(): Int32Array` right on the same descriptor.
            let rendered = typed_array(&signature[1..], &inner);
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

// ---------------------------------------------------------------------------
// Reading a table back
// ---------------------------------------------------------------------------
//
// The inverse of what `module_of` emits, and it lives here rather than in the
// consumer for the reason the class-file reader lives beside the writer: a
// format with one implementation of each direction, in one file, cannot have
// them disagree about a field order. `round_trips` asserts it instead of
// trusting it.
//
// **Why the consumer gets a `Vec` rather than a map.** Whoever loads this
// decides how to index it -- by `SourceId` once the snapshot has resolved
// paths, which is a fact this crate does not have. Returning the rows and
// stopping is the boundary: the parsing is a fact about the format, and the
// indexing is a fact about the program being compiled.

/// Parse a table emitted beside a `.d.ts`.
///
/// # Errors
///
/// The line number and what was wrong with it. A malformed table is worth
/// refusing by name: silently skipping a bad row would make a foreign call fall
/// back to "refused", which is indistinguishable from the feature not being
/// built.
pub fn read_table(text: &str) -> Result<Vec<Bound>, String> {
    let mut rows = Vec::new();
    for (at, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.splitn(5, ' ');
        let mut next = |what: &str| {
            parts.next().ok_or_else(|| format!("line {}: no {what}", at + 1)).map(str::to_owned)
        };
        let end = next("end offset")?;
        let line_no = next("line")?;
        let column = next("column")?;
        let call = next("call kind")?;
        let key = next("member key")?;
        let number = |text: &str, what: &str| {
            text.parse::<usize>().map_err(|_| format!("line {}: {what} is not a number: {text}", at + 1))
        };
        rows.push(Bound {
            end: number(&end, "the end offset")?,
            line: number(&line_no, "the line")?,
            column: number(&column, "the column")?,
            call: match call.as_str() {
                "static" => Call::Static,
                "virtual" => Call::Virtual,
                "interface" => Call::Interface,
                "special" => Call::Special,
                "field" => Call::Field,
                "staticfield" => Call::StaticField,
                other => return Err(format!("line {}: unknown call kind `{other}`", at + 1)),
            },
            key,
        });
    }
    Ok(rows)
}

/// Render rows as the table `read_table` reads.
///
/// The emitter used to live in `examples/bind.rs`, which meant the two
/// directions were in different crates and only one of them was tested.
#[must_use]
pub fn write_table(package: &str, rows: &[Bound]) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "# GENERATED by `nts bind`. The binding table for java:{package}.");
    out.push_str("# Keyed by the byte offset of a declaration's end, which is what\n");
    out.push_str("# `location.span.end` carries: the checker picks the overload, and the\n");
    out.push_str("# declaration it picked selects the row.\n");
    out.push_str("# <end-byte> <line> <column> <call> <owner.member:descriptor>\n");
    for row in rows {
        let call = match row.call {
            Call::Static => "static",
            Call::Virtual => "virtual",
            Call::Interface => "interface",
            Call::Special => "special",
            Call::Field => "field",
            Call::StaticField => "staticfield",
        };
        let _ = writeln!(out, "{} {} {} {call} {}", row.end, row.line, row.column, row.key);
    }
    out
}

/// Split a foreign key into the three parts an invoke instruction needs.
///
/// The inverse of `hir::runtime::foreign_key`, which builds
/// `owner.member:descriptor`. Lives here beside the writer for the reason
/// `read_table` does: one file, both directions, no chance of two crates
/// disagreeing about where the separators go.
///
/// **Both splits are unambiguous on a well-formed key, and I wrote a paragraph
/// claiming otherwise before testing it.** A descriptor contains no `:`, and a
/// *binary* owner separates packages with `/` rather than `.` -- so
/// `com/example/Catalog.find` holds exactly one dot and `split_once` and
/// `rsplit_once` agree. Changing this line to `split_once` and re-running the
/// tests was how I found that out: nothing failed, because nothing in the suite
/// could tell them apart.
///
/// `rsplit_once` is still the right one, for the case that *does* separate
/// them: an owner mistakenly passed in **source** form, `com.example.Catalog`.
/// Splitting from the left takes `com` as the owner and
/// `example.Catalog.find` as the member -- two plausible-looking strings and an
/// invoke against a class that does not exist. From the right the member is
/// still `find`, which is recoverable. `a_source_form_owner_keeps_its_member`
/// is that case, and it fails if this line changes.
///
/// # Errors
///
/// Returns `None` for a key that is not in that shape at all, so a caller
/// refuses rather than emitting an invoke against a name it guessed.
#[must_use]
pub fn split_key(key: &str) -> Option<(&str, &str, &str)> {
    // `:` first: a descriptor can contain `.`? No -- but it can contain `;` and
    // `/`, and taking the descriptor off first means the `.` search runs over
    // the owner and member only, which is the part with the guarantee.
    let (owner_and_member, descriptor) = key.split_once(':')?;
    let (owner, member) = owner_and_member.rsplit_once('.')?;
    if owner.is_empty() || member.is_empty() || descriptor.is_empty() {
        return None;
    }
    Some((owner, member, descriptor))
}

/// How many arguments a descriptor declares, for telling a static call from an
/// instance one.
///
/// An instance call arrives with the receiver as its first argument -- the
/// shape every runtime helper already has -- so `args == parameters + 1` says
/// instance and `args == parameters` says static. **A caller must still take
/// the kind from the table rather than from this**: the count cannot tell
/// `invokevirtual` from `invokeinterface`, and getting that wrong is an
/// `IncompatibleClassChangeError` at link time in the user's program rather
/// than a verifier error in ours. This is the cross-check, not the answer.
#[must_use]
pub fn declared_arity(descriptor: &str) -> Option<usize> {
    Some(crate::descriptor::parameters(descriptor)?.len())
}
