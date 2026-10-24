import { z } from 'zod';

import { successEnvelope } from './envelope';

// The browser sends only the conversation. The Worker adds the model, key, and timeout, so the
// OpenRouter credential never reaches client code.
export const ASSISTANT_MAX_MESSAGES = 12;
export const ASSISTANT_MAX_CONTENT_LENGTH = 6000;

export const AssistantMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1).max(ASSISTANT_MAX_CONTENT_LENGTH),
});

export const AssistantRequestSchema = z.strictObject({
  messages: z.array(AssistantMessageSchema).min(1).max(ASSISTANT_MAX_MESSAGES),
});

export const AssistantReplySchema = z.object({
  reply: z.string().min(1),
  model: z.string().min(1),
});

export const AssistantReplyResponseSchema = successEnvelope(AssistantReplySchema);

export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
export type AssistantRequest = z.infer<typeof AssistantRequestSchema>;
export type AssistantReply = z.infer<typeof AssistantReplySchema>;
export type AssistantReplyResponse = z.infer<typeof AssistantReplyResponseSchema>;
