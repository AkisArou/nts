//! Components carry their sources and full notices through one selection.
//! Replacing an optional component replaces the whole group, including notices.

use super::{Support, UnicodeNeeds};

struct Component {
    sources: Vec<Support<'static>>,
    notices: Vec<Support<'static>>,
}

fn file(name: &'static str, contents: &'static str, compiled: bool) -> Support<'static> {
    Support {
        name,
        contents,
        compiled,
    }
}

pub(super) fn support_files(needs: UnicodeNeeds) -> Vec<Support<'static>> {
    let mut components = vec![
        Component {
            sources: vec![
                file(super::RUNTIME_HEADER_NAME, super::RUNTIME_HEADER, false),
                file(
                    super::STRING_VIEW_HEADER_NAME,
                    super::STRING_VIEW_HEADER,
                    false,
                ),
                file(super::RUNTIME_SOURCE_NAME, super::RUNTIME_SOURCE, true),
            ],
            // Apache-2.0 WITH LLVM-exception exempts embedded nts runtime code
            // from program notice files; third-party groups keep their terms.
            notices: Vec::new(),
        },
        // nts_runtime.c includes both sources, so these groups always travel.
        Component {
            sources: vec![
                file(super::ZMIJ_HEADER_NAME, super::ZMIJ_HEADER, false),
                file(super::ZMIJ_SOURCE_NAME, super::ZMIJ_SOURCE, false),
            ],
            notices: vec![file(
                "notices/zmij/LICENSE",
                include_str!("../../../../../runtime/c/zmij/LICENSE"),
                false,
            )],
        },
        Component {
            sources: vec![file(super::FFC_HEADER_NAME, super::FFC_HEADER, false)],
            // FFC is used under BSL-1.0: machine-executable object code needs
            // no notice. Its unchanged source header carries the full text;
            // all three upstream alternatives stay in compiler attributions.
            notices: Vec::new(),
        },
    ];
    if needs.any() {
        components.push(Component {
            sources: vec![
                file(super::UNICODE_HEADER_NAME, super::UNICODE_HEADER, false),
                file(
                    super::unicode_tables::HEADER_NAME,
                    super::unicode_tables::header(needs),
                    false,
                ),
                file(super::UNICODE_SOURCE_NAME, super::UNICODE_SOURCE, true),
            ],
            notices: vec![file(
                "notices/unicode-data/LICENSE",
                nts_unicode::LICENSE,
                false,
            )],
        });
    }
    components
        .into_iter()
        .flat_map(|group| group.sources.into_iter().chain(group.notices))
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn program_notices_cover_exactly_the_third_party_components() {
        for (unicode, expected) in [
            (super::UnicodeNeeds::NONE, vec!["notices/zmij/LICENSE"]),
            (
                super::UnicodeNeeds::ALL,
                vec!["notices/unicode-data/LICENSE", "notices/zmij/LICENSE"],
            ),
        ] {
            let files = super::support_files(unicode);
            let mut notices: Vec<_> = files
                .iter()
                .filter(|file| file.name.starts_with("notices/"))
                .map(|file| file.name)
                .collect();
            notices.sort_unstable();
            assert_eq!(notices, expected);
            assert!(
                files
                    .iter()
                    .filter(|file| file.name.starts_with("notices/"))
                    .all(|file| !file.compiled && !file.contents.is_empty())
            );
        }
    }
}
