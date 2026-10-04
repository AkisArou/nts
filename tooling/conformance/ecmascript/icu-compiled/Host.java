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
        try (BufferedReader input = new BufferedReader(new FileReader(args[0]));
             PrintWriter output = new PrintWriter(new FileWriter(args[1]), true)) {
            String line;
            while ((line = input.readLine()) != null) {
                String[] fields = line.split("\\t", -1);
                String result;
                try {
                    String first = fields.length > 1 ? decode(fields[1]) : "";
                    switch (fields[0]) {
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
                        case "hourCycle": result = data.hourCycle(first); break;
                        case "timeZones": result = String.join(";", data.timeZones(first)); break;
                        case "textDirection": result = Integer.toString(data.textDirection(first)); break;
                        case "weekData": result = Integer.toString(data.weekData(first)); break;
                        case "timeZoneNames": result = String.join(";", data.timeZoneNames()); break;
                        case "canonicalTimeZone": result = data.canonicalTimeZone(first); break;
                        case "defaultTimeZoneIdentifier": result = data.defaultTimeZoneIdentifier(); break;
                        case "reset": formatters.clear(); collators.clear(); patterns.clear(); dates.clear(); result = ""; break;
                        case "patternOpen":
                            patterns.add(new IcuDatePatterns(first));
                            result = Integer.toString(patterns.size() - 1);
                            break;
                        case "bestPattern": result = patterns.get(Integer.parseInt(first)).bestPattern(decode(fields[2])); break;
                        case "stylePattern":
                            result = patterns.get(Integer.parseInt(first)).stylePattern(Integer.parseInt(decode(fields[2])), Integer.parseInt(decode(fields[3])));
                            break;
                        case "patterns": result = String.join(";", patterns.get(Integer.parseInt(first)).patterns()); break;
                        case "dateOpen":
                            dates.add(new IcuDateFormatter(first, decode(fields[2]), decode(fields[3])));
                            result = Integer.toString(dates.size() - 1);
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
