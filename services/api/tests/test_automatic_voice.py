import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, PropertyMock, patch
from xml.etree import ElementTree
import httpx

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from main import app
from app.services.auth import require_user
from app.services.voice import voice_provider, VoiceProvider, VoiceError
from app.services.automatic_voice import event_twiml,process_automatic_calls
from app.services.alerts import process_alerts
from app.api.routes.auth import attempts

ACTOR='11111111-1111-4111-8111-111111111111'
REF='22222222-2222-4222-8222-222222222222'
DELIVERY='33333333-3333-4333-8333-333333333333'
DEST='a'*64
CONTEXT={'magnitud':4.5,'lugar':'Cerca de Lima','ocurrido_en':'2026-10-24T12:30:00Z'}


class MessageTests(unittest.TestCase):
    def test_observed_event_spanish_time_and_escaping(self):
        xml=event_twiml({**CONTEXT,'lugar':'<Dial>malicioso</Dial> & Lima'})
        root=ElementTree.fromstring(xml)
        self.assertEqual([node.tag for node in root],['Say','Hangup'])
        text=root.find('Say').text
        for phrase in ['4 coma 5','07:30','24 de octubre de 2026','ya ocurrido','No es una predicción','<Dial>malicioso</Dial>']:
            self.assertIn(phrase,text)
    def test_invalid_event_is_rejected(self):
        for value in [float('nan'),float('inf'),-1,11]:
            with self.assertRaises(ValueError):event_twiml({**CONTEXT,'magnitud':value})
        with self.assertRaises(ValueError):event_twiml({**CONTEXT,'ocurrido_en':'2026-10-24T12:30:00'})


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.flags={'voz_habilitada':True,'voz_cuenta':voice_provider.account_hash}
        self.context=dict(CONTEXT);self.claim={'id':DELIVERY,'reserva_id':REF,'destino':DEST,'usuario_id':ACTOR}
        self.calls=[]
        async def db(method,table,**kwargs):
            self.calls.append((table,kwargs))
            if table=='fuentes_datos':return [{'limites':self.flags}]
            if table=='entregas_alerta':return []
            if table.endswith('sismocore_reservar_llamada_automatica'):return self.claim
            if table.endswith('sismocore_contenido_llamada'):return self.context
            return True
        self.patches=[patch('app.services.database.database.request',new=AsyncMock(side_effect=db)),
            patch.object(VoiceProvider,'configured',new_callable=PropertyMock,return_value=True),
            patch.object(voice_provider,'recipients',new=AsyncMock(return_value={DEST:'+51900000000'})),
            patch.object(voice_provider,'call_event',new=AsyncMock(return_value={'sid':'CA'+'c'*32,'estado':'queued'}))]
        self.mocks=[p.start() for p in self.patches]
    async def asyncTearDown(self):
        for p in reversed(self.patches):p.stop()
    async def test_switch_off_never_contacts_twilio(self):
        self.flags={}
        self.assertEqual((await process_automatic_calls())['estado'],'apagadas')
        self.mocks[2].assert_not_awaited();self.mocks[3].assert_not_awaited()
    async def test_different_account_stops_before_provider(self):
        self.flags['voz_cuenta']='wrong'
        with self.assertRaises(RuntimeError):await process_automatic_calls()
        self.mocks[2].assert_not_awaited()
    async def test_single_claim_single_call(self):
        self.assertEqual((await process_automatic_calls())['aceptadas'],1)
        self.mocks[3].assert_awaited_once_with('+51900000000',DELIVERY,REF)
        final=[kwargs['data'] for table,kwargs in self.calls if table.endswith('sismocore_finalizar_llamada_automatica')][0]
        self.assertEqual(final['p_estado'],'queued')
    async def test_revoked_consent_does_not_call(self):
        self.context=None
        self.assertEqual((await process_automatic_calls())['aceptadas'],0)
        self.mocks[3].assert_not_awaited()
    async def test_no_claim_does_not_call(self):
        self.claim=None
        await process_automatic_calls();self.mocks[3].assert_not_awaited()
    async def test_uncertain_call_is_not_retried(self):
        self.mocks[3].side_effect=VoiceError('CONEXION')
        self.assertEqual((await process_automatic_calls())['estado'],'desconocida')
        self.mocks[3].assert_awaited_once()
    async def test_invalid_context_does_not_call(self):
        self.context['magnitud']=float('nan')
        await process_automatic_calls();self.mocks[3].assert_not_awaited()
    async def test_missing_destination_does_not_call(self):
        self.mocks[2].return_value={}
        await process_automatic_calls();self.mocks[3].assert_not_awaited()


class ChannelIndependenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        sms=patch('app.services.alerts.process_automatic_sms',new=AsyncMock(return_value={'estado':'apagadas','aceptadas':0}));sms.start();self.addCleanup(sms.stop)
    async def test_push_failure_still_processes_voice(self):
        with patch('app.services.alerts.process_push_alerts',new=AsyncMock(side_effect=RuntimeError())),patch('app.services.alerts.process_automatic_calls',new=AsyncMock(return_value={})) as voice:
            with self.assertRaisesRegex(RuntimeError,'notificaciones'):await process_alerts()
            voice.assert_awaited_once()
    async def test_voice_failure_after_push_is_reported(self):
        with patch('app.services.alerts.process_push_alerts',new=AsyncMock(return_value={})) as push,patch('app.services.alerts.process_automatic_calls',new=AsyncMock(side_effect=RuntimeError())):
            with self.assertRaisesRegex(RuntimeError,'llamadas'):await process_alerts()
            push.assert_awaited_once()


class AutomaticVoiceApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        attempts.clear()
        self.actor={'id':ACTOR,'rol':'administrador','estado':'activo'}
        app.dependency_overrides[require_user]=lambda:dict(self.actor)
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:5173')
    async def asyncTearDown(self):
        await self.client.aclose();app.dependency_overrides.clear();attempts.clear()
    async def test_bad_signature_does_not_read_database(self):
        with patch.object(VoiceProvider,'configured',new_callable=PropertyMock,return_value=True),patch('app.services.database.database.request',new=AsyncMock()) as db:
            response=await self.client.get(f'/api/v1/voz/eventos/{DELIVERY}.xml?clave={REF}&firma='+('0'*64))
            self.assertEqual(response.status_code,403);db.assert_not_awaited()
    async def test_signed_xml_has_no_arbitrary_speech(self):
        with patch.object(VoiceProvider,'configured',new_callable=PropertyMock,return_value=True),patch('app.services.database.database.request',new=AsyncMock(return_value=CONTEXT)):
            signature=voice_provider.event_signature(DELIVERY,REF)
            response=await self.client.get(f'/api/v1/voz/eventos/{DELIVERY}.xml?clave={REF}&firma={signature}&mensaje=UNTRUSTED')
            self.assertEqual(response.status_code,200);self.assertNotIn('UNTRUSTED',response.text)
    async def test_expired_signed_xml_cannot_speak(self):
        with patch.object(VoiceProvider,'configured',new_callable=PropertyMock,return_value=True),patch('app.services.database.database.request',new=AsyncMock(return_value=None)):
            signature=voice_provider.event_signature(DELIVERY,REF)
            response=await self.client.post(f'/api/v1/voz/eventos/{DELIVERY}.xml?clave={REF}&firma={signature}')
            self.assertEqual(response.status_code,403);self.assertNotIn('<Say',response.text)
    async def test_other_roles_cannot_link_or_enable(self):
        with patch('app.services.audit.record',new=AsyncMock()):
            for role in ['operador','lectura','analista','auditor']:
                self.actor['rol']=role
                for path,body in [('telefono',{'destino_id':DEST,'confirmado':True}),('automaticas',{'activa':True,'confirmado':True})]:
                    response=await self.client.post('/api/v1/voz/'+path,json=body,headers={'Origin':'http://localhost:5173'})
                    self.assertEqual(response.status_code,403)
    async def test_pause_does_not_contact_provider(self):
        with patch('app.services.database.database.request',new=AsyncMock(return_value=True)),patch.object(voice_provider,'check_trial',new=AsyncMock()) as provider:
            response=await self.client.post('/api/v1/voz/automaticas',json={'activa':False,'confirmado':True},headers={'Origin':'http://localhost:5173'})
            self.assertEqual(response.status_code,200);provider.assert_not_awaited()
