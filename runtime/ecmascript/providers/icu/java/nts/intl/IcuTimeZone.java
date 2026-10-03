package nts.intl;

import com.ibm.icu.util.BasicTimeZone;
import com.ibm.icu.util.TimeZone;
import com.ibm.icu.util.TimeZoneTransition;

/** A reusable ICU data primitive, with no ECMAScript disambiguation policy. */
public final class IcuTimeZone {
    private final BasicTimeZone zone;
    private final int[] offsets = new int[2];

    private IcuTimeZone(BasicTimeZone zone) { this.zone = zone; }

    public static IcuTimeZone open(String id) {
        IcuVersions.verify();
        boolean[] system = new boolean[1];
        String canonical = TimeZone.getCanonicalID(id, system);
        if (canonical == null || !system[0]) return null;
        TimeZone zone = TimeZone.getFrozenTimeZone(canonical);
        return zone instanceof BasicTimeZone ? new IcuTimeZone((BasicTimeZone) zone) : null;
    }

    public String id() { return zone.getID(); }

    public synchronized double offsetMilliseconds(double epochMilliseconds) {
        if (!Double.isFinite(epochMilliseconds)) return Double.NaN;
        zone.getOffset((long) Math.floor(epochMilliseconds), false, offsets);
        return (double) offsets[0] + offsets[1];
    }

    public synchronized double localOffsetMilliseconds(double localMilliseconds, boolean former) {
        if (!Double.isFinite(localMilliseconds)) return Double.NaN;
        BasicTimeZone.LocalOption option = former ? BasicTimeZone.LocalOption.FORMER : BasicTimeZone.LocalOption.LATTER;
        zone.getOffsetFromLocal((long) Math.floor(localMilliseconds), option, option, offsets);
        return (double) offsets[0] + offsets[1];
    }

    // NaN is the primitive ABI's absent transition. The TS adapter exposes null.
    public double transition(double epochMilliseconds, boolean forward) {
        if (!Double.isFinite(epochMilliseconds)) return Double.NaN;
        long instant = (long) Math.floor(epochMilliseconds);
        TimeZoneTransition transition = forward ? zone.getNextTransition(instant, false) : zone.getPreviousTransition(instant, false);
        return transition == null ? Double.NaN : transition.getTime();
    }
}
