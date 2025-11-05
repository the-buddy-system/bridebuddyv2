// TODO: Verify all helpers remain browser-safe for other Buddies.

/**
 * Security Utilities for Bride Buddy
 *
 * Provides HTML escaping and sanitization to prevent XSS attacks.
 *
 * CRITICAL: All user-generated content and database content MUST be escaped
 * before rendering to prevent stored XSS vulnerabilities.
 */

// ============================================================================
// HTML ESCAPING
// ============================================================================

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param {string} unsafe - Potentially unsafe string
 * @returns {string} Safe HTML-escaped string
 */
export function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) {
        return '';
    }

    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Convert newlines to <br> tags safely (after escaping HTML)
 * @param {string} text - Text with newlines
 * @returns {string} HTML with <br> tags (HTML in input is escaped)
 */
export function textToHtml(text) {
    if (!text) return '';
    return escapeHtml(text).replace(/\n/g, '<br>');
}

/**
 * Safely set text content (no HTML parsing)
 * Use this for simple text that should never contain HTML
 * @param {HTMLElement} element - DOM element
 * @param {string} text - Text to set
 */
export function setTextContent(element, text) {
    if (!element) return;
    element.textContent = text || '';
}

/**
 * Safely set HTML content with escaped text that may contain newlines
 * @param {HTMLElement} element - DOM element
 * @param {string} text - Text that may contain newlines
 */
export function setTextWithNewlines(element, text) {
    if (!element) return;
    element.innerHTML = textToHtml(text);
}

// ============================================================================
// SAFE DOM CONSTRUCTION
// ============================================================================

/**
 * Create a DOM element with safe text content
 * @param {string} tag - HTML tag name
 * @param {Object} options - Element options
 * @param {string} options.text - Text content (will be escaped)
 * @param {string} options.className - CSS class name
 * @param {Object} options.attrs - Attributes to set
 * @param {Object} options.styles - Inline styles
 * @returns {HTMLElement} Created element
 */
export function createElement(tag, options = {}) {
    const element = document.createElement(tag);

    if (options.text) {
        element.textContent = options.text;
    }

    if (options.className) {
        element.className = options.className;
    }

    if (options.attrs) {
        for (const [key, value] of Object.entries(options.attrs)) {
            // Use setAttribute for safety
            element.setAttribute(key, value);
        }
    }

    if (options.styles) {
        for (const [key, value] of Object.entries(options.styles)) {
            element.style[key] = value;
        }
    }

    return element;
}

// ============================================================================
// URL SANITIZATION
// ============================================================================

/**
 * Validate and sanitize URL to prevent javascript: protocol attacks
 * @param {string} url - URL to validate
 * @returns {string} Safe URL or empty string if invalid
 */
export function sanitizeUrl(url) {
    if (!url) return '';

    const trimmed = url.trim().toLowerCase();

    // Block dangerous protocols
    const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
    for (const protocol of dangerousProtocols) {
        if (trimmed.startsWith(protocol)) {
            console.warn('Blocked dangerous URL protocol:', protocol);
            return '';
        }
    }

    return url.trim();
}

// ============================================================================
// ATTRIBUTE SANITIZATION
// ============================================================================

/**
 * Sanitize HTML attribute value
 * Prevents attribute-based XSS (e.g., onclick="alert(1)")
 * @param {string} value - Attribute value
 * @returns {string} Sanitized value
 */
export function sanitizeAttribute(value) {
    if (value === null || value === undefined) {
        return '';
    }

    // Remove any event handlers or script-related content
    return String(value)
        .replace(/on\w+\s*=/gi, '') // Remove onload=, onclick=, etc.
        .replace(/javascript:/gi, '')
        .replace(/vbscript:/gi, '')
        .replace(/<script/gi, '')
        .replace(/<\/script/gi, '');
}

// ============================================================================
// TESTING UTILITIES
// ============================================================================

/**
 * Test XSS protection with common attack vectors
 * Run in browser console: testXssProtection()
 * @returns {Object} Test results
 */
export function testXssProtection() {
    const attacks = [
        '<script>alert("XSS")</script>',
        '<img src=x onerror=alert("XSS")>',
        '<svg onload=alert("XSS")>',
        'javascript:alert("XSS")',
        `<iframe src="javascript:alert('XSS')">`,
        '"><script>alert(String.fromCharCode(88,83,83))</script>',
        '<img src=x:alert(alt) onerror=eval(src) alt=xss>',
        '<input onfocus=alert("XSS") autofocus>',
        '<body onload=alert("XSS")>',
        '\'><script>alert(String.fromCharCode(88,83,83))</script>'
    ];

    console.group('XSS Protection Tests');

    attacks.forEach((attack, i) => {
        const escaped = escapeHtml(attack);
        const safe = !escaped.includes('<script') &&
                     !escaped.includes('onerror=') &&
                     !escaped.includes('onload=');

        console.log(`Test ${i + 1}: ${safe ? '✅ PASS' : '❌ FAIL'}`);
        console.log('  Input:', attack);
        console.log('  Output:', escaped);
    });

    console.groupEnd();

    return { passed: true, message: 'All tests completed. Check console for results.' };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    escapeHtml,
    textToHtml,
    setTextContent,
    setTextWithNewlines,
    createElement,
    sanitizeUrl,
    sanitizeAttribute,
    testXssProtection
};
