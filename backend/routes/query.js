const express = require('express');
const pool = require('../models/db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// POST /api/query/run — run a SQL query
router.post('/run', authenticateToken, async (req, res) => {
  const { sql } = req.body;

  if (!sql) {
    return res.status(400).json({ error: 'SQL query is required.' });
  }

  // Basic safety check — only allow SELECT queries
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    return res.status(403).json({
      error: 'Only SELECT queries are allowed in the query editor.'
    });
  }

  try {
    const start = Date.now();
    const result = await pool.query(sql);
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);

    res.json({
      columns: result.fields.map(f => f.name),
      rows:    result.rows,
      rowCount: result.rowCount,
      executionTime: elapsed + 's',
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/query/saved — list saved queries
router.get('/saved', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM saved_queries WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch saved queries.' });
  }
});

// POST /api/query/saved — save a query
router.post('/saved', authenticateToken, async (req, res) => {
  const { name, sql } = req.body;
  if (!name || !sql) {
    return res.status(400).json({ error: 'Name and SQL are required.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO saved_queries (user_id, name, sql)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.user.id, name, sql]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save query.' });
  }
});

module.exports = router;
