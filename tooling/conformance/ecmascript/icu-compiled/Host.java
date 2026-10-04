import java.io.BufferedReader;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.Base64;
import nts.intl.IcuLocaleData;
import nts.intl.IcuNumberData;
import nts.intl.IcuNumberFormatter;
import nts.intl.IcuCollator;
import nts.intl.IcuDatePatterns;
import nts.intl.IcuDateFormatter;
import nts.intl.IcuRelativeFormatter;
import nts.intl.IcuPluralRules;
import nts.intl.IcuDisplayNames;
import nts.intl.IcuSegmenter;
import nts.intl.IcuTimeZone;
import nts.intl.IcuCalendar;

/** Host Test262 driver only: calls the same pinned provider as compiled TS. */
public final class Host {
    private static String decode(String value) {
        byte[] bytes = Base64.getDecoder().decode(value);
        if ((bytes.length & 1) != 0) throw new IllegalArgumentException("Invalid UTF-16 request");
        char[] units = new char[bytes.length / 2];
        for (int index = 0; index < units.length; index++)
            units[index] = (char)((bytes[index * 2] & 255) | (bytes[index * 2 + 1] & 255) << 8);
        return new String(units);
    }
    private static String encode(String value) {
        byte[] bytes = new byte[value.length() * 2];
        for (int index = 0; index < value.length(); index++) {
            char unit = value.charAt(index);
            bytes[index * 2] = (byte)unit;
            bytes[index * 2 + 1] = (byte)(unit >> 8);
        }
        return Base64.getEncoder().encodeToString(bytes);
    }
    public static void main(String[] args) throws Exception {
        IcuLocaleData data = new IcuLocaleData();
        IcuNumberData numbers = new IcuNumberData();
        ArrayList<IcuNumberFormatter> formatters = new ArrayList<>();
        ArrayList<IcuCollator> collators = new ArrayList<>();
        ArrayList<IcuDatePatterns> patterns = new ArrayList<>();
        ArrayList<IcuDateFormatter> dates = new ArrayList<>();
        ArrayList<IcuRelativeFormatter> relatives = new ArrayList<>();
        ArrayList<IcuPluralRules> plurals = new ArrayList<>();
        ArrayList<IcuDisplayNames> displays = new ArrayList<>();
        ArrayList<IcuSegmenter> segments = new ArrayList<>();
        ArrayList<IcuTimeZone> zones = new ArrayList<>();
        ArrayList<IcuCalendar> calendars = new ArrayList<>();
        try (BufferedReader input = new BufferedReader(new FileReader(args[0]));
             PrintWriter output = new PrintWriter(new FileWriter(args[1]), true)) {
            String line;
            while ((line = input.readLine()) != null) {
                String[] fields = line.split("\\t", -1);
                String result;
                try {
                    String first = fields.length > 1 ? decode(fields[1]) : "";
                    switch (fields[0]) {
                        case "nowNanoseconds": {
                            java.time.Instant instant = java.time.Instant.now();
                            result = java.math.BigInteger.valueOf(instant.getEpochSecond())
                                .multiply(java.math.BigInteger.valueOf(1000000000))
                                .add(java.math.BigInteger.valueOf(instant.getNano())).toString();
                            break;
                        }
                        case "canonicalize": result = data.canonicalize(first); break;
                        case "maximize": result = data.maximize(first); break;
                        case "minimize": result = data.minimize(first); break;
                        case "defaultLocale": result = data.defaultLocale(); break;
                        case "availableCount": result = Integer.toString(data.availableCount()); break;
                        case "availableLocale": result = data.availableLocale(Integer.parseInt(first)); break;
                        case "bestFit": result = data.bestFit(first); break;
                        case "defaultNumberingSystem": result = data.defaultNumberingSystem(first); break;
                        case "hasNumberingSystem": result = Boolean.toString(data.hasNumberingSystem(first)); break;
                        case "currencyDigits": result = Integer.toString(numbers.currencyDigits(first)); break;
                        case "canonicalType": result = data.canonicalType(first, decode(fields[2])); break;
                        case "calendarValues": result = String.join(";", data.calendarValues(first)); break;
                        case "availableCalendars": result = String.join(";", data.availableCalendars(first)); break;
                        case "collationValues": result = String.join(";", data.collationValues(first)); break;
                        case "collationDefaults": result = Integer.toString(IcuCollator.defaults(first)); break;
                        case "timeZones": result = String.join(";", data.timeZones(first)); break;
                        case "textDirection": result = Integer.toString(data.textDirection(first)); break;
                        case "isHebrew": result = Boolean.toString(data.isHebrew(Integer.parseInt(first))); break;
                        case "durationSamples": {
                            String[] samples = data.durationSamples(first);
                            for (int index = 0; index < samples.length; index++) samples[index] = encode(samples[index]);
                            result = String.join(";", samples);
                            break;
                        }
                        case "listSamples": {
                            String[] tokens = { decode(fields[4]), decode(fields[5]), decode(fields[6]), decode(fields[7]) };
                            String[] samples = data.listSamples(first, Integer.parseInt(decode(fields[2])), Integer.parseInt(decode(fields[3])), tokens);
                            for (int index = 0; index < samples.length; index++) samples[index] = encode(samples[index]);
                            result = String.join(";", samples);
                            break;
                        }
                        case "weekData": result = Integer.toString(data.weekData(first)); break;
                        case "timeZoneNames": result = String.join(";", data.timeZoneNames()); break;
                        case "availableValues": result = String.join(";", data.availableValues(Integer.parseInt(first))); break;
                        case "hasCurrencyName": result = Boolean.toString(data.hasCurrencyName(first)); break;
                        case "primaryTimeZoneNames": result = String.join(";", data.primaryTimeZoneNames()); break;
                        case "primaryTimeZone": result = data.primaryTimeZone(first); break;
                        case "canonicalTimeZone": result = data.canonicalTimeZone(first); break;
                        case "defaultTimeZoneIdentifier": result = data.defaultTimeZoneIdentifier(); break;
                        case "reset": formatters.clear(); collators.clear(); patterns.clear(); dates.clear(); relatives.clear(); plurals.clear(); displays.clear(); segments.clear(); zones.clear(); calendars.clear(); result = ""; break;
                        case "calendarOpen":
                            calendars.add(new IcuCalendar(first));
                            result = Integer.toString(calendars.size() - 1);
                            break;
                        case "calendarLoad": {
                            IcuCalendar calendar = calendars.get(Integer.parseInt(first));
                            if (!calendar.load(Double.parseDouble(decode(fields[2])))) {
                                result = null;
                                break;
                            }
                            StringBuilder snapshot = new StringBuilder();
                            for (int index = 0; index < 8; index++) {
                                if (index != 0) snapshot.append(',');
                                snapshot.append(calendar.field(index));
                            }
                            result = snapshot.append(';').append(calendar.monthCode()).toString();
                            break;
                        }
                        case "calendarEstimate":
                            result = Double.toString(calendars.get(Integer.parseInt(first)).toEpochDay(
                                Double.parseDouble(decode(fields[2])), Double.parseDouble(decode(fields[3])),
                                Double.parseDouble(decode(fields[4]))));
                            break;
                        case "zoneOpen": {
                            IcuTimeZone zone = IcuTimeZone.open(first);
                            if (zone == null) throw new IllegalArgumentException("Unknown time zone");
                            zones.add(zone);
                            result = Integer.toString(zones.size() - 1);
                            break;
                        }
                        case "zoneId": result = zones.get(Integer.parseInt(first)).id(); break;
                        case "zoneOffset": result = Double.toString(zones.get(Integer.parseInt(first)).offsetMilliseconds(Double.parseDouble(decode(fields[2])))); break;
                        case "zoneLocalOffset": result = Double.toString(zones.get(Integer.parseInt(first)).localOffsetMilliseconds(Double.parseDouble(decode(fields[2])), Boolean.parseBoolean(decode(fields[3])))); break;
                        case "zoneTransition": result = Double.toString(zones.get(Integer.parseInt(first)).transition(Double.parseDouble(decode(fields[2])), Boolean.parseBoolean(decode(fields[3])))); break;
                        case "segmentOpen":
                            segments.add(new IcuSegmenter(first, Integer.parseInt(decode(fields[2]))));
                            result = Integer.toString(segments.size() - 1);
                            break;
                        case "segmentText":
                            segments.add(segments.get(Integer.parseInt(first)).forText(decode(fields[2])));
                            result = Integer.toString(segments.size() - 1);
                            break;
                        case "segmentNext": result = Integer.toString(segments.get(Integer.parseInt(first)).next()); break;
                        case "segmentPrevious": result = Integer.toString(segments.get(Integer.parseInt(first)).previous()); break;
                        case "segmentAfter": result = Integer.toString(segments.get(Integer.parseInt(first)).following(Integer.parseInt(decode(fields[2])))); break;
                        case "segmentStatus": result = Integer.toString(segments.get(Integer.parseInt(first)).ruleStatus()); break;
                        case "displayOpen":
                            displays.add(new IcuDisplayNames(first, Integer.parseInt(decode(fields[2])), Integer.parseInt(decode(fields[3])), Boolean.parseBoolean(decode(fields[4]))));
                            result = Integer.toString(displays.size() - 1);
                            break;
                        case "displayName": result = displays.get(Integer.parseInt(first)).name(decode(fields[2]), Integer.parseInt(decode(fields[3]))); break;
                        case "pluralOpen":
                            plurals.add(new IcuPluralRules(first, Boolean.parseBoolean(decode(fields[2])), decode(fields[3]), decode(fields[4])));
                            result = Integer.toString(plurals.size() - 1);
                            break;
                        case "pluralCategories": result = Integer.toString(plurals.get(Integer.parseInt(first)).categories()); break;
                        case "pluralSelect": result = Integer.toString(plurals.get(Integer.parseInt(first)).select(Double.parseDouble(decode(fields[2])), Boolean.parseBoolean(decode(fields[3])))); break;
                        case "pluralDecimal": result = Integer.toString(plurals.get(Integer.parseInt(first)).selectDecimal(decode(fields[2]), Boolean.parseBoolean(decode(fields[3])))); break;
                        case "pluralRange": result = Integer.toString(plurals.get(Integer.parseInt(first)).selectRange(decode(fields[2]), decode(fields[3]), Boolean.parseBoolean(decode(fields[4])), Boolean.parseBoolean(decode(fields[5])))); break;
                        case "relativeOpen":
                            relatives.add(new IcuRelativeFormatter(first, Integer.parseInt(decode(fields[2]))));
                            result = Integer.toString(relatives.size() - 1);
                            break;
                        case "relativeFormat": {
                            IcuRelativeFormatter formatter = relatives.get(Integer.parseInt(first));
                            String formatted = formatter.format(Double.parseDouble(decode(fields[2])), Integer.parseInt(decode(fields[3])),
                                Boolean.parseBoolean(decode(fields[4])), Boolean.parseBoolean(decode(fields[5])));
                            StringBuilder encoded = new StringBuilder(encode(formatted));
                            for (int index = 0; index < formatter.fieldCount(); index++)
                                encoded.append(';').append(formatter.field(index)).append(',').append(formatter.start(index)).append(',').append(formatter.end(index));
                            result = encoded.toString();
                            break;
                        }
                        case "patternOpen":
                            patterns.add(new IcuDatePatterns(first));
                            result = Integer.toString(patterns.size() - 1);
                            break;
                        case "bestPattern": result = patterns.get(Integer.parseInt(first)).bestPattern(decode(fields[2])); break;
                        case "stylePattern":
                            result = patterns.get(Integer.parseInt(first)).stylePattern(Integer.parseInt(decode(fields[2])), Integer.parseInt(decode(fields[3])));
                            break;
                        case "patterns": result = String.join(";", patterns.get(Integer.parseInt(first)).patterns()); break;
                        case "intervalPattern":
                            result = patterns.get(Integer.parseInt(first)).intervalPattern(decode(fields[2]), Integer.parseInt(decode(fields[3])));
                            break;
                        case "intervalFallback": result = patterns.get(Integer.parseInt(first)).intervalFallback(); break;
                        case "dateTimeConnector":
                            result = patterns.get(Integer.parseInt(first)).dateTimeConnector(Integer.parseInt(decode(fields[2])));
                            break;
                        case "dateOpen":
                            dates.add(new IcuDateFormatter(first, decode(fields[2]), decode(fields[3])));
                            result = Integer.toString(dates.size() - 1);
                            break;
                        case "dateOffset":
                            result = Integer.toString(dates.get(Integer.parseInt(first)).offsetMilliseconds(Double.parseDouble(decode(fields[2]))));
                            break;
                        case "dateRangeCollapsed":
                            result = Boolean.toString(dates.get(Integer.parseInt(first)).rangeCollapsed());
                            break;
                        case "dateFieldLocator":
                            dates.get(Integer.parseInt(first)).addFieldLocator(decode(fields[2]), decode(fields[3]),
                                Integer.parseInt(decode(fields[4])), Integer.parseInt(decode(fields[5])));
                            result = "true";
                            break;
                        case "dateYearNameOnly":
                            dates.get(Integer.parseInt(first)).setYearNameOnly(Boolean.parseBoolean(decode(fields[2])));
                            result = "true";
                            break;
                        case "dateCalendarFields":
                            result = Boolean.toString(dates.get(Integer.parseInt(first)).setCalendarFields(
                                Integer.parseInt(decode(fields[2])), Integer.parseInt(decode(fields[3])),
                                Integer.parseInt(decode(fields[4])), Boolean.parseBoolean(decode(fields[5])),
                                Integer.parseInt(decode(fields[6])), Integer.parseInt(decode(fields[7]))));
                            break;
                        case "dateFormat":
                        case "dateRange": {
                            IcuDateFormatter formatter = dates.get(Integer.parseInt(first));
                            double start = Double.parseDouble(decode(fields[2]));
                            String formatted = fields[0].equals("dateFormat")
                                ? formatter.format(start, Boolean.parseBoolean(decode(fields[3])))
                                : formatter.formatRange(start, Double.parseDouble(decode(fields[3])), Boolean.parseBoolean(decode(fields[4])));
                            StringBuilder encoded = new StringBuilder(encode(formatted));
                            for (int index = 0; index < formatter.fieldCount(); index++)
                                encoded.append(';').append(formatter.field(index)).append(',').append(formatter.start(index)).append(',').append(formatter.end(index));
                            result = encoded.toString();
                            break;
                        }
                        case "collatorOpen":
                            collators.add(new IcuCollator(first, Integer.parseInt(decode(fields[2])), Boolean.parseBoolean(decode(fields[3])),
                                Boolean.parseBoolean(decode(fields[4])), Integer.parseInt(decode(fields[5]))));
                            result = Integer.toString(collators.size() - 1);
                            break;
                        case "compare":
                            result = Integer.toString(collators.get(Integer.parseInt(first)).compare(decode(fields[2]), decode(fields[3])));
                            break;
                        case "open":
                            formatters.add(new IcuNumberFormatter(first, decode(fields[2]), decode(fields[3])));
                            result = Integer.toString(formatters.size() - 1);
                            break;
                        default:
                            IcuNumberFormatter formatter = formatters.get(Integer.parseInt(first));
                            String value = decode(fields[2]);
                            String formatted;
                            if (fields[0].equals("formatRange"))
                                formatted = formatter.formatRange(value, decode(fields[3]), Boolean.parseBoolean(decode(fields[4])),
                                    Boolean.parseBoolean(decode(fields[5])), Boolean.parseBoolean(decode(fields[6])));
                            else if (fields[0].equals("formatDecimal"))
                                formatted = formatter.formatDecimal(value, Boolean.parseBoolean(decode(fields[3])), Boolean.parseBoolean(decode(fields[4])));
                            else if (fields[0].equals("format"))
                                formatted = formatter.format(Double.parseDouble(value), Boolean.parseBoolean(decode(fields[3])), Boolean.parseBoolean(decode(fields[4])));
                            else throw new IllegalArgumentException("Unknown host provider operation");
                            StringBuilder encoded = new StringBuilder(encode(formatted));
                            for (int index = 0; index < formatter.fieldCount(); index++)
                                encoded.append(';').append(formatter.field(index)).append(',').append(formatter.start(index)).append(',').append(formatter.end(index));
                            result = encoded.toString();
                    }
                    output.println(result == null ? "null" : "ok\t" + encode(result));
                } catch (RuntimeException error) {
                    output.println("error\t" + encode(error.toString()));
                }
            }
        }
    }
}
