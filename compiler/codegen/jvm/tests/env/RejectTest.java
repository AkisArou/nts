import nts.rt.NtsPromise;
import nts.rt.NtsValue;

/**
 * A rejection keeps the tag it arrived with.
 *
 * <p>`nts_promise_reject_value` is in the C header, in `hir::lower`, in this
 * backend's extern table and in the shipped jar -- and **nothing tested it**.
 * It is emitted only when an `async` function throws a value that is already
 * erased, which no program in the corpus does, so the helper was wired end to
 * end and never executed by anything.
 *
 * <p>What it is for is a rethrow. `reject` takes an `Object`, because a reason
 * is normally a reference the compiler has in hand; a `finally` spanning an
 * `await` has to re-reject with exactly what the catch handed it, and that is
 * an `NtsValue` because `catch (e)` is `unknown`.
 *
 * <p>The bug it avoids is one line wide and its own doc names it: `ofObject`
 * tags every reference `OBJECT`, so a round trip through `reject` would turn a
 * rejected **string** into a rejected object. `typeof` would then answer
 * "object" for a value the program threw as a string. That is the case here,
 * and it is why these assert the *tag* rather than only the reference.
 */
public final class RejectTest {
    static int checks;
    static int failures;

    static void check(boolean ok, String what) {
        checks++;
        if (!ok) {
            failures++;
            System.out.println("FAIL " + what);
        }
    }

    public static void main(String[] args) {
        // A rejected string stays a string. Through `reject` it would not.
        NtsPromise stringly = NtsPromise.newPromise();
        NtsPromise.rejectValue(stringly, NtsValue.ofString("boom"));
        check(NtsPromise.isRejected(stringly), "a value rejection did not reject");
        check(NtsPromise.value(stringly).tag == NtsValue.STRING,
            "a rejected string came back tagged " + NtsValue.tagName(NtsPromise.value(stringly).tag)
                + " -- `ofObject` tags every reference OBJECT, which is the round trip "
                + "`rejectValue` exists to avoid");
        check("boom".equals(NtsPromise.value(stringly).ref), "the reason itself did not survive");

        // The contrast, so the assertion above is about the tag and not about
        // rejection in general: `reject` takes an Object and tags it OBJECT.
        NtsPromise objectly = NtsPromise.newPromise();
        NtsPromise.reject(objectly, "boom");
        check(NtsPromise.value(objectly).tag == NtsValue.OBJECT,
            "`reject` did not tag its reference OBJECT, so these two are the same call");

        // A number that reached a rejection keeps being a number.
        NtsPromise numeric = NtsPromise.newPromise();
        NtsPromise.rejectValue(numeric, NtsValue.ofNumber(-0.0));
        check(NtsPromise.value(numeric).tag == NtsValue.NUMBER, "a rejected number lost its tag");
        check(Double.doubleToRawLongBits(NtsPromise.value(numeric).num)
                == Double.doubleToRawLongBits(-0.0),
            "a rejected -0 came back as +0, which is a different value to `Object.is`");

        // Settled once. A late rejection after a fulfilment must not overwrite
        // it -- the completion has already been observed.
        NtsPromise once = NtsPromise.newPromise();
        NtsPromise.fulfillNumber(once, 7);
        NtsPromise.rejectValue(once, NtsValue.ofString("too late"));
        check(!NtsPromise.isRejected(once), "a rejection overwrote a settled fulfilment");
        check(NtsPromise.number(once) == 7.0, "the fulfilment's value was lost");

        // And a second rejection does not replace the first.
        NtsPromise twice = NtsPromise.newPromise();
        NtsPromise.rejectValue(twice, NtsValue.ofString("first"));
        NtsPromise.rejectValue(twice, NtsValue.ofString("second"));
        check("first".equals(NtsPromise.value(twice).ref), "a second rejection replaced the first");

        System.out.printf("reject: %d checks, %d failures%n", checks, failures);
        if (failures != 0) {
            System.exit(1);
        }
    }
}
