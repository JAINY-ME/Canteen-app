const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET: Fetch system change logs (Manager review)
router.get('/list', async (req, res) => {
    try {
        const rows = await db.all("SELECT * FROM logs ORDER BY timestamp DESC LIMIT 200");
        res.json({ success: true, logs: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
