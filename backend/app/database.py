from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
if settings.database_url.startswith("sqlite:///") and not settings.database_url.startswith("sqlite:////"):
    Path(settings.database_url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
database_url = settings.database_url
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
elif database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
engine = create_engine(database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def migrate_schema() -> None:
    inspector = inspect(engine)
    if "campaigns" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("campaigns")}
        if "account_id" not in columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE campaigns ADD COLUMN account_id VARCHAR(255)"))
        with engine.begin() as connection:
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_campaigns_account_id ON campaigns (account_id)"))
