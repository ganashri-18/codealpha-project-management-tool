const $ = id => document.getElementById(id);

let currentUser = null;
let authMode = "login";
let projects = [];
let currentProject = null;
let currentTaskForComments = null;
let allUsers = [];

const statusLabels = {
  todo: "To do",
  doing: "In progress",
  done: "Completed"
};

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    el.classList.remove("show");
  }, 2800);
}

function showAuth() {
  $("authScreen").classList.remove("hidden");
  $("appScreen").classList.add("hidden");
}

function showApp() {
  $("authScreen").classList.add("hidden");
  $("appScreen").classList.remove("hidden");

  $("userName").textContent = currentUser.name;
  $("userEmail").textContent = currentUser.email;
  $("userAvatar").textContent =
    currentUser.name[0].toUpperCase();
}

function setAuthMode(mode) {
  authMode = mode;

  const registering = mode === "register";

  $("nameLabel").classList.toggle(
    "hidden",
    !registering
  );

  $("nameInput").required = registering;

  $("authSubmit").textContent = registering
    ? "Create account"
    : "Log in";

  $("loginTab").classList.toggle(
    "active",
    !registering
  );

  $("registerTab").classList.toggle(
    "active",
    registering
  );

  $("authMessage").textContent = "";
}

$("loginTab").onclick = () => setAuthMode("login");
$("registerTab").onclick = () => setAuthMode("register");

$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("authMessage").textContent = "";

  try {
    const data = await api(
      "/api/" +
        (authMode === "register" ? "register" : "login"),
      {
        method: "POST",
        body: JSON.stringify({
          name: $("nameInput").value,
          email: $("emailInput").value,
          password: $("passwordInput").value
        })
      }
    );

    currentUser = data.user;
    showApp();
    await loadProjects();
  } catch (err) {
    $("authMessage").textContent = err.message;
  }
});

$("logoutBtn").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST" });
    currentUser = null;
    currentProject = null;
    showAuth();
  } catch (err) {
    toast(err.message);
  }
};

function openProjectDialog() {
  $("projectForm").reset();
  $("projectDialog").showModal();
}

$("newProjectBtn").onclick =
  $("newProjectText").onclick =
  $("newProjectSmall").onclick = openProjectDialog;

document.querySelectorAll("[data-close]").forEach(button => {
  button.onclick = () => {
    $(button.dataset.close).close();
  };
});

// CREATE PROJECT
$("projectForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: $("projectName").value,
        description: $("projectDescription").value
      })
    });

    $("projectDialog").close();

    await loadProjects();

    toast("Project created!");
  } catch (err) {
    toast(err.message);
  }
});

// REFRESH
$("refreshBtn").onclick = () => {
  if (currentProject) {
    openProject(currentProject.id);
  } else {
    loadProjects();
  }
};

$("allProjectsBtn").onclick = () => showOverview();

// CREATE TASK
$("newTaskBtn").onclick = async () => {
  if (!currentProject) return;

  try {
    const data = await api(
      `/api/projects/${currentProject.id}/members`
    );

    allUsers = data.members;

    $("taskAssignee").innerHTML =
      '<option value="">Unassigned</option>' +
      allUsers.map(user =>
        `<option value="${user.id}">${esc(user.name)}</option>`
      ).join("");

    $("taskForm").reset();
    $("taskDialog").showModal();
  } catch (err) {
    toast(err.message);
  }
};

$("taskForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!currentProject) return;

  try {
    await api(
      `/api/projects/${currentProject.id}/tasks`,
      {
        method: "POST",
        body: JSON.stringify({
          title: $("taskTitle").value,
          description: $("taskDescription").value,
          priority: $("taskPriority").value,
          assignee_id: $("taskAssignee").value || null,
          due_date: $("taskDue").value
        })
      }
    );

    $("taskDialog").close();

    await openProject(currentProject.id);

    toast("Task added!");
  } catch (err) {
    toast(err.message);
  }
});

// ADD PROJECT MEMBER
$("inviteBtn").onclick = () => {
  $("memberForm").reset();
  $("memberDialog").showModal();
};

$("memberForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!currentProject) return;

  try {
    await api(
      `/api/projects/${currentProject.id}/members`,
      {
        method: "POST",
        body: JSON.stringify({
          email: $("memberEmail").value
        })
      }
    );

    $("memberDialog").close();

    toast("Member added to project.");

    await openProject(currentProject.id);
  } catch (err) {
    toast(err.message);
  }
});

