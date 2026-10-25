"""Short-lived, signed snapshots of public IGP observations for manual presentations."""
import base64
import hashlib
import hmac
import json
import math
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlencode
from uuid import UUID
from app.services.database import database


def context(event):
    def number(name, maximum):
        value=event[name]
        if isinstance(value,bool) or not isinstance(value,(float,int)) or not math.isfinite(value) or not 0<=value<=maximum:
            raise ValueError('Dato de evento inválido')
        return float(value)
    occurred=datetime.fromisoformat(event['ocurrido_en'].replace('Z','+00:00'))
    if occurred.tzinfo is None or not isinstance(event['lugar'],str) or not event['lugar'].strip():
        raise ValueError('Evento incompleto')
    if not re.fullmatch(r'\d{4}-\d{1,5}',event['id_externo']): raise ValueError('Código IGP inválido')
    result={'id':str(UUID(event['id'])),'id_externo':event['id_externo'],
        'magnitud':number('magnitud',10),'profundidad':number('profundidad',1000),
        'lugar':event['lugar'][:200],'ocurrido_en':occurred.astimezone(timezone.utc).isoformat()}
    result['huella']=hashlib.sha256(json.dumps(result,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return result


async def latest_event():
    rows=await database.request('GET','eventos_sismicos',params={
        'select':'id,id_externo,magnitud,profundidad,lugar,ocurrido_en,fuente:fuentes_datos!inner(codigo)',
        'fuente.codigo':'eq.igp','ocurrido_en':'lte.'+datetime.now(timezone.utc).isoformat(),
        'order':'ocurrido_en.desc,id.desc','limit':'1'})
    if not rows: return None
    try: return context(rows[0])
    except (ValueError,KeyError,TypeError): return None


def snapshot_url(origin, key, event):
    event=context(event)
    payload=json.dumps({'evento':event,'expira':int(time.time())+600},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
    data=base64.urlsafe_b64encode(payload).decode().rstrip('=')
    signature=hmac.new(key.encode(),('voz-catalogo-v1:'+data).encode(),hashlib.sha256).hexdigest()
    return origin+'/api/v1/voz/catalogo.xml?'+urlencode({'datos':data,'firma':signature})


def read_snapshot(data, signature, key):
    if len(data)>1800 or not re.fullmatch('[A-Za-z0-9_-]+',data): raise ValueError('Contenido inválido')
    expected=hmac.new(key.encode(),('voz-catalogo-v1:'+data).encode(),hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected,signature): raise ValueError('Firma inválida')
    value=json.loads(base64.urlsafe_b64decode(data+'='*(-len(data)%4)))
    expiry=value['expira']
    if not isinstance(expiry,int) or not int(time.time())<=expiry<=int(time.time())+600:
        raise ValueError('Contenido caducado')
    return context(value['evento'])
