const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET: Fetch active ads for customer banner
router.get('/list', async (req, res) => {
    try {
        const rows = await db.all("SELECT * FROM ads WHERE is_active = 1 ORDER BY created_at DESC");
        res.json({ success: true, ads: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
