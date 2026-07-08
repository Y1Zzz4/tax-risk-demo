import os
from functools import lru_cache

from dotenv import load_dotenv


load_dotenv()


class Settings:
    app_name: str = "企业风险核查智能体"
    deepseek_api_key: str | None
    deepseek_base_url: str
    deepseek_model: str
    request_timeout_seconds: float

    def __init__(self) -> None:
        self.deepseek_api_key = os.getenv("DEEPSEEK_API_KEY") or None
        self.deepseek_base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
        self.deepseek_model = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-pro")
        self.request_timeout_seconds = float(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "60"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
