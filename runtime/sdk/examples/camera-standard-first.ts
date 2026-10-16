// Standards do capture; the SDK only adds continuous scanning.
import { barcodeScanner, camera } from "@nts/sdk/camera";
import { photos } from "@nts/sdk/photos";

export async function captureWithStandards(view: { srcObject: MediaStream | null }): Promise<boolean> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
  });
  view.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  if (track === undefined) return false;
  const blob = await new ImageCapture(track).takePhoto();
  await photos.save(blob); // SDK gap: the user's library
  for (const t of stream.getTracks()) t.stop();
  return true;
}

export async function scanUntilFound(stream: MediaStream, signal: AbortSignal): Promise<string | undefined> {
  // One-shot standard first: new BarcodeDetector().detect(bitmap)
  for await (const batch of barcodeScanner.scan(stream, { formats: ["qr_code"], signal })) {
    const first = batch[0];
    if (first !== undefined) return first.rawValue;
  }
  return undefined;
}

export async function systemCamera(): Promise<File | null> {
  const photo = await camera.capturePhoto(); // null when backed out
  return photo?.file ?? null;
}
