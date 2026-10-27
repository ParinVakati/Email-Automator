from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_access_token: str = "change-me-before-use"
    database_url: str = "sqlite:///./recruiterreach.db"
    frontend_origin: str = "http://localhost:3000"
    brave_search_api_key: str | None = None
    hunter_api_key: str | None = None
    max_campaign_recipients: int = 10
    max_job_page_bytes: int = 2_000_000

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
