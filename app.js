const TOKEN_KEY = "movecircle-token";
const API_BASE_KEY = "movecircle-api-base";
const THEME_KEY = "movecircle-theme";

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  apiBase: localStorage.getItem(API_BASE_KEY) || "",
  theme: localStorage.getItem(THEME_KEY) || "light",
  data: null,
  activeTab: "home",
  selectedChat: { type: null, id: null },
  searchResults: [],
  messages: {},
  authMode: "login"
};

const refs = {
  authView: document.getElementById("authView"),
  appView: document.getElementById("appView"),
  deviceFrame: document.querySelector(".device-frame"),
  toast: document.getElementById("toast"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  apiBaseInput: document.getElementById("apiBaseInput"),
  authToggleButtons: document.querySelectorAll(".auth-toggle-button"),
  navButtons: document.querySelectorAll(".nav-item"),
  panels: document.querySelectorAll(".tab-panel"),
  bottomNav: document.querySelector(".bottom-nav"),
  headerGreeting: document.getElementById("headerGreeting"),
  themeToggleButton: document.getElementById("themeToggleButton"),
  chatThemeToggleButton: document.getElementById("chatThemeToggleButton"),
  heroSteps: document.getElementById("heroSteps"),
  heroCalories: document.getElementById("heroCalories"),
  goalRing: document.getElementById("goalRing"),
  goalPercent: document.getElementById("goalPercent"),
  dashboardStats: document.getElementById("dashboardStats"),
  feedCards: document.getElementById("feedCards"),
  friendSearchInput: document.getElementById("friendSearchInput"),
  friendRequests: document.getElementById("friendRequests"),
  friendSearchResults: document.getElementById("friendSearchResults"),
  friendList: document.getElementById("friendList"),
  chatList: document.getElementById("chatList"),
  chatBackButton: document.getElementById("chatBackButton"),
  chatAvatar: document.getElementById("chatAvatar"),
  chatTypeLabel: document.getElementById("chatTypeLabel"),
  chatTitle: document.getElementById("chatTitle"),
  chatSubtitle: document.getElementById("chatSubtitle"),
  messageList: document.getElementById("messageList"),
  messageForm: document.getElementById("messageForm"),
  messageInput: document.getElementById("messageInput"),
  createTeamForm: document.getElementById("createTeamForm"),
  memberTeams: document.getElementById("memberTeams"),
  teamDirectory: document.getElementById("teamDirectory"),
  leaderboardList: document.getElementById("leaderboardList"),
  adminUsersList: document.getElementById("adminUsersList"),
  adminClubsList: document.getElementById("adminClubsList"),
  adminNavButton: document.getElementById("adminNavButton"),
  challengeTitle: document.getElementById("challengeTitle"),
  challengePercentBadge: document.getElementById("challengePercentBadge"),
  challengeFill: document.getElementById("challengeFill"),
  challengeCopy: document.getElementById("challengeCopy"),
  profileAvatar: document.getElementById("profileAvatar"),
  profileName: document.getElementById("profileName"),
  profileHandle: document.getElementById("profileHandle"),
  profileForm: document.getElementById("profileForm"),
  bioInput: document.getElementById("bioInput"),
  goalInput: document.getElementById("goalInput"),
  goalLabel: document.getElementById("goalLabel"),
  stepsInput: document.getElementById("stepsInput"),
  caloriesInput: document.getElementById("caloriesInput"),
  syncKeyDisplay: document.getElementById("syncKeyDisplay"),
  topbar: document.getElementById("topbar"),
  logoutButton: document.getElementById("logoutButton")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  applyTheme();
  updateAuthMode();

  if (state.token) {
    await bootstrapApp();
  } else {
    renderShell();
  }
}

function bindEvents() {
  refs.authToggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.authMode = button.dataset.authMode;
      updateAuthMode();
    });
  });

  refs.loginForm.addEventListener("submit", handleLogin);
  refs.registerForm.addEventListener("submit", handleRegister);
  refs.apiBaseInput?.addEventListener("change", handleApiBaseChange);
  refs.themeToggleButton?.addEventListener("click", toggleTheme);
  refs.chatThemeToggleButton?.addEventListener("click", toggleTheme);
  refs.chatBackButton?.addEventListener("click", () => setTab("chats"));
  refs.navButtons.forEach((button) => button.addEventListener("click", () => setTab(button.dataset.target)));
  refs.friendSearchInput.addEventListener("input", debounce(handleSearchInput, 250));
  refs.friendRequests.addEventListener("click", handleRequestsClick);
  refs.friendSearchResults.addEventListener("click", handleSearchResultsClick);
  refs.friendList.addEventListener("click", handleFriendListClick);
  refs.chatList.addEventListener("click", handleChatListClick);
  refs.messageForm.addEventListener("submit", handleSendMessage);
  refs.createTeamForm.addEventListener("submit", handleCreateTeam);
  refs.teamDirectory.addEventListener("click", handleTeamDirectoryClick);
  refs.profileForm.addEventListener("submit", handleProfileSave);
  if (refs.adminUsersList) refs.adminUsersList.addEventListener("click", handleAdminUsersClick);
  if (refs.adminClubsList) refs.adminClubsList.addEventListener("click", handleAdminClubsClick);
  refs.goalInput.addEventListener("input", () => {
    refs.goalLabel.textContent = `Цель: ${formatNumber(Number(refs.goalInput.value || 0))} шагов`;
  });
  refs.logoutButton.addEventListener("click", handleLogout);
}

