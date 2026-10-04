package nts.intl;

import com.ibm.icu.text.ConstrainedFieldPosition;
import com.ibm.icu.text.DisplayContext;
import com.ibm.icu.text.DecimalFormat;
import com.ibm.icu.text.NumberFormat;
import com.ibm.icu.text.RelativeDateTimeFormatter;
import com.ibm.icu.util.ULocale;
import java.util.Arrays;

/** Locale text/field primitive. Shared TS owns options and exact text offsets. */
public final class IcuRelativeFormatter {
    private static final RelativeDateTimeFormatter.RelativeDateTimeUnit[] UNITS = {
        RelativeDateTimeFormatter.RelativeDateTimeUnit.YEAR,
        RelativeDateTimeFormatter.RelativeDateTimeUnit.QUARTER,
        RelativeDateTimeFormatter.RelativeDateTimeUnit.MONTH,
        RelativeDateTimeFormatter.RelativeDateTimeUnit.WEEK,
        RelativeDateTimeFormatter.RelativeDateTimeUnit.DAY,
        RelativeDateTimeFormatter.RelativeDateTimeUnit.HOUR,
        RelativeDateTimeFormatter.RelativeDateTimeUnit.MINUTE,
        RelativeDateTimeFormatter.RelativeDateTimeUnit.SECOND
    };
    private final RelativeDateTimeFormatter formatter;
    private ConstrainedFieldPosition position;
    private int[] spans;
    private int count;

    public IcuRelativeFormatter(String tag, int style) {
        IcuVersions.verify();
        if (style < 0 || style > 2) throw new IllegalArgumentException("Invalid relative style");
        ULocale locale = ULocale.forLanguageTag(tag);
        NumberFormat numbers = NumberFormat.getNumberInstance(locale);
        numbers.setMinimumIntegerDigits(1);
        numbers.setMinimumFractionDigits(0);
        numbers.setMaximumFractionDigits(3);
        numbers.setGroupingUsed(true);
        if (!(numbers instanceof DecimalFormat)) throw new IllegalStateException("Relative numbering requires decimal data");
        ((DecimalFormat) numbers).setMinimumGroupingDigits(DecimalFormat.MINIMUM_GROUPING_DIGITS_AUTO);
        numbers.setRoundingMode(com.ibm.icu.math.BigDecimal.ROUND_HALF_UP);
        formatter = RelativeDateTimeFormatter.getInstance(locale, numbers,
            RelativeDateTimeFormatter.Style.values()[style], DisplayContext.CAPITALIZATION_NONE);
    }
    public String format(double value, int unit, boolean auto, boolean fields) {
        if (!Double.isFinite(value) || unit < 0 || unit >= UNITS.length)
            throw new IllegalArgumentException("Invalid relative input");
        count = 0;
        if (!fields) return auto ? formatter.format(value, UNITS[unit]) : formatter.formatNumeric(value, UNITS[unit]);
        RelativeDateTimeFormatter.FormattedRelativeDateTime result = auto
            ? formatter.formatToValue(value, UNITS[unit]) : formatter.formatNumericToValue(value, UNITS[unit]);
        if (position == null) position = new ConstrainedFieldPosition();
        position.reset();
        while (result.nextPosition(position)) {
            int field;
            if (position.getField() == NumberFormat.Field.INTEGER) field = 0;
            else if (position.getField() == NumberFormat.Field.FRACTION) field = 1;
            else if (position.getField() == NumberFormat.Field.DECIMAL_SEPARATOR) field = 2;
            else if (position.getField() == NumberFormat.Field.GROUPING_SEPARATOR) field = 6;
            else if (position.getField() == RelativeDateTimeFormatter.Field.NUMERIC) field = 14;
            else if (position.getField() == RelativeDateTimeFormatter.Field.LITERAL) continue;
            else throw new IllegalStateException("Unexpected relative number field");
            if (spans == null) spans = new int[24];
            else if ((count + 1) * 3 > spans.length) spans = Arrays.copyOf(spans, spans.length * 2);
            spans[count * 3] = field;
            spans[count * 3 + 1] = position.getStart();
            spans[count * 3 + 2] = position.getLimit();
            count++;
        }
        return result.toString();
    }
    public int fieldCount() { return count; }
    public int field(int index) { return spans[index * 3]; }
    public int start(int index) { return spans[index * 3 + 1]; }
    public int end(int index) { return spans[index * 3 + 2]; }
}
