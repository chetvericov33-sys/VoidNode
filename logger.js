// ============================================================
// LOGGER.JS — ЛОГИРОВАНИЕ В ФАЙЛ
// ============================================================
const fs = require('fs');
const path = require('path');

// Создаём папку для логов
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Функция логирования
function logToFile(message, level = 'INFO') {
    try {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level}] ${message}\n`;
        const today = new Date().toISOString().split('T')[0];
        const logFile = path.join(logDir, `${today}.log`);
        fs.appendFileSync(logFile, logMessage, 'utf8');
    } catch (error) {
        // Если логирование упало — ничего не делаем, чтобы не создавать бесконечный цикл
    }
}

// Переопределяем console.log для автоматического логирования
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = function(...args) {
    const message = args.join(' ');
    logToFile(message, 'INFO');
    originalLog.apply(console, args);
};

console.error = function(...args) {
    const message = args.join(' ');
    logToFile(message, 'ERROR');
    originalError.apply(console, args);
};

console.warn = function(...args) {
    const message = args.join(' ');
    logToFile(message, 'WARN');
    originalWarn.apply(console, args);
};

// Дополнительные функции для прямого логирования
function logInfo(message) {
    logToFile(message, 'INFO');
}

function logError(message) {
    logToFile(message, 'ERROR');
}

function logWarn(message) {
    logToFile(message, 'WARN');
}

// Экспортируем функции
module.exports = {
    logInfo,
    logError,
    logWarn,
    logToFile
};
