const fs = require('fs');
const path = require('path');

// Helper para colores en consola
const logSuccess = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const logWarning = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const logError = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

// Archivos principales de tu SPA que queremos respaldar
const filesToTrack = ['index.html', 'style.css', 'script.js'];
const backupDir = path.join(__dirname, '.rollbacks');

// Capturar los comandos de la terminal
const args = process.argv.slice(2);
const command = args[0];
const param = args[1];

// Asegurar que exista la carpeta oculta de rollbacks
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
}

function getTimestamp() {
    const now = new Date();
    return now.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
}

switch (command) {
    case 'save':
    try {
        // EJEMPLO: node manager.js save "antes_de_firebase"
        const folderName = param ? `${getTimestamp()}__${param}` : getTimestamp();
        const targetDir = path.join(backupDir, folderName);
        fs.mkdirSync(targetDir);

        filesToTrack.forEach(file => {
            if (fs.existsSync(file)) {
                fs.copyFileSync(file, path.join(targetDir, file));
            } else {
                logWarning(`⚠️ Advertencia: No se encontró ${file}`);
            }
        });
        logSuccess(`✅ SNAPSHOT DIGITAL GUARDADO EN: .rollbacks/${folderName}`);
    } catch (err) {
        logError(`❌ ERROR al crear snapshot: ${err.message}`);
    }
    break;

    case 'list':
    try {
        // EJEMPLO: node manager.js list
        const backups = fs.readdirSync(backupDir).filter(f => fs.lstatSync(path.join(backupDir, f)).isDirectory());
        logSuccess('\n📦 PUNTOS DE ROLLBACK DISPONIBLES:');
        if (backups.length === 0) logWarning('   (Ninguno todavía. Usa "node manager.js save")');
        backups.forEach((b, index) => console.log(`   [${index}] ${b}`));
    } catch (err) {
        logError(`❌ ERROR al listar backups: ${err.message}`);
    }
    break;

    case 'rollback':
    try {
        // EJEMPLO: node manager.js rollback 2026-04-08_10-15-00__antes_de_firebase
        if (!param) {
            logError('\n❌ ERROR: Debes indicar el nombre exacto de la carpeta a la que quieres volver.');
            logWarning('Usa "node manager.js list" para ver los nombres.\n');
            break;
        }

        const sourceDir = path.join(backupDir, param);
        if (!fs.existsSync(sourceDir)) {
            logError(`\n❌ ERROR: El punto de rollback "${param}" no existe.\n`);
            break;
        }

        filesToTrack.forEach(file => {
            const backupFile = path.join(sourceDir, file);
            if (fs.existsSync(backupFile)) {
                fs.copyFileSync(backupFile, file);
                console.log(`   Revertido: ${file}`);
            }
        });
        logSuccess(`\n🔄 ROLLBACK DIGITAL COMPLETADO. Has vuelto a la versión: ${param}\n`);
    } catch (err) {
        logError(`❌ ERROR durante rollback: ${err.message}`);
    }
    break;

    default:
        console.log('\nComandos disponibles:');
        console.log('  node manager.js save "nombre_etiqueta"  -> Crea un punto de restauración');
        console.log('  node manager.js list                    -> Muestra el historial de versiones');
        console.log('  node manager.js rollback "nombre_dir"   -> Restaura el código a ese punto\n');
}