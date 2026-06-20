from __future__ import annotations
from pathlib import Path
import asyncio
import copy
import threading
import math
import random
import os
import time
import copy
import requests
from backend.database import init_db, load_game_state, save_game_state, PLAYER_ID
from typing import Dict, List, Optional, Literal, Any
from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

async def sync_state_from_db():
    saved_state = await load_game_state(PLAYER_ID)

    if saved_state:
        GAME_STATE.clear()
        GAME_STATE.update(saved_state)

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


ADMIN_KEY = os.getenv("ADMIN_KEY", "")


def require_admin(request: Request):
    key = request.headers.get("X-Admin-Key", "")

    if not ADMIN_KEY:
        raise HTTPException(status_code=500, detail="ADMIN_KEY belum diset")

    if key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Admin key salah")

    return True

def make_reset_player_profile(player_id: str, old_profile: dict | None = None):
    old_profile = old_profile or {}

    username = (
        old_profile.get("username")
        or old_profile.get("first_name")
        or old_profile.get("name")
        or player_id
    )

    profile = {
                "language": old_profile.get("language", "id"),
        "commander_name": old_profile.get(
            "commander_name",
            old_profile.get("name", username)
        ),
        "onboarding_complete": old_profile.get("onboarding_complete", False),
        "registered_at": old_profile.get("registered_at", int(time.time())),
        "referral_by": old_profile.get("referral_by", None),
        "referral_code": old_profile.get("referral_code", f"CC{str(old_profile.get('telegram_id') or player_id)[-6:]}"),
        "player_id": player_id,
        "telegram_id": old_profile.get("telegram_id", ""),
        "name": username,
        "username": old_profile.get("username", ""),
        "first_name": old_profile.get("first_name", ""),

        "x": old_profile.get("x", 120),
        "y": old_profile.get("y", 450),

        "lab_level": 0,
        "scanner_level": 0,
        "scout_level": 0,

        "energy": 100,
        "trace": 0,

        "jammer_level": 0,
        "defense_ai_level": 1,
        "trace_monitor_level": 1,

        "defense_style": "Starter Defense",
        "defense_build": {
            "name": "Starter Defense Grid",
            "modules": ["Firewall Core", "Trace Monitor", "Sentinel"],
        },

        "defense_units": [],

        "resources": {
            "credits": 3200,
            "nano_parts": 400,
            "data_shard": 0,
            "nexus_core": 0,
        },

        "buildings": make_default_player_buildings(),

        "owned_ai": ["nova_lite"],
        "active_ai": [],

        "unit_inventory": {
            "breaker": 0,
            "ghost": 0,
            "extractor": 0,
        },

        "research": {
            "level": 0,
            "unit_tech": {},
        },
        "tutorial": {
            "step": "build_main_lab",
            "completed": [],
        },
    }

    return ensure_player_profile_schema(profile)
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


UNITS = {
    "breaker": {
        "id": "breaker",
        "name": "Breaker",
        "type": "Infantry",
        "role": "Balanced assault unit",
        "description": "Pasukan utama yang seimbang. Cocok untuk serangan normal karena punya HP dan attack stabil.",
        "max_level": 5,
        "levels": {
            1: {
                "hp": 120,
                "attack": 35,
                "defense": 18,
                "speed": 7,
                "cargo": 3,
                "train_cost": {"credits": 60, "nano_parts": 10},
            },
            2: {
                "hp": 155,
                "attack": 48,
                "defense": 24,
                "speed": 7,
                "cargo": 4,
                "train_cost": {"credits": 120, "nano_parts": 25},
            },
            3: {
                "hp": 200,
                "attack": 65,
                "defense": 32,
                "speed": 6,
                "cargo": 5,
                "train_cost": {"credits": 220, "nano_parts": 55},
            },
            4: {
                "hp": 260,
                "attack": 88,
                "defense": 43,
                "speed": 6,
                "cargo": 6,
                "train_cost": {"credits": 380, "nano_parts": 100, "data_shard": 5},
            },
            5: {
                "hp": 340,
                "attack": 120,
                "defense": 58,
                "speed": 5,
                "cargo": 8,
                "train_cost": {"credits": 650, "nano_parts": 180, "data_shard": 15},
            },
        },
    },

    "ghost": {
        "id": "ghost",
        "name": "Ghost",
        "type": "Cavalry",
        "role": "Fast raider unit",
        "description": "Pasukan cepat untuk serangan kilat. Speed tinggi, tapi HP, defense, dan cargo lebih kecil.",
        "max_level": 5,
        "levels": {
            1: {
                "hp": 75,
                "attack": 28,
                "defense": 8,
                "speed": 14,
                "cargo": 2,
                "train_cost": {"credits": 85, "nano_parts": 14},
            },
            2: {
                "hp": 98,
                "attack": 39,
                "defense": 11,
                "speed": 15,
                "cargo": 2,
                "train_cost": {"credits": 165, "nano_parts": 34},
            },
            3: {
                "hp": 128,
                "attack": 54,
                "defense": 15,
                "speed": 16,
                "cargo": 3,
                "train_cost": {"credits": 300, "nano_parts": 75},
            },
            4: {
                "hp": 168,
                "attack": 74,
                "defense": 20,
                "speed": 17,
                "cargo": 3,
                "train_cost": {"credits": 520, "nano_parts": 135, "data_shard": 8},
            },
            5: {
                "hp": 220,
                "attack": 102,
                "defense": 27,
                "speed": 18,
                "cargo": 4,
                "train_cost": {"credits": 900, "nano_parts": 240, "data_shard": 25},
            },
        },
    },

    "extractor": {
        "id": "extractor",
        "name": "Extractor",
        "type": "Carrier",
        "role": "High cargo farming unit",
        "description": "Pasukan pembawa resource. Cargo dan HP besar, tapi speed dan attack lebih rendah.",
        "max_level": 5,
        "levels": {
            1: {
                "hp": 170,
                "attack": 18,
                "defense": 28,
                "speed": 4,
                "cargo": 12,
                "train_cost": {"credits": 120, "nano_parts": 22},
            },
            2: {
                "hp": 230,
                "attack": 25,
                "defense": 38,
                "speed": 4,
                "cargo": 18,
                "train_cost": {"credits": 230, "nano_parts": 55},
            },
            3: {
                "hp": 310,
                "attack": 35,
                "defense": 52,
                "speed": 4,
                "cargo": 26,
                "train_cost": {"credits": 420, "nano_parts": 120},
            },
            4: {
                "hp": 420,
                "attack": 49,
                "defense": 72,
                "speed": 3,
                "cargo": 38,
                "train_cost": {"credits": 720, "nano_parts": 210, "data_shard": 10},
            },
            5: {
                "hp": 570,
                "attack": 68,
                "defense": 98,
                "speed": 3,
                "cargo": 55,
                "train_cost": {"credits": 1250, "nano_parts": 380, "data_shard": 35},
            },
        },
    },
}

MINING_RESOURCES = [
    {
        "id": "data_shard",
        "name": "Data Shard",
        "node_name": "Data Cache",
        "asset": "assets/mining/data_cache.webp",
        "base_rate": 8,
        "capacity": 1200,
        "weight": 35,
    },
    {
        "id": "nano_parts",
        "name": "Nano Parts",
        "node_name": "Nano Mine",
        "asset": "assets/mining/nano_mine.webp",
        "base_rate": 6,
        "capacity": 900,
        "weight": 35,
    },
    {
        "id": "credits",
        "name": "Credits",
        "node_name": "Credit Vault",
        "asset": "assets/mining/credit_vault.webp",
        "base_rate": 20,
        "capacity": 3000,
        "weight": 25,
    },
    {
        "id": "nexus_core",
        "name": "Nexus Core",
        "node_name": "Nexus Rift",
        "asset": "assets/mining/nexus_rift.webp",
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
        "credits": 50000000,
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
            "asset": "assets/base.webp",
            "description": "Level utama akun, membuka bangunan baru, kapasitas dasar, dan syarat upgrade fitur besar.",
            "actions": ["Upgrade Main Lab", "View Lab Stats"],
        },
        "radar_tower": {
            "id": "radar_tower",
            "name": "Radar Tower",
            "level": 3,
            "locked": False,
            "asset": "assets/radar.webp",
            "description": "Untuk Scan area, Scout target, dan membuka informasi musuh berdasarkan Scout level.",
            "actions": ["Open Radar", "Upgrade Scanner", "Upgrade Scout"],
        },
        "ai_core": {
            "id": "ai_core",
            "name": "AI Core",
            "level": 2,
            "locked": False,
            "asset": "assets/ai_core.webp",
            "description": "Mengatur AI Agent, slot AI aktif, fragment, training AI, dan buff aktif.",
            "actions": ["Open AI Agent", "Upgrade AI Core"],
        },
        "unit_factory": {
            "id": "unit_factory",
            "name": "Unit Factory",
            "level": 2,
            "locked": False,
            "asset": "assets/unit_factory.webp",
            "description": "Tempat membuat pasukan cyber untuk menyerang. Unit bisa mati/disabled saat gagal menyerang.",
            "actions": ["Train Unit", "Upgrade Unit Factory"],
        },
        "research_lab": {
            "id": "research_lab",
            "name": "Research Lab",
            "level": 1,
            "locked": False,
            "asset": "assets/research_lab.webp",
            "description": "Tempat riset Network Speed, Scout Signal, Unit Capacity, AI Sync, dan Attack Routing.",
            "actions": ["Start Research", "Upgrade Research Lab"],
        },
        "recovery_center": {
            "id": "recovery_center",
            "name": "Recovery Center",
            "level": 1,
            "locked": False,
            "asset": "assets/recovery_center.webp",
            "description": "Memulihkan unit disabled, energy, cooldown, dan recovery setelah battle.",
            "actions": ["Recover Units", "Upgrade Recovery Center"],
        },
        "guild_gate": {
            "id": "guild_gate",
            "name": "Guild Gate",
            "level": 0,
            "locked": True,
            "asset": "assets/guild_gate.webp",
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
        "scout_drone": {
            "id": "scout_drone",
            "name": "Scout Drone",
            "level": 1,
            "max_level": 10,
            "base_credits": 900,
            "base_energy": 4,
            "description": "Meningkatkan level Scout Drone untuk membuka detail intel target.",
            "effect": "Unlock deeper scout intel per level",
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

BUILDING_MAX_LEVEL = {
    "main_lab": 10,
    "unit_factory": 10,
    "radar_tower": 10,
    "recovery_center": 10,
    "research_lab": 10,
    "ai_core": 10,
    "guild_gate": 10,
}
MAIN_LAB_UPGRADE_REQUIREMENTS = {
    # Untuk naik ke Main Lab Lv.2
    2: {
        "unit_factory": 1,
    },

    # Untuk naik ke Main Lab Lv.3
    3: {
        "unit_factory": 2,
        "radar_tower": 1,
    },

    # Untuk naik ke Main Lab Lv.4
    4: {
        "unit_factory": 3,
        "radar_tower": 2,
        "recovery_center": 1,
    },

    # Untuk naik ke Main Lab Lv.5
    5: {
        "unit_factory": 3,
        "radar_tower": 3,
        "recovery_center": 2,
        "research_lab": 1,
    },

    # Untuk naik ke Main Lab Lv.6
    6: {
        "unit_factory": 4,
        "radar_tower": 3,
        "research_lab": 2,
        "ai_core": 1,
    },

    # Untuk naik ke Main Lab Lv.7
    7: {
        "unit_factory": 5,
        "radar_tower": 4,
        "research_lab": 3,
        "ai_core": 2,
        "recovery_center": 3,
    },

    # Untuk naik ke Main Lab Lv.8
    8: {
        "unit_factory": 6,
        "radar_tower": 5,
        "research_lab": 4,
        "ai_core": 3,
        "recovery_center": 4,
    },

    # Untuk naik ke Main Lab Lv.9
    9: {
        "unit_factory": 7,
        "radar_tower": 6,
        "research_lab": 5,
        "ai_core": 4,
        "recovery_center": 5,
    },

    # Untuk naik ke Main Lab Lv.10
    10: {
        "unit_factory": 8,
        "radar_tower": 7,
        "research_lab": 6,
        "ai_core": 5,
        "recovery_center": 6,
    },
}

def get_building_display_name(profile: dict, building_id: str):
    building = profile.get("buildings", {}).get(building_id, {})
    return building.get("name", building_id)


def validate_building_upgrade_requirements(
    profile: dict,
    building_id: str,
    current_level: int,
    next_level: int,
):
    """
    Mengatur keseimbangan upgrade bangunan.

    Rule:
    1. Bangunan selain Main Lab tidak boleh melebihi level Main Lab.
    2. Main Lab tidak boleh naik kalau bangunan penting belum memenuhi syarat.
    """

    main_lab_level = get_profile_building_level(profile, "main_lab")

    # Rule 1:
    # Bangunan selain Main Lab tidak boleh lebih tinggi dari Main Lab.
    if building_id != "main_lab":
        if next_level > main_lab_level:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{get_building_display_name(profile, building_id)} tidak bisa naik ke Lv.{next_level}. "
                    f"Upgrade Main Lab ke Lv.{next_level} dulu."
                )
            )

        return True

    # Rule 2:
    # Main Lab harus menunggu bangunan penting ikut naik.
    requirements = MAIN_LAB_UPGRADE_REQUIREMENTS.get(next_level, {})

    missing = []

    for req_building_id, req_level in requirements.items():
        owned_level = get_profile_building_level(profile, req_building_id)

        if owned_level < int(req_level):
            missing.append(
                f"{get_building_display_name(profile, req_building_id)} Lv.{req_level}"
            )

    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Sebelum upgrade Main Lab ke Lv.{next_level}, penuhi dulu: "
                + ", ".join(missing)
            )
        )

    return True

def get_building_upgrade_cost(building_id: str, level: int):
    """
    level = level saat ini.
    Jika level 0, berarti biaya build pertama kali.
    Tidak memakai energy.
    """

    current_level = int(level or 0)
    next_level = current_level + 1

    # Main Lab adalah gate utama game.
    # Biayanya dibuat manual supaya progression lebih terkontrol.
    if building_id == "main_lab":
        main_lab_costs = {
            1: {"credits": 400},
            2: {"credits": 700, "nano_parts": 80},
            3: {"credits": 1200, "nano_parts": 160},
            4: {"credits": 2200, "nano_parts": 300, "data_shard": 50},
            5: {"credits": 4000, "nano_parts": 600, "data_shard": 150},
            6: {"credits": 7000, "nano_parts": 1000, "data_shard": 300, "nexus_core": 1},
            7: {"credits": 12000, "nano_parts": 1800, "data_shard": 600, "nexus_core": 2},
            8: {"credits": 20000, "nano_parts": 3000, "data_shard": 1000, "nexus_core": 4},
            9: {"credits": 35000, "nano_parts": 5000, "data_shard": 1800, "nexus_core": 7},
            10: {"credits": 60000, "nano_parts": 8000, "data_shard": 3000, "nexus_core": 12},
        }

        return main_lab_costs.get(next_level, {
            "credits": 999999,
            "nano_parts": 999999,
            "data_shard": 999999,
            "nexus_core": 999,
        })

    # Biaya build pertama kali untuk bangunan selain Main Lab.
    build_costs = {
        "unit_factory": {"credits": 500, "nano_parts": 50},
        "radar_tower": {"credits": 900, "nano_parts": 120},
        "recovery_center": {"credits": 900, "nano_parts": 120},
        "research_lab": {"credits": 1200, "nano_parts": 180, "data_shard": 30},
        "ai_core": {"credits": 1800, "nano_parts": 250, "data_shard": 80},
        "guild_gate": {"credits": 6000, "nano_parts": 1200, "data_shard": 500, "nexus_core": 2},
    }

    if current_level <= 0:
        return build_costs.get(building_id, {"credits": 800})

    # Biaya upgrade setelah bangunan aktif.
    base_costs = {
        "unit_factory": {"credits": 900, "nano_parts": 120},
        "radar_tower": {"credits": 1600, "nano_parts": 260, "data_shard": 40},
        "recovery_center": {"credits": 1300, "nano_parts": 180},
        "research_lab": {"credits": 1600, "nano_parts": 240, "data_shard": 40},
        "ai_core": {"credits": 2200, "nano_parts": 320, "data_shard": 90},
        "guild_gate": {"credits": 7000, "nano_parts": 1400, "data_shard": 600, "nexus_core": 2},
    }

    base = base_costs.get(building_id, {"credits": 1000})

    multiplier = 1.55 ** max(0, current_level - 1)

    cost = {}

    for resource_id, amount in base.items():
        cost[resource_id] = int(amount * multiplier)

    # Nexus Core mulai lebih berat di level tinggi untuk bangunan high-tech.
    if next_level >= 6 and building_id in ["ai_core", "research_lab", "guild_gate"]:
        cost["nexus_core"] = cost.get("nexus_core", 0) + max(1, next_level - 5)

    # Radar adalah gerbang reward besar, fragment, mining, dan target elite.
    # Jadi upgrade radar harus lebih mahal daripada bangunan biasa.
    if building_id == "radar_tower":
        if next_level >= 5:
            cost["data_shard"] = cost.get("data_shard", 0) + (next_level * 80)

        if next_level >= 7:
            cost["nexus_core"] = cost.get("nexus_core", 0) + max(1, next_level - 6)

    return cost

RESOURCE_LABELS = {
    "credits": "Credits",
    "nano_parts": "Nano Parts",
    "data_shard": "Data Shard",
    "nexus_core": "Nexus Core",
}


def require_and_pay_resources(profile: dict, cost: dict):
    resources = profile.setdefault("resources", {})

    for resource_id, amount in cost.items():
        amount = int(amount or 0)

        if amount <= 0:
            continue

        owned = int(resources.get(resource_id, 0) or 0)

        if owned < amount:
            label = RESOURCE_LABELS.get(resource_id, resource_id)
            raise HTTPException(
                status_code=400,
                detail=f"{label} tidak cukup. Butuh {amount}, punya {owned}"
            )

    for resource_id, amount in cost.items():
        amount = int(amount or 0)

        if amount <= 0:
            continue

        resources[resource_id] = int(resources.get(resource_id, 0) or 0) - amount

    profile["resources"] = resources
    return profile

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

DEFENSE_MODULE_CONFIG = {
    "Firewall Core": {
        "power": 280,
        "anti_scout": 2,
    },
    "Trace Monitor": {
        "power": 220,
        "anti_scout": 8,
    },
    "Sentinel": {
        "power": 260,
        "anti_scout": 2,
    },
    "Jammer Core": {
        "power": 240,
        "anti_scout": 14,
    },
    "Trap Net": {
        "power": 230,
        "anti_scout": 4,
    },
    "Repair Node": {
        "power": 260,
        "anti_scout": 1,
    },
    "Vault Guard": {
        "power": 320,
        "anti_scout": 1,
    },
}


def get_ai_defense_bonus_percent(profile: dict):
    profile = ensure_profile_ai_system(profile)

    buffs = get_active_ai_buffs(profile.get("active_ai", []))

    defense_buff_keys = {
        "Firewall Stability",
        "Counter-Trace",
        "Shield Decision Accuracy",
        "Honeypot Efficiency",
    }

    total = 0

    for key in defense_buff_keys:
        total += int(buffs.get(key, 0))

    return max(0, total)


