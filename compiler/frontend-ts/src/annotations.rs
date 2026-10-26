//! nts annotations on a declaration's leading documentation.
//! Tag ownership and interpretation belong to nts, independently of AST storage.

use nts_semantic_schema::NodeKind;

pub(crate) mod jvm;

pub(crate) fn carries_native_attributes(kind: NodeKind) -> bool {
    matches!(
        kind,
        NodeKind::Syntax(
            nts_semantic_schema::syntax::FUNCTION_DECLARATION
                | nts_semantic_schema::syntax::METHOD_SIGNATURE
                | nts_semantic_schema::syntax::PROPERTY_SIGNATURE
                | nts_semantic_schema::syntax::CONSTRUCT_SIGNATURE
                | nts_semantic_schema::syntax::CLASS_DECLARATION
                | nts_semantic_schema::syntax::INTERFACE_DECLARATION
                // `export type IPage = ComClass<...>`: a Windows Runtime
                // interface, and the IID it is asked for by (`@ntsQuery`).
                | nts_semantic_schema::syntax::TYPE_ALIAS_DECLARATION
                | nts_semantic_schema::syntax::METHOD_DECLARATION
                | nts_semantic_schema::syntax::PROPERTY_DECLARATION
                | nts_semantic_schema::syntax::GET_ACCESSOR
                | nts_semantic_schema::syntax::SET_ACCESSOR
                | nts_semantic_schema::syntax::CONSTRUCTOR
                | nts_semantic_schema::syntax::MODULE_DECLARATION
                | nts_semantic_schema::syntax::SOURCE_FILE
                // `let ticks: T;` in a namespace: a Windows Runtime class's
                // static property, whose comment is the statement's.
                | nts_semantic_schema::syntax::VARIABLE_STATEMENT
        )
    )
}

/// Only a tag in a leading documentation comment belongs to the declaration.
/// Stop at the first token: a body string or a preceding statement cannot
/// publish an ABI. Keep invalid and duplicate tags for lowering to diagnose.
pub(crate) fn native_attributes(
    source: &str,
) -> Option<Box<nts_semantic_schema::NativeAttributes>> {
    let abi = native_abi(source);
    let no_escape = leading_tag(source, "@ntsNoEscape")
        .map(|names| names.split_whitespace().map(str::to_owned).collect());
    // `<sys/utsname.h>` and `"local.h"` name the same thing to a reader and
    // differ only in where the preprocessor looks. Keep the spelling: a
    // project header found on the quoted path is not the system one.
    let headers = leading_tag(source, "@ntsHeader")
        .map(|names| names.split_whitespace().map(str::to_owned).collect());
    let defines = leading_tag(source, "@ntsDefine")
        .map(|names| names.split_whitespace().map(str::to_owned).collect());
    let free = leading_tag(source, "@ntsFree");
    let symbol = leading_tag(source, "@ntsSymbol");
    let throws = leading_tag(source, "@ntsThrows");
    let call = leading_tag(source, "@ntsCall");
    let defaults = leading_tag(source, "@ntsDefault");
    let get = leading_tag(source, "@ntsGet");
    let set = leading_tag(source, "@ntsSet");
    let construct = leading_tag(source, "@ntsConstruct");
    let selector = leading_tag(source, "@ntsSelector");
    let class = leading_tag(source, "@ntsClass");
    let protocol = leading_tag(source, "@ntsProtocol");
    let frameworks = leading_tag(source, "@ntsFramework")
        .map(|names| names.split_whitespace().map(str::to_owned).collect());
    let libraries = leading_tag(source, "@ntsLibrary")
        .map(|names| names.split_whitespace().map(str::to_owned).collect());
    let packages = leading_tag(source, "@ntsPackage")
        .map(|names| names.split_whitespace().map(str::to_owned).collect());
    let vtable = leading_tag(source, "@ntsVtable");
    let hresult = leading_tag(source, "@ntsHresult");
    let factory = leading_tag(source, "@ntsFactory");
    let query = leading_tag(source, "@ntsQuery");
    let activate = leading_tag(source, "@ntsActivate");
    let via = leading_tag(source, "@ntsVia");
    let listener = leading_tag(source, "@ntsListener");
    let iterate = leading_tag(source, "@ntsIterate");
    let vfunc = leading_tag(source, "@ntsVfunc");
    let vfunc_out = leading_tag(source, "@ntsVfuncOut");
    let intrinsic = leading_tag(source, "@ntsIntrinsic");
    let gtype = leading_tag(source, "@ntsGType");
    let composable = leading_tag(source, "@ntsComposable");
    let runtime_class = leading_tag(source, "@ntsRuntimeClass");
    let overridable = leading_tag(source, "@ntsOverride");
    let reference = leading_tag(source, "@ntsReference");
    let constant = leading_tag(source, "@ntsConstant");
    let bound_by = leading_tag(source, "@ntsBoundBy");
    let is = leading_tag(source, "@ntsIs");
    let attributes = nts_semantic_schema::NativeAttributes {
        jvm: None,
        abi,
        no_escape,
        headers,
        defines,
        free,
        symbol,
        throws,
        call,
        defaults,
        get,
        set,
        construct,
        selector,
        class,
        protocol,
        frameworks,
        libraries,
        packages,
        vtable,
        hresult,
        factory,
        query,
        activate,
        via,
        listener,
        iterate,
        vfunc,
        vfunc_out,
        intrinsic,
        gtype,
        composable,
        runtime_class,
        overridable,
        reference,
        constant,
        bound_by,
        is,
    };
    // No tag at all is no attributes, rather than an empty set of them.
    (attributes != nts_semantic_schema::NativeAttributes::default()).then(|| Box::new(attributes))
}

