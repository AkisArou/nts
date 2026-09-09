//! Emitting C from HIR.
//!
//! # A printer, not a decision-maker
//!
//! Block order and the copies a block-parameter edge implies are decided in
//! `nts-codegen-common`, so nothing here chooses anything a JVM emitter would
//! have to choose again. What is left is spelling.
//!
//! # Scalars only, for now
//!
//! A managed reference needs a runtime — an allocator, a header, a collector —
//! and none of that exists yet. Rather than emit a plausible `char *` and pretend,
//! a function touching a managed type is refused. RFC §4.1 again: the failure has
//! to be visible.

pub use nts_codegen_common::symbols::{c_global, c_identifier};
use nts_codegen_common::symbols::c_member;
use nts_codegen_common::{CodeWriter, Copy, block_order, destruct};
use nts_core::hir::{
    BinOp, BlockId, Callee, Func, HirType, ManagedType, OpKind, Program, Terminator, UnOp, ValueId,
};
use nts_diagnostics::Diagnostic;
use nts_semantic_schema::Origin;

/// The C runtime, as source.
///
/// Real C compiled as its own translation unit rather than text pasted into
/// every generated file. It lives under `runtime/c/` and is included here, so
/// it can be read, edited and reviewed as C -- and so an unused external
/// function is not a warning, which is what let the whole "work out which
/// helpers this program reaches" apparatus be deleted.
pub const RUNTIME_HEADER_NAME: &str = "nts_runtime.h";
pub const RUNTIME_HEADER: &str = include_str!("../../../../runtime/c/nts_runtime.h");
/// The shortest-decimal algorithm, which `nts_runtime.c` includes.
///
/// A header rather than a translation unit for the same reason `quickjs/dtoa.c`
/// is: the several places that build a program name their `.c` files, and one
/// of them is not this session's to change.
pub const GRISU_HEADER_NAME: &str = "nts_grisu.h";
pub const GRISU_HEADER: &str = include_str!("../../../../runtime/c/nts_grisu.h");
pub const RUNTIME_SOURCE_NAME: &str = "nts_runtime.c";
pub const RUNTIME_SOURCE: &str = include_str!("../../../../runtime/c/nts_runtime.c");

/// The libuv host, for a standalone program.
///
/// Separate from the runtime because it is a *choice*: an embedder with its
/// own loop supplies its own host and links none of this, and a library
/// product has no loop at all (RFC §26.1). Written beside the program only
/// when one is asked for.
pub const UV_HOST_HEADER_NAME: &str = "nts_uv_host.h";
pub const UV_HOST_HEADER: &str = include_str!("../../../../runtime/c/nts_uv_host.h");
pub const UV_HOST_SOURCE_NAME: &str = "nts_uv_host.c";
pub const UV_HOST_SOURCE: &str = include_str!("../../../../runtime/c/nts_uv_host.c");

/// The vendored half of the runtime, shipped as a `quickjs/` subdirectory.
///
/// Mirroring the repository layout rather than flattening it, so that
/// `#include "quickjs/dtoa.c"` in `nts_runtime.c` resolves the same whether the
/// runtime is compiled from `runtime/c` or from a directory this emitted. A
/// flat layout would need two different spellings of the same include.
///
/// None of these is a translation unit. They are `#include`d, which is what
/// keeps the several places that build a program from having to agree about a
/// new `.c` file -- one of them is `tooling/conformance/build.sh`, and adding a
/// source to its explicit list is not always this session's to do.
pub const CUTILS_HEADER_NAME: &str = "quickjs/cutils.h";
pub const CUTILS_HEADER: &str = include_str!("../../../../runtime/c/quickjs/cutils.h");
pub const DTOA_HEADER_NAME: &str = "quickjs/dtoa.h";
pub const DTOA_HEADER: &str = include_str!("../../../../runtime/c/quickjs/dtoa.h");
pub const DTOA_SOURCE_NAME: &str = "quickjs/dtoa.c";
pub const DTOA_SOURCE: &str = include_str!("../../../../runtime/c/quickjs/dtoa.c");

/// Unicode case conversion, which is a table rather than an algorithm.
///
/// # Why it is not part of the runtime
///
/// `dtoa` is: `String(x)` is in nearly every program and it is 12 KB with no
/// tables. These are 63 KB of tables that most programs never read, and linking
/// them takes `examples/hello` from 81 KB to 162 KB -- so they are emitted only
/// for a program that calls one of the methods, the same way the libuv host is
/// written only when a loop is asked for. `needs_unicode` says which.
pub const UNICODE_HEADER_NAME: &str = "nts_unicode.h";
pub const UNICODE_HEADER: &str = include_str!("../../../../runtime/c/nts_unicode.h");
pub const LIBUNICODE_HEADER_NAME: &str = "quickjs/libunicode.h";
pub const LIBUNICODE_HEADER: &str = include_str!("../../../../runtime/c/quickjs/libunicode.h");
pub const LIBUNICODE_TABLE_NAME: &str = "quickjs/libunicode-table.h";
pub const LIBUNICODE_TABLE: &str =
    include_str!("../../../../runtime/c/quickjs/libunicode-table.h");
pub const LIBUNICODE_SOURCE_NAME: &str = "quickjs/libunicode.c";
pub const LIBUNICODE_SOURCE: &str = include_str!("../../../../runtime/c/quickjs/libunicode.c");
pub const UNICODE_SOURCE_NAME: &str = "nts_unicode.c";
pub const UNICODE_SOURCE: &str = include_str!("../../../../runtime/c/nts_unicode.c");

/// One file a program needs beside `program.c`.
///
/// `compiled` is what separates a translation unit from a header: the caller
/// puts those on the command line and merely writes the rest. Saying it here
/// rather than letting each caller match on `.c` means the several places that
/// build a program cannot disagree about it -- and there is nothing to get
/// wrong when a helper arrives with a new file.
#[derive(Debug)]
pub struct Support {
    pub name: &'static str,
    pub contents: &'static str,
    pub compiled: bool,
}

impl Support {
    /// Write this file under `out`, making the `quickjs/` subdirectory if the
    /// name asks for one.
    ///
    /// A shared helper because a name with a directory in it is easy to write
    /// with `fs::write` and have fail at run time, in each of the several
    /// places that write these.
    ///
    /// # Errors
    ///
    /// If the directory cannot be made or the file cannot be written.
    pub fn write(&self, out: &std::path::Path) -> std::io::Result<std::path::PathBuf> {
        let path = out.join(self.name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, self.contents)?;
        Ok(path)
    }
}

/// Every file a program needs beside `program.c`, given whether it converts case.
#[must_use]
pub fn support_files(needs_unicode: bool) -> Vec<Support> {
    let one = |name, contents, compiled| Support {
        name,
        contents,
        compiled,
    };
    let mut files = vec![
        one(RUNTIME_HEADER_NAME, RUNTIME_HEADER, false),
        // `nts_runtime.c` includes `quickjs/dtoa.c`, so these travel with it
        // always -- `String(x)` is in nearly every program.
        one(CUTILS_HEADER_NAME, CUTILS_HEADER, false),
        one(DTOA_HEADER_NAME, DTOA_HEADER, false),
        one(DTOA_SOURCE_NAME, DTOA_SOURCE, false),
        one(GRISU_HEADER_NAME, GRISU_HEADER, false),
        one(RUNTIME_SOURCE_NAME, RUNTIME_SOURCE, true),
    ];
    if needs_unicode {
        files.extend([
            one(UNICODE_HEADER_NAME, UNICODE_HEADER, false),
            one(LIBUNICODE_HEADER_NAME, LIBUNICODE_HEADER, false),
            one(LIBUNICODE_TABLE_NAME, LIBUNICODE_TABLE, false),
            one(LIBUNICODE_SOURCE_NAME, LIBUNICODE_SOURCE, false),
            one(UNICODE_SOURCE_NAME, UNICODE_SOURCE, true),
        ]);
    }
    files
}

/// The `main` of a standalone program.
///
/// What an executable *is*, in one function: evaluate the module, then run the
/// loop until nothing is left, then shut down. That is what node does with
/// `node main.js`, and it is why the module's top-level code is the program
/// rather than some exported entry point being one.
///
/// `initializes` is whether the program has any top-level code. A program that
/// is only declarations has nothing to evaluate, and calling a function that
/// was never emitted is a link error.
#[must_use]
pub fn standalone_main(initializes: bool) -> String {
    let declare = if initializes {
        "/* Emitted only when the program has top-level code to evaluate. */\nvoid module__init(void);\n\n"
    } else {
        ""
    };
    let evaluate = if initializes {
        "    module__init();\n    /* Module evaluation is itself a job, so what it queued is drained\n     * here rather than at the first thing the loop runs. */\n    nts_enter();\n    nts_leave();\n"
    } else {
        "    /* No top-level code, so nothing to evaluate. */\n"
    };
    format!(
        "/* Before any header: libuv's Unix header names POSIX types that a\n\
         \x20* strict `-std=c11` translation unit cannot see, and a feature-test\n\
         \x20* macro set after the first system header has no effect. */\n\
         #if defined(__linux__) && !defined(_GNU_SOURCE)\n\
         #define _GNU_SOURCE\n\
         #endif\n\
         \n\
         #include \"nts_runtime.h\"\n\
         #include \"nts_uv_host.h\"\n\
         \n\
         {declare}\
         int main(void) {{\n\
         \x20   nts_uv_host_install(uv_default_loop());\n\
         {evaluate}\
         \x20   /* Until nothing is runnable, no timer is pending, and no\n\
         \x20    * foreign completion is in flight. */\n\
         \x20   nts_uv_host_run();\n\
         \x20   /* Closes every handle and drops whatever is still queued: a\n\
         \x20    * task owns a reference, and the contract is that whoever\n\
         \x20    * holds it either runs it or gives it back. */\n\
         \x20   nts_uv_host_shutdown();\n\
         \x20   return 0;\n\
         }}\n"
    )
}

/// Every value some operation or terminator in a function reads.
fn values_read(func: &Func) -> rustc_hash::FxHashSet<ValueId> {
    let mut read = rustc_hash::FxHashSet::default();
    for block in &func.blocks {
        read.extend(nts_core::hir::operands_of_terminator(&block.terminator));
        for value in &block.ops {
            read.extend(nts_core::hir::operands_of(
                &func.values[value.0 as usize].kind,
            ));
        }
    }
    read
}

/// What an emitter needs beyond the function it is emitting.
///
/// Layouts come from the program because a field's name and position are a
/// property of its *type*, not of the function reading it; literals come from
/// the program because two functions naming the same string must reach the same
/// static.
struct Context<'a> {
    program: &'a Program,
    literals: &'a [String],
    /// Values something in this function reads.
    ///
    /// A call whose result nobody wants still has to happen, so dead-code
    /// elimination keeps it — but assigning it to a local nobody reads is
    /// `-Wunused-but-set-variable`, which is an error under the flags the
    /// generated file is compiled with. `c.advance();` as a statement is
    /// exactly that.
    read: rustc_hash::FxHashSet<ValueId>,
}

/// C for one program, and what could not be emitted.
#[derive(Debug)]
pub struct Emitted {
    pub writer: CodeWriter,
    pub diagnostics: Vec<Diagnostic>,
    /// Whether the program calls something `nts_unicode.h` declares.
    ///
    /// Decided from the HIR because the `#include` has to be written before the
    /// body exists, and kept beside the text scan below rather than replacing
    /// it -- see [`Emitted::needs_unicode`].
    pub(crate) unicode: bool,
}

impl Emitted {
    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.diagnostics.is_empty()
    }

    /// Whether this program needs the Unicode tables beside it.
    ///
    /// Two answers, and both are kept. The text scan is the original and its
    /// reason still holds: the text is what gets compiled, so a helper the
    /// lowering emits by some route nobody enumerated still appears here, and
    /// the failure mode of missing one is a link error rather than a wrong
    /// answer.
    ///
    /// What it cannot do is decide the `#include`, which is written before
    /// there is any text to scan. So the HIR is asked as well -- does any call
    /// name something the header declares -- and the two are or'd. The scan
    /// catching something the walk missed writes the files without the include,
    /// which is the state this had before and still links.
    #[must_use]
    pub fn needs_unicode(&self) -> bool {
        let source = self.writer.text();
        self.unicode
            || source.contains("nts_str_to_lower_case")
            || source.contains("nts_str_to_upper_case")
    }

    /// The files to write beside `program.c`, this program's set.
    #[must_use]
    pub fn support_files(&self) -> Vec<Support> {
        support_files(self.needs_unicode())
    }
}

/// Emit a whole program as one translation unit.
/// Drop every body that calls a function this backend refused, to a fixed point.
///
/// `drop_callers_of_refused` does this for a *lowering* refusal, and it runs
/// before any backend sees the program, so it cannot see one made here. The
/// result was a translation unit that called a symbol nothing defines: node's
/// `punycode` refused `error(type): never` and emitted its eight call sites
/// anyway. A refusal that leaves its callers behind is not a refusal, it is a
/// link error with a diagnostic attached -- and the only reason it was not
/// silent is that C wants a definition at link time.
///
/// A loop rather than one pass: dropping a caller can orphan its own caller,
/// and the fixed point is what `drop_callers_of_refused` computes for the same
/// reason.
///
/// Direct calls only. A dropped function that a dispatch table names used to be
/// left as a dangling symbol on the argument that a null slot is worse than a
/// link error -- true while nothing checked the slot. It is not true now:
/// `emit_object_descriptors` takes the surviving names, writes null for a slot
/// whose body is gone, and refuses the one case where null is reachable, which
/// is a closure. So the table agrees with the bodies, and the case that would
/// have been a silent crash is a diagnostic instead.
fn drop_orphaned_bodies(
    bodies: &mut Vec<(String, CodeWriter, &Func)>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    loop {
        let defined: rustc_hash::FxHashSet<&str> =
            bodies.iter().map(|(_, _, func)| func.name.as_str()).collect();
        // The ops each block still *holds*, not every value the function ever
        // made. A `ValueId` is an index -- so is a field and so is a block --
        // which means a pass cannot renumber and taking an op out of the
        // control flow leaves it behind in the value list. Scanning that list
        // reports a call nothing will emit, and this is the third place tonight
        // that made the same mistake: `hir::drop_callers_of_refused` looped
        // forever re-finding an excised call, `verify::check_calls` refused to
        // emit `os` over one, and this dropped `module#init` after
        // `excise_from_initializer` had removed exactly the call it names --
        // which the addon still calls, so the module linked and died at
        // `dlopen` with an undefined symbol.
        let orphan = bodies.iter().enumerate().find_map(|(at, (_, _, func))| {
            func.blocks
                .iter()
                .flat_map(|block| block.ops.iter())
                .find_map(|value| match &func.values[value.0 as usize].kind {
                    OpKind::Call {
                        callee: Callee::Direct(name),
                        ..
                    } if !defined.contains(name.as_str()) => Some((
                        at,
                        name.clone(),
                        func.values[value.0 as usize].origin.clone(),
                    )),
                    _ => None,
                })
        });
        let Some((at, missing, origin)) = orphan else {
            return;
        };
        let orphaned = bodies[at].2.name.clone();
        diagnostics.push(Diagnostic::error(
            "NTS2009",
            format!(
                "`{orphaned}` cannot be emitted because it calls `{missing}`, which this \
                 backend refused above"
            ),
            origin.location,
        ));
        bodies.remove(at);
    }
}

#[must_use]
pub fn emit(program: &Program) -> Emitted {
    let mut writer = CodeWriter::new();
    let mut diagnostics = Vec::new();
    let unicode = uses_unicode(program);

    let Some(first) = program.funcs.first() else {
        return Emitted {
            writer,
            diagnostics,
            unicode,
        };
    };
    let origin = first.origin.clone();

    // Each function is emitted speculatively and kept only if it succeeded. A
    // half-emitted function is worse than an absent one: it declares a signature
    // and a body that does not return, which compiles into a callable shell.
    // Two different TypeScript names can mangle to one C name — `double` and
    // `double_` both become `double_`. Emitting both would produce a redefinition
    // error far from its cause, so it is caught here where the cause is known.
    let mut claimed: rustc_hash::FxHashMap<String, &str> = rustc_hash::FxHashMap::default();
    for func in &program.funcs {
        let c_name = c_identifier(&func.name);
        if let Some(previous) = claimed.insert(c_name.clone(), &func.name)
            && previous != func.name
        {
            diagnostics.push(Diagnostic::error(
                "NTS2004",
                format!(
                    "`{}` and `{previous}` both need the C name `{c_name}`",
                    func.name
                ),
                func.origin.location,
            ));
        }
    }

    // Collected before emission so that every reference names the same static.
    //
    // From the values each block still *executes*, not from every value the
    // function defines. Dead-code elimination leaves the definitions behind --
    // they are addressed by index, so removing one would renumber the rest --
    // and a static nothing reads is an error under `-Wunused-const-variable`,
    // which is the setting that makes a warning from generated code a compiler
    // bug rather than a style preference.
    let mut literals: Vec<String> = Vec::new();
    for func in &program.funcs {
        for block in &func.blocks {
            for value in &block.ops {
                if let OpKind::ConstString(text) = &func.values[value.0 as usize].kind
                    && !literals.contains(text)
                {
                    literals.push(text.clone());
                }
            }
        }
    }

    let mut bodies = emit_bodies(program, &literals, &mut diagnostics);
    drop_orphaned_bodies(&mut bodies, &mut diagnostics);
    // The C names of the functions this translation unit will actually define,
    // after the backend's own refusals have taken their callers with them.
    // `program.funcs` is the wrong list: it still holds the bodies dropped just
    // above, and a dispatch table built from it names them.
    let defined: rustc_hash::FxHashSet<String> =
        bodies.iter().map(|(_, _, func)| c_identifier(&func.name)).collect();

    let descriptors = descriptors_reached(&bodies);

    writer.line(&origin, "/* Generated by nts. Do not edit. */");
    // The runtime, and nothing else -- notably not <stdlib.h>, which declares
    // `div`, a name a TypeScript program is entitled to use.
    writer.line(&origin, format!("#include \"{RUNTIME_HEADER_NAME}\""));
    // The Unicode header, where the program reaches one of its helpers.
    //
    // Its helpers are declared there and defined in `nts_unicode.c`, which is
    // already compiled and linked -- only the prototype was ever missing. The
    // emitter used to supply one from the *call's* argument types, which
    // differed from the header by a `const` and made the two impossible to see
    // at once: `conflicting types for 'nts_str_to_lower_case'` the moment
    // anything included both.
    //
    // Including it here rather than force-including it at the build is what
    // makes the file self-describing: a generated translation unit names the
    // headers it needs, and every caller of `emit-c` gets the same answer
    // without a flag. `runtime/node/build.sh` had to revert exactly that flag
    // because of the conflict, and now needs no flag at all.
    if unicode {
        writer.line(&origin, format!("#include \"{UNICODE_HEADER_NAME}\""));
    }
    emit_object_types(&mut writer, &origin, program, &mut diagnostics);

    // Forward declarations, so a call does not depend on definition order — and
    // only for functions that actually have a definition. Before the
    // descriptors, because a dispatch table takes the address of a function and
    // C wants that declared.
    for (signature, _, _) in &bodies {
        writer.line(&origin, format!("{signature};"));
    }
    // And for the functions it calls and does *not* define. A
    // `declare function` is a promise that a symbol exists at link time, and
    // without a prototype the call is an implicit declaration -- which C99
    // removed and clang rejects.
    // Collected rather than aborted. One binding this cannot declare used to
    // discard **every** prototype in the program, so a single unspellable
    // return turned into an implicit declaration for every other binding the
    // module calls -- a much larger failure than the one being reported, and
    // reported as something else entirely.
    match external_prototypes(program) {
        Ok(prototypes) => {
            for prototype in prototypes {
                writer.line(&origin, prototype);
            }
        }
        Err((prototypes, refusals)) => {
            for prototype in prototypes {
                writer.line(&origin, prototype);
            }
            diagnostics.extend(refusals);
        }
    }
    writer.blank(&origin);

    emit_object_descriptors(&mut writer, &origin, program, &defined, &mut diagnostics);
    emit_descriptors(&mut writer, &origin, &descriptors);
    emit_literals(&mut writer, &origin, &literals);
    if let Err(diagnostic) = emit_globals(&mut writer, program) {
        diagnostics.push(diagnostic);
    }
    emit_closure_call_slot(&mut writer, &origin, program);

    for (_, body, _) in bodies {
        writer.append(body);
    }

    Emitted {
        writer,
        diagnostics,
        unicode,
    }
}

