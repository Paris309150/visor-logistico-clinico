const fs = require('fs');
let code = fs.readFileSync('script.js', 'utf8');

// 1. Update the table rendering
const oldTableRender = `                tr.innerHTML = \`
                    <td><strong>\${data.email || docSnap.id}</strong></td>
                    <td>\${selectHtml}</td>
                    <td>\${fechaStr}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger btn-eliminar-usuario" data-id="\${docSnap.id}">
                            <i class="ph ph-trash"></i> Eliminar
                        </button>
                    </td>
                \`;`;
                
const newTableRender = `                tr.innerHTML = \`
                    <td><strong>\${data.nombre || 'No registrado'}</strong><br><small class="text-muted" style="font-size:11px;">Agregado el \${fechaStr}</small></td>
                    <td>\${data.email || docSnap.id}</td>
                    <td>\${selectHtml}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger btn-eliminar-usuario" data-id="\${docSnap.id}" title="Eliminar Acceso">
                            <i class="ph ph-trash"></i> Eliminar
                        </button>
                    </td>
                \`;`;

code = code.replace(oldTableRender, newTableRender);

// 2. Add 'nombre' extraction
const oldInputVars = `            const inputEmail = document.getElementById('input-nuevo-usuario-email');
            const selectRol = document.getElementById('select-nuevo-usuario-rol');
            if (!inputEmail || !selectRol) return;`;
            
const newInputVars = `            const inputEmail = document.getElementById('input-nuevo-usuario-email');
            const selectRol = document.getElementById('select-nuevo-usuario-rol');
            const inputNombre = document.getElementById('usuario-nombre');
            if (!inputEmail || !selectRol) return;`;

code = code.replace(oldInputVars, newInputVars);

const oldRolAssign = `            const rol = selectRol.value;`;
const newRolAssign = `            const rol = selectRol.value;
            const nombre = inputNombre ? inputNombre.value.trim() : '';`;

code = code.replace(oldRolAssign, newRolAssign);

// 3. Add 'nombre' to setDoc
const oldSetDoc1 = `                await setDoc(doc(db, 'Usuarios', correoCompleto), {
                    email: correoCompleto,
                    rol: rol,
                    fechaRegistro: serverTimestamp(),
                    activo: true
                });`;
const newSetDoc1 = `                await setDoc(doc(db, 'Usuarios', correoCompleto), {
                    nombre: nombre,
                    email: correoCompleto,
                    rol: rol,
                    fechaRegistro: serverTimestamp(),
                    activo: true
                });`;
code = code.replace(oldSetDoc1, newSetDoc1);

const oldSetDoc2 = `                        await setDoc(doc(db, 'Usuarios', correoCompleto), {
                            email: correoCompleto,
                            rol: rol,
                            fechaRegistro: serverTimestamp(),
                            activo: true
                        });`;
const newSetDoc2 = `                        await setDoc(doc(db, 'Usuarios', correoCompleto), {
                            nombre: nombre,
                            email: correoCompleto,
                            rol: rol,
                            fechaRegistro: serverTimestamp(),
                            activo: true
                        });`;
code = code.replace(oldSetDoc2, newSetDoc2);

// 4. Clear inputNombre
code = code.replace(`                inputEmail.value = '';
                selectRol.value = '';`, `                inputEmail.value = '';
                selectRol.value = '';
                if(inputNombre) inputNombre.value = '';`);

code = code.replace(`                        inputEmail.value = '';
                        selectRol.value = '';`, `                        inputEmail.value = '';
                        selectRol.value = '';
                        if(inputNombre) inputNombre.value = '';`);

fs.writeFileSync('script.js', code);
console.log('Script patched successfully');
