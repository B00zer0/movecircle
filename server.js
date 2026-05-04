const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { createClient } = require("@libsql/client");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const localDbPath = path.join(root, "movecircle.db");
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";
const USE_TURSO = Boolean(TURSO_DATABASE_URL && TURSO_AUTH_TOKEN);

const AI_MODE = String(process.env.AI_MODE || "local").toLowerCase();
const LM_STUDIO_BASE = process.env.LM_STUDIO_BASE || "http://127.0.0.1:1234/v1";
const LM_STUDIO_CHAT = `${LM_STUDIO_BASE}/chat/completions`;
const DEFAULT_MODEL = process.env.LM_STUDIO_MODEL || "google/gemma-4-e4b";
const DEFAULT_ADMIN_USERNAME = normalizeHandle(process.env.ADMIN_USERNAME || "b00zer");
const DEFAULT_ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || "");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const modelCache = {
  expiresAt: 0,
  value: { reachable: false, model: DEFAULT_MODEL, models: [] }
};

const db = createDbAdapter();
const dbReady = initializeDatabase();

const server = http.createServer(async (req, res) => {
  try {
    await dbReady;
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    serveStatic(res, pathname);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, { error: error.message || "Internal server error." });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`MoveCircle running on http://127.0.0.1:${port}`);
});

function createDbAdapter() {
  if (USE_TURSO) {
    const client = createClient({
      url: TURSO_DATABASE_URL,
      authToken: TURSO_AUTH_TOKEN
    });

    return {
      kind: "remote",
      async exec(sql) {
        for (const statement of splitStatements(sql)) {
          if (!statement) continue;
          await client.execute(statement);
        }
      },
      prepare(sql) {
        return {
          async run(...args) {
            const result = await client.execute({ sql, args });
            return {
              rowsAffected: result.rowsAffected || 0,
              changes: result.rowsAffected || 0,
              lastInsertRowid: result.lastInsertRowid
            };
          },
          async get(...args) {
            const result = await client.execute({ sql, args });
            return result.rows[0] || null;
          },
          async all(...args) {
            const result = await client.execute({ sql, args });
            return result.rows || [];
          }
        };
      }
    };
  }

  const sqlite = new DatabaseSync(localDbPath);
  return {
    kind: "local",
    async exec(sql) {
      sqlite.exec(sql);
    },
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        async run(...args) {
          const result = stmt.run(...args);
          return {
            rowsAffected: result.changes || 0,
            changes: result.changes || 0,
            lastInsertRowid: result.lastInsertRowid
          };
        },
        async get(...args) {
          return stmt.get(...args);
        },
        async all(...args) {
          return stmt.all(...args);
        }
      };
    }
  };
}

