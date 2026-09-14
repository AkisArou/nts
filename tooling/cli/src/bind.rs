//! Derive a native binding from a C header: `nts bind-c`.
//!
//! A **subprocess**, not libclang, and measured rather than assumed: see the
//! comparison in `docs/native-operations.md`. The short of it is that the
//! driver supplies its own resource directory -- so `size_t` stays `size_t` --
//! and a header it cannot find is a nonzero exit rather than a diagnostic
//! someone has to remember to read.
//!
//! Two runs of one generated translation unit:
//!
//! - `-Xclang -ast-dump=json` for the structure: records, their members, their
//!   types, and every prototype with its parameter names and variadic flag.
//! - `-Xclang -fdump-record-layouts` for the numbers, used **only to check the
//!   result**. Never `-fdump-record-layouts-complete`, which reports every
//!   packed record unpacked.
//!
//! **The generated binding is still a claim.** It is one compiler's reading of
//! one set of headers under one set of macros, and `native_witness.c` is what
//! proves it against the headers a consumer actually compiles with. What this
//! removes is the hand-typing, which is where every binding error found in this
//! lane came from: `uint8_t` for `char`, `c_int` for `short`, `c_uint32` for
//! `size_t`, a struct one member short.

use anyhow::{Context, Result, bail};
use std::fmt::Write as _;
use std::collections::{BTreeMap, BTreeSet};

/// What to bind, and from where.
pub(crate) struct Request {
    /// Headers, spelled as a binding spells them -- `sys/epoll.h`, or quoted
    /// for the project include path.
    pub(crate) headers: Vec<String>,
    /// Feature-test macros, defined before any include.
    pub(crate) defines: Vec<String>,
    /// The module name the declaration file declares.
    pub(crate) module: String,
    /// Struct and union tags to describe.
    pub(crate) records: Vec<String>,
    /// Functions to declare.
    pub(crate) functions: Vec<String>,
    /// Extra arguments for clang, such as `-I`.
    pub(crate) clang_args: Vec<String>,
    /// `NAME` or `NAME:brand`, a constant to read out of the headers.
    ///
    /// A macro, an enumerator or an expression of them -- none of which is a
    /// declaration, so no binding can carry one and every example here typed
    /// the number by hand and asserted it from C. The value comes from the
    /// compiler's own evaluator; the brand is the author's claim, like every
    /// other type in a binding, and defaults to `c_int`.
    pub(crate) constants: Vec<(String, String)>,
    /// `function:parameter`, the arguments a caller claims are not retained.
    ///
    /// **Author knowledge, which is why it is a flag.** A header states types
    /// and nothing about lifetimes: that `poll` reads its array during the call
    /// and keeps no address into it is true, is what makes passing stack
    /// storage legal, and appears nowhere a compiler could read it. Without it
    /// a generated binding is structurally right and refuses every call that
    /// passes a `local<T>()` -- which is the correct refusal, and the reason
    /// this is here rather than assumed.
    pub(crate) no_escape: Vec<(String, String)>,
    /// `tag=Name`, for a type whose declaration file should call it something
    /// other than the tag's own `PascalCase`. A generated binding is meant to
    /// replace a hand-written one in place, and the name is the one thing the
    /// header does not decide.
    pub(crate) aliases: BTreeMap<String, String>,
}

/// One member of a record, as the header declares it.
#[derive(Debug, Clone)]
struct Member {
    name: String,
    ty: Shape,
}

/// The part of C's type grammar this understands.
///
/// Anything outside it is refused by name rather than approximated: a binding
/// that describes the wrong type is the failure this whole lane exists to
/// prevent, and it is worse than a binding that does not exist.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Shape {
    /// A brand from `c:types`, already spelled the way the surface spells it.
    Scalar(&'static str),
    /// `T *`, with whether the pointee is `const`.
    Pointer(Box<Shape>, bool),
    /// `void *`, which the surface spells `Ptr<unknown>`.
    VoidPointer(bool),
    /// `T[N]` stored inline.
    Array(Box<Shape>, u64),
    /// A struct or union this binding also describes.
    Record(String),
    /// `int (*)(int)` -- a C function pointer, which the surface spells as an
    /// ordinary TypeScript function type because at this boundary that can
    /// mean nothing else.
    FnPointer(Vec<Shape>, Box<Option<Shape>>),
}

#[derive(Debug, Clone)]
struct Record {
    tag: String,
    union: bool,
    packed: bool,
    members: Vec<Member>,
}

#[derive(Debug, Clone)]
struct Function {
    name: String,
    parameters: Vec<(String, Shape)>,
    result: Option<Shape>,
    variadic: bool,
}

/// What clang reported about a record's layout, for checking the binding.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Observed {
    size: u64,
    align: u64,
    offsets: Vec<u64>,
}

