const express = require('express');
const pool = require('../models/db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// GET /api/users — list all users (admin only)
router.get('/', authenticateToken, async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, role, organization, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// PUT /api/users/:id/role — update user role (admin only)
router.put('/:id/role', authenticateToken, async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  const { role } = req.body;
  const validRoles = ['Admin', 'Analyst', 'Viewer'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  try {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
    res.json({ message: 'User role updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

// DELETE /api/users/:id — delete a user (admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  if (req.user.id === parseInt(req.params.id)) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'User deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

module.exports = router;
