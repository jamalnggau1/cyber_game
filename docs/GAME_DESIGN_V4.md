# CyberCore Lab Prototype v4 - Design Snapshot

## Core
- Cyber strategy RPG untuk Telegram Mini App.
- 2D cyber map, bukan 3D.
- Serangan mengikuti jarak map, tidak ada quick/planned mode.
- Speed bisa ditingkatkan lewat module, riset lab, AI buff, guild relay.

## Scout
- Deep Scout dihapus.
- Semua data target dibuka lewat Scout level.
- Scout awal tetap memberi petunjuk kasar seperti Clash of Clans:
  - Lab tier
  - Signal strength
  - Vault signal
  - Visible structure
- Estimated power dan detail defense tetap terkunci sampai Scout level tinggi.

## AI Agent
- AI bukan penyerang utama.
- AI = analisis + buff + battle log + learning.
- Player awal dapat NOVA-Lite.
- AI kategori:
  - HEX = Attack AI
  - SENTRY = Defense AI
  - REBOOT = Recovery AI
  - ORA = Scout/Intel AI
  - ECHO = Rally/Guild AI
  - KAI = Support/Economy AI
- Buff harus terlihat jelas di UI.
- AI slot dibatasi oleh AI Core level.
- AI tidak bisa analisis akurat jika data Scout kurang.
- AI learning awal berupa XP/stat system, bukan training ML sungguhan.

## Unit Loss
- Equipment/module tidak rusak.
- Yang hilang saat gagal attack adalah cyber unit/pasukan:
  - Breaker Unit
  - Ghost Unit
  - Probe Unit
  - Payload Unit
  - Relay Unit
  - Extractor Unit
- Defense juga punya unit:
  - Guard Unit
  - Trace Unit
  - Sentinel Unit
  - Trap Unit
  - Repair Unit
  - Vault Guard
- Unit bisa destroyed atau disabled.
- Disabled masuk recovery, destroyed harus dibuat ulang.

## Guild Buildings
- MVP memakai card/list/2D icon.
- Guild lawan tidak harus 3D.
- Guild lawan muncul sebagai target struktur strategis:
  - Relay Tower
  - Firewall Core
  - Guild Radar
  - Guild Vault
  - War Room
- Bangunan guild lawan lebih baik disabled sementara, bukan hancur permanen.