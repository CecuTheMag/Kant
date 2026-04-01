/**
 * Kant Contacts — IndexedDB storage for contacts with QR code sharing
 */
export interface Contact {
    publicKeyHex: string;
    nickname?: string;
    addedAt: number;
}
/** Add or update a contact */
export declare function addContact(publicKeyHex: string, nickname?: string): Promise<void>;
/** Get all contacts */
export declare function getContacts(): Promise<Contact[]>;
/** Get single contact by hex */
export declare function getContact(publicKeyHex: string): Promise<Contact | undefined>;
/** Delete contact */
export declare function deleteContact(publicKeyHex: string): Promise<void>;
/** Generate QR code SVG for sharing (format: hex|nickname) */
export declare function generateQR(publicKeyHex: string, nickname?: string): Promise<string>;
/** Parse QR code data */
export declare function parseQR(qrData: string): {
    publicKeyHex: string;
    nickname?: string;
} | null;
