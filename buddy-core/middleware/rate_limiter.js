// TODO: make CORS origin configurable in buddy-core/config before cross-domain rollout

/**
 * Simple in-memory rate limiter for Vercel serverless functions
 *
 * For production use, consider using:
 * - Vercel Edge Config
 * - Redis (Upstash)
 * - Rate limiting at CDN level
 */

const requestCounts = new Map();

// Cleanup old entries every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of requestCounts.entries()) {
    if (now - data.resetTime > 0) {
      requestCounts.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Rate limiter configuration presets
 */
export const RATE_LIMITS = {
  STRICT: { maxRequests: 10, windowMs: 60 * 1000 }, // 10 requests per minute
  MODERATE: { maxRequests: 30, windowMs: 60 * 1000 }, // 30 requests per minute
  RELAXED: { maxRequests: 60, windowMs: 60 * 1000 }, // 60 requests per minute
  PAYMENT: { maxRequests: 5, windowMs: 60 * 1000 }, // 5 requests per minute for payment endpoints
};

/**
 * Check if request should be rate limited
 *
 * @param {string} identifier - Unique identifier (IP address, user ID, etc.)
 * @param {Object} options - Rate limiting options
 * @param {number} options.maxRequests - Maximum requests allowed in window
 * @param {number} options.windowMs - Time window in milliseconds
 * @returns {Object} - { allowed: boolean, remaining: number, resetTime: number }
 */
export function checkRateLimit(identifier, options = RATE_LIMITS.MODERATE) {
  const { maxRequests, windowMs } = options;
  const now = Date.now();

  if (!requestCounts.has(identifier)) {
    requestCounts.set(identifier, {
      count: 1,
      resetTime: now + windowMs
    });

    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: now + windowMs
    };
  }

  const data = requestCounts.get(identifier);

  // Reset if window has passed
  if (now > data.resetTime) {
    data.count = 1;
    data.resetTime = now + windowMs;

    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: data.resetTime
    };
  }

  // Increment count
  data.count++;

  if (data.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: data.resetTime
    };
  }

  return {
    allowed: true,
    remaining: maxRequests - data.count,
    resetTime: data.resetTime
  };
}

/**
 * Get client identifier from request
 * Uses IP address as primary identifier
 *
 * @param {Object} req - HTTP request object
 * @returns {string} - Client identifier
 */
export function getClientIdentifier(req) {
  // Get IP from various possible headers (Vercel, Cloudflare, etc.)
  const forwarded = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const ip = forwarded ? forwarded.split(',')[0] : (realIp || req.connection?.remoteAddress || 'unknown');

  return ip;
}

/**
 * CORS configuration
 * Locked to production domain to prevent unauthorized cross-origin access
 */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://bridebuddyv2.vercel.app',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400', // 24 hours
};

/**
 * Handle CORS preflight requests
 *
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 * @returns {boolean} - True if preflight was handled
 */
export function handleCORS(req, res) {
  // Set CORS headers
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  return false;
}

/**
 * Rate limiting middleware for Vercel serverless functions
 *
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 * @param {Object} options - Rate limiting options
 * @returns {boolean} - True if request should proceed, false if rate limited
 */
export function rateLimitMiddleware(req, res, options = RATE_LIMITS.MODERATE) {
  const identifier = getClientIdentifier(req);
  const { allowed, remaining, resetTime } = checkRateLimit(identifier, options);

  // Add rate limit headers
  res.setHeader('X-RateLimit-Limit', options.maxRequests);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', new Date(resetTime).toISOString());

  if (!allowed) {
    const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({
      error: 'Too many requests',
      message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
      retryAfter
    });
    return false;
  }

  return true;
}

export function configureCors(origin) {
  if (origin) {
    CORS_HEADERS['Access-Control-Allow-Origin'] = origin;
  }
}
