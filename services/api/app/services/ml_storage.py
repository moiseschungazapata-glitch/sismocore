"""Private JSON snapshots and model artifacts. Never load executable pickle data."""
import hashlib
import json
import re
import httpx
from app.core.config import settings

MAX_BYTES=4_000_000


class ArtifactError(Exception):
    pass


def encode(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def url(path):
    if not isinstance(path,str) or not re.fullmatch(r'(datasets|modelos)/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.json',path): raise ArtifactError('Ruta de artefacto inválida.')
    return settings.SUPABASE_URL+'/storage/v1/object/sismocore-privado/'+path


def headers():
    value={'apikey':settings.SUPABASE_SECRET_KEY}
    if settings.SUPABASE_SECRET_KEY.startswith('eyJ'):value['Authorization']='Bearer '+settings.SUPABASE_SECRET_KEY
    return value


async def upload(path,value):
    data=encode(value)
    if len(data)>MAX_BYTES:raise ArtifactError('El archivo supera el límite permitido.')
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            result=await client.post(url(path),content=data,headers={**headers(),'Content-Type':'application/json','x-upsert':'false'})
        if result.is_error:raise ArtifactError('No se pudo guardar el archivo privado en Supabase Storage.')
    except httpx.HTTPError:raise ArtifactError('Storage no está disponible.') from None
    return digest(data)


async def download(path,expected_hash):
    try:
        data=bytearray()
        async with httpx.AsyncClient(timeout=30) as client:
            async with client.stream('GET',url(path),headers=headers()) as response:
                if response.is_error:raise ArtifactError('El archivo privado no está disponible.')
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data)>MAX_BYTES:raise ArtifactError('Archivo demasiado grande.')
        if digest(data)!=expected_hash:raise ArtifactError('El archivo no coincide con su huella registrada.')
        return json.loads(data)
    except (httpx.HTTPError,ValueError):raise ArtifactError('No se pudo validar el archivo privado.') from None
