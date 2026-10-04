package nts.intl;

import com.ibm.icu.text.DateFormat;
import com.ibm.icu.text.SimpleDateFormat;
import com.ibm.icu.text.DateFormatSymbols;
import com.ibm.icu.text.DateIntervalFormat;
import com.ibm.icu.text.DateTimePatternGenerator;
import com.ibm.icu.text.ConstrainedFieldPosition;
import com.ibm.icu.util.Calendar;
import com.ibm.icu.util.GregorianCalendar;
import com.ibm.icu.util.TimeZone;
import com.ibm.icu.util.ULocale;
import java.text.AttributedCharacterIterator;
import java.text.FieldPosition;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.Map;

/** Reused text/field primitive. TypeScript owns ECMA-402 option and parts semantics. */
public final class IcuDateFormatter {
    private final SimpleDateFormat formatter;
    private Calendar calendar;
    private CalendarFields prepared;
    private final ULocale locale;
    private final String calendarType;
    private DateIntervalFormat range;
    private Calendar from, to;
    private final ConstrainedFieldPosition rangePosition = new ConstrainedFieldPosition();
    private final StringBuffer text = new StringBuffer(64);
    private final FieldPosition noField = new FieldPosition(-1);
    private ArrayList<DateFieldLocator> locators;
    private StringBuffer scratch;
    private int[] spans = new int[48];
    private int count;
    private boolean collapsed = true;
    private boolean yearNameOnly;

    public IcuDateFormatter(String locale, String pattern, String timeZone) {
        IcuVersions.verify();
        String identifier = timeZone.startsWith("+") || timeZone.startsWith("-") ? "GMT" + timeZone : timeZone;
        TimeZone zone = TimeZone.getTimeZone(identifier);
        if (zone.getID().equals("Etc/Unknown")) throw new IllegalArgumentException("Unknown time zone");
        this.locale = ULocale.forLanguageTag(locale);
        formatter = new SimpleDateFormat(pattern, this.locale);
        formatter.setTimeZone(zone);
        calendar = formatter.getCalendar();
        calendarType = calendar.getType();
        if (calendar instanceof GregorianCalendar)
            ((GregorianCalendar)calendar).setGregorianChange(new Date(-(1L << 53)));
    }
    public String calendarType() { return calendarType; }
    public String format(double milliseconds, boolean fields) {
        if (!Double.isFinite(milliseconds)) throw new IllegalArgumentException("Invalid date/time");
        calendar.setTimeInMillis((long)milliseconds);
        text.setLength(0);
        count = 0;
        collapsed = true;
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
        locateFields();
        return text.toString();
    }
    public void addFieldLocator(String marker, String pattern, int markerCode, int field) {
        if ((markerCode != 0 && markerCode != 1) || (field != 11 && field != 12) || pattern.isEmpty())
            throw new IllegalArgumentException("Invalid calendar field locator");
        if (locators == null) locators = new ArrayList<>(2);
        locators.add(new DateFieldLocator(marker, pattern, markerCode, field));
    }
    public void setYearNameOnly(boolean value) { yearNameOnly = value; }
    private static final class DateFieldLocator {
        final String markerPattern, fieldPattern;
        final FieldPosition position;
        final int field;
        SimpleDateFormat marker, value;
        DateFieldLocator(String markerPattern, String fieldPattern, int markerCode, int field) {
            this.markerPattern = markerPattern;
            this.fieldPattern = fieldPattern;
            this.field = field;
            position = new FieldPosition(markerCode == 0 ? DateFormat.Field.MILLISECONDS_IN_DAY : DateFormat.Field.JULIAN_DAY);
        }
    }
    private void locateFields() {
        if (locators == null) return;
        if (scratch == null) scratch = new StringBuffer(64);
        for (DateFieldLocator locator : locators) {
            if (locator.value == null) {
                // Keep the configured calendar type and localized symbols.
                locator.value = (SimpleDateFormat)formatter.clone();
                locator.value.applyPattern(locator.fieldPattern);
                if (!locator.markerPattern.isEmpty()) {
                    locator.marker = (SimpleDateFormat)formatter.clone();
                    locator.marker.applyPattern(locator.markerPattern);
                }
            }
            int start = 0;
            if (locator.marker != null) {
                scratch.setLength(0);
                locator.position.setBeginIndex(0);
                locator.position.setEndIndex(0);
                locator.marker.format(calendar, scratch, locator.position);
                if (locator.position.getEndIndex() <= locator.position.getBeginIndex())
                    throw new IllegalStateException("Calendar marker field was not formatted");
                start = locator.position.getBeginIndex();
            }
            scratch.setLength(0);
            locator.value.format(calendar, scratch, noField);
            int end = start + scratch.length();
            if (end > text.length() || end <= start)
                throw new IllegalStateException("Calendar field span outside text");
            int output = 0;
            for (int index = 0; index < count; index++) {
                if (locator.field == 12 && spans[index * 3] == 1 && spans[index * 3 + 1] >= start && spans[index * 3 + 2] <= end)
                    continue;
                spans[output * 3] = spans[index * 3];
                spans[output * 3 + 1] = spans[index * 3 + 1];
                spans[output * 3 + 2] = spans[index * 3 + 2];
                output++;
            }
            count = output;
            if ((count + 1) * 3 > spans.length) spans = Arrays.copyOf(spans, spans.length * 2);
            int position = 0;
            while (position < count && spans[position * 3 + 1] <= start) position++;
            System.arraycopy(spans, position * 3, spans, (position + 1) * 3, (count - position) * 3);
            spans[position * 3] = locator.field;
            spans[position * 3 + 1] = start;
            spans[position * 3 + 2] = end;
            count++;
        }
    }
    public int fieldCount() { return count; }
    public int field(int index) { return spans[index * 3]; }
    public int start(int index) { return spans[index * 3 + 1]; }
    public int end(int index) { return spans[index * 3 + 2]; }
    public boolean rangeCollapsed() { return collapsed; }

