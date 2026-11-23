//! A refusal inside the private body keeps the published source identity.
#[path = "../../common/test-support/published_consuming.rs"]
mod fixture;

#[test]
fn a_materialized_bodys_refusal_names_the_original_function() {
    let emitted = nts_codegen_llvm::emit(
        &fixture::refused_body(nts_core::hir::backend::Backend::Llvm),
        nts_codegen_llvm::Platform::SYSV_X86_64,
    );
    fixture::assert_source_name(&emitted.diagnostics);
}
