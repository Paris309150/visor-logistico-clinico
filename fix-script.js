const fs = require('fs');

let lines = fs.readFileSync('script.js', 'utf8').split('\n');

let startIndex = -1;
let endIndex = -1;

for(let i=0; i<lines.length; i++) {
    if (lines[i].includes('estadoCheck: false')) {
        startIndex = i;
    }
    if (startIndex !== -1 && i > startIndex && lines[i].includes('try {')) {
        if(lines[i+1].includes('newBtnFinal.disabled = true;')) {
            endIndex = i;
            break;
        }
    }
}

if(startIndex !== -1 && endIndex !== -1) {
    const replacement = `                        estadoCheck: false
                    });
                }
            });

            if (itemsAEnviar.length === 0) {
                alert("La bandeja no tiene medicamentos válidos.");
                return;
            }

            // Guardar items temporalmente para usarlos en el botón final
            window._bandejaActualItemsTemporal = itemsAEnviar;

            const ulLista = document.getElementById('resumen-bandeja-lista');
            if (ulLista) ulLista.innerHTML = listaHTML;
            const modalResumen = document.getElementById('modal-resumen-bandeja');
            if (modalResumen) modalResumen.style.display = 'flex';
        }
    });

    window.startBandejasModule = async function () {
        // 1. Lógica de Pestañas (Tabs)
        const tabCrear = document.getElementById('tab-crear-bandeja');
        const tabMis = document.getElementById('tab-mis-bandejas');
        const panelCrear = document.getElementById('panel-crear-bandeja');
        const panelMis = document.getElementById('panel-mis-bandejas');

        if (tabCrear && tabMis && panelCrear && panelMis) {
            // Limpiar listeners anteriores clonando
            const newTabCrear = tabCrear.cloneNode(true);
            tabCrear.parentNode.replaceChild(newTabCrear, tabCrear);
            const newTabMis = tabMis.cloneNode(true);
            tabMis.parentNode.replaceChild(newTabMis, tabMis);

            newTabCrear.addEventListener('click', () => {
                panelCrear.style.display = 'block';
                panelMis.style.display = 'none';
                newTabCrear.className = 'btn btn-primary';
                newTabMis.className = 'btn btn-outline-primary';
            });

            newTabMis.addEventListener('click', () => {
                panelCrear.style.display = 'none';
                panelMis.style.display = 'block';
                newTabMis.className = 'btn btn-primary';
                newTabCrear.className = 'btn btn-outline-primary';
            });
        }

        if (document.body.getAttribute('data-user-role') === 'enfermero') {
            const tabMis = document.getElementById('tab-mis-bandejas');
            if (tabMis) tabMis.click();
        }

        // 4. Ejecución Final (Descuento de Stock)
        const btnEjecutarFinal = document.getElementById('btn-ejecutar-despacho-final');
        if (btnEjecutarFinal) {
            const newBtnFinal = btnEjecutarFinal.cloneNode(true);
            btnEjecutarFinal.parentNode.replaceChild(newBtnFinal, btnEjecutarFinal);

            newBtnFinal.addEventListener('click', async (e) => {
                e.preventDefault();

                const selectBandeja = document.getElementById('select-numero-bandeja');
                const inputEnfermero = document.getElementById('select-enfermero-asignado');
                const valorSelect = selectBandeja ? selectBandeja.value : '';
                const valorEmail = inputEnfermero ? inputEnfermero.value.trim() : '';
                const itemsAEnviar = window._bandejaActualItemsTemporal || [];

                console.log("Clic en Sí Aceptar. items:", itemsAEnviar.length);

                if (itemsAEnviar.length === 0) {
                    alert("No hay items para despachar.");
                    return;
                }

                try {`;

    lines.splice(startIndex, endIndex - startIndex + 1, replacement);
    fs.writeFileSync('script.js', lines.join('\n'), 'utf8');
    console.log("Fixed successfully.");
} else {
    console.log("Failed to find bounds.");
}
