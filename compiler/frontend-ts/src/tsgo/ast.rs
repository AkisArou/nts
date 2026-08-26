//! Decoder for tsgo's encoded source-file format.
//!
//! `getSourceFile` answers with a flat binary encoding of a whole file's AST —
//! this is what makes the transport viable, because it means AST transfer costs
//! one round trip per file rather than one per node.
//!
//! The format is specified in `internal/api/encoder/encoder.go` of the pinned
//! submodule. Seven sections; a 44-byte header carries a protocol version, an
//! xxh3 content hash, and byte offsets to the rest:
//!
//! ```text
//! header            44 bytes
//! string offsets    8 bytes per string   (u32 start, u32 end) into string data
//! string data       variable             UTF-8, usually the file text itself
//! extended data     variable             template literals and SourceFile
//! structured data   variable             msgpack blobs (file references)
//! nodes             28 bytes per node    kind, pos, end, next, parent, data, flags
//! ```
//!
//! # Two things that will bite a reader of the raw bytes
//!
//! - **Node 0 is a nil sentinel**, 28 zero bytes. That is what lets `parent` and
//!   `next` use `0` to mean "none" unambiguously. Real nodes start at index 1.
//! - **`NodeList` is a node**, with the sentinel kind `0xFFFF_FFFF`, and its
//!   `data` field is a plain length rather than the tagged union every other node
//!   uses. Lists are the encoded parent of their contents.
//!
//! # Bounds
//!
//! Every offset in this file comes from a subprocess, so every read is checked.
//! The crate forbids `unsafe`, so there is no unchecked path to reach for.

use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::{NodeData, NodeId, NodeKind, NodeRecord, Origin};

/// Protocol version this decoder implements.
///
/// From `encoder.ProtocolVersion` in the pinned submodule. A mismatch means the
/// tsgo binary is not the pinned one, which is worth saying plainly rather than
/// discovering as a garbled node three sections later.
pub const PROTOCOL_VERSION: u8 = 5;

/// Byte offset of the protocol version within the header.
///
/// **The prose table in `encoder.go` is wrong about this.** It documents the
/// version at byte 0 with bytes 1-3 reserved. The code writes
/// `metadata := uint32(ProtocolVersion) << 24` as a little-endian `u32`, putting
/// the version in byte 3, and tsgo's own decoder reads `HeaderOffsetMetadata+3`.
/// The code is authoritative; this was caught by decoding a real file rather than
/// by reading the specification.
const VERSION_OFFSET: usize = 3;

const HEADER_SIZE: usize = 44;
const NODE_SIZE: usize = 28;
/// Stride between string-offset entries.
///
/// **The prose table in `encoder.go` is wrong about this too.** It documents
/// "8 bytes per string: pairs of starting and ending byte offsets". The code
/// reads `strTable + idx*4` for the start and `+4` for the end, so consecutive
/// entries *share* a boundary: it is a prefix-offset array of `n + 1` values, and
/// a string count of `len / 8` undercounts by half.
const STRING_ENTRY_SIZE: usize = 4;

/// Sentinel `kind` marking a `NodeList`.
const KIND_NODE_LIST: u32 = u32::MAX;

const DATA_TYPE_MASK: u32 = 0xC000_0000;
const DATA_SMALL_MASK: u32 = 0x3F00_0000;
const DATA_CHILD_MASK: u32 = 0x0000_00FF;
const DATA_STRING_INDEX_MASK: u32 = 0x00FF_FFFF;

const DATA_TYPE_CHILDREN: u32 = 0 << 30;
const DATA_TYPE_STRING: u32 = 1 << 30;
const DATA_TYPE_EXTENDED: u32 = 2 << 30;

/// Why an encoded source file could not be decoded.
#[derive(Debug, thiserror::Error)]
pub enum AstError {
    #[error("encoded source file is {len} bytes, too short for a {HEADER_SIZE}-byte header")]
    TooShort { len: usize },

