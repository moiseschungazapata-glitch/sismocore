"""Validate a real recovery link without sending email or changing the password."""
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import parse_qs, urlparse

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'services' / 'api'))
import httpx
from app.core.config import settings

email = input('Correo de prueba: ').strip()
headers = {'apikey': settings.SUPABASE_SECRET_KEY}
if settings.SUPABASE_SECRET_KEY.startswith('eyJ'):
    headers['Authorization'] = f'Bearer {settings.SUPABASE_SECRET_KEY}'
with httpx.Client(base_url=settings.SUPABASE_URL, headers=headers, timeout=30) as client:
    result = client.post('/auth/v1/admin/generate_link',
        params={'redirect_to': 'http://localhost:5173/index/restablecer'},
        json={'type': 'recovery', 'email': email})
if result.is_error:
    sys.exit('No se pudo generar el enlace de prueba en Supabase.')
link = result.json().get('action_link')
if not link or parse_qs(urlparse(link).query).get('redirect_to') != ['http://localhost:5173/index/restablecer']:
    sys.exit('Supabase no está usando la dirección de recuperación esperada.')
env = {**os.environ, 'RECOVERY_TEST_LINK': link}
node = Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'nodejs' / 'node.exe'
result = subprocess.run([str(node), 'scripts/recovery-link-smoke.mjs'], cwd=root, env=env)
sys.exit(result.returncode)