/// Prototypes for every function this program calls and does not define.
///
/// The signature comes from the call sites, because that is the only place it
/// exists: an external callee has no `Func` to read parameters off. Where two
/// calls disagree the program is asking for one symbol with two signatures,
/// which C would take and the linker would not, so it is a diagnostic here.
///
/// # Why the runtime's own helpers are excluded by asking rather than by name
///
/// They are already declared by the included header, and declaring them twice
/// with types derived from a call site would conflict with the real
/// declaration. The test is whether the header mentions the name, not whether
/// the name starts with `nts_`: a program is entitled to write
/// `declare function nts_process_cwd()`, and a naming convention would silently
/// leave that one undeclared -- which is the bug this function exists to fix.
type Prototypes = Result<Vec<String>, (Vec<String>, Vec<Diagnostic>)>;

fn external_prototypes(program: &Program) -> Prototypes {
    let mut seen: rustc_hash::FxHashMap<&str, String> = rustc_hash::FxHashMap::default();
    let mut prototypes = Vec::new();
    let mut refusals: Vec<Diagnostic> = Vec::new();
    for func in &program.funcs {
        for op in &func.values {
            let OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } = &op.kind
            else {
                continue;
            };
            if runtime_declares(name) {
                continue;
            }
            let mut parameters = Vec::new();
            let mut unnameable = false;
            for arg in args {
                let ty = &func.values[arg.0 as usize].ty;
                if crosses_as_header(ty) {
                    parameters.push("NtsHeader *".to_owned());
                    continue;
                }
                match c_type_of(program, ty, &op.origin) {
                    Ok(named) => parameters.push(named),
                    Err(why) => {
                        refusals.push(why);
                        unnameable = true;
                        break;
                    }
                }
            }
            if unnameable {
                continue;
            }
            if parameters.is_empty() {
                parameters.push("void".to_owned());
            }
            // The return takes the same escape the parameters above take, and
            // did not. A `declare function` returning an object emitted
            // `NtsObj_AsyncContextFrame * nts_async_context_get(void);` -- a
            // per-program struct name, which the one hand-written definition
            // every program links against cannot spell. So the symbol stayed
            // undefined in **14 of the 20 addons that build**, and a shared
            // object binds lazily, so each of them loaded, reported "builds and
            // loads", and would have aborted on the first call.
            //
            // Found with `nm -D` on the built artifacts rather than from the
            // source, by the Node lane, after `build-floor.sh` had been saying
            // "builds and loads" about all of them.
            let returns = match returned_shape(program, &op.ty) {
                Returned::Header => "NtsHeader *".to_owned(),
                // Reported where the *caller* is dropped, not here. A
                // prototype nothing calls is dead text; a body that calls it
                // emits an assignment clang rejects, so the body is the thing
                // that has to go and the diagnostic belongs beside it.
                Returned::Tuple => continue,
                Returned::Own => match c_type_of(program, &op.ty, &op.origin) {
                    Ok(named) => named,
                    Err(why) => {
                        refusals.push(why);
                        continue;
                    }
                },
            };
            let prototype = format!(
                "{} {}({});",
                returns,
                c_identifier(name),
                parameters.join(", ")
            );
            match seen.get(name.as_str()) {
                Some(existing) if *existing != prototype => {
                    refusals.push(Diagnostic::error(
                        "NTS2007",
                        format!(
                            "`{name}` is called with two different signatures, so there is no \
                             one declaration to emit: `{existing}` and `{prototype}`"
                        ),
                        op.origin.location,
                    ));
                }
                Some(_) => {}
                None => {
                    seen.insert(name.as_str(), prototype.clone());
                    prototypes.push(prototype);
                }
            }
        }
    }
    prototypes.sort();
    if refusals.is_empty() {
        Ok(prototypes)
    } else {
        Err((prototypes, refusals))
    }
}

/// Whether the runtime header already declares a name.
///
/// A whole-word search, so `nts_str_slice` does not count as a declaration of
/// `nts_str_slice_into`.
/// Whether the program calls anything `nts_unicode.h` declares.
///
/// Over the HIR rather than the emitted text, because this decides the
/// `#include` and that line is written first. `Emitted::needs_unicode` keeps
/// the text scan beside it for what this cannot see.
fn uses_unicode(program: &Program) -> bool {
    program.funcs.iter().any(|func| {
        func.values.iter().any(|op| {
            matches!(&op.kind, OpKind::Call { callee: Callee::External(name), .. }
                if declares_the_name(UNICODE_HEADER, name))
        })
    })
}

fn runtime_declares(name: &str) -> bool {
    // Every header the build force-includes, not only the main one.
    //
    // A prototype is emitted from the *call's* argument types, because for an
    // arbitrary `declare function` that is all there is. Where a header already
    // declares the name, the header is the one declaration and this must emit
    // none -- and asking only `nts_runtime.h` meant `nts_unicode.h`'s helpers
    // got a second, generated one:
    //
    //     nts_unicode.h  NtsString *nts_str_to_lower_case(const NtsString *s);
    //     program.c      NtsString * nts_str_to_lower_case(NtsString *);
    //
    // A `const` apart, invisible while nothing included both, and
    // `conflicting types` the moment `build.sh` force-included the header so
    // that `process` could reach three declared-and-defined helpers. The node
    // lane reverted that change rather than take a module's three errors at the
    // cost of two modules that build.
    //
    // Listed rather than derived because the set is small and each entry is a
    // decision: these are the headers a generated translation unit is compiled
    // against, and a header it is *not* compiled against must still get a
    // prototype or the call will not link.
    [RUNTIME_HEADER, UNICODE_HEADER, GRISU_HEADER]
        .iter()
        .any(|header| declares_the_name(header, name))
}

/// Whether a header declares exactly this name, on a word boundary, as a
/// function.
///
/// Three conditions and each one is load-bearing.
///
/// **A word boundary**, because substring alone answers yes for `nts_str_at`
/// inside `nts_str_at_into`, which is a different helper with a different
/// signature.
///
/// **Followed by `(`**, because a header is mostly prose and a name that
/// appears in a comment is not a declaration.
///
/// **Prefixed `nts_`**, because these headers are searched for names taken from
/// the *program*, and a program may name anything. `declare function f(...)` in
/// TypeScript is an ambient function called `f`, and a bare `f` occurs in any
/// large C file -- so the search concluded a header had declared it, emitted no
/// prototype, and produced `call to undeclared function 'f'`. The corpus found
/// that within an hour of the search widening from one header to three; on one
/// header it had been latent for as long as this existed.
fn declares_the_name(header: &str, name: &str) -> bool {
    if !name.starts_with("nts_") {
        return false;
    }
    header.match_indices(name).any(|(at, _)| {
        let before = header[..at].chars().next_back();
        let rest = &header[at + name.len()..];
        let boundary = |c: Option<char>| !c.is_some_and(|c| c.is_alphanumeric() || c == '_');
        boundary(before) && rest.trim_start().starts_with('(')
    })
}

/// The C name of a string literal's static data.
fn literal_name(literals: &[String], text: &str) -> String {
    let index = literals.iter().position(|known| known == text).unwrap_or(0);
    format!("nts_str_{index}")
}

