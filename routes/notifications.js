const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET: Fetch customer notifications
router.get('/:customerId', async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT * FROM notifications 
             WHERE recipient_type = 'Customer' AND recipient_id = ? 
             ORDER BY created_at DESC LIMIT 30`,
            [req.params.customerId]
        );
        res.json({ success: true, notifications: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST: Mark notifications as read
router.post('/mark-read', async (req, res) => {
    const { customer_id } = req.body;
    try {
        await db.run(
            `UPDATE notifications SET is_read = 1 
             WHERE recipient_type = 'Customer' AND recipient_id = ?`,
            [customer_id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;