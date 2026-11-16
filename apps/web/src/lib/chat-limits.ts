/** Limits of the support assistant, shared by the chat window and the server */

/** The longest question a visitor can send */
export const MAX_QUESTION_CHARS = 1000;

/** How many messages of a conversation are sent (questions and answers together) */
export const MAX_TURNS = 10;

/** The error codes the server answers with, which the chat window turns into messages */
export type ChatError = "busy" | "unavailable" | "tooLong" | "invalid" | "failed";
