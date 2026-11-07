const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { q, setSkills, PROJECT_SKILLS, MEMBER_COUNT } = require('./db');
const { sign, requireAuth } = require('./auth');
const storage = require('./storage');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong.' });
});
const fail = (status, message) => Object.assign(new Error(message), { status });

const isMember = async (pid, uid) =>
  (await q('SELECT 1 FROM members WHERE project_id=$1 AND user_id=$2', [pid, uid])).rowCount > 0;
const mustBeMember = async (pid, uid) => { if (!(await isMember(pid, uid))) throw fail(403, 'Only team members can do that.'); };

const userSkills = id => q(
  `SELECT COALESCE(json_agg(s.name ORDER BY s.name), '[]') AS skills FROM user_skills u
   JOIN skills s ON s.id = u.skill_id WHERE u.user_id = $1`, [id]).then(r => r.rows[0].skills);

module.exports = io => {
  const r = express.Router();

  // ---------- auth ----------
  r.post('/auth/register', wrap(async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 6) throw fail(400, 'Enter a name, email and a password of 6+ characters.');
    const hash = await bcrypt.hash(password, 10);
    try {
      const { rows } = await q('INSERT INTO users (name,email,password_hash) VALUES ($1,lower($2),$3) RETURNING id,name,email',
        [name, email, hash]);
      res.json({ token: sign(rows[0]), user: rows[0] });
    } catch (e) { throw e.code === '23505' ? fail(409, 'That email already has an account.') : e; }
  }));

  r.post('/auth/login', wrap(async (req, res) => {
    const { rows } = await q('SELECT * FROM users WHERE email = lower($1)', [req.body.email || '']);
    if (!rows[0] || !(await bcrypt.compare(req.body.password || '', rows[0].password_hash)))
      throw fail(401, 'Email or password is incorrect.');
    res.json({ token: sign(rows[0]), user: { id: rows[0].id, name: rows[0].name, email: rows[0].email } });
  }));

  r.get('/files/:key', wrap(async (req, res) => storage.stream(req.params.key, res)));
  r.use(requireAuth);

  // ---------- profile ----------
  r.get('/me', wrap(async (req, res) => {
    const { rows } = await q('SELECT id,name,email,major,bio FROM users WHERE id=$1', [req.userId]);
    res.json({ ...rows[0], skills: await userSkills(req.userId) });
  }));

  r.put('/me', wrap(async (req, res) => {
    const { name, major, bio, skills } = req.body;
    await q('UPDATE users SET name=COALESCE(NULLIF($1,\'\'),name), major=$2, bio=$3 WHERE id=$4',
      [name, major || '', bio || '', req.userId]);
    await setSkills('user_skills', 'user_id', req.userId, skills);
    res.json({ ok: true });
  }));

  // ---------- projects ----------
  r.get('/projects', wrap(async (req, res) => {
    const { q: text = '', skill = '' } = req.query;
    const { rows } = await q(
      `SELECT p.*, u.name AS owner_name, ${PROJECT_SKILLS}, ${MEMBER_COUNT}
       FROM projects p JOIN users u ON u.id = p.owner_id
       WHERE p.status='open'
         AND ($1 = '' OR p.title ILIKE '%'||$1||'%' OR p.course ILIKE '%'||$1||'%' OR p.description ILIKE '%'||$1||'%')
         AND ($2 = '' OR EXISTS (SELECT 1 FROM project_skills x JOIN skills s ON s.id=x.skill_id
                                 WHERE x.project_id=p.id AND s.name ILIKE $2))
       ORDER BY p.created_at DESC LIMIT 60`, [text, skill]);
    res.json(rows);
  }));

  r.post('/projects', upload.single('image'), wrap(async (req, res) => {
    const { title, course, description, team_size, deadline } = req.body;
    if (!title) throw fail(400, 'Give your project a title.');
    const image_key = req.file ? await storage.put(req.file) : null;
    const { rows } = await q(
      `INSERT INTO projects (owner_id,title,course,description,team_size,deadline,image_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.userId, title, course || '', description || '', parseInt(team_size) || 4, deadline || null, image_key]);
    const id = rows[0].id;
    await q("INSERT INTO members (project_id,user_id,role) VALUES ($1,$2,'owner')", [id, req.userId]);
    await setSkills('project_skills', 'project_id', id, (req.body.skills || '').split(','));
    res.json({ id });
  }));

  r.get('/projects/:id', wrap(async (req, res) => {
    const id = +req.params.id;
    const { rows } = await q(
      `SELECT p.*, u.name AS owner_name, ${PROJECT_SKILLS}, ${MEMBER_COUNT}
       FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=$1`, [id]);
    if (!rows[0]) throw fail(404, 'Project not found.');
    const member = await isMember(id, req.userId);
    const out = { ...rows[0], is_member: member };
    out.members = (await q(
      `SELECT u.id,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1`, [id])).rows;
    if (!member) {
      out.my_request = (await q('SELECT status FROM join_requests WHERE project_id=$1 AND user_id=$2', [id, req.userId])).rows[0]?.status || null;
      return res.json(out);
    }
    out.tasks = (await q(
      `SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
       WHERE t.project_id=$1 ORDER BY t.id`, [id])).rows;
    out.messages = (await q(
      `SELECT * FROM (SELECT m.id,m.body,m.created_at,m.user_id,u.name FROM messages m JOIN users u ON u.id=m.user_id
       WHERE m.project_id=$1 ORDER BY m.id DESC LIMIT 100) x ORDER BY id`, [id])).rows;
    out.files = (await q('SELECT id,key,name FROM project_files WHERE project_id=$1 ORDER BY id DESC', [id])).rows;
    res.json(out);
  }));

  // ---------- matching ----------
  r.get('/matches', wrap(async (req, res) => {
    const { rows } = await q(
      `SELECT p.*, u.name AS owner_name, ${PROJECT_SKILLS}, ${MEMBER_COUNT},
         (SELECT COALESCE(json_agg(s.name), '[]') FROM project_skills x JOIN skills s ON s.id=x.skill_id
            JOIN user_skills us ON us.skill_id=x.skill_id AND us.user_id=$1 WHERE x.project_id=p.id) AS matched_skills,
         ROUND(100.0 * COUNT(us.skill_id) / COUNT(ps.skill_id))::int AS score
       FROM projects p
       JOIN users u ON u.id = p.owner_id
       JOIN project_skills ps ON ps.project_id = p.id
       LEFT JOIN user_skills us ON us.skill_id = ps.skill_id AND us.user_id = $1
       WHERE p.status='open' AND p.owner_id <> $1
         AND NOT EXISTS (SELECT 1 FROM members m WHERE m.project_id=p.id AND m.user_id=$1)
       GROUP BY p.id, u.name HAVING COUNT(us.skill_id) > 0
       ORDER BY score DESC, p.created_at DESC LIMIT 30`, [req.userId]);
    res.json(rows);
  }));

  // ---------- join requests ----------
  r.post('/projects/:id/join', wrap(async (req, res) => {
    const id = +req.params.id;
    const p = (await q('SELECT owner_id,title,status FROM projects WHERE id=$1', [id])).rows[0];
    if (!p || p.status !== 'open') throw fail(400, 'This project is not accepting members.');
    if (await isMember(id, req.userId)) throw fail(400, 'You are already on this team.');
    await q(`INSERT INTO join_requests (project_id,user_id,message) VALUES ($1,$2,$3)
             ON CONFLICT (project_id,user_id) DO UPDATE SET status='pending', message=EXCLUDED.message`,
      [id, req.userId, req.body.message || '']);
    io.to('user:' + p.owner_id).emit('request:new', { project: p.title });
    res.json({ ok: true });
  }));

  r.get('/requests/incoming', wrap(async (req, res) => {
    const { rows } = await q(
      `SELECT jr.id, jr.message, jr.created_at, p.id AS project_id, p.title, u.id AS user_id, u.name, u.major,
         (SELECT COALESCE(json_agg(s.name), '[]') FROM user_skills us JOIN skills s ON s.id=us.skill_id WHERE us.user_id=u.id) AS skills
       FROM join_requests jr JOIN projects p ON p.id=jr.project_id JOIN users u ON u.id=jr.user_id
       WHERE p.owner_id=$1 AND jr.status='pending' ORDER BY jr.created_at`, [req.userId]);
    res.json(rows);
  }));

  r.post('/requests/:id/:decision(accept|reject)', wrap(async (req, res) => {
    const jr = (await q(
      `SELECT jr.*, p.owner_id, p.team_size FROM join_requests jr JOIN projects p ON p.id=jr.project_id WHERE jr.id=$1`,
      [req.params.id])).rows[0];
    if (!jr || jr.owner_id !== req.userId) throw fail(403, 'Only the project owner can answer requests.');
    const accept = req.params.decision === 'accept';
    await q('UPDATE join_requests SET status=$1 WHERE id=$2', [accept ? 'accepted' : 'rejected', jr.id]);
    if (accept) {
      await q("INSERT INTO members (project_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [jr.project_id, jr.user_id]);
      const n = (await q('SELECT COUNT(*)::int AS n FROM members WHERE project_id=$1', [jr.project_id])).rows[0].n;
      if (n >= jr.team_size) await q("UPDATE projects SET status='full' WHERE id=$1", [jr.project_id]);
    }
    io.to('user:' + jr.user_id).emit('request:update', { project_id: jr.project_id, accepted: accept });
    res.json({ ok: true });
  }));

  r.get('/my/projects', wrap(async (req, res) => {
    const { rows } = await q(
      `SELECT p.*, m.role, ${PROJECT_SKILLS}, ${MEMBER_COUNT},
         (SELECT COUNT(*) FILTER (WHERE status='done') || '/' || COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS progress
       FROM members m JOIN projects p ON p.id=m.project_id WHERE m.user_id=$1 ORDER BY p.created_at DESC`, [req.userId]);
    res.json(rows);
  }));

  // ---------- tasks ----------
  r.post('/projects/:id/tasks', wrap(async (req, res) => {
    const id = +req.params.id;
    await mustBeMember(id, req.userId);
    if (!req.body.title) throw fail(400, 'Name the task.');
    await q('INSERT INTO tasks (project_id,title,assignee_id,due_date) VALUES ($1,$2,$3,$4)',
      [id, req.body.title, req.body.assignee_id || null, req.body.due_date || null]);
    io.to('project:' + id).emit('tasks:changed');
    res.json({ ok: true });
  }));

  r.patch('/tasks/:id', wrap(async (req, res) => {
    const t = (await q('SELECT project_id FROM tasks WHERE id=$1', [req.params.id])).rows[0];
    if (!t) throw fail(404, 'Task not found.');
    await mustBeMember(t.project_id, req.userId);
    const { status, assignee_id } = req.body;
    await q(`UPDATE tasks SET status=COALESCE($1,status),
             assignee_id = CASE WHEN $3 THEN $2 ELSE assignee_id END WHERE id=$4`,
      [status || null, assignee_id || null, 'assignee_id' in req.body, req.params.id]);
    io.to('project:' + t.project_id).emit('tasks:changed');
    res.json({ ok: true });
  }));

  // ---------- files ----------
  r.post('/projects/:id/files', upload.single('file'), wrap(async (req, res) => {
    const id = +req.params.id;
    await mustBeMember(id, req.userId);
    if (!req.file) throw fail(400, 'Choose a file to upload.');
    const key = await storage.put(req.file);
    await q('INSERT INTO project_files (project_id,key,name,uploaded_by) VALUES ($1,$2,$3,$4)',
      [id, key, req.file.originalname, req.userId]);
    io.to('project:' + id).emit('files:changed');
    res.json({ ok: true });
  }));

  return r;
};
