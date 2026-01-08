/**
 * MAPRIX ENTERPRISE - Frontend Logic v7.0 (Cloudinary Edition)
 * Inclui: Edição Polígonos, Toasts, CRUD Tipos/Ativos, Bateria e Monitoramento Checklist.
 */

// =========================================================
// 0. PATCH DE COMPATIBILIDADE
// =========================================================
L.LineUtil._flat = L.LineUtil.isFlat || L.LineUtil._flat;
L.Polyline.prototype._flat = L.LineUtil.isFlat || L.Polyline.prototype._flat;

// =========================================================
// 1. VARIÁVEIS GLOBAIS E CACHES
// =========================================================
let dadosGlobais = [];
let cacheTipos = {};  // ID do Tipo -> URL da Imagem (Local ou Cloudinary)
let cacheAtivos = {}; // Nome do Equipamento -> ID do Tipo
let lastChecklistId = 0; // Controle de notificação

// =========================================================
// 2. UTILITÁRIOS (UI & URLS)
// =========================================================

// --- NOVA FUNÇÃO: Resolve se a imagem é local ou do Cloudinary ---
function resolverUrlImagem(caminho) {
    if (!caminho) return "";
    // Se começar com http ou https, é Cloudinary/Externo. Se não, é local (/static)
    if (caminho.startsWith('http') || caminho.startsWith('//')) {
        return caminho;
    }
    return `/static/${caminho}`;
}

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

const map = L.map('map', { center: [-14.235, -51.925], zoom: 4, layers: [satelite], zoomControl: false });
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
        console.log("Iniciando sistema...");
        
        carregarRegioes();
        carregarAreas();
        carregarConfigBateria();
        iniciarMonitoramentoChecklists();
        
        // Await garante que ícones existam antes de desenhar o mapa
        await carregarTipos();
        await carregarAtivos();
        
        carregarPontos();
        
    } catch (error) {
        console.error("Erro crítico:", error);
        showToast("Erro ao iniciar dados.", "error");
    }
}