    #[error(
        "tsgo speaks encoder protocol v{found}, this build decodes v{PROTOCOL_VERSION}; \
         the tsgo binary does not match the pinned version"
    )]
    ProtocolMismatch { found: u8 },

    #[error("section offset {offset} for `{section}` is past the end of a {len}-byte payload")]
    SectionOutOfRange {
        section: &'static str,
        offset: usize,
        len: usize,
    },

    #[error("section offsets are not ascending: `{earlier}` at {a} is after `{later}` at {b}")]
    SectionsOutOfOrder {
        earlier: &'static str,
        a: usize,
        later: &'static str,
        b: usize,
    },

    #[error("the nodes section is {len} bytes, not a multiple of {NODE_SIZE}")]
    RaggedNodes { len: usize },

    #[error("node {node} names parent {parent}, but only {count} nodes were decoded")]
    DanglingParent {
        node: u32,
        parent: u32,
        count: usize,
    },

    #[error("node {node} references string {index}, but only {count} strings were encoded")]
    DanglingString { node: u32, index: u32, count: usize },

    #[error("string {index} spans {start}..{end}, outside the {len}-byte string data section")]
    StringOutOfRange {
        index: u32,
        start: u32,
        end: u32,
        len: usize,
    },

    #[error("string {index} is not valid UTF-8")]
    StringNotUtf8 { index: u32 },

    #[error("node {node} uses reserved node-data tag 0b{tag:02b}; the payload is corrupt")]
    ReservedNodeData { node: u32, tag: u8 },
}

/// A decoded source file, before it becomes snapshot records.
#[derive(Debug, Clone)]
pub struct EncodedSourceFile {
    /// xxh3 content hash from the header, usable directly as a cache key.
    pub content_hash: [u8; 16],
    /// Nodes in source order. Index 0 is the nil sentinel and is not included.
    pub nodes: Vec<NodeRecord>,
}

fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes(slice.try_into().ok()?))
}

/// Decode one encoded source file.
///
/// `file` names which source the resulting [`Origin`]s point at; the encoding
/// carries positions but not the identity the rest of the compiler uses.
pub fn decode(payload: &[u8], file: SourceId) -> Result<EncodedSourceFile, AstError> {
    let header = Header::parse(payload)?;

    let strings = StringTable {
        offsets: &payload[header.string_offsets_at..header.string_data_at],
        // To the end of the payload, not to `extended_at`. tsgo's decoder slices
        // `data[strData:]` and lets offsets reach past the extended-data
        // boundary; strings appended after the file text live there.
        data: &payload[header.string_data_at..],
    };

    let mut nodes = decode_nodes(&payload[header.nodes_at..], file, &strings)?;
    rebuild_children(&mut nodes);

    Ok(EncodedSourceFile {
        content_hash: header.content_hash,
        nodes,
    })
}

/// The 44-byte header: a protocol version, a content hash, and section offsets.
struct Header {
    content_hash: [u8; 16],
    string_offsets_at: usize,
    string_data_at: usize,
    nodes_at: usize,
}

impl Header {
    fn parse(payload: &[u8]) -> Result<Self, AstError> {
        if payload.len() < HEADER_SIZE {
            return Err(AstError::TooShort { len: payload.len() });
        }

        let version = payload[VERSION_OFFSET];
        if version != PROTOCOL_VERSION {
            return Err(AstError::ProtocolMismatch { found: version });
        }

        let mut content_hash = [0u8; 16];
        content_hash.copy_from_slice(&payload[4..20]);

        let section = |offset: usize, name: &'static str| -> Result<usize, AstError> {
            let value =
                u32_at(payload, offset).ok_or(AstError::TooShort { len: payload.len() })? as usize;
            if value > payload.len() {
                return Err(AstError::SectionOutOfRange {
                    section: name,
                    offset: value,
                    len: payload.len(),
                });
            }
            Ok(value)
        };

        let string_offsets_at = section(24, "string offsets")?;
        let string_data_at = section(28, "string data")?;
        let extended_at = section(32, "extended data")?;
        let structured_at = section(36, "structured data")?;
        let nodes_at = section(40, "nodes")?;

