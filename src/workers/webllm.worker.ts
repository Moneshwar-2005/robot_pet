/**
 * Dedicated Web Worker for WebLLM on-device inference.
 *
 * Keeps all GPU compute, tensor loading, and token generation OFF the main UI thread
 * to guarantee 60fps responsiveness in the React application.
 */

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