// NOTIFICATIONS
$("notificationsBtn").onclick = loadNotifications;

$("markReadBtn").onclick = async () => {
  try {
    await api("/api/notifications/read", {
      method: "POST"
    });

    await loadNotifications();
  } catch (err) {
    toast(err.message);
  }
};

// LOAD PROJECTS
async function loadProjects() {
  try {
    const data = await api("/api/projects");

    projects = data.projects;

    renderProjectNav();
    showOverview();
  } catch (err) {
    if (err.message.includes("log in")) {
      showAuth();
    } else {
      toast(err.message);
    }
  }
}

// RENDER PROJECT NAVIGATION AND CARDS
function renderProjectNav() {
  $("projectNav").innerHTML = projects.map(project => `
    <button
      class="${
        currentProject &&
        currentProject.id === project.id
          ? "active"
          : ""
      }"
      data-project="${project.id}">
      <span class="project-dot"></span>
      <span>${esc(project.name)}</span>
    </button>
  `).join("");

  $("projectNav")
    .querySelectorAll("button")
    .forEach(button => {
      button.onclick = () =>
        openProject(Number(button.dataset.project));
    });

  $("projectGrid").innerHTML = projects.map(project => `
    <article class="project-card" data-project="${project.id}">
      <div class="project-card-top">
        <span class="project-symbol">▦</span>
        <span class="muted">↗</span>
      </div>

      <h3>${esc(project.name)}</h3>

      <p>${esc(
        project.description || "No description added yet."
      )}</p>

      <div class="project-meta">
        <span>▤ ${project.task_count} tasks</span>
        <span>Open board →</span>
      </div>
    </article>
  `).join("") ||
    '<div class="empty">No projects yet. Create your first project to get started.</div>';

  $("projectGrid")
    .querySelectorAll("[data-project]")
    .forEach(element => {
      element.onclick = () =>
        openProject(Number(element.dataset.project));
    });
}

// OVERVIEW
function showOverview() {
  $("overviewPanel").classList.remove("hidden");
  $("boardPanel").classList.add("hidden");
  $("notificationsPanel").classList.add("hidden");

  $("pageTitle").textContent = "All projects";
  $("pageEyebrow").textContent = "OVERVIEW";

  currentProject = null;

  renderProjectNav();

  $("statProjects").textContent = projects.length;

  $("statTasks").textContent = projects.reduce(
    (total, project) => total + Number(project.task_count),
    0
  );

  $("statDone").textContent = "—";
}

// OPEN A PROJECT BOARD
async function openProject(id) {
  try {
    const project = projects.find(p => p.id === id);

    if (!project) {
      throw new Error("Project not found.");
    }

    currentProject = project;

    $("overviewPanel").classList.add("hidden");
    $("notificationsPanel").classList.add("hidden");
    $("boardPanel").classList.remove("hidden");

    $("pageTitle").textContent = project.name;
    $("pageEyebrow").textContent = "PROJECT BOARD";

    $("boardDescription").textContent =
      project.description || "Keep your team moving forward.";

    renderProjectNav();

    const data = await api(`/api/projects/${id}/tasks`);

    renderBoard(data.tasks);
  } catch (err) {
    toast(err.message);
  }
}