        // Ascending order is what makes each section's length derivable from the
        // next section's start. A malformed header that violates it would
        // otherwise produce a reversed range and panic on slicing.
        for (earlier, a, later, b) in [
            (
                "string offsets",
                string_offsets_at,
                "string data",
                string_data_at,
            ),
            ("string data", string_data_at, "extended data", extended_at),
            (
                "extended data",
                extended_at,
                "structured data",
                structured_at,
            ),
            ("structured data", structured_at, "nodes", nodes_at),
        ] {
            if a > b {
                return Err(AstError::SectionsOutOfOrder {
                    earlier,
                    a,
                    later,
                    b,
                });
            }
        }

        Ok(Self {
            content_hash,
            string_offsets_at,
            string_data_at,
            nodes_at,
        })
    }
}

/// Decode the flat node array, dropping the nil sentinel at index 0.
fn decode_nodes(
    nodes_bytes: &[u8],
    file: SourceId,
    strings: &StringTable<'_>,
) -> Result<Vec<NodeRecord>, AstError> {
    if !nodes_bytes.len().is_multiple_of(NODE_SIZE) {
        return Err(AstError::RaggedNodes {
            len: nodes_bytes.len(),
        });
    }
    let encoded_count = nodes_bytes.len() / NODE_SIZE;

    // Index 0 is the nil sentinel; skip it, and shift every index down by one so
    // that our NodeId(0) is a real node rather than a hole nothing may address.
    let real_count = encoded_count.saturating_sub(1);
    let mut nodes = Vec::with_capacity(real_count);

    for index in 1..encoded_count {
        let at = index * NODE_SIZE;
        let raw = RawNode {
            kind: u32_at(nodes_bytes, at).unwrap_or(0),
            pos: u32_at(nodes_bytes, at + 4).unwrap_or(0),
            end: u32_at(nodes_bytes, at + 8).unwrap_or(0),
            parent: u32_at(nodes_bytes, at + 16).unwrap_or(0),
            data: u32_at(nodes_bytes, at + 20).unwrap_or(0),
            flags: u32_at(nodes_bytes, at + 24).unwrap_or(0),
        };

        let node_index = u32::try_from(index).unwrap_or(u32::MAX);
        if raw.parent as usize >= encoded_count {
            return Err(AstError::DanglingParent {
                node: node_index,
                parent: raw.parent,
                count: real_count,
            });
        }

        let is_list = raw.kind == KIND_NODE_LIST;
        let kind = if is_list {
            NodeKind::List
        } else {
            NodeKind::Syntax(u16::try_from(raw.kind).unwrap_or(u16::MAX))
        };

        let (data, text) = if is_list {
            // A list's data field is a plain length, not the tagged union.
            (NodeData::ListLength(raw.data), None)
        } else {
            decode_data(raw.data, node_index, strings)?
        };

        nodes.push(NodeRecord {
            kind,
            origin: Origin::source(Location {
                file,
                span: Span::new(raw.pos, raw.end),
            }),
            // Shift down by one; encoded 0 means "no parent".
            parent: (raw.parent != 0).then(|| NodeId(raw.parent - 1)),
            children: Vec::new(),
            symbol: None,
            flags: raw.flags,
            data,
            text,
        });
    }

    Ok(nodes)
}

/// Recover each node's children from the parent links.
///
/// The encoding stores parent and next-sibling instead of a child list. Because
/// nodes are in source order, appending each node to its parent produces the
/// child lists in source order too.
fn rebuild_children(nodes: &mut [NodeRecord]) {
    let mut children: Vec<Vec<NodeId>> = vec![Vec::new(); nodes.len()];
    for (index, node) in nodes.iter().enumerate() {
        if let Some(NodeId(parent)) = node.parent {
            let child = u32::try_from(index).unwrap_or(u32::MAX);
            children[parent as usize].push(NodeId(child));
        }
    }
    for (node, kids) in nodes.iter_mut().zip(children) {
        node.children = kids;
    }
}

struct RawNode {
    kind: u32,
    pos: u32,
    end: u32,
    parent: u32,
    data: u32,
    flags: u32,
}

struct StringTable<'a> {
    offsets: &'a [u8],
    data: &'a [u8],
}

