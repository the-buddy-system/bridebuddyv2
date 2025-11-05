// BuddyOS integration: now using shared Buddy Core + Bride Buddy adapters
import { createClient } from '@supabase/supabase-js';
// import { handleCORS, rateLimitMiddleware, RATE_LIMITS } from './_utils/rate-limiter.js';
import { handleCORS, rateLimitMiddleware, RATE_LIMITS } from '../buddy-core/middleware/rate_limiter.js';
import { processClaudePayload, vendorKey, taskDeterministicId } from '../buddy-core/structured-data/wedding_extractors.js';
import { buildBridePrompt } from '../buddies/bride/prompts.js';
import { getSupabaseConfig, getAnthropicConfig } from '../buddy-core/config/index.js';

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

  const { url: supabaseUrl, anonKey: supabaseAnonKey, serviceRoleKey: supabaseServiceRoleKey } = getSupabaseConfig();
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
    supabaseServiceRoleKey
  );

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Invalid user token');
    }

    // Get user's wedding and role
    const { data: membership, error: memberError } = await supabase
      .from('wedding_members')
      .select('wedding_id, role')
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      throw new Error('No wedding profile found');
    }

    // Block bestie access to wedding chat - they should use bestie chat
    if (membership.role === 'bestie') {
      return res.status(403).json({
        error: 'Besties cannot access wedding chat. Please use the bestie planning chat instead.',
        redirect: '/bestie-luxury.html'
      });
    }

    const { data: weddingData, error: weddingError } = await supabase
      .from('wedding_profiles')
      .select('*')
      .eq('id', membership.wedding_id)
      .single();

    if (weddingError || !weddingData) throw new Error('Wedding profile not found');

    // Check trial/VIP status
    const now = new Date();
    const trialEnds = weddingData.trial_end_date ? new Date(weddingData.trial_end_date) : null;
    const isVip = weddingData.is_vip;
    const daysLeft = trialEnds ? Math.ceil((trialEnds - now) / (1000 * 60 * 60 * 24)) : null;

    if (trialEnds && now > trialEnds && !isVip) {
      return res.status(200).json({
        response: "Your trial has ended! 🎉\n\nUpgrade to VIP to continue:\n✨ Unlimited messages\n✨ Full wedding database\n✨ Co-planner access\n\nChoose your plan:\n💍 $19.99/month\n💒 $199 one-time 'Until I Do'\n\nHead to the upgrade page to continue planning!",
        trialExpired: true
      });
    }

    let trialWarning = '';
    if (trialEnds && daysLeft <= 2 && daysLeft > 0 && !isVip) {
      trialWarning = `\n\n⏰ Reminder: Your trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}! Upgrade to keep unlimited access.`;
    }

    // Build wedding context
    let weddingContext = 'CURRENT WEDDING INFORMATION:';
    if (weddingData.wedding_name) weddingContext += `\n- Couple: ${weddingData.wedding_name}`;
    if (weddingData.partner1_name && weddingData.partner2_name) {
      weddingContext += `\n- Partners: ${weddingData.partner1_name} & ${weddingData.partner2_name}`;
    }
    if (weddingData.wedding_date) weddingContext += `\n- Wedding Date: ${weddingData.wedding_date}`;
    if (weddingData.wedding_time) weddingContext += `\n- Time: ${weddingData.wedding_time}`;
    if (weddingData.ceremony_location) weddingContext += `\n- Ceremony: ${weddingData.ceremony_location}`;
    if (weddingData.reception_location) weddingContext += `\n- Reception: ${weddingData.reception_location}`;
    if (weddingData.expected_guest_count) weddingContext += `\n- Expected Guests: ${weddingData.expected_guest_count}`;
    if (weddingData.total_budget) weddingContext += `\n- Total Budget: $${weddingData.total_budget}`;
    if (weddingData.wedding_style) weddingContext += `\n- Style: ${weddingData.wedding_style}`;
    if (weddingData.color_scheme_primary) weddingContext += `\n- Primary Color: ${weddingData.color_scheme_primary}`;
    if (weddingData.venue_name) weddingContext += `\n- Venue: ${weddingData.venue_name}${weddingData.venue_cost ? ` ($${weddingData.venue_cost})` : ''}`;

    const timelineGuidance = weddingData.wedding_date
      ? `Wedding is ${Math.ceil((new Date(weddingData.wedding_date) - now) / (1000 * 60 * 60 * 24))} days away`
      : 'Wedding is not set yet';

    const promptContent = buildBridePrompt({
      domainContext: weddingContext,
      userMessagePlaceholder: message,
      timelineGuidance,
      todayDate: now.toISOString().split('T')[0],
      weddingDate: weddingData.wedding_date || 'not set yet'
    });

    // CALL CLAUDE with full extraction prompt (vendors, budget, tasks)
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
    let processedPayload = processClaudePayload(null);

    if (dataMatch) {
      const rawExtractedSection = dataMatch[1];
      processedPayload = processClaudePayload(rawExtractedSection);
      if (processedPayload.parseError) {
        logError('Failed to parse extracted data', processedPayload.parseError);
      }
    }

    const validationNotes = [...processedPayload.warnings];

    if (assistantMessage.length > CLAUDE_RESPONSE_CHAR_LIMIT) {
      assistantMessage = `${assistantMessage.slice(0, CLAUDE_RESPONSE_CHAR_LIMIT)}…`;
      validationNotes.push('I shortened my reply slightly to keep things running smoothly.');
    }

    // Update database with extracted data (FULL extraction restored)

    // 1. Update wedding_profiles with general wedding info
    if (processedPayload.weddingInfo && Object.keys(processedPayload.weddingInfo).length > 0) {
      const { error: updateError } = await supabaseService
        .from('wedding_profiles')
        .update(processedPayload.weddingInfo)
        .eq('id', membership.wedding_id);

      if (updateError) {
        logError('Failed to update wedding profile', updateError);
        validationNotes.push('I had trouble saving your wedding profile details. Please try again in a moment.');
      }
    }

    // 2. Insert/Update vendors in vendor_tracker table (BATCHED)
    if (processedPayload.vendors.length > 0) {
      // Fetch all existing vendors for this wedding in one query
      const { data: existingVendors, error: existingVendorsError } = await supabaseService
        .from('vendor_tracker')
        .select('id, vendor_type, vendor_name')
        .eq('wedding_id', membership.wedding_id);

      const existingVendorMap = new Map();
      if (existingVendorsError) {
        logError('Failed to load existing vendors', existingVendorsError);
        validationNotes.push('I could not check your existing vendors, so I skipped vendor updates this round.');
      } else if (existingVendors) {
        existingVendors.forEach(v => {
          if (!v.vendor_type || !v.vendor_name) return;
          const key = vendorKey(v.vendor_type, v.vendor_name);
          existingVendorMap.set(key, v.id);
        });
      }

      const vendorsToInsert = [];
      const vendorsToUpdate = [];

      if (!existingVendorsError) {
        for (const vendor of processedPayload.vendors) {
          const key = vendorKey(vendor.vendor_type, vendor.vendor_name);
          const existingId = existingVendorMap.get(key);

          if (existingId) {
            // Prepare for batch update
            const vendorUpdates = { ...vendor };
            delete vendorUpdates.vendor_type; // Don't change type
            delete vendorUpdates.vendor_name; // Don't change name
            vendorsToUpdate.push({ id: existingId, updates: vendorUpdates });
          } else {
            // Prepare for batch insert
            vendorsToInsert.push({
              wedding_id: membership.wedding_id,
              ...vendor
            });
          }
        }

        // Batch insert new vendors
        if (vendorsToInsert.length > 0) {
          const { error: vendorInsertError } = await supabaseService
            .from('vendor_tracker')
            .insert(vendorsToInsert);

          if (vendorInsertError) {
            logError('Failed to batch insert vendors', vendorInsertError);
            validationNotes.push('I could not save some vendor updates just now. Please confirm them again later.');
          }
        }

        // Batch update existing vendors (Supabase doesn't support bulk update, so we update individually but in parallel)
        if (vendorsToUpdate.length > 0) {
          await Promise.all(
            vendorsToUpdate.map(({ id, updates }) =>
              supabaseService
                .from('vendor_tracker')
                .update(updates)
                .eq('id', id)
                .then(({ error }) => {
                  if (error) {
                    logError('Failed to update vendor', error);
                    validationNotes.push('Some vendor updates did not save. I will try again if you repeat them.');
                  }
                })
            )
          );
        }
      }
    }

    // 3. Insert/Update budget items in budget_tracker table (BATCHED)
    if (processedPayload.budgetItems.length > 0) {
      // Fetch all existing budget items for this wedding in one query
      const { data: existingBudgets, error: existingBudgetsError } = await supabaseService
        .from('budget_tracker')
        .select('id, category, spent_amount')
        .eq('wedding_id', membership.wedding_id);

      const existingBudgetMap = new Map();
      if (existingBudgetsError) {
        logError('Failed to load existing budget categories', existingBudgetsError);
        validationNotes.push('I could not review your budget tracker, so I did not apply budget updates this time.');
      } else if (existingBudgets) {
        existingBudgets.forEach(b => {
          existingBudgetMap.set(b.category, { id: b.id, spent_amount: b.spent_amount });
        });
      }

      const budgetsToInsert = [];
      const budgetsToUpdate = [];

      if (!existingBudgetsError) {
        for (const budgetItem of processedPayload.budgetItems) {
          const existing = existingBudgetMap.get(budgetItem.category);

          if (existing) {
            // Prepare for batch update
            const budgetUpdates = {};

            if (budgetItem.budgeted_amount !== null && budgetItem.budgeted_amount !== undefined) {
              budgetUpdates.budgeted_amount = budgetItem.budgeted_amount;
            }

            if (budgetItem.spent_amount !== null && budgetItem.spent_amount !== undefined) {
              const newSpent = (existing.spent_amount || 0) + budgetItem.spent_amount;
              if (budgetItem.spent_amount < 0) {
                validationNotes.push(`Ignored negative spend for category "${budgetItem.category}".`);
              } else if (newSpent < (existing.spent_amount || 0)) {
                validationNotes.push(`Ignored spend decrease for category "${budgetItem.category}".`);
              } else {
                budgetUpdates.spent_amount = newSpent;
              }
            }

            if (budgetItem.transaction_date) budgetUpdates.last_transaction_date = budgetItem.transaction_date;
            if (budgetItem.transaction_amount) budgetUpdates.last_transaction_amount = budgetItem.transaction_amount;
            if (budgetItem.transaction_description) {
              budgetUpdates.last_transaction_description = budgetItem.transaction_description;
            }
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
            logError('Failed to batch insert budgets', budgetInsertError);
            validationNotes.push('I was unable to add some budget updates. Please resend them if needed.');
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
                  if (error) {
                    logError('Failed to update budget', error);
                    validationNotes.push('One of the budget updates did not save properly. Let me know if you would like to try again.');
                  }
                })
            )
          );
        }
      }
    }

    // 4. Insert tasks in wedding_tasks table (BATCHED)
    let tasksForResponse = [];
    if (processedPayload.tasks.length > 0) {
      const { data: existingTasks, error: existingTasksError } = await supabaseService
        .from('wedding_tasks')
        .select('task_name, due_date')
        .eq('wedding_id', membership.wedding_id);

      if (existingTasksError) {
        logError('Failed to read existing tasks', existingTasksError);
        validationNotes.push('I could not review your current task list, so I skipped adding new tasks this time.');
      } else {
        const existingTaskKeys = new Set();
        if (existingTasks) {
          existingTasks.forEach(task => {
            if (!task?.task_name) return;
            const key = taskDeterministicId(task.task_name, task.due_date || undefined);
            existingTaskKeys.add(key);
          });
        }

        const tasksToInsert = [];

        for (const task of processedPayload.tasks) {
          const key = taskDeterministicId(task.task_name, task.due_date || undefined);
          if (existingTaskKeys.has(key)) {
            validationNotes.push(`"${task.task_name}" is already on the task list, so I skipped adding it again.`);
            continue;
          }

          existingTaskKeys.add(key);
          tasksToInsert.push({
            wedding_id: membership.wedding_id,
            ...task
          });
        }

        if (tasksToInsert.length > 0) {
          const { error: taskInsertError } = await supabaseService
            .from('wedding_tasks')
            .insert(tasksToInsert);

          if (taskInsertError) {
            logError('Failed to batch insert tasks', taskInsertError);
            validationNotes.push('I could not add some tasks right now. Please let me know if you want me to try again.');
          } else {
            tasksForResponse = tasksToInsert.map(({ wedding_id: _ignoredWeddingId, ...task }) => task);
          }
        }
      }
    }

    assistantMessage += trialWarning;

    if (validationNotes.length > 0) {
      const uniqueNotes = Array.from(new Set(validationNotes));
      assistantMessage += `\n\nℹ️ I reviewed the details before saving. A few items need clarification:\n${uniqueNotes
        .map(note => `• ${note}`)
        .join('\n')}`;
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
          message_type: 'main'
        });

      if (userMsgError) {
        logError('Failed to save user message', userMsgError);
      }

      // Save assistant message
      const { error: assistantMsgError } = await supabaseService
        .from('chat_messages')
        .insert({
          wedding_id: membership.wedding_id,
          user_id: user.id,
          role: 'assistant',
          message: assistantMessage,
          message_type: 'main'
        });

      if (assistantMsgError) {
        logError('Failed to save assistant message', assistantMsgError);
      }
    } catch (saveError) {
      logError('Error saving chat messages', saveError);
      // Don't fail the request if saving fails
    }

    return res.status(200).json({
      response: assistantMessage,
      conversationId: conversationId || 'temp',
      daysLeftInTrial: daysLeft,
      processedPayload: {
        wedding_info: processedPayload.weddingInfo,
        vendors: processedPayload.vendors,
        budget_items: processedPayload.budgetItems,
        tasks: tasksForResponse.length > 0 ? tasksForResponse : processedPayload.tasks,
        warnings: processedPayload.warnings
      }
    });

  } catch (error) {
    // Security: Only log error message, not full error object (may contain user messages, wedding data, user/wedding IDs)
    logError('Chat error', error);
    return res.status(500).json({ error: error.message || 'Chat processing failed' });
  }
}

export async function handleBrideBuddy(req, res) {
  return handler(req, res);
}

export { processClaudePayload, MAX_EXTRACTED_JSON_CHARS } from '../buddy-core/structured-data/wedding_extractors.js';
