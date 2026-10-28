from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./recruiterreach.db"
    frontend_origin: str = "http://localhost:3000"
    supabase_url: str | None = None
    brave_search_api_key: str | None = None
    hunter_api_key: str | None = None
    max_campaign_recipients: int = 10
    max_job_page_bytes: int = 2_000_000

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", env_ignore_empty=True)


settings = Settings()