def get_profile_army_power(profile: dict):
    profile = ensure_profile_unit_system(profile)

    total = 0

    for unit_id, inventory in profile.get("unit_inventory", {}).items():
        if unit_id not in UNITS:
            continue

        if not isinstance(inventory, dict):
            continue

        for level_text, amount in inventory.items():
            amount = int(amount or 0)

            if amount <= 0:
                continue

            level = int(level_text)
            stats = get_unit_stats(unit_id, level)

            unit_score = int(
                (stats["hp"] * 0.08)
                + (stats["attack"] * 1.4)
                + (stats["defense"] * 1.2)
                + (stats["speed"] * 5)
                + (stats["cargo"] * 2)
            )

            total += unit_score * amount

    return int(total)


def get_profile_base_power(profile: dict):
    buildings = profile.get("buildings", {})

    building_weights = {
        "main_lab": 520,
        "radar_tower": 220,
        "ai_core": 260,
        "unit_factory": 240,
        "research_lab": 240,
        "recovery_center": 180,
        "guild_gate": 400,
    }

    total = 0

    for building_id, weight in building_weights.items():
        building = buildings.get(building_id, {})
        level = int(building.get("level", 0) or 0)

        if building.get("locked"):
            continue

        total += level * weight

    return int(total)


def get_profile_research_power(profile: dict):
    profile = ensure_player_profile_schema(profile)

    research = profile.get("research", {})
    core = research.get("core", {})
    unit_tech = research.get("unit_tech", {})

    core_power = sum(int(level or 0) * 180 for level in core.values())
    unit_tech_power = sum(max(0, int(level or 1) - 1) * 140 for level in unit_tech.values())

    return int(core_power + unit_tech_power)


def get_profile_ai_power(profile: dict):
    profile = ensure_profile_ai_system(profile)

    rarity_weight = {
        "Common": 1.0,
        "Rare": 1.35,
        "Epic": 1.75,
        "Legendary": 2.35,
    }

    total = 0

    for ai_id in profile.get("active_ai", []):
        ai = AI_AGENTS.get(ai_id)

        if not ai:
            continue

        level = int(ai.get("level", 1))
        star = int(ai.get("star", 1))
        rarity = ai.get("rarity", "Common")

        total += int(level * star * 120 * rarity_weight.get(rarity, 1.0))

    return int(total)


def get_defense_module_score(modules: list[str]):
    total_power = 0
    total_anti_scout = 0

    for module in modules:
        config = DEFENSE_MODULE_CONFIG.get(module, {
            "power": 180,
            "anti_scout": 0,
        })

        total_power += int(config["power"])
        total_anti_scout += int(config["anti_scout"])

    return {
        "module_score": total_power,
        "module_anti_scout": total_anti_scout,
    }

def apply_npc_guard_damage(target: dict, final_attack_score: int, final_defense_score: int, success: bool):
    if target.get("kind") != "enemy":
        return {}

    army = target.get("enemy_army", [])

    if not isinstance(army, list) or not army:
        return {}

    pressure = final_attack_score / max(1, final_defense_score)

    if success:
        base_rate = random.uniform(0.35, 0.65)
    else:
        base_rate = random.uniform(0.08, 0.22)

    casualty_rate = base_rate * min(1.4, max(0.25, pressure))
    casualty_rate = max(0.02, min(0.85, casualty_rate))

    enemy_destroyed = {}
    new_guard_power = 0

    for unit in army:
        count = int(unit.get("count", 0) or 0)

        if count <= 0:
            continue

        old_power = int(unit.get("power", 0) or 0)
        per_unit_power = old_power / max(1, count)

        killed = int(count * casualty_rate * random.uniform(0.75, 1.15))

        if success and killed <= 0:
            killed = 1

        killed = max(0, min(count, killed))
        new_count = count - killed

        unit["count"] = new_count
        unit["power"] = int(per_unit_power * new_count)

        new_guard_power += int(unit["power"])

        if killed > 0:
            label = f"{unit.get('name', unit.get('id', 'Unknown Unit'))} Lv.{unit.get('level', 1)}"
            enemy_destroyed[label] = enemy_destroyed.get(label, 0) + killed

    target["enemy_army_power"] = int(new_guard_power)

    defense_stats = target.get("defense_stats", {})

    if isinstance(defense_stats, dict):
        module_power = int(defense_stats.get("npc_module_power", 0) or 0)

        defense_stats["npc_guard_power"] = int(new_guard_power)
        defense_stats["defense_power"] = int(new_guard_power + module_power)

        target["defense_stats"] = defense_stats
        target["defense_power"] = defense_stats["defense_power"]
        target["estimated_power"] = defense_stats["defense_power"]

    if success:
        target["status"] = "breached"
    elif new_guard_power <= 0:
        target["status"] = "collapsed"
    else:
        target["status"] = "damaged"

    return enemy_destroyed

def get_defense_stats_for_profile(profile: dict):
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_unit_system(profile)
    profile = ensure_profile_ai_system(profile)

    build = profile.get("defense_build", {})
    modules = build.get("modules", []) if isinstance(build, dict) else []

    module_stats = get_defense_module_score(modules)

    army_power = get_profile_army_power(profile)
    base_power = get_profile_base_power(profile)
    research_power = get_profile_research_power(profile)
    ai_power = get_profile_ai_power(profile)

    module_score = module_stats["module_score"]
    module_anti_scout = module_stats["module_anti_scout"]

    ai_defense_bonus_percent = get_ai_defense_bonus_percent(profile)
    ai_multiplier = 1 + (ai_defense_bonus_percent / 100)

    raw_defense_power = (
        army_power
        + base_power
        + research_power
        + ai_power
        + module_score
    )

    defense_power = int(raw_defense_power * ai_multiplier)

    jammer_level = int(profile.get("jammer_level", 1))

    # Lv.1 adalah baseline, belum memberi bonus besar.
    # Bonus anti-scout baru terasa mulai Lv.2.
    jammer_bonus = max(0, jammer_level - 1) * 12

    anti_scout_base = (
        jammer_bonus
        + module_anti_scout
        + int(base_power * 0.002)
        + int(research_power * 0.003)
    )

    anti_scout_score = int(anti_scout_base * ai_multiplier)

    return {
        "anti_scout_score": anti_scout_score,
        "defense_power": defense_power,

        "army_power": army_power,
        "base_power": base_power,
        "research_power": research_power,
        "ai_power": ai_power,
        "module_score": module_score,

        "raw_defense_power": raw_defense_power,
        "ai_defense_bonus_percent": ai_defense_bonus_percent,
        "ai_multiplier": round(ai_multiplier, 2),

        "jammer_level": profile.get("jammer_level", 1),
        "modules_count": len(modules),
        "active_ai": profile.get("active_ai", []),
        "active_ai_buffs": get_active_ai_buffs(profile.get("active_ai", [])),
    }

def refresh_player_target_from_profile(target: dict):
    if not isinstance(target, dict):
        return target

    if target.get("kind") != "player":
        return target

    defender_player_id = target.get("player_id")
    defender = GAME_STATE.get("players", {}).get(defender_player_id)

    if not defender:
        return target

    defender = ensure_player_profile_schema(defender)
    defense_stats = get_defense_stats_for_profile(defender)

    defense_units = defender.get("defense_units", [])
    army_power = sum(int(u.get("power", 0)) for u in defense_units)

    build = defender.get("defense_build", {})
    modules = build.get("modules", []) if isinstance(build, dict) else []

    target["name"] = f"Player Base: {defender.get('name', defender_player_id)}"
    target["level"] = defender.get("lab_level", 1)
    target["lab_level"] = defender.get("lab_level", 1)
    target["lab_tier"] = "Player"
    target["signal_strength"] = "Player"
    target["vault_signal"] = "Player Vault"

    target["enemy_army"] = defense_units
    target["enemy_army_power"] = army_power
    target["enemy_build"] = build
    target["defense_modules"] = modules
    target["defense_style"] = defender.get("defense_style", "Balanced Defense")

    target["defense_stats"] = defense_stats
    target["defense_power"] = defense_stats["defense_power"]
    target["estimated_power"] = defense_stats["defense_power"]
    target["resources"] = defender.get("resources", {})

    target["jammer_level"] = defender.get("jammer_level", 1)
    target["defense_ai_level"] = defender.get("defense_ai_level", 1)
    target["trace_monitor_level"] = defender.get("trace_monitor_level", 1)

    return target

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

def get_effective_scout_level(profile: dict) -> int:
    profile = ensure_player_profile_schema(profile)

    base_scout = int(profile.get("scout_level", 1))
    drone_research = int(get_profile_research_level(profile, "scout_drone"))

    return max(1, base_scout, drone_research)

def make_enemy_resources(target_level: int, signal_strength: str):
    mult = threat_multiplier(signal_strength)

    target_level = max(1, int(target_level or 1))

    return {
        "credits": int((600 + target_level * 180 + random.randint(0, 600)) * mult),
        "data_shard": int((30 + target_level * 12 + random.randint(0, 60)) * mult),
        "nano_parts": int((80 + target_level * 25 + random.randint(0, 120)) * mult),
        "nexus_core": 1 if target_level >= 8 and random.random() < 0.22 else 0,
    }

BUILDING_UNLOCK_RULES = {
    "unit_factory": {
        "main_lab": 1,
    },
    "radar_tower": {
        "main_lab": 1,
        "unit_factory": 1,
    },
    "recovery_center": {
        "main_lab": 2,
    },
    "research_lab": {
        "main_lab": 2,
    },
    "ai_core": {
        "main_lab": 3,
    },
    "guild_gate": {
        "main_lab": 5,
    },
}


def get_profile_building_level(profile: dict, building_id: str):
    building = profile.get("buildings", {}).get(building_id, {})
    return int(building.get("level", 0) or 0)


def is_building_requirement_met(profile: dict, requirements: dict):
    for req_building_id, req_level in requirements.items():
        if get_profile_building_level(profile, req_building_id) < int(req_level):
            return False

    return True

BUILT_BUILDING_ACTIONS = {
    "main_lab": ["Upgrade Main Lab", "Stats"],
    "unit_factory": ["Train", "Upgrade Factory"],
    "radar_tower": ["Open Radar", "Upgrade Radar"],
    "recovery_center": ["Recover", "Upgrade Recovery"],
    "research_lab": ["Research", "Upgrade Lab"],
    "ai_core": ["Open AI Agent", "Upgrade AI Core"],
    "guild_gate": ["Open Guild", "Upgrade Guild Gate"],
}


def get_build_action_text(building: dict):
    return f"Build {building.get('name', 'Building')}"


def refresh_building_actions(profile: dict):
    buildings = profile.setdefault("buildings", make_default_player_buildings())

    for building_id, building in buildings.items():
        level = int(building.get("level", 0) or 0)
        locked = bool(building.get("locked", False))

        if locked:
            building["actions"] = ["Locked"]
            continue

        if level <= 0:
            building["actions"] = [get_build_action_text(building)]
            continue

        building["actions"] = BUILT_BUILDING_ACTIONS.get(
            building_id,
            ["Upgrade"]
        )

    return profile

def apply_building_unlocks(profile: dict):
    buildings = profile.setdefault("buildings", make_default_player_buildings())

    for building_id, building in buildings.items():
        if building_id == "main_lab":
            building["locked"] = False
            continue

        requirements = BUILDING_UNLOCK_RULES.get(building_id, {})

        if not requirements:
            continue

        building["locked"] = not is_building_requirement_met(profile, requirements)

    # sync level profile utama
    profile["lab_level"] = get_profile_building_level(profile, "main_lab")
    profile["scanner_level"] = get_profile_building_level(profile, "radar_tower")
    profile["scout_level"] = get_profile_building_level(profile, "radar_tower")
    profile["ai_core_level"] = get_profile_building_level(profile, "ai_core")
    profile = refresh_building_actions(profile)
    return profile

RADAR_ALLOWED_SIGNALS = {
    1: ["Weak"],
    2: ["Weak"],
    3: ["Weak", "Medium"],
    4: ["Weak", "Medium"],
    5: ["Weak", "Medium"],
    6: ["Weak", "Medium", "Strong"],
    7: ["Weak", "Medium", "Strong"],
    8: ["Weak", "Medium", "Strong"],
    9: ["Weak", "Medium", "Strong"],
    10: ["Weak", "Medium", "Strong"],
}


def get_allowed_signals_for_radar(radar_level: int):
    radar_level = int(radar_level or 0)

    if radar_level <= 0:
        return []

    if radar_level >= 10:
        return RADAR_ALLOWED_SIGNALS[10]

    return RADAR_ALLOWED_SIGNALS.get(radar_level, ["Weak"])

RADAR_ALLOWED_TIERS = {
    1: ["Low"],
    2: ["Low"],
    3: ["Low", "Standard"],
    4: ["Low", "Standard"],
    5: ["Low", "Standard", "Advanced"],
    6: ["Low", "Standard", "Advanced"],
    7: ["Low", "Standard", "Advanced"],
    8: ["Low", "Standard", "Advanced", "Elite"],
    9: ["Low", "Standard", "Advanced", "Elite"],
    10: ["Low", "Standard", "Advanced", "Elite"],
}


def get_allowed_tiers_for_radar(radar_level: int):
    radar_level = int(radar_level or 0)

    if radar_level <= 0:
        return []

    if radar_level >= 10:
        return RADAR_ALLOWED_TIERS[10]

    return RADAR_ALLOWED_TIERS.get(radar_level, ["Low"])

def get_radar_scan_rule(radar_level: int):
    radar_level = int(radar_level or 0)

    if radar_level <= 0:
        return {
            "radius": 0,
            "total_limit": 0,
            "enemy_limit": 0,
            "mining_limit": 0,
            "max_npc_level": 0,
            "max_mining_level": 0,
            "allowed_tiers": [],
            "allowed_signals": [],
        }

    return {
        "radius": 40 + (radar_level * 12),

        # Radar Lv.1 hanya 1 hasil non-player.
        # Semakin tinggi radar, jumlah hasil bertambah.
        "total_limit": min(10, radar_level),

        # Field lama agar frontend lama tidak rusak.
        "enemy_limit": min(10, radar_level),
        "mining_limit": min(10, radar_level),

        # Radar Lv.5 berarti boleh Lv.1 sampai Lv.5.
        "max_npc_level": radar_level,
        "max_mining_level": radar_level,

        # Filter tier dan signal.
        "allowed_tiers": get_allowed_tiers_for_radar(radar_level),
        "allowed_signals": get_allowed_signals_for_radar(radar_level),
    }

def make_default_player_buildings():
    return {
        "main_lab": {
            "id": "main_lab",
            "name": "Main Lab",
            "level": 0,
            "locked": False,
            "asset": "assets/base.webp",
            "description": "Pusat base. Bangun Main Lab untuk membuka bangunan awal.",
            "actions": ["Build Main Lab"],
        },
        "unit_factory": {
            "id": "unit_factory",
            "name": "Unit Factory",
            "level": 0,
            "locked": True,
            "asset": "assets/unit_factory.webp",
            "description": "Tempat melatih pasukan. Terbuka setelah Main Lab Lv.1.",
            "actions": ["Build Unit Factory"],
        },
        "radar_tower": {
            "id": "radar_tower",
            "name": "Radar Tower",
            "level": 0,
            "locked": True,
            "asset": "assets/radar.webp",
            "description": "Untuk scan monster, mining, dan target di sekitar base. Terbuka setelah Unit Factory Lv.1.",
            "actions": ["Build Radar Tower"],
        },
        "recovery_center": {
            "id": "recovery_center",
            "name": "Recovery Center",
            "level": 0,
            "locked": True,
            "asset": "assets/recovery_center.webp",
            "description": "Memulihkan unit disabled setelah battle. Terbuka setelah Main Lab Lv.2.",
            "actions": ["Build Recovery Center"],
        },
        "research_lab": {
            "id": "research_lab",
            "name": "Research Lab",
            "level": 0,
            "locked": True,
            "asset": "assets/research_lab.webp",
            "description": "Riset teknologi base, unit, radar, dan AI. Terbuka setelah Main Lab Lv.2.",
            "actions": ["Build Research Lab"],
        },
        "ai_core": {
            "id": "ai_core",
            "name": "AI Core",
            "level": 0,
            "locked": True,
            "asset": "assets/ai_core.webp",
            "description": "Mengatur AI Agent. Terbuka setelah Main Lab Lv.3.",
            "actions": ["Build AI Core"],
        },
        "guild_gate": {
            "id": "guild_gate",
            "name": "Guild Gate",
            "level": 0,
            "locked": True,
            "asset": "assets/guild_gate.webp",
            "description": "Membuka guild, rally, guild war, dan territory. Terbuka setelah Main Lab Lv.5.",
            "actions": ["Locked"],
        },
    }

def ensure_player_profile_schema(profile: dict):
    if "resources" not in profile or not isinstance(profile["resources"], dict):
        profile["resources"] = {}

    profile["resources"].setdefault("credits", 2500)
    profile["resources"].setdefault("data_shard", 0)
    profile["resources"].setdefault("nano_parts", 1200)
    profile["resources"].setdefault("nexus_core", 0)

    profile.setdefault("energy", 80)
    profile.setdefault("trace", 0)

    profile.setdefault("lab_level", 0)
    profile.setdefault("scanner_level", 0)
    profile.setdefault("scout_level", 0)
    profile.setdefault("ai_core_level", 0)
    profile.setdefault("active_operations", [])

    if "buildings" not in profile or not isinstance(profile["buildings"], dict):
        profile["buildings"] = make_default_player_buildings()

    profile.setdefault("owned_ai", ["nova_lite"])
    profile.setdefault("active_ai", [])

    if "unit_inventory" not in profile or not isinstance(profile["unit_inventory"], dict):
        profile["unit_inventory"] = {
            "breaker": 0,
            "ghost": 0,
            "probe": 0,
            "payload": 0,
            "relay": 0,
            "extractor": 0,
        }

    default_research = make_default_player_research()

    if "research" not in profile or not isinstance(profile["research"], dict):
        profile["research"] = copy.deepcopy(default_research)

    if "core" not in profile["research"] or not isinstance(profile["research"]["core"], dict):
        profile["research"]["core"] = copy.deepcopy(default_research["core"])

    if "unit_tech" not in profile["research"] or not isinstance(profile["research"]["unit_tech"], dict):
        profile["research"]["unit_tech"] = copy.deepcopy(default_research["unit_tech"])

    for research_id, level in default_research["core"].items():
        profile["research"]["core"].setdefault(research_id, level)
        # Migration: Attack Routing diganti menjadi Scout Drone.
        profile["research"]["core"].pop("attack_routing", None)

    for unit_id, level in default_research["unit_tech"].items():
        profile["research"]["unit_tech"].setdefault(unit_id, level)

        profile.setdefault("language", "id")

    profile.setdefault(
        "commander_name",
        profile.get("name")
        or profile.get("username")
        or profile.get("first_name")
        or "Commander"
    )

    profile.setdefault("onboarding_complete", False)
    profile.setdefault("registered_at", int(time.time()))
    profile.setdefault("referral_by", None)
    profile.setdefault("referral_code", f"CC{str(profile.get('telegram_id') or profile.get('player_id') or '000000')[-6:]}")
    profile = ensure_profile_ai_system(profile)
    profile = apply_building_unlocks(profile)

    return profile

def get_profile_research_level(profile: dict, research_id: str) -> int:
    profile = ensure_player_profile_schema(profile)
    return int(profile.get("research", {}).get("core", {}).get(research_id, 0))


def get_profile_research_next_cost(research: dict):
    next_level = int(research.get("level", 0)) + 1

    return {
        "credits": int(research.get("base_credits", 1000)) * next_level,
        "energy": int(research.get("base_energy", 0)) * next_level,
    }


