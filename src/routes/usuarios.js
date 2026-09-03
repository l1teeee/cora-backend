import { randomBytes } from 'node:crypto'
import { rechazaSinAdminKey } from '../auth.js'
import { hashPassword, verificarPassword } from '../passwords.js'
import {
  listarUsuarios,
  obtenerUsuario,
  obtenerConHash,
  crearUsuario,
  actualizarUsuario,
  desactivarUsuario,
  contarAdminsActivos
} from '../repository/usuarios.js'
import { registrarAuditoria } from '../repository/auditoria.js'

const ROLES = ['admin', 'agente']
const LARGO_MINIMO_PASSWORD = 8

function esCadenaNoVacia(valor) {
  return typeof valor === 'string' && valor.trim() !== ''
}

// El dashboard manda el usuario de la sesion (body o header x-usuario); que falte no debe
// impedir registrar la auditoria, solo queda sin atribuir
function usuarioDe(request) {
  const usuario = request.body?.usuario ?? request.headers['x-usuario']
  return typeof usuario === 'string' && usuario.trim() !== '' ? usuario.slice(0, 120) : 'desconocido'
}

function sinHash(fila) {
  const { password_hash, ...publico } = fila
  return publico
}

export default async function (fastify, opts) {
  // Hash de descarte contra el que se verifica cuando el login no existe: sin el, un login
  // inexistente responderia mucho mas rapido que uno real y revelaria cuales cuentas existen
  const hashInexistente = await hashPassword(randomBytes(32).toString('hex'))

  fastify.get('/usuarios', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    try {
      const usuarios = await listarUsuarios()
      return { usuarios }
    } catch (error) {
      request.log.error(error, 'Error consultando usuarios')
      return reply.code(500).send({ error: 'Error consultando usuarios' })
    }
  })

  fastify.post('/usuarios', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { login, nombre, rol, password } = request.body ?? {}

    if (!esCadenaNoVacia(login)) {
      return reply.code(400).send({ error: 'login es obligatorio' })
    }

    if (!ROLES.includes(rol)) {
      return reply.code(400).send({ error: 'rol debe ser admin o agente' })
    }

    if (typeof password !== 'string' || password.length < LARGO_MINIMO_PASSWORD) {
      return reply.code(400).send({ error: `La password debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres` })
    }

    const loginNormalizado = login.trim().slice(0, 120)

    try {
      if (await obtenerUsuario(loginNormalizado)) {
        return reply.code(409).send({ error: 'Ya existe un usuario con ese login' })
      }

      const passwordHash = await hashPassword(password)
      const usuarioCreado = await crearUsuario({
        login: loginNormalizado,
        nombre: esCadenaNoVacia(nombre) ? nombre.trim().slice(0, 160) : loginNormalizado,
        rol,
        passwordHash
      })

      // El usuario ya quedo creado: un fallo de auditoria no debe tumbar la respuesta
      let auditoriaRegistrada = true
      try {
        await registrarAuditoria({
          usuario: usuarioDe(request),
          accion: 'creo_usuario',
          detalle: { login: loginNormalizado, rol }
        })
      } catch (error) {
        request.log.error(error, 'Error registrando la auditoria de creacion de usuario')
        auditoriaRegistrada = false
      }

      return reply.code(201).send({ ok: true, usuario: usuarioCreado, auditoriaRegistrada })
    } catch (error) {
      request.log.error(error, 'Error creando el usuario')
      return reply.code(500).send({ error: 'Error creando el usuario' })
    }
  })

  fastify.patch('/usuarios/:login', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { login } = request.params
    const { nombre, rol, activo, password } = request.body ?? {}

    if (rol !== undefined && !ROLES.includes(rol)) {
      return reply.code(400).send({ error: 'rol debe ser admin o agente' })
    }

    if (password !== undefined && (typeof password !== 'string' || password.length < LARGO_MINIMO_PASSWORD)) {
      return reply.code(400).send({ error: `La password debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres` })
    }

    if (nombre === undefined && rol === undefined && activo === undefined && password === undefined) {
      return reply.code(400).send({ error: 'Nada que actualizar' })
    }

    try {
      const usuario = await obtenerUsuario(login)

      if (!usuario) {
        return reply.code(404).send({ error: 'Usuario no encontrado' })
      }

      // Editar es la otra puerta para quedarse sin admin: degradar a agente o desactivar
      // al ultimo deja el panel sin nadie que pueda administrarlo, y no hay forma de
      // recuperarlo desde la interfaz. Mismo criterio que el DELETE.
      const pierdeElUltimoAdmin =
        usuario.rol === 'admin' &&
        usuario.activo &&
        (rol === 'agente' || activo === 0 || activo === false)

      if (pierdeElUltimoAdmin && (await contarAdminsActivos()) === 1) {
        return reply.code(409).send({ error: 'No se puede quitar el acceso al ultimo admin activo' })
      }

      const cambios = []
      if (nombre !== undefined) cambios.push('nombre')
      if (rol !== undefined) cambios.push('rol')
      if (activo !== undefined) cambios.push('activo')
      if (password !== undefined) cambios.push('password')

      const passwordHash = password !== undefined ? await hashPassword(password) : undefined
      await actualizarUsuario(login, { nombre, rol, activo, passwordHash })

      // La lista de campos alcanza para la trazabilidad; ni la password ni su hash entran a la auditoria
      let auditoriaRegistrada = true
      try {
        await registrarAuditoria({
          usuario: usuarioDe(request),
          accion: 'edito_usuario',
          detalle: { login, cambios }
        })
      } catch (error) {
        request.log.error(error, 'Error registrando la auditoria de edicion de usuario')
        auditoriaRegistrada = false
      }

      return { ok: true, cambios, auditoriaRegistrada }
    } catch (error) {
      request.log.error(error, 'Error actualizando el usuario')
      return reply.code(500).send({ error: 'Error actualizando el usuario' })
    }
  })

  // Baja logica, nunca DELETE fisico: llamadas.usuario_asignado apunta a este login y borrarlo
  // dejaria llamadas huerfanas apuntando a un usuario inexistente
  fastify.delete('/usuarios/:login', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { login } = request.params

    try {
      const usuario = await obtenerUsuario(login)

      if (!usuario) {
        return reply.code(404).send({ error: 'Usuario no encontrado' })
      }

      if (usuario.rol === 'admin' && usuario.activo && (await contarAdminsActivos()) === 1) {
        return reply.code(409).send({ error: 'No se puede desactivar al ultimo admin activo' })
      }

      await desactivarUsuario(login)

      let auditoriaRegistrada = true
      try {
        await registrarAuditoria({
          usuario: usuarioDe(request),
          accion: 'desactivo_usuario',
          detalle: { login }
        })
      } catch (error) {
        request.log.error(error, 'Error registrando la auditoria de desactivacion de usuario')
        auditoriaRegistrada = false
      }

      return { ok: true, auditoriaRegistrada }
    } catch (error) {
      request.log.error(error, 'Error desactivando el usuario')
      return reply.code(500).send({ error: 'Error desactivando el usuario' })
    }
  })

  fastify.post('/usuarios/verificar', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { login, password } = request.body ?? {}

    try {
      const usuario = esCadenaNoVacia(login) ? await obtenerConHash(login) : null

      // Se verifica igual contra un hash de descarte cuando el login no existe: responder antes
      // en ese caso permitiria distinguir por tiempo que logins son reales
      const passwordValida = await verificarPassword(password ?? '', usuario?.password_hash ?? hashInexistente)

      // Mismo 401 exista o no el login, y este activo o no: el mensaje no debe filtrar cual de las dos fallo
      if (!usuario || !passwordValida || !usuario.activo) {
        return reply.code(401).send({ error: 'Credenciales invalidas' })
      }

      return { usuario: sinHash(usuario) }
    } catch (error) {
      request.log.error(error, 'Error verificando las credenciales')
      return reply.code(500).send({ error: 'Error verificando las credenciales' })
    }
  })
}
