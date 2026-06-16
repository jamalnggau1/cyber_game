import os
import json
from datetime import datetime, timezone

from dotenv import load_dotenv
from sqlalchemy import (
    MetaData,
    Table,
    Column,
    String,
    Text,
    DateTime,
    select,
    insert,
    update,
)
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker


load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./cybercore_lab.db")
PLAYER_ID = os.getenv("PLAYER_ID", "dev_player")

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
)

metadata = MetaData()

player_state = Table(
    "player_state",
    metadata,
    Column("player_id", String(80), primary_key=True),
    Column("state_json", Text, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(metadata.create_all)


async def load_game_state(player_id: str = PLAYER_ID):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(player_state.c.state_json)
            .where(player_state.c.player_id == player_id)
        )

        raw = result.scalar_one_or_none()

        if not raw:
            return None

        return json.loads(raw)


async def save_game_state(state: dict, player_id: str = PLAYER_ID):
    raw = json.dumps(state, ensure_ascii=False, default=str)
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(player_state.c.player_id)
            .where(player_state.c.player_id == player_id)
        )

        exists = result.scalar_one_or_none()

        if exists:
            await session.execute(
                update(player_state)
                .where(player_state.c.player_id == player_id)
                .values(
                    state_json=raw,
                    updated_at=now,
                )
            )
        else:
            await session.execute(
                insert(player_state)
                .values(
                    player_id=player_id,
                    state_json=raw,
                    updated_at=now,
                )
            )

        await session.commit()