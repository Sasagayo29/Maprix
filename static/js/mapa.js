/**
 * MAPRIX ENTERPRISE - Frontend Logic v5.2 (Fix Leaflet Draw)
 */

// =========================================================
// 0. PATCH DE COMPATIBILIDADE (CORREÇÃO DO ERRO _flat)
// =========================================================
// O Leaflet.draw antigo busca _flat, mas o Leaflet novo usa isFlat.
// Isso faz a ponte entre os dois para não quebrar o desenho.
L.LineUtil._flat = L.LineUtil.isFlat || L.LineUtil._flat;
L.Polyline.prototype._flat = L.LineUtil.isFlat || L.Polyline.prototype._flat;

// =========================================================
// 1. VARIÁVEIS GLOBAIS E CACHES
// =========================================================
let dadosGlobais = [];
let cacheTipos = {};  // ID do Tipo -> URL da Imagem
let cacheAtivos = {}; // Nome do Equipamento -> ID do Tipo

// =========================================================
// 2. UTILITÁRIOS DE UI (TOASTS & MODAIS)
// =========================================================

function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if(!container) return alert(msg);

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'info-circle';
    if(type === 'success') icon = 'check-circle';
    if(type === 'error') icon = 'exclamation-circle';

    toast.innerHTML = `<i class="fas fa-${icon}"></i> <span>${msg}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

function showConfirm(msg, callbackYes) {
    const elMsg = document.getElementById('confirmMessage');
    if(elMsg) elMsg.innerText = msg;
    
    const modal = document.getElementById('modalConfirm');
    const btnYes = document.getElementById('btnConfirmYes');
    
    const newBtn = btnYes.cloneNode(true);
    btnYes.parentNode.replaceChild(newBtn, btnYes);
    
    newBtn.onclick = function() {
        callbackYes();
        fecharModal('modalConfirm');
    };
    
    if(modal) modal.style.display = 'flex';
}

function showPrompt(msg, callbackOk) {
    const elMsg = document.getElementById('promptMessage');
    if(elMsg) elMsg.innerText = msg;
    
    const input = document.getElementById('promptInput');
    input.value = "";
    
    const modal = document.getElementById('modalPrompt');
    const btnOk = document.getElementById('btnPromptOk');

    const newBtn = btnOk.cloneNode(true);
    btnOk.parentNode.replaceChild(newBtn, btnOk);

    newBtn.onclick = function() {
        const val = input.value;
        if(val) {
            callbackOk(val);
            fecharModal('modalPrompt');
        } else {
            showToast("Campo vazio!", "error");
        }
    };
    
    if(modal) {
        modal.style.display = 'flex';
        setTimeout(() => input.focus(), 100);
    }
}

function fecharModal(id) {
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
}

// =========================================================
// 3. CONFIGURAÇÃO DO MAPA E DRAWING
// =========================================================

const rua = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {});

const map = L.map('map', { 
    center: [-14.235, -51.925], 
    zoom: 4, 
    layers: [satelite], 
    zoomControl: false 
});
L.control.zoom({ position: 'bottomright' }).addTo(map);

const layerAreas = new L.FeatureGroup().addTo(map);
const layerPontos = new L.LayerGroup().addTo(map);
const layerTrajeto = new L.LayerGroup().addTo(map);

L.control.layers(
    { "Satélite": satelite, "Rua": rua }, 
    { "Áreas": layerAreas, "Equipamentos": layerPontos, "Rotas": layerTrajeto }, 
    { position: 'bottomright' }
).addTo(map);

// Ferramenta de Desenho
let layerDesenhoAtual = null;
const drawControl = new L.Control.Draw({
    draw: { 
        polyline: false, circle: false, circlemarker: false, marker: false,
        polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#aaa', dashArray: '5, 5' } },
        rectangle: { shapeOptions: { color: '#aaa', dashArray: '5, 5' } }
    },
    edit: { featureGroup: layerAreas, remove: true }
});
map.addControl(drawControl);

// Eventos do Desenho
map.on(L.Draw.Event.CREATED, function (e) {
    layerDesenhoAtual = e.layer;
    document.getElementById('areaNome').value = "";
    document.getElementById('modalArea').style.display = 'flex';
});

map.on(L.Draw.Event.EDITED, function (e) {
    const layers = e.layers;
    let atualizados = 0;
    layers.eachLayer(function (layer) {
        if (layer.maprixId) {
            const novaGeometria = layer.toGeoJSON().geometry;
            fetch(`/api/area/${layer.maprixId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ geometry: novaGeometria })
            }).then(r => { if (r.ok) atualizados++; });
        }
    });
    setTimeout(() => { if (atualizados >= 0) showToast("Geometria atualizada!", "success"); }, 500);
});