/// The constants, as a TypeScript module.
///
/// A **second file, and a `.ts` rather than a `.d.ts`**, because a declaration
/// file cannot carry a value: `declare const EPOLLIN: c_int` gives the compiler
/// nothing to fold and the program nothing to pass. So the binding and the
/// constants are two files with two jobs, which is what they are.
pub(crate) fn constants(request: &Request) -> Result<String> {
    let dir = tempdir()?;
    let probe = dir.join("nts-bind-constants.c");
    let mut text = preamble(request);
    text.push_str("enum nts_bind_constants {\n");
    for (name, _) in &request.constants {
        // Parenthesised and put through an enumerator, which is the one place
        // C guarantees a constant expression is evaluated and reported. A
        // macro, an enumerator and `O_CREAT | O_WRONLY` all arrive here as one
        // integer, computed by the compiler that owns the header.
        let _ = writeln!(text, "  nts_k_{name} = ({name}),");
    }
    text.push_str("};\n");
    std::fs::write(&probe, text).with_context(|| format!("writing {}", probe.display()))?;
    let json = clang(&probe, &request.clang_args, &["-ast-dump=json"])?;
    let json: serde_json::Value =
        serde_json::from_str(&json).context("clang's JSON AST did not parse")?;

    let mut nodes = Vec::new();
    walk(&json, &mut nodes);
    let mut out = String::from("// Generated by `nts bind-c`. Edit the command, not this file.\n");
    out.push_str("//\n// Each value was evaluated by the C compiler from the headers below, not\n");
    out.push_str("// typed here. The brands are the author's claim, as they are in a binding.\n");
    for header in &request.headers {
        let _ = writeln!(out, "// {header}");
    }
    let mut brands: BTreeSet<&str> = BTreeSet::new();
    let mut body = String::new();
    for (name, brand) in &request.constants {
        let tag = format!("nts_k_{name}");
        let value = nodes
            .iter()
            .find(|n| {
                n.get("kind").and_then(serde_json::Value::as_str) == Some("EnumConstantDecl")
                    && n.get("name").and_then(serde_json::Value::as_str) == Some(tag.as_str())
            })
            .and_then(|decl| {
                // The first evaluated node under the initializer. An
                // enumerator arrives wrapped in an `ImplicitCastExpr` whose
                // own `value` is absent, so this is a search and not a field.
                let mut under = Vec::new();
                walk(decl, &mut under);
                under.iter().find_map(|n| n.get("value").and_then(serde_json::Value::as_str))
            })
            .ok_or_else(|| anyhow::anyhow!(
                "`{name}` is not a constant expression in these headers, or clang reported no value for it"
            ))?;
        // The name this file gives it, which is not always the header's.
        //
        // `program.c` includes what a binding names, so a global here becomes a
        // C identifier beside everything those headers declare. A **macro** is
        // handled -- nts releases each of its own names from whatever macro a
        // header bound it to -- but a *declaration* cannot be released, and
        // `EPOLLIN` is an enumerator. A program defining one is a redefinition,
        // exactly as any C file would be.
        //
        // Refused here with the remedy, rather than left for the C compiler to
        // report about a file nobody wrote.
        // The override if there is one, and otherwise the header's own spelling
        // *unchanged*. Not `alias_for`, which PascalCases a tag: that is right
        // for `epoll_event` becoming `EpollEvent` and wrong for a constant,
        // where `EPOLL_CTL_ADD` came out as `EPOLLCTLADD` -- a name that is
        // neither the header's nor anyone's choice.
        let local = request.aliases.get(name).cloned().unwrap_or_else(|| name.clone());
        if local == *name
            && nodes.iter().any(|n| {
                matches!(
                    n.get("kind").and_then(serde_json::Value::as_str),
                    Some("EnumConstantDecl" | "VarDecl" | "FunctionDecl")
                ) && n.get("name").and_then(serde_json::Value::as_str) == Some(name.as_str())
            })
        {
            bail!(
                "`{name}` is declared by these headers, not just defined as a macro, so a \
                 global of that name is a redefinition once program.c includes them. \
                 Give it another name with `--alias {name}=<Name>`."
            );
        }
        if brand != "boolean" {
            brands.insert(brand.as_str());
        }
        let _ = writeln!(body, "/** `{name}`, from the headers above. */");
        let _ = writeln!(body, "export const {local} = {value} as {brand};");
    }
    if !brands.is_empty() {
        let _ = writeln!(
            out,
            "\nimport type {{ {} }} from \"c:types\";",
            brands.iter().copied().collect::<Vec<_>>().join(", ")
        );
    }
    out.push('\n');
    out.push_str(&body);
    Ok(out)
}

pub(crate) fn run(request: &Request) -> Result<String> {
    if request.headers.is_empty() {
        bail!("a binding needs at least one header to describe");
    }
    let dir = tempdir()?;

    // First pass: the headers alone. This learns what each tag *is* -- a
    // struct or a union -- which the second pass needs in order to name it.
    let structure = dir.join("nts-bind-structure.c");
    std::fs::write(&structure, preamble(request))
        .with_context(|| format!("writing {}", structure.display()))?;
    let json = clang(&structure, &request.clang_args, &["-ast-dump=json"])?;
    let json: serde_json::Value =
        serde_json::from_str(&json).context("clang's JSON AST did not parse")?;
    let mut binding = Binding::default();
    binding.collect(&json, request)?;

    // Second pass: the same headers, plus something that forces each record to
    // be laid out. A tentative definition does not -- `struct utsname x;` at
    // file scope produced an empty dump -- and `sizeof` in a `_Static_assert`
    // does, while defining nothing.
    let layout = dir.join("nts-bind-layout.c");
    let mut text = preamble(request);
    for record in binding.records.values() {
        let keyword = if record.union { "union" } else { "struct" };
        let _ = writeln!(
            text,
            "_Static_assert(sizeof({keyword} {}) > 0, \"{}\");",
            record.tag, record.tag
        );
    }
    std::fs::write(&layout, text).with_context(|| format!("writing {}", layout.display()))?;
    let layouts = clang(&layout, &request.clang_args, &["-fdump-record-layouts"])?;

    binding.check(&parse_layouts(&layouts))?;
    Ok(binding.render(request))
}

/// The macros and includes both probe translation units start with.
fn preamble(request: &Request) -> String {
    let mut text = String::from("/* Generated by `nts bind-c`. Not part of any program. */\n");
    for define in &request.defines {
        match define.split_once('=') {
            Some((name, value)) => {
                let _ = writeln!(text, "#define {name} {value}");
            }
            None => {
                let _ = writeln!(text, "#define {define} 1");
            }
        }
    }
    for header in &request.headers {
        let spelled = if header.starts_with('<') || header.starts_with('"') {
            header.clone()
        } else {
            format!("<{header}>")
        };
        let _ = writeln!(text, "#include {spelled}");
    }
    text
}

