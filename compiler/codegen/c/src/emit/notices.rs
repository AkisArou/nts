//! Components carry their sources and full notices through one selection.
//! Replacing an optional component replaces the whole group, including notices.

use super::Support;

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

pub(super) fn support_files(needs_unicode: bool) -> Vec<Support<'static>> {
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
    if needs_unicode {
        components.push(Component {
            sources: vec![
                file(super::UNICODE_HEADER_NAME, super::UNICODE_HEADER, false),
                file(super::CUTILS_HEADER_NAME, super::CUTILS_HEADER, false),
                file(
                    super::LIBUNICODE_HEADER_NAME,
                    super::LIBUNICODE_HEADER,
                    false,
                ),
                file(super::LIBUNICODE_TABLE_NAME, super::LIBUNICODE_TABLE, false),
                file(
                    super::LIBUNICODE_SOURCE_NAME,
                    super::LIBUNICODE_SOURCE,
                    false,
                ),
                file(super::UNICODE_SOURCE_NAME, super::UNICODE_SOURCE, true),
            ],
            notices: vec![
                file(
                    "notices/quickjs/LICENSE",
                    include_str!("../../../../../runtime/c/quickjs/LICENSE"),
                    false,
                ),
                file("notices/unicode-data/LICENSE", unicode_license(), false),
            ],
        });
    }
    components
        .into_iter()
        .flat_map(|group| group.sources.into_iter().chain(group.notices))
        .collect()
}

// Borrow the complete upstream notice from the data it licenses. No copied
// table or hand-maintained license text can diverge from the linked data.
fn unicode_license() -> &'static str {
    let (_, notice) = super::LIBUNICODE_TABLE
        .split_once("/*\n")
        .expect("upstream Unicode data license comment");
    let (notice, _) = notice
        .split_once("*/")
        .expect("upstream Unicode license end");
    assert!(
        notice.starts_with("UNICODE LICENSE V3\n"),
        "upstream Unicode license changed"
    );
    notice
}

#[cfg(test)]
mod tests {
    #[test]
    fn program_notices_cover_exactly_the_third_party_components() {
        for (unicode, expected) in [
            (false, vec!["notices/zmij/LICENSE"]),
            (
                true,
                vec![
                    "notices/quickjs/LICENSE",
                    "notices/unicode-data/LICENSE",
                    "notices/zmij/LICENSE",
                ],
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