map.on(L.Draw.Event.DELETED, function (e) {
    const layers = e.layers;
    layers.eachLayer(function (layer) {
        if (layer.maprixId) {
            fetch(`/api/area/${layer.maprixId}`, { method: 'DELETE' })
                .then(() => showToast(`Área removida`, "info"));
        }
    });
});

// =========================================================
// 4. LÓGICA DE DADOS (CARREGAMENTO ORDENADO)
// =========================================================

async function carregarTudo() {
    try {
        console.log("Iniciando carregamento...");
        
        carregarRegioes();
        carregarAreas();
        
        // Await garante que ícones existam antes de desenhar o mapa
        await carregarTipos();
        await carregarAtivos();
        
        carregarPontos();
        
    } catch (error) {
        console.error("Erro crítico no carregamento:", error);
        showToast("Erro ao carregar dados.", "error");
    }
}

// =========================================================
// 5. GESTÃO DE TIPOS (CRUD + CACHE DE ÍCONES)
// =========================================================

function previewIcone() {
    const file = document.getElementById('novoIcone').files[0];
    const preview = document.getElementById('imgPreview');
    const container = document.getElementById('previewContainer');
    if(file) {
        const reader = new FileReader();
        reader.onload = function(e) { preview.src = e.target.result; container.style.display = 'block'; }
        reader.readAsDataURL(file);
    }
}

function carregarTipos() {
    return fetch('/api/tipos').then(r => r.json()).then(lista => {
        const ul = document.getElementById('listaTipos');
        const selCadastro = document.getElementById('cadTipo');
        
        if(ul) ul.innerHTML = "";
        if(selCadastro) selCadastro.innerHTML = '<option value="">-- Selecione o Tipo --</option>';

        cacheTipos = {};

        lista.forEach(t => {
            if(t.icone) {
                cacheTipos[t.id] = `/static/${t.icone}`;
            }

            if(ul) {
                const imgHtml = t.icone 
                    ? `<img src="/static/${t.icone}" style="width:24px; height:24px; object-fit:contain; margin-right:8px; background:#fff; border-radius:4px; padding:2px; border:1px solid #ddd;">` 
                    : '<i class="fas fa-cube" style="margin-right:8px; color:#ccc;"></i>';

                ul.innerHTML += `
    <li style="display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center;">${imgHtml} <span>${t.nome}</span></div>
        <div style="display:flex; gap:5px;">
            <button class="btn-icon btn-edit" style="background:#17a2b8" onclick="abrirConfigChecklist(${t.id}, '${t.nome}')" title="Checklist">
                <i class="fas fa-tasks"></i>
            </button>
            <button class="btn-del-item" onclick="deletarTipo(${t.id})" title="Apagar">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    </li>`;
            }
            if(selCadastro) {
                const opt = document.createElement('option');
                opt.value = t.id; opt.innerText = t.nome;
                selCadastro.appendChild(opt);
            }
        });
    });
}

function criarTipo() {
    const nome = document.getElementById('novoTipo').value;
    const file = document.getElementById('novoIcone').files[0];

    if(!nome) return showToast("Digite o nome do tipo", "error");
    
    const formData = new FormData();
    formData.append('nome', nome);
    if(file) formData.append('file', file);

    fetch('/api/tipos', { method: 'POST', body: formData })
    .then(r => r.json()).then(d => {
        if(d.status === 'sucesso') {
            document.getElementById('novoTipo').value = "";
            document.getElementById('novoIcone').value = "";
            document.getElementById('previewContainer').style.display = 'none';
            carregarTipos().then(() => carregarAtivos().then(() => aplicarFiltro()));
            showToast("Tipo criado!", "success");
        } else { showToast(d.erro, "error"); }
    });
}

