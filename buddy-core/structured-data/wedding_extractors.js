// TODO: Inject domain enums via buddies/bride/domain.js
import {
  vendorTypeAliases as brideVendorTypeAliases,
  vendorTypes as brideVendorTypes,
  vendorStatuses as brideVendorStatuses,
  budgetCategories as brideBudgetCategories,
  taskCategories as brideTaskCategories,
  taskStatuses as brideTaskStatuses,
  taskPriorities as brideTaskPriorities
} from '../../buddies/bride/domain.js';

// TODO: Accept domain overrides when new buddies arrive.
const VENDOR_TYPE_ALIASES = brideVendorTypeAliases;
const VENDOR_TYPES = brideVendorTypes;
const VENDOR_STATUSES = brideVendorStatuses;
const BUDGET_CATEGORIES = brideBudgetCategories;
const TASK_CATEGORIES = brideTaskCategories;
const TASK_STATUSES = brideTaskStatuses;
const TASK_PRIORITIES = brideTaskPriorities;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9()[\]\s-]{7,}$/;
export const MAX_EXTRACTED_JSON_CHARS = 12000;

export function vendorKey(type, name) {
  return `${type}:${name.toLowerCase()}`;
}

export function taskDeterministicId(name, dueDate) {
  return `${name.toLowerCase()}::${dueDate || 'none'}`;
}

function toTrimmedString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeDate(value) {
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

export function normalizeCurrency(value) {
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

export function normalizeInteger(value) {
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

export function normalizeBoolean(value) {
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

export function processClaudePayload(rawExtractedDataText) {
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
