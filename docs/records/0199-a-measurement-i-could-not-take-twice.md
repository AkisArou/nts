# A measurement I could not take twice

I had "a device with a radio" on the blocked list for Wi-Fi/cellular
transitions. That was wrong in the way record 0190 is about: the emulator
carries **both** networks.

    NetworkAgentInfo{ ni{[type: WIFI[],        state: CONNECTED ...]} network{101} ... Score{60}
    NetworkAgentInfo{ ni{[type: MOBILE[LTE],   state: CONNECTED ...]} network{100} ... Score{50}

Both connected, both validated, WiFi default on score. With `adb root`, taking
`wlan0` down moves the default from one to the other exactly as a handover does:

    Active default network: 101      ->      Active default network: 100

And `app_process` can obtain a system `Context` through
`ActivityThread.systemMain`, which API 26 permits because hidden-API
restrictions arrive at 28. So the whole path is reachable: register a real
`ConnectivityManager` callback, open connections, produce a transition, watch
`watchDefaultNetwork` sweep them.

It worked.

    handover: 4 checks, 0 failures

And the sabotage bit — with nothing watching the default network, three
connections were still open after the transition, which is precisely the state
`networkChanged` exists to prevent.

## And then it would not do it again

The same class, run from the device suite's dex, hung. Run from its own dex,
which had passed twenty minutes earlier, hung. It wedged `adb` twice, and when
killed between taking `wlan0` down and restoring it, left the device with no
Wi-Fi — after which every later run hung on a network that was never coming
back, and I spent half an hour looking for a dex-packaging interaction that
turned out not to exist.

I added the restore to the harness, outside the JVM, so a kill could not leave
it down. It hung anyway.

## Why it is not in the suite

Because a case that cannot be run twice in a row is not evidence a suite can
carry, whatever it showed once. Everything else in that suite is a ratchet: a
count that may not fall, checked on every run. A case that passes, then hangs,
then hangs, contributes nothing to that and takes the device down with it —
including for every other case that would have run after it.

So the honest ledger entry is not "network transitions: tested". It is:

- **A Wi-Fi to cellular transition is producible here.** Measured.
- **`watchDefaultNetwork` swept the connections when one happened.** Measured
  once, with a sabotage that failed it.
- **Neither is reproducible on this setup**, and the cause is unknown.
- The transition *decision* — which events mean the sockets are dead — remains
  tested thirteen ways on a desktop JVM, and that part is a ratchet.

## The thing worth keeping

I have spent this session learning to test claims instead of asserting them,
and this is the other edge of it. A measurement taken once is not a test. The
suite's value is that its numbers cannot quietly fall, and something that only
works sometimes cannot have that property — it can only make every number
downstream of it unreliable too.

Deleting a passing result feels like losing evidence. What it actually removes
is a case that would have been amber forever, and that every future failure
elsewhere in the suite would have had to be diagnosed around.
