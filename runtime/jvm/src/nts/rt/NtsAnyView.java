package nts.rt;

/**
 * A window on an {@link NtsBuffer}: what a typed array and a `DataView` share.
 *
 * <h2>Why this exists</h2>
 *
 * `ArrayBufferView` in the specification is the union of the eleven typed
 * arrays and `DataView`, and code written against it is ordinary rather than
 * exotic -- anything that takes "some view of these bytes" and reads its
 * `buffer`, `byteOffset` or `byteLength` without caring which kind it got.
 * {@link NtsView} and {@link NtsDataView} held **the same three fields**,
 * declared twice, with no type able to name both. So a value of that union had
 * nowhere to go: `java/lang/Object` loses every accessor, and either concrete
 * class is wrong for half the inputs.
 *
 * <h2>What is here and what is deliberately not</h2>
 *
 * The three fields and nothing else. `length` is a typed array's and is
 * measured in elements; `byteLength` differs between the two -- a typed array's
 * is `count * width` and a `DataView`'s is bytes directly -- and a base that
 * declared either would be declaring a method one subclass has to fight.
 *
 * `shift` stays on {@link NtsView} for the reason its own note gives: it is
 * `log2` of an element width, a `DataView` has no element width at all, and
 * moving it up would put a field on `DataView` that means nothing there.
 *
 * <h2>Why not an interface</h2>
 *
 * Because the point is the *fields*. An interface cannot hold them, so every
 * reader would go through a virtual call to get at data that is a field load,
 * and record 0182 already measured what that costs on this exact path -- a
 * monomorphic `getAt` at 0.177 ns against 0.924 ns through a generic pair. A
 * base class keeps them as fields, and the JVM resolves a superclass field
 * statically, so reaching one through this costs nothing it did not cost
 * before.
 */
public abstract class NtsAnyView {
    final NtsBuffer buffer;
    final int offset;
    /** `-1` when the view tracks the buffer's length, as a length-less view does. */
    final int declared;

    NtsAnyView(NtsBuffer buffer, int offset, int declared) {
        this.buffer = buffer;
        this.offset = offset;
        this.declared = declared;
    }

    /** The buffer this window is on. */
    public static NtsBuffer buffer(NtsAnyView view) { return view.buffer; }

    /** Where the window starts, in bytes. */
    public static double byteOffset(NtsAnyView view) { return view.offset; }
}
