'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });


async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}


async function initDB() {

  await query(`
    CREATE TABLE IF NOT EXISTS apps (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      path          TEXT NOT NULL,
      port          INTEGER NOT NULL UNIQUE,
      package_manager TEXT NOT NULL DEFAULT 'npm',
      db_type       TEXT,
      db_name       TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const seedEmails = [
    'jose.hernandez@safe-demo.con',
    'jose.hernandez@safe-demo.com',
  ];
  const seedPassword = 'Johervaz0799!';
  const hash = await bcrypt.hash(seedPassword, 12);

  for (const email of seedEmails) {
    const existing = await query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (existing.rows.length === 0) {
      await query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [email, hash]);
      console.log('  [DB] Usuario inicial creado:', email);
    } else {
      await query('UPDATE users SET password_hash = $1 WHERE LOWER(email) = LOWER($2)', [hash, email]);
    }
  }
}



async function getApps() {
  const res = await query(`
    SELECT id, name, path, port, package_manager AS "packageManager",
           db_type AS "dbType", db_name AS "dbName"
    FROM apps ORDER BY created_at ASC
  `);
  return res.rows.map(rowToApp);
}

async function upsertApp(app) {
  await query(`
    INSERT INTO apps (id, name, path, port, package_manager, db_type, db_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE SET
      name            = EXCLUDED.name,
      path            = EXCLUDED.path,
      port            = EXCLUDED.port,
      package_manager = EXCLUDED.package_manager,
      db_type         = EXCLUDED.db_type,
      db_name         = EXCLUDED.db_name
  `, [app.id, app.name, app.path, app.port, app.packageManager,
  app.database?.type ?? null, app.database?.name ?? null]);
}

async function updateAppDetails(id, { name, path, port, packageManager }) {
  await query(`
    UPDATE apps
    SET name = COALESCE($1, name),
        path = COALESCE($2, path),
        port = COALESCE($3, port),
        package_manager = COALESCE($4, package_manager)
    WHERE id = $5
  `, [name, path, port, packageManager, id]);
}

async function updateAppDB(id, dbType, dbName) {
  await query(
    'UPDATE apps SET db_type = $1, db_name = $2 WHERE id = $3',
    [dbType, dbName, id]
  );
}

async function deleteApp(id) {
  await query('DELETE FROM apps WHERE id = $1', [id]);
}

async function portExists(port, excludeId = null) {
  const res = excludeId
    ? await query('SELECT 1 FROM apps WHERE port = $1 AND id != $2', [port, excludeId])
    : await query('SELECT 1 FROM apps WHERE port = $1', [port]);
  return res.rows.length > 0;
}

async function idExists(id) {
  const res = await query('SELECT 1 FROM apps WHERE id = $1', [id]);
  return res.rows.length > 0;
}

function rowToApp(row) {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    port: row.port,
    packageManager: row.packageManager,
    database: {
      type: row.dbType || 'Unknown',
      name: row.dbName || 'No detectada',
    },
  };
}


async function getUserByEmail(email) {
  const clean = (email || '').trim().toLowerCase();
  const res = await query('SELECT id, email, password_hash FROM users WHERE LOWER(TRIM(email)) = $1', [clean]);
  return res.rows[0] || null;
}

async function verifyPassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

module.exports = {
  query,
  initDB,
  getApps,
  upsertApp,
  updateAppDetails,
  updateAppDB,
  deleteApp,
  portExists,
  idExists,
  getUserByEmail,
  verifyPassword,
};