impl StringTable<'_> {
    /// Number of addressable strings.
    ///
    /// One fewer than the number of stored offsets, because the last value is the
    /// terminating end-boundary rather than the start of another string.
    fn len(&self) -> usize {
        (self.offsets.len() / STRING_ENTRY_SIZE).saturating_sub(1)
    }

    fn get(&self, index: u32, node: u32) -> Result<String, AstError> {
        let entry = index as usize * STRING_ENTRY_SIZE;
        let start = u32_at(self.offsets, entry).ok_or(AstError::DanglingString {
            node,
            index,
            count: self.len(),
        })?;
        let end = u32_at(self.offsets, entry + 4).ok_or(AstError::DanglingString {
            node,
            index,
            count: self.len(),
        })?;

        let slice =
            self.data
                .get(start as usize..end as usize)
                .ok_or(AstError::StringOutOfRange {
                    index,
                    start,
                    end,
                    len: self.data.len(),
                })?;

        String::from_utf8(slice.to_vec()).map_err(|_| AstError::StringNotUtf8 { index })
    }
}

/// Split a node's `data` field into its tagged parts.
fn decode_data(
    data: u32,
    node: u32,
    strings: &StringTable<'_>,
) -> Result<(NodeData, Option<String>), AstError> {
    // Top 2 bits select the interpretation; the next 6 carry per-kind flags, or
    // for unary expressions the operator's own SyntaxKind.
    let small = u8::try_from((data & DATA_SMALL_MASK) >> 24).unwrap_or(0);

    match data & DATA_TYPE_MASK {
        DATA_TYPE_STRING => {
            let index = data & DATA_STRING_INDEX_MASK;
            if index as usize >= strings.len() {
                return Err(AstError::DanglingString {
                    node,
                    index,
                    count: strings.len(),
                });
            }
            let text = strings.get(index, node)?;
            Ok((NodeData::String { index, small }, Some(text)))
        }
        DATA_TYPE_EXTENDED => Ok((
            NodeData::Extended {
                offset: data & DATA_STRING_INDEX_MASK,
                small,
            },
            None,
        )),
        DATA_TYPE_CHILDREN => Ok((
            NodeData::Children {
                present: u8::try_from(data & DATA_CHILD_MASK).unwrap_or(0),
                small,
            },
            None,
        )),
        // 0b11 is reserved by the format. No tsgo emits it, and one that started
        // would fail the protocol-version check first, so reaching here means the
        // payload is corrupt rather than merely newer.
        reserved => Err(AstError::ReservedNodeData {
            node,
            tag: u8::try_from(reserved >> 30).unwrap_or(3),
        }),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    /// Build a minimal well-formed payload: a header, one string, and `nodes`.
    fn payload(nodes: &[[u32; 7]], strings: &[&str]) -> Vec<u8> {
        // Prefix-offset array: n + 1 boundaries for n strings.
        let mut string_data = Vec::new();
        let mut string_offsets = Vec::new();
        if !strings.is_empty() {
            string_offsets.extend_from_slice(&0u32.to_le_bytes());
            for s in strings {
                string_data.extend_from_slice(s.as_bytes());
                let end = u32::try_from(string_data.len()).unwrap();
                string_offsets.extend_from_slice(&end.to_le_bytes());
            }
        }

        let string_offsets_at = HEADER_SIZE;
        let string_data_at = string_offsets_at + string_offsets.len();
        let extended_at = string_data_at + string_data.len();
        let structured_at = extended_at;
        let nodes_at = structured_at;

        let mut out = vec![0u8; HEADER_SIZE];
        out[VERSION_OFFSET] = PROTOCOL_VERSION;
        for (i, b) in (1u8..=16).enumerate() {
            out[4 + i] = b; // recognisable content hash
        }
        out[24..28].copy_from_slice(&u32::try_from(string_offsets_at).unwrap().to_le_bytes());
        out[28..32].copy_from_slice(&u32::try_from(string_data_at).unwrap().to_le_bytes());
        out[32..36].copy_from_slice(&u32::try_from(extended_at).unwrap().to_le_bytes());
        out[36..40].copy_from_slice(&u32::try_from(structured_at).unwrap().to_le_bytes());
        out[40..44].copy_from_slice(&u32::try_from(nodes_at).unwrap().to_le_bytes());

        out.extend_from_slice(&string_offsets);
        out.extend_from_slice(&string_data);

        // The nil sentinel, then the caller's nodes.
        out.extend_from_slice(&[0u8; NODE_SIZE]);
        for node in nodes {
            for field in node {
                out.extend_from_slice(&field.to_le_bytes());
            }
        }
        out
    }

    /// `[kind, pos, end, next, parent, data, flags]`
    const fn node(kind: u32, pos: u32, end: u32, parent: u32, data: u32) -> [u32; 7] {
        [kind, pos, end, 0, parent, data, 0]
    }

    #[test]
    fn the_nil_sentinel_is_not_decoded_as_a_node() {
        let decoded = decode(&payload(&[node(1, 0, 5, 0, 0)], &[]), SourceId(0)).unwrap();
        assert_eq!(decoded.nodes.len(), 1, "only the real node survives");
        assert_eq!(decoded.nodes[0].kind, NodeKind::Syntax(1));
    }

    #[test]
    fn the_content_hash_is_read_from_the_header() {
        let decoded = decode(&payload(&[node(1, 0, 1, 0, 0)], &[]), SourceId(0)).unwrap();
        assert_eq!(decoded.content_hash[0], 1);
        assert_eq!(decoded.content_hash[15], 16);
    }

    #[test]
    fn parents_are_shifted_past_the_sentinel() {
        // Encoded: node 1 is root, node 2's parent is encoded index 1.
        let decoded = decode(
            &payload(&[node(1, 0, 10, 0, 0), node(2, 0, 5, 1, 0)], &[]),
            SourceId(0),
        )
        .unwrap();
        assert_eq!(decoded.nodes[0].parent, None);
        assert_eq!(decoded.nodes[1].parent, Some(NodeId(0)));
    }

    #[test]
    fn children_are_rebuilt_in_source_order() {
        let decoded = decode(
            &payload(
                &[
                    node(1, 0, 10, 0, 0),
                    node(2, 0, 3, 1, 0),
                    node(3, 4, 7, 1, 0),
                ],
                &[],
            ),
            SourceId(0),
        )
        .unwrap();
        assert_eq!(decoded.nodes[0].children, vec![NodeId(1), NodeId(2)]);
        assert!(decoded.nodes[1].children.is_empty());
    }

    #[test]
    fn a_node_list_uses_its_data_as_a_length() {
        // Not the tagged union: 3 here means "three entries", not a string index.
        let decoded = decode(
            &payload(&[node(KIND_NODE_LIST, 0, 9, 0, 3)], &[]),
            SourceId(0),
        )
        .unwrap();
        assert_eq!(decoded.nodes[0].kind, NodeKind::List);
        assert_eq!(decoded.nodes[0].data, NodeData::ListLength(3));
        assert_eq!(decoded.nodes[0].text, None);
    }

    #[test]
    fn a_string_node_resolves_its_text() {
        let data = DATA_TYPE_STRING; // index 0
        let decoded = decode(
            &payload(&[node(80, 0, 5, 0, data)], &["hello"]),
            SourceId(0),
        )
        .unwrap();
        assert_eq!(decoded.nodes[0].text.as_deref(), Some("hello"));
        assert_eq!(
            decoded.nodes[0].data,
            NodeData::String { index: 0, small: 0 }
        );
    }

    #[test]
    fn the_six_small_bits_are_separated_from_the_payload() {
        // A PrefixUnaryExpression packs the operator's SyntaxKind into bits 24-29.
        // Reading the whole low word as a string index would be a wild pointer.
        let operator = 54u32; // TildeToken
        let data = DATA_TYPE_STRING | (operator << 24);
        let decoded = decode(&payload(&[node(220, 0, 2, 0, data)], &["x"]), SourceId(0)).unwrap();
        assert_eq!(
            decoded.nodes[0].data,
            NodeData::String {
                index: 0,
                small: 54
            }
        );
    }

    #[test]
    fn spans_come_from_pos_and_end() {
        let decoded = decode(&payload(&[node(1, 12, 34, 0, 0)], &[]), SourceId(7)).unwrap();
        let origin = &decoded.nodes[0].origin;
        assert_eq!(origin.location.span, Span::new(12, 34));
        assert_eq!(origin.location.file, SourceId(7));
    }

    #[test]
    fn a_wrong_protocol_version_is_named_plainly() {
        let mut bytes = payload(&[node(1, 0, 1, 0, 0)], &[]);
        bytes[VERSION_OFFSET] = PROTOCOL_VERSION + 1;
        let error = decode(&bytes, SourceId(0)).unwrap_err();
        assert!(matches!(error, AstError::ProtocolMismatch { .. }));
        // The message must point at the real cause: a mismatched binary.
        assert!(error.to_string().contains("pinned version"));
    }

    #[test]
    fn the_version_is_read_from_byte_three_not_byte_zero() {
        // Regression pin. encoder.go's prose table documents byte 0; the encoder
        // writes `ProtocolVersion << 24` little-endian, so it lands at byte 3.
        // Reading byte 0 makes every real payload look like protocol v0.
        let mut bytes = payload(&[node(1, 0, 1, 0, 0)], &[]);
        assert_eq!(
            bytes[0], 0,
            "byte 0 is part of the metadata word, not the version"
        );
        assert_eq!(bytes[3], PROTOCOL_VERSION);
        bytes[0] = 0xFF; // noise in the reserved bytes must not matter
        assert!(decode(&bytes, SourceId(0)).is_ok());
    }

    #[test]
    fn a_truncated_payload_is_rejected() {
        assert!(matches!(
            decode(&[0u8; 10], SourceId(0)),
            Err(AstError::TooShort { len: 10 })
        ));
    }

    #[test]
    fn a_ragged_nodes_section_is_rejected() {
        let mut bytes = payload(&[node(1, 0, 1, 0, 0)], &[]);
        bytes.push(0xAB); // one stray byte
        assert!(matches!(
            decode(&bytes, SourceId(0)),
            Err(AstError::RaggedNodes { .. })
        ));
    }

    #[test]
    fn a_dangling_parent_is_rejected() {
        let bytes = payload(&[node(1, 0, 1, 99, 0)], &[]);
        assert!(matches!(
            decode(&bytes, SourceId(0)),
            Err(AstError::DanglingParent { parent: 99, .. })
        ));
    }

    #[test]
    fn string_offsets_share_boundaries() {
        // Two strings need three boundaries, not four. Reading them as disjoint
        // 8-byte pairs would halve the count and reject valid indices.
        let bytes = payload(&[node(80, 0, 1, 0, DATA_TYPE_STRING | 1)], &["ab", "cd"]);
        let decoded = decode(&bytes, SourceId(0)).unwrap();
        assert_eq!(decoded.nodes[0].text.as_deref(), Some("cd"));
    }

    #[test]
    fn a_dangling_string_index_is_rejected() {
        // Claims string 5 when none were encoded.
        let data = DATA_TYPE_STRING | 5;
        let bytes = payload(&[node(80, 0, 1, 0, data)], &[]);
        assert!(matches!(
            decode(&bytes, SourceId(0)),
            Err(AstError::DanglingString {
                index: 5,
                count: 0,
                ..
            })
        ));
    }

    #[test]
    fn sections_out_of_order_are_rejected() {
        let mut bytes = payload(&[node(1, 0, 1, 0, 0)], &[]);
        // Point string data before string offsets.
        bytes[28..32].copy_from_slice(&0u32.to_le_bytes());
        assert!(matches!(
            decode(&bytes, SourceId(0)),
            Err(AstError::SectionsOutOfOrder { .. })
        ));
    }

    #[test]
    fn the_reserved_data_tag_is_rejected_rather_than_guessed() {
        let data = 0b11 << 30;
        let bytes = payload(&[node(1, 0, 1, 0, data)], &[]);
        assert!(matches!(
            decode(&bytes, SourceId(0)),
            Err(AstError::ReservedNodeData { tag: 3, .. })
        ));
    }

    #[test]
    fn an_empty_file_decodes_to_no_nodes() {
        // Just the sentinel. A file that fails to parse can legitimately be this.
        let decoded = decode(&payload(&[], &[]), SourceId(0)).unwrap();
        assert!(decoded.nodes.is_empty());
    }
}
