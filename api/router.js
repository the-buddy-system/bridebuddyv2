import { handleBrideBuddy } from './chat.js';

export async function routeToBuddy(domain, message) {
  const handlers = { bride: handleBrideBuddy };
  return (handlers[domain] || handleBrideBuddy)(message);
}

// TODO: Add Creator Buddy next.
