/**
 * Bride Buddy - Shared JavaScript Module
 * Common utilities and functions used across multiple pages
 */

// ============================================================================
// CONFIGURATION IMPORT
// ============================================================================

import { config } from './config.js';
// import { textToHtml } from './security.js';
import { textToHtml } from '../../buddy-core/frontend/security.js';
import {
    initSupabase as initSupabaseCore,
    getSupabase as getSupabaseCore,
    getStoredSession,
    storeSession,
    clearSession
} from '../../buddy-core/frontend/session.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const SUPABASE_URL = config.supabase.url;
const SUPABASE_ANON_KEY = config.supabase.anonKey;

// CSS Spinner (replaced image-based lazy susan)

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

/**
 * Initialize and return Supabase client (singleton pattern)
 * @returns {Object} Supabase client instance
 */
export function initSupabase(options = {}) {
    return initSupabaseCore({
        supabaseUrl: options.supabaseUrl || SUPABASE_URL,
        supabaseAnonKey: options.supabaseAnonKey || SUPABASE_ANON_KEY,
        supabaseLib: options.supabaseLib
    });
}

/**
 * Get existing Supabase client instance
 * @returns {Object} Supabase client instance
 */
export function getSupabase() {
    return getSupabaseCore();
}

// ============================================================================
// URL PARAMETER HELPERS
// ============================================================================

/**
 * Get URL parameter by name
 * @param {string} paramName - Name of the URL parameter
 * @returns {string|null} Parameter value or null if not found
 */
export function getUrlParam(paramName) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(paramName);
}

/**
 * Get wedding ID from URL
 * @returns {string|null} Wedding ID or null
 */
export function getWeddingIdFromUrl() {
    return getUrlParam('wedding_id');
}

/**
 * Update URL with wedding_id parameter
 * @param {string} weddingId - Wedding ID to add to URL
 */
export function updateUrlWithWeddingId(weddingId) {
    window.history.replaceState({}, '', `?wedding_id=${weddingId}`);
}

// ============================================================================
// SESSION MANAGEMENT (localStorage)
// ============================================================================

/**
 * Store user session in localStorage
 * @param {string} userId - User ID
 * @param {string} weddingId - Wedding ID
 */
export function storeUserSession(userId, weddingId) {
    storeSession({ userId, weddingId });
}

/**
 * Get user session from localStorage
 * @returns {Object} Session object with userId and weddingId
 */
export function getUserSession() {
    return getStoredSession();
}

/**
 * Clear user session from localStorage
 */
export function clearUserSession() {
    clearSession();
}

/**
 * Get user ID from session (localStorage or Supabase)
 * @returns {Promise<string|null>} User ID or null
 */
export async function getUserId() {
    // Try localStorage first
    const { userId } = getUserSession();
    if (userId) {
        return userId;
    }

    // Fall back to Supabase
    try {
        const supabase = getSupabase();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            // Store for next time
            storeUserSession(user.id, null);
            return user.id;
        }
    } catch (error) {
        console.error('Error getting user ID:', error);
    }

    return null;
}

/**
 * Get wedding ID from session (localStorage, URL, or database)
 * @returns {Promise<string|null>} Wedding ID or null
 */
export async function getWeddingId() {
    // Try localStorage first
    let { weddingId } = getUserSession();
    if (weddingId) {
        return weddingId;
    }

    // Try URL parameter
    weddingId = getWeddingIdFromUrl();
    if (weddingId) {
        // Store for next time
        storeUserSession(null, weddingId);
        return weddingId;
    }

    // Fall back to database query
    try {
        const userId = await getUserId();
        if (!userId) {
            return null;
        }

        const supabase = getSupabase();
        const { data: membership } = await supabase
            .from('wedding_members')
            .select('wedding_id')
            .eq('user_id', userId)
            .single();

        if (membership && membership.wedding_id) {
            // Store for next time
            storeUserSession(null, membership.wedding_id);
            return membership.wedding_id;
        }
    } catch (error) {
        console.error('Error getting wedding ID:', error);
    }

    return null;
}

// ============================================================================
// LOADING INDICATOR (CSS Spinner)
// ============================================================================

