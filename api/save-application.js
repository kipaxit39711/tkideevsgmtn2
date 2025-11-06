// api/save-application.js

const axios = require('axios');
const { MongoClient } = require('mongodb');
const { randomUUID } = require('crypto'); // <-- Geliştirme 1: Takip ID için

// --- Vercel Ortam Değişkenleri (Vercel Ayarlarından Girilmeli) ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'toki';

// --- Python API Bilgileri ---
const MY_PYTHON_API_URL = 'http://83.136.211.173:5031/send_sms';
const MY_PYTHON_API_KEY = 'YGX9-MM32-WDQV-8SDE-AYRF-QUJZ-AKR3-9SB7';

// --- Yardımcı Fonksiyonlar (Tamamı) ---
let cachedClient = null;

/**
 * MongoDB bağlantısını yönetir ve cache'ler.
 */
async function getClient(uri) {
    if (cachedClient) {
        try { 
            await cachedClient.db('admin').command({ ping: 1 }); 
            return cachedClient; 
        } catch (err) { 
            cachedClient = null; 
            console.warn('[DB_CACHE] Cachelenmiş bağlantı koptu, yeniden bağlanılıyor...');
        }
    }
    const client = new MongoClient(uri, { retryWrites: true, w: 'majority', serverSelectionTimeoutMS: 5000 });
    try {
        await client.connect();
    } catch (err) {
        console.error('[DB] Yeni MongoDB bağlantısı başarısız:', err.message);
        throw err;
    }
    cachedClient = client;
    return client;
}

/**
 * Tarihi dd.mm.yyyy HH:MM:SS olarak formatlar.
 */
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

/**
 * Telegram'a güvenli bir şekilde mesaj gönderir.
 */
async function sendTelegramMessage(text, parseMode = 'Markdown') {
    if (!BOT_TOKEN || !CHAT_ID) {
        console.warn('[TELEGRAM] BOT_TOKEN veya CHAT_ID yapılandırılmamış. Mesaj atlanıyor.');
        return;
    }
    const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(telegramApiUrl, {
            chat_id: CHAT_ID, 
            text: text, 
            parse_mode: parseMode, 
            disable_web_page_preview: true
        });
    } catch (error) {
        console.error('[TELEGRAM] Yardımcı fonksiyon mesaj gönderemedi:', error.message);
    }
}
// --- Yardımcı Fonksiyonlar Sonu ---


