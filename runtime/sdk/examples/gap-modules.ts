// Step-4 gap modules in use, beside their standard counterparts.
import { auth } from "@nts/sdk/auth";
import { images } from "@nts/sdk/images";
import { media } from "@nts/sdk/media";
import { network } from "@nts/sdk/network";
import { compose } from "@nts/sdk/compose";
import { store } from "@nts/sdk/store";
import { barometer } from "@nts/sdk/device";
import { brightness } from "@nts/sdk/brightness";
import { printing } from "@nts/sdk/printing";

export async function signIn(clientId: string): Promise<string | null> {
  const url = new URL("https://example.invalid/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", "myapp://auth");
  const back = await auth.openSession(url, { redirect: "myapp://" });
  return back?.searchParams.get("code") ?? null;
}

export async function thumbnail(original: File): Promise<File> {
  const out = await images.process(
    original,
    [{ resize: { width: 320 } }, { rotate: 0 }],
    { format: "image/webp", stripMetadata: true },
  );
  return out.file;
}

export async function playEpisode(episode: URL): Promise<void> {
  await using player = await media.createAudioPlayer(episode);
  player.playsInBackground = true;
  navigator.mediaSession.metadata = new MediaMetadata({ title: "Episode 1" });
  await player.play();
}

export async function waitForWifi(): Promise<void> {
  await using states = await network.watch();
  for await (const s of states) {
    if (s.online && s.type === "wifi") break;
  }
}

export async function sendReport(report: File): Promise<void> {
  if ((await compose.mailAvailable()).available) {
    await compose.mail({ subject: "Report", attachments: [report] });
  }
  if (Math.random() > 0.9) await store.requestReview();
  await printing.print(report).catch(() => "cancelled" as const);
}

export async function altitudeHint(): Promise<number> {
  const { hPa } = await barometer.pressure();
  await brightness.set(0.35, "app");
  return hPa;
}