    public int offsetMilliseconds(double milliseconds) {
        if (!Double.isFinite(milliseconds)) throw new IllegalArgumentException("Invalid date/time");
        return formatter.getTimeZone().getOffset((long)milliseconds);
    }
    private static String[] projectEras(String[] original, String[] gregorian) {
        if (original.length < 5 || gregorian.length < 2)
            throw new IllegalStateException("Pinned calendar era symbols are unavailable");
        String[] projected = new String[7];
        projected[0] = gregorian[0];
        projected[1] = gregorian[1];
        System.arraycopy(original, original.length - 5, projected, 2, 5);
        return projected;
    }
    private DateFormatSymbols preparedSymbols() {
        DateFormatSymbols symbols = formatter.getDateFormatSymbols();
        if (calendarType.equals("coptic")) {
            symbols.setEras(new String[] {symbols.getEras()[1]});
            symbols.setEraNames(new String[] {symbols.getEraNames()[1]});
            symbols.setNarrowEras(new String[] {symbols.getNarrowEras()[1]});
        } else if (calendarType.equals("japanese")) {
            ULocale gregory = new ULocale.Builder().setLocale(locale)
                .setUnicodeLocaleKeyword("ca", "gregory").build();
            DateFormatSymbols base = new DateFormatSymbols(gregory);
            symbols.setEras(projectEras(symbols.getEras(), base.getEras()));
            symbols.setEraNames(projectEras(symbols.getEraNames(), base.getEraNames()));
            symbols.setNarrowEras(projectEras(symbols.getNarrowEras(), base.getNarrowEras()));
        }
        return symbols;
    }
    public boolean setCalendarFields(int relatedYear, int year, int era, int month, boolean leap, int day, int dayOfYear) {
        if (era < 0 || era > 6 || month < 0 || month > 13 || day < 1 || day > 31 || dayOfYear < 1 || dayOfYear > 400)
            return false;
        if (prepared == null) {
            boolean lunisolar = calendarType.equals("chinese") || calendarType.equals("dangi");
            DateFormatSymbols symbols = lunisolar ? null : preparedSymbols();
            String type = lunisolar ? calendarType : "gregorian";
            prepared = new CalendarFields(formatter.getTimeZone(), locale, type);
            formatter.setCalendar(prepared);
            if (symbols != null) formatter.setDateFormatSymbols(symbols);
            calendar = prepared;
            if (locators != null) for (DateFieldLocator locator : locators) {
                locator.value = null;
                locator.marker = null;
            }
        }
        prepared.relatedYear = relatedYear;
        prepared.year = year;
        prepared.era = era;
        prepared.month = month;
        prepared.leap = leap;
        prepared.day = day;
        prepared.dayOfYear = dayOfYear;
        // Even repeated timestamps must recompute after replacing their fields.
        prepared.clear();
        return true;
    }

    /** Data adapter only: shared TypeScript supplies all calendar date fields. */
    private static final class CalendarFields extends GregorianCalendar {
        private static final long serialVersionUID = 1L;
        private final String type;
        int relatedYear, year, era, month, day, dayOfYear;
        boolean leap;
        CalendarFields(TimeZone zone, ULocale locale, String type) {
            super(zone, locale);
            this.type = type;
            setGregorianChange(new Date(-(1L << 53)));
        }
        @Override public String getType() { return type == null ? "gregorian" : type; }
        @Override protected void computeFields() {
            super.computeFields();
            internalSet(ERA, era);
            internalSet(YEAR, year);
            internalSet(EXTENDED_YEAR, relatedYear);
            internalSet(MONTH, month);
            internalSet(IS_LEAP_MONTH, leap ? 1 : 0);
            internalSet(DAY_OF_MONTH, day);
            internalSet(DAY_OF_YEAR, dayOfYear);
        }
    }

    public String formatRange(double start, double end, boolean fields) {
        if (prepared != null || locators != null) throw new IllegalStateException("Prepared calendar ranges require shared pattern selection");
        if (!Double.isFinite(start) || !Double.isFinite(end)) throw new IllegalArgumentException("Invalid date/time");
        if (range == null) {
            String skeleton = DateTimePatternGenerator.getInstance(locale).getSkeleton(formatter.toPattern());
            range = DateIntervalFormat.getInstance(skeleton, locale);
            range.setTimeZone(formatter.getTimeZone());
            from = calendar.clone();
            to = calendar.clone();
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
        if (!hasSpan) return format(start, fields);
        collapsed = false;
        return result.toString();
    }

    private int fieldCode(AttributedCharacterIterator.Attribute field) {
        if (field == DateFormat.Field.ERA) return 0;
        if (field == DateFormat.Field.YEAR) return yearNameOnly ? 12 : 1;
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
        if (field == DateFormat.Field.DAY_OF_YEAR || field == DateFormat.Field.DAY_OF_WEEK_IN_MONTH
            || field == DateFormat.Field.WEEK_OF_YEAR || field == DateFormat.Field.WEEK_OF_MONTH
            || field == DateFormat.Field.YEAR_WOY || field == DateFormat.Field.JULIAN_DAY
            || field == DateFormat.Field.MILLISECONDS_IN_DAY || field == DateFormat.Field.QUARTER) return 13;
        return -1;
    }
}
