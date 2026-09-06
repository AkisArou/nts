package nts.rt;

/**
 * A `Date`, which is a `double` and an identity.
 *
 * <p>Two operations reach it -- `nts_date_new` and `nts_date_value` -- and both
 * are about the same field. It is a class rather than a bare `double` because
 * two `new Date(0)` are different objects in JavaScript and a `Date | null`
 * needs an absence a `double` has no room for.
 *
 * <p>The `NtsDate` struct in `nts_runtime.h` is a header and a `double`. This
 * is the same shape with the collector's header supplied by the platform, which
 * is what every managed type on this lane looks like.
 */
public final class NtsDate {
    /** Milliseconds since the epoch, already clipped. */
    public final double ms;

    private NtsDate(double ms) { this.ms = ms; }

    /**
     * `new Date(ms)`, normalising at construction rather than at every read.
     *
     * <p>A transliteration of `nts_time_clip`, and the reasons are its reasons:
     * `new Date(1.5).getTime()` is 1 and `new Date(1e16).getTime()` is NaN, and
     * both are observable, so the truncation and the range test happen once.
     *
     * <p>`+0` and not `-0`. The specification routes through
     * `ToIntegerOrInfinity`, which maps `-0` to `+0`, and node agrees:
     * `Object.is(new Date(-0).getTime(), -0)` is false. Truncation alone leaves
     * the sign, and `1 / t` is the only thing that can tell.
     */
    public static NtsDate newDate(double ms) {
        if (!(ms >= -8.64e15 && ms <= 8.64e15)) {
            return new NtsDate(Double.NaN);
        }
        double whole = ms < 0 ? -Math.floor(-ms) : Math.floor(ms);
        return new NtsDate(whole == 0.0 ? 0.0 : whole);
    }

    /** `getTime()` and `valueOf()`, which are the same operation under two names. */
    public static double value(NtsDate date) { return date.ms; }
}
