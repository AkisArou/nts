//! The timed path never waits for a socket. A bounded queue retains partial
//! writes; only the last measured session's completion may block to flush it.
use std::collections::VecDeque;
use std::io::{self, Write};

const MAX_PENDING: usize = 1024 * 1024;

#[derive(Debug)]
pub(super) struct Nonblocking<W> {
    pub(super) writer: W,
    pending: VecDeque<Vec<u8>>,
    offset: usize,
    bytes: usize,
}
impl<W: Write> Nonblocking<W> {
    pub(super) fn new(writer: W) -> Self {
        Self {
            writer,
            pending: VecDeque::new(),
            offset: 0,
            bytes: 0,
        }
    }
    pub(super) fn drain(&mut self) -> io::Result<()> {
        while let Some(front) = self.pending.front() {
            match self.writer.write(&front[self.offset..]) {
                Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
                Ok(n) => {
                    self.offset += n;
                    self.bytes -= n;
                    if self.offset == front.len() {
                        self.pending.pop_front();
                        self.offset = 0;
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(()),
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
    pub(super) fn record(&mut self, record: &[u8]) -> io::Result<()> {
        self.drain()?;
        if self.bytes + record.len() > MAX_PENDING {
            return Err(io::Error::other(
                "check telemetry: bounded nonblocking queue exhausted",
            ));
        }
        self.pending.push_back(record.to_vec());
        self.bytes += record.len();
        self.drain()
    }
    pub(super) fn complete(&mut self) -> io::Result<()> {
        // The caller has already switched the real socket to its event-driven
        // blocking mode, outside every active check.total span.
        while let Some(front) = self.pending.pop_front() {
            self.writer.write_all(&front[self.offset..])?;
            self.offset = 0;
        }
        self.bytes = 0;
        self.writer.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Debug, Default)]
    struct Full {
        blocked: bool,
        bytes: Vec<u8>,
        calls: usize,
    }
    impl Write for Full {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.calls += 1;
            if self.blocked {
                return Err(io::ErrorKind::WouldBlock.into());
            }
            let n = bytes.len().min(3);
            self.bytes.extend_from_slice(&bytes[..n]);
            Ok(n)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    #[test]
    fn full_socket_queues_without_retrying_or_waiting_in_a_timed_send() {
        let mut output = Nonblocking::new(Full {
            blocked: true,
            ..Full::default()
        });
        assert!(output.record(b"phase one\n").is_ok());
        assert_eq!(output.writer.calls, 1, "WouldBlock returns immediately");
        assert!(output.record(b"phase two\n").is_ok());
        assert_eq!(output.writer.calls, 3, "at most one retry per send attempt");
        assert_eq!(output.bytes, 20);
        output.writer.blocked = false;
        assert!(output.complete().is_ok());
        assert_eq!(output.writer.bytes, b"phase one\nphase two\n");
    }
    #[test]
    fn pending_memory_is_bounded_even_when_the_receiver_never_reads() {
        let mut output = Nonblocking::new(Full {
            blocked: true,
            ..Full::default()
        });
        assert!(output.record(&vec![0; MAX_PENDING]).is_ok());
        assert!(output.record(b"more").is_err());
        assert_eq!(output.bytes, MAX_PENDING);
    }
}
