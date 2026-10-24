/// <reference lib="webworker" />
import { initializeApp } from '@firebase/app'
import { getMessaging } from '@firebase/messaging/sw'
import { firebaseConfig } from './config/firebase'

declare const self: ServiceWorkerGlobalScope

// Notifications created while the page is visible use our own safe click target.
self.addEventListener('notificationclick', event => {
  if (event.notification.data?.sismocore !== true) return
  event.stopImmediatePropagation()
  event.notification.close()
  event.waitUntil((async () => {
    const url = new URL('/alertas', self.location.origin).href
    const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true })
    const existing = clients.find(client => client.url.startsWith(self.location.origin + '/')) as WindowClient | undefined
    if (existing) { await existing.navigate(url); await existing.focus() }
    else await self.clients.openWindow(url)
  })())
})

// The SDK displays notification payloads in the background; do not display twice.
getMessaging(initializeApp(firebaseConfig))
