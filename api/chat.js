import { createClient } from '@supabase/supabase-js';
import { handleCORS, rateLimitMiddleware, RATE_LIMITS } from './_utils/rate-limiter.js';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9()[\]\s-]{7,}$/;
const CLAUDE_RESPONSE_CHAR_LIMIT = 20000;
const MAX_EXTRACTED_JSON_CHARS = 12000;

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

const VENDOR_TYPE_ALIASES = new Map([
  ['photography', 'photographer'],
  ['photo', 'photographer'],
  ['photos', 'photographer'],
  ['dj/band', 'dj'],
  ['band', 'dj'],
  ['music', 'dj'],
  ['bakery', 'baker'],
  ['cake', 'baker'],
  ['cakes', 'baker'],
  ['makeup', 'hair_makeup'],
  ['hair & makeup', 'hair_makeup'],
  ['hair and makeup', 'hair_makeup'],
  ['transport', 'transportation'],
  ['planner/coordinator', 'planner'],
  ['coordinator', 'planner'],
  ['decor', 'decorator'],
  ['lighting', 'decorator']
]);

const VENDOR_TYPES = new Set([
  'photographer',
  'caterer',
  'florist',
  'dj',
  'videographer',
  'baker',
  'planner',
  'venue',
  'decorator',
  'hair_makeup',
  'transportation',
  'rentals',
  'other'
]);

const VENDOR_STATUSES = new Set([
  'inquiry',
  'pending',
  'booked',
  'contract_signed',
  'deposit_paid',
  'fully_paid',
  'rejected',
  'cancelled'
]);

const BUDGET_CATEGORIES = new Map([
  ['venue', 'venue'],
  ['ceremony', 'venue'],
  ['reception', 'venue'],
  ['catering', 'catering'],
  ['food', 'catering'],
  ['flowers', 'flowers'],
  ['floral', 'flowers'],
  ['photography', 'photography'],
  ['photo', 'photography'],
  ['videography', 'videography'],
  ['music', 'music'],
  ['dj', 'music'],
  ['band', 'music'],
  ['cake', 'cake'],
  ['dessert', 'cake'],
  ['decor', 'decorations'],
  ['decorations', 'decorations'],
  ['attire', 'attire'],
  ['dress', 'attire'],
  ['suit', 'attire'],
  ['invitations', 'invitations'],
  ['stationery', 'invitations'],
  ['favors', 'favors'],
  ['transport', 'transportation'],
  ['transportation', 'transportation'],
  ['honeymoon', 'honeymoon'],
  ['other', 'other']
]);

const TASK_CATEGORIES = new Map([
  ['venue', 'venue'],
  ['catering', 'catering'],
  ['flowers', 'flowers'],
  ['floral', 'flowers'],
  ['photography', 'photography'],
  ['photo', 'photography'],
  ['attire', 'attire'],
  ['dress', 'attire'],
  ['invitations', 'invitations'],
  ['decor', 'decorations'],
  ['decorations', 'decorations'],
  ['transport', 'transportation'],
  ['transportation', 'transportation'],
  ['legal', 'legal'],
  ['honeymoon', 'honeymoon'],
  ['day_of', 'day_of'],
  ['day-of', 'day_of'],
  ['other', 'other']
]);

const TASK_STATUSES = new Set(['not_started', 'in_progress', 'completed', 'cancelled']);
const TASK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

function vendorKey(type, name) {
  return `${type}:${name.toLowerCase()}`;
}

function taskDeterministicId(name, dueDate) {
  return `${name.toLowerCase()}::${dueDate || 'none'}`;
}

function toTrimmedString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!DATE_REGEX.test(trimmed)) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  const [year, month, day] = trimmed.split('-');
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) {
    return null;
  }
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function normalizeCurrency(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }

  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeBoolean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const lowered = value.trim().toLowerCase();
  if (!lowered) return null;
  if (['true', 'yes', 'y', 'paid', 'completed'].includes(lowered)) return true;
  if (['false', 'no', 'n', 'unpaid', 'not paid'].includes(lowered)) return false;
  return null;
}

function canonicalizeVendorType(value) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (VENDOR_TYPES.has(normalized)) return normalized;
  return VENDOR_TYPE_ALIASES.get(normalized) || null;
}

function canonicalizeBudgetCategory(value) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return BUDGET_CATEGORIES.get(normalized) || null;
}

function canonicalizeTaskCategory(value) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return TASK_CATEGORIES.get(normalized) || null;
}

function validateEmail(value) {
  const str = toTrimmedString(value);
  if (!str) return null;
  return EMAIL_REGEX.test(str) ? str : null;
}

