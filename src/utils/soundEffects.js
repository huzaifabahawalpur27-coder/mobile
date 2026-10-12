// Web Audio API Procedural Sound Engine
// Zero network dependencies, instant tactile feedback, 100% offline-ready

let audioCtx = null

const DEFAULT_CONFIG = {
  master: true,
  hover: true,
  click: true,
  create: true,
  delete: true,
  alert: true,
  error: true,
  toggle: true
}

let soundConfig = { ...DEFAULT_CONFIG }

// Initialize config from localStorage safely
if (typeof window !== 'undefined') {
  try {
    const savedMaster = localStorage.getItem('edgex_sound_enabled')
    if (savedMaster !== null) {
      soundConfig.master = savedMaster !== 'false'
    }
    const savedConfig = localStorage.getItem('edgex_sound_config')
    if (savedConfig) {
      soundConfig = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) }
      if (savedMaster !== null) {
        soundConfig.master = savedMaster !== 'false'
      }
    }
  } catch (_) {
    soundConfig = { ...DEFAULT_CONFIG }
  }
}

let lastHoverTime = 0

function getAudioContext() {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (AudioContextClass) {
      audioCtx = new AudioContextClass({ latencyHint: 'interactive' })
    }
  }
  return audioCtx
}

// Global unlock on ANY user interaction
function unlockAudio() {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
}

if (typeof window !== 'undefined') {
  const unlockEvents = ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click']
  const handleInteraction = () => {
    unlockAudio()
  }
  unlockEvents.forEach((evt) => {
    window.addEventListener(evt, handleInteraction, { capture: true, passive: true })
  })
}

function withAudio(type, fn) {
  if (!soundConfig.master) return
  if (type && soundConfig[type] === false) return

  const ctx = getAudioContext()
  if (!ctx) return

  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      try {
        fn(ctx)
      } catch (_e) {
        void _e
      }
    }).catch(() => {})
  } else {
    try {
      fn(ctx)
    } catch (_e) {
      void _e
    }
  }
}

export function isSoundEnabled() {
  return soundConfig.master
}

export function setSoundEnabled(enabled) {
  soundConfig.master = !!enabled
  saveConfig()
  if (soundConfig.master) {
    playToggle()
  }
}

export function toggleSound() {
  const next = !soundConfig.master
  setSoundEnabled(next)
  return next
}

export function getSoundConfig() {
  return { ...soundConfig }
}

export function setSoundConfig(newConfig) {
  soundConfig = { ...soundConfig, ...newConfig }
  saveConfig()
}

export function toggleSoundType(type) {
  if (type in soundConfig) {
    soundConfig[type] = !soundConfig[type]
    saveConfig()
    if (soundConfig[type] && soundConfig.master) {
      testSound(type)
    }
    return soundConfig[type]
  }
  return false
}

function saveConfig() {
  try {
    localStorage.setItem('edgex_sound_enabled', soundConfig.master ? 'true' : 'false')
    localStorage.setItem('edgex_sound_config', JSON.stringify(soundConfig))
    window.dispatchEvent(new Event('edgex_sound_config_changed'))
  } catch (_e) {
    void _e
  }
}

/**
 * 1. Apple-like Hover Tick
 */
export function playHover() {
  const now = performance.now()
  if (now - lastHoverTime < 60) return // Throttle
  lastHoverTime = now

  withAudio('hover', (ctx) => {
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(1150, t)
    osc.frequency.exponentialRampToValueAtTime(700, t + 0.05)

    gain.gain.setValueAtTime(0.22, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(t)
    osc.stop(t + 0.06)
  })
}

/**
 * 2. Crisp Tactile Click / Tap
 */
export function playClick() {
  withAudio('click', (ctx) => {
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(650, t)
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.075)

    gain.gain.setValueAtTime(0.42, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(t)
    osc.stop(t + 0.08)
  })
}

/**
 * 3. Success / Create / Save Chime
 */
export function playCreate() {
  withAudio('create', (ctx) => {
    const t = ctx.currentTime
    const notes = [523.25, 659.25, 783.99] // C5, E5, G5

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, t + i * 0.065)

      const start = t + i * 0.065
      gain.gain.setValueAtTime(0.001, start)
      gain.gain.linearRampToValueAtTime(0.32, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(start)
      osc.stop(start + 0.27)
    })
  })
}

