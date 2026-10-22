
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / '.env')


class Settings:
    APP_NAME = 'Sistema Empresarial de Monitoreo Sísmico'
    APP_VERSION = '0.2.0'
    API_PREFIX = '/api/v1'
    DEBUG = os.getenv('DEBUG', 'false').lower() == 'true'
    SUPABASE_URL = os.getenv('SUPABASE_URL', '').rstrip('/')
    SUPABASE_SECRET_KEY = os.getenv('SUPABASE_SECRET_KEY', '')
    SYNC_INTERVAL_SECONDS = max(60, int(os.getenv('SYNC_INTERVAL_SECONDS', '300')))
    CORS_ORIGINS = os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',')
    AUTH_COOKIE_SECURE = os.getenv('AUTH_COOKIE_SECURE', 'true').lower() == 'true'

    @property
    def database_configured(self):
        return bool(self.SUPABASE_URL and self.SUPABASE_SECRET_KEY)


settings = Settings()
