const express = require('express');
const pool = require('../models/db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const totalUsers = await pool.query(
      'SELECT COUNT(*) FROM users'
    );

    const activeUsers = await pool.query(
      "SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '30 days'"
    );

    const totalAdmins = await pool.query(
      "SELECT COUNT(*) FROM users WHERE role = 'Admin'"
    );

    const newThisMonth = await pool.query(
      "SELECT COUNT(*) FROM users WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())"
    );

    const activePipelines = await pool.query(
      "SELECT COUNT(*) FROM pipelines WHERE status = 'active'"
    );

    const totalPipelines = await pool.query(
      'SELECT COUNT(*) FROM pipelines'
    );

    res.json({
      totalUsers:      parseInt(totalUsers.rows[0].count),
      activeUsers:     parseInt(activeUsers.rows[0].count),
      totalAdmins:     parseInt(totalAdmins.rows[0].count),
      newThisMonth:    parseInt(newThisMonth.rows[0].count),
      activePipelines: parseInt(activePipelines.rows[0].count),
      totalPipelines:  parseInt(totalPipelines.rows[0].count),
    });

  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Failed to load dashboard stats.' });
  }
});

module.exports = router;
