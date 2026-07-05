const config = window.SECURE_FINANCIAL_CONFIG || {};
const supabaseUrl = config.SUPABASE_URL;
const supabaseAnonKey = config.SUPABASE_ANON_KEY;
const supabaseReady = supabaseUrl && supabaseAnonKey && !supabaseUrl.includes("your-project");
const db = supabaseReady ? window.supabase.createClient(supabaseUrl, supabaseAnonKey) : null;

const state = {
  session: null,
  profile: null,
  account: null,
  transactions: [],
  adminUsers: [],
  adminTransactions: [],
  auditLogs: [],
  page: "dashboard",
  userPage: 1,
  adminUserPage: 1,
  pageSize: 8,
  realtimeChannel: null,
  charts: {}
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const money = (value = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
const dateText = (value) =>
  value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Pending";
const avatarFor = (name = "Secure Member") =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0f766e&color=fff&bold=true`;

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindEvents();
  applyTheme(localStorage.getItem("secure-financial-theme") || "light");
  if (!supabaseReady) {
    toast("Add your Supabase URL and anon key to config.js before signing in.");
    return;
  }
  db.auth.getSession().then(({ data }) => handleSession(data.session));
  db.auth.onAuthStateChange((_event, session) => handleSession(session));
}

function bindEvents() {
  $$("[data-open-auth]").forEach((button) => button.addEventListener("click", () => showAuth(button.dataset.openAuth)));
  $("#authClose").addEventListener("click", showHome);
  $$("[data-auth-tab]").forEach((button) => button.addEventListener("click", () => setAuthTab(button.dataset.authTab)));
  $("#loginForm").addEventListener("submit", login);
  $("#registerForm").addEventListener("submit", register);
  $("#resetForm").addEventListener("submit", resetPassword);
  $("#logoutButton").addEventListener("click", logout);
  $("#profileForm").addEventListener("submit", updateProfile);
  $("#passwordForm").addEventListener("submit", updatePassword);
  $("#menuToggle").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
  $("#refreshButton").addEventListener("click", loadAppData);
  $("#themeToggleHome").addEventListener("click", toggleTheme);
  $("#themeToggleApp").addEventListener("click", toggleTheme);
  $("#transactionSearch").addEventListener("input", renderTransactions);
  $("#transactionTypeFilter").addEventListener("change", renderTransactions);
  $("#userSearch").addEventListener("input", renderAdminUsers);
  $("#statusFilter").addEventListener("change", renderAdminUsers);
  $("#adminTransactionSearch").addEventListener("input", renderAdminTransactions);
  $("#dateFilter").addEventListener("change", renderAdminTransactions);
  $("#amountFilter").addEventListener("input", renderAdminTransactions);
  $("#adminTypeFilter").addEventListener("change", renderAdminTransactions);
  $("#exportUserTransactions").addEventListener("click", () => exportCsv("secure-financial-transactions.csv", state.transactions));
  $("#exportAdminTransactions").addEventListener("click", () => exportCsv("secure-financial-admin-transactions.csv", state.adminTransactions));
  $("#saveAdminUser").addEventListener("click", saveAdminUser);
  $("#saveBalanceAction").addEventListener("click", applyBalanceAction);
  $("#closeReceipt").addEventListener("click", () => $("#receiptDialog").close());
  $("#printReceipt").addEventListener("click", () => window.print());
  $("#newUserButton").addEventListener("click", () => toast("Create users through Supabase Auth or a service-role Edge Function."));
  $$("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`)?.close());
  });

  $$("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      setPage(button.dataset.page);
      $(".sidebar").classList.remove("open");
    });
  });
  $$("[data-page-jump]").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.pageJump)));
}

async function handleSession(session) {
  state.session = session;
  if (!session) {
    showHome();
    return;
  }
  $("#homeView").classList.add("hidden");
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  await loadAppData();
}

function showHome() {
  $("#homeView").classList.remove("hidden");
  $("#authView").classList.add("hidden");
  $("#appView").classList.add("hidden");
}

function showAuth(tab = "login") {
  $("#homeView").classList.add("hidden");
  $("#authView").classList.remove("hidden");
  setAuthTab(tab);
}

