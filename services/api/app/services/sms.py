"""Trial SMS templates only. No custom content, automatic sends or retries."""
import re
from app.services.voice import voice_provider,VoiceError
from app.core.config import settings

SMS_STATES={'accepted','queued','sending','sent','delivered','undelivered','failed','canceled'}
TEMPLATE='sms_appointment_reminders'


class SmsProvider:
    @property
    def configured(self):return voice_provider.configured
    @property
    def account_hash(self):return voice_provider.account_hash
    async def recipients(self):
        numbers=await voice_provider.recipients()
        payload=await voice_provider.request('GET','/Messages.json',params={'PageSize':50})
        rows=payload.get('messages',[])
        if not isinstance(rows,list):raise VoiceError('RESPUESTA_INVALIDA')
        for row in rows:
            phone=row.get('to') if isinstance(row,dict) else None
            if isinstance(phone,str) and re.fullmatch(r'\+519[0-9]{8}',phone) and row.get('status')=='delivered' and row.get('direction')=='outbound-api':
                numbers[voice_provider.recipient_id(phone)]=phone
        return numbers
    async def send_test(self,phone):
        await voice_provider.check_trial()
        if not re.fullmatch(r'\+519[0-9]{8}',phone):raise VoiceError('DESTINO_INVALIDO')
        # Match the request shown by this account's Try out SMS console.
        payload=await voice_provider.request('POST','/Messages.json',data={
            'To':phone,'From':settings.TWILIO_FROM_NUMBER,'Body':TEMPLATE})
        return self._result(payload)
    async def status(self,sid):
        if not re.fullmatch(r'SM[0-9a-fA-F]{32}',sid):raise VoiceError('RESPUESTA_INVALIDA')
        result=self._result(await voice_provider.request('GET',f'/Messages/{sid}.json'))
        if result['sid']!=sid:raise VoiceError('RESPUESTA_INVALIDA')
        return result['estado']
    def _result(self,payload):
        if not re.fullmatch(r'SM[0-9a-fA-F]{32}',str(payload.get('sid',''))) or payload.get('status') not in SMS_STATES:
            raise VoiceError('RESPUESTA_INVALIDA')
        return {'sid':payload['sid'],'estado':payload['status']}


sms_provider=SmsProvider()