async function bootstrapApp() {
  try {
    state.data = await api("/api/bootstrap");
    if (!state.selectedChat.id) {
      openDefaultChat();
    }
    await ensureSelectedChatLoaded();
    await runSearch();
    renderShell();
  } catch (error) {
    state.token = "";
    localStorage.removeItem(TOKEN_KEY);
    state.data = null;
    renderShell();
    showToast(error.message || "Не удалось загрузить приложение.");
  }
}

async function api(url, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  };

  if (state.token) {
    init.headers.Authorization = `Bearer ${state.token}`;
  }

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(buildApiUrl(url), init);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      state.token = "";
      localStorage.removeItem(TOKEN_KEY);
      state.data = null;
      renderShell();
    }
    throw new Error(payload.error || "Ошибка.");
  }

  return payload;
}

async function handleLogin(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(refs.loginForm).entries());

  try {
    const { token } = await api("/api/auth/login", { method: "POST", body });
    setSession(token);
    state.activeTab = "home";
    await bootstrapApp();
    setTab("home");
    renderShell();
    showToast("Вход выполнен.");
  } catch (error) {
    showToast(error.message);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(refs.registerForm).entries());

  try {
    const { token } = await api("/api/auth/register", { method: "POST", body });
    setSession(token);
    state.activeTab = "home";
    await bootstrapApp();
    setTab("home");
    renderShell();
    showToast("Аккаунт создан.");
  } catch (error) {
    showToast(error.message);
  }
}

async function handleSearchInput() {
  await runSearch();
  renderFriends();
}

async function runSearch() {
  const query = refs.friendSearchInput.value.trim();
  if (!query) {
    state.searchResults = [];
    return;
  }

  const response = await api(`/api/search?q=${encodeURIComponent(query)}`);
  state.searchResults = response.results || [];
}

async function handleRequestsClick(event) {
  const accept = event.target.closest("[data-accept-request]");
  const decline = event.target.closest("[data-decline-request]");

  if (accept) {
    await api(`/api/friends/requests/${accept.dataset.requestId}/accept`, { method: "POST" });
    await bootstrapApp();
    showToast("Запрос принят.");
  }

  if (decline) {
    await api(`/api/friends/requests/${decline.dataset.requestId}/decline`, { method: "POST" });
    await bootstrapApp();
    showToast("Запрос скрыт.");
  }
}

