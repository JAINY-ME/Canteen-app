const express = require("express");
const router = express.Router();
const db = require("../config/db");
const webpush = require("web-push");

// Cache public VAPID key
let vapidPublicKey = null;

async function getVapidPublicKey() {
  if (vapidPublicKey) return vapidPublicKey;

  let pubKeyRow = await db.get("SELECT value FROM settings WHERE key = 'vapid_public_key'");
  let privKeyRow = await db.get("SELECT value FROM settings WHERE key = 'vapid_private_key'");

  if (!pubKeyRow || !privKeyRow) {
    const keys = webpush.generateVAPIDKeys();
    await db.run("DELETE FROM settings WHERE key IN ('vapid_public_key', 'vapid_private_key')");
    await db.run("INSERT INTO settings (key, value) VALUES ('vapid_public_key', ?)", [keys.publicKey]);
    await db.run("INSERT INTO settings (key, value) VALUES ('vapid_private_key', ?)", [keys.privateKey]);
    vapidPublicKey = keys.publicKey;
    webpush.setVapidDetails("mailto:admin@canteen.com", keys.publicKey, keys.privateKey);
  } else {
    vapidPublicKey = pubKeyRow.value;
    webpush.setVapidDetails("mailto:admin@canteen.com", pubKeyRow.value, privKeyRow.value);
  }
  return vapidPublicKey;
}

// GET: Retrieve public VAPID key for browser subscription
router.get("/vapid-public-key", async (req, res) => {
  try {
    const publicKey = await getVapidPublicKey();
    res.json({ success: true, publicKey });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Register Web Push subscription
router.post("/register", async (req, res) => {
  const { customer_id, token, platform } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: "Subscription object string is required" });
  }
  try {
    // Remove duplicate registrations
    await db.run("DELETE FROM device_tokens WHERE token = ?", [token]);
    await db.run(
      "INSERT INTO device_tokens (customer_id, token, platform) VALUES (?, ?, ?)",
      [customer_id || null, token, platform || "web"]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Send push notifications using web-push
router.post("/send", async (req, res) => {
  const { customer_id, title, message, data } = req.body;
  if (!customer_id || !title || !message) {
    return res.status(400).json({ success: false, error: "customer_id, title and message required" });
  }

  try {
    await getVapidPublicKey();

    const tokens = await db.all(
      "SELECT token FROM device_tokens WHERE customer_id = ?",
      [customer_id]
    );

    if (!tokens || tokens.length === 0) {
      return res.json({ success: true, message: "No registered subscriptions for customer" });
    }

    const payload = JSON.stringify({
      title,
      body: message,
      data: data || {}
    });

    const results = [];
    for (const t of tokens) {
      try {
        if (t.token.startsWith("{")) {
          const subscription = JSON.parse(t.token);
          await webpush.sendNotification(subscription, payload);
          results.push({ status: "success" });
        } else {
          results.push({ status: "skipped_legacy" });
        }
      } catch (err) {
        console.error("Web push dispatch error:", err.message);
        results.push({ error: err.message });
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.run("DELETE FROM device_tokens WHERE token = ?", [t.token]);
        }
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
