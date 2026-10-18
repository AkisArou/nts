//! Reproducible synthetic COM metadata used by the Windows lifetime witness.
//! The checked-in bytes are generated here and tested through the public binder.
//! A differing candidate is left in the test scratch directory for review;
//! this test never updates a source file or silently accepts a new fixture.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use std::process::Command;
use windows_metadata::writer::{self, AttributeType, HasAttribute, MemberRefParent, TypeDefOrRef};
use windows_metadata::{
    FieldAttributes, MethodAttributes, MethodImplAttributes, PInvokeAttributes, ParamAttributes,
    Signature, Type, TypeAttributes, TypeName, Value,
};

const NS: &str = "Windows.Win32.OwnershipProbe";
const COM: &str = "Windows.Win32.System.Com";
const FOUNDATION: &str = "Windows.Win32.Foundation";
fn named(ns: &str, name: &str) -> Type {
    Type::ClassName(TypeName::named(ns, name))
}
fn attribute(file: &mut writer::File, owner: HasAttribute, name: &str, values: Vec<Value>) {
    let ty = file.TypeRef("Windows.Win32.Foundation.Metadata", name);
    let ctor = file.MemberRef(
        ".ctor",
        &Signature {
            types: values.iter().map(Value::ty).collect(),
            ..Signature::default()
        },
        MemberRefParent::TypeRef(ty),
    );
    file.Attribute(
        owner,
        AttributeType::MemberRef(ctor),
        &values
            .into_iter()
            .map(|v| (String::new(), v))
            .collect::<Vec<_>>(),
    );
}
fn interface(file: &mut writer::File, ns: &str, name: &str, first: u32) -> writer::TypeDef {
    let def = file.TypeDef(
        ns,
        name,
        TypeDefOrRef::default(),
        TypeAttributes::Public | TypeAttributes::Interface | TypeAttributes::Abstract,
    );
    attribute(
        file,
        HasAttribute::TypeDef(def),
        "GuidAttribute",
        vec![
            Value::U32(first),
            Value::U16(0),
            Value::U16(0),
            Value::U8(0xc0),
            Value::U8(0),
            Value::U8(0),
            Value::U8(0),
            Value::U8(0),
            Value::U8(0),
            Value::U8(0),
            Value::U8(0x46),
        ],
    );
    def
}
fn method(
    file: &mut writer::File,
    name: &str,
    result: Type,
    types: Vec<Type>,
    static_: bool,
) -> writer::MethodDef {
    let flags = MethodAttributes::Public
        | if static_ {
            MethodAttributes::Static
        } else {
            MethodAttributes::Virtual | MethodAttributes::Abstract
        };
    let method = file.MethodDef(
        name,
        &Signature {
            return_type: result,
            types,
            ..Signature::default()
        },
        flags,
        MethodImplAttributes(0),
    );
    attribute(
        file,
        HasAttribute::MethodDef(method),
        "DocumentationAttribute",
        vec![Value::Utf8(
            "https://example.invalid/api/ownership/nf-ownership-fixture".into(),
        )],
    );
    method
}
fn fixture() -> Vec<u8> {
    let mut file = writer::File::new("nts-com-ownership-fixture");
    let value_type = file.TypeRef("System", "ValueType");
    let hr = file.TypeDef(
        FOUNDATION,
        "HRESULT",
        TypeDefOrRef::TypeRef(value_type),
        TypeAttributes::Public,
    );
    attribute(
        &mut file,
        HasAttribute::TypeDef(hr),
        "NativeTypedefAttribute",
        vec![],
    );
    file.Field("Value", &Type::I32, FieldAttributes::Public);
    interface(&mut file, COM, "IUnknown", 0);
    method(
        &mut file,
        "QueryInterface",
        Type::ValueName(TypeName::named(FOUNDATION, "HRESULT")),
        vec![
            Type::PtrConst(
                Box::new(Type::ValueName(TypeName::named("System", "Guid"))),
                1,
            ),
            Type::PtrMut(Box::new(Type::Void), 2),
        ],
        false,
    );
    let iid = file.Param("iid", 1, ParamAttributes::In);
    attribute(
        &mut file,
        HasAttribute::Param(iid),
        "ConstAttribute",
        vec![],
    );
    file.Param("output", 2, ParamAttributes::Out);
    for name in ["AddRef", "Release"] {
        method(&mut file, name, Type::U32, vec![], false);
    }
    let derived = interface(&mut file, NS, "IEnumFixture", 0x1234_5678);
    file.InterfaceImpl(derived, &named(COM, "IUnknown"));
    let hresult = || Type::ValueName(TypeName::named(FOUNDATION, "HRESULT"));
    method(&mut file, "Reset", hresult(), vec![], false);
    let output = || Type::PtrMut(Box::new(named(NS, "IEnumFixture")), 1);
    method(&mut file, "Clone", hresult(), vec![output()], false);
    let param = file.Param("output", 1, ParamAttributes::Out);
    attribute(
        &mut file,
        HasAttribute::Param(param),
        "ComOutPtrAttribute",
        vec![],
    );
    let object = file.TypeRef("System", "Object");
    file.TypeDef(
        NS,
        "Apis",
        TypeDefOrRef::TypeRef(object),
        TypeAttributes::Public,
    );
    let make = method(&mut file, "OwnershipMake", hresult(), vec![output()], true);
    // Direct-C typed pure Out stays refused for the recorded status-spelling gap.
    file.Param("output", 1, ParamAttributes::Out);
    // The test's own native object supplies this synthetic symbol. kernel32's
    // import library is already present; no extra fixture DLL is needed.
    file.ImplMap(make, PInvokeAttributes(0), "OwnershipMake", "kernel32.dll");
    file.into_stream()
}
#[test]
fn synthetic_com_ownership_metadata_is_reproducible_and_header_checked() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let project = root.join("tests/interop/windows-com/ownership");
    let dir =
        std::env::temp_dir().join(format!("nts-com-ownership-fixture-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let bytes = fixture();
    let candidate = dir.join("ownership.winmd");
    std::fs::write(&candidate, &bytes).unwrap();
    eprintln!("metadata candidate: {}", candidate.display());
    assert_eq!(
        std::fs::read(project.join("ownership.winmd")).unwrap_or_default(),
        bytes,
        "review the generated candidate, then copy it explicitly and rerun"
    );
    let output = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", NS, "--winmd"])
        .arg(&candidate)
        .arg("--out")
        .arg(dir.join("bindings"))
        .env("C_INCLUDE_PATH", project.join("native"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text =
        std::fs::read_to_string(dir.join("bindings/Windows.Win32.OwnershipProbe.d.ts")).unwrap();
    assert!(
        text.contains("Clone(this: IEnumFixture): IEnumFixture | null;"),
        "{text}"
    );
    assert!(!text.contains("function OwnershipMake("), "{text}");
    let refusals =
        std::fs::read_to_string(dir.join("bindings/Windows.Win32.OwnershipProbe.refused.txt"))
            .unwrap();
    assert!(
        refusals.lines().count() == 1
            && refusals.starts_with("OwnershipMake\t")
            && refusals.contains("direct-C HRESULT status"),
        "{refusals}"
    );
    std::fs::remove_dir_all(dir).unwrap();
}
