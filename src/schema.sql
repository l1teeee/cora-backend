CREATE TABLE IF NOT EXISTS llamadas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  call_id VARCHAR(64) NOT NULL,
  fecha DATETIME NULL,
  duracion INT NULL,
  costo DECIMAL(10,4) NULL,
  transcripcion LONGTEXT NULL,
  resumen TEXT NULL,
  razon_finalizacion VARCHAR(100) NULL,
  numero_telefono VARCHAR(32) NULL,
  url_grabacion VARCHAR(1024) NULL,
  usuario_asignado VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_call_id (call_id),
  KEY idx_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditoria (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(120) NOT NULL,
  accion VARCHAR(60) NOT NULL,
  detalle JSON NULL,
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fecha (fecha),
  KEY idx_accion (accion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS historial_asistente (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  assistant_id VARCHAR(64) NOT NULL,
  config_json JSON NOT NULL,
  usuario VARCHAR(120) NOT NULL,
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_assistant_fecha (assistant_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contactos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  telefono VARCHAR(32) NOT NULL,
  nombre VARCHAR(160) NULL,
  notas TEXT NULL,
  primera_llamada DATETIME NULL,
  ultima_llamada DATETIME NULL,
  total_llamadas INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_telefono (telefono)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La columna se llama login y no usuario a proposito: en el resto del backend `usuario` es
-- QUIEN ejecuta la accion (auditoria), no la cuenta a la que pertenece la fila.
CREATE TABLE IF NOT EXISTS usuarios (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  login VARCHAR(120) NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  rol ENUM('admin','agente') NOT NULL DEFAULT 'agente',
  password_hash VARCHAR(255) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_login (login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE llamadas ADD COLUMN nombre_capturado VARCHAR(160) NULL;
ALTER TABLE llamadas ADD COLUMN motivo VARCHAR(32) NULL;
ALTER TABLE llamadas ADD COLUMN requiere_seguimiento TINYINT(1) NULL;
ALTER TABLE llamadas ADD INDEX idx_telefono (numero_telefono);