async function handleSearchResultsClick(event) {
  const add = event.target.closest("[data-add-friend]");
  const chat = event.target.closest("[data-open-chat]");
  const remove = event.target.closest("[data-remove-friend]");

  if (add) {
    await api("/api/friends/requests", {
      method: "POST",
      body: { recipientId: Number(add.dataset.userId) }
    });
    await bootstrapApp();
    showToast("Запрос отправлен.");
  }

  if (chat) {
    openChat(Number(chat.dataset.userId));
    await ensureSelectedChatLoaded();
    renderShell();
  }

  if (remove) {
    await api(`/api/friends/${remove.dataset.userId}`, { method: "DELETE" });
    await bootstrapApp();
    showToast("Друг удален.");
  }
}

async function handleFriendListClick(event) {
  const chat = event.target.closest("[data-open-chat]");
  const remove = event.target.closest("[data-remove-friend]");

  if (remove) {
    await api(`/api/friends/${remove.dataset.userId}`, { method: "DELETE" });
    await bootstrapApp();
    showToast("Друг удален.");
    return;
  }

  if (!chat) return;
  openChat(Number(chat.dataset.userId));
  await ensureSelectedChatLoaded();
  renderShell();
}

async function handleChatListClick(event) {
  const row = event.target.closest("[data-chat-id]");
  if (!row) return;
  const type = row.dataset.chatType;
  const id = type === "assistant" ? "assistant" : Number(row.dataset.chatId);
  openChat(id, type);
  await ensureSelectedChatLoaded(true);
  renderShell();
}

async function handleSendMessage(event) {
  event.preventDefault();
  if (!state.selectedChat.id) return;

  const body = refs.messageInput.value.trim();
  if (!body) return;

  try {
    if (state.selectedChat.type === "assistant") {
      await api("/api/assistant/chat", { method: "POST", body: { message: body } });
    } else {
      await api(`/api/messages/${state.selectedChat.id}`, { method: "POST", body: { body } });
    }
    refs.messageInput.value = "";
    await ensureSelectedChatLoaded(true);
    await bootstrapApp();
  } catch (error) {
    showToast(error.message);
  }
}

async function handleCreateTeam(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(refs.createTeamForm).entries());

  try {
    await api("/api/teams", { method: "POST", body });
    refs.createTeamForm.reset();
    await bootstrapApp();
    setTab("teams");
    showToast("Команда создана.");
  } catch (error) {
    showToast(error.message);
  }
}

async function handleTeamDirectoryClick(event) {
  const join = event.target.closest("[data-join-team]");
  if (!join) return;

  try {
    await api(`/api/teams/${join.dataset.teamId}/join`, { method: "POST" });
    await bootstrapApp();
    showToast("Ты в команде.");
  } catch (error) {
    showToast(error.message);
  }
}

async function handleProfileSave(event) {
  event.preventDefault();
  try {
    const body = {
      bio: refs.bioInput.value.trim(),
      goal: Number(refs.goalInput.value)
    };
    const steps = refs.stepsInput.value.trim();
    const calories = refs.caloriesInput.value.trim();
    if (steps !== "") body.steps = Number(steps);
    if (calories !== "") body.calories = Number(calories);

    await api("/api/profile", { method: "PATCH", body });
    refs.stepsInput.value = "";
    refs.caloriesInput.value = "";
    await bootstrapApp();
    showToast("Сохранено.");
  } catch (error) {
    showToast(error.message);
  }
}

async function handleLogout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}

  state.token = "";
  state.data = null;
  state.selectedChat = { type: null, id: null };
  state.messages = {};
  localStorage.removeItem(TOKEN_KEY);
  renderShell();
}

function openDefaultChat() {
  const firstFriend = state.data?.friends?.[0];
  if (firstFriend) {
    state.selectedChat = { type: "friend", id: firstFriend.id };
    return;
  }
  state.selectedChat = { type: "assistant", id: "assistant" };
}

function openChat(id, type = "friend") {
  state.selectedChat = { type, id };
  setTab("conversation");
}

