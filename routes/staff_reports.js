const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET: Fetch sales summary analytics for Accountant Dashboard
router.get('/earnings', async (req, res) => {
    const { canteen_id } = req.query;
    try {
        // 1. Total revenue & transaction counts
        let summarySql = `
            SELECT COUNT(t.transaction_id) as total_txs,
                    SUM(t.total_payable) as gross_revenue,
                    SUM(t.discount_amount) as total_discounts,
                    SUM(t.gst_amount) as total_gst,
                    AVG(t.total_payable) as avg_order_value
             FROM transactions t
             JOIN orders o ON t.order_id = o.order_id
             WHERE t.payment_status = 'Success'
        `;
        const summaryParams = [];
        if (canteen_id && canteen_id !== 'null' && canteen_id !== 'undefined') {
            summarySql += ` AND o.canteen_id = ?`;
            summaryParams.push(parseInt(canteen_id));
        }
        const summary = await db.get(summarySql, summaryParams);

        // 2. Breakdown by payment method
        let pmSql = `
            SELECT t.payment_type, COUNT(t.transaction_id) as count, SUM(t.total_payable) as sales
            FROM transactions t
            JOIN orders o ON t.order_id = o.order_id
            WHERE t.payment_status = 'Success'
        `;
        const pmParams = [];
        if (canteen_id && canteen_id !== 'null' && canteen_id !== 'undefined') {
            pmSql += ` AND o.canteen_id = ?`;
            pmParams.push(parseInt(canteen_id));
        }
        pmSql += ` GROUP BY t.payment_type`;
        const paymentMethods = await db.all(pmSql, pmParams);

        // 3. Sales breakdown by canteen sections (menus)
        let ssSql = `
            SELECT m.menu_name, SUM(oi.subtotal) as sales, COUNT(oi.order_item_id) as items_sold
            FROM order_items oi
            JOIN items i ON oi.item_id = i.item_id
            JOIN categories c ON i.category_id = c.category_id
            JOIN menus m ON c.menu_id = m.menu_id
            JOIN orders o ON oi.order_id = o.order_id
            WHERE o.order_status != 'Cancelled' AND o.order_id IN (SELECT order_id FROM transactions WHERE payment_status = 'Success')
        `;
        const ssParams = [];
        if (canteen_id && canteen_id !== 'null' && canteen_id !== 'undefined') {
            ssSql += ` AND o.canteen_id = ?`;
            ssParams.push(parseInt(canteen_id));
        }
        ssSql += ` GROUP BY m.menu_id`;
        const sectionSales = await db.all(ssSql, ssParams);

        // 4. Daily sales trend (last 30 days)
        let dsSql = `
            SELECT date(t.created_at) as date, SUM(t.total_payable) as sales, COUNT(t.transaction_id) as count
            FROM transactions t
            JOIN orders o ON t.order_id = o.order_id
            WHERE t.payment_status = 'Success'
        `;
        const dsParams = [];
        if (canteen_id && canteen_id !== 'null' && canteen_id !== 'undefined') {
            dsSql += ` AND o.canteen_id = ?`;
            dsParams.push(parseInt(canteen_id));
        }
        dsSql += ` GROUP BY date(t.created_at)
                   ORDER BY date(t.created_at) DESC LIMIT 30`;
        const dailySales = await db.all(dsSql, dsParams);

        res.json({
            success: true,
            analytics: {
                total_transactions: summary.total_txs || 0,
                gross_revenue: summary.gross_revenue || 0.0,
                total_discounts: summary.total_discounts || 0.0,
                total_gst: summary.total_gst || 0.0,
                avg_order_value: summary.avg_order_value || 0.0,
                payment_methods: paymentMethods,
                section_sales: sectionSales,
                daily_sales: dailySales
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET: Get all transactions
router.get('/transactions', async (req, res) => {
    const { canteen_id } = req.query;
    try {
        let txSql = `
            SELECT t.*, c.full_name as customer_name, c.customer_category, o.order_status
            FROM transactions t
            JOIN customers c ON t.customer_id = c.customer_id
            JOIN orders o ON t.order_id = o.order_id
        `;
        const txParams = [];
        if (canteen_id && canteen_id !== 'null' && canteen_id !== 'undefined') {
            txSql += ` WHERE o.canteen_id = ?`;
            txParams.push(parseInt(canteen_id));
        }
        txSql += ` ORDER BY t.created_at DESC`;

        const rows = await db.all(txSql, txParams);
        res.json({ success: true, transactions: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