function splitStatements(sql) {
  return String(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true, aiMode: AI_MODE, storage: USE_TURSO ? "turso" : "sqlite-local" });
    return;
  }

  if (pathname === "/api/auth/register" && req.method === "POST") {
    const body = await readJson(req);
    sendJson(res, 201, { token: await registerUser(body) });
    return;
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readJson(req);
    sendJson(res, 200, { token: await loginUser(body) });
    return;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const session = await requireSession(req);
    await db.prepare("DELETE FROM sessions WHERE token = ?").run(session.token);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/bootstrap" && req.method === "GET") {
    const session = await requireSession(req);
    sendJson(res, 200, await getBootstrapPayload(session.user.id));
    return;
  }

  if (pathname === "/api/profile" && req.method === "PATCH") {
    const session = await requireSession(req);
    const body = await readJson(req);
    await updateProfile(session.user.id, body);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/assistant/chat" && req.method === "POST") {
    const session = await requireSession(req);
    const body = await readJson(req);
    await askAssistant(session.user.id, body.message);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/teams" && req.method === "POST") {
    const session = await requireSession(req);
    const body = await readJson(req);
    await createTeam(session.user.id, body);
    sendJson(res, 201, { ok: true });
    return;
  }

  if (pathname === "/api/search" && req.method === "GET") {
    const session = await requireSession(req);
    const query = String(url.searchParams.get("q") || "");
    sendJson(res, 200, { results: await searchUsers(session.user.id, query) });
    return;
  }

  if (pathname === "/api/friends/requests" && req.method === "GET") {
    const session = await requireSession(req);
    sendJson(res, 200, await listFriendRequests(session.user.id));
    return;
  }

  if (pathname === "/api/friends/requests" && req.method === "POST") {
    const session = await requireSession(req);
    const body = await readJson(req);
    await sendFriendRequest(session.user.id, Number(body.recipientId));
    sendJson(res, 201, { ok: true });
    return;
  }

  const requestMatch = pathname.match(/^\/api\/friends\/requests\/(\d+)\/(accept|decline)$/);
  if (requestMatch && req.method === "POST") {
    const session = await requireSession(req);
    const requestId = Number(requestMatch[1]);
    const action = requestMatch[2];
    if (action === "accept") await acceptFriendRequest(session.user.id, requestId);
    if (action === "decline") await declineFriendRequest(session.user.id, requestId);
    sendJson(res, 200, { ok: true });
    return;
  }

  const friendMatch = pathname.match(/^\/api\/friends\/(\d+)$/);
  if (friendMatch && req.method === "POST") {
    const session = await requireSession(req);
    await createOrAcceptFriendship(session.user.id, Number(friendMatch[1]));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (friendMatch && req.method === "DELETE") {
    const session = await requireSession(req);
    await removeFriendship(session.user.id, Number(friendMatch[1]));
    sendJson(res, 200, { ok: true });
    return;
  }

  const messageMatch = pathname.match(/^\/api\/messages\/(\d+)$/);
  if (messageMatch) {
    const session = await requireSession(req);
    const friendId = Number(messageMatch[1]);
    if (req.method === "GET") {
      sendJson(res, 200, { messages: await getMessages(session.user.id, friendId) });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      await createMessage(session.user.id, friendId, body.body);
      sendJson(res, 201, { ok: true });
      return;
    }
  }

  const joinTeamMatch = pathname.match(/^\/api\/teams\/(\d+)\/join$/);
  if (joinTeamMatch && req.method === "POST") {
    const session = await requireSession(req);
    await addUserToTeam(Number(joinTeamMatch[1]), session.user.id, "member");
    sendJson(res, 200, { ok: true });
    return;
  }

  const teamMemberMatch = pathname.match(/^\/api\/teams\/(\d+)\/members$/);
  if (teamMemberMatch && req.method === "POST") {
    const session = await requireSession(req);
    const body = await readJson(req);
    await addFriendToTeam(Number(teamMemberMatch[1]), session.user.id, Number(body.friendId));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/integrations/xiaomi/push" && req.method === "POST") {
    const body = await readJson(req);
    await pushExternalMetrics(body);
    sendJson(res, 200, { ok: true });
    return;
  }

  const adminBanMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
  if (adminBanMatch && req.method === "POST") {
    const session = await requireSession(req);
    await ensureAdmin(session.user.id);
    await banUser(Number(adminBanMatch[1]));
    sendJson(res, 200, { ok: true });
    return;
  }

  const adminUserDeleteMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (adminUserDeleteMatch && req.method === "DELETE") {
    const session = await requireSession(req);
    await ensureAdmin(session.user.id);
    await deleteUser(Number(adminUserDeleteMatch[1]));
    sendJson(res, 200, { ok: true });
    return;
  }

  const adminTeamDeleteMatch = pathname.match(/^\/api\/admin\/teams\/(\d+)$/);
  if (adminTeamDeleteMatch && req.method === "DELETE") {
    const session = await requireSession(req);
    await ensureAdmin(session.user.id);
    await deleteTeam(Number(adminTeamDeleteMatch[1]));
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

async function initializeDatabase() {
  const schema = fs.readFileSync(path.join(root, "sql", "schema.sql"), "utf8");
  await db.exec(schema);
  await ensureColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("users", "banned_at", "TEXT");
  await ensureAdminSeed();
  if (db.kind !== "remote") {
    await purgeDemoData();
  }
}

async function purgeDemoData() {
  if (db.kind === "remote") return;

  const demoIds = (await db
    .prepare(
      `SELECT id FROM users
       WHERE email LIKE '%@movecircle.local'
          OR email LIKE '%@local.dev'
          OR email LIKE '%@example.com'
          OR username LIKE 'artur_%'
          OR username LIKE 'usera_%'
          OR username LIKE 'userb_%'
          OR username LIKE 'artur_test%'
          OR name IN ('User A', 'User B', 'Artur QA', 'User QA')
          OR username IN ('lena', 'max', 'ira', 'nikita')`
    )
    .all())
    .map((row) => row.id);

  for (const userId of demoIds) {
    await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }
}

async function getBootstrapPayload(userId) {
  const me = await getMe(userId);
  const friends = await listFriends(userId);
  const requests = await listFriendRequests(userId);
  const teams = await listTeams(userId);
  const leaderboard = await listLeaderboard();
  const challenge = buildChallenge(teams, leaderboard);
  const assistant = await getAssistantMeta(userId);
  const admin = (await isAdminUser(userId))
    ? { users: await listAdminUsers(), clubs: await listAdminTeams() }
    : null;

  return {
    me,
    friends,
    requests,
    teams,
    leaderboard,
    challenge,
    assistant,
    admin,
    stats: {
      friendCount: friends.length,
      requestCount: requests.incoming.length,
      teamCount: teams.filter((team) => team.isMember).length,
      rank: Math.max(1, leaderboard.findIndex((entry) => entry.id === userId) + 1)
    }
  };
}

async function registerUser(body) {
  const name = normalizeText(body.name);
  const username = normalizeHandle(body.username);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");

  if (name.length < 2 || username.length < 3 || password.length < 6 || !email.includes("@")) {
    throw new HttpError(400, "Check the registration fields.");
  }

  const existing = await db.prepare("SELECT id FROM users WHERE username = ? OR email = ?").get(username, email);
  if (existing) {
    throw new HttpError(409, "User already exists.");
  }

  const passwordHash = hashPassword(password);
  const isAdmin = username === DEFAULT_ADMIN_USERNAME || (DEFAULT_ADMIN_EMAIL && email === DEFAULT_ADMIN_EMAIL);
  const userId = (
    await db
    .prepare("INSERT INTO users (name, username, email, password_hash, bio, is_admin) VALUES (?, ?, ?, ?, ?, ?)")
    .run(name, username, email, passwordHash, "Sports lover", isAdmin ? 1 : 0)
  ).lastInsertRowid;

  await ensureMetricRow(Number(userId));
  await ensureSyncKey(Number(userId));
  return createSession(Number(userId));
}

async function loginUser(body) {
  const login = normalizeText(body.emailOrUsername).toLowerCase();
  const password = String(body.password || "");
  const user = await db
    .prepare("SELECT * FROM users WHERE email = ? OR username = ?")
    .get(login, login.replaceAll(" ", ""));

  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, "Invalid credentials.");
  }
  if (user.banned_at) {
    throw new HttpError(403, "Account is banned.");
  }

  return createSession(user.id);
}

