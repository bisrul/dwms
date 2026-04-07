-- ============================================
-- DWMS Database Schema
-- Run this file to create all tables
-- psql -U postgres -d dwms -f schema.sql
-- ============================================

-- Users table (for login/signup)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(200) UNIQUE NOT NULL,
  password      VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  DEFAULT 'Viewer',
  organization  VARCHAR(200),
  created_at    TIMESTAMP    DEFAULT NOW()
);

-- Pipelines table
CREATE TABLE IF NOT EXISTS pipelines (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  source      VARCHAR(100) NOT NULL,
  schedule    VARCHAR(100) DEFAULT 'Manual',
  status      VARCHAR(50)  DEFAULT 'idle',
  progress    INT          DEFAULT 0,
  records     VARCHAR(50)  DEFAULT '0',
  last_run    TIMESTAMP,
  created_at  TIMESTAMP    DEFAULT NOW()
);

-- Saved queries table
CREATE TABLE IF NOT EXISTS saved_queries (
  id          SERIAL PRIMARY KEY,
  user_id     INT          REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  sql         TEXT         NOT NULL,
  created_at  TIMESTAMP    DEFAULT NOW()
);

-- ============================================
-- Star Schema tables (Data Warehouse)
-- ============================================

CREATE TABLE IF NOT EXISTS dim_date (
  date_id     INT PRIMARY KEY,
  full_date   DATE NOT NULL,
  year        INT  NOT NULL,
  quarter     INT  CHECK (quarter BETWEEN 1 AND 4),
  month       INT  CHECK (month BETWEEN 1 AND 12),
  week        INT
);

CREATE TABLE IF NOT EXISTS dim_product (
  product_id    SERIAL PRIMARY KEY,
  product_name  VARCHAR(200) NOT NULL,
  category      VARCHAR(100),
  brand         VARCHAR(100),
  unit_price    DECIMAL(10,2)
);

CREATE TABLE IF NOT EXISTS dim_customer (
  customer_id   SERIAL PRIMARY KEY,
  full_name     VARCHAR(200) NOT NULL,
  email         VARCHAR(200) UNIQUE,
  segment       VARCHAR(50),
  joined_date   DATE
);

CREATE TABLE IF NOT EXISTS dim_region (
  region_id   SERIAL PRIMARY KEY,
  city        VARCHAR(100),
  province    VARCHAR(100),
  country     VARCHAR(100) NOT NULL,
  timezone    VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS fact_sales (
  sale_id      BIGSERIAL    PRIMARY KEY,
  date_id      INT          REFERENCES dim_date(date_id),
  product_id   INT          REFERENCES dim_product(product_id),
  customer_id  INT          REFERENCES dim_customer(customer_id),
  region_id    INT          REFERENCES dim_region(region_id),
  quantity     INT          NOT NULL,
  revenue      DECIMAL(12,2) NOT NULL,
  discount     DECIMAL(5,2)  DEFAULT 0.00
);

-- ============================================
-- Sample data (for testing)
-- ============================================

INSERT INTO users (first_name, last_name, email, password, role, organization)
VALUES ('Admin', 'User', 'admin@dwms.com',
  '$2b$10$examplehashedpassword', 'Admin', 'DWMS Corp')
ON CONFLICT (email) DO NOTHING;

INSERT INTO pipelines (name, source, schedule, status, progress, records) VALUES
  ('Sales ETL',      'PostgreSQL', 'Every 30 min',  'active', 0, '1.2M'),
  ('CRM Sync',       'REST API',   'Every 1 hour',  'active', 0, '340K'),
  ('Analytics DW',   'BigQuery',   'Every 6 hours', 'idle',   0, '2.1M'),
  ('Inventory',      'CSV Upload', 'Manual',        'idle',   0, '88K'),
  ('Logs ETL',       'S3 Bucket',  'Every 1 hour',  'error',  0, '560K')
ON CONFLICT DO NOTHING;

SELECT 'Database setup complete!' AS status;
