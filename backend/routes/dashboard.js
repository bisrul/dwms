const express = require('express');
const pool = require('../models/db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const totalRecords  = await pool.query('SELECT COUNT(*) FROM fact_sales');
    const activePipelines = await pool.query("SELECT COUNT(*) FROM pipelines WHERE status = 'active'");
    const totalUsers    = await pool.query('SELECT COUNT(*) FROM users');

    res.json({
      totalRecords:    parseInt(totalRecords.rows[0].count),
      activePipelines: parseInt(activePipelines.rows[0].count),
      totalUsers:      parseInt(totalUsers.rows[0].count),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard stats.' });
  }
});

module.exports = router;
