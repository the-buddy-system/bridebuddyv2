// BuddyOS Router — routes chat requests to domain-specific buddy handlers

import { handleCreatorBuddy } from "./creator-chat.js";

// Handler mapping for different buddy domains
const handlers = {
  bride: handleBrideBuddy,
  creator: handleCreatorBuddy,
};

// Placeholder for Bride Buddy handler
// TODO: Import actual Bride Buddy chat handler from chat.js
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
