const express = require('express');
const multer  = require('multer');
const csv     = require('csv-parser');
const fs      = require('fs');
const path    = require('path');
const pool    = require('../models/db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

/* ─── Multer config ─────────────────────────────────────────── */
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.json') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and JSON files are allowed'));
    }
  }
});

/* ─── Helper: parse CSV ─────────────────────────────────────── */
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', row => rows.push(row))
      .on('end',  ()  => resolve(rows))
      .on('error', err => reject(err));
  });
}

/* ─── Helper: parse JSON ────────────────────────────────────── */
function parseJSON(filePath) {
  return new Promise((resolve, reject) => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed  = JSON.parse(content);
      const rows    = Array.isArray(parsed) ? parsed : [parsed];
      resolve(rows);
    } catch (err) {
      reject(new Error('Invalid JSON file'));
    }
  });
}

/* ─── Helper: clean column names ───────────────────────────── */
function cleanColumnName(col) {
  return col
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^[0-9]/, 'col_$&');
}

/* ─── Helper: detect data type ─────────────────────────────── */
function detectType(value) {
  if (value === null || value === undefined || value === '') return 'TEXT';
  if (!isNaN(Number(value)) && value !== '') {
    return String(value).includes('.') ? 'DECIMAL' : 'INTEGER';
  }
  if (!isNaN(Date.parse(value)) && value.length > 4) return 'TIMESTAMP';
  return 'TEXT';
}

/* ─────────────────────────────────────────────────────────────
   POST /api/etl/preview
   Upload file and return preview (first 10 rows + columns)
───────────────────────────────────────────────────────────── */
router.post('/preview', authenticateToken, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const filePath = req.file.path;
  const fileExt  = path.extname(req.file.originalname).toLowerCase();

  try {
    let rows = [];
    if (fileExt === '.csv') {
      rows = await parseCSV(filePath);
    } else if (fileExt === '.json') {
      rows = await parseJSON(filePath);
    }

    if (!rows.length) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'File is empty or has no data.' });
    }

    // Detect columns and types from first row
    const columns = Object.keys(rows[0]).map(col => ({
      original: col,
      clean:    cleanColumnName(col),
      type:     detectType(rows[0][col]),
      sample:   rows[0][col],
    }));

    // Return preview (first 10 rows)
    const preview = rows.slice(0, 10).map(row => {
      const cleaned = {};
      Object.keys(row).forEach(k => {
        cleaned[cleanColumnName(k)] = row[k];
      });
      return cleaned;
    });

    // Get existing tables from database
    const tablesResult = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const existingTables = tablesResult.rows.map(r => r.table_name);

    res.json({
      fileName:       req.file.originalname,
      fileId:         req.file.filename,
      totalRows:      rows.length,
      columns,
      preview,
      existingTables,
    });

  } catch (err) {
    fs.unlinkSync(filePath);
    console.error('Preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/etl/import
   Import data into existing OR new table
───────────────────────────────────────────────────────────── */
router.post('/import', authenticateToken, async (req, res) => {
  const { fileId, fileName, targetTable, createNew, columnMapping } = req.body;

  if (!fileId || !targetTable) {
    return res.status(400).json({ error: 'fileId and targetTable are required.' });
  }

  const filePath = path.join('uploads', fileId);
  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'File not found. Please upload again.' });
  }

  const fileExt = path.extname(fileName).toLowerCase();

  try {
    // Parse file again
    let rows = [];
    if (fileExt === '.csv') {
      rows = await parseCSV(filePath);
    } else {
      rows = await parseJSON(filePath);
    }

    // Clean column names
    const cleanedRows = rows.map(row => {
      const cleaned = {};
      Object.keys(row).forEach(k => {
        const cleanKey = columnMapping?.[k] || cleanColumnName(k);
        cleaned[cleanKey] = row[k] === '' ? null : row[k];
      });
      return cleaned;
    });

    const columns = Object.keys(cleanedRows[0]);

    // Create new table if needed
    if (createNew) {
      const firstRow = cleanedRows[0];
      const colDefs  = columns.map(col => {
        const type = detectType(firstRow[col]);
        return `"${col}" ${type}`;
      }).join(', ');

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "${targetTable}" (
          id SERIAL PRIMARY KEY,
          ${colDefs},
          imported_at TIMESTAMP DEFAULT NOW()
        )
      `);
    }

    // Insert rows in batches of 100
    let inserted = 0;
    let failed   = 0;
    const batchSize = 100;

    for (let i = 0; i < cleanedRows.length; i += batchSize) {
      const batch = cleanedRows.slice(i, i + batchSize);

      for (const row of batch) {
        try {
          const keys   = columns.map(c => `"${c}"`).join(', ');
          const values = columns.map((_, idx) => `$${idx + 1}`).join(', ');
          const vals   = columns.map(c => row[c]);

          await pool.query(
            `INSERT INTO "${targetTable}" (${keys}) VALUES (${values})`,
            vals
          );
          inserted++;
        } catch (rowErr) {
          failed++;
        }
      }
    }

    // Cleanup uploaded file
    fs.unlinkSync(filePath);

    // Log to pipelines table
    await pool.query(`
      INSERT INTO pipelines (name, source, schedule, status, progress, records, last_run)
      VALUES ($1, $2, 'Manual', 'success', 100, $3, NOW())
      ON CONFLICT DO NOTHING
    `, [
      `ETL: ${fileName} → ${targetTable}`,
      fileExt === '.csv' ? 'CSV Upload' : 'JSON Upload',
      `${inserted}`,
    ]);

    res.json({
      success:    true,
      inserted,
      failed,
      totalRows:  cleanedRows.length,
      targetTable,
      message:    `Successfully imported ${inserted} rows into "${targetTable}"${failed > 0 ? `. ${failed} rows failed.` : '.'}`,
    });

  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/etl/tables
   Get all tables with row counts
───────────────────────────────────────────────────────────── */
router.get('/tables', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.table_name,
        (SELECT COUNT(*) FROM information_schema.columns c
         WHERE c.table_name = t.table_name
           AND c.table_schema = 'public') AS column_count
      FROM information_schema.tables t
      WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tables.' });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/etl/history
   Get ETL import history from pipelines
───────────────────────────────────────────────────────────── */
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM pipelines
      WHERE source IN ('CSV Upload', 'JSON Upload')
      ORDER BY last_run DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history.' });
  }
});

module.exports = router;
