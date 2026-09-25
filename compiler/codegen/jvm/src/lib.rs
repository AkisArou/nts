//! The third backend: JVM class files.
//!
//! # What it is for
//!
//! RFC §6.2 lists three backends and §37 puts the JVM in phase 2. §21.3 asks
//! for generated *class files* carrying `SourceFile`, `LineNumberTable` and a
//! `SourceDebugExtension` SMAP; §35 reserves this directory and
//! `compiler/jvm-emitter` beside it. Java source appears in the RFC exactly
//! once, under `abi/generated/java`, and it is binding code rather than a
//! rendering of the program -- which is right, because `codegen/common` hands
//! every backend a flat list of blocks with jumps between them, C and JVM
//! bytecode both have `goto`, and Java does not.
//!
//! # What it does not decide
//!
//! Block order, the copies a block-parameter edge implies, and the conversions
//! at a runtime boundary are all `nts-codegen-common`'s and `hir::runtime`'s.
//! This is a printer, the same way the C backend is, and for the same reason:
//! two emitters answering one question differently is the failure that crate
//! exists to prevent.
//!
//! What *is* decided here, and is not in the other two:
//!
//! - **The JVM object model.** RFC §13: TypeScript objects are ordinary JVM
//!   references and the platform collector owns them. So no descriptors, no
//!   header, no retains -- and a function carrying `Retain` or `Release` is
//!   refused rather than emitted with them dropped, because a build that
//!   silently ignored them would have its lifetimes come from somewhere
//!   unexplained.
//! - **Where Java is not JavaScript.** `Math.min`, `max`, `floor`, `ceil`,
//!   `abs` and `sqrt` agree with the language exactly, including on `NaN` and
//!   the sign of zero, so they are called directly -- C's `fmin`/`fmax` do not
//!   and the native runtime has to provide its own. `d2i`, `Math.round` and
//!   `Double.toString` do *not* agree, and each has a helper in `runtime/jvm`.
//!
//! # This slice
//!
//! Scalars: numbers, integers and booleans, arithmetic, comparison, calls
//! between lowered functions, globals and control flow. Anything managed or
//! erased is refused **by name**. A backend that emits something for every
//! input is a backend nobody can trust the output of.

pub mod closures;
mod intcall;
mod builder;
mod fuse;
pub mod body;
pub mod hierarchy;
pub mod ops;
pub mod types;
mod unbox;
pub mod widen;

use nts_core::hir::Program;
use nts_diagnostics::Diagnostic;
use rustc_hash::FxHashMap;
use nts_jvm_emitter::class::access;
use nts_jvm_emitter::code::Code;
use nts_jvm_emitter::{Class, ClassBuilder, Kind, Pool, VType};

pub use body::{PROGRAM, RUNTIME, program_class};
pub use types::DEFAULT_PACKAGE;

/// The static a standalone program's launcher calls.
///
/// **Named here rather than spelled at the caller.** Module evaluation is what
/// an executable's entry *is* -- `write_standalone` says so for the C lane, and
/// this is the same fact one mangling away. A launcher that wrote
/// `module$init` as a literal would be a second derivation of
/// `symbols::jvm_member_name`, and the failure is a `NoSuchMethodError` at
/// launch rather than anything a build reports.
#[must_use]
pub fn module_init_method() -> String {
    nts_codegen_common::symbols::jvm_member_name(nts_core::hir::lower::MODULE_INIT)
}

/// The runtime, as a jar.
///
/// Embedded rather than built: `nts` compiles TypeScript to class files with no
/// JDK on the machine, and only *running* the result needs one. The jar is
/// checked in and `tests/runtime_jar.rs` rebuilds it and compares byte for byte
/// wherever a JDK is present -- the same rule `codegen/llvm`'s signature test
/// states for clang, and for the same reason: a generated artifact is safe to
/// check in exactly as long as something notices when it drifts.
pub const RUNTIME_JAR: &[u8] = include_bytes!("../../../../runtime/jvm/nts-runtime.jar");
pub const RUNTIME_JAR_NAME: &str = "nts-runtime.jar";

/// The runtime to ship with an emitted program.
///
/// The embedded jar, unless `NTS_JVM_RUNTIME_JAR` names a file -- which lets a
/// test swap in a deliberately broken runtime without rebuilding this crate.
/// That is what `tooling/differential/tests/jvm_sabotage.rs` uses, and the
/// override exists for it: a suite that has never been made to fail is a suite
/// nobody has evidence about, and rebuilding Rust to find out is slow enough
/// that the evidence would be gathered by hand and then decay.
///
/// A missing or unreadable file is the embedded jar rather than an error,
/// because this is a debugging aid and a typo in it should not change what a
/// production build emits.
#[must_use]
pub fn runtime_jar() -> std::borrow::Cow<'static, [u8]> {
    if let Some(bytes) = std::env::var_os("NTS_JVM_RUNTIME_JAR")
        .and_then(|path| std::fs::read(path).ok())
    {
        return std::borrow::Cow::Owned(bytes);
    }
    std::borrow::Cow::Borrowed(RUNTIME_JAR)
}

#[derive(Debug)]
pub struct Emitted {
    pub classes: Vec<Class>,
    pub diagnostics: Vec<Diagnostic>,
}

impl Emitted {
    /// Whether every function was rendered. A caller that links anyway gets a
    /// `NoSuchMethodError` naming a method, which is a worse failure than this.
    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.diagnostics.is_empty()
    }
}

/// Render a whole program as class files.
///
/// A function this cannot render is *absent* and reported, exactly as the C and
/// LLVM backends do.
#[must_use]
pub fn emit(program: &Program) -> Emitted {
    emit_into(types::DEFAULT_PACKAGE, program)
}

/// A class the program writes over a foreign one is registered with, or
/// composed by, that foreign runtime (Objective-C's, the Windows Runtime's),
/// which a JVM has none of: each refused by name, at its first method.
fn foreign_classes_refused(program: &Program) -> Vec<Diagnostic> {
    program
        .foreign_classes
        .iter()
        .filter_map(|class| {
            let at = class
                .methods
                .first()
                .and_then(|method| program.funcs.iter().find(|func| func.name == method.function))
                .or_else(|| program.funcs.first())?;
            Some(Diagnostic::error(
                "NTS4002",
                format!("an Objective-C class the program declares (`{}`), which only an Apple program's runtime registers", class.name),
                at.origin.location,
            ))
        })
        .collect()
}

