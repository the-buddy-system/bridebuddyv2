// Bride Buddy domain constants — remain localized until schema abstraction.

export const vendorTypes = new Set([
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

export const vendorTypeAliases = new Map([
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

export const vendorStatuses = new Set([
  'inquiry',
  'pending',
  'booked',
  'contract_signed',
  'deposit_paid',
  'fully_paid',
  'rejected',
  'cancelled'
]);

export const budgetCategories = new Map([
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

export const taskCategories = new Map([
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

export const taskStatuses = new Set(['not_started', 'in_progress', 'completed', 'cancelled']);

export const taskPriorities = new Set(['low', 'medium', 'high', 'urgent']);

export const empathyStrings = {
  warmResponseDirective: 'Respond warmly and helpfully while guiding couples forward with clear next steps.',
  followUpQuestionDirective: 'Ask exactly one follow-up question to move planning forward.',
  trialReminder: '⏰ Reminder: Your trial ends in {days} day(s)! Upgrade to keep unlimited access.',
  trialExpired: "Your trial has ended! 🎉\n\nUpgrade to VIP to continue:\n✨ Unlimited messages\n✨ Full wedding database\n✨ Co-planner access\n\nChoose your plan:\n💍 $19.99/month\n💒 $199 one-time 'Until I Do'\n\nHead to the upgrade page to continue planning!",
  onboardingGreeting: 'Welcome to your wedding planning assistant! 💍 I\'m here to help you plan every detail of your perfect day.',
  bestieGreeting: 'Hey bestie! 💕 Welcome to your secret planning space!'
};
