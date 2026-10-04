package nts.intl;

import com.ibm.icu.text.DateFormat;
import com.ibm.icu.text.DateTimePatternGenerator;
import com.ibm.icu.text.SimpleDateFormat;
import com.ibm.icu.util.TimeZone;
import com.ibm.icu.util.ULocale;

/** CLDR date-pattern primitives; shared TypeScript owns matching and options. */
public final class IcuDatePatterns {
    private final ULocale locale;
    private final DateTimePatternGenerator generator;
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
}
