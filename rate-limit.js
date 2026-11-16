//Cargamos las variales de entorno
require('dotenv').config();

const { RateLimiterMemory } = require('rate-limiter-flexible');

//Limitador para combnación IP:username (ataques dirigidos)
const loginRateLimiter = new RateLimiterMemory({
    points: parseInt(process.env?.LOGIN_RATE_LIMIT_POINTS) || 5, //Número de intentos
    duration: parseInt(process.env?.LOGIN_RATE_LIMIT_DURATION) || 15 * 60, //15 Minutos (en segundos)
    blockDuration: parseInt(process.env?.LOGIN_RATE_LIMIT_BLOCK_DURATION) || 15 * 60, //Bloqueo por 15 minutos (en segundos)
    errorMessage: 'Demasiados intentos de logueo para este usuario. Por favor intenta mas tarde.'
});

//Limitador para IPs (ataques por posible combolists)
const ipLoginRateLimiter = new RateLimiterMemory({
    points: parseInt(process.env?.IP_LOGIN_RATE_LIMIT_POINTS) || 50,
    duration: parseInt(process.env?.IP_LOGIN_RATE_LIMIT_DURATION) || 15 * 60,
    blockDuration: parseInt(process.env?.IP_LOGIN_RATE_LIMIT_BLOCK_DURATION) || 15 * 60,
    errorMessage: 'Demasiados intentos de logueo para esta IP. Por favor intenta mas tarde.'
});

module.exports = {
    loginRateLimiter,
    ipLoginRateLimiter
};