/// Whether a runtime helper takes a managed reference of any class here.
///
/// The header spells that `NtsHeader *`, which C will not accept a
/// `NtsObj_Error *` for without being told -- and every managed object in a
/// program is one of those. A *string* is a `NtsHeader` by typedef, so a
/// `Promise<string>` worked and a `Promise<SomeClass>` did not, which is the
/// kind of gap that shows up as one payload type failing and the rest passing.
/// Whether a value crosses to a hand-written binding as its header pointer.
///
/// A binding is C somebody wrote, in a file that cannot include the generated
/// header: `NtsObj_Closure14` is a name this compilation invented and the next
/// one will invent a different one. So a class instance and a closure cross as
/// `NtsHeader *`, which every managed object begins with, and the binding casts
/// back if it needs to.
///
/// This is why `nts_node.h` declares `void nts_node_enqueue_microtask(NtsHeader
/// *callback)` and why its comment says naming the parameter otherwise "is what
/// produced the incompatible-pointer clang error in three modules". The header
/// was right and the emitter was generating a prototype from the *call's*
/// argument types, so the two disagreed and neither could be changed to match
/// the other: the binding cannot name the struct and the call cannot know the
/// binding.
///
/// A string, an array, a map and a view are **not** here. Their C types are the
/// runtime's own -- `NtsString *`, `NtsArray *` -- so a binding can name them,
/// and `runtime/node`'s bindings do.
/// Every function this translation unit will define, and the refusals that took
/// the rest.
///
/// Split from [`emit`] for the length limit, and it is the natural seam: above
/// it is what the file needs before any function can be written, below it is
/// what the file does with the functions it got.
fn emit_bodies<'a>(
    program: &'a Program,
    literals: &[String],
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<(String, CodeWriter, &'a Func)> {
    // The bindings whose return this backend cannot declare, and the bodies
    // that call them. Computed before anything is emitted, because a body that
    // calls one produces an assignment clang rejects -- `os` lost every export
    // over `nts_os_cpus` alone, where dropping the one function that reads it
    // leaves the other twenty-two.
    let unspellable = unspellable_returns(program);
    let mut bodies = Vec::new();
    for func in &program.funcs {
        if let Some((binding, origin)) = calls_unspellable(func, &unspellable) {
            diagnostics.push(unspellable_refusal(&func.name, binding, origin));
            continue;
        }
        // An `abstract` method is a signature and no body. It is in `funcs` so
        // that a call through the slot can take its function-pointer type from
        // it; nothing calls it and no vtable names it, because an abstract
        // class is never instantiated. Emitting the stub gave clang an
        // `unused function 'Shape__area'` under `-Werror`, which only the
        // benchmark build turns on -- so `examples/abstract-methods` passed and
        // `benches/cases/upcast` did not.
        if func.abstract_declaration {
            continue;
        }
        let mut body = CodeWriter::new();
        let context = Context {
            program,
            literals,
            read: values_read(func),
        };
        match emit_func(&mut body, func, &context) {
            Ok(signature) => bodies.push((signature, body, func)),
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

    bodies
}

/// Why a body that calls an unspellable binding is not emitted.
fn unspellable_refusal(caller: &str, binding: &str, origin: &Origin) -> Diagnostic {
    Diagnostic::error(
        "NTS2010",
        format!(
            "`{caller}` cannot be emitted because it calls `{binding}`, which returns a \
             tuple whose elements are not all one type -- its layout is numbered per \
             program, so no C definition can name the type this call expects, and one \
             returning an `NtsArray` would be read as a struct"
        ),
        origin.location,
    )
}

/// The `declare function` names whose return no shared C definition can spell.
fn unspellable_returns(program: &Program) -> rustc_hash::FxHashSet<String> {
    let mut found = rustc_hash::FxHashSet::default();
    for func in &program.funcs {
        for op in &func.values {
            if let OpKind::Call { callee: Callee::External(name), .. } = &op.kind
                && !runtime_declares(name)
                && matches!(returned_shape(program, &op.ty), Returned::Tuple)
            {
                found.insert(name.clone());
            }
        }
    }
    found
}

/// The first such binding this body calls, if any.
///
/// Over the blocks rather than `func.values`, for `drop_callers_of_refused`'s
/// reason one layer up: a value list keeps every op the lowering ever made,
/// including ones a pass has taken out of the control flow, so a call that
/// cannot run would drop a body that is fine.
fn calls_unspellable<'a>(
    func: &'a Func,
    unspellable: &rustc_hash::FxHashSet<String>,
) -> Option<(&'a str, &'a Origin)> {
    func.blocks
        .iter()
        .flat_map(|block| block.ops.iter())
        .find_map(|value| {
            let op = &func.values[value.0 as usize];
            match &op.kind {
                OpKind::Call { callee: Callee::External(name), .. }
                    if unspellable.contains(name) =>
                {
                    Some((name.as_str(), &op.origin))
                }
                _ => None,
            }
        })
}

/// What a binding's *return* type can be written as.
///
/// The `NtsHeader *` escape that parameters take is right for a value the C
/// side received and is handing back -- `nts_async_context_get` returns the
/// pointer `nts_async_context_set` was given, so the C never builds one and the
/// cast back at the call site is sound.
///
/// **It is wrong for a value the C side builds**, and a tuple is always that.
/// `nts_os_cpus` constructs a two-element `NtsArray` of references while the
/// compiler represents `[string[], number[]]` as a struct with two fields.
/// Writing `NtsHeader *` on both makes the declarations agree and lets the
/// program read struct fields out of an array header -- a build failure turned
/// into a silently wrong program, which is the worse of the two. The clang
/// error was doing useful work and this refuses in its place, with a sentence
/// saying why rather than `conflicting types for 'nts_os_cpus'`.
enum Returned {
    /// An object the C side can only have been given: escapes to `NtsHeader *`.
    Header,
    /// A tuple, whose layout is per-program and which no binding can build.
    Tuple,
    /// Anything a shared definition can already name.
    Own,
}

fn returned_shape(program: &Program, ty: &HirType) -> Returned {
    let HirType::Managed(ManagedType::Object(id)) = ty else {
        return Returned::Own;
    };
    let tuple = program
        .layouts
        .iter()
        .find(|layout| layout.types.contains(id))
        .is_some_and(|layout| nts_core::hir::is_tuple_layout_name(&layout.name));
    if tuple { Returned::Tuple } else { Returned::Header }
}

fn crosses_as_header(ty: &HirType) -> bool {
    matches!(ty, HirType::Managed(ManagedType::Object(_)))
}

/// Every parameter the runtime declares as `NtsHeader *`, by helper and
/// position.
///
/// The runtime stores one reference slot for every payload, so a helper that
/// takes *any* managed value names the base header and the caller supplies the
/// class. Our value has the class -- `NtsArray *`, `NtsObj_Foo *` -- and C
/// rejects the narrowing on the way in, so the cast is written here.
///
/// This was a hand-kept list of the four positions someone had hit, and it went
/// stale three times: `nts_promise_fulfill_tagged` is the same helper as
/// `nts_promise_fulfill_reference` with a tag, one line below it in the header,
/// and an `async` function returning an array is the most ordinary program that
/// reaches it. So it is no longer kept by hand. The header is the authority,
/// every position it declares is here, and `the_erasures_still_match_the_header`
/// reads it back out of clang.
///
/// Listing a position the emitter never reaches costs nothing: a cast to
/// `NtsHeader *` on a value that is already one is a cast to its own type.
const ERASES_CLASS: &[(&str, usize)] = &[
    ("nts_callback_task", 0),
    ("nts_concat_into", 0),
    ("nts_environment_install_platform", 0),
    ("nts_number_to_string_into", 0),
    ("nts_promise_fulfill_reference", 1),
    ("nts_promise_fulfill_tagged", 1),
    ("nts_promise_reject", 1),
    ("nts_release", 0),
    ("nts_retain", 0),
    ("nts_set_timeout", 0),
    ("nts_str_at_into", 0),
    ("nts_str_char_at_into", 0),
    ("nts_str_slice_into", 0),
    ("nts_str_substring_general", 0),
    ("nts_str_substring_into", 0),
    ("nts_str_substring_into_fn", 0),
    ("nts_string_from_char_code_into", 0),
    ("nts_string_from_code_point_into", 0),
    ("nts_tag_of_reference", 0),
    ("nts_value_eq_reference", 1),
    ("nts_value_of_reference", 0),
];

fn erases_class(callee: &str, at: usize) -> bool {
    ERASES_CLASS.binary_search(&(callee, at)).is_ok()
}

/// Whether a runtime helper *returns* a managed reference of any class.
///
/// The mirror of [`erases_class`], and it needs the same treatment for the
/// same reason: the runtime stores one reference slot for every payload, so it
/// hands back `NtsHeader *` and the caller supplies the class. The caller can,
/// because the payload's representation is in the type -- that is what
/// `ManagedType::Promise` carries it for.
///
/// A string and an object both went unnoticed here, because assigning to a
/// `NtsString *` from a `NtsHeader *` is the typedef and C allows it. An array
/// payload is the first one C objects to, which is a warning about how narrow
/// the accident of a passing test can be.
fn erases_result(callee: &str) -> bool {
    matches!(callee, "nts_promise_reference" | "nts_environment_platform")
}

/// A call: static, external, or through the receiver's dispatch table.
fn call_text(
    func: &Func,
    name: &str,
    value: ValueId,
    callee: &Callee,
    args: &[ValueId],
    context: &Context<'_>,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    // A virtual call names the implementation the receiver's *static* type would
    // reach. That is not the one that runs -- the table decides that -- but it
    // is what gives the call its signature, and an override has the same
    // signature by definition.
    //
    // A *closure* call has no such declaration -- every closure of a type has
    // its own implementation -- so its signature comes from the call site
    // instead, which knows the argument types and the result type exactly.
    let target = match callee {
        Callee::Direct(target)
        | Callee::External(target)
        | Callee::Virtual {
            declared: target, ..
        } => target.as_str(),
        Callee::Closure { .. } => "",
    };

    // A derived object passed where a base is expected. The layout is base
    // first, so the two agree on every field the base has and the cast is a
    // no-op -- but C will not take one pointer for the other without being told,
    // and `super(...)` does exactly this.
    //
    // Only an *up*cast is reachable here: TypeScript checked assignability
    // before any of this ran, so an argument that is not the parameter's type is
    // a subtype of it.
    let declared = context
        .program
        .funcs
        .iter()
        .find(|func| func.name == target)
        .map(|func| &func.params);
    let arguments: Vec<String> = args
        .iter()
        .enumerate()
        .map(|(at, argument)| {
            // A runtime helper that takes a managed reference of *any* class
            // is declared in the header as `NtsHeader *`, and the emitter has
            // no signature for it -- `declared` only covers functions the
            // program itself defines. A string is already an `NtsHeader`, so
            // this went unnoticed until an object payload reached one.
            // A runtime helper by name, or any object crossing to a binding
            // the compiler declared itself -- see `crosses_as_header`.
            if erases_class(target, at)
                || (matches!(callee, Callee::External(_))
                    && !runtime_declares(target)
                    && crosses_as_header(&func.values[argument.0 as usize].ty))
            {
                return format!("(NtsHeader *){}", value_name(*argument));
            }
            let wanted = declared.and_then(|params| params.get(at)).map(|p| &p.ty);
            let actual = &func.values[argument.0 as usize].ty;
            match wanted {
                Some(wanted) if wanted != actual && wanted.is_managed() => {
                    match c_type_of(context.program, wanted, origin) {
                        Ok(ty) => format!("({ty}){}", value_name(*argument)),
                        Err(_) => value_name(*argument),
                    }
                }
                _ => value_name(*argument),
            }
        })
        .collect();

    let call = if let Callee::Closure { slot } = callee {
        let signature = closure_signature(func, value, args, context.program, origin)?;
        let receiver = args
            .first()
            .map_or_else(|| "0".to_owned(), |value| value_name(*value));
        format!(
            "(({signature}){receiver}->header.descriptor->methods[{slot}])({})",
            arguments.join(", ")
        )
    } else if let Callee::Virtual { slot, .. } = callee {
        // The table stores untyped pointers, so the call spells the signature it
        // is making. `args[0]` is the receiver, and its descriptor is where the
        // table lives -- one load and one indirect call, which is what dispatch
        // costs when the compiler knows the whole hierarchy.
        let signature = virtual_signature(context.program, target, origin)?;
        let receiver = args
            .first()
            .map_or_else(|| "0".to_owned(), |value| value_name(*value));
        format!(
            "(({signature}){receiver}->header.descriptor->methods[{slot}])({})",
            arguments.join(", ")
        )
    } else if matches!(
        func.values[value.0 as usize].kind,
        OpKind::Call { frame: Some(_), .. }
    ) {
        // The `_into` form of the same helper, handed the storage declared
        // above. The frame is where the result lives; everything else about the
        // call is unchanged, which is the point of doing it this way rather than
        // with a second operation.
        format!(
            "{}_into(&{name}_frame.header, {})",
            c_identifier(target),
            arguments.join(", ")
        )
    } else if erases_result(target)
        || (matches!(callee, Callee::External(_))
            && !runtime_declares(target)
            && matches!(
                returned_shape(context.program, &func.values[value.0 as usize].ty),
                Returned::Header
            ))
    {
        // The other half of the prototype's return escape: the binding is
        // declared to hand back an `NtsHeader *`, and the program wants its own
        // struct. Symmetrical with the argument cast above, and with the
        // named-helper list `erases_result` carries -- the difference is only
        // that this one is decided by the shape rather than by the name,
        // because a `declare function` can be called anything.
        let wanted = c_type_of(context.program, &func.values[value.0 as usize].ty, origin)?;
        format!(
            "({wanted}){}({})",
            c_identifier(target),
            arguments.join(", ")
        )
    } else {
        format!("{}({})", c_identifier(target), arguments.join(", "))
    };

    // A result used at a different type than the callee declares.
    //
    // `bump(): this` on a base class returns the base pointer, and in a
    // subclass the caller's `this` is the subclass. Under base-first layout
    // those are the same pointer -- which is the rule `verify::compatible`
    // already applies to a return, a store and a call argument -- but C wants
    // telling, and `-Wincompatible-pointer-types` is an error here.
    //
    // Only where the two actually differ, so nothing that agreed before this
    // grows a cast. Only for a managed type, because two scalars are a
    // conversion rather than a cast and specialization owns those.
    let wanted = &func.values[value.0 as usize].ty;
    let cast = context
        .program
        .funcs
        .iter()
        .find(|declared| declared.name == *target)
        .filter(|declared| declared.return_type != *wanted && wanted.is_managed())
        .map(|_| c_type_of(context.program, wanted, origin))
        .transpose()?;

    Ok(if context.read.contains(&value) {
        match cast {
            Some(ty) => format!("{name} = ({ty}){call};"),
            None => format!("{name} = {call};"),
        }
    } else {
        // The call still happens; only its result is unwanted.
        format!("{call};")
    })
}

/// Which layouts some `ObjectNew` in the program actually creates.
///
/// Layouts a *published class* is constructed through, which this program may
/// never construct itself.
///
/// `string_decoder` exports `StringDecoder` and writes no `new StringDecoder`
/// anywhere: every construction is one the host performs through the addon. So
/// the whole-program scan below correctly finds nothing, and the descriptor the
/// wrapper needs in order to allocate does not exist.
///
/// The descriptor stays `static` -- `program.c` keeping its own is the rule
/// that refuses object *parameters* at the boundary, and it is a good rule.
/// What is added is one narrow, deliberate hole per published class: a factory
/// that allocates and returns the header, so the wrapper can construct without
/// being handed a layout it could then misread.
fn published_class_layouts(program: &Program) -> rustc_hash::FxHashSet<usize> {
    let classes: rustc_hash::FxHashSet<&str> = program
        .funcs
        .iter()
        .filter_map(|func| func.name.split_once('#').map(|(owner, _)| owner))
        .collect();
    program
        .public_api
        .iter()
        .filter(|(emitted, _)| classes.contains(emitted.as_str()))
        .filter_map(|(emitted, _)| {
            program
                .layouts
                .iter()
                .position(|layout| layout.name == *emitted)
        })
        .collect()
}

/// A descriptor is read through an object's own header, so only a layout a
/// program allocates can ever have its read.
fn layouts_needing_descriptors(program: &Program) -> rustc_hash::FxHashSet<usize> {
    let mut found: rustc_hash::FxHashSet<usize> = published_class_layouts(program);
    let want = |found: &mut rustc_hash::FxHashSet<usize>, ty: &nts_core::hir::ClassId| {
        if let Some(at) = program
            .layouts
            .iter()
            .position(|layout| layout.types.contains(ty))
        {
            found.insert(at);
        }
    };
    for func in &program.funcs {
        for op in &func.values {
            // An `instanceof` names one descriptor per class in its closed
            // set, and that set is every class extending the one written -- so
            // a class this program declares, tests against, and never
            // constructs still needs its descriptor to exist.
            //
            // It did not. `instance_of` emitted `&nts_desc_X` for any class
            // with a *layout* while this scan admitted only classes something
            // *allocates*, so a module declaring twenty error subclasses whose
            // constructors were refused produced C that referenced twenty
            // descriptors and defined none -- from an `emit-c` that reported
            // success. Found by the Codex session compiling `runtime/node`,
            // where clang stopped after twenty undeclared identifiers.
            //
            // Defined rather than dropped from the test. Filtering the
            // disjunction to allocated classes emits less code and is sound
            // only for as long as this scan never under-approximates; resting
            // a correctness property on a whole-program scan being complete is
            // a worse trade than a few static structs nothing reads.
            if let OpKind::InstanceOf { classes, .. } = &op.kind {
                for class in classes {
                    want(&mut found, class);
                }
                continue;
            }
            // A static closure instance is not allocated, but it *is* an
            // object: it carries a header, and a header needs a descriptor to
            // point at. Reference counting reads that descriptor before it
            // reads `NTS_IMMORTAL` and stops.
            if !matches!(op.kind, OpKind::ObjectNew { .. } | OpKind::ClosureStatic) {
                continue;
            }
            let HirType::Managed(ManagedType::Object(ty)) = &op.ty else {
                continue;
            };
            want(&mut found, ty);
        }
    }
    found
}

/// `a === b` on two strings, which compares by value.
///
/// `"a" + "b" === "ab"` is true in JavaScript, and those are two different
/// allocations -- so pointer equality is the wrong answer rather than an
/// approximation of it.
fn string_comparison(
    func: &Func,
    name: &str,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Option<String> {
    if !matches!(
        func.values[lhs.0 as usize].ty,
        HirType::Managed(ManagedType::String)
    ) {
        return None;
    }
    // `===` stops at the first difference and never has to order anything, so
    // it stays its own call.
    if matches!(bin, BinOp::Eq | BinOp::Ne) {
        let negate = if matches!(bin, BinOp::Ne) { "!" } else { "" };
        return Some(format!(
            "{name} = {negate}nts_string_eq({}, {});",
            value_name(lhs),
            value_name(rhs)
        ));
    }
    // The four relational operators are one code-unit comparison against zero.
    //
    // This half of the rule was missing. `===` went through `nts_string_eq`
    // and `<` fell through to the C operator, which compared the two
    // *addresses* -- so `"a" < "b"` answered whatever the allocator had done
    // that run, and `("a" + "b") <= "ab"` was false for two strings the
    // language calls equal. The same shape as the `icmp eq` on pointers in
    // record 0044: one half written, the other never.
    let operator = match bin {
        BinOp::Lt => "<",
        BinOp::Le => "<=",
        BinOp::Gt => ">",
        BinOp::Ge => ">=",
        _ => return None,
    };
    Some(format!(
        "{name} = nts_string_cmp({}, {}) {operator} 0;",
        value_name(lhs),
        value_name(rhs)
    ))
}

/// `===` and `!==` where one side is an erased value.
///
/// A tag has to be tested before a payload can be read, so this is a call
/// rather than a C operator. Reached by `x === 5` on a `number | undefined`,
/// which is what a `Map#get` produces -- and which emitted `(double)v` on a
/// sixteen-byte struct before this existed: uncompilable C from a function the
/// lowering reported as complete.
///
/// Deliberately not the table's key comparison. That one is `SameValueZero`, so
/// it answers true for `NaN` against `NaN`, and `===` answers false.
fn erased_comparison(
    func: &Func,
    name: &str,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Option<String> {
    if !matches!(bin, BinOp::Eq | BinOp::Ne) {
        return None;
    }
    let left = &func.values[lhs.0 as usize].ty;
    let right = &func.values[rhs.0 as usize].ty;
    let negate = if matches!(bin, BinOp::Ne) { "!" } else { "" };
    if left == &HirType::Erased && right == &HirType::Erased {
        return Some(format!(
            "{name} = {negate}nts_value_strict_eq({}, {});",
            value_name(lhs),
            value_name(rhs)
        ));
    }
    // One of each, in either order: equality is symmetric, so the erased side
    // becomes the receiver whichever side it was written on.
    let (value, against, other) = match (left, right) {
        (HirType::Erased, _) => (lhs, rhs, right),
        (_, HirType::Erased) => (rhs, lhs, left),
        _ => return None,
    };
    let helper = match other {
        HirType::Float { .. } | HirType::Int { .. } => "nts_value_eq_number",
        HirType::Bool => "nts_value_eq_boolean",
        HirType::Managed(ManagedType::String) => "nts_value_eq_string",
        // Every other managed value is a pointer and compares by identity,
        // which is what `===` means for one.
        HirType::Managed(_) => "nts_value_eq_reference",
        // `void` and `never` have no value to compare, and a comparison
        // against the absent reference was answered before this ran.
        _ => return None,
    };
    // Through `const NtsHeader *`, which is what the reference helper takes.
    // Every managed pointer is a header first -- that is what makes identity
    // comparable at all -- but C does not know it, and an object whose layout
    // is a *class* reaches here as `NtsObj_Point *`. It had never been an error
    // because the only managed values compared this way were strings, arrays
    // and maps, whose C types are the runtime's own; a class used as a value
    // gave the first `NtsObj_*` and five `-Wincompatible-pointer-types`.
    let cast = if helper == "nts_value_eq_reference" {
        "(const NtsHeader *)"
    } else {
        ""
    };
    Some(format!(
        "{name} = {negate}{helper}({}, {cast}{});",
        value_name(value),
        value_name(against)
    ))
}

/// `a === b` between two references whose classes differ, as one address
/// against another.
///
/// `===` on two references is identity, and identity does not care which class
/// either side was declared as: base-first layout puts a derived object and its
/// base at the same address, which is what makes the question answerable at
/// all. C does care -- the two pointers have different struct types -- so both
/// sides are spelled as the header they both begin with.
///
/// Found as `candidate === entry` in a linear scan over `interface MemoryEntry
/// extends HttpCacheEntry`, which is the plainest way anyone writes that loop.
/// It had been reaching the numeric fallback and emitting `(double)v3` on a
/// pointer; the middle end no longer offers a width for it, and this is the
/// other half.
///
/// Not strings, which compare by value and were taken above; not the absent
/// reference, which was taken above that.
fn reference_comparison(
    func: &Func,
    name: &str,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Option<String> {
    let left = &func.values[lhs.0 as usize].ty;
    let right = &func.values[rhs.0 as usize].ty;
    if !matches!(bin, BinOp::Eq | BinOp::Ne) || !left.is_managed() || !right.is_managed() {
        return None;
    }
    // Same class on both sides is already valid C, and saying so plainly reads
    // better than two casts that change nothing.
    if left == right {
        return None;
    }
    let operator = if matches!(bin, BinOp::Ne) { "!=" } else { "==" };
    Some(format!(
        "{name} = (const NtsHeader *){} {operator} (const NtsHeader *){};",
        value_name(lhs),
        value_name(rhs)
    ))
}

/// `x === null` and `x !== null`, as a comparison of addresses.
fn null_comparison(
    func: &Func,
    name: &str,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> Option<String> {
    let absent = |value: ValueId| {
        matches!(
            func.values[value.0 as usize].kind,
            OpKind::ConstNull | OpKind::ConstUndefined
        )
    };
    if !matches!(bin, BinOp::Eq | BinOp::Ne) || !(absent(lhs) || absent(rhs)) {
        return None;
    }
    // Addresses, so both sides have to *be* addresses. An erased operand is a
    // struct: `==` on it is not C, and its absence is a tag rather than a null
    // anyway. Guarded here rather than relied on from the lowering, because
    // this function cannot see what routed the comparison to it.
    if matches!(func.values[lhs.0 as usize].ty, HirType::Erased)
        || matches!(func.values[rhs.0 as usize].ty, HirType::Erased)
    {
        return None;
    }
    let operator = if matches!(bin, BinOp::Ne) { "!=" } else { "==" };
    Some(format!(
        "{name} = {} {operator} {};",
        value_name(lhs),
        value_name(rhs)
    ))
}

/// `obj.f = v`, with the truncation spelled where there is one.
///
/// A field narrowed to an integer by `hir::fields` is stored into from a double
/// the analysis proved whole and in range, so the cast is the identity on every
/// value the program can produce -- but C should be told rather than left to
/// convert implicitly.
/// Reading a field whose slot is wider than the value read out of it.
///
/// `field_store` has coerced *to* the slot for as long as it has existed and
/// the read never coerced *from* it, so a capture stored erased and read back
/// concrete emitted `v2 = v0->callback;`
/// with `callback` an `NtsValue` and `v2` an `NtsObj_Fn675__3 *`. clang rejects
/// assigning a struct to a pointer, and this was the one error `process` had
/// left after everything else in this file was fixed.
///
/// The read is the one [`OpKind::Unerase`] emits, and it is unchecked for the
/// same reason that one is: the lowering decided this value's type when it
/// typed the read, and reading the union member is what the program means by
/// it. **Why the slot is wider than the read in the first place is a lowering
/// question and is not answered here** -- a `FieldGet` typed from its use
/// rather than from its slot is a disagreement the emitter can only paper over,
/// and this papers over it in the one direction that is sound today.
fn field_load(
    func: &Func,
    op: &nts_core::hir::Op,
    object: ValueId,
    field: u32,
    name: &str,
    context: &Context<'_>,
) -> Result<String, Diagnostic> {
    let layout = layout_of(
        context.program,
        &func.values[object.0 as usize].ty,
        &op.origin,
    )?;
    let declared = layout.fields.get(field as usize).ok_or_else(|| {
        Diagnostic::error(
            "NTS2006",
            "a field index outside its layout",
            op.origin.location,
        )
    })?;
    // `c_member`, which is what the read used before this function existed.
    // `field_store` spells the same slot with `c_identifier`; the two agree on
    // every name in the corpus and that is luck rather than design, and not a
    // thing to change while fixing something else.
    let read = format!("{}->{}", value_name(object), c_member(&declared.name));
    if declared.ty == op.ty || !matches!(declared.ty, HirType::Erased) {
        return Ok(format!("{name} = {read};"));
    }
    let widened = match erased_tag(&op.ty) {
        Some((_, "reference")) => {
            let ty = c_type_of(context.program, &op.ty, &op.origin)?;
            format!("({ty})nts_value_reference({read})")
        }
        Some((_, "boolean")) => format!("nts_value_boolean({read})"),
        Some((_, "number")) => format!("nts_value_number({read})"),
        // A type this cannot read back out of an erased slot. Named rather
        // than assigned, which is what produced the clang error above.
        _ => {
            return Err(Diagnostic::error(
                "NTS2011",
                format!(
                    "a field held as an erased value is read back as a type this backend \
                     cannot narrow it to: `{}`",
                    declared.name
                ),
                op.origin.location,
            ));
        }
    };
    Ok(format!("{name} = {widened};"))
}

fn field_store(
    func: &Func,
    op: &nts_core::hir::Op,
    object: ValueId,
    field: u32,
    stored: ValueId,
    context: &Context<'_>,
) -> Result<String, Diagnostic> {
    let layout = layout_of(
        context.program,
        &func.values[object.0 as usize].ty,
        &op.origin,
    )?;
    let declared = layout.fields.get(field as usize).ok_or_else(|| {
        Diagnostic::error(
            "NTS2006",
            "a field index outside its layout",
            op.origin.location,
        )
    })?;
    let cast = if declared.ty == func.values[stored.0 as usize].ty {
        String::new()
    } else {
        c_type_of(context.program, &declared.ty, &op.origin)
            .map_or_else(|_| String::new(), |ty| format!("({ty})"))
    };
    Ok(format!(
        "{}->{} = {cast}{};",
        value_name(object),
        c_identifier(&declared.name),
        value_name(stored)
    ))
}

/// The cast an upcast needs, or nothing where the types already agree.
///
/// TypeScript checked assignability before any of this ran, so a reference
/// whose type is not the one wanted is a *subtype* of it -- and base-first
/// layout makes the two pointers equal. The cast carries no instruction; it
/// tells C that the two spellings mean one address.
fn upcast(func: &Func, context: &Context<'_>, wanted: &HirType, value: ValueId) -> String {
    let actual = &func.values[value.0 as usize].ty;
    if !wanted.is_managed() || wanted == actual {
        return String::new();
    }
    let origin = &func.values[value.0 as usize].origin;
    c_type_of(context.program, wanted, origin)
        .map_or_else(|_| String::new(), |ty| format!("({ty})"))
}

/// A function-pointer type for calling a closure, taken from the call itself.
///
/// The receiver is the closure object, whose static type is the *function*
/// type -- an empty layout that every closure of that type has as its base. So
/// the pointer the table entry is called with is the same address the
/// implementation wants, and only the spelling differs.
fn closure_signature(
    func: &Func,
    value: ValueId,
    args: &[ValueId],
    program: &Program,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    let mut params = Vec::new();
    for arg in args {
        params.push(c_type_of(program, &func.values[arg.0 as usize].ty, origin)?);
    }
    Ok(format!(
        "{} (*)({})",
        c_type_of(program, &func.values[value.0 as usize].ty, origin)?,
        if params.is_empty() {
            "void".to_owned()
        } else {
            params.join(", ")
        }
    ))
}

/// A function-pointer type for calling one implementation of a virtual method.
fn virtual_signature(
    program: &Program,
    target: &str,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    let Some(func) = program.funcs.iter().find(|func| func.name == target) else {
        return Err(Diagnostic::error(
            "NTS2006",
            format!("no declaration for `{target}` to take a signature from"),
            origin.location,
        ));
    };
    let mut params = Vec::new();
    for param in &func.params {
        params.push(c_type_of(program, &param.ty, origin)?);
    }
    Ok(format!(
        "{} (*)({})",
        return_c_type(program, &func.return_type, origin)?,
        if params.is_empty() {
            "void".to_owned()
        } else {
            params.join(", ")
        }
    ))
}

/// The C name of a module-scope variable.
fn global_name(program: &Program, global: u32) -> String {
    program.globals.get(global as usize).map_or_else(
        || format!("nts_global_{global}"),
        |g| c_global(&g.name, program.funcs.iter().map(|func| func.name.as_str())),
    )
}

/// Module-scope variables, as file-scope storage.
///
/// `static` unless exported, so a name a program keeps to itself does not become
/// part of the artifact's ABI -- and so the linker can drop one nothing reads,
/// which is the same reachability argument `--gc-sections` makes for functions.
/// Where a closure's `call` sits in a descriptor's method table, published so
/// that hand-written C can reach it.
///
/// The compiler decides this number and nothing else can. `hir` puts a
/// closure's method *after* every named method in the program --
/// `closure_slot = hierarchy.slots.len()` -- so it is 0 only in a program that
/// declares no methods at all, and `nts_callback_call` indexes the table with
/// it directly: it casts `descriptor->methods[entry->slot]` to the callback's
/// signature and calls it, with no check that the entry is filled.
///
/// A binding that wants to post a compiled closure as a task has to pass that
/// slot to `nts_callback_task`, and neither it nor the runtime can work it out:
/// a descriptor's method table carries no count to scan for the one filled
/// entry. Measured across the built profile before this existed --
/// `async_hooks` 8, `diagnostics_channel` 5, `buffer` 5, `punycode` 0 -- which
/// is the worst possible distribution for a hardcoded constant, because the
/// module anyone tries first is the one where 0 happens to be right and the
/// three that matter dereference a null.
///
/// Emitted unconditionally. A program with no closures has nothing to call, so
/// the value is unused rather than wrong, and a declaration in `nts_runtime.h`
/// that some translation unit references must resolve in every link.
fn emit_closure_call_slot(writer: &mut CodeWriter, origin: &Origin, program: &Program) {
    let slot = program
        .layouts
        .iter()
        .filter(|layout| layout.types.iter().copied().any(nts_core::hir::is_closure_type))
        .find_map(|layout| layout.methods.iter().position(Option::is_some))
        .and_then(|slot| u32::try_from(slot).ok())
        .unwrap_or(0);
    writer.line(
        origin,
        format!("const uint32_t nts_closure_call_slot = {slot}u;"),
    );
    writer.blank(origin);
}

/// Whether any function names this global.
///
/// A global that nothing reads, nothing writes and nothing publishes needs no
/// storage — and emitting one is not merely wasteful, it is a **build failure**:
/// `benches` compiles with `-Werror`, and an unread `static` is
/// `-Wunused-variable`.
///
/// This exists because an exported `const` with a folding initializer is given
/// a global so the export table has something to point at. In a *library* that
/// is exactly right. In an **executable** the exports are not roots — nothing
/// outside can call in — so `publish_surface` publishes nothing, and the global
/// is left with no reader, no writer and no external linkage.
///
/// `json-scan`'s `QUOTE`, `COMMA`, `MINUS` and `OPEN_BRACKET` are that shape:
/// module constants a benchmark folds at every use.
///
/// Asked of the IR rather than tracked alongside it, because the answer changes
/// with reachability and a flag set during lowering would be stale by now.
fn global_is_named(program: &Program, at: u32) -> bool {
    program.funcs.iter().any(|func| {
        func.values.iter().any(|op| {
            matches!(
                op.kind,
                OpKind::GlobalGet(global) | OpKind::GlobalSet { global, .. } if global == at
            )
        })
    })
}

fn emit_globals(writer: &mut CodeWriter, program: &Program) -> Result<(), Diagnostic> {
    for (at, global) in program.globals.iter().enumerate() {
        // Not `continue`-ing on an exported one: external linkage *is* a
        // reader, and the whole point of publishing a constant is that
        // something outside this translation unit names it.
        if !global.exported && !global_is_named(program, u32::try_from(at).unwrap_or(u32::MAX)) {
            continue;
        }
        // `c_type_of` rather than `c_type`: an object type is named per
        // program, so a global holding one cannot be spelled without it.
        let ty = c_type_of(program, &global.ty, &global.origin)?;
        let visibility = if global.exported { "" } else { "static " };
        writer.line(
            &global.origin,
            format!(
                "{visibility}{ty} {} = {};",
                c_global(&global.name, program.funcs.iter().map(|f| f.name.as_str())),
                match global.ty {
                    HirType::Bool => (global.initial != 0.0).to_string(),
                    // A global's `initial` is one `f64`, which cannot spell a
                    // tag beside a payload. It does not have to: an erased
                    // global starts as `undefined`, and whatever the source
                    // wrote is assigned by `module#init` -- which is where
                    // every module-scope initializer that is not a constant
                    // already runs.
                    //
                    // The macro rather than the accessor, because this is a
                    // static's initializer and C wants a constant expression
                    // there. The call compiled everywhere else and not here.
                    HirType::Erased => "NTS_VALUE_UNDEFINED".to_owned(),
                    // A reference global starts null, and `module#init`
                    // assigns whatever the source wrote -- the same place every
                    // non-constant module-scope initializer already runs.
                    // `initial` is one `f64` and cannot spell a pointer, so
                    // emitting it here would declare `NtsString *s = 0.0;`.
                    ref ty if ty.may_hold_a_reference() => "0".to_owned(),
                    _ => float_literal(global.initial),
                }
            ),
        );
    }
    if !program.globals.is_empty() {
        writer.blank(&program.globals[0].origin);
    }
    Ok(())
}

/// A double as a C expression.
///
/// Rust prints the three non-finite doubles as `inf`, `-inf` and `NaN`, none of
/// which is C. They reach here because `Infinity` and `NaN` are ordinary
/// constants in a TypeScript program and because the constant folder produces
/// them: dividing by zero is not an error in JavaScript, it is a value.
fn float_literal(value: f64) -> String {
    if value.is_nan() {
        // The sign and payload of a NaN are not observable from JavaScript, so
        // any NaN will do and `NAN` is the one `math.h` names.
        return "(double)NAN".to_owned();
    }
    if value.is_infinite() {
        return if value.is_sign_negative() {
            "-(double)INFINITY".to_owned()
        } else {
            "(double)INFINITY".to_owned()
        };
    }
    // `{:?}` round-trips: it prints the shortest decimal that reads back as the
    // same double, and always with a decimal point so C reads it as one.
    format!("{value:?}")
}

/// String literals, as static data.
///
/// Emitted as numeric code units rather than as C string literals: a C literal
/// would need escaping rules that do not match JavaScript's, and would carry
/// its own idea of what a byte means.
fn emit_literals(writer: &mut CodeWriter, origin: &Origin, literals: &[String]) {
    for (index, text) in literals.iter().enumerate() {
        let units: Vec<u16> = text.encode_utf16().collect();
        let name = format!("nts_str_{index}");
        // One byte per code unit whenever every one fits, which for ordinary
        // program text is always. The trailing zero is what makes a one-byte
        // string usable as a C string without copying.
        let wide = units.iter().any(|unit| *unit > 0xFF);
        let (element, descriptor, flags) = if wide {
            ("uint16_t", "nts_desc_string2", "NTS_TWO_BYTE")
        } else {
            ("unsigned char", "nts_desc_string1", "0")
        };
        let data: Vec<String> = units
            .iter()
            .map(std::string::ToString::to_string)
            .chain(std::iter::once("0".to_owned()))
            .collect();
        writer.line(
            origin,
            format!(
                "static const struct {{ NtsHeader header; {element} data[{}]; }} {name} = \
                 {{ {{ &{descriptor}, NTS_IMMORTAL, {flags}, {} }}, {{ {} }} }};",
                data.len(),
                units.len(),
                data.join(", ")
            ),
        );
    }
    if !literals.is_empty() {
        writer.blank(origin);
    }
}

/// A 128-bit integer as C source.
///
/// C has no literal wider than `long long`, so a `bigint` past 64 bits cannot
/// be written as digits: clang rejects `170141183460469231731687303715884105727`
/// with "integer literal is too large to be represented in any integer type",
/// which is what every `bigint` literal above 2^63 emitted.
///
/// Built from halves instead, which every C compiler accepts and constant-folds
/// away. The low half is taken as unsigned so its top bit is not a sign.
// Both casts reinterpret rather than convert, which is the whole job: the sign
// is carried by the top bit of the high half and the halves are put back
// together by the shift below.
#[allow(clippy::cast_sign_loss, clippy::cast_possible_truncation)]
fn integer_literal(value: i128) -> String {
    if let Ok(narrow) = i64::try_from(value) {
        return format!("{narrow}");
    }
    let bits = value as u128;
    let high = (bits >> 64) as u64;
    let low = bits as u64;
    format!("(((__int128)0x{high:x}ULL << 64) | 0x{low:x}ULL)")
}

/// The name of the single instance a named function's closure has.
fn static_closure_name(layout: &nts_core::hir::Layout) -> String {
    format!("nts_fnval_{}", object_type_name(layout))
}

/// A C struct per object type, and its descriptor.
///
/// A real struct rather than manual offsets, so the C compiler decides padding
/// and alignment and the emitted field access is `p->x` — which is both faster
/// to read and impossible to get wrong by an offset.
fn emit_object_types(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    diagnostics: &mut Vec<Diagnostic>,
) {
    // Every object type is forward-declared first, so a field may point at a
    // type declared later -- or at its own, which a linked structure does.
    for layout in &program.layouts {
        let name = object_type_name(layout);
        writer.line(origin, format!("typedef struct {name} {name};"));
    }
    if !program.layouts.is_empty() {
        writer.blank(origin);
    }

    // One number both backends write into a count word, checked against the
    // macro that defines it. A backend that got this wrong would produce
    // storage the collector believes it may free.
    writer.line(
        origin,
        format!(
            "_Static_assert(NTS_IMMORTAL == {}u, \"NTS_IMMORTAL is not what nts writes\");",
            nts_codegen_common::layout::IMMORTAL
        ),
    );
    for layout in &program.layouts {
        let name = object_type_name(layout);
        writer.line(origin, format!("struct {name} {{"));
        // The header first, so every managed object starts the same way and a
        // provider can read the descriptor without knowing the type (RFC 8.2).
        writer.line(origin, "    NtsHeader header;");
        for field in &layout.fields {
            // A field whose C type cannot be computed used to be *dropped
            // from the struct*, silently, while the descriptor beside it kept
            // taking an `offsetof` into it. Ninety-three of them across the
            // node profile, and not obscure ones: a cell's `value`, a closure's
            // captured `callback`, `Agent.requests`. A struct missing a field
            // the reference map still points at is not a smaller object, it is
            // a wrong one.
            //
            // Named instead. The layout is the thing that is unrepresentable,
            // so the diagnostic is about the layout rather than about whichever
            // function happened to touch it first.
            // A field whose type has no layout is still a *pointer*, and that
            // is the whole of what this struct needs from it.
            //
            // `materialize_within` walks containers and deliberately not
            // fields: demanding a layout for every field type refused a class
            // for holding a `Map` it never touches, at 81 profile functions to
            // fix nothing. What it did instead was silently *drop* the field --
            // ninety-three of them, including a cell's `value` and a closure's
            // captured `callback` -- while `reference_fields` kept the name in
            // the descriptor's map and the emitter kept taking an `offsetof`
            // into it. A struct missing a field the reference map points at is
            // not a smaller object, it is a wrong one.
            //
            // Neither horn was necessary. Every managed object is one pointer
            // whatever its layout, the reference map wants an offset and a
            // pointer has one, and nothing here can dereference it: reading
            // through the field would have called `layout_of` and there would
            // be a layout. So it is emitted opaque.
            //
            // Which is also where LLVM already is -- it has had none but opaque
            // pointers since 17 -- so this is the C backend agreeing with the
            // one that comes next rather than a concession.
            let ty = match c_type_of(program, &field.ty, origin) {
                Ok(ty) => ty,
                Err(problem) if field.ty.is_managed() => {
                    let _ = problem;
                    "void *".to_owned()
                }
                Err(problem) => {
                    diagnostics.push(problem);
                    continue;
                }
            };
            // `readonly` is semantic, not syntactic — `Readonly<T>` counts — but
            // it is deliberately *not* emitted as `const` on the member.
            //
            // It used to be, to let clang hoist loads across calls, and the
            // construction store wrote through the qualifier with a cast. That
            // is defined for heap storage, which has no declared type, and
            // undefined the moment the same struct is declared in a frame --
            // which is now something the compiler does whenever an object does
            // not escape. One of the two had to go, and an object that never
            // reaches the allocator is worth an order of magnitude more than a
            // qualifier on storage whose declared type does not exist.
            //
            // The fact is not lost: `readonly` stays in the HIR, where a field
            // load that cannot change is something this compiler can common up
            // itself. That is strictly more than the C qualifier was buying.
            writer.line(origin, format!("    {ty} {};", c_member(&field.name)));
        }
        writer.line(origin, "};");
        // What this compiler believes about the struct clang just laid out.
        //
        // Descriptors take `offsetof` on the principle that whoever laid the
        // struct out says where its fields are. That is right while C owns the
        // layout and unavailable the moment a second backend does not have an
        // `offsetof` to ask -- so the placement is computed in
        // `nts_codegen_common::layout` and this is where clang checks it, on
        // every build, per field.
        //
        // The claim and the oracle, side by side, until the claim has gone long
        // enough without being wrong to become the authority. A `_Static_assert`
        // costs nothing at run time and fails at compile time with the field's
        // name in the message.
        if let Some(placed) = nts_codegen_common::layout::place(&layout.fields) {
            writer.line(
                origin,
                format!(
                    "_Static_assert(sizeof({name}) == {}u, \"{name} is not the size nts computed\");",
                    placed.size
                ),
            );
            for (field, offset) in layout.fields.iter().zip(&placed.offsets) {
                writer.line(
                    origin,
                    format!(
                        "_Static_assert(offsetof({name}, {}) == {offset}u, \"{name}.{} is not where nts computed\");",
                        c_member(&field.name),
                        field.name
                    ),
                );
            }
        }
        writer.blank(origin);
    }
}

/// Per-type data: the reference map, the dispatch table, and the descriptor.
///
/// Separate from the structs because a dispatch table takes the address of a
/// function, and a function has to be declared before that is legal. The structs
/// come first because a declaration's parameter types need them.
/// Whether one of this layout's objects reaches somewhere that could call it.
///
/// Two conditions, and both are needed.
///
/// **Live.** Over the ops each block still holds, not over `func.values`: a
/// value list keeps everything the lowering ever made, including what a pass has
/// since taken out of the control flow. A value that is in no block cannot run.
///
/// **Handed to something outside.** A closure with no method is only a defect
/// if something calls it, and the only caller this translation unit cannot
/// answer for is a native one. `runtime/node/timers` hands its two to
/// `nts_timers_install`, which invokes them from C, and that is the case worth
/// stopping.
///
/// Deliberately *not* a store. A store is not a call, and reading one as an
/// escape refused two examples that are right: `examples/absent` builds five
/// closures purely to ask `typeof` of them, and `examples/library` puts seven
/// exported `const` arrows into globals. Neither calls one, the pruner
/// correctly drops each `#call` as unreachable, and a descriptor nothing reads
/// is a static struct. The narrower rule is also the honest one -- what makes
/// the timers case unanswerable is precisely that the caller is on the other
/// side of the ABI.
///
/// Through an `Erase` on the way, because a closure crossing into a native
/// binding is usually erased first.
fn escapes_uncalled(
    program: &Program,
    defined: &rustc_hash::FxHashSet<String>,
    layout: &nts_core::hir::Layout,
) -> bool {
    program
        .funcs
        .iter()
        .filter(|func| defined.contains(&c_identifier(&func.name)))
        .any(|func| {
            let live: Vec<ValueId> = func
                .blocks
                .iter()
                .flat_map(|block| block.ops.iter().copied())
                .collect();
            let is_one = |value: ValueId| {
                let op = &func.values[value.0 as usize];
                matches!(op.kind, OpKind::ObjectNew { .. } | OpKind::ClosureStatic)
                    && matches!(&op.ty, HirType::Managed(ManagedType::Object(ty))
                        if layout.types.contains(ty))
            };
            let carries = |value: ValueId| match &func.values[value.0 as usize].kind {
                OpKind::Erase { value } => is_one(*value),
                _ => is_one(value),
            };
            live.iter().any(|value| match &func.values[value.0 as usize].kind {
                // Every argument, because any of them can be the callback.
                OpKind::Call { callee: Callee::External(_), args, .. } => {
                    args.iter().copied().any(carries)
                }
                _ => false,
            })
        })
}

/// A closure class whose dispatch table would be null, which is a defect.
///
/// The comment in `emit_object_descriptors` is right about an ordinary class: a
/// slot it does not implement is null and unreachable, because a call only uses
/// a slot the receiver's static type declares. A closure is the opposite -- its
/// class exists *for* its one method, every call through it reads
/// `descriptor->methods[nts_closure_call_slot]`, and a null table there is a
/// null dereference on the first call rather than dead weight.
///
/// `runtime/node/timers` emitted exactly that: two closures passed to one call,
/// one losing its body -- which clang caught -- and the other losing its whole
/// table, which clang accepted. The one that compiled was the dangerous one: it
/// loads, and `setTimeout` crashes three layers from the cause. Refusing here
/// turns a latent crash into a build failure, whatever the cause turns out to
/// be.
///
/// A constructor token and a provided error class both answer yes to
/// `is_closure_type` and both mean to -- `typeof TypeError` is `"function"` --
/// and neither has a method, because nothing calls a class value: it exists to
/// have an address. `has_a_closure_body` is the narrower question, asked by the
/// band rather than by the name. A name test on `Ctor_` refused twelve examples
/// for holding a `RangeError`, which is spelled exactly as a user class is.
fn a_closure_with_nothing_to_call(
    program: &Program,
    defined: &rustc_hash::FxHashSet<String>,
    layout: &nts_core::hir::Layout,
    origin: &Origin,
) -> Option<Diagnostic> {
    let is_a_closure = layout
        .types
        .iter()
        .any(|ty| nts_core::hir::has_a_closure_body(*ty));
    // Empty and naming-something-absent are the same condition here: both leave
    // the table with nothing to dispatch to. They were two separate bugs in one
    // program -- `Closure55` had no slot and `Closure54` had a slot pointing at
    // a body that was never emitted -- and only the second was loud.
    let callable = layout
        .methods
        .iter()
        .flatten()
        .any(|name| defined.contains(&c_identifier(name)));
    if !is_a_closure || callable {
        return None;
    }
    // Only where the value still escapes to something that could call it. The
    // middle end excises the statements that held one when the method was
    // refused, and `layouts_needing_descriptors` scans `func.values` -- which
    // keeps every value the lowering ever made, excised or not -- so the
    // descriptor outlives the last holder. A descriptor nothing reads is a
    // static struct; a refusal nothing earns is a module that will not build.
    escapes_uncalled(program, defined, layout).then(|| {
        Diagnostic::error(
            "NTS2006",
            format!(
                "closure class `{}` reached code generation with no method to call",
                layout.name
            ),
            origin.location,
        )
    })
}

fn emit_object_descriptors(
    writer: &mut CodeWriter,
    origin: &Origin,
    program: &Program,
    defined: &rustc_hash::FxHashSet<String>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let cyclic_layouts = program.cyclic_layouts();
    let needed = layouts_needing_descriptors(program);
    let published = published_class_layouts(program);
    for (index, layout) in program.layouts.iter().enumerate() {
        // A layout nothing allocates *and* nothing tests against needs no
        // descriptor. It still needs its struct, because something is declared
        // as a pointer to it -- a closure's signature type is exactly that:
        // every value of it is really a closure, and the closure's own
        // descriptor is the one at runtime.
        //
        // "And nothing tests against" is the second half, and it was missing.
        // See `layouts_needing_descriptors`.
        if !needed.contains(&index) {
            continue;
        }
        let name = object_type_name(layout);
        // RFC 8.3: where this object's references are, as byte offsets. Written
        // with `offsetof` so the compiler that laid the struct out is the one
        // that says where its fields are -- padding, alignment and field order
        // are its business, and duplicating its arithmetic here would be a
        // second source of truth that agrees until it does not.
        //
        // Nothing reads this under NoGC, where a reference field is a pointer
        // and costs nothing. It is emitted anyway, because it is a fact about
        // the layout.
        // The class's dispatch table, where the hierarchy has one. A slot the
        // class does not implement is null, which is unreachable: a call only
        // uses a slot the receiver's static type declares, and every class at or
        // below that type fills it.
        diagnostics.extend(a_closure_with_nothing_to_call(program, defined, layout, origin));
        // A slot naming a function this program does not define is written as
        // null rather than as its address. The middle end drops a body long
        // after the layout that named it was built -- a refusal, then pruning,
        // then reshaping -- and nothing goes back to clear the slot, so the
        // descriptor took the address of a symbol nothing declares. Two in
        // `fs`, one in `timers`, and each one stopped the whole module.
        //
        // Null is what the slot already means when a class does not implement
        // it, and it is unreachable for the same reason: a call uses a slot the
        // receiver's static type declares, and a class whose method was refused
        // is one no surviving call can reach. A *closure* is the exception, and
        // is refused above rather than nulled here.
        let entry = |method: &Option<String>| {
            method
                .as_ref()
                .map(|name| c_identifier(name))
                .filter(|symbol| defined.contains(symbol))
                .map_or_else(|| "0".to_owned(), |symbol| format!("(void *){symbol}"))
        };
        let methods = if layout.methods.iter().all(|method| entry(method) == "0") {
            "0".to_owned()
        } else {
            let entries: Vec<String> = layout.methods.iter().map(entry).collect();
            writer.line(
                origin,
                format!(
                    "static void *const nts_vtable_{name}[] = {{ {} }};",
                    entries.join(", ")
                ),
            );
            format!("nts_vtable_{name}")
        };

        // The *pointer* slots, not every slot that may hold a reference: an
        // erased one belongs in the table below and in this one it would be
        // read as a pointer. See `HirType::holds_a_pointer`.
        let references = layout.pointer_fields();
        let offsets = if references.is_empty() {
            // No table, and no `static const uint32_t x[] = {};` either: a
            // zero-length array is not C.
            "0".to_owned()
        } else {
            let entries: Vec<String> = references
                .iter()
                .map(|field| format!("offsetof({name}, {})", c_member(field)))
                .collect();
            writer.line(
                origin,
                format!(
                    "static const uint32_t nts_refs_{name}[] = {{ {} }};",
                    entries.join(", ")
                ),
            );
            format!("nts_refs_{name}")
        };
        // Slots holding an erased value, which is a reference only when its tag
        // says so. Emitted the same way and for the same reason as the
        // reference table above: `offsetof`, so the compiler that laid the
        // struct out is the one that says where its fields are.
        let erased: Vec<&str> = layout
            .fields
            .iter()
            .filter(|field| field.ty == HirType::Erased)
            .map(|field| field.name.as_str())
            .collect();
        let erased_offsets = if erased.is_empty() {
            "0".to_owned()
        } else {
            let entries: Vec<String> = erased
                .iter()
                .map(|field| format!("offsetof({name}, {})", c_member(field)))
                .collect();
            writer.line(
                origin,
                format!(
                    "static const uint32_t nts_erased_{name}[] = {{ {} }};",
                    entries.join(", ")
                ),
            );
            format!("nts_erased_{name}")
        };
        // Whether an object of this type could be in a reference cycle. The
        // collector reads it to stay away from the programs that have none,
        // which is nearly all of them.
        let cyclic = u32::from(cyclic_layouts.get(index).copied().unwrap_or(true));
        // A tuple gets its own kind, and only so that `Array.isArray` can
        // answer for one that reached an `unknown`. It manages no storage and
        // behaves as an object at every site that switches on a kind.
        let kind = if nts_core::hir::is_tuple_layout_name(&layout.name) {
            "NTS_KIND_TUPLE"
        } else {
            "NTS_KIND_OBJECT"
        };
        writer.line(
            origin,
            format!(
                "static const NtsDescriptor nts_desc_{name} = \
                 {{ {kind}, sizeof({name}), {}u, {cyclic}u, {offsets}, {methods}, \"{}\", \
                 {}u, {erased_offsets} }};",
                references.len(),
                layout.name,
                erased.len()
            ),
        );
        if published.contains(&index) {
            writer.line(origin, construction_hole(&name));
        }

        // A named function used as a value is one object, so it is emitted
        // rather than allocated: static, immortal, and nothing in it but the
        // header. `NTS_IMMORTAL` is what keeps reference counting away from
        // storage that was never allocated and must never be freed.
        if wants_a_static_instance(program, layout) {
            writer.line(
                origin,
                format!(
                    "static {name} {} = {{{{&nts_desc_{name}, NTS_IMMORTAL, 0, 0}}}};",
                    static_closure_name(layout)
                ),
            );
        }
        writer.blank(origin);
    }
}

/// The construction hole for a published class, and the only symbol among these
/// that leaves the translation unit.
///
/// It hands back a header rather than the typed pointer, so nothing outside can
/// reach a field without going through a method: the descriptor stays private,
/// and a caller holding one of these can allocate and nothing else. That keeps
/// the rule which refuses object *parameters* at the boundary -- `program.c`
/// keeps its own layouts -- while letting a wrapper build the one thing it must.
fn construction_hole(name: &str) -> String {
    format!("NtsHeader *nts_construct_{name}(void) {{ return nts_object_new(&nts_desc_{name}); }}")
}

/// Whether anything in the program refers to this layout's single instance.
///
/// Asked of the IR rather than tracked alongside it: `ClosureStatic` is the
/// only thing that reads one, so the ops that read it are the whole answer.
fn wants_a_static_instance(program: &Program, layout: &nts_core::hir::Layout) -> bool {
    program.funcs.iter().any(|func| {
        func.values.iter().any(|op| {
            matches!(op.kind, OpKind::ClosureStatic)
                && matches!(&op.ty, HirType::Managed(ManagedType::Object(ty))
                    if layout.types.contains(ty))
        })
    })
}

/// The per-program data: a descriptor per element type this program allocates.
///
/// The runtime itself is [`RUNTIME_HEADER`] and [`RUNTIME_SOURCE`] -- real C,
/// compiled separately -- so none of it is generated. What is generated is what
/// depends on the program.
fn emit_descriptors(writer: &mut CodeWriter, origin: &Origin, descriptors: &[&'static str]) {
    for element in descriptors {
        writer.line(
            origin,
            format!(
                "static const NtsDescriptor {} = \
                 {{ NTS_KIND_ARRAY, sizeof({element}), 0, 0, 0, 0, \"{element}[]\", {}, 0 }};",
                descriptor_name(element),
                // For an array, `erased` is a fact about every element rather
                // than a table of offsets -- exactly as `references` is. An
                // array of erased values whose descriptor said `0` would never
                // be walked, so a string held in one would be released while
                // something still pointed at it.
                u32::from(**element == *"NtsValue")
            ),
        );
    }
    if !descriptors.is_empty() {
        writer.blank(origin);
    }
}

/// The element types the emitted functions actually allocate.
///
/// One descriptor per element type rather than per array: a descriptor is
/// immutable and describes the shape, not any particular array's contents.
fn descriptors_reached(bodies: &[(String, CodeWriter, &Func)]) -> Vec<&'static str> {
    let mut found: Vec<&'static str> = Vec::new();
    for func in bodies.iter().map(|(_, _, func)| *func) {
        for op in &func.values {
            if !matches!(op.kind, OpKind::ArrayNew { .. }) {
                continue;
            }
            let HirType::Managed(ManagedType::Array(element)) = &op.ty else {
                continue;
            };
            // Arrays of references share the runtime's own descriptor: every
            // reference is a pointer, so they are all the same shape.
            if element.is_managed() {
                continue;
            }
            if let Ok(spelling) = c_type(element, &op.origin)
                && !found.contains(&spelling)
            {
                found.push(spelling);
            }
        }
    }
    found
}

/// The C spelling of a type, including the object types this program declares.
fn c_type_of(program: &Program, ty: &HirType, origin: &Origin) -> Result<String, Diagnostic> {
    if let HirType::Managed(ManagedType::Object(_)) = ty {
        let layout = layout_of(program, ty, origin)?;
        return Ok(format!("{} *", object_type_name(layout)));
    }
    Ok(c_type(ty, origin)?.to_owned())
}

/// The C spelling of a function's RETURN type, which is not quite the spelling
/// of a value's.
///
/// `never` is the difference and it is the whole reason this exists separately.
/// A value of type `never` is control reaching somewhere the type system said
/// it could not, and `c_type` refuses it in those words. A *return* type of
/// `never` says something else entirely and is perfectly ordinary: the function
/// does not return. `function error(type: ErrorType): never` throws on every
/// path, node's own `punycode` has one, and every call to it was emitted with
/// no definition anywhere because the signature could not be spelled.
///
/// `void`, not `_Noreturn void`. The attribute would be true and it would let
/// clang delete the code after a call -- which is code this backend has already
/// decided is unreachable, so the attribute buys nothing and would be a second
/// place that has to stay right about it.
fn return_c_type(program: &Program, ty: &HirType, origin: &Origin) -> Result<String, Diagnostic> {
    if matches!(ty, HirType::Never) {
        return Ok("void".to_owned());
    }
    c_type_of(program, ty, origin)
}

/// The layout an object-typed value refers to.
fn layout_of<'a>(
    program: &'a Program,
    ty: &HirType,
    origin: &Origin,
) -> Result<&'a nts_core::hir::Layout, Diagnostic> {
    let HirType::Managed(ManagedType::Object(id)) = ty else {
        return Err(Diagnostic::error(
            "NTS2006",
            "a field operation on something that is not an object",
            origin.location,
        ));
    };
    program.layout(*id).ok_or_else(|| {
        // Naming the type, because the message alone is not an identifier.
        // 199 of these in the node profile carried nothing at all, so every one
        // was indistinguishable from every other in any output -- 199 rows a
        // reader cannot group, cannot count by cause, and cannot tell has moved.
        //
        // The id rather than a name: this backend holds a `Program`, and a
        // program that has no layout for a type has no name for it either.
        // `nts types` and `nts layouts` both print the id, so it is the handle
        // that resolves.
        Diagnostic::error(
            "NTS2006",
            format!("an object type with no layout: type {}", id.0),
            origin.location,
        )
    })
}

/// The C name of an object type.
///
/// Prefixed so it cannot collide with anything the program declares, and named
/// after the source type so the emitted C is readable.
/// `x instanceof C`, as one call per class that satisfies it.
///
/// The set is closed when the program is built -- `C` and everything extending
/// it, which is usually just `C` -- so there is no chain to walk.
///
/// A class with no layout was never laid out here, which means this program
/// never builds one, so nothing can be an instance of it and it contributes
/// nothing: `instanceof Error` names all four provided error classes, and a
/// program that throws only `TypeError` has a layout for one of them.
///
/// Through `nts_is_class` rather than an inline comparison, because the LLVM
/// backend cannot short-circuit the load without branching and one question
/// should not have two spellings. The helper also rules out the values with no
/// class at all -- a number, and `null`. A *string* passes that test and then
/// compares its own descriptor, which is never a class's, so `"x" instanceof C`
/// is false by the same comparison rather than by a case of its own.
fn instance_of(
    name: &str,
    operand: ValueId,
    classes: &[nts_core::hir::ClassId],
    context: &Context<'_>,
) -> String {
    let subject = value_name(operand);
    let tests: Vec<String> = classes
        .iter()
        .filter_map(|class| {
            context
                .program
                .layouts
                .iter()
                .find(|layout| layout.types.contains(class))
        })
        .map(|layout| {
            format!(
                "nts_is_class({subject}, &nts_desc_{})",
                object_type_name(layout)
            )
        })
        .collect();
    if tests.is_empty() {
        return format!("{name} = false;");
    }
    format!("{name} = ({});", tests.join(" || "))
}

fn object_type_name(layout: &nts_core::hir::Layout) -> String {
    format!(
        "NtsObj_{}",
        layout.name.replace(|c: char| !c.is_alphanumeric(), "_")
    )
}


/// The C spelling of an array's element type.
/// Which addressing an element access uses.
///
/// An array's elements sit inline after its header; a view's are in a buffer
/// somewhere else. The two macros differ only in how they find the base.
fn items_macro(receiver: &HirType) -> &'static str {
    match receiver {
        HirType::Managed(ManagedType::View(_)) => "NTS_VIEW_ITEMS",
        _ => "NTS_ITEMS",
    }
}

/// Where a value's length comes from.
///
/// A string *is* a header, so its length is a direct member. An array, a map
/// and a set have one as their first field and reach through it. A view has
/// neither: its length is **computed**, because one built without an explicit
/// count follows its buffer through `resize` -- so there is no field to read,
/// which is the point of it.
fn length_expression(ty: &HirType, value: ValueId) -> String {
    match ty {
        HirType::Managed(ManagedType::View(_)) => {
            format!("nts_view_length({})", value_name(value))
        }
        HirType::Managed(
            ManagedType::Array(_) | ManagedType::Map(_, _) | ManagedType::Set(_),
        ) => format!("{}->header.length", value_name(value)),
        _ => format!("{}->length", value_name(value)),
    }
}

/// The element type an array or view holds, as an `HirType`.
///
/// [`element_type`] answers the same question in C, which is what the store
/// needs to *write*; this is what it needs to *compare*, because two managed
/// types can differ and share a spelling only by accident.
fn element_declared(array: &HirType) -> Option<HirType> {
    match array {
        HirType::Managed(ManagedType::Array(element) | ManagedType::View(element)) => {
            Some((**element).clone())
        }
        _ => None,
    }
}

fn element_type(program: &Program, array: &HirType, origin: &Origin) -> Result<String, Diagnostic> {
    let HirType::Managed(ManagedType::Array(element) | ManagedType::View(element)) = array else {
        return Err(Diagnostic::error(
            "NTS2005",
            "an array operation on something that is not an array",
            origin.location,
        ));
    };
    c_type_of(program, element, origin)
}

/// The descriptor an array's elements use.
///
/// Every reference is the same shape -- a pointer -- so arrays of references
/// share one descriptor. A descriptor describes the element's *shape*, not what
/// it points at, and emitting one per pointed-to type would be as many copies
/// of the same three numbers.
fn element_descriptor(array: &HirType, origin: &Origin) -> Result<String, Diagnostic> {
    let HirType::Managed(ManagedType::Array(element)) = array else {
        return Err(Diagnostic::error(
            "NTS2005",
            "an array operation on something that is not an array",
            origin.location,
        ));
    };
    if element.is_managed() {
        return Ok("nts_desc_ref".to_owned());
    }
    Ok(descriptor_name(c_type(element, origin)?))
}

/// The descriptor a given element type uses. One per element type, not per
/// array: the descriptor is immutable and says nothing about a particular
/// array's contents.
fn descriptor_name(element: &str) -> String {
    format!("nts_desc_{}", element.replace(' ', "_"))
}

/// The subscript for an element access, with or without a bounds test.
///
/// An unsigned comparison catches a negative index in the same instruction as
/// a too-large one, since a negative wraps to something enormous. Where the
/// analysis proved the index in range, there is no test at all.
fn index_expression(func: &Func, array: ValueId, index: ValueId, checked: bool) -> String {
    if !checked {
        // Proven in range, so the cast is exact whichever representation it
        // arrived in.
        return format!("(uint32_t){}", value_name(index));
    }
    // A view's bound is computed rather than stored, so it has its own pair of
    // helpers. The choice is the receiver's type, exactly as the addressing is.
    let view = matches!(
        func.values[array.0 as usize].ty,
        HirType::Managed(ManagedType::View(_))
    );
    if matches!(func.values[index.0 as usize].ty, HirType::Int { .. }) {
        let helper = if view { "nts_view_check" } else { "nts_check" };
        format!(
            "{helper}({}, (uint32_t){})",
            value_name(array),
            value_name(index)
        )
    } else {
        let helper = if view { "nts_view_index" } else { "nts_index" };
        format!("{helper}({}, {})", value_name(array), value_name(index))
    }
}

/// Whether a coercion is a no-op because its operand already has that shape.
fn coercion_is_free(func: &Func, coercion: UnOp, operand: ValueId) -> bool {
    let source = &func.values[operand.0 as usize].ty;
    match coercion {
        UnOp::ToInt32 => {
            *source
                == HirType::Int {
                    bits: 32,
                    signed: true,
                }
        }
        UnOp::ToUint32 => {
            *source
                == HirType::Int {
                    bits: 32,
                    signed: false,
                }
        }
        _ => false,
    }
}

/// `Erase` and `Unerase`, which are a tag-and-store and a load.
///
/// Both fail the same way and for the same reason, so they answer together:
/// there is no tag for a reference yet, in either direction.
fn erased_conversion(
    func: &Func,
    op: &nts_core::hir::Op,
    name: &str,
    kind: &OpKind,
    context: &Context<'_>,
) -> Result<String, Diagnostic> {
    let refuse = |ty: &HirType, direction: &str| {
        Diagnostic::error(
            "NTS2008",
            format!(
                "a value of type {ty:?} cannot be {direction} yet; a reference payload needs \
                 retain and release that switch on the tag, and getting that subtly wrong is \
                 silent"
            ),
            op.origin.location,
        )
    };
    match kind {
        OpKind::Erase { value } => {
            let from = &func.value(*value).ty;
            let (tag, field) = erased_tag(from).ok_or_else(|| refuse(from, "erased"))?;
            // The payload is one `NtsHeader *` for every reference, because
            // that is what retain, release and the tracer all take. The cast is
            // the same one `nts_retain` needs and for the same reason: a class
            // instance is a header followed by its fields, so the two point at
            // the same address.
            // Through the runtime's constructors rather than a struct literal:
            // the representation is sixteen bytes of tag-beside-payload today
            // and eight NaN-boxed ones tomorrow, and the emitter should not be
            // the second place that has to know which.
            let built = match field {
                "reference" => format!(
                    "nts_value_of_reference((NtsHeader *){}, {tag})",
                    value_name(*value)
                ),
                "boolean" => format!("nts_value_of_boolean({})", value_name(*value)),
                _ if tag == "NTS_TAG_UNDEFINED" => "nts_value_of_undefined()".to_owned(),
                _ => format!("nts_value_of_number({})", value_name(*value)),
            };
            Ok(format!("{name} = {built};"))
        }
        OpKind::Unerase { value } => {
            let (_, field) = erased_tag(&op.ty).ok_or_else(|| refuse(&op.ty, "read back"))?;
            let read = match field {
                "reference" => {
                    let ty = c_type_of(context.program, &op.ty, &op.origin)?;
                    format!("({ty})nts_value_reference({})", value_name(*value))
                }
                "boolean" => format!("nts_value_boolean({})", value_name(*value)),
                _ => format!("nts_value_number({})", value_name(*value)),
            };
            Ok(format!("{name} = {read};"))
        }
        _ => unreachable!("only the two conversions reach here"),
    }
}

/// The tag and union member an erased value uses for a concrete type.
///
/// `None` for anything this cannot erase yet, which today is every reference:
/// a payload that is sometimes a pointer needs retain and release that switch
/// on the tag, and reference counting that is subtly wrong does not announce
/// itself. Refused by name rather than stored and hoped for.
fn erased_tag(ty: &HirType) -> Option<(&'static str, &'static str)> {
    match ty {
        HirType::Float { .. } | HirType::Int { .. } => Some(("NTS_TAG_NUMBER", "number")),
        HirType::Bool => Some(("NTS_TAG_BOOLEAN", "boolean")),
        HirType::Void => Some(("NTS_TAG_UNDEFINED", "number")),
        HirType::Managed(ManagedType::String) => Some(("NTS_TAG_STRING", "reference")),
        // A symbol answers `"symbol"` to `typeof`, so it carries its own tag --
        // the same reason a closure does, and the reason both sit below the
        // object range rather than inside it.
        HirType::Managed(ManagedType::Symbol) => Some(("NTS_TAG_SYMBOL", "reference")),
        // Every object shares one tag. `typeof` cannot tell two classes apart
        // -- it answers "object" for both -- and which class it is comes from
        // the header the payload points at, which is where the collector and
        // dispatch already look.
        // An array answers "object" to `typeof`, like any other object, and it
        // carries the same header -- so the collector and the refcount reach it
        // through the payload exactly as they reach a class instance.
        // A closure answers `"function"` to `typeof`, so it carries its own
        // tag. Told apart by the id rather than by the layout, because that is
        // all this sees -- see `hir::is_closure_type` for why the synthetic id
        // space is partitioned to make the question answerable here.
        HirType::Managed(ManagedType::Object(ty)) if nts_core::hir::is_closure_type(*ty) => {
            Some(("NTS_TAG_FUNCTION", "reference"))
        }
        // A date and an array buffer answer `"object"` too, and carry the same
        // header, so they join the arm rather than repeat it. Below the
        // closure guard because that one is narrower.
        //
        // A typed array is here for the same reason and arrived late: it was
        // `ManagedType::Array` when this arm was written, so it was covered by
        // accident, and became uncovered the moment it got a variant of its
        // own. `Array.isArray` of a `Uint8Array` in an `unknown` is what found
        // it -- which is to say, nothing found it until a feature needed the
        // one conversion it no longer had.
        HirType::Managed(
            ManagedType::Object(_)
            | ManagedType::Array(_)
            | ManagedType::View(_)
            // And a view whose element the declaration did not name, which is
            // the same runtime object with the same tag. Leaving it out would
            // have refused `unknown` of an `ArrayBufferView` -- exactly how the
            // typed view above came to be missing, which is a mistake worth
            // making once.
            | ManagedType::AnyView
            | ManagedType::Date
            | ManagedType::Buffer
            | ManagedType::DataView
            // A promise too. Its settled value lives in the descriptor's
            // *erased* table, which is what lets the collector follow it only
            // when the tag says there is something to follow -- and none of
            // that is disturbed by a reference to the promise itself being
            // erased, which is an ordinary pointer like the rest of this arm.
            | ManagedType::Promise(_),
        ) => Some(("NTS_TAG_OBJECT", "reference")),
        _ => None,
    }
}

fn c_type(ty: &HirType, origin: &Origin) -> Result<&'static str, Diagnostic> {
    Ok(match ty {
        HirType::Void => "void",
        HirType::Bool => "bool",
        HirType::Erased => "NtsValue",
        HirType::Float { bits: 32 } => "float",
        HirType::Float { .. } => "double",
        HirType::Int {
            bits: 8,
            signed: true,
        } => "int8_t",
        HirType::Int {
            bits: 8,
            signed: false,
        } => "uint8_t",
        HirType::Int {
            bits: 16,
            signed: true,
        } => "int16_t",
        HirType::Int {
            bits: 16,
            signed: false,
        } => "uint16_t",
        HirType::Int {
            bits: 32,
            signed: true,
        } => "int32_t",
        HirType::Int {
            bits: 32,
            signed: false,
        } => "uint32_t",
        // `bigint`. `__int128` is a clang extension rather than a C type, which
        // is fine here: this backend emits for clang and the runtime is built
        // with it.
        //
        // 128 bits is not arbitrary precision, and the difference is a
        // deliberate, visible boundary rather than a silent one -- a literal
        // that does not fit is refused where it is written. See `lower_bigint`
        // for the whole argument.
        HirType::BigInt => "__int128",
        HirType::Int { signed: true, .. } => "int64_t",
        HirType::Int { signed: false, .. } => "uint64_t",
        // `never` reaching a value position means control got somewhere the type
        // system said it could not.
        HirType::Never => {
            return Err(Diagnostic::error(
                "NTS2002",
                "a value of type `never` reached code generation",
                origin.location,
            ));
        }
        // An array is a pointer to its header; the elements follow it. The
        // element type is not in the C type, because every access already knows
        // it from the HIR and spelling it here would need a struct per element
        // type for no benefit.
        HirType::Managed(ManagedType::Array(_)) => "NtsArray *",
        HirType::Managed(ManagedType::String) => "NtsString *",
        HirType::Managed(ManagedType::Symbol) => "NtsSymbol *",
        HirType::Managed(ManagedType::Date) => "NtsDate *",
        HirType::Managed(ManagedType::Buffer) => "NtsBuffer *",
        // One C type for both, because it is one runtime object: `NtsView`
        // carries its element kind in its descriptor, so a declaration that does
        // not name one still points at something that knows. What the missing
        // element costs is the *operations* -- an indexed read has no width to
        // emit -- and those are refused where they are lowered rather than here.
        HirType::Managed(ManagedType::View(_) | ManagedType::AnyView) => "NtsView *",
        HirType::Managed(ManagedType::DataView) => "NtsDataView *",
        // One runtime type whatever it carries. The payload's representation is
        // in the HIR type for the compiler's sake -- it says which
        // `nts_promise_fulfill_*` to emit -- and the C sees a tagged union, so
        // there is nothing per payload to name here.
        HirType::Managed(ManagedType::Promise(_)) => "NtsPromise *",
        // Likewise one runtime type for both, and for both type arguments. The
        // table stores `NtsValue`s whatever the key and value represent as, so
        // a `Map<string, number>` and a `Map<Socket, Buffer>` are the same C
        // type -- what differs is the hash it was built with, which is an
        // argument to the constructor rather than part of the type.
        HirType::Managed(ManagedType::Map(_, _) | ManagedType::Set(_)) => "NtsMap *",
        // An object type is named per program, so it has no `&'static str`
        // spelling. `c_type_of` answers for those; reaching here means a caller
        // asked the question that cannot be answered without the program.
        HirType::Managed(ManagedType::Object(_)) => {
            return Err(Diagnostic::error(
                "NTS2006",
                "an object type needs the program to be named",
                origin.location,
            ));
        }
    })
}

/// One function's signature, used for both its definition and its prototype.
///
/// `static` unless exported, which the globals next door have always been and
/// functions never were. Same argument: a name a program keeps to itself should
/// not become part of the artifact's ABI, and the linker can drop one nothing
/// reads.
///
/// Not a speed change, and it was pursued as one. `accumulate` runs faster
/// through the LLVM backend, which emits `internal` for the same function, so
/// external linkage looked like the reason. It is not -- `tooling/bench` builds
/// with `-flto`, where clang internalizes what nothing outside needs, so this
/// was already happening. Measured before and after: 1.81us and 1.82us.
fn signature(program: &Program, func: &Func) -> Result<String, Diagnostic> {
    let returns = return_c_type(program, &func.return_type, &func.origin)?;
    let visibility = if func.exported { "" } else { "static " };
    if func.params.is_empty() {
        return Ok(format!(
            "{visibility}{returns} {}(void)",
            c_identifier(&func.name)
        ));
    }
    let mut params = Vec::new();
    for (index, param) in func.params.iter().enumerate() {
        let ty = c_type_of(program, &param.ty, &param.origin)?;
        params.push(format!(
            "{ty} {}",
            value_name(ValueId(u32::try_from(index).unwrap_or(0)))
        ));
    }
    Ok(format!(
        "{visibility}{returns} {}({})",
        c_identifier(&func.name),
        params.join(", ")
    ))
}

/// The C name of a value.
///
/// A parameter's value is the C parameter itself, which is why the arena is
/// numbered so that `%0..%n` are the parameters — no copy is needed to get an
/// argument into a local.
fn value_name(value: ValueId) -> String {
    format!("v{}", value.0)
}

fn block_label(block: BlockId) -> String {
    format!("b{}", block.0)
}

/// Emit one function, returning its signature so a declaration can be written.
fn emit_func(
    writer: &mut CodeWriter,
    func: &Func,
    context: &Context<'_>,
) -> Result<String, Diagnostic> {
    let signature = signature(context.program, func)?;
    writer.line(&func.origin, format!("{signature} {{"));
    emit_body(writer, func, context)?;
    writer.line(&func.origin, "}");
    writer.blank(&func.origin);
    Ok(signature)
}

fn emit_body(
    writer: &mut CodeWriter,
    func: &Func,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let order = block_order(func);

    // Every value except the parameters becomes a local. C scoping would not let
    // a value defined in one block be read in another, so they are all declared
    // at the top — where SSA guarantees each is assigned before any use.
    //
    // Declared from the block contents rather than from the value arena, so that
    // a value dead-code elimination dropped does not leave an unused local
    // behind. The arena keeps dead entries on purpose: a `ValueId` is an index
    // into it, and compacting would invalidate every reference in the function.
    let mut declared = rustc_hash::FxHashSet::default();
    let mut read = rustc_hash::FxHashSet::default();
    for block in &func.blocks {
        declared.extend(block.params.iter().copied());
        declared.extend(block.ops.iter().copied());
        read.extend(nts_core::hir::operands_of_terminator(&block.terminator));
        for value in &block.ops {
            read.extend(nts_core::hir::operands_of(
                &func.values[value.0 as usize].kind,
            ));
        }
    }

    // A call whose result nobody reads is emitted as a bare statement, so it has
    // nothing to declare. `c.advance();` written for its effect is exactly that,
    // and a local assigned by nobody is `-Wunused-variable`.
    declared.retain(|value| {
        read.contains(value) || !matches!(func.values[value.0 as usize].kind, OpKind::Call { .. })
    });

    // A parameter nothing reads is an error under -Werror, and constant folding
    // produces them for real: `fixed(scale: 8) { return scale * scale }` folds
    // to `64` and stops looking at its argument. The signature still has to
    // match, so the parameter stays and is discarded explicitly.
    writer.indent();
    for index in 0..func.params.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        if !read.contains(&id) {
            writer.line(
                &func.params[index].origin,
                format!("(void){};", value_name(id)),
            );
        }
    }
    writer.dedent();

    writer.indent();
    for (index, op) in func.values.iter().enumerate() {
        // A parameter is already declared by the signature, a value nothing
        // reads was dropped by dead-code elimination, and an operation that
        // produces nothing has nothing to hold — `void v4;` is not a variable.
        // A string built in the frame needs room for its code units, and the
        // statement names that room whether or not anything reads the result --
        // so the storage is declared on the strength of the *frame* rather than
        // of the value, above the skip below.
        //
        // Reachable since `for (const c of s)` existed: constant folding turns
        // `c.length` on a literal into a number, the slice becomes a call
        // nobody reads, and the assignment is dropped while the frame it writes
        // into is still named.
        if let OpKind::Call {
            frame: Some(units), ..
        } = op.kind
        {
            writer.line(
                &op.origin,
                format!(
                    "NTS_FRAME_STRING({units}) {}_frame;",
                    value_name(ValueId(u32::try_from(index).unwrap_or(0)))
                ),
            );
        }
        if matches!(op.kind, OpKind::Param(_))
            || matches!(op.ty, HirType::Void)
            || !declared.contains(&ValueId(u32::try_from(index).unwrap_or(0)))
        {
            continue;
        }
        let ty = c_type_of(context.program, &op.ty, &op.origin)?;
        // An object that does not escape lives here rather than on the heap, so
        // it needs storage as well as a pointer to it. Declared with the other
        // locals, which means one slot per allocation site rather than one per
        // execution of it -- correct precisely because nothing outlives the
        // iteration that made it.
        if let OpKind::ObjectNew { frame: true } = op.kind {
            let layout = layout_of(context.program, &op.ty, &op.origin)?;
            writer.line(
                &op.origin,
                format!(
                    "{} {}_frame;",
                    object_type_name(layout),
                    value_name(ValueId(u32::try_from(index).unwrap_or(0)))
                ),
            );
        }
        writer.line(
            &op.origin,
            format!(
                "{ty} {};",
                value_name(ValueId(u32::try_from(index).unwrap_or(0)))
            ),
        );
    }

    let temps = destruct::temp_count(func);
    for temp in 0..temps {
        // One scratch per cycle depth. Typed as the widest scalar, since a swap
        // only ever moves a value into a slot of its own type.
        writer.line(&func.origin, format!("double t{temp};"));
    }
    writer.dedent();

    // Only blocks something actually jumps to need a label, and an unreferenced
    // label is a warning in every C compiler worth using. "Actually" is the load-
    // bearing word: a jump to the next block in this order emits no `goto`, so
    // the successor edge exists in the HIR and no label is needed for it. This
    // has to mirror the rule in `emit_terminator` exactly or the two disagree.
    let mut targeted = rustc_hash::FxHashSet::default();
    for (position, block) in order.iter().enumerate() {
        let next = order.get(position + 1).copied();
        match &func.blocks[block.0 as usize].terminator {
            Terminator::Jump { target, .. } if next == Some(*target) => {}
            terminator => targeted.extend(terminator.successors()),
        }
    }

    for (position, block) in order.iter().enumerate() {
        let next = order.get(position + 1).copied();
        emit_block(
            writer,
            func,
            *block,
            next,
            targeted.contains(block),
            context,
        )?;
    }
    Ok(())
}