async function getMe(userId) {
  const user = await db.prepare("SELECT id, name, username, bio, is_admin, banned_at FROM users WHERE id = ?").get(userId);
  const metrics = await getMetrics(userId);
  const syncRow = await db.prepare("SELECT sync_key FROM sync_keys WHERE user_id = ?").get(userId);
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    bio: user.bio,
    isAdmin: Boolean(user.is_admin),
    bannedAt: user.banned_at,
    steps: metrics.steps,
    calories: metrics.calories,
    goal: metrics.goal,
    updatedAt: metrics.updated_at,
    syncKey: syncRow?.sync_key || null
  };
}

async function searchUsers(userId, query) {
  const q = normalizeText(query).toLowerCase();
  if (!q) return [];

  const friendIds = new Set(await getFriendIds(userId));
  const requestMap = await getRequestMap(userId);

  const rows = await db
    .prepare(
      `SELECT id, name, username, bio
       FROM users
       WHERE id != ?
         AND (LOWER(name) LIKE ? OR LOWER(username) LIKE ?)
       ORDER BY username ASC
       LIMIT 12`
    )
    .all(userId, `%${q}%`, `%${q}%`);

  return rows.map((row) => ({
      ...row,
      relation: friendIds.has(row.id)
        ? "friend"
        : requestMap.outgoing.has(row.id)
          ? "outgoing"
          : requestMap.incoming.has(row.id)
            ? "incoming"
            : "none"
    }));
}

