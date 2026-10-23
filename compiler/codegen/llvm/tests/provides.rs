//! What the C runtime provides, as C and LLVM answer a `typeof` of an
//! intrinsic (`nts_core::hir::features`): the header, which the signature
//! table lists whole -- a helper with a scalar parameter and a pointer-only one
//! alike, which core's own runtime table does not.

#[test]
fn the_header_provides_scalar_and_pointer_only_helpers() {
    assert!(nts_codegen_llvm::provides("nts_str_concat_number"));
    assert!(nts_codegen_llvm::provides("nts_retain"));
    assert!(!nts_codegen_llvm::provides("nts_no_such_helper"));
}