def get_research_with_costs_for_profile(profile: dict):
    profile = ensure_player_profile_schema(profile)

    result = {}
    core_levels = profile["research"]["core"]

    for research_id, template in GAME_STATE.get("research", {}).items():
        item = copy.deepcopy(template)

        item["level"] = int(core_levels.get(research_id, item.get("level", 0)))

        if item["level"] >= item["max_level"]:
            item["next_cost"] = None
            item["maxed"] = True
        else:
            item["next_cost"] = get_profile_research_next_cost(item)
            item["maxed"] = False

        result[research_id] = item

    return result


def get_energy_regen_per_minute_for_profile(profile: dict) -> int:
    return 1 + get_profile_research_level(profile, "energy_generation")


def get_max_deploy_units_for_profile(profile: dict) -> int:
    return 100 + (get_profile_research_level(profile, "unit_capacity") * 10)


def get_unit_tech_cost_for_profile(profile: dict, unit_id: str):
    profile = ensure_profile_unit_system(profile)

    current = int(profile["unit_tech"].get(unit_id, 1))
    next_level = current + 1

    return {
        "credits": 1000 * next_level,
        "energy": 4 * next_level,
    }


def get_unit_tech_list_for_profile(profile: dict):
    profile = ensure_profile_unit_system(profile)

    result = []

    for unit_id, unit in UNITS.items():
        current = int(profile["unit_tech"].get(unit_id, 1))
        max_level = int(unit.get("max_level", 5))
        next_level = current + 1

        maxed = current >= max_level

        result.append({
            "unit_id": unit_id,
            "name": unit["name"],
            "current_level": current,
            "next_level": next_level if not maxed else None,
            "max_level": max_level,
            "maxed": maxed,
            "next_cost": None if maxed else get_unit_tech_cost_for_profile(profile, unit_id),
            "effect": f"Unlock {unit['name']} higher level training and promote path.",
        })

    return result

def generate_targets(
    max_level: int = 1,
    allowed_tiers: list[str] | None = None,
    allowed_signals: list[str] | None = None,
):
    p = GAME_STATE["player"]
    max_level = max(1, int(max_level or 1))
    allowed_tiers = allowed_tiers or ["Low"]
    allowed_signals = allowed_signals or ["Weak"]

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
        max_level = max(1, int(max_level or 1))
        enemy_level = random.randint(1, max_level)
        defense_power = 800 + (enemy_level * 180) + random.randint(0, 350)
        

        signal_strength = random.choice(allowed_signals)

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
            "lab_tier": random.choice(allowed_tiers),
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

        npc_defense_stats = calculate_npc_defense_stats(
            enemy_army=enemy_army,
            enemy_build=enemy_build,
            target_level=enemy_level,
            target_type=signal_strength,
        )

        # Pasukan penjaga NPC
        target["enemy_army"] = enemy_army["units"]
        target["enemy_army_power"] = npc_defense_stats["npc_guard_power"]

        # Build/module pertahanan NPC
        target["enemy_build"] = enemy_build
        target["defense_modules"] = enemy_build["modules"]

        # defense_style tetap boleh ada untuk tampilan/scout,
        # tapi jangan dipakai sebagai battle stat.
        target["defense_style"] = enemy_build.get("defense_style", "Unknown")

        target["weakness_hint"] = enemy_build["weakness_hint"]
        target["counter_risk"] = enemy_build["counter_risk"]

        # Defense resmi NPC
        target["defense_stats"] = npc_defense_stats
        target["defense_power"] = npc_defense_stats["defense_power"]
        target["estimated_power"] = npc_defense_stats["defense_power"]

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

def generate_mining_nodes(
    enemy_targets=None,
    max_level: int = 1,
    allowed_signals: list[str] | None = None,
):
    p = GAME_STATE["player"]
    scan_counter = GAME_STATE.get("scan_counter", 0)

    enemy_targets = enemy_targets or []
    max_level = max(1, int(max_level or 1))

    nodes = []

    MIN_DISTANCE_FROM_ENEMY = 26
    MIN_DISTANCE_FROM_MINING = 18

    # Hitung kuota Nexus Core global
    active_nexus_cores = sum(
        1 for n in GAME_STATE.get("mining_nodes", {}).values() 
        if n.get("resource_id") == "nexus_core"
    )

    available_resources = [r for r in MINING_RESOURCES if r["id"] != "nexus_core"]

    if max_level >= 7 and active_nexus_cores < 10:
        if random.random() < 0.80:
            available_resources = MINING_RESOURCES

    if not available_resources:
        available_resources = MINING_RESOURCES

    for i in range(random.randint(2, 4)):
        weights = [r["weight"] for r in available_resources]
        res = random.choices(available_resources, weights=weights, k=1)[0]

        chosen_point = None

        # Logika pencarian koordinat bebas tabrakan
        for attempt in range(60):
            dx = random.randint(-55, 55)
            dy = random.randint(-55, 55)

            if abs(dx) < 12:
                dx += random.choice([-18, 18])

            if abs(dy) < 12:
                dy += random.choice([-18, 18])

            x = p["x"] + dx
            y = p["y"] + dy

            point = {"x": x, "y": y}

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

        # Penentuan Level dan Signal absolut
        if res["id"] == "nexus_core":
            guardian_level = random.randint(7, max_level)
            signal_strength = "Strong"
        else:
            guardian_level = random.randint(1, max_level)
            if guardian_level <= 3:
                signal_strength = "Weak"
            elif guardian_level <= 6:
                signal_strength = "Medium"
            else:
                signal_strength = "Strong"

        guardian_power = 500 + (guardian_level * 180) + random.randint(0, 300)
        
        if signal_strength == "Strong":
            guardian_power = int(guardian_power * 1.5)

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
            
            # State untuk Lazy Evaluation
            "owner": None,
            "occupied_at": None,
            "status": "Unoccupied",
            
            "signal_strength": signal_strength,
            "asset": res["asset"],
        })

    return nodes

def process_mining_tick(node_id: str, current_time: float) -> int:
    """Menghitung hasil tambang pasif (Lazy Evaluation)."""
    node = GAME_STATE.get("mining_nodes", {}).get(node_id)
    if not node or node.get("status") != "Occupied" or not node.get("owner"):
        return 0

    occupied_at = node.get("occupied_at", current_time)
    elapsed_minutes = (current_time - occupied_at) / 60.0

    if elapsed_minutes <= 0:
        return 0

    mined_amount = int(elapsed_minutes * node.get("production_per_minute", 0))
    mined_amount = min(mined_amount, node.get("capacity", 0))

    if mined_amount > 0:
        node["capacity"] -= mined_amount
        node["occupied_at"] = current_time
        
        if node["capacity"] <= 0:
            node["status"] = "Depleted"
            
    return mined_amount

def process_mining_tick(node_id: str, current_time: float):
    """
    Fungsi ringan (tanpa database write) untuk menghitung hasil tambang.
    Panggil ini TEPAT SEBELUM battle PvP terjadi di titik tambang.
    """
    node = GAME_STATE.get("mining_nodes", {}).get(node_id)
    if not node or node["status"] != "Occupied" or not node["owner"]:
        return 0

    occupied_at = node.get("occupied_at", current_time)
    elapsed_minutes = (current_time - occupied_at) / 60.0

    if elapsed_minutes <= 0:
        return 0

    # Hitung resource yang berhasil digali
    mined_amount = int(elapsed_minutes * node["production_per_minute"])
    
    # Pastikan tidak melebihi sisa kapasitas tambang
    mined_amount = min(mined_amount, node["capacity"])

    # Potong kapasitas tambang dan perbarui waktu
    node["capacity"] -= mined_amount
    node["occupied_at"] = current_time # Reset timer untuk sesi (atau penyerang) berikutnya
    
    if node["capacity"] <= 0:
        node["status"] = "Depleted"

    # Masukkan loot sementara ke cargo milik owner (Pemain A)
    # Ini memastikan jika Pemain A kalah, dia pulang membawa mined_amount ini.
    # Logic penambahan ke inventory diproses saat fase "Return".
    
    return mined_amount

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

def get_npc_module_power(modules: list[str], target_level: int, target_type: str):
    module_stats = get_defense_module_score(modules)

    base_module_power = int(module_stats.get("module_score", 0))

    target_level = max(1, int(target_level or 1))
    level_scale = 1 + ((target_level - 1) * 0.08)

    threat_scale = threat_multiplier(target_type)

    return int(base_module_power * level_scale * threat_scale)


def calculate_npc_defense_stats(enemy_army: dict, enemy_build: dict, target_level: int, target_type: str):
    guard_power = int(enemy_army.get("total_power", 0) or 0)

    modules = enemy_build.get("modules", [])
    module_power = get_npc_module_power(modules, target_level, target_type)

    total_defense_power = guard_power + module_power

    return {
        "defense_power": int(total_defense_power),

        "npc_guard_power": int(guard_power),
        "npc_module_power": int(module_power),

        "module_count": len(modules),
        "modules": modules,

        # NPC tidak punya AI Guard.
        "ai_power": 0,
        "base_guard_ai_power": 0,

        # Ini khusus scout, bukan battle.
        "anti_scout_score": 0,
    }

def make_enemy_build(target_level: int, target_type: str):
    build = random.choice(ENEMY_BUILD_ARCHETYPES)

    return {
        "id": build["id"],
        "name": build["name"],

        # Ini hanya label/tampilan/scout, bukan battle stat langsung.
        "defense_style": build["defense_style"],

        "modules": build["modules"],
        "weakness_hint": build["weakness_hint"],
        "counter_risk": build["counter_risk"],
    }

def get_enemy_asset_by_level(level: int, signal_strength: str):
    signal = str(signal_strength).lower()

    if level >= 10:
        return "assets/enemies/enemy_boss.webp"

    if "strong" in signal:
        return "assets/enemies/enemy_strong.webp"

    if "medium" in signal:
        return "assets/enemies/enemy_medium.webp"

    return "assets/enemies/enemy_weak.webp"


generate_targets()


# ==========================================================
# API models
# ==========================================================
class RecoverUnitRequest(BaseModel):
    unit_id: str
    level: int = Field(ge=1)
    amount: int = Field(ge=1)

class DefenseSetupRequest(BaseModel):
    defense_style: str = Field(default="Balanced Defense", max_length=40)
    modules: List[str] = Field(default_factory=list, max_length=6)

class SetActiveAiRequest(BaseModel):
    active_ai: List[str] = Field(default_factory=list, max_length=6)

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

    # format dari frontend:
    # {
    #   "breaker": {
    #     "1": 10,
    #     "2": 5
    #   }
    # }
    units: Dict[str, Dict[str, int]]

def get_attack_module_config(module_id: str):
    for module in ATTACK_MODULES:
        if module["id"] == module_id:
            return module

    return None


def get_attack_module_bonus(module_ids: list[str]):
    bonus = {
        "attack_flat": 0,
        "attack_percent": 0,
        "loss_reduction": 0,
        "trace_reduction": 0,
        "travel_reduction": 0,
        "loot_bonus": 0,
    }

    for module_id in module_ids:
        if module_id == "firewall_crusher":
            bonus["attack_percent"] += 10

        elif module_id == "core_breaker":
            bonus["attack_flat"] += 350

        elif module_id == "payload_booster":
            bonus["attack_percent"] += 8

        elif module_id == "exploit_chain_script":
            bonus["attack_flat"] += 220

        elif module_id == "ghost_proxy":
            bonus["trace_reduction"] += 4

        elif module_id == "silent_injector":
            bonus["trace_reduction"] += 3
            bonus["loss_reduction"] += 2

        elif module_id == "trace_masker":
            bonus["trace_reduction"] += 6

        elif module_id == "escape_script":
            bonus["loss_reduction"] += 6

        elif module_id == "signal_accelerator":
            bonus["travel_reduction"] += 12

        elif module_id == "data_extractor":
            bonus["loot_bonus"] += 10

        elif module_id == "anti_jammer_chip":
            # untuk attack, ini bukan anti scout.
            # efeknya kecil: stabilisasi route.
            bonus["travel_reduction"] += 5

        elif module_id == "trap_detector":
            bonus["loss_reduction"] += 4

        elif module_id == "fake_signal_filter":
            bonus["loss_reduction"] += 3

    return bonus

def ensure_recovery_system(profile: dict):
    profile.setdefault("disabled_units", {})

    for unit_id in UNITS.keys():
        profile["disabled_units"].setdefault(unit_id, {})

        max_level = int(UNITS[unit_id].get("max_level", 5))

        for level in range(1, max_level + 1):
            profile["disabled_units"][unit_id].setdefault(str(level), 0)

    return profile


def add_disabled_units_to_recovery(profile: dict, disabled_units: dict):
    profile = ensure_recovery_system(profile)

    for unit_id, level_map in disabled_units.items():
        if unit_id not in UNITS:
            continue

        profile["disabled_units"].setdefault(unit_id, {})

        for level_text, amount in level_map.items():
            amount = int(amount or 0)

            if amount <= 0:
                continue

            level_text = str(level_text)
            current = int(profile["disabled_units"][unit_id].get(level_text, 0))
            profile["disabled_units"][unit_id][level_text] = current + amount

    return profile


def get_recovery_center_level(profile: dict):
    buildings = profile.get("buildings", {})
    recovery = buildings.get("recovery_center", {})

    return max(1, int(recovery.get("level", 1) or 1))


def get_recovery_cost(profile: dict, unit_id: str, level: int, amount: int):
    unit = UNITS.get(unit_id)

    if not unit:
        raise HTTPException(status_code=400, detail=f"Unknown unit: {unit_id}")

    level = int(level)
    amount = int(amount)

    level_data = unit.get("levels", {}).get(level, {})
    train_cost = level_data.get("train_cost", {})

    recovery_level = get_recovery_center_level(profile)

    # Recovery lebih murah dari train.
    # Semakin tinggi Recovery Center, semakin murah.
    discount = max(0.55, 1 - ((recovery_level - 1) * 0.05))

    base_nano = int(train_cost.get("nano_parts", 0) or (30 * level))
    base_credits = int(train_cost.get("credits", 0) or (20 * level))

    nano_parts = int(base_nano * 0.40 * amount * discount)
    credits = int(base_credits * 0.30 * amount * discount)

    # Energy dibuat ringan supaya recovery tetap terasa aktif.
    energy = max(1, math.ceil(amount / max(4, 8 + recovery_level)))

    return {
        "credits": max(0, credits),
        "nano_parts": max(1, nano_parts),
        "energy": max(1, energy),
    }


def build_recovery_items(profile: dict):
    profile = ensure_profile_unit_system(profile)
    profile = ensure_recovery_system(profile)

    items = []

    for unit_id, level_map in profile.get("disabled_units", {}).items():
        unit = UNITS.get(unit_id)

        if not unit:
            continue

        for level_text, disabled_count in level_map.items():
            disabled_count = int(disabled_count or 0)

            if disabled_count <= 0:
                continue

            level = int(level_text)
            ready_owned = int(
                profile
                .get("unit_inventory", {})
                .get(unit_id, {})
                .get(level_text, 0)
            )

            items.append({
                "unit_id": unit_id,
                "name": unit.get("name", unit_id),
                "level": level,
                "disabled": disabled_count,
                "owned": ready_owned,
                "cost_one": get_recovery_cost(profile, unit_id, level, 1),
                "cost_all": get_recovery_cost(profile, unit_id, level, disabled_count),
            })

    return items

def remove_deployed_units_from_inventory(profile: dict, selected_units: dict):
    """
    Mengunci unit yang dikirim attack.
    Unit keluar dari inventory siap tempur saat pasukan berangkat.
    Nanti surviving unit dikembalikan saat fase return selesai.
    """
    profile = ensure_profile_unit_system(profile)

    for unit_id, levels in selected_units.items():
        if unit_id not in UNITS:
            raise HTTPException(status_code=400, detail=f"Unknown unit: {unit_id}")

        if not isinstance(levels, dict):
            raise HTTPException(status_code=400, detail=f"Invalid unit payload: {unit_id}")

        profile["unit_inventory"].setdefault(unit_id, {})

        for level_text, amount in levels.items():
            amount = int(amount or 0)

            if amount <= 0:
                continue

            level_text = str(level_text)
            owned = int(profile["unit_inventory"][unit_id].get(level_text, 0))

            if owned < amount:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unit tidak cukup untuk deploy: {unit_id} Lv.{level_text}. Punya {owned}, butuh {amount}"
                )

            profile["unit_inventory"][unit_id][level_text] = owned - amount

    return profile

def calculate_deployed_unit_outcome(selected_units: dict, loss_rate: float):
    """
    Menghitung hasil unit yang SUDAH dideploy.
    Jangan mengurangi unit_inventory di sini,
    karena unit sudah keluar dari inventory saat /api/attack start.
    """
    destroyed = {}
    disabled = {}
    surviving = {}

    for unit_id, levels in selected_units.items():
        destroyed[unit_id] = {}
        disabled[unit_id] = {}
        surviving[unit_id] = {}

        if unit_id not in UNITS:
            continue

        for level_text, amount in levels.items():
            amount = int(amount or 0)

            if amount <= 0:
                continue

            level_text = str(level_text)

            lost = int(amount * loss_rate)
            lost = max(0, min(amount, lost))

            dis = int(lost * 0.35)
            des = lost - dis
            survive = amount - lost

            destroyed[unit_id][level_text] = des
            disabled[unit_id][level_text] = dis
            surviving[unit_id][level_text] = survive

    return destroyed, disabled, surviving

def add_units_to_inventory(profile: dict, units_to_add: dict):
    """
    Mengembalikan surviving units ke inventory siap tempur.
    Dipakai saat pasukan sudah pulang ke base.
    """
    profile = ensure_profile_unit_system(profile)

    for unit_id, levels in units_to_add.items():
        if unit_id not in UNITS:
            continue

        if not isinstance(levels, dict):
            continue

        profile["unit_inventory"].setdefault(unit_id, {})

        for level_text, amount in levels.items():
            amount = int(amount or 0)

            if amount <= 0:
                continue

            level_text = str(level_text)
            current = int(profile["unit_inventory"][unit_id].get(level_text, 0))
            profile["unit_inventory"][unit_id][level_text] = current + amount

    return profile

def calculate_attack_unit_power(profile: dict, selected_units: dict):
    profile = ensure_profile_unit_system(profile)

    total_power = 0
    total_units = 0
    lines = []

    for unit_id, levels in selected_units.items():
        if unit_id not in UNITS:
            raise HTTPException(status_code=400, detail=f"Unknown unit: {unit_id}")

        if not isinstance(levels, dict):
            raise HTTPException(status_code=400, detail=f"Invalid unit payload: {unit_id}")

        inventory = profile["unit_inventory"].get(unit_id, {})

        for level_text, amount in levels.items():
            amount = int(amount or 0)

            if amount <= 0:
                continue

            level_text = str(level_text)
            owned = int(inventory.get(level_text, 0))

            if owned < amount:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unit tidak cukup: {unit_id} Lv.{level_text}. Punya {owned}, butuh {amount}"
                )

            level = int(level_text)
            stats = get_unit_stats(unit_id, level)

            unit_score = int(
                (stats["hp"] * 0.06)
                + (stats["attack"] * 2.1)
                + (stats["defense"] * 0.65)
                + (stats["speed"] * 7)
                + (stats["cargo"] * 3)
            )

            subtotal = unit_score * amount

            total_power += subtotal
            total_units += amount

            lines.append(
                f"- {UNITS[unit_id]['name']} Lv.{level}: {amount} × {unit_score} = {subtotal}"
            )

    if total_units <= 0:
        raise HTTPException(status_code=400, detail="Tidak ada unit yang dikirim")

    return {
        "attack_unit_power": int(total_power),
        "total_units": int(total_units),
        "lines": lines,
    }