async function listFriendRequests(userId) {
  const incoming = await db
    .prepare(
      `SELECT fr.id, fr.sender_id, u.name, u.username, u.bio
       FROM friend_requests fr
       JOIN users u ON u.id = fr.sender_id
       WHERE fr.recipient_id = ? AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`
    )
    .all(userId);

  const outgoing = await db
    .prepare(
      `SELECT fr.id, fr.recipient_id, u.name, u.username, u.bio
       FROM friend_requests fr
       JOIN users u ON u.id = fr.recipient_id
       WHERE fr.sender_id = ? AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`
    )
    .all(userId);

  return { incoming, outgoing };
}

async function sendFriendRequest(senderId, recipientId) {
  if (!recipientId || senderId === recipientId) {
    throw new HttpError(400, "Invalid recipient.");
  }

  if (await isFriend(senderId, recipientId)) {
    return;
  }

  const target = await db.prepare("SELECT id FROM users WHERE id = ?").get(recipientId);
  if (!target) {
    throw new HttpError(404, "User not found.");
  }

  const reverse = await db
    .prepare("SELECT id FROM friend_requests WHERE sender_id = ? AND recipient_id = ? AND status = 'pending'")
    .get(recipientId, senderId);
  if (reverse) {
    await createFriendship(senderId, recipientId);
    const direct = await db
      .prepare("SELECT id FROM friend_requests WHERE sender_id = ? AND recipient_id = ? AND status = 'pending'")
      .get(senderId, recipientId);
    await db.prepare("DELETE FROM friend_requests WHERE id = ? OR id = ?").run(reverse.id, direct?.id || -1);
    return;
  }

  await db.prepare("INSERT OR IGNORE INTO friend_requests (sender_id, recipient_id, status) VALUES (?, ?, 'pending')").run(
    senderId,
    recipientId
  );
}

async function acceptFriendRequest(userId, requestId) {
  const request = await db
    .prepare("SELECT * FROM friend_requests WHERE id = ? AND recipient_id = ? AND status = 'pending'")
    .get(requestId, userId);
  if (!request) {
    throw new HttpError(404, "Request not found.");
  }

  await createFriendship(request.sender_id, request.recipient_id);
  await db.prepare("DELETE FROM friend_requests WHERE id = ?").run(requestId);
}

async function declineFriendRequest(userId, requestId) {
  const request = await db
    .prepare("SELECT * FROM friend_requests WHERE id = ? AND recipient_id = ? AND status = 'pending'")
    .get(requestId, userId);
  if (!request) {
    throw new HttpError(404, "Request not found.");
  }

  await db.prepare("DELETE FROM friend_requests WHERE id = ?").run(requestId);
}

async function createOrAcceptFriendship(userId, otherUserId) {
  if (await isFriend(userId, otherUserId)) return;
  const incoming = await db
    .prepare("SELECT id, sender_id FROM friend_requests WHERE sender_id = ? AND recipient_id = ? AND status = 'pending'")
    .get(otherUserId, userId);
  if (incoming) {
    await acceptFriendRequest(userId, incoming.id);
    return;
  }
  await sendFriendRequest(userId, otherUserId);
}

