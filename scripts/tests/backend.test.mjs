import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { BackendSupervisor } from '../backend.mjs';
import { root } from '../runtime.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const silent = { info() {}, warn() {} };

async function fixture() {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = join(root, '.runtime/tests');
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, 'backend-'));
  return {
    url: `http://127.0.0.1:${port}/live`, command: process.execPath,
    args: ['-e', `require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({servicio:'api'}));}).listen(${port},'127.0.0.1')`],
    cwd: root, directory, checkFiles: false, intervalMs: 100, timeoutMs: 4000, logger: silent,
  };
}

async function until(check) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { if (await check()) return; await sleep(100); }
  throw new Error('La API no se recuperó dentro del plazo de prueba.');
}

test('el primer acceso inicia la API y comparte solicitudes simultáneas', async () => {
  const service = new BackendSupervisor(await fixture());
  try {
    assert.deepEqual(await Promise.all([service.ensure(), service.ensure(), service.ensure()]), [true, true, true]);
    assert.ok(service.child?.pid);
    assert.equal(await service.healthy(), true);
  } finally { service.stop(); }
});

test('reinicia automáticamente el proceso si se detiene', async () => {
  const service = new BackendSupervisor(await fixture());
  try {
    assert.equal(await service.start(), true);
    const original = service.child.pid;
    service.child.kill();
    await until(async () => service.child && service.child.pid !== original && await service.healthy());
    assert.notEqual(service.child.pid, original);
  } finally { service.stop(); }
});

test('reutilizar una API existente no permite detener un proceso ajeno', async () => {
  const options = await fixture();
  const owner = new BackendSupervisor(options);
  const consumer = new BackendSupervisor(options);
  try {
    await owner.start();
    assert.equal(await consumer.start(), true);
    assert.equal(consumer.child, null);
    consumer.stop();
    assert.equal(await owner.healthy(), true);
  } finally { consumer.stop(); owner.stop(); }
});

test('no reinicia servicios después de cerrar el supervisor', async () => {
  const service = new BackendSupervisor(await fixture());
  await service.start();
  service.stop();
  await sleep(400);
  assert.equal(await service.ensure(), false);
  assert.equal(service.child, null);
});

test('la falta de configuración produce un mensaje sin iniciar Python', async () => {
  const options = await fixture();
  const service = new BackendSupervisor({ ...options, checkFiles: true, command: join(options.directory, 'no-existe.exe') });
  try {
    assert.equal(await service.ensure(), false);
    assert.match(service.lastError, /configuración/);
    assert.equal(service.child, null);
  } finally { service.stop(); }
});
