package nts.intl;

import com.ibm.icu.text.DateFormat;
import com.ibm.icu.text.DateTimePatternGenerator;
import com.ibm.icu.text.SimpleDateFormat;
import com.ibm.icu.text.DateIntervalInfo;
import com.ibm.icu.util.Calendar;
import com.ibm.icu.util.TimeZone;
import com.ibm.icu.util.ULocale;

/** CLDR date-pattern primitives; shared TypeScript owns matching and options. */
public final class IcuDatePatterns {
    private final ULocale locale;
    private final DateTimePatternGenerator generator;
    private DateIntervalInfo intervals;
    private static final int[] INTERVAL_FIELDS = {
        Calendar.ERA, Calendar.YEAR, Calendar.MONTH, Calendar.DATE,
        Calendar.AM_PM, Calendar.HOUR, Calendar.MINUTE
    };
    public IcuDatePatterns(String tag) {
        IcuVersions.verify();
        locale = ULocale.forLanguageTag(tag);
        generator = DateTimePatternGenerator.getInstance(locale);
    }
    public String bestPattern(String skeleton) {
        return generator.getBestPattern(skeleton, DateTimePatternGenerator.MATCH_HOUR_FIELD_LENGTH);
    }
    public String stylePattern(int dateStyle, int timeStyle) {
        if (dateStyle < -1 || dateStyle > 3 || timeStyle < -1 || timeStyle > 3 || (dateStyle == -1 && timeStyle == -1))
            throw new IllegalArgumentException("Invalid date/time style");
        DateFormat format = DateFormat.getDateTimeInstance(dateStyle, timeStyle, locale);
        format.setTimeZone(TimeZone.GMT_ZONE);
        return ((SimpleDateFormat)format).toPattern();
    }
    public String[] patterns() {
        return generator.getSkeletons(null).values().toArray(new String[0]);
    }
    private DateIntervalInfo intervals() {
        if (intervals == null) intervals = new DateIntervalInfo(locale);
        return intervals;
    }
    public String intervalPattern(String skeleton, int field) {
        if (field < 0 || field >= INTERVAL_FIELDS.length)
            throw new IllegalArgumentException("Invalid interval field");
        DateIntervalInfo.PatternInfo pattern = intervals().getIntervalPattern(skeleton, INTERVAL_FIELDS[field]);
        if (pattern == null) return "";
        return (pattern.firstDateInPtnIsLaterDate() ? "latestFirst:" : "earliestFirst:")
            + pattern.getFirstPart() + (pattern.getSecondPart() == null ? "" : pattern.getSecondPart());
    }
    public String intervalFallback() { return intervals().getFallbackIntervalPattern(); }
    public String dateTimeConnector(int dateStyle) {
        if (dateStyle < 0 || dateStyle > 3) throw new IllegalArgumentException("Invalid date style");
        return generator.getDateTimeFormat(dateStyle);
    }
}
