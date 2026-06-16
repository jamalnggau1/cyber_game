from __future__ import annotations
from pathlib import Path
import asyncio
import copy
import threading
import math
import random
import time
from backend.database import init_db, load_game_state, save_game_state, PLAYER_ID
from typing import Dict, List, Optional, Literal, Any
from fastapi import FastAPI, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


app = FastAPI(title="CyberCore Lab MVP")
@app.on_event("startup")
async def startup_database():
    global DB_LOOP

    DB_LOOP = asyncio.get_running_loop()

    await init_db()

    saved_state = await load_game_state(PLAYER_ID)

    if saved_state:
        GAME_STATE.clear()
        GAME_STATE.update(saved_state)
        print("[DB] GAME_STATE loaded from database")
    else:
        await save_game_state(GAME_STATE, PLAYER_ID)
        print("[DB] No saved state. Default GAME_STATE inserted")

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"


@app.get("/health")
async def health():
    return {"ok": True, "message": "CyberCore backend running"}

# ==========================================================
# Game constants
# ==========================================================

AI_AGENTS = {
    "nova_lite": {
        "name": "NOVA-Lite",
        "category": "Starter",
        "rarity": "Common",
        "level": 1,
        "star": 1,
        "buffs": {
            "Scout Reading": 2,
            "Strategy Accuracy": 2,
        },
        "description": "Starter AI yang seimbang, cocok untuk awal game.",
    },
    "hex": {
        "name": "HEX",
        "category": "Attack AI",
        "rarity": "Epic",
        "level": 5,
        "star": 2,
        "buffs": {
            "Firewall Crusher Effectiveness": 8,
            "Burst Execution": 5,
            "Critical Breach Chance": 4,
            "Risk Prediction Accuracy": -6,
            "Trace Exposure": 8,
        },
        "description": "AI agresif untuk build brute/burst. Kuat menyerang, tapi lebih berisiko.",
    },
    "sentry": {
        "name": "SENTRY",
        "category": "Defense AI",
        "rarity": "Epic",
        "level": 5,
        "star": 2,
        "buffs": {
            "Firewall Stability": 10,
            "Counter-Trace": 8,
            "Honeypot Efficiency": 7,
            "Shield Decision Accuracy": 5,
        },
        "description": "AI pertahanan untuk jamming, shield, dan counter-scout.",
    },
    "reboot": {
        "name": "REBOOT",
        "category": "Recovery AI",
        "rarity": "Rare",
        "level": 4,
        "star": 1,
        "buffs": {
            "Energy Recovery Speed": 12,
            "Cooldown Time": -8,
            "Unit Recovery Speed": 10,
            "Failed Attack Recovery": 5,
        },
        "description": "AI pemulihan untuk energy, cooldown, dan recovery unit.",
    },
    "ora": {
        "name": "ORA",
        "category": "Scout/Intel AI",
        "rarity": "Epic",
        "level": 5,
        "star": 2,
        "buffs": {
            "Analysis Accuracy": 15,
            "Trap Detection": 12,
            "Fake Vault Detection": 10,
            "Risk Prediction": 8,
            "Scout Reading": 5,
        },
        "description": "AI intel untuk membaca trap, fake vault, dan risiko target.",
    },
    "echo": {
        "name": "ECHO",
        "category": "Rally/Guild AI",
        "rarity": "Legendary",
        "level": 4,
        "star": 1,
        "buffs": {
            "Rally Coordination": 10,
            "Team Sync": 8,
            "Rally Report Accuracy": 6,
            "Travel Coordination Penalty": -5,
        },
        "description": "AI rally untuk koordinasi serangan guild.",
    },
    "kai": {
        "name": "KAI",
        "category": "Support/Economy AI",
        "rarity": "Rare",
        "level": 4,
        "star": 1,
        "buffs": {
            "Energy Cost": -10,
            "Script Stability": 12,
            "Module Sync": 8,
            "Upgrade Cost": -5,
        },
        "description": "AI support untuk efisiensi module, energy, dan upgrade.",
    },
}

ATTACK_MODULES = [
    {"id": "firewall_crusher", "name": "Firewall Crusher", "tags": ["brute", "firewall"], "effect": "Strong vs Firewall Fortress"},
    {"id": "core_breaker", "name": "Core Breaker", "tags": ["brute"], "effect": "High core damage"},
    {"id": "ghost_proxy", "name": "Ghost Proxy", "tags": ["stealth"], "effect": "Lower trace exposure"},
    {"id": "silent_injector", "name": "Silent Injector", "tags": ["stealth"], "effect": "Better stealth route"},
    {"id": "trap_detector", "name": "Trap Detector", "tags": ["analyst", "trap"], "effect": "Counters Honeypot"},
    {"id": "fake_signal_filter", "name": "Fake Signal Filter", "tags": ["analyst", "decoy"], "effect": "Counters Decoy/Fake Vault"},
    {"id": "trace_masker", "name": "Trace Masker", "tags": ["stealth", "trace"], "effect": "Reduces counter-trace"},
    {"id": "exploit_chain_script", "name": "Exploit Chain Script", "tags": ["exploit"], "effect": "Strong vs old patch/module"},
    {"id": "escape_script", "name": "Escape Script", "tags": ["safety"], "effect": "Reduces loss on fail"},
    {"id": "signal_accelerator", "name": "Signal Accelerator", "tags": ["speed"], "effect": "Reduces travel time"},
    {"id": "anti_jammer_chip", "name": "Anti-Jammer Chip", "tags": ["anti_jammer"], "effect": "Counters Signal Jammer"},
    {"id": "payload_booster", "name": "Payload Booster", "tags": ["burst"], "effect": "Better burst pressure"},
]
BREAKER_LEVELS = {
    1: {
        "hp": 120,
        "attack": 35,
        "defense": 18,
        "speed": 7,
        "cargo": 3,
    },
    2: {
        "hp": 155,
        "attack": 48,
        "defense": 24,
        "speed": 7,
        "cargo": 4,
    },
    3: {
        "hp": 200,
        "attack": 65,
        "defense": 32,
        "speed": 6,
        "cargo": 5,
    },
    4: {
        "hp": 260,
        "attack": 88,
        "defense": 43,
        "speed": 6,
        "cargo": 6,
    },
    5: {
        "hp": 340,
        "attack": 120,
        "defense": 58,
        "speed": 5,
        "cargo": 8,
    },
}
UNITS = {
    "breaker": {
        "id": "breaker",
        "name": "Breaker",
        "role": "Heavy assault unit",
        "description": "Pasukan penyerang berat dengan attack dan HP tinggi, tapi speed lambat dan cargo kecil.",
        "max_level": 5,
        "levels": {
            1: {
                "hp": 120,
                "attack": 35,
                "defense": 18,
                "speed": 7,
                "cargo": 3,
                "train_cost": {"nano_parts": 80},
            },
            2: {
                "hp": 155,
                "attack": 48,
                "defense": 24,
                "speed": 7,
                "cargo": 4,
                "train_cost": {"nano_parts": 130},
            },
            3: {
                "hp": 200,
                "attack": 65,
                "defense": 32,
                "speed": 6,
                "cargo": 5,
                "train_cost": {"nano_parts": 210},
            },
            4: {
                "hp": 260,
                "attack": 88,
                "defense": 43,
                "speed": 6,
                "cargo": 6,
                "train_cost": {"credits": 340, "energy": 13},
            },
            5: {
                "hp": 340,
                "attack": 120,
                "defense": 58,
                "speed": 5,
                "cargo": 8,
                "train_cost": {"credits": 550, "energy": 18},
            },
        },
    },
}

MINING_RESOURCES = [
    {
        "id": "data_shard",
        "name": "Data Shard",
        "node_name": "Data Cache",
        "asset": "assets/mining/data_cache.png",
        "base_rate": 8,
        "capacity": 1200,
        "weight": 35,
    },
    {
        "id": "nano_parts",
        "name": "Nano Parts",
        "node_name": "Nano Mine",
        "asset": "assets/mining/nano_mine.png",
        "base_rate": 6,
        "capacity": 900,
        "weight": 35,
    },
    {
        "id": "credits",
        "name": "Credits",
        "node_name": "Credit Vault",
        "asset": "assets/mining/credit_vault.png",
        "base_rate": 20,
        "capacity": 3000,
        "weight": 25,
    },
    {
        "id": "nexus_core",
        "name": "Nexus Core",
        "node_name": "Nexus Rift",
        "asset": "assets/mining/nexus_rift.png",
        "base_rate": 0.05,
        "capacity": 5,
        "weight": 5,
    },
]

CONTESTED_NODES = {
    "obsidian_nexus": {
        "id": "obsidian_nexus",
        "name": "Obsidian Nexus",
        "type": "Weekly Nexus Node",
        "x": 410,
        "y": 880,
        "status": "Scheduled",
        "opens_in": "Sunday 20:00",
        "duration_minutes": 60,
        "current_holder": "None",
        "reward": "Guild Credits, Nexus Badge, Research Boost",
        "description": "Node besar yang diperebutkan guild selama 1 jam. Guild yang bertahan sampai akhir menjadi pemenang.",
    },
    "black_relay_core": {
        "id": "black_relay_core",
        "name": "Black Relay Core",
        "type": "Relay War Node",
        "x": 640,
        "y": 720,
        "status": "Locked",
        "opens_in": "Next Week",
        "duration_minutes": 60,
        "current_holder": "None",
        "occupants": 0,
        "max_occupants": 5,
        "reward": "Guild Relay Buff, Credits, War Points",
        "description": "Relay core yang memberi buff koordinasi rally untuk guild pemenang.",
    },
    "zero_day_citadel": {
        "id": "zero_day_citadel",
        "name": "Zero-Day Citadel",
        "type": "High Risk Nexus",
        "x": 920,
        "y": 1080,
        "status": "Locked",
        "opens_in": "Coming Soon",
        "duration_minutes": 60,
        "current_holder": "None",
        "occupants": 0,
        "max_occupants": 3,
        "reward": "Rare Fragment, Guild Title, High War Points",
        "description": "Citadel tingkat tinggi untuk guild kuat. Risiko tinggi, reward tinggi.",
    },
}

