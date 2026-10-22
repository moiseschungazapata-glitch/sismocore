// Test-only state is supplied in memory by auth-smoke; never commit session cookies.
export function testAuthState() {
  const state = process.env.SISMOCORE_TEST_STATE;
  if (!state) throw new Error('Ejecuta scripts/test-login.py para autenticar las pruebas sin guardar credenciales.');
  return JSON.parse(state);
}