fn emit_block(
    writer: &mut CodeWriter,
    func: &Func,
    block: BlockId,
    next: Option<BlockId>,
    labelled: bool,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let record = &func.blocks[block.0 as usize];
    let origin = func
        .values
        .get(record.ops.first().map_or(0, |v| v.0 as usize))
        .map_or_else(|| func.origin.clone(), |op| op.origin.clone());

    if labelled {
        writer.line(&origin, format!("{}:;", block_label(block)));
    }
    writer.indent();

    for value in &record.ops {
        emit_op(writer, func, *value, context)?;
    }
    emit_terminator(writer, func, block, next, &origin, context);

    writer.dedent();
    Ok(())
}

/// The C spelling of a binary operation.
fn binary_text(
    func: &Func,
    op: &nts_core::hir::Op,
    name: &str,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
) -> String {
    // A bitwise operator's operands are always coercion results — the lowering
    // guarantees it — so they hold int32 values whatever their representation
    // says. When specialization did not give them an integer type, the
    // arithmetic still has to happen in integers, so it is spelled with casts
    // around it. Those casts are exactly the cost the analysis removes.
    //
    // A `bigint` is the exception at both ends. It is already exact, and it is
    // 128 bits wide: narrowing it to `int32_t` or returning it through a
    // `double` would each throw away most of it. So it counts as integral here,
    // and the cast below leaves it alone.
    let integral = holds_an_integer(&op.ty);
    // Cast decided per *operand*, from its own type. Deciding it from the
    // result's would emit `v14 | v15` with `v15` a double, which is not C.
    let cast = |value: ValueId| {
        if matches!(
            func.values[value.0 as usize].ty,
            HirType::Int { .. } | HirType::BigInt
        ) {
            value_name(value)
        } else {
            format!("(int32_t){}", value_name(value))
        }
    };
    let wrap = |text: String| {
        if integral {
            format!("{name} = {text};")
        } else {
            format!("{name} = (double)({text});")
        }
    };

    // Shifts are not C operators here. JavaScript masks the count to five bits,
    // where C leaves a shift by 32 or more undefined; `<<` on a negative signed
    // operand is undefined in C and defined in JavaScript. Each goes through a
    // helper that spells the real rule.
    // The shift helpers spell JavaScript's rule for a *number*: the count is
    // masked to five bits and the operands are int32. A `bigint` has neither
    // rule -- the lowering skipped the `ToInt32` pair for it -- but it does not
    // get C's operator either, because a negative count reverses the direction
    // and a count past the width saturates, and C leaves both undefined. It
    // gets a second pair of helpers that spell *those* rules on 128 bits.
    if let Some(text) = shift_text(func, op, bin, lhs, rhs, &wrap, &cast) {
        return text;
    }

    // A comparison against the absent reference is a comparison of addresses,
    // whatever the other side is. It has to come before the string rule below:
    // `s === null` is a question about the pointer, and answering it by reading
    // through the pointer would read through the null one.
    if let Some(text) = null_comparison(func, name, bin, lhs, rhs) {
        return text;
    }

    // After the null rule, which answers `x === null` for an erased `x` as a
    // question about absence, and before the string one, whose test is the
    // *static* type being a string and so would not fire for an erased side.
    if let Some(text) = erased_comparison(func, name, bin, lhs, rhs) {
        return text;
    }
    if let Some(text) = string_comparison(func, name, bin, lhs, rhs) {
        return text;
    }

    // After the string rule, which compares by value, and after the null one:
    // both of those are references too, and this would answer them by address.
    if let Some(text) = reference_comparison(func, name, bin, lhs, rhs) {
        return text;
    }

    let operator = match bin {
        BinOp::Add => "+",
        BinOp::Sub => "-",
        BinOp::Mul => "*",
        BinOp::Div => "/",
        BinOp::Rem => "%",
        BinOp::BitAnd => "&",
        BinOp::BitOr => "|",
        BinOp::BitXor => "^",
        BinOp::Lt => "<",
        BinOp::Le => "<=",
        BinOp::Gt => ">",
        BinOp::Ge => ">=",
        BinOp::Eq => "==",
        BinOp::Ne => "!=",
        // Every shift went to a helper above except `>>>` on a bigint, which
        // is a TypeError in JavaScript and is rejected by the typechecker long
        // before this. Reachable in this `match`, unreachable from a program.
        BinOp::Shl | BinOp::Shr | BinOp::UShr => {
            unreachable!("`>>>` on a bigint is a type error and does not arrive")
        }
        // Not `fmin`/`fmax`: those return the non-NaN operand where JavaScript
        // returns NaN, and disagree about the two zeroes.
        BinOp::Min | BinOp::Max => {
            // Two integers cannot be NaN and have no second zero, so the whole
            // reason the helper exists is absent and a comparison will do.
            let both_integers = matches!(func.values[lhs.0 as usize].ty, HirType::Int { .. })
                && matches!(func.values[rhs.0 as usize].ty, HirType::Int { .. });
            if both_integers {
                let test = if matches!(bin, BinOp::Min) { "<" } else { ">" };
                return format!(
                    "{name} = {0} {test} {1} ? {0} : {1};",
                    value_name(lhs),
                    value_name(rhs)
                );
            }
            let helper = if matches!(bin, BinOp::Min) {
                "nts_min"
            } else {
                "nts_max"
            };
            return wrap(format!(
                "{helper}({}, {})",
                value_name(lhs),
                value_name(rhs)
            ));
        }
        BinOp::Concat => {
            return format!(
                "{name} = nts_concat({}, {});",
                value_name(lhs),
                value_name(rhs)
            );
        }
    };

    if matches!(bin, BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor) {
        return wrap(format!("{} {operator} {}", cast(lhs), cast(rhs)));
    }

    // `%` is integer-only in C, and on doubles it is `fmod` -- which is not an
    // approximation of JavaScript's remainder but exactly it: ECMAScript
    // defines `%` as truncated division with the sign of the dividend, and so
    // does C99. `-4 % 2` is `-0` on both sides, and `x % 0` is NaN on both.
    //
    // Specialization turns most of these into an integer `%` first, where the
    // two are also the same operation. This is what is left: a remainder over
    // values the analysis could not prove whole.
    if matches!(bin, BinOp::Rem) && matches!(op.ty, HirType::Float { .. }) {
        return format!("{name} = fmod({}, {});", value_name(lhs), value_name(rhs));
    }

    if let Some(text) = wrapping_arithmetic(op, name, bin, operator, lhs, rhs) {
        return text;
    }

    format!(
        "{name} = {} {operator} {};",
        value_name(lhs),
        value_name(rhs)
    )
}

