"""Interactive account provisioning. Credentials are read from stdin, never saved."""
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services' / 'api'))
import httpx
from app.core.config import settings


def main():
    email = input('Correo: ').strip()
    password = getpass.getpass('Contraseña: ') if sys.stdin.isatty() else sys.stdin.readline().rstrip('\r\n')
    if '@' not in email or len(password) < 12:
        raise RuntimeError('Se requiere un correo válido y una contraseña de al menos 12 caracteres.')
    if not settings.database_configured:
        raise RuntimeError('Falta la configuración privada de Supabase.')
    headers = {'apikey': settings.SUPABASE_SECRET_KEY}
    if settings.SUPABASE_SECRET_KEY.startswith('eyJ'):
        headers['Authorization'] = f'Bearer {settings.SUPABASE_SECRET_KEY}'
    with httpx.Client(base_url=settings.SUPABASE_URL, headers=headers, timeout=30) as client:
        existing = None
        for page in range(1, 101):
            result = client.get('/auth/v1/admin/users', params={'page': page, 'per_page': 100})
            if result.is_error:
                raise RuntimeError('No se pudieron consultar las cuentas de Supabase.')
            users = result.json().get('users', [])
            existing = next((user for user in users if user.get('email', '').lower() == email.lower()), None)
            if existing or len(users) < 100:
                break
        payload = {'email': email, 'password': password, 'email_confirm': True}
        result = client.put(f'/auth/v1/admin/users/{existing["id"]}', json=payload) if existing else client.post('/auth/v1/admin/users', json=payload)
        del password, payload
        if result.is_error:
            raise RuntimeError(f'No se pudo preparar la cuenta en Supabase (HTTP {result.status_code}).')
        user_id = result.json()['id']
        # The application owner's explicitly provisioned account is active administrator.
        result = client.patch('/rest/v1/perfiles', params={'id': f'eq.{user_id}'},
            json={'rol': 'administrador', 'estado': 'activo'}, headers={'Prefer': 'return=representation'})
        if result.is_error or not result.json():
            raise RuntimeError('La cuenta existe, pero no se pudo activar su perfil.')
        print('Cuenta de Supabase preparada. Perfil activo de administrador. No se guardaron credenciales.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, httpx.HTTPError) as exc:
        print(str(exc) if isinstance(exc, RuntimeError) else 'No se pudo contactar con Supabase.', file=sys.stderr)
        sys.exit(1)
