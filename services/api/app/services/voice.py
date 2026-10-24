"""Trial-only, fixed-message voice tests. Never automatically retry call creation."""
import hashlib
import hmac
import re
from urllib.parse import urlparse
import httpx
from app.core.config import settings

STATES={'queued','initiated','ringing','in-progress','completed','busy','failed','no-answer','canceled'}


class VoiceError(Exception):
    def __init__(self,code='CONEXION'):
        self.code=code
        super().__init__('No se pudo confirmar la operación de voz.')


class VoiceProvider:
    @property
    def configured(self):
        return bool(re.fullmatch(r'AC[0-9a-fA-F]{32}',settings.TWILIO_ACCOUNT_SID) and
            re.fullmatch(r'[0-9a-fA-F]{32}',settings.TWILIO_AUTH_TOKEN) and
            re.fullmatch(r'\+[1-9][0-9]{7,14}',settings.TWILIO_FROM_NUMBER))

    @property
    def account_hash(self):
        return hashlib.sha256(settings.TWILIO_ACCOUNT_SID.encode()).hexdigest()

    def recipient_id(self,phone):
        return hmac.new(settings.TWILIO_AUTH_TOKEN.encode(),phone.encode(),hashlib.sha256).hexdigest()

    async def request(self,method,resource='',*,data=None,params=None):
        if not self.configured: raise VoiceError('SIN_CONFIGURACION')
        url=f'https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}{resource}'
        try:
            async with httpx.AsyncClient(auth=(settings.TWILIO_ACCOUNT_SID,settings.TWILIO_AUTH_TOKEN),timeout=httpx.Timeout(15,connect=5)) as client:
                response=await client.request(method,url,data=data,params=params)
            if response.is_error:
                try: code=response.json().get('code')
                except (ValueError,AttributeError): code=None
                raise VoiceError(str(code) if isinstance(code,int) else 'PROVEEDOR')
            payload=response.json()
            if not isinstance(payload,dict): raise VoiceError('RESPUESTA_INVALIDA')
            return payload
        except (httpx.HTTPError,ValueError,TypeError) as failure:
            raise VoiceError('CONEXION') from failure

    async def check_trial(self):
        account=await self.request('GET','.json')
        if account.get('sid')!=settings.TWILIO_ACCOUNT_SID: raise VoiceError('RESPUESTA_INVALIDA')
        if account.get('type')!='Trial': raise VoiceError('CUENTA_NO_TRIAL')
        if account.get('status')!='active': raise VoiceError('CUENTA_INACTIVA')

    async def recipients(self):
        await self.check_trial()
        verified=await self.request('GET','/OutgoingCallerIds.json',params={'PageSize':50})
        calls=await self.request('GET','/Calls.json',params={'PageSize':50})
        if not isinstance(verified.get('outgoing_caller_ids',[]),list) or not isinstance(calls.get('calls',[]),list):
            raise VoiceError('RESPUESTA_INVALIDA')
        numbers={row.get('phone_number') for row in verified.get('outgoing_caller_ids',[]) if isinstance(row,dict)}
        # New Trial's console verification is not always listed as a classic Caller ID.
        # A completed outbound Trial call from this sender is also provider evidence.
        numbers.update(row.get('to') for row in calls.get('calls',[]) if isinstance(row,dict)
            and row.get('status')=='completed' and row.get('from')==settings.TWILIO_FROM_NUMBER
            and row.get('direction') in ('outbound-api','outbound-dial'))
        return {self.recipient_id(phone):phone for phone in numbers
            if isinstance(phone,str) and re.fullmatch(r'\+51[0-9]{9}',phone)}

    async def call(self,phone):
        return await self._create_call(phone,self._origin()+'/api/v1/voz/prueba.xml')

    async def verify_phone(self,phone):
        await self.check_trial()
        if not re.fullmatch(r'\+51[0-9]{9}',phone):raise VoiceError('21219')
        payload=await self.request('POST','/OutgoingCallerIds.json',data={'PhoneNumber':phone})
        if (payload.get('account_sid')!=settings.TWILIO_ACCOUNT_SID or payload.get('phone_number')!=phone
            or not re.fullmatch(r'[0-9]{6}',str(payload.get('validation_code','')))
            or not re.fullmatch(r'CA[0-9a-fA-F]{32}',str(payload.get('call_sid','')))):
            raise VoiceError('RESPUESTA_INVALIDA')
        return {'codigo':str(payload['validation_code']),'sid':payload['call_sid']}

    def _origin(self):
        origin=urlparse(settings.PUBLIC_APP_URL)
        if origin.scheme!='https' or not origin.netloc or origin.path or origin.query or origin.fragment or origin.username or origin.password:
            raise VoiceError('URL_INVALIDA')
        return settings.PUBLIC_APP_URL

    def event_signature(self,delivery,authorization):
        return hmac.new(settings.TWILIO_AUTH_TOKEN.encode(),f'voz-evento:{delivery}:{authorization}'.encode(),hashlib.sha256).hexdigest()

    async def call_event(self,phone,delivery,authorization):
        signature=self.event_signature(delivery,authorization)
        return await self._create_call(phone,f'{self._origin()}/api/v1/voz/eventos/{delivery}.xml?clave={authorization}&firma={signature}')

    async def _create_call(self,phone,url):
        await self.check_trial()
        if not re.fullmatch(r'\+51[0-9]{9}',phone): raise VoiceError('21219')
        payload=await self.request('POST','/Calls.json',data={
            'To':phone,'From':settings.TWILIO_FROM_NUMBER,'Url':url,
        })
        if not re.fullmatch(r'CA[0-9a-fA-F]{32}',str(payload.get('sid',''))) or payload.get('status') not in STATES:
            raise VoiceError('RESPUESTA_INVALIDA')
        return {'sid':payload['sid'],'estado':payload['status']}

    async def status(self,sid):
        if not re.fullmatch(r'CA[0-9a-fA-F]{32}',sid): raise VoiceError('RESPUESTA_INVALIDA')
        payload=await self.request('GET',f'/Calls/{sid}.json')
        if payload.get('sid')!=sid or payload.get('status') not in STATES: raise VoiceError('RESPUESTA_INVALIDA')
        return payload['status']


voice_provider=VoiceProvider()
