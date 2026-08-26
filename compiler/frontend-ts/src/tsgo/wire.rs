//! The `tsgo --api` frame codec.
//!
//! Despite the name, tsgo's `MessagePack` protocol is not general msgpack. It is
//! one fixed shape, defined by `internal/api/protocol_msgpack.go`:
//!
//! ```text
//! 0x93          msgpack fixed-array marker, 3 elements
//! <type>        positive fixint (0x00-0x7F), or 0xCC followed by a byte
//! <bin>         method name
//! <bin>         payload
//! ```
//!
//! where `<bin>` is `0xC4 u8len` / `0xC5 u16len` / `0xC6 u32len` (lengths
//! big-endian) followed by that many bytes.
//!
//! Payloads are JSON, except responses the server marks `RawBinary` — which is how
//! an encoded AST comes back without a base64 round trip.
//!
//! Implementing this directly rather than reaching for a msgpack crate is the
//! smaller dependency: a general decoder would accept frames this protocol never
//! produces, and we would still have to reject them.

use std::io::{self, Read, Write};

/// Frame kinds, from `internal/api/protocol_msgpack.go`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MessageType {
    /// Client → server. The method name doubles as the correlation id.
    Request = 1,
    /// Client → server, answering a server [`MessageType::Call`].
    CallResponse = 2,
    /// Client → server, failing a server [`MessageType::Call`].
    CallError = 3,
    /// Server → client, answering a [`MessageType::Request`].
    Response = 4,
    /// Server → client, failing a [`MessageType::Request`]. Payload is message text.
    Error = 5,
    /// Server → client. Filesystem callbacks, which we do not enable.
    Call = 6,
}

impl MessageType {
    const fn from_byte(raw: u8) -> Option<Self> {
        match raw {
            1 => Some(Self::Request),
            2 => Some(Self::CallResponse),
            3 => Some(Self::CallError),
            4 => Some(Self::Response),
            5 => Some(Self::Error),
            6 => Some(Self::Call),
            _ => None,
        }
    }
}

const ARRAY3: u8 = 0x93;
const BIN8: u8 = 0xC4;
const BIN16: u8 = 0xC5;
const BIN32: u8 = 0xC6;
const UINT8: u8 = 0xCC;

/// A decoded frame.
#[derive(Debug, Clone)]
pub struct Frame {
    pub message_type: MessageType,
    pub method: String,
    pub payload: Vec<u8>,
}