/**
 * Loading indicator utilities with CSS-only spinner
 */
export const loadingIndicator = {
    /**
     * Show loading indicator with CSS spinner
     * @param {string} containerId - ID of container to append loading indicator
     */
    show(containerId = 'chatMessages') {
        const messagesContainer = document.getElementById(containerId);
        if (!messagesContainer) {
            console.error(`Container with ID "${containerId}" not found`);
            return;
        }

        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'loadingIndicator';
        loadingDiv.className = 'chat-loading';
        loadingDiv.style.cssText = 'display: flex; justify-content: center; align-items: center; padding: var(--space-6);';

        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        spinner.style.cssText = `
            width: 40px;
            height: 40px;
            border: 4px solid rgba(201, 169, 97, 0.2);
            border-top-color: var(--color-gold);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        `;

        loadingDiv.appendChild(spinner);
        messagesContainer.appendChild(loadingDiv);

        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Add keyframe animation if not already present
        if (!document.getElementById('spinner-keyframes')) {
            const style = document.createElement('style');
            style.id = 'spinner-keyframes';
            style.textContent = `
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
    },

    /**
     * Hide loading indicator
     */
    hide() {
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }
    }
};

// ============================================================================
// CHAT MESSAGE DISPLAY
// ============================================================================

/**
 * Display message in chat container
 * @param {string} content - Message content (supports HTML)
 * @param {string} role - Message role ('user' or 'assistant')
 * @param {string} containerId - ID of chat container
 */
export function displayMessage(content, role = 'assistant', containerId = 'chatMessages') {
    const messagesContainer = document.getElementById(containerId);
    if (!messagesContainer) {
        console.error(`Container with ID "${containerId}" not found`);
        return;
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'chat-bubble';
    // SECURITY: Use textToHtml to escape HTML and prevent XSS attacks
    // This function escapes all HTML special characters before converting newlines to <br>
    bubbleDiv.innerHTML = textToHtml(content);

    messageDiv.appendChild(bubbleDiv);
    messagesContainer.appendChild(messageDiv);

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ============================================================================
// NAVIGATION FUNCTIONS
// ============================================================================

/**
 * Navigate to a page with wedding_id parameter
 * @param {string} page - Page filename (e.g., 'dashboard-luxury.html')
 * @param {string|null} weddingId - Wedding ID (defaults to URL param)
 */
export function navigateTo(page, weddingId = null) {
    const id = weddingId || getWeddingIdFromUrl();
    if (id) {
        window.location.href = `${page}?wedding_id=${id}`;
    } else {
        window.location.href = page;
    }
}

/**
 * Navigate back to dashboard
 * @param {string|null} weddingId - Wedding ID (defaults to URL param)
 */
export function goToDashboard(weddingId = null) {
    navigateTo('dashboard-luxury.html', weddingId);
}

/**
 * Navigate back to welcome page
 */
export function goToWelcome() {
    window.location.href = 'index-luxury.html';
}

// ============================================================================
// AUTHENTICATION FUNCTIONS
// ============================================================================

/**
 * Logout user and redirect to welcome page
 */
export async function logout() {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    goToWelcome();
}

/**
 * Check if user is authenticated
 * @returns {Promise<Object|null>} User session or null
 */
export async function checkAuth() {
    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    return session;
}

/**
 * Get current authenticated user
 * @returns {Promise<Object|null>} User object or null
 */
export async function getCurrentUser() {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

/**
 * Require authentication - redirect to welcome if not authenticated
 * @returns {Promise<Object>} User session
 */
export async function requireAuth() {
    const session = await checkAuth();
    if (!session) {
        goToWelcome();
        throw new Error('Not authenticated');
    }
    return session;
}

// ============================================================================
// WEDDING DATA LOADING
// ============================================================================

/**
 * Load wedding data and verify user access
 * @param {Object} options - Configuration options
 * @param {string} options.weddingId - Wedding ID (optional, will use URL param)
 * @param {boolean} options.requireAuth - Require authentication (default: true)
 * @param {boolean} options.redirectOnError - Redirect to welcome on error (default: true)
 * @returns {Promise<Object>} Wedding data object with { wedding, weddingId, member }
 */
export async function loadWeddingData(options = {}) {
    const {
        weddingId: providedWeddingId = null,
        requireAuth: shouldRequireAuth = true,
        redirectOnError = true
    } = options;

    try {
        const supabase = getSupabase();

        // Check authentication
        const { data: { user } } = await supabase.auth.getUser();

        if (!user && shouldRequireAuth) {
            if (redirectOnError) {
                goToWelcome();
            }
            throw new Error('Not authenticated');
        }

        // Get wedding_id from provided, URL, or session/database
        let weddingId = providedWeddingId || getWeddingIdFromUrl();

        // If no wedding_id yet, try to get from getWeddingId() which checks localStorage and database
        if (!weddingId) {
            weddingId = await getWeddingId();
        }

        if (!weddingId) {
            console.error('No wedding membership found');
            if (redirectOnError) {
                showToast('Please complete your wedding setup', 'info', 3000);
                setTimeout(() => {
                    window.location.href = 'onboarding-luxury.html';
                }, 1000);
            }
            throw new Error('No wedding membership found');
        }

        // Update URL with wedding_id
        updateUrlWithWeddingId(weddingId);

        // Extra safety check before querying
        if (!weddingId || weddingId === 'undefined' || weddingId === 'null') {
            // Security: Don't log actual wedding_id value
            console.error('Invalid wedding_id detected');
            if (redirectOnError) {
                alert('Unable to load wedding. Please create or join a wedding.');
                goToWelcome();
            }
            throw new Error('Invalid wedding_id');
        }

        // Get wedding profile
        const { data: wedding, error } = await supabase
            .from('wedding_profiles')
            .select('*')
            .eq('id', weddingId)
            .single();

        if (error) {
            console.error('Error loading wedding:', error);
            throw error;
        }

        // Get member info
        const { data: member, error: memberError } = await supabase
            .from('wedding_members')
            .select('*')
            .eq('wedding_id', weddingId)
            .eq('user_id', user.id)
            .single();

        if (memberError) {
            console.error('Error loading member:', memberError);
        }

        // Store session in localStorage for future use
        storeUserSession(user.id, weddingId);

        return {
            wedding,
            weddingId,
            member,
            user
        };

    } catch (error) {
        console.error('Error in loadWeddingData:', error);
        throw error;
    }
}

// ============================================================================
// CHAT HISTORY LOADING
// ============================================================================

/**
 * Load chat history for a wedding
 * @param {Object} options - Configuration options
 * @param {string} options.weddingId - Wedding ID
 * @param {string} options.messageType - Message type filter ('main', 'bestie', etc.)
 * @param {number} options.limit - Maximum number of messages to load (default: 20)
 * @returns {Promise<Array>} Array of chat messages
 */
export async function loadChatHistory(options = {}) {
    const {
        weddingId,
        messageType = 'main',
        limit = 20,
        userRole = null
    } = options;

    if (!weddingId) {
        throw new Error('weddingId is required');
    }

    try {
        const supabase = getSupabase();
        const user = await getCurrentUser();

        if (!user) {
            throw new Error('User not authenticated');
        }

        // Build query
        let query = supabase
            .from('chat_messages')
            .select('*')
            .eq('wedding_id', weddingId)
            .eq('message_type', messageType);

        // For 'main' messages: owner/partner see all wedding messages
        // For 'bestie' messages: only see own messages
        // For other roles: only see own messages
        if (messageType === 'bestie' || (userRole && !['owner', 'partner'].includes(userRole))) {
            query = query.eq('user_id', user.id);
        }

        query = query
            .order('created_at', { ascending: true })
            .limit(limit);

        const { data: messages, error } = await query;

        if (error) {
            console.error('Error loading chat history:', error);
            throw error;
        }

        return messages || [];

    } catch (error) {
        console.error('Error in loadChatHistory:', error);
        throw error;
    }
}

/**
 * Display chat history in a container
 * @param {Array} messages - Array of message objects
 * @param {string} containerId - ID of container to display messages
 */
export function displayChatHistory(messages, containerId = 'chatMessages') {
    if (!messages || messages.length === 0) {
        return;
    }

    messages.forEach(msg => {
        if (msg.role === 'user' || msg.role === 'assistant') {
            displayMessage(msg.message, msg.role, containerId);
        }
    });
}

// ============================================================================
// FORM VALIDATION HELPERS
// ============================================================================

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
export function isValidEmail(email) {
    return email && email.includes('@') && email.includes('.');
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @param {number} minLength - Minimum length (default: 6)
 * @returns {boolean} True if valid
 */
export function isValidPassword(password, minLength = 6) {
    return password && password.length >= minLength;
}

/**
 * Show form error message
 * @param {string} elementId - ID of error element
 * @param {string} message - Error message (optional)
 */
export function showFormError(elementId, message = null) {
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        if (message) {
            errorElement.textContent = message;
        }
        errorElement.style.display = 'block';
    }
}

/**
 * Hide form error message
 * @param {string} elementId - ID of error element
 */
export function hideFormError(elementId) {
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        errorElement.style.display = 'none';
    }
}

// ============================================================================
// MENU/MODAL HELPERS
// ============================================================================

/**
 * Toggle menu/modal visibility
 * @param {string} elementId - ID of element to toggle
 */
export function toggleMenu(elementId = 'menuOverlay') {
    const menu = document.getElementById(elementId);
    if (menu) {
        menu.classList.toggle('hidden');
    }
}

/**
 * Show element by removing 'hidden' class
 * @param {string} elementId - ID of element to show
 */
export function showElement(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.remove('hidden');
    }
}

/**
 * Hide element by adding 'hidden' class
 * @param {string} elementId - ID of element to hide
 */
export function hideElement(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.add('hidden');
    }
}

// ============================================================================
// SUBSCRIPTION/TRIAL HELPERS
// ============================================================================

/**
 * Calculate days remaining in trial
 * @param {string} trialEndDate - Trial end date (ISO string)
 * @returns {number} Days remaining
 */
export function getDaysRemainingInTrial(trialEndDate) {
    const endDate = new Date(trialEndDate);
    const now = new Date();
    return Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
}

/**
 * Update trial badge with days remaining
 * @param {Object} wedding - Wedding object with trial_end_date
 * @param {string} badgeElementId - ID of badge element
 */
export function updateTrialBadge(wedding, badgeElementId = 'trialBadge') {
    const badgeElement = document.getElementById(badgeElementId);
    if (!badgeElement) return;

    if (wedding.subscription_status === 'trialing') {
        const daysLeft = getDaysRemainingInTrial(wedding.trial_end_date);

        badgeElement.textContent = `VIP Trial • ${daysLeft} days left`;

        if (daysLeft <= 2) {
            badgeElement.classList.remove('badge-trial');
            badgeElement.classList.add('badge-warning');
        }
    }
}

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in milliseconds (default: 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer') || createToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} animate-fade-in-scale`;

    // Icon based on type
    const icons = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ'
    };

    toast.innerHTML = `
        <span style="font-size: 1.25rem; margin-right: 0.5rem;">${icons[type] || icons.info}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Auto remove after duration
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-1rem)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}

/**
 * Create toast container if it doesn't exist
 * @returns {HTMLElement} Toast container element
 */
function createToastContainer() {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

// ============================================================================
// EXPORTS SUMMARY
// ============================================================================

// Default export for convenience
export default {
    // Supabase
    initSupabase,
    getSupabase,

    // URL helpers
    getUrlParam,
    getWeddingIdFromUrl,
    updateUrlWithWeddingId,

    // Loading indicator
    loadingIndicator,

    // Chat
    displayMessage,
    loadChatHistory,
    displayChatHistory,

    // Navigation
    navigateTo,
    goToDashboard,
    goToWelcome,

    // Auth
    logout,
    checkAuth,
    getCurrentUser,
    requireAuth,

    // Wedding data
    loadWeddingData,

    // Form validation
    isValidEmail,
    isValidPassword,
    showFormError,
    hideFormError,

    // UI helpers
    toggleMenu,
    showElement,
    hideElement,

    // Subscription helpers
    getDaysRemainingInTrial,
    updateTrialBadge,

    // Toast notifications
    showToast
};