def apply_unit_losses(profile: dict, selected_units: dict, loss_rate: float):
    profile = ensure_profile_unit_system(profile)

    destroyed = {}
    disabled = {}

    for unit_id, levels in selected_units.items():
        destroyed[unit_id] = {}
        disabled[unit_id] = {}

        for level_text, amount in levels.items():
            amount = int(amount or 0)

            if amount <= 0:
                continue

            level_text = str(level_text)

            lost = int(amount * loss_rate)
            lost = max(0, min(amount, lost))

            dis = int(lost * 0.35)
            des = lost - dis

            owned = int(profile["unit_inventory"][unit_id].get(level_text, 0))
            profile["unit_inventory"][unit_id][level_text] = max(0, owned - lost)

            destroyed[unit_id][level_text] = des
            disabled[unit_id][level_text] = dis
            profile = add_disabled_units_to_recovery(profile, disabled)

    return destroyed, disabled


def get_attack_research_bonus(profile: dict):
    network_speed = get_profile_research_level(profile, "network_speed")
    ai_sync = get_profile_research_level(profile, "ai_sync")

    return {
        "network_speed": int(network_speed),
        "ai_sync": int(ai_sync),
        "attack_percent": int(ai_sync) * 2,
        "travel_reduction": int(network_speed) * 3,
    }


def get_attack_ai_bonus(profile: dict, ai_ids: list[str]):
    profile = ensure_profile_ai_system(profile)

    bonus = {
        "attack_percent": 0,
        "loss_reduction": 0,
        "trace_delta": 0,
        "travel_reduction": 0,
    }

    for ai_id in ai_ids:
        if ai_id not in AI_AGENTS:
            raise HTTPException(status_code=404, detail=f"AI tidak ditemukan: {ai_id}")

        if ai_id not in profile["owned_ai"]:
            raise HTTPException(status_code=403, detail=f"AI belum dimiliki: {ai_id}")

        ai = AI_AGENTS[ai_id]
        buffs = ai.get("buffs", {})

        bonus["attack_percent"] += int(buffs.get("Firewall Crusher Effectiveness", 0))
        bonus["attack_percent"] += int(buffs.get("Burst Execution", 0))
        bonus["attack_percent"] += int(buffs.get("Critical Breach Chance", 0))

        bonus["loss_reduction"] += max(0, int(buffs.get("Failed Attack Recovery", 0)))
        bonus["loss_reduction"] += max(0, int(buffs.get("Unit Recovery Speed", 0)) // 3)

        bonus["trace_delta"] += int(buffs.get("Trace Exposure", 0))
        bonus["travel_reduction"] += abs(min(0, int(buffs.get("Travel Coordination Penalty", 0))))

    return bonus


def get_target_defender_profile(target: dict):
    if target.get("kind") != "player":
        return None

    defender_player_id = target.get("player_id")
    return GAME_STATE.get("players", {}).get(defender_player_id)

def ensure_profile_ai_system(profile: dict):
    if "owned_ai" not in profile or not isinstance(profile["owned_ai"], list):
        profile["owned_ai"] = ["nova_lite"]

    if "nova_lite" not in profile["owned_ai"]:
        profile["owned_ai"].insert(0, "nova_lite")

    profile["owned_ai"] = [
        ai_id for ai_id in profile["owned_ai"]
        if ai_id in AI_AGENTS
    ]

    if "active_ai" not in profile or not isinstance(profile["active_ai"], list):
        profile["active_ai"] = []

    profile["active_ai"] = [
        ai_id for ai_id in profile["active_ai"]
        if ai_id in profile["owned_ai"] and ai_id in AI_AGENTS
    ]

    profile.setdefault("ai_core_level", 1)

    return profile


def get_ai_slot_limit_for_profile(profile: dict):
    profile = ensure_profile_ai_system(profile)

    buildings = profile.get("buildings", {})
    ai_core = buildings.get("ai_core", {})

    return max(
        1,
        int(profile.get("ai_core_level", 1)),
        int(ai_core.get("level", 1)),
    )


def get_ai_agents_for_profile(profile: dict):
    profile = ensure_profile_ai_system(profile)

    return {
        ai_id: AI_AGENTS[ai_id]
        for ai_id in profile["owned_ai"]
        if ai_id in AI_AGENTS
    }

def get_unit_config(unit_id: str) -> Dict[str, Any]:
    return UNITS.get(unit_id)


def get_unit_power(unit_id: str, level: int) -> int:
    unit = get_unit_config(unit_id)
    return int(unit["base_power"] + ((level - 1) * unit["power_growth"]))


def get_unit_train_cost(unit_id: str, level: int):
    stats = get_unit_stats(unit_id, level)
    return stats.get("train_cost", {"credits": 100, "nano_parts": 10})

def get_unit_factory_training_multiplier(profile: dict):
    """
    Bonus dari level Unit Factory.
    Lv.1 = x1.00
    Lv.2 = x1.05
    Lv.3 = x1.10
    Lv.4 = x1.15
    Lv.5 = x1.20
    """
    factory_level = get_profile_building_level(profile, "unit_factory")

    if factory_level <= 0:
        return 0

    bonus_steps = max(0, factory_level - 1)

    return 1 + (bonus_steps * UNIT_FACTORY_TRAIN_BONUS_PER_LEVEL)


def get_unit_train_batch_limit(profile: dict, unit_id: str, unit_level: int):
    """
    Batas train per batch.
    Total owned unit tidak dibatasi.

    Base limit ditentukan oleh level pasukan.
    Unit Factory level menaikkan base limit dengan multiplier.
    """
    factory_level = get_profile_building_level(profile, "unit_factory")

    if factory_level <= 0:
        return 0

    unit_level = int(unit_level or 1)

    base_limit = UNIT_TRAIN_BATCH_BASE_BY_LEVEL.get(unit_level, 10)
    multiplier = get_unit_factory_training_multiplier(profile)

    return max(1, int(math.ceil(base_limit * multiplier)))


def get_unit_promote_cost(unit_id: str, from_level: int, amount: int) -> Dict[str, int]:
    next_level = from_level + 1
    train_cost = get_unit_train_cost(unit_id, next_level)

    return {
        "credits": int(train_cost["credits"] * 0.55 * amount),
        "energy": max(1, int(train_cost["energy"] * amount)),
    }

def make_default_player_research():
    return {
        "core": {
            "energy_generation": 0,
            "network_speed": 0,
            "scout_drone": 1,
            "scout_signal": 1,
            "unit_capacity": 0,
            "ai_sync": 0,
            
        },
        "unit_tech": {
            unit_id: 1
            for unit_id in UNITS.keys()
        },
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
    """
    Legacy wrapper untuk kode lama yang masih membaca GAME_STATE["player"].
    Logic unit utama tetap memakai get_units_for_profile().
    """
    p = GAME_STATE.get("player", {})

    legacy_profile = {
        "buildings": GAME_STATE.get("buildings", {}),
        "unit_inventory": p.get("unit_inventory", {}),
        "unit_tech": p.get("unit_tech", {}),
        "resources": p.get("resources", {}),
    }

    return get_units_for_profile(legacy_profile)

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

@app.get("/api/recovery")
async def get_recovery(request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_unit_system(profile)
    profile = ensure_recovery_system(profile)

    items = build_recovery_items(profile)

    return {
        "player_id": player_id,
        "recovery_center_level": get_recovery_center_level(profile),
        "resources": profile.get("resources", {}),
        "energy": int(profile.get("energy", 0)),
        "items": items,
        "total_disabled": sum(int(item["disabled"]) for item in items),
    }


@app.post("/api/recovery/recover")
async def recover_unit(req: RecoverUnitRequest, request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_unit_system(profile)
    profile = ensure_recovery_system(profile)

    unit_id = str(req.unit_id).strip()
    level = int(req.level)
    amount = int(req.amount)

    if unit_id not in UNITS:
        raise HTTPException(status_code=400, detail=f"Unknown unit: {unit_id}")

    level_text = str(level)

    disabled_available = int(
        profile
        .get("disabled_units", {})
        .get(unit_id, {})
        .get(level_text, 0)
    )

    if disabled_available <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Tidak ada unit disabled: {unit_id} Lv.{level}"
        )

    if amount > disabled_available:
        raise HTTPException(
            status_code=400,
            detail=f"Jumlah recover melebihi disabled unit. Ada {disabled_available}, diminta {amount}"
        )

    cost = get_recovery_cost(profile, unit_id, level, amount)

    resources = profile.get("resources", {})

    if int(resources.get("credits", 0)) < cost["credits"]:
        raise HTTPException(
            status_code=400,
            detail=f"Credits tidak cukup. Butuh {cost['credits']}"
        )

    if int(resources.get("nano_parts", 0)) < cost["nano_parts"]:
        raise HTTPException(
            status_code=400,
            detail=f"Nano Parts tidak cukup. Butuh {cost['nano_parts']}"
        )

    if int(profile.get("energy", 0)) < cost["energy"]:
        raise HTTPException(
            status_code=400,
            detail=f"Energy tidak cukup. Butuh {cost['energy']}"
        )

    resources["credits"] = int(resources.get("credits", 0)) - cost["credits"]
    resources["nano_parts"] = int(resources.get("nano_parts", 0)) - cost["nano_parts"]
    profile["energy"] = int(profile.get("energy", 0)) - cost["energy"]

    profile["resources"] = resources

    profile["disabled_units"][unit_id][level_text] = disabled_available - amount

    profile["unit_inventory"].setdefault(unit_id, {})
    current_ready = int(profile["unit_inventory"][unit_id].get(level_text, 0))
    profile["unit_inventory"][unit_id][level_text] = current_ready + amount

    GAME_STATE["players"][player_id] = profile
    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    unit_name = UNITS[unit_id].get("name", unit_id)

    return {
        "success": True,
        "message": f"Recovered {amount} {unit_name} Lv.{level}",
        "unit_id": unit_id,
        "level": level,
        "amount": amount,
        "cost": cost,
        "remaining_disabled": profile["disabled_units"][unit_id][level_text],
        "ready_owned": profile["unit_inventory"][unit_id][level_text],
        "resources": profile["resources"],
        "energy": profile["energy"],
    }

@app.get("/api/state")
async def state(request: Request):
    await sync_state_from_db()
    apply_energy_regen()

    base_player = GAME_STATE["player"]

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_unit_system(profile)
    profile = ensure_profile_ai_system(profile)

    resources = profile.get("resources", {})

    player_view = copy.deepcopy(base_player)

    # Identity
    player_view["id"] = player_id
    player_view["player_id"] = player_id
    player_view["telegram_id"] = profile.get("telegram_id", "")
    player_view["name"] = profile.get("name", player_id)
    player_view["username"] = profile.get("username", "")
    player_view["first_name"] = profile.get("first_name", "")
    player_view["language"] = profile.get("language", "id")
    player_view["commander_name"] = profile.get("commander_name", player_view["name"])
    player_view["onboarding_complete"] = profile.get("onboarding_complete", False)
    player_view["registered_at"] = profile.get("registered_at")
    player_view["referral_code"] = profile.get("referral_code")
    player_view["referral_by"] = profile.get("referral_by")

    # Core levels
    player_view["x"] = profile.get("x", 120)
    player_view["y"] = profile.get("y", 450)
    player_view["lab_level"] = profile.get("lab_level", 1)
    player_view["scanner_level"] = profile.get("scanner_level", 1)
    player_view["scout_level"] = profile.get("scout_level", 1)
    player_view["ai_core_level"] = profile.get("ai_core_level", 1)

    # Economy
    player_view["credits"] = resources.get("credits", 0)
    player_view["energy"] = profile.get("energy", 100)
    player_view["max_energy"] = profile.get("max_energy", 100)

    player_view["resources"] = {
        "data_shard": resources.get("data_shard", 0),
        "nano_parts": resources.get("nano_parts", 0),
        "nexus_core": resources.get("nexus_core", 0),
    }

    # Trace
    player_view["trace"] = profile.get("trace", 0)
    player_view["trace_exposure"] = profile.get("trace", 0)

    # Player owned systems
    player_view["owned_ai"] = profile.get("owned_ai", ["nova_lite"])
    player_view["active_ai"] = profile.get("active_ai", [])
    player_view["ai_core_level"] = get_ai_slot_limit_for_profile(profile)
    player_view["unit_inventory"] = profile.get("unit_inventory", {})
    player_view["unit_tech"] = profile.get("unit_tech", {})

    GAME_STATE["players"][player_id] = profile
    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)
    # === SISIPIKAN VARIABEL INI ===
    player_active_attacks = {
        op_id: op for op_id, op in GAME_STATE.get("active_attacks", {}).items()
        if op.get("player_id") == player_id
    }
    # ==============================
    return {
        "player": player_view,
        "resources": player_view["resources"],

        "ai_agents": get_ai_agents_for_profile(profile),
        "all_ai_catalog": AI_AGENTS,
        "attack_modules": ATTACK_MODULES,
        "units": get_units_for_profile(profile),
        "scout_unlocks": SCOUT_UNLOCKS,
        "active_ai_buffs": get_effective_ai_buffs(profile["active_ai"]),
        "max_deploy_units": get_max_deploy_units_for_profile(profile),
        "research": get_research_with_costs_for_profile(profile),
        "energy_regen_per_minute": get_energy_regen_per_minute_for_profile(profile),
        # === TAMBAHKAN KUNCI SINKRONISASI INI KE DALAM RETURN ===
        "active_attacks": player_active_attacks,
    }

def make_player_scan_targets(attacker_player_id: str):
    ensure_multiplayer_system()

    players = GAME_STATE.get("players", {})

    attacker = players.get(attacker_player_id)

    # Fallback supaya Vercel tidak return [] kalau attacker belum kebaca di memory
    if not attacker:
        attacker = {
            "x": GAME_STATE.get("player", {}).get("x", 120),
            "y": GAME_STATE.get("player", {}).get("y", 450),
        }

    targets = []

    for player_id, defender in players.items():
        if player_id == attacker_player_id:
            continue

        dx = int(defender.get("x", 120)) - int(attacker.get("x", 120))
        dy = int(defender.get("y", 450)) - int(attacker.get("y", 450))
        distance = int((dx ** 2 + dy ** 2) ** 0.5)

        defense_units = defender.get("defense_units", [])
        army_power = sum(int(u.get("power", 0)) for u in defense_units)

        build = defender.get("defense_build", {})
        modules = build.get("modules", [])

        target_id = f"player_{player_id}"

        targets.append({
            "id": target_id,
            "kind": "player",
            "player_id": player_id,

            "name": f"Player Base: {defender.get('name', player_id)}",
            "x": defender.get("x", 120),
            "y": defender.get("y", 450),
            "distance": max(1, distance),
            "type": "Player Base",
            "level": defender.get("lab_level", 1),
            "lab_level": defender.get("lab_level", 1),
            "lab_tier": "Player",
            "signal_strength": "Player",
            "vault_signal": "Player Vault",

            "enemy_army": defense_units,
            "enemy_army_power": army_power,

            "enemy_build": build,
            "defense_modules": modules,
            "defense_style": defender.get("defense_style", "Balanced Defense"),

            "defense_power": army_power,
            "estimated_power": army_power,

            "resources": defender.get("resources", {}),
            "asset": get_player_target_asset(),

            "jammer_level": defender.get("jammer_level", 1),
            "defense_ai_level": defender.get("defense_ai_level", 1),
            "trace_monitor_level": defender.get("trace_monitor_level", 1),
        })

    return targets

@app.get("/api/scan")
async def scan(request: Request):
    await sync_state_from_db()
    apply_energy_regen()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_unit_system(profile)
    profile = apply_building_unlocks(profile)

    radar_level = get_profile_building_level(profile, "radar_tower")
    scan_rule = get_radar_scan_rule(radar_level)

    scanner_level = radar_level
    radius = scan_rule["radius"]
    enemy_limit = scan_rule["enemy_limit"]
    mining_limit = scan_rule["mining_limit"]

    # Radar Lv.0 tidak boleh scan monster/mining.
    if radar_level <= 0:
        return {
            "scan_id": GAME_STATE.get("scan_counter", 0),
            "scanner_level": 0,
            "radar_level": 0,
            "radius": 0,
            "enemy_limit": 0,
            "mining_limit": 0,
            "targets": [],
            "enemy_count": 0,
            "player_count": 0,
            "mining_count": 0,
            "message": "Radar Tower belum dibangun.",
        }

    # Sync legacy GAME_STATE["player"] agar generate_targets()
    # tetap memakai posisi dan level radar player aktif.
    GAME_STATE.setdefault("player", {})
    GAME_STATE["player"]["player_id"] = player_id
    GAME_STATE["player"]["x"] = profile.get("x", 120)
    GAME_STATE["player"]["y"] = profile.get("y", 450)
    GAME_STATE["player"]["scanner_level"] = scanner_level
    GAME_STATE["player"]["scout_level"] = scanner_level

    GAME_STATE["players"][player_id] = profile
    GAME_STATE["scan_counter"] = GAME_STATE.get("scan_counter", 0) + 1

    fresh_targets = generate_targets(
        max_level=scan_rule["max_npc_level"],
        allowed_tiers=scan_rule["allowed_tiers"],
        allowed_signals=scan_rule["allowed_signals"],
    )
    player_targets = make_player_scan_targets(player_id)

    all_targets = fresh_targets + player_targets
    fresh_mining_nodes = generate_mining_nodes(
        fresh_targets,
        max_level=scan_rule["max_mining_level"],
        allowed_signals=scan_rule["allowed_signals"],
    )

    GAME_STATE["targets"] = {
        t["id"]: t for t in all_targets
    }

    # === JANGAN HAPUS TAMBANG YANG SEDANG DIKUASAI ===
    # 1. Selamatkan semua tambang yang sedang dijajah dari memori lama
    old_occupied_nodes = {
        n_id: node for n_id, node in GAME_STATE.get("mining_nodes", {}).items()
        if node.get("status") == "Occupied"
    }

    # 2. Buat daftar tambang baru hasil scan
    new_mining_dict = {n["id"]: n for n in fresh_mining_nodes}

    # 3. Gabungkan tambang baru dengan tambang lama yang sedang dijajah
    new_mining_dict.update(old_occupied_nodes)

    # 4. Simpan kembali ke Global State secara utuh
    GAME_STATE["mining_nodes"] = new_mining_dict
    # =================================================

    visible_players = []
    visible_npc = []
    visible_mining = []

    # NPC + Player Base
    for t in all_targets:
        if t.get("kind") == "enemy" and t.get("status") in ["depleted", "collapsed"]:
            continue

        if int(t.get("distance", 9999)) > radius:
            continue

        safe_target = {
            "id": t["id"],
            "kind": t.get("kind", "enemy"),
            "name": t["name"],
            "x": t["x"],
            "y": t["y"],
            "distance": t["distance"],
            "type": t.get("type", "Unknown"),
            "level": t.get("level", 1),
            "signal_strength": t.get("signal_strength", "Unknown"),
            "lab_tier": t.get("lab_tier", "Unknown"),
            "vault_signal": t.get("vault_signal", "Unknown"),
            "asset": t.get("asset"),
            "player_id": t.get("player_id"),
            "intel_status": "scout_required",
        }

        # Player Base tidak dibatasi level/tier/signal radar.
        # Dia juga tidak memakan slot scan NPC/mining.
        if t.get("kind") == "player":
            visible_players.append(safe_target)
            continue

        # NPC dibatasi oleh max_npc_level, allowed_tiers, dan allowed_signals.
        target_level = int(t.get("level", 1))
        target_tier = t.get("lab_tier", "Low")
        target_signal = t.get("signal_strength", "Weak")

        if target_level > scan_rule["max_npc_level"]:
            continue

        if target_tier not in scan_rule["allowed_tiers"]:
            continue

        if target_signal not in scan_rule["allowed_signals"]:
            continue

        visible_npc.append(safe_target)

    # Mining nodes
    for node in fresh_mining_nodes:
        if int(node.get("distance", 9999)) > radius:
            continue

        if int(node.get("level", 1)) > scan_rule["max_mining_level"]:
            continue

        node_signal = node.get("signal_strength", "Weak")

        if node_signal not in scan_rule["allowed_signals"]:
            continue

        visible_mining.append(node)

    # Acak masing-masing kategori dulu.
    random.shuffle(visible_npc)
    random.shuffle(visible_mining)

    limit = int(scan_rule["total_limit"])
    selected_non_player = []

    # Radar Lv.1:
    # pilih kategori dulu, bukan item.
    # Jadi peluang NPC dan Mining lebih adil.
    if limit == 1:
        available_categories = []

        if visible_npc:
            available_categories.append("npc")

        if visible_mining:
            available_categories.append("mining")

        if available_categories:
            picked_category = random.choice(available_categories)

            if picked_category == "npc":
                selected_non_player.append(visible_npc[0])

            if picked_category == "mining":
                selected_non_player.append(visible_mining[0])

    else:
        # Radar Lv.2+:
        # isi slot secara campuran antara NPC dan mining.
        while len(selected_non_player) < limit and (visible_npc or visible_mining):
            available_categories = []

            if visible_npc:
                available_categories.append("npc")

            if visible_mining:
                available_categories.append("mining")

            picked_category = random.choice(available_categories)

            if picked_category == "npc":
                selected_non_player.append(visible_npc.pop(0))

            if picked_category == "mining":
                selected_non_player.append(visible_mining.pop(0))

    # Player base muncul terpisah dan tidak memakan kuota scan.
    visible_players = sorted(
        visible_players,
        key=lambda t: int(t.get("distance", 9999))
    )

    visible = visible_players + selected_non_player

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)
    # === LOGIKA MEMUNCULKAN SEMUA TAMBANG PVP (OCCUPIED) ===
    # Ambil semua tambang yang sedang dijajah (baik milik sendiri maupun orang lain)
    all_occupied_nodes = [
        node for node in GAME_STATE.get("mining_nodes", {}).values()
        if node.get("status") == "Occupied"
    ]

    existing_ids = {t["id"] for t in visible} 
    
    for occ_node in all_occupied_nodes:
        # Hitung jarak asli dari akun yang sedang scan ke lokasi tambang
        dx = int(occ_node.get("x", 0)) - int(profile.get("x", 120))
        dy = int(occ_node.get("y", 0)) - int(profile.get("y", 450))
        real_dist = int((dx ** 2 + dy ** 2) ** 0.5)

        # Jika tambang masuk di area radar dan belum ada di list, PAKSA MUNCULKAN!
        if real_dist <= radius and occ_node["id"] not in existing_ids:
            # Buat salinan (copy) agar tidak merusak koordinat global
            display_node = dict(occ_node)
            display_node["distance"] = max(1, real_dist)
            visible.append(display_node)
    # =======================================================

    return {
        "scan_id": GAME_STATE["scan_counter"],
        "scanner_level": scanner_level,
        "radar_level": radar_level,
        "radius": radius,
        "total_limit": scan_rule["total_limit"],
        "max_npc_level": scan_rule["max_npc_level"],
        "max_mining_level": scan_rule["max_mining_level"],
        "allowed_tiers": scan_rule["allowed_tiers"],
        "allowed_signals": scan_rule["allowed_signals"],

        # field lama tetap dikirim supaya frontend lama tidak rusak
        "enemy_limit": scan_rule["enemy_limit"],
        "mining_limit": scan_rule["mining_limit"],

        "targets": visible,  # <-- Sekarang visible sudah berisi tambang milik Anda!
        "enemy_count": len([t for t in visible if t.get("kind") not in ["player", "mining"]]),
        "player_count": len([t for t in visible if t.get("kind") == "player"]),
        "mining_count": len([t for t in visible if t.get("kind") == "mining"]),
    }

def apply_scout_noise_mask(report: dict):
    noise = str(report.get("noise", "Low"))

    if noise == "Low":
        report["report_quality"] = "Clean Intel"
        return report

    if noise == "Medium":
        report["report_quality"] = "Partially Jammed"

        # Data sensitif mulai terganggu
        report["resources"] = {
            "credits": "??? Jammed",
            "data_shard": "??? Jammed",
            "nano_parts": "??? Jammed",
            "nexus_core": "??? Jammed",
        }

        report["defense_modules"] = [
            "??? Jammed",
            "Partial signal only",
        ]

        report["counter_risk"] = "??? Jammed by defender anti-scout"
        report["weakness_hint"] = "??? Need stronger Scout/ORA"
        return report

    if noise == "High":
        report["report_quality"] = "Severely Jammed"

        # Hampir semua data battle penting dikunci
        report["enemy_army"] = [
            {
                "name": "???",
                "level": "???",
                "count": "???",
                "role": "Signal jammed",
            }
        ]

        report["resources"] = {
            "credits": "??? Jammed",
            "data_shard": "??? Jammed",
            "nano_parts": "??? Jammed",
            "nexus_core": "??? Jammed",
        }

        report["enemy_build"] = "??? Jammed"
        report["defense_modules"] = ["??? Jammed"]
        report["defense_style"] = "??? Jammed"
        report["estimated_power"] = "??? Jammed"
        report["counter_risk"] = "??? Jammed"
        report["weakness_hint"] = "??? Jammed"
        report["build_clue"] = "??? Jammed"

        return report

    report["report_quality"] = "Unknown"
    return report

def build_scout_report(target_id: str, attacker_profile: dict):
    p = attacker_profile

    target = GAME_STATE.get("targets", {}).get(target_id) or GAME_STATE.get("mining_nodes", {}).get(target_id)

    if target.get("kind") == "mining":
        return {
            "target_id": target_id,
            "name": target.get("name", "Mining Node"),
            "distance": target.get("distance", "Unknown"),
            "type": "Mining Node",
            "report_quality": "Clear Intel",
            "noise": "Low",
            "resources": {
                "credits": target.get("capacity") if target.get("resource_id") == "credits" else 0,
                "data_shard": target.get("capacity") if target.get("resource_id") == "data_shard" else 0,
                "nano_parts": target.get("capacity") if target.get("resource_id") == "nano_parts" else 0,
                "nexus_core": target.get("capacity") if target.get("resource_id") == "nexus_core" else 0,
            },
            "enemy_army": [{
                "name": "Guardian",
                "level": target.get("guardian_level", 1),
                "count": "Unknown",
                "role": "Protector"
            }],
            "estimated_power": target.get("guardian_power", 0),
            "defense_modules": ["Natural Defense"],
            "defense_style": "Wild Guardian",
            "weakness_hint": "Brute Force Attack",
            "counter_risk": "None",
            "lab_level": target.get("level", 1),
            "base_tier": target.get("signal_strength", "Unknown"),
            "vault_size": "N/A",
            "firewall": "None",
            "trap": "None",
            "trace_scanner": "None",
            "build_clue": "None"
        }

    level = get_effective_scout_level(p)
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
        "estimated_power": target.get("estimated_power", target.get("defense_power", "Unknown")),
        "weakness_hint": target.get("weakness_hint", "Unknown") if level >= 4 else "??? Unlock Scout Lv.4",
        "counter_risk": target.get("counter_risk", "Unknown") if level >= 4 else "??? Unlock Scout Lv.4",
        "build_clue": target.get("build_clue", "Unknown") if level >= 10 else "??? Unlock Scout Lv.10",
    }

    scout_signal_level = 0
    try:
        scout_signal_level = get_profile_research_level(p, "scout_signal")
    except Exception:
        scout_signal_level = 0

    ai_buffs = get_active_ai_buffs(p.get("active_ai", []))

    ai_scout_bonus = (
        int(ai_buffs.get("Scout Reading", 0))
        + int(ai_buffs.get("Analysis Accuracy", 0))
        + int(ai_buffs.get("Trap Detection", 0))
    )

    attacker_score = (
        int(level) * 10
        + int(p.get("scanner_level", 1)) * 3
        + int(scout_signal_level) * 4
        + ai_scout_bonus
    )

    defense_stats = target.get("defense_stats") or {}

    defender_score = int(
        defense_stats.get(
            "anti_scout_score",
            int(target.get("jammer_level", 1)) * 12
        )
    )

    report["scout_contest"] = {
        "attacker_score": attacker_score,
        "defender_score": defender_score,
        "attacker_scout_level": int(level),
        "attacker_scanner_level": int(p.get("scanner_level", 1)),
        "attacker_scout_signal": int(scout_signal_level),
        "attacker_active_ai": p.get("active_ai", []),
        "defender_jammer_level": int(target.get("jammer_level", 0)),
        "defender_anti_scout_score": defender_score,
        "defender_jammer_level": int(target.get("jammer_level", 1)),
        "defender_modules": target.get("defense_modules", []),
        "defender_ai_defense_bonus_percent": defense_stats.get("ai_defense_bonus_percent", 0),
    }

    if defender_score > attacker_score + 25:
        report["counter_scout_status"] = "Scout drone cut off by defender jammer"
        report["noise"] = "High"
    elif defender_score > attacker_score + 8:
        report["counter_scout_status"] = "Scout data partially jammed by defender"
        report["noise"] = "Medium"
    else:
        report["counter_scout_status"] = "Scout successful"
        report["noise"] = "Low"

    report = apply_scout_noise_mask(report)

    return report

