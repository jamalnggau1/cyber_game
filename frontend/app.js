let state = null;
let buildingsData = null;
let isRallyMode = false;
let selectedRallyTime = 300;
const clearedTargetIds = new Set();
let gameMessages = [];
let currentUnitFactoryView = null;
let contestedNodes = [];
let currentResearchLabTab = "research";
let currentUnitFactoryTab = "train";
let isLaunchingAttack = false;
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
    tg.setHeaderColor("#4A86CF");
    tg.setBackgroundColor("#4A86CF");
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

window.openNexusNode = function(nodeId) {
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
        <button class="guild-btn-danger text-bold" onclick="launchNexusRally('${node.id}')">Guild Rally</button>
        <button onclick="closeBuildingSheet(); scoutPopup('${node.id}')">Scout</button>
        <button onclick="openNexusWarSheet()">Back</button>
      </div>
    `
  );
};

// === FUNGSI JEMBATAN AGAR NEXUS BISA MASUK KE LAYAR RALLY ===
window.launchNexusRally = function(nodeId) {
  const node = contestedNodes.find(n => n.id === nodeId);
  if (!node) return;

  // Pastikan array radarTargets tersedia
  window.radarTargets = window.radarTargets || [];

  // Suntikkan data Nexus ke dalam radar lokal HP pemain sementara waktu
  // agar mesin Rally Setup mengenali Nexus ini sebagai target yang sah!
  const existing = window.radarTargets.find(t => t.id === node.id);
  if (!existing) {
      window.radarTargets.push({
          id: node.id,
          name: node.name,
          distance: 100, // Anggap jarak ke tengah map (Nexus) adalah 100 Trace Unit
          signal_strength: "Massive Nexus Energy",
          lab_tier: "Nexus Core",
          firewall: "Impenetrable Nexus Wall"
      });
  }

  // Buka layar persiapan Rally seperti biasa!
  openRallySetup(node.id);
};

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
  // === TAMBAHAN BARU: TEKS UNTUK RALLY JOIN ===
  if (op.type === "rally_join") {
    if (now < Number(op.endsAt || 0)) {
      return "Marching to Rally Point"; // Teks saat sedang berjalan
    }
    return "Waiting at Rally Point";    // Teks saat sudah sampai markas Kapten
  }
  // ============================================

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

    if (op.phase === "occupying") {
      return "Mining resource";
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
  const opId = attackResult.id || `atk_${now}`;

  const op = {
    id: opId,
    type: "attack",
    phase: attackResult.phase || "outbound",
    status: "running",

    title: `Attacking ${target?.name || attackResult.target_name || targetId || "Unknown Target"}`,
    targetId: targetId || attackResult.target_id,
    targetName: target?.name || attackResult.target_name || "Unknown Target",
    distance: target?.distance || attackResult.distance || "?",

    outboundSeconds: outbound,
    returnSeconds: returnSeconds,

    totalSeconds: outbound,
    startedAt: now,
    reachedAt: now + outbound * 1000,
    endsAt: now + outbound * 1000,

    result: attackResult,
    finalLog: Array.isArray(attackResult.battle_log)
      ? attackResult.battle_log.join("\n")
      : (finalLogText || "")
  };

  // === PERBAIKAN BUG LAYAR KEMBAR (CLOCK DRIFT FIX) ===
  // Cek apakah server sudah memasukkan data ini ke layar. 
  // Jika sudah ada, timpa saja datanya, JANGAN DITAMBAH BARU!
  const existingIndex = activeOperations.findIndex(o => o.id === opId);
  if (existingIndex >= 0) {
    activeOperations[existingIndex] = op;
  } else {
    activeOperations.unshift(op);
  }
  // ====================================================

  addGameMessage(
    "battle",
    "Attack Launched",
    `${op.title}\nDistance: ${op.distance} Trace Unit\nOutbound Time: ${formatSeconds(outbound)}\nReturn Time: ${formatSeconds(returnSeconds)}\nStatus: Units are going to target.`
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

  // === TAMPILKAN TOMBOL RECALL/ABORT BERDASARKAN FASE ===
  let recallBtn = "";
  if (op.phase === "occupying") {
    // Tombol kuning untuk menarik pasukan yang sedang menambang
    recallBtn = `<button onclick="recallOperation('${op.id}')" style="background:var(--warn); color:#000; border:none; padding:8px 12px; border-radius:6px; font-weight:bold; cursor:pointer; flex: 1;">Recall Troops</button>`;
  } else if (op.phase === "outbound") {
    // Tombol merah untuk membatalkan serangan di tengah jalan
    recallBtn = `<button onclick="recallOperation('${op.id}')" style="background:var(--bad); color:#fff; border:none; padding:8px 12px; border-radius:6px; font-weight:bold; cursor:pointer; flex: 1;">Abort Mission</button>`;
  }
  // ======================================================

  return `
    <div class="operation-card" data-op-id="${op.id}">
      <div class="operation-type" style="background: ${op.phase === "occupying" ? "var(--good)" : "var(--accent2)"}; color:#000; font-weight:bold; padding:2px 6px; border-radius:4px; display:inline-block; font-size:10px; margin-bottom:6px;">
        ${(op.phase === "occupying" ? "MINING" : op.type).toUpperCase()}
      </div>
      
      <h3 style="margin: 4px 0;">${escapeHtml(op.title || "Operation")}</h3>

      <small id="opPhase_${op.id}" class="muted" style="display:block; margin-bottom:4px;">
        ${escapeHtml(getOperationPhaseText(op))}
      </small>

      <small>
        <span id="opRemain_${op.id}" class="operation-status-running">
          ${op.status === "completed" ? "Completed" : `${formatSeconds(remaining)} remaining`}
        </span>
      </small>

      <small style="display:block; margin-top:4px;">Distance: ${escapeHtml(String(op.distance || "?"))} Trace Unit</small>

      <div class="operation-progress" style="margin-top:8px;">
        <div id="opProgress_${op.id}" style="width:${progress}%"></div>
      </div>

      <div class="sheet-actions" style="margin-top:12px; display:flex; gap:8px;">
        ${recallBtn}
        <button onclick="openOperationDetail('${op.id}')" style="flex: 1;">View Detail</button>
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

    // --- FIX: TANGANI FASE OCCUPYING (MINING) ---
    if (data.phase === "occupying") {
      op.phase = "occupying";
      op.status = "running";
      op.title = `Mining at ${data.target_name || op.targetName || "Target"}`;
      op.startedAt = Date.now();
      
      // Hitung batas waktu tambang
      op.endsAt = data.occupy_ends_at ? (Number(data.occupy_ends_at) * 1000) : (Date.now() + 86400000);
      op.totalSeconds = Math.max(1, Math.ceil((op.endsAt - op.startedAt) / 1000));
      op.occupy_ends_at = data.occupy_ends_at;

      addGameMessage(
        "battle",
        "Mining Started",
        `${data.target_name || op.targetName || "Target"}\n${op.finalLog}\nUnits are occupying the node.`
      );

      // === UPDATE INDIVIDUAL RADAR & MAP (TANPA FULL REFRESH) ===
      const targetIdStr = String(op.targetId || data.target_id);
      
      // 1. Update data radar di memori lokal secara instan
      if (typeof radarTargets !== 'undefined') {
        const targetInRadar = radarTargets.find(t => String(t.id) === targetIdStr);
        if (targetInRadar) {
          targetInRadar.status = "Occupied";
          targetInRadar.owner = state?.player?.id || "YOU";
          
          // 2. Jika popup informasi tambang ini sedang terbuka di layar, render ulang!
          if (String(selectedTarget) === targetIdStr) {
            openMiningNodeSheet(targetInRadar);
          }
        }
      }

      // 3. Tambahkan efek cincin merah di map (occupied-node) secara instan
      const marker = document.querySelector(`.enemy-marker[data-target-id="${targetIdStr}"]`);
      if (marker) {
        marker.classList.add("occupied-node");
      }
      // ========================================================

      // Gunakan sinkronisasi senyap (anti-glitch) menggantikan loadState()
      if (typeof silentSync === "function") {
        await silentSync();
      }

      renderOperationQueueList();
      updateOperationQueueWidget();
      return;
    }

    // --- TANGANI FASE RETURNING (PULANG) ---
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
        `${data.target_name || op.targetName || "Target"}\n${op.finalLog}\n\nUnits are returning to base.`
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

async function recallOperation(attackId) {
  try {
    // PERBAIKAN: Menggunakan format { method: "POST" } yang benar
    const data = await api(`/api/attack/${attackId}/recall`, { method: "POST" });
    
    // === PENGHAPUSAN MAP MARKER SECARA INSTAN ===
    // Jika server bilang tambang sudah habis, musnahkan dari layar!
    if (data.target_depleted) {
      const tId = String(data.target_id);

      // Bersihkan dari memori radar HP
      if (typeof radarTargets !== 'undefined') {
        radarTargets = radarTargets.filter(t => String(t.id) !== tId);
      }
      if (typeof placedRadarPoints !== 'undefined') {
        placedRadarPoints = placedRadarPoints.filter(t => String(t.id) !== tId);
      }

      // HAPUS PAKSA elemen gambar/ikon di peta!
      document.querySelectorAll(`[data-target-id="${tId}"], [data-id="${tId}"], [id*="${tId}"]`).forEach(el => el.remove());

      // Tutup popup jika kebetulan pemain sedang melihat popup-nya
      if (String(selectedTarget) === tId) {
        closeBuildingSheet();
      }
    }
    // ============================================

    // Paksa sinkronisasi senyap agar queue dan UI terupdate
    if (typeof silentSync === "function") {
      await silentSync();
    } else {
      await loadState();
    }

  } catch (err) {
    console.warn("Recall failed:", err);
    
    if (err.message.includes("tidak sedang menambang")) {
      alert("⚠️ Terlambat! Pasukanmu sudah ditarik mundur atau baru saja diusir paksa oleh komandan musuh!");
      if (typeof silentSync === "function") silentSync(); 
      else loadState();
    } else {
      alert("Gagal recall pasukan: " + err.message);
    }
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
        `${op.title}\nTarget: ${op.targetName || "Unknown"}\nDistance: ${op.distance} Trace Unit\n\n${op.finalLog}`,
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
      
      // AUTO RECALL JIKA WAKTU MINING HABIS
      if (op.phase === "occupying") {
        await recallOperation(op.id);
        continue;
      }

      continue;
    }

    op.status = "completed";
  }

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

function syncOperationsFromState() {
  if (!state || !state.active_attacks) return;

  const serverOps = Object.values(state.active_attacks).filter(op => 
    op.player_id === state.player.id && op.status === "running"
  );

  activeOperations = activeOperations.filter(localOp =>
    serverOps.some(srvOp => srvOp.id === localOp.id)
  );

  // KUNCI PERBAIKAN: Sensor pendeteksi perubahan nasib
  let forceRedraw = false; 

  serverOps.forEach(srvOp => {
    let localOp = activeOperations.find(o => o.id === srvOp.id);
    const now = Date.now();

    if (!localOp) {
      forceRedraw = true;
      let endsAt = now;
      if (srvOp.phase === "outbound" && srvOp.impact_at) endsAt = srvOp.impact_at * 1000;
      if (srvOp.phase === "returning" && srvOp.return_at) endsAt = srvOp.return_at * 1000;
      if (srvOp.phase === "occupying") endsAt = srvOp.occupy_ends_at ? (srvOp.occupy_ends_at * 1000) : now + 86400000;

      localOp = {
        id: srvOp.id,
        type: srvOp.type || "attack",
        phase: srvOp.phase,
        status: srvOp.status,
        title: srvOp.phase === "occupying" ? `Mining at ${srvOp.target_name}` : `Attacking ${srvOp.target_name}`,
        targetId: srvOp.target_id,
        targetName: srvOp.target_name || "Unknown",
        distance: srvOp.distance || "?",
        startedAt: now,
        endsAt: endsAt,
        totalSeconds: Math.max(1, Math.ceil((endsAt - now) / 1000)),
        occupy_ends_at: srvOp.occupy_ends_at,
        return_at: srvOp.return_at,
        impact_at: srvOp.impact_at
      };
      activeOperations.push(localOp);
    } else {
      
      // Jika server bilang fase berubah (dari Occupying dilempar jadi Returning)
      if (localOp.phase !== srvOp.phase) {
        forceRedraw = true; 

        // === AUTO-REMOVE MAP PIN ===
        // Jika pasukan kita pulang (entah karena kalah, ditarik manual, atau lahan HABIS),
        // hapus titik lahan ini dari map secara instan agar tidak jadi "tambang hantu".
        if (localOp.phase === "occupying" && srvOp.phase === "returning") {
          const tId = String(srvOp.target_id);

          // 1. Hapus dari memori radar
          if (typeof radarTargets !== 'undefined') {
            radarTargets = radarTargets.filter(t => String(t.id) !== tId);
          }

          // 2. Hilangkan icon dari layar
          document.querySelectorAll(`.enemy-marker[data-target-id="${tId}"]`).forEach(el => el.remove());

          // 3. Jika pop-up tambang ini sedang ditatap pemain, tutup paksa!
          if (String(selectedTarget) === tId) {
            closeBuildingSheet();
          }
        }
        // ===========================
      }

      localOp.phase = srvOp.phase;
      localOp.status = srvOp.status;
      localOp.occupy_ends_at = srvOp.occupy_ends_at;
      localOp.return_at = srvOp.return_at;

      if (srvOp.phase === "occupying") {
        localOp.endsAt = srvOp.occupy_ends_at ? (srvOp.occupy_ends_at * 1000) : now + 86400000;
        localOp.title = `Mining at ${srvOp.target_name}`;
      } else if (srvOp.phase === "returning") {
        localOp.endsAt = srvOp.return_at ? (srvOp.return_at * 1000) : now;
        localOp.title = `Returning from ${srvOp.target_name}`;
      }
    }
  });

  activeOperations = activeOperations.filter((op, index, self) =>
    index === self.findIndex((t) => t.id === op.id)
  );

  // Jika ada pasukan yang diusir, paksa kartu antrean berubah warna saat itu juga!
  if (forceRedraw) {
    renderOperationQueueList();
    updateOperationQueueWidget();
  }
}

async function loadState() {
  state = await api("/api/state");
  selectedAi = new Set(state?.player?.active_ai || []);

  const p = state.player;
  selectedAi = new Set(p.active_ai || []);

  // ---> TAMBAHKAN BARIS INI DI SINI <---
  syncOperationsFromState();
  // ------------------------------------

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

  // === OBAT LAYOUT TERGENCET ===
  // Kita bersihkan class bawaan yang merusak dan memaksanya menjadi blok penuh
  baseGrid.className = ""; 
  baseGrid.style.display = "block";
  baseGrid.style.width = "100%";

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
    const lockedClass = b.locked ? "locked-building" : (getBuildingLevel(b) <= 0 ? "needs-build-building" : "");

    let actionText = "OPEN";
    let btnClass = "cyber-btn"; 
    
    if (b.locked) {
        actionText = "LOCKED";
    } else if (getBuildingLevel(b) <= 0) {
        actionText = "BUILD";
        btnClass = "cyber-btn magenta-btn"; 
    } else if (id === "radar_tower") {
        actionText = "SCAN";
        btnClass = "cyber-btn magenta-btn"; 
    } else if (id === "unit_factory") {
        actionText = "TRAIN";
    } else {
        actionText = "UPGRADE";
    }

    // 1. KITA MUNCULKAN GEMBOK JIKA TERKUNCI
    const displayTitle = b.locked ? `🔒 ${b.name}` : b.name;

    return `
      <div class="cyber-card ${lockedClass}" onclick="openBuilding('${id}')">
        <img src="${b.asset}" alt="${b.name}" style="width: 78px; height: 78px; object-fit: contain; margin-bottom: 8px; filter: drop-shadow(0 0 10px var(--cyan-dim));">
        
        <div class="card-title" style="font-size: 10px;">${displayTitle}</div>
        <div class="card-level" style="font-size: 8px;">${levelText}</div>
        
        <button class="${btnClass}" onclick="event.stopPropagation(); openBuilding('${id}')">
          ${actionText}
        </button>
      </div>
    `;
  }).join("");

  // Memisahkan Kartu Misi dan Grid Bangunan agar tidak rebutan tempat
  baseGrid.innerHTML = `
    <div style="margin-bottom: 16px; width: 100%;">
       ${renderBeginnerMissionCard()}
    </div>
    <div class="building-grid">
       ${buildingCards}
    </div>
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
  // === CEGATAN GUILD GATE ===
  if (buildingId === "guild_gate") {
    openGuildGateSheet();
    return;
  }
  // ==========================

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

function getTrainBatchLimitForLevel(levelInfo) {
  const fromServer = Number(levelInfo?.train_batch_limit ?? 0);

  if (fromServer > 0) {
    return fromServer;
  }

  // Fallback kalau server belum mengirim train_batch_limit
  const factory = buildingsData?.buildings?.unit_factory || {};
  const factoryLevel = Number(factory.level ?? 0);
  const unitLevel = Number(levelInfo?.level ?? 1);

  if (factoryLevel <= 0) return 0;

  const baseByLevel = {
    1: 50,
    2: 40,
    3: 30,
    4: 20,
    5: 10,
  };

  const base = baseByLevel[unitLevel] || 10;
  const multiplier = 1 + (Math.max(0, factoryLevel - 1) * 0.05);

  return Math.max(1, Math.ceil(base * multiplier));
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

    const key = trainAmountKey(unit.id, lv.level);

    const batchLimit = getTrainBatchLimitForLevel(lv);
    const affordableMax = getTrainAffordableMax(trainCost);

    const canTrain = lv.unlocked && batchLimit > 0 && affordableMax > 0;

    const maxTrain = canTrain
      ? Math.max(1, Math.min(batchLimit, affordableMax))
      : 1;

    const currentAmount = canTrain
      ? Math.min(maxTrain, Math.max(1, num(trainAmountDraft[key] || 1)))
      : 1;

    const trainLockedReason = !lv.unlocked
      ? "Locked by Research"
      : batchLimit <= 0
        ? "Build Unit Factory first"
        : affordableMax <= 0
          ? "Not enough resources"
          : "";

    const trainPanel = canTrain
      ? `
        <div class="train-slider-panel">
          <div class="train-slider-top">
            <div>
              <small>Train Amount</small>
              <b>x<span id="trainAmount_${key}">${currentAmount}</span></b>
            </div>

            <div>
              <small>Total Cost</small>
              <b id="trainTotalCost_${key}">${getTotalTrainCostText(currentAmount, trainCost)}</b>
            </div>
          </div>

          <input
            id="trainRange_${key}"
            class="train-range"
            type="range"
            min="1"
            max="${maxTrain}"
            value="${currentAmount}"
            oninput="setTrainSliderAmount('${unit.id}', ${lv.level}, this.value)"
          />

          <div class="train-slider-bottom">
            <span>1</span>
            <span>Batch Max ${maxTrain}</span>
          </div>

          <button class="train-main-btn" onclick="trainFromSlider('${unit.id}', ${lv.level})">
            Train x<span id="trainButtonAmount_${key}">${currentAmount}</span>
          </button>
        </div>
      `
      : `
        <div class="train-slider-panel locked-panel">
          <button disabled>${trainLockedReason}</button>
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

            <p class="premium-cost-note">
              Base Cost: ${getTrainCostText(trainCost)} / unit
            </p>
            <p class="premium-cost-note">
              Batch Limit: ${batchLimit} / training
              ${lv.factory_train_multiplier ? `(Factory x${lv.factory_train_multiplier})` : ""}
            </p>
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
      "Settings & Strategy",
      `
        <div class="settings-card">
          <h3 class="text-good" style="margin-top: 0;">Strategy & Build</h3>
          <div class="settings-options" style="flex-direction: column; gap: 8px; margin-bottom: 16px;">
            <button style="width: 100%; text-align: left;" onclick="closeBuildingSheet(); openBuildTypesSheet()">📖 Build Types (Academy)</button>
            <button style="width: 100%; text-align: left;" onclick="closeBuildingSheet(); openCounterGuideSheet()">⚔️ Counter Guide</button>
            <button style="width: 100%; text-align: left;" onclick="closeBuildingSheet(); openModuleLibrarySheet()">📦 Module Library</button>
            <button style="width: 100%; text-align: left;" onclick="closeBuildingSheet(); openDefenseSetupSheet('build')">🛡️ Defense Setup</button>
          </div>
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

  const fixedPos = getRadarSlotPosition(pos.left, pos.top, markerKind);

  const markerTypeClass = target.kind === "mining"
    ? "mining-marker"
    : "enemy-hostile-marker";

  const levelText = `Lv.${target.level || target.guardian_level || 1}`;

  const marker = document.createElement("button");
  
  // Menggabungkan semua class bawaan
  let markerClasses = `enemy-marker enemy-image-marker ${markerTypeClass} ${signalClass}`;
  
  // Menambahkan efek border merah JIKA tambang sedang dijajah
  if (target.kind === "mining" && target.status === "Occupied") {
    markerClasses += " occupied-node";
  }
  
  marker.className = markerClasses;
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

  // === LOGIKA PINTAR: Cek apakah target ini adalah Pemain Nyata ===
  const isPlayerTarget = String(target.id).startsWith("tg_") || target.kind === "player";
  const rallyButtonHtml = isPlayerTarget 
    ? `<button class="guild-btn-danger" onclick="openRallySetup('${target.id}')">Rally</button>` 
    : ``;
  // ================================================================

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
        ${rallyButtonHtml}
        <button onclick="openAttackSetupFromRadar('${target.id}')">Attack</button>
        <button onclick="closeBuildingSheet(); scoutPopup('${target.id}')">Scout</button>
      </div>
    `
  );
}

