let state = null;
let buildingsData = null;
let radarTargets = [];
let gameMessages = [];
let currentUnitFactoryView = null;
let contestedNodes = [];
let currentResearchLabTab = "research";
let currentUnitFactoryTab = "train";
let promoteAmountDraft = {};
let selectedTarget = null;
let selectedModules = new Set();
let selectedAi = new Set();
let selectedUnits = {};
let placedRadarSlots = [];
let activeOperations = [];
let radarScanRunId = 0;
let isRadarScanning = false;
let placedRadarPoints = [];
let operationQueueTimer = null;
let currentOperationViewId = null;

let engineerDrones = [
  { id: "engineer_1", name: "Engineer Drone #1", status: "idle" },
  { id: "engineer_2", name: "Engineer Drone #2", status: "idle" }
];
let telegramUser = null;
let telegramInitData = "";

function initTelegramMiniApp() {
  const tg = window.Telegram?.WebApp;

  if (!tg) {
    console.log("Not running inside Telegram WebApp");
    return null;
  }

  tg.ready();
  tg.expand();

  try {
    tg.setHeaderColor("#050a18");
    tg.setBackgroundColor("#050a18");
  } catch (err) {
    console.log("Telegram color setup skipped:", err);
  }

  telegramInitData = tg.initData || "";
  telegramUser = tg.initDataUnsafe?.user || null;

  console.log("Telegram user:", telegramUser);

  if (telegramUser?.id) {
    authTelegramUser();
  }

  return telegramUser;
}

async function authTelegramUser() {
  try {
    const user = telegramUser;

    const data = await api("/api/auth/telegram", {
      method: "POST",
      body: JSON.stringify({
        init_data: telegramInitData,
        user: {
          id: user.id,
          first_name: user.first_name || "",
          last_name: user.last_name || "",
          username: user.username || "",
          language_code: user.language_code || ""
        }
      })
    });

    console.log("Telegram auth success:", data);
  } catch (err) {
    console.log("Telegram auth failed:", err.message);
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }

  return res.json();
}

async function loadContestedNodes() {
  try {
    const data = await api("/api/contested-nodes");
    contestedNodes = data.nodes || [];
  } catch (err) {
    console.warn("Gagal load contested nodes:", err);
    contestedNodes = [];
  }
}

async function openNexusWarSheet() {
  if (!contestedNodes.length) {
    await loadContestedNodes();
  }

  const nodesHtml = contestedNodes.length
    ? contestedNodes.map(node => `
      <div class="nexus-card ${String(node.status || "").toLowerCase()}">
        <div class="nexus-top">
          <div>
            <div class="nexus-type">${node.type}</div>
            <h3>${node.name}</h3>
          </div>
          <span class="nexus-status">${node.status}</span>
        </div>

        <p class="muted">${node.description}</p>

        ${row("Coordinate", `X:${node.x} / Y:${node.y}`)}
        ${row("Opens", node.opens_in)}
        ${row("Duration", `${node.duration_minutes} minutes`)}
        ${row("Holder", node.current_holder)}
        ${row("Reward", node.reward)}

        <div class="sheet-actions">
          <button onclick="openNexusNode('${node.id}')">View Detail</button>
        </div>
      </div>
    `).join("")
    : `
      <div class="nexus-card">
        <h3>No Nexus Node</h3>
        <p class="muted">Belum ada weekly node tersedia.</p>
      </div>
    `;

  showBuildingSheet(
    "Nexus War",
    `
      <p class="muted">
        Guild saling berebut node selama waktu event. Guild yang memegang node
        sampai timer habis akan menjadi pemenang.
      </p>

      <div class="nexus-sheet-list">
        ${nodesHtml}
      </div>
    `
  );
}

function renderContestedNodes() {
  const box = el("contestedNodeList");
  if (!box) return;

  if (!contestedNodes.length) {
    box.innerHTML = `
      <div class="nexus-card">
        <h3>No Nexus Node</h3>
        <p class="muted">Belum ada weekly node aktif.</p>
      </div>
    `;
    return;
  }

  box.innerHTML = contestedNodes.map(node => `
    <div class="nexus-card ${node.status.toLowerCase()}">
      <div class="nexus-top">
        <div>
          <div class="nexus-type">${node.type}</div>
          <h3>${node.name}</h3>
        </div>
        <span class="nexus-status">${node.status}</span>
      </div>

      <p class="muted">${node.description}</p>

      ${row("Coordinate", `X:${node.x} / Y:${node.y}`)}
      ${row("Opens", node.opens_in)}
      ${row("Duration", `${node.duration_minutes} minutes`)}
      ${row("Holder", node.current_holder)}
      ${row("Occupants", `${node.occupants}/${node.max_occupants}`)}

      <div class="sheet-actions">
        <button onclick="openNexusNode('${node.id}')">View</button>
      </div>
    </div>
  `).join("");
}

function resetRadarPlacement() {
  placedRadarPoints = [];
  placedRadarSlots = [];
}

function clearRadarMarkers() {
  const markerBox = el("radarMarkers");
  if (markerBox) markerBox.innerHTML = "";

  resetRadarPlacement();
}

function separateRadarPosition(rawX, rawY, minGap = 62) {
  let x = rawX;
  let y = rawY;

  for (let loop = 0; loop < 20; loop++) {
    let moved = false;

    for (const p of placedRadarPoints) {
      const dx = x - p.x;
      const dy = y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minGap) {
        const angle = Math.atan2(dy || 1, dx || 1);
        const push = (minGap - dist) + 2;

        x += Math.cos(angle) * push;
        y += Math.sin(angle) * push;
        moved = true;
      }
    }

    if (!moved) break;
  }

  // batasi supaya tidak keluar radar
  x = Math.max(28, Math.min(272, x));
  y = Math.max(28, Math.min(272, y));

  placedRadarPoints.push({ x, y });
  return { x, y };
}

function openNexusNode(nodeId) {
  const node = contestedNodes.find(n => n.id === nodeId);
  if (!node) return;

  showBuildingSheet(
    node.name,
    `
      <p class="muted">${node.description}</p>

      ${row("Type", node.type)}
      ${row("Status", node.status)}
      ${row("Coordinate", `X:${node.x} / Y:${node.y}`)}
      ${row("Opens", node.opens_in)}
      ${row("Duration", `${node.duration_minutes} minutes`)}
      ${row("Current Holder", node.current_holder)}
      ${row("Reward", node.reward)}

      <div class="sheet-actions">
        <button disabled>Enter Nexus War Soon</button>
        <button disabled>Guild Rally Soon</button>
        <button onclick="openNexusWarSheet()">Back</button>
      </div>
    `
  );
}

function addGameMessage(source, title, text, meta = {}) {
  const msg = {
    id: `log_${Date.now()}_${Math.floor(Math.random() * 999999)}`,
    source,
    title,
    text,
    time: new Date().toLocaleTimeString(),
    createdAt: Date.now(),

    // optional data
    targetId: meta.targetId || null,
    targetName: meta.targetName || null,
    reportType: meta.reportType || source,
    canAskAi: Boolean(meta.canAskAi),
    rawReport: meta.rawReport || text,
    rawReportData: meta.rawReportData || null,
    aiPlan: meta.aiPlan || null,
  };

  gameMessages.unshift(msg);
  gameMessages = gameMessages.slice(0, 50);

  renderGameMessages();
}