function validatePhone(value) {
  const str = toTrimmedString(value);
  if (!str) return null;
  return PHONE_REGEX.test(str) ? str : null;
}

function sanitizeWeddingInfo(weddingInfo) {
  if (!weddingInfo || typeof weddingInfo !== 'object') {
    return { sanitized: {}, warnings: [] };
  }

  const sanitized = {};
  const warnings = [];

  for (const [key, value] of Object.entries(weddingInfo)) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    switch (key) {
      case 'wedding_date': {
        const normalized = normalizeDate(value);
        if (normalized) {
          sanitized.wedding_date = normalized;
        } else {
          warnings.push(`Ignored wedding_date: expected YYYY-MM-DD, received "${value}".`);
        }
        break;
      }
      case 'wedding_time': {
        const formatted = formatWeddingTimeForSupabase(value);
        if (formatted) {
          sanitized.wedding_time = formatted;
        } else {
          warnings.push(`Ignored wedding_time: unrecognized time "${value}".`);
        }
        break;
      }
      case 'expected_guest_count': {
        const count = normalizeInteger(value);
        if (count !== null) {
          sanitized.expected_guest_count = count;
        } else {
          warnings.push(`Ignored expected_guest_count: expected whole number, received "${value}".`);
        }
        break;
      }
      case 'total_budget': {
        const budget = normalizeCurrency(value);
        if (budget !== null) {
          sanitized.total_budget = budget;
        } else {
          warnings.push(`Ignored total_budget: expected positive currency, received "${value}".`);
        }
        break;
      }
      case 'venue_cost': {
        const cost = normalizeCurrency(value);
        if (cost !== null) {
          sanitized.venue_cost = cost;
        } else {
          warnings.push(`Ignored venue_cost: expected positive currency, received "${value}".`);
        }
        break;
      }
      case 'partner1_name':
      case 'partner2_name':
      case 'ceremony_location':
      case 'reception_location':
      case 'venue_name':
      case 'color_scheme_primary':
      case 'color_scheme_secondary':
      case 'wedding_style':
      case 'wedding_name': {
        const str = toTrimmedString(value);
        if (str) {
          sanitized[key] = str;
        }
        break;
      }
      default: {
        // Ignore unexpected keys silently to avoid storing arbitrary data
        break;
      }
    }
  }

  return { sanitized, warnings };
}

function sanitizeVendors(vendors) {
  if (!Array.isArray(vendors) || vendors.length === 0) {
    return { sanitized: [], warnings: [] };
  }

  const sanitized = [];
  const warnings = [];
  const seen = new Set();

  vendors.forEach((vendor, index) => {
    if (!vendor || typeof vendor !== 'object') {
      warnings.push(`Skipped vendor at index ${index}: expected object.`);
      return;
    }

    const vendorName = toTrimmedString(vendor.vendor_name);
    const vendorType = canonicalizeVendorType(vendor.vendor_type);

    if (!vendorName) {
      warnings.push(`Skipped vendor at index ${index}: missing vendor_name.`);
      return;
    }

    if (!vendorType) {
      warnings.push(`Skipped vendor "${vendorName}": unsupported vendor_type "${vendor.vendor_type}".`);
      return;
    }

    const key = vendorKey(vendorType, vendorName);
    if (seen.has(key)) {
      warnings.push(`Skipped vendor "${vendorName}" (${vendorType}): duplicate entry.`);
      return;
    }
    seen.add(key);

    const totalCost = normalizeCurrency(vendor.total_cost);
    const depositAmount = normalizeCurrency(vendor.deposit_amount);
    const balanceDue = normalizeCurrency(vendor.balance_due);

    let adjustedDeposit = depositAmount;
    if (totalCost !== null && depositAmount !== null && depositAmount > totalCost) {
      adjustedDeposit = totalCost;
      warnings.push(`Adjusted deposit for vendor "${vendorName}" to not exceed total_cost.`);
    }

    const status = vendor.status ? vendor.status.trim().toLowerCase() : null;
    const canonicalStatus = status && VENDOR_STATUSES.has(status) ? status : null;
    if (status && !canonicalStatus) {
      warnings.push(`Dropped unsupported status "${vendor.status}" for vendor "${vendorName}".`);
    }

    const sanitizedVendor = {
      vendor_type: vendorType,
      vendor_name: vendorName,
      vendor_contact_name: toTrimmedString(vendor.vendor_contact_name),
      vendor_email: validateEmail(vendor.vendor_email),
      vendor_phone: validatePhone(vendor.vendor_phone),
      total_cost: totalCost,
      deposit_amount: adjustedDeposit,
      deposit_paid: normalizeBoolean(vendor.deposit_paid),
      deposit_date: normalizeDate(vendor.deposit_date),
      balance_due: balanceDue,
      final_payment_date: normalizeDate(vendor.final_payment_date),
      final_payment_paid: normalizeBoolean(vendor.final_payment_paid),
      status: canonicalStatus,
      contract_signed: normalizeBoolean(vendor.contract_signed),
      contract_date: normalizeDate(vendor.contract_date),
      service_date: normalizeDate(vendor.service_date),
      notes: toTrimmedString(vendor.notes)
    };

    const hasMeaningfulData =
      sanitizedVendor.total_cost !== null ||
      sanitizedVendor.deposit_amount !== null ||
      sanitizedVendor.status !== null ||
      sanitizedVendor.notes ||
      sanitizedVendor.deposit_paid !== null ||
      sanitizedVendor.contract_signed !== null ||
      sanitizedVendor.balance_due !== null;

    if (!hasMeaningfulData) {
      warnings.push(`Skipped vendor "${vendorName}" (${vendorType}): no actionable data provided.`);
      return;
    }

    sanitized.push(sanitizedVendor);
  });

  return { sanitized, warnings };
}

