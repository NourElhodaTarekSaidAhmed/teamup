const { Pool } = require('pg');
require('pg').types.setTypeParser(1082, v => v);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (text, params) => pool.query(text, params);

// Replace a user's/project's skills with the given names (creates unknown skills).
async function setSkills(table, col, id, names = []) {
  const clean = [...new Set(names.map(s => String(s).trim()).filter(Boolean))].slice(0, 30);
  await q(`DELETE FROM ${table} WHERE ${col} = $1`, [id]);
  for (const name of clean) {
    const { rows } = await q(
      `INSERT INTO skills (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name]);
    await q(`INSERT INTO ${table} (${col}, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, rows[0].id]);
  }
}

const PROJECT_SKILLS = `(SELECT COALESCE(json_agg(s.name ORDER BY s.name), '[]') FROM project_skills x
  JOIN skills s ON s.id = x.skill_id WHERE x.project_id = p.id) AS skills`;
const MEMBER_COUNT = `(SELECT COUNT(*) FROM members m WHERE m.project_id = p.id)::int AS member_count`;

module.exports = { q, pool, setSkills, PROJECT_SKILLS, MEMBER_COUNT };