SCOUT_UNLOCKS = [
    (1, "distance/type/lab level/base tier"),
    (2, "vault size/shield/last activity/visible structure"),
    (3, "firewall category"),
    (4, "trap possibility"),
    (5, "trace scanner strength"),
    (6, "defense style"),
    (7, "estimated power range"),
    (8, "weakness hint"),
    (9, "counter risk"),
    (10, "build clue"),
]


# ==========================================================
# In-memory state
# ==========================================================

GAME_STATE: Dict[str, Any] = {
    "player": {
        "id": "player_001",
        "name": "YourLab",
        "x": 120,
        "y": 450,
        "lab_level": 7,
        "scanner_level": 3,
        "scout_level": 4,
        "ai_core_level": 2,
        "credits": 50000,
        "energy": 100,
        "resources": {
            "data_shard": 0,
            "nano_parts": 10000,
            "nexus_core": 0,
        },
        "energy_last_update": time.time(),
        "trace_exposure": 12,
        "owned_ai": ["nova_lite", "hex", "ora", "reboot"],
        "active_ai": ["ora", "hex"],
        "unit_inventory": {
            "breaker": {"1": 80, "2": 0, "3": 0, "4": 0, "5": 0},
            "ghost": {"1": 40, "2": 0, "3": 0, "4": 0, "5": 0},
            "probe": {"1": 30, "2": 0, "3": 0, "4": 0, "5": 0},
            "payload": {"1": 60, "2": 0, "3": 0, "4": 0, "5": 0},
            "relay": {"1": 25, "2": 0, "3": 0, "4": 0, "5": 0},
            "extractor": {"1": 35, "2": 0, "3": 0, "4": 0, "5": 0},
        },

        "scan_counter": 0,
        "targets": [],
        "mining_nodes": [],

        "unit_tech": {
            "breaker": 1,
            "ghost": 1,
            "probe": 1,
            "payload": 1,
            "relay": 1,
            "extractor": 1,
        },
    },
    "settings": {
        "language": "id",
        "sound": True,
        "vibration": True,
        "reduced_motion": False,
        "theme": "cyber_dark",
        },

    "buildings": {
        "main_lab": {
            "id": "main_lab",
            "name": "Main Lab",
            "level": 7,
            "locked": False,
            "asset": "assets/base.png",
            "description": "Level utama akun, membuka bangunan baru, kapasitas dasar, dan syarat upgrade fitur besar.",
            "actions": ["Upgrade Main Lab", "View Lab Stats"],
        },
        "radar_tower": {
            "id": "radar_tower",
            "name": "Radar Tower",
            "level": 3,
            "locked": False,
            "asset": "assets/radar.png",
            "description": "Untuk Scan area, Scout target, dan membuka informasi musuh berdasarkan Scout level.",
            "actions": ["Open Radar", "Upgrade Scanner", "Upgrade Scout"],
        },
        "ai_core": {
            "id": "ai_core",
            "name": "AI Core",
            "level": 2,
            "locked": False,
            "asset": "assets/ai_core.png",
            "description": "Mengatur AI Agent, slot AI aktif, fragment, training AI, dan buff aktif.",
            "actions": ["Open AI Agent", "Upgrade AI Core"],
        },
        "unit_factory": {
            "id": "unit_factory",
            "name": "Unit Factory",
            "level": 2,
            "locked": False,
            "asset": "assets/unit_factory.png",
            "description": "Tempat membuat pasukan cyber untuk menyerang. Unit bisa mati/disabled saat gagal menyerang.",
            "actions": ["Train Unit", "Upgrade Unit Factory"],
        },
        "research_lab": {
            "id": "research_lab",
            "name": "Research Lab",
            "level": 1,
            "locked": False,
            "asset": "assets/research_lab.png",
            "description": "Tempat riset Network Speed, Scout Signal, Unit Capacity, AI Sync, dan Attack Routing.",
            "actions": ["Start Research", "Upgrade Research Lab"],
        },
        "recovery_center": {
            "id": "recovery_center",
            "name": "Recovery Center",
            "level": 1,
            "locked": False,
            "asset": "assets/recovery_center.png",
            "description": "Memulihkan unit disabled, energy, cooldown, dan recovery setelah battle.",
            "actions": ["Recover Units", "Upgrade Recovery Center"],
        },
        "guild_gate": {
            "id": "guild_gate",
            "name": "Guild Gate",
            "level": 0,
            "locked": True,
            "asset": "assets/guild_gate.png",
            "description": "Membuka guild, rally, guild building, guild war, dan territory.",
            "actions": ["Locked"],
        },
    },

    "unit_training_cost": {
        "breaker": {"credits": 80, "energy": 1},
        "ghost": {"credits": 120, "energy": 1},
        "probe": {"credits": 100, "energy": 1},
        "payload": {"credits": 140, "energy": 2},
        "relay": {"credits": 160, "energy": 2},
        "extractor": {"credits": 130, "energy": 1},
    },

    "targets": {},
    "active_attacks": {},
        "research": {
        "energy_generation": {
            "id": "energy_generation",
            "name": "Energy Generation",
            "level": 0,
            "max_level": 10,
            "base_credits": 800,
            "base_energy": 0,
            "description": "Meningkatkan pendapatan Energy otomatis setiap menit.",
            "effect": "Energy regen +1 per minute per level",
        },
        "network_speed": {
            "id": "network_speed",
            "name": "Network Speed",
            "level": 0,
            "max_level": 10,
            "base_credits": 1200,
            "base_energy": 5,
            "description": "Mengurangi waktu perjalanan serangan berdasarkan jarak.",
            "effect": "Travel time -3% per level",
        },
        "scout_signal": {
            "id": "scout_signal",
            "name": "Scout Signal",
            "level": 1,
            "max_level": 10,
            "base_credits": 1000,
            "base_energy": 4,
            "description": "Meningkatkan kualitas Scout dan mengurangi gangguan jammer.",
            "effect": "Scout noise -5% per level",
        },
        "unit_capacity": {
            "id": "unit_capacity",
            "name": "Unit Capacity",
            "level": 2,
            "max_level": 10,
            "base_credits": 1500,
            "base_energy": 6,
            "description": "Menambah jumlah unit yang bisa dibawa saat attack.",
            "effect": "Max deployed units +10 per level",
        },
        "ai_sync": {
            "id": "ai_sync",
            "name": "AI Sync",
            "level": 0,
            "max_level": 10,
            "base_credits": 1800,
            "base_energy": 8,
            "description": "Meningkatkan efektivitas buff dan analisis AI Agent.",
            "effect": "AI buff effect +3% per level",
        },
        "attack_routing": {
            "id": "attack_routing",
            "name": "Attack Routing",
            "level": 0,
            "max_level": 10,
            "base_credits": 1600,
            "base_energy": 7,
            "description": "Membuat rute serangan lebih stabil, terutama jarak jauh.",
            "effect": "Long distance penalty -5% per level",
        },
    },
}

DB_LOOP = None
_PENDING_SAVE_STATE = None
_SAVE_TASK = None
_SAVE_LOCK = threading.Lock()


def persist_state():
    """
    Simpan GAME_STATE ke database secara background.
    Aman dipanggil dari endpoint sync biasa.
    Tidak langsung blocking request.
    """
    global _PENDING_SAVE_STATE

    try:
        snapshot = copy.deepcopy(GAME_STATE)

        with _SAVE_LOCK:
            _PENDING_SAVE_STATE = snapshot

        if DB_LOOP and DB_LOOP.is_running():
            DB_LOOP.call_soon_threadsafe(_ensure_save_task)
        else:
            print("[DB] Event loop belum siap, skip schedule save sementara.")

    except Exception as e:
        print(f"[DB PERSIST ERROR] {e}")


def _ensure_save_task():
    global _SAVE_TASK

    if _SAVE_TASK is None or _SAVE_TASK.done():
        _SAVE_TASK = asyncio.create_task(_save_worker())


async def _save_worker():
    global _PENDING_SAVE_STATE

    while True:
        # debounce kecil supaya kalau banyak perubahan cepat,
        # database tidak ditulis berkali-kali.
        await asyncio.sleep(0.5)

        with _SAVE_LOCK:
            snapshot = _PENDING_SAVE_STATE
            _PENDING_SAVE_STATE = None

        if snapshot is None:
            return

        try:
            await save_game_state(snapshot, PLAYER_ID)
            print("[DB] GAME_STATE saved")
        except Exception as e:
            print(f"[DB SAVE ERROR] {e}")

        with _SAVE_LOCK:
            if _PENDING_SAVE_STATE is None:
                return

def get_unit_config(unit_id: str) -> Dict[str, Any]:
    unit = UNITS.get(unit_id)

    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    return unit