@app.get("/api/scout/{target_id}")
async def scout(target_id: str, request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_ai_system(profile)

    GAME_STATE["players"][player_id] = profile

    return build_scout_report(target_id, profile)

@app.post("/api/scout/start")
async def start_scout(payload: dict = Body(...), request: Request = None):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_ai_system(profile)

    target_id = str(payload.get("target_id", "")).strip()

    if not target_id:
        raise HTTPException(
            status_code=400,
            detail="target_id kosong. Lakukan Scan Area ulang lalu pilih target."
        )

    target = GAME_STATE.get("targets", {}).get(target_id) or GAME_STATE.get("mining_nodes", {}).get(target_id)

    if not target:
        raise HTTPException(
            status_code=404,
            detail="Target not found. Lakukan Scan Area dulu."
        )

    target = refresh_player_target_from_profile(target)

    if target.get("kind") == "player" and target.get("player_id") == player_id:
        raise HTTPException(
            status_code=400,
            detail="Tidak bisa scout base sendiri."
        )

    distance_value = float(target.get("distance", 0))
    scout_level = get_effective_scout_level(profile)

    energy_cost = scout_energy_cost(distance_value)

    if int(profile.get("energy", 0)) < energy_cost:
        raise HTTPException(
            status_code=400,
            detail=f"Energy tidak cukup. Butuh {energy_cost}, punya {profile.get('energy', 0)}"
        )

    report = build_scout_report(target_id, profile)
    trip = scout_trip_time(distance_value, scout_level)

    profile["energy"] = int(profile.get("energy", 0)) - energy_cost

    GAME_STATE["players"][player_id] = profile
    if target.get("kind") == "mining":
        GAME_STATE["mining_nodes"][target_id] = target
    else:
        GAME_STATE["targets"][target_id] = target

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    scout_id = f"sct_{int(time.time())}_{random.randint(1000, 9999)}"

    return {
        "id": scout_id,
        "type": "scout",
        "player_id": player_id,
        "target_id": target_id,
        "target_kind": target.get("kind", "enemy"),
        "target_player_id": target.get("player_id"),
        "target_name": target.get("name", "Unknown Target"),
        "distance": target.get("distance", "?"),
        "outbound_seconds": trip["outbound_seconds"],
        "return_seconds": trip["return_seconds"],
        "travel_seconds": trip["total_seconds"],
        "energy_cost": energy_cost,
        "report": report,
        "energy_left": profile["energy"],
    }

@app.post("/api/ai/analyze")
async def ai_analyze(request: Request, payload: dict = Body(...)):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_ai_system(profile)
    profile = ensure_profile_unit_system(profile)

    target_id = str(payload.get("target_id", "")).strip()
    ai_id = str(payload.get("ai_id", "nova_lite")).strip()
    scout_report_text = str(payload.get("scout_report", "")).strip()
    scout_report_data = payload.get("scout_report_data") or {}

    if not target_id:
        raise HTTPException(status_code=400, detail="target_id kosong.")

    if ai_id not in AI_AGENTS:
        raise HTTPException(status_code=404, detail=f"AI tidak ditemukan: {ai_id}")

    if ai_id not in profile.get("owned_ai", []):
        raise HTTPException(status_code=403, detail=f"AI belum dimiliki player: {ai_id}")

    target = GAME_STATE.get("targets", {}).get(target_id)

    if not target:
        raise HTTPException(
            status_code=404,
            detail="Target tidak ditemukan. Lakukan Scan Area dan Scout ulang."
        )

    target = refresh_player_target_from_profile(target)

    ai = AI_AGENTS[ai_id]
    ai_buffs = ai.get("buffs", {})
    active_buffs_preview = get_active_ai_buffs(profile.get("active_ai", []))

    def from_report(key: str, fallback="Unknown"):
        if isinstance(scout_report_data, dict):
            value = scout_report_data.get(key)
            if value is not None and value != "":
                return value
        return fallback

    target_name = from_report("name", target.get("name", "Unknown Target"))
    distance = from_report("distance", target.get("distance", "?"))
    lab_level = from_report("lab_level", target.get("lab_level", "Unknown"))
    base_tier = from_report("base_tier", target.get("lab_tier", "Unknown"))
    noise = from_report("noise", "Unknown")
    report_quality = from_report("report_quality", "Unknown")

    defense_style = from_report(
        "defense_style",
        target.get("defense_style", "Unknown")
    )

    estimated_power = from_report(
        "estimated_power",
        target.get("estimated_power", target.get("defense_power", "Unknown"))
    )

    enemy_build = from_report(
        "enemy_build",
        target.get("enemy_build", "Unknown")
    )

    defense_modules = from_report(
        "defense_modules",
        target.get("defense_modules", [])
    )

    resources = from_report(
        "resources",
        target.get("resources", {})
    )

    scout_contest = from_report("scout_contest", {})

    missing_data = []

    def is_unknown(value):
        text = str(value)
        return (
            value is None
            or value == ""
            or text.startswith("???")
            or text.lower() in ["unknown", "none", "null"]
        )

    if is_unknown(defense_style):
        missing_data.append("defense_style")

    if is_unknown(estimated_power):
        missing_data.append("estimated_power")

    if not isinstance(defense_modules, list) or not defense_modules or any(str(m).startswith("???") for m in defense_modules):
        missing_data.append("defense_modules")

    if isinstance(resources, dict):
        if any(str(v).startswith("???") for v in resources.values()):
            missing_data.append("resources")
    else:
        missing_data.append("resources")

    noise_penalty = 0
    if noise == "Medium":
        noise_penalty = 15
    elif noise == "High":
        noise_penalty = 30

    ai_accuracy_bonus = (
        int(ai_buffs.get("Analysis Accuracy", 0))
        + int(ai_buffs.get("Risk Prediction", 0))
        + int(ai_buffs.get("Strategy Accuracy", 0))
        + int(ai_buffs.get("Trap Detection", 0))
    )

    base_confidence = 45 + (int(ai.get("level", 1)) * 5) + ai_accuracy_bonus
    confidence = base_confidence - noise_penalty - (len(missing_data) * 7)
    confidence = max(20, min(95, confidence))

    module_text = " ".join(defense_modules) if isinstance(defense_modules, list) else str(defense_modules)
    style_text = str(defense_style)

    recommended_build = "Balanced Breach"
    recommended_modules = [
        "trace_masker",
        "escape_script",
        "core_breaker",
        "payload_booster",
    ]

    warning = ""

    combined_defense_text = f"{style_text} {module_text}".lower()

    if "firewall" in combined_defense_text:
        recommended_build = "Firewall Breaker Assault"
        recommended_modules = [
            "firewall_crusher",
            "core_breaker",
            "payload_booster",
            "trace_masker",
            "escape_script",
            "exploit_chain_script",
        ]

    elif "trap" in combined_defense_text:
        recommended_build = "Analyst Breach"
        recommended_modules = [
            "trap_detector",
            "fake_signal_filter",
            "trace_masker",
            "escape_script",
            "ghost_proxy",
            "exploit_chain_script",
        ]

    elif "jammer" in combined_defense_text or noise in ["Medium", "High"]:
        recommended_build = "Anti-Jammer Route"
        recommended_modules = [
            "anti_jammer_chip",
            "signal_accelerator",
            "trace_masker",
            "escape_script",
            "exploit_chain_script",
            "payload_booster",
        ]

    elif "vault" in combined_defense_text:
        recommended_build = "Vault Extraction Breach"
        recommended_modules = [
            "core_breaker",
            "payload_booster",
            "trace_masker",
            "escape_script",
            "fake_signal_filter",
            "ghost_proxy",
        ]

    if noise == "High":
        warning = "Scout report terkena High Noise. Rekomendasi AI berisiko salah. Upgrade Scout Signal, aktifkan ORA, atau scout ulang."
    elif noise == "Medium":
        warning = "Sebagian data terkena jammer. Gunakan build aman dan hindari deploy unit terlalu besar."
    elif missing_data:
        warning = f"Data kurang: {', '.join(missing_data)}. AI memakai fallback analysis."

    preferred_ai = ai.get("name", ai_id)

    if recommended_build in ["Firewall Breaker Assault", "Anti-Jammer Route"] and "hex" in profile.get("owned_ai", []):
        preferred_ai = AI_AGENTS["hex"]["name"]

    if recommended_build == "Analyst Breach" and "ora" in profile.get("owned_ai", []):
        preferred_ai = AI_AGENTS["ora"]["name"]

    analysis = (
        f"Target {target_name} berada pada jarak {distance} Trace Unit. "
        f"Lab Level: {lab_level}, Tier: {base_tier}. "
        f"Report Quality: {report_quality}, Noise: {noise}. "
        f"Defense Style: {defense_style}. "
        f"Estimated Power: {estimated_power}. "
    )

    if scout_contest:
        analysis += (
            f"Scout Contest: attacker {scout_contest.get('attacker_score', '?')} "
            f"vs defender {scout_contest.get('defender_score', scout_contest.get('defender_anti_scout_score', '?'))}. "
        )

    if isinstance(defense_modules, list) and defense_modules:
        analysis += f"Defense Modules: {', '.join(map(str, defense_modules))}. "

    if missing_data:
        analysis += "Beberapa data tidak lengkap karena scout noise. "

    GAME_STATE["players"][player_id] = profile

    return {
        "ai": {
            "id": ai_id,
            "name": ai.get("name", ai_id),
            "level": ai.get("level", 1),
            "rarity": ai.get("rarity", "Common"),
        },
        "player_id": player_id,
        "target": {
            "id": target_id,
            "name": target_name,
            "distance": distance,
            "lab_level": lab_level,
            "base_tier": base_tier,
            "noise": noise,
            "report_quality": report_quality,
        },
        "confidence": confidence,
        "analysis": analysis,
        "missing_data": missing_data,
        "recommendation": {
            "recommended_build": recommended_build,
            "recommended_modules": recommended_modules[:6],
            "recommended_ai": preferred_ai,
            "warning": warning,
        },
        "active_buffs_preview": active_buffs_preview,
    }

@app.post("/api/attack")
async def attack(req: AttackRequest, request: Request):
    await sync_state_from_db()

    attacker_id, attacker = get_or_create_active_player_profile(request)
    attacker = ensure_player_profile_schema(attacker)
    attacker = ensure_profile_unit_system(attacker)
    attacker = ensure_profile_ai_system(attacker)
    attacker = ensure_recovery_system(attacker)

    target = GAME_STATE.get("targets", {}).get(req.target_id) or GAME_STATE.get("mining_nodes", {}).get(req.target_id)

    if not target:
        raise HTTPException(
            status_code=404,
            detail="Target not found. Lakukan Scan Area dulu."
        )

    target = refresh_player_target_from_profile(target)

    if target.get("kind") == "enemy" and target.get("status") in ["depleted", "collapsed"]:
        return {
            "id": f"atk_ignored_{int(time.time())}_{random.randint(1000, 9999)}",
            "type": "attack",
            "phase": "ignored",
            "player_id": attacker_id,
            "target_id": req.target_id,
            "target_kind": target.get("kind", "enemy"),
            "target_player_id": target.get("player_id"),
            "target_name": target.get("name", "Unknown Target"),
            "target_status": target.get("status", "depleted"),

            "success": False,
            "target_depleted": True,
            "ignored": True,

            "final_travel_seconds": 0,
            "outbound_seconds": 0,
            "return_seconds": 0,
            "created_at": time.time(),

            "battle_log": [
                "TARGET ALREADY CLEARED",
                "This enemy has already been defeated.",
                "No units deployed.",
                "No energy spent.",
                "No loot secured.",
            ],

            "destroyed_units": {},
            "disabled_units": {},
            "enemy_destroyed_units": {},
            "reward": {
                "credits": 0,
                "data_shard": 0,
                "nano_parts": 0,
                "nexus_core": 0,
            },

            "trace_exposure": attacker.get("trace", 0),
            "energy_cost": 0,
        }

    if target.get("kind") == "player" and target.get("player_id") == attacker_id:
        raise HTTPException(status_code=400, detail="Tidak bisa menyerang base sendiri.")
    
    if target.get("kind") == "mining" and target.get("owner") == attacker_id:
        raise HTTPException(status_code=400, detail="Pasukanmu sudah menguasai lahan ini!")
    
    # === CEGAH PASUKAN GANDA KE TARGET YANG SAMA ===
    for op in GAME_STATE.get("active_attacks", {}).values():
        if op.get("player_id") == attacker_id and op.get("target_id") == req.target_id:
            if op.get("phase") in ["outbound", "occupying"]:
                raise HTTPException(
                    status_code=400, 
                    detail="Kamu sudah mengirim pasukan ke target ini!"
                )
    # ===============================================

    if len(req.module_ids) > 6:
        raise HTTPException(status_code=400, detail="Max 6 modules")

    clean_modules = []

    for module_id in req.module_ids:
        module_id = str(module_id).strip()

        if not get_attack_module_config(module_id):
            raise HTTPException(status_code=400, detail=f"Unknown attack module: {module_id}")

        if module_id not in clean_modules:
            clean_modules.append(module_id)

    if not clean_modules:
        raise HTTPException(status_code=400, detail="Pilih minimal 1 attack module")

    slot_limit = get_ai_slot_limit_for_profile(attacker)

    if len(req.ai_ids) > slot_limit:
        raise HTTPException(status_code=400, detail=f"AI Core hanya punya {slot_limit} slot")

    clean_ai_ids = []

    for ai_id in req.ai_ids:
        ai_id = str(ai_id).strip()

        if ai_id not in AI_AGENTS:
            raise HTTPException(status_code=404, detail=f"AI tidak ditemukan: {ai_id}")

        if ai_id not in attacker.get("owned_ai", []):
            raise HTTPException(status_code=403, detail=f"AI belum dimiliki: {ai_id}")

        if ai_id not in clean_ai_ids:
            clean_ai_ids.append(ai_id)

    unit_calc = calculate_attack_unit_power(attacker, req.units)

    total_units = unit_calc["total_units"]
    unit_power = unit_calc["attack_unit_power"]

    max_deploy_units = get_max_deploy_units_for_profile(attacker)

    if total_units > max_deploy_units:
        raise HTTPException(
            status_code=400,
            detail=f"Unit deploy melebihi limit. Max {max_deploy_units}, kamu pilih {total_units}"
        )

    module_bonus = get_attack_module_bonus(clean_modules)
    research_bonus = get_attack_research_bonus(attacker)
    ai_bonus = get_attack_ai_bonus(attacker, clean_ai_ids)

    distance_value = float(target.get("distance", 1))
    base_travel = max(5, int(distance_value * 1.2))

    total_travel_reduction = (
        module_bonus["travel_reduction"]
        + research_bonus["travel_reduction"]
        + ai_bonus["travel_reduction"]
    )

    total_travel_reduction = min(60, max(0, total_travel_reduction))

    outbound_seconds = max(
        3,
        int(base_travel * (1 - total_travel_reduction / 100))
    )

    # Untuk sekarang waktu pulang sama dengan waktu pergi.
    # Nanti bisa dipengaruhi cargo, unit speed, atau module.
    return_seconds = outbound_seconds

    energy_cost = 10 + int(total_units / 25)
    energy_cost = max(5, energy_cost)

    if attacker.get("energy", 0) < energy_cost:
        raise HTTPException(
            status_code=400,
            detail=f"Energy tidak cukup. Butuh {energy_cost}, punya {attacker.get('energy', 0)}"
        )

    # Mulai dari sini baru mutasi data.
    # Attack start hanya mengurangi energy dan mengunci unit.
    attacker["energy"] = int(attacker.get("energy", 0)) - energy_cost
    attacker = remove_deployed_units_from_inventory(attacker, req.units)

    now = time.time()
    attack_id = f"atk_{int(now)}_{random.randint(1000, 9999)}"

    active_attack = {
        "id": attack_id,
        "type": "attack",
        "phase": "outbound",
        "status": "running",

        "player_id": attacker_id,
        "target_id": req.target_id,
        "target_kind": target.get("kind", "enemy"),
        "target_player_id": target.get("player_id"),
        "target_name": target.get("name", "Unknown Target"),
        "target_status": target.get("status", "active"),

        "selected_units": copy.deepcopy(req.units),
        "module_ids": clean_modules,
        "ai_ids": clean_ai_ids,

        "unit_power_score": unit_power,
        "total_units": total_units,

        "distance": distance_value,
        "outbound_seconds": outbound_seconds,
        "return_seconds": return_seconds,
        "final_travel_seconds": outbound_seconds,

        "created_at": now,
        "started_at": now,
        "impact_at": now + outbound_seconds,
        "return_at": None,
        "completed_at": None,

        # Belum ada battle.
        "success": None,
        "battle_resolved": False,
        "return_resolved": False,

        # Belum ada reward/loss.
        "pending_reward": {
            "credits": 0,
            "data_shard": 0,
            "nano_parts": 0,
            "nexus_core": 0,
        },
        "reward": {
            "credits": 0,
            "data_shard": 0,
            "nano_parts": 0,
            "nexus_core": 0,
        },
        "destroyed_units": {},
        "disabled_units": {},
        "surviving_units": {},
        "enemy_destroyed_units": {},

        "trace_gain": 0,
        "trace_exposure": attacker.get("trace", 0),
        "energy_cost": energy_cost,

        "battle_log": [
            f"Attack launched against {target.get('name', req.target_id)}.",
            f"Distance: {int(distance_value)} Trace Unit.",
            f"Outbound Time: {outbound_seconds}s.",
            f"Return Time: {return_seconds}s.",
            f"Energy Cost: {energy_cost}.",
            "",
            "STATUS: OUTBOUND",
            "Units are moving to target.",
            "No battle yet.",
            "No loot secured yet.",
        ],
    }

    GAME_STATE["players"][attacker_id] = attacker
    GAME_STATE.setdefault("active_attacks", {})
    GAME_STATE["active_attacks"][attack_id] = active_attack

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return active_attack

@app.post("/api/attack/{attack_id}/impact")
async def attack_impact(attack_id: str, request: Request):
    await sync_state_from_db()

    attacker_id, attacker = get_or_create_active_player_profile(request)
    attacker = ensure_player_profile_schema(attacker)
    attacker = ensure_profile_unit_system(attacker)
    attacker = ensure_profile_ai_system(attacker)
    attacker = ensure_recovery_system(attacker)

    active_attacks = GAME_STATE.setdefault("active_attacks", {})
    active_attack = active_attacks.get(attack_id)

    if not active_attack or active_attack.get("player_id") != attacker_id:
        raise HTTPException(status_code=404, detail="Operation tidak ditemukan.")

    if active_attack.get("battle_resolved") or active_attack.get("phase") != "outbound":
        return active_attack

    now = time.time()
    impact_at = float(active_attack.get("impact_at", 0) or 0)

    if now < impact_at:
        return {
            **active_attack,
            "not_ready": True,
            "remaining_seconds": max(1, math.ceil(impact_at - now)),
        }

    target_id = active_attack.get("target_id")
    target = GAME_STATE.get("targets", {}).get(target_id) or GAME_STATE.get("mining_nodes", {}).get(target_id)

    if not target or (target.get("kind") == "enemy" and target.get("status") in ["depleted", "collapsed"]):
        active_attack["phase"] = "returning"
        active_attack["battle_resolved"] = True
        active_attack["success"] = False
        active_attack["return_at"] = now + int(active_attack.get("return_seconds", 1) or 1)
        active_attack["pending_reward"] = {"credits": 0, "data_shard": 0, "nano_parts": 0, "nexus_core": 0}
        active_attack["surviving_units"] = copy.deepcopy(active_attack.get("selected_units", {}))
        active_attack["destroyed_units"] = {}
        active_attack["disabled_units"] = {}
        active_attack["enemy_destroyed_units"] = {}
        active_attack["battle_log"] = ["TARGET SIGNAL LOST OR CLEARED", "No battle occurred. Units returning."]
        active_attacks[attack_id] = active_attack
        await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)
        return active_attack

    target = refresh_player_target_from_profile(target)

    selected_units = active_attack.get("selected_units", {})
    module_ids = active_attack.get("module_ids", [])
    ai_ids = active_attack.get("ai_ids", [])

    module_bonus = get_attack_module_bonus(module_ids)
    research_bonus = get_attack_research_bonus(attacker)
    ai_bonus = get_attack_ai_bonus(attacker, ai_ids)

    unit_power = int(active_attack.get("unit_power_score", 0) or 0)
    attack_percent = module_bonus["attack_percent"] + research_bonus["attack_percent"] + ai_bonus["attack_percent"]
    attack_score = int((unit_power + module_bonus["attack_flat"]) * (1 + attack_percent / 100))

    defense_modules = target.get("defense_modules", [])
    defense_stats = target.get("defense_stats") or {}
    defense_score = int(defense_stats.get("defense_power", target.get("estimated_power", 1000)))

    if "Firewall Core" in defense_modules and "firewall_crusher" not in module_ids: defense_score += 350
    if "Trap Net" in defense_modules and "trap_detector" not in module_ids: defense_score += 280
    if "Vault Guard" in defense_modules and "core_breaker" not in module_ids: defense_score += 320
    if "Repair Node" in defense_modules and "payload_booster" not in module_ids: defense_score += 260

    # === PVP MINING COMBAT: LAWAN PASUKAN PEMILIK ===
    defender_op_id = None
    if target.get("kind") == "mining" and target.get("status") == "Occupied":
        occupier_power = 0
        for op_id, op_data in GAME_STATE.get("active_attacks", {}).items():
            if op_data.get("target_id") == target_id and op_data.get("phase") == "occupying":
                defender_op_id = op_id
                for uid, levels in op_data.get("surviving_units", {}).items():
                    for lvl, amt in levels.items():
                        amt = int(amt or 0)
                        if amt > 0:
                            stats = get_unit_stats(uid, int(lvl))
                            unit_score = int((stats["hp"] * 0.06) + (stats["attack"] * 2.1) + (stats["defense"] * 0.65) + (stats["speed"] * 7) + (stats["cargo"] * 3))
                            occupier_power += unit_score * amt
                break
                
        if occupier_power > 0:
            defense_score = occupier_power

    attack_roll = random.uniform(0.92, 1.08)
    defense_roll = random.uniform(0.95, 1.06)

    final_attack_score = int(attack_score * attack_roll)
    final_defense_score = int(defense_score * defense_roll)
    success = final_attack_score > final_defense_score

    loss_rate = 0.16 if success else 0.42
    loss_rate -= module_bonus["loss_reduction"] / 100
    loss_rate -= ai_bonus["loss_reduction"] / 100
    loss_rate = max(0.05, min(0.65, loss_rate))

    destroyed, disabled, surviving = calculate_deployed_unit_outcome(selected_units, loss_rate)
    attacker = add_disabled_units_to_recovery(attacker, disabled)

    enemy_destroyed_units = apply_npc_guard_damage(target, final_attack_score, final_defense_score, success)

    trace_gain = max(1, min(40, (8 if success else 20) - module_bonus["trace_reduction"] + ai_bonus["trace_delta"]))
    attacker["trace"] = max(0, min(100, int(attacker.get("trace", 0)) + trace_gain))

    reward = {"credits": 0, "data_shard": 0, "nano_parts": 0, "nexus_core": 0}
    defender = get_target_defender_profile(target)

    if success and target.get("kind") != "mining":
        target_resources = target.get("resources", {})
        loot_rate = min(0.35, random.uniform(0.08, 0.18) + module_bonus["loot_bonus"] / 100)
        for key in ["credits", "data_shard", "nano_parts"]:
            available = int(target_resources.get(key, 0) or 0)
            stolen = int(available * loot_rate)
            if stolen > 0:
                reward[key] = stolen
                target_resources[key] = max(0, available - stolen)
                if defender:
                    defender["resources"][key] = max(0, int(defender.get("resources", {}).get(key, 0)) - stolen)
        
        if int(target_resources.get("nexus_core", 0) or 0) > 0 and random.random() < 0.08:
            reward["nexus_core"] = 1
            target_resources["nexus_core"] = max(0, int(target_resources.get("nexus_core", 0)) - 1)
            if defender: defender["resources"]["nexus_core"] = max(0, int(defender.get("resources", {}).get("nexus_core", 0)) - 1)

    if success and target.get("kind") == "enemy":
        target["status"] = "depleted"
        target["depleted_at"] = now
        target["defeated_by"] = attacker_id

    battle_log = [f"Attack impact at {target.get('name', target_id)}.", "", f"RESULT: {'SUCCESS' if success else 'FAILED'}", "", "YOUR LOSSES:"]
    
    has_loss = False
    for unit_id, level_map in destroyed.items():
        for level_text, amount in level_map.items():
            if amount > 0:
                has_loss = True
                battle_log.append(f"- {UNITS.get(unit_id, {}).get('name', unit_id)} Lv.{level_text} destroyed: {amount}")
    
    for unit_id, level_map in disabled.items():
        for level_text, amount in level_map.items():
            if amount > 0:
                has_loss = True
                battle_log.append(f"- {UNITS.get(unit_id, {}).get('name', unit_id)} Lv.{level_text} disabled: {amount}")
                
    if not has_loss: battle_log.append("- No confirmed unit losses.")
    battle_log.append("")

    if target.get("kind") == "mining":
        if success:
            total_cargo = sum(get_unit_stats(uid, int(lvl))["cargo"] * int(amt) for uid, levels in surviving.items() for lvl, amt in levels.items() if amt > 0)
            production_per_minute = float(target.get("production_per_minute", 1))
            capacity = int(target.get("capacity", 0))

            max_mineable = min(total_cargo, capacity)
            mining_minutes = max_mineable / max(0.1, production_per_minute)
            mining_seconds = int(mining_minutes * 60)

            # === PVP TAKEOVER: TENDANG PEMILIK LAMA ===
            previous_owner_id = target.get("owner")
            if previous_owner_id and previous_owner_id != attacker_id and defender_op_id:
                if defender_op_id in GAME_STATE.get("active_attacks", {}):
                    def_op = GAME_STATE["active_attacks"][defender_op_id]
                    stolen_amount = process_mining_tick(target_id, now)
                    res_id = def_op.get("mining_resource_id", "credits")
                    
                    if "pending_reward" not in def_op: def_op["pending_reward"] = {"credits": 0, "data_shard": 0, "nano_parts": 0, "nexus_core": 0}
                    def_op["pending_reward"][res_id] = int(def_op["pending_reward"].get(res_id, 0)) + stolen_amount
                    
                    def_op["phase"] = "returning"
                    def_op["return_at"] = now + int(def_op.get("return_seconds", 30))
                    def_op["occupy_ends_at"] = None
                    
                    if not isinstance(def_op.get("battle_log"), list): def_op["battle_log"] = []
                    def_op["battle_log"].extend(["", "⚠️ NODE UNDER ATTACK (PvP)!", f"- Diserang dan direbut komandan lain!", f"- Berhasil mengamankan: {stolen_amount} {res_id}", "- Pasukan ditarik mundur ke base."])
            # ==========================================

            target["owner"] = attacker_id
            target["occupied_at"] = now
            target["status"] = "Occupied"

            active_attack["phase"] = "occupying"
            active_attack["status"] = "running"
            active_attack["occupy_ends_at"] = now + mining_seconds
            active_attack["mining_capacity_booked"] = max_mineable
            active_attack["mining_resource_id"] = target.get("resource_id")
            active_attack["return_at"] = None
            active_attack["pending_reward"] = {"credits": 0, "data_shard": 0, "nano_parts": 0, "nexus_core": 0}

            battle_log.extend(["MINING OPERATION STARTED:", f"- Surviving Troop Cargo: {total_cargo}", f"- Target Lock: {max_mineable} {target.get('resource_name', 'resources')}", f"- Estimated Time: {int(mining_minutes)} minutes", f"TRACE: +{trace_gain}. Current Trace: {attacker['trace']}%.", "", "STATUS: OCCUPYING NODE"])
        else:
            battle_log.extend(["MINING FAILED:", "- No cargo secured.", f"TRACE: +{trace_gain}. Current Trace: {attacker['trace']}%.", "", "STATUS: RETURNING TO BASE"])
            active_attack["phase"] = "returning"
            active_attack["return_at"] = now + int(active_attack.get("return_seconds", 1) or 1)
            active_attack["pending_reward"] = {"credits": 0, "data_shard": 0, "nano_parts": 0, "nexus_core": 0}
    else:
        battle_log.append("CARGO:")
        if success:
            battle_log.extend([f"- Credits secured: {reward.get('credits', 0)}", f"- Data Shard secured: {reward.get('data_shard', 0)}", f"- Nano Parts secured: {reward.get('nano_parts', 0)}"])
            if reward.get("nexus_core", 0): battle_log.append(f"- Nexus Core secured: {reward.get('nexus_core', 0)}")
        else:
            battle_log.append("- No cargo secured.")
        battle_log.extend(["", f"TRACE: +{trace_gain}. Current Trace: {attacker['trace']}%.", "", "STATUS: RETURNING TO BASE"])
        active_attack["phase"] = "returning"
        active_attack["return_at"] = now + int(active_attack.get("return_seconds", 1) or 1)
        active_attack["pending_reward"] = reward

    active_attack["battle_resolved"] = True
    active_attack["success"] = success
    active_attack["impact_resolved_at"] = now
    active_attack["reward"] = {"credits": 0, "data_shard": 0, "nano_parts": 0, "nexus_core": 0}
    active_attack["destroyed_units"] = destroyed
    active_attack["disabled_units"] = disabled
    active_attack["surviving_units"] = surviving
    active_attack["enemy_destroyed_units"] = enemy_destroyed_units
    active_attack["trace_gain"] = trace_gain
    active_attack["trace_exposure"] = attacker["trace"]
    active_attack["battle_log"] = battle_log

    GAME_STATE["players"][attacker_id] = attacker
    if defender and target.get("player_id"): GAME_STATE["players"][target["player_id"]] = defender
    
    if target.get("kind") == "mining": GAME_STATE["mining_nodes"][target_id] = target
    else: GAME_STATE["targets"][target_id] = target

    active_attacks[attack_id] = active_attack
    GAME_STATE["active_attacks"] = active_attacks

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)
    return active_attack

