import { createClient } from '@supabase/supabase-js';
// import { handleCORS, rateLimitMiddleware, RATE_LIMITS } from './_utils/rate-limiter.js';
import { handleCORS, rateLimitMiddleware, RATE_LIMITS } from '../buddy-core/middleware/rate_limiter.js';
import { buildBridePrompt } from '../buddies/bride/prompts.js';
import { getSupabaseConfig, getAnthropicConfig } from '../buddy-core/config/index.js';

export default async function handler(req, res) {
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

  const { url: supabaseUrl, anonKey: supabaseAnonKey, serviceRoleKey: supabaseServiceKey } = getSupabaseConfig();
  const { apiKey: anthropicApiKey } = getAnthropicConfig();

  const supabase = createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${userToken}`
        }
      }
    }
  );

  // Service role client for database updates
  const supabaseService = createClient(
    supabaseUrl,
    supabaseServiceKey
  );

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw new Error('Invalid user token');

    // Get user's wedding and role
    const { data: membership, error: memberError } = await supabase
      .from('wedding_members')
      .select('wedding_id, role')
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) throw new Error('No wedding profile found');

    // Only besties can access bestie chat
    if (membership.role !== 'bestie') {
      return res.status(403).json({
        error: 'Only besties can access bestie chat. Please use the main wedding chat instead.',
        redirect: '/dashboard-luxury.html'
      });
    }

    const { data: weddingData, error: weddingError } = await supabase
      .from('wedding_profiles')
      .select('*')
      .eq('id', membership.wedding_id)
      .single();

    if (weddingError || !weddingData) throw new Error('Wedding profile not found');

    // Ensure bestie_profile exists (UI expects this table to be populated)
    const { data: bestieProfile } = await supabaseService
      .from('bestie_profile')
      .select('id')
      .eq('bestie_user_id', user.id)
      .eq('wedding_id', membership.wedding_id)
      .maybeSingle();

    if (!bestieProfile) {
      // Create bestie_profile if it doesn't exist
      const { error: profileError } = await supabaseService
        .from('bestie_profile')
        .insert({
          bestie_user_id: user.id,
          wedding_id: membership.wedding_id,
          bestie_brief: 'Welcome! Chat with me to start planning your bestie duties and surprises.'
        });

      if (profileError) {
        console.error('Failed to create bestie profile:', profileError);
        // Don't fail the request - continue with chat
      }
    }

    // Build wedding context for bestie chat with extraction
    let weddingContext = 'CURRENT WEDDING INFORMATION:';

    if (weddingData.wedding_name) weddingContext += `\n- Couple: ${weddingData.wedding_name}`;
    if (weddingData.partner1_name && weddingData.partner2_name) {
      weddingContext += `\n- Partners: ${weddingData.partner1_name} & ${weddingData.partner2_name}`;
    }
    if (weddingData.wedding_date) weddingContext += `\n- Wedding Date: ${weddingData.wedding_date}`;
    if (weddingData.expected_guest_count) weddingContext += `\n- Expected Guests: ${weddingData.expected_guest_count}`;
    if (weddingData.total_budget) weddingContext += `\n- Total Budget: $${weddingData.total_budget}`;
    if (weddingData.wedding_style) weddingContext += `\n- Style: ${weddingData.wedding_style}`;

    const todayDate = new Date().toISOString().split('T')[0];

    const promptContent = buildBridePrompt({
      variant: 'bestie',
      domainContext: weddingContext,
      userMessagePlaceholder: message,
      todayDate,
      weddingDate: weddingData.wedding_date || 'unknown'
    });

    // CALL CLAUDE with enhanced bestie extraction prompt
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3072,
        messages: [{
          role: 'user',
          content: promptContent
        }]
      })
    });

    // Check if API call was successful
    if (!claudeResponse.ok) {
      const errorData = await claudeResponse.json();
      console.error('Anthropic API error:', errorData);
      throw new Error(`Anthropic API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const claudeData = await claudeResponse.json();

    if (!claudeData.content || !claudeData.content[0]) {
      throw new Error('Invalid response from Claude');
    }

    const fullResponse = claudeData.content[0].text;

    // Parse response and extracted data
    const responseMatch = fullResponse.match(/<response>([\s\S]*?)<\/response>/);
    const dataMatch = fullResponse.match(/<extracted_data>([\s\S]*?)<\/extracted_data>/);

    const assistantMessage = responseMatch ? responseMatch[1].trim() : fullResponse;
    let extractedData = { budget_items: [], tasks: [], profile_summary: null };

    if (dataMatch) {
      try {
        const jsonStr = dataMatch[1].trim();
        extractedData = JSON.parse(jsonStr);
      } catch (e) {
        console.error('Failed to parse extracted data:', e);
      }
    }

    // Update database with extracted data from bestie chat

    // 1. Insert/Update budget items in budget_tracker table (BATCHED)
    if (extractedData.budget_items && extractedData.budget_items.length > 0) {
      // Fetch all existing budget items for this wedding in one query
      const { data: existingBudgets } = await supabaseService
        .from('budget_tracker')
        .select('id, category, spent_amount')
        .eq('wedding_id', membership.wedding_id);

      const existingBudgetMap = new Map();
      if (existingBudgets) {
        existingBudgets.forEach(b => {
          existingBudgetMap.set(b.category, { id: b.id, spent_amount: b.spent_amount });
        });
      }

      const budgetsToInsert = [];
      const budgetsToUpdate = [];

      for (const budgetItem of extractedData.budget_items) {
        const existing = existingBudgetMap.get(budgetItem.category);

        if (existing) {
          // Prepare for batch update
          const budgetUpdates = {};

          if (budgetItem.budgeted_amount !== null && budgetItem.budgeted_amount !== undefined) {
            budgetUpdates.budgeted_amount = budgetItem.budgeted_amount;
          }

          if (budgetItem.spent_amount !== null && budgetItem.spent_amount !== undefined) {
            budgetUpdates.spent_amount = (existing.spent_amount || 0) + budgetItem.spent_amount;
          }

          if (budgetItem.transaction_date) budgetUpdates.last_transaction_date = budgetItem.transaction_date;
          if (budgetItem.transaction_amount) budgetUpdates.last_transaction_amount = budgetItem.transaction_amount;
          if (budgetItem.transaction_description) budgetUpdates.last_transaction_description = budgetItem.transaction_description;
          if (budgetItem.notes) budgetUpdates.notes = budgetItem.notes;

          if (Object.keys(budgetUpdates).length > 0) {
            budgetsToUpdate.push({ id: existing.id, updates: budgetUpdates });
          }
        } else {
          // Prepare for batch insert
          budgetsToInsert.push({
            wedding_id: membership.wedding_id,
            category: budgetItem.category,
            budgeted_amount: budgetItem.budgeted_amount || 0,
            spent_amount: budgetItem.spent_amount || 0,
            last_transaction_date: budgetItem.transaction_date,
            last_transaction_amount: budgetItem.transaction_amount,
            last_transaction_description: budgetItem.transaction_description,
            notes: budgetItem.notes
          });
        }
      }

      // Batch insert new budget items
      if (budgetsToInsert.length > 0) {
        const { error: budgetInsertError } = await supabaseService
          .from('budget_tracker')
          .insert(budgetsToInsert);

        if (budgetInsertError) {
          console.error('Failed to batch insert budgets:', budgetInsertError);
        }
      }

      // Batch update existing budget items (in parallel)
      if (budgetsToUpdate.length > 0) {
        await Promise.all(
          budgetsToUpdate.map(({ id, updates }) =>
            supabaseService
              .from('budget_tracker')
              .update(updates)
              .eq('id', id)
              .then(({ error }) => {
                if (error) console.error('Failed to update budget:', error);
              })
          )
        );
      }
    }

    // 2. Insert tasks in wedding_tasks table (BATCHED)
    if (extractedData.tasks && extractedData.tasks.length > 0) {
      const tasksToInsert = extractedData.tasks.map(task => ({
        wedding_id: membership.wedding_id,
        ...task
      }));

      const { error: taskInsertError } = await supabaseService
        .from('wedding_tasks')
        .insert(tasksToInsert);

      if (taskInsertError) {
        console.error('Failed to batch insert tasks:', taskInsertError);
      }
    }

    // 3. Update bestie_profile with conversation summary
    if (extractedData.profile_summary && extractedData.profile_summary.trim()) {
      const { error: profileUpdateError } = await supabaseService
        .from('bestie_profile')
        .update({
          bestie_brief: extractedData.profile_summary,
          updated_at: new Date().toISOString()
        })
        .eq('bestie_user_id', user.id)
        .eq('wedding_id', membership.wedding_id);

      if (profileUpdateError) {
        console.error('Failed to update bestie profile:', profileUpdateError);
        // Don't fail the request if profile update fails
      }
    }

    // Save messages to chat_messages table
    try {
      // Save user message
      const { error: userMsgError } = await supabaseService
        .from('chat_messages')
        .insert({
          wedding_id: membership.wedding_id,
          user_id: user.id,
          role: 'user',
          message: message,
          message_type: 'bestie'
        });

      if (userMsgError) {
        console.error('Failed to save user message:', userMsgError);
      }

      // Save assistant message
      const { error: assistantMsgError } = await supabaseService
        .from('chat_messages')
        .insert({
          wedding_id: membership.wedding_id,
          user_id: user.id,
          role: 'assistant',
          message: assistantMessage,
          message_type: 'bestie'
        });

      if (assistantMsgError) {
        console.error('Failed to save assistant message:', assistantMsgError);
      }
    } catch (saveError) {
      console.error('Error saving chat messages:', saveError);
      // Don't fail the request if saving fails
    }

    return res.status(200).json({
      response: assistantMessage,
      conversationId: conversationId || 'bestie-temp',
      extractedData: extractedData // For debugging
    });

  } catch (error) {
    // Security: Only log error message, not full error object (may contain user messages, bestie data, user/wedding IDs)
    console.error('Bestie chat error:', error.message || 'Unknown error');
    return res.status(500).json({ error: error.message || 'Chat processing failed' });
  }
}