function deletarTipo(id) {
    showConfirm("Apagar este tipo?", () => {
        fetch(`/api/tipos/${id}`, { method: 'DELETE' }).then(() => {
            carregarTipos().then(() => aplicarFiltro());
            showToast("Tipo removido", "success");
        });
    });
}

// =========================================================
// 6. GESTÃO DE ATIVOS (FROTA)
// =========================================================

function carregarAtivos() {
    return fetch('/api/ativos').then(r => r.json()).then(lista => {
        const ul = document.getElementById('listaAtivos');
        if(ul) ul.innerHTML = "";
        
        cacheAtivos = {}; 

        lista.forEach(a => {
            if(a.tipo_id) cacheAtivos[a.nome] = a.tipo_id;

            if(ul) {
                let iconeDisplay = `<span style="color:${a.cor_padrao}; font-size:18px; margin-right:5px;">●</span>`;
                if(a.tipo_id && cacheTipos[a.tipo_id]) {
                    iconeDisplay = `<img src="${cacheTipos[a.tipo_id]}" style="width:24px; height:24px; object-fit:contain; margin-right:5px;">`;
                }
                
                const tipoDisplay = a.nome_tipo ? `<span class="tag-tipo">${a.nome_tipo}</span>` : '';

                const li = document.createElement('li');
                li.innerHTML = `
                    <div onclick="abrirModalEdicao('${a.id}', '${a.nome}', '${a.cor_padrao}', '', 'ativo')" style="flex-grow:1; display:flex; align-items:center;">
                        ${iconeDisplay} <b>${a.nome}</b> ${tipoDisplay}
                    </div>
                    <button class="btn-del-item" onclick="deletarAtivo(${a.id})"><i class="fas fa-times"></i></button>
                `;
                ul.appendChild(li);
            }
        });
    });
}

function cadastrarAtivo() {
    const nome = document.getElementById('cadNome').value;
    const tipoId = document.getElementById('cadTipo').value;
    const cor = document.getElementById('cadCor').value;

    if (!nome || !tipoId) return showToast("Preencha nome e selecione um tipo.", "error");
    
    fetch('/api/ativos', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ nome: nome, tipo_id: tipoId, cor: cor })
    }).then(r => r.json()).then(d => {
        if (d.status === 'sucesso') { 
            document.getElementById('cadNome').value = ""; 
            carregarAtivos().then(() => aplicarFiltro()); 
            showToast("Ativo cadastrado!", "success");
        } else { showToast(d.erro, "error"); }
    });
}

function deletarAtivo(id) {
    showConfirm("Remover equipamento da frota?", () => {
        fetch(`/api/ativos/${id}`, { method: 'DELETE' }).then(() => {
            carregarAtivos().then(() => aplicarFiltro());
            showToast("Ativo removido", "success");
        });
    });
}

// =========================================================
// 7. MAPA E CRIAÇÃO DE ÍCONES (CORE)
// =========================================================

function criarIcone(nomeEquipamento, cor) {
    const tipoId = cacheAtivos[nomeEquipamento];
    if (tipoId && cacheTipos[tipoId]) {
        return L.icon({
            iconUrl: cacheTipos[tipoId],
            iconSize: [40, 40],
            iconAnchor: [20, 20],
            popupAnchor: [0, -20],
            className: 'custom-img-marker'
        });
    }
    return L.divIcon({ 
        className: 'custom-marker-icon', 
        html: `<svg viewBox="0 0 384 512" width="30" height="40">
                <path fill="${cor||'#007bff'}" d="M172.2 501.6C27 291 0 269.4 0 192 0 86 86 0 192 0s192 86 192 192c0 77.4-27 99-172.2 309.7-9.5 13.7-29.9 13.7-39.5 0z"/>
                <circle cx="192" cy="192" r="80" fill="white"/>
               </svg>`, 
        iconSize:[30,40], iconAnchor:[15,40], popupAnchor:[0,-40] 
    });
}

function carregarPontos() {
    fetch('/api/locais').then(r => r.json()).then(dados => {
        dadosGlobais = dados;
        popularFiltro(dados);
        aplicarFiltro();
        
        const total = [...new Set(dados.map(d => d.equipamento))].length;
        const elTotal = document.getElementById('statTotal');
        const elReg = document.getElementById('statRegistros');
        if(elTotal) elTotal.innerText = total;
        if(elReg) elReg.innerText = dados.length;
    });
}

