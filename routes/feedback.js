const express = require("express");
const router = express.Router();
const db = require("../config/db");

// POST: Submit stars rating for orders, items, or menus
router.post("/rate", async (req, res) => {
  const { customer_id, order_id, ratings } = req.body;

  if (!customer_id || !ratings || !Array.isArray(ratings)) {
    return res
      .status(400)
      .json({
        success: false,
        error: "Missing required rating parameters (customer_id and ratings)",
      });
  }

  try {
    await db.run("BEGIN TRANSACTION");

    for (const item of ratings) {
      // item can contain: { item_id, menu_id, rating, review }
      await db.run(
        `INSERT INTO ratings (customer_id, order_id, menu_id, item_id, rating, review)
                 VALUES (?, ?, ?, ?, ?, ?)`,
        [
          customer_id,
          order_id || null,
          item.menu_id || null,
          item.item_id || null,
          item.rating,
          item.review || null,
        ],
      );
    }

    await db.run("COMMIT");

    // Log the rating action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Customer",
        customer_id,
        "Submit Rating",
        `Submitted ${ratings.length} rating details for Order #${order_id}`,
      ],
    );

    res.json({ success: true, message: "Ratings submitted successfully!" });
  } catch (err) {
    await db.run("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Submit general canteen feedback
router.post("/general", async (req, res) => {
  const { customer_id, message } = req.body;

  if (!customer_id || !message) {
    return res
      .status(400)
      .json({ success: false, error: "Missing feedback message" });
  }

  try {
    const result = await db.run(
      `INSERT INTO feedback (customer_id, message) VALUES (?, ?)`,
      [customer_id, message],
    );

    // Log feedback
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Customer",
        customer_id,
        "Submit Feedback",
        `Submitted feedback: "${message.substring(0, 50)}..."`,
      ],
    );

    res.json({
      success: true,
      message: "Feedback submitted. Thank you!",
      feedback_id: result.lastID,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Fetch all ratings and feedback (Manager review)
router.get("/list", async (req, res) => {
  try {
    const ratings = await db.all(
      `SELECT r.*, c.full_name as customer_name, i.item_name, m.menu_name 
             FROM ratings r 
             JOIN customers c ON r.customer_id = c.customer_id 
             LEFT JOIN items i ON r.item_id = i.item_id 
             LEFT JOIN menus m ON r.menu_id = m.menu_id 
             ORDER BY r.created_at DESC LIMIT 100`,
    );

    const generalFeedback = await db.all(
      `SELECT f.*, c.full_name as customer_name 
             FROM feedback f 
             JOIN customers c ON f.customer_id = c.customer_id 
             ORDER BY f.created_at DESC LIMIT 100`,
    );

    res.json({ success: true, ratings, generalFeedback });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