async function createFriendship(a, b) {
  const [userLow, userHigh] = a < b ? [a, b] : [b, a];
  await db.prepare("INSERT OR IGNORE INTO friendships (user_low, user_high) VALUES (?, ?)").run(userLow, userHigh);
}

async function listFriends(userId) {
  return Promise.all((await getFriendIds(userId)).map(async (friendId) => {
    const user = await db.prepare("SELECT id, name, username, bio FROM users WHERE id = ?").get(friendId);
    const metrics = await getMetrics(friendId);
    const lastMessage = await db
      .prepare(
        `SELECT body FROM direct_messages
         WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
         ORDER BY id DESC LIMIT 1`
      )
      .get(userId, friendId, friendId, userId);

    return {
      id: user.id,
      name: user.name,
      username: user.username,
      bio: user.bio,
      steps: metrics.steps,
      calories: metrics.calories,
      lastMessage: lastMessage?.body || ""
    };
  }));
}

async function removeFriendship(userId, otherUserId) {
  const [userLow, userHigh] = userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
  await db.prepare("DELETE FROM friendships WHERE user_low = ? AND user_high = ?").run(userLow, userHigh);
  await db.prepare(
    "DELETE FROM friend_requests WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)"
  ).run(userId, otherUserId, otherUserId, userId);
}

async function listTeams(userId) {
  const teams = await db
    .prepare("SELECT t.*, u.name AS owner_name FROM teams t JOIN users u ON u.id = t.owner_id ORDER BY t.id DESC")
    .all();

  return Promise.all(teams.map(async (team) => {
      const memberRows = await db
        .prepare(
          `SELECT u.id, u.name, u.username
           FROM team_members tm
           JOIN users u ON u.id = tm.user_id
           WHERE tm.team_id = ?
           ORDER BY tm.joined_at ASC`
        )
        .all(team.id);

      const members = await Promise.all(memberRows.map(async (member) => {
        const metricsRow = await db.prepare("SELECT steps, calories FROM user_metrics WHERE user_id = ?").get(member.id);
        return {
          id: member.id,
          name: member.name,
          username: member.username,
          steps: metricsRow?.steps || 0,
          calories: metricsRow?.calories || 0
        };
      }));

      const totals = members.reduce(
        (acc, member) => {
          acc.steps += member.steps;
          acc.calories += member.calories;
          return acc;
        },
        { steps: 0, calories: 0 }
      );

      return {
        id: team.id,
        name: team.name,
        description: team.description,
        ownerName: team.owner_name,
        isMember: members.some((member) => member.id === userId),
        memberCount: members.length,
        totalSteps: totals.steps,
        totalCalories: totals.calories,
        members
      };
    }));
}

async function listLeaderboard() {
  return await db
    .prepare(
      `SELECT u.id, u.name, u.username, m.steps, m.calories
       FROM users u
       JOIN user_metrics m ON m.user_id = u.id
       GROUP BY u.id
       ORDER BY m.steps DESC, m.calories DESC
       LIMIT 20`
    )
    .all();
}

function buildChallenge(teams, leaderboard) {
  const myTeam = teams.find((team) => team.isMember);
  if (myTeam) {
    const target = Math.max(4000, myTeam.memberCount * 1200);
    const progress = Math.min(100, Math.round((myTeam.totalCalories / target) * 100));
    return {
      title: `${myTeam.name} · командный челлендж`,
      progress,
      copy: `${formatNumber(myTeam.totalCalories)} из ${formatNumber(target)} ккал`
    };
  }

  const topFive = leaderboard.slice(0, 5).reduce((sum, entry) => sum + entry.steps, 0);
  const target = 50000;
  return {
    title: "Открытая лига",
    progress: Math.min(100, Math.round((topFive / target) * 100)),
    copy: `${formatNumber(topFive)} из ${formatNumber(target)} шагов`
  };
}

