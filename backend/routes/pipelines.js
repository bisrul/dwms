const express = require('express');
const pool = require('../models/db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// GET /api/pipelines — list all pipelines
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM pipelines ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pipelines.' });
  }
});

// POST /api/pipelines — create a new pipeline
router.post('/', authenticateToken, async (req, res) => {
  const { name, source, schedule } = req.body;
  if (!name || !source) {
    return res.status(400).json({ error: 'Name and source are required.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO pipelines (name, source, schedule, status, progress)
       VALUES ($1, $2, $3, 'idle', 0) RETURNING *`,
      [name, source, schedule || 'Manual']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create pipeline.' });
  }
});

// PUT /api/pipelines/:id/run — run a pipeline
router.put('/:id/run', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      "UPDATE pipelines SET status = 'running', progress = 0 WHERE id = $1",
      [id]
    );
    res.json({ message: 'Pipeline started.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to start pipeline.' });
  }
});

// PUT /api/pipelines/:id/stop — stop a pipeline
router.put('/:id/stop', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      "UPDATE pipelines SET status = 'idle', progress = 0 WHERE id = $1",
      [id]
    );
    res.json({ message: 'Pipeline stopped.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to stop pipeline.' });
  }
});

// DELETE /api/pipelines/:id — delete a pipeline
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM pipelines WHERE id = $1', [id]);
    res.json({ message: 'Pipeline deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete pipeline.' });
  }
});

module.exports = router;
