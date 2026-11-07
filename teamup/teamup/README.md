# Teamup

Helps students find project teammates by skills and interests.

## Run
    docker compose up --build
Open http://localhost (MinIO console: http://localhost:9001).
Set real secrets first (`JWT_SECRET`, `DB_PASSWORD`, `MINIO_PASSWORD`) in a `.env` file next to docker-compose.yml.

## Stack
- PostgreSQL: users, skills, projects, members, join requests, messages, tasks (db/init.sql)
- Node.js + Express API (backend/src)
- Socket.IO: team chat and live notifications (backend/src/realtime.js)
- MinIO: project images and files, streamed through /api/files/:key
- node-cron: every 30 min, reminds assignees of tasks due within 24h
- Nginx: serves frontend/, proxies /api and /socket.io