/// Emit into a named package.
#[must_use]
pub fn emit_into(package: &str, program: &Program) -> Emitted {
    let mut pool = Pool::new();
    let mut diagnostics = foreign_classes_refused(program);
    // An array that grows is a wrapper rather than a bare `double[]`, chosen
    // whole-program because `hir::arrays_can_grow` is: one `push` anywhere and
    // every array in the program needs a length beside its storage.
    //
    // This used to refuse such a program outright, on the plan's reasoning that
    // the wrapper is a real cost and should be priced before it is built.
    // Record 0088 priced it: **1.4% here against 4.02x on the native lane**,
    // because the bare array was already this shape -- a `double[]` is a heap
    // object with a header, and `xs[i]` is already a reference load, a bounds
    // check against a field, and a load through it.
    //
    // The bare array stays for a program that never grows one. 1.4% is small
    // and it is not nothing, and the AWFY rows -- which never `push` -- are the
    // only comparison against hand-written Java this lane has.
    let program_class = body::program_class(package);
    let mut builder = ClassBuilder::new(&program_class, "java/lang/Object");
    builder.access = access::PUBLIC | access::SUPER | access::FINAL;
    builder.source_file = Some("nts".to_owned());

    // Module-scope storage, as static fields. Private unless the program
    // exports it, for the reason the C backend makes it `static`: a name
    // outside the program is a name something outside can collide with.
    for global in &program.globals {
        let Some(descriptor) = types::descriptor(types::Shape::packaged(program, package), &global.ty) else {
            diagnostics.push(Diagnostic::error(
                "NTS4002",
                format!(
                    "a module-scope `{}` of unrepresentable type: {}",
                    global.name,
                    types::describe(&global.ty)
                ),
                global.origin.location,
            ));
            continue;
        };
        let visibility = if global.exported { access::PUBLIC } else { access::PRIVATE };
        builder.field(
            visibility | access::STATIC,
            body::method_name(&global.name),
            descriptor,
        );
    }

    // One static instance per closure class that `ClosureStatic` names.
    //
    // A closure standing for a named function captures nothing, so there is
    // nothing to distinguish two of them -- and `finish === finish` has to be
    // true, because an event emitter removing a listener finds it by exactly
    // that comparison. One instance, immortal, and identity falls out of
    // `if_acmpeq` rather than needing a rule.
    //
    // On `nts/gen/Program` rather than as an `INSTANCE` on each closure class,
    // because which closure types are used as values is a fact about the
    // *program* -- a scan of its operations -- and `object_class` sees one
    // layout at a time. `LambdaMetafactory` is wrong here for a reason no
    // API level reaches: it does not promise one instance. The floor is 29 and
    // would run an `invoke-custom` happily; identity is what rules it out.
    let singletons = closure_singletons(package, program);
    for (field, class) in &singletons {
        builder.field(access::PRIVATE | access::STATIC | access::FINAL, field.clone(), format!("L{class};"));
    }
    let erased = erased_closures(package, program);
    for (field, _) in &erased {
        builder.field(
            access::PRIVATE | access::STATIC | access::FINAL,
            field.clone(),
            types::VALUE_DESCRIPTOR.to_owned(),
        );
    }

    if let Some(body) = class_initializer(package, program, &singletons, &erased, &mut pool) {
        builder.method(access::STATIC, "<clinit>", "()V", Some(body));
    }
    if let Err(error) = builder.default_constructor(&program_origin(program), &mut pool) {
        diagnostics.push(Diagnostic::error(
            "NTS4003",
            format!("the generated constructor could not be written: {error}"),
            program_origin(program).location,
        ));
    }

    // One decision for the whole program: a field and the values that flow

    // through it are widened together or not at all. See `widen`.

    let plan = widen::plan(package, program);

    for func in &program.funcs {
        // An abstract declaration is carried in `program.funcs` so that a call
        // through the slot can take its descriptor from somewhere, and that is
        // the whole of what it is for: nothing calls it, because an abstract
        // class is never instantiated and every reachable receiver is a
        // subclass whose override filled the slot. So there is no body to
        // emit. `object_class` gives it `ACC_ABSTRACT` with no `Code` instead.
        //
        // The flag is what makes this readable rather than inferred. The shape
        // is otherwise "one block, `Unreachable`, no operations beyond
        // `Param`" -- which is also exactly what a function that legitimately
        // cannot return looks like, and emitting nothing for one of those
        // would be a linkage error at the call site rather than dead bytes.
        if func.abstract_declaration {
            continue;
        }
        match render(package, program, func, &plan, &mut pool) {
            Ok((name, signature, rendered)) => {
                // **Synthetic exactly when an instance method replaces it.**
                //
                // `Session$bump` is not something a caller should type: `$` is
                // the JVM's own mark for a generated name, and `ACC_SYNTHETIC`
                // is what tells a debugger or decompiler to hide one --
                // `class.rs` carries it with that comment.
                //
                // Measured before relying on it, and the measurement set the
                // order: `javac` does not merely *hide* a synthetic member, it
                // **refuses to reference** one. So this is safe only because
                // `member_forwarders` gives Java `s.bump()` instead. A free
                // function like `greet` has no forwarder and stays plain
                // public, because `Program.greet(...)` IS its API.
                let synthetic = if method_of(program, func).is_some() {
                    access::SYNTHETIC
                } else {
                    0
                };
                let access = access::PUBLIC | access::STATIC | synthetic;
                publish(package, &mut builder, program, func, access, &name, &signature, rendered);
            }
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

    // Which bound interfaces each closure is handed to; see
    // `closure_interfaces`. Computed once rather than per layout, because it
    // is a walk of every operation in the program.
    let (handed_to, mut classes) = (closure_interfaces(program), Vec::new());
    for layout in &program.layouts {
        // **A bound class is in somebody's jar and we must not write one.**
        // Emitting `com/conv/Conv.class` beside the real one puts a stub with
        // nothing but a default constructor on the classpath, and whichever
        // entry comes first wins: with the emitted directory ahead of the jar
        // -- the order a user would naturally write -- every call into the
        // bound class becomes `NoSuchMethodError` at runtime.
        //
        // Loud rather than silent, so it is not the worst kind of defect. It
        // is still a class this compiler had no business writing.
        if nts_core::hir::runtime::is_foreign_layout_name(&layout.name) {
            continue;
        }
        match object_class(package, program, layout, &plan, &handed_to) {
            Ok(Some(class)) => classes.push(class),
            Ok(None) => {}
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
        // One empty subclass per class sharing this layout; see
        // `hierarchy::identities`. The fields stay on the layout's own class,
        // so an object is not a byte larger and a parameter declared as either
        // class still takes the base -- only `new` and `instanceof` name these.
        for class in hierarchy::identities(program, layout) {
            match identity_class(package, program, layout, class) {
                Ok(emitted) => classes.push(emitted),
                Err(diagnostic) => diagnostics.push(diagnostic),
            }
        }
    }

    // **Lambda overloads, last**, because they add methods to the program class
    // and read every exported signature to decide which. Doing it inside the
    // loop above would ask the same question once per function.
    let (adapters, complaints) = lambda_overloads(package, program, &mut builder, &mut pool, &program_origin(program));
    classes.extend(adapters);
    diagnostics.extend(complaints);

    match builder.build(pool) {
        Ok(class) => {
            classes.push(class);
            Emitted { classes, diagnostics }
        }
        Err(error) => {
            diagnostics.push(Diagnostic::error(
                "NTS4004",
                format!("the program class could not be written: {error}"),
                program_origin(program).location,
            ));
            Emitted { classes: Vec::new(), diagnostics }
        }
    }
}

/// One class per layout: what it extends, the fields it declares, the
/// constructor `new` needs, and one forwarder per dispatch slot.
///
/// # `readonly` is not `ACC_FINAL` here
///
/// A TypeScript constructor is an ordinary method called after `new`, and since
/// JDK 9 a `putfield` to a final field outside its declaring `<init>` throws
/// `IllegalAccessError`. Inlining the constructor body into `<init>` would buy
/// the flag and cost the verifier's `uninitializedThis` state; it is a later
/// step and only worth taking if `benches/cases/objects` says the JIT cares.
/// The fields one class adds, which is not the fields its objects have.
///
/// A base's fields are a prefix of the derived's, so redeclaring them here
/// would give the object two of each and leave `getfield` reading whichever the
/// descriptor named.
fn declare_fields(
    package: &str,
    program: &Program,
    layout: &nts_core::hir::Layout,
    plan: &widen::Plan,
    builder: &mut ClassBuilder,
    interface: bool,
    origin: &nts_semantic_schema::Origin,
) -> Result<(), Diagnostic> {
    // Two properties that mangle to one field name.
    //
    // `jvm_member_name` maps everything DEX forbids to `$`, which is not
    // injective: `class C { "a.b": number; "a$b": number }` declares two
    // properties and produces two `public int a$b;` in one class file. The JVM
    // refuses that at load -- `ClassFormatError: Duplicate field name` -- so
    // the program is not miscompiled today so much as unloadable, and where
    // the descriptors happen to differ it is worse, because then it loads and
    // the two properties are told apart by their *types*, which is a rule
    // nobody can hold in their head.
    //
    // Refused by name. The injective mangling that would accept it -- escape
    // `$` as `$$`, forbidden characters as `$` plus a letter -- costs every
    // generated name its readability (`module#init` becomes `module$hinit`,
    // not `module$init`), and this shape has never occurred outside the test
    // that found it. If a real program hits this, that is the fix, and it is a
    // change to `symbols.rs` rather than to this refusal.
    let mut spelled: FxHashMap<String, String> = FxHashMap::default();
    for field in hierarchy::declared(program, layout) {
        if let Some(other) = spelled.insert(body::method_name(&field.name), field.name.clone()) {
            return Err(Diagnostic::error(
                "NTS4013",
                format!(
                    "`{}` declares both `{}` and `{}`, which are different properties and \
                     become the same JVM field `{}` -- this backend will not emit a class \
                     the JVM cannot load",
                    layout.name,
                    other,
                    field.name,
                    body::method_name(&field.name)
                ),
                origin.location,
            ));
        }
        if interface {
            // A JVM interface has no instance fields, so there is nowhere to
            // put this. Refused by name rather than dropped: an interface whose
            // properties silently vanished would read every one of them as the
            // zero of its type, which is a wrong answer rather than an error.
            return Err(Diagnostic::error(
                "NTS4001",
                format!(
                    "`{}` is implemented by another type and so is emitted as a JVM interface, \
                     but it declares the property `{}` -- an interface has no instance fields \
                     and this backend will not drop one",
                    layout.name, field.name
                ),
                origin.location,
            ));
        }
        let Some(descriptor) = types::field_descriptor(types::Shape::packaged(program, package), &field.ty)
        else {
            return Err(Diagnostic::error(
                "NTS4006",
                format!(
                    "`{}.{}` has no representation: {}",
                    layout.name,
                    field.name,
                    types::describe(&field.ty)
                ),
                origin.location,
            ));
        };
        // A field this backend holds as a `double`; see `widen`. The
        // declaration and every access ask the same plan with the same key, so
        // they cannot disagree about the descriptor.
        let descriptor = if plan.field(&types::class_name(package, layout), &field.name) {
            types::descriptor(types::Shape::packaged(program, package), &nts_core::hir::HirType::Float { bits: 64 })
                .unwrap_or(descriptor)
        } else {
            descriptor
        };
        builder.field(access::PACKAGE, body::method_name(&field.name), descriptor);
    }
    Ok(())
}

/// The optional-property presence word, where some program point asks about one
/// of this hierarchy's classes.
///
/// On the root only: a receiver may be typed as any class in the chain, and one
/// field at the root answers for all of them. See `hierarchy::holds_presence`.
///
/// **Refused rather than shadowed if a declared property mangles to the same
/// name.** `declare_fields` makes that check for two *declared* properties and
/// cannot see this one, because it is not in the layout -- so a class with a
/// property spelled to collide would get two `$presence` fields and a
/// `ClassFormatError` at load. That is the failure NTS4013 exists to prevent,
/// arriving from the one direction that check does not cover.
fn declare_presence(
    package: &str,
    program: &Program,
    layout: &nts_core::hir::Layout,
    interface: bool,
    builder: &mut ClassBuilder,
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
) -> Result<(), Diagnostic> {
    if interface || !hierarchy::holds_presence(package, program, layout) {
        return Ok(());
    }
    if let Some(clash) = hierarchy::declared(program, layout)
        .iter()
        .find(|field| body::method_name(&field.name) == types::PRESENCE)
    {
        return Err(Diagnostic::error(
            "NTS4013",
            format!(
                "`{}` declares `{}`, which becomes the JVM field `{}` -- the name this \
                 backend gives an object's optional-property presence bits",
                layout.name, clash.name, types::PRESENCE
            ),
            origin.location,
        ));
    }
    builder.field(access::PACKAGE, types::PRESENCE.to_owned(), "I".to_owned());

    // And the same bits where `instanceof` can reach them, for the one helper
    // whose receiver has no declared type to name. Five bytes and a method
    // entry on a root that already carries the field.
    builder.interfaces.push(types::PRESENCE_INTERFACE.to_owned());
    let mut code = Code::new(vec![VType::Object(types::class_name(package, layout))], 1);
    code.load(origin, Kind::Ref, 0);
    code.get_field(origin, pool, &types::class_name(package, layout), types::PRESENCE, "I");
    code.ret(origin, Some(Kind::Int));
    let rendered = code.finish(pool).map_err(|error| {
        Diagnostic::error(
            "NTS4008",
            format!("the presence reader for `{}` could not be written: {error}", layout.name),
            origin.location,
        )
    })?;
    builder.method(access::PUBLIC, types::PRESENCE_MEMBER, "()I", Some(rendered));
    Ok(())
}

/// The empty subclass that gives one class its own identity.
///
/// It declares nothing: the layout's class holds every field, and this exists
/// so that `instanceof` has something to distinguish. `final`, because nothing
/// extends a class token, and the JVM resolves a superclass field statically so
/// reaching `x` through it costs what reaching it through the base costs.
fn identity_class(
    package: &str,
    program: &Program,
    layout: &nts_core::hir::Layout,
    class: &nts_core::hir::ClassIdentity,
) -> Result<Class, Diagnostic> {
    let mut pool = Pool::new();
    let base = types::class_name(package, layout);
    let mut builder = ClassBuilder::new(types::identity_class_name(package, layout, class), base);
    builder.access = access::PUBLIC | access::SUPER | access::FINAL;
    builder.source_file = Some("nts".to_owned());
    let origin = program_origin(program);
    builder.default_constructor(&origin, &mut pool).map_err(|error| {
        Diagnostic::error(
            "NTS4003",
            format!("the constructor for `{}` could not be written: {error}", class.name),
            origin.location,
        )
    })?;
    builder.build(pool).map_err(|error| {
        Diagnostic::error(
            "NTS4004",
            format!("the class for `{}` could not be written: {error}", class.name),
            origin.location,
        )
    })
}

/// Which **bound Java interfaces** a closure is handed to.
///
/// A closure class is emitted once and which interface it should implement
/// depends on where it is passed, so this is the one question in this backend
/// that has to be asked of the whole program rather than of a layout.
///
/// **One hop backwards is enough.** `setOnTouch(View.OnTouch | ((x, y) =>
/// boolean))` is a union, so the argument at the call is an `Erase` of the
/// closure rather than the closure -- and `OpKind::Erase` carries its operand,
/// so the closure is one step away. Without this the value reached Java as an
/// `NtsValue` and the first dispatch was `IncompatibleClassChangeError`; with
/// the unboxing but without the interface it was `ClassCastException` naming
/// `nts/gen/Closure0`, which is the same gap said more precisely.
fn closure_interfaces(program: &Program) -> FxHashMap<nts_semantic_schema::TypeId, Vec<String>> {
    let mut found: FxHashMap<nts_semantic_schema::TypeId, Vec<String>> = FxHashMap::default();
    let interfaces: std::collections::BTreeSet<&str> = program
        .foreign
        .iter()
        .filter(|(_, row)| row.kind == nts_core::hir::runtime::ForeignKind::Interface)
        .filter_map(|(key, _)| key.split_once(':')?.0.rsplit_once('.').map(|(owner, _)| owner))
        .collect();
    for func in &program.funcs {
        for op in &func.values {
            let nts_core::hir::OpKind::Call { callee: nts_core::hir::Callee::External(key), args, .. } = &op.kind
            else {
                continue;
            };
            let Some(row) = program.foreign.get(key.as_str()) else { continue };
            let Some((_, descriptor)) = key.split_once(':') else { continue };
            let Some(parameters) = nts_jvm_emitter::descriptor::parameters(descriptor) else {
                continue;
            };
            // A bound instance call carries its receiver in `args[0]` and the
            // descriptor does not mention it; see `push_foreign_arguments`.
            let rest = if row.kind == nts_core::hir::runtime::ForeignKind::Static {
                args.as_slice()
            } else {
                args.get(1..).unwrap_or(&[])
            };
            for (argument, want) in rest.iter().zip(parameters) {
                let Some(name) = want.strip_prefix('L').and_then(|it| it.strip_suffix(';')) else {
                    continue;
                };
                if !interfaces.contains(name) {
                    continue;
                }
                let mut value = *argument;
                if let Some(op) = func.values.get(value.0 as usize)
                    && let nts_core::hir::OpKind::Erase { value: inner, .. } = op.kind
                {
                    value = inner;
                }
                let Some(held) = func.values.get(value.0 as usize) else { continue };
                if let nts_core::hir::HirType::Managed(nts_core::hir::ManagedType::Object(id)) =
                    held.ty
                {
                    let seen = found.entry(id).or_default();
                    if !seen.iter().any(|it| it == name) {
                        seen.push(name.to_owned());
                    }
                }
            }
        }
    }
    found
}

fn object_class(
    package: &str,
    program: &Program,
    layout: &nts_core::hir::Layout,
    plan: &widen::Plan,
    handed_to: &FxHashMap<nts_semantic_schema::TypeId, Vec<String>>,
) -> Result<Option<Class>, Diagnostic> {
    let origin = program_origin(program);
    let mut pool = Pool::new();
    let name = types::class_name(package, layout);
    let super_name = program
        .base_layout(layout)
        .and_then(|at| program.layouts.get(at))
        .map_or_else(|| "java/lang/Object".to_owned(), |l| types::class_name(package, l));
    // A dispatch root the program declares -- something another layout says it
    // implements -- is emitted as a JVM interface, not as a class. Its methods
    // are already `ACC_ABSTRACT` by way of `Func::abstract_declaration`; what
    // changes here is the class itself, and three things follow from it: no
    // `SUPER` bit, no constructor, and no fields.
    let interface = hierarchy::is_interface(program, layout);
    let mut builder = ClassBuilder::new(name, super_name);
    if interface {
        // `ACC_INTERFACE` implies `ACC_ABSTRACT` and forbids `ACC_FINAL` and
        // `ACC_SUPER`; JVMS 4.1 rejects the combinations at load rather than at
        // first use, so getting this wrong is a `ClassFormatError` on every
        // program rather than a subtle one.
        builder.access = access::PUBLIC | access::INTERFACE | access::ABSTRACT;
    } else {
        // `final` only where nothing extends it. A base class marked final is
        // rejected at load time, not at emit time, so this is the one place the
        // hierarchy has to be consulted for something other than a name.
        builder.access = if hierarchy::extended(program, layout) {
            access::PUBLIC | access::SUPER
        } else {
            access::PUBLIC | access::SUPER | access::FINAL
        };
        // What this layout declares it implements. Pushed before the runtime
        // interfaces below so the program's own edges come first and the order
        // is the IR's, which is sorted.
        for name in hierarchy::implemented(package, program, layout) {
            builder.interfaces.push(name);
        }
    }
    builder.source_file = Some("nts".to_owned());
    declare_fields(package, program, layout, plan, &mut builder, interface, &origin)?;
    declare_presence(package, program, layout, interface, &mut builder, &mut pool, &origin)?;
    // A frame a `Suspend` names implements `NtsResumable`, with `resume()`
    // forwarding to the static body -- the same shape as a dispatch slot's
    // forwarder, and the reason promises are not blocked behind the closure
    // base question: this relationship is created here rather than recovered
    // from the IR.
    // A layout whose dispatched `call` has a shape the ABI names is something
    // the runtime can call without knowing its class, which is what every
    // callback into generated code has to be. Decided from the *descriptor*
    // rather than from a list of class names, so it stays true of whatever the
    // lowering names a closure next.
    //
    // **The member name is part of the key, and used not to be.** The old rule
    // asked only whether some dispatched method was `()V`, so a class with an
    // ordinary `reset(): void` was told it implemented `NtsCallback` and did
    // not -- an `AbstractMethodError` waiting for the first caller to reach it
    // through the interface, and one the verifier does not catch because
    // interface implementation is checked at the call, not at load.
    // A closure handed to a bound Java interface implements it; the bridge
    // below carries the jar's own widths.
    for id in &layout.types {
        for interface in handed_to.get(id).into_iter().flatten() {
            if !builder.interfaces.iter().any(|it| it == interface) {
                builder.interfaces.push(interface.clone());
            }
        }
    }
    for interface in callback_interfaces(package, program, layout) {
        builder.interfaces.push(interface.to_owned());
    }
    // A tuple is laid out as a struct -- `[number, string]` has fields of
    // different types and cannot be a JVM array -- and the language calls it an
    // Array. `nts_is_array` reads this with `instanceof`, because nothing on
    // this lane carries a descriptor kind at run time.
    if nts_core::hir::is_tuple_layout_name(&layout.name) {
        builder.interfaces.push(types::TUPLE.to_owned());
    }
    // A class whose dispatch table names a no-argument `toString` returning a
    // string. `String(v)` on an erased object needs to tell that from a class
    // that merely inherits `java.lang.Object`'s, and no *class* can answer it --
    // they all have one. See `types::STRINGABLE`.
    //
    // **The member name is part of the key, and the descriptor with it.** Asking
    // only "is there a slot returning a string" would mark a class with an
    // unrelated `label(): string`, whose `toString` is then Object's and whose
    // `String()` answers `nts.gen.Thing@1b6d3586`. That is the mistake
    // `callback_interfaces` made with `call` and fixed, one method name over.
    if declares_own_to_string(package, program, layout) {
        builder.interfaces.push(types::STRINGABLE.to_owned());
    }
    if let Some(resume) = resumes(package, program, layout) {
        builder.interfaces.push(types::RESUMABLE.to_owned());
        let origin = program_origin(program);
        let mut code = Code::new(vec![VType::Object(types::class_name(package, layout))], 1);
        code.load(&origin, Kind::Ref, 0);
        code.invoke_static(
            &origin,
            &mut pool,
            &body::program_class(package),
            &body::method_name(&resume),
            &format!("(L{};)V", types::class_name(package, layout)),
        );
        code.ret(&origin, None);
        let rendered = code.finish(&pool).map_err(|error| {
            Diagnostic::error(
                "NTS4008",
                format!("the resume forwarder for `{}` could not be written: {error}", layout.name),
                program_origin(program).location,
            )
        })?;
        builder.method(access::PUBLIC, "resume", "()V", Some(rendered));
    }

    // **Dispatch first, and the order is load-bearing rather than tidy.**
    // Both of these declare instance methods on this class, and for a method
    // that is *both* a member of the layout and an entry in its dispatch table
    // -- which every override is -- they declare the same name and descriptor.
    // `dispatch_forwarders` is the one that must win: it names the method after
    // the layout that *declared* the slot rather than the one implementing it,
    // and it emits the covariant bridge. `member_forwarders` then skips what is
    // already there.
    //
    // Asking the builder what it already holds, rather than re-deriving which
    // functions occupy a slot, because two derivations of one fact disagree
    // eventually and the disagreement here is a class that does not load.
    dispatch_forwarders(package, program, layout, &mut builder, &mut pool)?;
    member_forwarders(package, program, layout, &mut builder, &mut pool)?;
    // A bound interface declares its own widths; see `foreign_bridges`.
    foreign_bridges(package, program, layout, handed_to, &mut pool, &mut builder, &origin)?;
    // A field the JVM zeroes to `null` where the language's zero is
    // `undefined`.
    //
    // The C lane gets this for free: an `NtsValue` is a struct, `UNDEFINED` is
    // tag 0, and zeroed storage *is* an undefined value. A JVM reference field
    // zeroes to `null`, which is a different value -- and `null` is a legal
    // TypeScript value in its own right, so it cannot be read as the absence.
    //
    // The symptom was a `NullPointerException` reading `NtsValue.ref` out of an
    // optional field that had never been assigned: `benches/cases/optional-chain`
    // builds `{}` and calls `h.fn?.(1)`, and half its iterations reach a field
    // nothing ever wrote. `Func::initializes_receiver` promises the fields are
    // zeroed and this is what keeping that promise costs on this platform.
    let erased: Vec<_> = hierarchy::declared(program, layout)
        .iter()
        .filter(|field| matches!(field.ty, nts_core::hir::HirType::Erased))
        .map(|field| body::method_name(&field.name))
        .collect();
    let initial: Vec<nts_jvm_emitter::FieldFromStatic<'_>> = erased
        .iter()
        .map(|field| nts_jvm_emitter::FieldFromStatic {
            field,
            from_class: types::VALUE,
            from_field: "UNDEFINED_VALUE",
            descriptor: types::VALUE_DESCRIPTOR,
        })
        .collect();
    // An interface may declare `<clinit>` and nothing else; an `<init>` on one
    // is a `ClassFormatError`. Nothing constructs an interface either -- a
    // dispatch root is never the class `ObjectNew` names.
    if !interface {
        builder.constructor(&origin, &mut pool, &initial).map_err(|error| {
            Diagnostic::error(
                "NTS4003",
                format!("`{}` could not be given a constructor: {error}", layout.name),
                origin.location,
            )
        })?;
    }
    builder
        .build(pool)
        .map(Some)
        .map_err(|error| {
            Diagnostic::error(
                "NTS4004",
                format!("`{}` could not be written: {error}", layout.name),
                origin.location,
            )
        })
}


fn render(
    package: &str,
    program: &Program,
    func: &nts_core::hir::Func,
    plan: &widen::Plan,
    pool: &mut Pool,
) -> Result<(String, String, nts_jvm_emitter::Body), Diagnostic> {
    let emitter = body::Emitter::new(package, program, func, plan)?;
    let signature = body::signature(package, program, func)
        .ok_or_else(|| body::refuse(func, "a signature with no representation"))?;
    let rendered = emitter.emit(pool)?;
    Ok((body::method_name(&func.name), signature, rendered))
}

/// One instance method per dispatch slot, forwarding to the static body.
///
/// The bodies stay static on `nts/gen/Program`, and each class gets a four-byte
/// `aload_0; invokestatic; return` per slot it implements. That is deliberate
/// and it is the cheaper half of a fork:
///
/// - A direct call stays `invokestatic`, which is what most calls are. Moving
///   the bodies onto the classes would make every call to a method virtual,
///   and C2 would have to devirtualise back to where it started.
/// - Nothing about how a body is emitted changes -- the signature, the slots
///   and the prologue are the same whether or not a method is dispatched.
/// - A forwarder is far below `FreqInlineSize`, so C2 inlines it away and the
///   frame does not exist at run time.
///
/// The overriding is done by the forwarders' *names and descriptors*, which is
/// why `slot` is unused on this backend: the JVM has its own vtable, and naming
/// the method lets the JIT devirtualise through class-hierarchy analysis. It
/// also means an override and the thing it overrides must agree on the
/// descriptor exactly -- if they do not, the JVM sees two unrelated methods,
/// both present, and dispatch quietly picks the wrong one with no verifier
/// error. `signatures::specialize` pinning anything a dispatch table names and
/// `unerase::narrow_returns` excluding `dispatched` are what make them agree
/// today, so the agreement is **checked here** rather than assumed.
/// The `nts.rt` interfaces this layout implements, from the shape of its
/// dispatched `call`.
///
/// Deduplicated, because two slots can name one function -- a class inheriting
/// a callback and redeclaring it would otherwise list the interface twice, and
/// a duplicate entry in `interfaces` is a class file the verifier rejects.
/// Whether this layout's dispatch table names a `toString(): string` of its own.
///
/// The descriptor has to be exactly `()Ljava/lang/String;`, because that is the
/// one that overrides `java.lang.Object.toString` and so the one `ref.toString()`
/// reaches. A `toString(radix)` is a different method to the JVM and marking its
/// class would promise a call that resolves elsewhere.
fn declares_own_to_string(package: &str, program: &Program, layout: &nts_core::hir::Layout) -> bool {
    layout.methods.iter().flatten().any(|name| {
        hierarchy::member_name(name) == "toString"
            && program
                .funcs
                .iter()
                .find(|func| &func.name == name)
                .and_then(|func| instance_descriptor(package, program, func))
                .is_some_and(|descriptor| descriptor == "()Ljava/lang/String;")
    })
}

fn callback_interfaces(
    package: &str,
    program: &Program,
    layout: &nts_core::hir::Layout,
) -> Vec<&'static str> {
    let mut found: Vec<&'static str> = Vec::new();
    for name in layout.methods.iter().flatten() {
        if hierarchy::member_name(name) != "call" {
            continue;
        }
        let Some(interface) = program
            .funcs
            .iter()
            .find(|func| &func.name == name)
            .and_then(|func| instance_descriptor(package, program, func))
            .and_then(|descriptor| types::callback_interface(&descriptor))
        else {
            continue;
        };
        if !found.contains(&interface) {
            found.push(interface);
        }
    }
    found
}

/// A method with a **bound interface's own descriptor**, delegating to ours.
///
/// A TypeScript class may `implements View.OnTouch`, and the emitted class says
/// so -- but the interface declares `onTouch(II)Z` and every TypeScript
/// `number` is a `double`, so ours is `onTouch(DD)Z`. Those are different
/// methods to the JVM, so the class claimed an interface it did not implement
/// and the first dispatch through it was `IncompatibleClassChangeError`, at run
/// time, in the caller's Java.
///
/// **Not the byte-identical bridge [`bridge_for`] emits.** That one exists for
/// descriptors differing only in reference types, where the same code verifies
/// under both. A width is not like that: the body would load an `int` where it
/// expects a `double`. This converts each parameter, calls ours, and converts
/// the result back.
/// The body of a bridge: convert each parameter, call ours, convert the result.
///
/// Split out of [`foreign_bridges`] because "what does this method do" and
/// "which methods does this class need" are two questions, and the first is
/// where every width decision lives.
#[allow(clippy::too_many_arguments)]
fn bridge_body(
    package: &str,
    program: &Program,
    layout: &nts_core::hir::Layout,
    ours: &nts_core::hir::Func,
    want: &str,
    full: &str,
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
) -> Result<nts_jvm_emitter::Body, Diagnostic> {
    let Some(parameters) = nts_jvm_emitter::descriptor::parameters(want) else {
        return Err(Diagnostic::error(
            "NTS4008",
            format!("a bridge against the unreadable descriptor `{want}`"),
            origin.location,
        ));
    };
    let mut locals = vec![VType::Object(types::class_name(package, layout))];
    for spelled in &parameters {
        locals.push(match *spelled {
            "I" | "S" | "B" | "C" | "Z" => VType::Integer,
            "J" => VType::Long,
            "F" => VType::Float,
            "D" => VType::Double,
            other => VType::Object(other.trim_matches(|c| c == 'L' || c == ';').to_owned()),
        });
    }
    let slots: u16 = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals, slots);

    // **Ask which lane this is, before touching anything.**
    //
    // A Java framework may call a bound interface from a thread we do not own --
    // `Loader.load` in `examples/interop/android-shape` is exactly that shape --
    // and everything in this runtime except the inbox is confined to one lane.
    // Running a TypeScript body on a framework thread mutates that lane's heap
    // from outside it, with no happens-before edge. `NtsInbox`'s own header is
    // blunt about the consequence: a reader "may observe stale bytes
    // indefinitely with no race in the JavaScript sense. On x86 it will appear
    // to work. Android is ARM."
    //
    // Until 2026-09-15 the bridge went straight to the body and the crossing was
    // silent. It is not that the refusal had to be written -- `NtsEnv.current`
    // has always thrown `the default environment belongs to another lane` for a
    // second lane, by name, with the remedy in the message. **Nothing asked it.**
    // The body reached the table directly and never called into `NtsEnv` at all,
    // so the check that existed was never on the path that needed it.
    //
    // The result is discarded: this is a question, not a value. One `ThreadLocal`
    // get per callback on the lane, which is the UI path's whole cost, against a
    // corruption that only appears on the platform this lane is for.
    //
    // **When the shape can be delivered, ask the runtime instead.** It answers
    // `false` for "you are already on this closure's lane, run the body" and
    // `true` for "posted, you are done" -- and throws for anything else, which
    // is the thread that owns no lane and the inbox that is full. One question,
    // one boolean, and every piece of policy in a file that can be read.
    if let Some(delivery) = types::deliverable(want) {
        let direct = code.label();
        code.load(origin, Kind::Ref, 0);
        match delivery.method {
            "()V" => {}
            "([BDD)V" | "(Ljava/lang/String;)V" => code.load(origin, Kind::Ref, 1),
            _ => code.load(origin, Kind::Double, 1),
        }
        code.invoke_static(origin, pool, types::FOREIGN, delivery.deliver, delivery.delivers);
        code.branch_zero(origin, nts_jvm_emitter::Compare::Eq, direct);
        code.ret(origin, None);
        code.bind(direct);
    } else {
        code.invoke_static(origin, pool, types::ENV, "current", "()Lnts/rt/NtsEnv;");
        code.pop(origin, 1);
    }

    code.load(origin, Kind::Ref, 0);
    let mut at: u16 = 1;
    for (spelled, param) in parameters.iter().zip(ours.params.iter().skip(1)) {
        let Some(kind) = types::kind(&param.ty) else { continue };
        match *spelled {
            "I" | "S" | "B" | "C" | "Z" => {
                code.load(origin, Kind::Int, at);
                if kind == Kind::Double {
                    code.convert(origin, nts_jvm_emitter::insn::I2D, Kind::Int, Kind::Double);
                }
                at += 1;
            }
            "D" => {
                code.load(origin, Kind::Double, at);
                at += 2;
            }
            // A Java array meeting a typed array. The same copy a
            // bound method's *return* takes -- `NtsViewU8.from` and
            // its siblings -- because it is the same boundary read the
            // other way: a view is a window onto a buffer and a Java
            // array has none.
            spelled if spelled.starts_with('[') => {
                code.load(origin, Kind::Ref, at);
                at += 1;
                if let Some(want) = types::descriptor(types::Shape::packaged(program, package), &param.ty)
                    && let Some(view) =
                        want.strip_prefix('L').and_then(|it| it.strip_suffix(';'))
                    && view.starts_with("nts/rt/NtsView")
                {
                    code.invoke_static(
                        origin,
                        pool,
                        view,
                        "from",
                        &format!("({spelled}){want}"),
                    );
                }
            }
            _ => {
                code.load(origin, kind, at);
                at += kind.words();
            }
        }
    }
    code.invoke_static(origin, pool, &body::program_class(package), &body::method_name(&ours.name), full);
    // The interface's return, from ours. `Z` against `Z` needs nothing;
    // a `double` answering an `I` takes the same `ToInt32` a bound
    // argument takes, because it is the same boundary.
    let returns = want.rsplit(')').next().unwrap_or("");
    let held = types::kind(&ours.return_type);
    if returns == "I" && held == Some(Kind::Double) {
        code.invoke_static(origin, pool, crate::body::RUNTIME, "toInt32", "(D)I");
    }
    code.ret(
        origin,
        match returns {
            "V" => None,
            "I" | "S" | "B" | "C" | "Z" => Some(Kind::Int),
            "J" => Some(Kind::Long),
            "F" => Some(Kind::Float),
            "D" => Some(Kind::Double),
            _ => Some(Kind::Ref),
        },
    );
    code.finish(pool).map_err(|error| {
        Diagnostic::error(
            "NTS4008",
            format!("the bridge for `{}` could not be written: {error}", ours.name),
            origin.location,
        )
    })
}

/// Whether this layout's class carries the lane its closure belongs to.
///
/// **One derivation, read from two places.** `foreign_bridges` uses it to emit
/// the field and `ops::coerce_callback` to emit the store that fills it; a
/// second copy of the rule would put the store on a class without the field, or
/// the field on a class nothing writes -- and the first is a `NoSuchFieldError`
/// at link time while the second is silent.
///
/// True exactly when some foreign interface this layout implements declares a
/// member the inbox can carry. `void` is necessary -- posting runs later and
/// there is nobody left to return a value to -- and not sufficient: the runtime
/// holds a holder for a fixed set of argument shapes, and a `void` member
/// outside them has nowhere to put its arguments. [`types::deliverable`] is the
/// set, and is the same function the bridge asks when it emits the post.
pub(crate) fn carries_env(package: &str, program: &Program, layout: &nts_core::hir::Layout) -> bool {
    let mut wanted: Vec<String> = hierarchy::implemented(package, program, layout);
    for id in &layout.types {
        for interface in closure_interfaces(program).get(id).into_iter().flatten() {
            if !wanted.iter().any(|it| it == interface) {
                wanted.push(interface.clone());
            }
        }
    }
    wanted.iter().filter(|it| nts_core::hir::runtime::is_foreign_layout_name(it)).any(
        |interface| {
            program.foreign.iter().any(|(key, row)| {
                row.kind == nts_core::hir::runtime::ForeignKind::Interface
                    && key
                        .split_once(':')
                        .and_then(|(head, want)| {
                            head.rsplit_once('.').map(|(owner, _)| (owner, want))
                        })
                        .is_some_and(|(owner, want)| {
                            owner == interface && types::deliverable(want).is_some()
                        })
            })
        },
    )
}

/// The body of a posted closure's callback method.
///
/// Four shapes, written out rather than adapted generically, because there are
/// four and a generic adapter with one real case reads as though it handles
/// more than it does. Each brings the holder's arguments to what our function
/// takes and calls it -- the same two steps the foreign bridge takes, from a
/// different starting descriptor.
fn delivered_body(
    package: &str,
    layout: &nts_core::hir::Layout,
    ours: &nts_core::hir::Func,
    delivery: &types::Deliverable,
    full: &str,
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
) -> Result<nts_jvm_emitter::Body, Diagnostic> {
    let this = VType::Object(types::class_name(package, layout));
    let locals = match delivery.method {
        "()V" => vec![this],
        "([BDD)V" => {
            vec![this, VType::Object("[B".to_owned()), VType::Double, VType::Double]
        }
        "(D)V" => vec![this, VType::Double],
        _ => vec![this, VType::Object("java/lang/String".to_owned())],
    };
    // **Summed, not written down.** A `double` is two slots, so `([BDD)V` is
    // six and not four -- and writing the number out gave five, which the JVM
    // rejects at load with `ClassFormatError: Arguments can't fit into locals`.
    // Every parameter of a callback arrives assigned, so the prologue has
    // nothing to initialise and the count is the whole frame.
    let slots: u16 = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals, slots);
    code.initialize_locals(origin, slots);
    code.load(origin, Kind::Ref, 0);
    match delivery.method {
        "()V" => {}
        "([BDD)V" => {
            // The holder's window, honoured rather than ignored.
            code.load(origin, Kind::Ref, 1);
            code.load(origin, Kind::Double, 2);
            code.load(origin, Kind::Double, 4);
            code.invoke_static(
                origin,
                pool,
                "nts/rt/NtsViewU8",
                "from",
                "([BDD)Lnts/rt/NtsViewU8;",
            );
        }
        "(D)V" => code.load(origin, Kind::Double, 1),
        _ => code.load(origin, Kind::Ref, 1),
    }
    code.invoke_static(origin, pool, &body::program_class(package), &body::method_name(&ours.name), full);
    code.ret(origin, None);
    code.finish(pool).map_err(|error| {
        Diagnostic::error(
            "NTS4008",
            format!("the delivery for `{}` could not be written: {error}", ours.name),
            origin.location,
        )
    })
}