// =========================================================
// 5. GESTÃO DE TIPOS E BATERIA
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
            // CORREÇÃO: Usa o resolvedor de URL
            if(t.icone) {
                cacheTipos[t.id] = resolverUrlImagem(t.icone);
            }

            if(ul) {
                // CORREÇÃO: Usa o resolvedor de URL no HTML
                const urlImg = resolverUrlImagem(t.icone);
                const imgHtml = t.icone 
                    ? `<img src="${urlImg}" style="width:24px; height:24px; object-fit:contain; margin-right:8px; background:#fff; border-radius:4px; padding:2px; border:1px solid #ddd;">` 
                    : '<i class="fas fa-cube" style="margin-right:8px; color:#ccc;"></i>';

                ul.innerHTML += `
                    <li style="display:flex; align-items:center; justify-content:space-between;">
                        <div style="display:flex; align-items:center;">${imgHtml} <span>${t.nome}</span></div>
                        <div style="display:flex; gap:5px;">
                            <button class="btn-icon btn-edit" style="background:#FFC107" onclick="abrirConfigChecklist(${t.id}, '${t.nome}')" title="Checklist"><i class="fas fa-tasks"></i></button>
                            <button class="btn-del-item" onclick="deletarTipo(${t.id})" title="Apagar"><i class="fas fa-trash"></i></button>
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

    // Aviso de upload (já que pode demorar um pouquinho no Cloudinary)
    if(file) showToast("Enviando ícone...", "info");

    fetch('/api/tipos', { method: 'POST', body: formData })
    .then(r => r.json()).then(d => {
        if(d.status === 'sucesso') {
            document.getElementById('novoTipo').value = "";
            document.getElementById('novoIcone').value = "";
            document.getElementById('previewContainer').style.display = 'none';
            carregarTipos().then(() => carregarAtivos().then(() => aplicarFiltro()));
            showToast("Tipo criado com sucesso!", "success");
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

// Configuração Bateria
function carregarConfigBateria() {
    fetch('/api/config/bateria').then(r=>r.json()).then(d => {
        const av = document.getElementById('confBatAviso');
        const cr = document.getElementById('confBatCritico');
        if(av && cr) { av.value = d.aviso; cr.value = d.critico; }
    });
}

function salvarConfigBateria() {
    const aviso = document.getElementById('confBatAviso').value;
    const critico = document.getElementById('confBatCritico').value;
    fetch('/api/config/bateria', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({aviso: aviso, critico: critico})
    }).then(() => showToast("Configuração de bateria salva!", "success"));
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
                
                // O cacheTipos já contém a URL resolvida (http ou /static)
                if(a.tipo_id && cacheTipos[a.tipo_id]) {
                    iconeDisplay = `<img src="${cacheTipos[a.tipo_id]}" style="width:24px; height:24px; object-fit:contain; margin-right:5px;">`;
                }
                
                // Status da Bateria
                let batStatus = "";
                if(a.status_bateria) {
                    let corClass = 'cinza';
                    if (a.cor_bateria === 'vermelho') corClass = 'vermelho';
                    else if (a.cor_bateria === 'laranja') corClass = 'laranja';
                    else if (a.cor_bateria === 'verde') corClass = 'verde';
                    
                    batStatus = `<span class="badge-bateria ${corClass}" style="margin-left:5px;">${a.status_bateria}</span>`;
                }

                const li = document.createElement('li');
                li.innerHTML = `
                    <div onclick="abrirModalEdicao('${a.id}', '${a.nome}', '${a.cor_padrao}', '', 'ativo', '${a.bateria_fabricacao || ''}')" style="flex-grow:1; display:flex; align-items:center; cursor:pointer;">
                        ${iconeDisplay} <b>${a.nome}</b> ${batStatus}
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
// 7. MAPA E CRIAÇÃO DE ÍCONES (COM LABEL E IMAGEM)
// =========================================================

function criarIcone(nomeEquipamento, cor) {
    const tipoId = cacheAtivos[nomeEquipamento];
    const nomeHtml = `<span class="marker-label">${nomeEquipamento}</span>`;

    // CASO 1: Ícone de Imagem (Cache já tem URL resolvida)
    if (tipoId && cacheTipos[tipoId]) {
        return L.divIcon({
            className: 'marker-container',
            html: `<div style="position:relative; width:40px; height:40px;">
                    <img src="${cacheTipos[tipoId]}" class="marker-img-content">
                    ${nomeHtml}
                   </div>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20],
            popupAnchor: [0, -10]
        });
    }

    // CASO 2: Ícone SVG (Fallback)
    return L.divIcon({ 
        className: 'marker-container', 
        html: `<div class="marker-svg-content" style="position:relative; width:30px; height:40px;">
                <svg viewBox="0 0 384 512" width="100%" height="100%">
                    <path fill="${cor||'#007bff'}" d="M172.2 501.6C27 291 0 269.4 0 192 0 86 86 0 192 0s192 86 192 192c0 77.4-27 99-172.2 309.7-9.5 13.7-29.9 13.7-39.5 0z"/>
                    <circle cx="192" cy="192" r="80" fill="white"/>
                </svg>
                ${nomeHtml}
               </div>`, 
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
        
        const obsHtml = p.observacao 
            ? `<div class="popup-obs">"${p.observacao}"</div>` 
            : '<div style="margin-bottom:10px;"></div>';

        m.bindPopup(`
            <div class="popup-header">
                <span>${p.equipamento}</span>
            </div>
            <div class="popup-body">
                <div class="popup-row">
                    <i class="far fa-clock"></i> 
                    <span>${new Date(p.data_hora).toLocaleString()}</span>
                </div>
                <div class="popup-row">
                    <i class="fas fa-map-marker-alt"></i> 
                    <span>Lat: ${p.latitude.toFixed(4)}, Lng: ${p.longitude.toFixed(4)}</span>
                </div>
                ${obsHtml}
            </div>
            <div class="popup-footer">
                <button class="btn-popup edit" onclick="abrirModalEdicao('${p.id}','${p.equipamento}','${p.cor}','${p.observacao}', 'registro')">
                    <i class="fas fa-edit"></i> Editar
                </button>
                <button class="btn-popup del" onclick="deletarPonto(${p.id})">
                    <i class="fas fa-trash"></i> Apagar
                </button>
            </div>
        `);
        layerPontos.addLayer(m);
    });
}

function desenharTrajeto(dados) {
    dados.sort((a,b) => new Date(a.data_hora) - new Date(b.data_hora));
    
    const latlngs = dados
        .filter(d => d.latitude != null && d.longitude != null && !isNaN(d.latitude))
        .map(d => [d.latitude, d.longitude]);

    if (latlngs.length > 1) {
        const poly = L.polyline(latlngs, { color: '#00bcd4', weight: 4, dashArray: '10, 10' });
        poly.addTo(layerTrajeto);
        return poly;
    }
    return null;
}

function focarTrajeto() {
    if (layerTrajeto.getLayers().length > 0) {
        const group = new L.FeatureGroup(layerTrajeto.getLayers());
        map.fitBounds(group.getBounds(), { padding: [50, 50] });
    } else {
        showToast("Nenhum trajeto visível para focar.", "info");
    }
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
// 8. EDIÇÃO E MODAIS
// =========================================================

function abrirModalEdicao(id, nome, cor, obs, contexto, dataBateria = "") {
    document.getElementById('editId').value = id;
    document.getElementById('editContexto').value = contexto;
    document.getElementById('editNome').value = nome;
    
    const colorInput = document.getElementById('editCor');
    const colorPreview = document.querySelector('.color-preview');
    colorInput.value = cor || '#007bff';
    if(colorPreview) colorPreview.style.backgroundColor = cor || '#007bff';

    const divBateria = document.getElementById('divDetalheBateria');
    const divObs = document.getElementById('divObsEdicao');
    const inputBateria = document.getElementById('editBateriaFab');

    if (contexto === 'ativo') {
        divBateria.style.display = 'block';
        divObs.style.display = 'none';
        inputBateria.value = dataBateria;
        calcularPrevisaoTroca();
    } else {
        divBateria.style.display = 'none';
        divObs.style.display = 'flex';
        document.getElementById('editObs').value = obs || '';
    }

    document.getElementById('modalEdicao').style.display = 'flex';
}

function calcularPrevisaoTroca() {
    const dataFab = document.getElementById('editBateriaFab').value;
    const elVenc = document.getElementById('viewBateriaVenc');
    const elStatus = document.getElementById('lblStatusBat');
    const elMeses = document.getElementById('lblMesesUso');
    const elProg = document.getElementById('progressBateria');

    if (!dataFab) {
        elVenc.value = "--";
        elStatus.innerText = "Status: Data não informada";
        elMeses.innerText = "";
        elProg.style.width = "0%";
        return;
    }

    const inicio = new Date(dataFab + "-01");
    const hoje = new Date();
    const limiteMeses = 54; 
    
    const vencimento = new Date(inicio);
    vencimento.setMonth(vencimento.getMonth() + limiteMeses);
    
    const mm = String(vencimento.getMonth() + 1).padStart(2, '0');
    const yyyy = vencimento.getFullYear();
    elVenc.value = `${mm}/${yyyy}`;

    let mesesUso = (hoje.getFullYear() - inicio.getFullYear()) * 12 + (hoje.getMonth() - inicio.getMonth());
    if (mesesUso < 0) mesesUso = 0;

    elMeses.innerText = `${mesesUso} meses de uso`;

    let porcentagem = (mesesUso / limiteMeses) * 100;
    if(porcentagem > 100) porcentagem = 100;
    
    elProg.style.width = `${porcentagem}%`;

    if (mesesUso >= 54) {
        elStatus.innerText = "Status: VENCIDO";
        elStatus.style.color = "var(--danger)";
        elProg.style.background = "var(--danger)";
    } else if (mesesUso >= 48) {
        elStatus.innerText = "Status: ATENÇÃO (Troca Próxima)";
        elStatus.style.color = "#fd7e14"; 
        elProg.style.background = "#fd7e14";
    } else {
        elStatus.innerText = "Status: SAUDÁVEL";
        elStatus.style.color = "var(--success)";
        elProg.style.background = "var(--success)";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const colorInput = document.getElementById('editCor');
    const colorPreview = document.querySelector('.color-preview');
    if(colorInput && colorPreview) {
        colorInput.addEventListener('input', (e) => { colorPreview.style.backgroundColor = e.target.value; });
        document.querySelector('.color-picker-modern').addEventListener('click', () => { colorInput.click(); });
    }
});

function salvarEdicao() {
    const id = document.getElementById('editId').value;
    const contexto = document.getElementById('editContexto').value;
    const nome = document.getElementById('editNome').value;
    const cor = document.getElementById('editCor').value;
    
    if(contexto === 'registro') {
        const obs = document.getElementById('editObs').value;
        fetch(`/api/registro/${id}`, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ equipamento: nome, cor: cor, observacao: obs })
        }).then(() => {
            fecharModal('modalEdicao'); carregarPontos(); showToast("Registro atualizado!", "success");
        });
    } 
    else if (contexto === 'ativo') {
        const dataBat = document.getElementById('editBateriaFab').value;
        
        fetch(`/api/ativos_update/${id}`, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ nome: nome, cor: cor, bateria_fabricacao: dataBat })
        }).then(r => r.json()).then(d => {
            if(d.status === 'sucesso') {
                fecharModal('modalEdicao'); 
                carregarAtivos();
                showToast("Equipamento atualizado!", "success");
            } else {
                showToast("Erro: " + d.erro, "error");
            }
        });
    }
}

// =========================================================
// 9. CHECKLIST MONITORING (ADMIN)
// =========================================================

function iniciarMonitoramentoChecklists() {
    setInterval(() => {
        fetch(`/api/checklists/novos?last_id=${lastChecklistId}`)
        .then(r=>r.json()).then(d => {
            if(d.qtd > 0) {
                lastChecklistId = d.max_id;
                showToast(`🔔 ${d.qtd} Novo(s) Checklist(s)!`, "info");
                if(document.getElementById('content-checklist') && document.getElementById('content-checklist').style.display === 'block') {
                    carregarChecklistsAdmin();
                }
            }
        });
    }, 10000); // Polling 10s
}

// =========================================================
// MÓDULO CHECKLIST: VISUALIZAÇÃO E FILTRO
// =========================================================

function carregarChecklistsAdmin() {
    const div = document.getElementById('listaChecklistsAdmin');
    div.innerHTML = '<div style="text-align:center; padding:20px; color:#999"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';

    fetch('/api/checklists/all').then(r => r.json()).then(lista => {
        div.innerHTML = "";
        
        if(lista.length === 0) {
            div.innerHTML = '<div style="text-align:center; padding:20px; color:#999">Nenhum checklist recebido ainda.</div>';
            return;
        }

        if(lista.length > 0) lastChecklistId = lista[0].id;

        lista.forEach(c => {
            let itensHtml = "";
            let temReprovado = false;

            c.itens.forEach(i => {
                const isOk = i.conforme;
                const statusClass = isOk ? 'status-badge-mini ok' : 'status-badge-mini nok';
                const statusText = isOk ? 'CONFORME' : 'ALERTA';
                
                if(!isOk) temReprovado = true;

                let obsIndicator = "";
                const obsSafe = i.observacao ? i.observacao.replace(/"/g, '&quot;').replace(/'/g, "&#39;") : "";
                
                if (i.observacao) {
                    obsIndicator = `<div class="chk-has-obs-indicator"><i class="fas fa-comment-dots"></i> Ver observação</div>`;
                }

                // CORREÇÃO: Resolve a URL da foto (Cloudinary ou Local)
                let btnFoto = "";
                if (i.foto_path) {
                    const urlFoto = resolverUrlImagem(i.foto_path);
                    const perguntaSafe = i.pergunta.replace(/"/g, "&quot;");
                    
                    btnFoto = `
                        <button class="btn-photo-mini" onclick="event.stopPropagation(); abrirImagemChecklist('${urlFoto}', '${perguntaSafe}')" title="Ver Foto">
                            <i class="fas fa-camera"></i>
                        </button>
                    `;
                } else {
                    btnFoto = `<div style="height:30px;"></div>`; 
                }

                itensHtml += `
                    <div class="chk-item-row-new" onclick="verObservacao('${obsSafe}', '${i.pergunta}')">
                        <div class="chk-left-content">
                            <div class="chk-question-main">${i.pergunta}</div>
                            ${obsIndicator}
                        </div>
                        <div class="chk-right-panel">
                            <span class="${statusClass}">${statusText}</span>
                            ${btnFoto}
                        </div>
                    </div>`;
            });

            const borderStyle = temReprovado 
                ? 'border-left-color: var(--danger);' 
                : 'border-left-color: var(--success);';
    
            const statusBadge = temReprovado 
                ? `<span style="font-size:10px; background:#dc3545; color:white; padding:2px 6px; border-radius:4px; margin-left:5px;">ALERTA</span>` 
                : `<span style="font-size:10px; background:#28a745; color:white; padding:2px 6px; border-radius:4px; margin-left:5px;">OK</span>`;
            
            const dataIso = c.data_hora; 

            const cardHtml = `
                <div class="chk-card-admin" style="${borderStyle}" data-search="${c.equipamento} ${c.operador} ${c.data_hora}">
                    <div class="chk-header-clickable" onclick="toggleChecklistDetails(this)">
                        <div style="flex-grow:1;">
                            <div class="chk-title">
                                <i class="fas fa-truck-moving" style="color:#ccc; margin-right:5px;"></i>
                                ${c.equipamento} 
                                ${statusBadge}
                            </div>
                            <div class="chk-date">
                                <i class="far fa-clock"></i> ${new Date(c.data_hora).toLocaleString()}
                            </div>
                        </div>

                        <div class="chk-actions-group">
                            <button class="btn-icon-sm edit" onclick="event.stopPropagation(); abrirEditarChecklist(${c.id}, '${c.equipamento}', '${c.operador}', '${dataIso}')" title="Editar Cabeçalho">
                                <i class="fas fa-pencil-alt"></i>
                            </button>
                            <button class="btn-icon-sm del" onclick="event.stopPropagation(); deletarChecklist(${c.id})" title="Apagar Registro">
                                <i class="fas fa-trash"></i>
                            </button>
                            <i class="fas fa-chevron-down chk-toggle-icon" style="margin-left:10px;"></i>
                        </div>
                    </div>

                    <div class="chk-body-details">
                        <div class="chk-op-info">
                            <i class="fas fa-user-hard-hat"></i> Operador: <strong>${c.operador}</strong>
                        </div>
                        <div style="background:#fff; border:1px solid #eee; padding:10px; border-radius:5px;">
                            ${itensHtml}
                        </div>
                    </div>
                </div>`;
            
            div.innerHTML += cardHtml;
        });
    });
}

function verObservacao(texto, titulo) {
    const elTexto = document.getElementById('textoObservacaoFull');
    const modal = document.getElementById('modalObsViewer');
    
    if (!texto) {
        showToast("Nenhuma observação registrada para este item.", "info");
        return;
    }

    elTexto.innerHTML = `<strong>Item:</strong> ${titulo}<br><br><strong>Observação:</strong><br>${texto}`;
    modal.style.display = 'flex';
}

function deletarChecklist(id) {
    showConfirm("ATENÇÃO: Isso apagará este registro e todas as respostas. Continuar?", () => {
        fetch(`/api/checklist/${id}`, { method: 'DELETE' })
            .then(() => {
                showToast("Registro apagado.", "success");
                carregarChecklistsAdmin();
            })
            .catch(() => showToast("Erro ao apagar.", "error"));
    });
}

function abrirEditarChecklist(id, equip, oper, dataHora) {
    document.getElementById('editChkId').value = id;
    document.getElementById('editChkEquip').value = equip;
    document.getElementById('editChkOper').value = oper;
    
    const dateObj = new Date(dataHora);
    dateObj.setMinutes(dateObj.getMinutes() - dateObj.getTimezoneOffset());
    document.getElementById('editChkData').value = dateObj.toISOString().slice(0,16);

    document.getElementById('modalEditChecklist').style.display = 'flex';
}

function salvarEdicaoChecklist() {
    const id = document.getElementById('editChkId').value;
    const equip = document.getElementById('editChkEquip').value;
    const oper = document.getElementById('editChkOper').value;
    const dataVal = document.getElementById('editChkData').value;

    if(!equip || !oper || !dataVal) return showToast("Preencha todos os campos", "error");

    fetch(`/api/checklist/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            equipamento: equip,
            operador: oper,
            data_hora: dataVal
        })
    }).then(() => {
        fecharModal('modalEditChecklist');
        carregarChecklistsAdmin();
        showToast("Registro corrigido!", "success");
    });
}