fn clang(probe: &std::path::Path, extra: &[String], cc1: &[&str]) -> Result<String> {
    let mut command = std::process::Command::new(std::env::var("CC").unwrap_or("clang".into()));
    command.args(["-std=c11", "-fsyntax-only"]);
    for flag in cc1 {
        command.arg("-Xclang").arg(flag);
    }
    command.args(extra).arg(probe);
    let output = command.output().context("running clang")?;
    // A header clang cannot find is a nonzero exit here, which is the property
    // this route was chosen for. libclang would have parsed on and answered.
    if !output.status.success() {
        bail!(
            "clang refused the probe translation unit:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn tempdir() -> Result<std::path::PathBuf> {
    let base = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_owned());
    let dir = std::path::Path::new(&base).join("nts-bind");
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    Ok(dir)
}

#[derive(Default)]
struct Binding {
    records: BTreeMap<String, Record>,
    functions: Vec<Function>,
}

fn children(node: &serde_json::Value) -> &[serde_json::Value] {
    node.get("inner").and_then(serde_json::Value::as_array).map_or(&[], Vec::as_slice)
}

fn walk<'a>(node: &'a serde_json::Value, out: &mut Vec<&'a serde_json::Value>) {
    out.push(node);
    for child in children(node) {
        walk(child, out);
    }
}

impl Binding {
    /// One record by tag, read out of the parse.
    ///
    /// `None` when these headers hold no complete definition of it -- the
    /// caller decides whether that is a refusal, because a requested tag that
    /// is missing and a nested one that is missing are different sentences.
    fn record_named(
        nodes: &[&serde_json::Value],
        tag: &str,
        typedefs: &BTreeMap<String, String>,
    ) -> Result<Option<Record>> {
        let Some(node) = nodes.iter().find(|n| {
            n.get("kind").and_then(serde_json::Value::as_str) == Some("RecordDecl")
                && n.get("completeDefinition") == Some(&serde_json::Value::Bool(true))
                && n.get("name").and_then(serde_json::Value::as_str) == Some(tag)
        }) else {
            return Ok(None);
        };
        let union = node.get("tagUsed").and_then(serde_json::Value::as_str) == Some("union");
        let packed = children(node)
            .iter()
            .any(|c| c.get("kind").and_then(serde_json::Value::as_str) == Some("PackedAttr"));
        let mut members = Vec::new();
        for field in children(node) {
            if field.get("kind").and_then(serde_json::Value::as_str) != Some("FieldDecl") {
                continue;
            }
            // A bit-field is a member with no address and no byte offset:
            // `&p->version` does not compile, the surface has no spelling for
            // one, and `hir::layout` has no rule for packing them. The layout
            // self-check already refuses such a record -- it cannot reproduce a
            // layout whose members have no byte offsets -- but it does so by
            // reporting two sizes, which names the symptom. Named here instead.
            if field.get("isBitfield") == Some(&serde_json::Value::Bool(true)) {
                let member =
                    field.get("name").and_then(serde_json::Value::as_str).unwrap_or("<unnamed>");
                bail!(
                    "`{tag}.{member}` is a bit-field, which this surface cannot describe: it has \
                     no address and no byte offset. Bind the record through an opaque pointer, \
                     or read it from C."
                );
            }
            let (written, desugared) = qual_type(field).unwrap_or_default();
            let member = field.get("name").and_then(serde_json::Value::as_str).ok_or_else(|| {
                anyhow::anyhow!(
                    "`{tag}` has an unnamed member of type `{written}`, which has no spelling in a binding"
                )
            })?;
            let ty = shape_of(written, desugared, typedefs)
                .with_context(|| format!("member `{member}` of `{tag}`"))?;
            members.push(Member { name: member.to_owned(), ty });
        }
        if members.is_empty() {
            bail!("`{tag}` has no members, which is not a layout a binding can describe");
        }
        Ok(Some(Record { tag: tag.to_owned(), union, packed, members }))
    }

    fn collect(&mut self, json: &serde_json::Value, request: &Request) -> Result<()> {
        let mut nodes = Vec::new();
        walk(json, &mut nodes);

        // Every typedef this parse recorded, name to underlying spelling. Built
        // once: `shape` resolves a chain one hop at a time and there are 137 of
        // them in a parse of two headers.
        let typedefs: BTreeMap<String, String> = nodes
            .iter()
            .filter(|n| n.get("kind").and_then(serde_json::Value::as_str) == Some("TypedefDecl"))
            .filter_map(|n| {
                Some((
                    n.get("name")?.as_str()?.to_owned(),
                    n.get("type")?.get("qualType")?.as_str()?.to_owned(),
                ))
            })
            .collect();

        let wanted_records: BTreeSet<&str> = request.records.iter().map(String::as_str).collect();
        let wanted_functions: BTreeSet<&str> =
            request.functions.iter().map(String::as_str).collect();

        // Records first: a prototype naming one has to find it already here.
        // A tag may be defined more than once across a header set; the last
        // complete definition wins, and `check` catches any disagreement with
        // the layout clang actually used.
        for tag in &wanted_records {
            if let Some(record) = Self::record_named(&nodes, tag, &typedefs)? {
                self.records.insert((*tag).to_owned(), record);
            }
        }
        for tag in &wanted_records {
            if !self.records.contains_key(*tag) {
                bail!("no complete definition of `{tag}` in these headers");
            }
        }

        self.pull_in_nested(&nodes, &typedefs)?;

        for node in &nodes {
            let Some(name) = node.get("name").and_then(serde_json::Value::as_str) else { continue };
            if node.get("kind").and_then(serde_json::Value::as_str) != Some("FunctionDecl")
                || !wanted_functions.contains(name)
                || self.functions.iter().any(|f| f.name == name)
            {
                continue;
            }
            let (signature, _) = qual_type(node).unwrap_or_default();
            let result = signature
                .split_once(" (")
                .map(|(before, _)| before.trim())
                .ok_or_else(|| anyhow::anyhow!("`{name}` has an unreadable type `{signature}`"))?;
            let result =
                if result == "void" { None } else { Some(shape(result, &typedefs)?) };
            let mut parameters = Vec::new();
            for (at, parameter) in children(node)
                .iter()
                .filter(|c| c.get("kind").and_then(serde_json::Value::as_str) == Some("ParmVarDecl"))
                .enumerate()
            {
                let (written, desugared) = qual_type(parameter).unwrap_or_default();
                // A header's parameter names are reserved spellings --
                // `__epfd`, `__fd` -- so they are stripped to something a
                // declaration file can carry. A nameless one gets its position.
                let spelled = parameter
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .map_or_else(|| format!("arg{at}"), |n| n.trim_start_matches('_').to_owned());
                parameters.push((
                    spelled,
                    shape_of(written, desugared, &typedefs)
                        .with_context(|| format!("parameter {at} of `{name}`"))?,
                ));
            }
            self.functions.push(Function {
                name: name.to_owned(),
                parameters,
                result,
                variadic: node.get("variadic") == Some(&serde_json::Value::Bool(true)),
            });
        }
        for wanted in &wanted_functions {
            if !self.functions.iter().any(|f| f.name == *wanted) {
                bail!("no declaration of `{wanted}` in these headers");
            }
        }
        Ok(())
    }

