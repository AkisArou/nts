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

pub mod body;
pub mod hierarchy;
pub mod ops;
pub mod types;

use nts_core::hir::Program;
use nts_diagnostics::Diagnostic;
use nts_jvm_emitter::class::access;
use nts_jvm_emitter::code::Code;
use nts_jvm_emitter::{Class, ClassBuilder, Kind, Pool, VType};

pub use body::{PROGRAM, RUNTIME};

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
    let mut pool = Pool::new();
    let mut diagnostics = Vec::new();
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
    let mut builder = ClassBuilder::new(PROGRAM, "java/lang/Object");
    builder.access = access::PUBLIC | access::SUPER | access::FINAL;
    builder.source_file = Some("nts".to_owned());

    // Module-scope storage, as static fields. Private unless the program
    // exports it, for the reason the C backend makes it `static`: a name
    // outside the program is a name something outside can collide with.
    for global in &program.globals {
        let Some(descriptor) = types::descriptor(types::Shape::of(program), &global.ty) else {
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
    // layout at a time. `LambdaMetafactory` is wrong here for a reason that
    // arrives before Android's API 26: it does not promise one instance.
    let singletons = closure_singletons(program);
    for (field, class) in &singletons {
        builder.field(access::PRIVATE | access::STATIC | access::FINAL, field.clone(), format!("L{class};"));
    }

    if let Some(body) = class_initializer(program, &singletons, &mut pool) {
        builder.method(access::STATIC, "<clinit>", "()V", Some(body));
    }
    if let Err(error) = builder.default_constructor(&program_origin(program), &mut pool) {
        diagnostics.push(Diagnostic::error(
            "NTS4003",
            format!("the generated constructor could not be written: {error}"),
            program_origin(program).location,
        ));
    }

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
        match render(program, func, &mut pool) {
            Ok((name, signature, rendered)) => {
                builder.method(
                    access::PUBLIC | access::STATIC,
                    name,
                    signature,
                    Some(rendered),
                );
            }
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

    let mut classes = Vec::new();
    for layout in &program.layouts {
        match object_class(program, layout) {
            Ok(Some(class)) => classes.push(class),
            Ok(None) => {}
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

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
fn object_class(program: &Program, layout: &nts_core::hir::Layout) -> Result<Option<Class>, Diagnostic> {
    let origin = program_origin(program);
    let mut pool = Pool::new();
    let name = types::class_name(layout);
    let super_name = program
        .base_layout(layout)
        .and_then(|at| program.layouts.get(at))
        .map_or_else(|| "java/lang/Object".to_owned(), types::class_name);
    let mut builder = ClassBuilder::new(name, super_name);
    // `final` only where nothing extends it. A base class marked final is
    // rejected at load time, not at emit time, so this is the one place the
    // hierarchy has to be consulted for something other than a name.
    builder.access = if hierarchy::extended(program, layout) {
        access::PUBLIC | access::SUPER
    } else {
        access::PUBLIC | access::SUPER | access::FINAL
    };
    builder.source_file = Some("nts".to_owned());
    // Only what this class adds. A base's fields are a prefix of the derived's,
    // so redeclaring them here would give the object two of each and leave
    // `getfield` reading whichever the descriptor named.
    for field in hierarchy::declared(program, layout) {
        let Some(descriptor) = types::descriptor(types::Shape::of(program), &field.ty) else {
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
        builder.field(access::PUBLIC, body::method_name(&field.name), descriptor);
    }
    // A frame a `Suspend` names implements `NtsResumable`, with `resume()`
    // forwarding to the static body -- the same shape as a dispatch slot's
    // forwarder, and the reason promises are not blocked behind the closure
    // base question: this relationship is created here rather than recovered
    // from the IR.
    // A layout whose dispatched method is `()V` is something the runtime can
    // call without knowing its class, which is what a timer callback has to
    // be. Decided from the *descriptor* rather than from a list of class
    // names, so it stays true of whatever the lowering names a closure next.
    if layout.methods.iter().flatten().any(|name| {
        program
            .funcs
            .iter()
            .find(|func| &func.name == name)
            .and_then(|func| instance_descriptor(program, func))
            .is_some_and(|descriptor| descriptor == "()V")
    }) {
        builder.interfaces.push(types::CALLBACK.to_owned());
    }
    if let Some(resume) = resumes(program, layout) {
        builder.interfaces.push(types::RESUMABLE.to_owned());
        let origin = program_origin(program);
        let mut code = Code::new(vec![VType::Object(types::class_name(layout))], 1);
        code.load(&origin, Kind::Ref, 0);
        code.invoke_static(
            &origin,
            &mut pool,
            PROGRAM,
            &body::method_name(&resume),
            &format!("(L{};)V", types::class_name(layout)),
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

    dispatch_forwarders(program, layout, &mut builder, &mut pool)?;
    builder.default_constructor(&origin, &mut pool).map_err(|error| {
        Diagnostic::error(
            "NTS4003",
            format!("`{}` could not be given a constructor: {error}", layout.name),
            origin.location,
        )
    })?;
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
    program: &Program,
    func: &nts_core::hir::Func,
    pool: &mut Pool,
) -> Result<(String, String, nts_jvm_emitter::Body), Diagnostic> {
    let emitter = body::Emitter::new(program, func)?;
    let signature = body::signature(program, func)
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
fn dispatch_forwarders(
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
        let Some(full) = body::signature(program, target) else {
            return Err(Diagnostic::error(
                "NTS4008",
                format!("`{func_name}` has no representable signature to dispatch to"),
                origin.location,
            ));
        };
        let member = hierarchy::member_name(func_name);
        let descriptor = instance_descriptor(program, target).ok_or_else(|| {
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
        let bridge = bridge_for(program, layout, base, slot, &member, &descriptor, &origin)?;

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

        let mut locals = vec![VType::Object(types::class_name(layout))];
        for param in target.params.iter().skip(1) {
            let Some(vtype) = types::vtype(types::Shape::of(program), &param.ty) else {
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
        code.invoke_static(&origin, pool, PROGRAM, &body::method_name(func_name), &full);
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

/// The descriptor a bridge method needs, or `None` when the override agrees
/// with what it overrides and no bridge is called for.
///
/// Refuses when they disagree in a way the JVM has no answer for.
fn bridge_for(
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
        .and_then(|f| instance_descriptor(program, f))
        .filter(|inherited| inherited != descriptor)
    else {
        return Ok(None);
    };
    if !narrows_return(program, descriptor, &inherited) {
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
fn narrows_return(program: &Program, derived: &str, base: &str) -> bool {
    let Some((derived_params, derived_result)) = derived.split_once(')') else { return false };
    let Some((base_params, base_result)) = base.split_once(')') else { return false };
    if derived_params != base_params {
        return false;
    }
    let (Some(from), Some(to)) = (class_of(derived_result), class_of(base_result)) else {
        return false;
    };
    let Some(layout) = program.layouts.iter().find(|l| types::class_name(l) == from) else {
        return false;
    };
    hierarchy::ancestry(program, layout).iter().any(|a| types::class_name(a) == to)
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
pub(crate) fn instance_descriptor(program: &Program, func: &nts_core::hir::Func) -> Option<String> {
    let mut params = Vec::with_capacity(func.params.len());
    for param in func.params.iter().skip(1) {
        params.push(types::descriptor(types::Shape::of(program), &param.ty)?);
    }
    func.params.first()?;
    let borrowed: Vec<&str> = params.iter().map(String::as_str).collect();
    Some(nts_jvm_emitter::descriptor::method(
        &borrowed,
        &types::descriptor(types::Shape::of(program), &func.return_type)?,
    ))
}

/// The function that resumes this layout, where it is a suspended frame.
///
/// A scan of `Suspend` operations rather than a flag on the layout, for the
/// same reason `closure_singletons` scans: which layouts are frames is a fact
/// about the program's *operations*, and `object_class` sees one layout at a
/// time.
fn resumes(program: &Program, layout: &nts_core::hir::Layout) -> Option<String> {
    let wanted = types::class_name(layout);
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
            if program.layout(id).map(types::class_name).as_deref() == Some(wanted.as_str()) {
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
fn closure_singletons(program: &Program) -> Vec<(String, String)> {
    let mut found = std::collections::BTreeSet::new();
    for func in &program.funcs {
        for op in &func.values {
            if !matches!(op.kind, nts_core::hir::OpKind::ClosureStatic) {
                continue;
            }
            if let nts_core::hir::HirType::Managed(nts_core::hir::ManagedType::Object(id)) = op.ty
                && let Some(layout) = program.layout(id)
            {
                found.insert(types::class_name(layout));
            }
        }
    }
    found
        .into_iter()
        .map(|class| {
            let field = format!("closure${}", class.rsplit('/').next().unwrap_or(&class));
            (field, class)
        })
        .collect()
}

/// `<clinit>`, where a global that starts as something other than zero is set.
///
/// The JVM zeroes a static field, so a global whose initial value is zero needs
/// nothing -- which is most of them, and is why this returns `None` rather than
/// an empty method for a program with no interesting initializers.
fn class_initializer(
    program: &Program,
    singletons: &[(String, String)],
    pool: &mut Pool,
) -> Option<nts_jvm_emitter::Body> {
    let interesting: Vec<_> = program
        .globals
        .iter()
        .filter(|global| global.initial != 0.0 && types::descriptor(types::Shape::of(program), &global.ty).is_some())
        .collect();
    if interesting.is_empty() && singletons.is_empty() {
        return None;
    }
    let mut code = Code::new(Vec::<VType>::new(), 0);
    let origin = program_origin(program);
    for (field, class) in singletons {
        code.new_object(&origin, pool, class);
        code.dup(&origin);
        code.invoke_special(&origin, pool, class, "<init>", "()V");
        code.put_static(&origin, pool, PROGRAM, field, &format!("L{class};"));
    }
    for global in interesting {
        let origin = global.origin.clone();
        let descriptor = types::descriptor(types::Shape::of(program), &global.ty)?;
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
        code.put_static(&origin, pool, PROGRAM, &body::method_name(&global.name), &descriptor);
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
