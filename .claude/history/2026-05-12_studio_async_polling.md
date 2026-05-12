# 2026-05-12 — Studio asynchronous polling update

## What
Updated the `alpha-studio-backend/server/routes/studio.js` API to properly support the new asynchronous request model (`HTTP 202 Async envelope`) used by the recent versions of `alpha-studio-flow-agent`.

## Why
When generating an image or a video, the `alpha-studio-flow-agent` has been refactored in a previous update (Phase 5) to use the Async API + Wait Queue architecture where requests to `/api/studio/image` immediately return `HTTP 202 Accepted` along with a `genId`, placing the task into a background queue. However, the Node.js Backend was still attempting to extract the full response data `items` directly from that initial response. This resulted in the condition `items.length === 0` to trigger in backend, forcing an immediate `HTTP 502: Flow agent không trả mediaName...`, causing the Frontend UI to crash the process within 0.8 seconds.

## Changes
- **`server/routes/studio.js`:** 
  - Added a `pollAgentProgress(server, genId, timeoutSec)` helper function to correctly handle the background API progress checks internally inside the backend.
  - Modified both `POST /image/generate` and `POST /video/generate` endpoints. If the Flow Agent responds with `HTTP 202`, the backend will iteratively poll `/api/studio/progress/${genId}` inside a promise-based loop until `status` becomes `'done'` or `'failed'` before resolving the proxy request back to the Frontend (which retains its own UI polling component unaffected).
