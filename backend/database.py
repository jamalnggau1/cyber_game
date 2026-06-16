import os
import json
from dotenv import load_dotenv
from sqlalchemy import Column, String, Text, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base

load_dotenv()

PLAYER_ID = os.getenv("PLAYER_ID", "global_state")


def normalize_database_url(url: str) -> str:
    url = (url or "").strip()

    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    # Neon / Vercel preview: asyncpg lebih aman tanpa channel_binding
    url = url.replace("&channel_binding=require", "")
    url = url.replace("?channel_binding=require&", "?")
    url = url.replace("?channel_binding=require", "")

    # Kalau dari dashboard Neon masih sslmode=require, ubah ke ssl=require
    url = url.replace("sslmode=require", "ssl=require")

    return url


DATABASE_URL = normalize_database_url(
    os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./cybercore_lab.db")
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
)

Base = declarative_base()


class PlayerState(Base):
    __tablename__ = "player_state"

    player_id = Column(String, primary_key=True)
    state_json = Column(Text, nullable=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def load_game_state(player_id: str = PLAYER_ID):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(PlayerState).where(PlayerState.player_id == player_id)
        )
        row = result.scalar_one_or_none()

        if not row:
            return None

        return json.loads(row.state_json)


async def save_game_state(state: dict, player_id: str = PLAYER_ID):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(PlayerState).where(PlayerState.player_id == player_id)
        )
        row = result.scalar_one_or_none()

        state_text = json.dumps(state, ensure_ascii=False)

        if row:
            row.state_json = state_text
        else:
            row = PlayerState(
                player_id=player_id,
                state_json=state_text,
            )
            session.add(row)

        await session.commit()