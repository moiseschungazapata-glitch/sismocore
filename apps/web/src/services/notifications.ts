import { firebaseConfig, vapidPublicKey } from '../config/firebase'
import { protectedRequest } from './auth'

export interface PushDevice {
  id:string; etiqueta:string; activo:boolean; registrado_en:string; actualizado_en:string
  ultima_prueba_en:string | null; ultima_prueba_estado:'pendiente' | 'aceptada' | 'fallida' | null; ultimo_error_codigo:string | null
}
export interface PushStatus { configurada:boolean; dispositivos:PushDevice[]; automaticas_activas:boolean; automaticas_habilitadas?:boolean; reglas_activas?:boolean; puede_configurar_automaticas?:boolean }
export const switchAutomaticPush=(activa:boolean)=>protectedRequest<{message:string}>('notificaciones/automaticas',{activa,confirmado:true})
type Binding = { id:string; userId:string }
const storageKey = 'sismocore.push-device.v1'
let memoryBinding: Binding | null = null

export function currentPushDevice(userId:string) {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null') as Binding | null
    if (value?.userId === userId && /^[0-9a-f-]{36}$/i.test(value.id)) return value.id
  } catch { /* Local preference may be disabled. */ }
  return memoryBinding?.userId === userId ? memoryBinding.id : null
}
export function forgetPushDevice() {
  memoryBinding = null
  try { localStorage.removeItem(storageKey) } catch { /* Optional storage. */ }
}
export function pushSupport() {
  if (!window.isSecureContext) return 'Las notificaciones necesitan una conexión HTTPS.'
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'Este navegador no admite notificaciones web. Prueba con Chrome actualizado en Android.'
  return ''
}
async function messaging() {
  const [app, fcm] = await Promise.all([import('@firebase/app'),import('@firebase/messaging')])
  if (!await fcm.isSupported()) throw new Error('El navegador no permite guardar el registro de notificaciones. Usa una ventana normal de Chrome.')
  return { sdk:fcm, instance:fcm.getMessaging(app.getApps().length ? app.getApp() : app.initializeApp(firebaseConfig)) }
}
async function worker() {
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { type:'module',scope:'/' })
  if (registration.active) return registration
  await new Promise<void>((resolve,reject) => {
    const installing = registration.installing || registration.waiting
    if (!installing) { reject(new Error('No se pudo activar el receptor de notificaciones. Recarga e inténtalo de nuevo.')); return }
    const timeout = window.setTimeout(() => { installing.removeEventListener('statechange', changed); reject(new Error('El receptor está tardando en iniciarse. Recarga e inténtalo de nuevo.')) },15000)
    function changed() {
      if (installing?.state === 'activated') { window.clearTimeout(timeout); installing.removeEventListener('statechange',changed); resolve() }
      else if (installing?.state === 'redundant') { window.clearTimeout(timeout); installing.removeEventListener('statechange',changed); reject(new Error('No se pudo iniciar el receptor de notificaciones.')) }
    }
    installing.addEventListener('statechange',changed); changed()
  })
  return registration
}
export const notificationStatus = (signal?:AbortSignal) => protectedRequest<PushStatus>('notificaciones',undefined,undefined,signal)
export async function enablePush(userId:string) {
  const unsupported = pushSupport()
  if (unsupported) throw new Error(unsupported)
  // Called directly from a user click, before any asynchronous SDK work.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Las notificaciones están bloqueadas. Permítelas en la configuración del sitio de Chrome y vuelve a intentarlo.' : 'No activaste el permiso de notificaciones. Puedes intentarlo cuando lo desees.')
  const { sdk,instance } = await messaging()
  const registration = await worker()
  const previous = currentPushDevice(userId)
  if (previous) {
    // Renewing must not reuse an expired FCM token or leave a duplicate active device.
    await protectedRequest(`notificaciones/dispositivos/${previous}/desactivar`,{})
    try { await sdk.deleteToken(instance) }
    catch { throw new Error('No se pudo renovar el registro de Firebase. Vuelve a activar las notificaciones.') }
    forgetPushDevice()
  }
  let token:string
  try { token = await sdk.getToken(instance,{ vapidKey:vapidPublicKey,serviceWorkerRegistration:registration }) }
  catch { throw new Error('Firebase no pudo registrar este navegador. Revisa la configuración del proyecto y vuelve a intentarlo.') }
  if (!token) throw new Error('No se obtuvo un registro de notificaciones. Vuelve a intentarlo.')
  const platform = /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone / iPad' : 'computadora'
  const result = await protectedRequest<{ dispositivo:PushDevice }>('notificaciones/dispositivos',{ token,etiqueta:`Navegador en ${platform}` })
  memoryBinding = { id:result.dispositivo.id,userId }
  try { localStorage.setItem(storageKey,JSON.stringify(memoryBinding)) } catch { /* Binding remains in memory. */ }
  return result.dispositivo
}
export async function deactivatePush(id:string,userId:string) {
  await protectedRequest(`notificaciones/dispositivos/${id}/desactivar`,{})
  if (currentPushDevice(userId) === id) {
    forgetPushDevice()
    try { const { sdk,instance } = await messaging(); await sdk.deleteToken(instance) } catch { /* Server already revoked this device. */ }
  }
}
export const sendPushTest = (id:string) => protectedRequest<{ message:string; estado:'aceptada' }>(`notificaciones/dispositivos/${id}/prueba`,{})
export const sendLatestAlert = (id:string) => protectedRequest<{ message:string; estado:'aceptada' }>(`notificaciones/dispositivos/${id}/ultima-alerta`,{})

export async function listenForPush(userId:string) {
  if (pushSupport() || Notification.permission !== 'granted' || !currentPushDevice(userId)) return () => {}
  const { sdk,instance } = await messaging()
  return sdk.onMessage(instance,payload => {
    if (!currentPushDevice(userId)) return
    const title = String(payload.notification?.title || 'SISMOCORE').slice(0,120)
    const body = String(payload.notification?.body || '').slice(0,500)
    window.dispatchEvent(new CustomEvent('sismocore:push-received',{ detail:{ title,body } }))
    void navigator.serviceWorker.getRegistration('/').then(registration => registration?.showNotification(title,{
      body,icon:'/favicon.svg',tag:`sismocore-${payload.data?.referencia || 'aviso'}`,data:{ sismocore:true },
    })).catch(() => { /* The in-app receipt remains visible if the OS suppresses it. */ })
  })
}