function sanitizeBudgetItems(budgetItems) {
  if (!Array.isArray(budgetItems) || budgetItems.length === 0) {
    return { sanitized: [], warnings: [] };
  }

  const aggregated = new Map();
  const warnings = [];

  budgetItems.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      warnings.push(`Skipped budget item at index ${index}: expected object.`);
      return;
    }

    const category = canonicalizeBudgetCategory(item.category);
    if (!category) {
      warnings.push(`Skipped budget item at index ${index}: unsupported category "${item.category}".`);
      return;
    }

    const budgetedAmount = normalizeCurrency(item.budgeted_amount);
    const spentAmount = normalizeCurrency(item.spent_amount);
    const transactionAmount = normalizeCurrency(item.transaction_amount);
    const transactionDate = normalizeDate(item.transaction_date);

    if (budgetedAmount === null && spentAmount === null && transactionAmount === null) {
      warnings.push(`Skipped budget item for category "${category}": no monetary values provided.`);
      return;
    }

    const existing = aggregated.get(category) || {
      category,
      budgeted_amount: null,
      spent_amount: null,
      transaction_date: null,
      transaction_amount: null,
      transaction_description: null,
      notes: null
    };

    if (budgetedAmount !== null) {
      existing.budgeted_amount = budgetedAmount;
    }

    if (spentAmount !== null) {
      existing.spent_amount = (existing.spent_amount || 0) + spentAmount;
    }

    if (transactionAmount !== null) {
      existing.transaction_amount = transactionAmount;
    }

    if (transactionDate) {
      existing.transaction_date = transactionDate;
    }

    const description = toTrimmedString(item.transaction_description);
    if (description) {
      existing.transaction_description = description;
    }

    const notes = toTrimmedString(item.notes);
    if (notes) {
      existing.notes = notes;
    }

    if (aggregated.has(category)) {
      warnings.push(`Merged duplicate budget category "${category}".`);
    }

    aggregated.set(category, existing);
  });

  return { sanitized: Array.from(aggregated.values()), warnings };
}

function sanitizeTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { sanitized: [], warnings: [] };
  }

  const sanitized = [];
  const warnings = [];
  const seen = new Set();

  tasks.forEach((task, index) => {
    if (!task || typeof task !== 'object') {
      warnings.push(`Skipped task at index ${index}: expected object.`);
      return;
    }

    const name = toTrimmedString(task.task_name);
    if (!name) {
      warnings.push(`Skipped task at index ${index}: missing task_name.`);
      return;
    }

    const dueDate = normalizeDate(task.due_date);
    if (task.due_date && !dueDate) {
      warnings.push(`Removed invalid due_date for task "${name}".`);
    }

    const category = canonicalizeTaskCategory(task.category) || null;
    if (task.category && !category) {
      warnings.push(`Dropped unsupported task category "${task.category}" for "${name}".`);
    }

    const status = task.status ? task.status.trim().toLowerCase() : null;
    const canonicalStatus = status && TASK_STATUSES.has(status) ? status : null;
    if (status && !canonicalStatus) {
      warnings.push(`Dropped unsupported task status "${task.status}" for "${name}".`);
    }

    const priority = task.priority ? task.priority.trim().toLowerCase() : null;
    const canonicalPriority = priority && TASK_PRIORITIES.has(priority) ? priority : null;
    if (priority && !canonicalPriority) {
      warnings.push(`Dropped unsupported task priority "${task.priority}" for "${name}".`);
    }

    const slug = taskDeterministicId(name, dueDate);
    if (seen.has(slug)) {
      warnings.push(`Skipped duplicate task "${name}" with due date ${dueDate || 'unspecified'}.`);
      return;
    }
    seen.add(slug);

    sanitized.push({
      task_name: name,
      task_description: toTrimmedString(task.task_description),
      category,
      due_date: dueDate,
      status: canonicalStatus,
      priority: canonicalPriority,
      notes: toTrimmedString(task.notes)
    });
  });

  return { sanitized, warnings };
}