function setAuthTab(tab) {
  const labels = {
    login: ["Welcome back", "Sign in to continue to Secure Financial."],
    register: ["Open your account", "Use a valid email address and verify it before login."],
    reset: ["Reset password", "We will send a secure password reset link to your email."]
  };
  $("#authTitle").textContent = labels[tab][0];
  $("#authSubtitle").textContent = labels[tab][1];
  $$("[data-auth-tab]").forEach((button) => button.classList.toggle("active", button.dataset.authTab === tab));
  ["login", "register", "reset"].forEach((name) => $(`#${name}Form`).classList.toggle("hidden", name !== tab));
}

async function login(event) {
  event.preventDefault();
  setFormLoading(event.target, true);
  const { data, error } = await db.auth.signInWithPassword({
    email: $("#loginEmail").value.trim(),
    password: $("#loginPassword").value
  });
  setFormLoading(event.target, false);
  if (error) return toast(error.message);
  if (!data.user.email_confirmed_at) {
    await db.auth.signOut();
    return toast("Please verify your email before logging in.");
  }
  toast("Login successful.");
}

async function register(event) {
  event.preventDefault();
  setFormLoading(event.target, true);
  const fullName = $("#registerName").value.trim();
  const { error } = await db.auth.signUp({
    email: $("#registerEmail").value.trim(),
    password: $("#registerPassword").value,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: window.location.origin
    }
  });
  setFormLoading(event.target, false);
  if (error) return toast(error.message);
  toast("Account created. Check your email to verify before login.");
  setAuthTab("login");
}

async function resetPassword(event) {
  event.preventDefault();
  setFormLoading(event.target, true);
  const { error } = await db.auth.resetPasswordForEmail($("#resetEmail").value.trim(), {
    redirectTo: window.location.origin
  });
  setFormLoading(event.target, false);
  toast(error ? error.message : "Password reset link sent.");
}

async function logout() {
  await db.auth.signOut();
  toast("Logged out.");
}

async function loadAppData() {
  if (!state.session) return;
  showLoading(true);
  try {
    await loadProfile();
    await Promise.all([loadAccount(), loadTransactions(), loadBankingInfo()]);
    if (isAdmin()) await Promise.all([loadAdminUsers(), loadAdminTransactions(), loadAuditLogs()]);
    setupRealtime();
    renderAll();
  } catch (error) {
    toast(error.message || "Unable to load dashboard.");
  } finally {
    showLoading(false);
  }
}

async function loadProfile() {
  const user = state.session.user;
  let { data, error } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    const fullName = user.user_metadata?.full_name || user.email.split("@")[0];
    const accountNumber = String(Math.floor(1000000000 + Math.random() * 9000000000));
    const insert = await db
      .from("profiles")
      .insert({ id: user.id, full_name: fullName, email: user.email, account_number: accountNumber })
      .select()
      .single();
    if (insert.error) throw insert.error;
    data = insert.data;
  }
  state.profile = data;
}

async function loadAccount() {
  let { data, error } = await db.from("accounts").select("*").eq("user_id", state.session.user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    const insert = await db.from("accounts").insert({ user_id: state.session.user.id }).select().single();
    if (insert.error) throw insert.error;
    data = insert.data;
  }
  state.account = data;
}