/// The `Nts*Callback` method a posted closure is driven through.
///
/// **The inbox needs a shape it already has a holder for.** `NtsForeign.postBytes`
/// takes an `NtsBytesCallback` and captures the array, the offset and the length
/// beside it; the closure implementing that interface is what lets the runtime's
/// existing helper own the holder, so no class is generated per bridge.
///
/// The body is the foreign bridge's, reached the same way: bring the arguments
/// to what our function takes, then call it. The difference is the offset and
/// length, which `postBytes` carries and which this must honour -- a callback
/// reading the whole array would be ignoring two of its own parameters, correct
/// only while every poster passes the whole array.
/// The field a closure carries its lane in, and the two accessors
/// `NtsLaneBound` declares.
///
/// Split from [`foreign_bridges`] because it is not a bridge: a bridge adapts
/// one of *our* functions to a descriptor a jar declared, and this is storage
/// plus the pair of methods that reach it. The two share only the question of
/// whether this class needs a lane at all, which [`carries_env`] answers for
/// both.
fn lane_accessors(
    package: &str,
    layout: &nts_core::hir::Layout,
    pool: &mut Pool,
    builder: &mut ClassBuilder,
    origin: &nts_semantic_schema::Origin,
) -> Result<(), Diagnostic> {
        builder.field(access::PACKAGE, types::ENV_MEMBER, types::ENV_DESCRIPTOR);
        let mut code = Code::new(
            vec![
                VType::Object(types::class_name(package, layout)),
                VType::Object(types::ENV.to_owned()),
            ],
            2,
        );
        code.initialize_locals(origin, 2);
        code.load(origin, Kind::Ref, 0);
        code.load(origin, Kind::Ref, 1);
        code.put_field(
            origin,
            pool,
            &types::class_name(package, layout),
            types::ENV_MEMBER,
            types::ENV_DESCRIPTOR,
        );
        code.ret(origin, None);
        let body = code.finish(pool).map_err(|error| {
            Diagnostic::error(
                "NTS4008",
                format!("the lane setter for `{}` could not be written: {error}", layout.name),
                origin.location,
            )
        })?;
        builder.method(
            access::PUBLIC,
            "bindLane".to_owned(),
            format!("({}){}", types::ENV_DESCRIPTOR, "V"),
            Some(body),
        );

        // And the reader, so `NtsForeign` can decide delivery without the
        // emitter naming a generated field from inside the runtime.
        let mut code = Code::new(vec![VType::Object(types::class_name(package, layout))], 1);
        code.initialize_locals(origin, 1);
        code.load(origin, Kind::Ref, 0);
        code.get_field(
            origin,
            pool,
            &types::class_name(package, layout),
            types::ENV_MEMBER,
            types::ENV_DESCRIPTOR,
        );
        code.ret(origin, Some(Kind::Ref));
        let body = code.finish(pool).map_err(|error| {
            Diagnostic::error(
                "NTS4008",
                format!("the lane reader for `{}` could not be written: {error}", layout.name),
                origin.location,
            )
        })?;
        builder.method(
            access::PUBLIC,
            "lane".to_owned(),
            format!("(){}", types::ENV_DESCRIPTOR),
            Some(body),
        );
    Ok(())
}