function toggleChecklistDetails(headerElement) {
    const card = headerElement.parentElement;
    card.classList.toggle('open');
}

function filtrarChecklists() {
    const termo = document.getElementById('buscaChecklist').value.toLowerCase();
    const cards = document.querySelectorAll('.chk-card-admin');
    
    cards.forEach(card => {
        const dados = card.getAttribute('data-search').toLowerCase();
        if (dados.includes(termo)) {
            card.style.display = "block";
        } else {
            card.style.display = "none";
        }
    });
}

function abrirConfigChecklist(tipoId, nomeTipo) {
    document.getElementById('checklistTipoId').value = tipoId;
    document.getElementById('tituloChecklistConfig').innerHTML = `<i class="fas fa-tasks"></i> Checklist: ${nomeTipo}`;
    document.getElementById('modalChecklistConfig').style.display = 'flex';
    carregarPerguntasChecklist(tipoId);
}

function carregarPerguntasChecklist(tipoId) {
    fetch(`/api/checklist/config/${tipoId}`).then(r => r.json()).then(lista => {
        const ul = document.getElementById('listaPerguntasChecklist');
        ul.innerHTML = "";
        if(lista.length === 0) ul.innerHTML = "<li style='color:#999; justify-content:center;'>Nenhum item cadastrado.</li>";
        lista.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${p.texto}</span><button class="btn-del-item" onclick="deletarPerguntaChecklist(${p.id}, ${tipoId})"><i class="fas fa-times"></i></button>`;
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
    fetch(`/api/checklist/config/${id}`, { method: 'DELETE' }).then(() => carregarPerguntasChecklist(tipoId));
}

// =========================================================
// 9. ÁREAS (GEOFENCING) - COM EDIÇÃO DE COR
// =========================================================

function carregarAreas() {
    fetch('/api/areas').then(r => r.json()).then(areas => {
        layerAreas.clearLayers();
        
        areas.forEach(a => {
            const layer = L.geoJSON(a.geometry, { 
                style: { color: a.cor, weight: 2, fillOpacity: 0.2 } 
            });
            
            layer.eachLayer(l => {
                l.maprixId = a.id;
                l.maprixNome = a.nome;
                
                l.bindPopup(`
                    <div class="popup-header">
                        <span><i class="fas fa-vector-square" style="margin-right:8px"></i> ${a.nome}</span>
                    </div>
                    
                    <div class="popup-body">
                        <div class="popup-obs">
                            Dica: Para alterar a forma, use o ícone de <i class="fa-solid fa-pen-to-square" style="font-size:10px"></i> na barra lateral.
                        </div>
                    </div>

                    <div class="popup-footer" style="display:flex; gap:5px;">
                        <button class="btn-popup edit" onclick="acionarTrocaCor(${a.id}, '${a.cor}')" style="flex:1; justify-content:center;">
                            <i class="fas fa-palette"></i> Cor
                        </button>
                        
                        <button class="btn-popup del" onclick="deletarArea(${a.id})" style="flex:1; justify-content:center;">
                            <i class="fas fa-trash"></i> Excluir
                        </button>
                    </div>
                `);
                
                layerAreas.addLayer(l);
            });
        });
    });
}

function acionarTrocaCor(id, corAtual) {
    const input = document.getElementById('auxColorPicker');
    input.value = corAtual;
    
    input.onchange = function() {
        const novaCor = input.value;
        fetch(`/api/area/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ cor: novaCor })
        }).then(r => {
            if(r.ok) {
                map.closePopup();
                carregarAreas();
                showToast("Cor atualizada!", "success");
            } else {
                showToast("Erro ao salvar cor.", "error");
            }
        });
    };
    
    input.click();
}