async function loadTransactions() {
  const { data, error } = await db
    .from("transactions")
    .select("*")
    .eq("user_id", state.session.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  state.transactions = data || [];
}

async function loadBankingInfo() {
  const [card, checking] = await Promise.all([
    db.from("debit_cards").select("*").eq("user_id", state.session.user.id).maybeSingle(),
    db.from("checking_accounts").select("*").eq("user_id", state.session.user.id).maybeSingle()
  ]);
  if (card.error) throw card.error;
  if (checking.error) throw checking.error;
  state.debitCard = card.data;
  state.checking = checking.data;
}

async function loadAdminUsers() {
  const { data, error } = await db
    .from("admin_user_overview")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  state.adminUsers = data || [];
}

async function loadAdminTransactions() {
  const { data, error } = await db
    .from("admin_transaction_overview")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  state.adminTransactions = data || [];
}

async function loadAuditLogs() {
  const { data, error } = await db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  state.auditLogs = data || [];
}

function isAdmin() {
  return state.profile?.role === "admin";
}

function renderAll() {
  renderIdentity();
  renderBalances();
  renderTransactions();
  renderBankingInfo();
  renderAdminAccess();
  if (isAdmin()) {
    renderAdminOverview();
    renderAdminUsers();
    renderAdminTransactions();
    renderAuditLogs();
  }
}

function renderIdentity() {
  const p = state.profile;
  const avatar = p.profile_picture || avatarFor(p.full_name);
  $("#headerAvatar").src = avatar;
  $("#profileAvatar").src = avatar;
  $("#profileName").textContent = p.full_name || "Secure Member";
  $("#profileEmail").textContent = p.email || state.session.user.email;
  $("#profilePhone").textContent = p.phone || "Not provided";
  $("#profileAddress").textContent = p.address || "Not provided";
  $("#profileAccount").textContent = p.account_number || "Pending";
  $("#profileCreated").textContent = dateText(p.created_at);
  $("#phoneInput").value = p.phone || "";
  $("#addressInput").value = p.address || "";
}

function renderBalances() {
  const balance = Number(state.account?.balance || 0);
  const savings = Number(state.account?.savings_balance || 0);
  const deposits = sumTransactions("deposit");
  const withdrawals = sumTransactions("withdrawal");
  $("#currentBalance").textContent = money(balance);
  $("#availableBalance").textContent = money(balance);
  $("#savingsBalance").textContent = money(savings);
  $("#totalDeposits").textContent = money(deposits);
  $("#adminDeposits").textContent = money(isAdmin() ? sumAdminTransactions("deposit") : deposits);
  $("#adminWithdrawals").textContent = money(isAdmin() ? sumAdminTransactions("withdrawal") : withdrawals);
}

function renderTransactions() {
  const search = $("#transactionSearch").value?.toLowerCase() || "";
  const type = $("#transactionTypeFilter").value;
  const filtered = state.transactions.filter((tx) => {
    const text = `${tx.description} ${tx.transaction_type}`.toLowerCase();
    return (!type || tx.transaction_type === type) && (!search || text.includes(search));
  });
  renderTransactionList("#recentTransactions", state.transactions.slice(0, 5));
  renderTransactionRows("#transactionsTable", paginate(filtered, state.userPage), true);
  renderPagination("#userPagination", filtered.length, state.userPage, (page) => {
    state.userPage = page;
    renderTransactions();
  });
}

function renderTransactionList(selector, transactions) {
  const target = $(selector);
  target.innerHTML = transactions.length
    ? transactions
        .map((tx) => {
          const positive = tx.transaction_type === "deposit";
          return `<div class="transaction-item">
            <span class="transaction-icon"><i class="fa-solid ${positive ? "fa-arrow-down" : "fa-arrow-up"}"></i></span>
            <div><strong>${escapeHtml(tx.description || tx.transaction_type)}</strong><p>${dateText(tx.created_at)}</p></div>
            <strong class="${positive ? "amount-positive" : "amount-negative"}">${positive ? "+" : "-"}${money(tx.amount)}</strong>
          </div>`;
        })
        .join("")
    : `<p class="muted">No transactions yet.</p>`;
}

function renderTransactionRows(selector, transactions, receiptAction = false) {
  $(selector).innerHTML = transactions.length
    ? transactions
        .map(
          (tx) => `<tr>
            <td>${dateText(tx.created_at)}</td>
            <td>${escapeHtml(tx.description || "")}</td>
            <td>${escapeHtml(tx.transaction_type || "")}</td>
            <td>${money(tx.amount)}</td>
            <td>${money(tx.balance_after)}</td>
            <td>${receiptAction ? `<button class="button button-small button-light" onclick="showReceipt('${tx.id}')">Receipt</button>` : ""}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="6">No records found.</td></tr>`;
}

function renderBankingInfo() {
  const card = state.debitCard;
  const checking = state.checking;
  $("#debitCardDetails").innerHTML = card
    ? detailRows({
        "Bank Name": card.bank_name,
        "Cardholder Name": card.cardholder_name,
        "Card Number": mask(card.card_number),
        Expiry: card.expiry,
        CVV: "***"
      })
    : `<p class="muted">No debit card information available.</p>`;
  $("#checkingDetails").innerHTML = checking
    ? detailRows({
        "Bank Name": checking.bank_name,
        "Routing Number": checking.routing_number,
        "Account Number": mask(checking.account_number),
        "Account Holder": checking.account_holder
      })
    : `<p class="muted">No checking account information available.</p>`;
}

function renderAdminAccess() {
  $("#adminNav").classList.toggle("hidden", !isAdmin());
  if (!isAdmin() && state.page.startsWith("admin")) setPage("dashboard");
}

function renderAdminOverview() {
  $("#adminTotalUsers").textContent = state.adminUsers.length;
  $("#adminBankBalance").textContent = money(state.adminUsers.reduce((sum, user) => sum + Number(user.balance || 0), 0));
  renderTransactionList("#adminRecentTransactions", state.adminTransactions.slice(0, 5));
  $("#newestUsers").innerHTML = state.adminUsers
    .slice(0, 5)
    .map(
      (user) => `<div class="transaction-item">
        <img class="avatar avatar-sm" src="${user.profile_picture || avatarFor(user.full_name)}" alt="">
        <div><strong>${escapeHtml(user.full_name || "Member")}</strong><p>${escapeHtml(user.email || "")}</p></div>
        <span class="status-pill status-${user.status || "active"}">${user.status || "active"}</span>
      </div>`
    )
    .join("");
  drawCharts();
}

function renderAdminUsers() {
  const search = $("#userSearch").value?.toLowerCase() || "";
  const status = $("#statusFilter").value;
  const filtered = state.adminUsers.filter((user) => {
    const text = `${user.full_name} ${user.email} ${user.phone} ${user.account_number}`.toLowerCase();
    return (!status || user.status === status) && (!search || text.includes(search));
  });
  $("#usersTable").innerHTML = paginate(filtered, state.adminUserPage)
    .map(
      (user) => `<tr>
        <td><img class="avatar avatar-sm" src="${user.profile_picture || avatarFor(user.full_name)}" alt=""></td>
        <td>${escapeHtml(user.full_name || "")}</td>
        <td>${escapeHtml(user.email || "")}</td>
        <td>${escapeHtml(user.phone || "")}</td>
        <td>${escapeHtml(user.address || "")}</td>
        <td>${money(user.balance)}</td>
        <td><span class="status-pill status-${user.status || "active"}">${user.status || "active"}</span></td>
        <td><div class="row-actions">
          <button class="icon-button" title="Edit" onclick="openUserDialog('${user.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-button" title="Balance" onclick="openBalanceDialog('${user.id}')"><i class="fa-solid fa-dollar-sign"></i></button>
          <button class="icon-button" title="Reset password" onclick="adminResetPassword('${user.email}')"><i class="fa-solid fa-key"></i></button>
          <button class="icon-button" title="${user.status === "suspended" ? "Activate" : "Suspend"}" onclick="toggleUserStatus('${user.id}', '${user.status || "active"}')"><i class="fa-solid fa-ban"></i></button>
          <button class="icon-button" title="Delete" onclick="deleteUserProfile('${user.id}')"><i class="fa-solid fa-trash"></i></button>
        </div></td>
      </tr>`
    )
    .join("");
  renderPagination("#adminUserPagination", filtered.length, state.adminUserPage, (page) => {
    state.adminUserPage = page;
    renderAdminUsers();
  });
}

function renderAdminTransactions() {
  const search = $("#adminTransactionSearch").value?.toLowerCase() || "";
  const date = $("#dateFilter").value;
  const amount = $("#amountFilter").value;
  const type = $("#adminTypeFilter").value;
  const filtered = state.adminTransactions.filter((tx) => {
    const text = `${tx.description} ${tx.transaction_type} ${tx.user_email} ${tx.user_name}`.toLowerCase();
    return (
      (!search || text.includes(search)) &&
      (!date || tx.created_at?.startsWith(date)) &&
      (!amount || Number(tx.amount) === Number(amount)) &&
      (!type || tx.transaction_type === type)
    );
  });
  $("#adminTransactionsTable").innerHTML = filtered.length
    ? filtered
        .map(
          (tx) => `<tr>
            <td>${dateText(tx.created_at)}</td>
            <td>${escapeHtml(tx.user_name || tx.user_email || "")}</td>
            <td>${escapeHtml(tx.transaction_type || "")}</td>
            <td>${escapeHtml(tx.description || "")}</td>
            <td>${money(tx.amount)}</td>
            <td>${money(tx.balance_before)}</td>
            <td>${money(tx.balance_after)}</td>
            <td>${escapeHtml(tx.admin_name || "System")}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="8">No records found.</td></tr>`;
}

function renderAuditLogs() {
  $("#auditLogs").innerHTML = state.auditLogs
    .map(
      (log) => `<div class="transaction-item">
        <span class="transaction-icon"><i class="fa-solid fa-fingerprint"></i></span>
        <div><strong>${escapeHtml(log.action)}</strong><p>${dateText(log.created_at)}</p></div>
        <small>${escapeHtml(log.entity_type || "")}</small>
      </div>`
    )
    .join("");
}

async function updateProfile(event) {
  event.preventDefault();
  showLoading(true);
  try {
    let profile_picture = state.profile.profile_picture;
    const file = $("#profilePictureInput").files[0];
    if (file) {
      const path = `${state.session.user.id}/${Date.now()}-${file.name}`;
      const upload = await db.storage.from("profile-pictures").upload(path, file, { upsert: true });
      if (upload.error) throw upload.error;
      const publicUrl = db.storage.from("profile-pictures").getPublicUrl(path);
      profile_picture = publicUrl.data.publicUrl;
    }
    const { error } = await db
      .from("profiles")
      .update({ phone: $("#phoneInput").value.trim(), address: $("#addressInput").value.trim(), profile_picture })
      .eq("id", state.session.user.id);
    if (error) throw error;
    await loadProfile();
    renderIdentity();
    toast("Profile updated successfully.");
  } catch (error) {
    toast(error.message);
  } finally {
    showLoading(false);
  }
}

async function updatePassword(event) {
  event.preventDefault();
  const { error } = await db.auth.updateUser({ password: $("#newPasswordInput").value });
  toast(error ? error.message : "Password updated successfully.");
  if (!error) event.target.reset();
}

window.openUserDialog = function (id) {
  const user = state.adminUsers.find((item) => item.id === id);
  if (!user) return;
  $("#adminUserId").value = user.id;
  $("#adminName").value = user.full_name || "";
  $("#adminEmail").value = user.email || "";
  $("#adminPhone").value = user.phone || "";
  $("#adminAddress").value = user.address || "";
  $("#adminRole").value = user.role || "user";
  $("#adminStatus").value = user.status || "active";
  $("#adminPicture").value = user.profile_picture || "";
  $("#adminUserDialog").showModal();
};

async function saveAdminUser() {
  const id = $("#adminUserId").value;
  const updates = {
    full_name: $("#adminName").value.trim(),
    email: $("#adminEmail").value.trim(),
    phone: $("#adminPhone").value.trim(),
    address: $("#adminAddress").value.trim(),
    role: $("#adminRole").value,
    profile_picture: $("#adminPicture").value.trim()
  };
  const status = $("#adminStatus").value;
  const { error } = await db.rpc("admin_update_user", { target_user_id: id, profile_updates: updates, account_status: status });
  if (error) return toast(error.message);
  $("#adminUserDialog").close();
  await loadAppData();
  toast("User updated successfully.");
}

window.openBalanceDialog = function (id) {
  $("#balanceUserId").value = id;
  $("#balanceForm").reset();
  $("#balanceDialog").showModal();
};

async function applyBalanceAction() {
  const amount = Number($("#balanceAmount").value);
  const { error } = await db.rpc("admin_modify_balance", {
    target_user_id: $("#balanceUserId").value,
    action_type: $("#balanceAction").value,
    amount_value: amount,
    action_description: $("#balanceDescription").value.trim()
  });
  if (error) return toast(error.message);
  $("#balanceDialog").close();
  await loadAppData();
  toast("Balance updated and transaction record created.");
}

window.toggleUserStatus = async function (id, status) {
  const nextStatus = status === "suspended" ? "active" : "suspended";
  const { error } = await db.rpc("admin_set_account_status", { target_user_id: id, account_status: nextStatus });
  if (error) return toast(error.message);
  await loadAppData();
  toast(`Account ${nextStatus}.`);
};

window.adminResetPassword = async function (email) {
  if (!confirm(`Send a password reset email to ${email}?`)) return;
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  toast(error ? error.message : "Password reset email sent.");
};

window.deleteUserProfile = async function (id) {
  if (!confirm("Delete this user profile and related records? Auth user deletion requires a service-role Edge Function.")) return;
  const { error } = await db.rpc("admin_delete_user_records", { target_user_id: id });
  if (error) return toast(error.message);
  await loadAppData();
  toast("User records deleted.");
};

window.showReceipt = function (id) {
  const tx = state.transactions.find((item) => item.id === id);
  if (!tx) return;
  $("#receiptContent").innerHTML = detailRows({
    Date: dateText(tx.created_at),
    Type: tx.transaction_type,
    Description: tx.description,
    Amount: money(tx.amount),
    "Balance Before": money(tx.balance_before),
    "Balance After": money(tx.balance_after),
    "Transaction ID": tx.id
  });
  $("#receiptDialog").showModal();
};

function setupRealtime() {
  if (state.realtimeChannel) db.removeChannel(state.realtimeChannel);
  state.realtimeChannel = db
    .channel(`secure-financial-${state.session.user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "accounts", filter: `user_id=eq.${state.session.user.id}` }, loadAppData)
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${state.session.user.id}` }, loadAppData)
    .subscribe();
}

function setPage(page) {
  if (page.startsWith("admin") && !isAdmin()) {
    toast("Admin access required.");
    return;
  }
  state.page = page;
  $$(".page").forEach((item) => item.classList.remove("active"));
  $(`#${page}Page`)?.classList.add("active");
  $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
  const title = page
    .replace("admin-", "Admin ")
    .replace("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  $("#pageTitle").textContent = title;
  $("#pageEyebrow").textContent = page.startsWith("admin") ? "Administrator Dashboard" : "User Dashboard";
}

function drawCharts() {
  drawChart("depositChart", "Deposits", monthlyTotals(state.adminTransactions, "deposit"), "#0f766e");
  drawChart("withdrawalChart", "Withdrawals", monthlyTotals(state.adminTransactions, "withdrawal"), "#dc2626");
  drawChart("growthChart", "User Growth", monthlyUsers(state.adminUsers), "#2563eb");
}

function drawChart(id, label, data, color) {
  const canvas = $(`#${id}`);
  if (!canvas || !window.Chart) return;
  state.charts[id]?.destroy();
  state.charts[id] = new Chart(canvas, {
    type: "line",
    data: { labels: data.labels, datasets: [{ label, data: data.values, borderColor: color, backgroundColor: `${color}22`, fill: true, tension: 0.35 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

function monthlyTotals(items, type) {
  const labels = lastSixMonths();
  const values = labels.map((label) =>
    items
      .filter((item) => item.transaction_type === type && monthLabel(item.created_at) === label)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
  );
  return { labels, values };
}

function monthlyUsers(users) {
  const labels = lastSixMonths();
  const values = labels.map((label) => users.filter((user) => monthLabel(user.created_at) === label).length);
  return { labels, values };
}

function lastSixMonths() {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - index));
    return monthLabel(date);
  });
}

function monthLabel(value) {
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(value));
}

function sumTransactions(type) {
  return state.transactions.filter((tx) => tx.transaction_type === type).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

function sumAdminTransactions(type) {
  return state.adminTransactions.filter((tx) => tx.transaction_type === type).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

function paginate(items, page) {
  const start = (page - 1) * state.pageSize;
  return items.slice(start, start + state.pageSize);
}

function renderPagination(selector, total, current, onPage) {
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  $(selector).innerHTML = Array.from({ length: pages }, (_, index) => {
    const page = index + 1;
    return `<button class="${page === current ? "active" : ""}" type="button">${page}</button>`;
  }).join("");
  $$(selector + " button").forEach((button, index) => button.addEventListener("click", () => onPage(index + 1)));
}

function detailRows(details) {
  return Object.entries(details)
    .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value || "Not available")}</dd></div>`)
    .join("");
}

function mask(value = "") {
  const text = String(value);
  return text.length > 4 ? `•••• •••• •••• ${text.slice(-4)}` : text;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function exportCsv(filename, rows) {
  if (!rows.length) return toast("No records to export.");
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((row) => headers.map((key) => JSON.stringify(row[key] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setFormLoading(form, loading) {
  form.querySelector(".button-label")?.classList.toggle("hidden", loading);
  form.querySelector(".spinner")?.classList.toggle("hidden", !loading);
}

function showLoading(show) {
  $("#loadingOverlay").classList.toggle("hidden", !show);
}

function toast(message) {
  const item = document.createElement("div");
  item.className = "toast-message";
  item.textContent = message;
  $("#toast").appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

function toggleTheme() {
  applyTheme(document.body.classList.contains("dark") ? "light" : "dark");
}

function applyTheme(theme) {
  document.body.classList.toggle("dark", theme === "dark");
  localStorage.setItem("secure-financial-theme", theme);
}