fn deliverable_bridges(
    package: &str,
    program: &Program,
    layout: &nts_core::hir::Layout,
    pool: &mut Pool,
    builder: &mut ClassBuilder,
    origin: &nts_semantic_schema::Origin,
) -> Result<(), Diagnostic> {
    let mut seen: Vec<&'static str> = Vec::new();
    let mut wanted: Vec<String> = hierarchy::implemented(package, program, layout);
    for id in &layout.types {
        for interface in closure_interfaces(program).get(id).into_iter().flatten() {
            if !wanted.iter().any(|it| it == interface) {
                wanted.push(interface.clone());
            }
        }
    }
    for interface in wanted {
        if !nts_core::hir::runtime::is_foreign_layout_name(&interface) {
            continue;
        }
        let mut rows: Vec<(&str, &str)> = program
            .foreign
            .iter()
            .filter(|(_, row)| row.kind == nts_core::hir::runtime::ForeignKind::Interface)
            .filter_map(|(key, _)| {
                let (head, want) = key.split_once(':')?;
                let (owner, member) = head.rsplit_once('.')?;
                (owner == interface).then_some((member, want))
            })
            .collect();
        rows.sort_unstable();
        for (_, want) in rows {
            let Some(delivery) = types::deliverable(want) else { continue };
            // One class may implement two jar interfaces of the same shape; the
            // method is the shape's, so emitting it twice is a duplicate member
            // the JVM refuses at load.
            if seen.contains(&delivery.interface) {
                continue;
            }
            seen.push(delivery.interface);
            builder.interfaces.push(delivery.interface.to_owned());
            let closure = format!("{}#call", layout.name);
            let Some(ours) = program.funcs.iter().find(|f| f.name == closure) else { continue };
            let Some(full) = body::signature(package, program, ours) else { continue };
            let body = delivered_body(package, layout, ours, &delivery, &full, pool, origin)?;
            builder.method(
                access::PUBLIC,
                "call".to_owned(),
                delivery.method.to_owned(),
                Some(body),
            );
        }
    }
    Ok(())
}

