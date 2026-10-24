from fastapi import APIRouter, Response

router = APIRouter(prefix='/voz', tags=['Prueba de voz'])

# Public, fixed instructions for Twilio's Custom TwiML URL. Fetching this endpoint
# never initiates calls, consumes provider credentials or accepts spoken user text.
TRIAL_TWIML = '''<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="man" language="es">Esta es una prueba de SISMOCORE. No representa una alerta sísmica real.</Say>
  <Hangup/>
</Response>'''


@router.api_route('/prueba.xml', methods=['GET', 'POST'], response_class=Response)
async def trial_instructions():
    return Response(content=TRIAL_TWIML, media_type='application/xml')
