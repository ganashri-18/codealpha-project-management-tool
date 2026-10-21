require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database("data.sqlite");

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  owner_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY(project_id, user_id),
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_id INTEGER,
  due_date TEXT DEFAULT '',
  created_by INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(assignee_id) REFERENCES users(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(task_id) REFERENCES tasks(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET ||
    "local-development-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.use(express.static(path.join(__dirname, "public")));

const getUser = id =>
  db.prepare(
    "SELECT id, name, email FROM users WHERE id = ?"
  ).get(id);

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      error: "Please log in first."
    });
  }

  req.user = getUser(req.session.userId);

  if (!req.user) {
    return res.status(401).json({
      error: "Session expired. Please log in again."
    });
  }

  next();
}

function isMember(projectId, userId) {
  return !!db.prepare(`
    SELECT 1 FROM project_members
    WHERE project_id = ? AND user_id = ?
  `).get(projectId, userId);
}

function notify(userId, message) {
  if (userId) {
    db.prepare(`
      INSERT INTO notifications(user_id, message)
      VALUES (?, ?)
    `).run(userId, message);
  }
}

// REGISTER
app.post("/api/register", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "")
    .trim().toLowerCase();
  const password = String(req.body.password || "");

  if (
    name.length < 2 ||
    !email.includes("@") ||
    password.length < 6
  ) {
    return res.status(400).json({
      error: "Enter a name, valid email, and password with at least 6 characters."
    });
  }

  try {
    const result = db.prepare(`
      INSERT INTO users(name, email, password_hash)
      VALUES (?, ?, ?)
    `).run(
      name,
      email,
      bcrypt.hashSync(password, 10)
    );

    req.session.userId = Number(result.lastInsertRowid);

    res.json({
      user: getUser(req.session.userId)
    });
  } catch {
    res.status(409).json({
      error: "That email is already registered."
    });
  }
});

// LOGIN
app.post("/api/login", (req, res) => {
  const email = String(req.body.email || "")
    .trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = db.prepare(
    "SELECT * FROM users WHERE email = ?"
  ).get(email);

  if (
    !user ||
    !bcrypt.compareSync(password, user.password_hash)
  ) {
    return res.status(401).json({
      error: "Incorrect email or password."
    });
  }

  req.session.userId = user.id;

  res.json({
    user: getUser(user.id)
  });
});

// LOGOUT
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// CURRENT USER
app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }

  res.json({
    user: getUser(req.session.userId) || null
  });
});

// LIST PROJECTS
app.get("/api/projects", requireAuth, (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, u.name AS owner_name,
      (
        SELECT COUNT(*)
        FROM tasks t
        WHERE t.project_id = p.id
      ) AS task_count
    FROM projects p
    JOIN project_members pm
      ON pm.project_id = p.id
    JOIN users u
      ON u.id = p.owner_id
    WHERE pm.user_id = ?
    ORDER BY p.id DESC
  `).all(req.user.id);

  res.json({ projects });
});

// CREATE PROJECT
app.post("/api/projects", requireAuth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(
    req.body.description || ""
  ).trim();

  if (!name) {
    return res.status(400).json({
      error: "Project name is required."
    });
  }

  const create = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO projects(name, description, owner_id)
      VALUES (?, ?, ?)
    `).run(name, description, req.user.id);

    db.prepare(`
      INSERT INTO project_members(project_id, user_id)
      VALUES (?, ?)
    `).run(result.lastInsertRowid, req.user.id);

    return Number(result.lastInsertRowid);
  });

  const id = create();

  res.status(201).json({
    project: db.prepare(
      "SELECT * FROM projects WHERE id = ?"
    ).get(id)
  });
});

// LIST USERS
app.get("/api/users", requireAuth, (req, res) => {
  const users = db.prepare(`
    SELECT id, name, email
    FROM users
    ORDER BY name
  `).all();

  res.json({ users });
});

