// Case ownership is checked by tooling/gate/test-layout.ts.
// Add a case module here; Cargo never discovers one binary per file.

#[path = "../../test-support/scratch.rs"]
mod scratch;

#[path = "builtin_study_controls.rs"]
mod builtin_study_controls;

#[path = "chain_links.rs"]
mod chain_links;

#[path = "closure_results.rs"]
mod closure_results;

#[path = "dates.rs"]
mod dates;

#[path = "delete_expression.rs"]
mod delete_expression;

#[path = "error_hierarchy.rs"]
mod error_hierarchy;

#[path = "generic_value_contexts.rs"]
mod generic_value_contexts;

#[path = "global_binding_scopes.rs"]
mod global_binding_scopes;

#[path = "imported_implementation.rs"]
mod imported_implementation;

#[path = "in_operator.rs"]
mod in_operator;

#[path = "module_evaluation.rs"]
mod module_evaluation;

#[path = "project_semantics.rs"]
mod project_semantics;

#[path = "reachability.rs"]
mod reachability;

#[path = "readonly.rs"]
mod readonly;

#[path = "settled_globals.rs"]
mod settled_globals;

#[path = "test_scratch.rs"]
mod test_scratch;