    /// Records stored inline in one being bound, brought in with it.
    ///
    /// Required and not optional: a nested record's layout *is* part of the
    /// outer layout, so without it nothing can be checked and nothing spelled.
    /// Pulled in rather than demanded -- `struct sockaddr_in` holds a `struct
    /// in_addr`, and asking for the second is bookkeeping this can do.
    fn pull_in_nested(
        &mut self,
        nodes: &[&serde_json::Value],
        typedefs: &BTreeMap<String, String>,
    ) -> Result<()> {
        // A record stored inline in a requested one is required, not optional:
        // its layout is part of the outer layout, so without it nothing can be
        // checked and nothing can be spelled. Pulled in rather than demanded --
        // `struct sockaddr_in` holds a `struct in_addr` and asking for the
        // second is bookkeeping the tool can do. Repeated until it settles,
        // because a nested record may nest.
        loop {
            let nested: BTreeSet<String> = self
                .records
                .values()
                .flat_map(|record| &record.members)
                .filter_map(|member| match &member.ty {
                    Shape::Record(tag) if !self.records.contains_key(tag) => Some(tag.clone()),
                    Shape::Array(element, _) => match &**element {
                        Shape::Record(tag) if !self.records.contains_key(tag) => Some(tag.clone()),
                        _ => None,
                    },
                    _ => None,
                })
                .collect();
            if nested.is_empty() {
                break;
            }
            let mut found = false;
            for tag in &nested {
                if let Some(record) = Self::record_named(nodes, tag, typedefs)? {
                    self.records.insert(tag.clone(), record);
                    found = true;
                }
            }
            if !found {
                bail!(
                    "these headers define no complete `{}`, which is stored inline in a record being bound",
                    nested.iter().next().map_or("", String::as_str)
                );
            }
        }

        Ok(())
    }
}

/// A type as written, and as clang desugars it.
///
/// Both, because they answer different questions. `uint32_t` is what the header
/// said and is the spelling a binding should keep; `union epoll_data` is what
/// it means, and is the only form that names a tag. Preferring the written one
/// and falling back is how `epoll_data_t` becomes a record and `uint32_t` stays
/// `c_uint32` rather than collapsing to `c_uint`.
fn qual_type(node: &serde_json::Value) -> Option<(&str, Option<&str>)> {
    let ty = node.get("type")?;
    Some((
        ty.get("qualType")?.as_str()?,
        ty.get("desugaredQualType").and_then(serde_json::Value::as_str),
    ))
}

/// The written spelling if it is one this knows, else the desugared one.
fn shape_of(
    written: &str,
    desugared: Option<&str>,
    typedefs: &BTreeMap<String, String>,
) -> Result<Shape> {
    match (shape(written, typedefs), desugared) {
        (Ok(shape), _) => Ok(shape),
        (Err(first), Some(desugared)) => shape(desugared, typedefs).map_err(|_| first),
        (Err(first), None) => Err(first),
    }
}