async function ensureSelectedChatLoaded(force = false) {
  if (!state.selectedChat.id) return;

  if (state.selectedChat.type === "assistant") {
    if (!force && state.messages.assistant) return;
    state.messages.assistant = state.data?.assistant?.history || [];
    return;
  }

  const friendId = state.selectedChat.id;
  if (!force && state.messages[friendId]) return;
  const response = await api(`/api/messages/${friendId}`);
  state.messages[friendId] = response.messages || [];
}

function renderShell() {
  const authed = Boolean(state.token && state.data);
  refs.authView.classList.toggle("hidden", authed);
  refs.appView.classList.toggle("hidden", !authed);

  if (!authed) {
    updateAuthMode();
    if (refs.apiBaseInput) refs.apiBaseInput.value = state.apiBase;
    return;
  }

  applyTheme();
  renderTabs();
  renderHome();
  renderFriends();
  renderChats();
  renderConversation();
  renderTeams();
  renderCompetition();
  renderProfile();
  renderAdmin();
}

function renderTabs() {
  refs.panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.tab === state.activeTab));
  refs.topbar?.classList.toggle("hidden", state.activeTab === "chats" || state.activeTab === "conversation");
  refs.bottomNav?.classList.toggle("hidden", state.activeTab === "conversation");
  refs.deviceFrame?.classList.toggle("conversation-open", state.activeTab === "conversation");
  const adminEnabled = Boolean(state.data?.me?.isAdmin);
  refs.adminNavButton?.classList.toggle("hidden", !adminEnabled);
  if (refs.bottomNav) {
    refs.bottomNav.style.gridTemplateColumns = adminEnabled
      ? "repeat(6, minmax(0, 1fr))"
      : "repeat(5, minmax(0, 1fr))";
  }
  refs.navButtons.forEach((button) => {
    const target = button.dataset.target;
    const visible = target !== "admin" || adminEnabled;
    button.classList.toggle("hidden", !visible);
    button.classList.toggle("active", target === state.activeTab);
  });
}

function renderHome() {
  if (!state.data) return;

  const { me, stats } = state.data;
  refs.headerGreeting.textContent = `${me.name}, в ритме`;
  refs.heroSteps.textContent = `${formatNumber(me.steps)} шагов`;
  refs.heroCalories.textContent = `${formatNumber(me.calories)} ккал`;

  const progress = Math.min(100, Math.round((me.steps / Math.max(me.goal, 1)) * 100));
  refs.goalPercent.textContent = `${progress}%`;
  refs.goalRing.style.background = `radial-gradient(circle at center, rgba(255,255,255,0.96) 0 41%, transparent 41%), conic-gradient(#fff 0 ${progress}%, rgba(255,255,255,0.24) ${progress}% 100%)`;

  refs.dashboardStats.innerHTML = [
    statCard("Друзья", stats.friendCount),
    statCard("Запросы", stats.requestCount),
    statCard("Место", `#${stats.rank}`)
  ].join("");

  const feed = [
    { title: "Сегодняшняя цель", text: `${formatNumber(me.steps)} шагов из ${formatNumber(me.goal)}` },
    { title: "Активность", text: `${formatNumber(me.calories)} ккал сожжено сегодня` },
    { title: "Соревнования", text: state.data.challenge.copy }
  ];

  refs.feedCards.innerHTML = feed
    .map(
      (item) => `
        <article class="coach-note">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.text)}</p>
        </article>
      `
    )
    .join("");
}

