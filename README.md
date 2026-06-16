# Cyber Game

Prototype awal game Telegram Mini App bertema cyber strategy RPG.

## Fitur MVP

- Map koordinat player
- Radar Scan berdasarkan scanner level
- Scout target dengan data terkunci berdasarkan Scout level
- Build/module serangan 6 slot
- Cyber Unit / pasukan
- AI Agent kategori:
  - NOVA-Lite = starter
  - HEX = Attack AI
  - SENTRY = Defense AI
  - REBOOT = Recovery AI
  - ORA = Scout/Intel AI
  - ECHO = Rally/Guild AI
  - KAI = Support/Economy AI
- Buff AI Agent terlihat jelas
- Serangan pakai waktu berdasarkan jarak
- Battle log animasi cyber-simulation
- Defense AI lawan bisa jamming/shield secara simulasi
- Unit bisa hancur/disabled, module tidak rusak

## Cara menjalankan

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux/Mac
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload
```

Buka:

```text
http://127.0.0.1:8000
```

## Catatan

Ini masih MVP lokal. Data masih in-memory, belum pakai database.
Tujuannya untuk melihat flow game dulu sebelum dibuat lebih besar.