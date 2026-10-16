/**
 * @nts/sdk/media — audio/video *playback*.
 *
 * Standard parts (use directly): recording is `MediaRecorder` over a
 * `getUserMedia` stream; processing is Web Audio (`AudioContext`) and
 * WebCodecs; OS media controls are `navigator.mediaSession`.
 * SDK part: a player. The Web's player is `HTMLMediaElement`, which
 * does not exist without a document; native targets have real players
 * with buffering/background semantics a <video> tag does not express.
 * The *view* for video is a UI-layer component bound to a VideoPlayer.
 */
import type { Availability, SignalOptions, Size, TypedEventTarget } from "./core.d.ts";

/** Re-exported so `@nts/sdk/media` is self-describing in the API reference. */
export type MediaRecorder = globalThis.MediaRecorder;
export type AudioContext = globalThis.AudioContext;
export type MediaSession = globalThis.MediaSession;
export type MediaMetadata = globalThis.MediaMetadata;
export type MediaStream = globalThis.MediaStream;

export type MediaSource = URL | string | File | Blob;

export type PlayerState = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

export interface PlayerStatus {
  readonly state: PlayerState;
  /** Seconds. */
  readonly position: number;
  readonly duration?: number;
  readonly buffered?: number;
  readonly error?: string;
}

export interface PlayerEvents {
  status: PlayerStatusEvent;
}
export interface PlayerStatusEvent extends Event {
  readonly status: PlayerStatus;
}

export interface PlayerBase extends TypedEventTarget<PlayerEvents>, AsyncDisposable {
  readonly status: PlayerStatus;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  /** 0..1 */
  volume: number;
  muted: boolean;
  /** Swap the source without recreating the player (queue-less transitions). */
  replace(source: MediaSource): Promise<void>;
  /** 1 = normal speed. */
  rate: number;
  loop: boolean;
  close(): Promise<void>;
}

export interface AudioPlaylist {
  readonly sources: readonly MediaSource[];
  readonly currentIndex: number;
  add(source: MediaSource, atIndex?: number): void;
  remove(index: number): void;
  clear(): void;
  next(): Promise<void>;
  previous(): Promise<void>;
  skipTo(index: number): Promise<void>;
}

export interface AudioPlayer extends PlayerBase {
  /** Keep playing when the app backgrounds (needs platform audio session/entitlement). */
  playsInBackground: boolean;
}

export interface MediaTrack {
  readonly id: string;
  readonly label?: string;
  /** BCP-47 language tag where known. */
  readonly language?: string;
}

export interface VideoPlayer extends PlayerBase {
  /** Intrinsic video size once known. */
  readonly videoSize?: Size;
  readonly isLive?: boolean;
  readonly audioTracks: readonly MediaTrack[];
  readonly subtitleTracks: readonly MediaTrack[];
  selectedAudioTrack: string | undefined;
  /** Undefined = subtitles off. */
  selectedSubtitleTrack: string | undefined;
  /** Whether a Picture-in-Picture surface is possible for this player here. */
  readonly canPictureInPicture: boolean;
}

export interface Media {
  availability(): Promise<Availability>;
  createAudioPlayer(source: MediaSource, options?: SignalOptions): Promise<AudioPlayer>;
  createAudioPlaylist(
    sources: readonly MediaSource[],
    options?: SignalOptions,
  ): Promise<AudioPlaylist & AudioPlayer>;
  /** A live MediaStream is also a valid video source (previews, calls). */
  createVideoPlayer(
    source: MediaSource | MediaStream,
    options?: SignalOptions,
  ): Promise<VideoPlayer>;
}

export declare const media: Media;