// --- 🚀 ANA SUNUCUSUZ FONKSİYON ---
module.exports = async (req, res) => {
    // Her istek için benzersiz bir Takip ID (Correlation ID) oluştur
    const correlationId = randomUUID().split('-')[0]; // örn: "a1b2c3d4"

    // 1. İstek Kontrolü ve Veri Doğrulama
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    let requestBody;
    try {
        requestBody = req.body;
        const { name, tc, phone, email, project } = requestBody;
        if (!name || !tc || !phone || !email || !project) {
            console.warn(`[${correlationId}] [VALIDATION] Eksik bilgi geldi.`);
            return res.status(400).json({ success: false, message: 'Eksik bilgi...' });
        }
    } catch (parseError) {
        console.error(`[${correlationId}] [VALIDATION] İstek (body) parse edilemedi.`, parseError);
        return res.status(400).json({ success: false, message: 'Geçersiz istek formatı.' });
    }

    // 2. --- HIZLI YANIT (Kullanıcıyı Bekletme) ---
    res.status(200).json({ 
        success: true, 
        message: 'Başvuru alındı. Arka planda işleniyor.',
        correlation_id: correlationId // Takip için bu ID'yi frontend'e de dönebiliriz
    });
    
    // 3. --- ARKA PLAN GÖREVLERİ (Güvenilirlik ve Sıralı Akış) ---
    // Yanıt DÖNDÜKTEN SONRA Vercel bu işlemlere devam eder.
    
    console.log(`[${correlationId}] [BG_TASK] Arka plan görevleri başlatıldı.`);
    const startTime = process.hrtime.bigint(); // Zamanlayıcıyı başlat

    let dbStatus = 'Beklemede';
    let dbDuration = '0ms';
    let smsStatus = 'Atlandı';
    let smsDuration = '0ms';
    let applicationId = null;
    let pythonApiResponse = null;
    
    // Gerekli değişkenleri yeniden yapılandır
    const { name, tc, phone, project } = requestBody; 

    try {
        // --- (Arka Plan) ADIM 1: Önce Veritabanına Kaydet (En Kritik Görev) ---
        const dbStart = process.hrtime.bigint();
        console.log(`[${correlationId}] [DB_TASK] Veritabanı kaydı başlıyor...`);
        try {
            const client = await getClient(MONGODB_URI);
            const db = client.db(MONGODB_DB);
            const collection = db.collection('applications');
            const applicationData = { 
                ...requestBody, // Gelen tüm veriyi kaydet
                created_at: new Date(),
                _correlationId: correlationId // Takip ID'sini DB'ye ekle
            };
            const result = await collection.insertOne(applicationData);
            applicationId = result.insertedId.toString();
            dbStatus = `✅ Başarılı (ID: ${applicationId})`;
            console.log(`[${correlationId}] [DB_TASK] Veritabanına kaydedildi. ID: ${applicationId}`);
        } catch (dbError) {
            console.error(`[${correlationId}] [DB_TASK] MongoDB kaydı BAŞARISIZ!`, dbError);
            dbStatus = `❌ BAŞARISIZ! (${dbError.message})`;
        }
        dbDuration = `${(process.hrtime.bigint() - dbStart) / 1000000n}ms`; // milisaniye

        // --- (Arka Plan) ADIM 2: DB Başarılı Olduysa SMS Gönder ---
        if (applicationId) { // Sadece DB kaydı başarılıysa SMS gönder
            const smsStart = process.hrtime.bigint();
            console.log(`[${correlationId}] [SMS_TASK] Python API tetikleniyor (ID: ${applicationId})...`);
            try {
                const smsApiPayload = { 
                    phone, 
                    name, 
                    project, 
                    applicationId, // <-- Gerçek ve kaydedilmiş ID'yi gönderiyoruz
                    _correlationId: correlationId // <-- Python logları için Takip ID'si
                };
                const apiHeaders = {'Content-Type': 'application/json', 'X-INTERNAL-API-KEY': MY_PYTHON_API_KEY};
                
                const smsResponse = await axios.post(MY_PYTHON_API_URL, smsApiPayload, { headers: apiHeaders, timeout: 5000 });
                pythonApiResponse = smsResponse.data;
                smsStatus = '✅ Başarılı';
                console.log(`[${correlationId}] [SMS_TASK] Python API başarıyla tetiklendi.`);
            } catch (smsError) {
                console.error(`[${correlationId}] [SMS_TASK] Python API tetiklenemedi!`, smsError);
                pythonApiResponse = smsError.response ? smsError.response.data : { error: smsError.message };
                smsStatus = `❌ BAŞARISIZ! (${smsError.message})`;
            }
            smsDuration = `${(process.hrtime.bigint() - smsStart) / 1000000n}ms`;
        } else {
            smsStatus = '--- Atlandı (DB Hatası)';
            console.warn(`[${correlationId}] [SMS_TASK] DB hatası nedeniyle SMS tetiklemesi atlandı.`);
        }

    } catch (generalError) {
        console.error(`[${correlationId}] [BG_TASK] Beklenmedik genel arka plan hatası!`, generalError);
        // Bu hata olursa, Telegram'a ayrı bir acil durum mesajı gönder
        await sendTelegramMessage(`🔥 *KRİTİK ARKA PLAN HATASI* 🔥\n*Takip ID:* \`${correlationId}\`\n*Hata:* ${generalError.message}`);
    }

    // --- (Arka Plan) ADIM 3: Detaylı Raporu Telegram'a Gönder ---
    const totalDuration = `${(process.hrtime.bigint() - startTime) / 1000000n}ms`;
    console.log(`[${correlationId}] [BG_TASK] Tüm görevler tamamlandı (${totalDuration}). Rapor gönderiliyor.`);
    
    // Mesajdaki özel karakterlerin Telegram Markdown'ını bozmasını engelle
    const safeName = (name || '').replace(/([_*\[\]()~`>#+-=|{}.!])/g, '\\$1');
    const safeTc = (tc || '').replace(/([_*\[\]()~`>#+-=|{}.!])/g, '\\$1');
    
    const reportMessage = `*✨ 🇹🇷 Yeni Başvuru Raporu*
*Takip ID:* \`${correlationId}\`

*👤 Ad Soyad:* ${safeName}
*🆔 TC:* ${safeTc}
*📱 Telefon:* \`${phone}\`

---
*GÖREV RAPORU (Toplam Süre: ${totalDuration})*
*1. Veritabanı:* ${dbStatus} _(${dbDuration})_
*2. SMS Gönderimi:* ${smsStatus} _(${smsDuration})_
---
*SMS API Yanıtı (Python'dan gelen):*
\`\`\`json
${JSON.stringify(pythonApiResponse || {"info": "SMS görevi atlandı."}, null, 2)}
\`\`\``;
        
    await sendTelegramMessage(reportMessage, 'MarkdownV2'); // Özel karakterleri güvenli göndermek için V2 modu
};