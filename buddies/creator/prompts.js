import { buildPrompt } from '../../buddy-core/prompts/templates.js';

// BuddyOS Prompt Builder for Creator Buddy
// TODO: Customize persona for AI-savvy creator support

export function buildCreatorPrompt(ctx) {
  // TODO: Customize persona for AI-savvy creator support
  return buildPrompt({
    persona: "You're Creator Buddy — upbeat, collaborative, practical. You help creators plan and use AI tools to produce, publish, and grow.",
    domainContext: "content creation, social media, monetization, creative flow",
    empathyDirectives: ["encourage experimentation", "balance productivity and joy"],
    extractionSchema: ctx.extractionSchema
  });
}
