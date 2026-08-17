const jwt = require("jsonwebtoken");
const db = require("../config/db");

const SECRET = process.env.STAFF_JWT_SECRET || "change_this_secret_in_prod";

async function verifyStaffToken(req, res, next) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || !auth.startsWith("Bearer "))
    return res.status(401).json({ success: false, error: "Missing token" });
  const token = auth.split(" ")[1];
  try {
    const payload = jwt.verify(token, SECRET);
    const staff = await db.get(
      "SELECT staff_id, full_name, email, role_id, canteen_id, status FROM staff WHERE staff_id = ?",
      [payload.staff_id],
    );
    if (!staff || staff.status !== "Active")
      return res
        .status(403)
        .json({ success: false, error: "Account inactive or not found" });
    req.staff = staff;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
}

module.exports = { verifyStaffToken };
