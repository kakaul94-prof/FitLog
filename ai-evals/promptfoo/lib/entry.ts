// What the promptfoo provider runs: the app's own code, bundled by bundle.mjs.
//
// - onRequestPost is the real Pages Function behind /api/trainer: its system
//   prompt, model, token ceiling, input caps, data blocks and SSE-to-text
//   stream, exactly as deployed. Nothing about it is re-implemented here.
// - displayText and parseRemember are the browser's own parser: what the chat
//   bubble shows, and which "Remember" chip a reply would offer.
// - registerCall routes the function's upstream request (see fetch-shim.mjs).
export { onRequestPost } from '../../../functions/api/trainer'
export { displayText, parseRemember } from '../../../src/lib/trainer'
export { registerCall } from './fetch-shim.mjs'
