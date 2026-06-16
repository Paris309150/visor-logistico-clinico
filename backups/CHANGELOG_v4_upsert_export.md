# 📦 Registro de Cambios V4: Upsert y Exportación PRO
**Fecha del Backup**: 21 de Abril de 2024
**Versión**: `20260421_v4_UpsertExportPRO`

## 🚀 Nuevas Capacidades de Élite
Esta versión introduce inteligencia de datos y herramientas de resguardo institucional de alto nivel.

### 1. 🔄 Motor de Carga Masiva (Upsert Logic)
- **No-Duplicidad**: El sistema ahora detecta automáticamente si un producto ya existe (por ID/Nombre + Lote).
- **Actualización Incremental**: En lugar de duplicar, el sistema suma el nuevo stock al existente usando `increment()` de Firestore, asegurando que los registros siempre reflejen el total real.
- **Sincronización Automática**: El precio y la ubicación se actualizan con la información más reciente del archivo cargado.

### 2. 📁 Exportación Masiva (Resguardo Admin)
- **Backup Institucional**: Nueva función para descargar el inventario completo en formato Excel.
- **Formateo de Fechas Legible**: El exportador revierte formatos técnicos a `DD / MM / AAAA` automáticamente.
- **Control RBAC**: Función blindada y oculta; solo visible y ejecutable por usuarios con rol de `admin`.

### 3. 🛡️ Capa de Seguridad (RBAC & Validaciones)
- **Validación Dual**: La descarga de datos se valida tanto en la interfaz (CSS) como en el servidor (Firebase JS) antes de procesar la consulta.
- **Sanitización Total**: Limpieza de descripciones y preparación de datos para re-carga inmediata.

---
**Backup realizado por Antigravity - Senior Fullstack Developer**
