/**
 * Kant Messages — Per-contact conversation persistence with at-rest encryption
 */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';
export interface StoredMessage {
    id: string;
    fromMe: boolean;
    ciphertext: Uint8Array;
    timestamp: number;
    status: MessageStatus;
}
export interface Conversation {
    contactPubkeyHex: string;
    messages: StoredMessage[];
}
/** Save a message to conversation (encrypts text) */
export declare function saveMessage(contactPubkeyHex: string, identityPrivateKey: Uint8Array, msg: Omit<StoredMessage, 'ciphertext'> & {
    text: string;
}): Promise<void>;
/** Load decrypted conversation */
export declare function getConversation(contactPubkeyHex: string, identityPrivateKey: Uint8Array): Promise<Conversation | null>;
/** Get summaries of all conversations */
export declare function getAllConversations(): Promise<Conversation[]>;
/** Delete entire conversation */
export declare function deleteConversation(contactPubkeyHex: string): Promise<void>;
