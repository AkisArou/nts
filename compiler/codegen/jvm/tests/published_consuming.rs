//! A refusal inside the private body keeps the published source identity.
#[path = "../../common/test-support/published_consuming.rs"]
mod fixture;

#[test]
fn a_materialized_bodys_refusal_names_the_original_function() {
    let emitted =
        nts_codegen_jvm::emit(&fixture::refused_body(nts_core::hir::backend::Backend::Jvm));
    fixture::assert_source_name(&emitted.diagnostics);
}