@app.post("/api/attack/{attack_id}/recall")
async def attack_recall(attack_id: str, request: Request):
    await sync_state_from_db()

    attacker_id, attacker = get_or_create_active_player_profile(request)
    active_attacks = GAME_STATE.setdefault("active_attacks", {})
    active_attack = active_attacks.get(attack_id)

    if not active_attack or active_attack.get("player_id") != attacker_id:
        raise HTTPException(status_code=404, detail="Operation tidak ditemukan.")

    if active_attack.get("phase") != "occupying":
        raise HTTPException(status_code=400, detail="Pasukan tidak sedang menambang.")

    now = time.time()
    target_id = active_attack.get("target_id")

    # 1. Hitung hasil tambang secara presisi (Lazy Evaluation)
    mined_amount = process_mining_tick(target_id, now)

    # 2. Masukkan hasil tambang ke kargo pasukan (pending_reward)
    res_id = active_attack.get("mining_resource_id", "credits")
    
    if "pending_reward" not in active_attack:
        active_attack["pending_reward"] = {"credits": 0, "data_shard": 0, "nano_parts": 0, "nexus_core": 0}
        
    active_attack["pending_reward"][res_id] = int(active_attack["pending_reward"].get(res_id, 0)) + mined_amount

    # 3. Lepaskan penguasaan tambang di Global State
    target = GAME_STATE.get("mining_nodes", {}).get(target_id)
    if target and target.get("owner") == attacker_id:
        target["owner"] = None
        target["status"] = "Unoccupied"

    # 4. Ubah status pasukan menjadi Pulang (Returning)
    return_seconds = int(active_attack.get("return_seconds", 30))
    active_attack["phase"] = "returning"
    active_attack["return_at"] = now + return_seconds
    active_attack["occupy_ends_at"] = None

    active_attack["battle_log"].append("")
    active_attack["battle_log"].append("RECALL COMMAND ISSUED:")
    active_attack["battle_log"].append(f"- Cargo Mined: {mined_amount} {res_id}")
    active_attack["battle_log"].append("- Troops are packing up and returning to base.")

    GAME_STATE["players"][attacker_id] = attacker
    active_attacks[attack_id] = active_attack
    
    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return active_attack