function renderFriends() {
  if (!state.data) return;

  const { friends, requests } = state.data;
  refs.friendRequests.innerHTML = renderRequests(requests);
  refs.friendSearchResults.innerHTML = renderSearchResults(state.searchResults);

  refs.friendList.innerHTML = friends.length
    ? friends
        .map(
          (friend) => `
            <article class="friend-card">
              <div class="friend-meta">
                <div class="avatar">${initials(friend.name)}</div>
                <div>
                  <strong>${escapeHtml(friend.name)}</strong>
                  <p class="muted">@${escapeHtml(friend.username)}</p>
                </div>
              </div>
              <div class="row-head">
                <span class="pill">${formatNumber(friend.steps)} шагов</span>
                <span class="pill">${formatNumber(friend.calories)} ккал</span>
                <button class="mini-button" data-open-chat="1" data-user-id="${friend.id}">Чат</button>
                <button class="mini-button danger" data-remove-friend="1" data-user-id="${friend.id}">Удалить</button>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state subtle">Пока нет друзей. Найди человека по нику и отправь запрос.</div>`;
}

function renderChats() {
  if (!state.data) return;

  const assistantChat = {
    id: "assistant",
    type: "assistant",
    title: "AI коуч",
    subtitle: "Спортивные советы",
    lastMessage: getLastAssistantText(),
    online: true
  };

  const friendChats = state.data.friends.map((friend) => ({
    id: friend.id,
    type: "friend",
    title: friend.name,
    subtitle: `@${friend.username}`,
    lastMessage: friend.lastMessage || "Нет сообщений"
  }));

  const chats = [assistantChat, ...friendChats];

  refs.chatList.innerHTML = chats
    .map(
      (chat) => `
        <article class="chat-list-item ${isSelectedChat(chat) ? "active" : ""}" data-chat-id="${chat.id}" data-chat-type="${chat.type}">
          <div class="friend-meta">
            <div class="avatar">${chat.type === "assistant" ? "AI" : initials(chat.title)}</div>
            <div>
              <strong>${escapeHtml(chat.title)}</strong>
              <p class="muted">${escapeHtml(chat.subtitle)}</p>
            </div>
          </div>
          <div class="chat-snippet">${escapeHtml(chat.lastMessage)}</div>
        </article>
      `
    )
    .join("");
}

function renderConversation() {
  if (!state.data) return;
  if (!refs.messageList) return;

  const assistantChat = {
    id: "assistant",
    type: "assistant",
    title: "AI коуч",
    subtitle: "Спортивные советы",
    lastMessage: getLastAssistantText(),
    online: true
  };

  const friendChats = state.data.friends.map((friend) => ({
    id: friend.id,
    type: "friend",
    title: friend.name,
    subtitle: `@${friend.username}`,
    lastMessage: friend.lastMessage || "Нет сообщений"
  }));

  const chats = [assistantChat, ...friendChats];
  const selected = getSelectedChatObject(chats);

  if (!selected) {
    refs.chatTypeLabel.textContent = "Чат";
    refs.chatTitle.textContent = "Выбери диалог";
    refs.chatSubtitle.textContent = "Открой чат из списка слева";
    refs.chatAvatar.textContent = "MC";
    refs.messageList.innerHTML = `<div class="empty-state subtle">Выбери диалог из списка чатов.</div>`;
    return;
  }
  const isAssistant = selected.type === "assistant";
  refs.chatTypeLabel.textContent = isAssistant ? "AI коуч" : "Чат";
  refs.chatTitle.textContent = selected.title;
  refs.chatSubtitle.textContent = isAssistant ? "Спортивные советы" : selected.subtitle;
  refs.chatAvatar.textContent = isAssistant ? "AI" : initials(selected.title);

  const messages = selected
    ? selected.type === "assistant"
      ? state.messages.assistant || []
      : state.messages[selected.id] || []
    : [];

  refs.messageList.innerHTML = selected
    ? messages.length
      ? messages
          .map((message) => {
            const isMine = selected.type === "assistant" ? message.role === "user" : message.isMine;
            const author = selected.type === "assistant" ? (isMine ? "Ты" : "MoveCircle AI") : isMine ? "Ты" : selected.title;
            return `
              <div class="message-row ${isMine ? "me" : ""}">
                <div class="message-bubble">
                  <strong>${escapeHtml(author)}</strong>
                  <p>${escapeHtml(message.body || message.content || "")}</p>
                </div>
              </div>
            `;
          })
          .join("")
      : `<div class="empty-state subtle">Начни диалог первым сообщением.</div>`
      : `<div class="empty-state subtle">Выбери чат слева.</div>`;

  scrollConversationToBottom();
}

function applyTheme() {
  document.body.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = state.theme;
  localStorage.setItem(THEME_KEY, state.theme);
  updateThemeButtons();
}

function updateThemeButtons() {
  const isDark = state.theme === "dark";
  const label = isDark ? "☀" : "☾";
  const tooltip = isDark ? "Светлая тема" : "Темная тема";
  [refs.themeToggleButton, refs.chatThemeToggleButton].forEach((button) => {
    if (!button) return;
    button.textContent = label;
    button.title = tooltip;
    button.setAttribute("aria-label", tooltip);
  });
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  applyTheme();
}

function scrollConversationToBottom() {
  if (!refs.messageList) return;
  const scroll = () => {
    const lastMessage = refs.messageList.lastElementChild;
    if (lastMessage && typeof lastMessage.scrollIntoView === "function") {
      lastMessage.scrollIntoView({ block: "end" });
    }
    refs.messageList.scrollTop = refs.messageList.scrollHeight;
  };

  requestAnimationFrame(() => {
    scroll();
    requestAnimationFrame(scroll);
    setTimeout(scroll, 40);
  });
}

function getSelectedChatObject(chats) {
  return chats.find((chat) => chat.type === state.selectedChat.type && String(chat.id) === String(state.selectedChat.id));
}

function isSelectedChat(chat) {
  return String(chat.id) === String(state.selectedChat.id) && chat.type === state.selectedChat.type;
}

function getLastAssistantText() {
  const history = state.data?.assistant?.history || [];
  const last = history[history.length - 1];
  return last ? (last.content || last.body || "").slice(0, 80) : "Спроси про тренировку";
}

function renderRequests(requests) {
  const incoming = requests?.incoming || [];
  const outgoing = requests?.outgoing || [];

  return `
    <div class="section-head"><div><p class="eyebrow">Запросы</p><h4>Входящие</h4></div></div>
    <div class="stack">
      ${
        incoming.length
          ? incoming
              .map(
                (item) => `
                  <article class="request-card">
                    <div class="friend-meta">
                      <div class="avatar">${initials(item.name)}</div>
                      <div>
                        <strong>${escapeHtml(item.name)}</strong>
                        <p class="muted">@${escapeHtml(item.username)}</p>
                      </div>
                    </div>
                    <div class="row-head">
                      <button class="mini-button" data-accept-request="1" data-request-id="${item.id}">Принять</button>
                      <button class="mini-button" data-decline-request="1" data-request-id="${item.id}">Скрыть</button>
                    </div>
                  </article>
                `
              )
              .join("")
          : `<div class="empty-state subtle">Нет входящих запросов.</div>`
      }
    </div>
    <div class="section-head"><div><p class="eyebrow">Запросы</p><h4>Отправленные</h4></div></div>
    <div class="stack">
      ${
        outgoing.length
          ? outgoing
              .map(
                (item) => `
                  <article class="request-card">
                    <div class="friend-meta">
                      <div class="avatar">${initials(item.name)}</div>
                      <div>
                        <strong>${escapeHtml(item.name)}</strong>
                        <p class="muted">@${escapeHtml(item.username)}</p>
                      </div>
                    </div>
                    <span class="pill">Отправлено</span>
                  </article>
                `
              )
              .join("")
          : `<div class="empty-state subtle">Нет исходящих запросов.</div>`
      }
    </div>
  `;
}

function renderSearchResults(results) {
  if (!refs.friendSearchInput.value.trim()) {
    return "";
  }

  if (!results.length) {
    return `<div class="empty-state subtle">Никого не нашли.</div>`;
  }

  return results
    .map(
      (user) => `
        <article class="search-card">
          <div class="friend-meta">
            <div class="avatar">${initials(user.name)}</div>
            <div>
              <strong>${escapeHtml(user.name)}</strong>
              <p class="muted">@${escapeHtml(user.username)}</p>
            </div>
          </div>
          <div class="row-head">
            <span class="pill">${relationLabel(user.relation)}</span>
            ${searchActionButton(user)}
          </div>
        </article>
      `
    )
    .join("");
}

function searchActionButton(user) {
  if (user.relation === "friend") {
    return `
      <button class="mini-button" data-open-chat="1" data-user-id="${user.id}">Чат</button>
      <button class="mini-button danger" data-remove-friend="1" data-user-id="${user.id}">Удалить</button>
    `;
  }
  if (user.relation === "incoming") {
    return `<span class="pill">Запрос у тебя</span>`;
  }
  if (user.relation === "outgoing") {
    return `<span class="pill">Отправлено</span>`;
  }
  return `<button class="mini-button" data-add-friend="1" data-user-id="${user.id}">Добавить</button>`;
}

function renderTeams() {
  if (!state.data) return;
  const myTeams = state.data.teams.filter((team) => team.isMember);
  const openTeams = state.data.teams.filter((team) => !team.isMember);

  refs.memberTeams.innerHTML = myTeams.length
    ? myTeams
        .map(
          (team) => `
            <article class="team-card">
              <div class="team-meta">
                <div class="badge">${initials(team.name)}</div>
                <div>
                  <strong>${escapeHtml(team.name)}</strong>
                  <p class="muted">${escapeHtml(team.description)}</p>
                </div>
              </div>
              <div class="row-head">
                <span class="pill">${team.memberCount} участников</span>
                <span class="pill">${formatNumber(team.totalSteps)} шагов</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state subtle">Пока нет команд.</div>`;

  refs.teamDirectory.innerHTML = openTeams.length
    ? openTeams
        .map(
          (team) => `
            <article class="team-card">
              <div class="team-meta">
                <div class="badge">${initials(team.name)}</div>
                <div>
                  <strong>${escapeHtml(team.name)}</strong>
                  <p class="muted">${escapeHtml(team.description)}</p>
                </div>
              </div>
              <div class="row-head">
                <span class="pill">${team.memberCount} участников</span>
                <button class="mini-button" data-join-team="1" data-team-id="${team.id}">Вступить</button>
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state subtle">Открытых команд пока нет.</div>`;
}

function renderCompetition() {
  if (!state.data) return;

  refs.leaderboardList.innerHTML = state.data.leaderboard
    .map(
      (entry, index) => `
        <article class="leaderboard-item">
          <div class="leader-meta">
            <div class="badge">#${index + 1}</div>
            <div>
              <strong>${escapeHtml(entry.name)}</strong>
              <p class="muted">@${escapeHtml(entry.username)}</p>
            </div>
          </div>
          <div class="row-head">
            <span class="pill">${formatNumber(entry.steps)} шагов</span>
            <span class="pill">${formatNumber(entry.calories)} ккал</span>
          </div>
        </article>
      `
    )
    .join("");

  refs.challengeTitle.textContent = state.data.challenge.title;
  refs.challengePercentBadge.textContent = `${state.data.challenge.progress}%`;
  refs.challengeFill.style.width = `${state.data.challenge.progress}%`;
  refs.challengeCopy.textContent = state.data.challenge.copy;
}

function renderProfile() {
  if (!state.data) return;
  const { me } = state.data;
  refs.profileAvatar.textContent = initials(me.name);
  refs.profileName.textContent = me.name;
  refs.profileHandle.textContent = `@${me.username}`;
  refs.bioInput.value = me.bio || "";
  refs.goalInput.value = String(me.goal);
  refs.goalLabel.textContent = `Цель: ${formatNumber(me.goal)} шагов`;
  refs.syncKeyDisplay.textContent = me.syncKey || "—";
}

function renderAdmin() {
  const admin = state.data?.admin;
  if (!refs.adminUsersList || !refs.adminClubsList) return;

  if (!admin) {
    refs.adminUsersList.innerHTML = `<div class="empty-state subtle">Админка доступна только владельцу.</div>`;
    refs.adminClubsList.innerHTML = `<div class="empty-state subtle">Админка доступна только владельцу.</div>`;
    return;
  }

  refs.adminUsersList.innerHTML = admin.users
    .map(
      (user) => `
        <article class="admin-card">
          <div class="friend-meta">
            <div class="avatar">${initials(user.name)}</div>
            <div>
              <strong>${escapeHtml(user.name)}</strong>
              <p class="muted">@${escapeHtml(user.username)} · ${escapeHtml(user.email)}</p>
            </div>
          </div>
          <div class="row-head">
            <span class="pill">${formatNumber(user.steps)} шагов</span>
            <span class="pill">${user.is_admin ? "admin" : "user"}</span>
            <button class="mini-button" data-ban-user="1" data-user-id="${user.id}">Бан</button>
            <button class="mini-button danger" data-delete-user="1" data-user-id="${user.id}">Удалить</button>
          </div>
        </article>
      `
    )
    .join("");

  refs.adminClubsList.innerHTML = admin.clubs
    .map(
      (team) => `
        <article class="admin-card">
          <div class="friend-meta">
            <div class="badge">${initials(team.name)}</div>
            <div>
              <strong>${escapeHtml(team.name)}</strong>
              <p class="muted">@${escapeHtml(team.owner_username)} · ${escapeHtml(team.description)}</p>
            </div>
          </div>
          <div class="row-head">
            <span class="pill">${team.member_count} участников</span>
            <button class="mini-button danger" data-delete-team="1" data-team-id="${team.id}">Удалить клуб</button>
          </div>
        </article>
      `
    )
    .join("");
}

async function handleAdminUsersClick(event) {
  const ban = event.target.closest("[data-ban-user]");
  const remove = event.target.closest("[data-delete-user]");

  if (ban) {
    await api(`/api/admin/users/${ban.dataset.userId}/ban`, { method: "POST" });
    await bootstrapApp();
    showToast("Пользователь забанен.");
  }

  if (remove) {
    await api(`/api/admin/users/${remove.dataset.userId}`, { method: "DELETE" });
    await bootstrapApp();
    showToast("Пользователь удален.");
  }
}

async function handleAdminClubsClick(event) {
  const remove = event.target.closest("[data-delete-team]");
  if (!remove) return;

  await api(`/api/admin/teams/${remove.dataset.teamId}`, { method: "DELETE" });
  await bootstrapApp();
  showToast("Клуб удален.");
}

function updateAuthMode() {
  refs.authToggleButtons.forEach((button) => button.classList.toggle("active", button.dataset.authMode === state.authMode));
  refs.loginForm.classList.toggle("hidden", state.authMode !== "login");
  refs.registerForm.classList.toggle("hidden", state.authMode !== "register");
}

function setTab(tab) {
  state.activeTab = tab;
  renderTabs();
}

function setSession(token) {
  state.token = token;
  localStorage.setItem(TOKEN_KEY, token);
}

function buildApiUrl(url) {
  if (/^https?:\/\//i.test(url)) return url;
  if (!state.apiBase) return url;
  return `${state.apiBase.replace(/\/$/, "")}${url}`;
}

function handleApiBaseChange() {
  state.apiBase = refs.apiBaseInput.value.trim();
  localStorage.setItem(API_BASE_KEY, state.apiBase);
}

function statCard(title, value) {
  return `<article class="stat-card"><p>${escapeHtml(title)}</p><strong>${escapeHtml(String(value))}</strong><span>сегодня</span></article>`;
}

function relationLabel(relation) {
  if (relation === "friend") return "Друг";
  if (relation === "incoming") return "Запрос у тебя";
  if (relation === "outgoing") return "Отправлено";
  return "Найден";
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => refs.toast.classList.add("hidden"), 2400);
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function initials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
