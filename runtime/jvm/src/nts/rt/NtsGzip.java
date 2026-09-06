package nts.rt;

import java.util.zip.CRC32;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

/**
 * Streaming gzip decoding, as a push state machine over raw DEFLATE.
 *
 * <h2>Why this exists</h2>
 *
 * {@link Inflater} decodes zlib-wrapped or raw DEFLATE and knows nothing about
 * the gzip container: the magic, method and flag bytes, the optional extra
 * field, file name, comment and header CRC, and the eight trailer bytes
 * carrying CRC32 and ISIZE. {@code GZIPInputStream} does know, and is the wrong
 * shape -- it is a blocking pull over an {@code InputStream}, and every byte
 * this runtime decodes arrives from a socket callback that must not block.
 *
 * <h2>Why a state machine rather than "read the header, then inflate"</h2>
 *
 * Bytes arrive in whatever sizes the network chose. A header can split between
 * the two magic bytes, a file name can span four chunks, and the trailer can
 * arrive a byte at a time long after the last compressed byte. A decoder that
 * needs a contiguous header buffers an unbounded prefix; one that assumes a
 * field is contiguous passes every fixture and fails on a real connection.
 *
 * <p>So each header field is consumed a byte at a time, and the only buffer is
 * the {@link Inflater}'s own input window. Nothing here grows with the stream.
 *
 * <h2>What it validates, and why each check earns its place</h2>
 *
 * <ul>
 * <li><b>`FHCRC`</b>, where present: the low sixteen bits of the CRC32 of every
 *     header byte before it. A header whose flags are corrupt otherwise steers
 *     the parse itself -- a wrong `FEXTRA` length silently eats compressed
 *     data -- so this is checked before the body is trusted.
 * <li><b>Trailer CRC32</b>, over the decompressed bytes.
 * <li><b>Trailer ISIZE</b>, their count modulo 2^32. Checking only the CRC
 *     accepts a stream truncated at a multiple of 4 GiB; checking only ISIZE
 *     accepts corruption that preserves length. Both, or neither is worth much.
 * </ul>
 *
 * A mismatch is an {@link NtsRefusal} rather than a short read, because a body
 * that decoded to the wrong bytes is not a shorter body.
 *
 * <h2>Lifetime</h2>
 *
 * {@link Inflater} holds native memory the collector does not account for.
 * {@link #end} releases it, is idempotent, and must be reached on completion,
 * cancellation and close alike -- the same obligation the completion contract
 * places on every other provider resource.
 */
public final class NtsGzip {
    private enum State {
        MAGIC_1, MAGIC_2, METHOD, FLAGS, FIXED,
        EXTRA_LEN_1, EXTRA_LEN_2, EXTRA, NAME, COMMENT, HEADER_CRC_1, HEADER_CRC_2,
        BODY, TRAILER, DONE
    }

    private static final int FHCRC = 2, FEXTRA = 4, FNAME = 8, FCOMMENT = 16;
    /** `MTIME` (4), `XFL` and `OS`: six bytes nothing here reads. */
    private static final int FIXED_HEADER_REST = 6;
    private static final int DEFLATE = 8;
    private static final int TRAILER_BYTES = 8;

    private State state = State.MAGIC_1;
    private int flags;
    /** Bytes still to consume in the current counted field. */
    private int need;
    private int storedHeaderCrc;
    /** Every header byte before `FHCRC`, and nothing else. */
    private final CRC32 headerCrc = new CRC32();
    /** Every decompressed byte, across every chunk. */
    private final CRC32 bodyCrc = new CRC32();
    private long produced;
    private long trailer;
    private int trailerRead;
    private final Inflater inflater = new Inflater(true);
    private boolean ended;
    private int taken;

    private NtsGzip() {}

    public static NtsGzip newDecoder() { return new NtsGzip(); }

    /** Whether the trailer has been read and both of its checks passed. */
    public static boolean finished(NtsGzip it) { return it.state == State.DONE; }

    /** Input bytes the last {@link #decode} consumed. */
    public static int consumed(NtsGzip it) { return it.taken; }

    /** Release the inflater's native memory. Idempotent. */
    public static void end(NtsGzip it) {
        if (!it.ended) { it.ended = true; it.inflater.end(); }
    }

    /**
     * Consume up to `length` input bytes and produce up to `outLength` output.
     *
     * <p>Returns the output written. The caller drives to quiescence: output
     * short of `outLength` with {@link #consumed} short of `length` means the
     * caller should call again; both exhausted means feed more input.
     */
    public static int decode(
        NtsGzip it, byte[] in, int offset, int length, byte[] out, int outOffset, int outLength
    ) {
        if (it.ended) { throw new NtsRefusal("gzip decode after the decoder was ended"); }
        int at = offset;
        int end = offset + length;
        int written = 0;

        while (true) {
            if (it.state == State.DONE) { break; }
            if (it.state == State.BODY) {
                written += it.inflateInto(in, at, end, out, outOffset + written, outLength - written);
                at += it.inflated;
                if (it.state != State.TRAILER) { break; }
                continue;
            }
            if (at >= end) { break; }
            int b = in[at] & 0xff;
            at++;
            if (it.state == State.TRAILER) { it.trailerByte(b); } else { it.headerByte(b); }
        }
        it.taken = at - offset;
        return written;
    }

