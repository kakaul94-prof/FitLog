import { Capacitor } from '@capacitor/core'
import { BleClient, numberToUUID } from '@capacitor-community/bluetooth-le'
import { parseHrMeasurement } from '@/lib/hr'

/**
 * The chest-strap radio. One module-level connection shared by every screen, so
 * the settings page and the recorder can't fight over the strap (BLE straps
 * accept one host at a time).
 *
 * Same shape as geoWatch.ts: the native build talks real BLE through
 * @capacitor-community/bluetooth-le, and on the web that same plugin delegates
 * to Web Bluetooth — Chrome only, and foreground/screen-on only. Nothing here
 * throws on an unsupported platform; hrSupported() gates the UI instead.
 */

export const HR_SERVICE = numberToUUID(0x180d)
export const HR_MEASUREMENT = numberToUUID(0x2a37)
const BATTERY_SERVICE = numberToUUID(0x180f)
const BATTERY_LEVEL = numberToUUID(0x2a19)

const STORE_KEY = 'fitlog.hrDevice'

export type HrStatus = 'idle' | 'connecting' | 'connected'

export interface HrState {
  status: HrStatus
  /** Live beats per minute, or null when nothing has arrived yet. */
  bpm: number | null
  /** Epoch ms of the last reading — the recorder uses this to spot a stall. */
  at: number
  /** Strap contact, when the strap reports it. */
  contact: boolean | null
  battery: number | null
  deviceName: string | null
  deviceId: string | null
  error: string | null
}

export interface SavedHrDevice {
  id: string
  name: string
}

/** The remembered strap, or null if none has been paired. */
export function savedHrDevice(): SavedHrDevice | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as SavedHrDevice) : null
  } catch {
    return null
  }
}

function rememberDevice(d: SavedHrDevice | null) {
  try {
    if (d) localStorage.setItem(STORE_KEY, JSON.stringify(d))
    else localStorage.removeItem(STORE_KEY)
  } catch {
    /* private mode — pairing just won't persist */
  }
}

const AUTO_KEY = 'fitlog.hrAutoConnect'

/** Whether a recording should reach for the strap on its own. Default on — a
 * paired strap you have to remember to switch on isn't much of a feature. */
export function hrAutoConnect(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0'
  } catch {
    return true
  }
}

export function setHrAutoConnect(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0')
  } catch {
    /* private mode */
  }
}

/** BLE is reachable: the native plugin, or Web Bluetooth in a Chromium browser. */
export function hrSupported(): boolean {
  if (Capacitor.isNativePlatform())
    return Capacitor.isPluginAvailable('BluetoothLe')
  return (
    typeof navigator !== 'undefined' &&
    'bluetooth' in navigator &&
    !!(navigator as { bluetooth?: unknown }).bluetooth
  )
}

/** A saved strap can only be reconnected silently on native — Web Bluetooth
 * makes you pick the device again every page load. */
export const canAutoReconnect = () => Capacitor.isNativePlatform()

// ---------- store ----------

const saved = savedHrDevice()
let state: HrState = {
  status: 'idle',
  bpm: null,
  at: 0,
  contact: null,
  battery: null,
  deviceName: saved?.name ?? null,
  deviceId: saved?.id ?? null,
  error: null,
}

const listeners = new Set<() => void>()

function set(patch: Partial<HrState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function subscribeHr(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const hrState = () => state

// ---------- connection ----------

let initialized = false
/** True while we want a live connection — drives the reconnect loop. */
let wanted = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

async function init() {
  if (initialized) return
  // androidNeverForLocation: we only want the strap, not to infer position, so
  // Android 12+ can skip the location permission entirely.
  await BleClient.initialize({ androidNeverForLocation: true })
  initialized = true
}

async function readBattery(deviceId: string) {
  try {
    const v = await BleClient.read(deviceId, BATTERY_SERVICE, BATTERY_LEVEL)
    set({ battery: v.getUint8(0) })
  } catch {
    // Plenty of straps don't expose the battery service. Not an error.
    set({ battery: null })
  }
}

function onDisconnect() {
  set({ status: 'idle', bpm: null, contact: null })
  if (wanted) scheduleReconnect()
}

function scheduleReconnect() {
  if (reconnectTimer || !canAutoReconnect()) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (wanted && state.status === 'idle') void connectHr().catch(() => {})
  }, 4000)
}

async function attach(deviceId: string, name: string) {
  await BleClient.connect(deviceId, onDisconnect)
  await BleClient.startNotifications(
    deviceId,
    HR_SERVICE,
    HR_MEASUREMENT,
    (value) => {
      const m = parseHrMeasurement(value)
      if (!m || !m.bpm) return
      set({ bpm: m.bpm, at: Date.now(), contact: m.contact, error: null })
    },
  )
  rememberDevice({ id: deviceId, name })
  set({
    status: 'connected',
    deviceId,
    deviceName: name,
    error: null,
  })
  void readBattery(deviceId)
}

/**
 * Connect to the remembered strap. On native this is silent; on the web the
 * browser has no memory across loads, so callers should fall back to
 * pairHrMonitor() (which shows the picker) when this reports it can't.
 */
export async function connectHr(): Promise<boolean> {
  const dev = savedHrDevice()
  if (!dev) return false
  if (!hrSupported()) {
    set({ error: 'This device can’t reach Bluetooth heart rate straps.' })
    return false
  }
  if (state.status !== 'idle') return state.status === 'connected'
  wanted = true
  set({ status: 'connecting', error: null })
  try {
    await init()
    await attach(dev.id, dev.name)
    return true
  } catch (e) {
    set({
      status: 'idle',
      error: canAutoReconnect()
        ? 'Couldn’t reach the strap. Is it on and worn?'
        : 'Reconnect the strap to keep reading it in the browser.',
    })
    void e
    return false
  }
}

/** Show the OS/browser device picker, then connect. Needs a user gesture. */
export async function pairHrMonitor(): Promise<boolean> {
  if (!hrSupported()) {
    set({ error: 'This device can’t reach Bluetooth heart rate straps.' })
    return false
  }
  wanted = true
  set({ status: 'connecting', error: null })
  try {
    await init()
    const device = await BleClient.requestDevice({
      services: [HR_SERVICE],
      optionalServices: [BATTERY_SERVICE],
    })
    await attach(device.deviceId, device.name || 'Heart rate strap')
    return true
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    set({
      status: 'idle',
      // The picker's own cancel isn't worth an error banner.
      error: /cancel|user|abort/i.test(msg)
        ? null
        : 'Couldn’t pair. Make sure the strap is worn and not connected to another app.',
    })
    return false
  }
}

export async function disconnectHr(): Promise<void> {
  wanted = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  const id = state.deviceId
  set({ status: 'idle', bpm: null, contact: null })
  if (!id) return
  try {
    await BleClient.stopNotifications(id, HR_SERVICE, HR_MEASUREMENT)
  } catch {
    /* already gone */
  }
  try {
    await BleClient.disconnect(id)
  } catch {
    /* already gone */
  }
}

/** Drop the strap and forget it, so the next connect goes back to the picker. */
export async function forgetHrMonitor(): Promise<void> {
  await disconnectHr()
  rememberDevice(null)
  set({ deviceId: null, deviceName: null, battery: null, error: null })
}