/// Overloads that let a Java caller pass a lambda, and the adapters they need.
///
/// `eachUpTo(double, Fn3__5)` gains `eachUpTo(double, NtsNumberCallback)`, whose
/// body wraps the interface in an adapter and calls the real one. Overloading
/// rather than replacing: a TypeScript caller still passes its own closure to
/// the `Fn` form, `javac` picks the most specific for a real closure, and only a
/// lambda -- which is not an `Fn` -- reaches the wrapper.
fn lambda_overloads(
    package: &str,
    program: &Program,
    builder: &mut ClassBuilder,
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
) -> (Vec<nts_jvm_emitter::Class>, Vec<Diagnostic>) {
    let (mut classes, mut diagnostics) = (Vec::new(), Vec::new());
    let mut adapters: std::collections::BTreeMap<String, (&'static str, String)> =
        std::collections::BTreeMap::new();

    for func in &program.funcs {
        if !func.exported || method_of(program, func).is_some() {
            continue;
        }
        let Some(descriptor) = body::signature(package, program, func) else { continue };
        let Some(parameters) = nts_jvm_emitter::descriptor::parameters(&descriptor) else {
            continue;
        };
        let swaps: Vec<(usize, String, &'static str, String)> = func
            .params
            .iter()
            .enumerate()
            .filter_map(|(at, param)| {
                lambda_interface(package, program, &param.ty).map(|(base, i, call)| (at, base, i, call))
            })
            .collect();
        if swaps.is_empty() {
            continue;
        }
        for (_, base, interface, call) in &swaps {
            adapters.insert(base.clone(), (interface, call.clone()));
        }
        match lambda_forward(package, func, &descriptor, &parameters, &swaps, pool, origin) {
            Ok((want, body)) => builder.method(
                access::PUBLIC | access::STATIC,
                body::method_name(&func.name),
                want,
                Some(body),
            ),
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

    for (base, (interface, call)) in adapters {
        match lambda_adapter(program, &base, interface, &call, origin) {
            Ok(class) => classes.push(class),
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }
    (classes, diagnostics)
}

/// The lambda-accepting overload's descriptor and body.
///
/// Split from [`lambda_overloads`], which decides *which* functions get one:
/// this decides what the one it gets looks like. The seam is where the loop
/// ends and the single function begins, and it is also where the line count
/// stopped being about one thing.
fn lambda_forward(
    package: &str,
    func: &nts_core::hir::Func,
    descriptor: &str,
    parameters: &[&str],
    swaps: &[(usize, String, &'static str, String)],
    pool: &mut Pool,
    origin: &nts_semantic_schema::Origin,
) -> Result<(String, nts_jvm_emitter::Body), Diagnostic> {
    let swapped = |at: usize| swaps.iter().find(|(which, _, _, _)| *which == at);

    let mut want = String::from("(");
    let mut locals: Vec<VType> = Vec::new();
    for (at, spelled) in parameters.iter().enumerate() {
        if let Some((_, _, interface, _)) = swapped(at) {
            want.push('L');
            want.push_str(interface);
            want.push(';');
            locals.push(VType::Object((*interface).to_owned()));
        } else {
            want.push_str(spelled);
            locals.push(match *spelled {
                "I" | "S" | "B" | "C" | "Z" => VType::Integer,
                "J" => VType::Long,
                "F" => VType::Float,
                "D" => VType::Double,
                other => VType::Object(other.trim_matches(|c| c == 'L' || c == ';').to_owned()),
            });
        }
    }
    let returns = descriptor.rsplit(')').next().unwrap_or("V");
    want.push(')');
    want.push_str(returns);

    let slots: u16 = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals.clone(), slots);
    code.initialize_locals(origin, slots);
    let mut at: u16 = 0;
    for (which, local) in locals.iter().enumerate() {
        if let Some((_, base, interface, _)) = swapped(which) {
            let adapter = format!("{base}$Lambda");
            code.new_object(origin, pool, &adapter);
            code.dup(origin);
            code.load(origin, Kind::Ref, at);
            code.invoke_special(origin, pool, &adapter, "<init>", &format!("(L{interface};)V"));
        } else {
            let kind = match local {
                VType::Double => Kind::Double,
                VType::Long => Kind::Long,
                VType::Float => Kind::Float,
                VType::Integer => Kind::Int,
                _ => Kind::Ref,
            };
            code.load(origin, kind, at);
        }
        at += local.slots();
    }
    code.invoke_static(origin, pool, &body::program_class(package), &body::method_name(&func.name), descriptor);
    code.ret(origin, if returns == "V" { None } else { types::kind(&func.return_type) });
    let body = code.finish(pool).map_err(|error| {
        Diagnostic::error(
            "NTS4003",
            format!("the lambda overload for `{}`: {error}", func.name),
            origin.location,
        )
    })?;
    Ok((want, body))
}

/// The closure base a parameter names, when Java could pass a lambda for it.
///
/// A closure's base is an `abstract class`, not an interface, and that is
/// deliberate: a closure call is `invokevirtual` on it, and making it an
/// interface would turn every closure call in every program into
/// `invokeinterface` to serve the ones Java reaches. So a lambda cannot be
/// passed directly -- Java has no syntax for an abstract class -- and the base
/// already implements the matching `Nts*Callback`, which Java *can* lambda.
fn lambda_interface(
    package: &str,
    program: &Program,
    ty: &nts_core::hir::HirType,
) -> Option<(String, &'static str, String)> {
    let descriptor = types::descriptor(types::Shape::packaged(program, package), ty)?;
    let class = descriptor.strip_prefix('L')?.strip_suffix(';')?.to_owned();
    let layout = program.layouts.iter().find(|it| types::class_name(package, it) == class)?;
    let call = layout.methods.iter().flatten().find(|name| hierarchy::member_name(name) == "call")?;
    let func = program.funcs.iter().find(|it| &it.name == call)?;
    let shape = instance_descriptor(package, program, func)?;
    // **`instance_descriptor` already excludes the receiver**, which cost a
    // debug session: stripping one off `(D)V` looked for a `;` that is not
    // there and answered `None` for every closure, silently.
    types::callback_interface(&shape).map(|interface| (class, interface, shape))
}

/// The class that lets a Java lambda stand in for a closure.
///
/// `final class Fn3__5$Lambda extends Fn3__5 { NtsNumberCallback it; call(d) { it.call(d); } }`
///
/// **One allocation, and only where Java passes a lambda.** A TypeScript caller
/// passes its own closure and never reaches this; the cost lands on the crossing
/// that could not happen at all before, which is the shape this lane prefers to
/// a wrapper on the common path.
fn lambda_adapter(
    program: &Program,
    base: &str,
    interface: &'static str,
    call: &str,
    origin: &nts_semantic_schema::Origin,
) -> Result<nts_jvm_emitter::Class, Diagnostic> {
    let _ = program;
    let name = format!("{base}$Lambda");
    let held = format!("L{interface};");
    let mut pool = Pool::new();
    let mut builder = ClassBuilder::new(name.clone(), base.to_owned());
    // `final` because nothing may extend an adapter, and `SourceFile` because
    // every other generated class carries one -- a frame in a stack trace with
    // no source name is the one that stops a reader.
    builder.access |= access::FINAL;
    builder.source_file = Some("nts".to_owned());
    builder.field(access::PACKAGE, "it", held.clone());

    // `<init>(I)V`: super(), then store the interface.
    let mut code = Code::new(
        vec![VType::Object(name.clone()), VType::Object(interface.to_owned())],
        2,
    );
    code.initialize_locals(origin, 2);
    code.load(origin, Kind::Ref, 0);
    code.invoke_special(origin, &mut pool, base, "<init>", "()V");
    code.load(origin, Kind::Ref, 0);
    code.load(origin, Kind::Ref, 1);
    code.put_field(origin, &mut pool, &name, "it", &held);
    code.ret(origin, None);
    let body = code.finish(&pool).map_err(|error| {
        Diagnostic::error("NTS4003", format!("the lambda adapter's constructor: {error}"), origin.location)
    })?;
    builder.method(access::PUBLIC, "<init>", format!("({held})V"), Some(body));

    // `call(...)`: forward to the interface, whose method is also `call`.
    let mut locals = vec![VType::Object(name.clone())];
    for spelled in nts_jvm_emitter::descriptor::parameters(call).unwrap_or_default() {
        locals.push(match spelled {
            "I" | "S" | "B" | "C" | "Z" => VType::Integer,
            "J" => VType::Long,
            "F" => VType::Float,
            "D" => VType::Double,
            other => VType::Object(other.trim_matches(|c| c == 'L' || c == ';').to_owned()),
        });
    }
    let slots: u16 = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals.clone(), slots);
    code.initialize_locals(origin, slots);
    code.load(origin, Kind::Ref, 0);
    code.get_field(origin, &mut pool, &name, "it", &held);
    let mut at: u16 = 1;
    for local in locals.iter().skip(1) {
        let kind = match local {
            VType::Double => Kind::Double,
            VType::Long => Kind::Long,
            VType::Float => Kind::Float,
            VType::Integer => Kind::Int,
            _ => Kind::Ref,
        };
        code.load(origin, kind, at);
        at += local.slots();
    }
    code.invoke_interface(origin, &mut pool, interface, "call", call);
    code.ret(origin, None);
    let body = code.finish(&pool).map_err(|error| {
        Diagnostic::error("NTS4003", format!("the lambda adapter's call: {error}"), origin.location)
    })?;
    builder.method(access::PUBLIC, "call", call.to_owned(), Some(body));

    builder.build(pool).map_err(|error| {
        Diagnostic::error("NTS4003", format!("the lambda adapter `{name}`: {error}"), origin.location)
    })
}

/// Add a function to the program class, with its generic signature if it has one.
///
/// **The whole of why this is a function and not two lines inline.** A generic
/// signature is the exception -- most methods have none -- so the decision is a
/// branch at every publish, and a branch repeated is a branch that drifts. The
/// alternative was a `match` at the one call site, which pushed `emit` over the
/// line limit and buried a one-sentence decision in the middle of a loop about
/// something else.
#[allow(clippy::too_many_arguments)]
fn publish(
    package: &str,
    builder: &mut ClassBuilder,
    program: &Program,
    func: &nts_core::hir::Func,
    access: u16,
    name: &str,
    descriptor: &str,
    body: nts_jvm_emitter::Body,
) {
    match generic_signature(package, program, func, descriptor) {
        Some(generic) => {
            builder.method_generic(access, name, descriptor, generic, Some(body));
        }
        None => builder.method(access, name, descriptor, Some(body)),
    }
}

/// A method's generic signature, or `None` when the descriptor already says
/// everything.
///
/// Built beside the descriptor rather than instead of it: the two must agree
/// after erasure, and the cheapest way to keep them agreeing is to derive both
/// from the same types in the same order. Returns `None` when nothing in the
/// signature is parameterised, so the attribute appears only where it says
/// something -- an attribute on every method would be bytes that mean nothing
/// and one more thing to keep true.
fn generic_signature(package: &str, program: &Program, func: &nts_core::hir::Func, descriptor: &str) -> Option<String> {
    let shape = types::Shape::packaged(program, package);
    let mut rendered = String::from("(");
    let mut interesting = false;
    for param in &func.params {
        let plain = types::descriptor(shape, &param.ty)?;
        match types::parameterised(shape, &param.ty) {
            Some(generic) => {
                interesting = true;
                rendered.push_str(&generic);
            }
            None => rendered.push_str(&plain),
        }
    }
    rendered.push(')');
    match types::parameterised(shape, &func.return_type) {
        Some(generic) => {
            interesting = true;
            rendered.push_str(&generic);
        }
        None => rendered.push_str(types::descriptor(shape, &func.return_type).as_deref().unwrap_or("V")),
    }
    // The erasure has to be the descriptor. If it is not, this lane has built a
    // signature for a shape it does not really emit, and an attribute nobody can
    // act on is worse than none: `javac` reads it in preference to the
    // descriptor.
    (interesting && erases_to(&rendered, descriptor)).then_some(rendered)
}

/// Whether a generic signature erases to a descriptor, by stripping every
/// `<...>` and comparing.
fn erases_to(signature: &str, descriptor: &str) -> bool {
    let mut erased = String::with_capacity(signature.len());
    let mut depth = 0usize;
    for ch in signature.chars() {
        match ch {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            other if depth == 0 => erased.push(other),
            _ => {}
        }
    }
    erased == descriptor
}

fn foreign_bridges(
    package: &str,
    program: &Program,
    layout: &nts_core::hir::Layout,
    handed_to: &FxHashMap<nts_semantic_schema::TypeId, Vec<String>>,
    pool: &mut Pool,
    builder: &mut ClassBuilder,
    origin: &nts_semantic_schema::Origin,
) -> Result<(), Diagnostic> {
    // Deduplicated: a class can both declare `implements View.OnTouch` and be
    // handed to one, and emitting the bridge twice is a duplicate member the
    // JVM refuses at load -- which the emitter's own accounting caught rather
    // than the verifier, and said so by name.
    let mut wanted: Vec<String> = hierarchy::implemented(package, program, layout);
    for id in &layout.types {
        for interface in handed_to.get(id).into_iter().flatten() {
            if !wanted.iter().any(|it| it == interface) {
                wanted.push(interface.clone());
            }
        }
    }
    for interface in wanted {
        if !nts_core::hir::runtime::is_foreign_layout_name(&interface) {
            continue;
        }
        let mut rows: Vec<(&str, &str)> = program
            .foreign
            .iter()
            .filter(|(_, row)| row.kind == nts_core::hir::runtime::ForeignKind::Interface)
            .filter_map(|(key, _)| {
                let (head, want) = key.split_once(':')?;
                let (owner, member) = head.rsplit_once('.')?;
                (owner == interface).then_some((member, want))
            })
            .collect();
        // Sorted, so the emitted class does not reorder between runs.
        rows.sort_unstable();
        for (member, want) in rows {
            // A closure's single method is `call`, whatever the interface
            // names its own -- `View.OnTouch.onTouch` is served by
            // `Closure0#call`. Looked up by the interface's name first so a
            // class that really declares it wins.
            let named = format!("{}#{member}", layout.name);
            let closure = format!("{}#call", layout.name);
            let Some(ours) = program
                .funcs
                .iter()
                .find(|f| f.name == named)
                .or_else(|| program.funcs.iter().find(|f| f.name == closure))
            else {
                continue;
            };
            let Some(mine) = instance_descriptor(package, program, ours) else { continue };
            if mine == want {
                continue;
            }
            let Some(full) = body::signature(package, program, ours) else { continue };
            let rendered = bridge_body(package, program, layout, ours, want, &full, pool, origin)?;
            builder.method(
                access::PUBLIC | access::BRIDGE | access::SYNTHETIC,
                member.to_owned(),
                want.to_owned(),
                Some(rendered),
            );
        }
    }

    // **The lane this closure belongs to, captured where it crosses.**
    //
    // A framework may call a bound interface from a thread we do not own, and
    // everything here except the inbox is confined to one lane. To deliver such
    // a call rather than refuse it, the bridge has to know *which* lane -- and
    // it cannot ask when it runs, because by then it is on the wrong thread.
    //
    // Set at the crossing rather than at construction: a `ClosureStatic`
    // singleton is built in `<clinit>`, which may run on any thread that first
    // touches the class, while handing a closure to Java is always the
    // program's own code and therefore always on the lane.
    //
    // Package-private, like every generated field: `nts/gen/Program` writes it
    // and nothing outside the package may.
    if carries_env(package, program, layout) {
        lane_accessors(package, layout, pool, builder, origin)?;
        builder.interfaces.push(types::LANE_BOUND.to_owned());
        deliverable_bridges(package, program, layout, pool, builder, origin)?;
    }
    Ok(())
}

fn dispatch_forwarders(
    package: &str,
    program: &Program,
    layout: &nts_core::hir::Layout,
    builder: &mut ClassBuilder,
    pool: &mut Pool,
) -> Result<(), Diagnostic> {
    let origin = program_origin(program);
    let base = program.base_layout(layout).and_then(|at| program.layouts.get(at));
    for (slot, entry) in layout.methods.iter().enumerate() {
        let Some(func_name) = entry else { continue };
        // A class declares a forwarder only where its implementation differs
        // from the one it would inherit; otherwise the base's already dispatches
        // correctly and a second copy is bytes with no meaning.
        if base.and_then(|b| b.methods.get(slot)) == Some(entry) {
            continue;
        }
        let Some(target) = program.funcs.iter().find(|f| &f.name == func_name) else {
            // A slot naming a function the program does not carry is a fact
            // about the IR, not about this backend, so it is reported rather
            // than skipped -- a silently absent forwarder is an
            // `AbstractMethodError` at run time.
            return Err(Diagnostic::error(
                "NTS4008",
                format!("`{}` dispatches slot {slot} to `{func_name}`, which this program does not define", layout.name),
                origin.location,
            ));
        };
        let Some(full) = body::signature(package, program, target) else {
            return Err(Diagnostic::error(
                "NTS4008",
                format!("`{func_name}` has no representable signature to dispatch to"),
                origin.location,
            ));
        };
        // The declaring layout's name, not the implementer's. See
        // `hierarchy::declared_member`: a generator frame fills a slot declared
        // as `Generator0#resume` with a free function called `upTo__resume`, and
        // naming the forwarder after the implementer is an `AbstractMethodError`
        // the verifier cannot catch.
        let member = hierarchy::declared_member(program, layout, slot)
            .unwrap_or_else(|| hierarchy::member_name(func_name));
        let descriptor = instance_descriptor(package, program, target).ok_or_else(|| {
            Diagnostic::error(
                "NTS4008",
                format!("`{func_name}` has no receiver to dispatch on"),
                origin.location,
            )
        })?;
        // The agreement that dispatch depends on, asserted where it is cheap --
        // and where the disagreement is one the JVM has an answer for, taken.
        //
        // A method returning `this` narrows its return type in every subclass:
        // `Counter.bump(): Counter` and `Doubling.bump(): Doubling`. That is a
        // covariant override, which Java has had since 5 and the *JVM* has
        // never had -- a method is identified by name and descriptor, so those
        // two are unrelated and dispatch through `Counter` would miss the
        // override entirely. javac's answer is a **bridge**: a second method on
        // the subclass with the inherited descriptor, whose body is the
        // forwarder's, and which the verifier accepts because a `Doubling`
        // returned where `Counter` is declared is an ordinary widening.
        //
        // Only the *return* may differ. Covariant parameters are not
        // overriding in any language on this platform -- they are overloading,
        // and a bridge would silently make one call the other.
        let bridge = bridge_for(package, program, layout, base, slot, &member, &descriptor, &origin)?;

        // An abstract declaration gets the method with no `Code`, and the
        // verifier is what makes the absence safe: `invokevirtual` on an
        // abstract method is legal exactly because a receiver can only be a
        // subclass that overrode it, and `new` on the abstract class does not
        // verify at all. That is the same guarantee the C lane gets from
        // nobody naming the symbol -- but enforced by the platform rather than
        // by the absence of a caller, which is the stronger of the two.
        //
        // `ACC_ABSTRACT` and `ACC_FINAL` together are rejected at load time.
        // `hierarchy::extended` is already true for any class worth declaring
        // abstract, so clearing it is belt-and-braces against a base nothing
        // happens to extend.
        if target.abstract_declaration {
            builder.access |= access::ABSTRACT;
            builder.access &= !access::FINAL;
            builder.method(access::PUBLIC | access::ABSTRACT, member, descriptor, None);
            continue;
        }

        let mut locals = vec![VType::Object(types::class_name(package, layout))];
        for param in target.params.iter().skip(1) {
            let Some(vtype) = types::vtype(types::Shape::packaged(program, package), &param.ty) else {
                return Err(Diagnostic::error(
                    "NTS4008",
                    format!("`{func_name}` takes a parameter with no representation"),
                    origin.location,
                ));
            };
            locals.push(vtype);
        }
        let slots: u16 = locals.iter().map(VType::slots).sum();
        let mut code = Code::new(locals, slots);
        code.load(&origin, Kind::Ref, 0);
        let mut at: u16 = 1;
        for param in target.params.iter().skip(1) {
            let Some(kind) = types::kind(&param.ty) else {
                return Err(Diagnostic::error(
                    "NTS4008",
                    format!("`{func_name}` takes a parameter with no representation"),
                    origin.location,
                ));
            };
            code.load(&origin, kind, at);
            at += kind.words();
        }
        code.invoke_static(&origin, pool, &body::program_class(package), &body::method_name(func_name), &full);
        code.ret(&origin, types::kind(&target.return_type));
        let rendered = code.finish(pool).map_err(|error| {
            Diagnostic::error(
                "NTS4008",
                format!("the forwarder for `{func_name}` could not be written: {error}"),
                origin.location,
            )
        })?;
        if let Some(inherited) = bridge {
            // Byte-for-byte the forwarder, under the descriptor the base
            // declared. `ACC_BRIDGE` is what tells a reader -- and any tool
            // reading these classes -- that the duplicate is deliberate.
            builder.method(
                access::PUBLIC | access::BRIDGE | access::SYNTHETIC,
                member.clone(),
                inherited,
                Some(rendered.clone()),
            );
        }
        builder.method(access::PUBLIC, member, descriptor, Some(rendered));
    }
    Ok(())
}



/// The layout this function is a method of, if it is one.
///
/// **One derivation, used twice**: the static's access flags ask it, and the
/// forwarder emission asks it. Two copies of this condition would drift into a
/// static marked synthetic with no instance method to replace it -- which is
/// not a wrong answer that runs, it is TypeScript becoming uncallable from
/// Java, because `javac` refuses to reference a synthetic member.
///
/// Ownership is read from the **type**: the lowering emits
/// `Session#bump(this: managed<obj#1>)` with the first parameter named `this`
/// and typed as the layout. The **name** is then an independent check rather
/// than the source of truth -- `<layout>#<member>` must agree -- and a
/// disagreement answers `None` rather than guessing, which keeps a
/// hand-written `function f(this: Foo)`, which TypeScript allows, from being
/// silently attached to a class.
fn method_of<'a>(
    program: &'a Program,
    func: &nts_core::hir::Func,
) -> Option<(&'a nts_core::hir::Layout, String)> {
    use nts_core::hir::{HirType, ManagedType};
    if !func.exported || func.abstract_declaration {
        return None;
    }
    let receiver = func.params.first()?;
    if receiver.name != "this" {
        return None;
    }
    let HirType::Managed(ManagedType::Object(owner)) = &receiver.ty else { return None };
    let (declared, member) = func.name.split_once('#')?;
    if member.is_empty() {
        return None;
    }
    let layout = program
        .layouts
        .iter()
        .find(|layout| layout.types.contains(owner) && layout.name == declared)?;
    Some((layout, member.to_owned()))
}

/// Instance methods on a layout's class, forwarding to the statics its methods
/// were lowered to.
///
/// # Why this exists
///
/// Every TypeScript method lowers to a free function, so a Java caller had to
/// write `Program.Session$bump(s)` rather than `s.bump()`. That is correct and
/// it reads as internals -- `$` is the JVM's own mark for a compiler-generated
/// name (`Outer$Inner`, `lambda$main$0`, `this$0`), so a caller typing one is
/// typing something that looks like it was not meant for them.
///
/// **Measured at zero.** `benches/interop-facade` times the same static called
/// directly against the same static called through a forwarder: minima of
/// 458.96 ns and 457.43 ns over four sittings, with the spread *within* each arm
/// (6.2 ns) larger than the difference between them. Three instructions that C2
/// and ART inline away.
///
/// Our own call sites are untouched: they still `invokestatic` the original,
/// because `Callee::Direct` never looks here.
///
/// # How ownership is recovered, without asking HIR to carry it
///
/// `Func` has no owner field, and `Layout.methods` is the *dispatch* table, so
/// a non-virtual method is in neither. What the lowering does record is
/// structural: `export func Session#bump(this: managed<obj#1>)` -- **the first
/// parameter is named `this` and typed as the layout**, set deliberately in
/// `lower`.
///
/// So ownership is read from the **type**, and the name is an independent
/// check rather than the source of truth: the function must also be called
/// `<layout>#<member>`. Two derivations that must agree, with the second
/// asserting rather than computing -- and a disagreement skips the method
/// rather than guessing, which keeps a `this`-parameter function that a user
/// wrote by hand (TypeScript allows `function f(this: Foo)`) from being
/// silently attached to a class as a method.
fn member_forwarders(
    package: &str,
    program: &Program,
    layout: &nts_core::hir::Layout,
    builder: &mut ClassBuilder,
    pool: &mut Pool,
) -> Result<(), Diagnostic> {
    let class = types::class_name(package, layout);
    let origin = program_origin(program);

    for func in &program.funcs {
        let Some((owner, member)) = method_of(program, func) else { continue };
        if owner.name != layout.name {
            continue;
        }

        let Some(signature) = body::signature(package, program, func) else { continue };
        // The forwarder's own descriptor is the static's minus the receiver.
        let Some(rest) = signature.strip_prefix(&format!("(L{class};")) else { continue };
        let forwarded = format!("({rest}");

        let shape = types::Shape::packaged(program, package);
        let mut locals = vec![VType::Object(class.clone())];
        let mut slots = 1u16;
        let mut ok = true;
        for param in &func.params[1..] {
            let (Some(vtype), Some(kind)) = (types::vtype(shape, &param.ty), types::kind(&param.ty))
            else {
                ok = false;
                break;
            };
            // `Kind::words` is slots and stack words both -- "which is why the
            // JVM calls both category". A `long` or a `double` is two.
            slots += kind.words();
            locals.push(vtype);
        }
        if !ok {
            continue;
        }

        let mut code = Code::new(locals, slots);
        code.load(&origin, Kind::Ref, 0);
        let mut at = 1u16;
        for param in &func.params[1..] {
            let Some(kind) = types::kind(&param.ty) else { break };
            code.load(&origin, kind, at);
            at += kind.words();
        }
        code.invoke_static(&origin, pool, &body::program_class(package), &body::method_name(&func.name), &signature);
        code.ret(&origin, types::kind(&func.return_type));

        let rendered = code.finish(pool).map_err(|error| {
            Diagnostic::error(
                "NTS4009",
                format!(
                    "the forwarder for `{member}` on `{}` could not be written: {error}",
                    layout.name
                ),
                origin.location,
            )
        })?;
        let name = body::method_name(&member);
        // Already declared by `dispatch_forwarders`, which ran first and had
        // more to say about it. A second copy is not a bigger surface: the JVM
        // rejects the whole class at load, which is what `DuplicateMember`
        // catches and what cost all eight `awfy-*` rows their JVM column
        // between 2026-09-13 and 2026-09-15 -- every one of those classes has a
        // `benchmark()D` that is an override.
        if builder.methods.iter().any(|m| m.name == name && m.descriptor == forwarded) {
            continue;
        }
        builder.method(access::PUBLIC, name, forwarded, Some(rendered));
    }
    Ok(())
}

/// The descriptor a bridge method needs, or `None` when the override agrees
/// with what it overrides and no bridge is called for.
///
/// Refuses when they disagree in a way the JVM has no answer for.
#[allow(clippy::too_many_arguments)]
fn bridge_for(
    package: &str,
    program: &Program,
    layout: &nts_core::hir::Layout,
    base: Option<&nts_core::hir::Layout>,
    slot: usize,
    member: &str,
    descriptor: &str,
    origin: &nts_semantic_schema::Origin,
) -> Result<Option<String>, Diagnostic> {
    let Some(inherited) = base
        .and_then(|b| b.methods.get(slot))
        .and_then(|m| m.as_ref())
        .and_then(|name| program.funcs.iter().find(|f| &f.name == name))
        .and_then(|f| instance_descriptor(package, program, f))
        .filter(|inherited| inherited != descriptor)
    else {
        return Ok(None);
    };
    if !narrows_return(package, program, descriptor, &inherited) {
        return Err(Diagnostic::error(
            "NTS4009",
            format!(
                "`{}.{member}` is `{descriptor}` where the method it overrides is \
                 `{inherited}` -- the JVM would treat these as two unrelated methods \
                 and dispatch would silently reach the wrong one",
                layout.name
            ),
            origin.location,
        ));
    }
    Ok(Some(inherited))
}

/// Whether two method descriptors differ only in that the first returns a
/// subclass of what the second returns.
///
/// The parameters must be identical: a difference there is an overload, and
/// bridging one to the other would make a call reach a method that was never
/// written for it.
fn narrows_return(package: &str, program: &Program, derived: &str, base: &str) -> bool {
    let Some((derived_params, derived_result)) = derived.split_once(')') else { return false };
    let Some((base_params, base_result)) = base.split_once(')') else { return false };
    if derived_params != base_params {
        return false;
    }
    let (Some(from), Some(to)) = (class_of(derived_result), class_of(base_result)) else {
        return false;
    };
    let Some(layout) = program.layouts.iter().find(|l| types::class_name(package, l) == from) else {
        return false;
    };
    hierarchy::ancestry(program, layout).iter().any(|a| types::class_name(package, a) == to)
}

/// The internal name inside an object descriptor, or `None` for anything else.
/// A primitive return that disagrees is not covariance and has no bridge.
fn class_of(descriptor: &str) -> Option<String> {
    descriptor
        .strip_prefix('L')
        .and_then(|rest| rest.strip_suffix(';'))
        .map(str::to_owned)
}

/// A dispatched method's descriptor as an *instance* method: its own signature
/// with the receiver dropped, because on the JVM the receiver is not a
/// parameter.
pub(crate) fn instance_descriptor(
    package: &str,
    program: &Program,
    func: &nts_core::hir::Func,
) -> Option<String> {
    let mut params = Vec::with_capacity(func.params.len());
    for param in func.params.iter().skip(1) {
        params.push(types::descriptor(types::Shape::packaged(program, package), &param.ty)?);
    }
    func.params.first()?;
    let borrowed: Vec<&str> = params.iter().map(String::as_str).collect();
    Some(nts_jvm_emitter::descriptor::method(
        &borrowed,
        &types::descriptor(types::Shape::packaged(program, package), &func.return_type)?,
    ))
}

/// The function that resumes this layout, where it is a suspended frame.
///
/// A scan of `Suspend` operations rather than a flag on the layout, for the
/// same reason `closure_singletons` scans: which layouts are frames is a fact
/// about the program's *operations*, and `object_class` sees one layout at a
/// time.
fn resumes(package: &str, program: &Program, layout: &nts_core::hir::Layout) -> Option<String> {
    let wanted = types::class_name(package, layout);
    for func in &program.funcs {
        for op in &func.values {
            let nts_core::hir::OpKind::Suspend { frame, resume, .. } = &op.kind else {
                continue;
            };
            let nts_core::hir::HirType::Managed(nts_core::hir::ManagedType::Object(id)) =
                func.values[frame.0 as usize].ty
            else {
                continue;
            };
            if program.layout(id).map(|l| types::class_name(package, l)).as_deref() == Some(wanted.as_str()) {
                return Some(resume.clone());
            }
        }
    }
    None
}

/// The closure classes this program uses as *values*, and the field each gets.
///
/// A scan rather than a flag on the layout: `ClosureStatic` is a fact about
/// call sites, and a closure class that is only ever constructed and called
/// needs no singleton. Sorted, so two runs of one compiler on one input emit
/// the same program -- the same rule `InstanceOf`'s class list keeps.
/// The closure classes this program *erases*, and the field each gets.
///
/// A `ClosureStatic` is already a `private static final INSTANCE`, because
/// `f === f` has to hold. Erasing one is equally constant -- the tag is
/// `FUNCTION` for every closure and the reference is that singleton -- and it
/// was rebuilt at every use: `NtsValue.ofTagged(4, closure$Closure0)`, which
/// allocates.
///
/// `optional-chain` assigns one to a field on half its iterations and measured
/// **1,600,000 bytes/op** -- 50,000 allocations of a value that could not
/// change. It was the only row in the suite where allocation was demonstrably
/// the cost, and the object being allocated was a constant.
///
/// Identity is not the reason to do this, but it is a reason it is safe: two
/// erasures of one closure are now the same `NtsValue` where they were equal
/// ones.
fn erased_closures(package: &str, program: &Program) -> Vec<(String, String)> {
    // **One per closure singleton, whether or not an `Erase` names it.**
    //
    // This scanned for `Erase { value }` over a `ClosureStatic` and declared a
    // field for each, and the emitter reached for the same field from a second
    // place the scan did not know about: a comparison between an erased value
    // and a bare closure pushes *both* sides erased, so
    //
    //     %2 = erase %1 : erased
    //     %4 = eq %2, %3 : bool     <- %3 a ClosureStatic, never an `Erase`
    //
    // emits `getstatic erased$Ctor_RangeError` for a field nothing declared.
    // `examples/class-values` does exactly that and the JVM said so:
    // `NoSuchFieldError`, loudly, at link time rather than as a wrong answer.
    //
    // The precise repair is to enumerate the implicit-erase sites too, and it
    // is the wrong one: it is a third walk that has to stay in step with the
    // emitter, and its failure mode is the `NoSuchFieldError` above. Deriving
    // the set from `closure_singletons` makes the two identical *by
    // construction* -- `erased$X` exists exactly when `closure$X` does -- and
    // its failure mode is an unused static field holding a constant.
    closure_singletons(package, program)
        .into_iter()
        .map(|(_, class)| (erased_field(&class), class))
        .collect()
}

/// The field an erased closure singleton gets, in one place because the scan
/// and the emitter both have to agree about it.
pub(crate) fn erased_field(class: &str) -> String {
    format!("erased${}", class.rsplit('/').next().unwrap_or(class))
}

/// The field a closure singleton gets, for the same reason.
pub(crate) fn closure_field(class: &str) -> String {
    format!("closure${}", class.rsplit('/').next().unwrap_or(class))
}

fn closure_singletons(package: &str, program: &Program) -> Vec<(String, String)> {
    let mut found = std::collections::BTreeSet::new();
    for func in &program.funcs {
        for op in &func.values {
            if !matches!(op.kind, nts_core::hir::OpKind::ClosureStatic) {
                continue;
            }
            if let nts_core::hir::HirType::Managed(nts_core::hir::ManagedType::Object(id)) = op.ty
                && let Some(layout) = program.layout(id)
            {
                found.insert(types::class_name(package, layout));
            }
        }
    }
    found.into_iter().map(|class| (closure_field(&class), class)).collect()
}

/// `<clinit>`, where a global that starts as something other than zero is set.
///
/// The JVM zeroes a static field, so a global whose initial value is zero needs
/// nothing -- which is most of them, and is why this returns `None` rather than
/// an empty method for a program with no interesting initializers.
fn class_initializer(
    package: &str,
    program: &Program,
    singletons: &[(String, String)],
    erased: &[(String, String)],
    pool: &mut Pool,
) -> Option<nts_jvm_emitter::Body> {
    let interesting: Vec<_> = program
        .globals
        .iter()
        .filter(|global| global.initial != 0.0 && types::descriptor(types::Shape::packaged(program, package), &global.ty).is_some())
        .collect();
    if interesting.is_empty() && singletons.is_empty() && erased.is_empty() {
        return None;
    }
    let mut code = Code::new(Vec::<VType>::new(), 0);
    let origin = program_origin(program);
    for (field, class) in singletons {
        code.new_object(&origin, pool, class);
        code.dup(&origin);
        code.invoke_special(&origin, pool, class, "<init>", "()V");
        code.put_static(&origin, pool, &body::program_class(package), field, &format!("L{class};"));
    }
    // After the instances they wrap, and in the same method, so an erased form
    // cannot be read before the closure it names exists.
    for (field, class) in erased {
        code.const_int(&origin, pool, i32::try_from(nts_core::hir::tags::FUNCTION).unwrap_or(0));
        code.get_static(&origin, pool, &body::program_class(package), &closure_field(class), &format!("L{class};"));
        code.invoke_static(
            &origin,
            pool,
            types::VALUE,
            "ofTagged",
            "(ILjava/lang/Object;)Lnts/rt/NtsValue;",
        );
        code.put_static(&origin, pool, &body::program_class(package), field, types::VALUE_DESCRIPTOR);
    }
    for global in interesting {
        let origin = global.origin.clone();
        let descriptor = types::descriptor(types::Shape::packaged(program, package), &global.ty)?;
        match types::kind(&global.ty)? {
            Kind::Double => code.const_double(&origin, pool, global.initial),
            #[allow(
                clippy::cast_possible_truncation,
                reason = "a float global's initial value was folded as one"
            )]
            Kind::Float => code.const_float(&origin, pool, global.initial as f32),
            #[allow(
                clippy::cast_possible_truncation,
                reason = "an integer global's initial value is whole by construction"
            )]
            Kind::Long => code.const_long(&origin, pool, global.initial as i64),
            #[allow(
                clippy::cast_possible_truncation,
                reason = "an integer global's initial value is whole by construction"
            )]
            _ => code.const_int(&origin, pool, global.initial as i32),
        }
        code.put_static(&origin, pool, &body::program_class(package), &body::method_name(&global.name), &descriptor);
    }
    let origin = program_origin(program);
    code.ret(&origin, None);
    code.finish(pool).ok()
}

fn program_origin(program: &Program) -> nts_semantic_schema::Origin {
    program
        .funcs
        .first()
        .map_or_else(
            || {
                nts_semantic_schema::Origin::source(nts_diagnostics::Location {
                    file: nts_diagnostics::SourceId(0),
                    span: nts_diagnostics::Span::new(0, 0),
                })
            },
            |func| func.origin.clone(),
        )
}
