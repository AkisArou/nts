/**
 * @nts/sdk/contacts — the address book.
 *
 * Standard part (use directly): the Contact Picker.
 *   const picked = await navigator.contacts.select(["name", "tel"], { multiple: true });
 * Picker-first means most apps need nothing here and no permission.
 * SDK part: full address-book access (needs `"contacts"`), which the
 * Picker deliberately does not provide.
 */
import type { Availability, SignalOptions, TypedEventTarget } from "./core.d.ts";

/** Re-exported so `@nts/sdk/contacts` is self-describing in the API reference. */
export type ContactsManager = globalThis.ContactsManager;
export type ContactInfo = globalThis.ContactInfo;
export type ContactAddress = globalThis.ContactAddress;
export type ContactProperty = globalThis.ContactProperty;

export interface PersonName {
  readonly given?: string;
  readonly family?: string;
  readonly middle?: string;
  readonly prefix?: string;
  readonly suffix?: string;
  /** Single display string as the OS formats it. */
  readonly display: string;
}

export interface LabeledValue {
  /** OS label ("home", "work", "mobile", …) — free-form by necessity. */
  readonly label?: string;
  readonly value: string;
}

export interface Contact {
  /** Stable OS id; opaque. Absent until saved. */
  readonly id?: string;
  readonly name: PersonName;
  readonly phones: readonly LabeledValue[];
  readonly emails: readonly LabeledValue[];
  readonly addresses: readonly ContactAddress[];
  readonly organization?: string;
  readonly jobTitle?: string;
  readonly birthday?: Date;
  readonly note?: string;
  /** Avatar image bytes, as a standard Blob. */
  readonly photo?: Blob;
}

export interface ContactQuery {
  /** Substring match against names, as the OS defines it. */
  readonly name?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export type NewContact = Omit<Contact, "id">;

export interface ContactGroup {
  readonly id: string;
  readonly name: string;
  /** Container/account the group belongs to (iOS grouping model). */
  readonly containerId?: string;
}

export interface ContactsChangeEvent extends Event {}

export interface Contacts extends TypedEventTarget<{ change: ContactsChangeEvent }> {
  availability(): Promise<Availability>;
  query(filter?: ContactQuery, options?: SignalOptions): Promise<readonly Contact[]>;
  get(id: string, options?: SignalOptions): Promise<Contact | undefined>;
  /** Creates in the default account/container. Returns the saved contact. */
  create(contact: NewContact, options?: SignalOptions): Promise<Contact>;
  /** Replaces the contact with the same id. */
  update(contact: Contact & { readonly id: string }, options?: SignalOptions): Promise<void>;
  remove(id: string, options?: SignalOptions): Promise<void>;
  /**
   * Opens the system contact editor (new contact when no argument, edit
   * when given). Resolves with the saved contact, or null if dismissed.
   * The editor carries its own consent; no contacts permission needed.
   */
  presentForm(contact?: Contact, options?: SignalOptions): Promise<Contact | null>;
  /** Serialize to vCard text (share it with navigator.share or files). */
  toVCard(contact: Contact): Promise<string>;
  groups(): Promise<readonly ContactGroup[]>;
  createGroup(name: string): Promise<ContactGroup>;
  renameGroup(id: string, name: string): Promise<void>;
  deleteGroup(id: string): Promise<void>;
  addToGroup(contactId: string, groupId: string): Promise<void>;
  removeFromGroup(contactId: string, groupId: string): Promise<void>;
}

export declare const contacts: Contacts;
