// Creator Buddy chat endpoint — powered by BuddyOS Core

import { createClient } from '@supabase/supabase-js';
import { handleCORS, rateLimitMiddleware, RATE_LIMITS } from '../buddy-core/middleware/rate_limiter.js';
import { getAnthropicConfig, getSupabaseConfig } from '../buddy-core/config/index.js';
import { buildCreatorPrompt } from '../buddies/creator/prompts.js';

const CLAUDE_RESPONSE_CHAR_LIMIT = 20000;
const isProduction = process.env.NODE_ENV === 'production';

function logError(message, error) {
  if (isProduction) {
    console.error(message);
    return;
  }

  if (error?.message) {
    console.error(message, { message: error.message });
  } else if (error) {
    console.error(message, error);
  } else {
    console.error(message);
  }
}

// TODO: Create creator_profiles table in Supabase with fields like:
// - creator_type (video, writing, social, design, etc.)
// - platform_focus (YouTube, TikTok, Instagram, Blog, etc.)
// - content_goals
// - current_tools
// - monetization_status

// TODO: Create creator_tasks table for tracking content planning tasks
// TODO: Create creator_tools table for tracking tool recommendations and usage

export async function handleCreatorBuddy(req, res) {
  // Handle CORS preflight
  if (handleCORS(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Apply rate limiting (30 requests per minute for chat)
  if (!rateLimitMiddleware(req, res, RATE_LIMITS.MODERATE)) {
    return;
  }

  const { message, conversationId, userToken } = req.body;

  if (!message || !userToken) {
    return res.status(400).json({ error: 'Message and user token required' });
  }

  const { url, anonKey, serviceRoleKey } = getSupabaseConfig();

  const supabase = createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${userToken}`
      }
    }
  });

  // Service role client for database updates (when schema exists)
  const supabaseService = createClient(url, serviceRoleKey);

  try {
    // Authenticate user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Invalid user token');
    }

    // TODO: Get user's creator profile once schema exists
    // const { data: creatorProfile, error: profileError } = await supabase
    //   .from('creator_profiles')
    //   .select('*')
    //   .eq('user_id', user.id)
    //   .single();

    // Build creator context (placeholder for now)
    const creatorContext = `You are Creator Buddy — an upbeat, collaborative AI assistant helping content creators plan and use AI tools to produce, publish, and grow.

TASK: Help the creator with their question or request.

USER MESSAGE: "${message}"

INSTRUCTIONS:
1. Respond naturally and conversationally
2. Provide practical, actionable advice for content creators
3. Suggest relevant AI tools and workflows when appropriate
4. Encourage experimentation and balance productivity with creative joy
5. Return your response in this EXACT format:

<response>Your natural, helpful response here</response>

<extracted_data>
{
  "creator_profile": {
    "creator_type": "video|writing|social|design|multi|other or null",
    "platform_focus": "string or null",
    "content_goals": "string or null"
  },
  "tools_mentioned": [
    {
      "tool_name": "string",
      "tool_category": "video|writing|social|design|automation|analytics|other",
      "use_case": "string or null"
    }
  ],
  "tasks": [
    {
      "task_name": "string",
      "task_description": "string or null",
      "category": "content|publishing|growth|monetization|learning|other or null",
      "due_date": "YYYY-MM-DD or null",
      "priority": "low|medium|high|urgent or null"
    }
  ]
}
</extracted_data>

EXTRACTION RULES:
- creator_profile: Extract information about the creator's focus and goals
- tools_mentioned: Extract any AI tools or software mentioned
- tasks: Extract any action items or goals mentioned

IMPORTANT:
- Today's date is ${new Date().toISOString().split('T')[0]}
- Only include sections that have data. Empty arrays [] are ok if nothing was mentioned
- If nothing extractable was mentioned, return {"creator_profile": {}, "tools_mentioned": [], "tasks": []}`;

    // TODO: Build prompt using buildCreatorPrompt with proper context structure
    // For now, using the simple context string above

    const { apiKey } = getAnthropicConfig();

    // Call Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: creatorContext
        }]
      })
    });

    // Check if API call was successful
    if (!claudeResponse.ok) {
      const errorData = await claudeResponse.json();
      const errorMessage = errorData?.error?.message || 'Unknown error';
      logError('Anthropic API error', new Error(errorMessage));
      throw new Error(`Anthropic API error: ${errorMessage}`);
    }

    const claudeData = await claudeResponse.json();

    if (!claudeData.content || !claudeData.content[0]) {
      throw new Error('Invalid response from Claude');
    }

    const fullResponse = claudeData.content[0].text;

    // Parse response and extracted data
    const responseMatch = fullResponse.match(/<response>([\s\S]*?)<\/response>/);
    const dataMatch = fullResponse.match(/<extracted_data>([\s\S]*?)<\/extracted_data>/);

    let assistantMessage = responseMatch ? responseMatch[1].trim() : fullResponse;

    // TODO: Process extracted data when creator schema is ready
    // For now, just capture it
    let extractedData = null;
    if (dataMatch) {
      try {
        const rawExtractedSection = dataMatch[1];
        extractedData = JSON.parse(rawExtractedSection);
        // TODO: Save to creator_profiles, creator_tools, creator_tasks tables
      } catch (parseError) {
        logError('Failed to parse extracted data', parseError);
      }
    }

    if (assistantMessage.length > CLAUDE_RESPONSE_CHAR_LIMIT) {
      assistantMessage = `${assistantMessage.slice(0, CLAUDE_RESPONSE_CHAR_LIMIT)}…`;
    }

    // TODO: Save conversation to creator_conversations table

    return res.status(200).json({
      response: assistantMessage,
      conversationId: conversationId || 'temp',
      extractedData: extractedData // Include for debugging/future use
    });

  } catch (error) {
    logError('Creator chat error', error);

    if (error.message === 'Invalid user token') {
      return res.status(401).json({ error: 'Invalid or expired authentication token' });
    }

    return res.status(500).json({
      error: 'An error occurred while processing your request',
      message: isProduction ? undefined : error.message
    });
  }
}

export default handleCreatorBuddy;
