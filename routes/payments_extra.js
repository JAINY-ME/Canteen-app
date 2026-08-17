const express = require("express");
const router = express.Router();
const axios = require("axios");
const db = require("../config/db");

// Customer confirms they've paid via UPI QR/Link -> mark transaction as awaiting settlement
router.post("/confirm-paid", async (req, res) => {
  const { order_id, customer_id, transaction_ref_id } = req.body;
  if (!order_id || !customer_id)
    return res
      .status(400)
      .json({ success: false, error: "Missing order_id or customer_id" });

  try {
    const tx = await db.get("SELECT * FROM transactions WHERE order_id = ?", [
      order_id,
    ]);
    if (!tx)
      return res
        .status(404)
        .json({ success: false, error: "Transaction not found" });

    // Only allow when pending
    if (tx.payment_status === "Success")
      return res.json({ success: true, message: "Already settled" });

    await db.run(
      "UPDATE transactions SET payment_status = ?, transaction_ref_id = ? WHERE order_id = ?",
      [
        "Awaiting Settlement",
        transaction_ref_id || tx.transaction_ref_id || null,
        order_id,
      ],
    );

    // Notify accountant via notification + socket
    await db.run(
      `INSERT INTO notifications (recipient_type, recipient_id, order_id, title, message) VALUES (?, ?, ?, ?, ?)`,
      [
        "Staff",
        0,
        order_id,
        "UPI Payment Awaiting Settlement",
        `Order #${order_id} marked as paid by customer and awaits accountant settlement.`,
      ],
    );

    triggerSocketUpdate("accountant_room", "UPI_AWAITING_SETTLEMENT", {
      order_id,
      customer_id,
      total: tx.total_payable,
    });

    res.json({
      success: true,
      message: "Payment flagged for accountant settlement.",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function triggerSocketUpdate(room, event, data) {
  const payload = { room, event, data };
  const port = process.env.PORT || 5000;
  axios
    .post(`http://localhost:${port}/api/internal/trigger-socket`, payload)
    .catch((e) => console.error(e.message));
}

module.exports = router;
