const express = require("express");
const router = express.Router();
const db = require("../config/db");
let bcrypt;
try {
  bcrypt = require("bcrypt");
} catch (e) {
  bcrypt = require("bcryptjs");
}
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.STAFF_JWT_SECRET || "change_this_secret_in_prod";
const JWT_EXPIRES = "8h";

// POST: Staff Authentication Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res
      .status(400)
      .json({ success: false, error: "Email and password are required" });

  try {
    const staff = await db.get(
      `SELECT s.*, r.role_name 
             FROM staff s
             JOIN roles r ON s.role_id = r.role_id
             WHERE s.email = ? AND s.status = 'Active'`,
      [email],
    );

    if (!staff)
      return res.status(401).json({
        success: false,
        error: "Invalid credentials or inactive account",
      });

    const match = await bcrypt.compare(password, staff.password_hash);
    if (!match)
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });

    // Update last login and log
    await db.run(
      `UPDATE staff SET last_login = datetime('now','localtime') WHERE staff_id = ?`,
      [staff.staff_id],
    );
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff.staff_id,
        "Login",
        `Staff member ${staff.full_name} (${staff.role_name}) logged in.`,
      ],
    );

    // Issue JWT
    const token = jwt.sign(
      { staff_id: staff.staff_id, role_id: staff.role_id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES },
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      staff: {
        staff_id: staff.staff_id,
        full_name: staff.full_name,
        email: staff.email,
        role: staff.role_name,
        canteen_id: staff.canteen_id,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Fetch active canteen sections (menus) for login dropdown
router.get("/sections", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT m.*, c.canteen_name 
             FROM menus m
             LEFT JOIN canteens c ON m.canteen_id = c.canteen_id
             WHERE m.is_active = 1
             ORDER BY m.canteen_id ASC, m.menu_name ASC`,
    );
    res.json({ success: true, sections: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================================
// STAFF USER ACCOUNTS MANAGEMENT
// ==========================================

// GET: Fetch all staff accounts (with role details)
router.get("/list", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT s.*, r.role_name, cant.canteen_name 
             FROM staff s
             JOIN roles r ON s.role_id = r.role_id
             LEFT JOIN canteens cant ON s.canteen_id = cant.canteen_id
             ORDER BY s.role_id ASC, s.full_name ASC`,
    );
    const roles = await db.all("SELECT * FROM roles ORDER BY role_id ASC");

    res.json({ success: true, staffList: rows, roles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Add new Staff account
router.post("/add", async (req, res) => {
  const {
    role_id,
    canteen_id,
    full_name,
    email,
    phone,
    password,
    status,
    staff_id,
  } = req.body;

  if (!role_id || !full_name || !email || !phone || !password) {
    return res.status(400).json({
      success: false,
      error: "Role, Name, Email, Phone and Password are required.",
    });
  }

  try {
    // Hash password
    const hash = await bcrypt.hash(password, 10);
    const result = await db.run(
      `INSERT INTO staff (role_id, canteen_id, full_name, email, phone, password_hash, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        role_id,
        canteen_id ? parseInt(canteen_id) : null,
        full_name,
        email,
        phone,
        hash,
        status || "Active",
      ],
    );
    const newStaffId = result.lastID;

    // Fetch role name for log
    const role = await db.get("SELECT role_name FROM roles WHERE role_id = ?", [
      role_id,
    ]);

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Add Staff Account",
        `Created staff account "${full_name}" as "${role.role_name}" (ID: ${newStaffId})`,
      ],
    );

    res.json({
      success: true,
      message: "Staff account created successfully.",
      staff_id: newStaffId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Edit Staff account
router.post("/edit/:id", async (req, res) => {
  const { id } = req.params;
  const {
    role_id,
    canteen_id,
    full_name,
    email,
    phone,
    password,
    status,
    staff_id,
  } = req.body;

  try {
    const oldStaff = await db.get("SELECT * FROM staff WHERE staff_id = ?", [
      id,
    ]);
    if (!oldStaff)
      return res
        .status(404)
        .json({ success: false, error: "Staff member not found." });

    let passwordFragment = "";
    const params = [
      role_id,
      canteen_id ? parseInt(canteen_id) : null,
      full_name,
      email,
      phone,
    ];
    if (password && password.trim() !== "") {
      const newHash = await bcrypt.hash(password, 10);
      passwordFragment = ", password_hash = ?";
      params.push(newHash);
    }
    params.push(status, id);

    await db.run(
      `UPDATE staff 
               SET role_id = ?, 
                   canteen_id = ?,
                   full_name = ?, 
                   email = ?, 
                   phone = ?${passwordFragment}, 
                   status = ?, 
                   updated_at = datetime('now','localtime') 
               WHERE staff_id = ?`,
      params,
    );

    // Fetch role name for log
    const role = await db.get("SELECT role_name FROM roles WHERE role_id = ?", [
      role_id,
    ]);

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Edit Staff Account",
        `Updated staff account "${full_name}" (ID: ${id}) as "${role.role_name}" (Status: ${status})`,
      ],
    );

    res.json({ success: true, message: "Staff account updated successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Delete Staff account
router.post("/delete/:id", async (req, res) => {
  const { id } = req.params;
  const { staff_id } = req.body;

  if (parseInt(id) === parseInt(staff_id)) {
    return res
      .status(400)
      .json({ success: false, error: "You cannot delete your own account!" });
  }

  try {
    const staffMember = await db.get("SELECT * FROM staff WHERE staff_id = ?", [
      id,
    ]);
    if (!staffMember)
      return res
        .status(404)
        .json({ success: false, error: "Staff member not found." });

    await db.run("DELETE FROM staff WHERE staff_id = ?", [id]);

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Delete Staff Account",
        `Deleted staff account for "${staffMember.full_name}" (ID: ${id})`,
      ],
    );

    res.json({ success: true, message: "Staff account deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Change own password (requires Authorization: Bearer <token>)
router.post("/change-password", async (req, res) => {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || !auth.startsWith("Bearer "))
    return res.status(401).json({ success: false, error: "Missing token" });
  const token = auth.split(" ")[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password)
      return res
        .status(400)
        .json({ success: false, error: "Old and new password required" });

    const staff = await db.get("SELECT * FROM staff WHERE staff_id = ?", [
      payload.staff_id,
    ]);
    if (!staff)
      return res.status(404).json({ success: false, error: "Staff not found" });

    const match = await bcrypt.compare(old_password, staff.password_hash);
    if (!match)
      return res
        .status(401)
        .json({ success: false, error: "Old password is incorrect" });

    const newHash = await bcrypt.hash(new_password, 10);
    await db.run(
      "UPDATE staff SET password_hash = ?, updated_at = datetime('now','localtime') WHERE staff_id = ?",
      [newHash, staff.staff_id],
    );

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff.staff_id,
        "Change Password",
        `Staff changed own password`,
      ],
    );

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    res.status(401).json({ success: false, error: "Invalid token or request" });
  }
});

module.exports = router;