function popularFiltro(dados) {
    const select = document.getElementById('filtroEquipamento');
    if(!select) return;
    const valorAtual = select.value;
    const unicos = [...new Set(dados.map(d => d.equipamento))].sort();
    
    select.innerHTML = '<option value="todos">-- Todos os Equipamentos --</option>';
    unicos.forEach(nome => {
        const opt = document.createElement('option');
        opt.value = nome; opt.innerText = nome;
        select.appendChild(opt);
    });

    if ([...select.options].some(o => o.value === valorAtual)) select.value = valorAtual;
}

function aplicarFiltro() {
    const select = document.getElementById('filtroEquipamento');
    if(!select) return;
    const filtro = select.value;

    layerPontos.clearLayers();
    layerTrajeto.clearLayers();
    
    const infoTime = document.getElementById('infoTimeline');
    if(infoTime) infoTime.style.display = 'none';

    let filtrados = dadosGlobais;
    if (filtro !== 'todos') {
        filtrados = dadosGlobais.filter(d => d.equipamento === filtro);
        const poly = desenharTrajeto(filtrados);
        if(infoTime) {
            infoTime.style.display = 'block';
            document.getElementById('nomeTrajeto').innerText = filtro;
            document.getElementById('qtdPontos').innerText = filtrados.length;
        }
        if (poly) map.fitBounds(poly.getBounds(), { padding: [50, 50] });
        else if(filtrados.length > 0) map.setView([filtrados[0].latitude, filtrados[0].longitude], 16);
    }

    filtrados.forEach(p => {
        const icon = criarIcone(p.equipamento, p.cor);
        const m = L.marker([p.latitude, p.longitude], { icon: icon });
        m.bindPopup(`
            <div style="text-align:center">
                <b style="font-size:14px">${p.equipamento}</b><br>
                <small>${new Date(p.data_hora).toLocaleString()}</small><br>
                <div style="margin:5px 0; font-style:italic; color:#555;">${p.observacao||''}</div>
                <div class="popup-actions">
                    <button class="btn-icon btn-edit" onclick="abrirModalEdicao('${p.id}','${p.equipamento}','${p.cor}','${p.observacao}', 'registro')" title="Editar"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon btn-del" onclick="deletarPonto(${p.id})" title="Apagar"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `);
        layerPontos.addLayer(m);
    });
}

function desenharTrajeto(dados) {
    dados.sort((a,b) => new Date(a.data_hora) - new Date(b.data_hora));
    if (dados.length > 1) {
        const poly = L.polyline(dados.map(d => [d.latitude, d.longitude]), { color: '#00bcd4', weight: 4, dashArray: '10, 10' });
        poly.addTo(layerTrajeto);
        return poly;
    }
    return null;
}

function deletarPonto(id) {
    showConfirm("Apagar registro?", () => {
        fetch(`/api/registro/${id}`, { method: 'DELETE' }).then(() => {
            carregarPontos();
            showToast("Registro apagado", "success");
        });
    });
}

// =========================================================
// 8. EDIÇÃO (MODAL)
// =========================================================

// 1. Função abrirModalEdicao Atualizada
function abrirModalEdicao(id, nome, cor, obs, contexto) {
    document.getElementById('editId').value = id;
    document.getElementById('editContexto').value = contexto;
    document.getElementById('editNome').value = nome;
    document.getElementById('editObs').value = obs || '';
    
    // Atualiza o Input de Cor Oculto e a Preview Visual
    const colorInput = document.getElementById('editCor');
    const colorPreview = document.querySelector('.color-preview');
    
    colorInput.value = cor || '#007bff';
    if(colorPreview) {
        colorPreview.style.backgroundColor = cor || '#007bff';
    }
    
    // Lógica de Contexto (Mostrar/Esconder Obs)
    const divObs = document.getElementById('divObsEdicao');
    if(divObs) {
        divObs.style.display = (contexto === 'ativo') ? 'none' : 'flex'; // flex para manter layout
    }

    document.getElementById('modalEdicao').style.display = 'flex';
}