/**
 * 4. Delete / Trash / Remove Sound
 */
export function playDelete() {
  withAudio('delete', (ctx) => {
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(260, t)
    osc.frequency.exponentialRampToValueAtTime(75, t + 0.17)

    gain.gain.setValueAtTime(0.45, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(t)
    osc.stop(t + 0.19)
  })
}

/**
 * 5. Alert / Warning Ping
 */
export function playAlert() {
  withAudio('alert', (ctx) => {
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(784.00, t) // G5
    osc.frequency.setValueAtTime(1046.50, t + 0.09) // C6

    gain.gain.setValueAtTime(0.38, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(t)
    osc.stop(t + 0.27)
  })
}

/**
 * 6. Error Sound
 */
export function playError() {
  withAudio('error', (ctx) => {
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(280, t)
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.16)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(550, t)

    gain.gain.setValueAtTime(0.35, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17)

    osc.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)

    osc.start(t)
    osc.stop(t + 0.19)
  })
}

/**
 * 7. Toggle / Switch Click
 */
export function playToggle() {
  withAudio('toggle', (ctx) => {
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(800, t)
    osc.frequency.exponentialRampToValueAtTime(1350, t + 0.04)

    gain.gain.setValueAtTime(0.35, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(t)
    osc.stop(t + 0.05)
  })
}

/**
 * Explicit sound test helper (bypasses category mute to let user sample the sound)
 */
export function testSound(type) {
  const orig = soundConfig[type]
  soundConfig[type] = true
  const origMaster = soundConfig.master
  soundConfig.master = true

  switch (type) {
    case 'hover': playHover(); break
    case 'click': playClick(); break
    case 'create': playCreate(); break
    case 'delete': playDelete(); break
    case 'alert': playAlert(); break
    case 'error': playError(); break
    case 'toggle': playToggle(); break
    default: playClick()
  }

  soundConfig[type] = orig
  soundConfig.master = origMaster
}

/**
 * Global Interactivity Listener (Uses CAPTURE phase so stopPropagation never blocks sounds)
 */
let listenersAttached = false

export function initGlobalSoundEffects() {
  if (typeof window === 'undefined' || listenersAttached) return
  listenersAttached = true

  // Hover detection on interactive elements
  window.addEventListener(
    'mouseover',
    (e) => {
      const target = e.target
      if (!target || !(target instanceof Element)) return
      const interactive = target.closest(
        'button, a, input[type="checkbox"], input[type="radio"], select, [role="button"], .cursor-pointer, .interactive-sound'
      )
      if (interactive) {
        playHover()
      }
    },
    true // Capture phase
  )

  // Click detection
  window.addEventListener(
    'click',
    (e) => {
      unlockAudio()
      const target = e.target
      if (!target || !(target instanceof Element)) return

      const interactive = target.closest(
        'button, a, input[type="checkbox"], input[type="radio"], select, [role="button"], .cursor-pointer, .interactive-sound'
      )
      if (!interactive) return

      // Explicit sound attribute: data-sound="delete" | "create" | "alert" | "error" | "toggle"
      const soundType = interactive.getAttribute('data-sound')
      if (soundType === 'delete') {
        playDelete()
        return
      }
      if (soundType === 'create') {
        playCreate()
        return
      }
      if (soundType === 'alert') {
        playAlert()
        return
      }
      if (soundType === 'error') {
        playError()
        return
      }
      if (soundType === 'toggle') {
        playToggle()
        return
      }

      // Check text or classes for heuristic matching
      const text = (interactive.textContent || '').trim().toLowerCase()
      const className = (interactive.className || '').toString().toLowerCase()

      // Delete / Danger detection
      if (
        className.includes('bg-red') ||
        className.includes('text-red') ||
        text.includes('delete') ||
        text.includes('remove') ||
        text.includes('trash') ||
        text.includes('void') ||
        text.includes('cancel sale')
      ) {
        playDelete()
        return
      }

      // Create / Success / Action detection
      if (
        text.includes('save') ||
        text.includes('create') ||
        text.includes('add') ||
        text.includes('complete') ||
        text.includes('pay') ||
        text.includes('checkout') ||
        text.includes('submit') ||
        text.includes('confirm')
      ) {
        playCreate()
        return
      }

      // Default crisp tactile tap
      playClick()
    },
    true // Capture phase
  )
}
