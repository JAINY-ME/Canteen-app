const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Check and verify customer by phone or email
router.post('/verify', async (req, res) => {
    const { phone, email, full_name, customer_category } = req.body;

    if (!phone || !email) {
        return res.status(400).json({ success: false, error: "Phone and email are required" });
    }

    try {
        // Query if customer exists by phone or email
        let customer = await db.get("SELECT * FROM customers WHERE phone = ? OR email = ?", [phone, email]);

        if (customer) {
            // Profile exists! Prevent redundancy by reusing this customer.
            // Check if any details changed to log the changes.
            let changes = [];
            if (customer.full_name !== full_name && full_name) {
                changes.push(`Name changed from "${customer.full_name}" to "${full_name}"`);
            }
            if (customer.customer_category !== customer_category && customer_category) {
                changes.push(`Category changed from "${customer.customer_category}" to "${customer_category}"`);
            }
            if (customer.phone !== phone) {
                changes.push(`Phone changed from "${customer.phone}" to "${phone}"`);
            }
            if (customer.email !== email) {
                changes.push(`Email changed from "${customer.email}" to "${email}"`);
            }

            if (changes.length > 0) {
                // Update profile in DB
                await db.run(
                    `UPDATE customers 
                     SET full_name = COALESCE(?, full_name), 
                         phone = COALESCE(?, phone), 
                         email = COALESCE(?, email), 
                         customer_category = COALESCE(?, customer_category) 
                     WHERE customer_id = ?`,
                    [full_name, phone, email, customer_category, customer.customer_id]
                );

                // Insert into system change logs
                await db.run(
                    `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
                    ['Customer', customer.customer_id, 'Profile Update', changes.join(', ')]
                );
                
                // Fetch updated customer record
                customer = await db.get("SELECT * FROM customers WHERE customer_id = ?", [customer.customer_id]);
            }

            return res.json({
                success: true,
                message: "Existing customer session retrieved successfully.",
                customer,
                is_new: false
            });
        } else {
            // Create a new customer if not found
            if (!full_name) {
                // If we don't have a name yet, prompt customer to fill details (Page1 prompt)
                return res.json({
                    success: false,
                    prompt_details: true,
                    message: "Customer details not found. Please fill in your profile."
                });
            }

            const result = await db.run(
                `INSERT INTO customers (full_name, phone, email, customer_category) VALUES (?, ?, ?, ?)`,
                [full_name, phone, email, customer_category || 'Student']
            );
            const customerId = result.lastID;

            await db.run(
                `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
                ['Customer', customerId, 'Registration', `Registered as new customer with Phone: ${phone}, Email: ${email}`]
            );

            const newCustomer = await db.get("SELECT * FROM customers WHERE customer_id = ?", [customerId]);

            return res.json({
                success: true,
                message: "New customer profile created.",
                customer: newCustomer,
                is_new: true
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Fetch customer by ID directly (for session recovery)
router.get('/:id', async (req, res) => {
    try {
        const customer = await db.get("SELECT * FROM customers WHERE customer_id = ?", [req.params.id]);
        if (!customer) {
            return res.status(404).json({ success: false, error: "Customer not found" });
        }
        res.json({ success: true, customer });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