/// One C type spelling, mapped onto the surface `c:types` publishes.
///
/// **Refuses by name rather than approximating.** Every wrong binding this lane
/// has found was a plausible near-miss -- `uint8_t` where the header says
/// `char`, `c_int` where it says `short` -- so a spelling this does not know is
/// an error naming the spelling, not a guess.
///
/// The *written* type is preferred over the canonical one where both name a
/// brand: `uint32_t` is `c_uint32` and `unsigned int` is `c_uint`, and on this
/// target they are the same type spelled by two declarations that mean
/// different things to a reader.
fn shape(c_type: &str, typedefs: &BTreeMap<String, String>) -> Result<Shape> {
    let c_type = c_type.trim();
    if let Some(inner) = c_type.strip_suffix('*') {
        let inner = inner.trim();
        let (inner, constant) = match inner.strip_prefix("const ") {
            Some(rest) => (rest.trim(), true),
            None => (inner, false),
        };
        if inner == "void" {
            return Ok(Shape::VoidPointer(constant));
        }
        return Ok(Shape::Pointer(Box::new(shape(inner, typedefs)?), constant));
    }
    if let Some((element, count)) = c_type.strip_suffix(']').and_then(|s| s.rsplit_once('[')) {
        let count: u64 = count
            .trim()
            .parse()
            .with_context(|| format!("`{c_type}` has no constant length"))?;
        return Ok(Shape::Array(Box::new(shape(element, typedefs)?), count));
    }
    // `R (*)(A, B)`. The declarator wraps the name, so the parentheses are
    // where the type is: everything before `(*)(` is the result and everything
    // inside the second pair is the parameters.
    if let Some((result, rest)) = c_type.split_once("(*)(")
        && let Some(parameters) = rest.strip_suffix(')')
    {
        let result = result.trim();
        let result = if result == "void" { None } else { Some(shape(result, typedefs)?) };
        let parameters = if parameters.trim() == "void" || parameters.trim().is_empty() {
            Vec::new()
        } else {
            split_arguments(parameters)
                .into_iter()
                .map(|one| shape(&one, typedefs))
                .collect::<Result<Vec<_>>>()?
        };
        return Ok(Shape::FnPointer(parameters, Box::new(result)));
    }
    for keyword in ["struct ", "union "] {
        if let Some(tag) = c_type.strip_prefix(keyword) {
            let tag = tag.trim();
            // clang spells an anonymous record by where it was written --
            // `(unnamed at /usr/include/bits/sigaction.h:31:5)`. That is a
            // location, not a tag, and the surface has no way to name a type
            // the header did not name. `struct sigaction` holds one.
            if tag.starts_with('(') {
                bail!(
                    "an anonymous {}, which this surface cannot describe: it has no tag to \
                     name and clang spells it as {tag}. Bind the record through an opaque \
                     pointer, or reach the member from C.",
                    keyword.trim()
                );
            }
            return Ok(Shape::Record(tag.to_owned()));
        }
    }
    // The fixed-width and pointer-width typedefs first, by their written name:
    // a binding saying `c_size_t` says something `c_uint64` does not.
    let brand = match c_type {
        "char" => "c_char",
        "signed char" | "int8_t" => "c_int8",
        "unsigned char" | "uint8_t" => "c_uint8",
        "short" | "short int" | "int16_t" => "c_int16",
        "unsigned short" | "short unsigned int" | "uint16_t" => "c_uint16",
        "int" => "c_int",
        "int32_t" => "c_int32",
        "unsigned int" => "c_uint",
        "uint32_t" => "c_uint32",
        "long" | "long int" => "c_long",
        "unsigned long" | "unsigned long int" => "c_ulong",
        "long long" | "int64_t" => "c_int64",
        "unsigned long long" | "uint64_t" => "c_uint64",
        "size_t" => "c_size_t",
        "ssize_t" | "ptrdiff_t" => "c_ptrdiff_t",
        "float" => "c_float",
        "double" => "c_double",
        "_Bool" | "bool" => "boolean",
        // A typedef clang recorded, resolved one hop at a time.
        //
        // **The table, not `desugaredQualType`.** That field is absent for an
        // array type: `cc_t[32]` and `__syscall_slong_t[3]` carry no desugared
        // form at all, so the fallback that handles a plain `cc_t` had nothing
        // to fall back to and `struct stat` and `struct termios` were both
        // refused for a typedef the parse had already resolved.
        other => {
            let next = typedefs.get(other).ok_or_else(|| anyhow::anyhow!(
                "`{other}` is a C type this does not know how to spell in a binding; \
                 add it to `shape` beside the others rather than letting it be guessed"
            ))?;
            // A chain terminates: clang's own typedefs are acyclic, and a name
            // that resolved to itself would be a parse this could not have got.
            if next == other {
                bail!("`{other}` is a typedef of itself, which clang cannot have reported");
            }
            return shape(next, typedefs);
        }
    };
    Ok(Shape::Scalar(brand))
}

/// A C parameter list split on its top-level commas.
///
/// Depth-aware, because a parameter may itself be a function pointer and
/// `void (*)(int, char)` inside one is a single argument. Splitting on every
/// comma would have read that as two.
fn split_arguments(list: &str) -> Vec<String> {
    let (mut out, mut depth, mut current) = (Vec::new(), 0i32, String::new());
    for ch in list.chars() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                out.push(std::mem::take(&mut current));
                continue;
            }
            _ => {}
        }
        current.push(ch);
    }
    if !current.trim().is_empty() {
        out.push(current);
    }
    out.into_iter().map(|one| one.trim().to_owned()).collect()
}

/// `epoll_event` becomes `EpollEvent`. The tag itself stays in the type, where
/// the witness reads it; this is only what the declaration file calls it.
fn alias_for(tag: &str, overrides: &BTreeMap<String, String>) -> String {
    overrides.get(tag).cloned().unwrap_or_else(|| alias(tag))
}

fn alias(tag: &str) -> String {
    tag.split('_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars.next().map_or_else(String::new, |first| {
                first.to_uppercase().collect::<String>() + chars.as_str()
            })
        })
        .collect()
}

/// What `-fdump-record-layouts` said, keyed by tag.
///
/// The format is indentation and pipes:
///
/// ```text
/// *** Dumping AST Record Layout
///          0 | struct epoll_event
///          0 |   uint32_t events
///          4 |   union epoll_data data
///            | [sizeof=12, align=1]
/// ```
///
/// Only the outermost members are read -- depth is the indentation after the
/// pipe -- because a nested record is dumped in its own entry as well.
fn parse_layouts(text: &str) -> BTreeMap<String, Observed> {
    let mut found = BTreeMap::new();
    let mut tag: Option<String> = None;
    let mut offsets: Vec<u64> = Vec::new();
    for line in text.lines() {
        let Some((left, right)) = line.split_once('|') else { continue };
        // Depth is the run of spaces after the pipe: one for the record's own
        // line and for its `[sizeof=...]`, three for a member, five for a
        // member of a member. Counting it rather than stripping a fixed prefix
        // -- the first version stripped two and so never matched the size line,
        // which has one, and reported that nothing had been laid out.
        let body = right.trim_start();
        let depth = right.len() - body.len();
        if let Some(rest) = body.strip_prefix("[sizeof=") {
            let (size, rest) = rest.split_once(',').unwrap_or((rest, ""));
            let align = rest.trim().trim_start_matches("align=").trim_end_matches(']');
            if let (Some(name), Ok(size), Ok(align)) =
                (tag.take(), size.trim().parse(), align.trim().parse())
            {
                found.insert(name, Observed { size, align, offsets: std::mem::take(&mut offsets) });
            }
            offsets.clear();
            continue;
        }
        let Ok(offset) = left.trim().parse::<u64>() else { continue };
        if depth == 1 {
            // The record's own line. A tag it is: `struct epoll_event`, or an
            // anonymous one clang spells with a source location, which is not
            // a name a binding can carry and is left for `check` to miss.
            tag = body
                .strip_prefix("struct ")
                .or_else(|| body.strip_prefix("union "))
                .filter(|rest| !rest.contains(' '))
                .map(str::to_owned);
            offsets.clear();
        } else if depth == 3 && tag.is_some() {
            offsets.push(offset);
        }
    }
    found
}

