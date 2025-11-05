// BuddyOS Router — routes chat requests to domain-specific buddy handlers

import { buildCreatorPrompt } from "../buddies/creator/prompts.js";

// Handler mapping for different buddy domains
const handlers = {
  bride: handleBrideBuddy,
  creator: async (message) => {
    // Placeholder route for Creator Buddy
    // TODO: Replace placeholder response with real Creator Buddy chat handler later.
    return { role: "assistant", content: `Creator Buddy received: ${message}` };
  },
};

// Placeholder for Bride Buddy handler
// TODO: Import actual Bride Buddy chat handler
async function handleBrideBuddy(message) {
  return { role: "assistant", content: `Bride Buddy received: ${message}` };
}

// Main router function
export async function routeBuddyRequest(domain, message, context = {}) {
  const handler = handlers[domain];

  if (!handler) {
    throw new Error(`Unknown buddy domain: ${domain}`);
  }

  return await handler(message, context);
}