async function getAssistantMeta(userId) {
  const rows = await db
    .prepare("SELECT role, body FROM assistant_messages WHERE user_id = ? ORDER BY id ASC LIMIT 12")
    .all(userId);
  const history = rows.map((row) => ({ role: row.role, content: row.body }));

  const status = await getModelStatus();
  return {
    connected: status.reachable,
    history,
    note: status.disabled ? "disabled" : status.reachable ? "ready" : "offline"
  };
}

async function askAssistant(userId, message) {
  const cleaned = normalizeText(message);
  if (!cleaned) {
    throw new HttpError(400, "Empty message.");
  }

  const status = await getModelStatus(true);
  if (!status.reachable) {
    throw new HttpError(503, status.disabled ? "Coach is disabled on this server." : "Local coach is unavailable.");
  }

  const me = await getMe(userId);
  const friends = (await listFriends(userId)).slice(0, 4);
  const teams = (await listTeams(userId)).filter((team) => team.isMember).slice(0, 3);
  const history = (await db
    .prepare("SELECT role, body FROM assistant_messages WHERE user_id = ? ORDER BY id DESC LIMIT 8")
    .all(userId)).reverse();

  const context = [
    {
      role: "system",
      content: [
        "Ты дружелюбный спортивный ассистент MoveCircle.",
        "Отвечай коротко, понятно и без технических деталей.",
        `Пользователь ${me.name} (${me.username}), ${me.steps} шагов, ${me.calories} ккал, цель ${me.goal}.`,
        `Друзья: ${friends.map((friend) => `${friend.name} (${friend.steps})`).join(", ") || "нет"}.`,
        `Команды: ${teams.map((team) => team.name).join(", ") || "нет"}.`
      ].join(" ")
    },
    ...history.map((item) => ({ role: item.role, content: item.body })),
    { role: "user", content: cleaned }
  ];

  const response = await fetch(LM_STUDIO_CHAT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: status.model, temperature: 0.6, messages: context })
  });

  const payload = await response.json();
  const answer = payload?.choices?.[0]?.message?.content?.trim();
  if (!response.ok || !answer) {
    throw new HttpError(503, "Local coach returned an error.");
  }

  await db.prepare("INSERT INTO assistant_messages (user_id, role, body) VALUES (?, 'user', ?)").run(userId, cleaned);
  await db.prepare("INSERT INTO assistant_messages (user_id, role, body) VALUES (?, 'assistant', ?)").run(userId, answer);
  return answer;
}

async function updateProfile(userId, body) {
  const bio = normalizeText(body.bio || "").slice(0, 220);
  const goal = clamp(Number(body.goal || 10000), 4000, 25000);
  const metrics = await getMetrics(userId);

  const steps = body.steps !== undefined ? clamp(Number(body.steps), 0, 500000) : metrics.steps;
  const calories = body.calories !== undefined ? clamp(Number(body.calories), 0, 50000) : metrics.calories;

  await db.prepare("UPDATE users SET bio = ? WHERE id = ?").run(bio, userId);
  await db.prepare(
    `UPDATE user_metrics
     SET goal = ?, steps = ?, calories = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`
  ).run(goal, steps, calories, userId);
}

async function createTeam(ownerId, body) {
  const name = normalizeText(body.name);
  const description = normalizeText(body.description);
  if (name.length < 3 || description.length < 6) {
    throw new HttpError(400, "Invalid team data.");
  }

  const teamId = (
    await db
    .prepare("INSERT INTO teams (name, description, owner_id) VALUES (?, ?, ?)")
    .run(name, description, ownerId)
  ).lastInsertRowid;
  await addUserToTeam(Number(teamId), ownerId, "captain");
}

async function addUserToTeam(teamId, userId, role) {
  const team = await db.prepare("SELECT id FROM teams WHERE id = ?").get(teamId);
  if (!team) throw new HttpError(404, "Team not found.");
  await db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)").run(teamId, userId, role);
}

