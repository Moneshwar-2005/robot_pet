/**
 * Backward-Compatibility Shim for useOllamaChat.
 *
 * Refactored into provider-independent useAssistantChat in Step 3.4.
 * Re-exports the provider-independent implementation so existing code remains functional.
 */

export {
  useAssistantChat,
  useAssistantChat as useOllamaChat,
  type UIChatMessage,
  type Conversation,
} from './useAssistantChat';
