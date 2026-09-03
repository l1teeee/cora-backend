import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derivar = promisify(scrypt)

const COSTO = 16384
const BLOQUE = 8
const PARALELISMO = 1
const LONGITUD_SALT = 16
const LONGITUD_CLAVE = 64

// Formato: scrypt$N$r$p$salt$hash (base64). Los parametros viajan dentro del hash para poder
// subirlos mas adelante sin invalidar las passwords ya guardadas.
export async function hashPassword(plano) {
  const salt = randomBytes(LONGITUD_SALT)
  const derivada = await derivar(String(plano), salt, LONGITUD_CLAVE, { N: COSTO, r: BLOQUE, p: PARALELISMO })

  return `scrypt$${COSTO}$${BLOQUE}$${PARALELISMO}$${salt.toString('base64')}$${derivada.toString('base64')}`
}

export async function verificarPassword(plano, hashGuardado) {
  if (typeof hashGuardado !== 'string') return false

  const partes = hashGuardado.split('$')
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false

  const [, costo, bloque, paralelismo, saltBase64, hashBase64] = partes
  const salt = Buffer.from(saltBase64, 'base64')
  const esperado = Buffer.from(hashBase64, 'base64')

  if (salt.length === 0 || esperado.length === 0) return false

  try {
    const derivada = await derivar(String(plano), salt, esperado.length, {
      N: Number(costo),
      r: Number(bloque),
      p: Number(paralelismo)
    })

    return timingSafeEqual(derivada, esperado)
  } catch {
    // Hash guardado con parametros corruptos o fuera de rango: es password invalida, no un crash
    return false
  }
}
