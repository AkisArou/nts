/**
 * @nts/sdk/notifications — telling the user things.
 *
 * Standard parts (use directly): immediate display is
 * `new Notification(title, options)`; web push is the Push API;
 * the icon badge is `navigator.setAppBadge(n)`.
 * SDK parts: the things with no standard — *scheduled* local
 * notifications and *native* push registration/tokens.
 * Permission: `"notifications"`; nothing here prompts implicitly.
 */
import type { Availability, SignalOptions, TypedEventTarget } from "./core.d.ts";

/** Re-exported so `@nts/sdk/notifications` is self-describing in the API reference. */
export type Notification = globalThis.Notification;
export type NotificationOptions = globalThis.NotificationOptions;
export type NotificationPermission = globalThis.NotificationPermission;
export type PushManager = globalThis.PushManager;
export type PushSubscription = globalThis.PushSubscription;

export type NotificationTrigger =
  | { readonly type: "date"; readonly at: Date }
  /** Platform minimum intervals clamp (e.g. 60s), never error. */
  | { readonly type: "interval"; readonly seconds: number }
  | {
      readonly type: "calendar";
      readonly hour?: number;
      readonly minute?: number;
      /** 1 = Sunday … 7 = Saturday. */
      readonly weekday?: number;
      readonly day?: number;
      readonly month?: number;
    };

export interface NotificationAction {
  readonly id: string;
  readonly title: string;
  readonly opensApp?: boolean;
  readonly textInput?: boolean;
  readonly destructive?: boolean;
}

export interface ScheduledNotificationContent {
  readonly title: string;
  readonly body?: string;
  readonly data?: unknown;
  readonly actions?: readonly NotificationAction[];
  readonly threadId?: string;
  readonly badge?: number;
  readonly sound?: boolean | string;
}

export interface ScheduledNotification {
  readonly id: string;
  readonly content: ScheduledNotificationContent;
  readonly trigger: NotificationTrigger;
}

export interface NotificationResponse {
  /** For push/immediate notifications, content as delivered, trigger absent. */
  readonly notification: { readonly id: string; readonly content: ScheduledNotificationContent };
  readonly actionId?: string;
  readonly text?: string;
}

export interface NotificationResponseEvent extends Event {
  readonly response: NotificationResponse;
}

/** No fake unification: the token names its push system. */
export type PushToken =
  | { readonly type: "apns"; readonly token: string }
  | { readonly type: "fcm"; readonly token: string }
  /** Browser Web Push — the subscription itself, as standard JSON. */
  | { readonly type: "web-push"; readonly subscription: unknown };

export type NotificationImportance = "min" | "low" | "default" | "high" | "max";

/** Android notification channel. Other platforms accept and map where they can. */
export interface NotificationChannel {
  readonly id: string;
  readonly name: string;
  readonly importance: NotificationImportance;
  readonly description?: string;
  readonly sound?: string;
  readonly vibrationPattern?: readonly number[];
  readonly lightColor?: string;
}

/** Action category registered up front (required for actionable notifications on iOS). */
export interface NotificationCategory {
  readonly id: string;
  readonly actions: readonly NotificationAction[];
}

export interface Notifications extends TypedEventTarget<{ response: NotificationResponseEvent }> {
  availability(): Promise<Availability>;
  /** Optional channel (Android) and category (iOS actions) are data on the content. */
  schedule(content: ScheduledNotificationContent & { readonly channelId?: string; readonly categoryId?: string }, trigger: NotificationTrigger, options?: SignalOptions): Promise<string>;
  scheduled(): Promise<readonly ScheduledNotification[]>;
  cancel(id: string): Promise<void>;
  cancelAll(): Promise<void>;
  /** The tap response that cold-launched the app, if one did. */
  readonly initialResponse: NotificationResponse | undefined;
  /** Register for remote push; call each launch (tokens rotate). */
  getPushToken(options?: SignalOptions): Promise<PushToken>;
  channels(): Promise<readonly NotificationChannel[]>;
  setChannel(channel: NotificationChannel): Promise<void>;
  deleteChannel(id: string): Promise<void>;
  categories(): Promise<readonly NotificationCategory[]>;
  setCategory(category: NotificationCategory): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  /** Notifications currently sitting in the tray/center. */
  delivered(): Promise<readonly { readonly id: string; readonly content: ScheduledNotificationContent }[]>;
  dismiss(id: string): Promise<void>;
  dismissAll(): Promise<void>;
  /** Current badge count as set via navigator.setAppBadge or notifications. */
  getBadge(): Promise<number>;
  /** FCM topic subscription (Android/web-push); rejects `unsupported` on APNs. */
  subscribeToTopic(topic: string): Promise<void>;
  unsubscribeFromTopic(topic: string): Promise<void>;
}

export declare const notifications: Notifications;
