import { query } from '../db.js'
import { hashPassword } from '../passwords.js'

// password_hash queda fuera a proposito: ninguna funcion que devuelva usuarios al exterior
// puede incluirlo. Para verificar credenciales esta obtenerConHash, de uso interno.
const COLUMNAS_PUBLICAS = 'id, login, nombre, rol, activo, created_at, updated_at'

export async function listarUsuarios() {
  return await query(`SELECT ${COLUMNAS_PUBLICAS} FROM usuarios ORDER BY login ASC`)
}

export async function obtenerUsuario(login) {
  const filas = await query(`SELECT ${COLUMNAS_PUBLICAS} FROM usuarios WHERE login = ?`, [login])
  return filas[0] ?? null
}

export async function obtenerConHash(login) {
  const filas = await query(`SELECT ${COLUMNAS_PUBLICAS}, password_hash FROM usuarios WHERE login = ?`, [login])
  return filas[0] ?? null
}

export async function crearUsuario({ login, nombre, rol, passwordHash }) {
  const sql = 'INSERT INTO usuarios (login, nombre, rol, password_hash) VALUES (?, ?, ?, ?)'
  await query(sql, [login, nombre, rol, passwordHash])

  return await obtenerUsuario(login)
}

export async function actualizarUsuario(login, { nombre, rol, activo, passwordHash } = {}) {
  const asignaciones = []
  const params = []

  if (nombre !== undefined) {
    asignaciones.push('nombre = ?')
    params.push(nombre)
  }

  if (rol !== undefined) {
    asignaciones.push('rol = ?')
    params.push(rol)
  }

  if (activo !== undefined) {
    asignaciones.push('activo = ?')
    params.push(activo ? 1 : 0)
  }

  if (passwordHash !== undefined) {
    asignaciones.push('password_hash = ?')
    params.push(passwordHash)
  }

  if (asignaciones.length === 0) return false

  params.push(login)
  const result = await query(`UPDATE usuarios SET ${asignaciones.join(', ')} WHERE login = ?`, params)

  return result.affectedRows > 0
}

export async function desactivarUsuario(login) {
  const result = await query('UPDATE usuarios SET activo = 0 WHERE login = ?', [login])
  return result.affectedRows > 0
}

export async function contarAdminsActivos() {
  const [{ total }] = await query("SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin' AND activo = 1")
  return total
}

// Sin siembra nadie puede entrar al panel tras la migracion. Solo corre con la tabla vacia:
// una vez creados los usuarios, cambiar las variables de entorno no debe recrearlos ni pisarlos.
export async function sembrarUsuariosIniciales() {
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM usuarios')
  if (total > 0) return { sembrados: [] }

  const iniciales = [
    { login: process.env.ADMIN_USUARIO, password: process.env.ADMIN_PASSWORD, rol: 'admin' },
    { login: process.env.AGENTE_USUARIO, password: process.env.AGENTE_PASSWORD, rol: 'agente' }
  ].filter((usuario) => usuario.login && usuario.password)

  if (iniciales.length === 0) {
    throw new Error(
      'Tabla usuarios vacia y sin credenciales iniciales: define ADMIN_USUARIO/ADMIN_PASSWORD (y opcionalmente AGENTE_USUARIO/AGENTE_PASSWORD)'
    )
  }

  const sembrados = []

  for (const { login, password, rol } of iniciales) {
    const passwordHash = await hashPassword(password)
    await crearUsuario({ login, nombre: login, rol, passwordHash })
    sembrados.push(login)
  }

  return { sembrados }
}