/// A shift, which is a helper call rather than a C operator.
///
/// JavaScript masks the count to five bits, where C leaves a shift by 32 or
/// more undefined; `<<` on a negative signed operand is undefined in C and
/// defined in JavaScript. Each goes through a helper that spells the real rule.
///
/// A `bigint` has neither rule -- the lowering skipped the `ToInt32` pair for it
/// -- but it does not get C's operator either, because a negative count
/// reverses the direction and a count past the width saturates, and C leaves
/// both undefined. It gets a second pair of helpers that spell *those* rules on
/// 128 bits.
///
/// `None` where the operator is not a shift, which is the caller's signal to
/// carry on.
fn shift_text(
    func: &Func,
    op: &nts_core::hir::Op,
    bin: BinOp,
    lhs: ValueId,
    rhs: ValueId,
    wrap: &impl Fn(String) -> String,
    cast: &impl Fn(ValueId) -> String,
) -> Option<String> {
    let wide = matches!(func.values[lhs.0 as usize].ty, HirType::BigInt);
    let helper = match (wide, bin) {
        (false, BinOp::Shl) => "nts_shl",
        (false, BinOp::Shr) => "nts_shr",
        (false, BinOp::UShr) => "nts_ushr",
        (true, BinOp::Shl) => "nts_bigint_shl",
        (true, BinOp::Shr) => "nts_bigint_shr",
        _ => return None,
    };
    // Cast to the slot the result goes in. `nts_ushr` answers a `uint32_t` --
    // `>>>` is defined to -- and the slot is an `int32_t`, so C narrowed it
    // silently. That is safe only because a shift by one or more clears the top
    // bit, which is an argument nobody had written down; `x >>> 0` is the case
    // it does not cover. Saying it makes the one place that has to think about
    // it visible.
    //
    // A shift's result is a scalar, so `c_type` answers it without the program;
    // if it somehow could not, the unannotated call is what this emitted before
    // and is no worse.
    let slot = c_type(&op.ty, &op.origin).unwrap_or("");
    Some(wrap(format!(
        "({slot}){helper}({}, {})",
        cast(lhs),
        cast(rhs)
    )))
}