fn native_abi(source: &str) -> Option<String> {
    leading_tag(source, "@ntsAbi")
}

fn leading_tags<'a>(mut source: &'a str, marker: &str) -> Vec<&'a str> {
    let mut tags = Vec::new();
    loop {
        source = source.trim_start();
        if let Some(comment) = source.strip_prefix("//") {
            source = comment.find(['\n', '\r']).map_or("", |end| &comment[end..]);
        } else if let Some(comment) = source.strip_prefix("/*") {
            let Some(end) = comment.find("*/") else { break };
            if let Some(doc) = comment[..end].strip_prefix('*') {
                for line in doc.lines() {
                    let line = line.trim().trim_start_matches('*').trim_start();
                    if let Some(tag) = line.strip_prefix(marker)
                        && (tag.is_empty() || tag.starts_with(char::is_whitespace))
                    {
                        tags.push(tag.trim());
                    }
                }
            }
            source = &comment[end + 2..];
        } else {
            break;
        }
    }
    // A space, not a comma. `@ntsNoEscape` takes a *list* of parameter names, so
    // two of them on separate lines have to compose into one list -- joined with
    // a comma the first name came back as `cb,` and was reported as naming no
    // parameter, which is true and unhelpful.
    //
    // It keeps the property the join was there for: a repeated `@ntsAbi managed`
    // becomes `managed managed`, still not an ABI anyone declared, so lowering
    // still reports the duplicate rather than honouring one of them.
    tags
}

fn leading_tag(source: &str, marker: &str) -> Option<String> {
    let tags = leading_tags(source, marker);
    (!tags.is_empty()).then(|| tags.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_delegated_declaration_carries_its_binding_and_its_test() {
        let source = "/**\n * @ntsBoundBy \"nts:dom\" Event\n * @ntsIs nts_dom_is 5\n */\ninterface AnimationEvent {}";
        let attributes = native_attributes(source).expect("tagged");
        assert_eq!(attributes.bound_by.as_deref(), Some("\"nts:dom\" Event"));
        assert_eq!(attributes.is.as_deref(), Some("nts_dom_is 5"));
        // A tag is matched whole: `@ntsIsland` is not `@ntsIs`.
        assert!(native_attributes("/** @ntsIsland x */\ninterface A {}").is_none());
    }

    /// A module names its pkg-config packages as it names its headers: on
    /// the `declare module`, one line or several, each name once in order.
    #[test]
    fn a_module_names_its_packages() {
        let source = "/**\n * @ntsHeader hb.h\n * @ntsPackage harfbuzz\n * @ntsPackage harfbuzz-gobject\n */\ndeclare module \"c:HarfBuzz-0.0\" {}";
        let attributes = native_attributes(source).expect("tagged");
        assert_eq!(
            attributes.headers.as_deref(),
            Some(&["hb.h".to_owned()][..])
        );
        assert_eq!(
            attributes.packages.as_deref(),
            Some(&["harfbuzz".to_owned(), "harfbuzz-gobject".to_owned()][..])
        );
        assert!(
            native_attributes("/** @ntsHeader a.h */\ndeclare module \"c:a\" {}")
                .is_some_and(|attributes| attributes.packages.is_none())
        );
    }

    #[test]
    fn native_abi_tags_cannot_escape_their_leading_documentation_comment() {
        for source in [
            "/* @ntsAbi managed */ declare function f(): void;",
            "// @ntsAbi managed\ndeclare function f(): void;",
            "declare function f(): void; /** @ntsAbi managed */",
            "function f() { return '/** @ntsAbi managed */'; }",
            "/** An example: @ntsAbi managed */ declare function f(): void;",
            "/** @ntsAbiExtra managed */ declare function f(): void;",
        ] {
            assert_eq!(super::native_abi(source), None, "{source}");
        }
        assert_eq!(
            super::native_abi("/** @ntsAbi */ declare function f(): void;"),
            Some(String::new())
        );
        // Two tags survive as one string so that lowering can report the
        // duplicate rather than honour whichever came first. What matters is
        // that the result is not an ABI anyone declared -- the separator is how
        // it is spelled, not what is being asserted, and it is a space because
        // `@ntsNoEscape` carries a *list* of names that has to compose.
        assert_eq!(
            super::native_abi(
                "/** @ntsAbi managed */\n/** @ntsAbi managed */ declare function f(): void;"
            ),
            Some("managed managed".to_owned())
        );
    }
}
