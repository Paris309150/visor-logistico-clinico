# 🏥 Visor Logístico Clínico

¡Bienvenido al repositorio del **Visor Logístico Clínico**! Esta es una aplicación web de alto rendimiento diseñada para la gestión integral de inventarios médicos, insumos y el control de flujos logísticos dentro de un entorno hospitalario. El sistema está construido para operar en tiempo real, garantizando la trazabilidad exacta de los fármacos desde la Bodega Central hasta las distintas áreas clínicas (Bandejas).

Aquí encontrarás todo el código fuente del frontend, las reglas de seguridad de la base de datos y los scripts administrativos.

---

## 🛠️ Tecnologías Utilizadas

Para garantizar un rendimiento rápido, seguro y escalable, el proyecto se construyó sobre un stack tecnológico moderno y serverless:

- **Frontend:** HTML5, CSS3 (Diseño responsivo y animaciones fluidas), JavaScript (Vanilla JS - sin frameworks pesados para máxima velocidad).
- **Backend & Base de Datos:** Firebase (Firestore Database, Firebase Authentication, Firebase Hosting).
- **Librerías Auxiliares:** SheetJS (Procesamiento de Excel), Phosphor Icons (Iconografía moderna), SweetAlert2 (Alertas interactivas).
- **Control de Versiones:** Git y Node.js.

---

## 📂 Estructura del Repositorio

El proyecto mantiene una arquitectura limpia y enfocada en la mantenibilidad:

```text
visor-logistico-clinico/
├── index.html               # Interfaz principal de la aplicación (Vista única)
├── style.css                # Sistema de diseño, variables, temas y animaciones
├── script.js                # Lógica central del sistema (Motor RBAC, Listeners, UI)
├── excelUtils.js            # Lógica para importación y exportación masiva de Excel
├── firebase.json            # Configuración de despliegue en Firebase Hosting
├── firestore.rules          # Reglas de seguridad estrictas para la base de datos
├── firestore.indexes.json   # Índices compuestos de Firestore para consultas rápidas
├── package.json             # Dependencias del proyecto de Node.js (Admin SDK)
└── backups/                 # Historial de versiones y changelogs detallados
```

---

## ✨ Características Principales

- 🔐 **Control de Acceso Basado en Roles (RBAC):** Perfiles definidos (Super Administrador, Logística, Bodega, Enfermería y Solo Lectura) con jerarquía de permisos estrictos en la interfaz y en la base de datos.
- 📦 **Gestión de Stock Multiestado:** Control exacto y segregado de los medicamentos entre Bodega Central, stock en Tránsito y Bandejas activas.
- 📊 **Auditoría y Trazabilidad (Cruce RAYEN):** Registro histórico inmutable de todos los movimientos logísticos (quién movió qué, cuándo y hacia dónde).
- 📥 **Cargas Masivas:** Integración robusta con archivos Excel para inicializar, cruzar o actualizar el inventario masivamente en cuestión de segundos.
- ⚡ **Sincronización en Tiempo Real:** Todos los operadores ven los cambios de stock instantáneamente gracias a la arquitectura reactiva de Firestore.

---

## 🚀 Cómo Configurar tu Entorno Local

Si deseas probar el proyecto, explorar el código o continuar con el desarrollo de forma local, sigue estos sencillos pasos:

### 1. Clonar el repositorio
Abre tu terminal y descarga el código a tu equipo:
```bash
git clone https://github.com/Paris309150/visor-logistico-clinico.git
cd visor-logistico-clinico
```

### 2. Instalar dependencias del proyecto
El proyecto utiliza dependencias de Node.js para las herramientas de administración locales:
```bash
npm install
```

### 3. Instalar Firebase CLI
Para poder emular y desplegar el proyecto, necesitas las herramientas globales de Firebase instaladas en tu máquina:
```bash
npm install -g firebase-tools
```

### 4. Autorizar la cuenta
Esto vinculará tu terminal con los permisos necesarios del proyecto en la nube:
```bash
firebase login
```

### 5. Ejecutar el Servidor Local de Desarrollo
Levanta el proyecto localmente. Esto te permitirá visualizar los cambios en vivo en tu navegador en `http://localhost:5000`:
```bash
firebase serve
```

---

## ✍️ Créditos y Propósito

Este sistema ha sido desarrollado a medida para optimizar la cadena de suministro logístico-clínico, priorizando la **velocidad de operación**, la **integridad y seguridad de los datos sensibles**, y ofreciendo una **experiencia de usuario interactiva y sumamente moderna**. Un recurso diseñado para salvar tiempo administrativo y evitar fugas de información.