impl Binding {
    /// Reproduce each record's layout and compare it with the one clang used.
    ///
    /// **The generator checking itself, before anything is written.** A binding
    /// that cannot account for the size the compiler computed is wrong in a way
    /// that no later step would question: it typechecks, it lowers, and it puts
    /// every field somewhere the library does not look. Refused here, naming
    /// both numbers, rather than handed to a person to notice.
    ///
    /// It is not a substitute for `native_witness.c`. This compares against the
    /// same clang invocation that produced the binding; the witness compares
    /// against the headers a consumer really compiles with, under their macros.
    fn check(&self, observed: &BTreeMap<String, Observed>) -> Result<()> {
        for record in self.records.values() {
            let Some(seen) = observed.get(&record.tag) else {
                bail!(
                    "clang laid out no `{}`, so nothing checks this binding",
                    record.tag
                );
            };
            let computed = self.place(record)?;
            if computed != *seen {
                bail!(
                    "the binding for `{}` does not reproduce the layout clang computed:\n  \
                     binding: size {} align {} offsets {:?}\n  clang:   size {} align {} offsets {:?}",
                    record.tag,
                    computed.size, computed.align, computed.offsets,
                    seen.size, seen.align, seen.offsets,
                );
            }
        }
        Ok(())
    }

    /// The layout this binding describes, by the same rules `hir::layout` uses.
    fn place(&self, record: &Record) -> Result<Observed> {
        let mut shapes = Vec::new();
        for member in &record.members {
            shapes.push(self.size_align(&member.ty).with_context(|| {
                format!("member `{}` of `{}`", member.name, record.tag)
            })?);
        }
        if record.union {
            let align = shapes.iter().map(|(_, a)| *a).max().unwrap_or(1);
            let largest = shapes.iter().map(|(s, _)| *s).max().unwrap_or(0);
            return Ok(Observed {
                size: largest.div_ceil(align) * align,
                align,
                offsets: vec![0; shapes.len()],
            });
        }
        let (mut at, mut align, mut offsets) = (0u64, 1u64, Vec::new());
        for (size, member_align) in shapes {
            if !record.packed {
                at = at.div_ceil(member_align) * member_align;
                align = align.max(member_align);
            }
            offsets.push(at);
            at += size;
        }
        Ok(Observed { size: if record.packed { at } else { at.div_ceil(align) * align }, align, offsets })
    }

    fn size_align(&self, shape: &Shape) -> Result<(u64, u64)> {
        Ok(match shape {
            Shape::Pointer(..) | Shape::VoidPointer(_) | Shape::FnPointer(..) => (8, 8),
            Shape::Array(element, count) => {
                let (size, align) = self.size_align(element)?;
                (size * count, align)
            }
            Shape::Record(tag) => {
                let nested = self.records.get(tag).ok_or_else(|| {
                    anyhow::anyhow!(
                        "`{tag}` is stored inline but is not one of the records being bound; \
                         name it too, or the layout cannot be checked"
                    )
                })?;
                let placed = self.place(nested)?;
                (placed.size, placed.align)
            }
            // Exhaustive, with no catch-all. A `_ => (8, 8)` here is how
            // `c_uint32` -- added to `shape` and not to this -- became eight
            // bytes, which put `epoll_event`'s union at offset 8 and made the
            // struct 16. The self-check below caught it, and would not have
            // had the fallback been an honest 8-byte type.
            Shape::Scalar(brand) => match *brand {
                "c_char" | "c_int8" | "c_uint8" | "boolean" => (1, 1),
                "c_int16" | "c_uint16" => (2, 2),
                "c_int" | "c_uint" | "c_int32" | "c_uint32" | "c_float" => (4, 4),
                "c_long" | "c_ulong" | "c_int64" | "c_uint64" | "c_size_t" | "c_ptrdiff_t"
                | "c_double" => (8, 8),
                other => bail!(
                    "`{other}` has no size here; every brand `shape` can produce needs one, \
                     and a catch-all would give a wrong answer rather than this message"
                ),
            },
        })
    }
}

impl Shape {
    /// How the surface spells this, given the aliases the file declares.
    fn spell(&self, aliases: &BTreeMap<String, String>) -> String {
        match self {
            Self::Scalar(brand) => (*brand).to_owned(),
            Self::VoidPointer(true) => "ConstPtr<unknown>".to_owned(),
            Self::VoidPointer(false) => "Ptr<unknown>".to_owned(),
            Self::Pointer(inner, true) => format!("ConstPtr<{}>", inner.spell(aliases)),
            Self::Pointer(inner, false) => format!("Ptr<{}>", inner.spell(aliases)),
            Self::Array(element, count) => format!("CArray<{}, {count}>", element.spell(aliases)),
            Self::Record(tag) => alias_for(tag, aliases),
            Self::FnPointer(parameters, result) => format!(
                "({}) => {}",
                parameters
                    .iter()
                    .enumerate()
                    .map(|(at, ty)| format!("arg{at}: {}", ty.spell(aliases)))
                    .collect::<Vec<_>>()
                    .join(", "),
                result.as_ref().as_ref().map_or_else(|| "void".to_owned(), |ty| ty.spell(aliases))
            ),
        }
    }

    /// The names from `c:types` this spelling needs imported.
    fn imports(&self, into: &mut BTreeSet<&'static str>) {
        match self {
            // `boolean` is TypeScript's own and needs no import.
            Self::Scalar(brand) => {
                if *brand != "boolean" {
                    into.insert(brand);
                }
            }
            Self::VoidPointer(constant) => {
                into.insert(if *constant { "ConstPtr" } else { "Ptr" });
            }
            Self::Pointer(inner, constant) => {
                into.insert(if *constant { "ConstPtr" } else { "Ptr" });
                inner.imports(into);
            }
            Self::Array(element, _) => {
                into.insert("CArray");
                element.imports(into);
            }
            Self::Record(_) => {}
            Self::FnPointer(parameters, result) => {
                for parameter in parameters {
                    parameter.imports(into);
                }
                if let Some(result) = result.as_ref() {
                    result.imports(into);
                }
            }
        }
    }
}