@app.post("/api/attack/{attack_id}/return")
async def attack_return(attack_id: str, request: Request):
    await sync_state_from_db()

    attacker_id, attacker = get_or_create_active_player_profile(request)
    attacker = ensure_player_profile_schema(attacker)
    attacker = ensure_profile_unit_system(attacker)
    attacker = ensure_profile_ai_system(attacker)
    attacker = ensure_recovery_system(attacker)

    active_attacks = GAME_STATE.setdefault("active_attacks", {})
    active_attack = active_attacks.get(attack_id)

    if not active_attack:
        raise HTTPException(status_code=404, detail="Attack operation tidak ditemukan.")

    if active_attack.get("player_id") != attacker_id:
        raise HTTPException(status_code=403, detail="Attack ini bukan milik player ini.")

    if active_attack.get("type") != "attack":
        raise HTTPException(status_code=400, detail="Operation ini bukan attack.")

    # Idempotent: kalau sudah pernah return, jangan tambah reward/unit dua kali.
    if active_attack.get("return_resolved"):
        return active_attack

    if not active_attack.get("battle_resolved"):
        return {
            **active_attack,
            "not_ready": True,
            "message": "Battle belum terjadi. Pasukan belum sampai target.",
        }

    if active_attack.get("phase") != "returning":
        return {
            **active_attack,
            "not_ready": True,
            "message": "Pasukan belum dalam fase pulang.",
        }

    now = time.time()
    return_at = float(active_attack.get("return_at", 0) or 0)

    if now < return_at:
        return {
            **active_attack,
            "not_ready": True,
            "remaining_seconds": max(1, math.ceil(return_at - now)),
            "message": "Pasukan masih dalam perjalanan pulang.",
        }

    pending_reward = active_attack.get("pending_reward", {}) or {}
    surviving_units = active_attack.get("surviving_units", {}) or {}

    attacker.setdefault("resources", {})

    for key in ["credits", "data_shard", "nano_parts", "nexus_core"]:
        amount = int(pending_reward.get(key, 0) or 0)

        if amount <= 0:
            continue

        attacker["resources"][key] = int(attacker["resources"].get(key, 0)) + amount

    attacker = add_units_to_inventory(attacker, surviving_units)

    active_attack["phase"] = "completed"
    active_attack["status"] = "completed"
    active_attack["return_resolved"] = True
    active_attack["completed_at"] = now

    # Reward baru resmi masuk saat pasukan pulang.
    active_attack["reward"] = {
        "credits": int(pending_reward.get("credits", 0) or 0),
        "data_shard": int(pending_reward.get("data_shard", 0) or 0),
        "nano_parts": int(pending_reward.get("nano_parts", 0) or 0),
        "nexus_core": int(pending_reward.get("nexus_core", 0) or 0),
    }

    active_attack["pending_reward"] = {
        "credits": 0,
        "data_shard": 0,
        "nano_parts": 0,
        "nexus_core": 0,
    }

    battle_log = active_attack.get("battle_log", [])

    if not isinstance(battle_log, list):
        battle_log = [str(battle_log)]

    battle_log.append("")
    battle_log.append("RETURN COMPLETE")
    battle_log.append("Units have returned to base.")

    has_survivors = any(
        int(amount or 0) > 0
        for level_map in surviving_units.values()
        for amount in level_map.values()
    )

    if has_survivors:
        battle_log.append("Surviving units are ready again.")
    else:
        battle_log.append("No surviving units returned.")

    reward = active_attack["reward"]

    if any(int(v or 0) > 0 for v in reward.values()):
        battle_log.append("")
        battle_log.append("REWARD DELIVERED:")
        battle_log.append(f"- Credits +{reward.get('credits', 0)}")
        battle_log.append(f"- Data Shard +{reward.get('data_shard', 0)}")
        battle_log.append(f"- Nano Parts +{reward.get('nano_parts', 0)}")

        if reward.get("nexus_core", 0):
            battle_log.append(f"- Nexus Core +{reward.get('nexus_core', 0)}")
    else:
        battle_log.append("No reward delivered.")

    active_attack["battle_log"] = battle_log

    GAME_STATE["players"][attacker_id] = attacker
    active_attacks[attack_id] = active_attack
    GAME_STATE["active_attacks"] = active_attacks

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return active_attack

class OnboardingCompleteRequest(BaseModel):
    language: Literal["id", "en"] = "id"
    commander_name: str = Field(min_length=3, max_length=24)
    referral_code: Optional[str] = None

class PromoteUnitRequest(BaseModel):
    unit_id: str
    from_level: int = Field(ge=1, le=4)
    amount: int = Field(gt=0, le=999)


class UpgradeUnitTechRequest(BaseModel):
    unit_id: str