// RENDER TASK COLUMNS
function renderBoard(tasks) {
  $("board").innerHTML = ["todo", "doing", "done"]
    .map(status => {
      const group = tasks.filter(
        task => task.status === status
      );

      return `
        <section class="board-column status-${status}">
          <div class="column-head">
            <span class="status-dot"></span>
            ${statusLabels[status]}
            <span class="column-count">${group.length}</span>
          </div>

          ${
            group.map(taskCard).join("") ||
            '<div class="empty">Nothing here yet</div>'
          }
        </section>
      `;
    }).join("");

  $("statTasks").textContent = tasks.length;

  $("statDone").textContent = tasks.filter(
    task => task.status === "done"
  ).length;

  // CHANGE TASK STATUS
  $("board")
    .querySelectorAll("[data-status-task]")
    .forEach(element => {
      element.onchange = async () => {
        try {
          await api(
            `/api/tasks/${element.dataset.statusTask}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                status: element.value
              })
            }
          );

          await openProject(currentProject.id);

          toast("Task status updated.");
        } catch (err) {
          toast(err.message);
        }
      };
    });

  // OPEN COMMENTS
  $("board")
    .querySelectorAll("[data-comment]")
    .forEach(button => {
      button.onclick = () =>
        openComments(
          Number(button.dataset.comment),
          button.dataset.title
        );
    });

  // DELETE TASK
  $("board")
    .querySelectorAll("[data-delete]")
    .forEach(button => {
      button.onclick = async () => {
        if (!confirm("Delete this task and its comments?")) {
          return;
        }

        try {
          await api(
            `/api/tasks/${button.dataset.delete}`,
            { method: "DELETE" }
          );

          await openProject(currentProject.id);

          toast("Task deleted.");
        } catch (err) {
          toast(err.message);
        }
      };
    });
}

// TASK CARD
function taskCard(task) {
  return `
    <article class="task-card">
      <div class="task-top">
        <span class="priority ${task.priority}">
          ${esc(
            task.priority[0].toUpperCase() +
            task.priority.slice(1)
          )} priority
        </span>

        <span class="muted">#${task.id}</span>
      </div>

      <h3>${esc(task.title)}</h3>

      ${
        task.description
          ? `<p>${esc(task.description)}</p>`
          : ""
      }

      <div class="task-controls">
        <select aria-label="Task status"
                data-status-task="${task.id}">
          ${Object.entries(statusLabels).map(([key, label]) => `
            <option value="${key}"
              ${task.status === key ? "selected" : ""}>
              ${label}
            </option>
          `).join("")}
        </select>

        <button class="comment-btn"
          data-comment="${task.id}"
          data-title="${esc(task.title)}">
          ☷ ${task.comment_count || 0}
        </button>

        <button class="delete-btn"
          data-delete="${task.id}"
          title="Delete task">×</button>
      </div>

      <div class="task-foot">
        <span>${
          task.due_date
            ? "Due " + esc(task.due_date)
            : "Created by " + esc(task.creator_name || "team")
        }</span>

        <span class="assignee">
          ${esc(task.assignee_name || "Unassigned")}
        </span>
      </div>
    </article>
  `;
}

// OPEN TASK COMMENTS
async function openComments(taskId, title) {
  currentTaskForComments = taskId;

  $("commentsTitle").textContent = title;

  $("commentsList").innerHTML =
    '<p class="muted">Loading comments…</p>';

  $("commentForm").reset();
  $("commentsDialog").showModal();

  await refreshComments();
}

// LOAD COMMENTS
async function refreshComments() {
  try {
    const data = await api(
      `/api/tasks/${currentTaskForComments}/comments`
    );

    $("commentsList").innerHTML = data.comments.map(comment => `
      <div class="comment">
        <b>${esc(comment.user_name)}</b>
        <small>${esc(comment.created_at)}</small>
        <p>${esc(comment.body)}</p>
      </div>
    `).join("") ||
      '<div class="empty">No comments yet. Start the conversation.</div>';
  } catch (err) {
    toast(err.message);
  }
}

// POST COMMENT
$("commentForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    await api(
      `/api/tasks/${currentTaskForComments}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          body: $("commentBody").value
        })
      }
    );

    $("commentForm").reset();

    await refreshComments();

    if (currentProject) {
      await openProject(currentProject.id);
    }

    toast("Comment posted.");
  } catch (err) {
    toast(err.message);
  }
});

// LOAD NOTIFICATIONS
async function loadNotifications() {
  try {
    const data = await api("/api/notifications");

    $("overviewPanel").classList.add("hidden");
    $("boardPanel").classList.add("hidden");
    $("notificationsPanel").classList.remove("hidden");

    $("pageTitle").textContent = "Notifications";
    $("pageEyebrow").textContent = "ACTIVITY";

    const unreadCount = data.notifications.filter(
      notification => !notification.read
    ).length;

    $("notificationCount").textContent = unreadCount || "";

    $("notificationList").innerHTML =
      data.notifications.map(notification => `
        <article class="notification ${
          notification.read ? "" : "unread"
        }">
          <span class="project-symbol">♧</span>
          <div>
            <p>${esc(notification.message)}</p>
            <small>${esc(notification.created_at)}</small>
          </div>
        </article>
      `).join("") ||
      '<div class="empty">You are all caught up. Notifications will appear here.</div>';
  } catch (err) {
    toast(err.message);
  }
}

// INITIALIZE APPLICATION
async function boot() {
  try {
    const data = await api("/api/me");

    if (data.user) {
      currentUser = data.user;

      showApp();

      await loadProjects();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
}

boot();