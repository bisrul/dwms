const express = require('express');
const pool = require('../models/db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// GET /api/schema/tables — list all tables and their columns
router.get('/tables', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        CASE WHEN kcu.column_name IS NOT NULL THEN 'PK' ELSE '' END AS key_type
      FROM information_schema.tables t
      JOIN information_schema.columns c
        ON t.table_name = c.table_name
      LEFT JOIN information_schema.key_column_usage kcu
        ON c.table_name = kcu.table_name
        AND c.column_name = kcu.column_name
      WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name, c.ordinal_position
    `);

    const tables = {};
    result.rows.forEach(row => {
      if (!tables[row.table_name]) {
        tables[row.table_name] = { name: row.table_name, columns: [] };
      }
      tables[row.table_name].columns.push({
        name:     row.column_name,
        type:     row.data_type,
        nullable: row.is_nullable === 'YES',
        key:      row.key_type,
      });
    });

    res.json(Object.values(tables));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch schema.' });
  }
});

module.exports = router;