function openMiningNodeSheet(node) {
  const asset = getEnemyAsset(node);

  let ownershipHtml = `<p style="color:var(--good); font-weight:bold; margin-bottom: 10px;">Status: Unoccupied</p>`;
  let actionHtml = "";

  if (node.status === "Occupied") {
    // 1. Cari data operasi pasukan kita yang sedang kemah di sini (ini penentu mutlak)
    const activeOp = activeOperations.find(op => String(op.targetId) === String(node.id) && op.phase === "occupying");
    
    // 2. Cek apakah ini tambang milik kita berdasarkan keberadaan pasukan
    const isMine = !!activeOp;
    
    // 3. Format nama pemilik agar lebih rapi
    let ownerName = node.owner;
    if (isMine) {
      ownerName = "YOU";
    } else if (String(node.owner) === String(state?.player?.id)) {
      // Radar bilang ini punya kita, tapi pasukan kita sudah hilang/pulang
      ownerName = "Unknown (Signal Lost)";
    } else if (String(ownerName).startsWith("tg_")) {
      // Samarkan ID telegram yang panjang
      ownerName = "Commander " + String(ownerName).slice(3, 7); 
    }

    ownershipHtml = `<p style="color:var(--danger); font-weight:bold; margin-bottom: 10px;">Status: Occupied by ${ownerName}</p>`;

    if (isMine) {
      const opId = activeOp ? activeOp.id : "";

      // Ubah tombol menjadi Recall
      actionHtml = `
        <button onclick="recallOperation('${opId}')" style="background:var(--warn); color:#000; font-weight:bold;">Recall Troops</button>
        <button onclick="closeBuildingSheet()">Close</button>
      `;
    } else {
      // Jika milik orang lain, munculkan tombol Attack PvP
      actionHtml = `
        <button onclick="openAttackSetupFromRadar('${node.id}')">Attack (PvP)</button>
        <button onclick="closeBuildingSheet(); scoutPopup('${node.id}')">Scout</button>
        <button onclick="closeBuildingSheet()">Close</button>
      `;
    }
  } else {
    // Jika masih kosong / dijaga Guardian
    actionHtml = `
      <button onclick="openAttackSetupFromRadar('${node.id}')">Attack Guardian</button>
      <button onclick="closeBuildingSheet(); scoutPopup('${node.id}')">Scout</button>
      <button onclick="closeBuildingSheet()">Close</button>
    `;
  }

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

      ${ownershipHtml}

      ${row("Resource", node.resource_name)}
      ${row("Production", `${node.production_per_minute} / minute`)}
      ${row("Capacity", node.capacity)}
      ${row("Guardian Level", `Lv.${node.guardian_level}`)}
      ${row("Guardian Power", node.guardian_power)}
      ${row("Distance", `${node.distance} Trace Unit`)}
      ${row("Coordinate", `X:${node.x} / Y:${node.y}`)}

      <p class="muted" style="margin-top:12px;">
        Jika guardian berhasil dikalahkan, pasukan tidak langsung pulang.
        Pasukan akan menetap di node ini dan mengumpulkan resource sampai di-recall
        atau dikalahkan player lain.
      </p>

      <div class="sheet-actions">
        ${actionHtml}
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

  isRallyMode = false; // PASTIKAN MODE RALLY MATI UNTUK SERANGAN BIASA
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
  
  // === LOGIKA TOMBOL DINAMIS (ATTACK vs RALLY) ===
  const actionButtonHtml = isRallyMode
    ? `<button class="guild-btn-danger" onclick="launchRallyApi()">Luncurkan Rally</button>`
    : `<button onclick="launchAttack()">Launch Attack</button>`;

  showBuildingSheet(
    isRallyMode ? "Rally Setup" : "Attack Setup",
    `
      <div class="attack-target-box">
        <h3>${target.name}</h3>
        ${isRallyMode ? `<div style="color:var(--warn); font-weight:bold; margin-bottom:8px;">Waktu Kumpul: ${selectedRallyTime / 60} Menit</div>` : ''}
        ${row("Distance", `${target.distance} Trace Unit`)}
        ${row("Signal", target.signal_strength)}
        ${row("Lab Tier", target.lab_tier)}
        ${row("Firewall", target.firewall || "Basic Firewall")}
      </div>

      <div class="attack-section">
        <h3>1. Vanguard Units</h3>
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
        ${actionButtonHtml}
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
  // 1. CEGAH DOUBLE CLICK
  if (isLaunchingAttack) return; 
  isLaunchingAttack = true;
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
    // 2. Jika sukses, tutup menu setup
    closeBuildingSheet(); // atau fungsi penutup menu Anda
    loadState();

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
  } finally {
    // 3. BUKA KEMBALI KUNCINYA APAPUN YANG TERJADI
    isLaunchingAttack = false;
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
  // === TAMBAHAN MISI ===
  if (id === "missionPage") {
    renderMissionPage();
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

// === FUNGSI SINKRONISASI SENYAP (FINAL & BERSIH) ===
async function silentSync() {
  try {
    const data = await api("/api/state");
    if (!data) return;
    state = data;
    syncOperationsFromState();

    // === KUNCI PERBAIKAN: Hapus syarat state.player.guild_id ===
    // Langsung tarik data Guild. Jika player tidak punya Guild,
    // biarkan API gagal dan jatuh ke catch tanpa merusak game.
    try {
      const guildData = await api("/api/guilds/my?_t=" + Date.now());
      
      if (guildData && guildData.success) {
        myGuildDataCache = guildData; 
        const serverTime = guildData.server_time || (Date.now() / 1000);
        
        const ralliesObj = guildData.guild.rallies || {};
        const rallies = Object.values(ralliesObj);
        
        console.log(`[DEBUG-SYNC] Ditemukan ${rallies.length} Rally di Server.`);

        rallies.forEach(r => {
          console.log(`[DEBUG-SYNC] Rally: ${r.id} | Status: ${r.status} | Sisa Waktu: ${r.gathering_ends_at - serverTime}s | Creator: ${r.creator_id} | Me: ${state.player.id}`);
          
          // KUNCI AMAN: Bungkus ID dengan String() agar tidak ada error tipe data Number vs String!
          if (r.status === "gathering" && r.gathering_ends_at > serverTime && String(r.creator_id) !== String(state.player.id)) {
            console.log(`[DEBUG-SYNC] 🚨 SYARAT TEMBUS! Menampilkan Notifikasi!`);
            showRallyToast(r.id, r.creator_name, r.target_name);
          }
        });
      }
    } catch (guildErr) {
      // Diamkan saja (Berarti player ini memang belum gabung Guild manapun)
    }
    // =============================================================

  } catch (err) {}
}

// ==========================================================
// MODULE: GUILD UI SYSTEM
// ==========================================================
let selectedGuildLogoId = "logo_dragon"; // Default pilihan awal

function renderGuildList(guilds) {
  const listHtml = guilds.length
    ? guilds.map(g => `
      <div class="card" style="margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
          <img src="${g.logo_asset}" style="width: 54px; height: 54px; object-fit: contain; border-radius: 6px; background: #0b132b; border: 1px solid var(--border);" onerror="this.src='assets/base.webp'"/>
          <div style="flex: 1;">
            <h3 style="margin: 0; font-size: 16px;">${escapeHtml(g.name)} <small>Lv.${g.level}</small></h3>
            <div style="color: var(--good); font-size: 13px; font-weight: bold;">Power: ${compactNumber(g.power)}</div>
          </div>
        </div>
        <p class="muted" style="margin-top: 0;">${escapeHtml(g.description || "No description")}</p>
        <div class="row"><span>Members</span><span>${g.members_count}/${g.max_members}</span></div>
        <div class="sheet-actions" style="margin-top:8px;">
          <button style="background: var(--good); color: #000; font-weight: bold;" onclick="joinGuild('${g.id}')">Join Guild</button>
        </div>
      </div>
    `).join("")
    : `<p class="muted">Belum ada Guild di server ini. Jadilah yang pertama!</p>`;

  showBuildingSheet(
    "Guild Gate",
    `
      <div class="sheet-actions" style="margin-bottom: 16px;">
        <button style="background: var(--good); color: #000; font-weight: bold;" onclick="openCreateGuildForm()">+ Create New Guild</button>
      </div>
      <h3>Available Guilds</h3>
      <div class="guild-list" style="max-height: 50vh; overflow-y: auto; padding-right: 4px;">
        ${listHtml}
      </div>
      <div class="sheet-actions">
        <button onclick="closeBuildingSheet()">Close</button>
      </div>
    `
  );
}

async function joinGuild(guildId) {
  try {
    const data = await api("/api/guilds/join", {
      method: "POST",
      body: JSON.stringify({ guild_id: guildId })
    });
    
    alert(data.message);
    await loadState(); // Sinkronisasi ulang data player dari server
    openGuildGateSheet(); // Buka ulang UI agar langsung memuat layar "My Guild"
  } catch (err) {
    alert("Gagal bergabung: " + err.message);
  }
}

// Fungsi helper untuk JS memproses klik logo
window.selectGuildLogo = function(id) {
  selectedGuildLogoId = id;
  document.querySelectorAll('.guild-logo-option').forEach(el => {
    el.style.borderColor = el.dataset.id === id ? 'var(--good)' : 'transparent';
  });
};

function openCreateGuildForm() {
  // Daftar logo (Bisa Anda tambah/ubah namanya nanti)
  const logos = [
    { id: "logo_dragon", asset: "assets/guild_dragon.webp" },
    { id: "logo_skull", asset: "assets/guild_skull.webp" },
    { id: "logo_cyber", asset: "assets/guild_cyber.webp" },
    { id: "logo_wolf", asset: "assets/guild_wolf.webp" },
    { id: "logo_eagle", asset: "assets/guild_eagle.webp" },
    { id: "logo_shield", asset: "assets/guild_shield.webp" }
  ];

  selectedGuildLogoId = logos[0].id; // Reset ke yang pertama tiap buka form

  const logosHtml = logos.map(l => `
    <img src="${l.asset}" 
         data-id="${l.id}" 
         class="guild-logo-option" 
         onerror="this.src='assets/base.webp'"
         style="width: 50px; height: 50px; object-fit: contain; cursor: pointer; border-radius: 6px; background: #0b132b; border: 2px solid ${l.id === selectedGuildLogoId ? 'var(--good)' : 'transparent'}; transition: border 0.2s;" 
         onclick="selectGuildLogo('${l.id}')" />
  `).join("");

  showBuildingSheet(
    "Create Guild",
    `
      <p class="muted">Biaya pembuatan: <b>10,000 Credits</b>.</p>
      
      <label>Pilih Logo Guild:</label>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; margin-top: 8px;">
        ${logosHtml}
      </div>

      <label>Guild Name (3-20 char)</label>
      <input type="text" id="newGuildName" placeholder="e.g. Cyber Ninjas" maxlength="20" style="width:100%; padding:8px; margin-bottom:12px; background:var(--bg2); color:#fff; border:1px solid var(--border); border-radius:4px;" />
      
      <label>Description (Optional)</label>
      <textarea id="newGuildDesc" placeholder="Guild description..." maxlength="150" style="width:100%; padding:8px; margin-bottom:12px; background:var(--bg2); color:#fff; border:1px solid var(--border); border-radius:4px; min-height:60px;"></textarea>
      
      <div class="sheet-actions">
        <button onclick="submitCreateGuild()" style="background: var(--good); color: #000; font-weight: bold;">Create (10K Credits)</button>
        <button onclick="openGuildGateSheet()">Back</button>
      </div>
    `
  );
}

async function submitCreateGuild() {
  const nameInput = document.getElementById("newGuildName");
  const descInput = document.getElementById("newGuildDesc");
  
  if (!nameInput || !descInput) return;
  
  const name = nameInput.value.trim();
  const desc = descInput.value.trim();
  
  if (name.length < 3) {
    alert("Nama Guild minimal 3 karakter!");
    return;
  }
  
  try {
    const data = await api("/api/guilds/create", {
      method: "POST",
      body: JSON.stringify({ 
        name: name, 
        description: desc,
        logo_id: selectedGuildLogoId 
      })
    });
    
    alert(data.message);
    await loadState(); 
    openGuildGateSheet(); 
  } catch (err) {
    alert("Gagal membuat Guild: " + err.message);
  }
}

async function openGuildGateSheet() {
  try {
    const data = await api("/api/guilds");
    
    if (data.player_guild_id) {
      // Jika player sudah punya guild, panggil fungsi renderMyGuild
      // Fungsi ini akan secara otomatis menarik data anggota dari server
      renderMyGuild();
    } else {
      // Jika belum punya, tampilkan daftar guild & opsi Create
      renderGuildList(data.guilds);
    }
  } catch (err) {
    alert("Gagal memuat data guild: " + err.message);
  }
}

let myGuildDataCache = null;
let currentGuildTab = "info"; // Tab default saat dibuka

// ==========================================
// RENDER MY GUILD (100% PURE JS LOGIC)
// ==========================================
async function renderMyGuild(forceRefresh = false) {
  if (forceRefresh || !myGuildDataCache) {
    showBuildingSheet("My Guild", `<div class="p-30 text-center"><p class="muted">Mengenkripsi sinyal Guild...</p></div>`);
    try {
      // === PERBAIKAN CACHE BUSTER ===
      // Menambahkan ?_t=waktu_sekarang agar Browser & Vercel TIDAK berani memberikan data basi!
      myGuildDataCache = await api("/api/guilds/my?_t=" + new Date().getTime());
      // ==============================
    } catch (err) {
      alert("Gagal memuat detail Guild: " + err.message);
      closeBuildingSheet();
      return;
    }
  }

  const guild = myGuildDataCache.guild;
  const members = myGuildDataCache.members;
  const myRole = myGuildDataCache.my_role;

  let bodyHtml = "";

  if (currentGuildTab === "info") {
    bodyHtml = `
      <div class="card guild-info-card">
        <img src="${guild.logo_asset}" class="guild-info-logo" onerror="this.src='assets/base.webp'"/>
        <h2 class="guild-info-title">${escapeHtml(guild.name)}</h2>
        <span class="guild-info-power">Lv. ${guild.level} | ${compactNumber(guild.power)} Total Power</span>
        
        <p class="muted guild-info-desc">${escapeHtml(guild.description || "No description")}</p>
        
        <hr class="guild-divider">
        ${row("Total Members", `${members.length}/${guild.max_members}`)}
        ${row("My Role", `<span class="${myRole === 'leader' ? 'guild-badge-leader' : (myRole === 'admin' ? 'guild-badge-admin' : '')}">${myRole.toUpperCase()}</span>`)}
      </div>

      <div class="sheet-actions mt-16">
        ${(myRole === 'leader' || myRole === 'admin') ? `<button class="guild-btn-warn" onclick="openGuildSettingsForm()">Edit Guild Info</button>` : ''}
        ${myRole === 'leader' ? `<button class="guild-btn-danger" onclick="alert('Fungsi Disband sedang disiapkan!')">Disband Guild</button>` : `<button class="guild-btn-danger" onclick="alert('Fungsi Leave sedang disiapkan!')">Leave Guild</button>`}
      </div>
    `;
  } 
  else if (currentGuildTab === "member") {
    // 1. RENDER ANTREAN PELAMAR (Hanya untuk Admin & Leader)
    let pendingHtml = "";
    const joinRequests = myGuildDataCache.join_requests || [];

    if ((myRole === 'leader' || myRole === 'admin') && joinRequests.length > 0) {
      let reqItems = joinRequests.map(req => `
        <div class="guild-pending-item">
          <div class="guild-pending-info">
            <span class="guild-member-name">${escapeHtml(req.name)}</span>
            <span class="guild-member-power">${compactNumber(req.power)} Pwr | Lab Lv.${req.lab_level}</span>
          </div>
          <div class="guild-pending-actions">
            <button class="guild-btn-sm guild-btn-success" onclick="handleJoinRequest('${req.player_id}', 'approve')">Terima</button>
            <button class="guild-btn-sm guild-btn-danger" onclick="handleJoinRequest('${req.player_id}', 'reject')">Tolak</button>
          </div>
        </div>
      `).join("");

      pendingHtml = `
        <div class="guild-pending-box">
          <div class="guild-pending-header">Menunggu Persetujuan (${joinRequests.length})</div>
          ${reqItems}
        </div>
      `;
    }

    // 2. RENDER ANGGOTA RESMI
    let membersHtml = "";
    members.forEach(m => {
      let roleBadge = "";
      let cardClass = "member";
      
      if (m.role === "leader") {
          roleBadge = `<span class="guild-badge-leader">LEADER</span>`;
          cardClass = "leader";
      } else if (m.role === "admin") {
          roleBadge = `<span class="guild-badge-admin">ADMIN</span>`;
          cardClass = "admin";
      }

      let actionButtons = "";
      if (myRole === "leader" && m.player_id !== state?.player?.id) {
        actionButtons = `
          <div class="guild-action-row">
            <button class="guild-btn-sm guild-btn-danger" onclick="kickMember('${m.player_id}')">Kick</button>
            ${m.role === 'member' ? `<button class="guild-btn-sm guild-btn-warn" onclick="promoteMember('${m.player_id}')">Promote</button>` : ''}
            ${m.role === 'admin' ? `<button class="guild-btn-sm guild-btn-success" onclick="demoteMember('${m.player_id}')">Demote</button>` : ''}
            <button class="guild-btn-sm guild-btn-epic" onclick="transferLeader('${m.player_id}')">Transfer Leader</button>
          </div>
        `;
      }

      membersHtml += `
        <div class="card guild-member-card ${cardClass}">
          <div class="guild-member-row">
             <div class="guild-member-name">${escapeHtml(m.name)} ${roleBadge}</div>
             <div class="guild-member-power">${compactNumber(m.power)} Pwr</div>
          </div>
          <div class="guild-member-detail">Main Lab Lv.${m.lab_level}</div>
          ${actionButtons}
        </div>
      `;
    });

    bodyHtml = `
      <div style="max-height: 45vh; overflow-y: auto; padding-right: 4px; margin-bottom: 12px;">
        ${pendingHtml}
        ${membersHtml}
      </div>
      <div class="sheet-actions">
        <button onclick="renderMyGuild(true)">Refresh Data</button>
      </div>
    `;
  }
  // ... (Tab Rally, Reward, Research biarkan seperti sebelumnya) ...
  else if (currentGuildTab === "rally") {
    const ralliesObj = guild.rallies || {};
    const rallies = Object.values(ralliesObj);
    
    // GUNAKAN JAM SERVER!
    const serverTime = myGuildDataCache.server_time || (Date.now() / 1000);

    let rallyHtml = "";
    if (rallies.length === 0) {
      rallyHtml = `<div class="p-30 text-center"><p class="muted">Belum ada Rally yang aktif di Guild ini.</p></div>`;
    } else {
      rallyHtml = rallies.map(r => {
        // Hitung sisa waktu menggunakan jam server
        const remain = Math.max(0, Math.ceil(r.gathering_ends_at - serverTime));
        const isGathering = r.status === "gathering" && remain > 0;
        
        // PASTI AMAN: Hanya yang ID-nya sama persis yang dianggap Pembuat!
        const myRally = r.creator_id === state?.player?.id;

        let btn = "";
        if (myRally) {
           if (isGathering) {
               btn = `<button id="rallyBtn_${r.id}" class="guild-btn-danger text-bold" style="width:100%" onclick="cancelRallyApi('${r.id}')">Batalkan Rally</button>`;
           } else {
               btn = `<button id="rallyBtn_${r.id}" class="guild-btn-danger" disabled style="width:100%">Pasukan Berangkat</button>`;
           }
        } else if (isGathering) {
           btn = `<button id="rallyBtn_${r.id}" class="guild-btn-success text-bold" style="width:100%" onclick="openJoinRallySetup('${r.id}')">Join Rally</button>`;
        } else {
           btn = `<button id="rallyBtn_${r.id}" class="guild-btn-danger" disabled style="width:100%">Pasukan Berangkat</button>`;
        }

        return `
          <div class="card guild-info-card" style="text-align:left; border-left: 3px solid var(--bad);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <b style="color:var(--bad);">⚔️ Target: ${escapeHtml(r.target_name)}</b>
              <span id="rallyTimer_${r.id}" class="text-warn font-bold">${formatSeconds(remain)}</span>
            </div>
            <p class="muted" style="margin-top:0; font-size:12px;">Commander: ${escapeHtml(r.creator_name)}</p>
            
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
              <span>Pasukan Terkumpul:</span>
              <b>${compactNumber(r.total_units)} / ${compactNumber(r.max_capacity)}</b>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:12px;">
              <span>Total Power:</span>
              <b style="color:var(--good);">${compactNumber(r.total_power)}</b>
            </div>
            
            ${btn}
          </div>
        `;
      }).join("");
    }

    bodyHtml = `
      <div style="max-height: 45vh; overflow-y: auto; padding-right: 4px; margin-bottom: 12px;">
        ${rallyHtml}
      </div>
      <div class="sheet-actions">
        <button onclick="renderMyGuild(true)">Refresh Data</button>
      </div>
    `;

    setTimeout(startGuildRallyTimer, 100);
  }
  else if (currentGuildTab === "reward") { bodyHtml = `<div class="card guild-info-card"><h3 class="text-good">Guild Rewards</h3><p class="muted">Dalam konstruksi.</p></div>`; }
  else if (currentGuildTab === "research") { bodyHtml = `<div class="card guild-info-card"><h3 class="text-info">Guild Tech</h3><p class="muted">Dalam konstruksi.</p></div>`; }

  const closeHtml = `<div class="sheet-actions mt-16"><button onclick="closeBuildingSheet()">Close Window</button></div>`;

  const tabsHtml = `
    <div class="facility-tabs bottom-navigation-guild">
      <button class="${currentGuildTab === 'info' ? 'active' : ''}" onclick="switchGuildTab('info')">Info</button>
      <button class="${currentGuildTab === 'member' ? 'active' : ''}" onclick="switchGuildTab('member')">Member</button>
      <button class="${currentGuildTab === 'rally' ? 'active' : ''}" onclick="switchGuildTab('rally')">Rally</button>
      <button class="${currentGuildTab === 'reward' ? 'active' : ''}" onclick="switchGuildTab('reward')">Hadiah</button>
      <button class="${currentGuildTab === 'research' ? 'active' : ''}" onclick="switchGuildTab('research')">Riset</button>
    </div>
  `;

  showBuildingSheet("My Guild", bodyHtml + closeHtml + tabsHtml);
}

// ==========================================
// FORM PENGATURAN GUILD (100% PURE JS LOGIC)
// ==========================================
window.openGuildSettingsForm = function() {
  if (!myGuildDataCache) return;
  const guild = myGuildDataCache.guild;
  
  const logos = [
    { id: "logo_dragon", asset: "assets/guild_dragon.webp" },
    { id: "logo_skull", asset: "assets/guild_skull.webp" },
    { id: "logo_cyber", asset: "assets/guild_cyber.webp" },
    { id: "logo_wolf", asset: "assets/guild_wolf.webp" },
    { id: "logo_eagle", asset: "assets/guild_eagle.webp" },
    { id: "logo_shield", asset: "assets/guild_shield.webp" }
  ];

  selectedGuildLogoId = guild.logo_id || logos[0].id;
  const currentJoinMode = guild.join_mode || "auto";

  const logosHtml = logos.map(l => `
    <img src="${l.asset}" 
         data-id="${l.id}" 
         class="guild-logo-preview ${l.id === selectedGuildLogoId ? 'selected' : ''}" 
         onerror="this.src='assets/base.webp'"
         onclick="selectGuildLogo('${l.id}')" />
  `).join("");

  showBuildingSheet(
    "Guild Settings",
    `
      <label class="guild-form-label">Ubah Logo Guild:</label>
      <div class="guild-logo-container">
        ${logosHtml}
      </div>
      
      <label class="guild-form-label">Mode Rekrutmen:</label>
      <select id="editJoinMode" class="guild-form-control">
        <option value="auto" ${currentJoinMode === 'auto' ? 'selected' : ''}>Terbuka (Siapapun Bebas Masuk)</option>
        <option value="approval" ${currentJoinMode === 'approval' ? 'selected' : ''}>Tertutup (Butuh Persetujuan Admin)</option>
      </select>

      <label class="guild-form-label">Deskripsi Guild:</label>
      <textarea id="editGuildDesc" maxlength="150" class="guild-form-control guild-form-textarea">${escapeHtml(guild.description || "")}</textarea>
      
      <div class="sheet-actions">
        <button onclick="submitGuildSettings()" class="guild-btn-success text-bold">Simpan Pengaturan</button>
        <button onclick="renderMyGuild(false)">Batal</button>
      </div>
    `
  );
};

// Fungsi Trigger untuk berpindah Tab secara instan
window.switchGuildTab = function(tab) {
  currentGuildTab = tab;
  renderMyGuild(false); // Render ulang UI tanpa perlu tarik data baru dari server
};

// Fungsi Helper Utama untuk API Manajemen Anggota
window.manageGuildMember = async function(targetId, action, confirmMsg) {
  if (!confirm(confirmMsg)) return;

  try {
    const data = await api("/api/guilds/manage_member", {
      method: "POST",
      body: JSON.stringify({ target_id: targetId, action: action })
    });
    alert(data.message);
    renderMyGuild(true); // Langsung refresh UI Guild tanpa loading lama
  } catch (err) {
    alert("Gagal mengeksekusi perintah: " + err.message);
  }
};

// Tombol-tombol pemicunya:
window.kickMember = function(targetId) {
  manageGuildMember(targetId, "kick", "⚠️ Yakin ingin menendang anggota ini dari Guild?");
};
window.promoteMember = function(targetId) {
  manageGuildMember(targetId, "promote", "Naikkan pangkat anggota ini menjadi Admin?");
};
window.demoteMember = function(targetId) {
  manageGuildMember(targetId, "demote", "Turunkan pangkat Admin ini menjadi member biasa?");
};
window.transferLeader = function(targetId) {
  manageGuildMember(targetId, "transfer", "🔥 PERINGATAN FATAL! Yakin ingin menyerahkan kepemimpinan Guild ke orang ini? Kamu akan otomatis turun menjadi Admin.");
};

async function initApp() {
  try {
    // 1. Hubungkan ke Telegram
    await initTelegramMiniApp();

    // 2. Load data game dari server (CUKUP 1 KALI SAJA DI AWAL)
    await loadState();
    maybeShowOnboarding();

    // 3. Pasang semua Event Listener tombol
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

    // 4. Lakukan Scan otomatis di awal
    scan().catch(err => {
      console.warn("Scan awal gagal/skip:", err);
    });

    // === SISTEM PENGHEMAT SERVER VERCEL (AFK DETECTOR) ===
    let idleSeconds = 0;

    // Reset timer jika pemain menyentuh layar atau main game
    document.addEventListener("click", () => idleSeconds = 0);
    document.addEventListener("touchstart", () => idleSeconds = 0);
    document.addEventListener("scroll", () => idleSeconds = 0);

    // Mesin Sinkronisasi (Berdetak tiap 5 detik)
    setInterval(() => {
      idleSeconds += 5;
      
      // Jika pemain AFK (tidak sentuh layar) lebih dari 3 menit (180 detik)
      // Mesin berhenti menembak server Vercel untuk menghemat kuota!
      if (idleSeconds > 180) {
          return; 
      }
      
      // Jika aktif, lakukan sinkronisasi normal
      silentSync();
    }, 5000);
    // =====================================================

  } catch (err) {
    // Tangkap error jika server sedang bermasalah
    console.error("LOAD STATE ERROR:", err);
    setText("playerStatus", "Error loading data");
    const info = el("buildingInfo");
    if (info) {
      info.innerText = err.message;
    }
  }
}

window.openGuildSettingsForm = function() {
  if (!myGuildDataCache) return;
  const guild = myGuildDataCache.guild;
  
  // Daftar logo yang sama dengan form pembuatan
  const logos = [
    { id: "logo_dragon", asset: "assets/guild_dragon.webp" },
    { id: "logo_skull", asset: "assets/guild_skull.webp" },
    { id: "logo_cyber", asset: "assets/guild_cyber.webp" },
    { id: "logo_wolf", asset: "assets/guild_wolf.webp" },
    { id: "logo_eagle", asset: "assets/guild_eagle.webp" },
    { id: "logo_shield", asset: "assets/guild_shield.webp" }
  ];

  selectedGuildLogoId = guild.logo_id || logos[0].id;
  const currentJoinMode = guild.join_mode || "auto";

  const logosHtml = logos.map(l => `
    <img src="${l.asset}" 
         data-id="${l.id}" 
         class="guild-logo-option" 
         onerror="this.src='assets/base.webp'"
         style="width: 45px; height: 45px; object-fit: contain; cursor: pointer; border-radius: 6px; background: #0b132b; border: 2px solid ${l.id === selectedGuildLogoId ? 'var(--good)' : 'transparent'}; transition: border 0.2s;" 
         onclick="selectGuildLogo('${l.id}')" />
  `).join("");

  showBuildingSheet(
    "Guild Settings",
    `
      <label>Ubah Logo Guild:</label>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; margin-top: 8px;">
        ${logosHtml}
      </div>
      
      <label>Mode Rekrutmen:</label>
      <select id="editJoinMode" style="width:100%; padding:8px; margin-bottom:12px; background:var(--bg2); color:#fff; border:1px solid var(--border); border-radius:4px;">
        <option value="auto" ${currentJoinMode === 'auto' ? 'selected' : ''}>Terbuka (Siapapun Bebas Masuk)</option>
        <option value="approval" ${currentJoinMode === 'approval' ? 'selected' : ''}>Tertutup (Butuh Persetujuan Admin)</option>
      </select>

      <label>Deskripsi Guild:</label>
      <textarea id="editGuildDesc" maxlength="150" style="width:100%; padding:8px; margin-bottom:12px; background:var(--bg2); color:#fff; border:1px solid var(--border); border-radius:4px; min-height:80px;">${escapeHtml(guild.description || "")}</textarea>
      
      <div class="sheet-actions">
        <button onclick="submitGuildSettings()" style="background: var(--good); color: #000; font-weight: bold;">Simpan Pengaturan</button>
        <button onclick="renderMyGuild(false)">Batal</button>
      </div>
    `
  );
};

window.submitGuildSettings = async function() {
  const descInput = document.getElementById("editGuildDesc");
  const modeInput = document.getElementById("editJoinMode");
  
  if (!descInput || !modeInput) return;
  
  try {
    const data = await api("/api/guilds/settings", {
      method: "POST",
      body: JSON.stringify({ 
        description: descInput.value.trim(),
        logo_id: selectedGuildLogoId,
        join_mode: modeInput.value
      })
    });
    
    alert(data.message);
    renderMyGuild(true); // Tarik data baru dari server dan buka kembali layar info
  } catch (err) {
    alert("Gagal menyimpan pengaturan: " + err.message);
  }
};

window.handleJoinRequest = async function(targetId, action) {
  try {
    const data = await api("/api/guilds/handle_request", {
      method: "POST",
      body: JSON.stringify({ target_id: targetId, action: action })
    });
    alert(data.message);
    renderMyGuild(true); // Auto-refresh UI setelah klik terima/tolak
  } catch (err) {
    alert("Gagal memproses lamaran: " + err.message);
  }
};

// ==========================================
// SISTEM RALLY (FRONTEND SETUP)
// ==========================================
window.openRallySetup = async function(targetId) {
  // Pengecekan akurat langsung ke server (mengatasi bug state cache)
  try {
    const guildData = await api("/api/guilds");
    if (!guildData.player_guild_id) {
      alert("Kamu harus bergabung dengan Guild terlebih dahulu untuk membuat Rally!");
      return;
    }
  } catch (err) {
    alert("Gagal memverifikasi status Guild: " + err.message);
    return;
  }

  showBuildingSheet(
    "Persiapan Rally",
    `
      <div class="text-center p-10">
        <h3 class="rally-setup-title">Deklarasi Serangan Gabungan</h3>
        <p class="muted rally-setup-desc">
          Pilih waktu persiapan. Selama waktu ini, anggota Guild lain bisa mengirimkan pasukan mereka untuk bergabung dengan pasukanmu.
        </p>

        <label class="rally-time-label">Waktu Persiapan:</label>
        <div class="rally-time-grid">
          <label class="rally-time-option">
            <input type="radio" name="rallyTime" value="300" checked> 5 Menit
          </label>
          <label class="rally-time-option">
            <input type="radio" name="rallyTime" value="600"> 10 Menit
          </label>
          <label class="rally-time-option">
            <input type="radio" name="rallyTime" value="1800"> 30 Menit
          </label>
        </div>

        <div class="sheet-actions">
          <button class="guild-btn-danger" onclick="proceedToRallySetup('${targetId}')">Pilih Pasukan Perintis</button>
          <button onclick="closeBuildingSheet()">Batal</button>
        </div>
      </div>
    `
  );
};

window.proceedToRallySetup = function(targetId) {
  const timeInput = document.querySelector('input[name="rallyTime"]:checked');
  if (!timeInput) return;

  selectedRallyTime = parseInt(timeInput.value, 10);
  isRallyMode = true; // NYALAKAN MODE RALLY!

  const target = radarTargets.find(t => t.id === targetId);
  if (!target) return;

  selectedTarget = target.id;
  selectedUnits = {};
  selectedModules = new Set();
  selectedAi = new Set();

  showAttackSetupSheet(target); // Buka layar pasukan
};

window.launchRallyApi = async function() {
  if (isLaunchingAttack) return;
  isLaunchingAttack = true;

  try {
    if (!selectedTarget) {
      alert("Pilih target dulu.");
      return;
    }

    const payload = {
      target_id: selectedTarget,
      rally_seconds: selectedRallyTime,
      module_ids: [...selectedModules],
      ai_ids: [...selectedAi],
      units: buildUnitPayload()
    };

    const totalUnits = Object.values(selectedUnits).reduce((a, b) => a + Number(b || 0), 0);

    if (totalUnits <= 0) {
      alert("Pilih minimal 1 unit sebagai Pasukan Perintis.");
      return;
    }

    if (selectedModules.size <= 0) {
      alert("Pilih minimal 1 module.");
      return;
    }

    const res = await api("/api/guilds/rally/launch", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    closeBuildingSheet();
    await loadState();

    alert(res.message);

    // Otomatis buka jendela Guild dan arahkan ke Tab Rally!
    currentGuildTab = "rally";
    renderMyGuild(true);

  } catch (err) {
    alert("Gagal membuka Rally: " + err.message);
  } finally {
    isLaunchingAttack = false;
    isRallyMode = false; // Reset mode
  }
};

let notifiedRallies = new Set();

function showRallyToast(rallyId, creatorName, targetName) {
  if (notifiedRallies.has(rallyId)) return;
  notifiedRallies.add(rallyId);

  let toast = document.getElementById("rallyToastAlert");
  if (!toast) {
      toast = document.createElement("div");
      toast.id = "rallyToastAlert";
      toast.className = "rally-toast";
      
      // Jika diklik, langsung buka tab Rally di Guild!
      toast.onclick = () => {
          toast.classList.remove("show");
          currentGuildTab = "rally";
          renderMyGuild(true);
      };
      document.body.appendChild(toast);
  }

  toast.innerHTML = `
      <div class="rally-toast-icon">🚨</div>
      <div class="rally-toast-content">
          <h4>Rally Dibuka!</h4>
          <p>Commander ${escapeHtml(creatorName)} menyerang ${escapeHtml(targetName)}! Klik untuk bergabung.</p>
      </div>
  `;

  // Tampilkan animasinya
  setTimeout(() => toast.classList.add("show"), 100);

  // Sembunyikan otomatis setelah 6 detik
  setTimeout(() => {
      toast.classList.remove("show");
  }, 6000);
}

window.cancelRallyApi = async function(rallyId) {
  const isSure = confirm("⚠️ Yakin ingin membatalkan Rally ini? Semua pasukan anggota yang sudah bergabung akan langsung dipulangkan ke pangkalan.");
  if (!isSure) return;

  try {
    const res = await api("/api/guilds/rally/cancel", {
      method: "POST",
      body: JSON.stringify({ rally_id: rallyId })
    });

    alert(res.message);
    
    // Refresh UI Guild dan Tarik ulang data Base untuk mengupdate angka Pasukan
    renderMyGuild(true);
    loadState(); 
  } catch (err) {
    alert("Gagal membatalkan Rally: " + err.message);
  }
};

// ==========================================
// SISTEM JOIN RALLY (FRONTEND)
// ==========================================
window.currentJoinRallyId = null;

// Helper khusus agar tidak merusak Attack Setup biasa
window.changeJoinUnit = function(unitId, level, delta, rallyId) {
   const key = unitStackKey(unitId, level);
   if (!key) return;
   const current = Number(selectedUnits[key] || 0);
   selectedUnits[key] = clampAttackUnitAmount(unitId, level, current + Number(delta || 0));
   openJoinRallySetup(rallyId);
};

window.setJoinUnitMax = function(unitId, level, rallyId) {
   const key = unitStackKey(unitId, level);
   if (!key) return;
   selectedUnits[key] = getAttackOwnedAmount(unitId, level);
   openJoinRallySetup(rallyId);
};

window.openJoinRallySetup = function(rallyId) {
  if (!myGuildDataCache || !myGuildDataCache.guild) return;
  const rally = myGuildDataCache.guild.rallies[rallyId];
  if (!rally) return;

  // Reset pilihan pasukan jika ini adalah pertama kali klik Rally ini
  if (window.currentJoinRallyId !== rallyId) {
      selectedUnits = {};
      window.currentJoinRallyId = rallyId;
  }

  const maxDeploy = state.max_deploy_units || 100;
  let totalUnits = 0;
  Object.values(selectedUnits).forEach(v => totalUnits += Number(v||0));

  // Render daftar pasukan yang dimiliki Aldi (Tanpa Module/AI, karena Kapten yang pegang AI)
  const unitList = state.units.map(u => {
    const rows = (u.levels || []).filter(lv => lv.unlocked && lv.owned > 0).map(lv => {
      const key = unitStackKey(u.id, lv.level);
      const selected = selectedUnits[key] || 0;

      return `
        <div class="attack-unit-card">
          <div class="attack-unit-head">
            <div>
              <b>${u.name} Lv.${lv.level}</b>
              <small>Owned: ${lv.owned}</small>
            </div>
            <input class="unit-amount attack-unit-input" type="number" min="0" max="${lv.owned}" value="${selected}" readonly />
          </div>
          <div class="unit-pick-actions">
            <button onclick="changeJoinUnit('${u.id}', ${lv.level}, -1, '${rallyId}')">-1</button>
            <button onclick="changeJoinUnit('${u.id}', ${lv.level}, 1, '${rallyId}')">+1</button>
            <button onclick="changeJoinUnit('${u.id}', ${lv.level}, 10, '${rallyId}')">+10</button>
            <button onclick="setJoinUnitMax('${u.id}', ${lv.level}, '${rallyId}')">MAX</button>
          </div>
        </div>
      `;
    }).join("");
    return rows;
  }).join("");

  const sisaRuang = rally.max_capacity - rally.total_units;

  showBuildingSheet(
    "Kirim Pasukan Bantuan",
    `
      <div class="attack-target-box">
        <h3>Target: ${escapeHtml(rally.target_name)}</h3>
        <div style="color:var(--good); font-weight:bold; margin-bottom:4px;">Kapten: ${escapeHtml(rally.creator_name)}</div>
        <div class="muted">Sisa Kapasitas Gerbong: ${compactNumber(sisaRuang)} Unit</div>
      </div>

      <div class="attack-section">
        <h3>Pilih Pasukan</h3>
        <p class="muted">Deploy: ${totalUnits}/${maxDeploy} · Energy akan terpotong saat berangkat.</p>
        ${unitList || '<p class="muted">Kamu tidak memiliki pasukan yang siap tempur di markas.</p>'}
      </div>

      <div class="sheet-actions">
        <button class="guild-btn-success text-bold" onclick="submitJoinRally('${rallyId}')">Konfirmasi & Gabung</button>
        <button onclick="window.currentJoinRallyId = null; renderMyGuild(false)">Batal</button>
      </div>
    `
  );
};

window.submitJoinRally = async function(rallyId) {
  if (isLaunchingAttack) return;
  isLaunchingAttack = true;

  try {
    const payload = {
      rally_id: rallyId,
      units: buildUnitPayload() // Mengambil data pasukan dari selectedUnits
    };

    // Cek apakah pemain memilih 0 unit
    const hasUnits = Object.values(payload.units).some(levels => 
        Object.values(levels).some(qty => Number(qty) > 0)
    );

    if (!hasUnits) {
      alert("Pilih minimal 1 unit untuk bergabung!");
      isLaunchingAttack = false;
      return;
    }

    // Tembak API yang sudah kita buat di main.py tadi
    const res = await api("/api/guilds/rally/join", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    alert(res.message);
    window.currentJoinRallyId = null;
    
    // Refresh Layar Guild
    await loadState();
    renderMyGuild(true); 

  } catch (err) {
    alert("Gagal bergabung: " + err.message);
  } finally {
    isLaunchingAttack = false;
  }
};

// ==========================================
// MESIN ANIMASI WAKTU RALLY (SMART SENSOR)
// ==========================================
let guildRallyTimer = null;

function startGuildRallyTimer() {
  if (guildRallyTimer) clearInterval(guildRallyTimer);
  
  if (!myGuildDataCache || !myGuildDataCache.server_time) return;
  
  const timeOffset = myGuildDataCache.server_time - (Date.now() / 1000);
  
  guildRallyTimer = setInterval(() => {
    const sheet = document.getElementById("buildingSheet");
    if (!sheet || !sheet.classList.contains("show") || currentGuildTab !== "rally") {
      clearInterval(guildRallyTimer);
      guildRallyTimer = null;
      return;
    }

    // === PERBAIKAN 1: Aman dari Error jika Rally kosong ===
    const ralliesObj = (myGuildDataCache.guild && myGuildDataCache.guild.rallies) ? myGuildDataCache.guild.rallies : {};
    const rallies = Object.values(ralliesObj);
    
    const currentServerTime = (Date.now() / 1000) + timeOffset; 
    let needsRefresh = false;

    // === PERBAIKAN 2: Sensor Cerdas Anti-Nyangkut ===
    // Mesin akan menghitung jumlah kartu Rally yang ada di layar saat ini
    const visibleCards = document.querySelectorAll('[id^="rallyTimer_"]').length;
    
    // Jika jumlah kartu di layar BEDA dengan jumlah data di server (misal: di layar masih 1, tapi di server sudah 0)
    if (visibleCards !== rallies.length) {
        needsRefresh = true; // Paksa layar untuk menggambar ulang!
    }
    // ================================================

    rallies.forEach(r => {
      const remainBox = document.getElementById(`rallyTimer_${r.id}`);
      const btnBox = document.getElementById(`rallyBtn_${r.id}`);
      
      if (remainBox) {
        const remain = Math.max(0, Math.ceil(r.gathering_ends_at - currentServerTime));
        
        if (remain > 0) {
          remainBox.innerText = formatSeconds(remain);
        } else if (remain <= 0 && r.status === "gathering") {
          r.status = "marching"; 
          remainBox.innerText = "Berangkat...";
          if (btnBox) {
            btnBox.disabled = true;
            btnBox.innerText = "Pasukan Berangkat";
            btnBox.className = "guild-btn-danger";
          }
          needsRefresh = true;
        }
      }
    });

    // Render layar secara halus (tanpa memanggil server lagi) jika ada perubahan
    if (needsRefresh) {
       renderMyGuild(false);
    }
  }, 1000);
}
// === PELATUK ANTI-TIDUR UNTUK BROWSER ===
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // Tarik data seketika saat pemain kembali melihat tab/layar game ini!
    silentSync(); 
  }
});

// ==========================================
// MODULE: MISSION PAGE (DAILY, MAIN, SIDE)
// ==========================================
let currentMissionTab = "daily"; // Tab default saat menu Misi dibuka

window.switchMissionTab = function(tab) {
  currentMissionTab = tab;
  renderMissionPage();
};

function renderMissionPage() {
  const box = el("missionPageContent");
  if (!box) return;

  box.innerHTML = `
    <div class="facility-tabs" style="margin-bottom: 16px;">
      <button class="${currentMissionTab === 'daily' ? 'active' : ''}" onclick="switchMissionTab('daily')">Daily</button>
      <button class="${currentMissionTab === 'main' ? 'active' : ''}" onclick="switchMissionTab('main')">Main</button>
      <button class="${currentMissionTab === 'side' ? 'active' : ''}" onclick="switchMissionTab('side')">Side</button>
    </div>

    <div id="missionTabContent">
      ${getMissionTabContent()}
    </div>
  `;
}

function getMissionTabContent() {
  if (currentMissionTab === "daily") {
    return renderDailyMissionsHtml();
  } else if (currentMissionTab === "main") {
    const beginnerHtml = renderBeginnerMissionCard();
    return `
      <p class="muted">Selesaikan misi utama untuk membuka fitur bangunan dan menaikkan level Commander.</p>
      <div class="mission-list" style="margin-top: 12px;">
        ${beginnerHtml || `
          <div class="card p-20 text-center">
            <span style="font-size: 24px; display:block; margin-bottom:8px;">✅</span>
            <b>Semua misi utama selesai!</b>
            <p class="muted" style="margin-bottom:0;">Tunggu update ekspansi dari CyberCore HQ.</p>
          </div>
        `}
      </div>
    `;
  } else if (currentMissionTab === "side") {
    return `
      <div class="card p-20 text-center">
        <span style="font-size: 24px; display:block; margin-bottom:8px;">📜</span>
        <b>Side Missions</b>
        <p class="muted" style="margin-bottom:0;">Misi sampingan untuk mendapatkan blueprint dan modul khusus sedang dalam konstruksi.</p>
      </div>
    `;
  }
}

// === TAMPILAN DAILY MISSIONS (TERKONEKSI DENGAN SERVER) ===
function renderDailyMissionsHtml() {
  const tracker = (state.player && state.player.daily_tracker) ? state.player.daily_tracker : { progress: {}, claimed: [] };

  // === PERBAIKAN UX: Gunakan onClickCode agar tombol bisa memanggil fungsi spesifik ===
  const dailyMissions = [
    { 
      id: "d1", title: "Radar Operator", desc: "Lakukan Scan Area di Radar Tower sebanyak 3 kali.", max: 3, reward: "500 Credits", 
      actionBtn: "Open Radar", onClickCode: "switchPage('radarPage')" 
    },
    { 
      id: "d2", title: "Army Deployment", desc: "Latih 10 unit pasukan Breaker baru di Unit Factory.", max: 10, reward: "250 Nano Parts", 
      actionBtn: "Go To Train", 
      // PERBAIKAN: Menggunakan nama fungsi asli Anda yaitu openBuilding
      onClickCode: "switchPage('basePage'); openBuilding('unit_factory')" 
    },
    { 
      id: "d3", title: "Resource Gathering", desc: "Kumpulkan 1,000 resource (Tahap Simulasi).", max: 1000, reward: "15 Energy", 
      actionBtn: "Go To Mining", onClickCode: "switchPage('radarPage')" 
    }
  ];

  const missionHtml = dailyMissions.map(m => {
    const currentProgress = Math.min(tracker.progress[m.id] || 0, m.max);
    const isFinished = currentProgress >= m.max;
    const isClaimed = tracker.claimed && tracker.claimed.includes(m.id);

    let btnHtml = "";
    let progressHtml = `<b style="color:var(--text-main); font-size:14px;">${currentProgress} / ${m.max}</b>`;
    let borderStyle = "border-left: 3px solid var(--border);";

    if (isClaimed) {
        btnHtml = `<button disabled style="width:100%;">Claimed</button>`;
        progressHtml = `<b style="color:var(--good); font-size:14px;">Selesai</b>`;
    } else if (isFinished) {
        borderStyle = "border-left: 3px solid var(--good);";
        btnHtml = `<button class="guild-btn-success text-bold" style="width:100%;" onclick="submitClaimDailyMission('${m.id}')">Claim Reward</button>`;
    } else {
        // === TOMBOL SHORTCUT DINAMIS ===
        btnHtml = `<button style="width:100%;" onclick="${m.onClickCode}">${m.actionBtn}</button>`;
    }

    return `
      <div class="card" style="margin-bottom: 12px; ${borderStyle}">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 8px;">
          <div style="padding-right: 12px;">
            <h3 style="margin:0 0 4px 0;">${m.title}</h3>
            <p class="muted" style="margin:0 0 8px 0; font-size: 12px; line-height: 1.4;">${m.desc}</p>
            <div style="font-size: 12px; color: var(--warn); font-weight: bold;">🎁 Reward: ${m.reward}</div>
          </div>
          <div style="text-align:right; white-space: nowrap;">
            ${progressHtml}
          </div>
        </div>
        <div>
          ${btnHtml}
        </div>
      </div>
    `;
  }).join("");

  return `
    <p class="muted">Misi harian di-reset setiap pukul 00:00 waktu server. Selesaikan untuk mendapatkan suplai rutin.</p>
    <div class="daily-mission-list" style="margin-top: 12px; max-height: 60vh; overflow-y: auto; padding-right: 4px;">
      ${missionHtml}
    </div>
  `;
}

// === API KLAIM MISI KE SERVER ===
window.submitClaimDailyMission = async function(missionId) {
  try {
    const res = await api("/api/missions/daily/claim", {
      method: "POST",
      body: JSON.stringify({ mission_id: missionId })
    });
    
    // Tampilkan sukses
    alert(res.message);
    
    // Tarik ulang data terbaru dari server
    await loadState();
    
    // Refresh Layar Misi (Tombol akan otomatis berubah jadi "Selesai")
    renderMissionPage();
    
    // (BARIS renderPlayerStatus() YANG MEMBUAT ERROR SUDAH KITA HAPUS)
    // Catatan: Baris resource di atas layar akan otomatis ter-update sendirinya 
    // dalam hitungan detik berkat mesin silentSync Anda!

  } catch (err) {
    alert("Gagal klaim: " + err.message);
  }
};

document.addEventListener("DOMContentLoaded", initApp);