//! What the Wasm backend provides, as it answers a `typeof` of an intrinsic
//! (`nts_core::hir::features`): what its catalog supports, and nothing it
//! declines or does not know.

#[test]
fn wasm_provides_what_its_catalog_supports() {
    assert!(nts_codegen_wasm::provides("nts_str_append"));
    assert!(!nts_codegen_wasm::provides("nts_str_concat_number"));
    assert!(!nts_codegen_wasm::provides("nts_no_such_helper"));
}
