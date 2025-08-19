// Load environment variables
require('dotenv').config();

const { RateLimiterMemory } = require('rate-limiter-flexible');

// Helper function to get client IP address
function getClientIP(req) {
    // Check for forwarded headers (for proxy/load balancer scenarios)
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    
    const realIP = req.headers['x-real-ip'];
    if (realIP) {
        return realIP;
    }

    // Fallback to connection remote address
    return req.connection?.remoteAddress || 
           req.socket?.remoteAddress || 
           req.connection?.socket?.remoteAddress || 
           'unknown';
}

// Create rate limiter for login attempts per IP:username (targeted attacks)
const loginRateLimiter = new RateLimiterMemory({
    keyGenerator: (req) => {
        const ip = getClientIP(req);
        const username = req._dataBody?.username || 'unknown';
        return `${ip}:${username}`;
    },
    points: parseInt(process.env.LOGIN_RATE_LIMIT_POINTS) || 5, // Number of attempts allowed per IP:username
    duration: parseInt(process.env.LOGIN_RATE_LIMIT_DURATION) || 15 * 60, // Per 15 minutes (in seconds)
    blockDuration: parseInt(process.env.LOGIN_RATE_LIMIT_BLOCK_DURATION) || 15 * 60, // Block for 15 minutes after limit is reached
    errorMessage: 'Too many login attempts for this username. Please try again later.'
});

// Create rate limiter for login attempts per IP (combolist attacks)
const ipLoginRateLimiter = new RateLimiterMemory({
    keyGenerator: (req) => {
        return getClientIP(req);
    },
    points: parseInt(process.env.IP_LOGIN_RATE_LIMIT_POINTS) || 50, // Number of attempts allowed per IP
    duration: parseInt(process.env.IP_LOGIN_RATE_LIMIT_DURATION) || 15 * 60, // Per 15 minutes (in seconds)
    blockDuration: parseInt(process.env.IP_LOGIN_RATE_LIMIT_BLOCK_DURATION) || 15 * 60, // Block for 15 minutes after limit is reached
    errorMessage: 'Too many login attempts from this IP. Please try again later.'
});

// Export the rate limiters and helper function
module.exports = {
    loginRateLimiter,
    ipLoginRateLimiter,
    getClientIP
}; 