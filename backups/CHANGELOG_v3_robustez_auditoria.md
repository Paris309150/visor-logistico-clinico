# 📦 Registro de Cambios V3: Robustez, Auditoría y Seguridad RBAC
**Fecha del Backup**: 21 de Abril de 2024
**Versión**: `20260421_v3_RobustezAudit`

## 💎 Mejoras Críticas e Infraestructura
Esta versión consolida el sistema como una plataforma de grado clínico, eliminando quiebres técnicos en procesos masivos y blindando la seguridad del núcleo.

### 1. 🛡️ Seguridad y Permisos (RBAC Cloud)
- **Firestore Rules**: Implementación de reglas granulares para la colección `informes`. Solo usuarios con rol `admin` en la base de datos `Usuarios` pueden leer o escribir logs de auditoría.
- **Acceso Denegado**: Se corrigió el error *Missing permissions* al intentar guardar incidencias de carga.

### 2. ⚡ Motor de Carga Masiva (v2.0)
- **ID Opcional**: El SKU ya no es obligatorio. El sistema genera IDs auto-generados (`AUTO-XXXX`) si el campo viene vacío, permitiendo cargar insumos rápidos.
- **Sanitización de Datos**: Limpieza automática de saltos de línea (`\n`) y espacios excesivos en las descripciones (ideal para datos extraídos de PDFs).
- **Reporte de Errores PRO**: Generación de CSV con campos envueltos en comillas y soporte BOM para apertura inmediata en Excel sin problemas de formato.

### 3. ✏️ Gestión de Inventario (Edición con Auditoría)
- **Modal de Edición**: Nueva interfaz con 10 campos de control para ajustes manuales.
- **Inmutabilidad de Auditoría**: Cada edición manual dispara un log de auditoría inmutable que registra quién editó, qué cambió y el valor anterior (Diffing).
- **Corrección de Fechas**: Conversión automática de números seriales de Excel a formato HTML5 (`YYYY-MM-DD`) al editar.

### 4. 📂 Auditoría Visual
- **Pestaña de Informes**: Se integró una tabla dinámica de **Logs de Auditoría** que permite al administrador ver en tiempo real los fallos o éxitos de las cargas masivas realizadas.

---
**Backup realizado por Antigravity - Senior Fullstack Developer**
