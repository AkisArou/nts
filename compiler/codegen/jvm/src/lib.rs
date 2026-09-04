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

/// One class per layout: its fields, and the constructor `new` needs.
///
/// # No `super_class`, and how that is kept honest
///
/// `Layout` records fields and methods and not the class it extends, so this
/// emits every generated class as a direct subclass of `Object`. That is
/// correct for a program with no inheritance and *unverifiable* for one with
/// it: passing a `Square` where `(LShape;)D` is declared needs a real
/// `super_class`, and base-first field order is not one.
///
/// So a program where any layout's fields are a prefix of another's is refused
/// whole. That test over-refuses -- two unrelated types can share a prefix --
/// which is the right direction for a check standing in for a fact the IR does
/// not carry yet. `Layout.base` is the fix and it belongs upstream.
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
    if program.layouts.iter().any(|other| is_base_of(layout, other)) {
        return Err(Diagnostic::error(
            "NTS4005",
            format!(
                "`{}` looks like a base class, and this backend has no `super_class` \
                 to give it -- `Layout` records fields and methods but not what a \
                 class extends",
                layout.name
            ),
            origin.location,
        ));
    }
    let mut pool = Pool::new();
    let name = types::class_name(layout);
    let mut builder = ClassBuilder::new(name, "java/lang/Object");
    builder.access = access::PUBLIC | access::SUPER | access::FINAL;
    builder.source_file = Some("nts".to_owned());
    for field in &layout.fields {
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

/// Whether `maybe_base`'s fields are a proper prefix of `derived`'s, which is
/// what base-first layout makes inheritance look like from here.
fn is_base_of(maybe_base: &nts_core::hir::Layout, derived: &nts_core::hir::Layout) -> bool {
    !maybe_base.fields.is_empty()
        && derived.fields.len() > maybe_base.fields.len()
        && derived
            .fields
            .iter()
            .zip(&maybe_base.fields)
            .all(|(theirs, mine)| theirs.name == mine.name && theirs.ty == mine.ty)
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
