const express  = require('express');
const pool     = require('../models/db');
const auth     = require('../middleware/auth');
const {
  schedulePipeline,
  stopPipelineJob,
  executePipeline,
  addLog,
  SCHEDULES,
} = require('../scheduler');

const router = express.Router();

/* ─────────────────────────────────────────────────────────────
   GET /api/pipelines
   List all pipelines
───────────────────────────────────────────────────────────── */
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM pipelines ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pipelines.' });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/pipelines
   Create a new pipeline
───────────────────────────────────────────────────────────── */
router.post('/', auth, async (req, res) => {
  const {
    name, source, source_id, source_config,
    schedule, target_table, query
  } = req.body;

  if (!name || !source) {
    return res.status(400).json({ error: 'Name and source are required.' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO pipelines
        (name, source, source_id, source_config, schedule,
         target_table, query, status, progress, records, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'idle',0,'0',${req.user.id})
      RETURNING *
    `, [
      name, source, source_id || null,
      source_config ? JSON.stringify(source_config) : null,
      schedule || 'Manual', target_table || null, query || null,
    ]);

    const pipeline = result.rows[0];

    // Schedule if needed
    if (pipeline.schedule !== 'Manual') {
      schedulePipeline(pipeline);
    }

    await addLog(pipeline.id, `Pipeline "${pipeline.name}" created`, 'info');

    res.status(201).json(pipeline);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create pipeline.' });
  }
});

/* ─────────────────────────────────────────────────────────────
   PUT /api/pipelines/:id
   Update a pipeline
───────────────────────────────────────────────────────────── */
router.put('/:id', auth, async (req, res) => {
  const { name, source, schedule, target_table, query } = req.body;
  try {
    const result = await pool.query(`
      UPDATE pipelines
      SET name=$1, source=$2, schedule=$3,
          target_table=$4, query=$5
      WHERE id=$6 RETURNING *
    `, [name, source, schedule, target_table, query, req.params.id]);

    const pipeline = result.rows[0];

    // Reschedule
    stopPipelineJob(pipeline.id);
    if (pipeline.schedule !== 'Manual') {
      schedulePipeline(pipeline);
    }

    res.json(pipeline);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update pipeline.' });
  }
});

/* ─────────────────────────────────────────────────────────────
   PUT /api/pipelines/:id/run
   Manually run a pipeline
───────────────────────────────────────────────────────────── */
router.put('/:id/run', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const check = await pool.query(
      "SELECT * FROM pipelines WHERE id = $1", [id]
    );
    if (!check.rows.length) {
      return res.status(404).json({ error: 'Pipeline not found.' });
    }
    if (check.rows[0].status === 'running') {
      return res.status(400).json({ error: 'Pipeline is already running.' });
    }

    // Run async (don't wait)
    executePipeline(parseInt(id));

    res.json({ message: 'Pipeline started.', id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start pipeline.' });
  }
});

/* ─────────────────────────────────────────────────────────────
   PUT /api/pipelines/:id/stop
   Stop a running pipeline
───────────────────────────────────────────────────────────── */
router.put('/:id/stop', auth, async (req, res) => {
  try {
    await pool.query(`
      UPDATE pipelines SET status='idle', progress=0 WHERE id=$1
    `, [req.params.id]);
    await addLog(parseInt(req.params.id), 'Pipeline stopped by user', 'warn');
    res.json({ message: 'Pipeline stopped.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop pipeline.' });
  }
});

/* ─────────────────────────────────────────────────────────────
   PUT /api/pipelines/:id/pause
   Pause / resume a pipeline schedule
───────────────────────────────────────────────────────────── */
router.put('/:id/pause', auth, async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT * FROM pipelines WHERE id=$1', [req.params.id]
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Not found.' });

    const pipeline = check.rows[0];
    const newStatus = pipeline.status === 'paused' ? 'idle' : 'paused';

    await pool.query(
      'UPDATE pipelines SET status=$1 WHERE id=$2',
      [newStatus, req.params.id]
    );

    if (newStatus === 'paused') {
      stopPipelineJob(pipeline.id);
      await addLog(pipeline.id, 'Pipeline schedule paused', 'warn');
    } else {
      schedulePipeline({ ...pipeline, status: 'idle' });
      await addLog(pipeline.id, 'Pipeline schedule resumed', 'info');
    }

    res.json({ message: `Pipeline ${newStatus}.`, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: 'Failed to pause/resume pipeline.' });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/pipelines/:id/logs
   Get logs for a pipeline
───────────────────────────────────────────────────────────── */
router.get('/:id/logs', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM pipeline_logs
      WHERE pipeline_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs.' });
  }
});

/* ─────────────────────────────────────────────────────────────
   DELETE /api/pipelines/:id
   Delete a pipeline
───────────────────────────────────────────────────────────── */
router.delete('/:id', auth, async (req, res) => {
  try {
    stopPipelineJob(parseInt(req.params.id));
    await pool.query('DELETE FROM pipelines WHERE id=$1', [req.params.id]);
    res.json({ message: 'Pipeline deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete pipeline.' });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/pipelines/schedules
   Get available schedule options
───────────────────────────────────────────────────────────── */
router.get('/schedules', auth, (req, res) => {
  res.json(Object.keys(SCHEDULES));
});

module.exports = router;
