"""Run real browser checks with interactive credentials held only in memory."""
import getpass
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
email = input('Correo de prueba: ').strip()
password = getpass.getpass('Contraseña: ') if sys.stdin.isatty() else sys.stdin.readline().rstrip('\r\n')
env = {**os.environ, 'TEST_LOGIN_EMAIL': email, 'TEST_LOGIN_PASSWORD': password}
del password
node = Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'nodejs' / 'node.exe'
result = subprocess.run([str(node), 'scripts/auth-smoke.mjs'], cwd=root, env=env)
del env
sys.exit(result.returncode)
