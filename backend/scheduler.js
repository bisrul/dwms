const cron = require('node-cron');
const pool = require('./models/db');

/* ── Schedule map ───────────────────────────────────────────── */
const SCHEDULES = {
  'Every 15 min':  '*/15 * * * *',
  'Every 30 min':  '*/30 * * * *',
  'Every 1 hour':  '0 * * * *',
  'Every 6 hours': '0 */6 * * *',
  'Daily':         '0 2 * * *',
  'Manual':        null,
};

/* ── Active cron jobs store ─────────────────────────────────── */
const activeJobs = {};

/* ── Execute a single pipeline ──────────────────────────────── */
async function executePipeline(pipelineId) {
  let pipeline;
  try {
    const res = await pool.query(
      'SELECT * FROM pipelines WHERE id = $1', [pipelineId]
    );
    if (!res.rows.length) return;
    pipeline = res.rows[0];

    // Mark as running
    await pool.query(`
      UPDATE pipelines
      SET status = 'running', progress = 0, last_run = NOW()
      WHERE id = $1
    `, [pipelineId]);

    await addLog(pipelineId, `Pipeline "${pipeline.name}" started`, 'info');

    // Simulate ETL steps with progress updates
    const steps = [
      { progress: 10, msg: `Connecting to ${pipeline.source}...` },
      { progress: 30, msg: 'Connection established. Extracting data...' },
      { progress: 55, msg: 'Transforming records...' },
      { progress: 80, msg: `Loading into warehouse...` },
      { progress: 100, msg: 'Pipeline completed successfully.' },
    ];

    for (const step of steps) {
      await sleep(800);
      await pool.query(
        'UPDATE pipelines SET progress = $1 WHERE id = $2',
        [step.progress, pipelineId]
      );
      await addLog(pipelineId, step.msg, step.progress === 100 ? 'success' : 'info');
    }

    // Mark as success
    await pool.query(`
      UPDATE pipelines
      SET status = 'success', progress = 100,
          records = (SELECT FLOOR(RANDOM() * 900000 + 100000)::TEXT || 'K'),
          last_run = NOW()
      WHERE id = $1
    `, [pipelineId]);

    await addLog(pipelineId, `Pipeline "${pipeline.name}" finished successfully`, 'success');

  } catch (err) {
    console.error(`Pipeline ${pipelineId} failed:`, err.message);
    await pool.query(`
      UPDATE pipelines SET status = 'error', progress = 0 WHERE id = $1
    `, [pipelineId]);
    await addLog(pipelineId, `ERROR: ${err.message}`, 'error');
  }
}

/* ── Schedule a pipeline ────────────────────────────────────── */
function schedulePipeline(pipeline) {
  const cronExpr = SCHEDULES[pipeline.schedule];
  if (!cronExpr) return;

  // Stop existing job if any
  if (activeJobs[pipeline.id]) {
    activeJobs[pipeline.id].stop();
    delete activeJobs[pipeline.id];
  }

  if (pipeline.status === 'paused' || pipeline.schedule === 'Manual') return;

  activeJobs[pipeline.id] = cron.schedule(cronExpr, async () => {
    console.log(`Running scheduled pipeline: ${pipeline.name}`);
    await executePipeline(pipeline.id);
  });

  console.log(`Scheduled pipeline "${pipeline.name}" → ${pipeline.schedule}`);
}

/* ── Stop a pipeline job ────────────────────────────────────── */
function stopPipelineJob(pipelineId) {
  if (activeJobs[pipelineId]) {
    activeJobs[pipelineId].stop();
    delete activeJobs[pipelineId];
    console.log(`Stopped scheduled job for pipeline ${pipelineId}`);
  }
}

/* ── Load and schedule all active pipelines on startup ─────── */
async function initScheduler() {
  try {
    await ensurePipelineTables();
    const res = await pool.query(
      "SELECT * FROM pipelines WHERE schedule != 'Manual' AND status != 'paused'"
    );
    res.rows.forEach(p => schedulePipeline(p));
    console.log(`Scheduler initialized — ${res.rows.length} pipelines scheduled`);
  } catch (err) {
    console.error('Scheduler init error:', err.message);
  }
}

/* ── Ensure pipeline_logs table exists ──────────────────────── */
async function ensurePipelineTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pipeline_logs (
      id          SERIAL PRIMARY KEY,
      pipeline_id INT REFERENCES pipelines(id) ON DELETE CASCADE,
      message     TEXT,
      level       VARCHAR(20) DEFAULT 'info',
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE pipelines
    ADD COLUMN IF NOT EXISTS source_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS source_config JSONB,
    ADD COLUMN IF NOT EXISTS target_table VARCHAR(100),
    ADD COLUMN IF NOT EXISTS query TEXT,
    ADD COLUMN IF NOT EXISTS last_run TIMESTAMP,
    ADD COLUMN IF NOT EXISTS created_by INT
  `);
}

/* ── Add log entry ──────────────────────────────────────────── */
async function addLog(pipelineId, message, level = 'info') {
  try {
    await pool.query(
      'INSERT INTO pipeline_logs (pipeline_id, message, level) VALUES ($1, $2, $3)',
      [pipelineId, message, level]
    );
  } catch (err) {
    console.error('Log error:', err.message);
  }
}

/* ── Helper ─────────────────────────────────────────────────── */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  initScheduler,
  schedulePipeline,
  stopPipelineJob,
  executePipeline,
  addLog,
  SCHEDULES,
};
