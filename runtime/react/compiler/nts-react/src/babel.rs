//! The compiler's own input format, taken as JSON.
//!
//! Upstream's Babel plugin hands the compiler a Babel AST and its scope
//! information as JSON (compiler/packages/babel-plugin-react-compiler-rust).
//! Accepting the same input is what lets the parity harness run this crate and
//! upstream's addon on identical bytes, and it is the oracle the tsgo frontend
//! is measured against.

use anyhow::{Context, Result};
use react_compiler::entrypoint::{PluginOptions, compile_program};
use react_compiler_ast::File;
use react_compiler_ast::scope::ScopeInfo;
use serde::Deserialize;

/// A deeply nested AST exceeds `serde_json`'s default recursion limit.
fn from_json<'de, T: Deserialize<'de>>(text: &'de str) -> serde_json::Result<T> {
    let mut deserializer = serde_json::Deserializer::from_str(text);
    deserializer.disable_recursion_limit();
    T::deserialize(&mut deserializer)
}

/// Compiles a program given as Babel JSON, returning the compiler's result
/// as JSON, exactly as upstream's napi `compile` does.
pub fn compile_json(ast: &str, scope: &str, options: &str) -> Result<String> {
    let ast: File = from_json(ast).context("the AST is not a Babel `File`")?;
    let scope: ScopeInfo = from_json(scope).context("the scope is not a `ScopeInfo`")?;
    let options: PluginOptions = from_json(options).context("the options are not `PluginOptions`")?;
    let result = compile_program(ast, scope, options);
    serde_json::to_string(&result).context("the compile result does not serialize")
}
