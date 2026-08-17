const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const db = require("../config/db");

// GET: Fetch receipt data for in-app viewing (returns JSON)
router.get("/:orderId", async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await db.get(
            `SELECT o.*, c.full_name, c.email, c.customer_category,
                    t.transaction_ref_id, t.payment_status, t.total_item_amount, t.discount_amount, t.gst_amount, t.payment_type
             FROM orders o
             JOIN customers c ON o.customer_id = c.customer_id
             JOIN transactions t ON o.order_id = t.order_id
             WHERE o.order_id = ?`,
            [orderId]
        );

        if (!order) {
            return res.status(404).json({ success: false, error: "Receipt/Order not found" });
        }

        const items = await db.all(
            `SELECT oi.*, i.item_name 
             FROM order_items oi 
             JOIN items i ON oi.item_id = i.item_id 
             WHERE oi.order_id = ?`,
            [orderId]
        );

        res.json({ success: true, order, items });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET: Generate and download receipt PDF on demand
router.get("/:orderId/pdf", async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await db.get(
            `SELECT o.*, c.full_name, c.email, c.customer_category,
                    t.transaction_ref_id, t.payment_status, t.total_item_amount, t.discount_amount, t.gst_amount, t.payment_type
             FROM orders o
             JOIN customers c ON o.customer_id = c.customer_id
             JOIN transactions t ON o.order_id = t.order_id
             WHERE o.order_id = ?`,
            [orderId]
        );

        if (!order) {
            return res.status(404).send("Receipt not found");
        }

        const items = await db.all(
            `SELECT oi.*, i.item_name 
             FROM order_items oi 
             JOIN items i ON oi.item_id = i.item_id 
             WHERE oi.order_id = ?`,
            [orderId]
        );

        const doc = new PDFDocument({ margin: 40 });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=Receipt_Order_${orderId}.pdf`);

        doc.pipe(res);

        doc.fontSize(20).text("Campus Central Canteen", { align: "center" });
        doc.fontSize(10).text("Official Payment Receipt", { align: "center" });
        doc.moveDown();

        doc.text(`Receipt No: RCT-${order.order_id}`);
        doc.text(`Date: ${new Date(order.created_at).toLocaleString()}`);
        doc.text(`Customer Name: ${order.full_name} (${order.customer_category})`);
        doc.text(`Payment Mode: ${order.payment_type}`);
        doc.text(`Reference ID: ${order.transaction_ref_id || "N/A"}`);
        doc.text(`Payment Status: ${order.payment_status}`);
        doc.moveDown();

        doc.text("----------------------------------------------------------------");
        doc.text("Item Name                          Qty      Unit Price     Subtotal");
        doc.text("----------------------------------------------------------------");

        items.forEach((item) => {
            const name = item.item_name.padEnd(32, " ");
            const qty = item.quantity.toString().padEnd(8, " ");
            const price = `Rs. ${item.unit_price}`.padEnd(14, " ");
            const sub = `Rs. ${item.subtotal.toFixed(2)}`;
            doc.text(`${name}${qty}${price}${sub}`);
        });

        doc.text("----------------------------------------------------------------");
        doc.text(`Subtotal: Rs. ${order.total_item_amount.toFixed(2)}`, { align: "right" });
        if (order.discount_amount > 0) {
            doc.text(`Student Discount (10%): -Rs. ${order.discount_amount.toFixed(2)}`, { align: "right" });
        }
        doc.text(`GST (5%): Rs. ${order.gst_amount.toFixed(2)}`, { align: "right" });
        doc.moveDown(0.5);
        doc.fontSize(12).text(`Total Paid: Rs. ${order.total_amount.toFixed(2)}`, { align: "right", bold: true });

        doc.moveDown();
        doc.fontSize(10).text("Thank you for dining with us!", { align: "center" });

        doc.end();
    } catch (err) {
        res.status(500).send("Error generating PDF receipt: " + err.message);
    }
});

module.exports = router;
