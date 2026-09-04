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
    // Whole-program, so refused whole. A Java array cannot grow, so a program
    // where any array does needs every array to be an object with a `double[]`
    // and a length inside it -- and `hir::arrays_can_grow` is true if *anything*
    // anywhere pushes. Measured across the corpus at false in 2 of 93 examples
    // and true in 20 of 23 `runtime/node` modules, so the wrapper is what real
    // code gets and the bare array is what a benchmark gets. Which side of that
    // cliff costs what is `benches/cases/growth-fixed` against `growth-grown`,
    // and the wrapper is not worth building before that number exists.
    if nts_core::hir::arrays_can_grow(program) {
        diagnostics.push(Diagnostic::error(
            "NTS4007",
            "this program grows an array, and a Java array cannot grow -- every \
             array in it would need a wrapper object, which this backend does \
             not build yet"
                .to_owned(),
            program_origin(program).location,
        ));
        return Emitted { classes: Vec::new(), diagnostics };
    }
    let mut builder = ClassBuilder::new(PROGRAM, "java/lang/Object");
    builder.access = access::PUBLIC | access::SUPER | access::FINAL;
    builder.source_file = Some("nts".to_owned());

    // Module-scope storage, as static fields. Private unless the program
    // exports it, for the reason the C backend makes it `static`: a name
    // outside the program is a name something outside can collide with.
    for global in &program.globals {
        let Some(descriptor) = types::descriptor(program, &global.ty) else {
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

    if let Some(body) = class_initializer(program, &mut pool) {
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
        let Some(descriptor) = types::descriptor(program, &field.ty) else {
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
        // The agreement that dispatch depends on, asserted where it is cheap.
        if let Some(inherited) = base
            .and_then(|b| b.methods.get(slot))
            .and_then(|m| m.as_ref())
            .and_then(|name| program.funcs.iter().find(|f| &f.name == name))
            .and_then(|f| instance_descriptor(program, f))
            .filter(|inherited| inherited != &descriptor)
        {
            {
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
        }

        let mut locals = vec![VType::Object(types::class_name(layout))];
        for param in target.params.iter().skip(1) {
            let Some(vtype) = types::vtype(program, &param.ty) else {
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
        builder.method(access::PUBLIC, member, descriptor, Some(rendered));
    }
    Ok(())
}

/// A dispatched method's descriptor as an *instance* method: its own signature
/// with the receiver dropped, because on the JVM the receiver is not a
/// parameter.
pub(crate) fn instance_descriptor(program: &Program, func: &nts_core::hir::Func) -> Option<String> {
    let mut params = Vec::with_capacity(func.params.len());
    for param in func.params.iter().skip(1) {
        params.push(types::descriptor(program, &param.ty)?);
    }
    func.params.first()?;
    let borrowed: Vec<&str> = params.iter().map(String::as_str).collect();
    Some(nts_jvm_emitter::descriptor::method(
        &borrowed,
        &types::descriptor(program, &func.return_type)?,
    ))
}

/// `<clinit>`, where a global that starts as something other than zero is set.
///
/// The JVM zeroes a static field, so a global whose initial value is zero needs
/// nothing -- which is most of them, and is why this returns `None` rather than
/// an empty method for a program with no interesting initializers.
fn class_initializer(program: &Program, pool: &mut Pool) -> Option<nts_jvm_emitter::Body> {
    let interesting: Vec<_> = program
        .globals
        .iter()
        .filter(|global| global.initial != 0.0 && types::descriptor(program, &global.ty).is_some())
        .collect();
    if interesting.is_empty() {
        return None;
    }
    let mut code = Code::new(Vec::<VType>::new(), 0);
    for global in interesting {
        let origin = global.origin.clone();
        let descriptor = types::descriptor(program, &global.ty)?;
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
