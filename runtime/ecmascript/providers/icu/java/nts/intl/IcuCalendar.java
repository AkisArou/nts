package nts.intl;

import com.ibm.icu.util.Calendar;
import com.ibm.icu.util.GregorianCalendar;
import com.ibm.icu.util.TimeZone;
import com.ibm.icu.util.ULocale;
import java.util.Date;

/** Public ICU calendar conversion/data only; JS calendar semantics live in TS. */
public final class IcuCalendar {
    private static final long DAY_MILLIS = 86400000;
    private final Calendar calendar;
    private final boolean hebrew;

    public IcuCalendar(String identifier) {
        IcuVersions.verify();
        ULocale locale = ULocale.forLanguageTag("und-u-ca-" + identifier);
        calendar = Calendar.getInstance(TimeZone.getTimeZone("GMT"), locale);
        String type = ULocale.toLegacyType("calendar", identifier);
        if (type == null || !calendar.getType().equals(type))
            throw new IllegalArgumentException("Unknown ICU calendar");
        hebrew = type.equals("hebrew");
        if (calendar instanceof GregorianCalendar)
            ((GregorianCalendar) calendar).setGregorianChange(new Date(-9007199254740992L));
        calendar.setLenient(false);
    }

    public boolean load(double epochDay) {
        // ICU4J 78.3's Hebrew CalendarCache can hang on non-positive years.
        // Decline this raw-data range before touching it. Shared arithmetic
        // covers the full Temporal range, including these Hebrew years.
        if (hebrew && epochDay < -2092590) return false;
        double milliseconds = epochDay * DAY_MILLIS;
        if (!Double.isFinite(epochDay) || epochDay != Math.floor(epochDay)
                || Math.abs(milliseconds) > 9007199254740991.0) return false;
        try {
            calendar.setTimeInMillis((long) milliseconds);
            calendar.get(Calendar.EXTENDED_YEAR);
            calendar.get(Calendar.ORDINAL_MONTH);
            calendar.get(Calendar.DAY_OF_MONTH);
            return calendar.getTimeInMillis() == (long) milliseconds;
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    public double field(int index) {
        switch (index) {
            case 0: return calendar.get(Calendar.EXTENDED_YEAR);
            case 1: return calendar.get(Calendar.ORDINAL_MONTH);
            case 2: return calendar.get(Calendar.DAY_OF_MONTH);
            case 3: return calendar.get(Calendar.DAY_OF_YEAR);
            case 4: return calendar.getActualMaximum(Calendar.DAY_OF_MONTH);
            case 5: return calendar.getActualMaximum(Calendar.DAY_OF_YEAR);
            case 6: return calendar.getActualMaximum(Calendar.ORDINAL_MONTH) + 1;
            case 7: return calendar.inTemporalLeapYear() ? 1 : 0;
            default: return Double.NaN;
        }
    }

    public String monthCode() {
        return calendar.getTemporalMonthCode();
    }

    public double toEpochDay(double extendedYear, double ordinalMonth, double day) {
        if (hebrew && extendedYear <= 0) return Double.NaN;
        if (!integer(extendedYear) || !integer(ordinalMonth) || !integer(day))
            return Double.NaN;
        calendar.clear();
        calendar.set(Calendar.EXTENDED_YEAR, (int) extendedYear);
        calendar.set(Calendar.MONTH, 0);
        calendar.set(Calendar.DAY_OF_MONTH, 1);
        try {
            // ICU 78's ordinal setter wraps month 13 to month 1 in Chinese
            // years with a late leap month (e.g. 2033). Traverse the public
            // month topology from the first day, before setting the final day.
            calendar.getTimeInMillis();
            if (ordinalMonth < 0 || ordinalMonth > calendar.getActualMaximum(Calendar.ORDINAL_MONTH))
                return Double.NaN;
            if (ordinalMonth != 0) {
                calendar.add(Calendar.MONTH, (int) ordinalMonth);
                // add computes the new month but retains user field stamps.
                // Reset them before changing day, or ICU resolves month 1 again.
                calendar.setTimeInMillis(calendar.getTimeInMillis());
            }
            calendar.set(Calendar.DAY_OF_MONTH, (int) day);
            return calendar.getTimeInMillis() / (double) DAY_MILLIS;
        } catch (IllegalArgumentException error) {
            return Double.NaN;
        }
    }

    private static boolean integer(double value) {
        return Double.isFinite(value) && value == Math.floor(value)
            && value >= Integer.MIN_VALUE && value <= Integer.MAX_VALUE;
    }
}