/// Integer `+`, `-` and `*`, wrapped the way JavaScript defines them.
///
/// Signed overflow is undefined in C and *defined* in JavaScript, where
/// `(a + b) | 0` wraps modulo 2^32.
///
/// Specialization narrows an accumulator to `int32_t` wherever the values are
/// whole, which is not the same as proving the sum fits -- and a plain C
/// operator then tells clang the overflow cannot happen. It happens:
/// `total = (total + step.value) | 0` over a long enough walk passed `INT32_MAX`
/// and the program answered 3221225471 where node answers -1073741825. The same
/// thirty-two bits, read as unsigned, because the optimizer had been given a
/// promise the program does not keep.
///
/// Wrapped through the unsigned counterpart, which is defined, and cast back --
/// exactly the spelling `benches/cases/accumulate`'s hand-written reference
/// uses, with a comment there saying the wrapping *is* the semantics. The C
/// emitted here is now held to the standard the reference is held to.
///
/// Only `+`, `-` and `*`. Division and remainder do not wrap, comparison does
/// not produce an integer, and the bitwise operators are answered before this.
///
/// The LLVM backend needs no equivalent: its `add` carries no `nsw`, so it
/// wraps by definition. This is a rule about C.
fn wrapping_arithmetic(
    op: &nts_core::hir::Op,
    name: &str,
    bin: BinOp,
    operator: &str,
    lhs: ValueId,
    rhs: ValueId,
) -> Option<String> {
    let HirType::Int { bits, signed: true } = op.ty else {
        return None;
    };
    if !matches!(bin, BinOp::Add | BinOp::Sub | BinOp::Mul) {
        return None;
    }
    Some(format!(
        "{name} = (int{bits}_t)((uint{bits}_t){} {operator} (uint{bits}_t){});",
        value_name(lhs),
        value_name(rhs)
    ))
}