def get_unit_stats(unit_id: str, level: int):
    unit = UNITS.get(unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    level = int(level)
    stats = unit["levels"].get(level)

    if not stats:
        raise HTTPException(status_code=400, detail="Unit level not found")

    return stats

def get_unit_level(unit_id: str) -> int:
    p = GAME_STATE["player"]
    p.setdefault("unit_levels", {})
    return int(p["unit_levels"].get(unit_id, 1))


def get_unit_power(unit_id: str) -> int:
    unit = get_unit_config(unit_id)
    level = get_unit_level(unit_id)

    return int(unit["base_power"] + ((level - 1) * unit["power_growth"]))


def get_unit_upgrade_cost(unit_id: str):
    unit = get_unit_config(unit_id)
    level = get_unit_level(unit_id)

    if level >= unit["max_level"]:
        return None

    mult = unit.get("upgrade_cost_mult", 1.0)

    return {
        "credits": int((1200 + level * 650) * mult),
        "energy": int((12 + level * 4) * mult),
    }


def get_units_for_player():
    p = GAME_STATE["player"]
    p.setdefault("unit_levels", {})

    result = []

    for unit_id, unit in UNITS.items():
        level = get_unit_level(unit_id)
        power = get_unit_power(unit_id)
        owned = p["unit_inventory"].get(unit_id, 0)
        next_cost = get_unit_upgrade_cost(unit_id)

        item = {
            **unit,
            "level": level,
            "power": power,
            "owned": owned,
            "total_power": owned * power,
            "next_upgrade_cost": next_cost,
            "maxed": next_cost is None,
        }

        result.append(item)

    return result


def calculate_unit_power_score(units: Dict[str, int]) -> tuple[int, List[str]]:
    total_power = 0
    lines = []

    for unit_id, amount in units.items():
        amount = int(amount or 0)
        if amount <= 0:
            continue

        unit = get_unit_config(unit_id)
        level = get_unit_level(unit_id)
        power = get_unit_power(unit_id)
        subtotal = amount * power

        total_power += subtotal
        lines.append(f"- {unit['name']} Lv.{level}: {amount} x {power} = {subtotal}")

    return total_power, lines

def distance(a_x: int, a_y: int, b_x: int, b_y: int) -> float:
    return round(math.sqrt((a_x - b_x) ** 2 + (a_y - b_y) ** 2), 2)


def scanner_radius(level: int) -> int:
    return {1: 10, 2: 25, 3: 50, 4: 100, 5: 200}.get(level, 10)


def base_travel_time_seconds(dist: float) -> int:
    if dist <= 10:
        return 30
    if dist <= 25:
        return 60
    if dist <= 50:
        return 180
    if dist <= 100:
        return 420
    if dist <= 200:
        return 900
    return 1800

def get_energy_regen_per_minute() -> int:
    base_regen = 1
    energy_research_level = get_research_level("energy_generation")
    return base_regen + energy_research_level


def apply_energy_regen():
    p = GAME_STATE["player"]

    now = time.time()
    last_update = p.get("energy_last_update", now)

    elapsed_seconds = now - last_update
    elapsed_minutes = int(elapsed_seconds // 60)

    if elapsed_minutes <= 0:
        return

    regen_per_minute = get_energy_regen_per_minute()
    gained_energy = elapsed_minutes * regen_per_minute

    max_energy = p.get("max_energy", 100)

    p["energy"] = min(max_energy, p["energy"] + gained_energy)
    p["energy_last_update"] = last_update + (elapsed_minutes * 60)

def get_active_ai_buffs(active_ai: List[str]) -> Dict[str, int]:
    buffs: Dict[str, int] = {}
    for ai_id in active_ai:
        ai = AI_AGENTS.get(ai_id)
        if not ai:
            continue
        for key, val in ai["buffs"].items():
            buffs[key] = buffs.get(key, 0) + val
    return buffs

def get_research_next_cost(research: Dict[str, Any]) -> Dict[str, int]:
    next_level = research["level"] + 1

    return {
        "credits": research["base_credits"] * next_level,
        "energy": research["base_energy"] * next_level,
    }


def get_research_with_costs() -> Dict[str, Any]:
    result = {}

    for research_id, research in GAME_STATE["research"].items():
        item = dict(research)

        if research["level"] >= research["max_level"]:
            item["next_cost"] = None
            item["maxed"] = True
        else:
            item["next_cost"] = get_research_next_cost(research)
            item["maxed"] = False

        result[research_id] = item

    return result

def get_research_level(research_id: str) -> int:
    research = GAME_STATE.get("research", {}).get(research_id)
    if not research:
        return 0
    return int(research.get("level", 0))


def get_max_deploy_units() -> int:
    base_capacity = 100
    unit_capacity_level = get_research_level("unit_capacity")
    return base_capacity + (unit_capacity_level * 10)


def get_effective_ai_buffs(active_ai: List[str]) -> Dict[str, int]:
    buffs = get_active_ai_buffs(active_ai)

    ai_sync_level = get_research_level("ai_sync")
    if ai_sync_level <= 0:
        return buffs

    multiplier = 1 + (ai_sync_level * 0.03)

    # Jangan boost penalty buruk dari AI agresif seperti HEX
    penalty_keys = {
        "Trace Exposure",
        "Risk Prediction Accuracy",
    }

    enhanced = {}

    for key, value in buffs.items():
        if key in penalty_keys:
            enhanced[key] = value
        else:
            enhanced[key] = int(round(value * multiplier))

    return enhanced

ENEMY_UNIT_POOL = [
    {
        "id": "breaker",
        "name": "Breaker",
        "role": "Frontline",
        "hp": 120,
        "attack": 35,
        "defense": 18,
        "speed": 7,
        "cargo": 3,
    },
    {
        "id": "sentry",
        "name": "Sentry Drone",
        "role": "Defender",
        "hp": 90,
        "attack": 28,
        "defense": 32,
        "speed": 8,
        "cargo": 1,
    },
    {
        "id": "trap_guard",
        "name": "Trap Guard",
        "role": "Control",
        "hp": 105,
        "attack": 22,
        "defense": 38,
        "speed": 5,
        "cargo": 1,
    },
    {
        "id": "vault_guard",
        "name": "Vault Guard",
        "role": "Heavy Defense",
        "hp": 180,
        "attack": 20,
        "defense": 55,
        "speed": 4,
        "cargo": 2,
    },
]

ENEMY_BUILD_ARCHETYPES = [
    {
        "id": "firewall_wall",
        "name": "Firewall Wall",
        "defense_style": "Firewall Heavy",
        "modules": ["Firewall Core", "Vault Guard", "Repair Node"],
        "weakness_hint": "Firewall Breaker + Breach Payload",
        "counter_risk": "Serangan lambat mudah menaikkan trace.",
    },
    {
        "id": "trap_network",
        "name": "Trap Network",
        "defense_style": "Trap Control",
        "modules": ["Trap Net", "Sentinel", "Trace Monitor"],
        "weakness_hint": "Trap Disruptor + Relay Booster",
        "counter_risk": "Unit cepat bisa terkena trap berlapis.",
    },
    {
        "id": "sentinel_grid",
        "name": "Sentinel Grid",
        "defense_style": "Balanced Defense",
        "modules": ["Sentinel", "Firewall Core", "Trace Monitor"],
        "weakness_hint": "Balanced module build lebih aman.",
        "counter_risk": "Salah build akan membuat damage rendah.",
    },
    {
        "id": "vault_turtle",
        "name": "Vault Turtle",
        "defense_style": "Resource Turtle",
        "modules": ["Vault Guard", "Repair Node", "Firewall Core"],
        "weakness_hint": "Breach Payload + Data Extractor",
        "counter_risk": "Pertahanan tebal, butuh power lebih tinggi.",
    },
]

def threat_multiplier(target_type: str) -> float:
    t = str(target_type or "").lower()

    if "nexus" in t:
        return 2.0
    if "strong" in t:
        return 1.6
    if "medium" in t:
        return 1.25
    if "weak" in t:
        return 0.9

    return 1.0

def make_enemy_resources(target_level: int, signal_strength: str):
    mult = threat_multiplier(signal_strength)

    target_level = max(1, int(target_level or 1))

    return {
        "credits": int((600 + target_level * 180 + random.randint(0, 600)) * mult),
        "data_shard": int((30 + target_level * 12 + random.randint(0, 60)) * mult),
        "nano_parts": int((80 + target_level * 25 + random.randint(0, 120)) * mult),
        "nexus_core": 1 if target_level >= 8 and random.random() < 0.22 else 0,
    }

def generate_targets():
    p = GAME_STATE["player"]

    names = [
        "Ghost Relay Lab",
        "Dark Packet Node",
        "Obsidian Firewall",
        "Silent Vault",
        "Neon Proxy Lab",
        "Broken Cipher Base",
        "Zero Trace Server",
        "Black Signal Core",
        "Crimson Data Nest",
        "Void Access Lab",
    ]

    enemy_types = [
        "Cyber Lab",
        "Data Vault",
        "Firewall Node",
        "Proxy Nest",
        "Signal Relay",
    ]

    signal_pool = ["Weak", "Medium", "Strong"]

    targets = []

    scan_counter = GAME_STATE.get("scan_counter", 0)

    for i in range(random.randint(5, 8)):
        dx = random.randint(-45, 45)
        dy = random.randint(-45, 45)

        if abs(dx) < 8:
            dx += random.choice([-12, 12])

        if abs(dy) < 8:
            dy += random.choice([-12, 12])

        tx = p["x"] + dx
        ty = p["y"] + dy

        distance = int((dx ** 2 + dy ** 2) ** 0.5)
        enemy_level = random.randint(1, 12)
        defense_power = 800 + (enemy_level * 180) + random.randint(0, 350)
        

        signal_strength = random.choice(signal_pool)

        if enemy_level >= 9:
            signal_strength = random.choice(["Medium", "Strong"])

        target_id = f"scan_{scan_counter}_{i}_{random.randint(1000, 9999)}"

        target = {
            "id": target_id,
            "name": random.choice(names),
            "x": tx,
            "y": ty,
            "distance": distance,
            "type": random.choice(enemy_types),
            "level": enemy_level,
            "lab_level": enemy_level,
            "defense_power": defense_power,
            "signal_strength": signal_strength,
            "lab_tier": random.choice(["Low", "Standard", "Advanced", "Elite"]),
            "vault_signal": random.choice(["Small", "Medium", "Large", "Encrypted"]),

            "firewall": random.choice([
                "Basic Firewall",
                "Hardened Firewall",
                "Reinforced Firewall",
                "Quantum Wall",
            ]),

            "asset": get_enemy_asset_by_level(enemy_level, signal_strength),
        }

        enemy_army = make_enemy_army(enemy_level, signal_strength)
        enemy_build = make_enemy_build(enemy_level, signal_strength)

        target["enemy_army"] = enemy_army["units"]
        target["enemy_army_power"] = enemy_army["total_power"]

        target["enemy_build"] = enemy_build
        target["defense_style"] = enemy_build["defense_style"]
        target["defense_modules"] = enemy_build["modules"]
        target["weakness_hint"] = enemy_build["weakness_hint"]
        target["counter_risk"] = enemy_build["counter_risk"]

        target["defense_power"] = enemy_army["total_power"] + enemy_build["power"]
        target["estimated_power"] = target["defense_power"]
        target["resources"] = make_enemy_resources(enemy_level, signal_strength)

        targets.append(target)

    return targets

def pick_mining_resource():
    weights = [r["weight"] for r in MINING_RESOURCES]
    return random.choices(MINING_RESOURCES, weights=weights, k=1)[0]

def point_distance(a, b):
    return int(((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2) ** 0.5)


def is_too_close_to_any(point, points, min_distance):
    for p in points:
        if point_distance(point, p) < min_distance:
            return True
    return False

def generate_mining_nodes(enemy_targets=None):
    p = GAME_STATE["player"]
    scan_counter = GAME_STATE.get("scan_counter", 0)

    enemy_targets = enemy_targets or []

    nodes = []

    MIN_DISTANCE_FROM_ENEMY = 26
    MIN_DISTANCE_FROM_MINING = 18

    for i in range(random.randint(2, 4)):
        res = pick_mining_resource()

        chosen_point = None

        # Coba cari posisi yang tidak menempel enemy/mining
        for attempt in range(60):
            dx = random.randint(-55, 55)
            dy = random.randint(-55, 55)

            if abs(dx) < 12:
                dx += random.choice([-18, 18])

            if abs(dy) < 12:
                dy += random.choice([-18, 18])

            x = p["x"] + dx
            y = p["y"] + dy

            point = {
                "x": x,
                "y": y
            }

            if is_too_close_to_any(point, enemy_targets, MIN_DISTANCE_FROM_ENEMY):
                continue

            if is_too_close_to_any(point, nodes, MIN_DISTANCE_FROM_MINING):
                continue

            chosen_point = point
            break

        # Fallback kalau radar terlalu padat
        if chosen_point is None:
            angle = random.random() * 6.28318
            distance_from_base = random.randint(38, 58)

            chosen_point = {
                "x": int(p["x"] + math.cos(angle) * distance_from_base),
                "y": int(p["y"] + math.sin(angle) * distance_from_base),
            }

        x = chosen_point["x"]
        y = chosen_point["y"]

        dx = x - p["x"]
        dy = y - p["y"]

        distance = int((dx ** 2 + dy ** 2) ** 0.5)

        guardian_level = random.randint(1, 10)
        guardian_power = 700 + (guardian_level * 170) + random.randint(0, 420)

        if res["id"] == "nexus_core":
            guardian_level += random.randint(2, 4)
            guardian_power += random.randint(600, 1200)

        node_id = f"mine_{scan_counter}_{i}_{random.randint(1000, 9999)}"

        nodes.append({
            "id": node_id,
            "kind": "mining",
            "name": f"{res['node_name']} Lv.{guardian_level}",
            "type": "Mining Node",
            "x": x,
            "y": y,
            "distance": distance,

            "level": guardian_level,
            "guardian_level": guardian_level,
            "guardian_power": guardian_power,

            "resource_id": res["id"],
            "resource_name": res["name"],
            "production_per_minute": res["base_rate"] + round(guardian_level * 0.35, 2),
            "capacity": res["capacity"] + (guardian_level * 120),
            "owner": None,
            "status": "Unoccupied",
            "signal_strength": "Strong" if res["id"] == "nexus_core" else random.choice(["Weak", "Medium", "Strong"]),
            "asset": res["asset"],
        })

    return nodes

def scale_enemy_stat(base_value: int, unit_level: int) -> int:
    return int(base_value * (1 + ((unit_level - 1) * 0.22)))

def make_enemy_army(target_level: int, target_type: str):
    mult = threat_multiplier(target_type)

    target_level = max(1, int(target_level or 1))
    unit_level = max(1, min(5, 1 + (target_level // 3)))

    picked_units = random.sample(
        ENEMY_UNIT_POOL,
        k=min(len(ENEMY_UNIT_POOL), random.randint(2, 3))
    )

    army = []
    total_power = 0

    for template in picked_units:
        count = int(random.randint(8, 18) * mult + target_level * 2)
        count = max(3, count)

        hp = scale_enemy_stat(template["hp"], unit_level)
        attack = scale_enemy_stat(template["attack"], unit_level)
        defense = scale_enemy_stat(template["defense"], unit_level)
        speed = template["speed"]
        cargo = template["cargo"]

        power = int((attack + defense + (hp / 10) + speed + cargo) * count)

        army.append({
            "id": template["id"],
            "name": template["name"],
            "role": template["role"],
            "level": unit_level,
            "count": count,
            "hp": hp,
            "attack": attack,
            "defense": defense,
            "speed": speed,
            "cargo": cargo,
            "power": power,
        })

        total_power += power

    return {
        "units": army,
        "total_power": total_power,
    }


def make_enemy_build(target_level: int, target_type: str):
    build = random.choice(ENEMY_BUILD_ARCHETYPES)
    mult = threat_multiplier(target_type)

    module_power = int((target_level * 120) * mult)

    return {
        "id": build["id"],
        "name": build["name"],
        "defense_style": build["defense_style"],
        "modules": build["modules"],
        "weakness_hint": build["weakness_hint"],
        "counter_risk": build["counter_risk"],
        "power": module_power,
    }

def get_enemy_asset_by_level(level: int, signal_strength: str):
    signal = str(signal_strength).lower()

    if level >= 10:
        return "assets/enemies/enemy_boss.png"

    if "strong" in signal:
        return "assets/enemies/enemy_strong.png"

    if "medium" in signal:
        return "assets/enemies/enemy_medium.png"

    return "assets/enemies/enemy_weak.png"


generate_targets()


# ==========================================================
# API models
# ==========================================================
class TrainUnitRequest(BaseModel):
    unit_id: str
    level: int = Field(ge=1, le=5)
    amount: int = Field(gt=0, le=999)
    
class UpdateSettingsRequest(BaseModel):
    language: str | None = None
    sound: bool | None = None
    vibration: bool | None = None
    reduced_motion: bool | None = None
    theme: str | None = None
    
class AnalyzeRequest(BaseModel):
    target_id: str
    ai_id: str = "ora"

class UpgradeResearchRequest(BaseModel):
    research_id: str

class AttackRequest(BaseModel):
    target_id: str
    module_ids: List[str] = Field(min_length=1, max_length=6)
    ai_ids: List[str] = Field(default_factory=list, max_length=6)
    units: Dict[str, Any]

def get_unit_config(unit_id: str) -> Dict[str, Any]:
    return UNITS.get(unit_id)


def get_unit_power(unit_id: str, level: int) -> int:
    unit = get_unit_config(unit_id)
    return int(unit["base_power"] + ((level - 1) * unit["power_growth"]))


def get_unit_train_cost(unit_id: str, level: int):
    stats = get_unit_stats(unit_id, level)
    return stats.get("train_cost", {"credits": 100, "energy": 5})


def get_unit_promote_cost(unit_id: str, from_level: int, amount: int) -> Dict[str, int]:
    next_level = from_level + 1
    train_cost = get_unit_train_cost(unit_id, next_level)

    return {
        "credits": int(train_cost["credits"] * 0.55 * amount),
        "energy": max(1, int(train_cost["energy"] * amount)),
    }


def get_unit_tech_cost(unit_id: str) -> Dict[str, int] | None:
    ensure_unit_system()

    p = GAME_STATE["player"]
    unit = get_unit_config(unit_id)

    current = int(p["unit_tech"].get(unit_id, 1))
    next_level = current + 1

    if next_level > unit["max_level"]:
        return None

    return {
        "credits": 2200 + (next_level * 1200),
        "energy": 18 + (next_level * 6),
    }


def get_units_for_player():
    ensure_unit_system()

    p = GAME_STATE["player"]
    result = []

    for unit_id, unit in UNITS.items():
        unlocked_level = int(p["unit_tech"].get(unit_id, 1))
        inventory = p["unit_inventory"].get(unit_id, {})

        levels = []

        for level in range(1, unit["max_level"] + 1):
            stats = get_unit_stats(unit_id, level)
            owned = int(inventory.get(str(level), 0))
            next_level = level + 1
            promote_to_next_unlocked = next_level <= unlocked_level and next_level <= unit["max_level"]

            levels.append({
                "promote_to_next_unlocked": promote_to_next_unlocked,
                "level": level,
                "unlocked": level <= unlocked_level,
                "owned": owned,

                "hp": stats["hp"],
                "attack": stats["attack"],
                "defense": stats["defense"],
                "speed": stats["speed"],
                "cargo": stats["cargo"],

                "train_cost": stats["train_cost"],
            })

        result.append({
            "id": unit_id,
            "name": unit["name"],
            "role": unit.get("role", ""),
            "description": unit.get("description", ""),
            "max_level": unit["max_level"],
            "unlocked_level": unlocked_level,
            "total_owned": sum(int(v or 0) for v in inventory.values()),
            "levels": levels,
        })

    return result


def get_unit_tech_list():
    ensure_unit_system()

    p = GAME_STATE["player"]
    items = []

    for unit_id, unit in UNITS.items():
        current = int(p["unit_tech"].get(unit_id, 1))
        cost = get_unit_tech_cost(unit_id)

        items.append({
            "unit_id": unit_id,
            "name": unit["name"],
            "current_level": current,
            "max_level": unit["max_level"],
            "next_level": current + 1 if cost else None,
            "next_cost": cost,
            "maxed": cost is None,
            "effect": f"Unlock {unit['name']} Lv.{current + 1}" if cost else "MAX LEVEL",
        })

    return items


def normalize_unit_payload(units: Dict[str, Any]) -> Dict[str, Dict[str, int]]:
    """
    Support payload baru:
    {
      "breaker": {"1": 10, "2": 5}
    }

    Support payload lama:
    {
      "breaker": 10
    }
    """
    normalized = {}

    for unit_id, value in units.items():
      get_unit_config(unit_id)

      if isinstance(value, dict):
          normalized[unit_id] = {
              str(level): int(amount or 0)
              for level, amount in value.items()
              if int(amount or 0) > 0
          }
      else:
          amount = int(value or 0)
          normalized[unit_id] = {"1": amount} if amount > 0 else {}

    return normalized

def find_target(target_id: str):
    for target in GAME_STATE.get("targets", []):
        if target["id"] == target_id:
            return target

    raise HTTPException(
        status_code=404,
        detail="Target not found. Scan again to find available targets."
    )

def scout_trip_time(dist: float, scout_level: int = 1):
    # Waktu pergi ke target
    outbound = int(float(dist) * 1.2)

    # minimal 4 detik, maksimal 45 detik untuk sekali jalan
    outbound = max(4, min(45, outbound))

    # Scout level tinggi sedikit mempercepat perjalanan
    speed_bonus = min(30, max(0, scout_level - 1) * 3)
    outbound = int(outbound * (1 - speed_bonus / 100))
    outbound = max(3, outbound)

    # Pulang ke base. Untuk MVP waktunya sama.
    return_time = outbound

    return {
        "outbound_seconds": outbound,
        "return_seconds": return_time,
        "total_seconds": outbound + return_time,
    }

def scout_energy_cost(dist: float) -> int:
    # dekat murah, jauh sedikit lebih mahal
    cost = 2 + int(float(dist) // 80)
    return max(2, min(8, cost))

def calculate_unit_power_score(units):
    ensure_unit_system()

    total_attack = 0
    total_hp = 0
    total_defense = 0
    total_cargo = 0
    speed_values = []
    lines = []
    total_units = 0

    normalized_units = normalize_unit_payload(units)

    for unit_id, level_map in normalized_units.items():
        unit = UNITS.get(unit_id)
        if not unit:
            continue

        for level_text, amount in level_map.items():
            level = int(level_text)
            amount = int(amount or 0)

            if amount <= 0:
                continue

            stats = get_unit_stats(unit_id, level)

            stack_attack = stats["attack"] * amount
            stack_hp = stats["hp"] * amount
            stack_defense = stats["defense"] * amount
            stack_cargo = stats["cargo"] * amount

            total_attack += stack_attack
            total_hp += stack_hp
            total_defense += stack_defense
            total_cargo += stack_cargo
            total_units += amount

            for _ in range(amount):
                speed_values.append(stats["speed"])

            lines.append(
                f"{unit['name']} Lv.{level} x{amount} | ATK {stack_attack} | HP {stack_hp} | DEF {stack_defense} | Cargo {stack_cargo}"
            )

    avg_speed = int(sum(speed_values) / len(speed_values)) if speed_values else 0

    total_power = total_attack

    return total_power, lines, total_units
# ==========================================================
# API endpoints
# ==========================================================

@app.get("/api/state")
def state():
    apply_energy_regen()
    p = GAME_STATE["player"]
    return {
        "player": p,
        "ai_agents": {ai_id: AI_AGENTS[ai_id] for ai_id in p["owned_ai"]},
        "all_ai_catalog": AI_AGENTS,
        "attack_modules": ATTACK_MODULES,
        "units": get_units_for_player(),
        "scout_unlocks": SCOUT_UNLOCKS,
        "active_ai_buffs": get_effective_ai_buffs(p["active_ai"]),
        "max_deploy_units": get_max_deploy_units(),
        "research": GAME_STATE["research"],
        "energy_regen_per_minute": get_energy_regen_per_minute(),
    }


@app.get("/api/scan")
def scan():
    apply_energy_regen()

    p = GAME_STATE["player"]

    GAME_STATE["scan_counter"] = GAME_STATE.get("scan_counter", 0) + 1
    persist_state()

    fresh_targets = generate_targets()
    fresh_mining_nodes = generate_mining_nodes(fresh_targets)

    GAME_STATE["targets"] = {
        t["id"]: t for t in fresh_targets
    }
    GAME_STATE["mining_nodes"] = {
        n["id"]: n for n in fresh_mining_nodes
    }

    scanner_level = p["scanner_level"]
    radius = 45 + (scanner_level * 15)

    visible = []

    for t in fresh_targets:
        if t["distance"] <= radius:
            visible.append({
                "id": t["id"],
                "kind": "enemy",
                "name": t["name"],
                "x": t["x"],
                "y": t["y"],
                "distance": t["distance"],
                "type": t["type"],
                "level": t.get("level", 1),
                "defense_power": t.get("defense_power", 500),
                "signal_strength": t["signal_strength"],
                "lab_tier": t["lab_tier"],
                "vault_signal": t["vault_signal"],
                
                "firewall": t.get("firewall", "Basic Firewall"),
                "asset": t.get("asset"),
            })
    visible_mining = []

    for node in fresh_mining_nodes:
        if node["distance"] <= radius:
            visible_mining.append(node)

    return {
        "scan_id": GAME_STATE["scan_counter"],
        "scanner_level": scanner_level,
        "radius": radius,
        "targets": visible + visible_mining,
        "enemy_count": len(visible),
        "mining_count": len(visible_mining),
    }

def build_scout_report(target_id: str):
    p = GAME_STATE["player"]

    target = GAME_STATE.get("targets", {}).get(target_id)

    if not target:
        raise HTTPException(
            status_code=404,
            detail="Target not found. Lakukan Scan Area dulu."
        )

    if target.get("kind") == "mining":
        raise HTTPException(
            status_code=400,
            detail="Mining node belum memakai Scout enemy."
        )

    level = int(p.get("scout_level", 1))
    enemy_army = target.get("enemy_army", [])
    enemy_build = target.get("enemy_build", {})
    defense_modules = target.get("defense_modules", [])
    target_resources = target.get("resources", {})

    if not isinstance(enemy_build, dict):
        enemy_build = {
            "name": str(enemy_build),
            "defense_style": target.get("defense_style", "Unknown"),
            "modules": defense_modules,
            "weakness_hint": target.get("weakness_hint", "Unknown"),
            "counter_risk": target.get("counter_risk", "Unknown"),
        }

    if not defense_modules:
        defense_modules = enemy_build.get("modules", [])

    report = {
        "enemy_army": enemy_army if level >= 2 else [
            {
                "name": "???",
                "level": "???",
                "count": "???",
                "role": "Unlock Scout Lv.2"
            }
        ],
        "resources": target_resources if level >= 2 else {
            "credits": "??? Unlock Scout Lv.2",
            "data_shard": "??? Unlock Scout Lv.2",
            "nano_parts": "??? Unlock Scout Lv.2",
            "nexus_core": "??? Unlock Scout Lv.2",
        },

        "enemy_build": enemy_build.get("name", "Unknown") if level >= 3 else "??? Unlock Scout Lv.3",

        "defense_modules": target.get("defense_modules", []) if level >= 4 else [
            "??? Unlock Scout Lv.4"
        ],
        "target_id": target.get("id", target_id),
        "name": target.get("name", "Unknown Target"),
        "distance": target.get("distance", "Unknown"),
        "type": target.get("type", "Unknown"),

        "lab_level": target.get("lab_level", target.get("level", "Unknown")),
        "base_tier": target.get("lab_tier", target.get("type", "Unknown")),

        "vault_size": target.get("vault_size", target.get("vault_signal", "Unknown")) if level >= 2 else "??? Unlock Scout Lv.2",
        "shield": "N/A - Enemy does not use shield",

        "last_activity": target.get("last_activity", "Unknown") if level >= 2 else "??? Unlock Scout Lv.2",
        "visible_structure": target.get("visible_structure", ["Unknown"]) if level >= 2 else ["??? Unlock Scout Lv.2"],

        "firewall": target.get("firewall", "Basic Firewall") if level >= 3 else "??? Unlock Scout Lv.3",
        "trap": target.get("trap", "Unknown") if level >= 4 else "??? Unlock Scout Lv.4",
        "trace_scanner": target.get("trace_scanner", "Unknown") if level >= 5 else "??? Unlock Scout Lv.5",
        "defense_style": target.get("defense_style", "Unknown") if level >= 3 else "??? Unlock Scout Lv.3",
        "estimated_power": target.get("estimated_power", target.get("defense_power", "Unknown")) if level >= 2 else "??? Unlock Scout Lv.2",
        "weakness_hint": target.get("weakness_hint", "Unknown") if level >= 4 else "??? Unlock Scout Lv.4",
        "counter_risk": target.get("counter_risk", "Unknown") if level >= 4 else "??? Unlock Scout Lv.4",
        "build_clue": target.get("build_clue", "Unknown") if level >= 10 else "??? Unlock Scout Lv.10",
    }

    attacker_score = level * 10
    defender_score = int(target.get("defense_ai_level", 0)) * 7 + int(target.get("jammer_level", 0)) * 5

    if defender_score > attacker_score + 15:
        report["counter_scout_status"] = "Scout channel cut off by enemy Defense AI"
        report["noise"] = "High"
    elif defender_score > attacker_score:
        report["counter_scout_status"] = "Scout data partially jammed"
        report["noise"] = "Medium"
    else:
        report["counter_scout_status"] = "Scout successful"
        report["noise"] = "Low"

    return report

@app.get("/api/scout/{target_id}")
def scout(target_id: str):
    return build_scout_report(target_id)

@app.post("/api/scout/start")
def start_scout(payload: dict = Body(...)):
    p = GAME_STATE["player"]

    target_id = str(payload.get("target_id", "")).strip()

    if not target_id:
        raise HTTPException(
            status_code=400,
            detail="target_id kosong. Lakukan Scan Area ulang lalu pilih target."
        )

    target = GAME_STATE.get("targets", {}).get(target_id)

    if not target:
        raise HTTPException(
            status_code=404,
            detail="Target not found. Lakukan Scan Area dulu."
        )

    if target.get("kind") == "mining":
        raise HTTPException(
            status_code=400,
            detail="Mining node belum bisa di-scout dengan Scout Drone."
        )

    distance_value = float(target.get("distance", 0))
    scout_level = int(p.get("scout_level", 1))

    energy_cost = scout_energy_cost(distance_value)

    if int(p.get("energy", 0)) < energy_cost:
        raise HTTPException(
            status_code=400,
            detail=f"Energy tidak cukup. Butuh {energy_cost}, punya {p.get('energy', 0)}"
        )

    p["energy"] -= energy_cost

    persist_state()
    report = build_scout_report(target_id)
    trip = scout_trip_time(distance_value, scout_level)

    scout_id = f"sct_{int(time.time())}_{random.randint(1000, 9999)}"

    return {
        "id": scout_id,
        "type": "scout",
        "target_id": target_id,
        "target_name": target.get("name", "Unknown Target"),
        "distance": target.get("distance", "?"),
        "outbound_seconds": trip["outbound_seconds"],
        "return_seconds": trip["return_seconds"],
        "travel_seconds": trip["total_seconds"],
        "energy_cost": energy_cost,
        "report": report,
        "energy_left": p["energy"],
    }

@app.post("/api/ai/analyze")
def ai_analyze(payload: dict = Body(...)):
    target_id = str(payload.get("target_id", "")).strip()
    ai_id = str(payload.get("ai_id", "nova_lite")).strip()
    scout_report = str(payload.get("scout_report", "")).strip()
    target_name_from_log = str(payload.get("target_name", "")).strip()

    if not target_id:
        raise HTTPException(status_code=400, detail="target_id kosong.")

    p = GAME_STATE["player"]

    target = GAME_STATE.get("targets", {}).get(target_id, {})

    ai_agents = GAME_STATE.get("ai_agents", {})
    ai = ai_agents.get(ai_id) or ai_agents.get("nova_lite") or {
        "id": "nova_lite",
        "name": "NOVA-Lite",
        "level": 1,
        "rarity": "Common",
        "buffs": {}
    }

    def read_report_value(label: str, default: str = "Unknown"):
        if not scout_report:
            return default

        prefix = f"{label}:"

        for line in scout_report.splitlines():
            line = line.strip()
            if line.lower().startswith(prefix.lower()):
                value = line.split(":", 1)[1].strip()
                return value if value else default

        return default

    target_name = (
        target.get("name")
        or target_name_from_log
        or read_report_value("Target")
        or "Unknown Target"
    )

    distance = target.get("distance", read_report_value("Distance", "?"))

    lab_level = target.get(
        "lab_level",
        target.get("level", read_report_value("Lab Level", "Unknown"))
    )

    base_tier = target.get(
        "lab_tier",
        target.get("type", read_report_value("Base Tier", "Unknown"))
    )

    firewall = target.get(
        "firewall",
        read_report_value("Firewall", "Unknown")
    )

    trap = target.get(
        "trap",
        read_report_value("Trap", "Unknown")
    )

    defense_style = target.get(
        "defense_style",
        read_report_value("Defense Style", "Unknown")
    )

    estimated_power = target.get(
        "estimated_power",
        target.get("defense_power", read_report_value("Estimated Power", "Unknown"))
    )

    weakness_hint = target.get(
        "weakness_hint",
        read_report_value("Weakness Hint", "Unknown")
    )

    counter_risk = target.get(
        "counter_risk",
        read_report_value("Counter Risk", "Unknown")
    )

    missing_data = []

    for label, value in [
        ("firewall", firewall),
        ("trap", trap),
        ("defense_style", defense_style),
        ("estimated_power", estimated_power),
        ("weakness_hint", weakness_hint),
        ("counter_risk", counter_risk),
    ]:
        value_text = str(value)
        if (
            not value_text
            or value_text == "Unknown"
            or value_text.startswith("???")
        ):
            missing_data.append(label)

    confidence = 55

    if scout_report:
        confidence += 15

    if not missing_data:
        confidence += 20
    else:
        confidence -= min(20, len(missing_data) * 4)

    ai_level = int(ai.get("level", 1))
    confidence += min(15, ai_level * 3)
    confidence = max(25, min(95, confidence))

    recommended_modules = []

    firewall_text = str(firewall).lower()
    trap_text = str(trap).lower()
    style_text = str(defense_style).lower()

    if "firewall" in firewall_text or "strong" in firewall_text or "basic" in firewall_text:
        recommended_modules.append("Firewall Breaker")

    if "trap" in trap_text or "net" in trap_text:
        recommended_modules.append("Trap Disruptor")

    if "stealth" in style_text or "jam" in style_text:
        recommended_modules.append("Signal Purifier")

    if "repair" in style_text or "sustain" in style_text:
        recommended_modules.append("Breach Payload")

    if "Unknown" in str(estimated_power) or str(estimated_power).startswith("???"):
        recommended_modules.append("Scout Booster")
    else:
        recommended_modules.append("Data Extractor")

    while len(recommended_modules) < 4:
        fallback = ["Relay Booster", "Breach Payload", "Data Extractor", "Route Stabilizer"]
        for item in fallback:
            if item not in recommended_modules:
                recommended_modules.append(item)
                break

    recommended_modules = recommended_modules[:4]

    if missing_data:
        recommended_build = "Safe Scout-Based Build"
        warning = "Data scout belum lengkap. Upgrade Scout untuk membuka informasi target lebih akurat."
    else:
        recommended_build = "Precision Breach Build"
        warning = "Data cukup untuk serangan terarah, tapi tetap cek energy dan unit sebelum attack."

    active_buffs_preview = {
        "analysis_accuracy": 0,
        "module_damage": 0,
        "trace_reduction": 0,
        "energy_efficiency": 0
    }

    buffs = ai.get("buffs", {}) or {}

    for key, value in buffs.items():
        key_text = str(key).lower()
        value_num = int(value) if isinstance(value, (int, float)) else 0

        if "accuracy" in key_text or "analysis" in key_text:
            active_buffs_preview["analysis_accuracy"] += value_num
        elif "damage" in key_text or "module" in key_text:
            active_buffs_preview["module_damage"] += value_num
        elif "trace" in key_text:
            active_buffs_preview["trace_reduction"] += value_num
        elif "energy" in key_text or "cost" in key_text:
            active_buffs_preview["energy_efficiency"] += value_num

    analysis = (
        f"Target {target_name} berada pada jarak {distance} Trace Unit. "
        f"Lab Level terdeteksi: {lab_level}, Tier: {base_tier}. "
        f"Firewall: {firewall}. Trap: {trap}. "
        f"Defense Style: {defense_style}. "
        f"Estimated Power: {estimated_power}. "
    )

    if weakness_hint and not str(weakness_hint).startswith("???"):
        analysis += f"Weakness Hint: {weakness_hint}. "

    if counter_risk and not str(counter_risk).startswith("???"):
        analysis += f"Counter Risk: {counter_risk}."

    return {
        "ai": {
            "id": ai.get("id", ai_id),
            "name": ai.get("name", ai_id),
            "level": ai.get("level", 1),
            "rarity": ai.get("rarity", "Common")
        },
        "target": {
            "id": target_id,
            "name": target_name,
            "distance": distance,
            "lab_level": lab_level,
            "base_tier": base_tier
        },
        "confidence": confidence,
        "analysis": analysis,
        "missing_data": missing_data,
        "recommendation": {
            "recommended_build": recommended_build,
            "recommended_modules": recommended_modules,
            "recommended_ai": ai.get("name", ai_id),
            "warning": warning
        },
        "active_buffs_preview": active_buffs_preview
    }


@app.post("/api/attack")
def attack(req: AttackRequest):
    apply_energy_regen()
    p = GAME_STATE["player"]
    target = GAME_STATE["targets"].get(req.target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")

    if len(req.module_ids) > 6:
        raise HTTPException(status_code=400, detail="Max 6 modules")
    if len(req.ai_ids) > p["ai_core_level"]:
        raise HTTPException(status_code=400, detail="Active AI exceeds AI Core slot")

    # validate owned AI
    ensure_unit_system()

    normalized_units = normalize_unit_payload(req.units)

    total_units = 0

    for unit_id, level_map in normalized_units.items():
        get_unit_config(unit_id)

        for level_text, amount in level_map.items():
            level = int(level_text)
            amount = int(amount or 0)

            if amount < 0:
                raise HTTPException(status_code=400, detail="Invalid unit amount")

            owned = int(p["unit_inventory"][unit_id].get(str(level), 0))

            if owned < amount:
                raise HTTPException(
                    status_code=400,
                    detail=f"Not enough {unit_id} Lv.{level}"
                )

            total_units += amount

    if total_units <= 0:
        raise HTTPException(status_code=400, detail="No units deployed")

    module_tags = []
    module_lookup = {m["id"]: m for m in ATTACK_MODULES}
    for mid in req.module_ids:
        mod = module_lookup.get(mid)
        if mod:
            module_tags.extend(mod["tags"])

    buffs = get_effective_ai_buffs(req.ai_ids)
    dist = target["distance"]
    travel = base_travel_time_seconds(dist)

    # speed reductions
    speed_reduce = 0
    network_speed_level = get_research_level("network_speed")
    speed_reduce += network_speed_level * 3
    if "signal_accelerator" in req.module_ids:
        speed_reduce += 15
    relay_count = sum(int(v or 0) for v in normalized_units.get("relay", {}).values())

    if relay_count >= 10:
        speed_reduce += 10
    if "Travel Coordination Penalty" in buffs:
        speed_reduce += abs(buffs["Travel Coordination Penalty"])
    if "Module Sync" in buffs:
        speed_reduce += min(5, buffs["Module Sync"] // 2)
        speed_reduce = min(speed_reduce, 70)
    final_travel = max(15, int(travel * (1 - speed_reduce / 100)))

    # battle scoring
    unit_power_score, unit_power_lines, total_units = calculate_unit_power_score(req.units)
    attack_score = unit_power_score
    if "firewall_crusher" in req.module_ids:
        attack_score += 350
        attack_score += buffs.get("Firewall Crusher Effectiveness", 0) * 15
    if "payload_booster" in req.module_ids:
        attack_score += 220
        attack_score += buffs.get("Burst Execution", 0) * 12
    if "exploit_chain_script" in req.module_ids:
        attack_score += 250
    if "trap_detector" in req.module_ids and target["defense_style"] == "Honeypot Trap":
        attack_score += 380
    if "fake_signal_filter" in req.module_ids and target["defense_style"] == "Decoy Network":
        attack_score += 350
    if "anti_jammer_chip" in req.module_ids and target["defense_style"] == "Signal Jammer":
        attack_score += 350

    defense_score = target["lab_level"] * 500 + target["defense_ai_level"] * 120 + target["jammer_level"] * 80
    attack_routing_level = get_research_level("attack_routing")

    long_distance_penalty = 0

    if dist > 100:
        long_distance_penalty = 10
    if dist > 200:
        long_distance_penalty = 20
    if dist > 300:
        long_distance_penalty = 30

    routing_reduction = attack_routing_level * 5
    final_distance_penalty = max(0, long_distance_penalty - routing_reduction)

    if final_distance_penalty > 0:
        attack_score = int(attack_score * (1 - final_distance_penalty / 100))

    # firewall defense bonus
    # Shield bukan defense bonus lagi. Shield hanya protection mutlak sebelum battle.
    shield_used = False
    shield_log = []

    firewall_bonus_map = {
        "Basic Firewall": 0,
        "Hardened Firewall": 250,
        "Reinforced Firewall": 500,
        "Quantum Wall": 800,
    }

    firewall_name = target.get("firewall", "Basic Firewall")
    firewall_bonus = firewall_bonus_map.get(firewall_name, 0)

    if firewall_bonus > 0:
        defense_score += firewall_bonus
        shield_log.append(f"DEFENSE: {firewall_name} added +{firewall_bonus} defense power.")

    success = attack_score > defense_score

    # unit losses
    loss_rate = 0.18 if success else 0.45
    if "escape_script" in req.module_ids:
        loss_rate -= 0.05
    loss_rate = max(0.08, loss_rate)

    destroyed = {}
    disabled = {}
    for unit_id, amount in req.units.items():
        lost = int(amount * loss_rate)
        dis = int(lost * 0.35)
        des = lost - dis
        destroyed[unit_id] = des
        disabled[unit_id] = dis
        p["unit_inventory"][unit_id] -= lost

    exposure_gain = 8 if success else 25
    if "trace_masker" in req.module_ids:
        exposure_gain -= 5
    exposure_gain += buffs.get("Trace Exposure", 0)
    p["trace_exposure"] = max(0, min(100, p["trace_exposure"] + exposure_gain))

    energy_cost = 15
    energy_cost += total_units // 30
    energy_cost += buffs.get("Energy Cost", 0)
    energy_cost = max(5, energy_cost)
    p["energy"] = max(0, p["energy"] - energy_cost)

    reward = {}
    if success:
        stolen = int(target["raidable_credits"] * random.uniform(0.25, 0.55))
        reward = {"credits": stolen, "material": random.randint(1, 5)}
        p["credits"] += stolen
    else:
        reward = {"credits": 0, "material": 0}

    battle_log = []
    ai_names = [AI_AGENTS[aid]["name"] for aid in req.ai_ids]
    battle_log.append(f"Attack launched against {target['name']}.")
    battle_log.append(f"Distance {dist} Trace Unit. Final travel time {final_travel} seconds.")
    battle_log.append(
        f"Research Applied: Network Speed Lv.{network_speed_level}, "
        f"Attack Routing Lv.{attack_routing_level}, "
        f"Unit Capacity Max {max_deploy_units}, "
        f"AI Sync Lv.{get_research_level('ai_sync')}."
    )

    if final_distance_penalty > 0:
        battle_log.append(f"Long Distance Penalty applied: -{final_distance_penalty}% attack efficiency.")
    else:
        battle_log.append("Attack Routing stable. No long distance penalty applied.")
        if ai_names:
            battle_log.append(f"Active AI: {', '.join(ai_names)}.")
            battle_log.append(f"Unit Power Score: {unit_power_score}.")
            battle_log.extend(unit_power_lines)
            battle_log.extend(shield_log)
    if target["defense_style"] == "Honeypot Trap" and "trap_detector" not in req.module_ids:
        battle_log.append("SYSTEM: Hidden Honeypot pressure detected. No Trap Detector equipped.")
    if target["defense_style"] == "Signal Jammer" and "anti_jammer_chip" not in req.module_ids:
        battle_log.append("SYSTEM: Signal Jammer disrupted part of the route.")
    battle_log.append(f"Attack Score: {int(attack_score)} vs Defense Score: {int(defense_score)}.")
    battle_log.append("RESULT: SUCCESS" if success else "RESULT: FAILED")
    if success:
        battle_log.append(f"Vault breached. Credits gained: {reward['credits']}.")
        battle_log.append("AI Learning: Strategy XP +10, Scout Reading XP +6.")
    else:
        battle_log.append("Attack route collapsed. Units destroyed/disabled.")
        battle_log.append("AI Learning: Risk Sense XP +10, Battle Simulation XP +8.")

    attack_id = f"atk_{int(time.time())}"
    GAME_STATE["active_attacks"][attack_id] = {
        "id": attack_id,
        "target_id": req.target_id,
        "success": success,
        "final_travel_seconds": final_travel,
        "created_at": time.time(),
        "battle_log": battle_log,
        "destroyed_units": destroyed,
        "disabled_units": disabled,
        "reward": reward,
        "trace_exposure": p["trace_exposure"],
        "energy_cost": energy_cost,
        "shield_used": shield_used,
        "unit_power_score": unit_power_score,
    }

    return GAME_STATE["active_attacks"][attack_id]

class PromoteUnitRequest(BaseModel):
    unit_id: str
    from_level: int = Field(ge=1, le=4)
    amount: int = Field(gt=0, le=999)


class UpgradeUnitTechRequest(BaseModel):
    unit_id: str


@app.get("/api/buildings")
def get_buildings():
    return {
        "buildings": GAME_STATE["buildings"],
        "player": GAME_STATE["player"],
        "units": get_units_for_player(),
        "unit_training_cost": GAME_STATE["unit_training_cost"],
    }


@app.post("/api/units/train")
def train_unit(req: TrainUnitRequest):
    ensure_unit_system()

    p = GAME_STATE["player"]
    unit = get_unit_config(req.unit_id)

    unlocked_level = int(p["unit_tech"].get(req.unit_id, 1))

    if req.level > unlocked_level:
        raise HTTPException(
            status_code=400,
            detail=f"{unit['name']} Lv.{req.level} belum terbuka di Research Lab"
        )

    cost = get_unit_train_cost(req.unit_id, req.level)

    total_nano = int(cost.get("nano_parts", 0)) * req.amount

    if p["resources"]["nano_parts"] < total_nano:
        raise HTTPException(status_code=400, detail="Not enough Nano Parts")

    p["resources"]["nano_parts"] -= total_nano
    p["unit_inventory"][req.unit_id][str(req.level)] += req.amount

    level_key = str(req.level)
    p["unit_inventory"][req.unit_id][level_key] += req.amount

    persist_state()
    return {
        "success": True,
        "message": f"Trained {req.amount} {unit['name']} Lv.{req.level}",
        "credits_left": p["credits"],
        "energy_left": p["energy"],
        "unit_inventory": p["unit_inventory"],
    }

def ensure_resource_system():
    p = GAME_STATE["player"]

    if "resources" not in p or not isinstance(p["resources"], dict):
        p["resources"] = {}

    p["resources"].setdefault("data_shard", 0)
    p["resources"].setdefault("nano_parts", 0)
    p["resources"].setdefault("nexus_core", 0)

def ensure_unit_system():
    p = GAME_STATE["player"]

    if "unit_inventory" not in p or not isinstance(p["unit_inventory"], dict):
        p["unit_inventory"] = {}

    if "unit_tech" not in p or not isinstance(p["unit_tech"], dict):
        p["unit_tech"] = {}

    for unit_id, unit in UNITS.items():
        p["unit_tech"].setdefault(unit_id, 1)

        current_inventory = p["unit_inventory"].get(unit_id)

        # Migrasi dari format lama:
        # "breaker": 80
        # menjadi:
        # "breaker": {"1": 80, "2": 0, ...}
        if isinstance(current_inventory, int):
            p["unit_inventory"][unit_id] = {
                "1": current_inventory
            }
        elif not isinstance(current_inventory, dict):
            p["unit_inventory"][unit_id] = {}

        max_level = int(unit.get("max_level", 5))

        for level in range(1, max_level + 1):
            p["unit_inventory"][unit_id].setdefault(str(level), 0)

@app.post("/api/units/promote")
def promote_unit(req: PromoteUnitRequest):
    ensure_unit_system()
    ensure_resource_system()

    p = GAME_STATE["player"]

    unit_id = req.unit_id
    from_level = int(req.from_level)
    to_level = from_level + 1
    amount = int(req.amount)

    if unit_id not in UNITS:
        raise HTTPException(status_code=400, detail="Unknown unit")

    unit = UNITS[unit_id]
    max_level = int(unit.get("max_level", 5))

    if from_level < 1 or from_level >= max_level:
        raise HTTPException(status_code=400, detail="Invalid promote level")

    unlocked_level = int(p["unit_tech"].get(unit_id, 1))

    if to_level > unlocked_level:
        raise HTTPException(
            status_code=400,
            detail=f"{unit['name']} Lv.{to_level} belum terbuka di Research Lab"
        )

    # Pastikan inventory unit dan level aman
    if unit_id not in p["unit_inventory"] or not isinstance(p["unit_inventory"][unit_id], dict):
        p["unit_inventory"][unit_id] = {}

    from_key = str(from_level)
    to_key = str(to_level)

    p["unit_inventory"][unit_id].setdefault(from_key, 0)
    p["unit_inventory"][unit_id].setdefault(to_key, 0)

    owned_from = int(p["unit_inventory"][unit_id].get(from_key, 0))

    if owned_from < amount:
        raise HTTPException(
            status_code=400,
            detail=f"Tidak cukup {unit['name']} Lv.{from_level}. Punya {owned_from}, butuh {amount}"
        )

    # Cost promote sementara pakai Nano Parts
    nano_per_unit = 40 * to_level
    total_nano = nano_per_unit * amount

    p["resources"].setdefault("nano_parts", 0)

    if int(p["resources"]["nano_parts"]) < total_nano:
        raise HTTPException(
            status_code=400,
            detail=f"Nano Parts tidak cukup. Butuh {total_nano}, punya {p['resources']['nano_parts']}"
        )

    p["resources"]["nano_parts"] -= total_nano

    p["unit_inventory"][unit_id][from_key] -= amount
    p["unit_inventory"][unit_id][to_key] += amount

    persist_state()
    return {
        "message": f"Promoted {amount} {unit['name']} Lv.{from_level} → Lv.{to_level}",
        "unit_id": unit_id,
        "from_level": from_level,
        "to_level": to_level,
        "amount": amount,
        "cost": {
            "nano_parts": total_nano
        },
        "inventory": p["unit_inventory"][unit_id],
        "resources": p["resources"],
    }

@app.post("/api/research/unit-tech/upgrade")
def upgrade_unit_tech(req: UpgradeUnitTechRequest):
    ensure_unit_system()

    p = GAME_STATE["player"]
    unit = get_unit_config(req.unit_id)

    current = int(p["unit_tech"].get(req.unit_id, 1))
    next_level = current + 1

    if next_level > unit["max_level"]:
        raise HTTPException(status_code=400, detail="Unit tech already max level")

    cost = get_unit_tech_cost(req.unit_id)

    if p["credits"] < cost["credits"]:
        raise HTTPException(status_code=400, detail="Not enough credits")

    if p["energy"] < cost["energy"]:
        raise HTTPException(status_code=400, detail="Not enough energy")

    p["credits"] -= cost["credits"]
    p["energy"] -= cost["energy"]

    p["unit_tech"][req.unit_id] = next_level
    persist_state()

    return {
        "success": True,
        "message": f"{unit['name']} Lv.{next_level} unlocked",
        "unit_id": req.unit_id,
        "unlocked_level": next_level,
        "credits_left": p["credits"],
        "energy_left": p["energy"],
    }

@app.get("/api/research")
def get_research():
    apply_energy_regen()
    return {
        "research": get_research_with_costs(),
        "player": GAME_STATE["player"],
        "research_lab": GAME_STATE["buildings"]["research_lab"],
        "unit_tech": get_unit_tech_list(),
        "energy_regen_per_minute": get_energy_regen_per_minute(),
    }

@app.post("/api/research/upgrade")
def upgrade_research(req: UpgradeResearchRequest):
    apply_energy_regen()
    p = GAME_STATE["player"]

    research = GAME_STATE["research"].get(req.research_id)
    if not research:
        raise HTTPException(status_code=404, detail="Research not found")

    if research["level"] >= research["max_level"]:
        raise HTTPException(status_code=400, detail="Research already max level")

    cost = get_research_next_cost(research)

    if p["credits"] < cost["credits"]:
        raise HTTPException(status_code=400, detail="Not enough credits")

    if p["energy"] < cost["energy"]:
        raise HTTPException(status_code=400, detail="Not enough energy")

    p["credits"] -= cost["credits"]
    p["energy"] -= cost["energy"]

    research["level"] += 1
    persist_state()

    return {
        "success": True,
        "message": f"{research['name']} upgraded to Lv.{research['level']}",
        "research": research,
        "player": p,
    }

@app.get("/api/contested-nodes")
def get_contested_nodes():
    return {
        "nodes": list(CONTESTED_NODES.values())
    }

@app.get("/api/profile")
def get_profile():
    apply_energy_regen()

    p = GAME_STATE["player"]

    return {
        "profile": {
            "id": p["id"],
            "name": p["name"],
            "coordinate": {
                "x": p["x"],
                "y": p["y"],
            },
            "lab_level": p["lab_level"],
            "scanner_level": p["scanner_level"],
            "scout_level": p["scout_level"],
            "ai_core_level": p["ai_core_level"],
            "credits": p["credits"],
            "energy": p["energy"],
            "max_energy": p.get("max_energy", 100),
            "energy_regen_per_minute": get_energy_regen_per_minute(),
            "trace_exposure": p["trace_exposure"],
            "owned_ai_count": len(p["owned_ai"]),
            "active_ai": p["active_ai"],
            "unit_inventory": p["unit_inventory"],
            "max_deploy_units": get_max_deploy_units(),
        }
    }


@app.get("/api/settings")
def get_settings():
    return {
        "settings": GAME_STATE["settings"]
    }


@app.post("/api/settings")
def update_settings(req: UpdateSettingsRequest):
    s = GAME_STATE["settings"]

    if req.language is not None:
        if req.language not in ["id", "en"]:
            raise HTTPException(status_code=400, detail="Unsupported language")
        s["language"] = req.language

    if req.sound is not None:
        s["sound"] = req.sound

    if req.vibration is not None:
        s["vibration"] = req.vibration

    if req.reduced_motion is not None:
        s["reduced_motion"] = req.reduced_motion

    if req.theme is not None:
        if req.theme not in ["cyber_dark"]:
            raise HTTPException(status_code=400, detail="Unsupported theme")
        s["theme"] = req.theme

    return {
        "success": True,
        "settings": s
    }

@app.post("/api/units/upgrade")
def upgrade_unit(req: UpgradeUnitRequest):
    p = GAME_STATE["player"]
    p.setdefault("unit_levels", {})

    if req.unit_id not in p["unit_inventory"]:
        raise HTTPException(status_code=400, detail="Unknown unit")

    unit = get_unit_config(req.unit_id)
    current_level = get_unit_level(req.unit_id)

    if current_level >= unit["max_level"]:
        raise HTTPException(status_code=400, detail="Unit already max level")

    cost = get_unit_upgrade_cost(req.unit_id)

    if p["credits"] < cost["credits"]:
        raise HTTPException(status_code=400, detail="Not enough credits")

    if p["energy"] < cost["energy"]:
        raise HTTPException(status_code=400, detail="Not enough energy")

    p["credits"] -= cost["credits"]
    p["energy"] -= cost["energy"]
    p["unit_levels"][req.unit_id] = current_level + 1

    new_level = p["unit_levels"][req.unit_id]
    new_power = get_unit_power(req.unit_id)

    return {
        "success": True,
        "message": f"{unit['name']} upgraded to Lv.{new_level}",
        "unit_id": req.unit_id,
        "level": new_level,
        "power": new_power,
        "credits_left": p["credits"],
        "energy_left": p["energy"],
    }

@app.post("/api/auth/telegram")
def auth_telegram(payload: dict = Body(...)):
    user = payload.get("user") or {}

    telegram_id = str(user.get("id", "")).strip()

    if not telegram_id:
        raise HTTPException(status_code=400, detail="Telegram user id kosong")

    p = GAME_STATE["player"]

    p["telegram"] = {
        "id": telegram_id,
        "username": user.get("username", ""),
        "first_name": user.get("first_name", ""),
        "last_name": user.get("last_name", ""),
        "language_code": user.get("language_code", ""),
    }

    p["player_id"] = f"tg_{telegram_id}"

    persist_state()

    return {
        "success": True,
        "player_id": p["player_id"],
        "telegram": p["telegram"],
    }

# WAJIB PALING BAWAH
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")