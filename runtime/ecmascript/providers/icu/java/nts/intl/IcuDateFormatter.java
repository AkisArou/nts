package nts.intl;

import com.ibm.icu.text.DateFormat;
import com.ibm.icu.text.SimpleDateFormat;
import com.ibm.icu.text.DateIntervalFormat;
import com.ibm.icu.text.DateTimePatternGenerator;
import com.ibm.icu.text.ConstrainedFieldPosition;
import com.ibm.icu.util.Calendar;
import com.ibm.icu.util.GregorianCalendar;
import com.ibm.icu.util.TimeZone;
import com.ibm.icu.util.ULocale;
import java.text.AttributedCharacterIterator;
import java.text.FieldPosition;
import java.text.Format;
import java.util.Arrays;
import java.util.Date;
import java.util.Map;

/** Reused text/field primitive. TypeScript owns ECMA-402 option and parts semantics. */
public final class IcuDateFormatter {
    private final SimpleDateFormat formatter;
    private final Calendar calendar;
    private final ULocale locale;
    private DateIntervalFormat range;
    private Calendar from, to;
    private final ConstrainedFieldPosition rangePosition = new ConstrainedFieldPosition();
    private final StringBuffer text = new StringBuffer(64);
    private final FieldPosition noField = new FieldPosition(-1);
    private final boolean yearName;
    private int[] spans = new int[48];
    private int count;

    public IcuDateFormatter(String locale, String pattern, String timeZone) {
        IcuVersions.verify();
        String identifier = timeZone.startsWith("+") || timeZone.startsWith("-") ? "GMT" + timeZone : timeZone;
        TimeZone zone = TimeZone.getTimeZone(identifier);
        if (zone.getID().equals("Etc/Unknown")) throw new IllegalArgumentException("Unknown time zone");
        this.locale = ULocale.forLanguageTag(locale);
        formatter = new SimpleDateFormat(pattern, this.locale);
        formatter.setTimeZone(zone);
        calendar = formatter.getCalendar();
        if (calendar instanceof GregorianCalendar)
            ((GregorianCalendar)calendar).setGregorianChange(new Date(-(1L << 53)));
        yearName = hasYearName(pattern);
    }
    public String format(double milliseconds, boolean fields) {
        if (!Double.isFinite(milliseconds)) throw new IllegalArgumentException("Invalid date/time");
        calendar.setTimeInMillis((long)milliseconds);
        text.setLength(0);
        count = 0;
        if (!fields) return formatter.format(calendar, text, noField).toString();
        // ICU4J's public field API returns an attributed iterator. Retain the
        // output and span buffers; the iterator's allocation belongs to ICU.
        AttributedCharacterIterator iterator = formatter.formatToCharacterIterator(calendar);
        for (int index = iterator.getBeginIndex(); index < iterator.getEndIndex();) {
            iterator.setIndex(index);
            int limit = iterator.getRunLimit();
            for (Map.Entry<AttributedCharacterIterator.Attribute, Object> entry : iterator.getAttributes().entrySet()) {
                int field = fieldCode(entry.getKey());
                if (field < 0) continue;
                if ((count + 1) * 3 > spans.length) spans = Arrays.copyOf(spans, spans.length * 2);
                spans[count * 3] = field;
                spans[count * 3 + 1] = index;
                spans[count * 3 + 2] = limit;
                count++;
            }
            while (index < limit) text.append(iterator.setIndex(index++));
        }
        return text.toString();
    }
    public int fieldCount() { return count; }
    public int field(int index) { return spans[index * 3]; }
    public int start(int index) { return spans[index * 3 + 1]; }
    public int end(int index) { return spans[index * 3 + 2]; }

    public String formatRange(double start, double end, boolean fields) {
        if (!Double.isFinite(start) || !Double.isFinite(end)) throw new IllegalArgumentException("Invalid date/time");
        if (range == null) {
            String skeleton = DateTimePatternGenerator.getInstance(locale).getSkeleton(formatter.toPattern());
            range = DateIntervalFormat.getInstance(skeleton, locale);
            range.setTimeZone(formatter.getTimeZone());
            from = (Calendar)calendar.clone();
            to = (Calendar)calendar.clone();
        }
        from.setTimeInMillis((long)start);
        to.setTimeInMillis((long)end);
        DateIntervalFormat.FormattedDateInterval result = range.formatToValue(from, to);
        rangePosition.reset();
        if (!fields) rangePosition.constrainField(DateIntervalFormat.SpanField.DATE_INTERVAL_SPAN);
        count = 0;
        boolean hasSpan = false;
        while (result.nextPosition(rangePosition)) {
            int field;
            if (rangePosition.getField() == DateIntervalFormat.SpanField.DATE_INTERVAL_SPAN) {
                field = 14 + ((Integer)rangePosition.getFieldValue()).intValue();
                hasSpan = true;
            } else field = fieldCode(rangePosition.getField());
            if (!fields || field < 0) continue;
            if ((count + 1) * 3 > spans.length) spans = Arrays.copyOf(spans, spans.length * 2);
            spans[count * 3] = field;
            spans[count * 3 + 1] = rangePosition.getStart();
            spans[count * 3 + 2] = rangePosition.getLimit();
            count++;
        }
        return hasSpan ? result.toString() : format(start, fields);
    }

    private static boolean hasYearName(String pattern) {
        boolean quoted = false;
        for (int index = 0; index < pattern.length(); index++) {
            char symbol = pattern.charAt(index);
            if (symbol == '\'') {
                if (index + 1 < pattern.length() && pattern.charAt(index + 1) == '\'') index++;
                else quoted = !quoted;
            } else if (!quoted && symbol == 'U') return true;
        }
        return false;
    }
    private int fieldCode(AttributedCharacterIterator.Attribute field) {
        if (field == DateFormat.Field.ERA) return 0;
        if (field == DateFormat.Field.YEAR) return yearName ? 12 : 1;
        if (field == DateFormat.Field.EXTENDED_YEAR) return 1;
        if (field == DateFormat.Field.MONTH) return 2;
        if (field == DateFormat.Field.DAY_OF_MONTH) return 3;
        if (field == DateFormat.Field.HOUR_OF_DAY0 || field == DateFormat.Field.HOUR_OF_DAY1 || field == DateFormat.Field.HOUR0 || field == DateFormat.Field.HOUR1) return 4;
        if (field == DateFormat.Field.MINUTE) return 5;
        if (field == DateFormat.Field.SECOND) return 6;
        if (field == DateFormat.Field.MILLISECOND) return 7;
        if (field == DateFormat.Field.DAY_OF_WEEK || field == DateFormat.Field.DOW_LOCAL) return 8;
        if (field == DateFormat.Field.AM_PM || field == DateFormat.Field.AM_PM_MIDNIGHT_NOON || field == DateFormat.Field.FLEXIBLE_DAY_PERIOD) return 9;
        if (field == DateFormat.Field.TIME_ZONE) return 10;
        if (field == DateFormat.Field.RELATED_YEAR) return 11;
        if (field == DateFormat.Field.TIME_SEPARATOR) return -1;
        return field instanceof Format.Field ? 13 : -1;
    }
}
