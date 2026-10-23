//! What the JVM provides, as it answers a `typeof` of an intrinsic
//! (`nts_core::hir::features`): the helpers its closed table maps or renders
//! inline, and nothing it would refuse.

#[test]
fn the_jvm_provides_what_its_table_maps() {
    assert!(nts_codegen_jvm::provides("nts_concat"));
    assert!(!nts_codegen_jvm::provides("nts_str_concat_number"));
    assert!(!nts_codegen_jvm::provides("nts_no_such_helper"));
}