function formatSeconds(seconds) {
  seconds = Math.max(0, Number(seconds || 0));

  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function getOperationRemaining(op) {
  if (!op) return 0;
  return Math.max(0, Math.ceil((op.endsAt - Date.now()) / 1000));
}

function getOperationProgress(op) {
  if (!op) return 0;

  const total = Math.max(1, op.totalSeconds);
  const remaining = getOperationRemaining(op);

  return Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
}

function getRunningOperations() {
  return activeOperations.filter(op => op.status === "running");
}

function getCompletedOperations() {
  return activeOperations.filter(op => op.status === "completed");
}

function startOperationQueueTimer() {
  if (operationQueueTimer) return;

  operationQueueTimer = setInterval(() => {
    updateOperations();
  }, 1000);
}

function renderOperationQueueList() {
  const box = el("operationQueueList");
  if (!box) return;

  finalizeExpiredOperations();

  const running = getRunningOperations();

  const runningHtml = running.length
    ? running.map(renderOperationCard).join("")
    : `
      <div class="operation-card">
        <div class="operation-type">RUNNING</div>
        <h3>No running operation</h3>
        <small>Semua operation selesai. Cek Battle Log untuk hasilnya.</small>
      </div>
    `;

  const engineerHtml = engineerDrones.map(drone => `
    <div class="operation-card engineer-idle">
      <div class="operation-type">ENGINEER DRONE</div>
      <h3>${drone.name}</h3>
      <small>Status: ${drone.status === "idle" ? "Idle" : "Working"}</small>
    </div>
  `).join("");

  box.innerHTML = `
    <h3>Running Operations</h3>
    ${runningHtml}

    <h3 style="margin-top:14px;">Engineer Drones</h3>
    ${engineerHtml}
  `;
}

function updateOperationQueueWidget() {
  const widget = el("operationQueueWidget");
  const title = el("operationQueueTitle");
  const subtitle = el("operationQueueSubtitle");
  const badge = el("operationQueueBadge");

  if (!widget) return;

  const running = getRunningOperations();

  if (running.length <= 0) {
    widget.classList.add("hidden");
    return;
  }

  widget.classList.remove("hidden");

  if (badge) badge.innerText = running.length;

  if (title) {
    title.innerText = `Operations ${running.length}`;
  }

  if (subtitle) {
    const next = running[0];
    subtitle.innerText = `${next.title} · ${formatSeconds(getOperationRemaining(next))} left`;
  }
}

function addScoutOperation(scoutResult, finalLogText, targetId) {
  const target =
    radarTargets.find(t => t.id === targetId) ||
    radarTargets.find(t => t.id === scoutResult.target_id);

  const outbound = Math.max(1, Number(scoutResult.outbound_seconds || 4));
  const returnSeconds = Math.max(1, Number(scoutResult.return_seconds || outbound));
  const total = outbound + returnSeconds;
  const now = Date.now();

  const op = {
    id: scoutResult.id || `sct_${now}`,
    type: "scout",
    status: "running",
    title: `Scouting ${target?.name || scoutResult.target_name || targetId}`,
    targetId: targetId || scoutResult.target_id,
    targetName: target?.name || scoutResult.target_name || "Unknown Target",
    distance: target?.distance || scoutResult.distance || "?",

    outboundSeconds: outbound,
    returnSeconds: returnSeconds,
    totalSeconds: total,

    startedAt: now,
    reachedAt: now + outbound * 1000,
    endsAt: now + total * 1000,

    result: scoutResult,
    finalLog: finalLogText
  };

  activeOperations.unshift(op);

  updateOperationQueueWidget();
  startOperationQueueTimer();

  openOperationQueueSheet();
}

function getOperationPhaseText(op) {
  const now = Date.now();

  if (op.type === "scout") {
    if (now < Number(op.reachedAt || 0)) {
      return "Going to target";
    }

    if (now < Number(op.endsAt || 0)) {
      return "Returning to base";
    }

    return "Report delivered";
  }

  return "Travelling";
}

function addAttackOperation(attackResult, finalLogText, targetId) {
  const target =
    radarTargets.find(t => t.id === targetId) ||
    radarTargets.find(t => t.id === attackResult.target_id);

  const total = Math.max(1, Number(attackResult.final_travel_seconds || 1));
  const now = Date.now();

  const op = {
    id: attackResult.id || `op_${now}`,
    type: "attack",
    status: "running",
    title: `Attacking ${target?.name || targetId || "Unknown Target"}`,
    targetId: targetId || attackResult.target_id,
    targetName: target?.name || targetId || "Unknown Target",
    distance: target?.distance || "?",
    totalSeconds: total,
    startedAt: now,
    endsAt: now + total * 1000,
    result: attackResult,
    finalLog: finalLogText
  };

  activeOperations.unshift(op);

  addGameMessage(
    "battle",
    "Attack Launched",
    `${op.title}
Distance: ${op.distance} Trace Unit
Travel Time: ${formatSeconds(total)}
Status: Units are travelling through the network route.`
  );

  updateOperationQueueWidget();
  startOperationQueueTimer();

  openOperationQueueSheet();
}

function renderGameMessages() {
  const box = el("battleLog");
  if (!box) return;

  if (!gameMessages.length) {
    box.innerHTML = `
      <div class="battle-inbox-empty">
        <b>No messages</b>
        <p class="muted">Scout report dan battle result akan muncul di sini.</p>
      </div>
    `;
    return;
  }

  box.innerHTML = gameMessages.map(m => `
    <button class="battle-message-card ${m.source}" onclick="openBattleLogMessage('${m.id}')">
      <div class="battle-message-icon">
        ${getBattleLogIcon(m.source)}
      </div>

      <div class="battle-message-content">
        <div class="battle-message-top">
          <b>${escapeHtml(m.title)}</b>
          <span>${escapeHtml(m.time)}</span>
        </div>

        <p>${escapeHtml(getBattleLogPreview(m.text))}</p>
      </div>

      <div class="battle-message-arrow">›</div>
    </button>
  `).join("");
}

function getBattleLogIcon(source) {
  if (source === "scout") return "◉";
  if (source === "battle") return "⚔";
  if (source === "ai") return "AI";
  if (source === "system") return "!";
  return "•";
}

function getBattleLogPreview(text) {
  const clean = String(text || "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "No detail available.";

  return clean.length > 90 ? `${clean.slice(0, 90)}...` : clean;
}

function getBattleLogById(logId) {
  return gameMessages.find(m => String(m.id) === String(logId));
}

function openBattleLogMessage(logId) {
  const msg = getBattleLogById(logId);

  if (!msg) {
    showBuildingSheet(
      "Log Not Found",
      `
        <p class="muted">Pesan log ini sudah tidak tersedia.</p>
        <div class="sheet-actions">
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      `
    );
    return;
  }
  if (msg.reportType === "scout" || msg.source === "scout") {
    openScoutIntelMessage(msg);
    return;
  }

  const askAiButton = msg.canAskAi && msg.targetId
    ? `<button onclick="askAiFromLog('${msg.id}')">Ask AI</button>`
    : `<button disabled>Ask AI</button>`;

  showBuildingSheet(
    msg.title,
    `
      <div class="battle-log-detail-head">
        <span class="battle-log-detail-type">${msg.source.toUpperCase()}</span>
        <span>${escapeHtml(msg.time)}</span>
      </div>

      <pre class="battle-result-pre">${escapeHtml(msg.rawReport || msg.text)}</pre>

      <div class="sheet-actions">
        ${askAiButton}
        <button onclick="shareBattleLog('${msg.id}')">Bagikan</button>
        <button onclick="closeBuildingSheet()">Close</button>
      </div>
    `
  );
}

function openScoutIntelMessage(msg) {
  const askAiButton = msg.canAskAi && msg.targetId
    ? `<button onclick="askAiFromLog('${msg.id}')">Ask AI</button>`
    : `<button disabled>Ask AI</button>`;

  showBuildingSheet(
    msg.title,
    `
      ${renderScoutIntelReport(msg)}

      <div class="sheet-actions scout-report-actions">
        ${askAiButton}
        <button onclick="shareBattleLog('${msg.id}')">Bagikan</button>
        <button onclick="closeBuildingSheet()">Close</button>
      </div>
    `
  );
}

function getScoutReportData(msg) {
  return msg.rawReportData || {};
}

function scoutValue(value, fallback = "Unknown") {
  if (value === null || value === undefined || value === "") return fallback;
  return value;
}

function renderScoutIntelReport(msg) {
  const r = getScoutReportData(msg);

  const name = scoutValue(r.name, msg.targetName || "Unknown Target");
  const distance = scoutValue(r.distance, "?");
  const labLevel = scoutValue(r.lab_level, "Unknown");
  const baseTier = scoutValue(r.base_tier, "Unknown");
  const power = scoutValue(r.estimated_power, "Unknown");
  const noise = scoutValue(r.noise, "Unknown");
  const defenseStyle = scoutValue(r.defense_style, "Unknown");

  return `
    <div class="scout-intel-header slim-intel-header">
        <div>
          <small>INTEL REPORT</small>
          <h2>${escapeHtml(name)}</h2>
          <p>Target scan completed</p>
        </div>

        <div class="intel-target-visual">
          <span>${getIntelTargetMark(name)}</span>
        </div>
      </div>

      <div class="intel-summary-grid compact-intel-grid">
        <div>
          <small>Lab</small>
          <b>Lv.${escapeHtml(String(labLevel))}</b>
        </div>

        <div>
          <small>Noise</small>
          <b>${escapeHtml(String(noise))}</b>
        </div>

        <div>
          <small>Power</small>
          <b>${escapeHtml(String(power))}</b>
        </div>
      </div>

      <div class="intel-meta-strip">
        <span>Tier: <b>${escapeHtml(String(baseTier))}</b></span>
        <span>Distance: <b>${escapeHtml(String(distance))}</b> Trace Unit</span>
      </div>

      ${renderScoutDroneBlock(r)}
      ${renderScoutEnemyArmyBlock(r.enemy_army)}
      ${renderScoutDefenseBuildBlock(r)}
      ${renderScoutResourcesBlock(r.resources)}

      
    </div>
  `;
}

function getIntelTargetMark(name) {
  const text = String(name || "NODE").trim();

  if (!text) return "ND";

  const parts = text.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return text.slice(0, 2).toUpperCase();
}

function renderScoutDroneBlock(r) {
  const noise = scoutValue(r.noise, "Unknown");
  const status = scoutValue(r.counter_scout_status, "Scout data processed");

  return `
    <div class="intel-section">
      <div class="intel-section-title">
        <h3>Scout Drone</h3>
        <span>${escapeHtml(String(noise))} Noise</span>
      </div>

      <div class="scout-drone-card">
        <div class="scout-drone-visual">
          <span>SC</span>
        </div>

        <div>
          <b>Recon Drone</b>
          <p class="muted">${escapeHtml(String(status))}</p>
          <small>Report quality depends on Scout level and enemy jammer.</small>
        </div>
      </div>
    </div>
  `;
}

function renderScoutEnemyArmyBlock(army) {
  if (!Array.isArray(army) || !army.length) {
    return `
      <div class="intel-section">
        <div class="intel-section-title">
          <h3>Enemy Army</h3>
          <span>Unknown</span>
        </div>
        <p class="muted">Army data not available.</p>
      </div>
    `;
  }

  return `
    <div class="intel-section">
      <div class="intel-section-title">
        <h3>Enemy Army</h3>
        <span>${army.length} stack</span>
      </div>

      <div class="enemy-army-grid">
        ${army.map(unit => renderEnemyArmyCard(unit)).join("")}
      </div>
    </div>
  `;
}

function renderEnemyArmyCard(unit) {
  const name = scoutValue(unit.name, "Unknown");
  const level = scoutValue(unit.level, "?");
  const count = scoutValue(unit.count, "?");
  const role = scoutValue(unit.role, "Unit");

  return `
    <div class="enemy-unit-card">
      <div class="enemy-unit-art">
        ${renderEnemyUnitVisual(unit)}
      </div>

      <div class="enemy-unit-info">
        <b>${escapeHtml(String(name))}</b>
        <span>Lv.${escapeHtml(String(level))} × ${escapeHtml(String(count))}</span>
        <small>${escapeHtml(String(role))}</small>
      </div>
    </div>
  `;
}

function renderEnemyUnitVisual(unit) {
  const id = String(unit.id || "").toLowerCase();
  const level = Number(unit.level || 1);

  if (id === "breaker") {
    return `<img src="assets/units/breaker/lv${Math.max(1, Math.min(5, level))}.png" alt="Breaker">`;
  }

  const label = String(unit.name || "??").slice(0, 2).toUpperCase();

  return `<span>${escapeHtml(label)}</span>`;
}

function renderScoutDefenseBuildBlock(r) {
  const buildName = scoutValue(r.enemy_build, "Unknown Build");
  const modules = Array.isArray(r.defense_modules) ? r.defense_modules : [];

  return `
    <div class="intel-section">
      <div class="intel-section-title">
        <h3>Defense Build</h3>
        <span>${escapeHtml(String(buildName))}</span>
      </div>

      <div class="defense-build-row">
        ${modules.length
          ? modules.map(m => renderDefenseModuleIcon(m)).join("")
          : `<p class="muted">Defense modules unknown.</p>`
        }
      </div>
    </div>
  `;
}

function renderDefenseModuleIcon(moduleName) {
  const icon = getDefenseModuleIcon(moduleName);

  return `
    <button
      class="defense-module-icon"
      onclick="openDefenseModuleInfo('${encodeURIComponent(moduleName)}')"
    >
      <span>${icon}</span>
      <small>${escapeHtml(String(moduleName))}</small>
    </button>
  `;
}

function getDefenseModuleIcon(moduleName) {
  const name = String(moduleName || "").toLowerCase();

  if (name.includes("firewall")) return "FW";
  if (name.includes("trap")) return "TR";
  if (name.includes("sentinel")) return "SN";
  if (name.includes("trace")) return "TC";
  if (name.includes("repair")) return "RP";
  if (name.includes("vault")) return "VT";

  return "DF";
}

function openDefenseModuleInfo(encodedName) {
  const name = decodeURIComponent(encodedName || "");
  const info = getDefenseModuleInfo(name);

  showBuildingSheet(
    name || "Defense Module",
    `
      <div class="module-info-card">
        <div class="module-info-icon">${getDefenseModuleIcon(name)}</div>
        <p class="muted">${escapeHtml(info.description)}</p>

        ${row("Role", escapeHtml(info.role))}
        ${row("Counter", escapeHtml(info.counter))}

        <div class="sheet-actions">
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      </div>
    `
  );
}

function getDefenseModuleInfo(moduleName) {
  const name = String(moduleName || "").toLowerCase();

  if (name.includes("firewall")) {
    return {
      role: "Blocks direct breach damage",
      counter: "Firewall Breaker",
      description: "Firewall Core mempertebal pertahanan awal dan mengurangi efektivitas breach langsung."
    };
  }

  if (name.includes("trap")) {
    return {
      role: "Disables fast or careless units",
      counter: "Trap Disruptor",
      description: "Trap Net membuat unit penyerang berisiko terkena disable sebelum damage utama masuk."
    };
  }

  if (name.includes("sentinel")) {
    return {
      role: "Balanced unit interception",
      counter: "Breach Payload / Balanced Build",
      description: "Sentinel menjaga base dari serangan seimbang dan memberi tekanan pada unit lemah."
    };
  }

  if (name.includes("trace")) {
    return {
      role: "Raises attacker trace",
      counter: "Relay Booster / Route Stabilizer",
      description: "Trace Monitor meningkatkan risiko trace exposure saat serangan berlangsung."
    };
  }

  if (name.includes("repair")) {
    return {
      role: "Sustain and recovery",
      counter: "Breach Payload",
      description: "Repair Node membantu pertahanan bertahan lebih lama saat battle berlangsung."
    };
  }

  if (name.includes("vault")) {
    return {
      role: "Protects resources",
      counter: "Data Extractor / Breach Payload",
      description: "Vault Guard melindungi resource dan membuat raid lebih sulit menghasilkan loot maksimal."
    };
  }

  return {
    role: "Unknown defense role",
    counter: "Scout more data",
    description: "Informasi module ini belum lengkap. Upgrade Scout untuk membaca detail lebih akurat."
  };
}

function renderScoutResourcesBlock(resources) {
  const r = resources || {};

  return `
    <div class="intel-section">
      <div class="intel-section-title">
        <h3>Detected Resources</h3>
        <span>Vault Signal</span>
      </div>

      <div class="intel-resource-grid">
        ${renderIntelResource("Credits", r.credits, "CR")}
        ${renderIntelResource("Data", r.data_shard, "DS")}
        ${renderIntelResource("Nano", r.nano_parts, "NP")}
        ${renderIntelResource("Nexus", r.nexus_core, "NX")}
      </div>
    </div>
  `;
}

function renderIntelResource(label, value, icon) {
  return `
    <div class="intel-resource-card">
      <span>${icon}</span>
      <small>${escapeHtml(label)}</small>
      <b>${escapeHtml(String(scoutValue(value, "???")))}</b>
    </div>
  `;
}

async function askAiFromLog(logId) {
  const msg = getBattleLogById(logId);

  if (!msg || !msg.targetId) {
    showBuildingSheet(
      "Ask AI Failed",
      `
        <p class="muted">Log ini tidak punya target data untuk dianalisa AI.</p>
        <div class="sheet-actions">
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      `
    );
    return;
  }

  try {
    const preferredAi = selectedAi.has("ora") ? "ora" : [...selectedAi][0] || "nova_lite";

    const data = await api("/api/ai/analyze", {
      method: "POST",
      body: JSON.stringify({
        target_id: msg.targetId,
        ai_id: preferredAi
      })
    });

    const rec = data.recommendation;

    const text = [
      `${data.ai.name}: Analyzing scout report...`,
      `Source Log: ${msg.title}`,
      `Confidence: ${data.confidence}%`,
      "",
      `Analysis: ${data.analysis}`,
      data.missing_data.length ? `Missing Data: ${data.missing_data.join(", ")}` : "Missing Data: none",
      "",
      `Recommended Build: ${rec.recommended_build}`,
      `Recommended Modules: ${rec.recommended_modules.join(", ")}`,
      `Recommended AI: ${rec.recommended_ai}`,
      rec.warning ? `Warning: ${rec.warning}` : "",
      "",
      "Active Buff Preview:",
      Object.entries(data.active_buffs_preview)
        .map(([k, v]) => `- ${k}: ${v > 0 ? "+" : ""}${v}%`)
        .join("\n")
    ].filter(Boolean).join("\n");

    addGameMessage("ai", "AI Analysis", text, {
      targetId: msg.targetId,
      targetName: msg.targetName,
      reportType: "ai",
      canAskAi: false,
      rawReport: text
    });

    showBuildingSheet(
      "AI Analysis",
      `
        <div class="battle-log-detail-head">
          <span class="battle-log-detail-type">AI ANALYSIS</span>
          <span>From Scout Log</span>
        </div>

        <pre class="battle-result-pre">${escapeHtml(text)}</pre>

        <div class="sheet-actions">
          <button onclick="closeBuildingSheet()">Close</button>
          <button onclick="closeBuildingSheet(); switchPage('logPage')">Open Battle Log</button>
        </div>
      `
    );
  } catch (err) {
    showBuildingSheet(
      "Ask AI Failed",
      `
        <p class="muted">${escapeHtml(err.message)}</p>
        <div class="sheet-actions">
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      `
    );
  }
}

function shareBattleLog(logId) {
  const msg = getBattleLogById(logId);

  showBuildingSheet(
    "Bagikan",
    `
      <p class="muted">
        Fitur bagikan belum aktif. Nanti tombol ini bisa dipakai untuk share scout report
        ke guild, chat, atau clipboard.
      </p>

      ${msg ? row("Log", msg.title) : ""}

      <div class="sheet-actions">
        <button onclick="closeBuildingSheet()">Close</button>
      </div>
    `
  );
}

function showAttackTravelSheet(attackResult, finalLogText, targetId) {
  addAttackOperation(attackResult, finalLogText, targetId);
}

function openOperationQueueSheet() {
  startOperationQueueTimer();
  finalizeExpiredOperations();
  updateOperationQueueWidget();

  showBuildingSheet(
    "Command Queue",
    `
      <p class="muted">
        Semua aktivitas berjalan masuk di sini: attack, engineer drone, research, training, dan recovery.
      </p>

      <div id="operationQueueList"></div>
    `
  );

  renderOperationQueueList();
}

function renderOperationQueueList() {
  const box = el("operationQueueList");
  if (!box) return;

  const running = getRunningOperations();
  const completed = getCompletedOperations();

  const runningHtml = running.length
    ? running.map(renderOperationCard).join("")
    : `
      <div class="operation-card">
        <div class="operation-type">RUNNING</div>
        <h3>No running operation</h3>
        <small>Belum ada aktivitas berjalan.</small>
      </div>
    `;

  const completedHtml = completed.length
    ? completed.map(renderOperationCard).join("")
    : "";

  const engineerHtml = engineerDrones.map(drone => `
    <div class="operation-card engineer-idle">
      <div class="operation-type">ENGINEER DRONE</div>
      <h3>${drone.name}</h3>
      <small>Status: ${drone.status === "idle" ? "Idle" : "Working"}</small>
    </div>
  `).join("");

  box.innerHTML = `
    <h3>Running</h3>
    ${runningHtml}

    <h3 style="margin-top:14px;">Completed</h3>
    ${completedHtml || `<p class="muted">Belum ada operation selesai.</p>`}

    <h3 style="margin-top:14px;">Engineer Drones</h3>
    ${engineerHtml}
  `;
}

function getOperationPhaseText(op) {
  const now = Date.now();

  if (op.type === "scout") {
    if (now < Number(op.reachedAt || 0)) {
      return "Going to target";
    }

    if (now < Number(op.endsAt || 0)) {
      return "Returning to base";
    }

    return "Report delivered";
  }

  return "Travelling";
}

function renderOperationCard(op) {
  const remaining = getOperationRemaining(op);
  const progress = getOperationProgress(op);

  return `
    <div class="operation-card" data-op-id="${op.id}">
      <div class="operation-type">${op.type.toUpperCase()}</div>
      <h3>${op.title}</h3>

      ${
        op.type === "scout"
          ? `<small id="opPhase_${op.id}" class="muted">${getOperationPhaseText(op)}</small>`
          : ""
      }

      <small>
        <span id="opRemain_${op.id}" class="operation-status-running">
          ${formatSeconds(remaining)} remaining
        </span>
      </small>

      <small>Distance: ${op.distance} Trace Unit</small>

      <div class="operation-progress">
        <div id="opProgress_${op.id}" style="width:${progress}%"></div>
      </div>

      <div class="sheet-actions">
        <button onclick="openOperationDetail('${op.id}')">View</button>
      </div>
    </div>
  `;
}

function updateOperationQueueSheetLive() {
  if (!el("operationQueueList")) return;

  finalizeExpiredOperations();

  const running = getRunningOperations();

  running.forEach(op => {
    const remainBox = el(`opRemain_${op.id}`);
    const progressBox = el(`opProgress_${op.id}`);
    const phaseBox = el(`opPhase_${op.id}`);

    if (remainBox) {
      remainBox.innerText = `${formatSeconds(getOperationRemaining(op))} remaining`;
    }

    if (phaseBox && op.type === "scout") {
      phaseBox.innerText = getOperationPhaseText(op);
    }

    if (progressBox) {
      progressBox.style.width = `${getOperationProgress(op)}%`;
    }
  });

  if (running.length <= 0) {
    renderOperationQueueList();
  }
}

function finalizeExpiredOperations() {
  const expired = activeOperations.filter(op => {
    return op.status === "running" && getOperationRemaining(op) <= 0;
  });

  if (!expired.length) return;

  expired.forEach(op => {
    if (op.type === "scout") {
      addGameMessage(
        "scout",
        "Scout Report Completed",
        `${op.title}
Target: ${op.targetName || "Unknown"}
Distance: ${op.distance} Trace Unit

${op.finalLog}`,
        {
          targetId: op.targetId,
          targetName: op.targetName,
          reportType: "scout",
          canAskAi: true,
          rawReport: op.finalLog,
          rawReportData: op.result?.report || null
        }
      );

      if (currentOperationViewId === op.id) {
        currentOperationViewId = null;
        closeBuildingSheet();
      }

      return;
    }

    addGameMessage(
      "battle",
      "Battle Completed",
      `${op.title}
Target: ${op.targetName || "Unknown"}
Distance: ${op.distance} Trace Unit

${op.finalLog}`
    );

    if (currentOperationViewId === op.id) {
      currentOperationViewId = null;
      showBattleResultSheet(op.finalLog, false);
    }
  });

  activeOperations = activeOperations.filter(op => {
    return !expired.some(done => done.id === op.id);
  });
}

function updateOperations() {
  finalizeExpiredOperations();

  updateOperationQueueWidget();
  updateOperationQueueSheetLive();
  updateOperationDetailLive();
}

function openOperationDetail(opId) {
  const op = activeOperations.find(o => o.id === opId);
  if (!op) return;

  currentOperationViewId = op.id;

  showBuildingSheet(
    op.type === "scout" ? "Scout Drone Travelling" : "Attack Travelling",
    `
      <div class="attack-visual">
        <div class="attack-line"></div>
        <div class="attack-node home">Your<br>Lab</div>
        <div class="attack-node target">Target<br>Lab</div>
        <div class="attack-packet"></div>
      </div>

      <p class="muted">
        ${op.type === "scout"
          ? `Phase: ${getOperationPhaseText(op)}
        Scout drone harus pergi ke target, membaca signal, lalu kembali ke base sebelum report tersedia.`
          : "Unit sedang bergerak melalui network route. Battle result akan tersedia saat sampai target."
        }
      </p>

      <div class="row"><span>Target</span><span>${op.targetName}</span></div>
      <div class="row"><span>Distance</span><span>${op.distance} Trace Unit</span></div>
      <div class="row"><span>Total Travel</span><span>${formatSeconds(op.totalSeconds)}</span></div>

      <div id="operationDetailCountdown" class="travel-countdown">
        ${formatSeconds(getOperationRemaining(op))}
      </div>

      <div class="travel-bar">
        <div id="operationDetailProgress" class="travel-bar-fill" style="width:${getOperationProgress(op)}%"></div>
      </div>

      <div class="sheet-actions">
        <button onclick="closeBuildingSheet()">Hide</button>
        <button onclick="openOperationQueueSheet()">Back to Queue</button>
      </div>
    `
  );
}

function updateOperationDetailLive() {
  if (!currentOperationViewId) return;

  const op = activeOperations.find(o => o.id === currentOperationViewId);
  if (!op) return;

  const countdown = el("operationDetailCountdown");
  const progress = el("operationDetailProgress");

  if (countdown) {
    countdown.innerText = op.status === "completed"
      ? "Completed"
      : formatSeconds(getOperationRemaining(op));
  }

  if (progress) {
    progress.style.width = `${getOperationProgress(op)}%`;
  }
}

function openOperationResult(opId) {
  const op = activeOperations.find(o => o.id === opId);
  if (!op) return;

  showBattleResultSheet(op.finalLog, false);
}

function getActiveAttackRemaining() {
  if (!activeAttack) return 0;

  return Math.max(0, Math.ceil((activeAttack.ends_at - Date.now()) / 1000));
}

function getActiveAttackProgress() {
  if (!activeAttack) return 0;

  const total = activeAttack.total_seconds;
  const remaining = getActiveAttackRemaining();

  return Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
}

function startActiveAttackTimer() {
  updateActiveAttackWidget();

  activeTravelTimer = setInterval(() => {
    updateActiveAttackWidget();
    updateActiveAttackSheetLive();

    if (!activeAttack) return;

    const remaining = getActiveAttackRemaining();

    if (remaining <= 0) {
      clearInterval(activeTravelTimer);
      activeTravelTimer = null;

      const finalLog = activeAttack.final_log;

      addGameMessage(
        "battle",
        "Battle Completed",
        `Attack arrived at target: ${activeAttack.target_name}.
Battle report generated.`
      );

      activeAttack = null;
      updateActiveAttackWidget();

      showBattleResultSheet(finalLog);
    }
  }, 1000);
}

function updateActiveAttackWidget() {
  const widget = el("activeAttackWidget");
  const title = el("activeAttackTitle");
  const time = el("activeAttackTime");
  const progress = el("activeAttackProgress");

  if (!widget) return;

  if (!activeAttack) {
    widget.classList.remove("show");
    return;
  }

  const remaining = getActiveAttackRemaining();
  const percent = getActiveAttackProgress();

  widget.classList.add("show");

  if (title) {
    title.innerText = `Attacking ${activeAttack.target_name}`;
  }

  if (time) {
    time.innerText = `${remaining}s remaining · ${activeAttack.distance} Trace Unit`;
  }

  if (progress) {
    progress.style.width = `${percent}%`;
  }
}
function openActiveAttackSheet() {
  if (!activeAttack) {
    alert("Tidak ada attack aktif.");
    return;
  }

  const remaining = getActiveAttackRemaining();
  const progress = getActiveAttackProgress();

  showBuildingSheet(
    "Attack Travelling",
    `
      <div class="attack-visual">
        <div class="attack-line"></div>
        <div class="attack-node home">Your<br>Lab</div>
        <div class="attack-node target">Target<br>Lab</div>
        <div class="attack-packet"></div>
      </div>

      <p class="muted">
        Unit sedang bergerak melalui network route. Battle result akan muncul saat sampai target.
      </p>

      <div class="row"><span>Target</span><span>${activeAttack.target_name}</span></div>
      <div class="row"><span>Distance</span><span>${activeAttack.distance} Trace Unit</span></div>
      <div class="row"><span>Total Travel</span><span>${activeAttack.total_seconds}s</span></div>

      <div id="travelCountdown" class="travel-countdown">${remaining}s</div>

      <div class="travel-bar">
        <div id="travelBarFill" class="travel-bar-fill" style="width:${progress}%"></div>
      </div>

      <div class="sheet-actions">
        <button onclick="closeBuildingSheet()">Hide</button>
        <button onclick="closeBuildingSheet(); switchPage('logPage')">Open Log</button>
      </div>
    `
  );
}

function updateActiveAttackSheetLive() {
  if (!activeAttack) return;

  const countdown = el("travelCountdown");
  const fill = el("travelBarFill");

  if (countdown) {
    countdown.innerText = `${getActiveAttackRemaining()}s`;
  }

  if (fill) {
    fill.style.width = `${getActiveAttackProgress()}%`;
  }
}

function el(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const node = el(id);
  if (node) node.innerText = text;
}

function fmtBuffs(buffs) {
  return Object.entries(buffs || {}).map(([k, v]) => {
    const sign = v > 0 ? "+" : "";
    return `<span class="badge ${v < 0 ? "warn" : "good"}">${k}: ${sign}${v}%</span>`;
  }).join(" ");
}

function row(label, value) {
  return `<div class="row"><span>${label}</span><span>${Array.isArray(value) ? value.join(", ") : value}</span></div>`;
}

function statusIcon(name) {
  return `<img src="assets/icons/${name}.png" alt="${name}" onerror="this.style.display='none'">`;
}

function renderStatusChip(icon, label, value, className = "") {
  return `
    <button class="status-chip icon-only-status ${className}" onclick="showResourceInfo('${label}')">
      ${statusIcon(icon)}
      <b>${value}</b>
    </button>
  `;
}

const RESOURCE_INFO = {
  Energy: "Energy dipakai untuk scan, attack, dan aktivitas operasi.",
  Credits: "Credits dipakai untuk speedup dan fitur convenience.",
  Data: "Data Shard dipakai untuk research dan teknologi.",
  Nano: "Nano Parts dipakai untuk train, promote, repair, dan upgrade unit.",
  Nexus: "Nexus Core adalah resource rare untuk upgrade penting atau fitur ekonomi khusus."
};

function showResourceInfo(label) {
  const text = RESOURCE_INFO[label] || "Resource game.";

  let toast = el("resourceToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "resourceToast";
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <b>${label}</b>
    <small>${text}</small>
  `;

  toast.classList.add("show");

  clearTimeout(window.resourceToastTimer);
  window.resourceToastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

function renderPlayerStatusHtml(p) {
  const r = getResourceBag();

  return `
    <div class="status-chip-grid">
      ${renderStatusChip("credits", "Credits", num(p.credits))}
      ${renderStatusChip("data_shard", "Data", num(r.data_shard))}
      ${renderStatusChip("nano_parts", "Nano", num(r.nano_parts))}
      ${renderStatusChip("nexus_core", "Nexus", num(r.nexus_core))}
    </div>
  `;
}

async function loadState() {
  state = await api("/api/state");

  const p = state.player;

  selectedAi = new Set(p.active_ai || []);

  const statusBox = el("playerStatus");
  if (statusBox) {
    statusBox.innerHTML = renderPlayerStatusHtml(p);
  }

  renderModules();
  renderUnits();
  renderAiInventory();
  renderAttackAiList();

  await loadBuildings();
}

async function loadBuildings() {
  buildingsData = await api("/api/buildings");
  renderBaseBuildings();
}

function renderBaseBuildings() {
  const baseGrid = el("baseGrid");
  if (!baseGrid || !buildingsData) return;

  const order = [
    "radar_tower",
    "unit_factory",
    "main_lab",
    "ai_core",
    "research_lab",
    "recovery_center",
    "guild_gate"
  ];

  baseGrid.innerHTML = order.map(id => {
    const b = buildingsData.buildings[id];
    if (!b) return "";

    const levelText = b.locked ? "Locked" : `Lv.${b.level}`;
    const lockedClass = b.locked ? "locked-building" : "";

    return `
      <div class="building-slot">
        <div class="building ${id} ${lockedClass}" onclick="openBuilding('${id}')">
          <img src="${b.asset}" alt="${b.name}">
          <div class="building-name">${b.name}</div>
          <div class="building-level">${levelText}</div>
        </div>
      </div>
    `;
  }).join("");
}

function showBuildingSheet(title, html) {
  const sheet = el("buildingSheet");
  const backdrop = el("sheetBackdrop");
  const titleBox = el("buildingSheetTitle");
  const body = el("buildingSheetBody");

  if (!sheet || !backdrop || !titleBox || !body) return;

  titleBox.innerText = title;
  body.innerHTML = html;

  backdrop.classList.add("show");
  sheet.classList.add("show");
}

function closeBuildingSheet() {
  const sheet = el("buildingSheet");
  const backdrop = el("sheetBackdrop");

  if (sheet) sheet.classList.remove("show");
  if (backdrop) backdrop.classList.remove("show");
}

function openRadarUpgradeSheet() {
  const radar = buildingsData?.buildings?.radar_tower;
  const player = state?.player || {};

  showBuildingSheet(
    "Radar Tower Upgrade",
    `
      <p class="muted">
        Upgrade Radar meningkatkan radius scan dan membuka informasi target yang lebih detail.
      </p>

      ${row("Current Radar", radar ? `Lv.${radar.level}` : "Unknown")}
      ${row("Scanner", `Lv.${player.scanner_level || 1}`)}
      ${row("Scout", `Lv.${player.scout_level || 1}`)}

      <div class="sheet-actions">
        <button disabled>Upgrade Radar Soon</button>
        <button disabled>Upgrade Scout Soon</button>
        <button onclick="closeBuildingSheet()">Close</button>
      </div>
    `
  );
}

let currentAiCoreTab = "agents";

function renderAiCoreTabs(activeTab) {
  const tabs = [
    { id: "agents", label: "Agents" },
    { id: "upgrade", label: "Upgrade" },
    { id: "sync", label: "Sync" }
  ];

  return `
    <div class="facility-tabs">
      ${tabs.map(tab => `
        <button
          class="${activeTab === tab.id ? "active" : ""}"
          onclick="renderAiCoreSheet('${tab.id}')"
        >
          ${tab.label}
        </button>
      `).join("")}
    </div>
  `;
}

function getAiCoreBuilding() {
  return buildingsData?.buildings?.ai_core || {
    name: "AI Core",
    level: state?.player?.ai_core_level || 1
  };
}

function renderAiCoreSheet(tab = "agents") {
  if (!state) return;

  currentAiCoreTab = tab;

  const core = getAiCoreBuilding();
  const level = Number(core.level || state.player.ai_core_level || 1);
  const maxSlot = Number(state.player.ai_core_level || level || 1);

  let body = "";

  if (tab === "agents") {
    body = renderAiCoreAgentsTab(maxSlot);
  } else if (tab === "upgrade") {
    body = renderAiCoreUpgradeTab(core, level);
  } else {
    body = renderAiCoreSyncTab(maxSlot);
  }

  showBuildingSheet(
    `AI Core Lv.${level}`,
    `
      ${renderAiCoreTabs(tab)}
      ${body}
    `
  );
}

function renderAiCoreAgentsTab(maxSlot) {
  const agents = Object.entries(state.ai_agents || {});

  if (!agents.length) {
    return `<p class="muted">Belum ada AI Agent.</p>`;
  }

  return `
    <div class="ai-core-summary">
      <div>
        <small>Active Slot</small>
        <b>${selectedAi.size}/${maxSlot}</b>
      </div>
      <div>
        <small>Owned AI</small>
        <b>${agents.length}</b>
      </div>
    </div>

    <div class="ai-core-agent-list">
      ${agents.map(([id, ai]) => {
        const active = selectedAi.has(id);

        return `
          <div class="ai-core-agent-card ${active ? "active" : ""}" onclick="toggleAiFromCore('${id}')">
            <div class="ai-agent-orb">
              <span>${String(ai.name || id).slice(0, 2).toUpperCase()}</span>
            </div>

            <div class="ai-agent-info">
              <div class="ai-agent-title">
                <h3>${ai.name}</h3>
                <span>${active ? "Active" : "Inactive"}</span>
              </div>

              <p>${ai.category} · ${ai.rarity}</p>
              <small>Lv.${ai.level} / ${ai.star}-Star</small>

              <div class="ai-buff-list">
                ${fmtBuffs(ai.buffs)}
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderAiCoreUpgradeTab(core, level) {
  const nextLevel = level + 1;

  const dataCost = 350 * level;
  const nexusCost = level >= 3 ? 1 : 0;

  return `
    <div class="facility-upgrade-card">
      <h3>Upgrade AI Core</h3>
      <p class="muted">
        Upgrade AI Core menambah slot AI aktif dan meningkatkan efisiensi AI Sync.
      </p>

      ${row("Current Level", `Lv.${level}`)}
      ${row("Next Level", `Lv.${nextLevel}`)}
      ${row("Current Slot", `${state.player.ai_core_level} Active AI`)}
      ${row("Next Effect", `+1 Active AI Slot`)}

      <div class="upgrade-cost-box">
        <h3>Upgrade Cost</h3>
        <div class="upgrade-cost-row">
          <span>Data Shard</span>
          <b>${dataCost}</b>
        </div>
        <div class="upgrade-cost-row">
          <span>Nexus Core</span>
          <b>${nexusCost}</b>
        </div>
      </div>

      <div class="sheet-actions">
        <button disabled>Upgrade AI Core Soon</button>
      </div>
    </div>
  `;
}

function renderAiCoreSyncTab(maxSlot) {
  const activeAgents = [...selectedAi]
    .map(id => state.ai_agents?.[id])
    .filter(Boolean);

  return `
    <div class="facility-upgrade-card">
      <h3>AI Sync</h3>
      <p class="muted">
        AI Sync adalah pusat buff dari AI yang aktif. Semakin tinggi AI Core,
        semakin banyak AI yang bisa bekerja bersamaan.
      </p>

      ${row("Active Slot", `${selectedAi.size}/${maxSlot}`)}
      ${row("Active AI", activeAgents.map(ai => ai.name).join(", ") || "None")}

      <h3 style="margin-top:14px;">Active Buff Preview</h3>

      <div class="ai-sync-buffs">
        ${
          activeAgents.length
            ? activeAgents.map(ai => `
                <div class="sync-ai-block">
                  <b>${ai.name}</b>
                  <div>${fmtBuffs(ai.buffs)}</div>
                </div>
              `).join("")
            : `<p class="muted">Belum ada AI aktif.</p>`
        }
      </div>
    </div>
  `;
}

function openBuilding(buildingId) {
  if (!buildingsData) return;

  const b = buildingsData.buildings[buildingId];

  if (!b) {
    showBuildingSheet("Unknown Building", "Building not found.");
    return;
  }
  if (buildingId === "radar_tower") {
    closeBuildingSheet();
    switchPage("radarPage");
    return;
  }

  if (buildingId === "ai_core") {
    renderAiCoreSheet("agents");
    return;
  }

  if (buildingId === "unit_factory") {
    renderUnitFactorySheet();
    return;
  }

  if (buildingId === "research_lab") {
    renderResearchLabSheet();
    return;
  }

  const levelText = b.locked ? "LOCKED" : `Lv.${b.level}`;

  let actionHtml = "";

  if (buildingId === "radar_tower") {
    actionHtml = `
      <div class="sheet-actions">
        <button onclick="closeBuildingSheet(); switchPage('radarPage')">Open Radar</button>
        <button disabled>Upgrade Scanner Soon</button>
      </div>
    `;
  } else if (buildingId === "ai_core") {
    actionHtml = `
      <div class="sheet-actions">
        <button onclick="closeBuildingSheet(); switchPage('aiPage')">Open AI Core</button>
        <button disabled>Upgrade AI Core Soon</button>
      </div>
    `;
  } else if (buildingId === "guild_gate" && b.locked) {
    actionHtml = `
      <div class="sheet-actions">
        <button disabled>Locked</button>
      </div>
    `;
  } else {
    actionHtml = `
      <div class="sheet-actions">
        <button disabled>Upgrade Soon</button>
        <button disabled>View Stats Soon</button>
      </div>
    `;
  }

  showBuildingSheet(
    `${b.name} ${levelText}`,
    `
      <p class="muted">${b.description}</p>

      <div class="row"><span>Status</span><span>${b.locked ? "Locked" : "Active"}</span></div>
      <div class="row"><span>Level</span><span>${b.locked ? "-" : b.level}</span></div>

      ${actionHtml}
    `
  );
}

function num(v) {
  return Number(v || 0);
}

function getLevelStat(lv, key) {
  return num(lv?.[key] ?? lv?.stats?.[key]);
}

function getTrainCostText(trainCost) {
  if (!trainCost) return "Research required";

  const nano = num(trainCost.nano_parts);

  return `Nano Parts ${nano}`;
}

function getTotalTrainCostText(amount, nanoCost) {
  return `Nano Parts ${amount * nanoCost}`;
}

function getUnitVisualHtml(unit, className = "") {
  if (unit.asset) {
    return `<img class="unit-detail-visual-img ${className}" src="${unit.asset}" alt="${unit.name}">`;
  }

  return `
    <div class="unit-icon ${unit.id} ${className}">
      <div class="unit-core"></div>
    </div>
  `;
}

function getResourceBag() {
  return state?.resources || state?.player?.resources || {};
}

function renderPlayerStatusText(p) {
  const r = getResourceBag();

  return [
    `Energy ${p.energy}/${p.max_energy || 100}`,
    `Credits ${num(p.credits)}`,
    `Data ${num(r.data_shard)}`,
    `Nano ${num(r.nano_parts)}`,
    `Nexus ${num(r.nexus_core)}`
  ].join(" | ");
}

function getUnitLevelAsset(unit, level) {
  return `assets/units/${unit.id}_lv${level}.png`;
}

function getBestDisplayLevel(unit) {
  if (!unit.levels || !unit.levels.length) return 1;

  const ownedLevel = [...unit.levels]
    .reverse()
    .find(lv => Number(lv.owned || 0) > 0);

  if (ownedLevel) return ownedLevel.level;

  return unit.unlocked_level || 1;
}

function getUnitVisualHtmlByAsset(asset, alt = "") {
  return `<img class="unit-detail-visual-img" src="${asset}" alt="${alt}">`;
}

function getBestDisplayLevel(unit) {
  if (!unit.levels || !unit.levels.length) return 1;

  const ownedLevel = [...unit.levels]
    .reverse()
    .find(lv => Number(lv.owned || 0) > 0);

  if (ownedLevel) return ownedLevel.level;

  return unit.unlocked_level || 1;
}

function getUnitVisualHtmlByAsset(asset, alt = "") {
  return `<img class="unit-detail-visual-img" src="${asset}" alt="${alt}">`;
}


function renderUnitFactoryTabs(activeTab) {
  const tabs = [
    { id: "train", label: "Train" },
    { id: "promote", label: "Promote" },
    { id: "upgrade", label: "Upgrade" }
  ];

  return `
    <div class="facility-tabs unit-factory-tabs">
      ${tabs.map(tab => `
        <button
          class="${activeTab === tab.id ? "active" : ""}"
          onclick="renderUnitFactorySheet('${tab.id}')"
        >
          ${tab.label}
        </button>
      `).join("")}
    </div>
  `;
}

function renderUnitFactorySheet(tab = "train") {
  if (!buildingsData) return;

  currentUnitFactoryTab = tab;
  currentUnitFactoryView = null;

  const factory = buildingsData.buildings.unit_factory;

  let body = "";

  if (tab === "train") {
    body = renderUnitFactoryTrainTab();
  } else if (tab === "promote") {
    body = renderUnitFactoryPromoteTab();
  } else {
    body = renderUnitFactoryUpgradeTab(factory);
  }

  showBuildingSheet(
    `Unit Factory Lv.${factory.level}`,
    `
      ${renderUnitFactoryTabs(tab)}
      ${body}
    `
  );
}

function renderUnitFactoryTrainTab() {
  const units = buildingsData.units || [];

  const cards = units.map(u => {
    const totalOwned = (u.levels || []).reduce((sum, lv) => {
      return sum + num(lv.owned);
    }, 0);

    const totalHp = (u.levels || []).reduce((sum, lv) => {
      return sum + (getLevelStat(lv, "hp") * num(lv.owned));
    }, 0);

    const totalAttack = (u.levels || []).reduce((sum, lv) => {
      return sum + (getLevelStat(lv, "attack") * num(lv.owned));
    }, 0);

    const totalDefense = (u.levels || []).reduce((sum, lv) => {
      return sum + (getLevelStat(lv, "defense") * num(lv.owned));
    }, 0);

    const totalCargo = (u.levels || []).reduce((sum, lv) => {
      return sum + (getLevelStat(lv, "cargo") * num(lv.owned));
    }, 0);

    const displayLevel = getBestDisplayLevel(u);
    const asset = getUnitLevelAsset(u, displayLevel);

    return `
      <div class="unit-summary-card ultra-unit-card" onclick="openUnitFactoryDetail('${u.id}')">
        <div class="ultra-unit-main">
          <div class="ultra-unit-art">
            ${getUnitVisualHtmlByAsset(asset, `${u.name} Lv.${displayLevel}`)}
          </div>

          <div class="ultra-unit-info">
            <div class="ultra-unit-title">
              <div>
                <h3>${u.name}</h3>
                <p>${u.role}</p>
              </div>

              <span>Lv.${displayLevel}</span>
            </div>

            <div class="ultra-owned">
              <small>Total Owned</small>
              <b>${totalOwned}</b>
            </div>
          </div>
        </div>

        <div class="ultra-stat-strip">
          <div><small>HP</small><b>${compactNumber(totalHp)}</b></div>
          <div><small>ATK</small><b>${compactNumber(totalAttack)}</b></div>
          <div><small>DEF</small><b>${compactNumber(totalDefense)}</b></div>
          <div><small>Cargo</small><b>${compactNumber(totalCargo)}</b></div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <p class="muted">
      Train pasukan baru berdasarkan level yang sudah terbuka dari Research Lab.
    </p>

    <div class="unit-summary-list ultra-unit-list">
      ${cards}
    </div>
  `;
}

function promoteAmountKey(unitId, level) {
  return `${unitId}_${level}`;
}

function getPromoteSliderAmount(unitId, level) {
  const key = promoteAmountKey(unitId, level);
  const input = el(`promoteRange_${key}`);

  return Math.max(1, Number(input?.value || promoteAmountDraft[key] || 1));
}

function getPromoteNanoCost(lv) {
  if (lv.promote_cost?.nano_parts !== undefined) {
    return num(lv.promote_cost.nano_parts);
  }

  // fallback sementara jika backend belum mengirim promote_cost
  return 40 * (num(lv.level) + 1);
}

function getPromoteCostText(amount, nanoCost) {
  return `Nano Parts ${amount * nanoCost}`;
}

function setPromoteSliderAmount(unitId, level, value, nanoCost) {
  const key = promoteAmountKey(unitId, level);
  const input = el(`promoteRange_${key}`);

  const max = Number(input?.max || 1);
  const amount = Math.max(1, Math.min(max, Number(value || 1)));

  promoteAmountDraft[key] = amount;

  if (input) input.value = amount;

  setText(`promoteAmount_${key}`, amount);
  setText(`promoteButtonAmount_${key}`, amount);
  setText(`promoteTotalCost_${key}`, getPromoteCostText(amount, nanoCost));
}

function promoteFromSlider(unitId, level) {
  const amount = getPromoteSliderAmount(unitId, level);
  promoteUnit(unitId, level, amount);
}

function renderUnitFactoryPromoteTab() {
  const units = buildingsData.units || [];

  const rows = [];

  units.forEach(unit => {
    (unit.levels || []).forEach(lv => {
      const owned = num(lv.owned);
      const canPromote = lv.promote_to_next_unlocked && owned > 0;

      if (!canPromote) return;

      const toLevel = num(lv.level) + 1;
      const key = promoteAmountKey(unit.id, lv.level);
      const maxPromote = owned;
      const currentAmount = Math.max(1, Math.min(maxPromote, num(promoteAmountDraft[key] || 1)));
      const nanoCost = getPromoteNanoCost(lv);

      rows.push(`
        <div class="promote-card">
          <div class="promote-top">
            <div class="promote-art">
              ${getUnitVisualHtmlByAsset(getUnitLevelAsset(unit, lv.level), `${unit.name} Lv.${lv.level}`)}
            </div>

            <div class="promote-info">
              <h3>${unit.name}</h3>
              <p class="muted">Promote Lv.${lv.level} → Lv.${toLevel}</p>

              <div class="promote-owned-line">
                <span>Owned Lv.${lv.level}</span>
                <b>${owned}</b>
              </div>
            </div>
          </div>

          <div class="promote-slider-panel">
            <div class="train-slider-top">
              <div>
                <small>Promote Amount</small>
                <b>x<span id="promoteAmount_${key}">${currentAmount}</span></b>
              </div>

              <div>
                <small>Total Cost</small>
                <b id="promoteTotalCost_${key}">${getPromoteCostText(currentAmount, nanoCost)}</b>
              </div>
            </div>

            <input
              id="promoteRange_${key}"
              class="train-range"
              type="range"
              min="1"
              max="${maxPromote}"
              value="${currentAmount}"
              oninput="setPromoteSliderAmount('${unit.id}', ${lv.level}, this.value, ${nanoCost})"
            />

            <div class="train-slider-bottom">
              <span>1</span>
              <span>Max ${maxPromote}</span>
            </div>

            <button class="train-main-btn" onclick="promoteFromSlider('${unit.id}', ${lv.level})">
              Promote x<span id="promoteButtonAmount_${key}">${currentAmount}</span>
            </button>
          </div>
        </div>
      `);
    });
  });

  if (!rows.length) {
    return `
      <div class="facility-upgrade-card">
        <h3>No Promotable Units</h3>
        <p class="muted">
          Belum ada stack yang bisa dipromote. Buka level unit berikutnya di Research Lab,
          lalu pastikan kamu punya unit level sebelumnya.
        </p>
      </div>
    `;
  }

  return `
    <p class="muted">
      Promote mengubah pasukan level lama menjadi level berikutnya yang sudah terbuka.
    </p>

    <div class="promote-list">
      ${rows.join("")}
    </div>
  `;
}

function renderUnitFactoryUpgradeTab(factory) {
  const level = Number(factory?.level || 1);
  const nextLevel = level + 1;

  return `
    <div class="facility-upgrade-card">
      <h3>Upgrade Unit Factory</h3>
      <p class="muted">
        Upgrade Unit Factory meningkatkan efisiensi training, kapasitas produksi,
        dan nanti bisa membuka queue training tambahan.
      </p>

      ${row("Current Level", `Lv.${level}`)}
      ${row("Next Level", `Lv.${nextLevel}`)}
      ${row("Current Effect", "Basic unit training unlocked")}
      ${row("Next Effect", "Training efficiency + queue capacity")}

      <div class="upgrade-cost-box">
        <h3>Upgrade Cost</h3>

        <div class="upgrade-cost-row">
          <span>Data Shard</span>
          <b>${250 * level}</b>
        </div>

        <div class="upgrade-cost-row">
          <span>Nano Parts</span>
          <b>${500 * level}</b>
        </div>
      </div>

      <div class="sheet-actions">
        <button disabled>Upgrade Unit Factory Soon</button>
      </div>
    </div>
  `;
}

let trainAmountDraft = {};

function trainAmountKey(unitId, level) {
  return `${unitId}_${level}`;
}

function getTrainAffordableMax(trainCost) {
  const r = getResourceBag();

  const nanoCost = Number(trainCost?.nano_parts || 0);
  const ownedNano = Number(r.nano_parts || 0);

  if (nanoCost <= 0) return 999;

  return Math.floor(ownedNano / nanoCost);
}

function getTrainSliderAmount(unitId, level) {
  const key = trainAmountKey(unitId, level);
  const input = el(`trainRange_${key}`);

  return Math.max(1, Number(input?.value || trainAmountDraft[key] || 1));
}

function setTrainSliderAmount(unitId, level, value, nanoCost) {
  const key = trainAmountKey(unitId, level);
  const input = el(`trainRange_${key}`);

  const max = Number(input?.max || 1);
  const amount = Math.max(1, Math.min(max, Number(value || 1)));

  trainAmountDraft[key] = amount;

  if (input) input.value = amount;

  setText(`trainAmount_${key}`, amount);
  setText(`trainButtonAmount_${key}`, amount);
  setText(`trainTotalCost_${key}`, getTotalTrainCostText(amount, nanoCost));
}

function trainFromSlider(unitId, level) {
  const amount = getTrainSliderAmount(unitId, level);
  trainUnit(unitId, level, amount);
}

function openUnitFactoryDetail(unitId) {
  if (!buildingsData) return;

  currentUnitFactoryView = unitId;

  const unit = (buildingsData.units || []).find(u => u.id === unitId);
  if (!unit) return;

  const levelRows = (unit.levels || []).map(lv => {
    const trainCost = lv.train_cost || {};
    const owned = num(lv.owned);

    const hp = getLevelStat(lv, "hp");
    const attack = getLevelStat(lv, "attack");
    const defense = getLevelStat(lv, "defense");
    const speed = getLevelStat(lv, "speed");
    const cargo = getLevelStat(lv, "cargo");

    const nanoCost = num(trainCost.nano_parts);

    const key = trainAmountKey(unit.id, lv.level);
    const maxTrain = lv.unlocked ? getTrainAffordableMax(trainCost) : 1;
    const currentAmount = Math.min(maxTrain, num(trainAmountDraft[key] || 1));

    const trainPanel = lv.unlocked
      ? `
        <div class="train-slider-panel">
          <div class="train-slider-top">
            <div>
              <small>Train Amount</small>
              <b>x<span id="trainAmount_${key}">${currentAmount}</span></b>
            </div>

            <div>
              <small>Total Cost</small>
              <b id="trainTotalCost_${key}">${getTotalTrainCostText(currentAmount, nanoCost)}</b>
            </div>
          </div>

          <input
            id="trainRange_${key}"
            class="train-range"
            type="range"
            min="1"
            max="${maxTrain}"
            value="${currentAmount}"
            oninput="setTrainSliderAmount('${unit.id}', ${lv.level}, this.value, ${nanoCost})"
          />

          <div class="train-slider-bottom">
            <span>1</span>
            <span>Max ${maxTrain}</span>
          </div>

          <button class="train-main-btn" onclick="trainFromSlider('${unit.id}', ${lv.level})">
            Train x<span id="trainButtonAmount_${key}">${currentAmount}</span>
          </button>
        </div>
      `
      : `
        <div class="train-slider-panel locked-panel">
          <button disabled>Locked by Research</button>
        </div>
      `;

    const promoteButtons = lv.promote_to_next_unlocked && owned > 0
      ? `
        <div class="promote-mini-actions">
          <button onclick="promoteUnit('${unit.id}', ${lv.level}, 1)">Promote +1</button>
          <button onclick="promoteUnit('${unit.id}', ${lv.level}, 5)">+5</button>
          <button onclick="promoteUnit('${unit.id}', ${lv.level}, 10)">+10</button>
        </div>
      `
      : "";

    return `
      <div class="unit-level-row premium-train-card ${lv.unlocked ? "" : "locked"}">
        <div class="premium-train-top">
          <div class="premium-unit-art">
            ${getUnitVisualHtmlByAsset(getUnitLevelAsset(unit, lv.level), `${unit.name} Lv.${lv.level}`)}
          </div>

          <div class="premium-unit-info">
            <div class="premium-unit-head">
              <div>
                <h3>Lv.${lv.level}</h3>
                <p>Owned: ${owned}</p>
              </div>

              ${lv.unlocked ? "" : `<span class="compact-lock">Locked</span>`}
            </div>

            <div class="premium-stat-chips">
              <span>HP ${hp}</span>
              <span>ATK ${attack}</span>
              <span>DEF ${defense}</span>
              <span>SPD ${speed}</span>
              <span>Cargo ${cargo}</span>
            </div>

            <p class="premium-cost-note">Base Cost: Nano Parts ${nanoCost} / unit</p>
          </div>
        </div>

        ${trainPanel}
        ${promoteButtons}
      </div>
    `;
  }).join("");

  showBuildingSheet(
    unit.name,
    `
      <div class="unit-level-list premium-train-list">
        ${levelRows}
      </div>

      <div class="sheet-actions">
        <button onclick="renderUnitFactorySheet()">Back to Unit List</button>
      </div>
    `
  );
}

function openUnitDetail(unitId) {
  const unit = (buildingsData?.units || state?.units || []).find(u => u.id === unitId);
  if (!unit) return;

  const owned = buildingsData?.player?.unit_inventory?.[unit.id] || state?.player?.unit_inventory?.[unit.id] || 0;
  const level = unit.level || 1;
  const power = unit.power || unit.base_power || 0;
  const totalPower = owned * power;
  const nextCost = unit.next_upgrade_cost;

  const upgradeCostText = unit.maxed || !nextCost
    ? "MAX LEVEL"
    : `${nextCost.credits} Credits + ${nextCost.energy} Energy`;

  showBuildingSheet(
    `${unit.name} Lv.${level}`,
    `
      <p class="muted">${unit.role}</p>

      ${row("Owned", owned)}
      ${row("Power / Unit", power)}
      ${row("Total Power", totalPower)}
      ${row("Max Level", unit.max_level || 10)}
      ${row("Upgrade Cost", upgradeCostText)}

      <h3 style="margin-top:12px;">Strong Against</h3>
      <div class="mini-tags">
        ${(unit.strong_vs || []).map(x => `<span class="badge good">${x}</span>`).join("")}
      </div>

      <h3 style="margin-top:12px;">Weak Against</h3>
      <div class="mini-tags">
        ${(unit.weak_vs || []).map(x => `<span class="badge warn">${x}</span>`).join("")}
      </div>

      <p class="muted" style="margin-top:12px;">
        Level unit berlaku untuk semua unit jenis ini. Jika ${unit.name} naik ke Lv.${level + 1},
        semua ${unit.name} yang kamu punya ikut naik level.
      </p>

      <div class="sheet-actions">
        <button onclick="renderUnitFactorySheet()">Back</button>
        <button onclick="upgradeUnit('${unit.id}')">Upgrade</button>
      </div>
    `
  );
}

function renderResearchLabTabs(activeTab) {
  const tabs = [
    { id: "research", label: "Research" },
    { id: "upgrade", label: "Upgrade" }
  ];

  return `
    <div class="facility-tabs research-lab-tabs two-tabs">
      ${tabs.map(tab => `
        <button
          class="${activeTab === tab.id ? "active" : ""}"
          onclick="renderResearchLabSheet('${tab.id}')"
        >
          ${tab.label}
        </button>
      `).join("")}
    </div>
  `;
}

function formatTechCost(cost) {
  if (!cost) return "MAX LEVEL";

  const parts = [];

  if (cost.data_shard !== undefined) parts.push(`Data Shard ${num(cost.data_shard)}`);
  if (cost.nano_parts !== undefined) parts.push(`Nano Parts ${num(cost.nano_parts)}`);
  if (cost.nexus_core !== undefined) parts.push(`Nexus Core ${num(cost.nexus_core)}`);

  // fallback kalau backend kamu masih pakai format lama
  if (cost.credits !== undefined) parts.push(`Credits ${num(cost.credits)}`);
  if (cost.energy !== undefined) parts.push(`Energy ${num(cost.energy)}`);

  return parts.length ? parts.join(" · ") : "No Cost";
}

async function renderResearchLabSheet(tab = "research") {
  try {
    currentResearchLabTab = tab;

    const data = await api("/api/research");
    const lab = data.research_lab;

    let body = "";

    if (tab === "research") {
      body = renderResearchTab(data);
    } else {
      body = renderResearchUpgradeTab(data);
    }

    showBuildingSheet(
      `Research Lab Lv.${lab.level}`,
      `
        ${renderResearchLabTabs(tab)}
        ${body}
      `
    );
  } catch (err) {
    showBuildingSheet("Research Lab", `Gagal memuat research: ${err.message}`);
  }
}

function renderResearchTab(data) {
  const researchOrder = [
    "energy_generation",
    "network_speed",
    "scout_signal",
    "unit_capacity",
    "ai_sync",
    "attack_routing"
  ];

  const researchList = researchOrder
    .map(id => data.research[id])
    .filter(Boolean);

  const coreCards = researchList.map(r => {
    const costText = r.maxed
      ? "MAX LEVEL"
      : formatTechCost(r.next_cost);

    const buttonHtml = r.maxed
      ? `<button disabled>Maxed</button>`
      : `<button onclick="upgradeResearch('${r.id}')">Research</button>`;

    return `
      <div class="research-card premium-research-card">
        <div class="research-card-top">
          <div>
            <h3>${r.name}</h3>
            <p class="muted">Lv.${r.level}/${r.max_level}</p>
          </div>

          <span class="research-level-badge">Lv.${r.level}</span>
        </div>

        <p class="muted">${r.description}</p>

        ${row("Effect", r.effect)}
        ${row("Next Cost", costText)}

        <div class="sheet-actions">
          ${buttonHtml}
        </div>
      </div>
    `;
  }).join("");

  const unitTechCards = (data.unit_tech || []).map(t => {
    const costText = t.maxed || !t.next_cost
      ? "MAX LEVEL"
      : formatTechCost(t.next_cost);

    const buttonHtml = t.maxed
      ? `<button disabled>Maxed</button>`
      : `<button onclick="upgradeUnitTech('${t.unit_id}')">Research Lv.${t.next_level}</button>`;

    return `
      <div class="research-card premium-research-card unit-tech-card">
        <div class="research-card-top">
          <div>
            <h3>${t.name} Tech</h3>
            <p class="muted">Lv.${t.current_level}/${t.max_level}</p>
          </div>

          <span class="research-level-badge">Lv.${t.current_level}</span>
        </div>

        <p class="muted">${t.effect}</p>

        ${row("Next Cost", costText)}

        <div class="sheet-actions">
          ${buttonHtml}
        </div>
      </div>
    `;
  }).join("");

  return `
    <p class="muted">
      Research Lab membuka teknologi permanen. Unit level baru dibuka di sini,
      lalu bisa ditrain atau dipromote di Unit Factory.
    </p>

    <h3 class="section-title">Core Research</h3>
    <div class="research-list">
      ${coreCards}
    </div>

    <h3 class="section-title">Unit Technology</h3>
    <div class="research-list">
      ${unitTechCards || `<p class="muted">Belum ada unit technology.</p>`}
    </div>
  `;
}

function renderResearchUpgradeTab(data) {
  const lab = data.research_lab;
  const level = Number(lab.level || 1);
  const nextLevel = level + 1;

  const dataCost = 300 * level;
  const nanoCost = 180 * level;

  return `
    <div class="facility-upgrade-card research-upgrade-card">
      <h3>Upgrade Research Lab</h3>

      <p class="muted">
        Upgrade Research Lab meningkatkan kapasitas riset, membuka batas level teknologi,
        dan mempercepat perkembangan unit technology.
      </p>

      ${row("Current Level", `Lv.${level}`)}
      ${row("Next Level", `Lv.${nextLevel}`)}
      ${row("Current Effect", "Core research dan unit technology tersedia")}
      ${row("Next Effect", "Unlock research tier lebih tinggi dan efisiensi riset")}

      <div class="upgrade-cost-box">
        <h3>Upgrade Cost</h3>

        <div class="upgrade-cost-row">
          <span>Data Shard</span>
          <b>${dataCost}</b>
        </div>

        <div class="upgrade-cost-row">
          <span>Nano Parts</span>
          <b>${nanoCost}</b>
        </div>
      </div>

      <div class="sheet-actions">
        <button disabled>Upgrade Research Lab Soon</button>
      </div>
    </div>
  `;
}

async function upgradeUnitTech(unitId) {
  try {
    const result = await api("/api/research/unit-tech/upgrade", {
      method: "POST",
      body: JSON.stringify({
        unit_id: unitId
      })
    });

    await loadState();
    await loadBuildings();
    await renderResearchLabSheet("research");

    alert(result.message);
  } catch (err) {
    alert("Gagal research unit tech: " + err.message);
  }
}

function unitStackKey(unitId, level) {
  return `${unitId}:${level}`;
}

function getUnitLevelInfo(unit, level) {
  return (unit?.levels || []).find(x => Number(x.level) === Number(level));
}

function getSelectedUnitPower() {
  return Object.entries(selectedUnits).reduce((total, [key, amount]) => {
    const [unitId, levelText] = key.split(":");
    const unit = state.units.find(u => u.id === unitId);
    const levelInfo = getUnitLevelInfo(unit, Number(levelText));
    const power = levelInfo?.power || 0;

    return total + (Number(amount || 0) * power);
  }, 0);
}

function buildUnitPayload() {
  const payload = {};

  Object.entries(selectedUnits).forEach(([key, amount]) => {
    amount = Number(amount || 0);
    if (amount <= 0) return;

    const [unitId, levelText] = key.split(":");

    if (!payload[unitId]) {
      payload[unitId] = {};
    }

    payload[unitId][levelText] = amount;
  });

  return payload;
}

async function upgradeResearch(researchId) {
  try {
    const result = await api("/api/research/upgrade", {
      method: "POST",
      body: JSON.stringify({
        research_id: researchId
      })
    });

    await loadState();
    await renderResearchLabSheet("research");

    alert(result.message);
  } catch (err) {
    alert("Gagal upgrade research: " + err.message);
  }
}

async function trainUnit(unitId, level, amount) {
  try {
    const result = await api("/api/units/train", {
      method: "POST",
      body: JSON.stringify({
        unit_id: unitId,
        level: level,
        amount: amount
      })
    });

    await loadState();
    await loadBuildings();

    if (currentUnitFactoryView) {
      openUnitFactoryDetail(currentUnitFactoryView);
    } else {
      renderUnitFactorySheet(currentUnitFactoryTab || "train");
    }

    alert(result.message);
  } catch (err) {
    alert("Gagal train unit: " + err.message);
  }
}

async function promoteUnit(unitId, fromLevel, amount) {
  try {
    const result = await api("/api/units/promote", {
      method: "POST",
      body: JSON.stringify({
        unit_id: unitId,
        from_level: fromLevel,
        amount: amount
      })
    });

    await loadState();
    await loadBuildings();

    if (currentUnitFactoryView) {
      openUnitFactoryDetail(currentUnitFactoryView);
    } else {
      renderUnitFactorySheet(currentUnitFactoryTab || "promote");
    }

    alert(result.message);
  } catch (err) {
    alert("Gagal promote unit: " + err.message);
  }
}

async function upgradeUnit(unitId) {
  try {
    const result = await api("/api/units/upgrade", {
      method: "POST",
      body: JSON.stringify({
        unit_id: unitId
      })
    });

    await loadState();
    renderUnitFactorySheet();

    alert(result.message);
  } catch (err) {
    alert("Gagal upgrade unit: " + err.message);
  }
}

const BUILD_ARCHETYPES = [
  {
    id: "brute_breaker",
    name: "Brute Breaker",
    role: "Menembus firewall keras dengan tekanan besar.",
    strongVs: ["Firewall Fortress", "Shield Core", "Low recovery base"],
    weakVs: ["Trace Hunter", "Honeypot Trap"],
    recommendedModules: ["Firewall Crusher", "Core Breaker", "Payload Booster", "Escape Script"],
    recommendedAi: "HEX",
    explanation:
      "Brute Breaker cocok dipakai kalau target terlihat punya firewall tebal. Build ini fokus menghancurkan pertahanan, tapi risikonya trace exposure lebih tinggi."
  },
  {
    id: "stealth_raider",
    name: "Stealth Raider",
    role: "Masuk diam-diam untuk mengurangi trace dan mencuri vault.",
    strongVs: ["Low Scanner", "Backup Recovery", "Weak Trace Scanner"],
    weakVs: ["Trace Hunter", "Signal Jammer", "Sentinel Defense"],
    recommendedModules: ["Ghost Proxy", "Silent Injector", "Trace Masker", "Escape Script"],
    recommendedAi: "ORA / KAI",
    explanation:
      "Stealth Raider cocok untuk target yang terlihat lemah di scanner dan trace. Build ini bukan untuk menghancurkan firewall besar, tapi untuk masuk aman dan keluar cepat."
  },
  {
    id: "exploit_chain",
    name: "Exploit Chain",
    role: "Menyerang kelemahan patch, module, atau routing target.",
    strongVs: ["Firewall Fortress", "Old Patch", "Backup Recovery"],
    weakVs: ["Signal Jammer", "Decoy Network"],
    recommendedModules: ["Exploit Chain Script", "Core Breaker", "Anti-Jammer Chip", "Trace Masker"],
    recommendedAi: "KAI / ORA",
    explanation:
      "Exploit Chain adalah build teknis. Cocok jika scout memberi clue bahwa target punya old patch atau kelemahan routing."
  },
  {
    id: "analyst_breach",
    name: "Analyst Breach",
    role: "Membaca trap, decoy, fake vault, dan risiko sebelum menyerang.",
    strongVs: ["Honeypot Trap", "Decoy Network", "Fake Vault"],
    weakVs: ["Firewall Fortress", "Burst Defense"],
    recommendedModules: ["Trap Detector", "Fake Signal Filter", "Trace Masker", "Escape Script"],
    recommendedAi: "ORA",
    explanation:
      "Analyst Breach cocok kalau data scout belum lengkap atau target mencurigakan. Build ini lebih aman, tapi damage-nya tidak sebesar Brute."
  },
  {
    id: "packet_overload",
    name: "Packet Overload",
    role: "Serangan cepat dengan burst pressure.",
    strongVs: ["Low Defense", "Weak Recovery", "Inactive Shield"],
    weakVs: ["Shield Core", "Backup Recovery", "Honeypot Trap"],
    recommendedModules: ["Payload Booster", "Signal Accelerator", "Core Breaker", "Escape Script"],
    recommendedAi: "HEX",
    explanation:
      "Packet Overload cocok untuk target yang jaraknya dekat atau punya shield inactive. Build ini cepat, tapi berisiko kalau target punya trap."
  },
  {
    id: "rally_support",
    name: "Rally Support",
    role: "Build untuk serangan guild/rally.",
    strongVs: ["Guild Target", "High Level Base", "Nexus War Node"],
    weakVs: ["Strong Jammer", "Anti-Rally Defense"],
    recommendedModules: ["Signal Accelerator", "Anti-Jammer Chip", "Trace Masker", "Payload Booster"],
    recommendedAi: "ECHO",
    explanation:
      "Rally Support dipakai saat guild menyerang bersama. Build ini lebih fokus ke koordinasi, travel efficiency, dan stabilitas team attack."
  }
];
function renderModules() {
  // Build page sekarang hanya menu.
  // Detail build/module dibuka lewat bottom sheet.
}

function compactNumber(value) {
  const n = Number(value || 0);

  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;

  return `${n}`;
}

function calculateProfileArmyStats() {
  const units = buildingsData?.units || state?.units || [];

  let totalOwned = 0;
  let totalHp = 0;
  let totalAttack = 0;
  let totalDefense = 0;
  let totalCargo = 0;

  units.forEach(unit => {
    (unit.levels || []).forEach(lv => {
      const owned = Number(lv.owned || 0);

      const hp = Number(lv.hp || lv.stats?.hp || 0);
      const attack = Number(lv.attack || lv.stats?.attack || 0);
      const defense = Number(lv.defense || lv.stats?.defense || 0);
      const cargo = Number(lv.cargo || lv.stats?.cargo || 0);

      totalOwned += owned;
      totalHp += hp * owned;
      totalAttack += attack * owned;
      totalDefense += defense * owned;
      totalCargo += cargo * owned;
    });
  });

  // Ini hanya rating profil, bukan rumus battle final.
  const powerRating =
    totalAttack +
    totalDefense +
    Math.floor(totalHp / 10) +
    Math.floor(totalCargo / 2);

  return {
    totalOwned,
    totalHp,
    totalAttack,
    totalDefense,
    totalCargo,
    powerRating
  };
}

function renderProfileEnergyBar(p) {
  const current = Number(p.energy || 0);
  const max = Math.max(1, Number(p.max_energy || 100));
  const percent = Math.max(0, Math.min(100, (current / max) * 100));

  return `
    <div class="profile-energy-card">
      <div class="profile-energy-top">
        <span>Energy for operation</span>
        <b>${current} / ${max}</b>
      </div>

      <div class="profile-energy-bar">
        <div style="width:${percent}%"></div>
      </div>
    </div>
  `;
}

function getProfileUnitStacks() {
  const units = buildingsData?.units || state?.units || [];
  const stacks = [];

  units.forEach(unit => {
    (unit.levels || []).forEach(lv => {
      const owned = num(lv.owned);

      if (owned <= 0) return;

      stacks.push({
        unit,
        unitId: unit.id,
        name: unit.name,
        level: lv.level,
        owned,
        hp: getLevelStat(lv, "hp"),
        attack: getLevelStat(lv, "attack"),
        defense: getLevelStat(lv, "defense"),
        cargo: getLevelStat(lv, "cargo"),
        asset: getUnitLevelAsset(unit, lv.level)
      });
    });
  });

  return stacks;
}

function renderProfileUnitRoster() {
  const stacks = getProfileUnitStacks();

  if (!stacks.length) {
    return `
      <div class="profile-unit-section">
        <h3>Semua Pasukan di Lab</h3>
        <p class="muted">Belum ada pasukan.</p>
      </div>
    `;
  }

  const totalAttack = stacks.reduce((sum, s) => sum + s.attack * s.owned, 0);
  const totalDefense = stacks.reduce((sum, s) => sum + s.defense * s.owned, 0);
  const totalCargo = stacks.reduce((sum, s) => sum + s.cargo * s.owned, 0);

  const unitCards = stacks.map(s => `
    <button class="profile-unit-card" onclick="openUnitFactoryDetail('${s.unitId}')">
      <img src="${s.asset}" alt="${s.name} Lv.${s.level}">
      <b>${s.owned}</b>
      <small>Lv.${s.level}</small>
    </button>
  `).join("");

  return `
    <div class="profile-unit-section">
      <h3>Semua Pasukan di Lab</h3>

      <div class="profile-unit-total-strip">
        <span>ATK <b>${compactNumber(totalAttack)}</b></span>
        <span>DEF <b>${compactNumber(totalDefense)}</b></span>
        <span>Cargo <b>${compactNumber(totalCargo)}</b></span>
      </div>

      <div class="profile-unit-grid">
        ${unitCards}
      </div>

      <p class="muted profile-unit-note">
        Pasukan ditampilkan berdasarkan jenis dan level stack yang kamu miliki.
      </p>
    </div>
  `;
}

function calculateCommanderStats(army, p) {
  const buildingPower =
    (Number(p.lab_level || 1) * 450) +
    (Number(p.scanner_level || 1) * 160) +
    (Number(p.scout_level || 1) * 140) +
    (Number(p.ai_core_level || 1) * 180);

  const researchPower =
    (Number(p.lab_level || 1) * 120) +
    (Number(p.scanner_level || 1) * 70) +
    (Number(p.scout_level || 1) * 70);

  const aiPower = Number(p.owned_ai_count || 0) * 250;

  const armyPower =
    army.totalAttack +
    army.totalDefense +
    Math.floor(army.totalHp / 10) +
    Math.floor(army.totalCargo / 2);

  const commanderPower =
    armyPower +
    buildingPower +
    researchPower +
    aiPower;

  return {
    armyPower,
    buildingPower,
    researchPower,
    aiPower,
    commanderPower
  };
}

async function openProfileSheet() {
  try {
    if (!state) {
      await loadState();
    }

    if (!buildingsData) {
      await loadBuildings();
    }

    const data = await api("/api/profile");
    const p = data.profile;
    const army = calculateProfileArmyStats();
    const commander = calculateCommanderStats(army, p);

    showBuildingSheet(
      "Commander Profile",
      `
        <div class="cyber-profile-hero">
          <div class="profile-hero-top">
            <div class="profile-hero-avatar">
              <img class="profile-hero-avatar-img" src="assets/profile/avatar.png" alt="Profile">
              <img class="profile-hero-border-img" src="assets/borders/topup_basic.png" alt="">
              <span class="profile-hero-level">Lv.${p.lab_level}</span>
            </div>

            <div class="profile-hero-info">
              <small>Cyber Lab Commander</small>
              <h2>${p.name}</h2>

              <div class="profile-power-pill">
                <span>Power</span>
                <b>${compactNumber(army.powerRating)}</b>
              </div>
            </div>
          </div>

          <div class="profile-action-row">
            <button disabled>Edit Name Soon</button>
            <button disabled>Change Avatar Soon</button>
            <button disabled>Border Tier Soon</button>
          </div>
        </div>

        <div class="profile-power-grid">
          <div>
            <small>Army Power</small>
            <b>${compactNumber(commander.armyPower)}</b>
          </div>

          <div>
            <small>Base Power</small>
            <b>${compactNumber(commander.buildingPower)}</b>
          </div>

          <div>
            <small>Research Power</small>
            <b>${compactNumber(commander.researchPower)}</b>
          </div>

          <div>
            <small>AI Power</small>
            <b>${compactNumber(commander.aiPower)}</b>
          </div>
        </div>
        ${renderProfileUnitRoster()}
        ${renderProfileEnergyBar(p)}

        <div class="profile-detail-card">
          <h3>Lab Detail</h3>

          ${row("Player ID", p.id)}
          ${row("Coordinate", `X:${p.coordinate.x} / Y:${p.coordinate.y}`)}
          ${row("Main Lab", `Lv.${p.lab_level}`)}
          ${row("Scanner", `Lv.${p.scanner_level}`)}
          ${row("Scout", `Lv.${p.scout_level}`)}
          ${row("AI Core", `Lv.${p.ai_core_level}`)}
          ${row("Trace Exposure", `${p.trace_exposure}%`)}
          ${row("Active AI", p.active_ai.join(", ") || "None")}
          ${row("Total Units", army.totalOwned)}
        </div>

        <div class="sheet-actions">
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      `
    );
  } catch (err) {
    alert("Gagal membuka profile: " + err.message);
  }
}

async function openSettingsSheet() {
  try {
    const data = await api("/api/settings");
    const s = data.settings;

    showBuildingSheet(
      "Settings",
      `
        <div class="settings-card">
          <h3>Language</h3>
          <div class="settings-options">
            <button class="${s.language === "id" ? "active-setting" : ""}" onclick="updateSetting('language', 'id')">Indonesia</button>
            <button class="${s.language === "en" ? "active-setting" : ""}" onclick="updateSetting('language', 'en')">English</button>
          </div>

          <h3>Audio & Feedback</h3>
          <div class="settings-options">
            <button class="${s.sound ? "active-setting" : ""}" onclick="updateSetting('sound', ${!s.sound})">
              Sound: ${s.sound ? "ON" : "OFF"}
            </button>

            <button class="${s.vibration ? "active-setting" : ""}" onclick="updateSetting('vibration', ${!s.vibration})">
              Vibration: ${s.vibration ? "ON" : "OFF"}
            </button>
          </div>

          <h3>Display</h3>
          <div class="settings-options">
            <button class="${s.reduced_motion ? "active-setting" : ""}" onclick="updateSetting('reduced_motion', ${!s.reduced_motion})">
              Reduced Motion: ${s.reduced_motion ? "ON" : "OFF"}
            </button>
          </div>

          <p class="muted" style="margin-top:12px;">
            Untuk saat ini settings masih basic. Nanti bahasa, sound, efek animasi,
            dan notifikasi bisa benar-benar dihubungkan ke seluruh game.
          </p>
        </div>

        <div class="sheet-actions">
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      `
    );
  } catch (err) {
    alert("Gagal membuka settings: " + err.message);
  }
}


async function updateSetting(key, value) {
  try {
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        [key]: value
      })
    });

    await openSettingsSheet();
  } catch (err) {
    alert("Gagal update settings: " + err.message);
  }
}

function renderBuildAcademy() {
  const box = el("buildArchetypeList");
  if (!box) return;

  box.innerHTML = BUILD_ARCHETYPES.map(build => `
    <div class="build-guide-card" onclick="openBuildGuide('${build.id}')">
      <h3>${build.name}</h3>
      <p class="muted">${build.role}</p>

      <div class="mini-tags">
        ${build.strongVs.slice(0, 2).map(x => `<span class="badge good">VS ${x}</span>`).join("")}
      </div>
    </div>
  `).join("");
}

function openBuildGuide(buildId) {
  const build = BUILD_ARCHETYPES.find(b => b.id === buildId);
  if (!build) return;

  showBuildingSheet(
    build.name,
    `
      <p class="muted">${build.explanation}</p>

      <h3>Strong Against</h3>
      <div class="mini-tags">
        ${build.strongVs.map(x => `<span class="badge good">${x}</span>`).join("")}
      </div>

      <h3>Weak Against</h3>
      <div class="mini-tags">
        ${build.weakVs.map(x => `<span class="badge warn">${x}</span>`).join("")}
      </div>

      <h3>Recommended Modules</h3>
      <div class="mini-tags">
        ${build.recommendedModules.map(x => `<span class="badge">${x}</span>`).join("")}
      </div>

      <div class="row"><span>Recommended AI</span><span>${build.recommendedAi}</span></div>

      <div class="sheet-actions">
        <button onclick="closeBuildingSheet()">Close</button>
      </div>
    `
  );
}

function renderModuleLibrary() {
  const box = el("moduleGuideList");
  if (!box || !state) return;

  box.innerHTML = state.attack_modules.map(m => `
    <div class="module-guide-card" onclick="openModuleGuide('${m.id}')">
      <h3>${m.name}</h3>
      <p class="muted">${m.effect}</p>
      <div class="mini-tags">
        ${m.tags.map(t => `<span class="badge">${t}</span>`).join("")}
      </div>
    </div>
  `).join("");
}

function openModuleGuide(moduleId) {
  const m = state.attack_modules.find(x => x.id === moduleId);
  if (!m) return;

  showBuildingSheet(
    m.name,
    `
      <p class="muted">${m.effect}</p>

      <div class="row"><span>Tags</span><span>${m.tags.join(", ")}</span></div>
      <div class="row"><span>Durability</span><span>Does not break</span></div>
      <div class="row"><span>Used In</span><span>Attack Setup</span></div>

      <p class="muted">
        Module ini bukan item sekali pakai. Player memilih maksimal 6 module
        saat akan menyerang target.
      </p>

      <div class="sheet-actions">
        <button onclick="closeBuildingSheet()">Close</button>
      </div>
    `
  );
}

function openBuildTypesSheet() {
  const list = BUILD_ARCHETYPES.map(build => `
    <div class="build-guide-card" onclick="openBuildGuide('${build.id}')">
      <h3>${build.name}</h3>
      <p class="muted">${build.role}</p>

      <div class="mini-tags">
        ${build.strongVs.slice(0, 2).map(x => `<span class="badge good">VS ${x}</span>`).join("")}
      </div>
    </div>
  `).join("");

  showBuildingSheet(
    "Build Types",
    `
      <p class="muted">
        Pilih tipe build untuk melihat fungsi, counter, kelemahan, dan module yang cocok.
      </p>

      <div class="build-guide-list">
        ${list}
      </div>
    `
  );
}

function openCounterGuideSheet() {
  showBuildingSheet(
    "Counter Guide",
    `
      <p class="muted">
        Panduan cepat counter-build. Ini membantu player memilih build yang tepat sebelum menyerang.
      </p>

      <div class="counter-card">
        <h3>Firewall Fortress</h3>
        <p class="muted">Counter: Exploit Chain / Brute Breaker</p>
      </div>

      <div class="counter-card">
        <h3>Trace Hunter</h3>
        <p class="muted">Counter: Trace Masker / Stealth Raider / Signal Accelerator</p>
      </div>

      <div class="counter-card">
        <h3>Honeypot Trap</h3>
        <p class="muted">Counter: Analyst Breach / Trap Detector / ORA</p>
      </div>

      <div class="counter-card">
        <h3>Decoy Network</h3>
        <p class="muted">Counter: Fake Signal Filter / Analyst Breach / High Scout</p>
      </div>

      <div class="counter-card">
        <h3>Signal Jammer</h3>
        <p class="muted">Counter: Anti-Jammer Chip / KAI / Attack Routing</p>
      </div>

      <div class="counter-card">
        <h3>Backup Recovery</h3>
        <p class="muted">Counter: Packet Overload / Exploit Chain / Burst Pressure</p>
      </div>
    `
  );
}

function openModuleLibrarySheet() {
  if (!state) return;

  const list = state.attack_modules.map(m => `
    <div class="module-guide-card" onclick="openModuleGuide('${m.id}')">
      <h3>${m.name}</h3>
      <p class="muted">${m.effect}</p>

      <div class="mini-tags">
        ${m.tags.map(t => `<span class="badge">${t}</span>`).join("")}
      </div>
    </div>
  `).join("");

  showBuildingSheet(
    "Module Library",
    `
      <p class="muted">
        Semua module attack. Module tidak rusak dan dipilih saat Attack Setup.
      </p>

      <div class="module-guide-list">
        ${list}
      </div>
    `
  );
}

function toggleModule(id) {
  if (selectedModules.has(id)) {
    selectedModules.delete(id);
  } else {
    if (selectedModules.size >= 6) {
      alert("Maksimal 6 module.");
      return;
    }
    selectedModules.add(id);
  }

  renderModules();
}

function renderUnits() {
  const box = el("unitList");
  if (!box || !state) return;

  box.innerHTML = state.units.map(u => {
    const max = state.player.unit_inventory[u.id] || 0;
    const val = selectedUnits[u.id] || 0;

    return `
      <div class="card">
        <h3>${u.name}</h3>
        <p class="muted">${u.role}</p>
        <small>Available: ${max}</small>
        <input type="number" min="0" max="${max}" value="${val}" onchange="setUnit('${u.id}', this.value)" />
      </div>
    `;
  }).join("");
}

function setUnit(id, value) {
  selectedUnits[id] = Math.max(0, parseInt(value || "0", 10));
}

function renderAiInventory() {
  const box = el("aiInventory");
  if (!box || !state) return;

  box.innerHTML = Object.entries(state.ai_agents).map(([id, ai]) => `
    <div class="card">
      <h3>${ai.name}</h3>
      <p>
        <span class="badge">${ai.category}</span>
        <span class="badge warn">${ai.rarity}</span>
      </p>
      <p class="muted">${ai.description}</p>
      <p>Lv.${ai.level} / ${ai.star}-Star</p>
      <div>${fmtBuffs(ai.buffs)}</div>
    </div>
  `).join("");
}

function renderAttackAiList() {
  const box = el("attackAiList");
  if (!box || !state) return;

  const maxSlot = state.player.ai_core_level;

  box.innerHTML = Object.entries(state.ai_agents).map(([id, ai]) => `
    <div class="card ${selectedAi.has(id) ? "selected" : ""}" onclick="toggleAi('${id}')">
      <h3>${ai.name}</h3>
      <p>
        <span class="badge">${ai.category}</span>
        <span class="badge">${selectedAi.has(id) ? "Active" : "Inactive"}</span>
      </p>
      <p class="muted">AI Core slot: ${selectedAi.size}/${maxSlot}</p>
      <div>${fmtBuffs(ai.buffs)}</div>
    </div>
  `).join("");
}

function toggleAi(id) {
  const maxSlot = state.player.ai_core_level;

  if (selectedAi.has(id)) {
    selectedAi.delete(id);
  } else {
    if (selectedAi.size >= maxSlot) {
      alert(`AI Core kamu hanya punya ${maxSlot} slot aktif.`);
      return;
    }

    selectedAi.add(id);
  }

  renderAttackAiList();
}

async function scan() {
  const scanInfo = el("scanInfo");
  const radarTargetInfo = el("radarTargetInfo");
  const scanBtn = el("scanBtn");

  const runId = ++radarScanRunId;

  selectedTarget = null;
  selectedUnits = {};
  selectedModules = new Set();

  clearRadarMarkers();
  radarTargets = [];

  if (scanBtn) scanBtn.disabled = true;
  if (!scanInfo) return;

  setRadarScanning(true);

  if (radarTargetInfo) {
    radarTargetInfo.innerText = "Scanning signal...";
  }

  scanInfo.innerText = "Radar scanning... mencari signal baru.";

  try {
    const data = await api("/api/scan");

    if (runId !== radarScanRunId) return;

    clearRadarMarkers();
    radarTargets = data.targets || [];

    const enemyCount = data.enemy_count ?? radarTargets.filter(t => t.kind !== "mining").length;
    const miningCount = data.mining_count ?? radarTargets.filter(t => t.kind === "mining").length;

    scanInfo.innerText =
      `Scanner Lv.${data.scanner_level} | Radius ${data.radius} | Enemy ${enemyCount} | Mining ${miningCount}`;

    await revealEnemyMarkers(radarTargets, data.radius, runId);

    if (runId !== radarScanRunId) return;

    if (!radarTargets.length && radarTargetInfo) {
      radarTargetInfo.innerText = "Tidak ada signal ditemukan di radius scanner.";
    } else if (radarTargetInfo) {
      radarTargetInfo.innerText = "Signal ditemukan. Tekan target di map untuk melihat detail.";
    }
  } catch (err) {
    if (runId === radarScanRunId) {
      scanInfo.innerText = "Scan gagal: " + err.message;
    }
  } finally {
    if (runId === radarScanRunId) {
      setRadarScanning(false);
      if (scanBtn) scanBtn.disabled = false;
    }
  }
}

function setRadarScanning(active) {
  const sweep = el("radarSweep");
  if (!sweep) return;

  sweep.classList.toggle("scanning", active);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getSignalClass(signalStrength) {
  const signal = String(signalStrength || "").toLowerCase();

  if (signal.includes("strong")) return "strong";
  if (signal.includes("medium")) return "medium";
  return "weak";
}

function calculateMarkerPosition(target, index, total, radius) {
  const p = state?.player;

  if (!p || target.x === undefined || target.y === undefined) {
    const angle = ((index + 1) / Math.max(total, 1)) * Math.PI * 2;
    const spread = 32;

    return {
      left: `${50 + Math.cos(angle) * spread}%`,
      top: `${50 + Math.sin(angle) * spread}%`
    };
  }

  const safeRadius = Math.max(radius || 50, 1);

  const dx = target.x - p.x;
  const dy = target.y - p.y;

  const scale = 42 / safeRadius;

  let left = 50 + dx * scale;
  let top = 50 + dy * scale;

  left = Math.max(8, Math.min(92, left));
  top = Math.max(8, Math.min(92, top));

  return {
    left: `${left}%`,
    top: `${top}%`
  };
}

function getEnemyAsset(target) {
  if (target.asset) return target.asset;

  if (target.kind === "mining") {
    const resource = String(target.resource_id || "").toLowerCase();

    if (resource === "data_shard") return "assets/mining/data_cache.png";
    if (resource === "nano_parts") return "assets/mining/nano_mine.png";
    if (resource === "credits") return "assets/mining/credit_vault.png";
    if (resource === "nexus_core") return "assets/mining/nexus_rift.png";

    return "assets/mining/data_cache.png";
  }

  const signal = String(target.signal_strength || "").toLowerCase();
  const type = String(target.type || "").toLowerCase();

  if (type.includes("nexus")) {
    return "assets/enemies/enemy_nexus.png";
  }

  if (signal.includes("strong")) {
    return "assets/enemies/enemy_strong.png";
  }

  if (signal.includes("medium")) {
    return "assets/enemies/enemy_medium.png";
  }

  return "assets/enemies/enemy_weak.png";
}

function isRadarSpotFree(x, y, minGap) {
  return placedRadarPoints.every(p => {
    const dx = x - p.x;
    const dy = y - p.y;
    return Math.sqrt(dx * dx + dy * dy) >= minGap;
  });
}

function clampRadarPoint(v) {
  return Math.max(11, Math.min(89, v));
}

function clampRadarPercent(v) {
  return Math.max(12, Math.min(88, Number(v)));
}

function getRadarGap(kindA, kindB) {
  // mining vs enemy harus lebih jauh karena ini yang paling terasa bug
  if (kindA !== kindB) return 22;

  // sesama mining juga jangan terlalu dekat
  if (kindA === "mining" && kindB === "mining") return 20;

  // sesama enemy boleh sedikit lebih dekat
  return 18;
}

function isRadarSpotFree(x, y, kind) {
  return placedRadarPoints.every(p => {
    const dx = x - p.x;
    const dy = y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minGap = getRadarGap(kind, p.kind);

    return dist >= minGap;
  });
}

function reserveRadarSpot(x, y, kind) {
  placedRadarPoints.push({ x, y, kind });
}

function separateRadarPositionPercent(left, top, kind = "enemy") {
  const baseX = clampRadarPercent(parseFloat(left));
  const baseY = clampRadarPercent(parseFloat(top));

  if (isRadarSpotFree(baseX, baseY, kind)) {
    reserveRadarSpot(baseX, baseY, kind);
    return {
      left: `${baseX}%`,
      top: `${baseY}%`
    };
  }

  // Cari posisi kosong di lingkaran sekitar posisi asli
  const rings = [10, 15, 20, 25, 30, 35];
  const directions = 18;

  for (const ring of rings) {
    for (let i = 0; i < directions; i++) {
      const angle = (Math.PI * 2 * i) / directions;

      const x = clampRadarPercent(baseX + Math.cos(angle) * ring);
      const y = clampRadarPercent(baseY + Math.sin(angle) * ring);

      if (isRadarSpotFree(x, y, kind)) {
        reserveRadarSpot(x, y, kind);
        return {
          left: `${x}%`,
          top: `${y}%`
        };
      }
    }
  }

  // Fallback terakhir: sebar melingkar supaya tidak tepat numpuk
  const fallbackAngle = placedRadarPoints.length * 1.618;
  const fallbackRadius = 34;

  const x = clampRadarPercent(50 + Math.cos(fallbackAngle) * fallbackRadius);
  const y = clampRadarPercent(50 + Math.sin(fallbackAngle) * fallbackRadius);

  reserveRadarSpot(x, y, kind);

  return {
    left: `${x}%`,
    top: `${y}%`
  };
}

function getMiningMarkerLabel(target) {
  const id = String(target.resource_id || "").toLowerCase();

  if (id === "data_shard") return "Data";
  if (id === "nano_parts") return "Nano";
  if (id === "credits") return "Credit";
  if (id === "nexus_core") return "Nexus";

  return "Mine";
}

function radarDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getRadarSlotGap(kindA, kindB) {
  // Mining dan enemy wajib lebih jauh
  if (kindA !== kindB) return 15;

  // Sesama mining juga jangan terlalu dekat
  if (kindA === "mining" && kindB === "mining") return 13;

  // Sesama enemy boleh sedikit lebih dekat
  return 12;
}

function isRadarSlotFree(slot, kind) {
  return placedRadarSlots.every(p => {
    return radarDistance(slot, p) >= getRadarSlotGap(kind, p.kind);
  });
}

function buildRadarSlots() {
  const slots = [];

  // slot grid dalam lingkaran radar
  for (let y = 14; y <= 86; y += 12) {
    for (let x = 14; x <= 86; x += 12) {
      const dx = x - 50;
      const dy = y - 50;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // jangan terlalu keluar dari lingkaran radar
      if (dist <= 43) {
        slots.push({ x, y });
      }
    }
  }

  return slots;
}

function getRadarSlotPosition(rawLeft, rawTop, kind) {
  const raw = {
    x: Math.max(12, Math.min(88, parseFloat(rawLeft))),
    y: Math.max(12, Math.min(88, parseFloat(rawTop)))
  };

  const slots = buildRadarSlots()
    .map(slot => ({
      ...slot,
      score: radarDistance(raw, slot)
    }))
    .sort((a, b) => a.score - b.score);

  for (const slot of slots) {
    const candidate = {
      x: slot.x,
      y: slot.y,
      kind
    };

    if (isRadarSlotFree(candidate, kind)) {
      placedRadarSlots.push(candidate);

      return {
        left: `${candidate.x}%`,
        top: `${candidate.y}%`
      };
    }
  }

  // fallback terakhir kalau radar terlalu penuh
  const fallbackAngle = placedRadarSlots.length * 1.618;
  const fallback = {
    x: 50 + Math.cos(fallbackAngle) * 35,
    y: 50 + Math.sin(fallbackAngle) * 35,
    kind
  };

  fallback.x = Math.max(12, Math.min(88, fallback.x));
  fallback.y = Math.max(12, Math.min(88, fallback.y));

  placedRadarSlots.push(fallback);

  return {
    left: `${fallback.x}%`,
    top: `${fallback.y}%`
  };
}
function createEnemyMarker(target, index, total, radius) {
  const markerBox = el("radarMarkers");
  if (!markerBox) return;

  const pos = calculateMarkerPosition(target, index, total, radius);
  const signalClass = getSignalClass(target.signal_strength);
  const asset = getEnemyAsset(target);

  const markerKind = target.kind === "mining" ? "mining" : "enemy";

  const fixedPos = getRadarSlotPosition(
    pos.left,
    pos.top,
    markerKind
  );

  const markerTypeClass = target.kind === "mining"
    ? "mining-marker"
    : "enemy-hostile-marker";

  const levelText = `Lv.${target.level || target.guardian_level || 1}`;
  

  const marker = document.createElement("button");
  marker.className = `enemy-marker enemy-image-marker ${markerTypeClass} ${signalClass}`;

  marker.style.left = fixedPos.left;
  marker.style.top = fixedPos.top;

  marker.style.zIndex = target.kind === "mining" ? 9 : 8;

  marker.title = `${target.name} | ${target.distance} Trace Unit`;

  marker.innerHTML = `
    <img src="${asset}" alt="${target.name}">
    <span class="enemy-marker-ring"></span>
    <span class="enemy-level-badge">${levelText}</span>
  `;

  marker.onclick = () => selectRadarSignal(target.id);

  markerBox.appendChild(marker);
}

async function revealEnemyMarkers(targets, radius, runId = radarScanRunId) {
  clearRadarMarkers();

  const sortedTargets = [...targets].sort((a, b) => {
    const ak = a.kind === "mining" ? 1 : 0;
    const bk = b.kind === "mining" ? 1 : 0;
    return ak - bk;
  });

  for (let i = 0; i < sortedTargets.length; i++) {
    if (runId !== radarScanRunId) return;

    createEnemyMarker(sortedTargets[i], i, sortedTargets.length, radius);

    await wait(160);
  }
}

function selectRadarSignal(targetId) {
  const target = radarTargets.find(t => t.id === targetId);
  if (!target) return;
  if (target.kind === "mining") {
    openMiningNodeSheet(target);
    return;
  }
  const targetAsset = getEnemyAsset(target);

  document.querySelectorAll(".enemy-marker").forEach(marker => {
    marker.classList.remove("selected");
  });

  const index = radarTargets.findIndex(t => t.id === targetId);
  const marker = document.querySelectorAll(".enemy-marker")[index];
  if (marker) marker.classList.add("selected");

  showBuildingSheet(
    target.name,
    `
      <div class="target-preview">
        <img src="${targetAsset}" alt="${target.name}">
        <div>
          <h3>${target.name}</h3>
          <p class="muted">Signal detected from nearby cyber lab.</p>
        </div>
      </div>

      ${row("Enemy Level", `Lv.${target.level || 1}`)}
      ${row("Defense Power", target.defense_power || "Unknown")}
      ${row("Type", target.type)}
      ${row("Distance", `${target.distance} Trace Unit`)}
      ${row("Coordinate", `X:${target.x} / Y:${target.y}`)}
      ${row("Signal", target.signal_strength)}
      ${row("Lab Tier", target.lab_tier)}
      ${row("Vault Signal", target.vault_signal)}
      ${row("Firewall", target.firewall || "Basic Firewall")}

      <div class="sheet-actions">
        <button onclick="openAttackSetupFromRadar('${target.id}')">Attack</button>
        <button onclick="closeBuildingSheet(); scoutPopup('${target.id}')">Scout</button>
      </div>
    `
  );
}

function openMiningNodeSheet(node) {
  const asset = getEnemyAsset(node);

  showBuildingSheet(
    node.name,
    `
      <div class="target-preview mining-preview">
        <img src="${asset}" alt="${node.name}">
        <div>
          <h3>${node.name}</h3>
          <p class="muted">
            Resource node protected by guardian units. Kalahkan guardian untuk occupy node.
          </p>
        </div>
      </div>

      ${row("Resource", node.resource_name)}
      ${row("Production", `${node.production_per_minute} / minute`)}
      ${row("Capacity", node.capacity)}
      ${row("Guardian Level", `Lv.${node.guardian_level}`)}
      ${row("Guardian Power", node.guardian_power)}
      ${row("Distance", `${node.distance} Trace Unit`)}
      ${row("Coordinate", `X:${node.x} / Y:${node.y}`)}
      ${row("Status", node.status || "Unoccupied")}

      <p class="muted" style="margin-top:12px;">
        Jika guardian berhasil dikalahkan, pasukan tidak langsung pulang.
        Pasukan akan menetap di node ini dan mengumpulkan resource sampai di-recall
        atau dikalahkan player lain.
      </p>

      <div class="sheet-actions">
        <button disabled>Attack Guardian Soon</button>
        <button disabled>Scout Node Soon</button>
        <button onclick="closeBuildingSheet()">Close</button>
      </div>
    `
  );
}

async function scoutPopup(id) {
  selectedTarget = id;

  if (!id || id === "undefined" || id === "null") {
    showBuildingSheet(
      "Scout Failed",
      `
        <p class="muted">
          Target ID tidak valid. Lakukan Scan Area ulang lalu pilih target dari hasil scan terbaru.
        </p>

        <div class="sheet-actions">
          <button onclick="closeBuildingSheet()">Close</button>
          <button onclick="closeBuildingSheet(); scan()">Scan Area</button>
        </div>
      `
    );
    return;
  }

  try {
    const data = await api("/api/scout/start", {
      method: "POST",
      body: JSON.stringify({
        target_id: String(id)
      })
    });

    const reportText = formatScoutReport(data.report);

    setText(
      "selectedTargetBox",
      `${data.target_name}\nTarget ID: ${id}\nDistance: ${data.distance} Trace Unit`
    );

    setText(
      "scoutReport",
      `Scout drone travelling...\nTarget: ${data.target_name}\nETA: ${formatSeconds(data.travel_seconds)}`
    );

    await loadState();

    addScoutOperation(data, reportText, id);
  } catch (err) {
    showBuildingSheet(
      "Scout Failed",
      `
        <p class="muted">${escapeHtml(err.message)}</p>

        <div class="sheet-actions">
          <button onclick="closeBuildingSheet()">Close</button>
          <button onclick="closeBuildingSheet(); scan()">Scan Area</button>
        </div>
      `
    );
  }
}

function selectTargetFromRadar(targetId) {
  const target = radarTargets.find(t => t.id === targetId);
  if (!target) return;

  selectedTarget = target.id;

  setText(
    "selectedTargetBox",
    `${target.name}\nTarget ID: ${target.id}\nDistance: ${target.distance} Trace Unit`
  );

  switchPage("buildPage");
}

function selectTarget(id, name, distance) {
  selectedTarget = id;

  setText(
    "selectedTargetBox",
    `${name}\nTarget ID: ${id}\nDistance: ${distance} Trace Unit`
  );

  scan();
  switchPage("buildPage");
}

function formatEnemyArmyForReport(army) {
  if (!Array.isArray(army) || !army.length) {
    return "Unknown";
  }

  return army.map(u => {
    return `${u.name} Lv.${u.level} x${u.count} (${u.role})`;
  }).join(", ");
}

function formatDefenseModulesForReport(modules) {
  if (!Array.isArray(modules) || !modules.length) {
    return "Unknown";
  }

  return modules.join(", ");
}

function formatScoutReport(r) {
  const lines = [];

  lines.push("SCOUT REPORT");
  lines.push(`Target: ${r.name}`);
  lines.push(`Distance: ${r.distance}`);
  lines.push(`Lab Level: ${r.lab_level}`);
  lines.push(`Base Tier: ${r.base_tier}`);
  lines.push(`Enemy Army: ${formatEnemyArmyForReport(r.enemy_army)}`);
  lines.push(`Enemy Build: ${r.enemy_build || "Unknown"}`);
  lines.push(`Defense Modules: ${formatDefenseModulesForReport(r.defense_modules)}`);
  lines.push(`Vault: ${r.vault_size}`);
  lines.push(`Last Activity: ${r.last_activity}`);
  lines.push(`Visible Structure: ${Array.isArray(r.visible_structure) ? r.visible_structure.join(", ") : r.visible_structure}`);
  lines.push(`Firewall: ${r.firewall}`);
  lines.push(`Trap: ${r.trap}`);
  lines.push(`Trace Scanner: ${r.trace_scanner}`);
  lines.push(`Defense Style: ${r.defense_style}`);
  lines.push(`Estimated Power: ${r.estimated_power}`);
  lines.push(`Weakness Hint: ${r.weakness_hint}`);
  lines.push(`Counter Risk: ${r.counter_risk}`);
  lines.push(`Build Clue: ${r.build_clue}`);
  lines.push(`Counter Scout: ${r.counter_scout_status}`);
  lines.push(`Noise: ${r.noise}`);

  return lines.join("\n");
}

async function scout(id) {
  selectedTarget = id;

  const r = await api(`/api/scout/${id}`);
  const text = formatScoutReport(r);

  setText("scoutReport", text);

  setText(
    "selectedTargetBox",
    `${r.name}\nTarget ID: ${id}\nDistance: ${r.distance} Trace Unit`
  );

  return text;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showBattleResultSheet(logText, addToLog = true) {
  if (addToLog) {
    addGameMessage("battle", "Battle Result", logText);
  }

  showBuildingSheet(
    "Battle Result",
    `
      <pre class="battle-result-pre">${escapeHtml(logText)}</pre>

      <div class="battle-result-actions">
        <button onclick="closeBuildingSheet()">Close</button>
        <button onclick="closeBuildingSheet(); switchPage('logPage')">Open Battle Log</button>
      </div>
    `
  );
}

async function askAi(id) {
  selectedTarget = id;

  const preferredAi = selectedAi.has("ora") ? "ora" : [...selectedAi][0] || "nova_lite";

  const data = await api("/api/ai/analyze", {
    method: "POST",
    body: JSON.stringify({
      target_id: msg.targetId,
      target_name: msg.targetName,
      ai_id: preferredAi,
      scout_report: msg.rawReport || msg.text || ""
    })
  });

  const rec = data.recommendation;

  const text = [
    `${data.ai.name}: Reading Scout data...`,
    `Confidence: ${data.confidence}%`,
    `Analysis: ${data.analysis}`,
    data.missing_data.length ? `Missing Data: ${data.missing_data.join(", ")}` : "Missing Data: none",
    `Recommended Build: ${rec.recommended_build}`,
    `Recommended Modules: ${rec.recommended_modules.join(", ")}`,
    `Recommended AI: ${rec.recommended_ai}`,
    rec.warning ? `Warning: ${rec.warning}` : "",
    "Active Buff Preview:",
    Object.entries(data.active_buffs_preview).map(([k, v]) => `- ${k}: ${v > 0 ? "+" : ""}${v}%`).join("\n")
  ].filter(Boolean).join("\n");

  addGameMessage("ai", "AI Analysis", text);

  showBuildingSheet(
    "AI Analysis",
    `
      <pre class="battle-result-pre">${escapeHtml(text)}</pre>
      <div class="sheet-actions">
        <button onclick="closeBuildingSheet()">Close</button>
        <button onclick="closeBuildingSheet(); switchPage('logPage')">Open Log</button>
      </div>
    `
  );
}

function openAttackSetupFromRadar(targetId) {
  const target = radarTargets.find(t => t.id === targetId);
  if (!target) return;

  selectedTarget = target.id;

  // default awal biar tidak kosong
  selectedUnits = selectedUnits || {};
  selectedModules = selectedModules || new Set();
  selectedAi = selectedAi || new Set();

  showAttackSetupSheet(target);
}

function showAttackSetupSheet(target) {
  const unitList = state.units.map(u => {
  const rows = (u.levels || [])
    .filter(lv => lv.unlocked && lv.owned > 0)
    .map(lv => {
      const key = unitStackKey(u.id, lv.level);
      const selected = selectedUnits[key] || 0;
      const selectedPower = selected * lv.power;

      return `
        <div class="attack-unit-card">
          <div class="attack-unit-head">
            <div>
              <b>${u.name} Lv.${lv.level}</b>
              <small>${u.role}</small>
              <small>Owned: ${lv.owned}</small>
              <small>Power/unit: ${lv.power}</small>
              <small>Selected Power: ${selectedPower}</small>
            </div>

            <div class="unit-amount">${selected}</div>
          </div>

          <div class="unit-pick-actions">
            <button onclick="changeAttackUnit('${u.id}', ${lv.level}, -1, '${target.id}')">-1</button>
            <button onclick="changeAttackUnit('${u.id}', ${lv.level}, 1, '${target.id}')">+1</button>
            <button onclick="changeAttackUnit('${u.id}', ${lv.level}, 5, '${target.id}')">+5</button>
            <button onclick="changeAttackUnit('${u.id}', ${lv.level}, 10, '${target.id}')">+10</button>
            <button onclick="setAttackUnitPercent('${u.id}', ${lv.level}, 50, '${target.id}')">50%</button>
            <button onclick="setAttackUnitMax('${u.id}', ${lv.level}, '${target.id}')">MAX</button>
            <button onclick="setAttackUnit('${u.id}', ${lv.level}, 0); showAttackSetupSheetById('${target.id}')">Clear</button>
          </div>
        </div>
      `;
    }).join("");

  return rows || "";
}).join("");

  const moduleList = state.attack_modules.map(m => {
    const active = selectedModules.has(m.id) ? "active" : "";

    return `
      <button class="pick-chip ${active}" onclick="toggleModuleFromSheet('${m.id}', '${target.id}')">
        ${m.name}
      </button>
    `;
  }).join("");

  const aiList = Object.entries(state.ai_agents).map(([id, ai]) => {
    const active = selectedAi.has(id) ? "active" : "";

    return `
      <button class="pick-chip ${active}" onclick="toggleAiFromSheet('${id}', '${target.id}')">
        ${ai.name}
      </button>
    `;
  }).join("");

  const totalUnits = Object.values(selectedUnits).reduce((a, b) => a + Number(b || 0), 0);
  const maxDeploy = state.max_deploy_units || 100;
  const selectedUnitPower = getSelectedUnitPower();
  
  showBuildingSheet(
    "Attack Setup",
    `
      <div class="attack-target-box">
        <h3>${target.name}</h3>
        ${row("Distance", `${target.distance} Trace Unit`)}
        ${row("Signal", target.signal_strength)}
        ${row("Lab Tier", target.lab_tier)}
        
        ${row("Firewall", target.firewall || "Basic Firewall")}
      </div>

      <div class="attack-section">
        <h3>1. Units</h3>
        <p class="muted">Deploy: ${totalUnits}/${maxDeploy} · Unit Power: ${selectedUnitPower}</p>
        ${unitList}
      </div>

      <div class="attack-section">
        <h3>2. Modules</h3>
        <p class="muted">Pilih maksimal 6 module. Module tidak rusak.</p>
        <div class="pick-chip-list">${moduleList}</div>
      </div>

      <div class="attack-section">
        <h3>3. AI Agent</h3>
        <p class="muted">Slot AI aktif: ${selectedAi.size}/${state.player.ai_core_level}</p>
        <div class="pick-chip-list">${aiList}</div>
      </div>

      <div class="sheet-actions">
        <button onclick="launchAttack()">Launch Attack</button>
        <button onclick="closeBuildingSheet()">Cancel</button>
      </div>
    `
  );
}

function showAttackSetupSheetById(targetId) {
  const target = radarTargets.find(t => t.id === targetId);
  if (target) showAttackSetupSheet(target);
}

function changeAttackUnit(unitId, delta, targetId) {
  const owned = state.player.unit_inventory[unitId] || 0;
  const current = Number(selectedUnits[unitId] || 0);

  let next = current + delta;
  if (next < 0) next = 0;
  if (next > owned) next = owned;

  selectedUnits[unitId] = next;

  showAttackSetupSheetById(targetId);
}

function setAttackUnitPercent(unitId, percent, targetId) {
  const owned = state.player.unit_inventory[unitId] || 0;
  selectedUnits[unitId] = Math.floor(owned * percent / 100);

  showAttackSetupSheetById(targetId);
}

function setAttackUnitMax(unitId, targetId) {
  const owned = state.player.unit_inventory[unitId] || 0;
  selectedUnits[unitId] = owned;

  showAttackSetupSheetById(targetId);
}

function setAttackUnit(unitId, value) {
  const owned = state.player.unit_inventory[unitId] || 0;
  let amount = parseInt(value || "0", 10);

  if (amount < 0) amount = 0;
  if (amount > owned) amount = owned;

  selectedUnits[unitId] = amount;
}

function toggleModuleFromSheet(moduleId, targetId) {
  if (selectedModules.has(moduleId)) {
    selectedModules.delete(moduleId);
  } else {
    if (selectedModules.size >= 6) {
      alert("Maksimal 6 module.");
      return;
    }

    selectedModules.add(moduleId);
  }

  const target = radarTargets.find(t => t.id === targetId);
  if (target) showAttackSetupSheet(target);
}

function toggleAiFromSheet(aiId, targetId) {
  const maxSlot = state.player.ai_core_level;

  if (selectedAi.has(aiId)) {
    selectedAi.delete(aiId);
  } else {
    if (selectedAi.size >= maxSlot) {
      alert(`AI Core kamu hanya punya ${maxSlot} slot aktif.`);
      return;
    }

    selectedAi.add(aiId);
  }

  const target = radarTargets.find(t => t.id === targetId);
  if (target) showAttackSetupSheet(target);
}

async function launchAttack() {
  try {
    if (!selectedTarget) {
      alert("Pilih target dulu.");
      return;
    }

    const payload = {
      target_id: selectedTarget,
      module_ids: [...selectedModules],
      ai_ids: [...selectedAi],
      units: buildUnitPayload()
    };

    const totalUnits = Object.values(selectedUnits)
      .reduce((a, b) => a + Number(b || 0), 0);

    if (totalUnits <= 0) {
      alert("Pilih minimal 1 unit untuk menyerang.");
      return;
    }

    if (selectedModules.size <= 0) {
      alert("Pilih minimal 1 module untuk menyerang.");
      return;
    }

    const res = await api("/api/attack", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    const unitLossLines = [
      "Destroyed Units:",
      ...Object.entries(res.destroyed_units).map(([k, v]) => `- ${k}: ${v}`),
      "Disabled Units:",
      ...Object.entries(res.disabled_units).map(([k, v]) => `- ${k}: ${v}`)
    ];

    const log = [
      ...res.battle_log,
      "",
      `Travel Time: ${res.final_travel_seconds}s`,
      
      `Energy Cost: ${res.energy_cost}`,
      `Trace Exposure Now: ${res.trace_exposure}%`,
      "",
      ...unitLossLines,
      "",
      `Reward: ${JSON.stringify(res.reward, null, 2)}`
    ].join("\n");

    addGameMessage(
      "system",
      "Attack Prepared",
      "Payload accepted. Units, modules, and AI Agent locked for attack."
    );

    await loadState();

    showAttackTravelSheet(res, log, selectedTarget);
  } catch (err) {
    alert("Attack gagal: " + err.message);
  }
}

function switchPage(id) {
  const page = el(id);
  if (!page) return;

  document.querySelectorAll(".page").forEach(p => {
    p.classList.remove("active-page");
  });

  page.classList.add("active-page");

  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.dataset.page === id);
  });

  if (id === "radarPage") {
    loadContestedNodes();
  }
}

async function initApp() {
  initTelegramMiniApp();
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      switchPage(btn.dataset.page);
    });
  });

  const scanBtn = el("scanBtn");
  if (scanBtn) {
    scanBtn.addEventListener("click", scan);
  }

  const launchAttackBtn = el("launchAttackBtn");
  if (launchAttackBtn) {
    launchAttackBtn.addEventListener("click", launchAttack);
  }

  loadState().then(() => {
    scan().catch(err => {
      console.warn("Scan gagal/skip:", err);
    });
  }).catch(err => {
    console.error("LOAD STATE ERROR:", err);

    setText("playerStatus", "Error loading data");

    const info = el("buildingInfo");
    if (info) {
      info.innerText = err.message;
    }
  });
}

document.addEventListener("DOMContentLoaded", initApp);