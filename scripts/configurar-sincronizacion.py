"""Configure Vault and activate Cron only after the deployed private API passes checks."""
import argparse
import asyncio
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
from pathlib import Path
import httpx

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.runtime' / 'supabase-cron.env'
URL = 'https://sismocore.vercel.app/api/v1/interno/sincronizacion'


def cli(sql):
    binary = shutil.which('supabase')
    if not binary:
        folder = Path(os.environ.get('LOCALAPPDATA','')) / 'npm-cache' / '_npx'
        matches = list(folder.glob('*/node_modules/@supabase/cli-windows-x64/bin/supabase.exe'))
        binary = str(matches[0]) if matches else None
    if not binary:
        raise RuntimeError('No se encontró la CLI de Supabase. Instálala e inicia sesión antes de continuar.')
    query = ROOT / '.runtime' / 'supabase-cron-configurar.sql'
    query.parent.mkdir(parents=True,exist_ok=True)
    query.write_text(sql,encoding='utf-8')
    try:
        result = subprocess.run([binary,'db','query','--linked','--file',str(query)],
            cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=90)
        # Do not echo SQL, credentials or upstream CLI errors.
        if result.returncode:
            raise RuntimeError('Supabase no pudo aplicar la configuración. Comprueba el acceso de la CLI y las migraciones.')
    finally:
        query.unlink(missing_ok=True)


def key():
    if not PRIVATE.exists():
        raise RuntimeError('Primero ejecuta este comando con --preparar.')
    value = PRIVATE.read_text(encoding='utf-8').strip().removeprefix('SYNC_CRON_SECRET=')
    if not re.fullmatch('[a-f0-9]{64}',value):
        raise RuntimeError('El archivo privado de Cron no es válido.')
    return value


def prepare():
    PRIVATE.parent.mkdir(parents=True,exist_ok=True)
    if not PRIVATE.exists():
        PRIVATE.write_text('SYNC_CRON_SECRET='+secrets.token_hex(32)+'\n',encoding='utf-8')
    token = key()
    cli("""do $setup$ declare existing uuid; begin
      select id into existing from vault.secrets where name='sismocore_sync_cron_secret';
      if existing is null then
        perform vault.create_secret('%s','sismocore_sync_cron_secret','Acceso privado de sincronizacion SISMOCORE');
      elsif not exists(select 1 from vault.decrypted_secrets where id=existing and decrypted_secret='%s') then
        raise exception 'La clave de Vault y el archivo local no coinciden. No se rotara automaticamente.';
      end if;
    end $setup$;""" % (token, token))
    print('Clave guardada en Vault. La tarea permanece en su estado actual; no se activó ni se realizó un envío.')
    print('En Vercel, configura SYNC_CRON_SECRET usando el valor del archivo privado: '+str(PRIVATE))
    print('Después despliega los cambios y ejecuta este script con --activar.')


async def check():
    async with httpx.AsyncClient(timeout=40,follow_redirects=False) as client:
        response = await client.get(URL,headers={'Authorization':'Bearer '+key()})
    if response.status_code != 200:
        raise RuntimeError(f'La API privada todavía no está lista (HTTP {response.status_code}). Configura la variable en Vercel y despliega los cambios.')
    try: state = response.json()
    except ValueError: raise RuntimeError('La dirección respondió con una página en lugar de la API privada.') from None
    if state.get('version')!='supabase-cron-v1' or state.get('listo') is not True:
        missing = state.get('faltantes',[])
        raise RuntimeError('No se activó Cron: comprueba la fuente IGP y las credenciales de los canales activos'+(' ('+', '.join(missing)+')' if missing else '')+'.')
    return {k:state.get(k) for k in ('version','listo','faltantes','programacion')}


async def main(args):
    if args.preparar:
        prepare()
    elif args.pausar:
        cli("select cron.alter_job(jobid,active:=false) from cron.job where jobname='sismocore-igp-5-minutos';")
        print('Sincronización de Supabase pausada. No se cambió ninguna regla ni autorización de avisos.')
    else:
        state = await check()  # This GET never imports data or sends notifications.
        if args.activar:
            cli("select cron.alter_job(jobid,active:=true) from cron.job where jobname='sismocore-igp-5-minutos';")
            state = await check()
            if state.get('programacion',{}).get('activo') is not True:
                raise RuntimeError('No se pudo confirmar que Cron quedó activo.')
            print('Supabase Cron activo cada cinco minutos. No se lanzó ninguna ejecución manual.')
        print(json.dumps(state,ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    mode=parser.add_mutually_exclusive_group(required=True)
    for name in ('preparar','comprobar','activar','pausar'): mode.add_argument('--'+name,action='store_true')
    try: asyncio.run(main(parser.parse_args()))
    except Exception as exc:
        print(str(exc) if isinstance(exc,RuntimeError) else 'No se completó la configuración. Revisa conectividad y acceso; no compartas credenciales.',file=sys.stderr)
        sys.exit(1)
