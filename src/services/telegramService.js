const axios = require('axios');

async function sendTelegramAlert(message) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        // Skip if not configured
        return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    try {
        await axios.post(url, {
            chat_id: chatId,
            text: `🚨 *iOpenWRT Alert* 🚨\n\n${message}`,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Failed to send Telegram alert:', error.response?.data || error.message);
    }
}

module.exports = { sendTelegramAlert };