// 2. Listener para atualizar a cor da "Barra" quando o input mudar
// Adicione isso fora de qualquer função, para rodar ao carregar o script
document.addEventListener("DOMContentLoaded", () => {
    const colorInput = document.getElementById('editCor');
    const colorPreview = document.querySelector('.color-preview');
    
    if(colorInput && colorPreview) {
        colorInput.addEventListener('input', (e) => {
            colorPreview.style.backgroundColor = e.target.value;
        });
        
        // Clica na barra inteira para abrir o seletor
        document.querySelector('.color-picker-modern').addEventListener('click', () => {
            colorInput.click();
        });
    }
});

function salvarEdicao() {
    const id = document.getElementById('editId').value;
    const contexto = document.getElementById('editContexto').value;
    const nome = document.getElementById('editNome').value;
    const cor = document.getElementById('editCor').value;
    const obs = document.getElementById('editObs').value;

    if(contexto === 'registro') {
        fetch(`/api/registro/${id}`, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ equipamento: nome, cor: cor, observacao: obs })
        }).then(() => {
            fecharModal('modalEdicao');
            carregarPontos(); 
            showToast("Atualizado!", "success");
        });
    } else {
        showToast("Edição de Ativo não suportada ainda.", "info");
        fecharModal('modalEdicao');
    }
}

// =========================================================
// 9. ÁREAS E REGIÕES
// =========================================================

function carregarAreas() {
    fetch('/api/areas').then(r=>r.json()).then(areas => {
        layerAreas.clearLayers();
        areas.forEach(a => {
            const layer = L.geoJSON(a.geometry, { style:{color:a.cor, weight:2, fillOpacity:0.2} });
            layer.eachLayer(l => {
                l.maprixId = a.id;
                l.bindPopup(`${a.nome}<br><button class="btn-sm" style="background:var(--danger);color:white" onclick="deletarArea(${a.id})">Apagar</button>`);
                layerAreas.addLayer(l);
            });
        });
    });
}

function confirmarArea() {
    const nome = document.getElementById('areaNome').value;
    const cor = document.getElementById('areaCor').value;
    if(nome && layerDesenhoAtual) {
        fetch('/api/salvar_area', { method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ nome: nome, geometry: layerDesenhoAtual.toGeoJSON().geometry, cor: cor })
        }).then(() => { carregarAreas(); cancelarDesenho(); showToast("Área salva!", "success"); });
    } else { showToast("Nome obrigatório", "error"); }
}

function cancelarDesenho() { if(layerDesenhoAtual) map.removeLayer(layerDesenhoAtual); fecharModal('modalArea'); }
window.deletarArea = function(id) { 
    showConfirm("Apagar área?", () => fetch(`/api/area/${id}`, {method:'DELETE'}).then(()=>{ carregarAreas(); showToast("Removida", "success"); })); 
}

// Regiões
function carregarRegioes() {
    fetch('/api/regioes').then(r=>r.json()).then(l => {
        const s = document.getElementById('selectRegiao');
        if(s) {
            s.innerHTML = '<option value="">-- Selecione --</option>';
            l.forEach(r => { const opt=document.createElement('option'); opt.value=JSON.stringify(r); opt.innerText=r.nome; s.appendChild(opt); });
        }
    });
}
function salvarRegiaoAtual() {
    showPrompt("Nome da Visão:", (n) => {
        fetch('/api/regioes', { method:'POST', headers:{'Content-Type':'application/json'}, 
            body: JSON.stringify({nome:n, latitude:map.getCenter().lat, longitude:map.getCenter().lng, zoom:map.getZoom()})
        }).then(()=> { carregarRegioes(); showToast("Salvo!", "success"); });
    });
}
function irParaRegiao() {
    const v = document.getElementById('selectRegiao').value;
    if(v) { const d = JSON.parse(v); map.setView([d.latitude, d.longitude], d.zoom); }
}
function deletarRegiao() {
    const v = document.getElementById('selectRegiao').value;
    if(v) showConfirm("Apagar visão?", () => fetch(`/api/regioes/${JSON.parse(v).id}`, {method:'DELETE'}).then(()=>{ carregarRegioes(); showToast("Apagado", "success"); }));
}