// =========================================================
// 10. BACKUP, CSV E OUTROS
// =========================================================

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
window.deletarArea = function(id) { showConfirm("Apagar área?", () => fetch(`/api/area/${id}`, {method:'DELETE'}).then(()=>{ carregarAreas(); showToast("Removida", "success"); })); }

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
    
    // Carrega dados específicos da aba ao abrir
    if(tab === 'checklist') carregarChecklistsAdmin();

    const btn = document.querySelector(`button[onclick="togglePanel('${tab}')"]`);
    if(btn) btn.classList.add('active');

    const titles = {
        'filtro': 'Mapa e Filtros', 
        'cadastro': 'Gestão de Cadastros', 
        'dados': 'Dados e Configurações',
        'ajuda': 'Ajuda',
        'checklist': 'Respostas Checklists' 
    };
    const tEl = document.getElementById('panelTitle');
    if(tEl) tEl.innerText = titles[tab] || 'Painel';
    
    if(panel) panel.classList.add('open');
}
function fecharPanel() { if(panel) panel.classList.remove('open'); document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active')); }

// === VISUALIZADOR DE IMAGEM ===
function abrirImagemChecklist(url, legenda) {
    const img = document.getElementById('imgViewerSrc');
    const cap = document.getElementById('imgViewerCaption');
    
    img.src = url;
    cap.innerText = legenda || "Evidência Fotográfica";
    
    document.getElementById('modalImageViewer').style.display = 'flex';
}

// INICIA TUDO
carregarTudo();