// LIST PROJECT MEMBERS
app.get(
  "/api/projects/:id/members",
  requireAuth,
  (req, res) => {
    const projectId = Number(req.params.id);

    if (!isMember(projectId, req.user.id)) {
      return res.status(403).json({
        error: "You are not a member of this project."
      });
    }

    const members = db.prepare(`
      SELECT u.id, u.name, u.email
      FROM users u
      JOIN project_members pm ON pm.user_id = u.id
      WHERE pm.project_id = ?
      ORDER BY u.name
    `).all(projectId);

    res.json({ members });
  }
);

// ADD PROJECT MEMBER
app.post(
  "/api/projects/:id/members",
  requireAuth,
  (req, res) => {
    const projectId = Number(req.params.id);
    const email = String(req.body.email || "")
      .trim().toLowerCase();

    const project = db.prepare(
      "SELECT * FROM projects WHERE id = ?"
    ).get(projectId);

    if (!project || project.owner_id !== req.user.id) {
      return res.status(403).json({
        error: "Only the project owner can add members."
      });
    }

    const user = db.prepare(
      "SELECT id FROM users WHERE email = ?"
    ).get(email);

    if (!user) {
      return res.status(404).json({
        error: "No registered user found with that email. Ask them to register first."
      });
    }

    db.prepare(`
      INSERT OR IGNORE INTO project_members(project_id, user_id)
      VALUES (?, ?)
    `).run(projectId, user.id);

    notify(
      user.id,
      `You were added to project "${project.name}".`
    );

    res.json({ ok: true });
  }
);

// LIST PROJECT TASKS
app.get(
  "/api/projects/:id/tasks",
  requireAuth,
  (req, res) => {
    const projectId = Number(req.params.id);

    if (!isMember(projectId, req.user.id)) {
      return res.status(403).json({
        error: "You are not a member of this project."
      });
    }

    const tasks = db.prepare(`
      SELECT t.*,
        u.name AS assignee_name,
        c.name AS creator_name,
        (
          SELECT COUNT(*)
          FROM comments cm
          WHERE cm.task_id = t.id
        ) AS comment_count
      FROM tasks t
      JOIN users c ON c.id = t.created_by
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.project_id = ?
      ORDER BY t.id DESC
    `).all(projectId);

    res.json({ tasks });
  }
);