@app.get("/api/buildings")
async def get_buildings(request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_unit_system(profile)
    profile = ensure_profile_ai_system(profile)

    return {
        "ai": {
            "owned_ai": profile["owned_ai"],
            "active_ai": profile["active_ai"],
            "ai_core_level": get_ai_slot_limit_for_profile(profile),
            "active_ai_buffs": get_effective_ai_buffs(profile["active_ai"]),
        },
        "player_id": player_id,
        "buildings": profile["buildings"],
        "main_lab_level": profile.get("lab_level", 1),
        "scanner_level": profile.get("scanner_level", 1),
        "scout_level": profile.get("scout_level", 1),

        "player": {
            "player_id": player_id,
            "credits": profile["resources"].get("credits", 0),
            "energy": profile.get("energy", 100),
            "max_energy": profile.get("max_energy", 100),
            "resources": profile["resources"],
            "unit_inventory": profile["unit_inventory"],
            "unit_tech": profile["unit_tech"],
        },

        "units": get_units_for_profile(profile),
    }

@app.post("/api/units/train")
async def train_unit(req: TrainUnitRequest, request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_unit_system(profile)

    factory_level = get_profile_building_level(profile, "unit_factory")

    if factory_level < 1:
        raise HTTPException(
            status_code=400,
            detail="Bangun Unit Factory dulu sebelum melatih pasukan."
        )

    unit = get_unit_config(req.unit_id)

    if not unit:
        raise HTTPException(status_code=400, detail="Unknown unit")
    required_factory_level = get_unit_factory_unlock_level(req.unit_id)

    if not is_unit_type_unlocked_by_factory(profile, req.unit_id):
        raise HTTPException(
            status_code=400,
            detail=f"{unit['name']} membutuhkan Unit Factory Lv.{required_factory_level}."
        )

    batch_limit = get_unit_train_batch_limit(profile, req.unit_id, req.level)

    if int(req.amount) > batch_limit:
        raise HTTPException(
            status_code=400,
            detail=f"Unit Factory Lv.{factory_level} hanya bisa train max {batch_limit} {unit['name']} Lv.{req.level} per batch."
        )

    unlocked_level = int(profile["unit_tech"].get(req.unit_id, 1))

    if req.level > unlocked_level:
        raise HTTPException(
            status_code=400,
            detail=f"{unit['name']} Lv.{req.level} belum terbuka di Research Lab"
        )

    cost = get_unit_train_cost(req.unit_id, req.level)

    total_cost = {}

    for resource_id, amount in cost.items():
        amount = int(amount or 0)

        if amount <= 0:
            continue

        # Energy tidak boleh jadi biaya train.
        if resource_id == "energy":
            continue

        total_cost[resource_id] = amount * int(req.amount)

    profile = require_and_pay_resources(profile, total_cost)

    level_key = str(req.level)

    profile["unit_inventory"].setdefault(req.unit_id, {})
    profile["unit_inventory"][req.unit_id].setdefault(level_key, 0)
    profile["unit_inventory"][req.unit_id][level_key] += int(req.amount)

    GAME_STATE["players"][player_id] = profile

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return {
        "success": True,
        "message": f"Trained {req.amount} {unit['name']} Lv.{req.level}",
        "player_id": player_id,
        "resources": profile["resources"],
        "energy": profile.get("energy", 0),
        "unit_inventory": profile["unit_inventory"],
        "units": get_units_for_profile(profile),
        "train_batch_limit": batch_limit,
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
async def promote_unit(req: PromoteUnitRequest, request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_unit_system(profile)

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

    unlocked_level = int(profile["unit_tech"].get(unit_id, 1))

    if to_level > unlocked_level:
        raise HTTPException(
            status_code=400,
            detail=f"{unit['name']} Lv.{to_level} belum terbuka di Research Lab"
        )

    from_key = str(from_level)
    to_key = str(to_level)

    profile["unit_inventory"][unit_id].setdefault(from_key, 0)
    profile["unit_inventory"][unit_id].setdefault(to_key, 0)

    owned_from = int(profile["unit_inventory"][unit_id].get(from_key, 0))

    if owned_from < amount:
        raise HTTPException(
            status_code=400,
            detail=f"Tidak cukup {unit['name']} Lv.{from_level}. Punya {owned_from}, butuh {amount}"
        )

    nano_per_unit = 40 * to_level
    total_nano = nano_per_unit * amount

    resources = profile["resources"]

    if int(resources.get("nano_parts", 0)) < total_nano:
        raise HTTPException(
            status_code=400,
            detail=f"Nano Parts tidak cukup. Butuh {total_nano}, punya {resources.get('nano_parts', 0)}"
        )

    resources["nano_parts"] = int(resources.get("nano_parts", 0)) - total_nano

    profile["unit_inventory"][unit_id][from_key] = owned_from - amount
    profile["unit_inventory"][unit_id][to_key] = int(profile["unit_inventory"][unit_id].get(to_key, 0)) + amount

    GAME_STATE["players"][player_id] = profile

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return {
        "success": True,
        "message": f"Promoted {amount} {unit['name']} Lv.{from_level} → Lv.{to_level}",
        "player_id": player_id,
        "resources": profile["resources"],
        "unit_inventory": profile["unit_inventory"],
        "units": get_units_for_profile(profile),
    }

@app.post("/api/research/unit-tech/upgrade")
async def upgrade_unit_tech(req: UpgradeUnitTechRequest, request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_unit_system(profile)

    unit = get_unit_config(req.unit_id)

    current = int(profile["unit_tech"].get(req.unit_id, 1))
    next_level = current + 1

    if next_level > int(unit["max_level"]):
        raise HTTPException(status_code=400, detail="Unit tech already max level")

    cost = get_unit_tech_cost_for_profile(profile, req.unit_id)

    resources = profile["resources"]
    credits = int(resources.get("credits", 0))
    energy = int(profile.get("energy", 0))

    if credits < cost["credits"]:
        raise HTTPException(
            status_code=400,
            detail=f"Credits tidak cukup. Butuh {cost['credits']}, punya {credits}"
        )

    if energy < cost["energy"]:
        raise HTTPException(
            status_code=400,
            detail=f"Energy tidak cukup. Butuh {cost['energy']}, punya {energy}"
        )

    resources["credits"] = credits - cost["credits"]
    profile["energy"] = energy - cost["energy"]

    profile["unit_tech"][req.unit_id] = next_level
    profile["research"]["unit_tech"][req.unit_id] = next_level

    GAME_STATE["players"][player_id] = profile

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return {
        "success": True,
        "message": f"{unit['name']} Lv.{next_level} unlocked",
        "player_id": player_id,
        "unit_id": req.unit_id,
        "unlocked_level": next_level,
        "cost": cost,
        "resources": profile["resources"],
        "energy": profile.get("energy", 0),
        "unit_tech": get_unit_tech_list_for_profile(profile),
        "units": get_units_for_profile(profile),
    }

@app.get("/api/research")
async def get_research(request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_unit_system(profile)

    buildings = profile.get("buildings", {})
    research_lab = buildings.get("research_lab", {
        "id": "research_lab",
        "name": "Research Lab",
        "level": 1,
        "locked": False,
    })

    return {
        "player_id": player_id,
        "research": get_research_with_costs_for_profile(profile),
        "player": {
            "player_id": player_id,
            "credits": profile["resources"].get("credits", 0),
            "energy": profile.get("energy", 100),
            "resources": profile["resources"],
        },
        "research_lab": research_lab,
        "unit_tech": get_unit_tech_list_for_profile(profile),
        "energy_regen_per_minute": get_energy_regen_per_minute_for_profile(profile),
    }

@app.post("/api/research/upgrade")
async def upgrade_research(req: UpgradeResearchRequest, request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_unit_system(profile)

    research_template = GAME_STATE.get("research", {}).get(req.research_id)

    if not research_template:
        raise HTTPException(status_code=404, detail="Research not found")

    current_level = int(profile["research"]["core"].get(req.research_id, 0))
    max_level = int(research_template.get("max_level", 10))

    if current_level >= max_level:
        raise HTTPException(status_code=400, detail="Research already max level")

    research_item = copy.deepcopy(research_template)
    research_item["level"] = current_level

    cost = get_profile_research_next_cost(research_item)

    resources = profile["resources"]
    credits = int(resources.get("credits", 0))
    energy = int(profile.get("energy", 0))

    if credits < cost["credits"]:
        raise HTTPException(
            status_code=400,
            detail=f"Credits tidak cukup. Butuh {cost['credits']}, punya {credits}"
        )

    if energy < cost["energy"]:
        raise HTTPException(
            status_code=400,
            detail=f"Energy tidak cukup. Butuh {cost['energy']}, punya {energy}"
        )

    resources["credits"] = credits - cost["credits"]
    profile["energy"] = energy - cost["energy"]

    profile["research"]["core"][req.research_id] = current_level + 1

    GAME_STATE["players"][player_id] = profile

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return {
        "success": True,
        "message": f"{research_template['name']} upgraded to Lv.{current_level + 1}",
        "player_id": player_id,
        "research_id": req.research_id,
        "new_level": current_level + 1,
        "cost": cost,
        "resources": profile["resources"],
        "energy": profile.get("energy", 0),
        "research": get_research_with_costs_for_profile(profile),
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

class UpgradeUnitRequest(BaseModel):
    unit_id: str


@app.post("/api/units/upgrade")
def upgrade_unit(req: UpgradeUnitRequest):
    raise HTTPException(
        status_code=410,
        detail="Endpoint lama sudah dinonaktifkan. Gunakan Train, Promote, atau Unit Tech Research."
    )

@app.post("/api/auth/telegram")
async def auth_telegram(payload: dict = Body(...)):
    await sync_state_from_db()

    user = payload.get("user") or {}

    telegram_id = str(user.get("id", "")).strip()

    if not telegram_id:
        raise HTTPException(status_code=400, detail="Telegram user id kosong")

    player_id = f"tg_{telegram_id}"

    p = GAME_STATE["player"]

    p["telegram"] = {
        "id": telegram_id,
        "username": user.get("username", ""),
        "first_name": user.get("first_name", ""),
        "last_name": user.get("last_name", ""),
        "language_code": user.get("language_code", ""),
    }

    p["player_id"] = player_id

    profile = register_or_update_telegram_player(user)

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return {
        "success": True,
        "player_id": player_id,
        "telegram": p["telegram"],
        "profile": profile,
    }

def get_player_target_asset():
    return "assets/base.webp"


def ensure_multiplayer_system():
    if "players" not in GAME_STATE or not isinstance(GAME_STATE["players"], dict):
        GAME_STATE["players"] = {}


def get_request_player_id_from_payload(payload: dict):
    user = payload.get("user") or {}
    telegram_id = str(user.get("id", "")).strip()

    if telegram_id:
        return f"tg_{telegram_id}"

    return GAME_STATE["player"].get("player_id", "dev_player")


def make_default_player_profile(player_id: str, user: dict):
    p = GAME_STATE["player"]

    username = user.get("username") or user.get("first_name") or player_id

    return {
        "player_id": player_id,
        "telegram_id": str(user.get("id", "")),
        "name": username,
        "username": user.get("username", ""),
        "first_name": user.get("first_name", ""),

        "x": p.get("x", 120),
        "y": p.get("y", 450),

        "lab_level": p.get("lab_level", 1),
        "scanner_level": p.get("scanner_level", 1),
        "scout_level": p.get("scout_level", 1),

        # ini inti PvP scout nanti
        "jammer_level": 1,
        "defense_ai_level": 1,
        "trace_monitor_level": 1,

        "defense_style": "Balanced Defense",
        "defense_build": {
            "name": "Starter Defense Grid",
            "modules": ["Firewall Core", "Trace Monitor", "Sentinel"],
        },

        "defense_units": [
            {
                "id": "breaker",
                "name": "Breaker",
                "role": "Frontline",
                "level": 1,
                "count": 30,
                "hp": 120,
                "attack": 35,
                "defense": 18,
                "speed": 7,
                "cargo": 3,
                "power": 1950,
            }
        ],

        "resources": {
            "credits": p.get("credits", 0),
            "data_shard": p.get("resources", {}).get("data_shard", 0),
            "nano_parts": p.get("resources", {}).get("nano_parts", 0),
            "nexus_core": p.get("resources", {}).get("nexus_core", 0),
        },
    }

def get_active_player_id(request: Request):
    return (
        request.headers.get("X-Player-Id")
        or GAME_STATE.get("player", {}).get("player_id")
        or "dev_player"
    )

def get_or_create_active_player_profile(request: Request):
    ensure_multiplayer_system()

    player_id = get_active_player_id(request)
    profile = GAME_STATE["players"].get(player_id)

    if not profile:
        profile = make_reset_player_profile(player_id, {
            "name": player_id,
            "username": player_id,
            "telegram_id": player_id.replace("tg_", ""),
        })
        GAME_STATE["players"][player_id] = profile

    profile = ensure_player_profile_schema(profile)
    GAME_STATE["players"][player_id] = profile

    return player_id, profile

def ensure_profile_unit_system(profile: dict):
    if "resources" not in profile or not isinstance(profile["resources"], dict):
        profile["resources"] = {}

    profile["resources"].setdefault("credits", 5000)
    profile["resources"].setdefault("data_shard", 0)
    profile["resources"].setdefault("nano_parts", 0)
    profile["resources"].setdefault("nexus_core", 0)

    if "unit_inventory" not in profile or not isinstance(profile["unit_inventory"], dict):
        profile["unit_inventory"] = {}

    # Unit tech bisa ada di profile["research"]["unit_tech"]
    if "research" not in profile or not isinstance(profile["research"], dict):
        profile["research"] = {"level": 1, "unit_tech": {}}

    if "unit_tech" not in profile["research"] or not isinstance(profile["research"]["unit_tech"], dict):
        profile["research"]["unit_tech"] = {}

    # Alias supaya kode lebih mudah
    profile["unit_tech"] = profile["research"]["unit_tech"]

    for unit_id, unit in UNITS.items():
        profile["unit_tech"].setdefault(unit_id, 1)

        current_inventory = profile["unit_inventory"].get(unit_id)

        # Migrasi dari format lama:
        # "breaker": 30
        # menjadi:
        # "breaker": {"1": 30, "2": 0, ...}
        if isinstance(current_inventory, int):
            profile["unit_inventory"][unit_id] = {
                "1": current_inventory
            }
        elif not isinstance(current_inventory, dict):
            profile["unit_inventory"][unit_id] = {}

        max_level = int(unit.get("max_level", 5))

        for level in range(1, max_level + 1):
            profile["unit_inventory"][unit_id].setdefault(str(level), 0)

    return profile

UNIT_TRAIN_BATCH_BASE_BY_LEVEL = {
    1: 50,
    2: 40,
    3: 30,
    4: 20,
    5: 50,
}

UNIT_TRAIN_PROFILE = {
    "breaker": {
        "batch_factor": 1.00,
        "type": "Infantry",
        "role": "Balanced assault unit",
        "unlock_factory_level": 1,
    },
    "ghost": {
        "batch_factor": 0.75,
        "type": "Cavalry",
        "role": "Fast raider unit",
        "unlock_factory_level": 2,
    },
    "extractor": {
        "batch_factor": 0.60,
        "type": "Carrier",
        "role": "High cargo farming unit",
        "unlock_factory_level": 3,
    },
}

def get_unit_factory_unlock_level(unit_id: str):
    profile_config = UNIT_TRAIN_PROFILE.get(unit_id, {})
    return int(profile_config.get("unlock_factory_level", 1))


def is_unit_type_unlocked_by_factory(profile: dict, unit_id: str):
    factory_level = get_profile_building_level(profile, "unit_factory")
    required_level = get_unit_factory_unlock_level(unit_id)

    return factory_level >= required_level

UNIT_FACTORY_TRAIN_BONUS_PER_LEVEL = 0.05


def get_unit_factory_training_multiplier(profile: dict):
    factory_level = get_profile_building_level(profile, "unit_factory")

    if factory_level <= 0:
        return 0

    return 1 + (max(0, factory_level - 1) * UNIT_FACTORY_TRAIN_BONUS_PER_LEVEL)


def get_unit_train_batch_limit(profile: dict, unit_id: str, unit_level: int):
    """
    Batas train per batch.
    Total owned unit tidak dibatasi.

    Dipengaruhi oleh:
    - level unit
    - level Unit Factory
    - jenis pasukan
    - unlock jenis unit dari Unit Factory
    """
    factory_level = get_profile_building_level(profile, "unit_factory")

    if factory_level <= 0:
        return 0

    if not is_unit_type_unlocked_by_factory(profile, unit_id):
        return 0

    unit_level = int(unit_level or 1)

    base_limit = UNIT_TRAIN_BATCH_BASE_BY_LEVEL.get(unit_level, 10)
    factory_multiplier = get_unit_factory_training_multiplier(profile)

    profile_config = UNIT_TRAIN_PROFILE.get(unit_id, {})
    unit_factor = float(profile_config.get("batch_factor", 1.0))

    final_limit = base_limit * factory_multiplier * unit_factor

    return max(1, int(math.ceil(final_limit)))

def get_units_for_profile(profile: dict):
    profile = ensure_profile_unit_system(profile)

    result = []

    for unit_id, unit in UNITS.items():
        unlocked_level = int(profile["unit_tech"].get(unit_id, 1))
        inventory = profile["unit_inventory"].get(unit_id, {})

        factory_unlock_level = get_unit_factory_unlock_level(unit_id)
        factory_unlocked = is_unit_type_unlocked_by_factory(profile, unit_id)
        unit_profile = UNIT_TRAIN_PROFILE.get(unit_id, {})

        levels = []

        for level in range(1, unit["max_level"] + 1):
            stats = get_unit_stats(unit_id, level)
            owned = int(inventory.get(str(level), 0))
            next_level = level + 1
            promote_to_next_unlocked = (
                next_level <= unlocked_level
                and next_level <= unit["max_level"]
            )

            train_cost = stats.get("train_cost", {})

            power = int(
                (stats["hp"] * 0.06)
                + (stats["attack"] * 2.1)
                + (stats["defense"] * 0.65)
                + (stats["speed"] * 7)
                + (stats["cargo"] * 3)
            )
            levels.append({
                "power": power,
                "promote_to_next_unlocked": promote_to_next_unlocked,
                "level": level,
                "unlocked": factory_unlocked and level <= unlocked_level,
                "factory_unlocked": factory_unlocked,
                "unlock_factory_level": factory_unlock_level,
                "owned": owned,

                "hp": stats["hp"],
                "attack": stats["attack"],
                "defense": stats["defense"],
                "speed": stats["speed"],
                "cargo": stats["cargo"],

                "train_cost": train_cost,
                "train_batch_limit": get_unit_train_batch_limit(profile, unit_id, level),
                "factory_train_multiplier": round(get_unit_factory_training_multiplier(profile), 2),
                "promote_cost": {
                    "nano_parts": 40 * (level + 1)
                },
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

def get_active_player_profile(request: Request):
    ensure_multiplayer_system()

    player_id = get_active_player_id(request)
    profile = GAME_STATE["players"].get(player_id)

    if profile:
        return player_id, profile

    return player_id, None

def register_or_update_telegram_player(user: dict):
    ensure_multiplayer_system()

    telegram_id = str(user.get("id", "")).strip()

    if not telegram_id:
        raise HTTPException(status_code=400, detail="Telegram user id kosong")

    player_id = f"tg_{telegram_id}"

    if player_id not in GAME_STATE["players"]:
        GAME_STATE["players"][player_id] = make_reset_player_profile(player_id, {
            "telegram_id": telegram_id,
            "name": user.get("username") or user.get("first_name") or player_id,
            "username": user.get("username", ""),
            "first_name": user.get("first_name", ""),
        })
    else:
        profile = GAME_STATE["players"][player_id]
        profile["username"] = user.get("username", profile.get("username", ""))
        profile["first_name"] = user.get("first_name", profile.get("first_name", ""))
        profile["name"] = user.get("username") or user.get("first_name") or profile.get("name", player_id)

    GAME_STATE["players"][player_id] = ensure_player_profile_schema(
        GAME_STATE["players"][player_id]
    )

    return GAME_STATE["players"][player_id]

@app.get("/api/debug/ping")
async def debug_ping():
    return {
        "ok": True,
        "message": "Debug API hidup"
    }


@app.get("/api/debug/players")
async def debug_players(request: Request):
    await sync_state_from_db()
    ensure_multiplayer_system()

    return {
        "header_player_id": request.headers.get("X-Player-Id"),
        "current_player_id": GAME_STATE["player"].get("player_id", "dev_player"),
        "players_count": len(GAME_STATE["players"]),
        "players": [
            {
                "player_id": player_id,
                "name": profile.get("name"),
                "telegram_id": profile.get("telegram_id"),
                "username": profile.get("username"),
                "x": profile.get("x"),
                "y": profile.get("y"),
                "jammer_level": profile.get("jammer_level"),
                "defense_ai_level": profile.get("defense_ai_level"),
            }
            for player_id, profile in GAME_STATE["players"].items()
        ],
    }


@app.post("/api/debug/seed-player")
async def seed_test_player(request: Request):
    await sync_state_from_db()
    ensure_multiplayer_system()

    attacker_id = (
        request.headers.get("X-Player-Id")
        or GAME_STATE["player"].get("player_id")
        or "dev_player"
    )

    test_player_id = "tg_test_defender"

    GAME_STATE["players"][test_player_id] = {
        "player_id": test_player_id,
        "telegram_id": "test_defender",
        "name": "Test Defender",
        "username": "test_defender",
        "first_name": "Test Defender",

        "x": 155,
        "y": 470,

        "lab_level": 6,
        "scanner_level": 3,
        "scout_level": 2,

        "jammer_level": 5,
        "defense_ai_level": 3,
        "trace_monitor_level": 4,

        "defense_style": "Jammer Defense",
        "defense_build": {
            "name": "Jammer Grid",
            "modules": ["Jammer Core", "Trace Monitor", "Firewall Core"],
        },

        "defense_units": [
            {
                "id": "sentinel",
                "name": "Sentinel",
                "role": "Defense",
                "level": 3,
                "count": 45,
                "hp": 180,
                "attack": 42,
                "defense": 55,
                "speed": 5,
                "cargo": 1,
                "power": 5200,
            }
        ],

        "resources": {
            "credits": 12000,
            "data_shard": 300,
            "nano_parts": 800,
            "nexus_core": 1,
        },
    }

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return {
        "success": True,
        "attacker_id": attacker_id,
        "seeded_player": GAME_STATE["players"][test_player_id],
        "players_count": len(GAME_STATE["players"]),
    }

@app.post("/api/admin/reset-player")
async def admin_reset_player(request: Request, payload: dict = Body(...)):
    require_admin(request)

    await sync_state_from_db()
    ensure_multiplayer_system()

    target_player_id = str(payload.get("player_id", "")).strip()
    telegram_id = str(payload.get("telegram_id", "")).strip()

    if not target_player_id and telegram_id:
        target_player_id = f"tg_{telegram_id}"

    if not target_player_id:
        raise HTTPException(
            status_code=400,
            detail="Isi player_id atau telegram_id"
        )

    old_profile = GAME_STATE["players"].get(target_player_id)

    if not old_profile:
        raise HTTPException(
            status_code=404,
            detail=f"Player tidak ditemukan: {target_player_id}"
        )

    GAME_STATE["players"][target_player_id] = make_reset_player_profile(
        target_player_id,
        old_profile,
    )

    # Bersihkan target scan lama supaya radar tidak memakai data basi
    GAME_STATE["targets"] = {}
    GAME_STATE["scan_counter"] = GAME_STATE.get("scan_counter", 0) + 1

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return {
        "success": True,
        "message": f"Player {target_player_id} berhasil direset",
        "player_id": target_player_id,
        "profile": GAME_STATE["players"][target_player_id],
    }

@app.post("/api/buildings/{building_id}/upgrade")
async def upgrade_building(building_id: str, request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)

    buildings = profile.get("buildings", {})

    if building_id not in buildings:
        raise HTTPException(status_code=404, detail="Building tidak ditemukan")

    building = buildings[building_id]

    if building.get("locked"):
        raise HTTPException(status_code=400, detail="Building masih terkunci")

    current_level = int(building.get("level", 0))
    next_level = current_level + 1

    max_level = int(BUILDING_MAX_LEVEL.get(building_id, 10))

    if current_level >= max_level:
        raise HTTPException(status_code=400, detail="Building sudah max level")

    validate_building_upgrade_requirements(
        profile=profile,
        building_id=building_id,
        current_level=current_level,
        next_level=next_level,
    )

    cost = get_building_upgrade_cost(building_id, current_level)

    profile = require_and_pay_resources(profile, cost)
    resources = profile["resources"]

    building["level"] = next_level

    if building_id == "main_lab":
        profile["lab_level"] = next_level

    if building_id == "radar_tower":
        profile["scanner_level"] = next_level
        profile["scout_level"] = next_level

    if building_id == "ai_core":
        profile["ai_core_level"] = next_level

    profile["resources"] = resources
    profile["buildings"][building_id] = building
    profile = apply_building_unlocks(profile)
    GAME_STATE["players"][player_id] = profile

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)
    action_text = "dibangun" if current_level == 0 else f"naik ke Lv.{next_level}"

    return {
        "success": True,
        "message": f"{building['name']} berhasil {action_text}",
        "player_id": player_id,
        "building_id": building_id,
        "building": building,
        "new_level": next_level,
        "cost": cost,
        "resources": profile["resources"],
        "energy": profile.get("energy", 0),
        "profile_levels": {
            "lab_level": profile.get("lab_level", 1),
            "scanner_level": profile.get("scanner_level", 1),
            "scout_level": profile.get("scout_level", 1),
            "ai_core_level": profile.get("ai_core_level", 1),
        },
    }

@app.post("/api/onboarding/complete")
async def complete_onboarding(req: OnboardingCompleteRequest, request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)

    commander_name = req.commander_name.strip()

    if len(commander_name) < 3:
        raise HTTPException(status_code=400, detail="Commander name minimal 3 karakter")

    blocked_words = ["admin", "owner", "system", "moderator"]

    if commander_name.lower() in blocked_words:
        raise HTTPException(status_code=400, detail="Nama ini tidak bisa dipakai")

    profile["language"] = req.language
    profile["commander_name"] = commander_name
    profile["name"] = commander_name
    profile["onboarding_complete"] = True
    profile["registered_at"] = profile.get("registered_at") or int(time.time())

    if req.referral_code:
        profile["referral_by"] = req.referral_code.strip()

    if not profile.get("referral_code"):
        profile["referral_code"] = f"CC{str(profile.get('telegram_id') or player_id)[-6:]}"

    GAME_STATE["players"][player_id] = profile

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return {
        "success": True,
        "message": f"Welcome Commander {commander_name}",
        "player_id": player_id,
        "profile": {
            "player_id": player_id,
            "commander_name": profile["commander_name"],
            "language": profile["language"],
            "referral_code": profile["referral_code"],
            "registered_at": profile["registered_at"],
            "onboarding_complete": profile["onboarding_complete"],
        }
    }

@app.get("/api/ai-core")
async def get_ai_core(request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_ai_system(profile)

    slot_limit = get_ai_slot_limit_for_profile(profile)

    active_ai = profile.get("active_ai", [])[:slot_limit]

    return {
        "player_id": player_id,
        "ai_core_level": slot_limit,
        "owned_ai": profile["owned_ai"],
        "active_ai": active_ai,
        "ai_agents": get_ai_agents_for_profile(profile),
        "active_ai_buffs": get_effective_ai_buffs(active_ai),
        "max_slot": slot_limit,
    }


@app.post("/api/ai-core/active")
async def set_active_ai(req: SetActiveAiRequest, request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_ai_system(profile)

    slot_limit = get_ai_slot_limit_for_profile(profile)

    clean_active = []
    for ai_id in req.active_ai:
        ai_id = str(ai_id).strip()

        if ai_id not in AI_AGENTS:
            raise HTTPException(status_code=404, detail=f"AI tidak ditemukan: {ai_id}")

        if ai_id not in profile["owned_ai"]:
            raise HTTPException(status_code=400, detail=f"AI belum dimiliki: {ai_id}")

        if ai_id not in clean_active:
            clean_active.append(ai_id)

    if len(clean_active) > slot_limit:
        raise HTTPException(
            status_code=400,
            detail=f"AI Core hanya punya {slot_limit} slot aktif"
        )

    profile["active_ai"] = clean_active

    GAME_STATE["players"][player_id] = profile

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return {
        "success": True,
        "player_id": player_id,
        "active_ai": profile["active_ai"],
        "active_ai_buffs": get_effective_ai_buffs(profile["active_ai"]),
        "max_slot": slot_limit,
        "ai_agents": get_ai_agents_for_profile(profile),
    }

@app.get("/api/defense")
async def get_defense_setup(request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)
    profile = ensure_profile_ai_system(profile)

    allowed_modules = [
        "Firewall Core",
        "Trace Monitor",
        "Sentinel",
        "Jammer Core",
        "Trap Net",
        "Repair Node",
        "Vault Guard",
    ]

    return {
        "player_id": player_id,
        "defense": {
            "defense_style": profile.get("defense_style", "Balanced Defense"),
            "defense_build": profile.get("defense_build", {
                "name": "Starter Defense Grid",
                "modules": ["Firewall Core", "Trace Monitor", "Sentinel"],
            }),
            "defense_units": profile.get("defense_units", []),
            "stats": get_defense_stats_for_profile(profile),
            "allowed_modules": allowed_modules,
        }
    }


@app.post("/api/defense")
async def save_defense_setup(req: DefenseSetupRequest, request: Request):
    await sync_state_from_db()

    player_id, profile = get_or_create_active_player_profile(request)
    profile = ensure_player_profile_schema(profile)

    allowed_modules = {
        "Firewall Core",
        "Trace Monitor",
        "Sentinel",
        "Jammer Core",
        "Trap Net",
        "Repair Node",
        "Vault Guard",
    }

    modules = []

    for module in req.modules:
        if module in allowed_modules and module not in modules:
            modules.append(module)

    if not modules:
        modules = ["Firewall Core", "Trace Monitor", "Sentinel"]

    profile["defense_style"] = req.defense_style.strip() or "Balanced Defense"
    profile["defense_build"] = {
        "name": profile["defense_style"],
        "modules": modules,
    }

    GAME_STATE["players"][player_id] = profile

    await save_game_state(copy.deepcopy(GAME_STATE), PLAYER_ID)

    return {
        "success": True,
        "message": "Defense build saved",
        "player_id": player_id,
        "defense": {
            "defense_style": profile["defense_style"],
            "defense_build": profile["defense_build"],
            "stats": get_defense_stats_for_profile(profile),
        }
    }

@app.middleware("http")
async def add_cache_headers(request: Request, call_next):
    response = await call_next(request)

    path = request.url.path.lower()

    if path.endswith((".webp", ".png", ".jpg", ".jpeg", ".svg", ".css", ".js", ".ico")):
        response.headers["Cache-Control"] = "public, max-age=604800"

    return response

# WAJIB PALING BAWAH
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:
    print(f"[WARNING] Frontend folder not found: {FRONTEND_DIR}")