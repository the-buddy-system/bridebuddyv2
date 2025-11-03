import assert from 'node:assert/strict';
import { processClaudePayload, MAX_EXTRACTED_JSON_CHARS } from '../api/chat.js';

function runTests() {
  // Valid payload normalization
  const validPayload = processClaudePayload(
    JSON.stringify({
      wedding_info: {
        wedding_time: '5:30pm',
        wedding_date: '2025-09-20',
        expected_guest_count: '150',
        total_budget: '$25,000'
      },
      vendors: [
        {
          vendor_type: 'photo',
          vendor_name: 'Lens & Co',
          total_cost: '$3000',
          status: 'Booked'
        }
      ],
      budget_items: [
        {
          category: 'flowers',
          spent_amount: '$450'
        }
      ],
      tasks: [
        {
          task_name: 'Send invites',
          category: 'invitations',
          status: 'in_progress',
          due_date: '2025-05-01'
        },
        {
          task_name: 'Send invites',
          category: 'invitations',
          status: 'in_progress',
          due_date: '2025-05-01'
        }
      ]
    })
  );

  assert.equal(validPayload.parseError, null, 'Valid payload should not produce parse errors');
  assert.equal(validPayload.weddingInfo.wedding_time, '17:30', 'Time should normalize to 24-hour clock');
  assert.equal(validPayload.weddingInfo.expected_guest_count, 150, 'Guest count should become integer');
  assert.equal(validPayload.weddingInfo.total_budget, 25000, 'Budget should normalize to integer dollars');
  assert.equal(validPayload.vendors.length, 1, 'Duplicate vendors should be filtered');
  assert.equal(validPayload.vendors[0].vendor_type, 'photographer', 'Vendor type should canonicalize');
  assert.equal(validPayload.budgetItems.length, 1, 'Budget item should remain');
  assert.equal(validPayload.tasks.length, 1, 'Duplicate tasks should be removed');

  // Invalid JSON handling
  const invalidPayload = processClaudePayload('{bad json');
  assert.ok(invalidPayload.parseError instanceof Error, 'Invalid JSON should surface parse error');
  assert.ok(
    invalidPayload.warnings.some(note => note.includes('could not read')),
    'Invalid JSON should generate a user-facing warning'
  );

  // Missing sections should default safely
  const emptyPayload = processClaudePayload(JSON.stringify({}));
  assert.deepEqual(emptyPayload.weddingInfo, {}, 'Empty wedding info should remain empty object');
  assert.deepEqual(emptyPayload.vendors, [], 'Empty vendors array expected');
  assert.deepEqual(emptyPayload.tasks, [], 'Empty tasks array expected');

  // Large payload should be rejected early
  const oversized = 'x'.repeat(MAX_EXTRACTED_JSON_CHARS + 1);
  const oversizedResult = processClaudePayload(oversized);
  assert.equal(oversizedResult.parseError, null, 'Oversized payload should not attempt parse');
  assert.ok(
    oversizedResult.warnings.some(note => note.includes('very large set of details')),
    'Oversized payload should warn about size limit'
  );

  console.log('All chat payload validation tests passed.');
}

try {
  runTests();
  process.exit(0);
} catch (error) {
  console.error('Chat payload validation tests failed:', error);
  process.exit(1);
}
