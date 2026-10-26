//! Invalid async yields report their type error while valid constituents,
//! contextual next types and subsequent diagnostics survive recovery.
use std::num::NonZeroU16;

use crate::{
    Diagnostic, DiagnosticScope, ProjectSpec, SessionOptions, SignatureKind, TypeKind, TypeLiteral,
};
use tsrs_ast::Kind;

#[derive(Debug)]
struct Argument {
    kind: TypeKind,
    number_literals: Vec<String>,
}

fn check(source: &str, count: u16, capture: bool) -> (Vec<Diagnostic>, Vec<Argument>) {
    let mut options = SessionOptions::new("/__nts_yield_recovery_test__");
    options.checker_count = NonZeroU16::new(count);
    crate::run(options, |session| {
        let mut spec = ProjectSpec::new("tsconfig.json");
        spec.overlays.insert("tsconfig.json".into(), r#"{"compilerOptions":{"target":"ESNext","module":"preserve","strict":true,"noImplicitAny":false,"types":[],"noEmit":true},"files":["main.ts"]}"#.into());
        spec.overlays.insert("main.ts".into(), source.into());
        let checked = session.open(spec).expect("yield recovery project");
        let files: Vec<_> = checked
            .projects()
            .flat_map(crate::Project::files)
            .filter(|file| !file.is_default_library())
            .map(|file| file.path().to_owned())
            .collect();
        let checked = checked.start_diagnostics(DiagnosticScope::Files(&files));
        let mut arguments = Vec::new();
        if capture {
            let file = checked
                .projects()
                .next()
                .expect("program")
                .files()
                .find(|file| !file.is_default_library())
                .expect("source");
            let mut pending = vec![file.root()];
            while let Some(node) = pending.pop() {
                if node.native.kind() == Kind::FunctionDeclaration {
                    let signatures = node.ty().signatures(SignatureKind::Call);
                    if let Some(signature) = signatures.first()
                        && let Some(reference) = signature.return_type().reference()
                    {
                        arguments.extend(reference.arguments.iter().map(|ty| {
                            let mut numbers = ty
                                .constituents()
                                .into_iter()
                                .flatten()
                                .map(|part| {
                                    let Some(TypeLiteral::Number(value)) = part.literal() else {
                                        panic!("expected numeric yield constituent, got {part:?}");
                                    };
                                    value.to_string()
                                })
                                .collect::<Vec<_>>();
                            numbers.sort();
                            Argument {
                                kind: ty.kind(),
                                number_literals: numbers,
                            }
                        }));
                    }
                }
                for edge in node.edges() {
                    match edge {
                        crate::Edge::Node { node, .. } => pending.push(node),
                        crate::Edge::List { list, .. } => pending.extend(list.iter()),
                    }
                }
            }
        }
        (checked.finish().diagnostics(), arguments)
    })
}

#[test]
fn invalid_async_yields_preserve_diagnostics_and_present_inference() {
    let bad = "const bad = { then(resolve, reject) { resolve(reject); } };";
    for (body, codes, yield_kind, next_kind) in [
        ("yield bad;", vec![1321], Some(TypeKind::Never), None),
        (
            "yield 1; yield bad;",
            vec![1321],
            Some(TypeKind::Number),
            None,
        ),
        (
            "yield bad; yield 2;",
            vec![1321],
            Some(TypeKind::Number),
            None,
        ),
        (
            "yield 1; yield bad; yield 2; const later: number = 'wrong';",
            vec![1321, 2322],
            Some(TypeKind::Union),
            None,
        ),
        (
            "const received: string = yield bad; yield 1;",
            vec![1321],
            Some(TypeKind::Number),
            Some(TypeKind::String),
        ),
        (
            "yield Promise.resolve(1);",
            vec![],
            Some(TypeKind::Number),
            None,
        ),
        (
            "yield { then(resolve: (value: number) => void) { resolve(1); } };",
            vec![],
            Some(TypeKind::Number),
            None,
        ),
        // The invalid delegated neighbor is a separate upstream panic on both
        // pristine tsrs and TypeScript 3e; retain its repro in the record.
        ("yield* [1];", vec![], Some(TypeKind::Number), None),
    ] {
        let source = format!("{bad}\nasync function* g() {{ {body} }}\ng().next();");
        let mut previous = None;
        for count in [1, 4] {
            let (pristine, _) = check(&source, count, false);
            let (captured, arguments) = check(&source, count, true);
            assert_eq!(
                captured, pristine,
                "capture must not change diagnostics: {body}"
            );
            let mut actual: Vec<_> = pristine.iter().map(|diagnostic| diagnostic.code).collect();
            actual.sort_unstable();
            assert_eq!(actual, codes, "{body}: {pristine:?}");
            if let Some(expected) = yield_kind {
                assert_eq!(
                    arguments.first().map(|value| value.kind),
                    Some(expected),
                    "yield type: {body}"
                );
                if expected == TypeKind::Union {
                    assert_eq!(
                        arguments[0].number_literals,
                        ["1", "2"],
                        "both valid yield constituents survive"
                    );
                }
            }
            if let Some(expected) = next_kind {
                assert_eq!(
                    arguments.get(2).map(|value| value.kind),
                    Some(expected),
                    "contextual next type: {body}"
                );
            }
            if let Some(previous) = previous {
                assert_eq!(pristine, previous);
            }
            previous = Some(pristine);
        }
    }
    for count in [1, 4] {
        let source = format!("{bad}\nfunction* g() {{ yield bad; }}\ng().next();");
        assert!(
            check(&source, count, false).0.is_empty(),
            "sync yield does not await its operand"
        );
    }
}