function formatWeddingTimeForSupabase(rawTime) {
  if (!rawTime || typeof rawTime !== 'string') {
    return null;
  }

  const trimmed = rawTime.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();

  if (lower === 'noon') {
    return '12:00';
  }

  if (lower === 'midnight') {
    return '00:00';
  }

  const directMatch = lower.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (directMatch) {
    const hours = directMatch[1].padStart(2, '0');
    const minutes = directMatch[2];
    return `${hours}:${minutes}`;
  }

  const ampmMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const modifier = ampmMatch[3];

    if (hours === 12) {
      hours = modifier === 'am' ? 0 : 12;
    } else if (modifier === 'pm') {
      hours += 12;
    }

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  const embedded24HourMatch = lower.match(/\b([01]?\d|2[0-3])(:([0-5]\d))\b/);
  if (embedded24HourMatch) {
    const hours = embedded24HourMatch[1].padStart(2, '0');
    const minutes = embedded24HourMatch[3];
    return `${hours}:${minutes}`;
  }

  const embeddedHourMatch = lower.match(/\b([1-9]|1[0-2])\b/);
  if (embeddedHourMatch) {
    const hourVal = parseInt(embeddedHourMatch[1], 10);
    if (hourVal >= 0 && hourVal <= 23) {
      return `${hourVal.toString().padStart(2, '0')}:00`;
    }
  }

  return null;
}

function processClaudePayload(rawExtractedDataText) {
  const result = {
    weddingInfo: {},
    vendors: [],
    budgetItems: [],
    tasks: [],
    warnings: [],
    parseError: null
  };

  if (!rawExtractedDataText || typeof rawExtractedDataText !== 'string') {
    return result;
  }

  const trimmed = rawExtractedDataText.trim();
  if (!trimmed) {
    return result;
  }

  if (trimmed.length > MAX_EXTRACTED_JSON_CHARS) {
    result.warnings.push('I received a very large set of details, so I skipped saving them to keep things stable.');
    return result;
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    result.parseError = error;
    result.warnings.push('I could not read the structured details this time, so I did not save any changes. Could you share them again?');
    return result;
  }

  const { sanitized: sanitizedWeddingInfo, warnings: weddingInfoWarnings } = sanitizeWeddingInfo(parsed.wedding_info);
  const { sanitized: sanitizedVendors, warnings: vendorWarnings } = sanitizeVendors(parsed.vendors);
  const { sanitized: sanitizedBudgetItems, warnings: budgetWarnings } = sanitizeBudgetItems(parsed.budget_items);
  const { sanitized: sanitizedTasks, warnings: taskWarnings } = sanitizeTasks(parsed.tasks);

  result.weddingInfo = sanitizedWeddingInfo;
  result.vendors = sanitizedVendors;
  result.budgetItems = sanitizedBudgetItems;
  result.tasks = sanitizedTasks;
  result.warnings.push(
    ...weddingInfoWarnings,
    ...vendorWarnings,
    ...budgetWarnings,
    ...taskWarnings
  );

  return result;
}

