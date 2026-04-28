from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database (set via DATABASE_URL env var or .env file)
    database_url: str = "postgresql+asyncpg://finpulse_user:changeme@localhost:5432/finpulse"

    # API Keys
    fmp_api_key: str = ""
    openai_api_key: str = ""
    github_token: str = ""  # for GitHub Models (free AI inference)

    # Behaviour
    price_refresh_interval: int = 15  # minutes
    ai_cache_hours: int = 6
    ai_language: str = "bg"

    # Known tickers (for startup preload of chart history)
    known_tickers: list[str] = [
        "QYLD", "BHP", "CNQ", "DIV", "SPHD",
        "SXR8.DE", "ET", "PSEC", "VTI", "IBM", "RKLB",
    ]


settings = Settings()