async function addFriendToTeam(teamId, ownerId, friendId) {
  if (!(await isFriend(ownerId, friendId))) {
    throw new HttpError(400, "Only friends can be added.");
  }

  if (!(await isTeamMember(teamId, ownerId))) {
    throw new HttpError(400, "Join the team first.");
  }

  await addUserToTeam(teamId, friendId, "member");
}

async function banUser(userId) {
  const user = await db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) throw new HttpError(404, "User not found.");
  await db.prepare("UPDATE users SET banned_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId);
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

async function deleteUser(userId) {
  const user = await db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) throw new HttpError(404, "User not found.");
  await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

async function deleteTeam(teamId) {
  const team = await db.prepare("SELECT id FROM teams WHERE id = ?").get(teamId);
  if (!team) throw new HttpError(404, "Team not found.");
  await db.prepare("DELETE FROM teams WHERE id = ?").run(teamId);
}

async function createMessage(senderId, recipientId, body) {
  const message = normalizeText(body);
  if (!message) throw new HttpError(400, "Empty message.");
  if (!(await isFriend(senderId, recipientId))) throw new HttpError(403, "Add this user as a friend first.");

  await db.prepare("INSERT INTO direct_messages (sender_id, recipient_id, body) VALUES (?, ?, ?)").run(senderId, recipientId, message);
}

async function getMessages(userId, friendId) {
  if (!(await isFriend(userId, friendId))) return [];
  return (await db
    .prepare(
      `SELECT id, sender_id, recipient_id, body, created_at
       FROM direct_messages
       WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
       ORDER BY id ASC`
    )
    .all(userId, friendId, friendId, userId))
    .map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      isMine: row.sender_id === userId
    }));
}

async function pushExternalMetrics(body) {
  const syncKey = normalizeText(body.syncKey);
  const steps = clamp(Number(body.steps || 0), 0, 500000);
  const calories = clamp(Number(body.calories || 0), 0, 50000);

  const row = await db.prepare("SELECT user_id FROM sync_keys WHERE sync_key = ?").get(syncKey);
  if (!row) throw new HttpError(401, "Invalid sync key.");

  await ensureMetricRow(row.user_id);
  await db.prepare(
    `UPDATE user_metrics
     SET steps = ?, calories = ?, source_type = ?, source_status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`
  ).run(steps, calories, body.source || "bridge", "synced", row.user_id);
}

async function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  await db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, userId);
  return token;
}

