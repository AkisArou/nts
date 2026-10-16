/**
 * lib.native-dom.d.ts — TEMPORARY, generated. Do not hand-edit.
 *
 * The application-platform subset of TypeScript 7.0.2's lib.dom.d.ts
 * (plus its iterable/asynciterable companions), copied verbatim by
 * tools/extract-native-dom.py, for nts application targets that have no
 * browser document: native mobile/desktop and the Blink host's app
 * realm. Web platform shape, no Window/Document/Element tree.
 *
 * TypeScript's lib files are Apache-2.0 (Copyright Microsoft); see
 * https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt
 *
 * Two kinds of deviation, both produced by the extractor and recorded
 * there: OVERRIDES (aliases trimmed of DOM-tree members) and the
 * MDN-sourced additions at the end (APIs lib.dom does not carry yet).
 * This file is a stand-in until nts generates a native lib from WebIDL;
 * membership here is a *typing* convenience, not a conformance claim —
 * docs/compatibility tracks what each target actually implements.
 */

interface AacEncoderConfig {
  format?: AacBitstreamFormat;
}

interface AddEventListenerOptions extends EventListenerOptions {
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

interface AesCbcParams extends Algorithm {
  iv: BufferSource;
}

interface AesCtrParams extends Algorithm {
  counter: BufferSource;
  length: number;
}

interface AesDerivedKeyParams extends Algorithm {
  length: number;
}

interface AesGcmParams extends Algorithm {
  additionalData?: BufferSource;
  iv: BufferSource;
  tagLength?: number;
}

interface AesKeyAlgorithm extends KeyAlgorithm {
  length: number;
}

interface AesKeyGenParams extends Algorithm {
  length: number;
}

interface Algorithm {
  name: string;
}

interface AllAcceptedCredentialsOptions {
  allAcceptedCredentialIds: Base64URLString[];
  rpId: string;
  userId: Base64URLString;
}

interface AnalyserOptions extends AudioNodeOptions {
  fftSize?: number;
  maxDecibels?: number;
  minDecibels?: number;
  smoothingTimeConstant?: number;
}

interface AudioBufferOptions {
  length: number;
  numberOfChannels?: number;
  sampleRate: number;
}

interface AudioBufferSourceOptions {
  buffer?: AudioBuffer | null;
  detune?: number;
  loop?: boolean;
  loopEnd?: number;
  loopStart?: number;
  playbackRate?: number;
}

interface AudioContextOptions {
  latencyHint?: AudioContextLatencyCategory | number;
  sampleRate?: number;
}

interface AudioDataCopyToOptions {
  format?: AudioSampleFormat;
  frameCount?: number;
  frameOffset?: number;
  planeIndex: number;
}

interface AudioDataInit {
  data: BufferSource;
  format: AudioSampleFormat;
  numberOfChannels: number;
  numberOfFrames: number;
  sampleRate: number;
  timestamp: number;
  transfer?: ArrayBuffer[];
}

interface AudioDecoderConfig {
  codec: string;
  description?: AllowSharedBufferSource;
  numberOfChannels: number;
  sampleRate: number;
}

interface AudioDecoderInit {
  error: WebCodecsErrorCallback;
  output: AudioDataOutputCallback;
}

interface AudioDecoderSupport {
  config?: AudioDecoderConfig;
  supported?: boolean;
}

interface AudioEncoderConfig {
  aac?: AacEncoderConfig;
  bitrate?: number;
  bitrateMode?: BitrateMode;
  codec: string;
  numberOfChannels: number;
  opus?: OpusEncoderConfig;
  sampleRate: number;
}

interface AudioEncoderInit {
  error: WebCodecsErrorCallback;
  output: EncodedAudioChunkOutputCallback;
}

interface AudioEncoderSupport {
  config?: AudioEncoderConfig;
  supported?: boolean;
}

interface AudioNodeOptions {
  channelCount?: number;
  channelCountMode?: ChannelCountMode;
  channelInterpretation?: ChannelInterpretation;
}

interface AudioProcessingEventInit extends EventInit {
  inputBuffer: AudioBuffer;
  outputBuffer: AudioBuffer;
  playbackTime: number;
}

interface AudioTimestamp {
  contextTime?: number;
  performanceTime?: DOMHighResTimeStamp;
}

interface AuthenticationExtensionsClientInputs {
  appid?: string;
  credProps?: boolean;
  credentialProtectionPolicy?: string;
  enforceCredentialProtectionPolicy?: boolean;
  hmacCreateSecret?: boolean;
  largeBlob?: AuthenticationExtensionsLargeBlobInputs;
  minPinLength?: boolean;
  prf?: AuthenticationExtensionsPRFInputs;
}

interface AuthenticationExtensionsClientInputsJSON {
  appid?: string;
  credProps?: boolean;
  largeBlob?: AuthenticationExtensionsLargeBlobInputsJSON;
  prf?: AuthenticationExtensionsPRFInputsJSON;
}

interface AuthenticationExtensionsClientOutputs {
  appid?: boolean;
  credProps?: CredentialPropertiesOutput;
  hmacCreateSecret?: boolean;
  largeBlob?: AuthenticationExtensionsLargeBlobOutputs;
  prf?: AuthenticationExtensionsPRFOutputs;
}

interface AuthenticationExtensionsClientOutputsJSON {
  appid?: boolean;
  credProps?: CredentialPropertiesOutput;
  largeBlob?: AuthenticationExtensionsLargeBlobOutputsJSON;
  prf?: AuthenticationExtensionsPRFOutputsJSON;
}

interface AuthenticationExtensionsLargeBlobInputs {
  read?: boolean;
  support?: string;
  write?: BufferSource;
}

interface AuthenticationExtensionsLargeBlobInputsJSON {
  read?: boolean;
  support?: string;
  write?: Base64URLString;
}

interface AuthenticationExtensionsLargeBlobOutputs {
  blob?: ArrayBuffer;
  supported?: boolean;
  written?: boolean;
}

interface AuthenticationExtensionsLargeBlobOutputsJSON {
  blob?: Base64URLString;
  supported?: boolean;
  written?: boolean;
}

interface AuthenticationExtensionsPRFInputs {
  eval?: AuthenticationExtensionsPRFValues;
  evalByCredential?: Record<string, AuthenticationExtensionsPRFValues>;
}

interface AuthenticationExtensionsPRFInputsJSON {
  eval?: AuthenticationExtensionsPRFValuesJSON;
  evalByCredential?: Record<string, AuthenticationExtensionsPRFValuesJSON>;
}

interface AuthenticationExtensionsPRFOutputs {
  enabled?: boolean;
  results?: AuthenticationExtensionsPRFValues;
}

interface AuthenticationExtensionsPRFOutputsJSON {
  enabled?: boolean;
  results?: AuthenticationExtensionsPRFValuesJSON;
}

interface AuthenticationExtensionsPRFValues {
  first: BufferSource;
  second?: BufferSource;
}

interface AuthenticationExtensionsPRFValuesJSON {
  first: Base64URLString;
  second?: Base64URLString;
}

interface AuthenticationResponseJSON {
  authenticatorAttachment?: string;
  clientExtensionResults: AuthenticationExtensionsClientOutputsJSON;
  id: string;
  rawId: Base64URLString;
  response: AuthenticatorAssertionResponseJSON;
  type: string;
}

interface AuthenticatorAssertionResponseJSON {
  authenticatorData: Base64URLString;
  clientDataJSON: Base64URLString;
  signature: Base64URLString;
  userHandle?: Base64URLString;
}

interface AuthenticatorAttestationResponseJSON {
  attestationObject: Base64URLString;
  authenticatorData: Base64URLString;
  clientDataJSON: Base64URLString;
  publicKey?: Base64URLString;
  publicKeyAlgorithm: COSEAlgorithmIdentifier;
  transports: string[];
}

interface AuthenticatorSelectionCriteria {
  authenticatorAttachment?: AuthenticatorAttachment;
  requireResidentKey?: boolean;
  residentKey?: ResidentKeyRequirement;
  userVerification?: UserVerificationRequirement;
}

interface AvcEncoderConfig {
  format?: AvcBitstreamFormat;
}

interface BiquadFilterOptions extends AudioNodeOptions {
  Q?: number;
  detune?: number;
  frequency?: number;
  gain?: number;
  type?: BiquadFilterType;
}

interface BlobEventInit extends EventInit {
  data: Blob;
  timecode?: DOMHighResTimeStamp;
}

interface BlobPropertyBag {
  endings?: EndingType;
  type?: string;
}

interface ChannelMergerOptions extends AudioNodeOptions {
  numberOfInputs?: number;
}

interface ChannelSplitterOptions extends AudioNodeOptions {
  numberOfOutputs?: number;
}

interface ClipboardItemOptions {
  presentationStyle?: PresentationStyle;
}

interface CloseEventInit extends EventInit {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

interface ConstantSourceOptions {
  offset?: number;
}

interface ConstrainBooleanOrDOMStringParameters {
  exact?: boolean | string;
  ideal?: boolean | string;
}

interface ConstrainBooleanParameters {
  exact?: boolean;
  ideal?: boolean;
}

interface ConstrainDOMStringParameters {
  exact?: string | string[];
  ideal?: string | string[];
}

interface ConstrainDoubleRange extends DoubleRange {
  exact?: number;
  ideal?: number;
}

interface ConstrainULongRange extends ULongRange {
  exact?: number;
  ideal?: number;
}

interface ConvolverOptions extends AudioNodeOptions {
  buffer?: AudioBuffer | null;
  disableNormalization?: boolean;
}

interface CredentialCreationOptions {
  publicKey?: PublicKeyCredentialCreationOptions;
  signal?: AbortSignal;
}

interface CredentialPropertiesOutput {
  rk?: boolean;
}

interface CredentialRequestOptions {
  mediation?: CredentialMediationRequirement;
  publicKey?: PublicKeyCredentialRequestOptions;
  signal?: AbortSignal;
}

interface CryptoKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

interface CurrentUserDetailsOptions {
  displayName: string;
  name: string;
  rpId: string;
  userId: Base64URLString;
}

interface CustomEventInit<T = any> extends EventInit {
  detail?: T;
}

interface DOMMatrix2DInit {
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  e?: number;
  f?: number;
  m11?: number;
  m12?: number;
  m21?: number;
  m22?: number;
  m41?: number;
  m42?: number;
}

interface DOMMatrixInit extends DOMMatrix2DInit {
  is2D?: boolean;
  m13?: number;
  m14?: number;
  m23?: number;
  m24?: number;
  m31?: number;
  m32?: number;
  m33?: number;
  m34?: number;
  m43?: number;
  m44?: number;
}

interface DOMPointInit {
  w?: number;
  x?: number;
  y?: number;
  z?: number;
}

interface DOMRectInit {
  height?: number;
  width?: number;
  x?: number;
  y?: number;
}

interface DelayOptions extends AudioNodeOptions {
  delayTime?: number;
  maxDelayTime?: number;
}

interface DeviceMotionEventAccelerationInit {
  x?: number | null;
  y?: number | null;
  z?: number | null;
}

interface DeviceMotionEventInit extends EventInit {
  acceleration?: DeviceMotionEventAccelerationInit;
  accelerationIncludingGravity?: DeviceMotionEventAccelerationInit;
  interval?: number;
  rotationRate?: DeviceMotionEventRotationRateInit;
}

interface DeviceMotionEventRotationRateInit {
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
}

interface DeviceOrientationEventInit extends EventInit {
  absolute?: boolean;
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
}

interface DisplayMediaStreamOptions {
  audio?: boolean | MediaTrackConstraints;
  video?: boolean | MediaTrackConstraints;
}

interface DoubleRange {
  max?: number;
  min?: number;
}

interface DynamicsCompressorOptions extends AudioNodeOptions {
  attack?: number;
  knee?: number;
  ratio?: number;
  release?: number;
  threshold?: number;
}

interface EcKeyGenParams extends Algorithm {
  namedCurve: NamedCurve;
}

interface EcKeyImportParams extends Algorithm {
  namedCurve: NamedCurve;
}

interface EcdhKeyDeriveParams extends Algorithm {
  public: CryptoKey;
}

interface EcdsaParams extends Algorithm {
  hash: HashAlgorithmIdentifier;
}

interface EncodedAudioChunkInit {
  data: AllowSharedBufferSource;
  duration?: number;
  timestamp: number;
  transfer?: ArrayBuffer[];
  type: EncodedAudioChunkType;
}

interface EncodedAudioChunkMetadata {
  decoderConfig?: AudioDecoderConfig;
}

interface EncodedVideoChunkInit {
  data: AllowSharedBufferSource;
  duration?: number;
  timestamp: number;
  type: EncodedVideoChunkType;
}

interface EncodedVideoChunkMetadata {
  decoderConfig?: VideoDecoderConfig;
  svc?: SvcOutputMetadata;
}

interface ErrorEventInit extends EventInit {
  colno?: number;
  error?: any;
  filename?: string;
  lineno?: number;
  message?: string;
}

interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

interface EventListenerOptions {
  capture?: boolean;
}

interface EventSourceInit {
  withCredentials?: boolean;
}

interface FilePropertyBag extends BlobPropertyBag {
  lastModified?: number;
}

interface FileSystemCreateWritableOptions {
  keepExistingData?: boolean;
}

interface FileSystemGetDirectoryOptions {
  create?: boolean;
}

interface FileSystemGetFileOptions {
  create?: boolean;
}

interface FileSystemRemoveOptions {
  recursive?: boolean;
}

interface FontFaceDescriptors {
  ascentOverride?: string;
  descentOverride?: string;
  display?: FontDisplay;
  featureSettings?: string;
  lineGapOverride?: string;
  stretch?: string;
  style?: string;
  unicodeRange?: string;
  variationSettings?: string;
  weight?: string;
}

interface FontFaceSetLoadEventInit extends EventInit {
  fontfaces?: FontFace[];
}

interface GainOptions extends AudioNodeOptions {
  gain?: number;
}

interface GamepadEffectParameters {
  duration?: number;
  leftTrigger?: number;
  rightTrigger?: number;
  startDelay?: number;
  strongMagnitude?: number;
  weakMagnitude?: number;
}

interface HkdfParams extends Algorithm {
  hash: HashAlgorithmIdentifier;
  info: BufferSource;
  salt: BufferSource;
}

interface HmacImportParams extends Algorithm {
  hash: HashAlgorithmIdentifier;
  length?: number;
}

interface HmacKeyGenParams extends Algorithm {
  hash: HashAlgorithmIdentifier;
  length?: number;
}

interface IDBDatabaseInfo {
  name?: string;
  version?: number;
}

interface IDBIndexParameters {
  multiEntry?: boolean;
  unique?: boolean;
}

interface IDBObjectStoreParameters {
  autoIncrement?: boolean;
  keyPath?: string | string[] | null;
}

interface IDBTransactionOptions {
  durability?: IDBTransactionDurability;
}

interface IDBVersionChangeEventInit extends EventInit {
  newVersion?: number | null;
  oldVersion?: number;
}

interface IIRFilterOptions extends AudioNodeOptions {
  feedback: number[];
  feedforward: number[];
}

interface ImageBitmapOptions {
  colorSpaceConversion?: ColorSpaceConversion;
  imageOrientation?: ImageOrientation;
  premultiplyAlpha?: PremultiplyAlpha;
  resizeHeight?: number;
  resizeQuality?: ResizeQuality;
  resizeWidth?: number;
}

interface ImageDecodeOptions {
  completeFramesOnly?: boolean;
  frameIndex?: number;
}

interface ImageDecodeResult {
  complete: boolean;
  image: VideoFrame;
}

interface ImageDecoderInit {
  colorSpaceConversion?: ColorSpaceConversion;
  data: ImageBufferSource;
  desiredHeight?: number;
  desiredWidth?: number;
  preferAnimation?: boolean;
  transfer?: ArrayBuffer[];
  type: string;
}

interface JsonWebKey {
  alg?: string;
  crv?: string;
  d?: string;
  dp?: string;
  dq?: string;
  e?: string;
  ext?: boolean;
  k?: string;
  key_ops?: string[];
  kty?: string;
  n?: string;
  oth?: RsaOtherPrimesInfo[];
  p?: string;
  q?: string;
  qi?: string;
  use?: string;
  x?: string;
  y?: string;
}

interface KeyAlgorithm {
  name: string;
}

interface LockInfo {
  clientId?: string;
  mode?: LockMode;
  name?: string;
}

interface LockManagerSnapshot {
  held?: LockInfo[];
  pending?: LockInfo[];
}

interface LockOptions {
  ifAvailable?: boolean;
  mode?: LockMode;
  signal?: AbortSignal;
  steal?: boolean;
}

interface MediaImage {
  sizes?: string;
  src: string;
  type?: string;
}

interface MediaMetadataInit {
  album?: string;
  artist?: string;
  artwork?: MediaImage[];
  title?: string;
}

interface MediaPositionState {
  duration?: number;
  playbackRate?: number;
  position?: number;
}

interface MediaRecorderOptions {
  audioBitsPerSecond?: number;
  bitsPerSecond?: number;
  mimeType?: string;
  videoBitsPerSecond?: number;
}

interface MediaSessionActionDetails {
  action: MediaSessionAction;
  fastSeek?: boolean;
  seekOffset?: number;
  seekTime?: number;
}

interface MediaSettingsRange {
  max?: number;
  min?: number;
  step?: number;
}

interface MediaStreamAudioSourceOptions {
  mediaStream: MediaStream;
}

interface MediaStreamConstraints {
  audio?: boolean | MediaTrackConstraints;
  peerIdentity?: string;
  preferCurrentTab?: boolean;
  video?: boolean | MediaTrackConstraints;
}

interface MediaStreamTrackEventInit extends EventInit {
  track: MediaStreamTrack;
}

interface MediaTrackCapabilities {
  aspectRatio?: DoubleRange;
  autoGainControl?: boolean[];
  backgroundBlur?: boolean[];
  channelCount?: ULongRange;
  deviceId?: string;
  displaySurface?: string;
  echoCancellation?: (boolean | string)[];
  facingMode?: string[];
  frameRate?: DoubleRange;
  groupId?: string;
  height?: ULongRange;
  noiseSuppression?: boolean[];
  sampleRate?: ULongRange;
  sampleSize?: ULongRange;
  width?: ULongRange;
}

interface MediaTrackConstraintSet {
  aspectRatio?: ConstrainDouble;
  autoGainControl?: ConstrainBoolean;
  backgroundBlur?: ConstrainBoolean;
  channelCount?: ConstrainULong;
  deviceId?: ConstrainDOMString;
  displaySurface?: ConstrainDOMString;
  echoCancellation?: ConstrainBooleanOrDOMString;
  facingMode?: ConstrainDOMString;
  frameRate?: ConstrainDouble;
  groupId?: ConstrainDOMString;
  height?: ConstrainULong;
  noiseSuppression?: ConstrainBoolean;
  sampleRate?: ConstrainULong;
  sampleSize?: ConstrainULong;
  width?: ConstrainULong;
}

interface MediaTrackConstraints extends MediaTrackConstraintSet {
  advanced?: MediaTrackConstraintSet[];
}

interface MediaTrackSettings {
  aspectRatio?: number;
  autoGainControl?: boolean;
  backgroundBlur?: boolean;
  channelCount?: number;
  deviceId?: string;
  displaySurface?: string;
  echoCancellation?: boolean | string;
  facingMode?: string;
  frameRate?: number;
  groupId?: string;
  height?: number;
  noiseSuppression?: boolean;
  sampleRate?: number;
  sampleSize?: number;
  torch?: boolean;
  whiteBalanceMode?: string;
  width?: number;
  zoom?: number;
}

interface MediaTrackSupportedConstraints {
  aspectRatio?: boolean;
  autoGainControl?: boolean;
  backgroundBlur?: boolean;
  channelCount?: boolean;
  deviceId?: boolean;
  displaySurface?: boolean;
  echoCancellation?: boolean;
  facingMode?: boolean;
  frameRate?: boolean;
  groupId?: boolean;
  height?: boolean;
  noiseSuppression?: boolean;
  sampleRate?: boolean;
  sampleSize?: boolean;
  width?: boolean;
}

interface MessageEventInit<T = any> extends EventInit {
  data?: T;
  lastEventId?: string;
  origin?: string;
  ports?: MessagePort[];
  source?: MessageEventSource | null;
}

interface NotificationOptions {
  badge?: string;
  body?: string;
  data?: any;
  dir?: NotificationDirection;
  icon?: string;
  lang?: string;
  requireInteraction?: boolean;
  silent?: boolean | null;
  tag?: string;
}

interface OfflineAudioCompletionEventInit extends EventInit {
  renderedBuffer: AudioBuffer;
}

interface OfflineAudioContextOptions {
  length: number;
  numberOfChannels?: number;
  sampleRate: number;
}

interface OpusEncoderConfig {
  complexity?: number;
  format?: OpusBitstreamFormat;
  frameDuration?: number;
  packetlossperc?: number;
  usedtx?: boolean;
  useinbandfec?: boolean;
}

interface OscillatorOptions extends AudioNodeOptions {
  detune?: number;
  frequency?: number;
  periodicWave?: PeriodicWave;
  type?: OscillatorType;
}

interface PannerOptions extends AudioNodeOptions {
  coneInnerAngle?: number;
  coneOuterAngle?: number;
  coneOuterGain?: number;
  distanceModel?: DistanceModelType;
  maxDistance?: number;
  orientationX?: number;
  orientationY?: number;
  orientationZ?: number;
  panningModel?: PanningModelType;
  positionX?: number;
  positionY?: number;
  positionZ?: number;
  refDistance?: number;
  rolloffFactor?: number;
}

interface Pbkdf2Params extends Algorithm {
  hash: HashAlgorithmIdentifier;
  iterations: number;
  salt: BufferSource;
}

interface PerformanceMarkOptions {
  detail?: any;
  startTime?: DOMHighResTimeStamp;
}

interface PerformanceMeasureOptions {
  detail?: any;
  duration?: DOMHighResTimeStamp;
  end?: string | DOMHighResTimeStamp;
  start?: string | DOMHighResTimeStamp;
}

interface PerformanceObserverInit {
  buffered?: boolean;
  entryTypes?: string[];
  type?: string;
}

interface PeriodicWaveConstraints {
  disableNormalization?: boolean;
}

interface PeriodicWaveOptions extends PeriodicWaveConstraints {
  imag?: number[] | Float32Array;
  real?: number[] | Float32Array;
}

interface PermissionDescriptor {
  name: PermissionName;
}

interface PhotoCapabilities {
  fillLightMode?: FillLightMode[];
  imageHeight?: MediaSettingsRange;
  imageWidth?: MediaSettingsRange;
  redEyeReduction?: RedEyeReduction;
}

interface PhotoSettings {
  fillLightMode?: FillLightMode;
  imageHeight?: number;
  imageWidth?: number;
  redEyeReduction?: boolean;
}

interface PlaneLayout {
  offset: number;
  stride: number;
}

interface PositionOptions {
  enableHighAccuracy?: boolean;
  maximumAge?: number;
  timeout?: number;
}

interface ProgressEventInit extends EventInit {
  lengthComputable?: boolean;
  loaded?: number;
  total?: number;
}

interface PublicKeyCredentialCreationOptions {
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  challenge: BufferSource;
  excludeCredentials?: PublicKeyCredentialDescriptor[];
  extensions?: AuthenticationExtensionsClientInputs;
  pubKeyCredParams: PublicKeyCredentialParameters[];
  rp: PublicKeyCredentialRpEntity;
  timeout?: number;
  user: PublicKeyCredentialUserEntity;
}

interface PublicKeyCredentialCreationOptionsJSON {
  attestation?: string;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  challenge: Base64URLString;
  excludeCredentials?: PublicKeyCredentialDescriptorJSON[];
  extensions?: AuthenticationExtensionsClientInputsJSON;
  hints?: string[];
  pubKeyCredParams: PublicKeyCredentialParameters[];
  rp: PublicKeyCredentialRpEntity;
  timeout?: number;
  user: PublicKeyCredentialUserEntityJSON;
}

interface PublicKeyCredentialDescriptor {
  id: BufferSource;
  transports?: AuthenticatorTransport[];
  type: PublicKeyCredentialType;
}

interface PublicKeyCredentialDescriptorJSON {
  id: Base64URLString;
  transports?: string[];
  type: string;
}

interface PublicKeyCredentialEntity {
  name: string;
}

interface PublicKeyCredentialParameters {
  alg: COSEAlgorithmIdentifier;
  type: PublicKeyCredentialType;
}

interface PublicKeyCredentialRequestOptions {
  allowCredentials?: PublicKeyCredentialDescriptor[];
  challenge: BufferSource;
  extensions?: AuthenticationExtensionsClientInputs;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
}

interface PublicKeyCredentialRequestOptionsJSON {
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
  challenge: Base64URLString;
  extensions?: AuthenticationExtensionsClientInputsJSON;
  hints?: string[];
  rpId?: string;
  timeout?: number;
  userVerification?: string;
}

interface PublicKeyCredentialRpEntity extends PublicKeyCredentialEntity {
  id?: string;
}

interface PublicKeyCredentialUserEntity extends PublicKeyCredentialEntity {
  displayName: string;
  id: BufferSource;
}

interface PublicKeyCredentialUserEntityJSON {
  displayName: string;
  id: Base64URLString;
  name: string;
}

interface PushSubscriptionJSON {
  endpoint?: string;
  expirationTime?: EpochTimeStamp | null;
  keys?: Record<string, string>;
}

interface PushSubscriptionOptionsInit {
  applicationServerKey?: BufferSource | string | null;
  userVisibleOnly?: boolean;
}

interface QueuingStrategy<T = any> {
  highWaterMark?: number;
  size?: QueuingStrategySize<T>;
}

interface QueuingStrategyInit {
  /**
   * Creates a new ByteLengthQueuingStrategy with the provided high water mark.
   *
   * Note that the provided high water mark will not be validated ahead of time. Instead, if it is negative, NaN, or not a number, the resulting ByteLengthQueuingStrategy will cause the corresponding stream constructor to throw.
   */
  highWaterMark: number;
}

interface RTCAnswerOptions extends RTCOfferAnswerOptions {}

interface RTCConfiguration {
  bundlePolicy?: RTCBundlePolicy;
  certificates?: RTCCertificate[];
  iceCandidatePoolSize?: number;
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  rtcpMuxPolicy?: RTCRtcpMuxPolicy;
}

interface RTCDTMFToneChangeEventInit extends EventInit {
  tone?: string;
}

interface RTCDataChannelEventInit extends EventInit {
  channel: RTCDataChannel;
}

interface RTCDataChannelInit {
  id?: number;
  maxPacketLifeTime?: number;
  maxRetransmits?: number;
  negotiated?: boolean;
  ordered?: boolean;
  protocol?: string;
}

interface RTCDtlsFingerprint {
  algorithm?: string;
  value?: string;
}

interface RTCErrorEventInit extends EventInit {
  error: RTCError;
}

interface RTCErrorInit {
  errorDetail: RTCErrorDetailType;
  httpRequestStatusCode?: number;
  receivedAlert?: number;
  sctpCauseCode?: number;
  sdpLineNumber?: number;
  sentAlert?: number;
}

interface RTCIceCandidateInit {
  candidate?: string;
  sdpMLineIndex?: number | null;
  sdpMid?: string | null;
  usernameFragment?: string | null;
}

interface RTCIceServer {
  credential?: string;
  urls: string | string[];
  username?: string;
}

interface RTCLocalIceCandidateInit extends RTCIceCandidateInit {}

interface RTCLocalSessionDescriptionInit {
  sdp?: string;
  type?: RTCSdpType;
}

interface RTCOfferAnswerOptions {}

interface RTCOfferOptions extends RTCOfferAnswerOptions {
  iceRestart?: boolean;
  offerToReceiveAudio?: boolean;
  offerToReceiveVideo?: boolean;
}

interface RTCPeerConnectionIceErrorEventInit extends EventInit {
  address?: string | null;
  errorCode: number;
  errorText?: string;
  port?: number | null;
  url?: string;
}

interface RTCPeerConnectionIceEventInit extends EventInit {
  candidate?: RTCIceCandidate | null;
}

interface RTCRtcpParameters {
  cname?: string;
  reducedSize?: boolean;
}

interface RTCRtpCapabilities {
  codecs: RTCRtpCodec[];
  headerExtensions: RTCRtpHeaderExtensionCapability[];
}

interface RTCRtpCodec {
  channels?: number;
  clockRate: number;
  mimeType: string;
  sdpFmtpLine?: string;
}

interface RTCRtpCodecParameters extends RTCRtpCodec {
  payloadType: number;
}

interface RTCRtpCodingParameters {
  rid?: string;
}

interface RTCRtpContributingSource {
  audioLevel?: number;
  rtpTimestamp: number;
  source: number;
  timestamp: DOMHighResTimeStamp;
}

interface RTCRtpEncodingParameters extends RTCRtpCodingParameters {
  active?: boolean;
  maxBitrate?: number;
  maxFramerate?: number;
  networkPriority?: RTCPriorityType;
  priority?: RTCPriorityType;
  scaleResolutionDownBy?: number;
}

interface RTCRtpHeaderExtensionCapability {
  uri: string;
}

interface RTCRtpHeaderExtensionParameters {
  encrypted?: boolean;
  id: number;
  uri: string;
}

interface RTCRtpParameters {
  codecs: RTCRtpCodecParameters[];
  headerExtensions: RTCRtpHeaderExtensionParameters[];
  rtcp: RTCRtcpParameters;
}

interface RTCRtpReceiveParameters extends RTCRtpParameters {}

interface RTCRtpSendParameters extends RTCRtpParameters {
  degradationPreference?: RTCDegradationPreference;
  encodings: RTCRtpEncodingParameters[];
  transactionId: string;
}

interface RTCRtpSynchronizationSource extends RTCRtpContributingSource {}

interface RTCRtpTransceiverInit {
  direction?: RTCRtpTransceiverDirection;
  sendEncodings?: RTCRtpEncodingParameters[];
  streams?: MediaStream[];
}

interface RTCSessionDescriptionInit {
  sdp?: string;
  type: RTCSdpType;
}

interface RTCSetParameterOptions {}

interface RTCTrackEventInit extends EventInit {
  receiver: RTCRtpReceiver;
  streams?: MediaStream[];
  track: MediaStreamTrack;
  transceiver: RTCRtpTransceiver;
}

interface ReadableStreamBYOBReaderReadOptions {
  min?: number;
}

interface ReadableStreamGetReaderOptions {
  /**
   * Creates a ReadableStreamBYOBReader and locks the stream to the new reader.
   *
   * This call behaves the same way as the no-argument variant, except that it only works on readable byte streams, i.e. streams which were constructed specifically with the ability to handle "bring your own buffer" reading. The returned BYOB reader provides the ability to directly read individual chunks from the stream via its read() method, into developer-supplied buffers, allowing more precise control over allocation.
   */
  mode?: ReadableStreamReaderMode;
}

interface ReadableStreamIteratorOptions {
  /**
   * Asynchronously iterates over the chunks in the stream's internal queue.
   *
   * Asynchronously iterating over the stream will lock it, preventing any other consumer from acquiring a reader. The lock will be released if the async iterator's return() method is called, e.g. by breaking out of the loop.
   *
   * By default, calling the async iterator's return() method will also cancel the stream. To prevent this, use the stream's values() method, passing true for the preventCancel option.
   */
  preventCancel?: boolean;
}

interface ReadableStreamReadDoneResult<T> {
  done: true;
  value: T | undefined;
}

interface ReadableStreamReadValueResult<T> {
  done: false;
  value: T;
}

interface ReadableWritablePair<R = any, W = any> {
  readable: ReadableStream<R>;
  /**
   * Provides a convenient, chainable way of piping this readable stream through a transform stream (or any other { writable, readable } pair). It simply pipes the stream into the writable side of the supplied pair, and returns the readable side for further use.
   *
   * Piping a stream will lock it for the duration of the pipe, preventing any other consumer from acquiring a reader.
   */
  writable: WritableStream<W>;
}

interface RegistrationResponseJSON {
  authenticatorAttachment?: string;
  clientExtensionResults: AuthenticationExtensionsClientOutputsJSON;
  id: string;
  rawId: Base64URLString;
  response: AuthenticatorAttestationResponseJSON;
  type: string;
}

interface RequestInit {
  /** A BodyInit object or null to set request's body. */
  body?: BodyInit | null;
  /** A string indicating how the request will interact with the browser's cache to set request's cache. */
  cache?: RequestCache;
  /** A string indicating whether credentials will be sent with the request always, never, or only when sent to a same-origin URL. Sets request's credentials. */
  credentials?: RequestCredentials;
  /** A Headers object, an object literal, or an array of two-item arrays to set request's headers. */
  headers?: HeadersInit;
  /** A cryptographic hash of the resource to be fetched by request. Sets request's integrity. */
  integrity?: string;
  /** A boolean to set request's keepalive. */
  keepalive?: boolean;
  /** A string to set request's method. */
  method?: string;
  /** A string to indicate whether the request will use CORS, or will be restricted to same-origin URLs. Sets request's mode. */
  mode?: RequestMode;
  priority?: RequestPriority;
  /** A string indicating whether request follows redirects, results in an error upon encountering a redirect, or returns the redirect (in an opaque fashion). Sets request's redirect. */
  redirect?: RequestRedirect;
  /** A string whose value is a same-origin URL, "about:client", or the empty string, to set request's referrer. */
  referrer?: string;
  /** A referrer policy to set request's referrerPolicy. */
  referrerPolicy?: ReferrerPolicy;
  /** An AbortSignal to set request's signal. */
  signal?: AbortSignal | null;
  /** Can only be null. Used to disassociate request from any Window. */
  window?: null;
}

interface ResponseInit {
  headers?: HeadersInit;
  status?: number;
  statusText?: string;
}

interface RsaHashedImportParams extends Algorithm {
  hash: HashAlgorithmIdentifier;
}

interface RsaHashedKeyGenParams extends RsaKeyGenParams {
  hash: HashAlgorithmIdentifier;
}

interface RsaKeyGenParams extends Algorithm {
  modulusLength: number;
  publicExponent: BigInteger;
}

interface RsaOaepParams extends Algorithm {
  label?: BufferSource;
}

interface RsaOtherPrimesInfo {
  d?: string;
  r?: string;
  t?: string;
}

interface RsaPssParams extends Algorithm {
  saltLength: number;
}

interface SchedulerPostTaskOptions {
  delay?: number;
  priority?: TaskPriority;
  signal?: AbortSignal;
}

interface ShareData {
  files?: File[];
  text?: string;
  title?: string;
  url?: string;
}

interface SpeechSynthesisErrorEventInit extends SpeechSynthesisEventInit {
  error: SpeechSynthesisErrorCode;
}

interface SpeechSynthesisEventInit extends EventInit {
  charIndex?: number;
  charLength?: number;
  elapsedTime?: number;
  name?: string;
  utterance: SpeechSynthesisUtterance;
}

interface StereoPannerOptions extends AudioNodeOptions {
  pan?: number;
}

interface StorageEstimate {
  quota?: number;
  usage?: number;
}

interface StreamPipeOptions {
  preventAbort?: boolean;
  preventCancel?: boolean;
  /**
   * Pipes this readable stream to a given writable stream destination. The way in which the piping process behaves under various error conditions can be customized with a number of passed options. It returns a promise that fulfills when the piping process completes successfully, or rejects if any errors were encountered.
   *
   * Piping a stream will lock it for the duration of the pipe, preventing any other consumer from acquiring a reader.
   *
   * Errors and closures of the source and destination streams propagate as follows:
   *
   * An error in this source readable stream will abort destination, unless preventAbort is truthy. The returned promise will be rejected with the source's error, or with any error that occurs during aborting the destination.
   *
   * An error in destination will cancel this source readable stream, unless preventCancel is truthy. The returned promise will be rejected with the destination's error, or with any error that occurs during canceling the source.
   *
   * When this source readable stream closes, destination will be closed, unless preventClose is truthy. The returned promise will be fulfilled once this process completes, unless an error is encountered while closing the destination, in which case it will be rejected with that error.
   *
   * If destination starts out closed or closing, this source readable stream will be canceled, unless preventCancel is true. The returned promise will be rejected with an error indicating piping to a closed stream failed, or with any error that occurs during canceling the source.
   *
   * The signal option can be set to an AbortSignal to allow aborting an ongoing pipe operation via the corresponding AbortController. In this case, this source readable stream will be canceled, and destination aborted, unless the respective options preventCancel or preventAbort are set.
   */
  preventClose?: boolean;
  signal?: AbortSignal;
}

interface StructuredSerializeOptions {
  transfer?: Transferable[];
}

interface SvcOutputMetadata {
  temporalLayerId?: number;
}

interface TextDecodeOptions {
  stream?: boolean;
}

interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

interface TextEncoderEncodeIntoResult {
  read: number;
  written: number;
}

interface Transformer<I = any, O = any> {
  flush?: TransformerFlushCallback<O>;
  readableType?: undefined;
  start?: TransformerStartCallback<O>;
  transform?: TransformerTransformCallback<I, O>;
  writableType?: undefined;
}

interface ULongRange {
  max?: number;
  min?: number;
}

interface URLPatternComponentResult {
  groups: Record<string, string | undefined>;
  input: string;
}

interface URLPatternInit {
  baseURL?: string;
  hash?: string;
  hostname?: string;
  password?: string;
  pathname?: string;
  port?: string;
  protocol?: string;
  search?: string;
  username?: string;
}

interface URLPatternOptions {
  ignoreCase?: boolean;
}

interface URLPatternResult {
  hash: URLPatternComponentResult;
  hostname: URLPatternComponentResult;
  inputs: URLPatternInput[];
  password: URLPatternComponentResult;
  pathname: URLPatternComponentResult;
  port: URLPatternComponentResult;
  protocol: URLPatternComponentResult;
  search: URLPatternComponentResult;
  username: URLPatternComponentResult;
}

interface UnderlyingByteSource {
  autoAllocateChunkSize?: number;
  cancel?: UnderlyingSourceCancelCallback;
  pull?: (controller: ReadableByteStreamController) => void | PromiseLike<void>;
  start?: (controller: ReadableByteStreamController) => any;
  type: "bytes";
}

interface UnderlyingDefaultSource<R = any> {
  cancel?: UnderlyingSourceCancelCallback;
  pull?: (controller: ReadableStreamDefaultController<R>) => void | PromiseLike<void>;
  start?: (controller: ReadableStreamDefaultController<R>) => any;
  type?: undefined;
}

interface UnderlyingSink<W = any> {
  abort?: UnderlyingSinkAbortCallback;
  close?: UnderlyingSinkCloseCallback;
  start?: UnderlyingSinkStartCallback;
  type?: undefined;
  write?: UnderlyingSinkWriteCallback<W>;
}

interface UnderlyingSource<R = any> {
  autoAllocateChunkSize?: number;
  cancel?: UnderlyingSourceCancelCallback;
  pull?: UnderlyingSourcePullCallback<R>;
  start?: UnderlyingSourceStartCallback<R>;
  type?: ReadableStreamType;
}

interface UnknownCredentialOptions {
  credentialId: Base64URLString;
  rpId: string;
}

interface VideoColorSpaceInit {
  fullRange?: boolean | null;
  matrix?: VideoMatrixCoefficients | null;
  primaries?: VideoColorPrimaries | null;
  transfer?: VideoTransferCharacteristics | null;
}

interface VideoDecoderConfig {
  codec: string;
  codedHeight?: number;
  codedWidth?: number;
  colorSpace?: VideoColorSpaceInit;
  description?: AllowSharedBufferSource;
  displayAspectHeight?: number;
  displayAspectWidth?: number;
  hardwareAcceleration?: HardwareAcceleration;
  optimizeForLatency?: boolean;
}

interface VideoDecoderInit {
  error: WebCodecsErrorCallback;
  output: VideoFrameOutputCallback;
}

interface VideoDecoderSupport {
  config?: VideoDecoderConfig;
  supported?: boolean;
}

interface VideoEncoderConfig {
  alpha?: AlphaOption;
  avc?: AvcEncoderConfig;
  bitrate?: number;
  bitrateMode?: VideoEncoderBitrateMode;
  codec: string;
  contentHint?: string;
  displayHeight?: number;
  displayWidth?: number;
  framerate?: number;
  hardwareAcceleration?: HardwareAcceleration;
  height: number;
  latencyMode?: LatencyMode;
  scalabilityMode?: string;
  width: number;
}

interface VideoEncoderEncodeOptions {
  avc?: VideoEncoderEncodeOptionsForAvc;
  keyFrame?: boolean;
}

interface VideoEncoderEncodeOptionsForAvc {
  quantizer?: number | null;
}

interface VideoEncoderInit {
  error: WebCodecsErrorCallback;
  output: EncodedVideoChunkOutputCallback;
}

interface VideoEncoderSupport {
  config?: VideoEncoderConfig;
  supported?: boolean;
}

interface VideoFrameBufferInit {
  codedHeight: number;
  codedWidth: number;
  colorSpace?: VideoColorSpaceInit;
  displayHeight?: number;
  displayWidth?: number;
  duration?: number;
  format: VideoPixelFormat;
  layout?: PlaneLayout[];
  timestamp: number;
  visibleRect?: DOMRectInit;
}

interface VideoFrameCopyToOptions {
  colorSpace?: PredefinedColorSpace;
  format?: VideoPixelFormat;
  layout?: PlaneLayout[];
  rect?: DOMRectInit;
}

interface VideoFrameInit {
  alpha?: AlphaOption;
  displayHeight?: number;
  displayWidth?: number;
  duration?: number;
  timestamp?: number;
  visibleRect?: DOMRectInit;
}

interface WaveShaperOptions extends AudioNodeOptions {
  curve?: number[] | Float32Array;
  oversample?: OverSampleType;
}

interface WorkerOptions {
  credentials?: RequestCredentials;
  name?: string;
  type?: WorkerType;
}

interface WorkletOptions {
  credentials?: RequestCredentials;
}

interface WriteParams {
  data?: BufferSource | Blob | string | null;
  position?: number | null;
  size?: number | null;
  type: WriteCommandType;
}

/**
 * The **`AbortController`** interface represents a controller object that allows you to abort one or more Web requests as and when desired.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortController)
 */
interface AbortController {
  /**
   * The **`signal`** read-only property of the AbortController interface returns an AbortSignal object instance, which can be used to communicate with/abort an asynchronous operation as desired.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortController/signal)
   */
  readonly signal: AbortSignal;
  /**
   * The **`abort()`** method of the AbortController interface aborts an asynchronous operation before it has completed. This is able to abort fetch requests, the consumption of any response bodies, or streams.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortController/abort)
   */
  abort(reason?: any): void;
}

declare var AbortController: {
  prototype: AbortController;
  new (): AbortController;
};

interface AbortSignalEventMap {
  abort: Event;
}

/**
 * The **`AbortSignal`** interface represents a signal object that allows you to communicate with an asynchronous operation (such as a fetch request) and abort it if required via an AbortController object.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal)
 */
interface AbortSignal extends EventTarget {
  /**
   * The **`aborted`** read-only property returns a value that indicates whether the asynchronous operations the signal is communicating with are aborted (true) or not (false).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/aborted)
   */
  readonly aborted: boolean;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/abort_event) */
  onabort: ((this: AbortSignal, ev: Event) => any) | null;
  /**
   * The **`reason`** read-only property returns a JavaScript value that indicates the abort reason.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/reason)
   */
  readonly reason: any;
  /**
   * The **`throwIfAborted()`** method throws the signal's abort reason if the signal has been aborted; otherwise it does nothing.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/throwIfAborted)
   */
  throwIfAborted(): void;
  addEventListener<K extends keyof AbortSignalEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: AbortSignalEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof AbortSignalEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: AbortSignalEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var AbortSignal: {
  prototype: AbortSignal;
  new (): AbortSignal;
  /**
   * The **`AbortSignal.abort()`** static method returns an AbortSignal that is already set as aborted (and which does not trigger an abort event).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/abort_static)
   */
  abort(reason?: any): AbortSignal;
  /**
   * The **`AbortSignal.any()`** static method takes an iterable of abort signals and returns an AbortSignal. The returned abort signal is aborted when any of the input iterable abort signals are aborted. The abort reason will be set to the reason of the first signal that is aborted. If any of the given abort signals are already aborted then so will be the returned AbortSignal.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/any_static)
   */
  any(signals: AbortSignal[]): AbortSignal;
  /**
   * The **`AbortSignal.timeout()`** static method returns an AbortSignal that will automatically abort after a specified time.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/timeout_static)
   */
  timeout(milliseconds: number): AbortSignal;
};

interface AbstractWorkerEventMap {
  error: ErrorEvent;
}

interface AbstractWorker {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ServiceWorker/error_event) */
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null;
  addEventListener<K extends keyof AbstractWorkerEventMap>(
    type: K,
    listener: (this: AbstractWorker, ev: AbstractWorkerEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof AbstractWorkerEventMap>(
    type: K,
    listener: (this: AbstractWorker, ev: AbstractWorkerEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

/**
 * The **`AnalyserNode`** interface represents a node able to provide real-time frequency and time-domain analysis information. It is an AudioNode that passes the audio stream unchanged from the input to the output, but allows you to take the generated data, process it, and create audio visualizations.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AnalyserNode)
 */
interface AnalyserNode extends AudioNode {
  /**
   * The **`fftSize`** property of the AnalyserNode interface is an unsigned long value and represents the window size in samples that is used when performing a Fast Fourier Transform (FFT) to get frequency domain data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AnalyserNode/fftSize)
   */
  fftSize: number;
  /**
   * The **`frequencyBinCount`** read-only property of the AnalyserNode interface contains the total number of data points available to AudioContext sampleRate. This is half of the value of the AnalyserNode.fftSize. The two methods' indices have a linear relationship with the frequencies they represent, between 0 and the Nyquist frequency.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AnalyserNode/frequencyBinCount)
   */
  readonly frequencyBinCount: number;
  /**
   * The **`maxDecibels`** property of the AnalyserNode interface is a double value representing the maximum power value in the scaling range for the FFT analysis data, for conversion to unsigned byte values — basically, this specifies the maximum value for the range of results when using getByteFrequencyData().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AnalyserNode/maxDecibels)
   */
  maxDecibels: number;
  /**
   * The **`minDecibels`** property of the AnalyserNode interface is a double value representing the minimum power value in the scaling range for the FFT analysis data, for conversion to unsigned byte values — basically, this specifies the minimum value for the range of results when using getByteFrequencyData().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AnalyserNode/minDecibels)
   */
  minDecibels: number;
  /**
   * The **`smoothingTimeConstant`** property of the AnalyserNode interface is a double value representing the averaging constant with the last analysis frame. It's basically an average between the current buffer and the last buffer the AnalyserNode processed, and results in a much smoother set of value changes over time.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AnalyserNode/smoothingTimeConstant)
   */
  smoothingTimeConstant: number;
  /**
   * The **`getByteFrequencyData()`** method of the AnalyserNode interface copies the current frequency data into a Uint8Array (unsigned byte array) passed into it.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AnalyserNode/getByteFrequencyData)
   */
  getByteFrequencyData(array: Uint8Array<ArrayBuffer>): void;
  /**
   * The **`getByteTimeDomainData()`** method of the AnalyserNode Interface copies the current waveform, or time-domain, data into a Uint8Array (unsigned byte array) passed into it.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AnalyserNode/getByteTimeDomainData)
   */
  getByteTimeDomainData(array: Uint8Array<ArrayBuffer>): void;
  /**
   * The **`getFloatFrequencyData()`** method of the AnalyserNode Interface copies the current frequency data into a Float32Array array passed into it.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AnalyserNode/getFloatFrequencyData)
   */
  getFloatFrequencyData(array: Float32Array<ArrayBuffer>): void;
  /**
   * The **`getFloatTimeDomainData()`** method of the AnalyserNode Interface copies the current waveform, or time-domain, data into a Float32Array array passed into it. Each array value is a sample, the magnitude of the signal at a particular time.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AnalyserNode/getFloatTimeDomainData)
   */
  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void;
}

declare var AnalyserNode: {
  prototype: AnalyserNode;
  new (context: BaseAudioContext, options?: AnalyserOptions): AnalyserNode;
};

/**
 * The **`AudioBuffer`** interface represents a short audio asset residing in memory, created from an audio file using the AudioContext.decodeAudioData() method, or from raw data using AudioContext.createBuffer(). Once put into an AudioBuffer, the audio can then be played by being passed into an AudioBufferSourceNode.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBuffer)
 */
interface AudioBuffer {
  /**
   * The **`duration`** property of the AudioBuffer interface returns a double representing the duration, in seconds, of the PCM data stored in the buffer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBuffer/duration)
   */
  readonly duration: number;
  /**
   * The **`length`** property of the AudioBuffer interface returns an integer representing the length, in sample-frames, of the PCM data stored in the buffer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBuffer/length)
   */
  readonly length: number;
  /**
   * The **`numberOfChannels`** property of the AudioBuffer interface returns an integer representing the number of discrete audio channels described by the PCM data stored in the buffer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBuffer/numberOfChannels)
   */
  readonly numberOfChannels: number;
  /**
   * The **`sampleRate`** property of the AudioBuffer interface returns a float representing the sample rate, in samples per second, of the PCM data stored in the buffer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBuffer/sampleRate)
   */
  readonly sampleRate: number;
  /**
   * The **`copyFromChannel()`** method of the AudioBuffer interface copies the audio sample data from the specified channel of the AudioBuffer to a specified Float32Array.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBuffer/copyFromChannel)
   */
  copyFromChannel(
    destination: Float32Array<ArrayBuffer>,
    channelNumber: number,
    bufferOffset?: number,
  ): void;
  /**
   * The **`copyToChannel()`** method of the AudioBuffer interface copies the samples to the specified channel of the AudioBuffer, from the source array.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBuffer/copyToChannel)
   */
  copyToChannel(
    source: Float32Array<ArrayBuffer>,
    channelNumber: number,
    bufferOffset?: number,
  ): void;
  /**
   * The **`getChannelData()`** method of the AudioBuffer Interface returns a Float32Array containing the PCM data associated with the channel, defined by the channel parameter (with 0 representing the first channel).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBuffer/getChannelData)
   */
  getChannelData(channel: number): Float32Array<ArrayBuffer>;
}

declare var AudioBuffer: {
  prototype: AudioBuffer;
  new (options: AudioBufferOptions): AudioBuffer;
};

/**
 * The **`AudioBufferSourceNode`** interface is an AudioScheduledSourceNode which represents an audio source consisting of in-memory audio data, stored in an AudioBuffer.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBufferSourceNode)
 */
interface AudioBufferSourceNode extends AudioScheduledSourceNode {
  /**
   * The **`buffer`** property of the AudioBufferSourceNode interface provides the ability to play back audio using an AudioBuffer as the source of the sound data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBufferSourceNode/buffer)
   */
  buffer: AudioBuffer | null;
  /**
   * The **`detune`** property of the AudioBufferSourceNode interface is a k-rate AudioParam representing detuning of oscillation in cents.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBufferSourceNode/detune)
   */
  readonly detune: AudioParam;
  /**
   * The **`loop`** property of the AudioBufferSourceNode interface is a Boolean indicating if the audio asset must be replayed when the end of the AudioBuffer is reached.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBufferSourceNode/loop)
   */
  loop: boolean;
  /**
   * The **`loopEnd`** property of the AudioBufferSourceNode interface specifies is a floating point number specifying, in seconds, at what offset into playing the AudioBuffer playback should loop back to the time indicated by the loopStart property. This is only used if the loop property is true.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBufferSourceNode/loopEnd)
   */
  loopEnd: number;
  /**
   * The **`loopStart`** property of the AudioBufferSourceNode interface is a floating-point value indicating, in seconds, where in the AudioBuffer the restart of the play must happen.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBufferSourceNode/loopStart)
   */
  loopStart: number;
  /**
   * The **`playbackRate`** property of the AudioBufferSourceNode interface Is a k-rate AudioParam that defines the speed at which the audio asset will be played.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBufferSourceNode/playbackRate)
   */
  readonly playbackRate: AudioParam;
  /**
   * The **`start()`** method of the AudioBufferSourceNode Interface is used to schedule playback of the audio data contained in the buffer, or to begin playback immediately.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioBufferSourceNode/start)
   */
  start(when?: number, offset?: number, duration?: number): void;
  addEventListener<K extends keyof AudioScheduledSourceNodeEventMap>(
    type: K,
    listener: (this: AudioBufferSourceNode, ev: AudioScheduledSourceNodeEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof AudioScheduledSourceNodeEventMap>(
    type: K,
    listener: (this: AudioBufferSourceNode, ev: AudioScheduledSourceNodeEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var AudioBufferSourceNode: {
  prototype: AudioBufferSourceNode;
  new (context: BaseAudioContext, options?: AudioBufferSourceOptions): AudioBufferSourceNode;
};

/**
 * The **`AudioContext`** interface represents an audio-processing graph built from audio modules linked together, each represented by an AudioNode.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioContext)
 */
interface AudioContext extends BaseAudioContext {
  /**
   * The **`baseLatency`** read-only property of the AudioContext interface returns a double that represents the number of seconds of processing latency incurred by the AudioContext passing an audio buffer from the AudioDestinationNode — i.e., the end of the audio graph — into the host system's audio subsystem ready for playing.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioContext/baseLatency)
   */
  readonly baseLatency: number;
  /**
   * The **`outputLatency`** read-only property of the AudioContext Interface provides an estimation of the output latency of the current audio context.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioContext/outputLatency)
   */
  readonly outputLatency: number;
  /**
   * The **`close()`** method of the AudioContext Interface closes the audio context, releasing any system audio resources that it uses.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioContext/close)
   */
  close(): Promise<void>;
  /**
   * The **`createMediaElementSource()`** method of the AudioContext Interface is used to create a new MediaElementAudioSourceNode object, given an existing HTML <audio> or <video> element, the audio from which can then be played and manipulated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioContext/createMediaElementSource)
   */

  /**
   * The **`createMediaStreamDestination()`** method of the AudioContext Interface is used to create a new MediaStreamAudioDestinationNode object associated with a WebRTC MediaStream representing an audio stream, which may be stored in a local file or sent to another computer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioContext/createMediaStreamDestination)
   */
  createMediaStreamDestination(): MediaStreamAudioDestinationNode;
  /**
   * The **`createMediaStreamSource()`** method of the AudioContext Interface is used to create a new MediaStreamAudioSourceNode object, given a media stream (say, from a MediaDevices.getUserMedia instance), the audio from which can then be played and manipulated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioContext/createMediaStreamSource)
   */
  createMediaStreamSource(mediaStream: MediaStream): MediaStreamAudioSourceNode;
  /**
   * The **`getOutputTimestamp()`** method of the AudioContext interface returns a new AudioTimestamp object containing two audio timestamp values relating to the current audio context.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioContext/getOutputTimestamp)
   */
  getOutputTimestamp(): AudioTimestamp;
  /**
   * The **`resume()`** method of the AudioContext interface resumes the progression of time in an audio context that has previously been suspended.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioContext/resume)
   */
  resume(): Promise<void>;
  /**
   * The **`suspend()`** method of the AudioContext Interface suspends the progression of time in the audio context, temporarily halting audio hardware access and reducing CPU/battery usage in the process — this is useful if you want an application to power down the audio hardware when it will not be using an audio context for a while.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioContext/suspend)
   */
  suspend(): Promise<void>;
  addEventListener<K extends keyof BaseAudioContextEventMap>(
    type: K,
    listener: (this: AudioContext, ev: BaseAudioContextEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof BaseAudioContextEventMap>(
    type: K,
    listener: (this: AudioContext, ev: BaseAudioContextEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var AudioContext: {
  prototype: AudioContext;
  new (contextOptions?: AudioContextOptions): AudioContext;
};

/**
 * The **`AudioData`** interface of the WebCodecs API represents an audio sample.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioData)
 */
interface AudioData {
  /**
   * The **`duration`** read-only property of the AudioData interface returns the duration in microseconds of this AudioData object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioData/duration)
   */
  readonly duration: number;
  /**
   * The **`format`** read-only property of the AudioData interface returns the sample format of the AudioData object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioData/format)
   */
  readonly format: AudioSampleFormat | null;
  /**
   * The **`numberOfChannels`** read-only property of the AudioData interface returns the number of channels in the AudioData object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioData/numberOfChannels)
   */
  readonly numberOfChannels: number;
  /**
   * The **`numberOfFrames`** read-only property of the AudioData interface returns the number of frames in the AudioData object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioData/numberOfFrames)
   */
  readonly numberOfFrames: number;
  /**
   * The **`sampleRate`** read-only property of the AudioData interface returns the sample rate in Hz.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioData/sampleRate)
   */
  readonly sampleRate: number;
  /**
   * The **`timestamp`** read-only property of the AudioData interface returns the timestamp of this AudioData object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioData/timestamp)
   */
  readonly timestamp: number;
  /**
   * The **`allocationSize()`** method of the AudioData interface returns the size in bytes required to hold the current sample as filtered by options passed into the method.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioData/allocationSize)
   */
  allocationSize(options: AudioDataCopyToOptions): number;
  /**
   * The **`clone()`** method of the AudioData interface creates a new AudioData object with reference to the same media resource as the original.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioData/clone)
   */
  clone(): AudioData;
  /**
   * The **`close()`** method of the AudioData interface clears all states and releases the reference to the media resource.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioData/close)
   */
  close(): void;
  /**
   * The **`copyTo()`** method of the AudioData interface copies a plane of an AudioData object to a destination buffer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioData/copyTo)
   */
  copyTo(destination: AllowSharedBufferSource, options: AudioDataCopyToOptions): void;
}

declare var AudioData: {
  prototype: AudioData;
  new (init: AudioDataInit): AudioData;
};

interface AudioDecoderEventMap {
  dequeue: Event;
}

/**
 * The **`AudioDecoder`** interface of the WebCodecs API decodes chunks of audio.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDecoder)
 */
interface AudioDecoder extends EventTarget {
  /**
   * The **`decodeQueueSize`** read-only property of the AudioDecoder interface returns the number of pending decode requests in the queue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDecoder/decodeQueueSize)
   */
  readonly decodeQueueSize: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDecoder/dequeue_event) */
  ondequeue: ((this: AudioDecoder, ev: Event) => any) | null;
  /**
   * The **`state`** read-only property of the AudioDecoder interface returns the current state of the underlying codec.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDecoder/state)
   */
  readonly state: CodecState;
  /**
   * The **`close()`** method of the AudioDecoder interface ends all pending work and releases system resources.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDecoder/close)
   */
  close(): void;
  /**
   * The **`configure()`** method of the AudioDecoder interface enqueues a control message to configure the audio decoder for decoding chunks.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDecoder/configure)
   */
  configure(config: AudioDecoderConfig): void;
  /**
   * The **`decode()`** method of the AudioDecoder interface enqueues a control message to decode a given chunk of audio.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDecoder/decode)
   */
  decode(chunk: EncodedAudioChunk): void;
  /**
   * The **`flush()`** method of the AudioDecoder interface returns a Promise that resolves once all pending messages in the queue have been completed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDecoder/flush)
   */
  flush(): Promise<void>;
  /**
   * The **`reset()`** method of the AudioDecoder interface resets all states including configuration, control messages in the control message queue, and all pending callbacks.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDecoder/reset)
   */
  reset(): void;
  addEventListener<K extends keyof AudioDecoderEventMap>(
    type: K,
    listener: (this: AudioDecoder, ev: AudioDecoderEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof AudioDecoderEventMap>(
    type: K,
    listener: (this: AudioDecoder, ev: AudioDecoderEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var AudioDecoder: {
  prototype: AudioDecoder;
  new (init: AudioDecoderInit): AudioDecoder;
  /**
   * The **`isConfigSupported()`** static method of the AudioDecoder interface checks if the given config is supported (that is, if AudioDecoder objects can be successfully configured with the given config).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDecoder/isConfigSupported_static)
   */
  isConfigSupported(config: AudioDecoderConfig): Promise<AudioDecoderSupport>;
};

/**
 * The **`AudioDestinationNode`** interface represents the end destination of an audio graph in a given context — usually the speakers of your device. It can also be the node that will "record" the audio data when used with an OfflineAudioContext.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDestinationNode)
 */
interface AudioDestinationNode extends AudioNode {
  /**
   * The **`maxChannelCount`** property of the AudioDestinationNode interface is an unsigned long defining the maximum amount of channels that the physical device can handle.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioDestinationNode/maxChannelCount)
   */
  readonly maxChannelCount: number;
}

declare var AudioDestinationNode: {
  prototype: AudioDestinationNode;
  new (): AudioDestinationNode;
};

interface AudioEncoderEventMap {
  dequeue: Event;
}

/**
 * The **`AudioEncoder`** interface of the WebCodecs API encodes AudioData objects.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioEncoder)
 */
interface AudioEncoder extends EventTarget {
  /**
   * The **`encodeQueueSize`** read-only property of the AudioEncoder interface returns the number of pending encode requests in the queue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioEncoder/encodeQueueSize)
   */
  readonly encodeQueueSize: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioEncoder/dequeue_event) */
  ondequeue: ((this: AudioEncoder, ev: Event) => any) | null;
  /**
   * The **`state`** read-only property of the AudioEncoder interface returns the current state of the underlying codec.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioEncoder/state)
   */
  readonly state: CodecState;
  /**
   * The **`close()`** method of the AudioEncoder interface ends all pending work and releases system resources.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioEncoder/close)
   */
  close(): void;
  /**
   * The **`configure()`** method of the AudioEncoder interface enqueues a control message to configure the audio encoder for encoding chunks.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioEncoder/configure)
   */
  configure(config: AudioEncoderConfig): void;
  /**
   * The **`encode()`** method of the AudioEncoder interface enqueues a control message to encode a given AudioData object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioEncoder/encode)
   */
  encode(data: AudioData): void;
  /**
   * The **`flush()`** method of the AudioEncoder interface returns a Promise that resolves once all pending messages in the queue have been completed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioEncoder/flush)
   */
  flush(): Promise<void>;
  /**
   * The **`reset()`** method of the AudioEncoder interface resets all states including configuration, control messages in the control message queue, and all pending callbacks.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioEncoder/reset)
   */
  reset(): void;
  addEventListener<K extends keyof AudioEncoderEventMap>(
    type: K,
    listener: (this: AudioEncoder, ev: AudioEncoderEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof AudioEncoderEventMap>(
    type: K,
    listener: (this: AudioEncoder, ev: AudioEncoderEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var AudioEncoder: {
  prototype: AudioEncoder;
  new (init: AudioEncoderInit): AudioEncoder;
  /**
   * The **`isConfigSupported()`** static method of the AudioEncoder interface checks if the given config is supported (that is, if AudioEncoder objects can be successfully configured with the given config).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioEncoder/isConfigSupported_static)
   */
  isConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport>;
};

/**
 * The **`AudioListener`** interface represents the position and orientation of the unique person listening to the audio scene, and is used in audio spatialization. All PannerNodes spatialize in relation to the AudioListener stored in the BaseAudioContext.listener attribute.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener)
 */
interface AudioListener {
  /**
   * The **`forwardX`** read-only property of the AudioListener interface is an AudioParam representing the x value of the direction vector defining the forward direction the listener is pointing in.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener/forwardX)
   */
  readonly forwardX: AudioParam;
  /**
   * The **`forwardY`** read-only property of the AudioListener interface is an AudioParam representing the y value of the direction vector defining the forward direction the listener is pointing in.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener/forwardY)
   */
  readonly forwardY: AudioParam;
  /**
   * The **`forwardZ`** read-only property of the AudioListener interface is an AudioParam representing the z value of the direction vector defining the forward direction the listener is pointing in.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener/forwardZ)
   */
  readonly forwardZ: AudioParam;
  /**
   * The **`positionX`** read-only property of the AudioListener interface is an AudioParam representing the x position of the listener in 3D cartesian space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener/positionX)
   */
  readonly positionX: AudioParam;
  /**
   * The **`positionY`** read-only property of the AudioListener interface is an AudioParam representing the y position of the listener in 3D cartesian space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener/positionY)
   */
  readonly positionY: AudioParam;
  /**
   * The **`positionZ`** read-only property of the AudioListener interface is an AudioParam representing the z position of the listener in 3D cartesian space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener/positionZ)
   */
  readonly positionZ: AudioParam;
  /**
   * The **`upX`** read-only property of the AudioListener interface is an AudioParam representing the x value of the direction vector defining the up direction the listener is pointing in.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener/upX)
   */
  readonly upX: AudioParam;
  /**
   * The **`upY`** read-only property of the AudioListener interface is an AudioParam representing the y value of the direction vector defining the up direction the listener is pointing in.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener/upY)
   */
  readonly upY: AudioParam;
  /**
   * The **`upZ`** read-only property of the AudioListener interface is an AudioParam representing the z value of the direction vector defining the up direction the listener is pointing in.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener/upZ)
   */
  readonly upZ: AudioParam;
  /**
   * The **`setOrientation()`** method of the AudioListener interface defines the orientation of the listener.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener/setOrientation)
   */
  setOrientation(x: number, y: number, z: number, xUp: number, yUp: number, zUp: number): void;
  /**
   * The **`setPosition()`** method of the AudioListener Interface defines the position of the listener.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioListener/setPosition)
   */
  setPosition(x: number, y: number, z: number): void;
}

declare var AudioListener: {
  prototype: AudioListener;
  new (): AudioListener;
};

/**
 * The **`AudioNode`** interface is a generic interface for representing an audio processing module.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioNode)
 */
interface AudioNode extends EventTarget {
  /**
   * The **`channelCount`** property of the AudioNode interface represents an integer used to determine how many channels are used when up-mixing and down-mixing connections to any inputs to the node.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioNode/channelCount)
   */
  channelCount: number;
  /**
   * The **`channelCountMode`** property of the AudioNode interface represents an enumerated value describing the way channels must be matched between the node's inputs and outputs.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioNode/channelCountMode)
   */
  channelCountMode: ChannelCountMode;
  /**
   * The **`channelInterpretation`** property of the AudioNode interface represents an enumerated value describing how input channels are mapped to output channels when the number of inputs/outputs is different. For example, this setting defines how a mono input will be up-mixed to a stereo or 5.1 channel output, or how a quad channel input will be down-mixed to a stereo or mono output.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioNode/channelInterpretation)
   */
  channelInterpretation: ChannelInterpretation;
  /**
   * The read-only **`context`** property of the AudioNode interface returns the associated BaseAudioContext, that is the object representing the processing graph the node is participating in.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioNode/context)
   */
  readonly context: BaseAudioContext;
  /**
   * The **`numberOfInputs`** property of the AudioNode interface returns the number of inputs feeding the node. Source nodes are defined as nodes having a numberOfInputs property with a value of 0.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioNode/numberOfInputs)
   */
  readonly numberOfInputs: number;
  /**
   * The **`numberOfOutputs`** property of the AudioNode interface returns the number of outputs coming out of the node. Destination nodes — like AudioDestinationNode — have a value of 0 for this attribute.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioNode/numberOfOutputs)
   */
  readonly numberOfOutputs: number;
  /**
   * The **`connect()`** method of the AudioNode interface lets you connect one of the node's outputs to a target, which may be either another AudioNode (thereby directing the sound data to the specified node) or an AudioParam, so that the node's output data is automatically used to change the value of that parameter over time.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioNode/connect)
   */
  connect(destinationNode: AudioNode, output?: number, input?: number): AudioNode;
  connect(destinationParam: AudioParam, output?: number): void;
  /**
   * The **`disconnect()`** method of the AudioNode interface lets you disconnect one or more nodes from the node on which the method is called.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioNode/disconnect)
   */
  disconnect(): void;
  disconnect(output: number): void;
  disconnect(destinationNode: AudioNode): void;
  disconnect(destinationNode: AudioNode, output: number): void;
  disconnect(destinationNode: AudioNode, output: number, input: number): void;
  disconnect(destinationParam: AudioParam): void;
  disconnect(destinationParam: AudioParam, output: number): void;
}

declare var AudioNode: {
  prototype: AudioNode;
  new (): AudioNode;
};

/**
 * The Web Audio API's **`AudioParam`** interface represents an audio-related parameter, usually a parameter of an AudioNode (such as GainNode.gain).
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam)
 */
interface AudioParam {
  automationRate: AutomationRate;
  /**
   * The **`defaultValue`** read-only property of the AudioParam interface represents the initial value of the attributes as defined by the specific AudioNode creating the AudioParam.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/defaultValue)
   */
  readonly defaultValue: number;
  /**
   * The **`maxValue`** read-only property of the AudioParam interface represents the maximum possible value for the parameter's nominal (effective) range.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/maxValue)
   */
  readonly maxValue: number;
  /**
   * The **`minValue`** read-only property of the AudioParam interface represents the minimum possible value for the parameter's nominal (effective) range.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/minValue)
   */
  readonly minValue: number;
  /**
   * The **`value`** property of the AudioParam interface gets or sets the value of this AudioParam at the current time. Initially, the value is set to AudioParam.defaultValue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/value)
   */
  value: number;
  /**
   * The **`cancelAndHoldAtTime()`** method of the AudioParam interface cancels all scheduled future changes to the AudioParam but holds its value at a given time until further changes are made using other methods.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/cancelAndHoldAtTime)
   */
  cancelAndHoldAtTime(cancelTime: number): AudioParam;
  /**
   * The **`cancelScheduledValues()`** method of the AudioParam Interface cancels all scheduled future changes to the AudioParam.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/cancelScheduledValues)
   */
  cancelScheduledValues(cancelTime: number): AudioParam;
  /**
   * The **`exponentialRampToValueAtTime()`** method of the AudioParam Interface schedules a gradual exponential change in the value of the AudioParam. The change starts at the time specified for the previous event, follows an exponential ramp to the new value given in the value parameter, and reaches the new value at the time given in the endTime parameter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/exponentialRampToValueAtTime)
   */
  exponentialRampToValueAtTime(value: number, endTime: number): AudioParam;
  /**
   * The **`linearRampToValueAtTime()`** method of the AudioParam Interface schedules a gradual linear change in the value of the AudioParam. The change starts at the time specified for the previous event, follows a linear ramp to the new value given in the value parameter, and reaches the new value at the time given in the endTime parameter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/linearRampToValueAtTime)
   */
  linearRampToValueAtTime(value: number, endTime: number): AudioParam;
  /**
   * The **`setTargetAtTime()`** method of the AudioParam interface schedules the start of a gradual change to the AudioParam value. This is useful for decay or release portions of ADSR envelopes.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/setTargetAtTime)
   */
  setTargetAtTime(target: number, startTime: number, timeConstant: number): AudioParam;
  /**
   * The **`setValueAtTime()`** method of the AudioParam interface schedules an instant change to the AudioParam value at a precise time, as measured against AudioContext.currentTime. The new value is given in the value parameter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/setValueAtTime)
   */
  setValueAtTime(value: number, startTime: number): AudioParam;
  /**
   * The **`setValueCurveAtTime()`** method of the AudioParam interface schedules the parameter's value to change following a curve defined by a list of values.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/setValueCurveAtTime)
   */
  setValueCurveAtTime(
    values: number[] | Float32Array,
    startTime: number,
    duration: number,
  ): AudioParam;
}

declare var AudioParam: {
  prototype: AudioParam;
  new (): AudioParam;
};

interface AudioParam {
  /**
   * The **`setValueCurveAtTime()`** method of the AudioParam interface schedules the parameter's value to change following a curve defined by a list of values.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioParam/setValueCurveAtTime)
   */
  setValueCurveAtTime(values: Iterable<number>, startTime: number, duration: number): AudioParam;
}

/**
 * The **`AudioProcessingEvent`** interface of the Web Audio API represents events that occur when a ScriptProcessorNode input buffer is ready to be processed.
 * @deprecated As of the August 29 2014 Web Audio API spec publication, this feature has been marked as deprecated, and is soon to be replaced by AudioWorklet.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioProcessingEvent)
 */
interface AudioProcessingEvent extends Event {
  /**
   * The **`inputBuffer`** read-only property of the AudioProcessingEvent interface represents the input buffer of an audio processing event.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioProcessingEvent/inputBuffer)
   */
  readonly inputBuffer: AudioBuffer;
  /**
   * The **`outputBuffer`** read-only property of the AudioProcessingEvent interface represents the output buffer of an audio processing event.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioProcessingEvent/outputBuffer)
   */
  readonly outputBuffer: AudioBuffer;
  /**
   * The **`playbackTime`** read-only property of the AudioProcessingEvent interface represents the time when the audio will be played. It is in the same coordinate system as the time used by the AudioContext.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioProcessingEvent/playbackTime)
   */
  readonly playbackTime: number;
}

/** @deprecated */
declare var AudioProcessingEvent: {
  prototype: AudioProcessingEvent;
  new (type: string, eventInitDict: AudioProcessingEventInit): AudioProcessingEvent;
};

interface AudioScheduledSourceNodeEventMap {
  ended: Event;
}

/**
 * The **`AudioScheduledSourceNode`** interface—part of the Web Audio API—is a parent interface for several types of audio source node interfaces which share the ability to be started and stopped, optionally at specified times. Specifically, this interface defines the start() and stop() methods, as well as the ended event.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioScheduledSourceNode)
 */
interface AudioScheduledSourceNode extends AudioNode {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioScheduledSourceNode/ended_event) */
  onended: ((this: AudioScheduledSourceNode, ev: Event) => any) | null;
  /**
   * The **`start()`** method on AudioScheduledSourceNode schedules a sound to begin playback at the specified time. If no time is specified, then the sound begins playing immediately.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioScheduledSourceNode/start)
   */
  start(when?: number): void;
  /**
   * The **`stop()`** method on AudioScheduledSourceNode schedules a sound to cease playback at the specified time. If no time is specified, then the sound stops playing immediately.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioScheduledSourceNode/stop)
   */
  stop(when?: number): void;
  addEventListener<K extends keyof AudioScheduledSourceNodeEventMap>(
    type: K,
    listener: (this: AudioScheduledSourceNode, ev: AudioScheduledSourceNodeEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof AudioScheduledSourceNodeEventMap>(
    type: K,
    listener: (this: AudioScheduledSourceNode, ev: AudioScheduledSourceNodeEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var AudioScheduledSourceNode: {
  prototype: AudioScheduledSourceNode;
  new (): AudioScheduledSourceNode;
};

/**
 * The **`AudioWorklet`** interface of the Web Audio API is used to supply custom audio processing scripts that execute in a separate thread to provide very low latency audio processing.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AudioWorklet)
 */
interface AudioWorklet extends Worklet {}

declare var AudioWorklet: {
  prototype: AudioWorklet;
  new (): AudioWorklet;
};

/**
 * The **`AuthenticatorAssertionResponse`** interface of the Web Authentication API contains a digital signature from the private key of a particular WebAuthn credential. The relying party's server can verify this signature to authenticate a user, for example when they sign in.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAssertionResponse)
 */
interface AuthenticatorAssertionResponse extends AuthenticatorResponse {
  /**
   * The **`authenticatorData`** property of the AuthenticatorAssertionResponse interface returns an ArrayBuffer containing information from the authenticator such as the Relying Party ID Hash (rpIdHash), a signature counter, test of user presence, user verification flags, and any extensions processed by the authenticator.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAssertionResponse/authenticatorData)
   */
  readonly authenticatorData: ArrayBuffer;
  /**
   * The **`signature`** read-only property of the AuthenticatorAssertionResponse interface is an ArrayBuffer object which is the signature of the authenticator for both AuthenticatorAssertionResponse.authenticatorData and a SHA-256 hash of the client data (AuthenticatorAssertionResponse.clientDataJSON).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAssertionResponse/signature)
   */
  readonly signature: ArrayBuffer;
  /**
   * The **`userHandle`** read-only property of the AuthenticatorAssertionResponse interface is an ArrayBuffer object providing an opaque identifier for the given user. Such an identifier can be used by the relying party's server to link the user account with its corresponding credentials and other data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAssertionResponse/userHandle)
   */
  readonly userHandle: ArrayBuffer | null;
}

declare var AuthenticatorAssertionResponse: {
  prototype: AuthenticatorAssertionResponse;
  new (): AuthenticatorAssertionResponse;
};

/**
 * The **`AuthenticatorAttestationResponse`** interface of the Web Authentication API is the result of a WebAuthn credential registration. It contains information about the credential that the server needs to perform WebAuthn assertions, such as its credential ID and public key.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse)
 */
interface AuthenticatorAttestationResponse extends AuthenticatorResponse {
  /**
   * The **`attestationObject`** property of the AuthenticatorAttestationResponse interface returns an ArrayBuffer containing the new public key, as well as signature over the entire attestationObject with a private key that is stored in the authenticator when it is manufactured.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse/attestationObject)
   */
  readonly attestationObject: ArrayBuffer;
  /**
   * The **`getAuthenticatorData()`** method of the AuthenticatorAttestationResponse interface returns an ArrayBuffer containing the authenticator data contained within the AuthenticatorAttestationResponse.attestationObject property.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse/getAuthenticatorData)
   */
  getAuthenticatorData(): ArrayBuffer;
  /**
   * The **`getPublicKey()`** method of the AuthenticatorAttestationResponse interface returns an ArrayBuffer containing the DER SubjectPublicKeyInfo of the new credential (see Subject Public Key Info), or null if this is not available.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse/getPublicKey)
   */
  getPublicKey(): ArrayBuffer | null;
  /**
   * The **`getPublicKeyAlgorithm()`** method of the AuthenticatorAttestationResponse interface returns a number that is equal to a COSE Algorithm Identifier, representing the cryptographic algorithm used for the new credential.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse/getPublicKeyAlgorithm)
   */
  getPublicKeyAlgorithm(): COSEAlgorithmIdentifier;
  /**
   * The **`getTransports()`** method of the AuthenticatorAttestationResponse interface returns an array of strings describing the different transports which may be used by the authenticator.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse/getTransports)
   */
  getTransports(): string[];
}

declare var AuthenticatorAttestationResponse: {
  prototype: AuthenticatorAttestationResponse;
  new (): AuthenticatorAttestationResponse;
};

/**
 * The **`AuthenticatorResponse`** interface of the Web Authentication API is the base interface for interfaces that provide a cryptographic root of trust for a key pair. The child interfaces include information from the browser such as the challenge origin and either may be returned from PublicKeyCredential.response.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorResponse)
 */
interface AuthenticatorResponse {
  /**
   * The **`clientDataJSON`** property of the AuthenticatorResponse interface stores a JSON string in an ArrayBuffer, representing the client data that was passed to navigator.credentials.create() or navigator.credentials.get(). This property is only accessed on one of the child objects of AuthenticatorResponse, specifically AuthenticatorAttestationResponse or AuthenticatorAssertionResponse.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorResponse/clientDataJSON)
   */
  readonly clientDataJSON: ArrayBuffer;
}

declare var AuthenticatorResponse: {
  prototype: AuthenticatorResponse;
  new (): AuthenticatorResponse;
};

interface BaseAudioContextEventMap {
  statechange: Event;
}

/**
 * The **`BaseAudioContext`** interface of the Web Audio API acts as a base definition for online and offline audio-processing graphs, as represented by AudioContext and OfflineAudioContext respectively. You wouldn't use BaseAudioContext directly — you'd use its features via one of these two inheriting interfaces.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext)
 */
interface BaseAudioContext extends EventTarget {
  /**
   * The **`audioWorklet`** read-only property of the BaseAudioContext interface returns an instance of AudioWorklet that can be used for adding AudioWorkletProcessor-derived classes which implement custom audio processing.
   * Available only in secure contexts.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/audioWorklet)
   */
  readonly audioWorklet: AudioWorklet;
  /**
   * The **`currentTime`** read-only property of the BaseAudioContext interface returns a double representing an ever-increasing hardware timestamp in seconds that can be used for scheduling audio playback, visualizing timelines, etc. It starts at 0.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/currentTime)
   */
  readonly currentTime: number;
  /**
   * The **`destination`** property of the BaseAudioContext interface returns an AudioDestinationNode representing the final destination of all audio in the context. It often represents an actual audio-rendering device such as your device's speakers.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/destination)
   */
  readonly destination: AudioDestinationNode;
  /**
   * The **`listener`** property of the BaseAudioContext interface returns an AudioListener object that can then be used for implementing 3D audio spatialization.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/listener)
   */
  readonly listener: AudioListener;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/statechange_event) */
  onstatechange: ((this: BaseAudioContext, ev: Event) => any) | null;
  /**
   * The **`sampleRate`** property of the BaseAudioContext interface returns a floating point number representing the sample rate, in samples per second, used by all nodes in this audio context. This limitation means that sample-rate converters are not supported.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/sampleRate)
   */
  readonly sampleRate: number;
  /**
   * The **`state`** read-only property of the BaseAudioContext interface returns the current state of the AudioContext.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/state)
   */
  readonly state: AudioContextState;
  /**
   * The **`createAnalyser()`** method of the BaseAudioContext interface creates an AnalyserNode, which can be used to expose audio time and frequency data and create data visualizations.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createAnalyser)
   */
  createAnalyser(): AnalyserNode;
  /**
   * The **`createBiquadFilter()`** method of the BaseAudioContext interface creates a BiquadFilterNode, which represents a second order filter configurable as several different common filter types.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createBiquadFilter)
   */
  createBiquadFilter(): BiquadFilterNode;
  /**
   * The **`createBuffer()`** method of the BaseAudioContext Interface is used to create a new, empty AudioBuffer object, which can then be populated by data, and played via an AudioBufferSourceNode.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createBuffer)
   */
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
  /**
   * The **`createBufferSource()`** method of the BaseAudioContext Interface is used to create a new AudioBufferSourceNode, which can be used to play audio data contained within an AudioBuffer object. AudioBuffers are created using BaseAudioContext.createBuffer or returned by BaseAudioContext.decodeAudioData when it successfully decodes an audio track.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createBufferSource)
   */
  createBufferSource(): AudioBufferSourceNode;
  /**
   * The **`createChannelMerger()`** method of the BaseAudioContext interface creates a ChannelMergerNode, which combines channels from multiple audio streams into a single audio stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createChannelMerger)
   */
  createChannelMerger(numberOfInputs?: number): ChannelMergerNode;
  /**
   * The **`createChannelSplitter()`** method of the BaseAudioContext Interface is used to create a ChannelSplitterNode, which is used to access the individual channels of an audio stream and process them separately.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createChannelSplitter)
   */
  createChannelSplitter(numberOfOutputs?: number): ChannelSplitterNode;
  /**
   * The **`createConstantSource()`** property of the BaseAudioContext interface creates a ConstantSourceNode object, which is an audio source that continuously outputs a monaural (one-channel) sound signal whose samples all have the same value.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createConstantSource)
   */
  createConstantSource(): ConstantSourceNode;
  /**
   * The **`createConvolver()`** method of the BaseAudioContext interface creates a ConvolverNode, which is commonly used to apply reverb effects to your audio. See the spec definition of Convolution for more information.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createConvolver)
   */
  createConvolver(): ConvolverNode;
  /**
   * The **`createDelay()`** method of the BaseAudioContext Interface is used to create a DelayNode, which is used to delay the incoming audio signal by a certain amount of time.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createDelay)
   */
  createDelay(maxDelayTime?: number): DelayNode;
  /**
   * The **`createDynamicsCompressor()`** method of the BaseAudioContext Interface is used to create a DynamicsCompressorNode, which can be used to apply compression to an audio signal.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createDynamicsCompressor)
   */
  createDynamicsCompressor(): DynamicsCompressorNode;
  /**
   * The **`createGain()`** method of the BaseAudioContext interface creates a GainNode, which can be used to control the overall gain (or volume) of the audio graph.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createGain)
   */
  createGain(): GainNode;
  /**
   * The **`createIIRFilter()`** method of the BaseAudioContext interface creates an IIRFilterNode, which represents a general infinite impulse response (IIR) filter which can be configured to serve as various types of filter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createIIRFilter)
   */
  createIIRFilter(feedforward: number[], feedback: number[]): IIRFilterNode;
  /**
   * The **`createOscillator()`** method of the BaseAudioContext interface creates an OscillatorNode, a source representing a periodic waveform. It basically generates a constant tone.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createOscillator)
   */
  createOscillator(): OscillatorNode;
  /**
   * The **`createPanner()`** method of the BaseAudioContext Interface is used to create a new PannerNode, which is used to spatialize an incoming audio stream in 3D space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createPanner)
   */
  createPanner(): PannerNode;
  /**
   * The **`createPeriodicWave()`** method of the BaseAudioContext interface is used to create a PeriodicWave. This wave is used to define a periodic waveform that can be used to shape the output of an OscillatorNode.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createPeriodicWave)
   */
  createPeriodicWave(
    real: number[] | Float32Array,
    imag: number[] | Float32Array,
    constraints?: PeriodicWaveConstraints,
  ): PeriodicWave;
  /**
   * The **`createScriptProcessor()`** method of the BaseAudioContext interface creates a ScriptProcessorNode used for direct audio processing.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createScriptProcessor)
   */
  createScriptProcessor(
    bufferSize?: number,
    numberOfInputChannels?: number,
    numberOfOutputChannels?: number,
  ): ScriptProcessorNode;
  /**
   * The **`createStereoPanner()`** method of the BaseAudioContext interface creates a StereoPannerNode, which can be used to apply stereo panning to an audio source. It positions an incoming audio stream in a stereo image using a low-cost panning algorithm.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createStereoPanner)
   */
  createStereoPanner(): StereoPannerNode;
  /**
   * The **`createWaveShaper()`** method of the BaseAudioContext interface creates a WaveShaperNode, which represents a non-linear distortion. It is used to apply distortion effects to your audio.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createWaveShaper)
   */
  createWaveShaper(): WaveShaperNode;
  /**
   * The **`decodeAudioData()`** method of the BaseAudioContext Interface is used to asynchronously decode audio file data contained in an ArrayBuffer that is loaded from fetch(), XMLHttpRequest, or FileReader. The decoded AudioBuffer is resampled to the AudioContext's sampling rate, then passed to a callback or promise.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/decodeAudioData)
   */
  decodeAudioData(
    audioData: ArrayBuffer,
    successCallback?: DecodeSuccessCallback | null,
    errorCallback?: DecodeErrorCallback | null,
  ): Promise<AudioBuffer>;
  addEventListener<K extends keyof BaseAudioContextEventMap>(
    type: K,
    listener: (this: BaseAudioContext, ev: BaseAudioContextEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof BaseAudioContextEventMap>(
    type: K,
    listener: (this: BaseAudioContext, ev: BaseAudioContextEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var BaseAudioContext: {
  prototype: BaseAudioContext;
  new (): BaseAudioContext;
};

interface BaseAudioContext {
  /**
   * The **`createIIRFilter()`** method of the BaseAudioContext interface creates an IIRFilterNode, which represents a general infinite impulse response (IIR) filter which can be configured to serve as various types of filter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createIIRFilter)
   */
  createIIRFilter(feedforward: Iterable<number>, feedback: Iterable<number>): IIRFilterNode;
  /**
   * The **`createPeriodicWave()`** method of the BaseAudioContext interface is used to create a PeriodicWave. This wave is used to define a periodic waveform that can be used to shape the output of an OscillatorNode.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BaseAudioContext/createPeriodicWave)
   */
  createPeriodicWave(
    real: Iterable<number>,
    imag: Iterable<number>,
    constraints?: PeriodicWaveConstraints,
  ): PeriodicWave;
}

/**
 * The **`BiquadFilterNode`** interface represents a simple low-order filter, and is created using the BaseAudioContext/createBiquadFilter method. It is an AudioNode that can represent different kinds of filters, tone control devices, and graphic equalizers. A BiquadFilterNode always has exactly one input and one output.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BiquadFilterNode)
 */
interface BiquadFilterNode extends AudioNode {
  /**
   * The **`Q`** property of the BiquadFilterNode interface is an a-rate AudioParam, a double representing a Q factor, or quality factor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BiquadFilterNode/Q)
   */
  readonly Q: AudioParam;
  /**
   * The **`detune`** property of the BiquadFilterNode interface is an a-rate AudioParam representing detuning of the frequency in cents.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BiquadFilterNode/detune)
   */
  readonly detune: AudioParam;
  /**
   * The **`frequency`** property of the BiquadFilterNode interface is an a-rate AudioParam — a double representing a frequency in the current filtering algorithm measured in hertz (Hz).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BiquadFilterNode/frequency)
   */
  readonly frequency: AudioParam;
  /**
   * The **`gain`** property of the BiquadFilterNode interface is an a-rate AudioParam — a double representing the gain used in the current filtering algorithm.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BiquadFilterNode/gain)
   */
  readonly gain: AudioParam;
  /**
   * The **`type`** property of the BiquadFilterNode interface is a string (enum) value defining the kind of filtering algorithm the node is implementing.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BiquadFilterNode/type)
   */
  type: BiquadFilterType;
  /**
   * The **`getFrequencyResponse()`** method of the BiquadFilterNode interface takes the current filtering algorithm's settings and calculates the frequency response for frequencies specified in a specified array of frequencies.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BiquadFilterNode/getFrequencyResponse)
   */
  getFrequencyResponse(
    frequencyHz: Float32Array<ArrayBuffer>,
    magResponse: Float32Array<ArrayBuffer>,
    phaseResponse: Float32Array<ArrayBuffer>,
  ): void;
}

declare var BiquadFilterNode: {
  prototype: BiquadFilterNode;
  new (context: BaseAudioContext, options?: BiquadFilterOptions): BiquadFilterNode;
};

/**
 * The **`Blob`** interface represents a blob, which is a file-like object of immutable, raw data; they can be read as text or binary data, or converted into a ReadableStream so its methods can be used for processing the data.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob)
 */
interface Blob {
  /**
   * The **`size`** read-only property of the Blob interface returns the size of the Blob or File in bytes.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/size)
   */
  readonly size: number;
  /**
   * The **`type`** read-only property of the Blob interface returns the MIME type of the file.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/type)
   */
  readonly type: string;
  /**
   * The **`arrayBuffer()`** method of the Blob interface returns a Promise that resolves with the contents of the blob as binary data contained in an ArrayBuffer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/arrayBuffer)
   */
  arrayBuffer(): Promise<ArrayBuffer>;
  /**
   * The **`bytes()`** method of the Blob interface returns a Promise that resolves with a Uint8Array containing the contents of the blob as an array of bytes.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/bytes)
   */
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * The **`slice()`** method of the Blob interface creates and returns a new Blob object which contains data from a subset of the blob on which it's called.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/slice)
   */
  slice(start?: number, end?: number, contentType?: string): Blob;
  /**
   * The **`stream()`** method of the Blob interface returns a ReadableStream which upon reading returns the data contained within the Blob.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/stream)
   */
  stream(): ReadableStream<Uint8Array<ArrayBuffer>>;
  /**
   * The **`text()`** method of the Blob interface returns a Promise that resolves with a string containing the contents of the blob, interpreted as UTF-8.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/text)
   */
  text(): Promise<string>;
}

declare var Blob: {
  prototype: Blob;
  new (blobParts?: BlobPart[], options?: BlobPropertyBag): Blob;
};

/**
 * The **`BlobEvent`** interface of the MediaStream Recording API represents events associated with a Blob. These blobs are typically, but not necessarily, associated with media content.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BlobEvent)
 */
interface BlobEvent extends Event {
  /**
   * The **`data`** read-only property of the BlobEvent interface represents a Blob associated with the event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BlobEvent/data)
   */
  readonly data: Blob;
  /**
   * The **`timecode`** read-only property of the BlobEvent interface indicates the difference between the timestamp of the first chunk of data, and the timestamp of the first chunk in the first BlobEvent produced by this recorder.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BlobEvent/timecode)
   */
  readonly timecode: DOMHighResTimeStamp;
}

declare var BlobEvent: {
  prototype: BlobEvent;
  new (type: string, eventInitDict: BlobEventInit): BlobEvent;
};

interface Body {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/body) */
  readonly body: ReadableStream<Uint8Array<ArrayBuffer>> | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/bodyUsed) */
  readonly bodyUsed: boolean;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/arrayBuffer) */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/blob) */
  blob(): Promise<Blob>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/bytes) */
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/formData) */
  formData(): Promise<FormData>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/json) */
  json(): Promise<any>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/text) */
  text(): Promise<string>;
}

interface BroadcastChannelEventMap {
  message: MessageEvent;
  messageerror: MessageEvent;
}

/**
 * The **`BroadcastChannel`** interface represents a named channel that any browsing context of a given origin can subscribe to. It allows communication between different documents (in different windows, tabs, frames or iframes) of the same origin. Messages are broadcasted via a message event fired at all BroadcastChannel objects listening to the channel, except the object that sent the message.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BroadcastChannel)
 */
interface BroadcastChannel extends EventTarget {
  /**
   * The **`name`** read-only property of the BroadcastChannel interface returns a string, which uniquely identifies the given channel with its name. This name is passed to the BroadcastChannel() constructor at creation time and is therefore read-only.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BroadcastChannel/name)
   */
  readonly name: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/BroadcastChannel/message_event) */
  onmessage: ((this: BroadcastChannel, ev: MessageEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/BroadcastChannel/messageerror_event) */
  onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => any) | null;
  /**
   * The **`close()`** method of the BroadcastChannel interface terminates the connection to the underlying channel, allowing the object to be garbage collected. This is a necessary step to perform as there is no other way for a browser to know that this channel is not needed anymore.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BroadcastChannel/close)
   */
  close(): void;
  /**
   * The **`postMessage()`** method of the BroadcastChannel interface sends a message, which can be of any kind of Object, to each listener in any browsing context with the same origin. The message is transmitted as a message event targeted at each BroadcastChannel bound to the channel.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/BroadcastChannel/postMessage)
   */
  postMessage(message: any): void;
  addEventListener<K extends keyof BroadcastChannelEventMap>(
    type: K,
    listener: (this: BroadcastChannel, ev: BroadcastChannelEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof BroadcastChannelEventMap>(
    type: K,
    listener: (this: BroadcastChannel, ev: BroadcastChannelEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var BroadcastChannel: {
  prototype: BroadcastChannel;
  new (name: string): BroadcastChannel;
};

/**
 * The **`ByteLengthQueuingStrategy`** interface of the Streams API provides a built-in byte length queuing strategy that can be used when constructing streams.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ByteLengthQueuingStrategy)
 */
interface ByteLengthQueuingStrategy extends QueuingStrategy<ArrayBufferView> {
  /**
   * The read-only **`ByteLengthQueuingStrategy.highWaterMark`** property returns the total number of bytes that can be contained in the internal queue before backpressure is applied.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ByteLengthQueuingStrategy/highWaterMark)
   */
  readonly highWaterMark: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ByteLengthQueuingStrategy/size) */
  readonly size: QueuingStrategySize<ArrayBufferView>;
}

declare var ByteLengthQueuingStrategy: {
  prototype: ByteLengthQueuingStrategy;
  new (init: QueuingStrategyInit): ByteLengthQueuingStrategy;
};

/**
 * The **`ChannelMergerNode`** interface, often used in conjunction with its opposite, ChannelSplitterNode, reunites different mono inputs into a single output. Each input is used to fill a channel of the output. This is useful for accessing each channel separately, e.g., for performing channel mixing where gain must be separately controlled on each channel.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ChannelMergerNode)
 */
interface ChannelMergerNode extends AudioNode {}

declare var ChannelMergerNode: {
  prototype: ChannelMergerNode;
  new (context: BaseAudioContext, options?: ChannelMergerOptions): ChannelMergerNode;
};

/**
 * The **`ChannelSplitterNode`** interface, often used in conjunction with its opposite, ChannelMergerNode, separates the different channels of an audio source into a set of mono outputs. This is useful for accessing each channel separately, e.g., for performing channel mixing where gain must be separately controlled on each channel.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ChannelSplitterNode)
 */
interface ChannelSplitterNode extends AudioNode {}

declare var ChannelSplitterNode: {
  prototype: ChannelSplitterNode;
  new (context: BaseAudioContext, options?: ChannelSplitterOptions): ChannelSplitterNode;
};

/**
 * The **`Clipboard`** interface of the Clipboard API provides read and write access to the contents of the system clipboard. This allows a web application to implement cut, copy, and paste features.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Clipboard)
 */
interface Clipboard extends EventTarget {
  /**
   * The **`read()`** method of the Clipboard interface requests a copy of the clipboard's contents, fulfilling the returned Promise with the data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Clipboard/read)
   */
  read(): Promise<ClipboardItems>;
  /**
   * The **`readText()`** method of the Clipboard interface returns a Promise which fulfills with a copy of the textual contents of the system clipboard.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Clipboard/readText)
   */
  readText(): Promise<string>;
  /**
   * The **`write()`** method of the Clipboard interface writes arbitrary ClipboardItem data such as images and text to the clipboard, fulfilling the returned Promise on completion. This can be used to implement cut and copy functionality.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Clipboard/write)
   */
  write(data: ClipboardItems): Promise<void>;
  /**
   * The **`writeText()`** method of the Clipboard interface writes the specified text to the system clipboard, returning a Promise that is resolved once the system clipboard has been updated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Clipboard/writeText)
   */
  writeText(data: string): Promise<void>;
}

declare var Clipboard: {
  prototype: Clipboard;
  new (): Clipboard;
};

/**
 * The **`ClipboardItem`** interface of the Clipboard API represents a single item format, used when reading or writing clipboard data using Clipboard.read() and Clipboard.write() respectively.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ClipboardItem)
 */
interface ClipboardItem {
  /**
   * The read-only **`presentationStyle`** property of the ClipboardItem interface returns a string indicating how an item should be presented.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ClipboardItem/presentationStyle)
   */
  readonly presentationStyle: PresentationStyle;
  /**
   * The read-only **`types`** property of the ClipboardItem interface returns an Array of MIME types available within the ClipboardItem.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ClipboardItem/types)
   */
  readonly types: ReadonlyArray<string>;
  /**
   * The **`getType()`** method of the ClipboardItem interface returns a Promise that resolves with a Blob of the requested MIME type or an error if the MIME type is not found.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ClipboardItem/getType)
   */
  getType(type: string): Promise<Blob>;
}

declare var ClipboardItem: {
  prototype: ClipboardItem;
  new (
    items: Record<string, string | Blob | PromiseLike<string | Blob>>,
    options?: ClipboardItemOptions,
  ): ClipboardItem;
  /**
   * The **`supports()`** static method of the ClipboardItem interface returns true if the given MIME type is supported by the clipboard, and false otherwise.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ClipboardItem/supports_static)
   */
  supports(type: string): boolean;
};

/**
 * A **`CloseEvent`** is sent to clients using WebSockets when the connection is closed. This is delivered to the listener indicated by the WebSocket object's onclose attribute.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CloseEvent)
 */
interface CloseEvent extends Event {
  /**
   * The **`code`** read-only property of the CloseEvent interface returns a WebSocket connection close code indicating the reason the connection was closed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CloseEvent/code)
   */
  readonly code: number;
  /**
   * The **`reason`** read-only property of the CloseEvent interface returns the WebSocket connection close reason the server gave for closing the connection; that is, a concise human-readable prose explanation for the closure.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CloseEvent/reason)
   */
  readonly reason: string;
  /**
   * The **`wasClean`** read-only property of the CloseEvent interface returns true if the connection closed cleanly.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CloseEvent/wasClean)
   */
  readonly wasClean: boolean;
}

declare var CloseEvent: {
  prototype: CloseEvent;
  new (type: string, eventInitDict?: CloseEventInit): CloseEvent;
};

/**
 * The **`CompressionStream`** interface of the Compression Streams API compresses a stream of data. It implements the same shape as a TransformStream, allowing it to be used in ReadableStream.pipeThrough() and similar methods.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CompressionStream)
 */
interface CompressionStream extends GenericTransformStream {
  /** The **`readable`** read-only property of the CompressionStream interface returns a ReadableStream that emits compressed data as Uint8Array chunks. */
  readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>;
  /** The **`writable`** read-only property of the CompressionStream interface returns a WritableStream that accepts uncompressed data to be compressed, in the form of ArrayBuffer, TypedArray, or DataView chunks. */
  readonly writable: WritableStream<BufferSource>;
}

declare var CompressionStream: {
  prototype: CompressionStream;
  new (format: CompressionFormat): CompressionStream;
};

/**
 * The **`ConstantSourceNode`** interface—part of the Web Audio API—represents an audio source (based upon AudioScheduledSourceNode) whose output is single unchanging value. This makes it useful for cases in which you need a constant value coming in from an audio source. In addition, it can be used like a constructible AudioParam by automating the value of its offset or by connecting another node to it; see Controlling multiple parameters with ConstantSourceNode.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ConstantSourceNode)
 */
interface ConstantSourceNode extends AudioScheduledSourceNode {
  /**
   * The read-only **`offset`** property of the ConstantSourceNode interface returns an AudioParam object indicating the numeric a-rate value which is always returned by the source when asked for the next sample.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ConstantSourceNode/offset)
   */
  readonly offset: AudioParam;
  addEventListener<K extends keyof AudioScheduledSourceNodeEventMap>(
    type: K,
    listener: (this: ConstantSourceNode, ev: AudioScheduledSourceNodeEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof AudioScheduledSourceNodeEventMap>(
    type: K,
    listener: (this: ConstantSourceNode, ev: AudioScheduledSourceNodeEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var ConstantSourceNode: {
  prototype: ConstantSourceNode;
  new (context: BaseAudioContext, options?: ConstantSourceOptions): ConstantSourceNode;
};

/**
 * The **`ConvolverNode`** interface is an AudioNode that performs a Linear Convolution on a given AudioBuffer, often used to achieve a reverb effect. A ConvolverNode always has exactly one input and one output.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ConvolverNode)
 */
interface ConvolverNode extends AudioNode {
  /**
   * The **`buffer`** property of the ConvolverNode interface represents a mono, stereo, or 4-channel AudioBuffer containing the (possibly multichannel) impulse response used by the ConvolverNode to create the reverb effect.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ConvolverNode/buffer)
   */
  buffer: AudioBuffer | null;
  /**
   * The **`normalize`** property of the ConvolverNode interface is a boolean that controls whether the impulse response from the buffer will be scaled by an equal-power normalization when the buffer attribute is set, or not.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ConvolverNode/normalize)
   */
  normalize: boolean;
}

declare var ConvolverNode: {
  prototype: ConvolverNode;
  new (context: BaseAudioContext, options?: ConvolverOptions): ConvolverNode;
};

/**
 * The **`CountQueuingStrategy`** interface of the Streams API provides a built-in chunk counting queuing strategy that can be used when constructing streams.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CountQueuingStrategy)
 */
interface CountQueuingStrategy extends QueuingStrategy {
  /**
   * The read-only **`CountQueuingStrategy.highWaterMark`** property returns the total number of chunks that can be contained in the internal queue before backpressure is applied.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CountQueuingStrategy/highWaterMark)
   */
  readonly highWaterMark: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CountQueuingStrategy/size) */
  readonly size: QueuingStrategySize;
}

declare var CountQueuingStrategy: {
  prototype: CountQueuingStrategy;
  new (init: QueuingStrategyInit): CountQueuingStrategy;
};

/**
 * The **`Credential`** interface of the Credential Management API provides information about an entity (usually a user) normally as a prerequisite to a trust decision.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Credential)
 */
interface Credential {
  /**
   * The **`id`** read-only property of the Credential interface returns a string containing the credential's identifier. This might be a GUID, username, or email address, or some other value, depending on the type of credential.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Credential/id)
   */
  readonly id: string;
  /**
   * The **`type`** read-only property of the Credential interface returns a string containing the credential's type. Valid values are password, federated, public-key, identity and otp.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Credential/type)
   */
  readonly type: string;
}

declare var Credential: {
  prototype: Credential;
  new (): Credential;
};

/**
 * The **`CredentialsContainer`** interface of the Credential Management API exposes methods to request credentials and notify the user agent when events such as successful sign in or sign out happen. This interface is accessible from Navigator.credentials.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CredentialsContainer)
 */
interface CredentialsContainer {
  /**
   * The **`create()`** method of the CredentialsContainer interface creates a new credential, which can then be stored and later retrieved using the navigator.credentials.get() method. The retrieved credential can then be used by a website to authenticate a user.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CredentialsContainer/create)
   */
  create(options?: CredentialCreationOptions): Promise<Credential | null>;
  /**
   * The **`get()`** method of the CredentialsContainer interface returns a Promise that fulfills with a single credential, which can then be used to authenticate a user to a website.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CredentialsContainer/get)
   */
  get(options?: CredentialRequestOptions): Promise<Credential | null>;
  /**
   * The **`preventSilentAccess()`** method of the CredentialsContainer interface sets a flag that specifies whether automatic log in is allowed for future visits to the current origin, then returns a Promise that resolves to undefined. For example, you might call this, after a user signs out of a website to ensure that they aren't automatically signed in on the next site visit. Mediation varies by origin, and is an added check point of browser stored credentials, informing a user of an account login status. This method is typically called after a user signs out of a website, ensuring this user's login information is not automatically passed on the next site visit.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CredentialsContainer/preventSilentAccess)
   */
  preventSilentAccess(): Promise<void>;
  /**
   * The **`store()`** method of the CredentialsContainer stores a set of credentials for the user inside a Credential instance, returning this in a Promise.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CredentialsContainer/store)
   */
  store(credential: Credential): Promise<void>;
}

declare var CredentialsContainer: {
  prototype: CredentialsContainer;
  new (): CredentialsContainer;
};

/**
 * The **`Crypto`** interface represents basic cryptography features available in the current context. It allows access to a cryptographically strong random number generator and to cryptographic primitives.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Crypto)
 */
interface Crypto {
  /**
   * The **`Crypto.subtle`** read-only property returns a SubtleCrypto which can then be used to perform low-level cryptographic operations.
   * Available only in secure contexts.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Crypto/subtle)
   */
  readonly subtle: SubtleCrypto;
  /**
   * The **`Crypto.getRandomValues()`** method lets you get cryptographically strong random values. The array given as the parameter is filled with random numbers (random in its cryptographic meaning).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Crypto/getRandomValues)
   */
  getRandomValues<T extends Exclude<BufferSource, ArrayBuffer>>(array: T): T;
  /**
   * The **`randomUUID()`** method of the Crypto interface is used to generate a v4 UUID using a cryptographically secure random number generator.
   * Available only in secure contexts.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Crypto/randomUUID)
   */
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
}

declare var Crypto: {
  prototype: Crypto;
  new (): Crypto;
};

/**
 * The **`CryptoKey`** interface of the Web Crypto API represents a cryptographic key obtained from one of the SubtleCrypto methods generateKey(), deriveKey(), importKey(), or unwrapKey().
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CryptoKey)
 */
interface CryptoKey {
  /**
   * The read-only **`algorithm`** property of the CryptoKey interface returns an object describing the algorithm for which this key can be used, and any associated extra parameters.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CryptoKey/algorithm)
   */
  readonly algorithm: KeyAlgorithm;
  /**
   * The read-only **`extractable`** property of the CryptoKey interface indicates whether or not the key may be extracted using SubtleCrypto.exportKey() or SubtleCrypto.wrapKey().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CryptoKey/extractable)
   */
  readonly extractable: boolean;
  /**
   * The read-only **`type`** property of the CryptoKey interface indicates which kind of key is represented by the object. It can have the following values:
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CryptoKey/type)
   */
  readonly type: KeyType;
  /**
   * The read-only **`usages`** property of the CryptoKey interface indicates what can be done with the key.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CryptoKey/usages)
   */
  readonly usages: KeyUsage[];
}

declare var CryptoKey: {
  prototype: CryptoKey;
  new (): CryptoKey;
};

/**
 * The **`CustomEvent`** interface can be used to attach custom data to an event generated by an application.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CustomEvent)
 */
interface CustomEvent<T = any> extends Event {
  /**
   * The read-only **`detail`** property of the CustomEvent interface returns any data passed when initializing the event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CustomEvent/detail)
   */
  readonly detail: T;
  /**
   * The **`CustomEvent.initCustomEvent()`** method initializes a CustomEvent object. If the event has already been dispatched, this method does nothing.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/CustomEvent/initCustomEvent)
   */
  initCustomEvent(type: string, bubbles?: boolean, cancelable?: boolean, detail?: T): void;
}

declare var CustomEvent: {
  prototype: CustomEvent;
  new <T>(type: string, eventInitDict?: CustomEventInit<T>): CustomEvent<T>;
};

/**
 * The **`DOMException`** interface represents an abnormal event (called an exception) that occurs as a result of calling a method or accessing a property of a web API. This is how error conditions are described in web APIs.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMException)
 */
interface DOMException extends Error {
  /**
   * The **`code`** read-only property of the DOMException interface returns one of the legacy error code constants, or 0 if none match.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMException/code)
   */
  readonly code: number;
  /**
   * The **`message`** read-only property of the DOMException interface returns a string representing a message or description associated with the given error name.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMException/message)
   */
  readonly message: string;
  /**
   * The **`name`** read-only property of the DOMException interface returns a string that contains one of the strings associated with an error name.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMException/name)
   */
  readonly name: string;
  readonly INDEX_SIZE_ERR: 1;
  readonly DOMSTRING_SIZE_ERR: 2;
  readonly HIERARCHY_REQUEST_ERR: 3;
  readonly WRONG_DOCUMENT_ERR: 4;
  readonly INVALID_CHARACTER_ERR: 5;
  readonly NO_DATA_ALLOWED_ERR: 6;
  readonly NO_MODIFICATION_ALLOWED_ERR: 7;
  readonly NOT_FOUND_ERR: 8;
  readonly NOT_SUPPORTED_ERR: 9;
  readonly INUSE_ATTRIBUTE_ERR: 10;
  readonly INVALID_STATE_ERR: 11;
  readonly SYNTAX_ERR: 12;
  readonly INVALID_MODIFICATION_ERR: 13;
  readonly NAMESPACE_ERR: 14;
  readonly INVALID_ACCESS_ERR: 15;
  readonly VALIDATION_ERR: 16;
  readonly TYPE_MISMATCH_ERR: 17;
  readonly SECURITY_ERR: 18;
  readonly NETWORK_ERR: 19;
  readonly ABORT_ERR: 20;
  readonly URL_MISMATCH_ERR: 21;
  readonly QUOTA_EXCEEDED_ERR: 22;
  readonly TIMEOUT_ERR: 23;
  readonly INVALID_NODE_TYPE_ERR: 24;
  readonly DATA_CLONE_ERR: 25;
}

declare var DOMException: {
  prototype: DOMException;
  new (message?: string, name?: string): DOMException;
  readonly INDEX_SIZE_ERR: 1;
  readonly DOMSTRING_SIZE_ERR: 2;
  readonly HIERARCHY_REQUEST_ERR: 3;
  readonly WRONG_DOCUMENT_ERR: 4;
  readonly INVALID_CHARACTER_ERR: 5;
  readonly NO_DATA_ALLOWED_ERR: 6;
  readonly NO_MODIFICATION_ALLOWED_ERR: 7;
  readonly NOT_FOUND_ERR: 8;
  readonly NOT_SUPPORTED_ERR: 9;
  readonly INUSE_ATTRIBUTE_ERR: 10;
  readonly INVALID_STATE_ERR: 11;
  readonly SYNTAX_ERR: 12;
  readonly INVALID_MODIFICATION_ERR: 13;
  readonly NAMESPACE_ERR: 14;
  readonly INVALID_ACCESS_ERR: 15;
  readonly VALIDATION_ERR: 16;
  readonly TYPE_MISMATCH_ERR: 17;
  readonly SECURITY_ERR: 18;
  readonly NETWORK_ERR: 19;
  readonly ABORT_ERR: 20;
  readonly URL_MISMATCH_ERR: 21;
  readonly QUOTA_EXCEEDED_ERR: 22;
  readonly TIMEOUT_ERR: 23;
  readonly INVALID_NODE_TYPE_ERR: 24;
  readonly DATA_CLONE_ERR: 25;
};

/**
 * A **`DOMPoint`** object represents a 2D or 3D point in a coordinate system; it includes values for the coordinates in up to three dimensions, as well as an optional perspective value. DOMPoint is based on DOMPointReadOnly but allows its properties' values to be changed.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPoint)
 */
interface DOMPoint extends DOMPointReadOnly {
  /**
   * The DOMPoint interface's **`w`** property holds the point's perspective value, w, for a point in space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPoint/w)
   */
  w: number;
  /**
   * The DOMPoint interface's **`x`** property holds the horizontal coordinate, x, for a point in space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPoint/x)
   */
  x: number;
  /**
   * The DOMPoint interface's **`y`** property holds the vertical coordinate, y, for a point in space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPoint/y)
   */
  y: number;
  /**
   * The DOMPoint interface's **`z`** property specifies the depth coordinate of a point in space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPoint/z)
   */
  z: number;
}

declare var DOMPoint: {
  prototype: DOMPoint;
  new (x?: number, y?: number, z?: number, w?: number): DOMPoint;
  /**
   * The **`fromPoint()`** static method of the DOMPoint interface creates and returns a new mutable DOMPoint object given a source point.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPoint/fromPoint_static)
   */
  fromPoint(other?: DOMPointInit): DOMPoint;
};

/**
 * The **`DOMPointReadOnly`** interface specifies the coordinate and perspective fields used by DOMPoint to define a 2D or 3D point in a coordinate system.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPointReadOnly)
 */
interface DOMPointReadOnly {
  /**
   * The DOMPointReadOnly interface's **`w`** property holds the point's perspective value, w, for a read-only point in space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPointReadOnly/w)
   */
  readonly w: number;
  /**
   * The DOMPointReadOnly interface's **`x`** property holds the horizontal coordinate, x, for a read-only point in space. This property cannot be changed by JavaScript code in this read-only version of the DOMPoint object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPointReadOnly/x)
   */
  readonly x: number;
  /**
   * The DOMPointReadOnl**`y`** interface's y property holds the vertical coordinate, y, for a read-only point in space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPointReadOnly/y)
   */
  readonly y: number;
  /**
   * The DOMPointReadOnly interface's **`z`** property holds the depth coordinate, z, for a read-only point in space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPointReadOnly/z)
   */
  readonly z: number;
  /**
   * The **`matrixTransform()`** method of the DOMPointReadOnly interface applies a matrix transform specified as an object to the DOMPointReadOnly object, creating and returning a new DOMPointReadOnly object. Neither the matrix nor the point are altered.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPointReadOnly/matrixTransform)
   */
  matrixTransform(matrix?: DOMMatrixInit): DOMPoint;
  /**
   * The DOMPointReadOnly method **`toJSON()`** returns an object giving the JSON form of the point object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPointReadOnly/toJSON)
   */
  toJSON(): any;
}

declare var DOMPointReadOnly: {
  prototype: DOMPointReadOnly;
  new (x?: number, y?: number, z?: number, w?: number): DOMPointReadOnly;
  /**
   * The static DOMPointReadOnly method **`fromPoint()`** creates and returns a new DOMPointReadOnly object given a source point.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMPointReadOnly/fromPoint_static)
   */
  fromPoint(other?: DOMPointInit): DOMPointReadOnly;
};

/**
 * A **`DOMRect`** describes the size and position of a rectangle.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRect)
 */
interface DOMRect extends DOMRectReadOnly {
  /**
   * The **`height`** property of the DOMRect interface represents the height of the rectangle. The value can be negative.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRect/height)
   */
  height: number;
  /**
   * The **`width`** property of the DOMRect interface represents the width of the rectangle. The value can be negative.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRect/width)
   */
  width: number;
  /**
   * The **`x`** property of the DOMRect interface represents the x-coordinate of the rectangle, which is the horizontal distance between the viewport's left edge and the rectangle's origin.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRect/x)
   */
  x: number;
  /**
   * The **`y`** property of the DOMRect interface represents the y-coordinate of the rectangle, which is the vertical distance between the viewport's top edge and the rectangle's origin.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRect/y)
   */
  y: number;
}

declare var DOMRect: {
  prototype: DOMRect;
  new (x?: number, y?: number, width?: number, height?: number): DOMRect;
  /**
   * The **`fromRect()`** static method of the DOMRect object creates a new DOMRect object with a given location and dimensions.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRect/fromRect_static)
   */
  fromRect(other?: DOMRectInit): DOMRect;
};

/**
 * The **`DOMRectReadOnly`** interface specifies the standard properties (also used by DOMRect) to define a rectangle whose properties are immutable.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly)
 */
interface DOMRectReadOnly {
  /**
   * The **`bottom`** read-only property of the DOMRectReadOnly interface returns the bottom coordinate value of the DOMRect. (Has the same value as y + height, or y if height is negative.)
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly/bottom)
   */
  readonly bottom: number;
  /**
   * The **`height`** read-only property of the DOMRectReadOnly interface represents the height of the DOMRect.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly/height)
   */
  readonly height: number;
  /**
   * The **`left`** read-only property of the DOMRectReadOnly interface returns the left coordinate value of the DOMRect. (Has the same value as x, or x + width if width is negative.)
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly/left)
   */
  readonly left: number;
  /**
   * The **`right`** read-only property of the DOMRectReadOnly interface returns the right coordinate value of the DOMRect. (Has the same value as x + width, or x if width is negative.)
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly/right)
   */
  readonly right: number;
  /**
   * The **`top`** read-only property of the DOMRectReadOnly interface returns the top coordinate value of the DOMRect. (Has the same value as y, or y + height if height is negative.)
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly/top)
   */
  readonly top: number;
  /**
   * The **`width`** read-only property of the DOMRectReadOnly interface represents the width of the DOMRect.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly/width)
   */
  readonly width: number;
  /**
   * The **`x`** read-only property of the DOMRectReadOnly interface represents the x coordinate of the DOMRect's origin.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly/x)
   */
  readonly x: number;
  /**
   * The **`y`** read-only property of the DOMRectReadOnly interface represents the y coordinate of the DOMRect's origin.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly/y)
   */
  readonly y: number;
  /**
   * The DOMRectReadOnly method **`toJSON()`** returns a JSON representation of the DOMRectReadOnly object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly/toJSON)
   */
  toJSON(): any;
}

declare var DOMRectReadOnly: {
  prototype: DOMRectReadOnly;
  new (x?: number, y?: number, width?: number, height?: number): DOMRectReadOnly;
  /**
   * The **`fromRect()`** static method of the DOMRectReadOnly object creates a new DOMRectReadOnly object with a given location and dimensions.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMRectReadOnly/fromRect_static)
   */
  fromRect(other?: DOMRectInit): DOMRectReadOnly;
};

/**
 * The **`DOMStringList`** interface is a legacy type returned by some APIs and represents a non-modifiable list of strings (DOMString).
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMStringList)
 */
interface DOMStringList {
  /**
   * The read-only **`length`** property indicates the number of strings in the DOMStringList.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMStringList/length)
   */
  readonly length: number;
  /**
   * The **`contains()`** method returns a boolean indicating whether the given string is in the list.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMStringList/contains)
   */
  contains(string: string): boolean;
  /**
   * The **`item()`** method returns a string from a DOMStringList by index.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DOMStringList/item)
   */
  item(index: number): string | null;
  [index: number]: string;
}

declare var DOMStringList: {
  prototype: DOMStringList;
  new (): DOMStringList;
};

interface DOMStringList {
  [Symbol.iterator](): ArrayIterator<string>;
}

/**
 * The **`DecompressionStream`** interface of the Compression Streams API decompresses a stream of data. It implements the same shape as a TransformStream, allowing it to be used in ReadableStream.pipeThrough() and similar methods.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DecompressionStream)
 */
interface DecompressionStream extends GenericTransformStream {
  /** The **`readable`** read-only property of the DecompressionStream interface returns a ReadableStream that emits decompressed data as Uint8Array chunks. */
  readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>;
  /** The **`writable`** read-only property of the DecompressionStream interface returns a WritableStream that accepts compressed data to be decompressed, in the form of ArrayBuffer, TypedArray, or DataView chunks. */
  readonly writable: WritableStream<BufferSource>;
}

declare var DecompressionStream: {
  prototype: DecompressionStream;
  new (format: CompressionFormat): DecompressionStream;
};

/**
 * The **`DelayNode`** interface represents a delay-line; an AudioNode audio-processing module that causes a delay between the arrival of an input data and its propagation to the output.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DelayNode)
 */
interface DelayNode extends AudioNode {
  /**
   * The **`delayTime`** property of the DelayNode interface is an a-rate AudioParam representing the amount of delay to apply.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DelayNode/delayTime)
   */
  readonly delayTime: AudioParam;
}

declare var DelayNode: {
  prototype: DelayNode;
  new (context: BaseAudioContext, options?: DelayOptions): DelayNode;
};

/**
 * The **`DeviceMotionEvent`** interface of the Device Orientation Events provides web developers with information about the speed of changes for the device's position and orientation.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEvent)
 */
interface DeviceMotionEvent extends Event {
  /**
   * The **`acceleration`** read-only property of the DeviceMotionEvent interface returns the acceleration recorded by the device, in meters per second squared (m/s²). This value does not include the effect of the gravitational force, in contrast to DeviceMotionEvent.accelerationIncludingGravity.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEvent/acceleration)
   */
  readonly acceleration: DeviceMotionEventAcceleration | null;
  /**
   * The **`accelerationIncludingGravity`** read-only property of the DeviceMotionEvent interface returns the amount of acceleration recorded by the device, in meters per second squared (m/s²). Unlike DeviceMotionEvent.acceleration which compensates for the influence of gravity, its value is the sum of the acceleration of the device as induced by the user and an acceleration equal and opposite to that caused by gravity. In other words, it measures the g-force. In practice, this value represents the raw data measured by an accelerometer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEvent/accelerationIncludingGravity)
   */
  readonly accelerationIncludingGravity: DeviceMotionEventAcceleration | null;
  /**
   * The **`interval`** read-only property of the DeviceMotionEvent interface returns the interval, in milliseconds, at which data is obtained from the underlying hardware. You can use this to determine the granularity of motion events.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEvent/interval)
   */
  readonly interval: number;
  /**
   * The **`rotationRate`** read-only property of the DeviceMotionEvent interface returns the rate at which the device is rotating around each of its axes in degrees per second.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEvent/rotationRate)
   */
  readonly rotationRate: DeviceMotionEventRotationRate | null;
}

declare var DeviceMotionEvent: {
  prototype: DeviceMotionEvent;
  new (type: string, eventInitDict?: DeviceMotionEventInit): DeviceMotionEvent;
};

/**
 * The **`DeviceMotionEventAcceleration`** interface of the Device Orientation Events provides information about the amount of acceleration the device is experiencing along all three axes.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEventAcceleration)
 */
interface DeviceMotionEventAcceleration {
  /**
   * The **`x`** read-only property of the DeviceMotionEventAcceleration interface indicates the amount of acceleration that occurred along the X axis in a DeviceMotionEventAcceleration object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEventAcceleration/x)
   */
  readonly x: number | null;
  /**
   * The **`y`** read-only property of the DeviceMotionEventAcceleration interface indicates the amount of acceleration that occurred along the Y axis in a DeviceMotionEventAcceleration object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEventAcceleration/y)
   */
  readonly y: number | null;
  /**
   * The **`z`** read-only property of the DeviceMotionEventAcceleration interface indicates the amount of acceleration that occurred along the Z axis in a DeviceMotionEventAcceleration object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEventAcceleration/z)
   */
  readonly z: number | null;
}

/**
 * A **`DeviceMotionEventRotationRate`** interface of the Device Orientation Events provides information about the rate at which the device is rotating around all three axes.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEventRotationRate)
 */
interface DeviceMotionEventRotationRate {
  /**
   * The **`alpha`** read-only property of the DeviceMotionEventRotationRate interface indicates the rate of rotation around the Z axis, in degrees per second.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEventRotationRate/alpha)
   */
  readonly alpha: number | null;
  /**
   * The **`beta`** read-only property of the DeviceMotionEventRotationRate interface indicates the rate of rotation around the X axis, in degrees per second.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEventRotationRate/beta)
   */
  readonly beta: number | null;
  /**
   * The **`gamma`** read-only property of the DeviceMotionEventRotationRate interface indicates the rate of rotation around the Y axis, in degrees per second.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceMotionEventRotationRate/gamma)
   */
  readonly gamma: number | null;
}

/**
 * The **`DeviceOrientationEvent`** interface of the Device Orientation Events provides web developers with information from the physical orientation of the device running the web page.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceOrientationEvent)
 */
interface DeviceOrientationEvent extends Event {
  /**
   * The **`absolute`** read-only property of the DeviceOrientationEvent interface indicates whether or not the device is providing orientation data absolutely (that is, in reference to the Earth's coordinate frame) or using some arbitrary frame determined by the device. See Orientation and motion data explained for details.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceOrientationEvent/absolute)
   */
  readonly absolute: boolean;
  /**
   * The **`alpha`** read-only property of the DeviceOrientationEvent interface returns the rotation of the device around the Z axis; that is, the number of degrees by which the device is being twisted around the center of the screen. See Orientation and motion data explained for details.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceOrientationEvent/alpha)
   */
  readonly alpha: number | null;
  /**
   * The **`beta`** read-only property of the DeviceOrientationEvent interface returns the rotation of the device around the X axis; that is, the number of degrees, ranged between -180 and 180, by which the device is tipped forward or backward. See Orientation and motion data explained for details.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceOrientationEvent/beta)
   */
  readonly beta: number | null;
  /**
   * The **`gamma`** read-only property of the DeviceOrientationEvent interface returns the rotation of the device around the Y axis; that is, the number of degrees, ranged between -90 and 90, by which the device is tilted left or right. See Orientation and motion data explained for details.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DeviceOrientationEvent/gamma)
   */
  readonly gamma: number | null;
}

declare var DeviceOrientationEvent: {
  prototype: DeviceOrientationEvent;
  new (type: string, eventInitDict?: DeviceOrientationEventInit): DeviceOrientationEvent;
};

/**
 * The **`DynamicsCompressorNode`** interface provides a compression effect, which lowers the volume of the loudest parts of the signal in order to help prevent clipping and distortion that can occur when multiple sounds are played and multiplexed together at once. This is often used in musical production and game audio. DynamicsCompressorNode is an AudioNode that has exactly one input and one output.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DynamicsCompressorNode)
 */
interface DynamicsCompressorNode extends AudioNode {
  /**
   * The **`attack`** property of the DynamicsCompressorNode interface is a k-rate AudioParam representing the amount of time, in seconds, required to reduce the gain by 10 dB. It defines how quickly the signal is adapted when its volume is increased.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DynamicsCompressorNode/attack)
   */
  readonly attack: AudioParam;
  /**
   * The **`knee`** property of the DynamicsCompressorNode interface is a k-rate AudioParam containing a decibel value representing the range above the threshold where the curve smoothly transitions to the compressed portion.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DynamicsCompressorNode/knee)
   */
  readonly knee: AudioParam;
  /**
   * The **`ratio`** property of the DynamicsCompressorNode interface Is a k-rate AudioParam representing the amount of change, in dB, needed in the input for a 1 dB change in the output.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DynamicsCompressorNode/ratio)
   */
  readonly ratio: AudioParam;
  /**
   * The **`reduction`** read-only property of the DynamicsCompressorNode interface is a float representing the amount of gain reduction currently applied by the compressor to the signal.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DynamicsCompressorNode/reduction)
   */
  readonly reduction: number;
  /**
   * The **`release`** property of the DynamicsCompressorNode interface Is a k-rate AudioParam representing the amount of time, in seconds, required to increase the gain by 10 dB. It defines how quick the signal is adapted when its volume is reduced.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DynamicsCompressorNode/release)
   */
  readonly release: AudioParam;
  /**
   * The **`threshold`** property of the DynamicsCompressorNode interface is a k-rate AudioParam representing the decibel value above which the compression will start taking effect.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/DynamicsCompressorNode/threshold)
   */
  readonly threshold: AudioParam;
}

declare var DynamicsCompressorNode: {
  prototype: DynamicsCompressorNode;
  new (context: BaseAudioContext, options?: DynamicsCompressorOptions): DynamicsCompressorNode;
};

/**
 * The **`EncodedAudioChunk`** interface of the WebCodecs API represents a chunk of encoded audio data.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedAudioChunk)
 */
interface EncodedAudioChunk {
  /**
   * The **`byteLength`** read-only property of the EncodedAudioChunk interface returns the length in bytes of the encoded audio data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedAudioChunk/byteLength)
   */
  readonly byteLength: number;
  /**
   * The **`duration`** read-only property of the EncodedAudioChunk interface returns an integer indicating the duration of the audio in microseconds.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedAudioChunk/duration)
   */
  readonly duration: number | null;
  /**
   * The **`timestamp`** read-only property of the EncodedAudioChunk interface returns an integer indicating the timestamp of the audio in microseconds.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedAudioChunk/timestamp)
   */
  readonly timestamp: number;
  /**
   * The **`type`** read-only property of the EncodedAudioChunk interface returns a value indicating whether the audio chunk is a key chunk, which does not relying on other frames for decoding.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedAudioChunk/type)
   */
  readonly type: EncodedAudioChunkType;
  /**
   * The **`copyTo()`** method of the EncodedAudioChunk interface copies the encoded chunk of audio data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedAudioChunk/copyTo)
   */
  copyTo(destination: AllowSharedBufferSource): void;
}

declare var EncodedAudioChunk: {
  prototype: EncodedAudioChunk;
  new (init: EncodedAudioChunkInit): EncodedAudioChunk;
};

/**
 * The **`EncodedVideoChunk`** interface of the WebCodecs API represents a chunk of encoded video data.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedVideoChunk)
 */
interface EncodedVideoChunk {
  /**
   * The **`byteLength`** read-only property of the EncodedVideoChunk interface returns the length in bytes of the encoded video data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedVideoChunk/byteLength)
   */
  readonly byteLength: number;
  /**
   * The **`duration`** read-only property of the EncodedVideoChunk interface returns an integer indicating the duration of the video in microseconds.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedVideoChunk/duration)
   */
  readonly duration: number | null;
  /**
   * The **`timestamp`** read-only property of the EncodedVideoChunk interface returns an integer indicating the timestamp of the video in microseconds.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedVideoChunk/timestamp)
   */
  readonly timestamp: number;
  /**
   * The **`type`** read-only property of the EncodedVideoChunk interface returns a value indicating whether the video chunk is a key chunk, which does not rely on other frames for decoding.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedVideoChunk/type)
   */
  readonly type: EncodedVideoChunkType;
  /**
   * The **`copyTo()`** method of the EncodedVideoChunk interface copies the encoded chunk of video data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EncodedVideoChunk/copyTo)
   */
  copyTo(destination: AllowSharedBufferSource): void;
}

declare var EncodedVideoChunk: {
  prototype: EncodedVideoChunk;
  new (init: EncodedVideoChunkInit): EncodedVideoChunk;
};

/**
 * The **`ErrorEvent`** interface represents events providing information related to errors in scripts or in files.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ErrorEvent)
 */
interface ErrorEvent extends Event {
  /**
   * The **`colno`** read-only property of the ErrorEvent interface returns an integer containing the column number of the script file on which the error occurred.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ErrorEvent/colno)
   */
  readonly colno: number;
  /**
   * The **`error`** read-only property of the ErrorEvent interface returns a JavaScript value, such as an Error or DOMException, representing the error associated with this event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ErrorEvent/error)
   */
  readonly error: any;
  /**
   * The **`filename`** read-only property of the ErrorEvent interface returns a string containing the name of the script file in which the error occurred.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ErrorEvent/filename)
   */
  readonly filename: string;
  /**
   * The **`lineno`** read-only property of the ErrorEvent interface returns an integer containing the line number of the script file on which the error occurred.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ErrorEvent/lineno)
   */
  readonly lineno: number;
  /**
   * The **`message`** read-only property of the ErrorEvent interface returns a string containing a human-readable error message describing the problem.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ErrorEvent/message)
   */
  readonly message: string;
}

declare var ErrorEvent: {
  prototype: ErrorEvent;
  new (type: string, eventInitDict?: ErrorEventInit): ErrorEvent;
};

/**
 * The **`Event`** interface represents an event which takes place on an EventTarget.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event)
 */
interface Event {
  /**
   * The **`bubbles`** read-only property of the Event interface indicates whether the event bubbles up through the DOM tree or not.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/bubbles)
   */
  readonly bubbles: boolean;
  /**
   * The **`cancelBubble`** property of the Event interface is deprecated. Use Event.stopPropagation() instead. Setting its value to true before returning from an event handler prevents propagation of the event. In later implementations, setting this to false does nothing. See Browser compatibility for details.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/cancelBubble)
   */
  cancelBubble: boolean;
  /**
   * The **`cancelable`** read-only property of the Event interface indicates whether the event can be canceled, and therefore prevented as if the event never happened.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/cancelable)
   */
  readonly cancelable: boolean;
  /**
   * The read-only **`composed`** property of the Event interface returns a boolean value which indicates whether or not the event will propagate across the shadow DOM boundary into the standard DOM.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/composed)
   */
  readonly composed: boolean;
  /**
   * The **`currentTarget`** read-only property of the Event interface identifies the element to which the event handler has been attached.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/currentTarget)
   */
  readonly currentTarget: EventTarget | null;
  /**
   * The **`defaultPrevented`** read-only property of the Event interface returns a boolean value indicating whether or not the call to Event.preventDefault() canceled the event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/defaultPrevented)
   */
  readonly defaultPrevented: boolean;
  /**
   * The **`eventPhase`** read-only property of the Event interface indicates which phase of the event flow is currently being evaluated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/eventPhase)
   */
  readonly eventPhase: number;
  /**
   * The **`isTrusted`** read-only property of the Event interface is a boolean value that is true when the event was generated by the user agent (including via user actions and programmatic methods such as HTMLElement.focus()), and false when the event was dispatched via EventTarget.dispatchEvent(). The only exception is the click event, which initializes the isTrusted property to false in user agents.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/isTrusted)
   */
  readonly isTrusted: boolean;
  /**
   * The Event property **`returnValue`** indicates whether the default action for this event has been prevented or not.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/returnValue)
   */
  returnValue: boolean;
  /**
   * The deprecated **`Event.srcElement`** is an alias for the Event.target property. Use Event.target instead.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/srcElement)
   */
  readonly srcElement: EventTarget | null;
  /**
   * The read-only **`target`** property of the Event interface is a reference to the object onto which the event was dispatched. It is different from Event.currentTarget when the event handler is called during the bubbling or capturing phase of the event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/target)
   */
  readonly target: EventTarget | null;
  /**
   * The **`timeStamp`** read-only property of the Event interface returns the time (in milliseconds) at which the event was created.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/timeStamp)
   */
  readonly timeStamp: DOMHighResTimeStamp;
  /**
   * The **`type`** read-only property of the Event interface returns a string containing the event's type. It is set when the event is constructed and is the name commonly used to refer to the specific event, such as click, load, or error.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/type)
   */
  readonly type: string;
  /**
   * The **`composedPath()`** method of the Event interface returns the event's path which is an array of the objects on which listeners will be invoked. This does not include nodes in shadow trees if the shadow root was created with its ShadowRoot.mode closed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/composedPath)
   */
  composedPath(): EventTarget[];
  /**
   * The **`Event.initEvent()`** method is used to initialize the value of an event created using Document.createEvent().
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/initEvent)
   */
  initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void;
  /**
   * The **`preventDefault()`** method of the Event interface tells the user agent that the event is being explicitly handled, so its default action, such as page scrolling, link navigation, or pasting text, should not be taken.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/preventDefault)
   */
  preventDefault(): void;
  /**
   * The **`stopImmediatePropagation()`** method of the Event interface prevents other listeners of the same event from being called.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/stopImmediatePropagation)
   */
  stopImmediatePropagation(): void;
  /**
   * The **`stopPropagation()`** method of the Event interface prevents further propagation of the current event in the capturing and bubbling phases. It does not, however, prevent any default behaviors from occurring; for instance, clicks on links are still processed. If you want to stop those behaviors, see the preventDefault() method. It also does not prevent propagation to other event-handlers of the current element. If you want to stop those, see stopImmediatePropagation().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/stopPropagation)
   */
  stopPropagation(): void;
  readonly NONE: 0;
  readonly CAPTURING_PHASE: 1;
  readonly AT_TARGET: 2;
  readonly BUBBLING_PHASE: 3;
}

declare var Event: {
  prototype: Event;
  new (type: string, eventInitDict?: EventInit): Event;
  readonly NONE: 0;
  readonly CAPTURING_PHASE: 1;
  readonly AT_TARGET: 2;
  readonly BUBBLING_PHASE: 3;
};

/**
 * The **`EventCounts`** interface of the Performance API provides the number of events that have been dispatched for each event type.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventCounts)
 */
interface EventCounts {
  forEach(
    callbackfn: (value: number, key: string, parent: EventCounts) => void,
    thisArg?: any,
  ): void;
}

declare var EventCounts: {
  prototype: EventCounts;
  new (): EventCounts;
};

interface EventCounts extends ReadonlyMap<string, number> {}

interface EventListener {
  (evt: Event): void;
}

interface EventListenerObject {
  handleEvent(object: Event): void;
}

interface EventSourceEventMap {
  error: Event;
  message: MessageEvent;
  open: Event;
}

/**
 * The **`EventSource`** interface is web content's interface to server-sent events.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource)
 */
interface EventSource extends EventTarget {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/error_event) */
  onerror: ((this: EventSource, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/message_event) */
  onmessage: ((this: EventSource, ev: MessageEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/open_event) */
  onopen: ((this: EventSource, ev: Event) => any) | null;
  /**
   * The **`readyState`** read-only property of the EventSource interface returns a number representing the state of the connection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/readyState)
   */
  readonly readyState: number;
  /**
   * The **`url`** read-only property of the EventSource interface returns a string representing the URL of the source.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/url)
   */
  readonly url: string;
  /**
   * The **`withCredentials`** read-only property of the EventSource interface returns a boolean value indicating whether the EventSource object was instantiated with CORS credentials set.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/withCredentials)
   */
  readonly withCredentials: boolean;
  /**
   * The **`close()`** method of the EventSource interface closes the connection, if one is made, and sets the EventSource.readyState attribute to 2 (closed).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/close)
   */
  close(): void;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSED: 2;
  addEventListener<K extends keyof EventSourceEventMap>(
    type: K,
    listener: (this: EventSource, ev: EventSourceEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: (this: EventSource, event: MessageEvent) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof EventSourceEventMap>(
    type: K,
    listener: (this: EventSource, ev: EventSourceEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: (this: EventSource, event: MessageEvent) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var EventSource: {
  prototype: EventSource;
  new (url: string | URL, eventSourceInitDict?: EventSourceInit): EventSource;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSED: 2;
};

/**
 * The **`EventTarget`** interface is implemented by objects that can receive events and may have listeners for them. In other words, any target of events implements the three methods associated with this interface.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventTarget)
 */
interface EventTarget {
  /**
   * The **`addEventListener()`** method of the EventTarget interface sets up a function that will be called whenever the specified event is delivered to the target.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventTarget/addEventListener)
   */
  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void;
  /**
   * The **`dispatchEvent()`** method of the EventTarget sends an Event to the object, (synchronously) invoking the affected event listeners in the appropriate order. The normal event processing rules (including the capturing and optional bubbling phase) also apply to events dispatched manually with dispatchEvent().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventTarget/dispatchEvent)
   */
  dispatchEvent(event: Event): boolean;
  /**
   * The **`removeEventListener()`** method of the EventTarget interface removes an event listener previously registered with EventTarget.addEventListener() from the target. The event listener to be removed is identified using a combination of the event type, the event listener function itself, and various optional options that may affect the matching process; see Matching event listeners for removal.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventTarget/removeEventListener)
   */
  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void;
}

declare var EventTarget: {
  prototype: EventTarget;
  new (): EventTarget;
};

/**
 * The **`File`** interface provides information about files and allows JavaScript in a web page to access their content.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/File)
 */
interface File extends Blob {
  /**
   * The **`lastModified`** read-only property of the File interface provides the last modified date of the file as the number of milliseconds since the Unix epoch (January 1, 1970 at midnight). Files without a known last modified date return the current date.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/File/lastModified)
   */
  readonly lastModified: number;
  /**
   * The **`name`** read-only property of the File interface returns the name of the file represented by a File object. For security reasons, the path is excluded from this property.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/File/name)
   */
  readonly name: string;
  /**
   * The **`webkitRelativePath`** read-only property of the File interface contains a string which specifies the file's path relative to the directory selected by the user in an <input> element with its webkitdirectory attribute set.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/File/webkitRelativePath)
   */
  readonly webkitRelativePath: string;
}

declare var File: {
  prototype: File;
  new (fileBits: BlobPart[], fileName: string, options?: FilePropertyBag): File;
};

/**
 * The **`FileList`** interface represents an object of this type returned by the files property of the HTML <input> element; this lets you access the list of files selected with the <input type="file"> element. It's also used for a list of files dropped into web content when using the drag and drop API; see the DataTransfer object for details on this usage.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileList)
 */
interface FileList {
  /**
   * The **`length`** read-only property of the FileList interface returns the number of files in the FileList.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileList/length)
   */
  readonly length: number;
  /**
   * The **`item()`** method of the FileList interface returns a File object representing the file at the specified index in the file list.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileList/item)
   */
  item(index: number): File | null;
  [index: number]: File;
}

declare var FileList: {
  prototype: FileList;
  new (): FileList;
};

interface FileList {
  [Symbol.iterator](): ArrayIterator<File>;
}

interface FileReaderEventMap {
  abort: ProgressEvent<FileReader>;
  error: ProgressEvent<FileReader>;
  load: ProgressEvent<FileReader>;
  loadend: ProgressEvent<FileReader>;
  loadstart: ProgressEvent<FileReader>;
  progress: ProgressEvent<FileReader>;
}

/**
 * The **`FileReader`** interface lets web applications asynchronously read the contents of files (or raw data buffers) stored on the user's computer, using File or Blob objects to specify the file or data to read.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader)
 */
interface FileReader extends EventTarget {
  /**
   * The **`error`** read-only property of the FileReader interface returns the error that occurred while reading the file.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/error)
   */
  readonly error: DOMException | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/abort_event) */
  onabort: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/error_event) */
  onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/load_event) */
  onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/loadend_event) */
  onloadend: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/loadstart_event) */
  onloadstart: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/progress_event) */
  onprogress: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null;
  /**
   * The **`readyState`** read-only property of the FileReader interface provides the current state of the reading operation. This will be one of the states: EMPTY, LOADING, or DONE.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/readyState)
   */
  readonly readyState: 0 | 1 | 2;
  /**
   * The **`result`** read-only property of the FileReader interface returns the file's contents. This property is only valid after the read operation is complete, and the format of the data depends on which of the methods was used to initiate the read operation.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/result)
   */
  readonly result: string | ArrayBuffer | null;
  /**
   * The **`abort()`** method of the FileReader interface aborts the read operation. Upon return, the readyState will be DONE.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/abort)
   */
  abort(): void;
  /**
   * The **`readAsArrayBuffer()`** method of the FileReader interface is used to start reading the contents of a specified Blob or File. When the read operation is finished, the readyState property becomes DONE, and the loadend event is triggered. At that time, the result property contains an ArrayBuffer representing the file's data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/readAsArrayBuffer)
   */
  readAsArrayBuffer(blob: Blob): void;
  /**
   * The **`readAsBinaryString()`** method of the FileReader interface is used to start reading the contents of the specified Blob or File. When the read operation is finished, the readyState property becomes DONE, and the loadend event is triggered. At that time, the result property contains the raw binary data from the file.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/readAsBinaryString)
   */
  readAsBinaryString(blob: Blob): void;
  /**
   * The **`readAsDataURL()`** method of the FileReader interface is used to read the contents of the specified Blob or File. When the read operation is finished, the readyState property becomes DONE, and the loadend event is triggered. At that time, the result attribute contains the data as a data: URL representing the file's data as a base64 encoded string.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/readAsDataURL)
   */
  readAsDataURL(blob: Blob): void;
  /**
   * The **`readAsText()`** method of the FileReader interface is used to read the contents of the specified Blob or File. When the read operation is complete, the readyState property is changed to DONE, the loadend event is triggered, and the result property contains the contents of the file as a text string.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileReader/readAsText)
   */
  readAsText(blob: Blob, encoding?: string): void;
  readonly EMPTY: 0;
  readonly LOADING: 1;
  readonly DONE: 2;
  addEventListener<K extends keyof FileReaderEventMap>(
    type: K,
    listener: (this: FileReader, ev: FileReaderEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof FileReaderEventMap>(
    type: K,
    listener: (this: FileReader, ev: FileReaderEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var FileReader: {
  prototype: FileReader;
  new (): FileReader;
  readonly EMPTY: 0;
  readonly LOADING: 1;
  readonly DONE: 2;
};

/**
 * The **`FileSystemDirectoryHandle`** interface of the File System API provides a handle to a file system directory.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemDirectoryHandle)
 */
interface FileSystemDirectoryHandle extends FileSystemHandle {
  readonly kind: "directory";
  /**
   * The **`getDirectoryHandle()`** method of the FileSystemDirectoryHandle interface returns a FileSystemDirectoryHandle for a subdirectory with the specified name within the directory handle on which the method is called.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemDirectoryHandle/getDirectoryHandle)
   */
  getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle>;
  /**
   * The **`getFileHandle()`** method of the FileSystemDirectoryHandle interface returns a FileSystemFileHandle for a file with the specified name, within the directory the method is called.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemDirectoryHandle/getFileHandle)
   */
  getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle>;
  /**
   * The **`removeEntry()`** method of the FileSystemDirectoryHandle interface attempts to remove an entry if the directory handle contains a file or directory called the name specified.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemDirectoryHandle/removeEntry)
   */
  removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void>;
  /**
   * The **`resolve()`** method of the FileSystemDirectoryHandle interface returns an Array of directory names from the parent handle to the specified child entry, with the name of the child entry as the last array item.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemDirectoryHandle/resolve)
   */
  resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
}

declare var FileSystemDirectoryHandle: {
  prototype: FileSystemDirectoryHandle;
  new (): FileSystemDirectoryHandle;
};

interface FileSystemDirectoryHandle {
  [Symbol.asyncIterator](): FileSystemDirectoryHandleAsyncIterator<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >;
  entries(): FileSystemDirectoryHandleAsyncIterator<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >;
  keys(): FileSystemDirectoryHandleAsyncIterator<string>;
  values(): FileSystemDirectoryHandleAsyncIterator<
    FileSystemDirectoryHandle | FileSystemFileHandle
  >;
}

/**
 * The **`FileSystemFileHandle`** interface of the File System API represents a handle to a file system entry. The interface is accessed through the window.showOpenFilePicker() method.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemFileHandle)
 */
interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: "file";
  /**
   * The **`createWritable()`** method of the FileSystemFileHandle interface creates a FileSystemWritableFileStream that can be used to write to a file. The method returns a Promise which resolves to this created stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemFileHandle/createWritable)
   */
  createWritable(options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream>;
  /**
   * The **`getFile()`** method of the FileSystemFileHandle interface returns a Promise which resolves to a File object representing the state on disk of the entry represented by the handle.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemFileHandle/getFile)
   */
  getFile(): Promise<File>;
}

declare var FileSystemFileHandle: {
  prototype: FileSystemFileHandle;
  new (): FileSystemFileHandle;
};

/**
 * The **`FileSystemHandle`** interface of the File System API is an object which represents a file or directory entry. Multiple handles can represent the same entry. For the most part you do not work with FileSystemHandle directly but rather its child interfaces FileSystemFileHandle and FileSystemDirectoryHandle.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemHandle)
 */
interface FileSystemHandle {
  /**
   * The **`kind`** read-only property of the FileSystemHandle interface returns the type of entry. This is 'file' if the associated entry is a file or 'directory'. It is used to distinguish files from directories when iterating over the contents of a directory.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemHandle/kind)
   */
  readonly kind: FileSystemHandleKind;
  /**
   * The **`name`** read-only property of the FileSystemHandle interface returns the name of the entry represented by handle.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemHandle/name)
   */
  readonly name: string;
  /**
   * The **`isSameEntry()`** method of the FileSystemHandle interface compares two handles to see if the associated entries (either a file or directory) match.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemHandle/isSameEntry)
   */
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
}

declare var FileSystemHandle: {
  prototype: FileSystemHandle;
  new (): FileSystemHandle;
};

/**
 * The **`FileSystemWritableFileStream`** interface of the File System API is a WritableStream object with additional convenience methods, which operates on a single file on disk. The interface is accessed through the FileSystemFileHandle.createWritable() method.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemWritableFileStream)
 */
interface FileSystemWritableFileStream extends WritableStream {
  /**
   * The **`seek()`** method of the FileSystemWritableFileStream interface updates the current file cursor offset to the position (in bytes) specified when calling the method.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemWritableFileStream/seek)
   */
  seek(position: number): Promise<void>;
  /**
   * The **`truncate()`** method of the FileSystemWritableFileStream interface resizes the file associated with the stream to the specified size in bytes.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemWritableFileStream/truncate)
   */
  truncate(size: number): Promise<void>;
  /**
   * The **`write()`** method of the FileSystemWritableFileStream interface writes content into the file the method is called on, at the current file cursor offset.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FileSystemWritableFileStream/write)
   */
  write(data: FileSystemWriteChunkType): Promise<void>;
}

declare var FileSystemWritableFileStream: {
  prototype: FileSystemWritableFileStream;
  new (): FileSystemWritableFileStream;
};

/**
 * The **`FontFace`** interface of the CSS Font Loading API represents a single usable font face.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace)
 */
interface FontFace {
  /**
   * The **`ascentOverride`** property of the FontFace interface returns and sets the ascent metric for the font, the height above the baseline that CSS uses to lay out line boxes in an inline formatting context.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/ascentOverride)
   */
  ascentOverride: string;
  /**
   * The **`descentOverride`** property of the FontFace interface returns and sets the value of the descent-override descriptor. The possible values are normal, indicating that the metric used should be obtained from the font file, or a percentage.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/descentOverride)
   */
  descentOverride: string;
  /**
   * The **`display`** property of the FontFace interface determines how a font face is displayed based on whether and when it is downloaded and ready to use. This property is equivalent to the CSS font-display descriptor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/display)
   */
  display: FontDisplay;
  /**
   * The **`FontFace.family`** property allows the author to get or set the font family of a FontFace object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/family)
   */
  family: string;
  /**
   * The **`featureSettings`** property of the FontFace interface retrieves or sets infrequently used font features that are not available from a font's variant properties.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/featureSettings)
   */
  featureSettings: string;
  /**
   * The **`lineGapOverride`** property of the FontFace interface returns and sets the value of the line-gap-override descriptor. The possible values are normal, indicating that the metric used should be obtained from the font file, or a percentage.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/lineGapOverride)
   */
  lineGapOverride: string;
  /**
   * The **`loaded`** read-only property of the FontFace interface returns a Promise that resolves with the current FontFace object when the font specified in the object's constructor is done loading or rejects with a SyntaxError.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/loaded)
   */
  readonly loaded: Promise<FontFace>;
  /**
   * The **`status`** read-only property of the FontFace interface returns an enumerated value indicating the status of the font, one of "unloaded", "loading", "loaded", or "error".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/status)
   */
  readonly status: FontFaceLoadStatus;
  /**
   * The **`stretch`** property of the FontFace interface retrieves or sets how the font stretches.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/stretch)
   */
  stretch: string;
  /**
   * The **`style`** property of the FontFace interface retrieves or sets the font's style.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/style)
   */
  style: string;
  /**
   * The **`unicodeRange`** property of the FontFace interface retrieves or sets the range of unicode code points encompassing the font.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/unicodeRange)
   */
  unicodeRange: string;
  /**
   * The **`variationSettings`** property of the FontFace interface retrieves or sets low-level OpenType or TrueType font variations.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/variationSettings)
   */
  variationSettings: string;
  /**
   * The **`weight`** property of the FontFace interface retrieves or sets the weight of the font.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/weight)
   */
  weight: string;
  /**
   * The **`load()`** method of the FontFace interface requests and loads a font whose source was specified as a URL. It returns a Promise that resolves with the current FontFace object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFace/load)
   */
  load(): Promise<FontFace>;
}

declare var FontFace: {
  prototype: FontFace;
  new (family: string, source: string | BufferSource, descriptors?: FontFaceDescriptors): FontFace;
};

interface FontFaceSetEventMap {
  loading: FontFaceSetLoadEvent;
  loadingdone: FontFaceSetLoadEvent;
  loadingerror: FontFaceSetLoadEvent;
}

/**
 * The **`FontFaceSet`** interface of the CSS Font Loading API manages the loading of font-faces and querying of their download status.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFaceSet)
 */
interface FontFaceSet extends EventTarget {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFaceSet/loading_event) */
  onloading: ((this: FontFaceSet, ev: FontFaceSetLoadEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFaceSet/loadingdone_event) */
  onloadingdone: ((this: FontFaceSet, ev: FontFaceSetLoadEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFaceSet/loadingerror_event) */
  onloadingerror: ((this: FontFaceSet, ev: FontFaceSetLoadEvent) => any) | null;
  /**
   * The **`ready`** read-only property of the FontFaceSet interface returns a Promise that resolves to the given FontFaceSet.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFaceSet/ready)
   */
  readonly ready: Promise<FontFaceSet>;
  /**
   * The **`status`** read-only property of the FontFaceSet interface returns the loading state of the fonts in the set.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFaceSet/status)
   */
  readonly status: FontFaceSetLoadStatus;
  /**
   * The **`check()`** method of the FontFaceSet returns true if you can render some text using the given font specification without attempting to use any fonts in this FontFaceSet that are not yet fully loaded. This means you can use the font specification without causing a font swap.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFaceSet/check)
   */
  check(font: string, text?: string): boolean;
  /**
   * The **`load()`** method of the FontFaceSet forces all the fonts given in parameters to be loaded.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFaceSet/load)
   */
  load(font: string, text?: string): Promise<FontFace[]>;
  forEach(
    callbackfn: (value: FontFace, key: FontFace, parent: FontFaceSet) => void,
    thisArg?: any,
  ): void;
  addEventListener<K extends keyof FontFaceSetEventMap>(
    type: K,
    listener: (this: FontFaceSet, ev: FontFaceSetEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof FontFaceSetEventMap>(
    type: K,
    listener: (this: FontFaceSet, ev: FontFaceSetEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var FontFaceSet: {
  prototype: FontFaceSet;
  new (): FontFaceSet;
};

interface FontFaceSet extends Set<FontFace> {}

/**
 * The **`FontFaceSetLoadEvent`** interface of the CSS Font Loading API represents events fired at a FontFaceSet after it starts loading font faces.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFaceSetLoadEvent)
 */
interface FontFaceSetLoadEvent extends Event {
  /**
   * The **`fontfaces`** read-only property of the FontFaceSetLoadEvent interface returns an array of FontFace instances, each of which represents a single usable font.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FontFaceSetLoadEvent/fontfaces)
   */
  readonly fontfaces: ReadonlyArray<FontFace>;
}

declare var FontFaceSetLoadEvent: {
  prototype: FontFaceSetLoadEvent;
  new (type: string, eventInitDict?: FontFaceSetLoadEventInit): FontFaceSetLoadEvent;
};

/**
 * The **`FormData`** interface provides a way to construct a set of key/value pairs representing form fields and their values, which can be sent using the fetch(), XMLHttpRequest.send() or navigator.sendBeacon() methods. It uses the same format a form would use if the encoding type were set to "multipart/form-data".
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData)
 */
interface FormData {
  /**
   * The **`append()`** method of the FormData interface appends a new value onto an existing key inside a FormData object, or adds the key if it does not already exist.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/append)
   */
  append(name: string, value: string | Blob): void;
  append(name: string, value: string): void;
  append(name: string, blobValue: Blob, filename?: string): void;
  /**
   * The **`delete()`** method of the FormData interface deletes a key and its value(s) from a FormData object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/delete)
   */
  delete(name: string): void;
  /**
   * The **`get()`** method of the FormData interface returns the first value associated with a given key from within a FormData object. If you expect multiple values and want all of them, use the getAll() method instead.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/get)
   */
  get(name: string): FormDataEntryValue | null;
  /**
   * The **`getAll()`** method of the FormData interface returns all the values associated with a given key from within a FormData object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/getAll)
   */
  getAll(name: string): FormDataEntryValue[];
  /**
   * The **`has()`** method of the FormData interface returns whether a FormData object contains a certain key.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/has)
   */
  has(name: string): boolean;
  /**
   * The **`set()`** method of the FormData interface sets a new value for an existing key inside a FormData object, or adds the key/value if it does not already exist.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/FormData/set)
   */
  set(name: string, value: string | Blob): void;
  set(name: string, value: string): void;
  set(name: string, blobValue: Blob, filename?: string): void;
  forEach(
    callbackfn: (value: FormDataEntryValue, key: string, parent: FormData) => void,
    thisArg?: any,
  ): void;
}

declare var FormData: {
  prototype: FormData;
  new (): FormData;
};

interface FormData {
  [Symbol.iterator](): FormDataIterator<[string, FormDataEntryValue]>;
  /** Returns an array of key, value pairs for every entry in the list. */
  entries(): FormDataIterator<[string, FormDataEntryValue]>;
  /** Returns a list of keys in the list. */
  keys(): FormDataIterator<string>;
  /** Returns a list of values in the list. */
  values(): FormDataIterator<FormDataEntryValue>;
}

/**
 * The **`GainNode`** interface represents a change in volume. It is an AudioNode audio-processing module that causes a given gain to be applied to the input data before its propagation to the output. A GainNode always has exactly one input and one output, both with the same number of channels.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GainNode)
 */
interface GainNode extends AudioNode {
  /**
   * The **`gain`** property of the GainNode interface is an a-rate AudioParam representing the amount of gain to apply.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GainNode/gain)
   */
  readonly gain: AudioParam;
}

declare var GainNode: {
  prototype: GainNode;
  new (context: BaseAudioContext, options?: GainOptions): GainNode;
};

/**
 * The **`Gamepad`** interface of the Gamepad API defines an individual gamepad or other controller, allowing access to information such as button presses, axis positions, and id.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Gamepad)
 */
interface Gamepad {
  /**
   * The **`Gamepad.axes`** property of the Gamepad interface returns an array representing the controls with axes present on the device (e.g., analog thumb sticks).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Gamepad/axes)
   */
  readonly axes: ReadonlyArray<number>;
  /**
   * The **`buttons`** property of the Gamepad interface returns an array of GamepadButton objects representing the buttons present on the device.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Gamepad/buttons)
   */
  readonly buttons: ReadonlyArray<GamepadButton>;
  /**
   * The **`Gamepad.connected`** property of the Gamepad interface returns a boolean indicating whether the gamepad is still connected to the system.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Gamepad/connected)
   */
  readonly connected: boolean;
  /**
   * The **`Gamepad.id`** property of the Gamepad interface returns a string containing some information about the controller.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Gamepad/id)
   */
  readonly id: string;
  /**
   * The **`Gamepad.index`** property of the Gamepad interface returns an integer that is auto-incremented to be unique for each device currently connected to the system.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Gamepad/index)
   */
  readonly index: number;
  /**
   * The **`Gamepad.mapping`** property of the Gamepad interface returns a string indicating whether the browser has remapped the controls on the device to a known layout.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Gamepad/mapping)
   */
  readonly mapping: GamepadMappingType;
  /**
   * The **`Gamepad.timestamp`** property of the Gamepad interface returns a DOMHighResTimeStamp representing the last time the data for this gamepad was updated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Gamepad/timestamp)
   */
  readonly timestamp: DOMHighResTimeStamp;
  /**
   * The **`vibrationActuator`** read-only property of the Gamepad interface returns a GamepadHapticActuator object, which represents haptic feedback hardware available on the controller.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Gamepad/vibrationActuator)
   */
  readonly vibrationActuator: GamepadHapticActuator;
}

declare var Gamepad: {
  prototype: Gamepad;
  new (): Gamepad;
};

/**
 * The **`GamepadButton`** interface defines an individual button of a gamepad or other controller, allowing access to the current state of different types of buttons available on the control device.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GamepadButton)
 */
interface GamepadButton {
  /**
   * The **`GamepadButton.pressed`** property of the GamepadButton interface returns a boolean indicating whether the button is currently pressed (true) or unpressed (false).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GamepadButton/pressed)
   */
  readonly pressed: boolean;
  /**
   * The **`touched`** property of the GamepadButton interface returns a boolean indicating whether a button capable of detecting touch is currently touched (true) or not touched (false).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GamepadButton/touched)
   */
  readonly touched: boolean;
  /**
   * The **`GamepadButton.value`** property of the GamepadButton interface returns a double value used to represent the current state of analog buttons on many modern gamepads, such as the triggers.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GamepadButton/value)
   */
  readonly value: number;
}

declare var GamepadButton: {
  prototype: GamepadButton;
  new (): GamepadButton;
};

/**
 * The **`GamepadHapticActuator`** interface of the Gamepad API represents hardware in the controller designed to provide haptic feedback to the user (if available), most commonly vibration hardware.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GamepadHapticActuator)
 */
interface GamepadHapticActuator {
  /**
   * The **`playEffect()`** method of the GamepadHapticActuator interface causes the hardware to play a specific vibration effect.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GamepadHapticActuator/playEffect)
   */
  playEffect(
    type: GamepadHapticEffectType,
    params?: GamepadEffectParameters,
  ): Promise<GamepadHapticsResult>;
  /**
   * The **`reset()`** method of the GamepadHapticActuator interface stops the hardware from playing an active vibration effect.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GamepadHapticActuator/reset)
   */
  reset(): Promise<GamepadHapticsResult>;
}

declare var GamepadHapticActuator: {
  prototype: GamepadHapticActuator;
  new (): GamepadHapticActuator;
};

interface GenericTransformStream {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CompressionStream/readable) */
  readonly readable: ReadableStream;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/CompressionStream/writable) */
  readonly writable: WritableStream;
}

/**
 * The **`Geolocation`** interface represents an object able to obtain the position of the device programmatically. It gives Web content access to the location of the device. This allows a website or app to offer customized results based on the user's location.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Geolocation)
 */
interface Geolocation {
  /**
   * The **`clearWatch()`** method of the Geolocation interface is used to unregister location/error monitoring handlers previously installed using Geolocation.watchPosition().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Geolocation/clearWatch)
   */
  clearWatch(watchId: number): void;
  /**
   * The **`getCurrentPosition()`** method of the Geolocation interface is used to get the current position of the device.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Geolocation/getCurrentPosition)
   */
  getCurrentPosition(
    successCallback: PositionCallback,
    errorCallback?: PositionErrorCallback | null,
    options?: PositionOptions,
  ): void;
  /**
   * The **`watchPosition()`** method of the Geolocation interface is used to register a handler function that will be called automatically each time the position of the device changes. You can also, optionally, specify an error handling callback function.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Geolocation/watchPosition)
   */
  watchPosition(
    successCallback: PositionCallback,
    errorCallback?: PositionErrorCallback | null,
    options?: PositionOptions,
  ): number;
}

declare var Geolocation: {
  prototype: Geolocation;
  new (): Geolocation;
};

/**
 * The **`GeolocationCoordinates`** interface represents the position and altitude of the device on Earth, as well as the accuracy with which these properties are calculated. The geographic position information is provided in terms of World Geodetic System coordinates (WGS84).
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationCoordinates)
 */
interface GeolocationCoordinates {
  /**
   * The **`accuracy`** read-only property of the GeolocationCoordinates interface is a strictly positive double representing the accuracy, with a 95% confidence level, of the GeolocationCoordinates.latitude and GeolocationCoordinates.longitude properties expressed in meters.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationCoordinates/accuracy)
   */
  readonly accuracy: number;
  /**
   * The **`altitude`** read-only property of the GeolocationCoordinates interface is a double representing the altitude of the position in meters above the WGS84 ellipsoid (which defines the nominal sea level surface). This value is null if the implementation cannot provide this data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationCoordinates/altitude)
   */
  readonly altitude: number | null;
  /**
   * The **`altitudeAccuracy`** read-only property of the GeolocationCoordinates interface is a strictly positive double representing the accuracy, with a 95% confidence level, of the altitude expressed in meters. This value is null if the implementation doesn't support measuring altitude.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationCoordinates/altitudeAccuracy)
   */
  readonly altitudeAccuracy: number | null;
  /**
   * The **`heading`** read-only property of the GeolocationCoordinates interface is a double representing the direction in which the device is traveling. This value, specified in degrees, indicates how far off from heading due north the device is. 0 degrees represents true north, and the direction is determined clockwise (which means that east is 90 degrees and west is 270 degrees). If GeolocationCoordinates.speed is 0 or the device is not able to provide heading information, heading is null.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationCoordinates/heading)
   */
  readonly heading: number | null;
  /**
   * The **`latitude`** read-only property of the GeolocationCoordinates interface is a double representing the latitude of the position in decimal degrees.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationCoordinates/latitude)
   */
  readonly latitude: number;
  /**
   * The **`longitude`** read-only property of the GeolocationCoordinates interface is a number which represents the longitude of a geographical position, specified in decimal degrees. Together with a timestamp, given as Unix time in milliseconds, indicating a time of measurement, the GeolocationCoordinates object is part of the GeolocationPosition interface, which is the object type returned by Geolocation API functions that obtain and return a geographical position.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationCoordinates/longitude)
   */
  readonly longitude: number;
  /**
   * The **`speed`** read-only property of the GeolocationCoordinates interface is a double representing the velocity of the device in meters per second. This value is null if the implementation is not able to measure it.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationCoordinates/speed)
   */
  readonly speed: number | null;
  /**
   * The **`toJSON()`** method of the GeolocationCoordinates interface is a serializer; it returns a JSON representation of the GeolocationCoordinates object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationCoordinates/toJSON)
   */
  toJSON(): any;
}

declare var GeolocationCoordinates: {
  prototype: GeolocationCoordinates;
  new (): GeolocationCoordinates;
};

/**
 * The **`GeolocationPosition`** interface represents the position of the concerned device at a given time. The position, represented by a GeolocationCoordinates object, comprehends the 2D position of the device, on a spheroid representing the Earth, but also its altitude and its speed.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationPosition)
 */
interface GeolocationPosition {
  /**
   * The **`coords`** read-only property of the GeolocationPosition interface returns a GeolocationCoordinates object representing a geographic position. It contains the location, that is longitude and latitude on the Earth, the altitude, and the speed of the object concerned, regrouped inside the returned value. It also contains accuracy information about these values.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationPosition/coords)
   */
  readonly coords: GeolocationCoordinates;
  /**
   * The **`timestamp`** read-only property of the GeolocationPosition interface represents the date and time that the position was acquired by the device.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationPosition/timestamp)
   */
  readonly timestamp: EpochTimeStamp;
  /**
   * The **`toJSON()`** method of the GeolocationPosition interface is a serializer; it returns a JSON representation of the GeolocationPosition object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationPosition/toJSON)
   */
  toJSON(): any;
}

declare var GeolocationPosition: {
  prototype: GeolocationPosition;
  new (): GeolocationPosition;
};

/**
 * The **`GeolocationPositionError`** interface represents the reason of an error occurring when using the geolocating device.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationPositionError)
 */
interface GeolocationPositionError {
  /**
   * The **`code`** read-only property of the GeolocationPositionError interface is an unsigned short representing the error code.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationPositionError/code)
   */
  readonly code: number;
  /**
   * The **`message`** read-only property of the GeolocationPositionError interface returns a human-readable string describing the details of the error.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/GeolocationPositionError/message)
   */
  readonly message: string;
  readonly PERMISSION_DENIED: 1;
  readonly POSITION_UNAVAILABLE: 2;
  readonly TIMEOUT: 3;
}

declare var GeolocationPositionError: {
  prototype: GeolocationPositionError;
  new (): GeolocationPositionError;
  readonly PERMISSION_DENIED: 1;
  readonly POSITION_UNAVAILABLE: 2;
  readonly TIMEOUT: 3;
};

/**
 * The **`Headers`** interface of the Fetch API allows you to perform various actions on HTTP request and response headers. These actions include retrieving, setting, adding to, and removing headers from the list of the request's headers.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers)
 */
interface Headers {
  /**
   * The **`append()`** method of the Headers interface appends a new value onto an existing header inside a Headers object, or adds the header if it does not already exist.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/append)
   */
  append(name: string, value: string): void;
  /**
   * The **`delete()`** method of the Headers interface deletes a header from the current Headers object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/delete)
   */
  delete(name: string): void;
  /**
   * The **`get()`** method of the Headers interface returns a byte string of all the values of a header within a Headers object with a given name. If the requested header doesn't exist in the Headers object, it returns null.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/get)
   */
  get(name: string): string | null;
  /**
   * The **`getSetCookie()`** method of the Headers interface returns an array containing the values of all Set-Cookie headers associated with a response. This allows Headers objects to handle having multiple Set-Cookie headers, which wasn't possible prior to its implementation.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/getSetCookie)
   */
  getSetCookie(): string[];
  /**
   * The **`has()`** method of the Headers interface returns a boolean stating whether a Headers object contains a certain header.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/has)
   */
  has(name: string): boolean;
  /**
   * The **`set()`** method of the Headers interface sets a new value for an existing header inside a Headers object, or adds the header if it does not already exist.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/set)
   */
  set(name: string, value: string): void;
  forEach(callbackfn: (value: string, key: string, parent: Headers) => void, thisArg?: any): void;
}

declare var Headers: {
  prototype: Headers;
  new (init?: HeadersInit): Headers;
};

interface Headers {
  [Symbol.iterator](): HeadersIterator<[string, string]>;
  /** Returns an iterator allowing to go through all key/value pairs contained in this object. */
  entries(): HeadersIterator<[string, string]>;
  /** Returns an iterator allowing to go through all keys of the key/value pairs contained in this object. */
  keys(): HeadersIterator<string>;
  /** Returns an iterator allowing to go through all values of the key/value pairs contained in this object. */
  values(): HeadersIterator<string>;
}

/**
 * The **`IDBCursor`** interface of the IndexedDB API represents a cursor for traversing or iterating over multiple records in a database.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursor)
 */
interface IDBCursor {
  /**
   * The **`direction`** read-only property of the IDBCursor interface is a string that returns the direction of traversal of the cursor (set using IDBObjectStore.openCursor for example). See the Value section below for possible values.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursor/direction)
   */
  readonly direction: IDBCursorDirection;
  /**
   * The **`key`** read-only property of the IDBCursor interface returns the key for the record at the cursor's position. If the cursor is outside its range, this is set to undefined. The cursor's key can be any data type.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursor/key)
   */
  readonly key: IDBValidKey;
  /**
   * The **`primaryKey`** read-only property of the IDBCursor interface returns the cursor's current effective key. If the cursor is currently being iterated or has iterated outside its range, this is set to undefined. The cursor's primary key can be any data type.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursor/primaryKey)
   */
  readonly primaryKey: IDBValidKey;
  /**
   * The **`request`** read-only property of the IDBCursor interface returns the IDBRequest used to obtain the cursor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursor/request)
   */
  readonly request: IDBRequest;
  /**
   * The **`source`** read-only property of the IDBCursor interface returns the IDBObjectStore or IDBIndex that the cursor is iterating over. This function never returns null or throws an exception, even if the cursor is currently being iterated, has iterated past its end, or its transaction is not active.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursor/source)
   */
  readonly source: IDBObjectStore | IDBIndex;
  /**
   * The **`advance()`** method of the IDBCursor interface sets the number of times a cursor should move its position forward.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursor/advance)
   */
  advance(count: number): void;
  /**
   * The **`continue()`** method of the IDBCursor interface advances the cursor to the next position along its direction, to the item whose key matches the optional key parameter. If no key is specified, the cursor advances to the immediate next position, based on its direction.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursor/continue)
   */
  continue(key?: IDBValidKey): void;
  /**
   * The **`continuePrimaryKey()`** method of the IDBCursor interface advances the cursor to the item whose key matches the key parameter as well as whose primary key matches the primary key parameter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursor/continuePrimaryKey)
   */
  continuePrimaryKey(key: IDBValidKey, primaryKey: IDBValidKey): void;
  /**
   * The **`delete()`** method of the IDBCursor interface returns an IDBRequest object, and, in a separate thread, deletes the record at the cursor's position, without changing the cursor's position. Once the record is deleted, the cursor's value is set to null.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursor/delete)
   */
  delete(): IDBRequest<undefined>;
  /**
   * The **`update()`** method of the IDBCursor interface returns an IDBRequest object, and, in a separate thread, updates the value at the current position of the cursor in the object store. If the cursor points to a record that has just been deleted, a new record is created.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursor/update)
   */
  update(value: any): IDBRequest<IDBValidKey>;
}

declare var IDBCursor: {
  prototype: IDBCursor;
  new (): IDBCursor;
};

/**
 * The **`IDBCursorWithValue`** interface of the IndexedDB API represents a cursor for traversing or iterating over multiple records in a database. It is the same as the IDBCursor, except that it includes the value property.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursorWithValue)
 */
interface IDBCursorWithValue extends IDBCursor {
  /**
   * The **`value`** read-only property of the IDBCursorWithValue interface returns the value of the current cursor, whatever that is.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBCursorWithValue/value)
   */
  readonly value: any;
}

declare var IDBCursorWithValue: {
  prototype: IDBCursorWithValue;
  new (): IDBCursorWithValue;
};

interface IDBDatabaseEventMap {
  abort: Event;
  close: Event;
  error: Event;
  versionchange: IDBVersionChangeEvent;
}

/**
 * The **`IDBDatabase`** interface of the IndexedDB API provides a connection to a database; you can use an IDBDatabase object to open a transaction on your database then create, manipulate, and delete objects (data) in that database. The interface provides the only way to get and manage versions of the database.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBDatabase)
 */
interface IDBDatabase extends EventTarget {
  /**
   * The **`name`** read-only property of the IDBDatabase interface is a string that contains the name of the connected database.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBDatabase/name)
   */
  readonly name: string;
  /**
   * The **`objectStoreNames`** read-only property of the IDBDatabase interface is a DOMStringList containing a list of the names of the object stores currently in the connected database.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBDatabase/objectStoreNames)
   */
  readonly objectStoreNames: DOMStringList;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/abort_event) */
  onabort: ((this: IDBDatabase, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBDatabase/close_event) */
  onclose: ((this: IDBDatabase, ev: Event) => any) | null;
  onerror: ((this: IDBDatabase, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBDatabase/versionchange_event) */
  onversionchange: ((this: IDBDatabase, ev: IDBVersionChangeEvent) => any) | null;
  /**
   * The **`version`** property of the IDBDatabase interface is a 64-bit integer that contains the version of the connected database. When a database is first created, this attribute is an empty string.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBDatabase/version)
   */
  readonly version: number;
  /**
   * The **`close()`** method of the IDBDatabase interface returns immediately and closes the connection in a separate thread.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBDatabase/close)
   */
  close(): void;
  /**
   * The **`createObjectStore()`** method of the IDBDatabase interface creates and returns a new IDBObjectStore.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBDatabase/createObjectStore)
   */
  createObjectStore(name: string, options?: IDBObjectStoreParameters): IDBObjectStore;
  /**
   * The **`deleteObjectStore()`** method of the IDBDatabase interface destroys the object store with the given name in the connected database, along with any indexes that reference it.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBDatabase/deleteObjectStore)
   */
  deleteObjectStore(name: string): void;
  /**
   * The **`transaction`** method of the IDBDatabase interface immediately returns a transaction object (IDBTransaction) containing the IDBTransaction.objectStore method, which you can use to access your object store.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBDatabase/transaction)
   */
  transaction(
    storeNames: string | string[],
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions,
  ): IDBTransaction;
  addEventListener<K extends keyof IDBDatabaseEventMap>(
    type: K,
    listener: (this: IDBDatabase, ev: IDBDatabaseEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof IDBDatabaseEventMap>(
    type: K,
    listener: (this: IDBDatabase, ev: IDBDatabaseEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var IDBDatabase: {
  prototype: IDBDatabase;
  new (): IDBDatabase;
};

interface IDBDatabase {
  /**
   * The **`transaction`** method of the IDBDatabase interface immediately returns a transaction object (IDBTransaction) containing the IDBTransaction.objectStore method, which you can use to access your object store.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBDatabase/transaction)
   */
  transaction(
    storeNames: string | Iterable<string>,
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions,
  ): IDBTransaction;
}

/**
 * The **`IDBFactory`** interface of the IndexedDB API lets applications asynchronously access the indexed databases. The object that implements the interface is window.indexedDB. You open — that is, create and access — and delete a database with this object, and not directly with IDBFactory.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBFactory)
 */
interface IDBFactory {
  /**
   * The **`cmp()`** method of the IDBFactory interface compares two values as keys to determine equality and ordering for IndexedDB operations, such as storing and iterating.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBFactory/cmp)
   */
  cmp(first: any, second: any): number;
  /**
   * The **`databases`** method of the IDBFactory interface returns a Promise that fulfills with an array of objects containing the name and version of all the available databases.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBFactory/databases)
   */
  databases(): Promise<IDBDatabaseInfo[]>;
  /**
   * The **`deleteDatabase()`** method of the IDBFactory interface requests the deletion of a database. The method returns an IDBOpenDBRequest object immediately, and performs the deletion operation asynchronously.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBFactory/deleteDatabase)
   */
  deleteDatabase(name: string): IDBOpenDBRequest;
  /**
   * The **`open()`** method of the IDBFactory interface requests opening a connection to a database.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBFactory/open)
   */
  open(name: string, version?: number): IDBOpenDBRequest;
}

declare var IDBFactory: {
  prototype: IDBFactory;
  new (): IDBFactory;
};

/**
 * **`IDBIndex`** interface of the IndexedDB API provides asynchronous access to an index in a database. An index is a kind of object store for looking up records in another object store, called the referenced object store. You use this interface to retrieve data.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex)
 */
interface IDBIndex {
  /**
   * The **`keyPath`** property of the IDBIndex interface returns the key path of the current index. If null, this index is not auto-populated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/keyPath)
   */
  readonly keyPath: string | string[];
  /**
   * The **`multiEntry`** read-only property of the IDBIndex interface returns a boolean value that affects how the index behaves when the result of evaluating the index's key path yields an array.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/multiEntry)
   */
  readonly multiEntry: boolean;
  /**
   * The **`name`** property of the IDBIndex interface contains a string which names the index.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/name)
   */
  name: string;
  /**
   * The **`objectStore`** property of the IDBIndex interface returns the object store referenced by the current index.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/objectStore)
   */
  readonly objectStore: IDBObjectStore;
  /**
   * The **`unique`** read-only property returns a boolean that states whether the index allows duplicate keys.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/unique)
   */
  readonly unique: boolean;
  /**
   * The **`count()`** method of the IDBIndex interface returns an IDBRequest object, and in a separate thread, returns the number of records within a key range.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/count)
   */
  count(query?: IDBValidKey | IDBKeyRange): IDBRequest<number>;
  /**
   * The **`get()`** method of the IDBIndex interface returns an IDBRequest object, and, in a separate thread, finds either the value in the referenced object store that corresponds to the given key or the first corresponding value, if key is set to an IDBKeyRange.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/get)
   */
  get(query: IDBValidKey | IDBKeyRange): IDBRequest<any>;
  /**
   * The **`getAll()`** method of the IDBIndex interface retrieves all objects that are inside the index.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/getAll)
   */
  getAll(queryOrOptions?: IDBValidKey | IDBKeyRange | null, count?: number): IDBRequest<any[]>;
  /**
   * The **`getAllKeys()`** method of the IDBIndex interface asynchronously retrieves the primary keys of all objects inside the index, setting them as the result of the request object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/getAllKeys)
   */
  getAllKeys(
    queryOrOptions?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): IDBRequest<IDBValidKey[]>;
  /**
   * The **`getKey()`** method of the IDBIndex interface returns an IDBRequest object, and, in a separate thread, finds either the primary key that corresponds to the given key in this index or the first corresponding primary key, if key is set to an IDBKeyRange.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/getKey)
   */
  getKey(query: IDBValidKey | IDBKeyRange): IDBRequest<IDBValidKey | undefined>;
  /**
   * The **`openCursor()`** method of the IDBIndex interface returns an IDBRequest object, and, in a separate thread, creates a cursor over the specified key range.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/openCursor)
   */
  openCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): IDBRequest<IDBCursorWithValue | null>;
  /**
   * The **`openKeyCursor()`** method of the IDBIndex interface returns an IDBRequest object, and, in a separate thread, creates a cursor over the specified key range, as arranged by this index.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBIndex/openKeyCursor)
   */
  openKeyCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): IDBRequest<IDBCursor | null>;
}

declare var IDBIndex: {
  prototype: IDBIndex;
  new (): IDBIndex;
};

/**
 * The **`IDBKeyRange`** interface of the IndexedDB API represents a continuous interval over some data type that is used for keys. Records can be retrieved from IDBObjectStore and IDBIndex objects using keys or a range of keys. You can limit the range using lower and upper bounds. For example, you can iterate over all values of a key in the value range A–Z.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBKeyRange)
 */
interface IDBKeyRange {
  /**
   * The **`lower`** read-only property of the IDBKeyRange interface returns the lower bound of the key range.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBKeyRange/lower)
   */
  readonly lower: any;
  /**
   * The **`lowerOpen`** read-only property of the IDBKeyRange interface returns a boolean indicating whether the lower-bound value is included in the key range.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBKeyRange/lowerOpen)
   */
  readonly lowerOpen: boolean;
  /**
   * The **`upper`** read-only property of the IDBKeyRange interface returns the upper bound of the key range.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBKeyRange/upper)
   */
  readonly upper: any;
  /**
   * The **`upperOpen`** read-only property of the IDBKeyRange interface returns a boolean indicating whether the upper-bound value is included in the key range.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBKeyRange/upperOpen)
   */
  readonly upperOpen: boolean;
  /**
   * The **`includes()`** method of the IDBKeyRange interface returns a boolean indicating whether a specified key is inside the key range.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBKeyRange/includes)
   */
  includes(key: any): boolean;
}

declare var IDBKeyRange: {
  prototype: IDBKeyRange;
  new (): IDBKeyRange;
  /**
   * The **`bound()`** static method of the IDBKeyRange interface creates a new key range with the specified upper and lower bounds. The bounds can be open (that is, the bounds exclude the endpoint values) or closed (that is, the bounds include the endpoint values). By default, the bounds are closed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBKeyRange/bound_static)
   */
  bound(lower: any, upper: any, lowerOpen?: boolean, upperOpen?: boolean): IDBKeyRange;
  /**
   * The **`lowerBound()`** static method of the IDBKeyRange interface creates a new key range with only a lower bound. By default, it includes the lower endpoint value and is closed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBKeyRange/lowerBound_static)
   */
  lowerBound(lower: any, open?: boolean): IDBKeyRange;
  /**
   * The **`only()`** static method of the IDBKeyRange interface creates a new key range containing a single value.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBKeyRange/only_static)
   */
  only(value: any): IDBKeyRange;
  /**
   * The **`upperBound()`** static method of the IDBKeyRange interface creates a new upper-bound key range. By default, it includes the upper endpoint value and is closed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBKeyRange/upperBound_static)
   */
  upperBound(upper: any, open?: boolean): IDBKeyRange;
};

/**
 * The **`IDBObjectStore`** interface of the IndexedDB API represents an object store in a database. Records within an object store are sorted according to their keys. This sorting enables fast insertion, look-up, and ordered retrieval.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore)
 */
interface IDBObjectStore {
  /**
   * The **`autoIncrement`** read-only property of the IDBObjectStore interface returns the value of the auto increment flag for this object store.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/autoIncrement)
   */
  readonly autoIncrement: boolean;
  /**
   * The **`indexNames`** read-only property of the IDBObjectStore interface returns a list of the names of indexes on objects in this object store.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/indexNames)
   */
  readonly indexNames: DOMStringList;
  /**
   * The **`keyPath`** read-only property of the IDBObjectStore interface returns the key path of this object store.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/keyPath)
   */
  readonly keyPath: string | string[] | null;
  /**
   * The **`name`** property of the IDBObjectStore interface indicates the name of this object store.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/name)
   */
  name: string;
  /**
   * The **`transaction`** read-only property of the IDBObjectStore interface returns the transaction object to which this object store belongs.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/transaction)
   */
  readonly transaction: IDBTransaction;
  /**
   * The **`add()`** method of the IDBObjectStore interface returns an IDBRequest object, and, in a separate thread, creates a structured clone of the value, and stores the cloned value in the object store. This is for adding new records to an object store.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/add)
   */
  add(value: any, key?: IDBValidKey): IDBRequest<IDBValidKey>;
  /**
   * The **`clear()`** method of the IDBObjectStore interface creates and immediately returns an IDBRequest object, and clears this object store in a separate thread. This is for deleting all the current data out of an object store.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/clear)
   */
  clear(): IDBRequest<undefined>;
  /**
   * The **`count()`** method of the IDBObjectStore interface returns an IDBRequest object, and, in a separate thread, returns the total number of records that match the provided key or IDBKeyRange. If no arguments are provided, it returns the total number of records in the store.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/count)
   */
  count(query?: IDBValidKey | IDBKeyRange): IDBRequest<number>;
  /**
   * The **`createIndex()`** method of the IDBObjectStore interface creates and returns a new IDBIndex object in the connected database. It creates a new field/column defining a new data point for each database record to contain.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/createIndex)
   */
  createIndex(name: string, keyPath: string | string[], options?: IDBIndexParameters): IDBIndex;
  /**
   * The **`delete()`** method of the IDBObjectStore interface returns an IDBRequest object, and, in a separate thread, deletes the specified record or records.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/delete)
   */
  delete(query: IDBValidKey | IDBKeyRange): IDBRequest<undefined>;
  /**
   * The **`deleteIndex()`** method of the IDBObjectStore interface destroys the index with the specified name in the connected database, used during a version upgrade.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/deleteIndex)
   */
  deleteIndex(name: string): void;
  /**
   * The **`get()`** method of the IDBObjectStore interface returns an IDBRequest object, and, in a separate thread, returns the object selected by the specified key. This is for retrieving specific records from an object store.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/get)
   */
  get(query: IDBValidKey | IDBKeyRange): IDBRequest<any>;
  /**
   * The **`getAll()`** method of the IDBObjectStore interface returns an IDBRequest object containing all objects in the object store matching the specified parameter or all objects in the store if no parameters are given.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/getAll)
   */
  getAll(queryOrOptions?: IDBValidKey | IDBKeyRange | null, count?: number): IDBRequest<any[]>;
  /**
   * The **`getAllKeys()`** method of the IDBObjectStore interface returns an IDBRequest object retrieves record keys for all objects in the object store matching the specified parameter or all objects in the store if no parameters are given.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/getAllKeys)
   */
  getAllKeys(
    queryOrOptions?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): IDBRequest<IDBValidKey[]>;
  /**
   * The **`getKey()`** method of the IDBObjectStore interface returns an IDBRequest object, and, in a separate thread, returns the key selected by the specified query. This is for retrieving specific records from an object store.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/getKey)
   */
  getKey(query: IDBValidKey | IDBKeyRange): IDBRequest<IDBValidKey | undefined>;
  /**
   * The **`index()`** method of the IDBObjectStore interface opens a named index in the current object store, after which it can be used to, for example, return a series of records sorted by that index using a cursor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/index)
   */
  index(name: string): IDBIndex;
  /**
   * The **`openCursor()`** method of the IDBObjectStore interface returns an IDBRequest object, and, in a separate thread, returns a new IDBCursorWithValue object. Used for iterating through an object store with a cursor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/openCursor)
   */
  openCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): IDBRequest<IDBCursorWithValue | null>;
  /**
   * The **`openKeyCursor()`** method of the IDBObjectStore interface returns an IDBRequest object whose result will be set to an IDBCursor that can be used to iterate through matching results. Used for iterating through the keys of an object store with a cursor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/openKeyCursor)
   */
  openKeyCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): IDBRequest<IDBCursor | null>;
  /**
   * The **`put()`** method of the IDBObjectStore interface updates a given record in a database, or inserts a new record if the given item does not already exist.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/put)
   */
  put(value: any, key?: IDBValidKey): IDBRequest<IDBValidKey>;
}

declare var IDBObjectStore: {
  prototype: IDBObjectStore;
  new (): IDBObjectStore;
};

interface IDBObjectStore {
  /**
   * The **`createIndex()`** method of the IDBObjectStore interface creates and returns a new IDBIndex object in the connected database. It creates a new field/column defining a new data point for each database record to contain.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBObjectStore/createIndex)
   */
  createIndex(
    name: string,
    keyPath: string | Iterable<string>,
    options?: IDBIndexParameters,
  ): IDBIndex;
}

interface IDBOpenDBRequestEventMap extends IDBRequestEventMap {
  blocked: IDBVersionChangeEvent;
  upgradeneeded: IDBVersionChangeEvent;
}

/**
 * The **`IDBOpenDBRequest`** interface of the IndexedDB API provides access to the results of requests to open or delete databases (performed using IDBFactory.open and IDBFactory.deleteDatabase), using specific event handler attributes.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBOpenDBRequest)
 */
interface IDBOpenDBRequest extends IDBRequest<IDBDatabase> {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBOpenDBRequest/blocked_event) */
  onblocked: ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBOpenDBRequest/upgradeneeded_event) */
  onupgradeneeded: ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => any) | null;
  addEventListener<K extends keyof IDBOpenDBRequestEventMap>(
    type: K,
    listener: (this: IDBOpenDBRequest, ev: IDBOpenDBRequestEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof IDBOpenDBRequestEventMap>(
    type: K,
    listener: (this: IDBOpenDBRequest, ev: IDBOpenDBRequestEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var IDBOpenDBRequest: {
  prototype: IDBOpenDBRequest;
  new (): IDBOpenDBRequest;
};

interface IDBRequestEventMap {
  error: Event;
  success: Event;
}

/**
 * The **`IDBRequest`** interface of the IndexedDB API provides access to results of asynchronous requests to databases and database objects using event handler attributes. Each reading and writing operation on a database is done using a request.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBRequest)
 */
interface IDBRequest<T = any> extends EventTarget {
  /**
   * The **`error`** read-only property of the IDBRequest interface returns the error in the event of an unsuccessful request.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBRequest/error)
   */
  readonly error: DOMException | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBRequest/error_event) */
  onerror: ((this: IDBRequest<T>, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBRequest/success_event) */
  onsuccess: ((this: IDBRequest<T>, ev: Event) => any) | null;
  /**
   * The **`readyState`** read-only property of the IDBRequest interface returns the state of the request.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBRequest/readyState)
   */
  readonly readyState: IDBRequestReadyState;
  /**
   * The **`result`** read-only property of the IDBRequest interface returns the result of the request.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBRequest/result)
   */
  readonly result: T;
  /**
   * The **`source`** read-only property of the IDBRequest interface returns the source of the request, such as an Index or an object store. If no source exists (such as when calling IDBFactory.open), it returns null.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBRequest/source)
   */
  readonly source: IDBObjectStore | IDBIndex | IDBCursor;
  /**
   * The **`transaction`** read-only property of the IDBRequest interface returns the transaction for the request, that is, the transaction the request is being made inside.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBRequest/transaction)
   */
  readonly transaction: IDBTransaction | null;
  addEventListener<K extends keyof IDBRequestEventMap>(
    type: K,
    listener: (this: IDBRequest<T>, ev: IDBRequestEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof IDBRequestEventMap>(
    type: K,
    listener: (this: IDBRequest<T>, ev: IDBRequestEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var IDBRequest: {
  prototype: IDBRequest;
  new (): IDBRequest;
};

interface IDBTransactionEventMap {
  abort: Event;
  complete: Event;
  error: Event;
}

/**
 * The **`IDBTransaction`** interface of the IndexedDB API provides a static, asynchronous transaction on a database using event handler attributes. All reading and writing of data is done within transactions. You use IDBDatabase to start transactions, IDBTransaction to set the mode of the transaction (e.g., is it readonly or readwrite), and you access an IDBObjectStore to make a request. You can also use an IDBTransaction object to abort transactions.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction)
 */
interface IDBTransaction extends EventTarget {
  /**
   * The **`db`** read-only property of the IDBTransaction interface returns the database connection with which this transaction is associated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/db)
   */
  readonly db: IDBDatabase;
  /**
   * The **`durability`** read-only property of the IDBTransaction interface returns the durability hint the transaction was created with. This is a hint to the user agent of whether to prioritize performance or durability when committing the transaction.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/durability)
   */
  readonly durability: IDBTransactionDurability;
  /**
   * The **`IDBTransaction.error`** property of the IDBTransaction interface returns the type of error when there is an unsuccessful transaction.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/error)
   */
  readonly error: DOMException | null;
  /**
   * The **`mode`** read-only property of the IDBTransaction interface returns the current mode for accessing the data in the object stores in the scope of the transaction (i.e., is the mode to be read-only, or do you want to write to the object stores?) The default value is readonly.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/mode)
   */
  readonly mode: IDBTransactionMode;
  /**
   * The **`objectStoreNames`** read-only property of the IDBTransaction interface returns a DOMStringList of names of IDBObjectStore objects.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/objectStoreNames)
   */
  readonly objectStoreNames: DOMStringList;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/abort_event) */
  onabort: ((this: IDBTransaction, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/complete_event) */
  oncomplete: ((this: IDBTransaction, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/error_event) */
  onerror: ((this: IDBTransaction, ev: Event) => any) | null;
  /**
   * The **`abort()`** method of the IDBTransaction interface rolls back all the changes to objects in the database associated with this transaction.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/abort)
   */
  abort(): void;
  /**
   * The **`commit()`** method of the IDBTransaction interface commits the transaction if it is called on an active transaction.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/commit)
   */
  commit(): void;
  /**
   * The **`objectStore()`** method of the IDBTransaction interface returns an object store that has already been added to the scope of this transaction.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBTransaction/objectStore)
   */
  objectStore(name: string): IDBObjectStore;
  addEventListener<K extends keyof IDBTransactionEventMap>(
    type: K,
    listener: (this: IDBTransaction, ev: IDBTransactionEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof IDBTransactionEventMap>(
    type: K,
    listener: (this: IDBTransaction, ev: IDBTransactionEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var IDBTransaction: {
  prototype: IDBTransaction;
  new (): IDBTransaction;
};

/**
 * The **`IDBVersionChangeEvent`** interface of the IndexedDB API indicates that the version of the database has changed, as the result of an onupgradeneeded event handler function.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBVersionChangeEvent)
 */
interface IDBVersionChangeEvent extends Event {
  /**
   * The **`newVersion`** read-only property of the IDBVersionChangeEvent interface returns the new version number of the database.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBVersionChangeEvent/newVersion)
   */
  readonly newVersion: number | null;
  /**
   * The **`oldVersion`** read-only property of the IDBVersionChangeEvent interface returns the old version number of the database.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IDBVersionChangeEvent/oldVersion)
   */
  readonly oldVersion: number;
}

declare var IDBVersionChangeEvent: {
  prototype: IDBVersionChangeEvent;
  new (type: string, eventInitDict?: IDBVersionChangeEventInit): IDBVersionChangeEvent;
};

/**
 * The **`IIRFilterNode`** interface of the Web Audio API is an AudioNode processor which implements a general infinite impulse response (IIR) filter; this type of filter can be used to implement tone control devices and graphic equalizers as well. It lets the parameters of the filter response be specified, so that it can be tuned as needed.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IIRFilterNode)
 */
interface IIRFilterNode extends AudioNode {
  /**
   * The **`getFrequencyResponse()`** method of the IIRFilterNode interface takes the current filtering algorithm's settings and calculates the frequency response for frequencies specified in a specified array of frequencies.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/IIRFilterNode/getFrequencyResponse)
   */
  getFrequencyResponse(
    frequencyHz: Float32Array<ArrayBuffer>,
    magResponse: Float32Array<ArrayBuffer>,
    phaseResponse: Float32Array<ArrayBuffer>,
  ): void;
}

declare var IIRFilterNode: {
  prototype: IIRFilterNode;
  new (context: BaseAudioContext, options: IIRFilterOptions): IIRFilterNode;
};

/**
 * The **`ImageBitmap`** interface represents a bitmap image which can be drawn to a <canvas> without undue latency. It can be created from a variety of source objects using the Window.createImageBitmap() or WorkerGlobalScope.createImageBitmap() factory method. ImageBitmap provides an asynchronous and resource efficient pathway to prepare textures for rendering in WebGL.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageBitmap)
 */
interface ImageBitmap {
  /**
   * The **`ImageBitmap.height`** read-only property returns the ImageBitmap object's height in CSS pixels.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageBitmap/height)
   */
  readonly height: number;
  /**
   * The **`ImageBitmap.width`** read-only property returns the ImageBitmap object's width in CSS pixels.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageBitmap/width)
   */
  readonly width: number;
  /**
   * The **`ImageBitmap.close()`** method disposes of all graphical resources associated with an ImageBitmap.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageBitmap/close)
   */
  close(): void;
}

declare var ImageBitmap: {
  prototype: ImageBitmap;
  new (): ImageBitmap;
};

/**
 * The **`ImageCapture`** interface of the MediaStream Image Capture API provides methods to enable the capture of images or photos from a camera or other photographic device. It provides an interface for capturing images from a photographic device referenced through a valid MediaStreamTrack.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageCapture)
 */
interface ImageCapture {
  /**
   * The **`track`** read-only property of the ImageCapture interface returns a reference to the MediaStreamTrack passed to the ImageCapture() constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageCapture/track)
   */
  readonly track: MediaStreamTrack;
  /**
   * The **`getPhotoCapabilities()`** method of the ImageCapture interface returns a Promise that resolves with an object containing the ranges of available configuration options.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageCapture/getPhotoCapabilities)
   */
  getPhotoCapabilities(): Promise<PhotoCapabilities>;
  /**
   * The **`getPhotoSettings()`** method of the ImageCapture interface returns a Promise that resolves with an object containing the current photo configuration settings.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageCapture/getPhotoSettings)
   */
  getPhotoSettings(): Promise<PhotoSettings>;
  /**
   * The **`grabFrame()`** method of the ImageCapture interface takes a snapshot of the live video in a MediaStreamTrack and returns a Promise that resolves with an ImageBitmap containing the snapshot.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageCapture/grabFrame)
   */
  grabFrame(): Promise<ImageBitmap>;
  /**
   * The **`takePhoto()`** method of the ImageCapture interface takes a single exposure using the video capture device sourcing a MediaStreamTrack and returns a Promise that resolves with a Blob containing the data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageCapture/takePhoto)
   */
  takePhoto(photoSettings?: PhotoSettings): Promise<Blob>;
}

declare var ImageCapture: {
  prototype: ImageCapture;
  new (videoTrack: MediaStreamTrack): ImageCapture;
};

/**
 * The **`ImageDecoder`** interface of the WebCodecs API provides a way to unpack and decode encoded image data.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageDecoder)
 */
interface ImageDecoder {
  /**
   * The **`complete`** read-only property of the ImageDecoder interface returns true if encoded data has completed buffering.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageDecoder/complete)
   */
  readonly complete: boolean;
  /**
   * The **`completed`** read-only property of the ImageDecoder interface returns a promise that resolves once encoded data has finished buffering.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageDecoder/completed)
   */
  readonly completed: Promise<void>;
  /**
   * The **`tracks`** read-only property of the ImageDecoder interface returns a list of the tracks in the encoded image data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageDecoder/tracks)
   */
  readonly tracks: ImageTrackList;
  /**
   * The **`type`** read-only property of the ImageDecoder interface reflects the MIME type configured during construction.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageDecoder/type)
   */
  readonly type: string;
  /**
   * The **`close()`** method of the ImageDecoder interface ends all pending work and releases system resources.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageDecoder/close)
   */
  close(): void;
  /**
   * The **`decode()`** method of the ImageDecoder interface enqueues a control message to decode the frame of an image.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageDecoder/decode)
   */
  decode(options?: ImageDecodeOptions): Promise<ImageDecodeResult>;
  /**
   * The **`reset()`** method of the ImageDecoder interface aborts all pending decode() operations; rejecting all pending promises. All other state will be unchanged. Class methods can continue to be invoked after reset(). E.g., calling decode() after reset() is permitted.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageDecoder/reset)
   */
  reset(): void;
}

declare var ImageDecoder: {
  prototype: ImageDecoder;
  new (init: ImageDecoderInit): ImageDecoder;
  /**
   * The **`ImageDecoder.isTypeSupported()`** static method checks if a given MIME type can be decoded by the user agent.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageDecoder/isTypeSupported_static)
   */
  isTypeSupported(type: string): Promise<boolean>;
};

/**
 * The **`ImageTrack`** interface of the WebCodecs API represents an individual image track.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageTrack)
 */
interface ImageTrack {
  /**
   * The **`animated`** property of the ImageTrack interface returns true if the track is animated and therefore has multiple frames.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageTrack/animated)
   */
  readonly animated: boolean;
  /**
   * The **`frameCount`** property of the ImageTrack interface returns the number of frames in the track.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageTrack/frameCount)
   */
  readonly frameCount: number;
  /**
   * The **`repetitionCount`** property of the ImageTrack interface returns the number of repetitions of this track.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageTrack/repetitionCount)
   */
  readonly repetitionCount: number;
  /**
   * The **`selected`** property of the ImageTrack interface returns true if the track is selected for decoding.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageTrack/selected)
   */
  selected: boolean;
}

declare var ImageTrack: {
  prototype: ImageTrack;
  new (): ImageTrack;
};

/**
 * The **`ImageTrackList`** interface of the WebCodecs API represents a list of image tracks.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageTrackList)
 */
interface ImageTrackList {
  /**
   * The **`length`** property of the ImageTrackList interface returns the length of the ImageTrackList.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageTrackList/length)
   */
  readonly length: number;
  /**
   * The **`ready`** property of the ImageTrackList interface returns a Promise that resolves when the ImageTrackList is populated with tracks.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageTrackList/ready)
   */
  readonly ready: Promise<void>;
  /**
   * The **`selectedIndex`** property of the ImageTrackList interface returns the index of the selected track.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageTrackList/selectedIndex)
   */
  readonly selectedIndex: number;
  /**
   * The **`selectedTrack`** property of the ImageTrackList interface returns an ImageTrack object representing the currently selected track.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ImageTrackList/selectedTrack)
   */
  readonly selectedTrack: ImageTrack | null;
  [index: number]: ImageTrack;
}

declare var ImageTrackList: {
  prototype: ImageTrackList;
  new (): ImageTrackList;
};

interface ImageTrackList {
  [Symbol.iterator](): ArrayIterator<ImageTrack>;
}

/**
 * The **`Lock`** interface of the Web Locks API provides the name and mode of a lock. This may be a newly requested lock that is received in the callback to LockManager.request(), or a record of an active or queued lock returned by LockManager.query().
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Lock)
 */
interface Lock {
  /**
   * The **`mode`** read-only property of the Lock interface returns the access mode passed to LockManager.request() when the lock was requested. The mode is either "exclusive" (the default) or "shared".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Lock/mode)
   */
  readonly mode: LockMode;
  /**
   * The **`name`** read-only property of the Lock interface returns the name passed to LockManager.request selected when the lock was requested.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Lock/name)
   */
  readonly name: string;
}

declare var Lock: {
  prototype: Lock;
  new (): Lock;
};

/**
 * The **`LockManager`** interface of the Web Locks API provides methods for requesting a new Lock object and querying for an existing Lock object. To get an instance of LockManager, call navigator.locks.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/LockManager)
 */
interface LockManager {
  /**
   * The **`query()`** method of the LockManager interface returns a Promise that resolves with an object containing information about held and pending locks.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/LockManager/query)
   */
  query(): Promise<LockManagerSnapshot>;
  /**
   * The **`request()`** method of the LockManager interface requests a Lock object with parameters specifying its name and characteristics. The requested Lock is passed to a callback, while the function itself returns a Promise that resolves (or rejects) with the result of the callback after the lock is released, or rejects if the request is aborted.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/LockManager/request)
   */
  request<T>(name: string, callback: LockGrantedCallback<T>): Promise<Awaited<T>>;
  request<T>(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<T>,
  ): Promise<Awaited<T>>;
}

declare var LockManager: {
  prototype: LockManager;
  new (): LockManager;
};

/**
 * The **`MediaDeviceInfo`** interface of the Media Capture and Streams API contains information that describes a single media input or output device.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDeviceInfo)
 */
interface MediaDeviceInfo {
  /**
   * The **`deviceId`** read-only property of the MediaDeviceInfo interface returns a string that is an identifier for the represented device and is persisted across sessions.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDeviceInfo/deviceId)
   */
  readonly deviceId: string;
  /**
   * The **`groupId`** read-only property of the MediaDeviceInfo interface returns a string that is a group identifier.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDeviceInfo/groupId)
   */
  readonly groupId: string;
  /**
   * The **`kind`** read-only property of the MediaDeviceInfo interface returns an enumerated value, that is either "videoinput", "audioinput" or "audiooutput".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDeviceInfo/kind)
   */
  readonly kind: MediaDeviceKind;
  /**
   * The **`label`** read-only property of the MediaDeviceInfo interface returns a string describing this device (for example "External USB Webcam").
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDeviceInfo/label)
   */
  readonly label: string;
  /**
   * The **`toJSON()`** method of the MediaDeviceInfo interface is a serializer; it returns a JSON representation of the MediaDeviceInfo object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDeviceInfo/toJSON)
   */
  toJSON(): any;
}

declare var MediaDeviceInfo: {
  prototype: MediaDeviceInfo;
  new (): MediaDeviceInfo;
};

interface MediaDevicesEventMap {
  devicechange: Event;
}

/**
 * The **`MediaDevices`** interface of the Media Capture and Streams API provides access to connected media input devices like cameras and microphones, as well as screen sharing. In essence, it lets you obtain access to any hardware source of media data.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDevices)
 */
interface MediaDevices extends EventTarget {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDevices/devicechange_event) */
  ondevicechange: ((this: MediaDevices, ev: Event) => any) | null;
  /**
   * The **`enumerateDevices()`** method of the MediaDevices interface requests a list of the currently available media input and output devices, such as microphones, cameras, headsets, and so forth. The returned Promise is resolved with an array of MediaDeviceInfo objects describing the devices.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDevices/enumerateDevices)
   */
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  /**
   * The **`getDisplayMedia()`** method of the MediaDevices interface prompts the user to select and grant permission to capture the contents of a display or portion thereof (such as a window) as a MediaStream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDevices/getDisplayMedia)
   */
  getDisplayMedia(options?: DisplayMediaStreamOptions): Promise<MediaStream>;
  /**
   * The **`getSupportedConstraints()`** method of the MediaDevices interface returns an object based on the MediaTrackSupportedConstraints dictionary, whose member fields each specify one of the constrainable properties the user agent understands.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDevices/getSupportedConstraints)
   */
  getSupportedConstraints(): MediaTrackSupportedConstraints;
  /**
   * The **`getUserMedia()`** method of the MediaDevices interface prompts the user for permission to use a media input which produces a MediaStream with tracks containing the requested types of media.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia)
   */
  getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
  addEventListener<K extends keyof MediaDevicesEventMap>(
    type: K,
    listener: (this: MediaDevices, ev: MediaDevicesEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MediaDevicesEventMap>(
    type: K,
    listener: (this: MediaDevices, ev: MediaDevicesEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var MediaDevices: {
  prototype: MediaDevices;
  new (): MediaDevices;
};

/**
 * The **`MediaMetadata`** interface of the Media Session API allows a web page to provide rich media metadata for display in a platform UI.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaMetadata)
 */
interface MediaMetadata {
  /**
   * The **`album`** property of the MediaMetadata interface returns or sets the name of the album or collection containing the media to be played.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaMetadata/album)
   */
  album: string;
  /**
   * The **`artist`** property of the MediaMetadata interface returns or sets the name of the artist, group, creator, etc., of the media to be played.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaMetadata/artist)
   */
  artist: string;
  /**
   * The **`artwork`** property of the MediaMetadata interface returns or sets an array of objects representing images associated with playing media.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaMetadata/artwork)
   */
  artwork: ReadonlyArray<MediaImage>;
  /**
   * The **`title`** property of the MediaMetadata interface returns or sets the title of the media to be played.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaMetadata/title)
   */
  title: string;
}

declare var MediaMetadata: {
  prototype: MediaMetadata;
  new (init?: MediaMetadataInit): MediaMetadata;
};

interface MediaRecorderEventMap {
  dataavailable: BlobEvent;
  error: ErrorEvent;
  pause: Event;
  resume: Event;
  start: Event;
  stop: Event;
}

/**
 * The **`MediaRecorder`** interface of the MediaStream Recording API provides functionality to easily record media. It is created using the MediaRecorder() constructor.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder)
 */
interface MediaRecorder extends EventTarget {
  /**
   * The **`audioBitsPerSecond`** read-only property of the MediaRecorder interface returns the audio encoding bit rate in use.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/audioBitsPerSecond)
   */
  readonly audioBitsPerSecond: number;
  /**
   * The **`mimeType`** read-only property of the MediaRecorder interface returns the MIME media type that was specified when creating the MediaRecorder object, or, if none was specified, which was chosen by the browser. This is the file format of the file that would result from writing all of the recorded data to disk.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/mimeType)
   */
  readonly mimeType: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/dataavailable_event) */
  ondataavailable: ((this: MediaRecorder, ev: BlobEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/error_event) */
  onerror: ((this: MediaRecorder, ev: ErrorEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/pause_event) */
  onpause: ((this: MediaRecorder, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/resume_event) */
  onresume: ((this: MediaRecorder, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/start_event) */
  onstart: ((this: MediaRecorder, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/stop_event) */
  onstop: ((this: MediaRecorder, ev: Event) => any) | null;
  /**
   * The **`state`** read-only property of the MediaRecorder interface returns the current state of the current MediaRecorder object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/state)
   */
  readonly state: RecordingState;
  /**
   * The **`stream`** read-only property of the MediaRecorder interface returns the stream that was passed into the MediaRecorder() constructor when the MediaRecorder was created.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/stream)
   */
  readonly stream: MediaStream;
  /**
   * The **`videoBitsPerSecond`** read-only property of the MediaRecorder interface returns the video encoding bit rate in use.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/videoBitsPerSecond)
   */
  readonly videoBitsPerSecond: number;
  /**
   * The **`pause()`** method of the MediaRecorder interface is used to pause recording of media streams.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/pause)
   */
  pause(): void;
  /**
   * The **`requestData()`** method of the MediaRecorder interface is used to raise a dataavailable event containing a Blob object of the captured media as it was when the method was called. This can then be grabbed and manipulated as you wish.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/requestData)
   */
  requestData(): void;
  /**
   * The **`resume()`** method of the MediaRecorder interface is used to resume media recording when it has been previously paused.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/resume)
   */
  resume(): void;
  /**
   * The **`start()`** method of the MediaRecorder interface begins recording media into one or more Blob objects.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/start)
   */
  start(timeslice?: number): void;
  /**
   * The **`stop()`** method of the MediaRecorder interface is used to stop media capture.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/stop)
   */
  stop(): void;
  addEventListener<K extends keyof MediaRecorderEventMap>(
    type: K,
    listener: (this: MediaRecorder, ev: MediaRecorderEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MediaRecorderEventMap>(
    type: K,
    listener: (this: MediaRecorder, ev: MediaRecorderEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var MediaRecorder: {
  prototype: MediaRecorder;
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
  /**
   * The **`isTypeSupported()`** static method of the MediaRecorder interface returns a Boolean which is true if the MIME media type specified is one the user agent should be able to successfully record.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaRecorder/isTypeSupported_static)
   */
  isTypeSupported(type: string): boolean;
};

/**
 * The **`MediaSession`** interface of the Media Session API allows a web page to provide custom behaviors for standard media playback interactions, and to report metadata that can be sent by the user agent to the device or operating system for presentation in standardized user interface elements.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSession)
 */
interface MediaSession {
  /**
   * The **`metadata`** property of the MediaSession interface contains a MediaMetadata object providing descriptive information about the currently playing media, or null if the metadata has not been set. This metadata is provided by the browser to the device for presentation in any standard media control user interface the device might offer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSession/metadata)
   */
  metadata: MediaMetadata | null;
  /**
   * The **`playbackState`** property of the MediaSession interface indicates whether the current media session is playing or paused.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSession/playbackState)
   */
  playbackState: MediaSessionPlaybackState;
  /**
   * The **`setActionHandler()`** method of the MediaSession interface sets a handler for a media session action. These actions let a web app receive notifications when the user engages a device's built-in physical or onscreen media controls, such as play, stop, or seek buttons.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSession/setActionHandler)
   */
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void;
  /**
   * The **`setCameraActive()`** method of the MediaSession interface is used to indicate to the user agent whether the user's camera is considered to be active.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSession/setCameraActive)
   */
  setCameraActive(active: boolean): Promise<void>;
  /**
   * The **`setMicrophoneActive()`** method of the MediaSession interface is used to indicate to the user agent whether the user's microphone is considered to be currently muted.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSession/setMicrophoneActive)
   */
  setMicrophoneActive(active: boolean): Promise<void>;
  /**
   * The **`setPositionState()`** method of the MediaSession interface is used to update the current document's media playback position and speed for presentation by user's device in any kind of interface that provides details about ongoing media. This can be particularly useful if your code implements a player for type of media not directly supported by the browser.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSession/setPositionState)
   */
  setPositionState(state?: MediaPositionState): void;
}

declare var MediaSession: {
  prototype: MediaSession;
  new (): MediaSession;
};

interface MediaSourceEventMap {
  sourceclose: Event;
  sourceended: Event;
  sourceopen: Event;
}

/**
 * The **`MediaSource`** interface of the Media Source Extensions API represents a source of media data for an HTMLMediaElement object. A MediaSource object can be attached to a HTMLMediaElement to be played in the user agent.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource)
 */
interface MediaSource extends EventTarget {
  /**
   * The **`activeSourceBuffers`** read-only property of the MediaSource interface returns a SourceBufferList object containing a subset of the SourceBuffer objects contained within sourceBuffers — the list of objects providing the selected video track, enabled audio tracks, and shown/hidden text tracks.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/activeSourceBuffers)
   */
  readonly activeSourceBuffers: SourceBufferList;
  /**
   * The **`duration`** property of the MediaSource interface gets and sets the duration of the current media being presented.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/duration)
   */
  duration: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/sourceclose_event) */
  onsourceclose: ((this: MediaSource, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/sourceended_event) */
  onsourceended: ((this: MediaSource, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/sourceopen_event) */
  onsourceopen: ((this: MediaSource, ev: Event) => any) | null;
  /**
   * The **`readyState`** read-only property of the MediaSource interface returns an enum representing the state of the current MediaSource. The three possible values are:
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/readyState)
   */
  readonly readyState: ReadyState;
  /**
   * The **`sourceBuffers`** read-only property of the MediaSource interface returns a SourceBufferList object containing the list of SourceBuffer objects associated with this MediaSource.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/sourceBuffers)
   */
  readonly sourceBuffers: SourceBufferList;
  /**
   * The **`addSourceBuffer()`** method of the MediaSource interface creates a new SourceBuffer of the given MIME type and adds it to the MediaSource's sourceBuffers list. The new SourceBuffer is also returned.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/addSourceBuffer)
   */
  addSourceBuffer(type: string): SourceBuffer;
  /**
   * The **`clearLiveSeekableRange()`** method of the MediaSource interface clears a seekable range previously set with a call to setLiveSeekableRange().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/clearLiveSeekableRange)
   */
  clearLiveSeekableRange(): void;
  /**
   * The **`endOfStream()`** method of the MediaSource interface signals the end of the stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/endOfStream)
   */
  endOfStream(error?: EndOfStreamError): void;
  /**
   * The **`removeSourceBuffer()`** method of the MediaSource interface removes the given SourceBuffer from the SourceBufferList associated with this MediaSource object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/removeSourceBuffer)
   */
  removeSourceBuffer(sourceBuffer: SourceBuffer): void;
  /**
   * The **`setLiveSeekableRange()`** method of the MediaSource interface sets the range that the user can seek to in the media element.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/setLiveSeekableRange)
   */
  setLiveSeekableRange(start: number, end: number): void;
  addEventListener<K extends keyof MediaSourceEventMap>(
    type: K,
    listener: (this: MediaSource, ev: MediaSourceEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MediaSourceEventMap>(
    type: K,
    listener: (this: MediaSource, ev: MediaSourceEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var MediaSource: {
  prototype: MediaSource;
  new (): MediaSource;
  /**
   * The **`canConstructInDedicatedWorker`** static property of the MediaSource interface returns true if MediaSource worker support is implemented, providing a low-latency feature detection mechanism.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/canConstructInDedicatedWorker_static)
   */
  readonly canConstructInDedicatedWorker: boolean;
  /**
   * The **`MediaSource.isTypeSupported()`** static method returns a boolean value which is true if the given MIME type and (optional) codec are likely to be supported by the current user agent.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSource/isTypeSupported_static)
   */
  isTypeSupported(type: string): boolean;
};

/**
 * The **`MediaSourceHandle`** interface of the Media Source Extensions API is a proxy for a MediaSource that can be transferred from a dedicated worker back to the main thread and attached to a media element via its HTMLMediaElement.srcObject property. MediaSource objects are not transferable because they are event targets, hence the need for MediaSourceHandles.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaSourceHandle)
 */
interface MediaSourceHandle {}

declare var MediaSourceHandle: {
  prototype: MediaSourceHandle;
  new (): MediaSourceHandle;
};

interface MediaStreamEventMap {
  addtrack: MediaStreamTrackEvent;
  removetrack: MediaStreamTrackEvent;
}

/**
 * The **`MediaStream`** interface of the Media Capture and Streams API represents a stream of media content. A stream consists of several tracks, such as video or audio tracks. Each track is specified as an instance of MediaStreamTrack.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream)
 */
interface MediaStream extends EventTarget {
  /**
   * The **`active`** read-only property of the MediaStream interface returns a Boolean value which is true if the stream is currently active; otherwise, it returns false. A stream is considered active if at least one of its MediaStreamTracks does not have its property MediaStreamTrack.readyState set to ended. Once every track has ended, the stream's active property becomes false.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream/active)
   */
  readonly active: boolean;
  /**
   * The **`id`** read-only property of the MediaStream interface is a string containing 36 characters denoting a unique identifier (GUID) for the object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream/id)
   */
  readonly id: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream/addtrack_event) */
  onaddtrack: ((this: MediaStream, ev: MediaStreamTrackEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream/removetrack_event) */
  onremovetrack: ((this: MediaStream, ev: MediaStreamTrackEvent) => any) | null;
  /**
   * The **`addTrack()`** method of the MediaStream interface adds a new track to the stream. The track is specified as a parameter of type MediaStreamTrack.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream/addTrack)
   */
  addTrack(track: MediaStreamTrack): void;
  /**
   * The **`clone()`** method of the MediaStream interface creates a duplicate of the MediaStream. This new MediaStream object has a new unique id and contains clones of every MediaStreamTrack contained by the MediaStream on which clone() was called.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream/clone)
   */
  clone(): MediaStream;
  /**
   * The **`getAudioTracks()`** method of the MediaStream interface returns a sequence that represents all the MediaStreamTrack objects in this stream's track set where MediaStreamTrack.kind is audio.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream/getAudioTracks)
   */
  getAudioTracks(): MediaStreamTrack[];
  /**
   * The **`getTrackById()`** method of the MediaStream interface returns a MediaStreamTrack object representing the track with the specified ID string. If there is no track with the specified ID, this method returns null.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream/getTrackById)
   */
  getTrackById(trackId: string): MediaStreamTrack | null;
  /**
   * The **`getTracks()`** method of the MediaStream interface returns a sequence that represents all the MediaStreamTrack objects in this stream's track set, regardless of MediaStreamTrack.kind.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream/getTracks)
   */
  getTracks(): MediaStreamTrack[];
  /**
   * The **`getVideoTracks()`** method of the MediaStream interface returns a sequence of MediaStreamTrack objects representing the video tracks in this stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream/getVideoTracks)
   */
  getVideoTracks(): MediaStreamTrack[];
  /**
   * The **`removeTrack()`** method of the MediaStream interface removes a MediaStreamTrack from a stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStream/removeTrack)
   */
  removeTrack(track: MediaStreamTrack): void;
  addEventListener<K extends keyof MediaStreamEventMap>(
    type: K,
    listener: (this: MediaStream, ev: MediaStreamEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MediaStreamEventMap>(
    type: K,
    listener: (this: MediaStream, ev: MediaStreamEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var MediaStream: {
  prototype: MediaStream;
  new (): MediaStream;
  new (stream: MediaStream): MediaStream;
  new (tracks: MediaStreamTrack[]): MediaStream;
};

/**
 * The **`MediaStreamAudioDestinationNode`** interface represents an audio destination consisting of a WebRTC MediaStream with a single AudioMediaStreamTrack, which can be used in a similar way to a MediaStream obtained from navigator.mediaDevices.getUserMedia().
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamAudioDestinationNode)
 */
interface MediaStreamAudioDestinationNode extends AudioNode {
  /**
   * The **`stream`** property of the AudioContext interface represents a MediaStream containing a single audio MediaStreamTrack with the same number of channels as the node itself.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamAudioDestinationNode/stream)
   */
  readonly stream: MediaStream;
}

declare var MediaStreamAudioDestinationNode: {
  prototype: MediaStreamAudioDestinationNode;
  new (context: AudioContext, options?: AudioNodeOptions): MediaStreamAudioDestinationNode;
};

/**
 * The **`MediaStreamAudioSourceNode`** interface is a type of AudioNode which operates as an audio source whose media is received from a MediaStream obtained using the WebRTC or Media Capture and Streams APIs.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamAudioSourceNode)
 */
interface MediaStreamAudioSourceNode extends AudioNode {
  /**
   * The MediaStreamAudioSourceNode interface's read-only **`mediaStream`** property indicates the MediaStream that contains the audio track from which the node is receiving audio.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamAudioSourceNode/mediaStream)
   */
  readonly mediaStream: MediaStream;
}

declare var MediaStreamAudioSourceNode: {
  prototype: MediaStreamAudioSourceNode;
  new (context: AudioContext, options: MediaStreamAudioSourceOptions): MediaStreamAudioSourceNode;
};

interface MediaStreamTrackEventMap {
  ended: Event;
  mute: Event;
  unmute: Event;
}

/**
 * The **`MediaStreamTrack`** interface of the Media Capture and Streams API represents a single media track within a stream; typically, these are audio or video tracks, but other track types may exist as well.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack)
 */
interface MediaStreamTrack extends EventTarget {
  /**
   * The **`contentHint`** property of the MediaStreamTrack interface is a string that hints at the type of content the track contains. Allowable values depend on the value of the MediaStreamTrack.kind property.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/contentHint)
   */
  contentHint: string;
  /**
   * The **`enabled`** property of the MediaStreamTrack interface is a Boolean value which is true if the track is allowed to render the source stream or false if it is not. This can be used to intentionally mute a track.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/enabled)
   */
  enabled: boolean;
  /**
   * The **`id`** read-only property of the MediaStreamTrack interface returns a string containing a unique identifier (GUID) for the track, which is generated by the user agent.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/id)
   */
  readonly id: string;
  /**
   * The **`kind`** read-only property of the MediaStreamTrack interface returns a string set to "audio" if the track is an audio track and to "video" if it is a video track. It doesn't change if the track is disassociated from its source.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/kind)
   */
  readonly kind: string;
  /**
   * The **`label`** read-only property of the MediaStreamTrack interface returns a string containing a user agent-assigned label that identifies the track source, as in "internal microphone".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/label)
   */
  readonly label: string;
  /**
   * The **`muted`** read-only property of the MediaStreamTrack interface returns a boolean value indicating whether or not the track is currently unable to provide media output.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/muted)
   */
  readonly muted: boolean;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/ended_event) */
  onended: ((this: MediaStreamTrack, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/mute_event) */
  onmute: ((this: MediaStreamTrack, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/unmute_event) */
  onunmute: ((this: MediaStreamTrack, ev: Event) => any) | null;
  /**
   * The **`readyState`** read-only property of the MediaStreamTrack interface returns an enumerated value giving the status of the track.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/readyState)
   */
  readonly readyState: MediaStreamTrackState;
  /**
   * The **`applyConstraints()`** method of the MediaStreamTrack interface applies a set of constraints to the track; these constraints let the website or app establish ideal values and acceptable ranges of values for the constrainable properties of the track, such as frame rate, dimensions, echo cancellation, and so forth.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/applyConstraints)
   */
  applyConstraints(constraints?: MediaTrackConstraints): Promise<void>;
  /**
   * The **`clone()`** method of the MediaStreamTrack interface creates a duplicate of the MediaStreamTrack. This new MediaStreamTrack object is identical except for its unique id.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/clone)
   */
  clone(): MediaStreamTrack;
  /**
   * The **`getCapabilities()`** method of the MediaStreamTrack interface returns an object detailing the accepted values or value range for each constrainable property of the associated MediaStreamTrack, based upon the platform and user agent.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/getCapabilities)
   */
  getCapabilities(): MediaTrackCapabilities;
  /**
   * The **`getConstraints()`** method of the MediaStreamTrack interface returns a MediaTrackConstraints object containing the set of constraints most recently established for the track using a prior call to applyConstraints(). These constraints indicate values and ranges of values that the website or application has specified are required or acceptable for the included constrainable properties.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/getConstraints)
   */
  getConstraints(): MediaTrackConstraints;
  /**
   * The **`getSettings()`** method of the MediaStreamTrack interface returns a MediaTrackSettings object containing the current values of each of the constrainable properties for the current MediaStreamTrack.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/getSettings)
   */
  getSettings(): MediaTrackSettings;
  /**
   * The **`stop()`** method of the MediaStreamTrack interface stops the track.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrack/stop)
   */
  stop(): void;
  addEventListener<K extends keyof MediaStreamTrackEventMap>(
    type: K,
    listener: (this: MediaStreamTrack, ev: MediaStreamTrackEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MediaStreamTrackEventMap>(
    type: K,
    listener: (this: MediaStreamTrack, ev: MediaStreamTrackEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var MediaStreamTrack: {
  prototype: MediaStreamTrack;
  new (): MediaStreamTrack;
};

/**
 * The **`MediaStreamTrackEvent`** interface of the Media Capture and Streams API represents events which indicate that a MediaStream has had tracks added to or removed from the stream through calls to Media Capture and Streams API methods. These events are sent to the stream when these changes occur.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrackEvent)
 */
interface MediaStreamTrackEvent extends Event {
  /**
   * The **`track`** read-only property of the MediaStreamTrackEvent interface returns the MediaStreamTrack associated with this event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrackEvent/track)
   */
  readonly track: MediaStreamTrack;
}

declare var MediaStreamTrackEvent: {
  prototype: MediaStreamTrackEvent;
  new (type: string, eventInitDict: MediaStreamTrackEventInit): MediaStreamTrackEvent;
};

/**
 * The **`MessageChannel`** interface of the Channel Messaging API allows us to create a new message channel and send data through it via its two MessagePort properties.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessageChannel)
 */
interface MessageChannel {
  /**
   * The **`port1`** read-only property of the MessageChannel interface returns the first port of the message channel — the port attached to the context that originated the channel.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessageChannel/port1)
   */
  readonly port1: MessagePort;
  /**
   * The **`port2`** read-only property of the MessageChannel interface returns the second port of the message channel — the port attached to the context at the other end of the channel, which the message is initially sent to.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessageChannel/port2)
   */
  readonly port2: MessagePort;
}

declare var MessageChannel: {
  prototype: MessageChannel;
  new (): MessageChannel;
};

/**
 * The **`MessageEvent`** interface represents a message received by a target object.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessageEvent)
 */
interface MessageEvent<T = any> extends Event {
  /**
   * The **`data`** read-only property of the MessageEvent interface represents the data sent by the message emitter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessageEvent/data)
   */
  readonly data: T;
  /**
   * The **`lastEventId`** read-only property of the MessageEvent interface is a string representing a unique ID for the event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessageEvent/lastEventId)
   */
  readonly lastEventId: string;
  /**
   * The **`origin`** read-only property of the MessageEvent interface is a string representing the origin of the message emitter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessageEvent/origin)
   */
  readonly origin: string;
  /**
   * The **`ports`** read-only property of the MessageEvent interface is an array of MessagePort objects containing all MessagePort objects sent with the message, in order.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessageEvent/ports)
   */
  readonly ports: ReadonlyArray<MessagePort>;
  /**
   * The **`source`** read-only property of the MessageEvent interface is a MessageEventSource (which can be a WindowProxy, MessagePort, or ServiceWorker object) representing the message emitter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessageEvent/source)
   */
  readonly source: MessageEventSource | null;
  /** @deprecated */
  initMessageEvent(
    type: string,
    bubbles?: boolean,
    cancelable?: boolean,
    data?: any,
    origin?: string,
    lastEventId?: string,
    source?: MessageEventSource | null,
    ports?: MessagePort[],
  ): void;
}

declare var MessageEvent: {
  prototype: MessageEvent;
  new <T>(type: string, eventInitDict?: MessageEventInit<T>): MessageEvent<T>;
};

interface MessageEvent<T = any> {
  /** @deprecated */
  initMessageEvent(
    type: string,
    bubbles?: boolean,
    cancelable?: boolean,
    data?: any,
    origin?: string,
    lastEventId?: string,
    source?: MessageEventSource | null,
    ports?: Iterable<MessagePort>,
  ): void;
}

interface MessageEventTargetEventMap {
  message: MessageEvent;
  messageerror: MessageEvent;
}

interface MessageEventTarget<T> {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/DedicatedWorkerGlobalScope/message_event) */
  onmessage: ((this: T, ev: MessageEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/DedicatedWorkerGlobalScope/messageerror_event) */
  onmessageerror: ((this: T, ev: MessageEvent) => any) | null;
  addEventListener<K extends keyof MessageEventTargetEventMap>(
    type: K,
    listener: (this: T, ev: MessageEventTargetEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MessageEventTargetEventMap>(
    type: K,
    listener: (this: T, ev: MessageEventTargetEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

interface MessagePortEventMap extends MessageEventTargetEventMap {
  message: MessageEvent;
  messageerror: MessageEvent;
}

/**
 * The **`MessagePort`** interface of the Channel Messaging API represents one of the two ports of a MessageChannel, allowing messages to be sent from one port and listening out for them arriving at the other.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessagePort)
 */
interface MessagePort extends EventTarget, MessageEventTarget<MessagePort> {
  /**
   * The **`close()`** method of the MessagePort interface disconnects the port, so it is no longer active. This stops the flow of messages to that port.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessagePort/close)
   */
  close(): void;
  /**
   * The **`postMessage()`** method of the MessagePort interface sends a message from the port, and optionally, transfers ownership of objects to other browsing contexts.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessagePort/postMessage)
   */
  postMessage(message: any, transfer: Transferable[]): void;
  postMessage(message: any, options?: StructuredSerializeOptions): void;
  /**
   * The **`start()`** method of the MessagePort interface starts the sending of messages queued on the port. This method is only needed when using EventTarget.addEventListener; it is implied when using onmessage.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MessagePort/start)
   */
  start(): void;
  addEventListener<K extends keyof MessagePortEventMap>(
    type: K,
    listener: (this: MessagePort, ev: MessagePortEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MessagePortEventMap>(
    type: K,
    listener: (this: MessagePort, ev: MessagePortEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var MessagePort: {
  prototype: MessagePort;
  new (): MessagePort;
};

interface NotificationEventMap {
  click: Event;
  close: Event;
  error: Event;
  show: Event;
}

/**
 * The **`Notification`** interface of the Notifications API is used to configure and display desktop notifications to the user.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification)
 */
interface Notification extends EventTarget {
  /**
   * The **`body`** read-only property of the Notification interface indicates the body string of the notification, as specified in the body option of the Notification() constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/body)
   */
  readonly body: string;
  /**
   * The **`data`** read-only property of the Notification interface returns a structured clone of the notification's data, as specified in the data option of the Notification() constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/data)
   */
  readonly data: any;
  /**
   * The **`dir`** read-only property of the Notification interface indicates the text direction of the notification, as specified in the dir option of the Notification() constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/dir)
   */
  readonly dir: NotificationDirection;
  /**
   * The **`icon`** read-only property of the Notification interface contains the URL of an icon to be displayed as part of the notification, as specified in the icon option of the Notification() constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/icon)
   */
  readonly icon: string;
  /**
   * The **`lang`** read-only property of the Notification interface indicates the language used in the notification, as specified in the lang option of the Notification() constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/lang)
   */
  readonly lang: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/click_event) */
  onclick: ((this: Notification, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/close_event) */
  onclose: ((this: Notification, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/error_event) */
  onerror: ((this: Notification, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/show_event) */
  onshow: ((this: Notification, ev: Event) => any) | null;
  /**
   * The **`requireInteraction`** read-only property of the Notification interface returns a boolean value indicating that a notification should remain active until the user clicks or dismisses it, rather than closing automatically.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/requireInteraction)
   */
  readonly requireInteraction: boolean;
  /**
   * The **`silent`** read-only property of the Notification interface specifies whether the notification should be silent, i.e., no sounds or vibrations should be issued regardless of the device settings. This is controlled via the silent option of the Notification() constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/silent)
   */
  readonly silent: boolean | null;
  /**
   * The **`tag`** read-only property of the Notification interface signifies an identifying tag for the notification, as specified in the tag option of the Notification() constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/tag)
   */
  readonly tag: string;
  /**
   * The **`title`** read-only property of the Notification interface indicates the title of the notification, as specified in the title parameter of the Notification() constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/title)
   */
  readonly title: string;
  /**
   * The **`close()`** method of the Notification interface is used to close/remove a previously displayed notification.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/close)
   */
  close(): void;
  addEventListener<K extends keyof NotificationEventMap>(
    type: K,
    listener: (this: Notification, ev: NotificationEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof NotificationEventMap>(
    type: K,
    listener: (this: Notification, ev: NotificationEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var Notification: {
  prototype: Notification;
  new (title: string, options?: NotificationOptions): Notification;
  /**
   * The **`permission`** read-only static property of the Notification interface indicates the current permission granted by the user for the current origin to display web notifications.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/permission_static)
   */
  readonly permission: NotificationPermission;
  /**
   * The **`requestPermission()`** static method of the Notification interface requests permission from the user for the current origin to display notifications.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Notification/requestPermission_static)
   */
  requestPermission(
    deprecatedCallback?: NotificationPermissionCallback,
  ): Promise<NotificationPermission>;
};

/**
 * The Web Audio API **`OfflineAudioCompletionEvent`** interface represents events that occur when the processing of an OfflineAudioContext is terminated. The complete event uses this interface.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OfflineAudioCompletionEvent)
 */
interface OfflineAudioCompletionEvent extends Event {
  /**
   * The **`renderedBuffer`** read-only property of the OfflineAudioCompletionEvent interface is an AudioBuffer containing the result of processing an OfflineAudioContext.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OfflineAudioCompletionEvent/renderedBuffer)
   */
  readonly renderedBuffer: AudioBuffer;
}

declare var OfflineAudioCompletionEvent: {
  prototype: OfflineAudioCompletionEvent;
  new (type: string, eventInitDict: OfflineAudioCompletionEventInit): OfflineAudioCompletionEvent;
};

interface OfflineAudioContextEventMap extends BaseAudioContextEventMap {
  complete: OfflineAudioCompletionEvent;
}

/**
 * The **`OfflineAudioContext`** interface is an AudioContext interface representing an audio-processing graph built from linked together AudioNodes. In contrast with a standard AudioContext, an OfflineAudioContext doesn't render the audio to the device hardware; instead, it generates it, as fast as it can, and outputs the result to an AudioBuffer.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OfflineAudioContext)
 */
interface OfflineAudioContext extends BaseAudioContext {
  /**
   * The **`length`** property of the OfflineAudioContext interface returns an integer representing the size of the buffer in sample-frames.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OfflineAudioContext/length)
   */
  readonly length: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/OfflineAudioContext/complete_event) */
  oncomplete: ((this: OfflineAudioContext, ev: OfflineAudioCompletionEvent) => any) | null;
  /**
   * The **`resume()`** method of the OfflineAudioContext interface resumes the progression of time in an audio context that has been suspended. The promise resolves immediately because the OfflineAudioContext does not require the audio hardware.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OfflineAudioContext/resume)
   */
  resume(): Promise<void>;
  /**
   * The **`startRendering()`** method of the OfflineAudioContext Interface starts rendering the audio graph, taking into account the current connections and the current scheduled changes.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OfflineAudioContext/startRendering)
   */
  startRendering(): Promise<AudioBuffer>;
  /**
   * The **`suspend()`** method of the OfflineAudioContext interface schedules a suspension of the time progression in the audio context at the specified time and returns a promise. This is generally useful at the time of manipulating the audio graph synchronously on OfflineAudioContext.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OfflineAudioContext/suspend)
   */
  suspend(suspendTime: number): Promise<void>;
  addEventListener<K extends keyof OfflineAudioContextEventMap>(
    type: K,
    listener: (this: OfflineAudioContext, ev: OfflineAudioContextEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof OfflineAudioContextEventMap>(
    type: K,
    listener: (this: OfflineAudioContext, ev: OfflineAudioContextEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var OfflineAudioContext: {
  prototype: OfflineAudioContext;
  new (contextOptions: OfflineAudioContextOptions): OfflineAudioContext;
  new (numberOfChannels: number, length: number, sampleRate: number): OfflineAudioContext;
};

/**
 * The **`OscillatorNode`** interface represents a periodic waveform, such as a sine wave. It is an AudioScheduledSourceNode audio-processing module that causes a specified frequency of a given wave to be created—in effect, a constant tone.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OscillatorNode)
 */
interface OscillatorNode extends AudioScheduledSourceNode {
  /**
   * The **`detune`** property of the OscillatorNode interface is an a-rate AudioParam representing detuning of oscillation in cents.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OscillatorNode/detune)
   */
  readonly detune: AudioParam;
  /**
   * The **`frequency`** property of the OscillatorNode interface is an a-rate AudioParam representing the frequency of oscillation in hertz.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OscillatorNode/frequency)
   */
  readonly frequency: AudioParam;
  /**
   * The **`type`** property of the OscillatorNode interface specifies what shape of waveform the oscillator will output. There are several common waveforms available, as well as an option to specify a custom waveform shape. The shape of the waveform will affect the tone that is produced.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OscillatorNode/type)
   */
  type: OscillatorType;
  /**
   * The **`setPeriodicWave()`** method of the OscillatorNode interface is used to point to a PeriodicWave defining a periodic waveform that can be used to shape the oscillator's output, when type is custom.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/OscillatorNode/setPeriodicWave)
   */
  setPeriodicWave(periodicWave: PeriodicWave): void;
  addEventListener<K extends keyof AudioScheduledSourceNodeEventMap>(
    type: K,
    listener: (this: OscillatorNode, ev: AudioScheduledSourceNodeEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof AudioScheduledSourceNodeEventMap>(
    type: K,
    listener: (this: OscillatorNode, ev: AudioScheduledSourceNodeEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var OscillatorNode: {
  prototype: OscillatorNode;
  new (context: BaseAudioContext, options?: OscillatorOptions): OscillatorNode;
};

/**
 * The **`PannerNode`** interface defines an audio-processing object that represents the location, direction, and behavior of an audio source signal in a simulated physical space. This AudioNode uses right-hand Cartesian coordinates to describe the source's position as a vector and its orientation as a 3D directional cone.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode)
 */
interface PannerNode extends AudioNode {
  /**
   * The **`coneInnerAngle`** property of the PannerNode interface is a double value describing the angle, in degrees, of a cone inside of which there will be no volume reduction.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/coneInnerAngle)
   */
  coneInnerAngle: number;
  /**
   * The **`coneOuterAngle`** property of the PannerNode interface is a double value describing the angle, in degrees, of a cone outside of which the volume will be reduced by a constant value, defined by the coneOuterGain property.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/coneOuterAngle)
   */
  coneOuterAngle: number;
  /**
   * The **`coneOuterGain`** property of the PannerNode interface is a double value, describing the amount of volume reduction outside the cone, defined by the coneOuterAngle attribute.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/coneOuterGain)
   */
  coneOuterGain: number;
  /**
   * The **`distanceModel`** property of the PannerNode interface is an enumerated value determining which algorithm to use to reduce the volume of the audio source as it moves away from the listener.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/distanceModel)
   */
  distanceModel: DistanceModelType;
  /**
   * The **`maxDistance`** property of the PannerNode interface is a double value representing the maximum distance between the audio source and the listener, after which the volume is not reduced any further. This value is used only by the linear distance model.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/maxDistance)
   */
  maxDistance: number;
  /**
   * The **`orientationX`** property of the PannerNode interface indicates the X (horizontal) component of the direction in which the audio source is facing, in a 3D Cartesian coordinate space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/orientationX)
   */
  readonly orientationX: AudioParam;
  /**
   * The **`orientationY`** property of the PannerNode interface indicates the Y (vertical) component of the direction the audio source is facing, in 3D Cartesian coordinate space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/orientationY)
   */
  readonly orientationY: AudioParam;
  /**
   * The **`orientationZ`** property of the PannerNode interface indicates the Z (depth) component of the direction the audio source is facing, in 3D Cartesian coordinate space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/orientationZ)
   */
  readonly orientationZ: AudioParam;
  /**
   * The **`panningModel`** property of the PannerNode interface is an enumerated value determining which spatialization algorithm to use to position the audio in 3D space.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/panningModel)
   */
  panningModel: PanningModelType;
  /**
   * The **`positionX`** property of the PannerNode interface specifies the X coordinate of the audio source's position in 3D Cartesian coordinates, corresponding to the horizontal axis (left-right).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/positionX)
   */
  readonly positionX: AudioParam;
  /**
   * The **`positionY`** property of the PannerNode interface specifies the Y coordinate of the audio source's position in 3D Cartesian coordinates, corresponding to the vertical axis (top-bottom). The complete vector is defined by the position of the audio source, given as (positionX, positionY, positionZ), and the orientation of the audio source (that is, the direction in which it's facing), given as (orientationX, orientationY, orientationZ).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/positionY)
   */
  readonly positionY: AudioParam;
  /**
   * The **`positionZ`** property of the PannerNode interface specifies the Z coordinate of the audio source's position in 3D Cartesian coordinates, corresponding to the depth axis (behind-in front of the listener). The complete vector is defined by the position of the audio source, given as (positionX, positionY, positionZ), and the orientation of the audio source (that is, the direction in which it's facing), given as (orientationX, orientationY, orientationZ).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/positionZ)
   */
  readonly positionZ: AudioParam;
  /**
   * The **`refDistance`** property of the PannerNode interface is a double value representing the reference distance for reducing volume as the audio source moves further from the listener – i.e., the distance at which the volume reduction starts taking effect. This value is used by all distance models.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/refDistance)
   */
  refDistance: number;
  /**
   * The **`rolloffFactor`** property of the PannerNode interface is a double value describing how quickly the volume is reduced as the source moves away from the listener. This value is used by all distance models. The rolloffFactor property's default value is 1.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/rolloffFactor)
   */
  rolloffFactor: number;
  /**
   * The **`setOrientation()`** method of the PannerNode Interface defines the direction the audio source is playing in.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/setOrientation)
   */
  setOrientation(x: number, y: number, z: number): void;
  /**
   * The **`setPosition()`** method of the PannerNode Interface defines the position of the audio source relative to the listener (represented by an AudioListener object stored in the BaseAudioContext.listener attribute.) The three parameters x, y and z are unitless and describe the source's position in 3D space using the right-hand Cartesian coordinate system.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PannerNode/setPosition)
   */
  setPosition(x: number, y: number, z: number): void;
}

declare var PannerNode: {
  prototype: PannerNode;
  new (context: BaseAudioContext, options?: PannerOptions): PannerNode;
};

interface PerformanceEventMap {
  resourcetimingbufferfull: Event;
}

/**
 * The **`Performance`** interface provides access to performance-related information for the current page.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance)
 */
interface Performance extends EventTarget {
  /**
   * The read-only **`performance.eventCounts`** property is an EventCounts map containing the number of events which have been dispatched per event type since the page was loaded.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/eventCounts)
   */
  readonly eventCounts: EventCounts;
  /**
   * The read-only **`performance.interactionCount`** property represents the number of real-user interactions that have occurred on the page since it was loaded.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/interactionCount)
   */
  readonly interactionCount: number;
  /**
   * The legacy **`Performance.navigation`** read-only property returns a PerformanceNavigation object representing the type of navigation that occurs in the given browsing context, such as the number of redirections needed to fetch the resource.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/navigation)
   */
  readonly navigation: PerformanceNavigation;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/resourcetimingbufferfull_event) */
  onresourcetimingbufferfull: ((this: Performance, ev: Event) => any) | null;
  /**
   * The **`timeOrigin`** read-only property of the Performance interface returns the high resolution timestamp that is used as the baseline for performance-related timestamps.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/timeOrigin)
   */
  readonly timeOrigin: DOMHighResTimeStamp;
  /**
   * The legacy **`Performance.timing`** read-only property returns a PerformanceTiming object containing latency-related performance information.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/timing)
   */
  readonly timing: PerformanceTiming;
  /**
   * The **`clearMarks()`** method removes all or specific PerformanceMark objects from the browser's performance timeline.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/clearMarks)
   */
  clearMarks(markName?: string): void;
  /**
   * The **`clearMeasures()`** method removes all or specific PerformanceMeasure objects from the browser's performance timeline.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/clearMeasures)
   */
  clearMeasures(measureName?: string): void;
  /**
   * The **`clearResourceTimings()`** method removes all performance entries with an entryType of "resource" from the browser's performance timeline and sets the size of the performance resource data buffer to zero.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/clearResourceTimings)
   */
  clearResourceTimings(): void;
  /**
   * The **`getEntries()`** method returns an array of all PerformanceEntry objects currently present in the performance timeline.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/getEntries)
   */
  getEntries(): PerformanceEntryList;
  /**
   * The **`getEntriesByName()`** method returns an array of PerformanceEntry objects currently present in the performance timeline with the given name and type.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/getEntriesByName)
   */
  getEntriesByName(name: string, type?: string): PerformanceEntryList;
  /**
   * The **`getEntriesByType()`** method returns an array of PerformanceEntry objects currently present in the performance timeline for a given type.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/getEntriesByType)
   */
  getEntriesByType(type: string): PerformanceEntryList;
  /**
   * The **`mark()`** method creates a named PerformanceMark object representing a high resolution timestamp marker in the browser's performance timeline.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/mark)
   */
  mark(markName: string, markOptions?: PerformanceMarkOptions): PerformanceMark;
  /**
   * The **`measure()`** method creates a named PerformanceMeasure object representing a time measurement between two marks in the browser's performance timeline.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/measure)
   */
  measure(
    measureName: string,
    startOrMeasureOptions?: string | PerformanceMeasureOptions,
    endMark?: string,
  ): PerformanceMeasure;
  /**
   * The **`performance.now()`** method returns a high resolution timestamp in milliseconds. It represents the time elapsed since Performance.timeOrigin (the time when navigation has started in window contexts, or the time when the worker is run in Worker and ServiceWorker contexts).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/now)
   */
  now(): DOMHighResTimeStamp;
  /**
   * The **`setResourceTimingBufferSize()`** method sets the desired size of the browser's resource timing buffer which stores the "resource" performance entries.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/setResourceTimingBufferSize)
   */
  setResourceTimingBufferSize(maxSize: number): void;
  /**
   * The **`toJSON()`** method of the Performance interface is a serializer; it returns a JSON representation of the Performance object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Performance/toJSON)
   */
  toJSON(): any;
  addEventListener<K extends keyof PerformanceEventMap>(
    type: K,
    listener: (this: Performance, ev: PerformanceEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof PerformanceEventMap>(
    type: K,
    listener: (this: Performance, ev: PerformanceEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var Performance: {
  prototype: Performance;
  new (): Performance;
};

/**
 * The **`PerformanceEntry`** object encapsulates a single performance metric that is part of the browser's performance timeline.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceEntry)
 */
interface PerformanceEntry {
  /**
   * The read-only **`duration`** property returns a timestamp that is the duration of the performance entry. The meaning of this property depends on the value of this entry's entryType.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceEntry/duration)
   */
  readonly duration: DOMHighResTimeStamp;
  /**
   * The read-only **`entryType`** property returns a string representing the type of performance metric that this entry represents.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceEntry/entryType)
   */
  readonly entryType: string;
  /**
   * The read-only **`name`** property of the PerformanceEntry interface is a string representing the name for a performance entry. It acts as an identifier, but it does not have to be unique. The value depends on the subclass.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceEntry/name)
   */
  readonly name: string;
  /**
   * The read-only **`startTime`** property returns the first timestamp recorded for this PerformanceEntry. The meaning of this property depends on the value of this entry's entryType.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceEntry/startTime)
   */
  readonly startTime: DOMHighResTimeStamp;
  /**
   * The **`toJSON()`** method is a serializer; it returns a JSON representation of the PerformanceEntry object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceEntry/toJSON)
   */
  toJSON(): any;
}

declare var PerformanceEntry: {
  prototype: PerformanceEntry;
  new (): PerformanceEntry;
};

/**
 * **`PerformanceMark`** is an interface for PerformanceEntry objects with an entryType of "mark".
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceMark)
 */
interface PerformanceMark extends PerformanceEntry {
  /**
   * The read-only **`detail`** property returns arbitrary metadata that was included in the mark upon construction (either when using performance.mark() or the PerformanceMark() constructor).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceMark/detail)
   */
  readonly detail: any;
}

declare var PerformanceMark: {
  prototype: PerformanceMark;
  new (markName: string, markOptions?: PerformanceMarkOptions): PerformanceMark;
};

/**
 * **`PerformanceMeasure`** is an abstract interface for PerformanceEntry objects with an entryType of "measure". Entries of this type are created by calling performance.measure() to add a named DOMHighResTimeStamp (the measure) between two marks to the browser's performance timeline.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceMeasure)
 */
interface PerformanceMeasure extends PerformanceEntry {
  /**
   * The read-only **`detail`** property returns arbitrary metadata that was included in the mark upon construction (when using performance.measure().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceMeasure/detail)
   */
  readonly detail: any;
}

declare var PerformanceMeasure: {
  prototype: PerformanceMeasure;
  new (): PerformanceMeasure;
};

/**
 * The legacy **`PerformanceNavigation`** interface represents information about how the navigation to the current document was done.
 * @deprecated This interface is deprecated in the Navigation Timing Level 2 specification. Please use the PerformanceNavigationTiming interface instead.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigation)
 */
interface PerformanceNavigation {
  /**
   * The legacy **`PerformanceNavigation.redirectCount`** read-only property returns an unsigned short representing the number of REDIRECTs done before reaching the page.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigation/redirectCount)
   */
  readonly redirectCount: number;
  /**
   * The legacy **`PerformanceNavigation.type`** read-only property returns an unsigned short containing a constant describing how the navigation to this page was done.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigation/type)
   */
  readonly type: number;
  /**
   * The **`toJSON()`** method of the PerformanceNavigation interface is a serializer; it returns a JSON representation of the PerformanceNavigation object.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigation/toJSON)
   */
  toJSON(): any;
  readonly TYPE_NAVIGATE: 0;
  readonly TYPE_RELOAD: 1;
  readonly TYPE_BACK_FORWARD: 2;
  readonly TYPE_RESERVED: 255;
}

/** @deprecated */
declare var PerformanceNavigation: {
  prototype: PerformanceNavigation;
  new (): PerformanceNavigation;
  readonly TYPE_NAVIGATE: 0;
  readonly TYPE_RELOAD: 1;
  readonly TYPE_BACK_FORWARD: 2;
  readonly TYPE_RESERVED: 255;
};

/**
 * The **`PerformanceNavigationTiming`** interface provides methods and properties to store and retrieve metrics regarding the browser's document navigation events. For example, this interface can be used to determine how much time it takes to load or unload a document.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming)
 */
interface PerformanceNavigationTiming extends PerformanceResourceTiming {
  /**
   * The **`domComplete`** read-only property returns a DOMHighResTimeStamp representing the time immediately before the user agent sets the document's readyState to "complete".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming/domComplete)
   */
  readonly domComplete: DOMHighResTimeStamp;
  /**
   * The **`domContentLoadedEventEnd`** read-only property returns a DOMHighResTimeStamp representing the time immediately after the current document's DOMContentLoaded event handler completes.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming/domContentLoadedEventEnd)
   */
  readonly domContentLoadedEventEnd: DOMHighResTimeStamp;
  /**
   * The **`domContentLoadedEventStart`** read-only property returns a DOMHighResTimeStamp representing the time immediately before the current document's DOMContentLoaded event handler starts.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming/domContentLoadedEventStart)
   */
  readonly domContentLoadedEventStart: DOMHighResTimeStamp;
  /**
   * The **`domInteractive`** read-only property returns a DOMHighResTimeStamp representing the time immediately before the user agent sets the document's readyState to "interactive".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming/domInteractive)
   */
  readonly domInteractive: DOMHighResTimeStamp;
  /**
   * The **`loadEventEnd`** read-only property returns a DOMHighResTimeStamp representing the time immediately after the current document's load event handler completes.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming/loadEventEnd)
   */
  readonly loadEventEnd: DOMHighResTimeStamp;
  /**
   * The **`loadEventStart`** read-only property returns a DOMHighResTimeStamp representing the time immediately before the current document's load event handler starts.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming/loadEventStart)
   */
  readonly loadEventStart: DOMHighResTimeStamp;
  /**
   * The **`redirectCount`** read-only property returns a number representing the number of redirects since the last non-redirect navigation in the current browsing context.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming/redirectCount)
   */
  readonly redirectCount: number;
  /**
   * The **`type`** read-only property returns the type of navigation.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming/type)
   */
  readonly type: NavigationTimingType;
  /**
   * The **`unloadEventEnd`** read-only property returns a DOMHighResTimeStamp representing the time immediately after the previous document's unload event handler completes.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming/unloadEventEnd)
   */
  readonly unloadEventEnd: DOMHighResTimeStamp;
  /**
   * The **`unloadEventStart`** read-only property returns a DOMHighResTimeStamp representing the time immediately before the previous document's unload event handler starts.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming/unloadEventStart)
   */
  readonly unloadEventStart: DOMHighResTimeStamp;
  /**
   * The **`toJSON()`** method of the PerformanceNavigationTiming interface is a serializer; it returns a JSON representation of the PerformanceNavigationTiming object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceNavigationTiming/toJSON)
   */
  toJSON(): any;
}

declare var PerformanceNavigationTiming: {
  prototype: PerformanceNavigationTiming;
  new (): PerformanceNavigationTiming;
};

/**
 * The **`PerformanceObserver`** interface is used to observe performance measurement events and be notified of new performance entries as they are recorded in the browser's performance timeline.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceObserver)
 */
interface PerformanceObserver {
  /**
   * The **`disconnect()`** method of the PerformanceObserver interface is used to stop the performance observer from receiving any performance entry events.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceObserver/disconnect)
   */
  disconnect(): void;
  /**
   * The **`observe()`** method of the PerformanceObserver interface is used to specify the set of performance entry types to observe.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceObserver/observe)
   */
  observe(options?: PerformanceObserverInit): void;
  /**
   * The **`takeRecords()`** method of the PerformanceObserver interface returns the current list of PerformanceEntry objects stored in the performance observer, emptying it out.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceObserver/takeRecords)
   */
  takeRecords(): PerformanceEntryList;
}

declare var PerformanceObserver: {
  prototype: PerformanceObserver;
  new (callback: PerformanceObserverCallback): PerformanceObserver;
  /**
   * The static **`supportedEntryTypes`** read-only property of the PerformanceObserver interface returns an array of the entryType values supported by the user agent.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceObserver/supportedEntryTypes_static)
   */
  readonly supportedEntryTypes: ReadonlyArray<string>;
};

/**
 * The **`PerformanceObserverEntryList`** interface is a list of performance events that were explicitly observed via the observe() method.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceObserverEntryList)
 */
interface PerformanceObserverEntryList {
  /**
   * The **`getEntries()`** method of the PerformanceObserverEntryList interface returns a list of explicitly observed performance entry objects. The list's members are determined by the set of entry types specified in the call to the observe() method. The list is available in the observer's callback function (as the first parameter in the callback).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceObserverEntryList/getEntries)
   */
  getEntries(): PerformanceEntryList;
  /**
   * The **`getEntriesByName()`** method of the PerformanceObserverEntryList interface returns a list of explicitly observed PerformanceEntry objects for a given name and entryType. The list's members are determined by the set of entry types specified in the call to the observe() method. The list is available in the observer's callback function (as the first parameter in the callback).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceObserverEntryList/getEntriesByName)
   */
  getEntriesByName(name: string, type?: string): PerformanceEntryList;
  /**
   * The **`getEntriesByType()`** method of the PerformanceObserverEntryList returns a list of explicitly observed performance entry objects for a given performance entry type. The list's members are determined by the set of entry types specified in the call to the observe() method. The list is available in the observer's callback function (as the first parameter in the callback).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceObserverEntryList/getEntriesByType)
   */
  getEntriesByType(type: string): PerformanceEntryList;
}

declare var PerformanceObserverEntryList: {
  prototype: PerformanceObserverEntryList;
  new (): PerformanceObserverEntryList;
};

/**
 * The **`PerformanceResourceTiming`** interface enables retrieval and analysis of detailed network timing data regarding the loading of an application's resources. An application can use the timing metrics to determine, for example, the length of time it takes to fetch a specific resource, such as an XMLHttpRequest, <SVG>, image, or script.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming)
 */
interface PerformanceResourceTiming extends PerformanceEntry {
  /**
   * The **`connectEnd`** read-only property returns the timestamp immediately after the browser finishes establishing the connection to the server to retrieve the resource. The timestamp value includes the time interval to establish the transport connection, as well as other time intervals such as TLS handshake and SOCKS authentication.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/connectEnd)
   */
  readonly connectEnd: DOMHighResTimeStamp;
  /**
   * The **`connectStart`** read-only property returns the timestamp immediately before the user agent starts establishing the connection to the server to retrieve the resource.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/connectStart)
   */
  readonly connectStart: DOMHighResTimeStamp;
  /**
   * The **`decodedBodySize`** read-only property returns the size (in octets) received from the fetch (HTTP or cache) of the message body after removing any applied content encoding (like gzip or Brotli). If the resource is retrieved from an application cache or local resources, it returns the size of the payload after removing any applied content encoding.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/decodedBodySize)
   */
  readonly decodedBodySize: number;
  /**
   * The **`domainLookupEnd`** read-only property returns the timestamp immediately after the browser finishes the domain-name lookup for the resource.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/domainLookupEnd)
   */
  readonly domainLookupEnd: DOMHighResTimeStamp;
  /**
   * The **`domainLookupStart`** read-only property returns the timestamp immediately before the browser starts the domain name lookup for the resource.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/domainLookupStart)
   */
  readonly domainLookupStart: DOMHighResTimeStamp;
  /**
   * The **`encodedBodySize`** read-only property represents the size (in octets) received from the fetch (HTTP or cache) of the payload body before removing any applied content encodings (like gzip or Brotli). If the resource is retrieved from an application cache or a local resource, it must return the size of the payload body before removing any applied content encoding.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/encodedBodySize)
   */
  readonly encodedBodySize: number;
  /**
   * The **`fetchStart`** read-only property represents a timestamp immediately before the browser starts to fetch the resource.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/fetchStart)
   */
  readonly fetchStart: DOMHighResTimeStamp;
  /**
   * The **`initiatorType`** read-only property is a string representing web platform feature that initiated the resource load.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/initiatorType)
   */
  readonly initiatorType: string;
  /**
   * The **`nextHopProtocol`** read-only property is a string representing the network protocol used to fetch the resource, as identified by the ALPN Protocol ID (RFC7301).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/nextHopProtocol)
   */
  readonly nextHopProtocol: string;
  /**
   * The **`redirectEnd`** read-only property returns a timestamp immediately after receiving the last byte of the response of the last redirect.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/redirectEnd)
   */
  readonly redirectEnd: DOMHighResTimeStamp;
  /**
   * The **`redirectStart`** read-only property returns a timestamp representing the start time of the fetch which that initiates the redirect.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/redirectStart)
   */
  readonly redirectStart: DOMHighResTimeStamp;
  /**
   * The **`requestStart`** read-only property returns a timestamp of the time immediately before the browser starts requesting the resource from the server, cache, or local resource. If the transport connection fails and the browser retries the request, the value returned will be the start of the retry request.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/requestStart)
   */
  readonly requestStart: DOMHighResTimeStamp;
  /**
   * The **`responseEnd`** read-only property returns a timestamp immediately after the browser receives the last byte of the resource or immediately before the transport connection is closed, whichever comes first.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/responseEnd)
   */
  readonly responseEnd: DOMHighResTimeStamp;
  /**
   * The **`responseStart`** read-only property returns a timestamp immediately after the browser receives the first byte of the response from the server, cache, or local resource.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/responseStart)
   */
  readonly responseStart: DOMHighResTimeStamp;
  /**
   * The **`responseStatus`** read-only property represents the HTTP response status code returned when fetching the resource.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/responseStatus)
   */
  readonly responseStatus: number;
  /**
   * The **`secureConnectionStart`** read-only property returns a timestamp immediately before the browser starts the handshake process to secure the current connection. If a secure connection is not used, the property returns zero.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/secureConnectionStart)
   */
  readonly secureConnectionStart: DOMHighResTimeStamp;
  /**
   * The **`serverTiming`** read-only property returns an array of PerformanceServerTiming entries containing server timing metrics.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/serverTiming)
   */
  readonly serverTiming: ReadonlyArray<PerformanceServerTiming>;
  /**
   * The **`transferSize`** read-only property represents the size (in octets) of the fetched resource. The size includes the response header fields plus the response payload body (as defined by RFC7230).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/transferSize)
   */
  readonly transferSize: number;
  /**
   * The **`workerStart`** read-only property of the PerformanceResourceTiming interface returns a DOMHighResTimeStamp immediately before dispatching the FetchEvent if a Service Worker thread is already running, or immediately before starting the Service Worker thread if it is not already running. If the resource is not intercepted by a Service Worker the property will always return 0.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/workerStart)
   */
  readonly workerStart: DOMHighResTimeStamp;
  /**
   * The **`toJSON()`** method of the PerformanceResourceTiming interface is a serializer; it returns a JSON representation of the PerformanceResourceTiming object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceResourceTiming/toJSON)
   */
  toJSON(): any;
}

declare var PerformanceResourceTiming: {
  prototype: PerformanceResourceTiming;
  new (): PerformanceResourceTiming;
};

/**
 * The **`PerformanceServerTiming`** interface surfaces server metrics that are sent with the response in the Server-Timing HTTP header.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceServerTiming)
 */
interface PerformanceServerTiming {
  /**
   * The **`description`** read-only property returns a string value of the server-specified metric description, or an empty string.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceServerTiming/description)
   */
  readonly description: string;
  /**
   * The **`duration`** read-only property returns a double that contains the server-specified metric duration (usually in milliseconds), or the value 0.0.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceServerTiming/duration)
   */
  readonly duration: DOMHighResTimeStamp;
  /**
   * The **`name`** read-only property returns a string value of the server-specified metric name.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceServerTiming/name)
   */
  readonly name: string;
  /**
   * The **`toJSON()`** method of the PerformanceServerTiming interface is a serializer; it returns a JSON representation of the PerformanceServerTiming object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceServerTiming/toJSON)
   */
  toJSON(): any;
}

declare var PerformanceServerTiming: {
  prototype: PerformanceServerTiming;
  new (): PerformanceServerTiming;
};

/**
 * The **`PerformanceTiming`** interface is a legacy interface kept for backwards compatibility and contains properties that offer performance timing information for various events which occur during the loading and use of the current page. You get a PerformanceTiming object describing your page using the window.performance.timing property.
 * @deprecated This interface is deprecated in the Navigation Timing Level 2 specification. Please use the PerformanceNavigationTiming interface instead.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming)
 */
interface PerformanceTiming {
  /**
   * The legacy **`PerformanceTiming.connectEnd`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, where the connection is opened network. If the transport layer reports an error and the connection establishment is started again, the last connection establishment end time is given. If a persistent connection is used, the value will be the same as PerformanceTiming.fetchStart. A connection is considered as opened when all secure connection handshake, or SOCKS authentication, is terminated.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/connectEnd)
   */
  readonly connectEnd: number;
  /**
   * The legacy **`PerformanceTiming.connectStart`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, where the request to open a connection is sent to the network. If the transport layer reports an error and the connection establishment is started again, the last connection establishment start time is given. If a persistent connection is used, the value will be the same as PerformanceTiming.fetchStart.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/connectStart)
   */
  readonly connectStart: number;
  /**
   * The legacy **`PerformanceTiming.domComplete`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, when the parser finished its work on the main document, that is when its Document.readyState changes to 'complete' and the corresponding readystatechange event is thrown.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/domComplete)
   */
  readonly domComplete: number;
  /**
   * The legacy **`PerformanceTiming.domContentLoadedEventEnd`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, right after all the scripts that need to be executed as soon as possible, in order or not, has been executed.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/domContentLoadedEventEnd)
   */
  readonly domContentLoadedEventEnd: number;
  /**
   * The legacy **`PerformanceTiming.domContentLoadedEventStart`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, right before the parser sent the DOMContentLoaded event, that is right after all the scripts that need to be executed right after parsing has been executed.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/domContentLoadedEventStart)
   */
  readonly domContentLoadedEventStart: number;
  /**
   * The legacy **`PerformanceTiming.domInteractive`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, when the parser finished its work on the main document, that is when its Document.readyState changes to 'interactive' and the corresponding readystatechange event is thrown.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/domInteractive)
   */
  readonly domInteractive: number;
  /**
   * The legacy **`PerformanceTiming.domLoading`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, when the parser started its work, that is when its Document.readyState changes to 'loading' and the corresponding readystatechange event is thrown.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/domLoading)
   */
  readonly domLoading: number;
  /**
   * The legacy **`PerformanceTiming.domainLookupEnd`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, where the domain lookup is finished. If a persistent connection is used, or the information is stored in a cache or a local resource, the value will be the same as PerformanceTiming.fetchStart.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/domainLookupEnd)
   */
  readonly domainLookupEnd: number;
  /**
   * The legacy **`PerformanceTiming.domainLookupStart`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, where the domain lookup starts. If a persistent connection is used, or the information is stored in a cache or a local resource, the value will be the same as PerformanceTiming.fetchStart.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/domainLookupStart)
   */
  readonly domainLookupStart: number;
  /**
   * The legacy **`PerformanceTiming.fetchStart`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, the browser is ready to fetch the document using an HTTP request. This moment is before the check to any application cache.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/fetchStart)
   */
  readonly fetchStart: number;
  /**
   * The legacy **`PerformanceTiming.loadEventEnd`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, when the load event handler terminated, that is when the load event is completed. If this event has not yet been sent, or is not yet completed, it returns 0.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/loadEventEnd)
   */
  readonly loadEventEnd: number;
  /**
   * The legacy **`PerformanceTiming.loadEventStart`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, when the load event was sent for the current document. If this event has not yet been sent, it returns 0.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/loadEventStart)
   */
  readonly loadEventStart: number;
  /**
   * The legacy **`PerformanceTiming.navigationStart`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, right after the prompt for unload terminates on the previous document in the same browsing context. If there is no previous document, this value will be the same as PerformanceTiming.fetchStart.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/navigationStart)
   */
  readonly navigationStart: number;
  /**
   * The legacy **`PerformanceTiming.redirectEnd`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, the last HTTP redirect is completed, that is when the last byte of the HTTP response has been received. If there is no redirect, or if one of the redirect is not of the same origin, the value returned is 0.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/redirectEnd)
   */
  readonly redirectEnd: number;
  /**
   * The legacy **`PerformanceTiming.redirectStart`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, the first HTTP redirect starts. If there is no redirect, or if one of the redirect is not of the same origin, the value returned is 0.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/redirectStart)
   */
  readonly redirectStart: number;
  /**
   * The legacy **`PerformanceTiming.requestStart`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, when the browser sent the request to obtain the actual document, from the server or from a cache. If the transport layer fails after the start of the request and the connection is reopened, this property will be set to the time corresponding to the new request.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/requestStart)
   */
  readonly requestStart: number;
  /**
   * The legacy **`PerformanceTiming.responseEnd`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, when the browser received the last byte of the response, or when the connection is closed if this happened first, from the server from a cache or from a local resource.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/responseEnd)
   */
  readonly responseEnd: number;
  /**
   * The legacy **`PerformanceTiming.responseStart`** read-only property returns an unsigned long long representing the moment in time (in milliseconds since the UNIX epoch) when the browser received the first byte of the response from the server, cache, or local resource.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/responseStart)
   */
  readonly responseStart: number;
  /**
   * The legacy **`PerformanceTiming.secureConnectionStart`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, where the secure connection handshake starts. If no such connection is requested, it returns 0.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/secureConnectionStart)
   */
  readonly secureConnectionStart: number;
  /**
   * The legacy **`PerformanceTiming.unloadEventEnd`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, the unload event handler finishes. If there is no previous document, or if the previous document, or one of the needed redirects, is not of the same origin, the value returned is 0.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/unloadEventEnd)
   */
  readonly unloadEventEnd: number;
  /**
   * The legacy **`PerformanceTiming.unloadEventStart`** read-only property returns an unsigned long long representing the moment, in milliseconds since the UNIX epoch, the unload event has been thrown. If there is no previous document, or if the previous document, or one of the needed redirects, is not of the same origin, the value returned is 0.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/unloadEventStart)
   */
  readonly unloadEventStart: number;
  /**
   * The legacy **`toJSON()`** method of the PerformanceTiming interface is a serializer; it returns a JSON representation of the PerformanceTiming object.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PerformanceTiming/toJSON)
   */
  toJSON(): any;
}

/** @deprecated */
declare var PerformanceTiming: {
  prototype: PerformanceTiming;
  new (): PerformanceTiming;
};

/**
 * The **`PeriodicWave`** interface defines a periodic waveform that can be used to shape the output of an OscillatorNode.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PeriodicWave)
 */
interface PeriodicWave {}

declare var PeriodicWave: {
  prototype: PeriodicWave;
  new (context: BaseAudioContext, options?: PeriodicWaveOptions): PeriodicWave;
};

interface PermissionStatusEventMap {
  change: Event;
}

/**
 * The **`PermissionStatus`** interface of the Permissions API provides the state of an object and an event handler for monitoring changes to said state.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PermissionStatus)
 */
interface PermissionStatus extends EventTarget {
  /**
   * The **`name`** read-only property of the PermissionStatus interface returns the name of a requested permission.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PermissionStatus/name)
   */
  readonly name: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/PermissionStatus/change_event) */
  onchange: ((this: PermissionStatus, ev: Event) => any) | null;
  /**
   * The **`state`** read-only property of the PermissionStatus interface returns the state of a requested permission. This property returns one of 'granted', 'denied', or 'prompt'.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PermissionStatus/state)
   */
  readonly state: PermissionState;
  addEventListener<K extends keyof PermissionStatusEventMap>(
    type: K,
    listener: (this: PermissionStatus, ev: PermissionStatusEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof PermissionStatusEventMap>(
    type: K,
    listener: (this: PermissionStatus, ev: PermissionStatusEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var PermissionStatus: {
  prototype: PermissionStatus;
  new (): PermissionStatus;
};

/**
 * The **`Permissions`** interface of the Permissions API provides the core Permission API functionality, such as methods for querying and revoking permissions
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Permissions)
 */
interface Permissions {
  /**
   * The **`query()`** method of the Permissions interface returns the state of a user permission on the global scope.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Permissions/query)
   */
  query(permissionDesc: PermissionDescriptor): Promise<PermissionStatus>;
}

declare var Permissions: {
  prototype: Permissions;
  new (): Permissions;
};

/**
 * The **`ProgressEvent`** interface represents events that measure the progress of an underlying process, like an HTTP request (e.g., an XMLHttpRequest, or the loading of the underlying resource of an <img>, <audio>, <video>, <style> or <link>).
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ProgressEvent)
 */
interface ProgressEvent<T extends EventTarget = EventTarget> extends Event {
  /**
   * The **`ProgressEvent.lengthComputable`** read-only property is a boolean flag indicating if the resource concerned by the ProgressEvent has a length that can be calculated. If not, the ProgressEvent.total property has no significant value.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ProgressEvent/lengthComputable)
   */
  readonly lengthComputable: boolean;
  /**
   * The **`ProgressEvent.loaded`** read-only property is a number indicating the size of the data already transmitted or processed. The progress ratio can be calculated by dividing the value of this property by ProgressEvent.total.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ProgressEvent/loaded)
   */
  readonly loaded: number;
  readonly target: T | null;
  /**
   * The **`ProgressEvent.total`** read-only property is a number indicating the total size of the data being transmitted or processed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ProgressEvent/total)
   */
  readonly total: number;
}

declare var ProgressEvent: {
  prototype: ProgressEvent;
  new (type: string, eventInitDict?: ProgressEventInit): ProgressEvent;
};

/**
 * The **`PublicKeyCredential`** interface provides information about a public key / private key pair, which is a credential for logging in to a service using an un-phishable and data-breach resistant asymmetric key pair instead of a password. It inherits from Credential, and is part of the Web Authentication API extension to the Credential Management API.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential)
 */
interface PublicKeyCredential extends Credential {
  /**
   * The **`authenticatorAttachment`** read-only property of the PublicKeyCredential interface is a string that indicates the general category of authenticator used during the associated navigator.credentials.create() or navigator.credentials.get() call.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/authenticatorAttachment)
   */
  readonly authenticatorAttachment: string | null;
  /**
   * The **`rawId`** read-only property of the PublicKeyCredential interface is an ArrayBuffer object containing the identifier of the credentials.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/rawId)
   */
  readonly rawId: ArrayBuffer;
  /**
   * The **`response`** read-only property of the PublicKeyCredential interface is an AuthenticatorResponse object which is sent from the authenticator to the user agent for the creation/fetching of credentials. The information contained in this response will be used by the relying party's server to verify the demand is legitimate.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/response)
   */
  readonly response: AuthenticatorResponse;
  /**
   * The **`getClientExtensionResults()`** method of the PublicKeyCredential interface returns an object mapping the identifiers of extensions requested during credential creation or authentication, and their results after processing by the user agent.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/getClientExtensionResults)
   */
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs;
  /**
   * The **`toJSON()`** method of the PublicKeyCredential interface returns a JSON type representation of a PublicKeyCredential.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/toJSON)
   */
  toJSON(): RegistrationResponseJSON | AuthenticationResponseJSON;
}

declare var PublicKeyCredential: {
  prototype: PublicKeyCredential;
  new (): PublicKeyCredential;
  /**
   * The **`getClientCapabilities()`** static method of the PublicKeyCredential interface returns a Promise that resolves with an object that can be used to check whether or not particular WebAuthn client capabilities and extensions are supported.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/getClientCapabilities_static)
   */
  getClientCapabilities(): Promise<PublicKeyCredentialClientCapabilities>;
  /**
   * The **`isConditionalMediationAvailable()`** static method of the PublicKeyCredential interface returns a Promise which resolves to true if conditional mediation is available.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/isConditionalMediationAvailable_static)
   */
  isConditionalMediationAvailable(): Promise<boolean>;
  /**
   * The **`isUserVerifyingPlatformAuthenticatorAvailable()`** static method of the PublicKeyCredential interface returns a Promise which resolves to true if a user-verifying platform authenticator is present.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/isUserVerifyingPlatformAuthenticatorAvailable_static)
   */
  isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean>;
  /**
   * The **`parseCreationOptionsFromJSON()`** static method of the PublicKeyCredential interface creates a PublicKeyCredentialCreationOptions object from a JSON representation of its properties.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/parseCreationOptionsFromJSON_static)
   */
  parseCreationOptionsFromJSON(
    options: PublicKeyCredentialCreationOptionsJSON,
  ): PublicKeyCredentialCreationOptions;
  /**
   * The **`parseRequestOptionsFromJSON()`** static method of the PublicKeyCredential interface converts a JSON type representation into a PublicKeyCredentialRequestOptions instance.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/parseRequestOptionsFromJSON_static)
   */
  parseRequestOptionsFromJSON(
    options: PublicKeyCredentialRequestOptionsJSON,
  ): PublicKeyCredentialRequestOptions;
  /**
   * The **`signalAllAcceptedCredentials()`** static method of the PublicKeyCredential interface signals to the authenticator all of the valid credential IDs that the relying party (RP) server still holds for a particular user.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/signalAllAcceptedCredentials_static)
   */
  signalAllAcceptedCredentials(options: AllAcceptedCredentialsOptions): Promise<void>;
  /**
   * The **`signalCurrentUserDetails()`** static method of the PublicKeyCredential interface signals to the authenticator that a particular user has updated their user name and/or display name on the relying party (RP) server.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/signalCurrentUserDetails_static)
   */
  signalCurrentUserDetails(options: CurrentUserDetailsOptions): Promise<void>;
  /**
   * The **`signalUnknownCredential()`** static method of the PublicKeyCredential interface signals to the authenticator that a credential ID was not recognized by the relying party (RP) server.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/signalUnknownCredential_static)
   */
  signalUnknownCredential(options: UnknownCredentialOptions): Promise<void>;
};

/**
 * The **`PushManager`** interface of the Push API provides a way to receive notifications from third-party servers as well as request URLs for push notifications.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushManager)
 */
interface PushManager {
  /**
   * The **`PushManager.getSubscription()`** method of the PushManager interface retrieves an existing push subscription.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushManager/getSubscription)
   */
  getSubscription(): Promise<PushSubscription | null>;
  /**
   * The **`permissionState()`** method of the PushManager interface returns a Promise that resolves to a string indicating the permission state of the push manager. Possible values are 'prompt', 'denied', or 'granted'.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushManager/permissionState)
   */
  permissionState(options?: PushSubscriptionOptionsInit): Promise<PermissionState>;
  /**
   * The **`subscribe()`** method of the PushManager interface subscribes to a push service.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushManager/subscribe)
   */
  subscribe(options?: PushSubscriptionOptionsInit): Promise<PushSubscription>;
}

declare var PushManager: {
  prototype: PushManager;
  new (): PushManager;
  /**
   * The **`supportedContentEncodings`** read-only static property of the PushManager interface returns an array of supported content codings that can be used to encrypt the payload of a push message.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushManager/supportedContentEncodings_static)
   */
  readonly supportedContentEncodings: ReadonlyArray<string>;
};

/**
 * The **`PushSubscription`** interface of the Push API provides a subscription's URL endpoint along with the public key and secrets that should be used for encrypting push messages to this subscription. This information must be passed to the application server, using any desired application-specific method.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushSubscription)
 */
interface PushSubscription {
  /**
   * The **`endpoint`** read-only property of the PushSubscription interface returns a string containing the endpoint associated with the push subscription.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushSubscription/endpoint)
   */
  readonly endpoint: string;
  /**
   * The **`expirationTime`** read-only property of the PushSubscription interface returns a DOMHighResTimeStamp of the subscription expiration time associated with the push subscription, if there is one, or null otherwise.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushSubscription/expirationTime)
   */
  readonly expirationTime: EpochTimeStamp | null;
  /**
   * The **`options`** read-only property of the PushSubscription interface is an object containing the options used to create the subscription.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushSubscription/options)
   */
  readonly options: PushSubscriptionOptions;
  /**
   * The **`getKey()`** method of the PushSubscription interface returns an ArrayBuffer representing a client public key, which can then be sent to a server and used in encrypting push message data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushSubscription/getKey)
   */
  getKey(name: PushEncryptionKeyName): ArrayBuffer | null;
  /**
   * The **`toJSON()`** method of the PushSubscription interface is a standard serializer: it returns a JSON representation of the subscription properties, providing a useful shortcut.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushSubscription/toJSON)
   */
  toJSON(): PushSubscriptionJSON;
  /**
   * The **`unsubscribe()`** method of the PushSubscription interface returns a Promise that resolves to a boolean value when the current subscription is successfully unsubscribed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushSubscription/unsubscribe)
   */
  unsubscribe(): Promise<boolean>;
}

declare var PushSubscription: {
  prototype: PushSubscription;
  new (): PushSubscription;
};

/**
 * The **`PushSubscriptionOptions`** interface of the Push API represents the options associated with a push subscription.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushSubscriptionOptions)
 */
interface PushSubscriptionOptions {
  /**
   * The **`applicationServerKey`** read-only property of the PushSubscriptionOptions interface contains the public key used by the push server.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushSubscriptionOptions/applicationServerKey)
   */
  readonly applicationServerKey: ArrayBuffer | null;
  /**
   * The **`userVisibleOnly`** read-only property of the PushSubscriptionOptions interface indicates if the returned push subscription will only be used for messages whose effect is made visible to the user.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PushSubscriptionOptions/userVisibleOnly)
   */
  readonly userVisibleOnly: boolean;
}

declare var PushSubscriptionOptions: {
  prototype: PushSubscriptionOptions;
  new (): PushSubscriptionOptions;
};

/**
 * The **`RTCCertificate`** interface of the WebRTC API provides an object representing a certificate that an RTCPeerConnection uses to authenticate.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCCertificate)
 */
interface RTCCertificate {
  /**
   * The read-only **`expires`** property of the RTCCertificate interface returns the expiration date of the certificate.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCCertificate/expires)
   */
  readonly expires: EpochTimeStamp;
  /**
   * The **`getFingerprints()`** method of the RTCCertificate interface is used to get an array of certificate fingerprints.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCCertificate/getFingerprints)
   */
  getFingerprints(): RTCDtlsFingerprint[];
}

declare var RTCCertificate: {
  prototype: RTCCertificate;
  new (): RTCCertificate;
};

interface RTCDTMFSenderEventMap {
  tonechange: RTCDTMFToneChangeEvent;
}

/**
 * The **`RTCDTMFSender`** interface provides a mechanism for transmitting DTMF codes on a WebRTC RTCPeerConnection. You gain access to the connection's RTCDTMFSender through the RTCRtpSender.dtmf property on the audio track you wish to send DTMF with.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDTMFSender)
 */
interface RTCDTMFSender extends EventTarget {
  /**
   * The **`canInsertDTMF`** read-only property of the RTCDTMFSender interface returns a boolean value which indicates whether the RTCDTMFSender is capable of sending DTMF tones over the RTCPeerConnection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDTMFSender/canInsertDTMF)
   */
  readonly canInsertDTMF: boolean;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDTMFSender/tonechange_event) */
  ontonechange: ((this: RTCDTMFSender, ev: RTCDTMFToneChangeEvent) => any) | null;
  /**
   * The RTCDTMFSender interface's **`toneBuffer`** property returns a string containing a list of the DTMF tones currently queued for sending to the remote peer over the RTCPeerConnection. To place tones into the buffer, call insertDTMF().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDTMFSender/toneBuffer)
   */
  readonly toneBuffer: string;
  /**
   * The **`insertDTMF()`** method of the RTCDTMFSender interface sends DTMF tones to the remote peer over the RTCPeerConnection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDTMFSender/insertDTMF)
   */
  insertDTMF(tones: string, duration?: number, interToneGap?: number): void;
  addEventListener<K extends keyof RTCDTMFSenderEventMap>(
    type: K,
    listener: (this: RTCDTMFSender, ev: RTCDTMFSenderEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof RTCDTMFSenderEventMap>(
    type: K,
    listener: (this: RTCDTMFSender, ev: RTCDTMFSenderEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var RTCDTMFSender: {
  prototype: RTCDTMFSender;
  new (): RTCDTMFSender;
};

/**
 * The **`RTCDTMFToneChangeEvent`** interface represents events sent to indicate that DTMF tones have started or finished playing. This interface is used by the tonechange event.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDTMFToneChangeEvent)
 */
interface RTCDTMFToneChangeEvent extends Event {
  /**
   * The read-only property **`RTCDTMFToneChangeEvent.tone`** returns the DTMF character which has just begun to play, or an empty string (""). if all queued tones have finished playing (that is, RTCDTMFSender.toneBuffer is empty).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDTMFToneChangeEvent/tone)
   */
  readonly tone: string;
}

declare var RTCDTMFToneChangeEvent: {
  prototype: RTCDTMFToneChangeEvent;
  new (type: string, eventInitDict?: RTCDTMFToneChangeEventInit): RTCDTMFToneChangeEvent;
};

interface RTCDataChannelEventMap {
  bufferedamountlow: Event;
  close: Event;
  closing: Event;
  error: RTCErrorEvent;
  message: MessageEvent;
  open: Event;
}

/**
 * The **`RTCDataChannel`** interface represents a network channel which can be used for bidirectional peer-to-peer transfers of arbitrary data. Every data channel is associated with an RTCPeerConnection, and each peer connection can have up to a theoretical maximum of 65,534 data channels (the actual limit may vary from browser to browser).
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel)
 */
interface RTCDataChannel extends EventTarget {
  /**
   * The property **`binaryType`** on the RTCDataChannel interface is a string which specifies the type of object which should be used to represent binary data received on the RTCDataChannel. Values allowed by the WebSocket.binaryType property are also permitted here: blob if Blob objects are being used or arraybuffer if ArrayBuffer objects are being used. The default is arraybuffer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/binaryType)
   */
  binaryType: BinaryType;
  /**
   * The read-only RTCDataChannel property **`bufferedAmount`** returns the number of bytes of data currently queued to be sent over the data channel. The queue may build up as a result of calls to the send() method. This only includes data buffered by the user agent itself; it doesn't include any framing overhead or buffering done by the operating system or network hardware.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/bufferedAmount)
   */
  readonly bufferedAmount: number;
  /**
   * The RTCDataChannel property **`bufferedAmountLowThreshold`** is used to specify the number of bytes of buffered outgoing data that is considered "low." The default value is 0. When the number of buffered outgoing bytes, as indicated by the bufferedAmount property, falls to or below this value, a bufferedamountlow event is fired. This event may be used, for example, to implement code which queues more messages to be sent whenever there's room to buffer them. Listeners may be added with onbufferedamountlow or addEventListener().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/bufferedAmountLowThreshold)
   */
  bufferedAmountLowThreshold: number;
  /**
   * The read-only RTCDataChannel property **`id`** returns an ID number (between 0 and 65,534) which uniquely identifies the RTCDataChannel. This ID is set at the time the data channel is created, either by the user agent (if RTCDataChannel.negotiated is false) or by the site or app script (if negotiated is true).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/id)
   */
  readonly id: number | null;
  /**
   * The read-only RTCDataChannel property **`label`** returns a string containing a name describing the data channel. These labels are not required to be unique.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/label)
   */
  readonly label: string;
  /**
   * The read-only RTCDataChannel property **`maxPacketLifeTime`** returns the amount of time, in milliseconds, the browser is allowed to take to attempt to transmit a message, as set when the data channel was created, or null. This limits how long the browser can continue to attempt to transmit and retransmit the message before giving up.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/maxPacketLifeTime)
   */
  readonly maxPacketLifeTime: number | null;
  /**
   * The read-only RTCDataChannel property **`maxRetransmits`** returns the maximum number of times the browser should try to retransmit a message before giving up, as set when the data channel was created, or null, which indicates that there is no maximum. This can only be set when the RTCDataChannel is created by calling RTCPeerConnection.createDataChannel(), using the maxRetransmits field in the specified options.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/maxRetransmits)
   */
  readonly maxRetransmits: number | null;
  /**
   * The read-only RTCDataChannel property **`negotiated`** indicates whether the RTCDataChannel's connection was negotiated by the Web app (true) or by the WebRTC layer (false). The default is false.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/negotiated)
   */
  readonly negotiated: boolean;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/bufferedamountlow_event) */
  onbufferedamountlow: ((this: RTCDataChannel, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/close_event) */
  onclose: ((this: RTCDataChannel, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/closing_event) */
  onclosing: ((this: RTCDataChannel, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/error_event) */
  onerror: ((this: RTCDataChannel, ev: RTCErrorEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/message_event) */
  onmessage: ((this: RTCDataChannel, ev: MessageEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/open_event) */
  onopen: ((this: RTCDataChannel, ev: Event) => any) | null;
  /**
   * The read-only RTCDataChannel property **`ordered`** indicates whether or not the data channel guarantees in-order delivery of messages; the default is true, which indicates that the data channel is indeed ordered. This is set when the RTCDataChannel is created, by setting the ordered property on the object passed as RTCPeerConnection.createDataChannel()'s options parameter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/ordered)
   */
  readonly ordered: boolean;
  /**
   * The read-only RTCDataChannel property **`protocol`** returns a string containing the name of the subprotocol in use. If no protocol was specified when the data channel was created, then this property's value is the empty string ("").
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/protocol)
   */
  readonly protocol: string;
  /**
   * The read-only RTCDataChannel property **`readyState`** returns a string which indicates the state of the data channel's underlying data connection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/readyState)
   */
  readonly readyState: RTCDataChannelState;
  /**
   * The **`RTCDataChannel.close()`** method closes the RTCDataChannel. Either peer is permitted to call this method to initiate closure of the channel.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/close)
   */
  close(): void;
  /**
   * The **`send()`** method of the RTCDataChannel interface sends data across the data channel to the remote peer. This can be done any time except during the initial process of creating the underlying transport channel. Data sent before connecting is buffered if possible (or an error occurs if it's not possible), and is also buffered if sent while the connection is closing or closed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannel/send)
   */
  send(data: string): void;
  send(data: Blob): void;
  send(data: ArrayBuffer): void;
  send(data: ArrayBufferView<ArrayBuffer>): void;
  addEventListener<K extends keyof RTCDataChannelEventMap>(
    type: K,
    listener: (this: RTCDataChannel, ev: RTCDataChannelEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof RTCDataChannelEventMap>(
    type: K,
    listener: (this: RTCDataChannel, ev: RTCDataChannelEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var RTCDataChannel: {
  prototype: RTCDataChannel;
  new (): RTCDataChannel;
};

/**
 * The **`RTCDataChannelEvent`** interface represents an event related to a specific RTCDataChannel.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannelEvent)
 */
interface RTCDataChannelEvent extends Event {
  /**
   * The read-only property **`RTCDataChannelEvent.channel`** returns the RTCDataChannel associated with the event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDataChannelEvent/channel)
   */
  readonly channel: RTCDataChannel;
}

declare var RTCDataChannelEvent: {
  prototype: RTCDataChannelEvent;
  new (type: string, eventInitDict: RTCDataChannelEventInit): RTCDataChannelEvent;
};

interface RTCDtlsTransportEventMap {
  error: RTCErrorEvent;
  statechange: Event;
}

/**
 * The **`RTCDtlsTransport`** interface provides access to information about the Datagram Transport Layer Security (DTLS) transport over which a RTCPeerConnection's RTP and RTCP packets are sent and received by its RTCRtpSender and RTCRtpReceiver objects.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDtlsTransport)
 */
interface RTCDtlsTransport extends EventTarget {
  /**
   * The **`iceTransport`** read-only property of the RTCDtlsTransport interface contains a reference to the underlying RTCIceTransport.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDtlsTransport/iceTransport)
   */
  readonly iceTransport: RTCIceTransport;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDtlsTransport/error_event) */
  onerror: ((this: RTCDtlsTransport, ev: RTCErrorEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDtlsTransport/statechange_event) */
  onstatechange: ((this: RTCDtlsTransport, ev: Event) => any) | null;
  /**
   * The **`state`** read-only property of the RTCDtlsTransport interface provides information which describes a Datagram Transport Layer Security (DTLS) transport state.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCDtlsTransport/state)
   */
  readonly state: RTCDtlsTransportState;
  getRemoteCertificates(): ArrayBuffer[];
  addEventListener<K extends keyof RTCDtlsTransportEventMap>(
    type: K,
    listener: (this: RTCDtlsTransport, ev: RTCDtlsTransportEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof RTCDtlsTransportEventMap>(
    type: K,
    listener: (this: RTCDtlsTransport, ev: RTCDtlsTransportEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var RTCDtlsTransport: {
  prototype: RTCDtlsTransport;
  new (): RTCDtlsTransport;
};

/**
 * The **`RTCError`** interface describes an error which has occurred while handling WebRTC operations. It's based upon the standard DOMException interface that describes general DOM errors.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCError)
 */
interface RTCError extends DOMException {
  /**
   * The RTCError interface's read-only **`errorDetail`** property is a string indicating the WebRTC-specific error code that occurred.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCError/errorDetail)
   */
  readonly errorDetail: RTCErrorDetailType;
  /**
   * The RTCError read-only property **`receivedAlert`** specifies the fatal DTLS error which resulted in an alert being received from the remote peer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCError/receivedAlert)
   */
  readonly receivedAlert: number | null;
  /**
   * The read-only **`sctpCauseCode`** property in an RTCError object provides the SCTP cause code explaining why the SCTP negotiation failed, if the RTCError represents an SCTP error.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCError/sctpCauseCode)
   */
  readonly sctpCauseCode: number | null;
  /**
   * The RTCError interface's read-only property **`sdpLineNumber`** specifies the line number within the SDP at which a syntax error occurred while parsing it.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCError/sdpLineNumber)
   */
  readonly sdpLineNumber: number | null;
  /**
   * The read-only **`sentAlert`** property in an RTCError object specifies the DTLS alert number occurred while sending data to the remote peer, if the error represents an outbound DTLS error.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCError/sentAlert)
   */
  readonly sentAlert: number | null;
}

declare var RTCError: {
  prototype: RTCError;
  new (init: RTCErrorInit, message?: string): RTCError;
};

/**
 * The WebRTC API's **`RTCErrorEvent`** interface represents an error sent to a WebRTC object. It's based on the standard Event interface, but adds RTC-specific information describing the error, as shown below.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCErrorEvent)
 */
interface RTCErrorEvent extends Event {
  /**
   * The read-only RTCErrorEvent property **`error`** contains an RTCError object describing the details of the error which the event is announcing.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCErrorEvent/error)
   */
  readonly error: RTCError;
}

declare var RTCErrorEvent: {
  prototype: RTCErrorEvent;
  new (type: string, eventInitDict: RTCErrorEventInit): RTCErrorEvent;
};

/**
 * The **`RTCIceCandidate`** interface—part of the WebRTC API—represents a candidate Interactive Connectivity Establishment (ICE) configuration which may be used to establish an RTCPeerConnection.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate)
 */
interface RTCIceCandidate {
  /**
   * The RTCIceCandidate interface's read-only **`address`** property is a string providing the IP address of the device which is the source of the candidate. The address is null by default if not otherwise specified.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/address)
   */
  readonly address: string | null;
  /**
   * The read-only property **`candidate`** on the RTCIceCandidate interface returns a string describing the candidate in detail. Most of the other properties of RTCIceCandidate are actually extracted from this string.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/candidate)
   */
  readonly candidate: string;
  /**
   * The read-only **`component`** property on the RTCIceCandidate interface is a string which indicates whether the candidate is an RTP or an RTCP candidate.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/component)
   */
  readonly component: RTCIceComponent | null;
  /**
   * The **`foundation`** read-only property of the RTCIceCandidate interface is a string that allows correlation of candidates from a common network path on multiple RTCIceTransport objects.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/foundation)
   */
  readonly foundation: string | null;
  /**
   * The RTCIceCandidate interface's read-only **`port`** property contains the port number on the device at the address given by RTCIceCandidate.address at which the candidate's peer can be reached.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/port)
   */
  readonly port: number | null;
  /**
   * The RTCIceCandidate interface's read-only **`priority`** property specifies the candidate's priority according to the remote peer; the higher this value is, the better the remote peer considers the candidate to be.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/priority)
   */
  readonly priority: number | null;
  /**
   * The RTCIceCandidate interface's read-only **`protocol`** property is a string which indicates whether the candidate uses UDP or TCP as its transport protocol.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/protocol)
   */
  readonly protocol: RTCIceProtocol | null;
  /**
   * The RTCIceCandidate interface's read-only **`relatedAddress`** property is a string indicating the related address of a relay or reflexive candidate.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/relatedAddress)
   */
  readonly relatedAddress: string | null;
  /**
   * The RTCIceCandidate interface's read-only **`relatedPort`** property indicates the port number of reflexive or relay candidates.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/relatedPort)
   */
  readonly relatedPort: number | null;
  /**
   * The read-only **`sdpMLineIndex`** property on the RTCIceCandidate interface is a zero-based index of the m-line describing the media associated with the candidate.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/sdpMLineIndex)
   */
  readonly sdpMLineIndex: number | null;
  /**
   * The read-only property **`sdpMid`** on the RTCIceCandidate interface returns a string specifying the media stream identification tag of the media component with which the candidate is associated. This ID uniquely identifies a given stream for the component with which the candidate is associated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/sdpMid)
   */
  readonly sdpMid: string | null;
  /**
   * The RTCIceCandidate interface's read-only **`tcpType`** property is included on TCP candidates to provide additional details about the candidate type.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/tcpType)
   */
  readonly tcpType: RTCIceTcpCandidateType | null;
  /**
   * The RTCIceCandidate interface's read-only **`type`** specifies the type of candidate the object represents.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/type)
   */
  readonly type: RTCIceCandidateType | null;
  /**
   * The read-only **`usernameFragment`** property on the RTCIceCandidate interface is a string indicating the username fragment ("ufrag") that uniquely identifies a single ICE interaction session.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/usernameFragment)
   */
  readonly usernameFragment: string | null;
  /**
   * The RTCIceCandidate method **`toJSON()`** converts the RTCIceCandidate on which it's called into JSON.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/toJSON)
   */
  toJSON(): RTCIceCandidateInit;
}

declare var RTCIceCandidate: {
  prototype: RTCIceCandidate;
  new (candidateInitDict?: RTCLocalIceCandidateInit): RTCIceCandidate;
};

/** The **`RTCIceCandidatePair`** dictionary describes a pair of ICE candidates which together comprise a description of a viable connection between two WebRTC endpoints. It is used as the return value from RTCIceTransport.getSelectedCandidatePair() to identify the currently-selected candidate pair identified by the ICE agent. */
interface RTCIceCandidatePair {
  /** The **`local`** property of the RTCIceCandidatePair dictionary specifies the RTCIceCandidate which describes the configuration of the local end of a viable WebRTC connection. */
  local: RTCIceCandidate;
  /** The **`remote`** property of the RTCIceCandidatePair dictionary specifies the RTCIceCandidate describing the configuration of the remote end of a viable WebRTC connection. */
  remote: RTCIceCandidate;
}

interface RTCIceTransportEventMap {
  gatheringstatechange: Event;
  selectedcandidatepairchange: Event;
  statechange: Event;
}

/**
 * The **`RTCIceTransport`** interface provides access to information about the ICE transport layer over which the data is being sent and received. This is particularly useful if you need to access state information about the connection.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceTransport)
 */
interface RTCIceTransport extends EventTarget {
  /**
   * The **`gatheringState`** read-only property of the RTCIceTransport interface returns a string that indicates the current gathering state of the ICE agent for this transport: "new", "gathering", or "complete".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceTransport/gatheringState)
   */
  readonly gatheringState: RTCIceGathererState;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceTransport/gatheringstatechange_event) */
  ongatheringstatechange: ((this: RTCIceTransport, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceTransport/selectedcandidatepairchange_event) */
  onselectedcandidatepairchange: ((this: RTCIceTransport, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceTransport/statechange_event) */
  onstatechange: ((this: RTCIceTransport, ev: Event) => any) | null;
  /**
   * The **`state`** read-only property of the RTCIceTransport interface returns the current state of the ICE transport, so you can determine the state of ICE gathering in which the ICE agent currently is operating.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceTransport/state)
   */
  readonly state: RTCIceTransportState;
  /**
   * The **`getSelectedCandidatePair()`** method of the RTCIceTransport interface returns an RTCIceCandidatePair object containing the current best-choice pair of ICE candidates describing the configuration of the endpoints of the transport.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceTransport/getSelectedCandidatePair)
   */
  getSelectedCandidatePair(): RTCIceCandidatePair | null;
  addEventListener<K extends keyof RTCIceTransportEventMap>(
    type: K,
    listener: (this: RTCIceTransport, ev: RTCIceTransportEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof RTCIceTransportEventMap>(
    type: K,
    listener: (this: RTCIceTransport, ev: RTCIceTransportEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var RTCIceTransport: {
  prototype: RTCIceTransport;
  new (): RTCIceTransport;
};

interface RTCPeerConnectionEventMap {
  connectionstatechange: Event;
  datachannel: RTCDataChannelEvent;
  icecandidate: RTCPeerConnectionIceEvent;
  icecandidateerror: RTCPeerConnectionIceErrorEvent;
  iceconnectionstatechange: Event;
  icegatheringstatechange: Event;
  negotiationneeded: Event;
  signalingstatechange: Event;
  track: RTCTrackEvent;
}

/**
 * The **`RTCPeerConnection`** interface represents a WebRTC connection between the local computer and a remote peer. It provides methods to connect to a remote peer, maintain and monitor the connection, and close the connection once it's no longer needed.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection)
 */
interface RTCPeerConnection extends EventTarget {
  /**
   * The **`canTrickleIceCandidates`** read-only property of the RTCPeerConnection interface returns a boolean value which indicates whether or not the remote peer can accept trickled ICE candidates.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/canTrickleIceCandidates)
   */
  readonly canTrickleIceCandidates: boolean | null;
  /**
   * The **`connectionState`** read-only property of the RTCPeerConnection interface indicates the current state of the peer connection by returning one of the following string values: new, connecting, connected, disconnected, failed, or closed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/connectionState)
   */
  readonly connectionState: RTCPeerConnectionState;
  /**
   * The **`currentLocalDescription`** read-only property of the RTCPeerConnection interface returns an RTCSessionDescription object describing the local end of the connection as it was most recently successfully negotiated since the last time the RTCPeerConnection finished negotiating and connecting to a remote peer. Also included is a list of any ICE candidates that may already have been generated by the ICE agent since the offer or answer represented by the description was first instantiated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/currentLocalDescription)
   */
  readonly currentLocalDescription: RTCSessionDescription | null;
  /**
   * The **`currentRemoteDescription`** read-only property of the RTCPeerConnection interface returns an RTCSessionDescription object describing the remote end of the connection as it was most recently successfully negotiated since the last time the RTCPeerConnection finished negotiating and connecting to a remote peer. Also included is a list of any ICE candidates that may already have been generated by the ICE agent since the offer or answer represented by the description was first instantiated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/currentRemoteDescription)
   */
  readonly currentRemoteDescription: RTCSessionDescription | null;
  /**
   * The **`iceConnectionState`** read-only property of the RTCPeerConnection interface returns a string which state of the ICE agent associated with the RTCPeerConnection: new, checking, connected, completed, failed, disconnected, and closed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/iceConnectionState)
   */
  readonly iceConnectionState: RTCIceConnectionState;
  /**
   * The **`iceGatheringState`** read-only property of the RTCPeerConnection interface returns a string that describes the overall ICE gathering state for this connection. This lets you detect, for example, when collection of ICE candidates has finished.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/iceGatheringState)
   */
  readonly iceGatheringState: RTCIceGatheringState;
  /**
   * The **`localDescription`** read-only property of the RTCPeerConnection interface returns an RTCSessionDescription describing the session for the local end of the connection. If it has not yet been set, this is null.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/localDescription)
   */
  readonly localDescription: RTCSessionDescription | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/connectionstatechange_event) */
  onconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/datachannel_event) */
  ondatachannel: ((this: RTCPeerConnection, ev: RTCDataChannelEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/icecandidate_event) */
  onicecandidate: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/icecandidateerror_event) */
  onicecandidateerror:
    | ((this: RTCPeerConnection, ev: RTCPeerConnectionIceErrorEvent) => any)
    | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/iceconnectionstatechange_event) */
  oniceconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/icegatheringstatechange_event) */
  onicegatheringstatechange: ((this: RTCPeerConnection, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/negotiationneeded_event) */
  onnegotiationneeded: ((this: RTCPeerConnection, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/signalingstatechange_event) */
  onsignalingstatechange: ((this: RTCPeerConnection, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/track_event) */
  ontrack: ((this: RTCPeerConnection, ev: RTCTrackEvent) => any) | null;
  /**
   * The **`pendingLocalDescription`** read-only property of the RTCPeerConnection interface returns an RTCSessionDescription object describing a pending configuration change for the local end of the connection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/pendingLocalDescription)
   */
  readonly pendingLocalDescription: RTCSessionDescription | null;
  /**
   * The **`pendingRemoteDescription`** read-only property of the RTCPeerConnection interface returns an RTCSessionDescription object describing a pending configuration change for the remote end of the connection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/pendingRemoteDescription)
   */
  readonly pendingRemoteDescription: RTCSessionDescription | null;
  /**
   * The **`remoteDescription`** read-only property of the RTCPeerConnection interface returns a RTCSessionDescription describing the session (which includes configuration and media information) for the remote end of the connection. If this hasn't been set yet, this is null.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/remoteDescription)
   */
  readonly remoteDescription: RTCSessionDescription | null;
  /**
   * The **`sctp`** read-only property of the RTCPeerConnection interface returns an RTCSctpTransport describing the SCTP transport over which SCTP data is being sent and received. If SCTP hasn't been negotiated, this value is null.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/sctp)
   */
  readonly sctp: RTCSctpTransport | null;
  /**
   * The **`signalingState`** read-only property of the RTCPeerConnection interface returns a string value describing the state of the signaling process on the local end of the connection while connecting or reconnecting to another peer. See Signaling in our WebRTC session lifetime page.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/signalingState)
   */
  readonly signalingState: RTCSignalingState;
  /**
   * The **`addIceCandidate()`** method of the RTCPeerConnection interface adds a new remote candidate to the connection's remote description, which describes the state of the remote end of the connection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/addIceCandidate)
   */
  addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void>;
  /** @deprecated */
  addIceCandidate(
    candidate: RTCIceCandidateInit | null,
    successCallback: VoidFunction,
    failureCallback: RTCPeerConnectionErrorCallback,
  ): Promise<void>;
  /**
   * The **`addTrack()`** method of the RTCPeerConnection interface adds a new media track to the set of tracks which will be transmitted to the other peer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/addTrack)
   */
  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender;
  /**
   * The **`addTransceiver()`** method of the RTCPeerConnection interface creates a new RTCRtpTransceiver and adds it to the set of transceivers associated with the RTCPeerConnection. Each transceiver represents a bidirectional stream, with both an RTCRtpSender and an RTCRtpReceiver associated with it.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/addTransceiver)
   */
  addTransceiver(
    trackOrKind: MediaStreamTrack | string,
    init?: RTCRtpTransceiverInit,
  ): RTCRtpTransceiver;
  /**
   * The **`close()`** method of the RTCPeerConnection interface closes the current peer connection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/close)
   */
  close(): void;
  /**
   * The **`createAnswer()`** method of the RTCPeerConnection interface creates an SDP answer to an offer received from a remote peer during the offer/answer negotiation of a WebRTC connection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/createAnswer)
   */
  createAnswer(options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit>;
  /** @deprecated */
  createAnswer(
    successCallback: RTCSessionDescriptionCallback,
    failureCallback: RTCPeerConnectionErrorCallback,
  ): Promise<void>;
  /**
   * The **`createDataChannel()`** method of the RTCPeerConnection interface creates a new channel linked with the remote peer, over which any kind of data may be transmitted. This can be useful for back-channel content, such as images, file transfer, text chat, game update packets, and so forth.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/createDataChannel)
   */
  createDataChannel(label: string, dataChannelDict?: RTCDataChannelInit): RTCDataChannel;
  /**
   * The **`createOffer()`** method of the RTCPeerConnection interface initiates the creation of an SDP offer for the purpose of starting a new WebRTC connection to a remote peer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/createOffer)
   */
  createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit>;
  /** @deprecated */
  createOffer(
    successCallback: RTCSessionDescriptionCallback,
    failureCallback: RTCPeerConnectionErrorCallback,
    options?: RTCOfferOptions,
  ): Promise<void>;
  /**
   * The **`getConfiguration()`** method of the RTCPeerConnection interface returns an object which indicates the current configuration of the RTCPeerConnection on which the method is called.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/getConfiguration)
   */
  getConfiguration(): RTCConfiguration;
  /**
   * The **`getReceivers()`** method of the RTCPeerConnection interface returns an array of RTCRtpReceiver objects, each of which represents one RTP receiver. Each RTP receiver manages the reception and decoding of data for a MediaStreamTrack on an RTCPeerConnection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/getReceivers)
   */
  getReceivers(): RTCRtpReceiver[];
  /**
   * The **`getSenders()`** method of the RTCPeerConnection interface returns an array of RTCRtpSender objects, each of which represents the RTP sender responsible for transmitting one track's data. A sender object provides methods and properties for examining and controlling the encoding and transmission of the track's data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/getSenders)
   */
  getSenders(): RTCRtpSender[];
  /**
   * The **`getStats()`** method of the RTCPeerConnection interface returns a promise which resolves with data providing statistics about either the overall connection or about the specified MediaStreamTrack.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/getStats)
   */
  getStats(selector?: MediaStreamTrack | null): Promise<RTCStatsReport>;
  /**
   * The **`getTransceivers()`** method of the RTCPeerConnection interface returns a list of the RTCRtpTransceiver objects being used to send and receive data on the connection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/getTransceivers)
   */
  getTransceivers(): RTCRtpTransceiver[];
  /**
   * The **`removeTrack()`** method of the RTCPeerConnection interface tells the local end of the connection to stop sending media from the specified track, without actually removing the corresponding RTCRtpSender from the list of senders as reported by RTCPeerConnection.getSenders(). If the track is already stopped, or is not in the connection's senders list, this method has no effect.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/removeTrack)
   */
  removeTrack(sender: RTCRtpSender): void;
  /**
   * The **`restartIce()`** method of the RTCPeerConnection interface allows a web application to request that ICE candidate gathering be redone on both ends of the connection. This simplifies the process by allowing the same method to be used by either the caller or the receiver to trigger an ICE restart.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/restartIce)
   */
  restartIce(): void;
  /**
   * The **`setConfiguration()`** method of the RTCPeerConnection interface sets the current configuration of the connection based on the values included in the specified object. This lets you change the ICE servers used by the connection and which transport policies to use.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/setConfiguration)
   */
  setConfiguration(configuration?: RTCConfiguration): void;
  /**
   * The **`setLocalDescription()`** method of the RTCPeerConnection interface changes the local description associated with the connection. This description specifies the properties of the local end of the connection, including the media format. The method takes a single parameter—the session description—and it returns a Promise which is fulfilled once the description has been changed, asynchronously.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/setLocalDescription)
   */
  setLocalDescription(description?: RTCLocalSessionDescriptionInit): Promise<void>;
  /** @deprecated */
  setLocalDescription(
    description: RTCLocalSessionDescriptionInit,
    successCallback: VoidFunction,
    failureCallback: RTCPeerConnectionErrorCallback,
  ): Promise<void>;
  /**
   * The **`setRemoteDescription()`** method of the RTCPeerConnection interface sets the specified session description as the remote peer's current offer or answer. The description specifies the properties of the remote end of the connection, including the media format. The method takes a single parameter—the session description—and it returns a Promise which is fulfilled once the description has been changed, asynchronously.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/setRemoteDescription)
   */
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  /** @deprecated */
  setRemoteDescription(
    description: RTCSessionDescriptionInit,
    successCallback: VoidFunction,
    failureCallback: RTCPeerConnectionErrorCallback,
  ): Promise<void>;
  addEventListener<K extends keyof RTCPeerConnectionEventMap>(
    type: K,
    listener: (this: RTCPeerConnection, ev: RTCPeerConnectionEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof RTCPeerConnectionEventMap>(
    type: K,
    listener: (this: RTCPeerConnection, ev: RTCPeerConnectionEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var RTCPeerConnection: {
  prototype: RTCPeerConnection;
  new (configuration?: RTCConfiguration): RTCPeerConnection;
  /**
   * The **`generateCertificate()`** static function of the RTCPeerConnection interface creates an X.509 certificate and corresponding private key, returning a promise that resolves with the new RTCCertificate once it's generated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/generateCertificate_static)
   */
  generateCertificate(keygenAlgorithm: AlgorithmIdentifier): Promise<RTCCertificate>;
};

/**
 * The **`RTCPeerConnectionIceErrorEvent`** interface—based upon the Event interface—provides details pertaining to an ICE error announced by sending an icecandidateerror event to the RTCPeerConnection object.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnectionIceErrorEvent)
 */
interface RTCPeerConnectionIceErrorEvent extends Event {
  /**
   * The RTCPeerConnectionIceErrorEvent property **`address`** is a string which indicates the local IP address being used to communicate with the STUN or TURN server during negotiations. The error which occurred involved this address.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnectionIceErrorEvent/address)
   */
  readonly address: string | null;
  readonly errorCode: number;
  readonly errorText: string;
  readonly port: number | null;
  readonly url: string;
}

declare var RTCPeerConnectionIceErrorEvent: {
  prototype: RTCPeerConnectionIceErrorEvent;
  new (
    type: string,
    eventInitDict: RTCPeerConnectionIceErrorEventInit,
  ): RTCPeerConnectionIceErrorEvent;
};

/**
 * The **`RTCPeerConnectionIceEvent`** interface represents events that occur in relation to ICE candidates with the target, usually an RTCPeerConnection.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnectionIceEvent)
 */
interface RTCPeerConnectionIceEvent extends Event {
  /**
   * The read-only **`candidate`** property of the RTCPeerConnectionIceEvent interface returns the RTCIceCandidate associated with the event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCPeerConnectionIceEvent/candidate)
   */
  readonly candidate: RTCIceCandidate | null;
}

declare var RTCPeerConnectionIceEvent: {
  prototype: RTCPeerConnectionIceEvent;
  new (type: string, eventInitDict?: RTCPeerConnectionIceEventInit): RTCPeerConnectionIceEvent;
};

/**
 * The **`RTCRtpReceiver`** interface of the WebRTC API manages the reception and decoding of data for a MediaStreamTrack on an RTCPeerConnection.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpReceiver)
 */
interface RTCRtpReceiver {
  /**
   * The **`jitterBufferTarget`** property of the RTCRtpReceiver interface is a DOMHighResTimeStamp that indicates the application's preferred duration, in milliseconds, for which the jitter buffer should hold media before playing it out.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpReceiver/jitterBufferTarget)
   */
  jitterBufferTarget: DOMHighResTimeStamp | null;
  /**
   * The **`track`** read-only property of the RTCRtpReceiver interface returns the MediaStreamTrack associated with the current RTCRtpReceiver instance.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpReceiver/track)
   */
  readonly track: MediaStreamTrack;
  /**
   * The **`transform`** property of the RTCRtpReceiver object is used to insert a transform stream (TransformStream) running in a worker thread into the receiver pipeline. This allows stream transforms to be applied to encoded video and audio frames as they arrive from the packetizer (before they are played/rendered).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpReceiver/transform)
   */
  transform: RTCRtpReceiverTransform | null;
  /**
   * The read-only **`transport`** property of an RTCRtpReceiver object provides the RTCDtlsTransport object used to interact with the underlying transport over which the receiver is exchanging Real-time Transport Control Protocol (RTCP) packets.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpReceiver/transport)
   */
  readonly transport: RTCDtlsTransport | null;
  /**
   * The **`getContributingSources()`** method of the RTCRtpReceiver interface returns an array of objects, each corresponding to one CSRC (contributing source) identifier received by the current RTCRtpReceiver in the last ten seconds.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpReceiver/getContributingSources)
   */
  getContributingSources(): RTCRtpContributingSource[];
  /**
   * The **`getParameters()`** method of the RTCRtpReceiver interface returns an object describing the current configuration for how the receiver's track is decoded.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpReceiver/getParameters)
   */
  getParameters(): RTCRtpReceiveParameters;
  /**
   * The RTCRtpReceiver method **`getStats()`** asynchronously requests an RTCStatsReport object which provides statistics about incoming traffic on the owning RTCPeerConnection, returning a Promise whose fulfillment handler will be called once the results are available.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpReceiver/getStats)
   */
  getStats(): Promise<RTCStatsReport>;
  /**
   * The **`getSynchronizationSources()`** method of the RTCRtpReceiver interface returns an array of objects, each corresponding to one SSRC (synchronization source) identifier received by the current RTCRtpReceiver in the last ten seconds.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpReceiver/getSynchronizationSources)
   */
  getSynchronizationSources(): RTCRtpSynchronizationSource[];
}

declare var RTCRtpReceiver: {
  prototype: RTCRtpReceiver;
  new (): RTCRtpReceiver;
  /**
   * The static method **`RTCRtpReceiver.getCapabilities()`** returns an object describing the codec and header extension capabilities supported by RTCRtpReceiver objects on the current device.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpReceiver/getCapabilities_static)
   */
  getCapabilities(kind: string): RTCRtpCapabilities | null;
};

/**
 * The **`RTCRtpScriptTransform`** interface of the WebRTC API is used to insert a WebRTC Encoded Transform (a TransformStream running in a worker thread) into the WebRTC sender and receiver pipelines.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpScriptTransform)
 */
interface RTCRtpScriptTransform {}

declare var RTCRtpScriptTransform: {
  prototype: RTCRtpScriptTransform;
  new (worker: Worker, options?: any, transfer?: any[]): RTCRtpScriptTransform;
};

/**
 * The **`RTCRtpSender`** interface provides the ability to control and obtain details about how a particular MediaStreamTrack is encoded and sent to a remote peer.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpSender)
 */
interface RTCRtpSender {
  /**
   * The read-only **`dtmf`** property on the RTCRtpSender interface returns a RTCDTMFSender object which can be used to send DTMF tones over the RTCPeerConnection. See Using DTMF for details on how to make use of the returned RTCDTMFSender object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpSender/dtmf)
   */
  readonly dtmf: RTCDTMFSender | null;
  /**
   * The **`track`** read-only property of the RTCRtpSender interface returns the MediaStreamTrack which is being handled by the RTCRtpSender.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpSender/track)
   */
  readonly track: MediaStreamTrack | null;
  /**
   * The **`transform`** property of the RTCRtpSender object is used to insert a transform stream (TransformStream) running in a worker thread into the sender pipeline. This allows stream transforms to be applied to encoded video and audio frames after they are output by a codec, and before they are sent.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpSender/transform)
   */
  transform: RTCRtpSenderTransform | null;
  /**
   * The read-only **`transport`** property of an RTCRtpSender object provides the RTCDtlsTransport object used to interact with the underlying transport over which the sender is exchanging Real-time Transport Control Protocol (RTCP) packets.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpSender/transport)
   */
  readonly transport: RTCDtlsTransport | null;
  /**
   * The **`getParameters()`** method of the RTCRtpSender interface returns an object describing the current configuration for how the sender's track will be encoded and transmitted to a remote RTCRtpReceiver.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpSender/getParameters)
   */
  getParameters(): RTCRtpSendParameters;
  /**
   * The RTCRtpSender method **`getStats()`** asynchronously requests an RTCStatsReport object which provides statistics about outgoing traffic on the RTCPeerConnection which owns the sender, returning a Promise which is fulfilled when the results are available.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpSender/getStats)
   */
  getStats(): Promise<RTCStatsReport>;
  /**
   * The RTCRtpSender method **`replaceTrack()`** replaces the track currently being used as the sender's source with a new MediaStreamTrack.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpSender/replaceTrack)
   */
  replaceTrack(withTrack: MediaStreamTrack | null): Promise<void>;
  /**
   * The **`setParameters()`** method of the RTCRtpSender interface applies changes the configuration of sender's track, which is the MediaStreamTrack for which the RTCRtpSender is responsible.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpSender/setParameters)
   */
  setParameters(
    parameters: RTCRtpSendParameters,
    setParameterOptions?: RTCSetParameterOptions,
  ): Promise<void>;
  /**
   * The RTCRtpSender method **`setStreams()`** associates the sender's track with the specified MediaStream objects.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpSender/setStreams)
   */
  setStreams(...streams: MediaStream[]): void;
}

declare var RTCRtpSender: {
  prototype: RTCRtpSender;
  new (): RTCRtpSender;
  /**
   * The static method **`RTCRtpSender.getCapabilities()`** returns an object describing the codec and header extension capabilities supported by the RTCRtpSender.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpSender/getCapabilities_static)
   */
  getCapabilities(kind: string): RTCRtpCapabilities | null;
};

/**
 * The WebRTC interface **`RTCRtpTransceiver`** describes a permanent pairing of an RTCRtpSender and an RTCRtpReceiver, along with some shared state.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpTransceiver)
 */
interface RTCRtpTransceiver {
  /**
   * The read-only RTCRtpTransceiver property **`currentDirection`** is a string which indicates the current negotiated directionality of the transceiver.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpTransceiver/currentDirection)
   */
  readonly currentDirection: RTCRtpTransceiverDirection | null;
  /**
   * The RTCRtpTransceiver property **`direction`** is a string that indicates the transceiver's preferred directionality.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpTransceiver/direction)
   */
  direction: RTCRtpTransceiverDirection;
  /**
   * The read-only RTCRtpTransceiver interface's **`mid`** property specifies the negotiated media ID (mid) which the local and remote peers have agreed upon to uniquely identify the stream's pairing of sender and receiver.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpTransceiver/mid)
   */
  readonly mid: string | null;
  /**
   * The read-only **`receiver`** property of WebRTC's RTCRtpTransceiver interface indicates the RTCRtpReceiver responsible for receiving and decoding incoming media data for the transceiver's stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpTransceiver/receiver)
   */
  readonly receiver: RTCRtpReceiver;
  /**
   * The read-only **`sender`** property of WebRTC's RTCRtpTransceiver interface indicates the RTCRtpSender responsible for encoding and sending outgoing media data for the transceiver's stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpTransceiver/sender)
   */
  readonly sender: RTCRtpSender;
  /**
   * The **`setCodecPreferences()`** method of the RTCRtpTransceiver interface is used to set the codecs that the transceiver allows for decoding received data, in order of decreasing preference.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpTransceiver/setCodecPreferences)
   */
  setCodecPreferences(codecs: RTCRtpCodec[]): void;
  /**
   * The **`stop()`** method in the RTCRtpTransceiver interface permanently stops the transceiver by stopping both the associated RTCRtpSender and RTCRtpReceiver.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpTransceiver/stop)
   */
  stop(): void;
}

declare var RTCRtpTransceiver: {
  prototype: RTCRtpTransceiver;
  new (): RTCRtpTransceiver;
};

interface RTCRtpTransceiver {
  /**
   * The **`setCodecPreferences()`** method of the RTCRtpTransceiver interface is used to set the codecs that the transceiver allows for decoding received data, in order of decreasing preference.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCRtpTransceiver/setCodecPreferences)
   */
  setCodecPreferences(codecs: Iterable<RTCRtpCodec>): void;
}

interface RTCSctpTransportEventMap {
  statechange: Event;
}

/**
 * The **`RTCSctpTransport`** interface provides information which describes a Stream Control Transmission Protocol (SCTP) transport. This provides information about limitations of the transport, but also provides a way to access the underlying Datagram Transport Layer Security (DTLS) transport over which SCTP packets for all of an RTCPeerConnection's data channels are sent and received.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCSctpTransport)
 */
interface RTCSctpTransport extends EventTarget {
  /**
   * The **`maxChannels`** read-only property of the RTCSctpTransport interface indicates the maximum number of RTCDataChannel objects that can be opened simultaneously.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCSctpTransport/maxChannels)
   */
  readonly maxChannels: number | null;
  /**
   * The **`maxMessageSize`** read-only property of the RTCSctpTransport interface indicates the maximum size of a message that can be sent using the RTCDataChannel.send() method.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCSctpTransport/maxMessageSize)
   */
  readonly maxMessageSize: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCSctpTransport/statechange_event) */
  onstatechange: ((this: RTCSctpTransport, ev: Event) => any) | null;
  /**
   * The **`state`** read-only property of the RTCSctpTransport interface provides information which describes a Stream Control Transmission Protocol (SCTP) transport state.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCSctpTransport/state)
   */
  readonly state: RTCSctpTransportState;
  /**
   * The **`transport`** read-only property of the RTCSctpTransport interface returns a RTCDtlsTransport object representing the DTLS transport used for the transmission and receipt of data packets.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCSctpTransport/transport)
   */
  readonly transport: RTCDtlsTransport;
  addEventListener<K extends keyof RTCSctpTransportEventMap>(
    type: K,
    listener: (this: RTCSctpTransport, ev: RTCSctpTransportEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof RTCSctpTransportEventMap>(
    type: K,
    listener: (this: RTCSctpTransport, ev: RTCSctpTransportEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var RTCSctpTransport: {
  prototype: RTCSctpTransport;
  new (): RTCSctpTransport;
};

/**
 * The **`RTCSessionDescription`** interface describes one end of a connection—or potential connection—and how it's configured. Each RTCSessionDescription consists of a description type indicating which part of the offer/answer negotiation process it describes and of the SDP descriptor of the session.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCSessionDescription)
 */
interface RTCSessionDescription {
  /**
   * The property **`RTCSessionDescription.sdp`** is a read-only string containing the SDP which describes the session.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCSessionDescription/sdp)
   */
  readonly sdp: string;
  /**
   * The property **`RTCSessionDescription.type`** is a read-only string value which describes the description's type.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCSessionDescription/type)
   */
  readonly type: RTCSdpType;
  /**
   * The **`RTCSessionDescription.toJSON()`** method generates a JSON description of the object. Both properties, type and sdp, are contained in the generated JSON.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCSessionDescription/toJSON)
   */
  toJSON(): RTCSessionDescriptionInit;
}

declare var RTCSessionDescription: {
  prototype: RTCSessionDescription;
  new (descriptionInitDict: RTCSessionDescriptionInit): RTCSessionDescription;
};

/**
 * The **`RTCStatsReport`** interface of the WebRTC API provides a statistics report for a RTCPeerConnection, RTCRtpSender, or RTCRtpReceiver.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCStatsReport)
 */
interface RTCStatsReport {
  forEach(
    callbackfn: (value: any, key: string, parent: RTCStatsReport) => void,
    thisArg?: any,
  ): void;
}

declare var RTCStatsReport: {
  prototype: RTCStatsReport;
  new (): RTCStatsReport;
};

interface RTCStatsReport extends ReadonlyMap<string, any> {}

/**
 * The WebRTC API interface **`RTCTrackEvent`** represents the track event, which is sent when a new MediaStreamTrack is added to an RTCRtpReceiver which is part of the RTCPeerConnection.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCTrackEvent)
 */
interface RTCTrackEvent extends Event {
  /**
   * The read-only **`receiver`** property of the RTCTrackEvent interface indicates the RTCRtpReceiver which is used to receive data containing media for the track to which the event refers.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCTrackEvent/receiver)
   */
  readonly receiver: RTCRtpReceiver;
  /**
   * The WebRTC API interface RTCTrackEvent's read-only **`streams`** property specifies an array of MediaStream objects, one for each of the streams that comprise the track being added to the RTCPeerConnection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCTrackEvent/streams)
   */
  readonly streams: ReadonlyArray<MediaStream>;
  /**
   * The WebRTC API interface RTCTrackEvent's read-only **`track`** property specifies the MediaStreamTrack that has been added to the RTCPeerConnection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCTrackEvent/track)
   */
  readonly track: MediaStreamTrack;
  /**
   * The WebRTC API interface RTCTrackEvent's read-only **`transceiver`** property indicates the RTCRtpTransceiver affiliated with the event's track.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCTrackEvent/transceiver)
   */
  readonly transceiver: RTCRtpTransceiver;
}

declare var RTCTrackEvent: {
  prototype: RTCTrackEvent;
  new (type: string, eventInitDict: RTCTrackEventInit): RTCTrackEvent;
};

/**
 * The **`ReadableByteStreamController`** interface of the Streams API represents a controller for a readable byte stream. It allows control of the state and internal queue of a ReadableStream with an underlying byte source, and enables efficient zero-copy transfer of data from the underlying source to a consumer when the stream's internal queue is empty.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableByteStreamController)
 */
interface ReadableByteStreamController {
  /**
   * The **`byobRequest`** read-only property of the ReadableByteStreamController interface returns the current BYOB request, or null if there are no pending requests.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableByteStreamController/byobRequest)
   */
  readonly byobRequest: ReadableStreamBYOBRequest | null;
  /**
   * The **`desiredSize`** read-only property of the ReadableByteStreamController interface returns the number of bytes required to fill the stream's internal queue to its "desired size".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableByteStreamController/desiredSize)
   */
  readonly desiredSize: number | null;
  /**
   * The **`close()`** method of the ReadableByteStreamController interface closes the associated stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableByteStreamController/close)
   */
  close(): void;
  /**
   * The **`enqueue()`** method of the ReadableByteStreamController interface enqueues a given chunk on the associated readable byte stream (the chunk is transferred into the stream's internal queues).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableByteStreamController/enqueue)
   */
  enqueue(chunk: ArrayBufferView<ArrayBuffer>): void;
  /**
   * The **`error()`** method of the ReadableByteStreamController interface causes any future interactions with the associated stream to error with the specified reason.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableByteStreamController/error)
   */
  error(e?: any): void;
}

declare var ReadableByteStreamController: {
  prototype: ReadableByteStreamController;
  new (): ReadableByteStreamController;
};

/**
 * The **`ReadableStream`** interface of the Streams API represents a readable stream of byte data. The Fetch API offers a concrete instance of a ReadableStream through the body property of a Response object.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream)
 */
interface ReadableStream<R = any> {
  /**
   * The **`locked`** read-only property of the ReadableStream interface returns whether or not the readable stream is locked to a reader.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/locked)
   */
  readonly locked: boolean;
  /**
   * The **`cancel()`** method of the ReadableStream interface returns a Promise that resolves when the stream is canceled.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/cancel)
   */
  cancel(reason?: any): Promise<void>;
  /**
   * The **`getReader()`** method of the ReadableStream interface creates a reader and locks the stream to it. While the stream is locked, no other reader can be acquired until this one is released.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/getReader)
   */
  getReader(options: { mode: "byob" }): ReadableStreamBYOBReader;
  getReader(): ReadableStreamDefaultReader<R>;
  getReader(options?: ReadableStreamGetReaderOptions): ReadableStreamReader<R>;
  /**
   * The **`pipeThrough()`** method of the ReadableStream interface provides a chainable way of piping the current stream through a transform stream or any other writable/readable pair.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/pipeThrough)
   */
  pipeThrough<T>(
    transform: ReadableWritablePair<T, R>,
    options?: StreamPipeOptions,
  ): ReadableStream<T>;
  /**
   * The **`pipeTo()`** method of the ReadableStream interface pipes the current ReadableStream to a given WritableStream and returns a Promise that fulfills when the piping process completes successfully, or rejects if any errors were encountered.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/pipeTo)
   */
  pipeTo(destination: WritableStream<R>, options?: StreamPipeOptions): Promise<void>;
  /**
   * The **`tee()`** method of the ReadableStream interface tees the current readable stream, returning a two-element array containing the two resulting branches as new ReadableStream instances.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/tee)
   */
  tee(): [ReadableStream<R>, ReadableStream<R>];
}

declare var ReadableStream: {
  prototype: ReadableStream;
  new (
    underlyingSource: UnderlyingByteSource,
    strategy?: { highWaterMark?: number },
  ): ReadableStream<Uint8Array<ArrayBuffer>>;
  new <R = any>(
    underlyingSource: UnderlyingDefaultSource<R>,
    strategy?: QueuingStrategy<R>,
  ): ReadableStream<R>;
  new <R = any>(
    underlyingSource?: UnderlyingSource<R>,
    strategy?: QueuingStrategy<R>,
  ): ReadableStream<R>;
};

interface ReadableStream<R = any> {
  [Symbol.asyncIterator](options?: ReadableStreamIteratorOptions): ReadableStreamAsyncIterator<R>;
  values(options?: ReadableStreamIteratorOptions): ReadableStreamAsyncIterator<R>;
}

/**
 * The **`ReadableStreamBYOBReader`** interface of the Streams API defines a reader for a ReadableStream that supports zero-copy reading from an underlying byte source. It is used for efficient copying from underlying sources where the data is delivered as an "anonymous" sequence of bytes, such as files.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBReader)
 */
interface ReadableStreamBYOBReader extends ReadableStreamGenericReader {
  /**
   * The **`read()`** method of the ReadableStreamBYOBReader interface is used to read data into a view on a user-supplied buffer from an associated readable byte stream. A request for data will be satisfied from the stream's internal queues if there is any data present. If the stream queues are empty, the request may be supplied as a zero-copy transfer from the underlying byte source.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBReader/read)
   */
  read<T extends Exclude<BufferSource, ArrayBuffer>>(
    view: T,
    options?: ReadableStreamBYOBReaderReadOptions,
  ): Promise<ReadableStreamReadResult<T>>;
  /**
   * The **`releaseLock()`** method of the ReadableStreamBYOBReader interface releases the reader's lock on the stream. After the lock is released, the reader is no longer active.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBReader/releaseLock)
   */
  releaseLock(): void;
}

declare var ReadableStreamBYOBReader: {
  prototype: ReadableStreamBYOBReader;
  new (stream: ReadableStream<Uint8Array<ArrayBuffer>>): ReadableStreamBYOBReader;
};

/**
 * The **`ReadableStreamBYOBRequest`** interface of the Streams API represents a "pull request" for data from an underlying source that will made as a zero-copy transfer to a consumer (bypassing the stream's internal queues).
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBRequest)
 */
interface ReadableStreamBYOBRequest {
  /**
   * The **`view`** getter property of the ReadableStreamBYOBRequest interface returns the current view.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBRequest/view)
   */
  readonly view: ArrayBufferView<ArrayBuffer> | null;
  /**
   * The **`respond()`** method of the ReadableStreamBYOBRequest interface is used to signal to the associated readable byte stream that the specified number of bytes were written into the ReadableStreamBYOBRequest.view.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBRequest/respond)
   */
  respond(bytesWritten: number): void;
  /**
   * The **`respondWithNewView()`** method of the ReadableStreamBYOBRequest interface specifies a new view that the consumer of the associated readable byte stream should write to instead of ReadableStreamBYOBRequest.view.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBRequest/respondWithNewView)
   */
  respondWithNewView(view: ArrayBufferView<ArrayBuffer>): void;
}

declare var ReadableStreamBYOBRequest: {
  prototype: ReadableStreamBYOBRequest;
  new (): ReadableStreamBYOBRequest;
};

/**
 * The **`ReadableStreamDefaultController`** interface of the Streams API represents a controller allowing control of a ReadableStream's state and internal queue. Default controllers are for streams that are not byte streams.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultController)
 */
interface ReadableStreamDefaultController<R = any> {
  /**
   * The **`desiredSize`** read-only property of the ReadableStreamDefaultController interface returns the desired size required to fill the stream's internal queue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultController/desiredSize)
   */
  readonly desiredSize: number | null;
  /**
   * The **`close()`** method of the ReadableStreamDefaultController interface closes the associated stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultController/close)
   */
  close(): void;
  /**
   * The **`enqueue()`** method of the ReadableStreamDefaultController interface enqueues a given chunk in the associated stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultController/enqueue)
   */
  enqueue(chunk: R): void;
  /**
   * The **`error()`** method of the ReadableStreamDefaultController interface causes any future interactions with the associated stream to error.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultController/error)
   */
  error(e?: any): void;
}

declare var ReadableStreamDefaultController: {
  prototype: ReadableStreamDefaultController;
  new (): ReadableStreamDefaultController;
};

/**
 * The **`ReadableStreamDefaultReader`** interface of the Streams API represents a default reader that can be used to read stream data supplied from a network (such as a fetch request).
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultReader)
 */
interface ReadableStreamDefaultReader<R = any> extends ReadableStreamGenericReader {
  /**
   * The **`read()`** method of the ReadableStreamDefaultReader interface returns a Promise providing access to the next chunk in the stream's internal queue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultReader/read)
   */
  read(): Promise<ReadableStreamReadResult<R>>;
  /**
   * The **`releaseLock()`** method of the ReadableStreamDefaultReader interface releases the reader's lock on the stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultReader/releaseLock)
   */
  releaseLock(): void;
}

declare var ReadableStreamDefaultReader: {
  prototype: ReadableStreamDefaultReader;
  new <R = any>(stream: ReadableStream<R>): ReadableStreamDefaultReader<R>;
};

interface ReadableStreamGenericReader {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBReader/closed) */
  readonly closed: Promise<void>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBReader/cancel) */
  cancel(reason?: any): Promise<void>;
}

/**
 * The **`Request`** interface of the Fetch API represents a resource request.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request)
 */
interface Request extends Body {
  /**
   * The **`cache`** read-only property of the Request interface contains the cache mode of the request. It controls how the request will interact with the browser's HTTP cache.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/cache)
   */
  readonly cache: RequestCache;
  /**
   * The **`credentials`** read-only property of the Request interface reflects the value given to the Request() constructor in the credentials option. It determines whether or not the browser sends credentials with the request, as well as whether any Set-Cookie response headers are respected.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/credentials)
   */
  readonly credentials: RequestCredentials;
  /**
   * The **`destination`** read-only property of the Request interface returns a string describing the type of content being requested.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/destination)
   */
  readonly destination: RequestDestination;
  /**
   * The **`headers`** read-only property of the Request interface contains the Headers object associated with the request.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/headers)
   */
  readonly headers: Headers;
  /**
   * The **`integrity`** read-only property of the Request interface contains the subresource integrity value of the request.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/integrity)
   */
  readonly integrity: string;
  /**
   * The **`keepalive`** read-only property of the Request interface contains the request's keepalive setting (true or false), which indicates whether the browser will keep the associated request alive if the page that initiated it is unloaded before the request is complete.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/keepalive)
   */
  readonly keepalive: boolean;
  /**
   * The **`method`** read-only property of the Request interface contains the request's method (GET, POST, etc.)
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/method)
   */
  readonly method: string;
  /**
   * The **`mode`** read-only property of the Request interface contains the mode of the request (e.g., cors, no-cors, same-origin, or navigate.) This is used to determine if cross-origin requests lead to valid responses, and which properties of the response are readable.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/mode)
   */
  readonly mode: RequestMode;
  /**
   * The **`redirect`** read-only property of the Request interface contains the mode for how redirects are handled.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/redirect)
   */
  readonly redirect: RequestRedirect;
  /**
   * The **`referrer`** read-only property of the Request interface is set by the user agent to be the referrer of the Request. (e.g., client, no-referrer, or a URL.)
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/referrer)
   */
  readonly referrer: string;
  /**
   * The **`referrerPolicy`** read-only property of the Request interface returns the referrer policy, which governs what referrer information, sent in the Referer header, should be included with the request.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/referrerPolicy)
   */
  readonly referrerPolicy: ReferrerPolicy;
  /**
   * The read-only **`signal`** property of the Request interface returns the AbortSignal associated with the request.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/signal)
   */
  readonly signal: AbortSignal;
  /**
   * The **`url`** read-only property of the Request interface contains the URL of the request.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/url)
   */
  readonly url: string;
  /**
   * The **`clone()`** method of the Request interface creates a copy of the current Request object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Request/clone)
   */
  clone(): Request;
}

declare var Request: {
  prototype: Request;
  new (input: RequestInfo | URL, init?: RequestInit): Request;
};

/**
 * The **`Response`** interface of the Fetch API represents the response to a request.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response)
 */
interface Response extends Body {
  /**
   * The **`headers`** read-only property of the Response interface contains the Headers object associated with the response.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/headers)
   */
  readonly headers: Headers;
  /**
   * The **`ok`** read-only property of the Response interface contains a Boolean stating whether the response was successful (status in the range 200-299) or not.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/ok)
   */
  readonly ok: boolean;
  /**
   * The **`redirected`** read-only property of the Response interface indicates whether or not the response is the result of a request you made which was redirected.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/redirected)
   */
  readonly redirected: boolean;
  /**
   * The **`status`** read-only property of the Response interface contains the HTTP status codes of the response.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/status)
   */
  readonly status: number;
  /**
   * The **`statusText`** read-only property of the Response interface contains the status message corresponding to the HTTP status code in Response.status.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/statusText)
   */
  readonly statusText: string;
  /**
   * The **`type`** read-only property of the Response interface contains the type of the response. The type determines whether scripts are able to access the response body and headers.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/type)
   */
  readonly type: ResponseType;
  /**
   * The **`url`** read-only property of the Response interface contains the URL of the response. The value of the url property will be the final URL obtained after any redirects.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/url)
   */
  readonly url: string;
  /**
   * The **`clone()`** method of the Response interface creates a clone of a response object, identical in every way, but stored in a different variable.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/clone)
   */
  clone(): Response;
}

declare var Response: {
  prototype: Response;
  new (body?: BodyInit | null, init?: ResponseInit): Response;
  /**
   * The **`error()`** static method of the Response interface returns a new Response object associated with a network error.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/error_static)
   */
  error(): Response;
  /**
   * The **`json()`** static method of the Response interface returns a Response that contains the provided JSON data as body, and a Content-Type header which is set to application/json. The response status, status message, and additional headers can also be set.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/json_static)
   */
  json(data: any, init?: ResponseInit): Response;
  /**
   * The **`redirect()`** static method of the Response interface returns a Response resulting in a redirect to the specified URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Response/redirect_static)
   */
  redirect(url: string | URL, status?: number): Response;
};

/**
 * The **`Scheduler`** interface of the Prioritized Task Scheduling API provides methods for scheduling prioritized tasks.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Scheduler)
 */
interface Scheduler {
  /**
   * The **`postTask()`** method of the Scheduler interface is used for adding tasks to be scheduled according to their priority.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Scheduler/postTask)
   */
  postTask(callback: SchedulerPostTaskCallback, options?: SchedulerPostTaskOptions): Promise<any>;
  /**
   * The **`yield()`** method of the Scheduler interface is used for yielding to the main thread during a task and continuing execution later, with the continuation scheduled as a prioritized task (see the Prioritized Task Scheduling API for more information). This allows long-running work to be broken up so the browser stays responsive.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Scheduler/yield)
   */
  yield(): Promise<void>;
}

declare var Scheduler: {
  prototype: Scheduler;
  new (): Scheduler;
};

interface ScreenOrientationEventMap {
  change: Event;
}

/**
 * The **`ScreenOrientation`** interface of the Screen Orientation API provides information about the current orientation of the document.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ScreenOrientation)
 */
interface ScreenOrientation extends EventTarget {
  /**
   * The **`angle`** read-only property of the ScreenOrientation interface returns the document's current orientation angle.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ScreenOrientation/angle)
   */
  readonly angle: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ScreenOrientation/change_event) */
  onchange: ((this: ScreenOrientation, ev: Event) => any) | null;
  /**
   * The **`type`** read-only property of the ScreenOrientation interface returns the document's current orientation type, one of portrait-primary, portrait-secondary, landscape-primary, or landscape-secondary.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ScreenOrientation/type)
   */
  readonly type: OrientationType;
  /**
   * The **`lock()`** method of the ScreenOrientation interface locks the orientation of the containing document to the specified orientation.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ScreenOrientation/lock)
   */
  lock(orientation: OrientationLockType): Promise<void>;
  /**
   * The **`unlock()`** method of the ScreenOrientation interface unlocks the orientation of the containing document, effectively locking it to the default screen orientation.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ScreenOrientation/unlock)
   */
  unlock(): void;
  addEventListener<K extends keyof ScreenOrientationEventMap>(
    type: K,
    listener: (this: ScreenOrientation, ev: ScreenOrientationEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof ScreenOrientationEventMap>(
    type: K,
    listener: (this: ScreenOrientation, ev: ScreenOrientationEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var ScreenOrientation: {
  prototype: ScreenOrientation;
  new (): ScreenOrientation;
};

interface ScriptProcessorNodeEventMap {
  audioprocess: AudioProcessingEvent;
}

/**
 * The **`ScriptProcessorNode`** interface allows the generation, processing, or analyzing of audio using JavaScript.
 * @deprecated As of the August 29 2014 Web Audio API spec publication, this feature has been marked as deprecated, and was replaced by AudioWorklet (see AudioWorkletNode).
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ScriptProcessorNode)
 */
interface ScriptProcessorNode extends AudioNode {
  /**
   * The **`bufferSize`** property of the ScriptProcessorNode interface returns an integer representing both the input and output buffer size, in sample-frames. Its value can be a power of 2 value in the range 256 – 16384.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ScriptProcessorNode/bufferSize)
   */
  readonly bufferSize: number;
  /**
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ScriptProcessorNode/audioprocess_event)
   */
  onaudioprocess: ((this: ScriptProcessorNode, ev: AudioProcessingEvent) => any) | null;
  addEventListener<K extends keyof ScriptProcessorNodeEventMap>(
    type: K,
    listener: (this: ScriptProcessorNode, ev: ScriptProcessorNodeEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof ScriptProcessorNodeEventMap>(
    type: K,
    listener: (this: ScriptProcessorNode, ev: ScriptProcessorNodeEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

/** @deprecated */
declare var ScriptProcessorNode: {
  prototype: ScriptProcessorNode;
  new (): ScriptProcessorNode;
};

interface ServiceWorkerEventMap extends AbstractWorkerEventMap {
  statechange: Event;
}

/**
 * The **`ServiceWorker`** interface of the Service Worker API provides a reference to a service worker. Multiple browsing contexts (e.g., pages, workers, etc.) can be associated with the same service worker, each through a unique ServiceWorker object.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ServiceWorker)
 */
interface ServiceWorker extends EventTarget, AbstractWorker {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/ServiceWorker/statechange_event) */
  onstatechange: ((this: ServiceWorker, ev: Event) => any) | null;
  /**
   * Returns the ServiceWorker serialized script URL defined as part of ServiceWorkerRegistration. Must be on the same origin as the document that registers the ServiceWorker.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ServiceWorker/scriptURL)
   */
  readonly scriptURL: string;
  /**
   * The **`state`** read-only property of the ServiceWorker interface returns a string representing the current state of the service worker. It can be one of the following values: parsed, installing, installed, activating, activated, or redundant.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ServiceWorker/state)
   */
  readonly state: ServiceWorkerState;
  /**
   * The **`postMessage()`** method of the ServiceWorker interface sends a message to the worker. The first parameter is the data to send to the worker. The data may be any JavaScript object which can be handled by the structured clone algorithm.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ServiceWorker/postMessage)
   */
  postMessage(message: any, transfer: Transferable[]): void;
  postMessage(message: any, options?: StructuredSerializeOptions): void;
  addEventListener<K extends keyof ServiceWorkerEventMap>(
    type: K,
    listener: (this: ServiceWorker, ev: ServiceWorkerEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof ServiceWorkerEventMap>(
    type: K,
    listener: (this: ServiceWorker, ev: ServiceWorkerEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var ServiceWorker: {
  prototype: ServiceWorker;
  new (): ServiceWorker;
};

interface SourceBufferEventMap {
  abort: Event;
  error: Event;
  update: Event;
  updateend: Event;
  updatestart: Event;
}

/**
 * The **`SourceBuffer`** interface represents a chunk of media to be passed into an HTMLMediaElement and played, via a MediaSource object. This can be made up of one or several media segments.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer)
 */
interface SourceBuffer extends EventTarget {
  /**
   * The **`appendWindowEnd`** property of the SourceBuffer interface controls the timestamp for the end of the append window, a timestamp range that can be used to filter what media data is appended to the SourceBuffer. Coded media frames with timestamps within this range will be appended, whereas those outside the range will be filtered out.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/appendWindowEnd)
   */
  appendWindowEnd: number;
  /**
   * The **`appendWindowStart`** property of the SourceBuffer interface controls the timestamp for the start of the append window, a timestamp range that can be used to filter what media data is appended to the SourceBuffer. Coded media frames with timestamps within this range will be appended, whereas those outside the range will be filtered out.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/appendWindowStart)
   */
  appendWindowStart: number;
  /**
   * The **`buffered`** read-only property of the SourceBuffer interface returns the time ranges that are currently buffered in the SourceBuffer as a normalized TimeRanges object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/buffered)
   */
  readonly buffered: TimeRanges;
  /**
   * The **`mode`** property of the SourceBuffer interface controls whether media segments can be appended to the SourceBuffer in any order, or in a strict sequence.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/mode)
   */
  mode: AppendMode;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/abort_event) */
  onabort: ((this: SourceBuffer, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/error_event) */
  onerror: ((this: SourceBuffer, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/update_event) */
  onupdate: ((this: SourceBuffer, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/updateend_event) */
  onupdateend: ((this: SourceBuffer, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/updatestart_event) */
  onupdatestart: ((this: SourceBuffer, ev: Event) => any) | null;
  /**
   * The **`timestampOffset`** property of the SourceBuffer interface controls the offset applied to timestamps inside media segments that are appended to the SourceBuffer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/timestampOffset)
   */
  timestampOffset: number;
  /**
   * The **`updating`** read-only property of the SourceBuffer interface indicates whether the SourceBuffer is currently being updated — i.e., whether an appendBuffer() or remove() operation is currently in progress.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/updating)
   */
  readonly updating: boolean;
  /**
   * The **`abort()`** method of the SourceBuffer interface aborts the current segment and resets the segment parser.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/abort)
   */
  abort(): void;
  /**
   * The **`appendBuffer()`** method of the SourceBuffer interface appends media segment data from an ArrayBuffer, a TypedArray or a DataView object to the SourceBuffer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/appendBuffer)
   */
  appendBuffer(data: BufferSource): void;
  /**
   * The **`changeType()`** method of the SourceBuffer interface sets the MIME type that future calls to appendBuffer() should expect the new media data to conform to. This makes it possible to change codecs or container type mid-stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/changeType)
   */
  changeType(type: string): void;
  /**
   * The **`remove()`** method of the SourceBuffer interface removes media segments within a specific time range from the SourceBuffer. This method can only be called when SourceBuffer.updating equals false. If SourceBuffer.updating is not equal to false, call SourceBuffer.abort().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBuffer/remove)
   */
  remove(start: number, end: number): void;
  addEventListener<K extends keyof SourceBufferEventMap>(
    type: K,
    listener: (this: SourceBuffer, ev: SourceBufferEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof SourceBufferEventMap>(
    type: K,
    listener: (this: SourceBuffer, ev: SourceBufferEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var SourceBuffer: {
  prototype: SourceBuffer;
  new (): SourceBuffer;
};

interface SourceBufferListEventMap {
  addsourcebuffer: Event;
  removesourcebuffer: Event;
}

/**
 * The **`SourceBufferList`** interface represents a simple container list for multiple SourceBuffer objects.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBufferList)
 */
interface SourceBufferList extends EventTarget {
  /**
   * The **`length`** read-only property of the SourceBufferList interface returns the number of SourceBuffer objects in the list.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SourceBufferList/length)
   */
  readonly length: number;
  onaddsourcebuffer: ((this: SourceBufferList, ev: Event) => any) | null;
  onremovesourcebuffer: ((this: SourceBufferList, ev: Event) => any) | null;
  addEventListener<K extends keyof SourceBufferListEventMap>(
    type: K,
    listener: (this: SourceBufferList, ev: SourceBufferListEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof SourceBufferListEventMap>(
    type: K,
    listener: (this: SourceBufferList, ev: SourceBufferListEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  [index: number]: SourceBuffer;
}

declare var SourceBufferList: {
  prototype: SourceBufferList;
  new (): SourceBufferList;
};

interface SourceBufferList {
  [Symbol.iterator](): ArrayIterator<SourceBuffer>;
}

interface SpeechSynthesisEventMap {
  voiceschanged: Event;
}

/**
 * The **`SpeechSynthesis`** interface of the Web Speech API is the controller interface for the speech service; this can be used to retrieve information about the synthesis voices available on the device, start and pause speech, and other commands besides.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis)
 */
interface SpeechSynthesis extends EventTarget {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis/voiceschanged_event) */
  onvoiceschanged: ((this: SpeechSynthesis, ev: Event) => any) | null;
  /**
   * The **`paused`** read-only property of the SpeechSynthesis interface is a boolean value that returns true if the SpeechSynthesis object is in a paused state, or false if not.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis/paused)
   */
  readonly paused: boolean;
  /**
   * The **`pending`** read-only property of the SpeechSynthesis interface is a boolean value that returns true if the utterance queue contains as-yet-unspoken utterances.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis/pending)
   */
  readonly pending: boolean;
  /**
   * The **`speaking`** read-only property of the SpeechSynthesis interface is a boolean value that returns true if an utterance is currently in the process of being spoken — even if SpeechSynthesis is in a paused state.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis/speaking)
   */
  readonly speaking: boolean;
  /**
   * The **`cancel()`** method of the SpeechSynthesis interface removes all utterances from the utterance queue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis/cancel)
   */
  cancel(): void;
  /**
   * The **`getVoices()`** method of the SpeechSynthesis interface returns a list of SpeechSynthesisVoice objects representing all the available voices on the current device.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis/getVoices)
   */
  getVoices(): SpeechSynthesisVoice[];
  /**
   * The **`pause()`** method of the SpeechSynthesis interface puts the SpeechSynthesis object into a paused state.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis/pause)
   */
  pause(): void;
  /**
   * The **`resume()`** method of the SpeechSynthesis interface puts the SpeechSynthesis object into a non-paused state: resumes it if it was already paused.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis/resume)
   */
  resume(): void;
  /**
   * The **`speak()`** method of the SpeechSynthesis interface adds an utterance to the utterance queue; it will be spoken when any other utterances queued before it have been spoken.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesis/speak)
   */
  speak(utterance: SpeechSynthesisUtterance): void;
  addEventListener<K extends keyof SpeechSynthesisEventMap>(
    type: K,
    listener: (this: SpeechSynthesis, ev: SpeechSynthesisEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof SpeechSynthesisEventMap>(
    type: K,
    listener: (this: SpeechSynthesis, ev: SpeechSynthesisEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var SpeechSynthesis: {
  prototype: SpeechSynthesis;
  new (): SpeechSynthesis;
};

/**
 * The **`SpeechSynthesisErrorEvent`** interface of the Web Speech API contains information about any errors that occur while processing SpeechSynthesisUtterance objects in the speech service.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisErrorEvent)
 */
interface SpeechSynthesisErrorEvent extends SpeechSynthesisEvent {
  /**
   * The **`error`** property of the SpeechSynthesisErrorEvent interface returns an error code indicating what has gone wrong with a speech synthesis attempt.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisErrorEvent/error)
   */
  readonly error: SpeechSynthesisErrorCode;
}

declare var SpeechSynthesisErrorEvent: {
  prototype: SpeechSynthesisErrorEvent;
  new (type: string, eventInitDict: SpeechSynthesisErrorEventInit): SpeechSynthesisErrorEvent;
};

/**
 * The **`SpeechSynthesisEvent`** interface of the Web Speech API contains information about the current state of SpeechSynthesisUtterance objects that have been processed in the speech service.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisEvent)
 */
interface SpeechSynthesisEvent extends Event {
  /**
   * The **`charIndex`** read-only property of the SpeechSynthesisUtterance interface returns the index position of the character in SpeechSynthesisUtterance.text that was being spoken when the event was triggered.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisEvent/charIndex)
   */
  readonly charIndex: number;
  /**
   * The read-only **`charLength`** property of the SpeechSynthesisEvent interface returns the number of characters left to be spoken after the character at the charIndex position.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisEvent/charLength)
   */
  readonly charLength: number;
  /**
   * The **`elapsedTime`** read-only property of the SpeechSynthesisEvent returns the elapsed time in seconds, after the SpeechSynthesisUtterance.text started being spoken, at which the event was triggered.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisEvent/elapsedTime)
   */
  readonly elapsedTime: number;
  /**
   * The **`name`** read-only property of the SpeechSynthesisUtterance interface returns the name associated with certain types of events occurring as the SpeechSynthesisUtterance.text is being spoken: the name of the SSML marker reached in the case of a mark event, or the type of boundary reached in the case of a boundary event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisEvent/name)
   */
  readonly name: string;
  /**
   * The **`utterance`** read-only property of the SpeechSynthesisUtterance interface returns the SpeechSynthesisUtterance instance that the event was triggered on.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisEvent/utterance)
   */
  readonly utterance: SpeechSynthesisUtterance;
}

declare var SpeechSynthesisEvent: {
  prototype: SpeechSynthesisEvent;
  new (type: string, eventInitDict: SpeechSynthesisEventInit): SpeechSynthesisEvent;
};

interface SpeechSynthesisUtteranceEventMap {
  boundary: SpeechSynthesisEvent;
  end: SpeechSynthesisEvent;
  error: SpeechSynthesisErrorEvent;
  mark: SpeechSynthesisEvent;
  pause: SpeechSynthesisEvent;
  resume: SpeechSynthesisEvent;
  start: SpeechSynthesisEvent;
}

/**
 * The **`SpeechSynthesisUtterance`** interface of the Web Speech API represents a speech request. It contains the content the speech service should read and information about how to read it (e.g., language, pitch and volume.)
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance)
 */
interface SpeechSynthesisUtterance extends EventTarget {
  /**
   * The **`lang`** property of the SpeechSynthesisUtterance interface gets and sets the language of the utterance.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/lang)
   */
  lang: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/boundary_event) */
  onboundary: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/end_event) */
  onend: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/error_event) */
  onerror: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisErrorEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/mark_event) */
  onmark: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/pause_event) */
  onpause: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/resume_event) */
  onresume: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/start_event) */
  onstart: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisEvent) => any) | null;
  /**
   * The **`pitch`** property of the SpeechSynthesisUtterance interface gets and sets the pitch at which the utterance will be spoken at.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/pitch)
   */
  pitch: number;
  /**
   * The **`rate`** property of the SpeechSynthesisUtterance interface gets and sets the speed at which the utterance will be spoken at.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/rate)
   */
  rate: number;
  /**
   * The **`text`** property of the SpeechSynthesisUtterance interface gets and sets the text that will be synthesized when the utterance is spoken.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/text)
   */
  text: string;
  /**
   * The **`voice`** property of the SpeechSynthesisUtterance interface gets and sets the voice that will be used to speak the utterance.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/voice)
   */
  voice: SpeechSynthesisVoice | null;
  /**
   * The **`volume`** property of the SpeechSynthesisUtterance interface gets and sets the volume that the utterance will be spoken at.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisUtterance/volume)
   */
  volume: number;
  addEventListener<K extends keyof SpeechSynthesisUtteranceEventMap>(
    type: K,
    listener: (this: SpeechSynthesisUtterance, ev: SpeechSynthesisUtteranceEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof SpeechSynthesisUtteranceEventMap>(
    type: K,
    listener: (this: SpeechSynthesisUtterance, ev: SpeechSynthesisUtteranceEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var SpeechSynthesisUtterance: {
  prototype: SpeechSynthesisUtterance;
  new (text?: string): SpeechSynthesisUtterance;
};

/**
 * The **`SpeechSynthesisVoice`** interface of the Web Speech API represents a voice that the system supports. Every SpeechSynthesisVoice has its own relative speech service including information about language, name and URI.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisVoice)
 */
interface SpeechSynthesisVoice {
  /**
   * The **`default`** read-only property of the SpeechSynthesisVoice interface returns a boolean value indicating whether the voice is the default voice for the current app (true), or not (false.)
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisVoice/default)
   */
  readonly default: boolean;
  /**
   * The **`lang`** read-only property of the SpeechSynthesisVoice interface returns a BCP 47 language tag indicating the language of the voice.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisVoice/lang)
   */
  readonly lang: string;
  /**
   * The **`localService`** read-only property of the SpeechSynthesisVoice interface returns a boolean value indicating whether the voice is supplied by a local speech synthesizer service (true), or a remote speech synthesizer service (false.)
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisVoice/localService)
   */
  readonly localService: boolean;
  /**
   * The **`name`** read-only property of the SpeechSynthesisVoice interface returns a human-readable name that represents the voice.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisVoice/name)
   */
  readonly name: string;
  /**
   * The **`voiceURI`** read-only property of the SpeechSynthesisVoice interface returns the type of URI and location of the speech synthesis service for this voice.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SpeechSynthesisVoice/voiceURI)
   */
  readonly voiceURI: string;
}

declare var SpeechSynthesisVoice: {
  prototype: SpeechSynthesisVoice;
  new (): SpeechSynthesisVoice;
};

/**
 * The **`StereoPannerNode`** interface of the Web Audio API represents a simple stereo panner node that can be used to pan an audio stream left or right. It is an AudioNode audio-processing module that positions an incoming audio stream in a stereo image using a low-cost equal-power panning algorithm.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/StereoPannerNode)
 */
interface StereoPannerNode extends AudioNode {
  /**
   * The **`pan`** property of the StereoPannerNode interface is an a-rate AudioParam representing the amount of panning to apply. The value can range between -1 (full left pan) and 1 (full right pan).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/StereoPannerNode/pan)
   */
  readonly pan: AudioParam;
}

declare var StereoPannerNode: {
  prototype: StereoPannerNode;
  new (context: BaseAudioContext, options?: StereoPannerOptions): StereoPannerNode;
};

/**
 * The **`Storage`** interface of the Web Storage API provides access to a particular domain's session or local storage. It allows, for example, the addition, modification, or deletion of stored data items.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Storage)
 */
interface Storage {
  /**
   * The **`length`** read-only property of the Storage interface returns the number of data items stored in a given Storage object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Storage/length)
   */
  readonly length: number;
  /**
   * The **`clear()`** method of the Storage interface clears all keys stored in a given Storage object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Storage/clear)
   */
  clear(): void;
  /**
   * The **`getItem()`** method of the Storage interface, when passed a key name, will return that key's value, or null if the key does not exist, in the given Storage object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Storage/getItem)
   */
  getItem(key: string): string | null;
  /**
   * The **`key()`** method of the Storage interface, when passed a number n, returns the name of the nth key in a given Storage object. The order of keys is user-agent defined, so you should not rely on it.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Storage/key)
   */
  key(index: number): string | null;
  /**
   * The **`removeItem()`** method of the Storage interface, when passed a key name, will remove that key from the given Storage object if it exists. The Storage interface of the Web Storage API provides access to a particular domain's session or local storage.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Storage/removeItem)
   */
  removeItem(key: string): void;
  /**
   * The **`setItem()`** method of the Storage interface, when passed a key name and value, will add that key to the given Storage object, or update that key's value if it already exists.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Storage/setItem)
   */
  setItem(key: string, value: string): void;
  [name: string]: any;
}

declare var Storage: {
  prototype: Storage;
  new (): Storage;
};

/**
 * The **`StorageManager`** interface of the Storage API provides an interface for managing persistence permissions and estimating available storage. You can get a reference to this interface using either navigator.storage or WorkerNavigator.storage.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/StorageManager)
 */
interface StorageManager {
  /**
   * The **`estimate()`** method of the StorageManager interface asks the Storage Manager for how much storage the current origin takes up (usage), and how much space is available (quota).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/StorageManager/estimate)
   */
  estimate(): Promise<StorageEstimate>;
  /**
   * The **`getDirectory()`** method of the StorageManager interface is used to obtain a reference to a FileSystemDirectoryHandle object allowing access to a directory and its contents, stored in the origin private file system (OPFS).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/StorageManager/getDirectory)
   */
  getDirectory(): Promise<FileSystemDirectoryHandle>;
  /**
   * The **`persist()`** method of the StorageManager interface requests permission to use persistent storage, and returns a Promise that resolves to true if permission is granted and bucket mode is persistent, and false otherwise. The browser may or may not honor the request, depending on browser-specific rules. (For more details, see the guide to Storage quotas and eviction criteria.)
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/StorageManager/persist)
   */
  persist(): Promise<boolean>;
  /**
   * The **`persisted()`** method of the StorageManager interface returns a Promise that resolves to true if your site's storage bucket is persistent.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/StorageManager/persisted)
   */
  persisted(): Promise<boolean>;
}

declare var StorageManager: {
  prototype: StorageManager;
  new (): StorageManager;
};

/**
 * The **`SubtleCrypto`** interface of the Web Crypto API provides a number of low-level cryptographic functions.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto)
 */
interface SubtleCrypto {
  /**
   * The **`decrypt()`** method of the SubtleCrypto interface decrypts some encrypted data. It takes as arguments a key to decrypt with, some optional extra parameters, and the data to decrypt (also known as "ciphertext"). It returns a Promise which will be fulfilled with the decrypted data (also known as "plaintext").
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/decrypt)
   */
  decrypt(
    algorithm: AlgorithmIdentifier | RsaOaepParams | AesCtrParams | AesCbcParams | AesGcmParams,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer>;
  /**
   * The **`deriveBits()`** method of the SubtleCrypto interface can be used to derive an array of bits from a base key.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/deriveBits)
   */
  deriveBits(
    algorithm: AlgorithmIdentifier | EcdhKeyDeriveParams | HkdfParams | Pbkdf2Params,
    baseKey: CryptoKey,
    length?: number | null,
  ): Promise<ArrayBuffer>;
  /**
   * The **`deriveKey()`** method of the SubtleCrypto interface can be used to derive a secret key from a master key.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/deriveKey)
   */
  deriveKey(
    algorithm: AlgorithmIdentifier | EcdhKeyDeriveParams | HkdfParams | Pbkdf2Params,
    baseKey: CryptoKey,
    derivedKeyType:
      | AlgorithmIdentifier
      | AesDerivedKeyParams
      | HmacImportParams
      | HkdfParams
      | Pbkdf2Params,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  /**
   * The **`digest()`** method of the SubtleCrypto interface generates a digest of the given data, using the specified hash function. A digest is a short fixed-length value derived from some variable-length input. Cryptographic digests should exhibit collision-resistance, meaning that it's hard to come up with two different inputs that have the same digest value.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/digest)
   */
  digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer>;
  /**
   * The **`encrypt()`** method of the SubtleCrypto interface encrypts data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/encrypt)
   */
  encrypt(
    algorithm: AlgorithmIdentifier | RsaOaepParams | AesCtrParams | AesCbcParams | AesGcmParams,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer>;
  /**
   * The **`exportKey()`** method of the SubtleCrypto interface exports a key: that is, it takes as input a CryptoKey object and gives you the key in an external, portable format.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/exportKey)
   */
  exportKey(format: "jwk", key: CryptoKey): Promise<JsonWebKey>;
  exportKey(format: Exclude<KeyFormat, "jwk">, key: CryptoKey): Promise<ArrayBuffer>;
  exportKey(format: KeyFormat, key: CryptoKey): Promise<ArrayBuffer | JsonWebKey>;
  /**
   * The **`generateKey()`** method of the SubtleCrypto interface is used to generate a new key (for symmetric algorithms) or key pair (for public-key algorithms).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/generateKey)
   */
  generateKey(
    algorithm: "Ed25519" | { name: "Ed25519" },
    extractable: boolean,
    keyUsages: ReadonlyArray<"sign" | "verify">,
  ): Promise<CryptoKeyPair>;
  generateKey(
    algorithm: "X25519" | { name: "X25519" },
    extractable: boolean,
    keyUsages: ReadonlyArray<"deriveBits" | "deriveKey">,
  ): Promise<CryptoKeyPair>;
  generateKey(
    algorithm: RsaHashedKeyGenParams | EcKeyGenParams,
    extractable: boolean,
    keyUsages: ReadonlyArray<KeyUsage>,
  ): Promise<CryptoKeyPair>;
  generateKey(
    algorithm: AesKeyGenParams | HmacKeyGenParams | Pbkdf2Params,
    extractable: boolean,
    keyUsages: ReadonlyArray<KeyUsage>,
  ): Promise<CryptoKey>;
  generateKey(
    algorithm: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKeyPair | CryptoKey>;
  /**
   * The **`importKey()`** method of the SubtleCrypto interface imports a key: that is, it takes as input a key in an external, portable format and gives you a CryptoKey object that you can use in the Web Crypto API.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/importKey)
   */
  importKey(
    format: "jwk",
    keyData: JsonWebKey,
    algorithm:
      | AlgorithmIdentifier
      | RsaHashedImportParams
      | EcKeyImportParams
      | HmacImportParams
      | AesKeyAlgorithm,
    extractable: boolean,
    keyUsages: ReadonlyArray<KeyUsage>,
  ): Promise<CryptoKey>;
  importKey(
    format: Exclude<KeyFormat, "jwk">,
    keyData: BufferSource,
    algorithm:
      | AlgorithmIdentifier
      | RsaHashedImportParams
      | EcKeyImportParams
      | HmacImportParams
      | AesKeyAlgorithm,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  /**
   * The **`sign()`** method of the SubtleCrypto interface generates a digital signature.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/sign)
   */
  sign(
    algorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer>;
  /**
   * The **`unwrapKey()`** method of the SubtleCrypto interface "unwraps" a key. This means that it takes as its input a key that has been exported and then encrypted (also called "wrapped"). It decrypts the key and then imports it, returning a CryptoKey object that can be used in the Web Crypto API.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/unwrapKey)
   */
  unwrapKey(
    format: KeyFormat,
    wrappedKey: BufferSource,
    unwrappingKey: CryptoKey,
    unwrapAlgorithm:
      | AlgorithmIdentifier
      | RsaOaepParams
      | AesCtrParams
      | AesCbcParams
      | AesGcmParams,
    unwrappedKeyAlgorithm:
      | AlgorithmIdentifier
      | RsaHashedImportParams
      | EcKeyImportParams
      | HmacImportParams
      | AesKeyAlgorithm,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  /**
   * The **`verify()`** method of the SubtleCrypto interface verifies a digital signature.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/verify)
   */
  verify(
    algorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams,
    key: CryptoKey,
    signature: BufferSource,
    data: BufferSource,
  ): Promise<boolean>;
  /**
   * The **`wrapKey()`** method of the SubtleCrypto interface "wraps" a key. This means that it exports the key in an external, portable format, then encrypts the exported key. Wrapping a key helps protect it in untrusted environments, such as inside an otherwise unprotected data store or in transmission over an unprotected network.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/wrapKey)
   */
  wrapKey(
    format: KeyFormat,
    key: CryptoKey,
    wrappingKey: CryptoKey,
    wrapAlgorithm: AlgorithmIdentifier | RsaOaepParams | AesCtrParams | AesCbcParams | AesGcmParams,
  ): Promise<ArrayBuffer>;
}

declare var SubtleCrypto: {
  prototype: SubtleCrypto;
  new (): SubtleCrypto;
};

interface SubtleCrypto {
  /**
   * The **`deriveKey()`** method of the SubtleCrypto interface can be used to derive a secret key from a master key.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/deriveKey)
   */
  deriveKey(
    algorithm: AlgorithmIdentifier | EcdhKeyDeriveParams | HkdfParams | Pbkdf2Params,
    baseKey: CryptoKey,
    derivedKeyType:
      | AlgorithmIdentifier
      | AesDerivedKeyParams
      | HmacImportParams
      | HkdfParams
      | Pbkdf2Params,
    extractable: boolean,
    keyUsages: Iterable<KeyUsage>,
  ): Promise<CryptoKey>;
  /**
   * The **`generateKey()`** method of the SubtleCrypto interface is used to generate a new key (for symmetric algorithms) or key pair (for public-key algorithms).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/generateKey)
   */
  generateKey(
    algorithm: "Ed25519" | { name: "Ed25519" },
    extractable: boolean,
    keyUsages: ReadonlyArray<"sign" | "verify">,
  ): Promise<CryptoKeyPair>;
  generateKey(
    algorithm: "X25519" | { name: "X25519" },
    extractable: boolean,
    keyUsages: ReadonlyArray<"deriveBits" | "deriveKey">,
  ): Promise<CryptoKeyPair>;
  generateKey(
    algorithm: RsaHashedKeyGenParams | EcKeyGenParams,
    extractable: boolean,
    keyUsages: ReadonlyArray<KeyUsage>,
  ): Promise<CryptoKeyPair>;
  generateKey(
    algorithm: AesKeyGenParams | HmacKeyGenParams | Pbkdf2Params,
    extractable: boolean,
    keyUsages: ReadonlyArray<KeyUsage>,
  ): Promise<CryptoKey>;
  generateKey(
    algorithm: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: Iterable<KeyUsage>,
  ): Promise<CryptoKeyPair | CryptoKey>;
  /**
   * The **`importKey()`** method of the SubtleCrypto interface imports a key: that is, it takes as input a key in an external, portable format and gives you a CryptoKey object that you can use in the Web Crypto API.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/importKey)
   */
  importKey(
    format: "jwk",
    keyData: JsonWebKey,
    algorithm:
      | AlgorithmIdentifier
      | RsaHashedImportParams
      | EcKeyImportParams
      | HmacImportParams
      | AesKeyAlgorithm,
    extractable: boolean,
    keyUsages: ReadonlyArray<KeyUsage>,
  ): Promise<CryptoKey>;
  importKey(
    format: Exclude<KeyFormat, "jwk">,
    keyData: BufferSource,
    algorithm:
      | AlgorithmIdentifier
      | RsaHashedImportParams
      | EcKeyImportParams
      | HmacImportParams
      | AesKeyAlgorithm,
    extractable: boolean,
    keyUsages: Iterable<KeyUsage>,
  ): Promise<CryptoKey>;
  /**
   * The **`unwrapKey()`** method of the SubtleCrypto interface "unwraps" a key. This means that it takes as its input a key that has been exported and then encrypted (also called "wrapped"). It decrypts the key and then imports it, returning a CryptoKey object that can be used in the Web Crypto API.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/SubtleCrypto/unwrapKey)
   */
  unwrapKey(
    format: KeyFormat,
    wrappedKey: BufferSource,
    unwrappingKey: CryptoKey,
    unwrapAlgorithm:
      | AlgorithmIdentifier
      | RsaOaepParams
      | AesCtrParams
      | AesCbcParams
      | AesGcmParams,
    unwrappedKeyAlgorithm:
      | AlgorithmIdentifier
      | RsaHashedImportParams
      | EcKeyImportParams
      | HmacImportParams
      | AesKeyAlgorithm,
    extractable: boolean,
    keyUsages: Iterable<KeyUsage>,
  ): Promise<CryptoKey>;
}

/**
 * The **`TextDecoder`** interface represents a decoder for a specific text encoding, such as UTF-8, ISO-8859-2, or GBK. A decoder takes an array of bytes as input and returns a JavaScript string.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TextDecoder)
 */
interface TextDecoder extends TextDecoderCommon {
  /**
   * The **`TextDecoder.decode()`** method returns a string containing text decoded from the buffer passed as a parameter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TextDecoder/decode)
   */
  decode(input?: AllowSharedBufferSource, options?: TextDecodeOptions): string;
}

declare var TextDecoder: {
  prototype: TextDecoder;
  new (label?: string, options?: TextDecoderOptions): TextDecoder;
};

interface TextDecoderCommon {
  /**
   * Returns encoding's name, lowercased.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TextDecoder/encoding)
   */
  readonly encoding: string;
  /**
   * Returns true if error mode is "fatal", otherwise false.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TextDecoder/fatal)
   */
  readonly fatal: boolean;
  /**
   * Returns the value of ignore BOM.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TextDecoder/ignoreBOM)
   */
  readonly ignoreBOM: boolean;
}

/**
 * The **`TextDecoderStream`** interface of the Encoding API converts a stream of text in a binary encoding, such as UTF-8 etc., to a stream of strings. It is the streaming equivalent of TextDecoder. It implements the same shape as a TransformStream, allowing it to be used in ReadableStream.pipeThrough() and similar methods.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TextDecoderStream)
 */
interface TextDecoderStream extends GenericTransformStream, TextDecoderCommon {
  /** The **`readable`** read-only property of the TextDecoderStream interface returns a ReadableStream that emits decoded strings. */
  readonly readable: ReadableStream<string>;
  /** The **`writable`** read-only property of the TextDecoderStream interface returns a WritableStream that accepts binary data, in the form of ArrayBuffer, TypedArray, or DataView chunks (SharedArrayBuffer and its views are also allowed), to be decoded into strings. */
  readonly writable: WritableStream<BufferSource>;
}

declare var TextDecoderStream: {
  prototype: TextDecoderStream;
  new (label?: string, options?: TextDecoderOptions): TextDecoderStream;
};

/**
 * The **`TextEncoder`** interface enables you to encode a JavaScript string using UTF-8.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TextEncoder)
 */
interface TextEncoder extends TextEncoderCommon {
  /**
   * The **`TextEncoder.encode()`** method takes a string as input, and returns a Uint8Array containing the string encoded using UTF-8.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TextEncoder/encode)
   */
  encode(input?: string): Uint8Array<ArrayBuffer>;
  /**
   * The **`TextEncoder.encodeInto()`** method takes a string to encode and a destination Uint8Array to put resulting UTF-8 encoded text into, and returns an object indicating the progress of the encoding. This is potentially more performant than the encode() method — especially when the target buffer is a view into a Wasm heap.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TextEncoder/encodeInto)
   */
  encodeInto(source: string, destination: Uint8Array<ArrayBufferLike>): TextEncoderEncodeIntoResult;
}

declare var TextEncoder: {
  prototype: TextEncoder;
  new (): TextEncoder;
};

interface TextEncoderCommon {
  /**
   * Returns "utf-8".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TextEncoder/encoding)
   */
  readonly encoding: string;
}

/**
 * The **`TextEncoderStream`** interface of the Encoding API converts a stream of strings into bytes in the UTF-8 encoding. It is the streaming equivalent of TextEncoder. It implements the same shape as a TransformStream, allowing it to be used in ReadableStream.pipeThrough() and similar methods.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TextEncoderStream)
 */
interface TextEncoderStream extends GenericTransformStream, TextEncoderCommon {
  /** The **`readable`** read-only property of the TextEncoderStream interface returns a ReadableStream that emits encoded binary data as Uint8Array chunks. */
  readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>;
  /** The **`writable`** read-only property of the TextEncoderStream interface returns a WritableStream that accepts strings to be encoded into binary data. */
  readonly writable: WritableStream<string>;
}

declare var TextEncoderStream: {
  prototype: TextEncoderStream;
  new (): TextEncoderStream;
};

/**
 * When loading a media resource for use by an <audio> or <video> element, the **`TimeRanges`** interface is used for representing the time ranges of the media resource that have been buffered, the time ranges that have been played, and the time ranges that are seekable.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TimeRanges)
 */
interface TimeRanges {
  /**
   * The **`TimeRanges.length`** read-only property returns the number of ranges in the object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TimeRanges/length)
   */
  readonly length: number;
  /**
   * The **`end()`** method of the TimeRanges interface returns the time offset (in seconds) at which a specified time range ends.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TimeRanges/end)
   */
  end(index: number): number;
  /**
   * The **`start()`** method of the TimeRanges interface returns the time offset (in seconds) at which a specified time range begins.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TimeRanges/start)
   */
  start(index: number): number;
}

declare var TimeRanges: {
  prototype: TimeRanges;
  new (): TimeRanges;
};

/**
 * The **`TransformStream`** interface of the Streams API represents a concrete implementation of the pipe chain transform stream concept.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TransformStream)
 */
interface TransformStream<I = any, O = any> {
  /**
   * The **`readable`** read-only property of the TransformStream interface returns the ReadableStream instance controlled by this TransformStream. This stream emits the transformed output data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TransformStream/readable)
   */
  readonly readable: ReadableStream<O>;
  /**
   * The **`writable`** read-only property of the TransformStream interface returns the WritableStream instance controlled by this TransformStream. This stream accepts input data that will be transformed and emitted to the readable stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TransformStream/writable)
   */
  readonly writable: WritableStream<I>;
}

declare var TransformStream: {
  prototype: TransformStream;
  new <I = any, O = any>(
    transformer?: Transformer<I, O>,
    writableStrategy?: QueuingStrategy<I>,
    readableStrategy?: QueuingStrategy<O>,
  ): TransformStream<I, O>;
};

/**
 * The **`TransformStreamDefaultController`** interface of the Streams API provides methods to manipulate the associated ReadableStream and WritableStream.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TransformStreamDefaultController)
 */
interface TransformStreamDefaultController<O = any> {
  /**
   * The **`desiredSize`** read-only property of the TransformStreamDefaultController interface returns the desired size to fill the queue of the associated ReadableStream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TransformStreamDefaultController/desiredSize)
   */
  readonly desiredSize: number | null;
  /**
   * The **`enqueue()`** method of the TransformStreamDefaultController interface enqueues the given chunk in the readable side of the stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TransformStreamDefaultController/enqueue)
   */
  enqueue(chunk?: O): void;
  /**
   * The **`error()`** method of the TransformStreamDefaultController interface errors both sides of the stream. Any further interactions with it will fail with the given error message, and any chunks in the queue will be discarded.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TransformStreamDefaultController/error)
   */
  error(reason?: any): void;
  /**
   * The **`terminate()`** method of the TransformStreamDefaultController interface closes the readable side and errors the writable side of the stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/TransformStreamDefaultController/terminate)
   */
  terminate(): void;
}

declare var TransformStreamDefaultController: {
  prototype: TransformStreamDefaultController;
  new (): TransformStreamDefaultController;
};

/**
 * The **`URL`** interface is used to parse, construct, normalize, and encode URLs. It works by providing properties which allow you to easily read and modify the components of a URL.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL)
 */
interface URL {
  /**
   * The **`hash`** property of the URL interface is a string containing a "#" followed by the fragment identifier of the URL. If the URL does not have a fragment identifier, this property contains an empty string, "".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/hash)
   */
  hash: string;
  /**
   * The **`host`** property of the URL interface is a string containing the host, which is the hostname, and then, if the port of the URL is nonempty, a ":", followed by the port of the URL. If the URL does not have a hostname, this property contains an empty string, "".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/host)
   */
  host: string;
  /**
   * The **`hostname`** property of the URL interface is a string containing either the domain name or IP address of the URL. If the URL does not have a hostname, this property contains an empty string, "". IPv4 and IPv6 addresses are normalized, such as stripping leading zeros, and domain names are converted to IDN.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/hostname)
   */
  hostname: string;
  /**
   * The **`href`** property of the URL interface is a string containing the whole URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/href)
   */
  href: string;
  toString(): string;
  /**
   * The **`origin`** read-only property of the URL interface returns a string containing the Unicode serialization of the origin of the represented URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/origin)
   */
  readonly origin: string;
  /**
   * The **`password`** property of the URL interface is a string containing the password component of the URL. If the URL does not have a password, this property contains an empty string, "".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/password)
   */
  password: string;
  /**
   * The **`pathname`** property of the URL interface represents a location in a hierarchical structure. It is a string constructed from a list of path segments, each of which is prefixed by a / character.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/pathname)
   */
  pathname: string;
  /**
   * The **`port`** property of the URL interface is a string containing the port number of the URL. If the port is the default for the protocol (80 for ws: and http:, 443 for wss: and https:, and 21 for ftp:), this property contains an empty string, "".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/port)
   */
  port: string;
  /**
   * The **`protocol`** property of the URL interface is a string containing the protocol or scheme of the URL, including the final ":".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/protocol)
   */
  protocol: string;
  /**
   * The **`search`** property of the URL interface is a search string, also called a query string, that is a string containing a "?" followed by the parameters of the URL. If the URL does not have a search query, this property contains an empty string, "".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/search)
   */
  search: string;
  /**
   * The **`searchParams`** read-only property of the URL interface returns a URLSearchParams object allowing access to the GET decoded query arguments contained in the URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/searchParams)
   */
  readonly searchParams: URLSearchParams;
  /**
   * The **`username`** property of the URL interface is a string containing the username component of the URL. If the URL does not have a username, this property contains an empty string, "".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/username)
   */
  username: string;
  /**
   * The **`toJSON()`** method of the URL interface returns a string containing a serialized version of the URL, although in practice it seems to have the same effect as URL.toString().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/toJSON)
   */
  toJSON(): string;
}

declare var URL: {
  prototype: URL;
  new (url: string | URL, base?: string | URL): URL;
  /**
   * The **`URL.canParse()`** static method of the URL interface returns a boolean indicating whether or not an absolute URL, or a relative URL combined with a base URL, are parsable and valid.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/canParse_static)
   */
  canParse(url: string | URL, base?: string | URL): boolean;
  /**
   * The **`createObjectURL()`** static method of the URL interface creates a string containing a blob URL pointing to the object given in the parameter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/createObjectURL_static)
   */
  createObjectURL(obj: Blob | MediaSource): string;
  /**
   * The **`URL.parse()`** static method of the URL interface returns a newly created URL object representing the URL defined by the parameters.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/parse_static)
   */
  parse(url: string | URL, base?: string | URL): URL | null;
  /**
   * The **`revokeObjectURL()`** static method of the URL interface releases an existing object URL which was previously created by calling URL.createObjectURL().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URL/revokeObjectURL_static)
   */
  revokeObjectURL(url: string): void;
};

/**
 * The **`URLPattern`** interface of the URL Pattern API matches URLs or parts of URLs against a pattern. The pattern can contain capturing groups that extract parts of the matched URL.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern)
 */
interface URLPattern {
  /**
   * The **`hasRegExpGroups`** read-only property of the URLPattern interface is a boolean indicating whether or not any of the URLPattern components contain regular expression capturing groups.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern/hasRegExpGroups)
   */
  readonly hasRegExpGroups: boolean;
  /**
   * The **`hash`** read-only property of the URLPattern interface is a string containing the pattern used to match the fragment part of a URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern/hash)
   */
  readonly hash: string;
  /**
   * The **`hostname`** read-only property of the URLPattern interface is a string containing the pattern used to match the hostname part of a URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern/hostname)
   */
  readonly hostname: string;
  /**
   * The **`password`** read-only property of the URLPattern interface is a string containing the pattern used to match the password part of a URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern/password)
   */
  readonly password: string;
  /**
   * The **`pathname`** read-only property of the URLPattern interface is a string containing the pattern used to match the pathname part of a URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern/pathname)
   */
  readonly pathname: string;
  /**
   * The **`port`** read-only property of the URLPattern interface is a string containing the pattern used to match the port part of a URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern/port)
   */
  readonly port: string;
  /**
   * The **`protocol`** read-only property of the URLPattern interface is a string containing the pattern used to match the protocol part of a URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern/protocol)
   */
  readonly protocol: string;
  /**
   * The **`search`** read-only property of the URLPattern interface is a string containing the pattern used to match the search part of a URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern/search)
   */
  readonly search: string;
  /**
   * The **`username`** read-only property of the URLPattern interface is a string containing the pattern used to match the username part of a URL.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern/username)
   */
  readonly username: string;
  /**
   * The **`exec()`** method of the URLPattern interface takes a URL or object of URL parts, and returns either an object containing the results of matching the URL to the pattern, or null if the URL does not match the pattern.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern/exec)
   */
  exec(input?: URLPatternInput, baseURL?: string | URL): URLPatternResult | null;
  /**
   * The **`test()`** method of the URLPattern interface takes a URL string or object of URL parts, and returns a boolean indicating if the given input matches the current pattern.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLPattern/test)
   */
  test(input?: URLPatternInput, baseURL?: string | URL): boolean;
}

declare var URLPattern: {
  prototype: URLPattern;
  new (input: URLPatternInput, baseURL: string | URL, options?: URLPatternOptions): URLPattern;
  new (input?: URLPatternInput, options?: URLPatternOptions): URLPattern;
};

/**
 * The **`URLSearchParams`** interface defines utility methods to work with the query string of a URL.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams)
 */
interface URLSearchParams {
  /**
   * The **`size`** read-only property of the URLSearchParams interface indicates the total number of search parameter entries.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams/size)
   */
  readonly size: number;
  /**
   * The **`append()`** method of the URLSearchParams interface appends a specified key/value pair as a new search parameter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams/append)
   */
  append(name: string, value: string): void;
  /**
   * The **`delete()`** method of the URLSearchParams interface deletes specified parameters and their associated value(s) from the list of all search parameters.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams/delete)
   */
  delete(name: string, value?: string): void;
  /**
   * The **`get()`** method of the URLSearchParams interface returns the first value associated to the given search parameter.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams/get)
   */
  get(name: string): string | null;
  /**
   * The **`getAll()`** method of the URLSearchParams interface returns all the values associated with a given search parameter as an array.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams/getAll)
   */
  getAll(name: string): string[];
  /**
   * The **`has()`** method of the URLSearchParams interface returns a boolean value that indicates whether the specified parameter is in the search parameters.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams/has)
   */
  has(name: string, value?: string): boolean;
  /**
   * The **`set()`** method of the URLSearchParams interface sets the value associated with a given search parameter to the given value. If there were several matching values, this method deletes the others. If the search parameter doesn't exist, this method creates it.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams/set)
   */
  set(name: string, value: string): void;
  /**
   * The **`URLSearchParams.sort()`** method sorts all key/value pairs contained in this object in place and returns undefined. Key/value pairs are sorted by the values of the UTF-16 code units of the keys. This method uses a stable sorting algorithm (i.e., the relative order between key/value pairs with equal keys will be preserved).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams/sort)
   */
  sort(): void;
  toString(): string;
  forEach(
    callbackfn: (value: string, key: string, parent: URLSearchParams) => void,
    thisArg?: any,
  ): void;
}

declare var URLSearchParams: {
  prototype: URLSearchParams;
  new (init?: string[][] | Record<string, string> | string | URLSearchParams): URLSearchParams;
};

interface URLSearchParams {
  [Symbol.iterator](): URLSearchParamsIterator<[string, string]>;
  /** Returns an array of key, value pairs for every entry in the search params. */
  entries(): URLSearchParamsIterator<[string, string]>;
  /** Returns a list of keys in the search params. */
  keys(): URLSearchParamsIterator<string>;
  /** Returns a list of values in the search params. */
  values(): URLSearchParamsIterator<string>;
}

/**
 * The **`VideoColorSpace`** interface of the WebCodecs API represents the color space of a video.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoColorSpace)
 */
interface VideoColorSpace {
  /**
   * The **`fullRange`** read-only property of the VideoColorSpace interface returns true if full-range color values are used.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoColorSpace/fullRange)
   */
  readonly fullRange: boolean | null;
  /**
   * The **`matrix`** read-only property of the VideoColorSpace interface returns the matrix coefficient of the video. Matrix coefficients describe the relationship between sample component values and color coordinates.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoColorSpace/matrix)
   */
  readonly matrix: VideoMatrixCoefficients | null;
  /**
   * The **`primaries`** read-only property of the VideoColorSpace interface returns the color gamut of the video.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoColorSpace/primaries)
   */
  readonly primaries: VideoColorPrimaries | null;
  /**
   * The **`transfer`** read-only property of the VideoColorSpace interface returns the opto-electronic transfer characteristics of the video.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoColorSpace/transfer)
   */
  readonly transfer: VideoTransferCharacteristics | null;
  /**
   * The **`toJSON()`** method of the VideoColorSpace interface is a serializer that returns a JSON representation of the VideoColorSpace object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoColorSpace/toJSON)
   */
  toJSON(): VideoColorSpaceInit;
}

declare var VideoColorSpace: {
  prototype: VideoColorSpace;
  new (init?: VideoColorSpaceInit): VideoColorSpace;
};

interface VideoDecoderEventMap {
  dequeue: Event;
}

/**
 * The **`VideoDecoder`** interface of the WebCodecs API decodes chunks of video.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoDecoder)
 */
interface VideoDecoder extends EventTarget {
  /**
   * The **`decodeQueueSize`** read-only property of the VideoDecoder interface returns the number of pending decode requests in the queue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoDecoder/decodeQueueSize)
   */
  readonly decodeQueueSize: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoDecoder/dequeue_event) */
  ondequeue: ((this: VideoDecoder, ev: Event) => any) | null;
  /**
   * The **`state`** property of the VideoDecoder interface returns the current state of the underlying codec.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoDecoder/state)
   */
  readonly state: CodecState;
  /**
   * The **`close()`** method of the VideoDecoder interface ends all pending work and releases system resources.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoDecoder/close)
   */
  close(): void;
  /**
   * The **`configure()`** method of the VideoDecoder interface enqueues a control message to configure the video decoder for decoding chunks.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoDecoder/configure)
   */
  configure(config: VideoDecoderConfig): void;
  /**
   * The **`decode()`** method of the VideoDecoder interface enqueues a control message to decode a given chunk of video.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoDecoder/decode)
   */
  decode(chunk: EncodedVideoChunk): void;
  /**
   * The **`flush()`** method of the VideoDecoder interface returns a Promise that resolves once all pending messages in the queue have been completed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoDecoder/flush)
   */
  flush(): Promise<void>;
  /**
   * The **`reset()`** method of the VideoDecoder interface resets all states including configuration, control messages in the control message queue, and all pending callbacks.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoDecoder/reset)
   */
  reset(): void;
  addEventListener<K extends keyof VideoDecoderEventMap>(
    type: K,
    listener: (this: VideoDecoder, ev: VideoDecoderEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof VideoDecoderEventMap>(
    type: K,
    listener: (this: VideoDecoder, ev: VideoDecoderEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var VideoDecoder: {
  prototype: VideoDecoder;
  new (init: VideoDecoderInit): VideoDecoder;
  /**
   * The **`isConfigSupported()`** static method of the VideoDecoder interface checks if the given config is supported (that is, if VideoDecoder objects can be successfully configured with the given config).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoDecoder/isConfigSupported_static)
   */
  isConfigSupported(config: VideoDecoderConfig): Promise<VideoDecoderSupport>;
};

interface VideoEncoderEventMap {
  dequeue: Event;
}

/**
 * The **`VideoEncoder`** interface of the WebCodecs API encodes VideoFrame objects into EncodedVideoChunks.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoEncoder)
 */
interface VideoEncoder extends EventTarget {
  /**
   * The **`encodeQueueSize`** read-only property of the VideoEncoder interface returns the number of pending encode requests in the queue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoEncoder/encodeQueueSize)
   */
  readonly encodeQueueSize: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoEncoder/dequeue_event) */
  ondequeue: ((this: VideoEncoder, ev: Event) => any) | null;
  /**
   * The **`state`** read-only property of the VideoEncoder interface returns the current state of the underlying codec.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoEncoder/state)
   */
  readonly state: CodecState;
  /**
   * The **`close()`** method of the VideoEncoder interface ends all pending work and releases system resources.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoEncoder/close)
   */
  close(): void;
  /**
   * The **`configure()`** method of the VideoEncoder interface changes the state of the encoder to "configured" and asynchronously prepares the encoder to accept VideoEncoders for encoding with the specified parameters. If the encoder doesn't support the specified parameters or can't be initialized for other reasons an error will be reported via the error callback provided to the VideoEncoder constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoEncoder/configure)
   */
  configure(config: VideoEncoderConfig): void;
  /**
   * The **`encode()`** method of the VideoEncoder interface asynchronously encodes a VideoFrame. Encoded data (EncodedVideoChunk) or an error will eventually be returned via the callbacks provided to the VideoEncoder constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoEncoder/encode)
   */
  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void;
  /**
   * The **`flush()`** method of the VideoEncoder interface forces all pending encodes to complete.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoEncoder/flush)
   */
  flush(): Promise<void>;
  /**
   * The **`reset()`** method of the VideoEncoder interface synchronously cancels all pending encodes and callbacks, frees all underlying resources and sets the state to "unconfigured". After calling reset(), configure() must be called before resuming encode() calls.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoEncoder/reset)
   */
  reset(): void;
  addEventListener<K extends keyof VideoEncoderEventMap>(
    type: K,
    listener: (this: VideoEncoder, ev: VideoEncoderEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof VideoEncoderEventMap>(
    type: K,
    listener: (this: VideoEncoder, ev: VideoEncoderEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var VideoEncoder: {
  prototype: VideoEncoder;
  new (init: VideoEncoderInit): VideoEncoder;
  /**
   * The **`isConfigSupported()`** static method of the VideoEncoder interface checks if VideoEncoder can be successfully configured with the given config.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoEncoder/isConfigSupported_static)
   */
  isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
};

/**
 * The **`VideoFrame`** interface of the Web Codecs API represents a frame of a video.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame)
 */
interface VideoFrame {
  /**
   * The **`codedHeight`** property of the VideoFrame interface returns the height of the VideoFrame in pixels, potentially including non-visible padding, and prior to considering potential ratio adjustments.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/codedHeight)
   */
  readonly codedHeight: number;
  /**
   * The **`codedRect`** property of the VideoFrame interface returns a DOMRectReadOnly with the width and height matching VideoFrame.codedWidth and VideoFrame.codedHeight.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/codedRect)
   */
  readonly codedRect: DOMRectReadOnly | null;
  /**
   * The **`codedWidth`** property of the VideoFrame interface returns the width of the VideoFrame in pixels, potentially including non-visible padding, and prior to considering potential ratio adjustments.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/codedWidth)
   */
  readonly codedWidth: number;
  /**
   * The **`colorSpace`** property of the VideoFrame interface returns a VideoColorSpace object representing the color space of the video.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/colorSpace)
   */
  readonly colorSpace: VideoColorSpace;
  /**
   * The **`displayHeight`** property of the VideoFrame interface returns the height of the VideoFrame after applying aspect ratio adjustments.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/displayHeight)
   */
  readonly displayHeight: number;
  /**
   * The **`displayWidth`** property of the VideoFrame interface returns the width of the VideoFrame after applying aspect ratio adjustments.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/displayWidth)
   */
  readonly displayWidth: number;
  /**
   * The **`duration`** property of the VideoFrame interface returns an integer indicating the duration of the video in microseconds.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/duration)
   */
  readonly duration: number | null;
  /**
   * The **`format`** property of the VideoFrame interface returns the pixel format of the VideoFrame.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/format)
   */
  readonly format: VideoPixelFormat | null;
  /**
   * The **`timestamp`** property of the VideoFrame interface returns an integer indicating the timestamp of the video in microseconds.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/timestamp)
   */
  readonly timestamp: number;
  /**
   * The **`visibleRect`** property of the VideoFrame interface returns a DOMRectReadOnly describing the visible rectangle of pixels for this VideoFrame.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/visibleRect)
   */
  readonly visibleRect: DOMRectReadOnly | null;
  /**
   * The **`allocationSize()`** method of the VideoFrame interface returns the number of bytes required to hold the video as filtered by options passed into the method.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/allocationSize)
   */
  allocationSize(options?: VideoFrameCopyToOptions): number;
  /**
   * The **`clone()`** method of the VideoFrame interface creates a new VideoFrame object referencing the same media resource as the original.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/clone)
   */
  clone(): VideoFrame;
  /**
   * The **`close()`** method of the VideoFrame interface clears all states and releases the reference to the media resource.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/close)
   */
  close(): void;
  /**
   * The **`copyTo()`** method of the VideoFrame interface copies the contents of the VideoFrame to an ArrayBuffer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/VideoFrame/copyTo)
   */
  copyTo(
    destination: AllowSharedBufferSource,
    options?: VideoFrameCopyToOptions,
  ): Promise<PlaneLayout[]>;
}

declare var VideoFrame: {
  prototype: VideoFrame;
  new (image: CanvasImageSource, init?: VideoFrameInit): VideoFrame;
  new (data: AllowSharedBufferSource, init: VideoFrameBufferInit): VideoFrame;
};

/**
 * The **`WakeLock`** interface of the Screen Wake Lock API can be used to request a lock that prevents device screens from dimming or locking when an application needs to keep running.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WakeLock)
 */
interface WakeLock {
  /**
   * The **`request()`** method of the WakeLock interface returns a Promise that fulfills with a WakeLockSentinel object if the system screen wake lock is granted.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WakeLock/request)
   */
  request(type?: WakeLockType): Promise<WakeLockSentinel>;
}

declare var WakeLock: {
  prototype: WakeLock;
  new (): WakeLock;
};

interface WakeLockSentinelEventMap {
  release: Event;
}

/**
 * The **`WakeLockSentinel`** interface of the Screen Wake Lock API can be used to monitor the status of the platform screen wake lock, and manually release the lock when needed.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WakeLockSentinel)
 */
interface WakeLockSentinel extends EventTarget {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/WakeLockSentinel/release_event) */
  onrelease: ((this: WakeLockSentinel, ev: Event) => any) | null;
  /**
   * The **`released`** read-only property of the WakeLockSentinel interface returns a boolean that indicates whether a WakeLockSentinel has been released.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WakeLockSentinel/released)
   */
  readonly released: boolean;
  /**
   * The **`type`** read-only property of the WakeLockSentinel interface returns a string representation of the currently acquired WakeLockSentinel type.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WakeLockSentinel/type)
   */
  readonly type: WakeLockType;
  /**
   * The **`release()`** method of the WakeLockSentinel interface releases the WakeLockSentinel, returning a Promise that is resolved once the sentinel has been successfully released.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WakeLockSentinel/release)
   */
  release(): Promise<void>;
  addEventListener<K extends keyof WakeLockSentinelEventMap>(
    type: K,
    listener: (this: WakeLockSentinel, ev: WakeLockSentinelEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof WakeLockSentinelEventMap>(
    type: K,
    listener: (this: WakeLockSentinel, ev: WakeLockSentinelEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var WakeLockSentinel: {
  prototype: WakeLockSentinel;
  new (): WakeLockSentinel;
};

/**
 * The **`WaveShaperNode`** interface represents a non-linear distorter.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WaveShaperNode)
 */
interface WaveShaperNode extends AudioNode {
  /**
   * The **`curve`** property of the WaveShaperNode interface is a Float32Array of numbers describing the distortion to apply.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WaveShaperNode/curve)
   */
  curve: Float32Array<ArrayBuffer> | null;
  /**
   * The **`oversample`** property of the WaveShaperNode interface is an enumerated value indicating if oversampling must be used. Oversampling is a technique for creating more samples (up-sampling) before applying a distortion effect to the audio signal.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WaveShaperNode/oversample)
   */
  oversample: OverSampleType;
}

declare var WaveShaperNode: {
  prototype: WaveShaperNode;
  new (context: BaseAudioContext, options?: WaveShaperOptions): WaveShaperNode;
};

interface WebSocketEventMap {
  close: CloseEvent;
  error: Event;
  message: MessageEvent;
  open: Event;
}

/**
 * The **`WebSocket`** object provides the API for creating and managing a WebSocket connection to a server, as well as for sending and receiving data on the connection.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket)
 */
interface WebSocket extends EventTarget {
  /**
   * The **`WebSocket.binaryType`** property controls the type of binary data being received over the WebSocket connection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/binaryType)
   */
  binaryType: BinaryType;
  /**
   * The **`WebSocket.bufferedAmount`** read-only property returns the number of bytes of data that have been queued using calls to send() but not yet transmitted to the network. This value resets to zero once all queued data has been sent. This value does not reset to zero when the connection is closed; if you keep calling send(), this will continue to climb.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/bufferedAmount)
   */
  readonly bufferedAmount: number;
  /**
   * The **`WebSocket.extensions`** read-only property returns the extensions selected by the server. This is currently only the empty string or a list of extensions as negotiated by the connection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/extensions)
   */
  readonly extensions: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/close_event) */
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/error_event) */
  onerror: ((this: WebSocket, ev: Event) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/message_event) */
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/open_event) */
  onopen: ((this: WebSocket, ev: Event) => any) | null;
  /**
   * The **`WebSocket.protocol`** read-only property returns the name of the sub-protocol the server selected; this will be one of the strings specified in the protocols parameter when creating the WebSocket object, or the empty string if no connection is established.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/protocol)
   */
  readonly protocol: string;
  /**
   * The **`WebSocket.readyState`** read-only property returns the current state of the WebSocket connection.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/readyState)
   */
  readonly readyState: 0 | 1 | 2 | 3;
  /**
   * The **`WebSocket.url`** read-only property returns the absolute URL of the WebSocket as resolved by the constructor.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/url)
   */
  readonly url: string;
  /**
   * The **`WebSocket.close()`** method closes the WebSocket connection or connection attempt, if any. If the connection is already CLOSED, this method does nothing.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/close)
   */
  close(code?: number, reason?: string): void;
  /**
   * The **`WebSocket.send()`** method enqueues the specified data to be transmitted to the server over the WebSocket connection, increasing the value of bufferedAmount by the number of bytes needed to contain the data. If the data can't be sent (for example, because it needs to be buffered but the buffer is full), the socket is closed automatically. The browser will throw an exception if you call send() when the connection is in the CONNECTING state. If you call send() when the connection is in the CLOSING or CLOSED states, the browser will silently discard the data.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WebSocket/send)
   */
  send(data: BufferSource | Blob | string): void;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var WebSocket: {
  prototype: WebSocket;
  new (url: string | URL, protocols?: string | string[]): WebSocket;
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
};

interface WorkerEventMap extends AbstractWorkerEventMap, MessageEventTargetEventMap {}

/**
 * The **`Worker`** interface of the Web Workers API represents a background task that can be created via script, which can send messages back to its creator.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Worker)
 */
interface Worker extends EventTarget, AbstractWorker, MessageEventTarget<Worker> {
  /**
   * The **`postMessage()`** method of the Worker interface sends a message to the worker. The first parameter is the data to send to the worker. The data may be any JavaScript object that can be handled by the structured clone algorithm.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Worker/postMessage)
   */
  postMessage(message: any, transfer: Transferable[]): void;
  postMessage(message: any, options?: StructuredSerializeOptions): void;
  /**
   * The **`terminate()`** method of the Worker interface immediately terminates the Worker. This does not offer the worker an opportunity to finish its operations; it is stopped at once.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Worker/terminate)
   */
  terminate(): void;
  addEventListener<K extends keyof WorkerEventMap>(
    type: K,
    listener: (this: Worker, ev: WorkerEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof WorkerEventMap>(
    type: K,
    listener: (this: Worker, ev: WorkerEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare var Worker: {
  prototype: Worker;
  new (scriptURL: string | URL, options?: WorkerOptions): Worker;
};

/**
 * The **`Worklet`** interface is a lightweight version of Web Workers and gives developers access to low-level parts of the rendering pipeline.
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Worklet)
 */
interface Worklet {
  /**
   * The **`addModule()`** method of the Worklet interface loads the module in the given JavaScript file and adds it to the current Worklet.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Worklet/addModule)
   */
  addModule(moduleURL: string | URL, options?: WorkletOptions): Promise<void>;
}

declare var Worklet: {
  prototype: Worklet;
  new (): Worklet;
};

/**
 * The **`WritableStream`** interface of the Streams API provides a standard abstraction for writing streaming data to a destination, known as a sink. This object comes with built-in backpressure and queuing.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStream)
 */
interface WritableStream<W = any> {
  /**
   * The **`locked`** read-only property of the WritableStream interface returns a boolean indicating whether the WritableStream is locked to a writer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStream/locked)
   */
  readonly locked: boolean;
  /**
   * The **`abort()`** method of the WritableStream interface aborts the stream, signaling that the producer can no longer successfully write to the stream and it is to be immediately moved to an error state, with any queued writes discarded.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStream/abort)
   */
  abort(reason?: any): Promise<void>;
  /**
   * The **`close()`** method of the WritableStream interface closes the associated stream. All chunks written before this method is called are sent before the returned promise is fulfilled.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStream/close)
   */
  close(): Promise<void>;
  /**
   * The **`getWriter()`** method of the WritableStream interface returns a new instance of WritableStreamDefaultWriter and locks the stream to that instance. While the stream is locked, no other writer can be acquired until this one is released.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStream/getWriter)
   */
  getWriter(): WritableStreamDefaultWriter<W>;
}

declare var WritableStream: {
  prototype: WritableStream;
  new <W = any>(
    underlyingSink?: UnderlyingSink<W>,
    strategy?: QueuingStrategy<W>,
  ): WritableStream<W>;
};

/**
 * The **`WritableStreamDefaultController`** interface of the Streams API represents a controller allowing control of a WritableStream's state. When constructing a WritableStream, the underlying sink is given a corresponding WritableStreamDefaultController instance to manipulate.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultController)
 */
interface WritableStreamDefaultController {
  /**
   * The read-only **`signal`** property of the WritableStreamDefaultController interface returns the AbortSignal associated with the controller.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultController/signal)
   */
  readonly signal: AbortSignal;
  /**
   * The **`error()`** method of the WritableStreamDefaultController interface causes any future interactions with the associated stream to error.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultController/error)
   */
  error(e?: any): void;
}

declare var WritableStreamDefaultController: {
  prototype: WritableStreamDefaultController;
  new (): WritableStreamDefaultController;
};

/**
 * The **`WritableStreamDefaultWriter`** interface of the Streams API is the object returned by WritableStream.getWriter() and once created locks the writer to the WritableStream ensuring that no other streams can write to the underlying sink.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter)
 */
interface WritableStreamDefaultWriter<W = any> {
  /**
   * The **`closed`** read-only property of the WritableStreamDefaultWriter interface returns a Promise that fulfills if the stream becomes closed, or rejects if the stream errors or the writer's lock is released.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/closed)
   */
  readonly closed: Promise<void>;
  /**
   * The **`desiredSize`** read-only property of the WritableStreamDefaultWriter interface returns the desired size required to fill the stream's internal queue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/desiredSize)
   */
  readonly desiredSize: number | null;
  /**
   * The **`ready`** read-only property of the WritableStreamDefaultWriter interface returns a Promise that resolves when the desired size of the stream's internal queue transitions from non-positive to positive, signaling that it is no longer applying backpressure.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/ready)
   */
  readonly ready: Promise<void>;
  /**
   * The **`abort()`** method of the WritableStreamDefaultWriter interface aborts the stream, signaling that the producer can no longer successfully write to the stream and it is to be immediately moved to an error state, with any queued writes discarded.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/abort)
   */
  abort(reason?: any): Promise<void>;
  /**
   * The **`close()`** method of the WritableStreamDefaultWriter interface closes the associated writable stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/close)
   */
  close(): Promise<void>;
  /**
   * The **`releaseLock()`** method of the WritableStreamDefaultWriter interface releases the writer's lock on the corresponding stream. After the lock is released, the writer is no longer active. If the associated stream is errored when the lock is released, the writer will appear errored in the same way from now on; otherwise, the writer will appear closed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/releaseLock)
   */
  releaseLock(): void;
  /**
   * The **`write()`** method of the WritableStreamDefaultWriter interface writes a passed chunk of data to a WritableStream and its underlying sink, then returns a Promise that resolves to indicate the success or failure of the write operation.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/write)
   */
  write(chunk?: W): Promise<void>;
}

declare var WritableStreamDefaultWriter: {
  prototype: WritableStreamDefaultWriter;
  new <W = any>(stream: WritableStream<W>): WritableStreamDefaultWriter<W>;
};

/**
 * The **`console`** object provides access to the debugging console (e.g., the Web console in Firefox).
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console)
 */
interface Console {
  /**
   * The **`console.assert()`** static method writes an error message to the console if the assertion is false. If the assertion is true, nothing happens.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/assert_static)
   */
  assert(condition?: boolean, ...data: any[]): void;
  /**
   * The **`console.clear()`** static method clears the console if possible.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/clear_static)
   */
  clear(): void;
  /**
   * The **`console.count()`** static method logs the number of times that this particular call to count() has been called.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/count_static)
   */
  count(label?: string): void;
  /**
   * The **`console.countReset()`** static method resets counter used with console.count().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/countReset_static)
   */
  countReset(label?: string): void;
  /**
   * The **`console.debug()`** static method outputs a message to the console at the "debug" log level. The message is only displayed to the user if the console is configured to display debug output. In most cases, the log level is configured within the console UI. This log level might correspond to the Debug or Verbose log level.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/debug_static)
   */
  debug(...data: any[]): void;
  /**
   * The **`console.dir()`** static method displays a list of the properties of the specified JavaScript object. In browser consoles, the output is presented as a hierarchical listing with disclosure triangles that let you see the contents of child objects.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/dir_static)
   */
  dir(item?: any, options?: any): void;
  /**
   * The **`console.dirxml()`** static method displays an interactive tree of the descendant elements of the specified XML/HTML element. If it is not possible to display as an element the JavaScript Object view is shown instead. The output is presented as a hierarchical listing of expandable nodes that let you see the contents of child nodes.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/dirxml_static)
   */
  dirxml(...data: any[]): void;
  /**
   * The **`console.error()`** static method outputs a message to the console at the "error" log level. The message is only displayed to the user if the console is configured to display error output. In most cases, the log level is configured within the console UI. The message may be formatted as an error, with red colors and call stack information.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/error_static)
   */
  error(...data: any[]): void;
  /**
   * The **`console.group()`** static method creates a new inline group in the Web console log, causing any subsequent console messages to be indented by an additional level, until console.groupEnd() is called.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/group_static)
   */
  group(...data: any[]): void;
  /**
   * The **`console.groupCollapsed()`** static method creates a new inline group in the console. Unlike console.group(), however, the new group is created collapsed. The user will need to use the disclosure button next to it to expand it, revealing the entries created in the group.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/groupCollapsed_static)
   */
  groupCollapsed(...data: any[]): void;
  /**
   * The **`console.groupEnd()`** static method exits the current inline group in the console. See Using groups in the console in the console documentation for details and examples.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/groupEnd_static)
   */
  groupEnd(): void;
  /**
   * The **`console.info()`** static method outputs a message to the console at the "info" log level. The message is only displayed to the user if the console is configured to display info output. In most cases, the log level is configured within the console UI. The message may receive special formatting, such as a small "i" icon next to it.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/info_static)
   */
  info(...data: any[]): void;
  /**
   * The **`console.log()`** static method outputs a message to the console.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/log_static)
   */
  log(...data: any[]): void;
  /**
   * The **`console.table()`** static method displays tabular data as a table.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/table_static)
   */
  table(tabularData?: any, properties?: string[]): void;
  /**
   * The **`console.time()`** static method starts a timer you can use to track how long an operation takes. You give each timer a unique name, and may have up to 10,000 timers running on a given page. When you call console.timeEnd() with the same name, the browser will output the time, in milliseconds, that elapsed since the timer was started.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/time_static)
   */
  time(label?: string): void;
  /**
   * The **`console.timeEnd()`** static method stops a timer that was previously started by calling console.time().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/timeEnd_static)
   */
  timeEnd(label?: string): void;
  /**
   * The **`console.timeLog()`** static method logs the current value of a timer that was previously started by calling console.time().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/timeLog_static)
   */
  timeLog(label?: string, ...data: any[]): void;
  /** The **`console.timeStamp()`** static method adds a single marker to the browser's Performance tool (Firefox bug 1387528, Chrome). This lets you correlate a point in your code with the other events recorded in the timeline, such as layout and paint events. */
  timeStamp(label?: string): void;
  /**
   * The **`console.trace()`** static method outputs a stack trace to the console.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/trace_static)
   */
  trace(...data: any[]): void;
  /**
   * The **`console.warn()`** static method outputs a warning message to the console at the "warning" log level. The message is only displayed to the user if the console is configured to display warning output. In most cases, the log level is configured within the console UI. The message may receive special formatting, such as yellow colors and a warning icon.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/console/warn_static)
   */
  warn(...data: any[]): void;
}

declare var console: Console;

interface AudioDataOutputCallback {
  (output: AudioData): void;
}

interface DecodeErrorCallback {
  (error: DOMException): void;
}

interface DecodeSuccessCallback {
  (decodedData: AudioBuffer): void;
}

interface EncodedAudioChunkOutputCallback {
  (output: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata): void;
}

interface EncodedVideoChunkOutputCallback {
  (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata): void;
}

interface LockGrantedCallback<T> {
  (lock: Lock | null): T;
}

interface MediaSessionActionHandler {
  (details: MediaSessionActionDetails): void;
}

interface NotificationPermissionCallback {
  (permission: NotificationPermission): void;
}

interface PerformanceObserverCallback {
  (entries: PerformanceObserverEntryList, observer: PerformanceObserver): void;
}

interface PositionCallback {
  (position: GeolocationPosition): void;
}

interface PositionErrorCallback {
  (positionError: GeolocationPositionError): void;
}

interface QueuingStrategySize<T = any> {
  (chunk: T): number;
}

interface RTCPeerConnectionErrorCallback {
  (error: DOMException): void;
}

interface RTCSessionDescriptionCallback {
  (description: RTCSessionDescriptionInit): void;
}

interface SchedulerPostTaskCallback {
  (): any;
}

interface TransformerFlushCallback<O> {
  (controller: TransformStreamDefaultController<O>): void | PromiseLike<void>;
}

interface TransformerStartCallback<O> {
  (controller: TransformStreamDefaultController<O>): any;
}

interface TransformerTransformCallback<I, O> {
  (chunk: I, controller: TransformStreamDefaultController<O>): void | PromiseLike<void>;
}

interface UnderlyingSinkAbortCallback {
  (reason?: any): void | PromiseLike<void>;
}

interface UnderlyingSinkCloseCallback {
  (): void | PromiseLike<void>;
}

interface UnderlyingSinkStartCallback {
  (controller: WritableStreamDefaultController): any;
}

interface UnderlyingSinkWriteCallback<W> {
  (chunk: W, controller: WritableStreamDefaultController): void | PromiseLike<void>;
}

interface UnderlyingSourceCancelCallback {
  (reason?: any): void | PromiseLike<void>;
}

interface UnderlyingSourcePullCallback<R> {
  (controller: ReadableStreamController<R>): void | PromiseLike<void>;
}

interface UnderlyingSourceStartCallback<R> {
  (controller: ReadableStreamController<R>): any;
}

interface VideoFrameOutputCallback {
  (output: VideoFrame): void;
}

interface VoidFunction {
  (): void;
}

interface WebCodecsErrorCallback {
  (error: DOMException): void;
}

/**
 * The **`speechSynthesis`** read-only property of the Window object returns a SpeechSynthesis object, which is the entry point into using Web Speech API speech synthesis functionality.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/speechSynthesis)
 */
declare var speechSynthesis: SpeechSynthesis;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/crypto) */
declare var crypto: Crypto;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/indexedDB) */
declare var indexedDB: IDBFactory;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/performance) */
declare var performance: Performance;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/atob) */
declare function atob(data: string): string;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/btoa) */
declare function btoa(data: string): string;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/clearInterval) */
declare function clearInterval(id: number | undefined): void;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/clearTimeout) */
declare function clearTimeout(id: number | undefined): void;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/createImageBitmap) */
declare function createImageBitmap(
  image: ImageBitmapSource,
  options?: ImageBitmapOptions,
): Promise<ImageBitmap>;

declare function createImageBitmap(
  image: ImageBitmapSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  options?: ImageBitmapOptions,
): Promise<ImageBitmap>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch) */
declare function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/queueMicrotask) */
declare function queueMicrotask(callback: VoidFunction): void;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/setInterval) */
declare function setInterval(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/setTimeout) */
declare function setTimeout(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;

/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/structuredClone) */
declare function structuredClone<T = any>(value: T, options?: StructuredSerializeOptions): T;

type AlgorithmIdentifier = Algorithm | string;

type AllowSharedBufferSource = ArrayBufferLike | ArrayBufferView<ArrayBufferLike>;

type Base64URLString = string;

type BigInteger = Uint8Array<ArrayBuffer>;

type BlobPart = BufferSource | Blob | string;

type BodyInit = ReadableStream | XMLHttpRequestBodyInit;

type BufferSource = ArrayBufferView<ArrayBuffer> | ArrayBuffer;

type COSEAlgorithmIdentifier = number;

type CanvasImageSource = ImageBitmap | VideoFrame;

type ClipboardItems = ClipboardItem[];

type ConstrainBoolean = boolean | ConstrainBooleanParameters;

type ConstrainBooleanOrDOMString = boolean | string | ConstrainBooleanOrDOMStringParameters;

type ConstrainDOMString = string | string[] | ConstrainDOMStringParameters;

type ConstrainDouble = number | ConstrainDoubleRange;

type ConstrainULong = number | ConstrainULongRange;

type DOMHighResTimeStamp = number;

type EpochTimeStamp = number;

type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

type FileSystemWriteChunkType = BufferSource | Blob | string | WriteParams;

type FormDataEntryValue = File | string;

type HashAlgorithmIdentifier = AlgorithmIdentifier;

type HeadersInit = [string, string][] | Record<string, string> | Headers;

type IDBValidKey = number | string | Date | BufferSource | IDBValidKey[];

type ImageBitmapSource = Blob | ImageBitmap | VideoFrame;

type ImageBufferSource = AllowSharedBufferSource | ReadableStream;

type MessageEventSource = MessagePort;

type NamedCurve = string;

type PerformanceEntryList = PerformanceEntry[];

type PublicKeyCredentialClientCapabilities = Record<string, boolean>;

type RTCRtpReceiverTransform = RTCRtpScriptTransform;

type RTCRtpSenderTransform = RTCRtpScriptTransform;

type ReadableStreamController<T> =
  | ReadableStreamDefaultController<T>
  | ReadableByteStreamController;

type ReadableStreamReadResult<T> =
  | ReadableStreamReadValueResult<T>
  | ReadableStreamReadDoneResult<T>;

type ReadableStreamReader<T> = ReadableStreamDefaultReader<T> | ReadableStreamBYOBReader;

type RequestInfo = Request | string;

type TimerHandler = string | Function;

type Transferable =
  | ImageBitmap
  | MessagePort
  | ReadableStream
  | WritableStream
  | TransformStream
  | AudioData
  | VideoFrame;

type URLPatternInput = string | URLPatternInit;

type XMLHttpRequestBodyInit = Blob | BufferSource | FormData | URLSearchParams | string;

type AacBitstreamFormat = "aac" | "adts";

type AlphaOption = "discard" | "keep";

type AppendMode = "segments" | "sequence";

type AttestationConveyancePreference = "direct" | "enterprise" | "indirect" | "none";

type AudioContextLatencyCategory = "balanced" | "interactive" | "playback";

type AudioContextState = "closed" | "interrupted" | "running" | "suspended";

type AudioSampleFormat =
  | "f32"
  | "f32-planar"
  | "s16"
  | "s16-planar"
  | "s32"
  | "s32-planar"
  | "u8"
  | "u8-planar";

type AuthenticatorAttachment = "cross-platform" | "platform";

type AuthenticatorTransport = "ble" | "hybrid" | "internal" | "nfc" | "usb";

type AutomationRate = "a-rate" | "k-rate";

type AvcBitstreamFormat = "annexb" | "avc";

type BinaryType = "arraybuffer" | "blob";

type BiquadFilterType =
  | "allpass"
  | "bandpass"
  | "highpass"
  | "highshelf"
  | "lowpass"
  | "lowshelf"
  | "notch"
  | "peaking";

type BitrateMode = "constant" | "variable";

type ChannelCountMode = "clamped-max" | "explicit" | "max";

type ChannelInterpretation = "discrete" | "speakers";

type CodecState = "closed" | "configured" | "unconfigured";

type ColorSpaceConversion = "default" | "none";

type CompressionFormat = "deflate" | "deflate-raw" | "gzip";

type CredentialMediationRequirement = "conditional" | "optional" | "required" | "silent";

type DistanceModelType = "exponential" | "inverse" | "linear";

type EncodedAudioChunkType = "delta" | "key";

type EncodedVideoChunkType = "delta" | "key";

type EndOfStreamError = "decode" | "network";

type EndingType = "native" | "transparent";

type FileSystemHandleKind = "directory" | "file";

type FillLightMode = "auto" | "flash" | "off";

type FontDisplay = "auto" | "block" | "fallback" | "optional" | "swap";

type FontFaceLoadStatus = "error" | "loaded" | "loading" | "unloaded";

type FontFaceSetLoadStatus = "loaded" | "loading";

type GamepadHapticEffectType = "dual-rumble" | "trigger-rumble";

type GamepadHapticsResult = "complete" | "preempted";

type GamepadMappingType = "" | "standard" | "xr-standard";

type HardwareAcceleration = "no-preference" | "prefer-hardware" | "prefer-software";

type IDBCursorDirection = "next" | "nextunique" | "prev" | "prevunique";

type IDBRequestReadyState = "done" | "pending";

type IDBTransactionDurability = "default" | "relaxed" | "strict";

type IDBTransactionMode = "readonly" | "readwrite" | "versionchange";

type ImageOrientation = "flipY" | "from-image" | "none";

type KeyFormat = "jwk" | "pkcs8" | "raw" | "spki";

type KeyType = "private" | "public" | "secret";

type KeyUsage =
  | "decrypt"
  | "deriveBits"
  | "deriveKey"
  | "encrypt"
  | "sign"
  | "unwrapKey"
  | "verify"
  | "wrapKey";

type LatencyMode = "quality" | "realtime";

type LockMode = "exclusive" | "shared";

type MediaDeviceKind = "audioinput" | "audiooutput" | "videoinput";

type MediaSessionAction =
  | "nexttrack"
  | "pause"
  | "play"
  | "previoustrack"
  | "seekbackward"
  | "seekforward"
  | "seekto"
  | "skipad"
  | "stop";

type MediaSessionPlaybackState = "none" | "paused" | "playing";

type MediaStreamTrackState = "ended" | "live";

type NavigationTimingType = "back_forward" | "navigate" | "reload";

type NotificationDirection = "auto" | "ltr" | "rtl";

type NotificationPermission = "default" | "denied" | "granted";

type OpusBitstreamFormat = "ogg" | "opus";

type OrientationLockType =
  | "any"
  | "landscape"
  | "landscape-primary"
  | "landscape-secondary"
  | "natural"
  | "portrait"
  | "portrait-primary"
  | "portrait-secondary";

type OrientationType =
  | "landscape-primary"
  | "landscape-secondary"
  | "portrait-primary"
  | "portrait-secondary";

type OscillatorType = "custom" | "sawtooth" | "sine" | "square" | "triangle";

type OverSampleType = "2x" | "4x" | "none";

type PanningModelType = "HRTF" | "equalpower";

type PermissionName =
  | "camera"
  | "geolocation"
  | "microphone"
  | "midi"
  | "notifications"
  | "persistent-storage"
  | "push"
  | "screen-wake-lock"
  | "storage-access";

type PermissionState = "denied" | "granted" | "prompt";

type PredefinedColorSpace = "display-p3" | "srgb";

type PremultiplyAlpha = "default" | "none" | "premultiply";

type PresentationStyle = "attachment" | "inline" | "unspecified";

type PublicKeyCredentialType = "public-key";

type PushEncryptionKeyName = "auth" | "p256dh";

type RTCBundlePolicy = "balanced" | "max-bundle" | "max-compat";

type RTCDataChannelState = "closed" | "closing" | "connecting" | "open";

type RTCDegradationPreference = "balanced" | "maintain-framerate" | "maintain-resolution";

type RTCDtlsTransportState = "closed" | "connected" | "connecting" | "failed" | "new";

type RTCErrorDetailType =
  | "data-channel-failure"
  | "dtls-failure"
  | "fingerprint-failure"
  | "hardware-encoder-error"
  | "hardware-encoder-not-available"
  | "sctp-failure"
  | "sdp-syntax-error";

type RTCIceCandidateType = "host" | "prflx" | "relay" | "srflx";

type RTCIceComponent = "rtcp" | "rtp";

type RTCIceConnectionState =
  | "checking"
  | "closed"
  | "completed"
  | "connected"
  | "disconnected"
  | "failed"
  | "new";

type RTCIceGathererState = "complete" | "gathering" | "new";

type RTCIceGatheringState = "complete" | "gathering" | "new";

type RTCIceProtocol = "tcp" | "udp";

type RTCIceTcpCandidateType = "active" | "passive" | "so";

type RTCIceTransportPolicy = "all" | "relay";

type RTCIceTransportState =
  | "checking"
  | "closed"
  | "completed"
  | "connected"
  | "disconnected"
  | "failed"
  | "new";

type RTCPeerConnectionState =
  | "closed"
  | "connected"
  | "connecting"
  | "disconnected"
  | "failed"
  | "new";

type RTCPriorityType = "high" | "low" | "medium" | "very-low";

type RTCRtcpMuxPolicy = "require";

type RTCRtpTransceiverDirection = "inactive" | "recvonly" | "sendonly" | "sendrecv" | "stopped";

type RTCSctpTransportState = "closed" | "connected" | "connecting";

type RTCSdpType = "answer" | "offer" | "pranswer" | "rollback";

type RTCSignalingState =
  | "closed"
  | "have-local-offer"
  | "have-local-pranswer"
  | "have-remote-offer"
  | "have-remote-pranswer"
  | "stable";

type ReadableStreamReaderMode = "byob";

type ReadableStreamType = "bytes";

type ReadyState = "closed" | "ended" | "open";

type RecordingState = "inactive" | "paused" | "recording";

type RedEyeReduction = "always" | "controllable" | "never";

type ReferrerPolicy =
  | ""
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url";

type RequestCache =
  | "default"
  | "force-cache"
  | "no-cache"
  | "no-store"
  | "only-if-cached"
  | "reload";

type RequestCredentials = "include" | "omit" | "same-origin";

type RequestDestination =
  | ""
  | "audio"
  | "audioworklet"
  | "document"
  | "embed"
  | "font"
  | "frame"
  | "iframe"
  | "image"
  | "manifest"
  | "object"
  | "paintworklet"
  | "report"
  | "script"
  | "sharedworker"
  | "style"
  | "track"
  | "video"
  | "worker"
  | "xslt";

type RequestMode = "cors" | "navigate" | "no-cors" | "same-origin";

type RequestPriority = "auto" | "high" | "low";

type RequestRedirect = "error" | "follow" | "manual";

type ResidentKeyRequirement = "discouraged" | "preferred" | "required";

type ResizeQuality = "high" | "low" | "medium" | "pixelated";

type ResponseType = "basic" | "cors" | "default" | "error" | "opaque" | "opaqueredirect";

type ServiceWorkerState =
  | "activated"
  | "activating"
  | "installed"
  | "installing"
  | "parsed"
  | "redundant";

type SpeechSynthesisErrorCode =
  | "audio-busy"
  | "audio-hardware"
  | "canceled"
  | "interrupted"
  | "invalid-argument"
  | "language-unavailable"
  | "network"
  | "not-allowed"
  | "synthesis-failed"
  | "synthesis-unavailable"
  | "text-too-long"
  | "voice-unavailable";

type TaskPriority = "background" | "user-blocking" | "user-visible";

type UserVerificationRequirement = "discouraged" | "preferred" | "required";

type VideoColorPrimaries = "bt470bg" | "bt709" | "smpte170m";

type VideoEncoderBitrateMode = "constant" | "quantizer" | "variable";

type VideoMatrixCoefficients = "bt470bg" | "bt709" | "rgb" | "smpte170m";

type VideoPixelFormat =
  | "BGRA"
  | "BGRX"
  | "I420"
  | "I420A"
  | "I422"
  | "I444"
  | "NV12"
  | "RGBA"
  | "RGBX";

type VideoTransferCharacteristics = "bt709" | "iec61966-2-1" | "smpte170m";

type WakeLockType = "screen";

type WorkerType = "classic" | "module";

type WriteCommandType = "seek" | "truncate" | "write";

interface FormDataIterator<T> extends IteratorObject<T, BuiltinIteratorReturn, unknown> {
  [Symbol.iterator](): FormDataIterator<T>;
}

interface HeadersIterator<T> extends IteratorObject<T, BuiltinIteratorReturn, unknown> {
  [Symbol.iterator](): HeadersIterator<T>;
}

interface URLSearchParamsIterator<T> extends IteratorObject<T, BuiltinIteratorReturn, unknown> {
  [Symbol.iterator](): URLSearchParamsIterator<T>;
}

interface FileSystemDirectoryHandleAsyncIterator<T> extends AsyncIteratorObject<
  T,
  BuiltinIteratorReturn,
  unknown
> {
  [Symbol.asyncIterator](): FileSystemDirectoryHandleAsyncIterator<T>;
}

interface ReadableStreamAsyncIterator<T> extends AsyncIteratorObject<
  T,
  BuiltinIteratorReturn,
  unknown
> {
  [Symbol.asyncIterator](): ReadableStreamAsyncIterator<T>;
}

// ===========================================================================
// MDN-SOURCED ADDITIONS — Web APIs lib.dom.d.ts (TS 7.0.2) does not carry.
// Hand-written from the MDN references and the underlying specifications,
// in lib.dom style. Verified missing from lib.dom by probe (2026-10-16):
// BarcodeDetector, Generic Sensors, ContactsManager, BatteryManager.
// ===========================================================================

// ---- Barcode Detection (Shape Detection API) -------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
// Spec: https://wicg.github.io/shape-detection-api/#barcode-detection-api

type BarcodeFormat =
  | "aztec"
  | "code_128"
  | "code_39"
  | "code_93"
  | "codabar"
  | "data_matrix"
  | "ean_13"
  | "ean_8"
  | "itf"
  | "pdf417"
  | "qr_code"
  | "upc_a"
  | "upc_e"
  | "unknown";

interface BarcodeDetectorOptions {
  formats?: BarcodeFormat[];
}

interface DetectedBarcode {
  readonly boundingBox: DOMRectReadOnly;
  readonly rawValue: string;
  readonly format: BarcodeFormat;
  readonly cornerPoints: readonly DOMPointReadOnly[];
}

interface BarcodeDetector {
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

declare var BarcodeDetector: {
  prototype: BarcodeDetector;
  new (options?: BarcodeDetectorOptions): BarcodeDetector;
  getSupportedFormats(): Promise<BarcodeFormat[]>;
};

// ---- Generic Sensor API ------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/Sensor
// https://developer.mozilla.org/en-US/docs/Web/API/Accelerometer (etc.)
// Spec: https://www.w3.org/TR/generic-sensor/ and per-sensor specs

type SensorLocalCoordinateSystem = "device" | "screen";

interface SensorOptions {
  frequency?: number;
  referenceFrame?: SensorLocalCoordinateSystem;
}

interface SensorErrorEventInit extends EventInit {
  error: DOMException;
}

interface SensorErrorEvent extends Event {
  readonly error: DOMException;
}

declare var SensorErrorEvent: {
  prototype: SensorErrorEvent;
  new (type: string, init: SensorErrorEventInit): SensorErrorEvent;
};

interface Sensor extends EventTarget {
  readonly activated: boolean;
  readonly hasReading: boolean;
  readonly timestamp: DOMHighResTimeStamp | null;
  onactivate: ((this: Sensor, ev: Event) => void) | null;
  onerror: ((this: Sensor, ev: SensorErrorEvent) => void) | null;
  onreading: ((this: Sensor, ev: Event) => void) | null;
  start(): void;
  stop(): void;
}

declare var Sensor: { prototype: Sensor; new (): Sensor };

interface MotionSensor extends Sensor {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}

interface Accelerometer extends MotionSensor {}
interface LinearAccelerationSensor extends MotionSensor {}
interface GravitySensor extends MotionSensor {}
interface Gyroscope extends MotionSensor {}
interface Magnetometer extends MotionSensor {}
interface UncalibratedMagnetometer extends MotionSensor {
  readonly xBias: number | null;
  readonly yBias: number | null;
  readonly zBias: number | null;
}

declare var Accelerometer: {
  prototype: Accelerometer;
  new (options?: SensorOptions): Accelerometer;
};
declare var LinearAccelerationSensor: {
  prototype: LinearAccelerationSensor;
  new (options?: SensorOptions): LinearAccelerationSensor;
};
declare var GravitySensor: {
  prototype: GravitySensor;
  new (options?: SensorOptions): GravitySensor;
};
declare var Gyroscope: { prototype: Gyroscope; new (options?: SensorOptions): Gyroscope };
declare var Magnetometer: { prototype: Magnetometer; new (options?: SensorOptions): Magnetometer };
declare var UncalibratedMagnetometer: {
  prototype: UncalibratedMagnetometer;
  new (options?: SensorOptions): UncalibratedMagnetometer;
};

interface OrientationSensor extends Sensor {
  readonly quaternion: ReadonlyArray<number> | null;
  populateMatrix(matrix: Float32Array | Float64Array): void;
}

interface AbsoluteOrientationSensor extends OrientationSensor {}
interface RelativeOrientationSensor extends OrientationSensor {}

declare var AbsoluteOrientationSensor: {
  prototype: AbsoluteOrientationSensor;
  new (options?: SensorOptions): AbsoluteOrientationSensor;
};
declare var RelativeOrientationSensor: {
  prototype: RelativeOrientationSensor;
  new (options?: SensorOptions): RelativeOrientationSensor;
};

interface AmbientLightSensor extends Sensor {
  readonly illuminance: number | null;
}

declare var AmbientLightSensor: {
  prototype: AmbientLightSensor;
  new (options?: SensorOptions): AmbientLightSensor;
};

// ---- Contact Picker API ------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/ContactsManager/select
// Spec: https://wicg.github.io/contact-api/spec/

type ContactProperty = "address" | "email" | "icon" | "name" | "tel";

interface ContactsSelectOptions {
  multiple?: boolean;
}

interface ContactAddress {
  readonly addressLine: readonly string[];
  readonly city: string;
  readonly country: string;
  readonly dependentLocality: string;
  readonly organization: string;
  readonly phone: string;
  readonly postalCode: string;
  readonly recipient: string;
  readonly region: string;
  readonly sortingCode: string;
}

interface ContactInfo {
  readonly address?: readonly ContactAddress[];
  readonly email?: readonly string[];
  readonly icon?: readonly Blob[];
  readonly name?: readonly string[];
  readonly tel?: readonly string[];
}

interface ContactsManager {
  getProperties(): Promise<ContactProperty[]>;
  select(properties: ContactProperty[], options?: ContactsSelectOptions): Promise<ContactInfo[]>;
}

// ---- Battery Status API --------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/BatteryManager
// (Removed from some browsers for privacy; meaningful on native targets.)

interface BatteryManager extends EventTarget {
  readonly charging: boolean;
  /** Seconds until full; Infinity when not charging/unknown. */
  readonly chargingTime: number;
  /** Seconds until empty; Infinity when charging/unknown. */
  readonly dischargingTime: number;
  /** 0..1 */
  readonly level: number;
  onchargingchange: ((this: BatteryManager, ev: Event) => void) | null;
  onchargingtimechange: ((this: BatteryManager, ev: Event) => void) | null;
  ondischargingtimechange: ((this: BatteryManager, ev: Event) => void) | null;
  onlevelchange: ((this: BatteryManager, ev: Event) => void) | null;
}

// ---- Network Information API ---------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation
// Spec: https://wicg.github.io/netinfo/

type ConnectionType =
  | "bluetooth"
  | "cellular"
  | "ethernet"
  | "mixed"
  | "none"
  | "other"
  | "unknown"
  | "wifi"
  | "wimax";
type EffectiveConnectionType = "2g" | "3g" | "4g" | "slow-2g";

interface NetworkInformation extends EventTarget {
  readonly type?: ConnectionType;
  readonly effectiveType?: EffectiveConnectionType;
  /** Estimated downlink speed in megabits per second. */
  readonly downlink?: number;
  readonly downlinkMax?: number;
  /** Estimated round-trip time in milliseconds. */
  readonly rtt?: number;
  readonly saveData?: boolean;
  onchange: ((this: NetworkInformation, ev: Event) => void) | null;
}

// ---- Device Posture API ----------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/DevicePosture
// Spec: https://www.w3.org/TR/device-posture/

type DevicePostureType = "continuous" | "folded";

interface DevicePosture extends EventTarget {
  readonly type: DevicePostureType;
  onchange: ((this: DevicePosture, ev: Event) => void) | null;
}

declare var DevicePosture: { prototype: DevicePosture; new (): DevicePosture };

// ---- Screen (trimmed) ------------------------------------------------------------
// lib.dom's Screen is a seed we exclude, but ScreenOrientation (adopted
// verbatim) is reached as screen.orientation. This trimmed interface is
// the spec's Screen minus window-management members (ScreenDetails is a
// later, desktop-ledger decision).

interface Screen {
  readonly orientation: ScreenOrientation;
  readonly width: number;
  readonly height: number;
  readonly availWidth: number;
  readonly availHeight: number;
  readonly colorDepth: number;
  readonly pixelDepth: number;
}

declare var Screen: { prototype: Screen; new (): Screen };
declare var screen: Screen;

// ---- Navigator (trimmed) -------------------------------------------------------
// lib.dom's Navigator merges dozens of partial interfaces bound to the
// browser document (plugins, presentation, XR, ...). A native app realm
// has a navigator with exactly the application-platform members. Member
// semantics are the standards'; this interface only *selects* them.

type VibratePattern = number | number[];

interface Navigator {
  readonly mediaDevices: MediaDevices;
  readonly geolocation: Geolocation;
  readonly permissions: Permissions;
  readonly clipboard: Clipboard;
  readonly credentials: CredentialsContainer;
  readonly storage: StorageManager;
  readonly locks: LockManager;
  readonly wakeLock: WakeLock;
  readonly contacts: ContactsManager;
  readonly mediaSession: MediaSession;
  readonly connection?: NetworkInformation;
  readonly devicePosture?: DevicePosture;
  getGamepads(): (Gamepad | null)[];
  readonly userAgent: string;
  readonly language: string;
  readonly languages: readonly string[];
  readonly onLine: boolean;
  readonly hardwareConcurrency: number;
  readonly maxTouchPoints: number;
  share(data?: ShareData): Promise<void>;
  canShare(data?: ShareData): boolean;
  getBattery(): Promise<BatteryManager>;
  vibrate(pattern: VibratePattern): boolean;
  setAppBadge(contents?: number): Promise<void>;
  clearAppBadge(): Promise<void>;
}

declare var navigator: Navigator;
declare var Navigator: { prototype: Navigator; new (): Navigator };

// ===========================================================================
// MDN-SOURCED ADDITIONS, ROUND 2 — SpeechRecognition and the hardware-
// access family (Web Bluetooth, Web NFC, WebUSB, Web Serial, WebHID),
// plus FileSystemObserver, Compute Pressure, Idle Detection, EyeDropper,
// Keyboard (layout/lock) and Launch Handler. All verified absent from
// lib.dom 7.0.2 by probe (2026-10-16). Shapes follow the MDN references
// and the underlying specs; device access goes through the platform's
// chooser/permission UI exactly as specified — no relaxation natively.
// ===========================================================================

// ---- Web Speech: recognition (synthesis is in lib.dom proper) -------------
// https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative | null;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult | null;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEventInit extends EventInit {
  resultIndex?: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

declare var SpeechRecognitionEvent: {
  prototype: SpeechRecognitionEvent;
  new (type: string, init: SpeechRecognitionEventInit): SpeechRecognitionEvent;
};

type SpeechRecognitionErrorCode =
  | "no-speech"
  | "aborted"
  | "audio-capture"
  | "network"
  | "not-allowed"
  | "service-not-allowed"
  | "language-not-supported"
  | "phrases-not-supported";

interface SpeechRecognitionErrorEventInit extends EventInit {
  error: SpeechRecognitionErrorCode;
  message?: string;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: SpeechRecognitionErrorCode;
  readonly message: string;
}

declare var SpeechRecognitionErrorEvent: {
  prototype: SpeechRecognitionErrorEvent;
  new (type: string, init: SpeechRecognitionErrorEventInit): SpeechRecognitionErrorEvent;
};

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  /** Prefer on-device recognition where the platform supports it. */
  processLocally: boolean;
  onaudiostart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onaudioend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onsoundstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onsoundend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onspeechstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onspeechend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  abort(): void;
  start(): void;
  stop(): void;
}

declare var SpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
  available(options: {
    langs: string[];
    processLocally?: boolean;
  }): Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  install(options: { langs: string[]; processLocally?: boolean }): Promise<boolean>;
};

// ---- Web Bluetooth ---------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/Bluetooth
// Spec: https://webbluetoothcg.github.io/web-bluetooth/

type BluetoothServiceUUID = string | number;
type BluetoothCharacteristicUUID = string | number;
type BluetoothDescriptorUUID = string | number;

interface BluetoothRequestDeviceFilter {
  services?: BluetoothServiceUUID[];
  optionalServices?: BluetoothServiceUUID[];
  optionalManufacturerData?: number[];
  name?: string;
  namePrefix?: string;
  manufacturerData?: { companyIdentifier: number; dataPrefix?: Uint8Array; mask?: Uint8Array }[];
  serviceData?: { service: BluetoothServiceUUID; dataPrefix?: Uint8Array; mask?: Uint8Array }[];
}

interface RequestDeviceOptions {
  filters?: BluetoothRequestDeviceFilter[];
  exclusionFilters?: BluetoothRequestDeviceFilter[];
  optionalServices?: BluetoothServiceUUID[];
  optionalManufacturerData?: number[];
  acceptAllDevices?: boolean;
}

interface BluetoothCharacteristicProperties {
  readonly broadcast: boolean;
  readonly read: boolean;
  readonly writeWithoutResponse: boolean;
  readonly write: boolean;
  readonly notify: boolean;
  readonly indicate: boolean;
  readonly authenticatedSignedWrites: boolean;
  readonly reliableWrite: boolean;
  readonly writableAuxiliaries: boolean;
}

interface BluetoothRemoteGATTDescriptor extends EventTarget {
  readonly characteristic: BluetoothRemoteGATTCharacteristic;
  readonly uuid: string;
  readonly value?: DataView;
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource): Promise<void>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly service: BluetoothRemoteGATTService;
  readonly uuid: string;
  readonly properties: BluetoothCharacteristicProperties;
  readonly value?: DataView;
  oncharacteristicvaluechanged:
    | ((this: BluetoothRemoteGATTCharacteristic, ev: Event) => void)
    | null;
  getDescriptor(descriptor: BluetoothDescriptorUUID): Promise<BluetoothRemoteGATTDescriptor>;
  getDescriptors(descriptor?: BluetoothDescriptorUUID): Promise<BluetoothRemoteGATTDescriptor[]>;
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTService extends EventTarget {
  readonly device: BluetoothDevice;
  readonly uuid: string;
  readonly isPrimary: boolean;
  getCharacteristic(
    characteristic: BluetoothCharacteristicUUID,
  ): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(
    characteristic?: BluetoothCharacteristicUUID,
  ): Promise<BluetoothRemoteGATTCharacteristic[]>;
  getIncludedService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
  getIncludedServices(service?: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothRemoteGATTServer {
  readonly device: BluetoothDevice;
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
  getPrimaryServices(service?: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
  ongattserverdisconnected: ((this: BluetoothDevice, ev: Event) => void) | null;
  forget(): Promise<void>;
}

declare var BluetoothDevice: { prototype: BluetoothDevice; new (): BluetoothDevice };

interface Bluetooth extends EventTarget {
  getAvailability(): Promise<boolean>;
  getDevices(): Promise<BluetoothDevice[]>;
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
  onavailabilitychanged: ((this: Bluetooth, ev: Event) => void) | null;
}

// ---- Web NFC ---------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/NDEFReader
// Spec: https://w3c.github.io/web-nfc/

type NDEFRecordType = string;

interface NDEFRecordInit {
  recordType: NDEFRecordType;
  mediaType?: string;
  id?: string;
  data?: BufferSource | string | NDEFMessageInit;
  encoding?: string;
  lang?: string;
}

interface NDEFMessageInit {
  records: NDEFRecordInit[];
}

interface NDEFRecord {
  readonly recordType: NDEFRecordType;
  readonly mediaType?: string;
  readonly id?: string;
  readonly data?: DataView;
  readonly encoding?: string;
  readonly lang?: string;
  toRecords(): NDEFRecord[] | undefined;
}

declare var NDEFRecord: { prototype: NDEFRecord; new (init: NDEFRecordInit): NDEFRecord };

interface NDEFMessage {
  readonly records: readonly NDEFRecord[];
}

declare var NDEFMessage: { prototype: NDEFMessage; new (init: NDEFMessageInit): NDEFMessage };

interface NDEFReadingEventInit extends EventInit {
  serialNumber?: string;
  message: NDEFMessageInit;
}

interface NDEFReadingEvent extends Event {
  readonly serialNumber: string;
  readonly message: NDEFMessage;
}

declare var NDEFReadingEvent: {
  prototype: NDEFReadingEvent;
  new (type: string, init: NDEFReadingEventInit): NDEFReadingEvent;
};

interface NDEFReader extends EventTarget {
  onreading: ((this: NDEFReader, ev: NDEFReadingEvent) => void) | null;
  onreadingerror: ((this: NDEFReader, ev: Event) => void) | null;
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(
    message: NDEFMessageInit | string,
    options?: { overwrite?: boolean; signal?: AbortSignal },
  ): Promise<void>;
  makeReadOnly(options?: { signal?: AbortSignal }): Promise<void>;
}

declare var NDEFReader: { prototype: NDEFReader; new (): NDEFReader };

// ---- WebUSB ----------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/USB
// Spec: https://wicg.github.io/webusb/

interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
  serialNumber?: string;
}

interface USBControlTransferParameters {
  requestType: "standard" | "class" | "vendor";
  recipient: "device" | "interface" | "endpoint" | "other";
  request: number;
  value: number;
  index: number;
}

interface USBInTransferResult {
  readonly data?: DataView;
  readonly status: "ok" | "stall" | "babble";
}

interface USBOutTransferResult {
  readonly bytesWritten: number;
  readonly status: "ok" | "stall";
}

interface USBIsochronousInTransferPacket {
  readonly data?: DataView;
  readonly status: "ok" | "stall" | "babble";
}

interface USBIsochronousInTransferResult {
  readonly data?: DataView;
  readonly packets: readonly USBIsochronousInTransferPacket[];
}

interface USBIsochronousOutTransferPacket {
  readonly bytesWritten: number;
  readonly status: "ok" | "stall";
}

interface USBIsochronousOutTransferResult {
  readonly packets: readonly USBIsochronousOutTransferPacket[];
}

interface USBEndpoint {
  readonly endpointNumber: number;
  readonly direction: "in" | "out";
  readonly type: "bulk" | "interrupt" | "isochronous";
  readonly packetSize: number;
}

declare var USBEndpoint: { prototype: USBEndpoint; new (): USBEndpoint };

interface USBAlternateInterface {
  readonly alternateSetting: number;
  readonly interfaceClass: number;
  readonly interfaceSubclass: number;
  readonly interfaceProtocol: number;
  readonly interfaceName?: string;
  readonly endpoints: readonly USBEndpoint[];
}

declare var USBAlternateInterface: {
  prototype: USBAlternateInterface;
  new (): USBAlternateInterface;
};

interface USBInterface {
  readonly interfaceNumber: number;
  readonly alternate: USBAlternateInterface;
  readonly alternates: readonly USBAlternateInterface[];
  readonly claimed: boolean;
}

declare var USBInterface: { prototype: USBInterface; new (): USBInterface };

interface USBConfiguration {
  readonly configurationValue: number;
  readonly configurationName?: string;
  readonly interfaces: readonly USBInterface[];
}

declare var USBConfiguration: { prototype: USBConfiguration; new (): USBConfiguration };

interface USBDevice extends EventTarget {
  readonly usbVersionMajor: number;
  readonly usbVersionMinor: number;
  readonly usbVersionSubminor: number;
  readonly deviceClass: number;
  readonly deviceSubclass: number;
  readonly deviceProtocol: number;
  readonly deviceVersionMajor: number;
  readonly deviceVersionMinor: number;
  readonly deviceVersionSubminor: number;
  readonly vendorId: number;
  readonly productId: number;
  readonly manufacturerName?: string;
  readonly productName?: string;
  readonly serialNumber?: string;
  readonly configuration?: USBConfiguration;
  readonly configurations: readonly USBConfiguration[];
  readonly opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
  controlTransferIn(
    setup: USBControlTransferParameters,
    length: number,
  ): Promise<USBInTransferResult>;
  controlTransferOut(
    setup: USBControlTransferParameters,
    data?: BufferSource,
  ): Promise<USBOutTransferResult>;
  clearHalt(direction: "in" | "out", endpointNumber: number): Promise<void>;
  transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
  isochronousTransferIn(
    endpointNumber: number,
    packetLengths: number[],
  ): Promise<USBIsochronousInTransferResult>;
  isochronousTransferOut(
    endpointNumber: number,
    data: BufferSource,
    packetLengths: number[],
  ): Promise<USBIsochronousOutTransferResult>;
  reset(): Promise<void>;
}

declare var USBDevice: { prototype: USBDevice; new (): USBDevice };

interface USBConnectionEventInit extends EventInit {
  device: USBDevice;
}

interface USBConnectionEvent extends Event {
  readonly device: USBDevice;
}

declare var USBConnectionEvent: {
  prototype: USBConnectionEvent;
  new (type: string, init: USBConnectionEventInit): USBConnectionEvent;
};

interface USB extends EventTarget {
  onconnect: ((this: USB, ev: USBConnectionEvent) => void) | null;
  ondisconnect: ((this: USB, ev: USBConnectionEvent) => void) | null;
  getDevices(): Promise<USBDevice[]>;
  requestDevice(options: {
    filters: USBDeviceFilter[];
    exclusionFilters?: USBDeviceFilter[];
  }): Promise<USBDevice>;
}

// ---- Web Serial ---------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/Serial
// Spec: https://wicg.github.io/serial/

interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
  flowControl?: "none" | "hardware";
}

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: string | number;
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  onconnect: ((this: SerialPort, ev: Event) => void) | null;
  ondisconnect: ((this: SerialPort, ev: Event) => void) | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
  getInfo(): SerialPortInfo;
  setSignals(signals: {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
    break?: boolean;
  }): Promise<void>;
  getSignals(): Promise<{
    clearToSend: boolean;
    dataCarrierDetect: boolean;
    dataSetReady: boolean;
    ringIndicator: boolean;
  }>;
}

declare var SerialPort: { prototype: SerialPort; new (): SerialPort };

interface Serial extends EventTarget {
  onconnect: ((this: Serial, ev: Event) => void) | null;
  ondisconnect: ((this: Serial, ev: Event) => void) | null;
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: {
    filters?: SerialPortFilter[];
    allowedBluetoothServiceClassIds?: (string | number)[];
  }): Promise<SerialPort>;
}

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: string | number;
}

// ---- WebHID -------------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/HID
// Spec: https://wicg.github.io/webhid/

interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HIDCollectionInfo {
  usagePage: number;
  usage: number;
  type: number;
  children: HIDCollectionInfo[];
  inputReports: HIDReportInfo[];
  outputReports: HIDReportInfo[];
  featureReports: HIDReportInfo[];
}

interface HIDReportItem {
  isAbsolute?: boolean;
  isArray?: boolean;
  isBufferedBytes?: boolean;
  isConstant?: boolean;
  isLinear?: boolean;
  isRange?: boolean;
  isVolatile?: boolean;
  hasNull?: boolean;
  hasPreferredState?: boolean;
  isWrapped?: boolean;
  logicalMinimum: number;
  logicalMaximum: number;
  physicalMinimum: number;
  physicalMaximum: number;
  unitExponent: number;
  unitSystem: string;
  unitFactorLengthExponent: number;
  unitFactorMassExponent: number;
  unitFactorTimeExponent: number;
  unitFactorTemperatureExponent: number;
  unitFactorCurrentExponent: number;
  unitFactorLuminousIntensityExponent: number;
  usages: number[];
  usageMinimum: number;
  usageMaximum: number;
  reportSize: number;
  reportCount: number;
  strings: string[];
}

interface HIDReportInfo {
  reportId: number;
  items: HIDReportItem[];
}

interface HIDInputReportEventInit extends EventInit {
  device: HIDDevice;
  reportId: number;
  data: DataView;
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

declare var HIDInputReportEvent: {
  prototype: HIDInputReportEvent;
  new (type: string, init: HIDInputReportEventInit): HIDInputReportEvent;
};

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: readonly HIDCollectionInfo[];
  oninputreport: ((this: HIDDevice, ev: HIDInputReportEvent) => void) | null;
  open(): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  sendFeatureReport(reportId: number, data: BufferSource): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
}

declare var HIDDevice: { prototype: HIDDevice; new (): HIDDevice };

interface HIDConnectionEventInit extends EventInit {
  device: HIDDevice;
}

interface HIDConnectionEvent extends Event {
  readonly device: HIDDevice;
}

declare var HIDConnectionEvent: {
  prototype: HIDConnectionEvent;
  new (type: string, init: HIDConnectionEventInit): HIDConnectionEvent;
};

interface HID extends EventTarget {
  onconnect: ((this: HID, ev: HIDConnectionEvent) => void) | null;
  ondisconnect: ((this: HID, ev: HIDConnectionEvent) => void) | null;
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: {
    filters: HIDDeviceFilter[];
    exclusionFilters?: HIDDeviceFilter[];
  }): Promise<HIDDevice[]>;
}

// ---- FileSystemObserver ---------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver

type FileSystemChangeType =
  | "appeared"
  | "disappeared"
  | "modified"
  | "moved"
  | "unknown"
  | "errored";

interface FileSystemChangeRecord {
  readonly root: FileSystemHandle;
  readonly changedHandle: FileSystemHandle | null;
  readonly relativePathComponents: readonly string[];
  readonly type: FileSystemChangeType;
  readonly relativePathMovedFrom?: readonly string[];
}

type FileSystemObserverCallback = (
  records: FileSystemChangeRecord[],
  observer: FileSystemObserver,
) => void;

interface FileSystemObserver {
  observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>;
  unobserve(handle: FileSystemHandle): void;
  disconnect(): void;
}

declare var FileSystemObserver: {
  prototype: FileSystemObserver;
  new (callback: FileSystemObserverCallback): FileSystemObserver;
};

// ---- Compute Pressure --------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/PressureObserver

type PressureSource = "thermals" | "cpu";
type PressureState = "nominal" | "fair" | "serious" | "critical";

interface PressureRecord {
  readonly source: PressureSource;
  readonly state: PressureState;
  readonly time: DOMHighResTimeStamp;
  toJSON(): unknown;
}

type PressureUpdateCallback = (changes: PressureRecord[], observer: PressureObserver) => void;

interface PressureObserver {
  observe(source: PressureSource, options?: { sampleInterval?: number }): Promise<void>;
  unobserve(source: PressureSource): void;
  disconnect(): void;
  takeRecords(): PressureRecord[];
}

declare var PressureObserver: {
  prototype: PressureObserver;
  new (callback: PressureUpdateCallback, options?: { sampleInterval?: number }): PressureObserver;
  readonly knownSources: readonly PressureSource[];
};

// ---- Idle Detection -------------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/IdleDetector

type UserIdleState = "active" | "idle";
type ScreenIdleState = "locked" | "unlocked";

interface IdleDetector extends EventTarget {
  readonly userState: UserIdleState | null;
  readonly screenState: ScreenIdleState | null;
  onchange: ((this: IdleDetector, ev: Event) => void) | null;
  start(options?: { threshold?: number; signal?: AbortSignal }): Promise<void>;
}

declare var IdleDetector: {
  prototype: IdleDetector;
  new (): IdleDetector;
  requestPermission(): Promise<PermissionState>;
};

// ---- EyeDropper -------------------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper

interface EyeDropperOpenOptions {
  signal?: AbortSignal;
}

interface ColorSelectionResult {
  readonly sRGBHex: string;
}

interface EyeDropper {
  open(options?: EyeDropperOpenOptions): Promise<ColorSelectionResult>;
}

declare var EyeDropper: { prototype: EyeDropper; new (): EyeDropper };

// ---- Keyboard (layout map + lock) ----------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/Keyboard

interface KeyboardLayoutMap {
  readonly size: number;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  forEach(callback: (value: string, key: string, map: KeyboardLayoutMap) => void): void;
  get(key: string): string | undefined;
  has(key: string): boolean;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

interface Keyboard extends EventTarget {
  getLayoutMap(): Promise<KeyboardLayoutMap>;
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
  onlayoutchange: ((this: Keyboard, ev: Event) => void) | null;
}

// ---- Launch Handler ---------------------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/LaunchQueue

interface LaunchParams {
  readonly files: readonly FileSystemFileHandle[];
  readonly targetURL?: string;
}

type LaunchConsumer = (params: LaunchParams) => void;

interface LaunchQueue {
  setConsumer(consumer: LaunchConsumer): void;
}

declare var launchQueue: LaunchQueue;

// ---- Clipboard change event ------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/ClipboardChangeEvent

interface ClipboardChangeEventInit extends EventInit {
  types?: string[];
  changeId?: bigint;
}

interface ClipboardChangeEvent extends Event {
  readonly types: readonly string[];
  readonly changeId: bigint;
}

declare var ClipboardChangeEvent: {
  prototype: ClipboardChangeEvent;
  new (type: string, init?: ClipboardChangeEventInit): ClipboardChangeEvent;
};

interface Clipboard {
  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void;
  addEventListener(
    type: "clipboardchange",
    listener: (this: Clipboard, ev: ClipboardChangeEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: "clipboardchange",
    listener: (this: Clipboard, ev: ClipboardChangeEvent) => void,
    options?: EventListenerOptions | boolean,
  ): void;
}

// ---- Navigator additions (interface merging with the trimmed Navigator above) ------------

interface Navigator {
  readonly bluetooth: Bluetooth;
  readonly usb: USB;
  readonly serial: Serial;
  readonly hid: HID;
  readonly keyboard: Keyboard;
}
