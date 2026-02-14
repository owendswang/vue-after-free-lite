import { fn, BigInt } from 'download0/types'

export function checkJailbroken (): boolean {
  fn.register(24, 'getuid', [], 'bigint')
  fn.register(23, 'setuid', ['number'], 'bigint')

  const uidBefore = fn.getuid()
  const uidBeforeVal = uidBefore instanceof BigInt ? uidBefore.lo : uidBefore
  debug('UID before setuid: ' + uidBeforeVal)

  debug('Attempting setuid(0)...')

  try {
    const setuidResult = fn.setuid(0)
    const setuidRet = setuidResult instanceof BigInt ? setuidResult.lo : setuidResult
    debug('setuid returned: ' + setuidRet)
  } catch (e) {
    debug('setuid threw exception: ' + (e as Error).toString())
  }

  const uidAfter = fn.getuid()
  const uidAfterVal = uidAfter instanceof BigInt ? uidAfter.lo : uidAfter
  debug('UID after setuid: ' + uidAfterVal)

  const jailbroken = uidAfterVal === 0
  debug(jailbroken ? 'Already jailbroken' : 'Not jailbroken')
  return jailbroken
}