export { processClaudePayload, MAX_EXTRACTED_JSON_CHARS };

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

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
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
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
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
    let weddingContext = `You are Bride Buddy, a helpful wedding planning assistant.

CURRENT WEDDING INFORMATION:`;
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

    // CALL CLAUDE with full extraction prompt (vendors, budget, tasks)
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3072,
        messages: [{
          role: 'user',
          content: `${weddingContext}

TASK: Extract wedding information from the user's message and respond proactively.

USER MESSAGE: "${message}"

INSTRUCTIONS:
1. Respond warmly and helpfully AND proactively guide them forward:
   - Acknowledge what they shared
   - Calculate urgency: Wedding is ${weddingData.wedding_date ? `${Math.ceil((new Date(weddingData.wedding_date) - new Date()) / (1000*60*60*24))} days away` : 'not set yet'}
   - Based on timeline, suggest the NEXT 1-2 concrete steps (not overwhelming list)
   - Ask ONE follow-up question to move planning forward (not multiple questions)
   - Timeline-based guidance:
     * <6 months: Emphasize urgency on vendor bookings and final details
     * 6-12 months: Focus on major decisions (venue, caterer, photographer, dress)
     * >12 months: Focus on foundation (setting budget, defining style, initial vendor research)
     * No wedding date set: Encourage setting one to enable timeline planning

2. Extract ALL wedding details from the message including:
   - General info (dates, location, guest count, style preferences)
   - Vendors (name, type, cost, deposit status)
   - Budget items (category, amount, paid/unpaid)
   - Tasks (what needs to be done, when)

3. Return your response in this EXACT format:

<response>Your natural, conversational response here</response>

<extracted_data>
{
  "wedding_info": {
    "wedding_date": "YYYY-MM-DD or null",
    "wedding_time": "HH:MM or null",
    "partner1_name": "string or null",
    "partner2_name": "string or null",
    "ceremony_location": "string or null",
    "reception_location": "string or null",
    "venue_name": "string or null",
    "venue_cost": number or null,
    "expected_guest_count": number or null,
    "total_budget": number or null,
    "color_scheme_primary": "string or null",
    "color_scheme_secondary": "string or null",
    "wedding_style": "string or null"
  },
  "vendors": [
    {
      "vendor_type": "photographer|caterer|florist|dj|videographer|baker|planner|venue|decorator|hair_makeup|transportation|rentals|other",
      "vendor_name": "string",
      "vendor_contact_name": "string or null",
      "vendor_email": "string or null",
      "vendor_phone": "string or null",
      "total_cost": number or null,
      "deposit_amount": number or null,
      "deposit_paid": true|false|null,
      "deposit_date": "YYYY-MM-DD or null",
      "balance_due": number or null,
      "final_payment_date": "YYYY-MM-DD or null",
      "final_payment_paid": true|false|null,
      "status": "inquiry|pending|booked|contract_signed|deposit_paid|fully_paid|rejected|cancelled or null",
      "contract_signed": true|false|null,
      "contract_date": "YYYY-MM-DD or null",
      "service_date": "YYYY-MM-DD or null",
      "notes": "string or null"
    }
  ],
  "budget_items": [
    {
      "category": "venue|catering|flowers|photography|videography|music|cake|decorations|attire|invitations|favors|transportation|honeymoon|other",
      "budgeted_amount": number or null,
      "spent_amount": number or null,
      "transaction_date": "YYYY-MM-DD or null",
      "transaction_amount": number or null,
      "transaction_description": "string or null",
      "notes": "string or null"
    }
  ],
  "tasks": [
    {
      "task_name": "string",
      "task_description": "string or null",
      "category": "venue|catering|flowers|photography|attire|invitations|decorations|transportation|legal|honeymoon|day_of|other or null",
      "due_date": "YYYY-MM-DD or null",
      "status": "not_started|in_progress|completed|cancelled or null",
      "priority": "low|medium|high|urgent or null",
      "notes": "string or null"
    }
  ]
}
</extracted_data>

EXTRACTION RULES:
- wedding_info: Extract basic wedding details
- vendors: Extract ANY mention of vendors with detailed tracking. Examples:
  * "I paid the florist $500 deposit" → {"vendor_type": "florist", "deposit_amount": 500, "deposit_paid": true, "deposit_date": "today's date"}
  * "We booked Sarah's Photography for $3000" → {"vendor_type": "photographer", "vendor_name": "Sarah's Photography", "total_cost": 3000, "status": "booked"}
  * "Called the caterer, deposit due next week" → {"vendor_type": "caterer", "status": "pending", "deposit_paid": false}
- budget_items: Extract payments, spending, or budget allocations
  * "Paid $500 for flowers" → {"category": "flowers", "spent_amount": 500, "transaction_amount": 500, "transaction_date": "today's date"}
  * "Budgeted $5000 for catering" → {"category": "catering", "budgeted_amount": 5000}
- tasks: Extract any to-dos, deadlines, or action items
  * "Need to mail invitations by March 15" → {"task_name": "Mail invitations", "category": "invitations", "due_date": "2025-03-15", "status": "not_started"}
  * "Finished picking flowers!" → {"task_name": "Pick flowers", "category": "flowers", "status": "completed"}

IMPORTANT:
- Today's date is ${new Date().toISOString().split('T')[0]}
- Only include sections that have data. Empty arrays [] are ok if nothing was mentioned
- If nothing wedding-related was mentioned, return {"wedding_info": {}, "vendors": [], "budget_items": [], "tasks": []}`
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
