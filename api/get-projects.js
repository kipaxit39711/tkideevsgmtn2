// api/get-projects.js
// Returns projects for a given province code (01..81) from MongoDB 'cities' collection

const { MongoClient } = require('mongodb');

let cachedClient = null;
let loggedConnection = false;

async function getClient(uri) {
    if (cachedClient) return cachedClient;
    const client = new MongoClient(uri, { retryWrites: true, w: 'majority' });
    try {
        await client.connect();
        if (!loggedConnection) {
            console.log('[DB] Connected to MongoDB successfully');
            loggedConnection = true;
        }
    } catch (err) {
        console.error('[DB] MongoDB connection failed:', err.message);
        throw err;
    }
    cachedClient = client;
    return cachedClient;
}

module.exports = async (req, res) => {
    try {
        const { province, city, debug } = req.query || {};
        if (!province && !city) {
            return res.status(400).json({ success: false, message: 'province (01..81) veya city parametresi gerekli' });
        }

        const uri = process.env.MONGODB_URI;
        const dbName = process.env.MONGODB_DB || 'toki';
        if (!uri) {
            return res.status(500).json({ success: false, message: 'MONGODB_URI tanımlı değil' });
        }

        const client = await getClient(uri);
        const db = client.db(dbName);
        const col = db.collection('cities');

        if (debug === '1') {
            const count = await col.estimatedDocumentCount();
            const sample = await col.find({}, { projection: { _id: 0, city: 1, provinceCode: 1 }, limit: 3 }).toArray();
            console.log('[DB] Debug:', { dbName, count, sample });
        }

        let doc = null;
        if (province) {
            const padded = String(province).padStart(2, '0');
            const unpadded = String(parseInt(province, 10));
            const numeric = parseInt(province, 10);
            doc = await col.findOne(
                { provinceCode: { $in: [padded, unpadded, numeric] } },
                { projection: { _id: 0, projects: 1 } }
            );
            if (!doc) {
                console.log(`[DB] No doc for provinceCode`, { padded, unpadded, numeric });
            }
        }

        if (!doc && city) {
            const cityName = String(city).trim();
            // Case/diacritic-insensitive match with Turkish collation
            doc = await col.findOne(
                { city: cityName },
                { projection: { _id: 0, projects: 1 }, collation: { locale: 'tr', strength: 1 } }
            );
            if (!doc) {
                console.log(`[DB] No doc for city fallbacks`, { cityName });
            }
        }

        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        return res.status(200).json({ success: true, projects: doc?.projects || [], project_details: [] });
    } catch (err) {
        console.error('get-projects error:', err.message);
        return res.status(500).json({ success: false, message: 'Sunucu hatası', error: err.message });
    }
};