// =========================================================
// 10. BACKUP E CSV
// =========================================================
function backupBanco() { window.location.href = '/api/backup_db'; showToast("Download iniciado...", "info"); }
function restaurarBanco() {
    const f = document.getElementById('dbInput').files[0];
    if(f) showConfirm("Substituir todo o banco?", () => {
        const fd = new FormData(); fd.append('file', f);
        fetch('/api/restore_db', {method:'POST', body:fd}).then(r=>r.json()).then(d=>{
            if(d.status==='sucesso') { alert("Restaurado! Recarregando..."); location.reload(); }
            else showToast(d.erro, "error");
        });
    });
}
function exportarCSV() {
    if(dadosGlobais.length===0) return showToast("Sem dados", "error");
    let csv = "Equipamento,Lat,Lng,Data,Obs\n";
    dadosGlobais.forEach(r => csv += `${r.equipamento},${r.latitude},${r.longitude},${r.data_hora},"${r.observacao}"\n`);
    const a = document.createElement('a'); a.href = window.URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
    a.download = 'backup.csv'; a.click();
}
function importarCSV() {
    const f = document.getElementById('fileInput').files[0];
    if(f) { const fd = new FormData(); fd.append('file', f); fetch('/api/importar_csv', {method:'POST', body:fd}).then(()=> { carregarTudo(); showToast("Importado!", "success"); }); }
}

// =========================================================
// 11. PAINEL LATERAL
// =========================================================
const panel = document.getElementById('sidePanel');
function togglePanel(tab) {
    document.querySelectorAll('.panel-content').forEach(c => c.style.display='none');
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
    
    const content = document.getElementById(`content-${tab}`);
    if(content) content.style.display='block';
    
    const btn = document.querySelector(`button[onclick="togglePanel('${tab}')"]`);
    if(btn) btn.classList.add('active');

    const titles = {'filtro': 'Mapa e Filtros', 'cadastro': 'Gestão de Cadastros', 'dados': 'Dados e Backup', 'ajuda': 'Ajuda'};
    const tEl = document.getElementById('panelTitle');
    if(tEl) tEl.innerText = titles[tab] || 'Painel';
    
    if(panel) panel.classList.add('open');
}
function fecharPanel() { if(panel) panel.classList.remove('open'); document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active')); }

// === GESTÃO DE CHECKLIST (ADMIN) ===

function abrirConfigChecklist(tipoId, nomeTipo) {
    document.getElementById('checklistTipoId').value = tipoId;
    document.getElementById('tituloChecklistConfig').innerHTML = `<i class="fas fa-tasks"></i> Checklist: ${nomeTipo}`;
    document.getElementById('modalChecklistConfig').style.display = 'flex';
    carregarPerguntasChecklist(tipoId);
}

function carregarPerguntasChecklist(tipoId) {
    fetch(`/api/checklist/config/${tipoId}`)
        .then(r => r.json())
        .then(lista => {
            const ul = document.getElementById('listaPerguntasChecklist');
            ul.innerHTML = "";
            if(lista.length === 0) ul.innerHTML = "<li style='color:#999; justify-content:center;'>Nenhum item cadastrado.</li>";
            
            lista.forEach(p => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <span>${p.texto}</span>
                    <button class="btn-del-item" onclick="deletarPerguntaChecklist(${p.id}, ${tipoId})"><i class="fas fa-times"></i></button>
                `;
                ul.appendChild(li);
            });
        });
}

function addPerguntaChecklist() {
    const tipoId = document.getElementById('checklistTipoId').value;
    const texto = document.getElementById('novaPergunta').value;
    
    if(!texto) return showToast("Digite a pergunta", "error");
    
    fetch('/api/checklist/config', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ tipo_id: tipoId, texto: texto })
    }).then(() => {
        document.getElementById('novaPergunta').value = "";
        carregarPerguntasChecklist(tipoId);
        showToast("Item adicionado", "success");
    });
}

function deletarPerguntaChecklist(id, tipoId) {
    fetch(`/api/checklist/config/${id}`, { method: 'DELETE' }).then(() => {
        carregarPerguntasChecklist(tipoId);
    });
}

// INICIA TUDO
carregarTudo();