impl Binding {
    fn render(&self, request: &Request) -> String {
        let mut needed: BTreeSet<&'static str> = BTreeSet::new();
        for record in self.records.values() {
            needed.insert(if record.union { "Union" } else { "Struct" });
            if record.packed {
                needed.insert("Packed");
            }
            for member in &record.members {
                member.ty.imports(&mut needed);
            }
        }
        for function in &self.functions {
            for (_, ty) in &function.parameters {
                ty.imports(&mut needed);
            }
            if let Some(result) = &function.result {
                result.imports(&mut needed);
            }
        }

        let mut out = String::new();
        out.push_str("// Generated by `nts bind-c`. Edit the command, not this file.\n//\n");
        out.push_str("// Derived from one compiler's reading of these headers under these macros,\n");
        out.push_str("// which makes it a claim like any hand-written binding. `native_witness.c`\n");
        out.push_str("// is what proves it against the headers a consumer actually compiles with.\n");
        out.push_str("/**\n");
        for header in &request.headers {
            let _ = writeln!(out, " * @ntsHeader {header}");
        }
        for define in &request.defines {
            let _ = writeln!(out, " * @ntsDefine {define}");
        }
        out.push_str(" */\n");
        let _ = writeln!(out, "declare module \"{}\" {{", request.module);
        if !needed.is_empty() {
            let _ = writeln!(
                out,
                "  import type {{ {} }} from \"c:types\";",
                needed.iter().copied().collect::<Vec<_>>().join(", ")
            );
        }
        for record in self.records.values() {
            let keyword = if record.union { "Union" } else { "Struct" };
            let members = record
                .members
                .iter()
                .map(|m| format!("    {}: {};", m.name, m.ty.spell(&request.aliases)))
                .collect::<Vec<_>>()
                .join("\n");
            let body = format!("{keyword}<{{\n{members}\n  }}, \"{}\">", record.tag);
            let body = if record.packed { format!("Packed<{body}>") } else { body };
            let _ = writeln!(out, "  export type {} = {body};", alias_for(&record.tag, &request.aliases));
        }
        for function in &self.functions {
            let borrowed: Vec<&str> = request
                .no_escape
                .iter()
                .filter(|(name, _)| *name == function.name)
                .map(|(_, parameter)| parameter.as_str())
                .collect();
            if !borrowed.is_empty() {
                let _ = write!(
                    out,
                    "  /** Nothing of {} outlives the call -- an authored claim, which no header\n   * states and this tool did not read anywhere.\n   * @ntsNoEscape {} */\n",
                    borrowed
                        .iter()
                        .map(|p| format!("`{p}`"))
                        .collect::<Vec<_>>()
                        .join(" or "),
                    borrowed.join(" ")
                );
            }
            let mut parameters: Vec<String> = function
                .parameters
                .iter()
                .map(|(name, ty)| format!("{name}: {}", ty.spell(&request.aliases)))
                .collect();
            if function.variadic {
                // The tail's element type is a claim C's prototype cannot make,
                // so it is the one thing here a person has to decide. `unknown`
                // does not compile, which is the intent: it stops at the
                // declaration rather than at a call.
                parameters.push("...rest: unknown[] /* TODO: the tail's C type */".to_owned());
            }
            let result = function
                .result
                .as_ref()
                .map_or_else(|| "void".to_owned(), |ty| ty.spell(&request.aliases));
            let _ = writeln!(
                out,
                "  export function {}({}): {result};",
                function.name,
                parameters.join(", ")
            );
        }
        out.push_str("}\n");
        out
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    /// Real output, kept verbatim. The parser reads indentation, so a
    /// paraphrase would test a format clang does not produce -- and the first
    /// version of it stripped a fixed two-space prefix, which never matched the
    /// `[sizeof=...]` line and reported that nothing had been laid out.
    const DUMP: &str = "\n*** Dumping AST Record Layout\n\
         0 | struct epoll_event\n\
         0 |   uint32_t events\n\
         4 |   union epoll_data data\n\
         4 |     void * ptr\n\
         4 |     int fd\n\
         4 |     uint32_t u32\n\
         4 |     uint64_t u64\n\
           | [sizeof=12, align=1]\n\
\n*** Dumping AST Record Layout\n\
         0 | struct utsname\n\
         0 |   char[65] sysname\n\
        65 |   char[65] nodename\n\
           | [sizeof=390, align=1]\n";

    #[test]
    fn a_layout_dump_yields_sizes_and_only_the_outer_members() {
        let found = parse_layouts(DUMP);
        let event = found.get("epoll_event").expect("epoll_event");
        assert_eq!(event.size, 12);
        assert_eq!(event.align, 1);
        // Two members, not six: the union's own members sit at depth five and
        // belong to its entry, not to this one.
        assert_eq!(event.offsets, vec![0, 4]);
        let utsname = found.get("utsname").expect("utsname");
        assert_eq!((utsname.size, utsname.align), (390, 1));
        assert_eq!(utsname.offsets, vec![0, 65]);
    }

    #[test]
    fn c_spellings_map_or_are_refused_by_name() {
        // `cc_t` stands for the case the survey found: a typedef reached
        // through an array, where clang reports no `desugaredQualType` at all.
        let typedefs: BTreeMap<String, String> =
            [("cc_t".to_owned(), "unsigned char".to_owned())].into_iter().collect();
        let shape = |c_type: &str| super::shape(c_type, &typedefs);
        assert_eq!(shape("char").unwrap(), Shape::Scalar("c_char"));
        // `char` and `uint8_t` are different types with one representation,
        // which is the distinction a hand-written binding got wrong first.
        assert_eq!(shape("unsigned char").unwrap(), Shape::Scalar("c_uint8"));
        assert_eq!(shape("size_t").unwrap(), Shape::Scalar("c_size_t"));
        assert_eq!(shape("short int").unwrap(), Shape::Scalar("c_int16"));
        assert_eq!(
            shape("const char *").unwrap(),
            Shape::Pointer(Box::new(Shape::Scalar("c_char")), true)
        );
        assert_eq!(shape("void *").unwrap(), Shape::VoidPointer(false));
        assert_eq!(
            shape("char[65]").unwrap(),
            Shape::Array(Box::new(Shape::Scalar("c_char")), 65)
        );
        assert_eq!(shape("struct pollfd").unwrap(), Shape::Record("pollfd".to_owned()));
        // A function pointer, which is a member of `struct sigaction` and of
        // every registration table in C.
        assert_eq!(
            shape("int (*)(int)").unwrap(),
            Shape::FnPointer(
                vec![Shape::Scalar("c_int")],
                Box::new(Some(Shape::Scalar("c_int")))
            )
        );
        assert_eq!(
            shape("void (*)(void)").unwrap(),
            Shape::FnPointer(Vec::new(), Box::new(None))
        );
        // The parameter list is split on *top-level* commas only: a parameter
        // that is itself a function pointer holds its own, and splitting on
        // every comma would read `void (*)(int, char)` as two arguments.
        assert_eq!(
            split_arguments("int, void (*)(int, char), char *"),
            vec!["int", "void (*)(int, char)", "char *"]
        );
        // An anonymous record has no tag to name -- clang spells it as a source
        // location -- and `struct sigaction` holds one.
        let anonymous = shape("union (unnamed at /usr/include/bits/sigaction.h:31:5)")
            .unwrap_err()
            .to_string();
        assert!(anonymous.contains("anonymous union"), "{anonymous}");
        // Through a typedef, and through one reached inside an array -- which
        // is the shape with no `desugaredQualType` to fall back on.
        assert_eq!(shape("cc_t").unwrap(), Shape::Scalar("c_uint8"));
        assert_eq!(
            shape("cc_t[32]").unwrap(),
            Shape::Array(Box::new(Shape::Scalar("c_uint8")), 32)
        );
        // Refused by name rather than approximated. A near-miss is the failure
        // this tool exists to remove, so an unknown spelling must not become a
        // plausible neighbour.
        let refused = shape("_Complex double").unwrap_err().to_string();
        assert!(refused.contains("_Complex double"), "{refused}");
    }

    fn record(tag: &str, union: bool, packed: bool, members: &[(&str, Shape)]) -> Record {
        Record {
            tag: tag.to_owned(),
            union,
            packed,
            members: members
                .iter()
                .map(|(name, ty)| Member { name: (*name).to_owned(), ty: ty.clone() })
                .collect(),
        }
    }

    fn request(no_escape: Vec<(String, String)>) -> Request {
        Request {
            headers: vec!["string.h".to_owned()],
            defines: Vec::new(),
            module: "c:x".to_owned(),
            records: Vec::new(),
            functions: Vec::new(),
            clang_args: Vec::new(),
            constants: Vec::new(),
            no_escape,
            aliases: BTreeMap::new(),
        }
    }

    /// An importer leaves effects **Unknown** rather than inventing them from
    /// C types.
    ///
    /// The temptation is real and the inference is wrong: `const void *` looks
    /// like a promise not to keep the pointer and is nothing of the kind --
    /// `const` restricts what the callee may *write through*, not what it may
    /// retain, and `strdup`'s argument is `const char *`. A header states types
    /// and says nothing about lifetimes, so a contract can only come from an
    /// author, which is why `--no-escape` is a flag and not a heuristic.
    ///
    /// The second arm is what makes the first a check: with the flag, the tag
    /// does appear, so this cannot pass on a tool that stopped emitting tags
    /// altogether.
    #[test]
    fn a_derived_binding_invents_no_contract_from_a_c_type() {
        let mut binding = Binding::default();
        binding.functions.push(Function {
            name: "keeps_it".to_owned(),
            // Every shape that might tempt an inference: a const view, a plain
            // pointer, and a `void *`.
            parameters: vec![
                ("a".to_owned(), Shape::VoidPointer(true)),
                ("b".to_owned(), Shape::Pointer(Box::new(Shape::Scalar("c_char")), true)),
                ("c".to_owned(), Shape::Pointer(Box::new(Shape::Scalar("c_int")), false)),
            ],
            result: Some(Shape::Scalar("c_int")),
            variadic: false,
        });

        let silent = binding.render(&request(Vec::new()));
        assert!(
            !silent.contains("@ntsNoEscape"),
            "a header states no lifetime, so nothing here may claim one:\n{silent}"
        );
        assert!(silent.contains("ConstPtr<unknown>"), "{silent}");

        let authored = binding.render(&request(vec![
            ("keeps_it".to_owned(), "a".to_owned()),
        ]));
        assert!(authored.contains("@ntsNoEscape a"), "{authored}");
        assert!(
            authored.contains("an authored claim"),
            "the generated file has to say whose claim it is:\n{authored}"
        );
    }

    #[test]
    fn the_binding_reproduces_the_layouts_it_describes_and_refuses_when_it_cannot() {
        let mut binding = Binding::default();
        binding.records.insert(
            "epoll_data".to_owned(),
            record("epoll_data", true, false, &[
                ("ptr", Shape::VoidPointer(false)),
                ("fd", Shape::Scalar("c_int")),
                ("u64", Shape::Scalar("c_uint64")),
            ]),
        );
        binding.records.insert(
            "epoll_event".to_owned(),
            record("epoll_event", false, true, &[
                ("events", Shape::Scalar("c_uint32")),
                ("data", Shape::Record("epoll_data".to_owned())),
            ]),
        );
        let observed = parse_layouts(DUMP);
        let mut clang = BTreeMap::new();
        clang.insert("epoll_event".to_owned(), observed["epoll_event"].clone());
        clang.insert(
            "epoll_data".to_owned(),
            Observed { size: 8, align: 8, offsets: vec![0, 0, 0] },
        );
        binding.check(&clang).expect("the packed struct and the union must agree");

        // The arm that makes the one above a check: unpacked, the same members
        // are sixteen bytes with the union at eight. If `check` passed this,
        // it would pass a binding that puts every field where the library does
        // not look.
        let mut wrong = binding;
        wrong.records.get_mut("epoll_event").unwrap().packed = false;
        let refused = wrong.check(&clang).unwrap_err().to_string();
        assert!(refused.contains("does not reproduce"), "{refused}");
        assert!(refused.contains("size 16"), "{refused}");
    }
}
