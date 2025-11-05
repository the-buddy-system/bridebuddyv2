// TODO: make localStorage key prefix configurable per buddy

import { getSupabaseConfig } from '../config/index.js';

const USER_ID_KEY = 'user_id';
const WEDDING_ID_KEY = 'wedding_id';

let supabaseClient = null;

export function initSupabase(options = {}) {
  if (!supabaseClient) {
    const { url: defaultUrl, anonKey: defaultAnonKey } = getSupabaseConfig() || {};
    const supabaseUrl = options.supabaseUrl || defaultUrl;
    const supabaseAnonKey = options.supabaseAnonKey || defaultAnonKey;
    const supabaseLib = options.supabaseLib || window.supabase || window.supabaseJs;

    if (!supabaseLib) {
      console.error('Supabase SDK not loaded. Make sure the Supabase CDN script is included in your HTML.');
      throw new Error('Supabase SDK not available. Please check that the Supabase CDN script is loaded.');
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase configuration is missing URL or anon key.');
    }

    try {
      supabaseClient = supabaseLib.createClient(supabaseUrl, supabaseAnonKey);

      if (!supabaseClient) {
        throw new Error('createClient returned null or undefined');
      }
    } catch (err) {
      console.error('Error creating Supabase client:', err);
      throw new Error(`Failed to create Supabase client: ${err.message}`);
    }
  }

  return supabaseClient;
}

export function getSupabase() {
  if (!supabaseClient) {
    return initSupabase();
  }
  return supabaseClient;
}

export function getStoredSession() {
  return {
    userId: typeof localStorage !== 'undefined' ? localStorage.getItem(USER_ID_KEY) : null,
    weddingId: typeof localStorage !== 'undefined' ? localStorage.getItem(WEDDING_ID_KEY) : null
  };
}

export function storeSession({ userId, weddingId } = {}) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  if (userId) {
    localStorage.setItem(USER_ID_KEY, userId);
  }

  if (weddingId) {
    localStorage.setItem(WEDDING_ID_KEY, weddingId);
  }
}

export function clearSession() {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.removeItem(USER_ID_KEY);
  localStorage.removeItem(WEDDING_ID_KEY);
}