/// Whether a bitwise result can be written without going through a `double`.
///
/// `Bool` counts. `a || b` lowers to a bitwise or of two comparisons, and
/// leaving it out sent the result through a `double` on its way into a `bool`
/// -- `(double)((int32_t)v31 | (int32_t)v33)` in a condition, so a float
/// compare where an integer test would do. Twenty-eight of those across the
/// examples, found by compiling the generated C with `-Wconversion`, which is a
/// question nothing had asked it before.
fn holds_an_integer(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Int { .. } | HirType::BigInt | HirType::Bool
    )
}

/// The C spelling of a unary operation.
fn unary_text(
    func: &Func,
    name: &str,
    un: UnOp,
    operand: ValueId,
    result: &HirType,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    // Integer arithmetic happens in the type of the *result*, not of the
    // operand, and the two differ exactly where it matters. The analysis widens
    // `-x` and `Math.abs(x)` on an `i32` to `i64` precisely because
    // `-INT32_MIN` does not fit; negating first and widening after is signed
    // overflow, which is undefined and which in practice yields `INT32_MIN`
    // again -- the one input `Math.abs` exists to handle. Differential testing
    // against node found it as `Math.abs(-2147483648)`.
    let widen = |value: ValueId| -> Result<String, Diagnostic> {
        if matches!(result, HirType::Int { .. }) {
            Ok(format!(
                "({}){}",
                c_type(result, origin)?,
                value_name(value)
            ))
        } else {
            Ok(value_name(value))
        }
    };

    Ok(match un {
        UnOp::Neg => format!("{name} = -{};", widen(operand)?),
        // IEEE-754 requires a correctly rounded square root, so C's is
        // JavaScript's -- on every input, including the negatives where both
        // are NaN and the negative zero both return unchanged.
        UnOp::Sqrt => format!("{name} = sqrt({});", value_name(operand)),
        UnOp::Not => format!("{name} = !{};", value_name(operand)),
        UnOp::Truthy => {
            // An integer is truthy exactly when it is non-zero, and `!= 0` says
            // so. A double additionally has to exclude NaN, which is falsy and
            // which `!= 0` would call true — every comparison with a NaN is
            // false, including the inequality.
            //
            // A reference is truthy when it is present, except that an *empty
            // string* is falsy in JavaScript however present it is. An array or
            // an object is truthy whatever it holds, including an empty one:
            // `if ([])` runs.
            match &func.values[operand.0 as usize].ty {
                HirType::Managed(ManagedType::String) => format!(
                    "{name} = {0} != 0 && {0}->length != 0;",
                    value_name(operand)
                ),
                // An integer, a `bigint` and a reference are all "not the zero
                // value". A `bigint` reached the double rule below and emitted
                // `isnan` on an `__int128`, which is not C -- it has no NaN to
                // exclude, being an exact integer, and `0n` is its only falsy
                // value.
                HirType::Int { .. } | HirType::BigInt | HirType::Managed(_) => {
                    format!("{name} = {} != 0;", value_name(operand))
                }
                // An erased value carries which of those it is, so the rule is
                // a switch on the tag rather than a comparison. In the runtime,
                // because spelling it inline would put the whole of JavaScript
                // truthiness at every site that tests one.
                HirType::Erased => {
                    format!("{name} = nts_value_truthy({});", value_name(operand))
                }
                _ => format!("{name} = ({0} != 0.0) && !isnan({0});", value_name(operand)),
            }
        }
        UnOp::Floor | UnOp::Ceil | UnOp::Trunc | UnOp::Round | UnOp::Abs => {
            // An integer is already rounded, and taking its magnitude is a
            // comparison rather than a library call.
            let already_integral =
                matches!(func.values[operand.0 as usize].ty, HirType::Int { .. });
            if already_integral {
                return Ok(match un {
                    UnOp::Abs => {
                        let wide = widen(operand)?;
                        format!("{name} = {wide} < 0 ? -{wide} : {wide};")
                    }
                    _ => format!("{name} = {};", widen(operand)?),
                });
            }
            let call = match un {
                UnOp::Floor => "floor",
                UnOp::Ceil => "ceil",
                UnOp::Trunc => "trunc",
                UnOp::Abs => "fabs",
                // C's `round` rounds a half away from zero; JavaScript rounds it
                // toward positive infinity, so `Math.round(-1.5)` is `-1` and
                // `round(-1.5)` is `-2`.
                _ => "nts_round",
            };
            // Rounding in doubles and converting after, never the other way
            // round: `(int32_t)-3.7` is `-3` and `floor(-3.7)` is `-4`.
            // The cast is to the result's own width. Hardcoding `int32_t` here
            // truncated a `floor` whose range the analysis had already widened
            // past 32 bits.
            if matches!(result, HirType::Int { .. }) {
                return Ok(format!(
                    "{name} = ({}){call}({});",
                    c_type(result, origin)?,
                    value_name(operand)
                ));
            }
            format!("{name} = {call}({});", value_name(operand))
        }
        UnOp::ToInt32 | UnOp::ToUint32 => {
            // A value already in the target representation needs no coercion,
            // and that is the common case: integer code writing `x | 0` on
            // something already proven an integer.
            if coercion_is_free(func, un, operand) {
                return Ok(format!("{name} = {};", value_name(operand)));
            }

            // An *integer* of some other width is a truncation, which C spells
            // as a cast through the unsigned type of the target — exactly
            // ToInt32's "reduce modulo 2^32, reinterpret signed", and one
            // instruction. Only a genuine double needs the total, wrapping,
            // fmod-based helper, and reaching for it on an `int64_t` operand
            // costs a conversion to double and a library call in the loop body
            // that the whole analysis existed to speed up.
            if matches!(func.values[operand.0 as usize].ty, HirType::Int { .. }) {
                return Ok(match un {
                    UnOp::ToInt32 => {
                        format!("{name} = (int32_t)(uint32_t){};", value_name(operand))
                    }
                    _ => format!("{name} = (uint32_t){};", value_name(operand)),
                });
            }

            let helper = if matches!(un, UnOp::ToInt32) {
                "nts_to_int32"
            } else {
                "nts_to_uint32"
            };
            format!("{name} = {helper}({});", value_name(operand))
        }
    })
}

/// Allocation and field or element access: the operations that go through a
/// managed object's header.
/// Prepare an object that lives in the frame rather than on the heap.
///
/// The storage is a local declared with the others; this fills in what the
/// allocator would have. The descriptor because anything that reads an object
/// reads it there, and the count as `NTS_IMMORTAL` so that a retain or release
/// which somehow reaches a frame object is a no-op rather than `free` on a stack
/// address.
///
/// The reference slots start empty, and that one is load-bearing. A frame slot
/// is reused by every execution of the site that declares it, so on the second
/// pass through a loop it holds the pointers the first pass released -- and the
/// compiler emits a release of each reference field where the object ends.
/// Zeroing is what makes that release read a null rather than a pointer to
/// memory that is gone, on any path where a field was not written.
///
/// None of these stores survive a program that writes every field before reading
/// it, which is every constructor and every object literal; clang removes them
/// along with the object.
fn start_frame_object(
    writer: &mut CodeWriter,
    origin: &Origin,
    name: &str,
    type_name: &str,
    layout: &nts_core::hir::Layout,
) {
    writer.line(
        origin,
        format!("{name}_frame.header.descriptor = &nts_desc_{type_name};"),
    );
    writer.line(
        origin,
        format!("{name}_frame.header.reserved = NTS_IMMORTAL;"),
    );
    for field in layout.reference_fields() {
        // An erased field's zero is `undefined`, and it has to be spelled --
        // the tag is a struct member, not a pointer, so `= 0` is not C. That
        // this *is* the zero is what makes an omitted optional property
        // already correct without a store.
        let zero = layout
            .fields
            .iter()
            .find(|candidate| candidate.name == field)
            .filter(|candidate| candidate.ty == HirType::Erased)
            .map_or("0", |_| "nts_value_of_undefined()");
        writer.line(
            origin,
            format!("{name}_frame.{} = {zero};", c_identifier(field)),
        );
    }
}

/// The two operations `hir::suspend` deals in.
///
/// `Await` never reaches here: the pass rewrites every one away, so arriving
/// with one means an `async` function was transformed by nobody, and there is
/// no C for "stop here and come back later".
fn suspension(op: &nts_core::hir::Op) -> Result<String, Diagnostic> {
    match &op.kind {
        // `drop` is null: the frame is released by the resumption that runs it,
        // and a task the queue discards instead is one the runtime never had --
        // `nts_promise_subscribe` is the only path in, and it either keeps the
        // task or hands it to the microtask queue.
        OpKind::Suspend {
            promise,
            frame,
            resume,
        } => Ok(format!(
            "nts_promise_subscribe({}, (NtsTask){{ (void (*)(void *))&{}, 0, {} }});",
            value_name(*promise),
            crate::c_identifier(resume),
            value_name(*frame)
        )),
        _ => Err(Diagnostic::error(
            "NTS2007",
            "an `await` reached code generation",
            op.origin.location,
        )),
    }
}

fn managed_op(
    writer: &mut CodeWriter,
    func: &Func,
    value: ValueId,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let op = func.value(value);
    let name = value_name(value);
    let text = match &op.kind {
        // One predictable branch. The string is compile-time text and is only
        // touched on the path that ends the program.
        OpKind::CellReady { cell, name } => format!(
            "if (!{}->ready) nts_cell_unready(\"{}\");",
            value_name(*cell),
            name.escape_default()
        ),
        // One instance, emitted once beside its descriptor. No allocation and
        // no reference counting: it is immortal, and there is nothing in it.
        OpKind::ClosureStatic => {
            let layout = layout_of(context.program, &op.ty, &op.origin)?;
            format!("{name} = &{};", static_closure_name(layout))
        }
        OpKind::ObjectNew { frame } => {
            let layout = layout_of(context.program, &op.ty, &op.origin)?;
            let type_name = object_type_name(layout);
            if *frame {
                start_frame_object(writer, &op.origin, &name, &type_name, layout);
                format!("{name} = &{name}_frame;")
            } else {
                format!("{name} = ({type_name} *)nts_object_new(&nts_desc_{type_name});")
            }
        }
        OpKind::FieldGet { object, field } => {
            field_load(func, op, *object, *field, &name, context)?
        }
        OpKind::FieldSet {
            object,
            field,
            value: stored,
        } => field_store(func, op, *object, *field, *stored, context)?,
        OpKind::Await { .. } | OpKind::Yield { .. } | OpKind::Suspend { .. } => suspension(op)?,
        OpKind::ArrayNew { length, zeroed } => {
            // Two entry points rather than a flag argument, so the branch is
            // taken here rather than once per allocation at run time.
            let allocate = if *zeroed {
                "nts_array_new"
            } else {
                "nts_array_new_uninitialized"
            };
            format!(
                "{name} = {allocate}(&{}, {});",
                element_descriptor(&op.ty, &op.origin)?,
                value_name(*length)
            )
        }
        OpKind::Length(array) => {
            let target = c_type(&op.ty, &op.origin)?;
            // A string *is* a header, so its length is a direct member.
            // Everything else here has one as its first field and reaches
            // through it -- an array because it can grow and a string cannot, a
            // table because it owns three arrays besides.
            format!(
                "{name} = ({target}){};",
                length_expression(&func.values[array.0 as usize].ty, *array)
            )
        }
        OpKind::ArrayGet {
            array,
            index,
            checked,
        } => {
            let element = element_type(
                context.program,
                &func.values[array.0 as usize].ty,
                &op.origin,
            )?;
            let slot = index_expression(func, *array, *index, *checked);
            // A view's elements are not inline, so they are addressed through
            // the buffer it names. Same operation, different storage -- which
            // is the whole reason `ArrayGet` takes both rather than there
            // being a second opcode.
            let items = items_macro(&func.values[array.0 as usize].ty);
            format!(
                "{name} = {items}({}, {element})[{slot}];",
                value_name(*array)
            )
        }
        OpKind::ArraySet {
            array,
            index,
            value: stored,
            checked,
        } => {
            let element = element_type(
                context.program,
                &func.values[array.0 as usize].ty,
                &op.origin,
            )?;
            let slot = index_expression(func, *array, *index, *checked);
            let items = items_macro(&func.values[array.0 as usize].ty);
            // The third storage this family needs and the third time it has
            // been found by a program rather than by looking: an argument gets
            // the cast at the call, a global gets it at the store, and an
            // element did not get it anywhere. `const entries: Entry[] = [...,
            // derived, ...]` is the plainest way anyone fills an array of a
            // base, and it emitted `NTS_ITEMS(v6, NtsObj_Entry *)[i] = v1;`
            // with `v1` an `NtsObj_Extended *`.
            //
            // Only an upcast is reachable -- the checker settled assignability
            // long before this -- and base-first layout makes one free: the
            // same address, with the base's fields at the base's offsets.
            let stored_ty = &func.values[stored.0 as usize].ty;
            let cast = match element_declared(&func.values[array.0 as usize].ty) {
                Some(declared) if declared != *stored_ty && declared.is_managed() => {
                    format!("({element})")
                }
                _ => String::new(),
            };
            format!(
                "{items}({}, {element})[{slot}] = {cast}{};",
                value_name(*array),
                value_name(*stored)
            )
        }
        _ => unreachable!("managed_op is only reached for managed operations"),
    };
    writer.line(&op.origin, text);
    Ok(())
}

/// The cast a store into a global needs, or nothing.
///
/// Only an *up*cast is reachable -- TypeScript checked assignability long
/// before this ran -- and base-first layout makes one free: the same address,
/// with the base's fields at the base's offsets. C still wants it spelled,
/// because the two pointers have different struct types.
fn upcast_to_global(
    global: u32,
    value: ValueId,
    func: &Func,
    context: &Context<'_>,
    origin: &Origin,
) -> String {
    let Some(declared) = context.program.globals.get(global as usize).map(|held| &held.ty) else {
        return String::new();
    };
    if declared == &func.values[value.0 as usize].ty || !declared.is_managed() {
        return String::new();
    }
    c_type_of(context.program, declared, origin).map_or_else(|_| String::new(), |ty| format!("({ty})"))
}