/// Why a frame could not be read or written.
#[derive(Debug, thiserror::Error)]
pub enum WireError {
    #[error("io error talking to tsgo: {0}")]
    Io(#[from] io::Error),

    #[error("expected a 3-element array marker (0x93), got 0x{0:02x}")]
    NotATuple(u8),

    #[error("expected a fixint or uint8 message type, got 0x{0:02x}")]
    BadTypeMarker(u8),

    #[error("unknown message type {0}")]
    UnknownMessageType(u8),

    #[error("expected binary data (0xc4-0xc6), got 0x{0:02x}")]
    NotBinary(u8),

    #[error("method name was not utf-8")]
    MethodNotUtf8,

    #[error("payload exceeds 4 GiB")]
    PayloadTooLarge,
}

/// Write one frame.
pub fn write_frame(
    w: &mut impl Write,
    message_type: MessageType,
    method: &str,
    payload: &[u8],
) -> Result<(), WireError> {
    w.write_all(&[ARRAY3, message_type as u8])?;
    write_bin(w, method.as_bytes())?;
    write_bin(w, payload)?;
    w.flush()?;
    Ok(())
}

fn write_bin(w: &mut impl Write, data: &[u8]) -> Result<(), WireError> {
    let len = data.len();
    if let Ok(len8) = u8::try_from(len) {
        w.write_all(&[BIN8, len8])?;
    } else if let Ok(len16) = u16::try_from(len) {
        w.write_all(&[BIN16])?;
        w.write_all(&len16.to_be_bytes())?;
    } else {
        let len32 = u32::try_from(len).map_err(|_| WireError::PayloadTooLarge)?;
        w.write_all(&[BIN32])?;
        w.write_all(&len32.to_be_bytes())?;
    }
    w.write_all(data)?;
    Ok(())
}

/// Read one frame.
pub fn read_frame(r: &mut impl Read) -> Result<Frame, WireError> {
    let marker = read_byte(r)?;
    if marker != ARRAY3 {
        return Err(WireError::NotATuple(marker));
    }

    let type_marker = read_byte(r)?;
    let raw = if type_marker <= 0x7F {
        type_marker
    } else if type_marker == UINT8 {
        read_byte(r)?
    } else {
        return Err(WireError::BadTypeMarker(type_marker));
    };
    let message_type = MessageType::from_byte(raw).ok_or(WireError::UnknownMessageType(raw))?;

    let method = String::from_utf8(read_bin(r)?).map_err(|_| WireError::MethodNotUtf8)?;
    let payload = read_bin(r)?;

    Ok(Frame {
        message_type,
        method,
        payload,
    })
}

fn read_byte(r: &mut impl Read) -> Result<u8, WireError> {
    let mut byte = [0u8; 1];
    r.read_exact(&mut byte)?;
    Ok(byte[0])
}

fn read_bin(r: &mut impl Read) -> Result<Vec<u8>, WireError> {
    let marker = read_byte(r)?;
    let len = match marker {
        BIN8 => u32::from(read_byte(r)?),
        BIN16 => {
            let mut b = [0u8; 2];
            r.read_exact(&mut b)?;
            u32::from(u16::from_be_bytes(b))
        }
        BIN32 => {
            let mut b = [0u8; 4];
            r.read_exact(&mut b)?;
            u32::from_be_bytes(b)
        }
        other => return Err(WireError::NotBinary(other)),
    };

    // `read_to_end` on a take() rather than `vec![0; len]` so a frame claiming
    // 4 GiB cannot make us allocate it before a single byte has arrived.
    let mut payload = Vec::new();
    let read = r.take(u64::from(len)).read_to_end(&mut payload)?;
    if read != len as usize {
        return Err(WireError::Io(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            format!("frame claimed {len} payload bytes, got {read}"),
        )));
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    fn roundtrip(method: &str, payload: &[u8]) -> Frame {
        let mut buffer = Vec::new();
        write_frame(&mut buffer, MessageType::Request, method, payload).unwrap();
        read_frame(&mut buffer.as_slice()).unwrap()
    }

    #[test]
    fn small_frame_roundtrips() {
        let frame = roundtrip("initialize", b"{}");
        assert_eq!(frame.message_type, MessageType::Request);
        assert_eq!(frame.method, "initialize");
        assert_eq!(frame.payload, b"{}");
    }

    #[test]
    fn frame_layout_matches_the_go_encoder() {
        // Pinned byte-for-byte against protocol_msgpack.go's writeTuple. A test
        // that only round-trips with itself would pass with both sides wrong.
        let mut buffer = Vec::new();
        write_frame(&mut buffer, MessageType::Request, "ab", b"xy").unwrap();
        assert_eq!(
            buffer,
            vec![0x93, 0x01, 0xC4, 0x02, b'a', b'b', 0xC4, 0x02, b'x', b'y'],
        );
    }

    #[test]
    fn bin16_is_used_past_255_bytes() {
        let payload = vec![7u8; 300];
        let mut buffer = Vec::new();
        write_frame(&mut buffer, MessageType::Response, "m", &payload).unwrap();
        // array marker, type, then bin8 method (marker + len + 1 byte) = 5 bytes
        assert_eq!(buffer[5], BIN16);
        assert_eq!(&buffer[6..8], &300u16.to_be_bytes());
        assert_eq!(roundtrip("m", &payload).payload, payload);
    }

    #[test]
    fn bin32_is_used_past_65535_bytes() {
        let payload = vec![3u8; 70_000];
        let mut buffer = Vec::new();
        write_frame(&mut buffer, MessageType::Response, "m", &payload).unwrap();
        assert_eq!(buffer[5], BIN32);
        assert_eq!(&buffer[6..10], &70_000u32.to_be_bytes());
        assert_eq!(roundtrip("m", &payload).payload.len(), 70_000);
    }

    #[test]
    fn uint8_type_marker_is_accepted() {
        // The Go writer only emits fixints, but its reader accepts 0xCC. Accept it
        // too, rather than depending on which branch the server happened to take.
        let framed = [0x93, UINT8, 4, 0xC4, 0x01, b'm', 0xC4, 0x00];
        let frame = read_frame(&mut framed.as_slice()).unwrap();
        assert_eq!(frame.message_type, MessageType::Response);
        assert!(frame.payload.is_empty());
    }

    #[test]
    fn a_non_tuple_frame_is_rejected() {
        let garbage = [0x91, 0x01];
        assert!(matches!(
            read_frame(&mut garbage.as_slice()),
            Err(WireError::NotATuple(0x91))
        ));
    }

    #[test]
    fn an_unknown_message_type_is_rejected() {
        let framed = [0x93, 0x7F, 0xC4, 0x00, 0xC4, 0x00];
        assert!(matches!(
            read_frame(&mut framed.as_slice()),
            Err(WireError::UnknownMessageType(0x7F))
        ));
    }

    #[test]
    fn a_truncated_payload_is_an_error_not_a_panic() {
        // Claims 8 bytes, supplies 2. Must not index past the end or hang.
        let framed = [0x93, 0x01, 0xC4, 0x01, b'm', 0xC4, 0x08, 1, 2];
        assert!(matches!(
            read_frame(&mut framed.as_slice()),
            Err(WireError::Io(_))
        ));
    }

    #[test]
    fn an_empty_method_name_roundtrips() {
        // The server writes an empty method on responses when there is no id.
        let mut buffer = Vec::new();
        write_frame(&mut buffer, MessageType::Response, "", b"null").unwrap();
        let frame = read_frame(&mut buffer.as_slice()).unwrap();
        assert!(frame.method.is_empty());
        assert_eq!(frame.payload, b"null");
    }
}
