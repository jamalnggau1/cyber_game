let state = null;
let buildingsData = null;
const clearedTargetIds = new Set();
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

async function initTelegramMiniApp() {
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
    await authTelegramUser();
  }

  return telegramUser;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Player-Id": localStorage.getItem("cybercore_player_id") || "",
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }

  return res.json();
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
    if (data.player_id) {
      localStorage.setItem("cybercore_player_id", data.player_id);
    }
  } catch (err) {
    console.log("Telegram auth failed:", err.message);
  }
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

function markTargetCleared(targetId) {
  if (!targetId) return;

  const id = String(targetId);

  clearedTargetIds.add(id);

  radarTargets = (radarTargets || []).filter(t => String(t.id) !== id);

  document.querySelectorAll(`.enemy-marker[data-target-id="${id}"]`).forEach(marker => {
    marker.remove();
  });

  if (String(selectedTarget) === id) {
    selectedTarget = null;
  }

  const radarTargetInfo = el("radarTargetInfo");
  if (radarTargetInfo) {
    radarTargetInfo.innerText = "Target cleared. Signal removed from current radar.";
  }

  closeBuildingSheet();
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

  if (op.type === "attack") {
    if (op.phase === "outbound") {
      return "Going to target";
    }

    if (op.phase === "returning") {
      return "Returning to base";
    }

    if (op.phase === "completed") {
      return "Completed";
    }

    if (op.phase === "ignored") {
      return "Target already cleared";
    }

    return "Attack running";
  }

  return "Travelling";
}