async function requireSession(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new HttpError(401, "Unauthorized.");

  const session = await db
    .prepare(
      `SELECT s.token, u.id, u.name, u.username, u.email, u.banned_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);

  if (!session) throw new HttpError(401, "Session expired.");
  if (session.banned_at) {
    await db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    throw new HttpError(403, "Account is banned.");
  }

  return {
    token: session.token,
    user: {
      id: session.id,
      name: session.name,
      username: session.username,
      email: session.email,
      banned_at: session.banned_at
    }
  };
}

async function ensureColumn(table, column, definition) {
  const exists = await db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
  if (!exists) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function ensureAdminSeed() {
  const adminEmail = DEFAULT_ADMIN_EMAIL || "__no_admin__";
  const admin = await db
    .prepare("SELECT id FROM users WHERE username = ? OR (email = ? AND email != '')")
    .get(DEFAULT_ADMIN_USERNAME, adminEmail);
  if (admin && admin.id != null) {
    const userId = Number(admin.id);
    if (Number.isFinite(userId)) {
      await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(userId);
    }
  }
}

async function isAdminUser(userId) {
  const row = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  return Boolean(row?.is_admin);
}

async function ensureAdmin(userId) {
  if (!(await isAdminUser(userId))) {
    throw new HttpError(403, "Admin only.");
  }
}

async function listAdminUsers() {
  return await db
    .prepare(
      `SELECT u.id, u.name, u.username, u.email, u.bio, u.is_admin, u.banned_at, u.created_at,
              COALESCE(m.steps, 0) AS steps,
              COALESCE(m.calories, 0) AS calories
       FROM users u
       LEFT JOIN user_metrics m ON m.user_id = u.id
       ORDER BY u.created_at DESC`
    )
    .all();
}

async function listAdminTeams() {
  return await db
    .prepare(
      `SELECT t.id, t.name, t.description, t.owner_id, u.username AS owner_username,
              COUNT(tm.id) AS member_count
       FROM teams t
       JOIN users u ON u.id = t.owner_id
       LEFT JOIN team_members tm ON tm.team_id = t.id
       GROUP BY t.id
       ORDER BY t.created_at DESC`
    )
    .all();
}

async function getModelStatus(force = false) {
  if (AI_MODE === "disabled") {
    return {
      reachable: false,
      model: DEFAULT_MODEL,
      models: [],
      disabled: true
    };
  }

  const now = Date.now();
  if (!force && modelCache.expiresAt > now) return modelCache.value;

  try {
    const response = await fetch(`${LM_STUDIO_BASE}/models`);
    const payload = await response.json();
    const models = (payload.data || []).map((model) => model.id);
    modelCache.value = {
      reachable: response.ok && models.length > 0,
      model: models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : models[0] || DEFAULT_MODEL,
      models
    };
  } catch {
    modelCache.value = { reachable: false, model: DEFAULT_MODEL, models: [] };
  }

  modelCache.expiresAt = Date.now() + 15000;
  return modelCache.value;
}

async function getMetrics(userId) {
  await ensureMetricRow(userId);
  return await db.prepare("SELECT * FROM user_metrics WHERE user_id = ?").get(userId);
}

async function ensureMetricRow(userId) {
  await db.prepare(
    `INSERT OR IGNORE INTO user_metrics (user_id, steps, calories, goal, source_type, source_status)
     VALUES (?, 0, 0, 10000, 'manual', 'ready')`
  ).run(userId);
}

async function ensureSyncKey(userId) {
  const existing = await db.prepare("SELECT sync_key FROM sync_keys WHERE user_id = ?").get(userId);
  if (existing) return;
  const key = crypto.randomBytes(16).toString("hex");
  await db.prepare("INSERT OR IGNORE INTO sync_keys (sync_key, user_id) VALUES (?, ?)").run(key, userId);
}

async function getFriendIds(userId) {
  return (await db
    .prepare(
      `SELECT CASE WHEN user_low = ? THEN user_high ELSE user_low END AS friend_id
       FROM friendships
       WHERE user_low = ? OR user_high = ?`
    )
    .all(userId, userId, userId)
    .map((row) => row.friend_id));
}

async function getRequestMap(userId) {
  const incoming = new Set(
    (await db.prepare("SELECT sender_id AS id FROM friend_requests WHERE recipient_id = ? AND status = 'pending'").all(userId)).map((row) => row.id)
  );
  const outgoing = new Set(
    (await db.prepare("SELECT recipient_id AS id FROM friend_requests WHERE sender_id = ? AND status = 'pending'").all(userId)).map((row) => row.id)
  );
  return { incoming, outgoing };
}

async function isFriend(a, b) {
  const [low, high] = a < b ? [a, b] : [b, a];
  return Boolean(await db.prepare("SELECT id FROM friendships WHERE user_low = ? AND user_high = ?").get(low, high));
}

async function isTeamMember(teamId, userId) {
  return Boolean(await db.prepare("SELECT id FROM team_members WHERE team_id = ? AND user_id = ?").get(teamId, userId));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeHandle(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, "");
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = String(stored).split(":");
  if (!salt || !originalHash) return false;
  const currentHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(originalHash, "hex"), Buffer.from(currentHash, "hex"));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(path.join(root, requested));

  if (!safePath.startsWith(root)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  fs.readFile(safePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }

    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(safePath)] || "text/plain; charset=utf-8" });
    res.end(data);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
