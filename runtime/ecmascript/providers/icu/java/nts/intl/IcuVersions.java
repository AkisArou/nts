package nts.intl;

import com.ibm.icu.lang.UCharacter;
import com.ibm.icu.util.LocaleData;
import com.ibm.icu.util.TimeZone;
import com.ibm.icu.util.VersionInfo;

/** Reject replaced data rather than silently produce backend-specific results. */
public final class IcuVersions {
    private IcuVersions() {}
    private static final boolean VERIFIED = check();
    private static boolean check() {
        if (!VersionInfo.ICU_VERSION.equals(VersionInfo.getInstance(78, 3))
            || !UCharacter.getUnicodeVersion().equals(VersionInfo.getInstance(17, 0))
            // ICU's CLDR runtime API reports 48.0 for the 48.2 maintenance data.
            // The exact jar hash, separately pinned, identifies those bytes.
            || !LocaleData.getCLDRVersion().equals(VersionInfo.getInstance(48, 0))
            || !TimeZone.getTZDataVersion().equals("2026a")) {
            throw new IllegalStateException("NTS requires ICU 78.3 / Unicode 17 / CLDR 48.2 / TZDB 2026a");
        }
        return true;
    }
    public static void verify() { if (!VERIFIED) throw new IllegalStateException("ICU verification failed"); }
}
