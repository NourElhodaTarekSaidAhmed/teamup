CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  major TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE skills (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE user_skills (
  user_id INT REFERENCES users ON DELETE CASCADE,
  skill_id INT REFERENCES skills ON DELETE CASCADE,
  PRIMARY KEY (user_id, skill_id)
);
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  owner_id INT REFERENCES users ON DELETE CASCADE,
  title TEXT NOT NULL,
  course TEXT DEFAULT '',
  description TEXT DEFAULT '',
  team_size INT DEFAULT 4,
  deadline DATE,
  image_key TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE project_skills (
  project_id INT REFERENCES projects ON DELETE CASCADE,
  skill_id INT REFERENCES skills ON DELETE CASCADE,
  PRIMARY KEY (project_id, skill_id)
);
CREATE TABLE members (
  project_id INT REFERENCES projects ON DELETE CASCADE,
  user_id INT REFERENCES users ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE join_requests (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects ON DELETE CASCADE,
  user_id INT REFERENCES users ON DELETE CASCADE,
  message TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects ON DELETE CASCADE,
  user_id INT REFERENCES users ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee_id INT REFERENCES users ON DELETE SET NULL,
  status TEXT DEFAULT 'todo',
  due_date DATE,
  reminded BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE project_files (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  uploaded_by INT REFERENCES users,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON messages (project_id, id);
CREATE INDEX ON tasks (due_date) WHERE NOT reminded;
