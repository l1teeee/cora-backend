import './env.js'
import Fastify from 'fastify'
import { ejecutarMigracion } from './migrate.js'
import { configuracionDb } from './db.js'
import rutaWebhook from './routes/webhook.js'
import rutaLlamadas from './routes/llamadas.js'
import rutaSync from './routes/sync.js'
import rutaAuditoria from './routes/auditoria.js'
import rutaVapi from './routes/vapi.js'
import rutaContactos from './routes/contactos.js'
import rutaUsuarios from './routes/usuarios.js'
import { sembrarUsuariosIniciales } from './repository/usuarios.js'


const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 }) // payloads de Vapi con transcripcion completa superan el limite default de 1MB

const estado = () => ({ ok: true, servicio: 'cora-backend', ts: new Date().toISOString() })

app.get('/', async () => estado())
app.get('/health', async () => estado())

await app.register(rutaWebhook)
await app.register(rutaLlamadas)
await app.register(rutaSync)
await app.register(rutaAuditoria)
await app.register(rutaVapi)
await app.register(rutaContactos)
await app.register(rutaUsuarios)

async function iniciar() {
  try {
    app.log.info({ db: configuracionDb() }, 'Conectando a MySQL')
    await ejecutarMigracion()

    // Sin siembra nadie puede entrar al panel tras la migracion; con la tabla ya poblada no hace nada
    const { sembrados } = await sembrarUsuariosIniciales()
    if (sembrados.length > 0) {
      app.log.info({ sembrados }, 'Usuarios iniciales creados')
    }

    await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' })
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

iniciar()