    /**
     * Input the last {@link #inflateInto} took.
     *
     * <p>A field rather than half of a packed return, because the first version
     * of this packed written and consumed into one `int` and **both overflow
     * sixteen bits**: a one-megabyte output buffer produced 4,464 bytes of a
     * 70,000-byte payload and called it done. The packing was written for
     * tidiness and the tidiness was wrong. Two of four hundred chunk/output
     * combinations found it, and only because the test varied *both* sizes.
     */
    private int inflated;

    /** One inflate pass. Returns bytes written; sets {@link #inflated}. */
    private int inflateInto(byte[] in, int at, int end, byte[] out, int outOffset, int outLength) {
        int available = end - at;
        if (available > 0) { inflater.setInput(in, at, available); }
        int written = 0;
        try {
            while (written < outLength) {
                int n = inflater.inflate(out, outOffset + written, outLength - written);
                if (n > 0) {
                    bodyCrc.update(out, outOffset + written, n);
                    written += n;
                    produced += n;
                    continue;
                }
                if (inflater.finished()) {
                    // What the inflater did not need is the trailer, and
                    // whatever follows it.
                    state = State.TRAILER;
                    inflated = available - inflater.getRemaining();
                    return written;
                }
                // Needs input. `needsDictionary` cannot arise in a raw gzip
                // stream and would be a corrupt one if it did.
                if (inflater.needsDictionary()) {
                    throw new NtsRefusal("gzip stream asked for a preset dictionary");
                }
                inflated = available;
                return written;
            }
        } catch (DataFormatException malformed) {
            throw new NtsRefusal("gzip stream is not valid DEFLATE: " + malformed.getMessage());
        }
        // Output is full; the inflater keeps the input it has not read.
        inflated = available - inflater.getRemaining();
        return written;
    }

    private void headerByte(int b) {
        if (state != State.HEADER_CRC_1 && state != State.HEADER_CRC_2) { headerCrc.update(b); }
        switch (state) {
            case MAGIC_1:
                if (b != 0x1f) { throw new NtsRefusal("not a gzip stream: first byte is not 0x1f"); }
                state = State.MAGIC_2;
                break;
            case MAGIC_2:
                if (b != 0x8b) { throw new NtsRefusal("not a gzip stream: second byte is not 0x8b"); }
                state = State.METHOD;
                break;
            case METHOD:
                if (b != DEFLATE) {
                    throw new NtsRefusal("gzip compression method " + b + " is not DEFLATE");
                }
                state = State.FLAGS;
                break;
            case FLAGS:
                flags = b;
                need = FIXED_HEADER_REST;
                state = State.FIXED;
                break;
            case FIXED:
                if (--need == 0) { state = afterFixed(); }
                break;
            case EXTRA_LEN_1:
                need = b;
                state = State.EXTRA_LEN_2;
                break;
            case EXTRA_LEN_2:
                need |= b << 8;
                state = need == 0 ? afterExtra() : State.EXTRA;
                break;
            case EXTRA:
                if (--need == 0) { state = afterExtra(); }
                break;
            case NAME:
                if (b == 0) { state = afterName(); }
                break;
            case COMMENT:
                if (b == 0) { state = afterComment(); }
                break;
            case HEADER_CRC_1:
                storedHeaderCrc = b;
                state = State.HEADER_CRC_2;
                break;
            case HEADER_CRC_2:
                storedHeaderCrc |= b << 8;
                int computed = (int) (headerCrc.getValue() & 0xffff);
                if (storedHeaderCrc != computed) {
                    throw new NtsRefusal(
                        "gzip header CRC mismatch: the header says " + storedHeaderCrc
                            + " and its bytes are " + computed
                    );
                }
                state = State.BODY;
                break;
            default:
                throw new NtsRefusal("gzip state " + state + " cannot consume a header byte");
        }
    }

    private State afterFixed() {
        return (flags & FEXTRA) != 0 ? State.EXTRA_LEN_1 : afterExtra();
    }

    private State afterExtra() {
        return (flags & FNAME) != 0 ? State.NAME : afterName();
    }

    private State afterName() {
        return (flags & FCOMMENT) != 0 ? State.COMMENT : afterComment();
    }

    private State afterComment() {
        return (flags & FHCRC) != 0 ? State.HEADER_CRC_1 : State.BODY;
    }

    private void trailerByte(int b) {
        trailer |= ((long) b) << (8 * trailerRead);
        trailerRead++;
        if (trailerRead < TRAILER_BYTES) { return; }
        long storedCrc = trailer & 0xFFFFFFFFL;
        long storedSize = (trailer >>> 32) & 0xFFFFFFFFL;
        long actualCrc = bodyCrc.getValue();
        if (storedCrc != actualCrc) {
            throw new NtsRefusal(
                "gzip CRC32 mismatch: the trailer says " + storedCrc + " and the data is " + actualCrc
            );
        }
        if (storedSize != (produced & 0xFFFFFFFFL)) {
            throw new NtsRefusal(
                "gzip ISIZE mismatch: the trailer says " + storedSize + " and "
                    + (produced & 0xFFFFFFFFL) + " bytes were produced"
            );
        }
        state = State.DONE;
    }
}
