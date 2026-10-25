
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / '.env')


class Settings:
    APP_NAME = 'Sistema Empresarial de Monitoreo Sísmico'
    APP_VERSION = '0.2.0'
    API_PREFIX = '/api/v1'
    DEBUG = os.getenv('DEBUG', 'false').lower() == 'true'
    SYNC_CRON_SECRET = os.getenv('SYNC_CRON_SECRET', '')
    SUPABASE_URL = os.getenv('SUPABASE_URL', '').rstrip('/')
    SUPABASE_SECRET_KEY = os.getenv('SUPABASE_SECRET_KEY', '')
    SYNC_INTERVAL_SECONDS = max(300, int(os.getenv('SYNC_INTERVAL_SECONDS', '300')))
    CATALOG_DAYS = max(1, min(365, int(os.getenv('CATALOG_DAYS', '30'))))
    RUN_BACKGROUND_SYNC = os.getenv('VERCEL') != '1'
    CORS_ORIGINS = os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',')
    AUTH_COOKIE_SECURE = os.getenv('AUTH_COOKIE_SECURE', 'true').lower() == 'true'
    FIREBASE_PROJECT_ID = os.getenv('FIREBASE_PROJECT_ID', 'sismocore-5af68')
    FIREBASE_SERVICE_ACCOUNT_JSON = os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON', '')
    PUBLIC_APP_URL = os.getenv('PUBLIC_APP_URL','https://sismocore.vercel.app').rstrip('/')
    TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID','')
    TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN','')
    TWILIO_FROM_NUMBER = os.getenv('TWILIO_FROM_NUMBER','')

    @property
    def database_configured(self):
        return bool(self.SUPABASE_URL and self.SUPABASE_SECRET_KEY)


settings = Settings()
