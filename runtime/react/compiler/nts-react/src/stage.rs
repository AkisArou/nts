//! One file through the stage: converted, compiled by the React Compiler,
//! printed with its types restored and, optionally, its JSX lowered.
//!
//! What each function came to is reported beside the text, by its original
//! span: compiled, skipped (the compiler found nothing to do, or was told not
//! to), or failed (the compiler bailed out, and the function is as written).
//! A caller that checks the output hands back the functions whose compiled
//! form did not typecheck as [`PrintOptions::as_written`], and they are
//! printed as the user wrote them.

use react_compiler::entrypoint::{CompileResult, LoggerEvent, LoggerSourceLocation, PluginOptions};
use serde_json::{Value, json};

use crate::convert::text::SourceText;
use crate::convert::{self, Unsupported};
use crate::print::{self, PrintOptions, TypeOracle};
use crate::tsgo::Nodes;

/// The compiler's options for a build: what the Babel plugin resolves by
/// default, with function outlining off -- an outlined function is a new
/// top-level declaration with no source of its own to restore types from.
#[must_use]
pub fn default_options() -> Value {
    json!({
        "shouldCompile": true,
        "enableReanimated": false,
        "isDev": false,
        "compilationMode": "infer",
        "panicThreshold": "none",
        "target": "19",
        "flowSuppressions": true,
        "environment": { "enableFunctionOutlining": false },
    })
}

/// What happened to one function the compiler considered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FunctionState {
    Compiled,
    /// Left alone, for `reason`: not a component or hook, or opted out.
    Skipped(String),
    /// The compiler bailed out, for `reason`; the function is as written.
    Failed(String),
}

#[derive(Debug, Clone)]
pub struct Function {
    pub name: Option<String>,
    /// Its span in the source, in UTF-16 units.
    pub span: (u32, u32),
    /// Where its compiled form is in the output, if it was printed from the
    /// compiler's output rather than as written.
    pub output: Option<(u32, u32)>,
    pub state: FunctionState,
}

/// A file through the stage.
#[derive(Debug)]
pub struct Outcome {
    /// The file as it is to be built.
    pub text: String,
    /// Whether `text` differs from the source.
    pub changed: bool,
    pub functions: Vec<Function>,
    /// The compiler's own answer, for tools that compare it with upstream's.
    pub result: CompileResult,
}

/// Why a file could not go through the stage at all.
#[derive(Debug)]
pub enum Refused {
    /// The converter met a construct it does not handle.
    Unsupported(Unsupported),
    /// The options are not the compiler's.
    Options(serde_json::Error),
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported(why) => write!(f, "node {}: {}", why.node.0, why.what),
            Self::Options(error) => write!(f, "the options are not the compiler's: {error}"),
        }
    }
}

/// Puts one file through the stage. `code` is its text and `nodes` its tsgo
/// syntax tree, whose node 0 is the `SourceFile`; `options` are the plugin's
/// ([`default_options`]), and `filename` is what the compiler reports it as.
pub fn compile_file(
    code: &str,
    nodes: Nodes<'_>,
    filename: &str,
    options: &Value,
    types: &mut dyn TypeOracle,
    print: &PrintOptions,
) -> Result<Outcome, Refused> {
    let text = SourceText::new(code);
    let file = convert::convert_file(nodes, nts_semantic_schema::NodeId(0), &text).map_err(Refused::Unsupported)?;
    let scope = crate::scope::build(&file);
    // The plugin's bridge hands the compiler the file's text and name beside
    // its options; so does this.
    let mut options = options.clone();
    options["filename"] = Value::String(filename.to_owned());
    options["__sourceCode"] = Value::String(code.to_owned());
    let options: PluginOptions = serde_json::from_value(options).map_err(Refused::Options)?;
    let original = file.clone();
    let result = react_compiler::entrypoint::compile_program(file, scope, options);
    let (compiled, renames, events) = match &result {
        CompileResult::Success { ast, renames, events, .. } => (ast.as_ref(), renames.as_slice(), events.as_slice()),
        CompileResult::Error { events, .. } => (None, &[][..], events.as_slice()),
    };
    let mut functions: Vec<Function> = events.iter().filter_map(|event| function_of(event, &text)).collect();
    // The program as it is to be built: the user's text wherever the
    // compiler changed nothing. The compiler's renames apply even when it
    // compiled nothing, as the Babel plugin applies them: a function that
    // bailed out may have had a shadowing binding renamed while lowered.
    let printed = if compiled.is_some() || !renames.is_empty() || print.lower_jsx {
        let printed = print::print_file(&text, &original, compiled.unwrap_or(&original), renames, types, print);
        for function in &mut functions {
            function.output = printed.functions.iter().find(|p| p.original == function.span).map(|p| p.output);
        }
        printed.text
    } else {
        code.to_owned()
    };
    Ok(Outcome { changed: printed != code, text: printed, functions, result })
}

fn function_of(event: &LoggerEvent, text: &SourceText) -> Option<Function> {
    let (location, name, state) = match event {
        LoggerEvent::CompileSuccess { fn_loc, fn_name, .. } => (fn_loc.as_ref()?, fn_name.clone(), FunctionState::Compiled),
        LoggerEvent::CompileSkip { fn_loc, reason, .. } => (fn_loc.as_ref()?, None, FunctionState::Skipped(reason.clone())),
        LoggerEvent::CompileError { fn_loc, detail } => (fn_loc.as_ref()?, None, FunctionState::Failed(detail.reason.clone())),
        LoggerEvent::CompileErrorWithLoc { fn_loc, detail } => (fn_loc, None, FunctionState::Failed(detail.reason.clone())),
        LoggerEvent::CompileUnexpectedThrow { fn_loc, data } | LoggerEvent::PipelineError { fn_loc, data } => {
            (fn_loc.as_ref()?, None, FunctionState::Failed(data.clone()))
        }
    };
    Some(Function { name, span: span_of(location, text)?, output: None, state })
}

fn span_of(location: &LoggerSourceLocation, text: &SourceText) -> Option<(u32, u32)> {
    let at = |p: &react_compiler::entrypoint::LoggerPosition| p.index.or_else(|| text.offset(p.line, p.column));
    Some((at(&location.start)?, at(&location.end)?))
}