// CREATE TASK
app.post(
  "/api/projects/:id/tasks",
  requireAuth,
  (req, res) => {
    const projectId = Number(req.params.id);

    if (!isMember(projectId, req.user.id)) {
      return res.status(403).json({
        error: "You are not a member of this project."
      });
    }

    const title = String(req.body.title || "").trim();
    const description = String(
      req.body.description || ""
    ).trim();

    const priority = [
      "low", "medium", "high"
    ].includes(req.body.priority)
      ? req.body.priority
      : "medium";

    const assigneeId = req.body.assignee_id
      ? Number(req.body.assignee_id)
      : null;

    const dueDate = String(req.body.due_date || "");

    if (!title) {
      return res.status(400).json({
        error: "Task title is required."
      });
    }

    if (
      assigneeId &&
      !isMember(projectId, assigneeId)
    ) {
      return res.status(400).json({
        error: "Assignee must be a member of this project."
      });
    }

    const result = db.prepare(`
      INSERT INTO tasks(
        project_id, title, description, priority,
        assignee_id, due_date, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      title,
      description,
      priority,
      assigneeId,
      dueDate,
      req.user.id
    );

    if (assigneeId && assigneeId !== req.user.id) {
      notify(
        assigneeId,
        `You were assigned task "${title}".`
      );
    }

    res.status(201).json({
      task: db.prepare(
        "SELECT * FROM tasks WHERE id = ?"
      ).get(result.lastInsertRowid)
    });
  }
);

// UPDATE TASK
app.patch("/api/tasks/:id", requireAuth, (req, res) => {
  const task = db.prepare(
    "SELECT * FROM tasks WHERE id = ?"
  ).get(Number(req.params.id));

  if (!task || !isMember(task.project_id, req.user.id)) {
    return res.status(404).json({
      error: "Task not found."
    });
  }

  const status = req.body.status;
  const priority = req.body.priority;

  if (
    status !== undefined &&
    !["todo", "doing", "done"].includes(status)
  ) {
    return res.status(400).json({
      error: "Invalid status."
    });
  }

  if (
    priority !== undefined &&
    !["low", "medium", "high"].includes(priority)
  ) {
    return res.status(400).json({
      error: "Invalid priority."
    });
  }

  const assigneeId = req.body.assignee_id === undefined
    ? task.assignee_id
    : (
        req.body.assignee_id
          ? Number(req.body.assignee_id)
          : null
      );

  if (
    assigneeId &&
    !isMember(task.project_id, assigneeId)
  ) {
    return res.status(400).json({
      error: "Assignee must be a project member."
    });
  }

  db.prepare(`
    UPDATE tasks
    SET status = ?, priority = ?, assignee_id = ?
    WHERE id = ?
  `).run(
    status || task.status,
    priority || task.priority,
    assigneeId,
    task.id
  );

  if (
    assigneeId &&
    assigneeId !== task.assignee_id
  ) {
    notify(
      assigneeId,
      `You were assigned task "${task.title}".`
    );
  }

  res.json({
    task: db.prepare(
      "SELECT * FROM tasks WHERE id = ?"
    ).get(task.id)
  });
});

// DELETE TASK
app.delete("/api/tasks/:id", requireAuth, (req, res) => {
  const task = db.prepare(
    "SELECT * FROM tasks WHERE id = ?"
  ).get(Number(req.params.id));

  if (!task || !isMember(task.project_id, req.user.id)) {
    return res.status(404).json({
      error: "Task not found."
    });
  }

  if (task.created_by !== req.user.id) {
    return res.status(403).json({
      error: "Only the task creator can delete this task."
    });
  }

  db.prepare(
    "DELETE FROM comments WHERE task_id = ?"
  ).run(task.id);

  db.prepare(
    "DELETE FROM tasks WHERE id = ?"
  ).run(task.id);

  res.json({ ok: true });
});

// GET COMMENTS
app.get(
  "/api/tasks/:id/comments",
  requireAuth,
  (req, res) => {
    const task = db.prepare(
      "SELECT * FROM tasks WHERE id = ?"
    ).get(Number(req.params.id));

    if (
      !task ||
      !isMember(task.project_id, req.user.id)
    ) {
      return res.status(404).json({
        error: "Task not found."
      });
    }

    const comments = db.prepare(`
      SELECT c.*, u.name AS user_name
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.task_id = ?
      ORDER BY c.id
    `).all(task.id);

    res.json({ comments });
  }
);

// ADD COMMENT
app.post(
  "/api/tasks/:id/comments",
  requireAuth,
  (req, res) => {
    const task = db.prepare(
      "SELECT * FROM tasks WHERE id = ?"
    ).get(Number(req.params.id));

    if (
      !task ||
      !isMember(task.project_id, req.user.id)
    ) {
      return res.status(404).json({
        error: "Task not found."
      });
    }

    const body = String(req.body.body || "").trim();

    if (!body) {
      return res.status(400).json({
        error: "Comment cannot be empty."
      });
    }

    db.prepare(`
      INSERT INTO comments(task_id, user_id, body)
      VALUES (?, ?, ?)
    `).run(task.id, req.user.id, body);

    const members = db.prepare(`
      SELECT user_id
      FROM project_members
      WHERE project_id = ? AND user_id <> ?
    `).all(task.project_id, req.user.id);

    members.forEach(member => {
      notify(
        member.user_id,
        `New comment on task "${task.title}".`
      );
    });

    res.status(201).json({ ok: true });
  }
);

// GET NOTIFICATIONS
app.get("/api/notifications", requireAuth, (req, res) => {
  const notifications = db.prepare(`
    SELECT *
    FROM notifications
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 30
  `).all(req.user.id);

  res.json({ notifications });
});

// MARK NOTIFICATIONS AS READ
app.post(
  "/api/notifications/read",
  requireAuth,
  (req, res) => {
    db.prepare(`
      UPDATE notifications
      SET read = 1
      WHERE user_id = ?
    `).run(req.user.id);

    res.json({ ok: true });
  }
);

// SERVE FRONTEND
app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(
    `Project tool running at http://localhost:${port}`
  );
});