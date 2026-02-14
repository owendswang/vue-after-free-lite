import { libc_addr } from 'download0/userland'
import { fn, mem, BigInt, utils } from 'download0/types'
import { sysctlbyname } from 'download0/kernel'
import { lapse } from 'download0/lapse'
import { binloader_init } from 'download0/binloader'
import { checkJailbroken } from 'download0/check-jailbroken'

// Load binloader first (just defines the function, doesn't execute)

// Now load userland and lapse
// Check if libc_addr is defined
if (typeof libc_addr === 'undefined') {
  include('userland.js')
}
include('binloader.js')
include('kernel.js')
include('lapse.js')
include('netctrl_c0w_twins.js')
include('check-jailbroken.js')
include('ftp-server.js')
debug('All scripts loaded')

function write64 (addr: BigInt, val: BigInt | number) {
  mem.view(addr).setBigInt(0, new BigInt(val), true)
}

function read8 (addr: BigInt) {
  return mem.view(addr).getUint8(0)
}

function malloc (size: number) {
  return mem.malloc(size)
}

function get_fwversion () {
  const buf = malloc(0x8)
  const size = malloc(0x8)
  write64(size, 0x8)
  if (sysctlbyname('kern.sdk_version', buf, size, 0, 0)) {
    const byte1 = Number(read8(buf.add(2)))  // Minor version (first byte)
    const byte2 = Number(read8(buf.add(3)))  // Major version (second byte)

    const version = byte2.toString(16) + '.' + byte1.toString(16).padStart(2, '0')
    return version
  }

  return null
}

const FW_VERSION: string | null = get_fwversion()

if (FW_VERSION === null) {
  log('ERROR: Failed to determine FW version')
  throw new Error('Failed to determine FW version')
} else {
  log('Firmware Version: ' + FW_VERSION)
}

const compare_version = (a: string, b: string) => {
  const a_arr = a.split('.')
  const amaj = Number(a_arr[0])
  const amin = Number(a_arr[1])
  const b_arr = b.split('.')
  const bmaj = Number(b_arr[0])
  const bmin = Number(b_arr[1])
  return amaj === bmaj ? amin - bmin : amaj - bmaj
}

function timeoutExploitAsync (chosenMethod) {
  const max_wait_seconds = chosenMethod === 'lapse' ? 5 : 10
  const timeoutMs = max_wait_seconds * 1000

  waitUntil(checkJailbroken, 500, timeoutMs, function (err, elapsed) {
    if (err) {
      error('ERROR: Timeout waiting for exploit to complete (' + max_wait_seconds + ' seconds)')
      throw err
    }
    log('Exploit completed successfully after ' + (elapsed / 1000).toFixed(1) + ' seconds')
  })
}

function start_loader () {
  log('')
  if (compare_version(FW_VERSION, '7.00') < 0 && compare_version(FW_VERSION, '13.00') > 0) {
    throw new Error('Unsupported firmware: ' + FW_VERSION)
  }

  let lapseAble = false
  let poopsAble = false
  let chosenMethod = ''
  const is_jailbroken = checkJailbroken()
  if (!is_jailbroken) {
    log('Select jailbreak method:')
    if (compare_version(FW_VERSION, '7.00') >= 0 && compare_version(FW_VERSION, '12.02') <= 0) {
      log('[X] = Lapse')
      lapseAble = true
    }
    if (compare_version(FW_VERSION, '9.00') >= 0 && compare_version(FW_VERSION, '13.00') <= 0) {
      log('[O] = Poopsloit (NetCtrl)')
      poopsAble = true
    }
  } else {
    utils.notify('Already Jailbroken!')
    error('Already jailbroken!')
  }

  log('')
  log('Select other payloads:')
  log('[Square] = FTP Server (Userland only)')
  if (is_jailbroken) {
    log('[Triangle] = ELF Loader (elfldr.elf)')
    log('[R1] = NP Fake Signin (fake-signin.bin)')
  }
  log('')

  jsmaf._onKeyUp = function (keyCode) {
    if (chosenMethod.length > 0) {
      return
    }
    debug(keyCode.toString())
    // 1 = l3
    // 2 = r3
    // 3 = options
    // 4 = up
    // 5 = right
    // 6 = down
    // 7 = left
    // 8 + 53= l2
    // 9 + 54= r2
    // 12 = triangle
    // 13 = circle
    // 14 = cross
    // 15 = square
    // 11 = r1
    // 10 = r2
    // 16 = touchpad click
    // 55 = left stick up
    // 56 = left stick right
    // 57 = left stick down
    // 58 = left stick left
    // 59 = right stick up
    // 60 = right stick right
    // 61 = right stick down
    // 62 = right stick left

    // cross pressed
    if (keyCode === 14) {
      if (lapseAble) {
        log('(Close and re-open Vue to choose again)')
        log('')
        log('=== PS4 Lapse Jailbreak ===')
        log('Starting in 1 second...')
        chosenMethod = 'lapse'
        jsmaf.setTimeout(function () {
          lapse()
          timeoutExploitAsync('lapse', function (err) {
            if (err) throw err
          })
        }, 1000)
      }
    }

    // circle pressed
    if (keyCode === 13) {
      if (poopsAble) {
        log('(Close and re-open Vue to choose again)')
        log('')
        log('=== PS4 NetCtrl Jailbreak ===')
        log('Starting in 1 second...')
        chosenMethod = 'poopsloit'
        jsmaf.setTimeout(function () {
          netctrl_exploit()
        }, 1000)
      }
    }

    // square pressed
    if (keyCode === 15) {
      log('(Close and re-open Vue to choose again)')
      log('')
      log('=== FTP Server (Userland only) ===')
      log('Starting in 1 second...')
      chosenMethod = 'ftpServer'
      jsmaf.setTimeout(function () {
        start_ftp_server()
      }, 1000)
    }

    // triangle pressed
    if (keyCode === 12) {
      if (is_jailbroken) {
        log('(Close and re-open Vue to choose again)')
        log('')
        log('=== ELF Loader (elfldr.elf) ===')
        log('Starting in 1 second...')
        chosenMethod = 'elfldr'
        jsmaf.setTimeout(function () {
          binloader_init('elfldr.elf')
        }, 1000)
      }
    }

    // r1 pressed
    if (keyCode === 11) {
      if (is_jailbroken) {
        log('(Close and re-open Vue to choose again)')
        log('')
        log('=== NP Fake Signin ===')
        log('Starting in 1 second...')
        chosenMethod = 'fake-signin'
        jsmaf.setTimeout(function () {
          binloader_init('fake-signin.bin')
        }, 1000)
      }
    }
  }
}

start_loader()
