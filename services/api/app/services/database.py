"""Private server connection. Never send these headers or upstream errors to React."""
import httpx

from app.core.config import settings


class DatabaseError(Exception):
    def __init__(self, status_code=503, code=None):
        self.status_code = status_code
        self.code = code
        super().__init__('No se pudo acceder a la base de datos.')


class Database:
    def __init__(self):
        self.client = None

    async def open(self):
        headers = {'apikey': settings.SUPABASE_SECRET_KEY}
        if settings.SUPABASE_SECRET_KEY.startswith('eyJ'):
            headers['Authorization'] = f'Bearer {settings.SUPABASE_SECRET_KEY}'
        self.client = httpx.AsyncClient(
            base_url=f'{settings.SUPABASE_URL}/rest/v1/', headers=headers,
            timeout=httpx.Timeout(30, connect=10),
        )

    async def close(self):
        if self.client:
            await self.client.aclose()

    async def request(self, method, table, *, params=None, data=None, prefer=None):
        if not settings.database_configured or self.client is None:
            raise DatabaseError()
        try:
            response = await self.client.request(
                method, table, params=params, json=data,
                headers={'Prefer': prefer or 'return=representation'},
            )
            if response.is_error:
                try:
                    code = response.json().get('code')
                except ValueError:
                    code = None
                raise DatabaseError(response.status_code, code)
            return response.json() if response.content else []
        except (httpx.HTTPError, ValueError) as exc:
            raise DatabaseError() from exc

    async def page(self, table, *, params):
        if self.client is None or not settings.database_configured:
            raise DatabaseError()
        try:
            response = await self.client.get(table, params=params, headers={'Prefer':'count=exact'})
            if response.is_error:
                raise DatabaseError(response.status_code)
            total = response.headers.get('content-range', '*/0').split('/')[-1]
            return response.json(), int(total) if total.isdigit() else None
        except (httpx.HTTPError, ValueError) as exc:
            raise DatabaseError() from exc


database = Database()