fn emit_op(
    writer: &mut CodeWriter,
    func: &Func,
    value: ValueId,
    context: &Context<'_>,
) -> Result<(), Diagnostic> {
    let op = func.value(value);
    let name = value_name(value);
    let text = match &op.kind {
        // Nothing to compute at the definition site. A parameter *is* the C
        // parameter; a block parameter is written by the edges that jump here;
        // a return is spelled by the terminator.
        OpKind::Param(_) | OpKind::BlockParam(_) | OpKind::Return(_) => return Ok(()),
        OpKind::ConstInt(v) => format!("{name} = {};", integer_literal(*v)),
        // A concrete value becomes an erased one, and reading one back. Both
        // are one line and both can fail, so they live together in
        // `erased_conversion` rather than growing this match by twenty.
        OpKind::Erase { .. } | OpKind::Unerase { .. } => {
            erased_conversion(func, op, &name, &op.kind, context)?
        }
        OpKind::TagOf { value: at } => format!("{name} = nts_value_tag({});", value_name(*at)),
        OpKind::InstanceOf { value: at, classes } => instance_of(&name, *at, classes, context),
        // The absent reference. Typed, because C distinguishes a null
        // `NtsString *` from a null `NtsObj_Point *` even though the address is
        // the same one.
        // The absent value in an erased slot is a tag, not a null pointer:
        // there is nothing to point at and `undefined` is a kind of value here
        // rather than the absence of one.
        // Erased, the two are different values and carry different tags --
        // which is the whole reason a union holding both cannot be a pointer.
        OpKind::ConstNull if op.ty == HirType::Erased => {
            format!("{name} = nts_value_of_null();")
        }
        OpKind::ConstUndefined if op.ty == HirType::Erased => {
            format!("{name} = nts_value_of_undefined();")
        }
        // As a pointer, they are the same address -- and only one of them can
        // reach a given pointer, because a type holding both is erased instead.
        OpKind::ConstNull | OpKind::ConstUndefined => {
            let ty = c_type_of(context.program, &op.ty, &op.origin)?;
            format!("{name} = ({ty})0;")
        }
        // Enough digits to round-trip an f64 exactly. Fewer would change the
        // program's arithmetic.
        OpKind::ConstFloat(v) => format!("{name} = {};", float_literal(*v)),
        OpKind::StringUnitAt {
            string,
            index,
            checked,
        } => {
            // Proven inside the string, so there is no NaN to produce and no
            // range to test: a load, and the index is already an integer.
            if *checked {
                // An index specialization already made an integer does not go
                // back through a double to be range-tested. The general form
                // has to -- `s.charCodeAt(0.5)` is index 0 -- and paying that
                // per character is what the unchecked path exists to avoid,
                // which the checked path was quietly undoing.
                let helper = if func.value(*index).ty.is_scalar()
                    && !matches!(func.value(*index).ty, HirType::Float { .. })
                {
                    "nts_str_char_code_at_int"
                } else {
                    "nts_str_char_code_at"
                };
                format!(
                    "{name} = {helper}({}, {});",
                    value_name(*string),
                    value_name(*index)
                )
            } else {
                format!(
                    "{name} = nts_unit({}, (uint32_t){});",
                    value_name(*string),
                    value_name(*index)
                )
            }
        }
        OpKind::GlobalGet(global) => format!("{name} = {};", global_name(context.program, *global)),
        // A derived object stored where a base is declared, which for a global
        // is `let drain: Drain | undefined` holding an arrow: the closure's
        // class extends the signature's, so the two agree on every field and
        // the cast is a no-op -- but C will not take one pointer for the other
        // without being told, exactly as it will not at a call.
        //
        // The *alias* is what makes this visible. An inferred `let` takes the
        // closure's own class and needs nothing; a declared function type gives
        // the slot the signature's class, so the profile meets this where it
        // writes its host contracts down rather than everywhere it uses a
        // callback. Four sites in `events`, four in `stream`, three in `fs`.
        //
        // Only an *up*cast is reachable: TypeScript checked assignability
        // before any of this ran.
        OpKind::GlobalSet { global, value } => format!(
            "{} = {}{};",
            global_name(context.program, *global),
            upcast_to_global(*global, *value, func, context, &op.origin),
            value_name(*value)
        ),
        OpKind::ConstBool(v) => format!("{name} = {v};"),
        // A literal is immutable and known now, so it is static data rather
        // than an allocation. This is the difference between a string-heavy
        // program allocating once at startup and allocating in a loop.
        OpKind::ConstString(text) => {
            let literal = literal_name(context.literals, text);
            format!("{name} = (NtsString *)(void *)&{literal};")
        }
        OpKind::Binary { op: bin, lhs, rhs } => binary_text(func, op, &name, *bin, *lhs, *rhs),
        OpKind::Call { callee, args, .. } => {
            call_text(func, &name, value, callee, args, context, &op.origin)?
        }
        OpKind::Unary { op: un, operand } => {
            unary_text(func, &name, *un, *operand, &op.ty, &op.origin)?
        }
        OpKind::ObjectNew { .. }
        | OpKind::ClosureStatic
        | OpKind::CellReady { .. }
        | OpKind::FieldGet { .. }
        | OpKind::FieldSet { .. }
        | OpKind::ArrayNew { .. }
        | OpKind::Length(_)
        | OpKind::ArrayGet { .. }
        | OpKind::ArraySet { .. }
        | OpKind::Await { .. }
        | OpKind::Yield { .. }
        | OpKind::Suspend { .. } => {
            return managed_op(writer, func, value, context);
        }
        // An erased value is not a pointer to cast: it is sixteen bytes that
        // hold one only when the tag says so, and the runtime helper is where
        // that question is asked. The compiler emits the same retain and
        // release it would for a reference and lets the tag decide -- which is
        // exactly the branch that specializing a site by its reaching
        // representations would remove.
        OpKind::Retain(object) if func.value(*object).ty == HirType::Erased => {
            format!("nts_value_retain({});", value_name(*object))
        }
        OpKind::Release(object) if func.value(*object).ty == HirType::Erased => {
            format!("nts_value_release({});", value_name(*object))
        }
        OpKind::Retain(object) => {
            format!("nts_retain((NtsHeader *){});", value_name(*object))
        }
        OpKind::Release(object) => {
            format!("nts_release((NtsHeader *){});", value_name(*object))
        }
        OpKind::Convert(operand) => {
            // A C cast. Between an integer and a double this is one instruction,
            // and every one is a place specialization decided two adjacent
            // values should live in different machine types.
            let target = c_type(&op.ty, &op.origin)?;
            format!("{name} = ({target}){};", value_name(*operand))
        }
    };
    writer.line(&op.origin, text);
    Ok(())
}

fn emit_terminator(
    writer: &mut CodeWriter,
    func: &Func,
    block: BlockId,
    next: Option<BlockId>,
    origin: &Origin,
    context: &Context<'_>,
) {
    let record = &func.blocks[block.0 as usize];

    // The copies an edge implies run before control leaves.
    let emit_edge = |writer: &mut CodeWriter, target: BlockId, args: &[ValueId]| {
        let params = &func.blocks[target.0 as usize].params;
        for copy in destruct::edge_copies(params, args) {
            let text = match copy {
                Copy::Move { to, from } => format!(
                    "{} = {}{};",
                    value_name(to),
                    upcast(func, context, &func.value(to).ty, from),
                    value_name(from)
                ),
                Copy::Save { temp, from } => format!("t{temp} = {};", value_name(from)),
                Copy::Restore { to, temp } => format!("{} = t{temp};", value_name(to)),
            };
            writer.line(origin, text);
        }
    };

    match &record.terminator {
        Terminator::Return(Some(value)) => {
            // A derived reference where a base is declared. The layout is base
            // first so the pointer is already right; C wants to be told.
            let cast = upcast(func, context, &func.return_type, *value);
            writer.line(origin, format!("return {cast}{};", value_name(*value)));
        }
        Terminator::Return(None) => writer.line(origin, "return;"),
        Terminator::Unreachable | Terminator::FellThrough => {
            // A claim the compiler made. Saying so lets the C compiler optimize on
            // it, and makes a violated claim a crash rather than a fall-through.
            //
            // The same code for both, and safe for the second only because the
            // verifier has already established that a `FellThrough` block is
            // unreachable. It is what this rendered before that check existed
            // that made the check worth having: a setter with a wrong return
            // type came out as a store followed by this line, which the C
            // compiler read as a licence to compute anything at all.
            writer.line(origin, "__builtin_unreachable();");
        }
        Terminator::Jump { target, args } => {
            emit_edge(writer, *target, args);
            // The block order exists so this is usually free.
            if next != Some(*target) {
                writer.line(origin, format!("goto {};", block_label(*target)));
            }
        }
        Terminator::Branch {
            cond,
            then_target,
            then_args,
            else_target,
            else_args,
        } => {
            // Each arm's copies belong to that arm, so they are emitted inside it.
            writer.line(origin, format!("if ({}) {{", value_name(*cond)));
            writer.nested(|writer| {
                emit_edge(writer, *then_target, then_args);
                writer.line(origin, format!("goto {};", block_label(*then_target)));
            });
            writer.line(origin, "} else {");
            writer.nested(|writer| {
                emit_edge(writer, *else_target, else_args);
                writer.line(origin, format!("goto {};", block_label(*else_target)));
            });
            writer.line(origin, "}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_c_keyword_is_not_a_usable_function_name() {
        // `function double()` is ordinary TypeScript.
        assert_eq!(c_identifier("double"), "double_");
        assert_eq!(c_identifier("int"), "int_");
        assert_eq!(c_identifier("switch"), "switch_");
        // `main` is not a keyword, but a second definition of it does not link.
        assert_eq!(c_identifier("main"), "main_");
    }

    #[test]
    fn a_name_this_backend_generates_is_also_reserved() {
        // A function called `v0` would shadow the first parameter of every
        // function that calls it.
        assert_eq!(c_identifier("v0"), "v0_");
        assert_eq!(c_identifier("t12"), "t12_");
        assert_eq!(c_identifier("b3"), "b3_");
        // Only the exact generated shape. These are ordinary names.
        assert_eq!(c_identifier("v"), "v");
        assert_eq!(c_identifier("value0"), "value0");
        assert_eq!(c_identifier("b3x"), "b3x");
    }

    #[test]
    fn a_leading_underscore_is_reserved_to_the_implementation() {
        assert_eq!(c_identifier("_internal"), "_internal_");
    }

    /// Integer `+`, `-` and `*` are emitted as wrapping arithmetic.
    ///
    /// Pinned on the emitted *text* rather than on an answer, and that is the
    /// point. Signed overflow is undefined in C, so a program that relies on it
    /// may give the right answer on Tuesday: three examples written to catch
    /// this agreed with node even with the fix reverted, because clang chose to
    /// wrap anyway at those shapes. A differential cannot hold a rule about
    /// undefined behaviour -- it can only notice the days the optimizer took
    /// the other branch.
    ///
    /// The rule it *can* hold is that the emitted C never asks. So this reads
    /// the text.
    #[test]
    fn integer_arithmetic_is_emitted_wrapping() {
        use nts_core::hir::Op;
        use nts_diagnostics::{Location, SourceId, Span};
        use nts_semantic_schema::Origin;

        let i32_ty = HirType::Int {
            bits: 32,
            signed: true,
        };
        let origin = Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        });
        let value = |ty: HirType| Op {
            kind: OpKind::ConstFloat(0.0),
            ty,
            origin: origin.clone(),
        };
        let func = Func {
            name: "probe".to_owned(),
            params: Vec::new(),
            return_type: i32_ty.clone(),
            values: vec![value(i32_ty.clone()), value(i32_ty.clone())],
            blocks: Vec::new(),
            origin: origin.clone(),
            exported: false,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
        };
        let op = value(i32_ty);
        for (bin, operator) in [(BinOp::Add, "+"), (BinOp::Sub, "-"), (BinOp::Mul, "*")] {
            let text = binary_text(&func, &op, "out", bin, ValueId(0), ValueId(1));
            assert_eq!(
                text,
                format!("out = (int32_t)((uint32_t)v0 {operator} (uint32_t)v1);"),
                "`{operator}` on two int32 must wrap rather than invite the optimizer",
            );
        }
    }

    /// A function this backend refuses takes its callers with it.
    ///
    /// The failure this guards is the one node's `punycode` had: `error(type):
    /// never` was refused at emit time, its body was dropped, a diagnostic was
    /// pushed -- and its eight call sites were emitted anyway, into a
    /// translation unit that called a symbol nothing defines. `clang` was the
    /// only thing that noticed, and only because C wants a definition at link
    /// time.
    ///
    /// Transitive, which is the half a single pass would miss: `caller` goes
    /// because it calls `refused`, and `outer` goes because it calls `caller`.
    #[test]
    fn a_function_this_backend_refuses_takes_its_callers_with_it() {
        use nts_core::hir::{Block, Op, Terminator};
        use nts_diagnostics::{Location, SourceId, Span};
        use nts_semantic_schema::Origin;

        let origin = Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        });
        let func = |name: &str, values: Vec<Op>| Func {
            name: name.to_owned(),
            params: Vec::new(),
            return_type: HirType::Void,
            blocks: vec![Block {
                params: Vec::new(),
                ops: (0..values.len())
                    .map(|at| ValueId(u32::try_from(at).unwrap_or(0)))
                    .collect(),
                terminator: Terminator::Return(None),
            }],
            values,
            origin: origin.clone(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
        };
        let calling = |name: &str| Op {
            kind: OpKind::Call {
                callee: Callee::Direct(name.to_owned()),
                args: Vec::new(),
                frame: None,
            },
            ty: HirType::Void,
            origin: origin.clone(),
        };
        // A value of type `never` is what this backend refuses, and it is the
        // shape `punycode` reached it by.
        let never = Op {
            kind: OpKind::ConstFloat(0.0),
            ty: HirType::Never,
            origin: origin.clone(),
        };

        let program = Program {
            funcs: vec![
                func("refused", vec![never]),
                func("caller", vec![calling("refused")]),
                func("outer", vec![calling("caller")]),
                func("unrelated", vec![]),
            ],
            ..Program::default()
        };
        let emitted = emit(&program);
        let text = emitted.writer.text();

        for gone in ["refused", "caller", "outer"] {
            assert!(
                !text.contains(&format!("{gone}(")),
                "`{gone}` is still called or defined in:\n{text}",
            );
        }
        assert!(
            text.contains("unrelated("),
            "a function that calls nothing refused must survive:\n{text}",
        );

        let codes: Vec<&str> = emitted
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code.as_str())
            .collect();
        assert_eq!(
            codes,
            ["NTS2002", "NTS2009", "NTS2009"],
            "one refusal and one report per caller it orphaned",
        );
    }

    #[test]
    fn an_ordinary_name_is_left_alone() {
        // Mangling everything would be simpler and would make every exported
        // symbol worse to link against.
        assert_eq!(c_identifier("compute"), "compute");
        assert_eq!(c_identifier("sumTo"), "sumTo");
    }

    /// A closure with no body, handed to a native binding, is refused; the same
    /// closure kept to itself is not.
    ///
    /// Both halves matter and the second is the one that cost three rounds. The
    /// first version of this guard refused any *live* closure without a method,
    /// and `examples/absent` builds five purely to ask `typeof` of them. The
    /// second added stores, and `examples/library` puts seven exported `const`
    /// arrows into globals. Neither calls one; the pruner drops each `#call` as
    /// unreachable and is right to. What makes the native case different is not
    /// that the value moved -- it is that the caller is on the other side of the
    /// ABI and cannot be asked.
    #[test]
    fn a_bodiless_closure_is_refused_only_where_native_code_can_call_it() {
        use nts_core::hir::{Block, Field, Layout, Op, Terminator};
        use nts_diagnostics::{Location, SourceId, Span};
        use nts_semantic_schema::Origin;

        let origin = Origin::source(Location { file: SourceId(0), span: Span::new(0, 1) });
        let closure = nts_semantic_schema::TypeId(nts_core::hir::SYNTHETIC_CLOSURES + 9);
        let ty = HirType::Managed(ManagedType::Object(closure));
        let layout = Layout {
            types: vec![closure],
            name: "Closure9".to_owned(),
            fields: Vec::<Field>::new(),
            // A slot naming a body that is not in `defined`: the backend-refusal
            // half, which used to emit `(void *)Closure9__call` and not link.
            methods: vec![Some("Closure9#call".to_owned())],
            interfaces: Vec::new(),
            base: None,
        };
        let op = |kind, ty: &HirType| Op { kind, ty: ty.clone(), origin: origin.clone() };
        let holder = |last: OpKind| Func {
            name: "holds".to_owned(),
            params: Vec::new(),
            return_type: HirType::Void,
            blocks: vec![Block {
                params: Vec::new(),
                ops: vec![ValueId(0), ValueId(1)],
                terminator: Terminator::Return(None),
            }],
            values: vec![op(OpKind::ClosureStatic, &ty), op(last, &HirType::Void)],
            origin: origin.clone(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
        };
        let defined: rustc_hash::FxHashSet<String> = ["holds".to_owned()].into_iter().collect();

        let handed_over = OpKind::Call {
            callee: Callee::External("nts_timers_install".to_owned()),
            args: vec![ValueId(0)],
            frame: None,
        };
        let mut program = Program { layouts: vec![layout.clone()], ..Program::default() };
        program.funcs = vec![holder(handed_over)];
        assert!(
            a_closure_with_nothing_to_call(&program, &defined, &layout, &origin).is_some(),
            "a closure with no body passed to a native binding must be refused"
        );

        // Kept to itself: stored in a global, which is what an exported `const`
        // arrow does, and never handed anywhere C can call it.
        let stored = OpKind::GlobalSet { global: 0, value: ValueId(0) };
        program.funcs = vec![holder(stored)];
        assert!(
            a_closure_with_nothing_to_call(&program, &defined, &layout, &origin).is_none(),
            "a store is not a call, and refusing one refuses programs that are right"
        );

        // And with the body present it is an ordinary closure either way.
        let present: rustc_hash::FxHashSet<String> =
            ["holds".to_owned(), "Closure9__call".to_owned()].into_iter().collect();
        program.funcs = vec![holder(OpKind::Call {
            callee: Callee::External("nts_timers_install".to_owned()),
            args: vec![ValueId(0)],
            frame: None,
        })];
        assert!(
            a_closure_with_nothing_to_call(&program, &present, &layout, &origin).is_none(),
            "a closure whose body was emitted has something to dispatch to"
        );
    }

    #[test]
    fn the_erasure_table_is_searchable() {
        assert!(
            ERASES_CLASS.windows(2).all(|pair| pair[0] < pair[1]),
            "ERASES_CLASS is binary-searched and is out of order"
        );
    }

    /// Every `NtsHeader *` parameter the header declares is in `ERASES_CLASS`.
    ///
    /// The list used to be kept by hand and went stale three times, each time
    /// as an `incompatible pointer types` error in a module that had done
    /// nothing unusual. Skips without clang, because a missing tool is not a
    /// broken table; fails when clang runs and refuses, because that is.
    #[test]
    fn the_erasures_still_match_the_header() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let header = root.join("runtime/c/nts_runtime.h");
        let dir = std::env::temp_dir().join(format!("nts-erasures-{}", std::process::id()));
        if std::fs::create_dir_all(&dir).is_err()
            || std::fs::copy(&header, dir.join("nts_runtime.h")).is_err()
            || std::fs::write(dir.join("probe.c"), "#include \"nts_runtime.h\"\n").is_err()
        {
            eprintln!("SKIP: the runtime header is unavailable");
            return;
        }
        let Ok(output) = std::process::Command::new("clang")
            .args(["-Xclang", "-ast-dump", "-fsyntax-only", "-I"])
            .arg(&dir)
            .arg(dir.join("probe.c"))
            .output()
        else {
            eprintln!("SKIP: clang is unavailable");
            return;
        };
        assert!(
            output.status.success(),
            "clang refused the header:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );

        let dump = String::from_utf8_lossy(&output.stdout);
        let mut declared: Vec<(String, usize)> = Vec::new();
        for line in dump.lines() {
            // `FunctionDecl 0x… <…> … name 'returns (params)'`
            let Some(at) = line.find("FunctionDecl ") else { continue };
            let rest = &line[at..];
            let (Some(open), Some(close)) = (rest.find(" '"), rest.rfind('\'')) else { continue };
            if close <= open + 2 {
                continue;
            }
            let name = rest[..open].split_whitespace().last().unwrap_or("");
            if !name.starts_with("nts_") {
                continue;
            }
            let signature = &rest[open + 2..close];
            let Some(paren) = signature.find('(') else { continue };
            for (index, parameter) in
                signature[paren + 1..].trim_end_matches(')').split(',').enumerate()
            {
                if matches!(parameter.trim(), "NtsHeader *" | "const NtsHeader *") {
                    declared.push((name.to_owned(), index));
                }
            }
        }
        assert!(
            declared.len() > 15,
            "only {} header parameters parsed; the parse is wrong",
            declared.len()
        );
        declared.sort_unstable();
        declared.dedup();

        let known: Vec<(String, usize)> =
            ERASES_CLASS.iter().map(|(name, at)| ((*name).to_owned(), *at)).collect();
        assert_eq!(
            declared, known,
            "the header's `NtsHeader *` parameters and `ERASES_CLASS` disagree"
        );
    }
}
