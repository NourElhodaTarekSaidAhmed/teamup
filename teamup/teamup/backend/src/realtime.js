const cron = require('node-cron');
const { q } = require('./db');
const { verify } = require('./auth');

function setupSockets(io) {
  io.use((socket, next) => {
    try { socket.userId = verify(socket.handshake.auth.token).id; next(); }
    catch { next(new Error('unauthorized')); }
  });

  io.on('connection', socket => {
    socket.join('user:' + socket.userId);

    socket.on('project:join', async pid => {
      const ok = (await q('SELECT 1 FROM members WHERE project_id=$1 AND user_id=$2', [pid, socket.userId])).rowCount;
      if (ok) socket.join('project:' + pid);
    });

    socket.on('chat', async ({ projectId, body }) => {
      body = String(body || '').trim().slice(0, 2000);
      if (!body || !socket.rooms.has('project:' + projectId)) return;
      const { rows } = await q(
        `WITH m AS (INSERT INTO messages (project_id,user_id,body) VALUES ($1,$2,$3) RETURNING *)
         SELECT m.id,m.body,m.created_at,m.user_id,u.name FROM m JOIN users u ON u.id=m.user_id`,
        [projectId, socket.userId, body]);
      io.to('project:' + projectId).emit('chat', { projectId, ...rows[0] });
    });
  });
}

// Every 30 min: remind assignees about unfinished tasks due within 24 hours.
function setupCron(io) {
  cron.schedule('*/30 * * * *', async () => {
    const { rows } = await q(
      `UPDATE tasks t SET reminded = true
       FROM projects p
       WHERE p.id = t.project_id AND NOT t.reminded AND t.status <> 'done'
         AND t.assignee_id IS NOT NULL AND t.due_date <= CURRENT_DATE + 1
       RETURNING t.title, t.due_date, t.assignee_id, p.title AS project`);
    for (const t of rows) io.to('user:' + t.assignee_id).emit('reminder', t);
    if (rows.length) console.log(`sent ${rows.length} reminders`);
  });
}

module.exports = { setupSockets, setupCron };