function addAttackOperation(attackResult, finalLogText, targetId) {
  const target =
    radarTargets.find(t => t.id === targetId) ||
    radarTargets.find(t => t.id === attackResult.target_id);

  if (attackResult.ignored || attackResult.target_depleted) {
    markTargetCleared(targetId || attackResult.target_id);

    addGameMessage(
      "system",
      "Target Cleared",
      "Target ini sudah dikalahkan dan sinyalnya dihapus dari radar."
    );

    return;
  }

  const outbound = Math.max(
    1,
    Number(attackResult.outbound_seconds || attackResult.final_travel_seconds || 1)
  );

  const returnSeconds = Math.max(
    1,
    Number(attackResult.return_seconds || outbound)
  );

  const now = Date.now();

  const op = {
    id: attackResult.id || `atk_${now}`,
    type: "attack",
    phase: attackResult.phase || "outbound",
    status: "running",

    title: `Attacking ${target?.name || attackResult.target_name || targetId || "Unknown Target"}`,
    targetId: targetId || attackResult.target_id,
    targetName: target?.name || attackResult.target_name || "Unknown Target",
    distance: target?.distance || attackResult.distance || "?",

    outboundSeconds: outbound,
    returnSeconds: returnSeconds,

    // Untuk fase pertama, timer hanya sampai target.
    totalSeconds: outbound,
    startedAt: now,
    reachedAt: now + outbound * 1000,
    endsAt: now + outbound * 1000,

    result: attackResult,
    finalLog: Array.isArray(attackResult.battle_log)
      ? attackResult.battle_log.join("\n")
      : (finalLogText || "")
  };

  activeOperations.unshift(op);

  addGameMessage(
    "battle",
    "Attack Launched",
    `${op.title}
Distance: ${op.distance} Trace Unit
Outbound Time: ${formatSeconds(outbound)}
Return Time: ${formatSeconds(returnSeconds)}
Status: Units are going to target.`
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
          <b>${typeof power === "number" ? formatPower(power) : escapeHtml(String(power))}</b>
        </div>
      </div>

      <div class="intel-meta-strip">
        <span>Tier: <b>${escapeHtml(String(baseTier))}</b></span>
        <span>Distance: <b>${escapeHtml(String(distance))}</b> Trace Unit</span>
      </div>

      ${renderScoutDroneBlock(r)}
      ${renderScoutContestBlock(r)}
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
          <small>Report quality depends on Scout level, Scout Signal, active AI, and enemy Anti Scout.</small>
        </div>
      </div>
    </div>
  `;
}

function renderScoutContestBlock(r) {
  const contest = r.scout_contest || null;

  if (!contest) {
    return "";
  }

  const attackerScore = Number(contest.attacker_score || 0);
  const defenderScore = Number(contest.defender_score || contest.defender_anti_scout_score || 0);
  const total = Math.max(1, attackerScore + defenderScore);
  const attackerPct = Math.round((attackerScore / total) * 100);
  const defenderPct = Math.round((defenderScore / total) * 100);

  const noise = scoutValue(r.noise, "Unknown");
  const quality = scoutValue(r.report_quality, "Unknown");

  return `
    <div class="intel-section scout-contest-section">
      <div class="intel-section-title">
        <h3>Scout Contest</h3>
        <span>${escapeHtml(String(quality))}</span>
      </div>

      <div class="scout-contest-card">
        <div class="contest-score-row">
          <div>
            <small>Your Scout</small>
            <b>${attackerScore}</b>
          </div>

          <div>
            <small>Enemy Anti Scout</small>
            <b>${defenderScore}</b>
          </div>
        </div>

        <div class="contest-bar">
          <div class="contest-attacker" style="width:${attackerPct}%"></div>
          <div class="contest-defender" style="width:${defenderPct}%"></div>
        </div>

        <div class="contest-detail-grid">
          ${row("Noise", noise)}
          ${row("Scout Drone Lv", contest.attacker_scout_level ?? "?")}
          ${row("Scanner Lv", contest.attacker_scanner_level ?? "?")}
          ${row("Signal Research", contest.attacker_scout_signal ?? "?")}
          ${row("Defender Jammer", contest.defender_jammer_level ?? "?")}
          ${row("DEF AI Bonus", `${contest.defender_ai_defense_bonus_percent || 0}%`)}
        </div>

        <p class="muted">
          Jika Enemy Anti Scout lebih tinggi, report akan terkena noise dan sebagian data berubah menjadi ???.
        </p>
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
    return `<img src="assets/units/breaker/lv${Math.max(1, Math.min(5, level))}.webp" alt="Breaker">`;
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
        target_name: msg.targetName,
        ai_id: preferredAi,
        scout_report: msg.rawReport || msg.text || "",
        scout_report_data: msg.rawReportData || null
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

function renderOperationCard(op) {
  const remaining = getOperationRemaining(op);
  const progress = getOperationProgress(op);

  return `
    <div class="operation-card" data-op-id="${op.id}">
      <div class="operation-type">${op.type.toUpperCase()}</div>
      <h3>${escapeHtml(op.title || "Operation")}</h3>

      <small id="opPhase_${op.id}" class="muted">
        ${escapeHtml(getOperationPhaseText(op))}
      </small>

      <small>
        <span id="opRemain_${op.id}" class="operation-status-running">
          ${op.status === "completed" ? "Completed" : `${formatSeconds(remaining)} remaining`}
        </span>
      </small>

      <small>Distance: ${escapeHtml(String(op.distance || "?"))} Trace Unit</small>

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

  const running = getRunningOperations();

  running.forEach(op => {
    const remainBox = el(`opRemain_${op.id}`);
    const progressBox = el(`opProgress_${op.id}`);
    const phaseBox = el(`opPhase_${op.id}`);

    if (remainBox) {
      remainBox.innerText = op.status === "completed"
        ? "Completed"
        : `${formatSeconds(getOperationRemaining(op))} remaining`;
    }

    if (phaseBox) {
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

function getAttackOperationLog(data) {
  if (Array.isArray(data?.battle_log)) {
    return data.battle_log.join("\n");
  }

  return String(data?.battle_log || data?.message || "No battle log available.");
}

async function resolveAttackImpact(op) {
  if (!op || op.resolving) return;

  op.resolving = true;

  try {
    const data = await api(`/api/attack/${op.id}/impact`, {
      method: "POST"
    });

    op.resolving = false;

    if (data.not_ready) {
      const remain = Math.max(1, Number(data.remaining_seconds || 1));
      op.endsAt = Date.now() + remain * 1000;
      op.totalSeconds = remain;
      renderOperationQueueList();
      return;
    }

    op.result = data;
    op.finalLog = getAttackOperationLog(data);

    if (
      data.target_kind === "enemy" &&
      (data.success || data.target_depleted || data.target_status === "depleted")
    ) {
      markTargetCleared(data.target_id || op.targetId);
    }

    if (data.phase === "returning") {
      const returnSeconds = Math.max(1, Number(data.return_seconds || op.returnSeconds || 1));
      const now = Date.now();

      let returnEnd = now + returnSeconds * 1000;

      if (data.return_at) {
        const serverReturnEnd = Number(data.return_at) * 1000;

        if (Number.isFinite(serverReturnEnd) && serverReturnEnd > now) {
          returnEnd = serverReturnEnd;
        }
      }

      op.phase = "returning";
      op.status = "running";
      op.title = `Returning from ${data.target_name || op.targetName || "Target"}`;
      op.returnSeconds = returnSeconds;
      op.startedAt = now;
      op.endsAt = returnEnd;
      op.totalSeconds = Math.max(1, Math.ceil((returnEnd - now) / 1000));

      addGameMessage(
        "battle",
        "Attack Impact",
        `${data.target_name || op.targetName || "Target"}
${op.finalLog}

Units are returning to base.`
      );

      await loadState();

      renderOperationQueueList();
      updateOperationQueueWidget();
      return;
    }

    renderOperationQueueList();
  } catch (err) {
    op.resolving = false;
    console.warn("Attack impact failed:", err);
  }
}

async function resolveAttackReturn(op) {
  if (!op || op.resolving) return;

  op.resolving = true;

  try {
    const data = await api(`/api/attack/${op.id}/return`, {
      method: "POST"
    });

    op.resolving = false;

    if (data.not_ready) {
      const remain = Math.max(1, Number(data.remaining_seconds || 1));
      op.endsAt = Date.now() + remain * 1000;
      op.totalSeconds = remain;
      renderOperationQueueList();
      return;
    }

    op.result = data;
    op.finalLog = getAttackOperationLog(data);
    op.phase = "completed";
    op.status = "completed";
    op.endsAt = Date.now();
    op.totalSeconds = 1;

    addGameMessage(
      "battle",
      "Battle Completed",
      `${data.target_name || op.targetName || "Target"}
Target: ${data.target_name || op.targetName || "Unknown"}
Distance: ${op.distance} Trace Unit

${op.finalLog}`
    );

    if (currentOperationViewId === op.id) {
      currentOperationViewId = null;
      showBattleResultSheet(op.finalLog, false);
    }

    await loadState();

    renderOperationQueueList();
    updateOperationQueueWidget();
  } catch (err) {
    op.resolving = false;
    console.warn("Attack return failed:", err);
  }
}

async function finalizeExpiredOperations() {
  const expired = activeOperations.filter(op => {
    return op.status === "running" && getOperationRemaining(op) <= 0;
  });

  if (!expired.length) return;

  for (const op of expired) {
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

      op.status = "completed";
      op.phase = "completed";
      continue;
    }

    if (op.type === "attack") {
      if (op.phase === "outbound") {
        await resolveAttackImpact(op);
        continue;
      }

      if (op.phase === "returning") {
        await resolveAttackReturn(op);
        continue;
      }

      continue;
    }

    op.status = "completed";
  }

  // Hapus scout completed lama dari running queue,
  // tapi attack completed tetap boleh tampil di Completed list.
  activeOperations = activeOperations.filter(op => {
    if (op.type === "scout" && op.status === "completed") return false;
    return true;
  });
}

async function updateOperations() {
  await finalizeExpiredOperations();

  updateOperationQueueWidget();
  updateOperationQueueSheetLive();
  updateOperationDetailLive();
}

function openOperationDetail(opId) {
  const op = activeOperations.find(o => o.id === opId);
  if (!op) return;

  currentOperationViewId = op.id;

  const phase = getOperationPhaseText(op);

  showBuildingSheet(
    op.type === "attack" ? "Attack Operation" : "Operation",
    `
      <div class="attack-visual ${op.phase === "returning" ? "returning" : ""}">
        <div class="attack-line"></div>
        <div class="attack-node home">Your<br>Lab</div>
        <div class="attack-node target">Target<br>Lab</div>
        <div class="attack-packet"></div>
      </div>

      <p class="muted">
        ${escapeHtml(phase)}
      </p>

      <div class="row"><span>Target</span><span>${escapeHtml(op.targetName || "Unknown")}</span></div>
      <div class="row"><span>Distance</span><span>${escapeHtml(String(op.distance || "?"))} Trace Unit</span></div>
      <div class="row"><span>Phase</span><span>${escapeHtml(phase)}</span></div>

      <div id="operationDetailCountdown" class="travel-countdown">
        ${op.status === "completed" ? "Completed" : formatSeconds(getOperationRemaining(op))}
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
  return `
    <div class="row">
      <span>${label}</span>
      <b>${value}</b>
    </div>
  `;
}

function getBuildingLevel(building) {
  return Number(building?.level ?? 0);
}

function isBuildingLocked(building) {
  return Boolean(building?.locked);
}

function getBuildingStatusText(building) {
  if (!building) return "Unknown";

  if (isBuildingLocked(building)) {
    return "Locked";
  }

  if (getBuildingLevel(building) <= 0) {
    return "Build Required";
  }

  return `Lv.${getBuildingLevel(building)}`;
}

function getBuildingActionText(building) {
  if (!building) return "Unknown";

  if (isBuildingLocked(building)) {
    return "Locked";
  }

  if (getBuildingLevel(building) <= 0) {
    return `Build ${building.name || "Building"}`;
  }

  return `Upgrade ${building.name || "Building"}`;
}

function getBuildingRequirementText(buildingId) {
  if (buildingId === "unit_factory") {
    return "Main Lab Lv.1";
  }

  if (buildingId === "radar_tower") {
    return "Main Lab Lv.1 dan Unit Factory Lv.1";
  }

  if (buildingId === "research_lab") {
    return "Main Lab Lv.2";
  }

  if (buildingId === "recovery_center") {
    return "Main Lab Lv.2";
  }

  if (buildingId === "ai_core") {
    return "Main Lab Lv.3";
  }

  if (buildingId === "guild_gate") {
    return "Main Lab Lv.5";
  }

  return "";
}

function getBeginnerMission() {
  const buildings = buildingsData?.buildings || {};
  const player = state?.player || {};
  const units = player.unit_inventory || {};

  const mainLab = buildings.main_lab || {};
  const unitFactory = buildings.unit_factory || {};
  const radarTower = buildings.radar_tower || {};

  const mainLabLevel = getBuildingLevel(mainLab);
  const factoryLevel = getBuildingLevel(unitFactory);
  const radarLevel = getBuildingLevel(radarTower);

  const breakerCount = Number(
    units?.breaker?.["1"] ??
    units?.breaker ??
    0
  );

  if (mainLabLevel <= 0) {
    return {
      title: "Mission 1: Build Main Lab",
      text: "Bangun Main Lab untuk memulai base dan membuka bangunan awal.",
      action: "Build Main Lab",
      buildingId: "main_lab",
    };
  }

  if (factoryLevel <= 0) {
    return {
      title: "Mission 2: Build Unit Factory",
      text: "Unit Factory sudah terbuka, tapi belum dibangun. Bangun dulu agar kamu bisa melatih pasukan.",
      action: "Build Unit Factory",
      buildingId: "unit_factory",
    };
  }

  if (breakerCount < 10) {
    return {
      title: "Mission 3: Train Breaker",
      text: "Latih minimal 10 Breaker Lv.1 sebagai pasukan awal untuk menyerang monster kecil.",
      action: "Train Breaker",
      buildingId: "unit_factory",
    };
  }

  if (radarLevel <= 0) {
    return {
      title: "Mission 4: Build Radar Tower",
      text: "Bangun Radar Tower agar kamu bisa mencari monster di sekitar base.",
      action: "Build Radar Tower",
      buildingId: "radar_tower",
    };
  }

  return {
    title: "Mission 5: Scan Area",
    text: "Gunakan Radar untuk mencari monster kecil. Radar Lv.1 hanya menampilkan target sesuai kemampuan awal.",
    action: "Open Radar",
    buildingId: "radar_tower",
  };
}

function renderBeginnerMissionCard() {
  if (!buildingsData) return "";

  const mission = getBeginnerMission();

  return `
    <div class="mission-card">
      <div class="mission-title">${escapeHtml(mission.title)}</div>
      <div class="mission-text">${escapeHtml(mission.text)}</div>
      <button onclick="focusMissionBuilding('${mission.buildingId}')">
        ${escapeHtml(mission.action)}
      </button>
    </div>
  `;
}

function focusMissionBuilding(buildingId) {
  const building = buildingsData?.buildings?.[buildingId];

  if (!building) {
    alert("Building belum tersedia.");
    return;
  }

  if (buildingId === "radar_tower" && getBuildingLevel(building) > 0) {
    switchPage("radarPage");
    return;
  }

  openBuilding(buildingId);
}

function statusIcon(name) {
  return `<img src="assets/icons/${name}.webp" alt="${name}" onerror="this.style.display='none'">`;
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
  selectedAi = new Set(state?.player?.active_ai || []);

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

async function upgradeBuilding(buildingId) {
  try {
    const result = await api(`/api/buildings/${buildingId}/upgrade`, {
      method: "POST"
    });

    await loadState();
    await loadBuildings();

    alert(result.message || "Building upgraded.");

    if (buildingId === "ai_core") {
      renderAiCoreSheet("upgrade");
      return;
    }

    if (buildingId === "unit_factory") {
      renderUnitFactorySheet("upgrade");
      return;
    }

    if (buildingId === "research_lab") {
      renderResearchLabSheet("upgrade");
      return;
    }

    if (buildingId === "radar_tower") {
      openRadarUpgradeSheet();
      return;
    }

    openBuilding(buildingId);
  } catch (err) {
    alert("Gagal upgrade building: " + err.message);
  }
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

  const buildingCards = order.map(id => {
    const b = buildingsData.buildings[id];
    if (!b) return "";

    const levelText = getBuildingStatusText(b);

    const lockedClass = b.locked
      ? "locked-building"
      : getBuildingLevel(b) <= 0
        ? "needs-build-building"
        : "";

    return `
      <div class="building-slot">
        <div class="building ${id} ${lockedClass}" onclick="openBuilding('${id}')">
          <img src="${b.asset}" alt="${b.name}">
          <div class="building-name">${b.name}</div>
          <div class="building-level">${getBuildingStatusText(b)}</div>
        </div>
      </div>
    `;
  }).join("");

  baseGrid.innerHTML = `
    ${renderBeginnerMissionCard()}
    ${buildingCards}
  `;
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
  const radar = buildingsData?.buildings?.radar_tower || {};
  const player = state?.player || {};

  const radarLevel = Number(
    radar.level ?? player.scanner_level ?? player.radar_level ?? 0
  );

  const isLocked = Boolean(radar.locked);

  const title = radarLevel <= 0
    ? "Build Radar Tower"
    : "Radar Tower Upgrade";

  const actionText = radarLevel <= 0
    ? "Build Radar Tower"
    : "Upgrade Radar Tower";

  const description = isLocked
    ? "Radar Tower masih terkunci. Bangun Main Lab dan Unit Factory dulu."
    : radarLevel <= 0
      ? "Bangun Radar Tower untuk membuka scan monster dan target di sekitar base."
      : "Upgrade Radar meningkatkan radius scan dan jumlah target yang bisa ditemukan.";

  const nextInfo = radarLevel <= 0
    ? "Setelah dibangun, Radar Lv.1 bisa menemukan max 2 enemy dan 0 mining."
    : "Level lebih tinggi membuka radius scan lebih jauh, lebih banyak enemy, dan mining node.";

  showBuildingSheet(
    title,
    `
      <p class="muted">
        ${description}
      </p>

      ${row("Current Radar", `Lv.${radarLevel}`)}
      ${row("Scanner", `Lv.${radarLevel}`)}
      ${row("Scout", `Lv.${radarLevel}`)}
      ${row("Next", nextInfo)}

      ${
        isLocked
          ? `<p class="muted">Requirement: Main Lab Lv.1 dan Unit Factory Lv.1</p>`
          : ``
      }

      <div class="sheet-actions">
        <button ${isLocked ? "disabled" : ""} onclick="upgradeBuilding('radar_tower')">
          ${isLocked ? "Locked" : actionText}
        </button>
        <button disabled>Split Scanner/Scout Later</button>
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

async function toggleAiFromCore(id) {
  const maxSlot = Number(state?.player?.ai_core_level || 1);
  const nextActive = new Set(selectedAi);

  if (nextActive.has(id)) {
    nextActive.delete(id);
  } else {
    if (nextActive.size >= maxSlot) {
      alert(`AI Core kamu hanya punya ${maxSlot} slot aktif.`);
      return;
    }

    nextActive.add(id);
  }

  try {
    const result = await api("/api/ai-core/active", {
      method: "POST",
      body: JSON.stringify({
        active_ai: [...nextActive]
      })
    });

    selectedAi = new Set(result.active_ai || []);

    await loadState();

    renderAiCoreSheet(currentAiCoreTab || "agents");
  } catch (err) {
    alert("Gagal mengubah active AI: " + err.message);
  }
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
        <button onclick="upgradeBuilding('ai_core')">Upgrade AI Core</button>
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

  const level = getBuildingLevel(b);

  if (b.locked) {
    showBuildingSheet(
      `${b.name} Locked`,
      `
        <p class="muted">${b.description || "Building masih terkunci."}</p>

        ${row("Status", "Locked")}
        ${row("Requirement", getBuildingRequirementText(buildingId) || "Requirement belum tersedia")}

        <div class="sheet-actions">
          <button disabled>Locked</button>
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      `
    );
    return;
  }

  if (level <= 0) {
    showBuildingSheet(
      `Build ${b.name}`,
      `
        <p class="muted">
          ${b.description || ""}
        </p>

        <p class="muted">
          Bangunan ini sudah terbuka, tapi belum dibangun.
          Tekan tombol Build untuk mengaktifkan fiturnya.
        </p>

        ${row("Status", "Build Required")}
        ${row("Level", "0")}
        ${row("Next", "Lv.1")}

        <div class="sheet-actions">
          <button onclick="upgradeBuilding('${buildingId}')">Build ${b.name}</button>
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      `
    );
    return;
  }

  if (buildingId === "unit_factory") {
    renderUnitFactorySheet(currentUnitFactoryTab || "train");
    return;
  }

  if (buildingId === "research_lab") {
    renderResearchLabSheet("research");
    return;
  }

  if (buildingId === "radar_tower") {
    showBuildingSheet(
      `${b.name} Lv.${level}`,
      `
        <p class="muted">${b.description}</p>

        ${row("Status", "Active")}
        ${row("Level", `Lv.${level}`)}
        ${row("Scan", "Monster dan target tersedia sesuai level Radar")}

        <div class="sheet-actions">
          <button onclick="closeBuildingSheet(); switchPage('radarPage')">Open Radar</button>
          <button onclick="openRadarUpgradeSheet()">Upgrade Radar</button>
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      `
    );
    return;
  }

  if (buildingId === "ai_core") {
    if (typeof renderAiCoreSheet === "function") {
      renderAiCoreSheet("agents");
      return;
    }

    switchPage("aiPage");
    return;
  }

  const levelText = getBuildingStatusText(b);

  showBuildingSheet(
    `${b.name} ${levelText}`,
    `
      <p class="muted">${b.description}</p>

      ${row("Status", "Active")}
      ${row("Level", `Lv.${level}`)}

      <div class="sheet-actions">
        <button onclick="upgradeBuilding('${buildingId}')">Upgrade ${b.name}</button>
        <button onclick="closeBuildingSheet()">Close</button>
      </div>
    `
  );
}

let currentDefenseSetupTab = "build";
let defenseSetupData = null;

async function openDefenseSetupSheet(tab = "build") {
  try {
    defenseSetupData = await api("/api/defense");
    currentDefenseSetupTab = tab;

    renderDefenseSetupSheet();
  } catch (err) {
    alert("Gagal membuka Defense Setup: " + err.message);
  }
}

function renderDefenseSetupTabs(activeTab) {
  const tabs = [
    { id: "build", label: "Defense Build" },
    { id: "stats", label: "Stats" },
  ];

  return `
    <div class="facility-tabs defense-setup-tabs">
      ${tabs.map(tab => `
        <button
          class="${activeTab === tab.id ? "active" : ""}"
          onclick="openDefenseSetupSheet('${tab.id}')"
        >
          ${tab.label}
        </button>
      `).join("")}
    </div>
  `;
}

function formatRecoveryCost(cost) {
  const parts = [];

  if (Number(cost?.credits || 0) > 0) {
    parts.push(`Credits ${Number(cost.credits).toLocaleString()}`);
  }

  if (Number(cost?.nano_parts || 0) > 0) {
    parts.push(`Nano ${Number(cost.nano_parts).toLocaleString()}`);
  }

  if (Number(cost?.energy || 0) > 0) {
    parts.push(`Energy ${Number(cost.energy).toLocaleString()}`);
  }

  return parts.length ? parts.join(" · ") : "Free";
}

function renderRecoveryItem(item) {
  return `
    <div class="recovery-unit-card">
      <div class="recovery-unit-top">
        <div>
          <b>${escapeHtml(item.name)} Lv.${item.level}</b>
          <small>Ready: ${Number(item.owned || 0).toLocaleString()}</small>
        </div>

        <span>${Number(item.disabled || 0).toLocaleString()} Disabled</span>
      </div>

      ${row("Recover x1", formatRecoveryCost(item.cost_one))}
      ${row("Recover All", formatRecoveryCost(item.cost_all))}

      <div class="sheet-actions recovery-actions">
        <button onclick="recoverUnit('${item.unit_id}', ${item.level}, 1)">
          Recover 1
        </button>

        <button onclick="recoverUnit('${item.unit_id}', ${item.level}, ${item.disabled})">
          Recover All
        </button>
      </div>
    </div>
  `;
}

async function renderRecoveryCenterSheet() {
  try {
    const data = await api("/api/recovery");

    const items = data.items || [];

    const listHtml = items.length
      ? items.map(renderRecoveryItem).join("")
      : `
        <div class="recovery-empty">
          <b>No disabled units</b>
          <p class="muted">
            Unit disabled dari battle akan muncul di sini dan bisa dipulihkan.
          </p>
        </div>
      `;

    showBuildingSheet(
      `Recovery Center Lv.${data.recovery_center_level || 1}`,
      `
        <p class="muted">
          Memulihkan unit disabled agar kembali ke pasukan siap tempur.
          Destroyed unit tidak bisa dipulihkan.
        </p>

        <div class="recovery-summary">
          ${row("Disabled Units", Number(data.total_disabled || 0).toLocaleString())}
          ${row("Credits", Number(data.resources?.credits || 0).toLocaleString())}
          ${row("Nano Parts", Number(data.resources?.nano_parts || 0).toLocaleString())}
          ${row("Energy", Number(data.energy || 0).toLocaleString())}
        </div>

        <div class="recovery-list">
          ${listHtml}
        </div>

        <div class="sheet-actions">
          <button onclick="renderRecoveryCenterSheet()">Refresh</button>
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      `
    );
  } catch (err) {
    alert("Gagal membuka Recovery Center: " + err.message);
  }
}

async function recoverUnit(unitId, level, amount) {
  try {
    const result = await api("/api/recovery/recover", {
      method: "POST",
      body: JSON.stringify({
        unit_id: unitId,
        level: Number(level),
        amount: Number(amount),
      }),
    });

    await loadState();
    await renderRecoveryCenterSheet();

    alert(result.message || "Unit recovered.");
  } catch (err) {
    alert("Gagal recover unit: " + err.message);
  }
}

function renderDefenseSetupSheet() {
  const data = defenseSetupData || {};
  const d = data.defense || {};

  showBuildingSheet(
    "Defense Setup",
    `
      ${renderDefenseSetupTabs(currentDefenseSetupTab)}

      ${
        currentDefenseSetupTab === "stats"
          ? renderDefenseStatsTab(d)
          : renderDefenseBuildTab(d)
      }
    `
  );
}

function renderDefenseBuildTab(d) {
  const build = d.defense_build || {};
  const modules = build.modules || [];

  const allModules = d.allowed_modules || [
    "Firewall Core",
    "Trace Monitor",
    "Sentinel",
    "Jammer Core",
    "Trap Net",
    "Repair Node",
    "Vault Guard",
  ];

  return `
    <p class="muted">
      Susun strategi pertahanan saat base kamu diserang. Module ini akan mempengaruhi battle defense.
    </p>

    <div class="defense-setup-card">
      <label>Defense Style</label>
      <select id="defenseStyle">
        ${["Balanced Defense", "Jammer Defense", "Firewall Heavy", "Trap Control", "Vault Turtle"]
          .map(style => `
            <option value="${style}" ${style === d.defense_style ? "selected" : ""}>
              ${style}
            </option>
          `).join("")}
      </select>

      <label>Defense Modules</label>
      <div class="defense-module-select-grid">
        ${allModules.map(module => `
          <label class="defense-module-check">
            <input
              type="checkbox"
              value="${module}"
              ${modules.includes(module) ? "checked" : ""}
            >
            <span>${module}</span>
          </label>
        `).join("")}
      </div>
    </div>

    <div class="sheet-actions">
      <button onclick="saveDefenseBuild()">Save Build</button>
      <button onclick="closeBuildingSheet()">Close</button>
    </div>
  `;
}

async function saveDefenseBuild() {
  const moduleInputs = [...document.querySelectorAll(".defense-module-check input:checked")];

  const payload = {
    defense_style: document.getElementById("defenseStyle")?.value || "Balanced Defense",
    modules: moduleInputs.map(input => input.value),
  };

  try {
    const result = await api("/api/defense", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    alert(result.message || "Defense build saved.");
    await openDefenseSetupSheet("build");
  } catch (err) {
    alert("Gagal save defense: " + err.message);
  }
}

function formatPower(value) {
  const n = Number(value || 0);

  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;

  return String(Math.round(n));
}

function renderDefenseStatsTab(d) {
  const stats = d.stats || {};
  const build = d.defense_build || {};
  const modules = build.modules || [];
  const buffs = stats.active_ai_buffs || {};
  const aiDefenseBonus = Number(stats.ai_defense_bonus_percent || 0);

  const buffRows = Object.keys(buffs).length
    ? Object.entries(buffs).map(([key, value]) => `
        <div class="defense-mini-row">
          <span>${escapeHtml(key)}</span>
          <b>${Number(value) > 0 ? "+" : ""}${escapeHtml(String(value))}%</b>
        </div>
      `).join("")
    : `<p class="muted compact-muted">Tidak ada active AI buff.</p>`;

  return `
    <p class="muted compact-defense-desc">
      Stats ini dihitung dari unit, bangunan, research, AI aktif, dan defense build.
      Anti Scout Score dipakai saat musuh melakukan Scout ke base kamu.
    </p>

    <div class="defense-overview-grid">
      <div class="defense-overview-card main">
        <small>Defense Power</small>
        <b>${formatPower(stats.defense_power)}</b>
        <span>Total kekuatan pertahanan</span>
      </div>

      <div class="defense-overview-card">
        <small>Anti Scout</small>
        <b>${formatPower(stats.anti_scout_score)}</b>
        <span>Melawan Scout Drone</span>
      </div>
    </div>

    <div class="defense-breakdown-card">
      <div class="defense-breakdown-title">
        <h3>Power Breakdown</h3>
        <span>Formula aktif</span>
      </div>

      <div class="defense-breakdown-grid">
        <div>
          <small>Army</small>
          <b>${formatPower(stats.army_power)}</b>
        </div>

        <div>
          <small>Base</small>
          <b>${formatPower(stats.base_power)}</b>
        </div>

        <div>
          <small>Research</small>
          <b>${formatPower(stats.research_power)}</b>
        </div>

        <div>
          <small>AI</small>
          <b>${formatPower(stats.ai_power)}</b>
        </div>

        <div>
          <small>Module</small>
          <b>${formatPower(stats.module_score)}</b>
        </div>

        <div>
          <small>AI DEF Bonus</small>
          <b>${aiDefenseBonus > 0 ? "+" : ""}${aiDefenseBonus}%</b>
        </div>
      </div>
    </div>

    <div class="defense-compact-info">
      ${row("Jammer Level", stats.jammer_level || 1)}
      ${row("AI Multiplier", `×${stats.ai_multiplier || 1}`)}
      ${row("Defense Style", d.defense_style || "Balanced Defense")}
      ${row("Modules", modules.length ? modules.join(", ") : "None")}
    </div>

    <div class="defense-compact-info">
      <div class="defense-breakdown-title">
        <h3>Active AI Buff</h3>
        <span>${Object.keys(buffs).length} buff</span>
      </div>
      ${buffRows}
    </div>

    <div class="sheet-actions">
      <button disabled>Upgrade Jammer in Research Later</button>
      <button onclick="openDefenseSetupSheet('build')">Edit Build</button>
      <button onclick="closeBuildingSheet()">Close</button>
    </div>
  `;
}

function num(v) {
  return Number(v || 0);
}

function getLevelStat(lv, key) {
  return num(lv?.[key] ?? lv?.stats?.[key]);
}

function getResourceLabel(resourceId) {
  const labels = {
    credits: "Credits",
    nano_parts: "Nano Parts",
    data_shard: "Data Shard",
    nexus_core: "Nexus Core",
  };

  return labels[resourceId] || resourceId;
}

function getResourceAmount(resourceId) {
  const r = getResourceBag();
  const p = state?.player || buildingsData?.player || {};

  if (resourceId === "credits") {
    return num(r.credits ?? p.credits ?? 0);
  }

  return num(r[resourceId] ?? 0);
}

function cleanEconomyCost(cost) {
  const clean = {};

  Object.entries(cost || {}).forEach(([resourceId, amount]) => {
    amount = num(amount);

    if (amount <= 0) return;

    // Energy bukan resource ekonomi untuk train.
    if (resourceId === "energy") return;

    clean[resourceId] = amount;
  });

  return clean;
}

function getCostText(cost) {
  const clean = cleanEconomyCost(cost);
  const order = ["credits", "nano_parts", "data_shard", "nexus_core"];

  const parts = order
    .filter(resourceId => clean[resourceId] > 0)
    .map(resourceId => `${getResourceLabel(resourceId)} ${clean[resourceId]}`);

  return parts.length ? parts.join(" + ") : "Free";
}

function multiplyCost(cost, amount) {
  const clean = cleanEconomyCost(cost);
  const total = {};

  Object.entries(clean).forEach(([resourceId, value]) => {
    total[resourceId] = num(value) * num(amount);
  });

  return total;
}

function getTrainCostText(trainCost) {
  if (!trainCost) return "Research required";
  return getCostText(trainCost);
}

function getTotalTrainCostText(amount, trainCost) {
  return getCostText(multiplyCost(trainCost, amount));
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
  return `assets/units/${unit.id}_lv${level}.webp`;
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
  const factoryLevel = getBuildingLevel(factory);

  if (factory.locked) {
    showBuildingSheet(
      "Unit Factory Locked",
      `
        <p class="muted">
          Unit Factory masih terkunci.
        </p>

        ${row("Status", "Locked")}
        ${row("Requirement", getBuildingRequirementText("unit_factory"))}

        <div class="sheet-actions">
          <button disabled>Locked</button>
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      `
    );
    return;
  }

  if (factoryLevel <= 0) {
    showBuildingSheet(
      "Build Unit Factory",
      `
        <p class="muted">
          Unit Factory sudah terbuka, tapi belum dibangun.
          Bangun Unit Factory dulu sebelum melatih pasukan.
        </p>

        ${row("Status", "Build Required")}
        ${row("Level", "0")}
        ${row("Next", "Train Breaker Lv.1")}

        <div class="sheet-actions">
          <button onclick="upgradeBuilding('unit_factory')">Build Unit Factory</button>
          <button onclick="closeBuildingSheet()">Close</button>
        </div>
      `
    );
    return;
  }

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
        <button onclick="upgradeBuilding('unit_factory')">Upgrade Unit Factory</button>
      </div>
    </div>
  `;
}

let trainAmountDraft = {};

function trainAmountKey(unitId, level) {
  return `${unitId}_${level}`;
}

function getResourceLabel(resourceId) {
  const labels = {
    credits: "Credits",
    nano_parts: "Nano Parts",
    data_shard: "Data Shard",
    nexus_core: "Nexus Core",
  };

  return labels[resourceId] || resourceId;
}

function getResourceAmount(resourceId) {
  const r = getResourceBag();
  const p = state?.player || buildingsData?.player || {};

  if (resourceId === "credits") {
    return num(r.credits ?? p.credits ?? 0);
  }

  return num(r[resourceId] ?? 0);
}

function cleanEconomyCost(cost) {
  const clean = {};

  Object.entries(cost || {}).forEach(([resourceId, amount]) => {
    amount = num(amount);

    if (amount <= 0) return;

    // Energy bukan biaya train.
    if (resourceId === "energy") return;

    clean[resourceId] = amount;
  });

  return clean;
}

function getCostText(cost) {
  const clean = cleanEconomyCost(cost);
  const order = ["credits", "nano_parts", "data_shard", "nexus_core"];

  const parts = order
    .filter(resourceId => clean[resourceId] > 0)
    .map(resourceId => `${getResourceLabel(resourceId)} ${clean[resourceId]}`);

  return parts.length ? parts.join(" + ") : "Free";
}

function multiplyCost(cost, amount) {
  const clean = cleanEconomyCost(cost);
  const total = {};

  Object.entries(clean).forEach(([resourceId, value]) => {
    total[resourceId] = num(value) * num(amount);
  });

  return total;
}

function getTrainCostText(trainCost) {
  if (!trainCost) return "Research required";
  return getCostText(trainCost);
}

function getTotalTrainCostText(amount, trainCost) {
  return getCostText(multiplyCost(trainCost, amount));
}

function getTrainAffordableMax(trainCost) {
  const clean = cleanEconomyCost(trainCost);
  const limits = [];

  Object.entries(clean).forEach(([resourceId, amount]) => {
    amount = num(amount);

    if (amount <= 0) return;

    const owned = getResourceAmount(resourceId);
    limits.push(Math.floor(owned / amount));
  });

  if (!limits.length) return 999;

  return Math.max(0, Math.min(...limits));
}

function getTrainBatchLimit() {
  const factory = buildingsData?.buildings?.unit_factory || {};
  const level = Number(factory.level ?? 0);

  if (level <= 0) return 0;
  if (level === 1) return 5;
  if (level === 2) return 10;
  if (level === 3) return 20;
  if (level === 4) return 35;

  return 50;
}

function getTrainSliderAmount(unitId, level) {
  const key = trainAmountKey(unitId, level);
  const input = el(`trainRange_${key}`);

  return Math.max(1, Number(input?.value || trainAmountDraft[key] || 1));
}

function getUnitTrainCost(unitId, level) {
  const unit = (buildingsData?.units || []).find(u => u.id === unitId);
  const lv = (unit?.levels || []).find(x => Number(x.level) === Number(level));

  return lv?.train_cost || {};
}

function setTrainSliderAmount(unitId, level, value) {
  const key = trainAmountKey(unitId, level);
  const input = el(`trainRange_${key}`);

  const trainCost = getUnitTrainCost(unitId, level);

  const max = Number(input?.max || 1);
  const amount = Math.max(1, Math.min(max, Number(value || 1)));

  trainAmountDraft[key] = amount;

  if (input) input.value = amount;

  setText(`trainAmount_${key}`, amount);
  setText(`trainButtonAmount_${key}`, amount);
  setText(`trainTotalCost_${key}`, getTotalTrainCostText(amount, trainCost));
}

function trainFromSlider(unitId, level) {
  const amount = getTrainSliderAmount(unitId, level);
  trainUnit(unitId, level, amount);
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
    "scout_drone",
    "scout_signal",
    "unit_capacity",
    "ai_sync"
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
        <button onclick="upgradeBuilding('research_lab')">Upgrade Research Lab</button>
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

function normalizeUnitLevel(level) {
  const n = Number(level);

  if (!Number.isFinite(n) || n < 1) {
    return null;
  }

  return Math.floor(n);
}

function unitStackKey(unitId, level) {
  const lv = normalizeUnitLevel(level);

  if (!lv) {
    console.warn("[ATTACK] Invalid unit level:", unitId, level);
    return null;
  }

  return `${unitId}:${lv}`;
}

function cleanSelectedUnits() {
  Object.keys(selectedUnits || {}).forEach(key => {
    const [unitId, levelText] = String(key).split(":");
    const level = normalizeUnitLevel(levelText);
    const amount = Number(selectedUnits[key] || 0);

    if (!unitId || !level || amount <= 0) {
      delete selectedUnits[key];
    }
  });
}

function buildUnitPayload() {
  cleanSelectedUnits();

  const payload = {};

  Object.entries(selectedUnits || {}).forEach(([key, amount]) => {
    const qty = parseInt(amount || "0", 10);

    if (!qty || qty <= 0) {
      return;
    }

    const [unitId, levelText] = String(key).split(":");
    const level = normalizeUnitLevel(levelText);

    if (!unitId || !level) {
      console.warn("[ATTACK] Skip invalid selected unit:", key, amount);
      return;
    }

    if (!payload[unitId]) {
      payload[unitId] = {};
    }

    payload[unitId][String(level)] = (payload[unitId][String(level)] || 0) + qty;
  });

  return payload;
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
    // Power breakdown dipindahkan ke Defense Stats.

    showBuildingSheet(
      "Commander Profile",
      `
        <div class="cyber-profile-hero">
          <div class="profile-hero-top">
            <div class="profile-hero-avatar">
              <img class="profile-hero-avatar-img" src="assets/profile/avatar.webp" alt="Profile">
              <img class="profile-hero-border-img" src="assets/borders/topup_basic.webp" alt="">
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
  const clearedTargetIds = new Set();

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
    if (data.message) {
      const radarTargetInfo = el("radarTargetInfo");

      if (radarTargetInfo) {
        radarTargetInfo.innerText = data.message;
      }

      addGameMessage(
        "system",
        "Radar Offline",
        data.message
      );

      return;
    }

    if (runId !== radarScanRunId) return;

    clearRadarMarkers();
    radarTargets = (data.targets || []).filter(t => {
      return !clearedTargetIds.has(String(t.id));
    });

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

    if (resource === "data_shard") return "assets/mining/data_cache.webp";
    if (resource === "nano_parts") return "assets/mining/nano_mine.webp";
    if (resource === "credits") return "assets/mining/credit_vault.webp";
    if (resource === "nexus_core") return "assets/mining/nexus_rift.webp";

    return "assets/mining/data_cache.webp";
  }

  const signal = String(target.signal_strength || "").toLowerCase();
  const type = String(target.type || "").toLowerCase();

  if (type.includes("nexus")) {
    return "assets/enemies/enemy_nexus.webp";
  }

  if (signal.includes("strong")) {
    return "assets/enemies/enemy_strong.webp";
  }

  if (signal.includes("medium")) {
    return "assets/enemies/enemy_medium.webp";
  }

  return "assets/enemies/enemy_weak.webp";
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
  marker.dataset.targetId = String(target.id);

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
    marker.classList.toggle(
      "selected",
      marker.dataset.targetId === String(targetId)
    );
  });

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

            <input
              class="unit-amount attack-unit-input"
              type="number"
              min="0"
              max="${lv.owned}"
              value="${selected}"
              onchange="setAttackUnit('${u.id}', ${lv.level}, this.value, '${target.id}')"
            />
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

function getAttackUnitLevelInfo(unitId, level) {
  const unit = state?.units?.find(u => String(u.id) === String(unitId));
  if (!unit) return null;

  return (unit.levels || []).find(lv => Number(lv.level) === Number(level)) || null;
}

function getAttackOwnedAmount(unitId, level) {
  const lv = getAttackUnitLevelInfo(unitId, level);
  return Number(lv?.owned || 0);
}

function clampAttackUnitAmount(unitId, level, value) {
  const owned = getAttackOwnedAmount(unitId, level);
  let amount = parseInt(value || "0", 10);

  if (Number.isNaN(amount)) amount = 0;
  if (amount < 0) amount = 0;
  if (amount > owned) amount = owned;

  return amount;
}

function getAttackUnitLevelInfo(unitId, level) {
  const unit = state?.units?.find(u => String(u.id) === String(unitId));
  const lv = normalizeUnitLevel(level);

  if (!unit || !lv) {
    return null;
  }

  return (unit.levels || []).find(item => Number(item.level) === lv) || null;
}

function getAttackOwnedAmount(unitId, level) {
  const lv = getAttackUnitLevelInfo(unitId, level);
  return Number(lv?.owned || 0);
}

function clampAttackUnitAmount(unitId, level, value) {
  const owned = getAttackOwnedAmount(unitId, level);
  let amount = parseInt(value || "0", 10);

  if (Number.isNaN(amount)) amount = 0;
  if (amount < 0) amount = 0;
  if (amount > owned) amount = owned;

  return amount;
}

function changeAttackUnit(unitId, level, delta, targetId) {
  const key = unitStackKey(unitId, level);

  if (!key) {
    return;
  }

  const current = Number(selectedUnits[key] || 0);
  selectedUnits[key] = clampAttackUnitAmount(unitId, level, current + Number(delta || 0));

  showAttackSetupSheetById(targetId);
}

function setAttackUnitPercent(unitId, level, percent, targetId) {
  const key = unitStackKey(unitId, level);

  if (!key) {
    return;
  }

  const owned = getAttackOwnedAmount(unitId, level);
  selectedUnits[key] = clampAttackUnitAmount(unitId, level, Math.floor(owned * Number(percent || 0) / 100));

  showAttackSetupSheetById(targetId);
}

function setAttackUnitMax(unitId, level, targetId) {
  const key = unitStackKey(unitId, level);

  if (!key) {
    return;
  }

  selectedUnits[key] = getAttackOwnedAmount(unitId, level);

  showAttackSetupSheetById(targetId);
}

function setAttackUnit(unitId, level, value, targetId = null) {
  const key = unitStackKey(unitId, level);

  if (!key) {
    return;
  }

  selectedUnits[key] = clampAttackUnitAmount(unitId, level, value);

  if (targetId) {
    showAttackSetupSheetById(targetId);
  }
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

function removeTargetFromLocalRadar(targetId) {
  if (!targetId) return;

  // Hapus dari state targets jika ada.
  if (Array.isArray(state?.targets)) {
    state.targets = state.targets.filter(t => String(t.id) !== String(targetId));
  }

  // Hapus elemen DOM kalau target card/pin memakai data-target-id.
  document.querySelectorAll(`[data-target-id="${targetId}"]`).forEach(el => {
    el.remove();
  });

  // Reset selectedTarget kalau target yang dihapus sedang dipilih.
  if (String(selectedTarget) === String(targetId)) {
    selectedTarget = null;
  }

  // Render ulang radar/map kalau function-nya ada.
  if (typeof renderRadarTargets === "function") {
    renderRadarTargets();
  }

  if (typeof renderMap === "function") {
    renderMap();
  }

  if (typeof renderRadar === "function") {
    renderRadar();
  }
}

async function launchAttack() {
  try {
    if (!selectedTarget) {
      alert("Pilih target dulu.");
      return;
    }

    const targetId = selectedTarget;

    const payload = {
      target_id: targetId,
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

    // Kalau server bilang target sudah habis/depleted,
    // hapus dari radar lokal dan jangan mulai travel.
    if (
      res.target_depleted ||
      res.ignored ||
      res.phase === "ignored" ||
      res.target_status === "depleted" ||
      res.target_status === "collapsed"
    ) {
      markTargetCleared(targetId);

      addGameMessage(
        "system",
        "Target Cleared",
        "Target ini sudah dikalahkan dan sinyalnya dihapus dari radar."
      );

      alert("Target sudah dikalahkan dan dihapus dari radar.");
      return;
    }

    // Attack sekarang baru START.
    // Battle, reward, trace, dan NPC hilang nanti terjadi saat impact/return.
    const log = Array.isArray(res.battle_log)
      ? res.battle_log.join("\n")
      : "Attack started. Units are moving to target.";

    addGameMessage(
      "system",
      "Attack Launched",
      "Pasukan sudah berangkat menuju target. Battle belum terjadi."
    );

    await loadState();

    showAttackTravelSheet(res, log, targetId);
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

let onboardingLanguageDraft = "id";

function getSuggestedCommanderName() {
  const p = state?.player || {};

  return (
    p.commander_name ||
    p.username ||
    telegramUser?.username ||
    telegramUser?.first_name ||
    "Commander"
  );
}

function maybeShowOnboarding() {
  if (!state?.player) return;

  if (state.player.onboarding_complete) {
    return;
  }

  showOnboardingGate();
}

function showOnboardingGate() {
  const old = document.getElementById("onboardingGate");
  if (old) old.remove();

  onboardingLanguageDraft = state?.player?.language || telegramUser?.language_code || "id";

  if (!["id", "en"].includes(onboardingLanguageDraft)) {
    onboardingLanguageDraft = "id";
  }

  const suggestedName = getSuggestedCommanderName();

  const gate = document.createElement("div");
  gate.id = "onboardingGate";
  gate.className = "onboarding-gate";

  gate.innerHTML = `
    <div class="onboarding-card">
      <div class="onboarding-logo">CC</div>

      <small>CYBERCORE LAB NETWORK</small>
      <h1>Commander Registration</h1>

      <p>
        Identitas Telegram kamu sudah terhubung. Sekarang buat nama Commander
        untuk masuk ke jaringan CyberCore.
      </p>

      <label>Language</label>
      <div class="onboarding-language-row">
        <button id="onboardLangId" onclick="selectOnboardingLanguage('id')">Indonesia</button>
        <button id="onboardLangEn" onclick="selectOnboardingLanguage('en')">English</button>
      </div>

      <label>Commander Name</label>
      <input
        id="onboardingCommanderName"
        maxlength="24"
        value="${escapeHtml(String(suggestedName)).replace(/"/g, "&quot;")}"
        placeholder="Commander name"
      />

      <small class="onboarding-note">
        Nama ini akan tampil di profile, radar PvP, dan scout report.
      </small>

      <button class="onboarding-start-btn" onclick="completeOnboarding()">
        Enter CyberCore
      </button>
    </div>
  `;

  document.body.appendChild(gate);
  selectOnboardingLanguage(onboardingLanguageDraft);
}

function selectOnboardingLanguage(lang) {
  onboardingLanguageDraft = lang;

  const idBtn = document.getElementById("onboardLangId");
  const enBtn = document.getElementById("onboardLangEn");

  if (idBtn) idBtn.classList.toggle("active", lang === "id");
  if (enBtn) enBtn.classList.toggle("active", lang === "en");
}

async function completeOnboarding() {
  const input = document.getElementById("onboardingCommanderName");
  const commanderName = String(input?.value || "").trim();

  if (commanderName.length < 3) {
    alert("Commander name minimal 3 karakter.");
    return;
  }

  try {
    const result = await api("/api/onboarding/complete", {
      method: "POST",
      body: JSON.stringify({
        language: onboardingLanguageDraft,
        commander_name: commanderName
      })
    });

    const gate = document.getElementById("onboardingGate");
    if (gate) gate.remove();

    await loadState();
    await loadBuildings();

    showBuildingSheet(
      "Registration Complete",
      `
        <div class="profile-card">
          <h3>${escapeHtml(result.profile.commander_name)}</h3>
          <p class="muted">Commander registered in CyberCore Lab.</p>

          ${row("Player ID", result.player_id)}
          ${row("Language", result.profile.language)}
          ${row("Referral Code", result.profile.referral_code)}

          <p class="muted" style="margin-top:12px;">
            Base awal sudah dibuat. Ikuti Mission Card di halaman Base:
            bangun Main Lab, bangun Unit Factory, latih Breaker, lalu bangun Radar Tower.
          </p>

          <div class="sheet-actions">
            <button onclick="closeBuildingSheet()">Enter Base</button>
          </div>
        </div>
      `
    );
  } catch (err) {
    alert("Registration failed: " + err.message);
  }
}

async function initApp() {
  await initTelegramMiniApp();
  await loadState();
  maybeShowOnboarding();
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