/**
 * MAPRIX - Lógica do Mapa de Gestão
 * Arquivo: static/js/mapa.js
 */

// --- 1. CONFIGURAÇÃO INICIAL DO MAPA ---

// Camadas Base
const rua = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
    maxZoom: 19, 
    attribution: '© OpenStreetMap' 
});

const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
    attribution: 'Tiles © Esri' 
});

// Inicializa Mapa (Centro do Brasil)
const map = L.map('map', {
    center: [-14.2350, -51.9253],
    zoom: 4,
    layers: [satelite], // Começa com Satélite
    zoomControl: false  // Desativa zoom padrão para reposicionar
});

// Reposiciona o Zoom no canto inferior direito
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Grupos de Camadas
const layerAreas = new L.FeatureGroup().addTo(map);   // Polígonos
const layerPontos = new L.LayerGroup().addTo(map);    // Pinos
const layerTrajeto = new L.LayerGroup().addTo(map);   // Linhas

// Controle de Camadas
L.control.layers(
    { "Satélite": satelite, "Mapa de Ruas": rua }, 
    { "Áreas Delimitadas": layerAreas, "Equipamentos": layerPontos, "Rastro": layerTrajeto }, 
    { position: 'bottomright' }
).addTo(map);


// --- 2. FERRAMENTA DE DESENHO (ÁREAS) ---

// Variável para guardar o desenho temporariamente enquanto escolhe a cor
let layerDesenhoAtual = null;

const drawControl = new L.Control.Draw({
    draw: {
        polyline: false, circle: false, circlemarker: false, marker: false,
        // Configuração visual padrão (cinza) antes de escolher a cor
        polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#aaa', dashArray: '5, 5' } },
        rectangle: { shapeOptions: { color: '#aaa', dashArray: '5, 5' } }
    },
    edit: { featureGroup: layerAreas, remove: true }
});
map.addControl(drawControl);

// Evento: Quando o usuário termina de desenhar no mapa
map.on(L.Draw.Event.CREATED, function (e) {
    layerDesenhoAtual = e.layer; // Guarda o desenho na memória
    
    // Reseta e abre o Modal de Área
    document.getElementById('areaNome').value = "";
    document.getElementById('areaCor').value = "#FFC107"; // Dourado padrão
    document.getElementById('modalArea').style.display = 'flex';
});


// --- 3. LÓGICA DOS MODAIS (ÁREA E EQUIPAMENTO) ---

// A) MODAL DE ÁREA (Salvar Desenho)
function confirmarArea() {
    const nome = document.getElementById('areaNome').value;
    const cor = document.getElementById('areaCor').value;

    if (!nome) return alert("Por favor, dê um nome para a área.");

    if (layerDesenhoAtual) {
        // Envia para o Backend
        fetch('/api/salvar_area', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                nome: nome, 
                geometry: layerDesenhoAtual.toGeoJSON().geometry,
                cor: cor 
            })
        }).then(res => {
            if(res.ok) {
                carregarTudo(); // Recarrega do servidor para pegar o ID correto
                cancelarDesenho(); // Fecha modal
            } else {
                alert("Erro ao salvar área.");
            }
        });
    }
}

function cancelarDesenho() {
    if(layerDesenhoAtual && !layerAreas.hasLayer(layerDesenhoAtual)) {
        // Se cancelou e o layer não foi salvo, remove do mapa se estiver lá
        map.removeLayer(layerDesenhoAtual);
    }
    document.getElementById('modalArea').style.display = 'none';
    layerDesenhoAtual = null;
}

// Funçao global para deletar área pelo Popup
window.deletarArea = function(id) {
    if(confirm("Deseja apagar esta delimitação?")) {
        fetch(`/api/area/${id}`, { method: 'DELETE' })
            .then(() => carregarTudo());
    }
};


// B) MODAL DE EQUIPAMENTO (Editar Ponto)
function abrirModalEdicao(id, nome, cor, obs) {
    document.getElementById('editId').value = id;
    document.getElementById('editNome').value = nome;
    document.getElementById('editCor').value = cor;
    document.getElementById('editObs').value = (obs === 'null' || obs === 'undefined') ? '' : obs;
    
    document.getElementById('modalEdicao').style.display = 'flex';
}

function fecharModal() {
    document.getElementById('modalEdicao').style.display = 'none';
}

function salvarEdicao() {
    const id = document.getElementById('editId').value;
    const dados = {
        equipamento: document.getElementById('editNome').value,
        cor: document.getElementById('editCor').value,
        observacao: document.getElementById('editObs').value
    };

    fetch(`/api/registro/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(dados)
    }).then(res => {
        if(res.ok) {
            fecharModal();
            carregarTudo();
        } else {
            alert("Erro ao atualizar registro.");
        }
    });
}


// --- 4. DADOS E RENDERIZAÇÃO ---

let dadosGlobais = [];

// Função para gerar ícone SVG colorido dinamicamente
function criarIcone(cor) {
    const c = cor || '#007bff'; // Azul padrão se não tiver cor
    // SVG de Marcador FontAwesome style
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="30" height="40">
            <path fill="${c}" d="M172.268 501.67C26.97 291.031 0 269.413 0 192 0 85.961 85.961 0 192 0s192 85.961 192 192c0 77.413-26.97 99.031-172.268 309.67-9.535 13.774-29.93 13.773-39.464 0z"/>
            <circle cx="192" cy="192" r="80" fill="white"/>
        </svg>`;
    
    return L.divIcon({
        html: svg,
        className: 'custom-marker-icon', // Classe para sombra no CSS
        iconSize: [30, 40],
        iconAnchor: [15, 40],
        popupAnchor: [0, -40]
    });
}

function carregarTudo() {
    // 1. Carregar Áreas
    fetch('/api/areas').then(r => r.json()).then(areas => {
        layerAreas.clearLayers();
        areas.forEach(a => {
            const layer = L.geoJSON(a.geometry, {
                style: { color: a.cor, weight: 2, fillOpacity: 0.3 }
            });
            
            // Adiciona popup com botão de deletar
            layer.eachLayer(l => {
                l.bindPopup(`
                    <div style="text-align:center">
                        <b>${a.nome}</b><br>
                        <button class="btn-del" style="margin-top:5px; padding:5px; border:none; background:#d9534f; color:white; border-radius:4px; cursor:pointer;" onclick="deletarArea(${a.id})">
                            <i class="fas fa-trash"></i> Apagar
                        </button>
                    </div>
                `);
                layerAreas.addLayer(l);
            });
        });
    });

    // 2. Carregar Equipamentos
    fetch('/api/locais').then(r => r.json()).then(dados => {
        dadosGlobais = dados;
        popularSelect(dados);
        atualizarDashboard(dados);
        aplicarFiltro();
    });
}

function popularSelect(dados) {
    const sel = document.getElementById('filtroEquipamento');
    const val = sel.value;
    // Pega nomes únicos
    const unicos = [...new Set(dados.map(d => d.equipamento))];
    
    sel.innerHTML = '<option value="todos">Mostrar Todos</option>';
    unicos.forEach(nome => {
        const opt = document.createElement('option');
        opt.value = nome;
        opt.innerText = nome;
        sel.appendChild(opt);
    });
    sel.value = val;
}

function aplicarFiltro() {
    const filtro = document.getElementById('filtroEquipamento').value;
    
    layerPontos.clearLayers();
    layerTrajeto.clearLayers();
    document.getElementById('infoTimeline').style.display = 'none';

    let filtrados = dadosGlobais;

    // Lógica de Filtro e Timeline
    if (filtro !== 'todos') {
        filtrados = dadosGlobais.filter(d => d.equipamento === filtro);
        desenharTrajeto(filtrados);
        
        document.getElementById('infoTimeline').style.display = 'block';
        document.getElementById('nomeTrajeto').innerText = filtro;
        document.getElementById('qtdPontos').innerText = filtrados.length;
        
        // Foca no último ponto
        if(filtrados.length > 0) {
            const ultimo = filtrados[filtrados.length - 1];
            map.setView([ultimo.latitude, ultimo.longitude], 16);
        }
    }

    // Desenha os marcadores
    filtrados.forEach(p => {
        const marker = L.marker([p.latitude, p.longitude], { 
            icon: criarIcone(p.cor) 
        });

        const obsHtml = p.observacao ? 
            `<div style="background:#f9f9f9; padding:5px; border-left:3px solid #ccc; margin:5px 0; font-style:italic; font-size:12px;">"${p.observacao}"</div>` : '';

        marker.bindPopup(`
            <div style="text-align:center; min-width: 150px;">
                <b style="font-size:14px">${p.equipamento}</b><br>
                <small>${new Date(p.data_hora).toLocaleString()}</small>
                ${obsHtml}
                <div class="popup-actions">
                    <button class="btn-icon btn-edit" onclick="abrirModalEdicao('${p.id}', '${p.equipamento}', '${p.cor || '#007bff'}', '${p.observacao || ''}')" title="Editar"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon btn-del" onclick="deletarPonto(${p.id})" title="Apagar"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `);
        layerPontos.addLayer(marker);
    });
}

function desenharTrajeto(dados) {
    // Ordena Cronologicamente
    dados.sort((a,b) => new Date(a.data_hora) - new Date(b.data_hora));
    
    if (dados.length > 1) {
        L.polyline(dados.map(d => [d.latitude, d.longitude]), { 
            color: '#00bcd4', // Ciano (destaca bem no satélite)
            weight: 4, 
            dashArray: '10, 10' 
        }).addTo(layerTrajeto);
    }
}

function atualizarDashboard(dados) {
    const totalEquip = [...new Set(dados.map(d => d.equipamento))].length;
    document.getElementById('statTotal').innerText = totalEquip;
    document.getElementById('statRegistros').innerText = dados.length;
}


// --- 5. INTERFACE (PAINEL LATERAL) ---

const panel = document.getElementById('sidePanel');

function togglePanel(tipo) {
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
    
    if (tipo === 'filtro') {
        document.querySelector('button[onclick="togglePanel(\'filtro\')"]').classList.add('active');
        document.getElementById('content-filtro').style.display = 'block';
        document.getElementById('content-ajuda').style.display = 'none';
        document.getElementById('panelTitle').innerText = "Filtros & Gestão";
        panel.classList.add('open');
    } 
    else if (tipo === 'ajuda') {
        document.querySelector('button[onclick="togglePanel(\'ajuda\')"]').classList.add('active');
        document.getElementById('content-filtro').style.display = 'none';
        document.getElementById('content-ajuda').style.display = 'block';
        document.getElementById('panelTitle').innerText = "Ajuda";
        panel.classList.add('open');
    }
    
    // Animação CSS dura 300ms, ajusta o mapa depois
    setTimeout(() => map.invalidateSize(), 300);
}

function fecharPanel() {
    panel.classList.remove('open');
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('active'));
    setTimeout(() => map.invalidateSize(), 300);
}


// --- 6. FUNÇÕES UTILITÁRIAS E GLOBAIS ---

window.deletarPonto = function(id) {
    if(confirm("Deseja realmente apagar este registro?")) {
        fetch(`/api/registro/${id}`, { method: 'DELETE' })
            .then(() => carregarTudo());
    }
};

function exportarCSV() {
    if (dadosGlobais.length === 0) return alert("Sem dados para exportar.");
    
    let csv = "ID,Equipamento,Latitude,Longitude,Data,Observacao\n";
    dadosGlobais.forEach(r => {
        // Trata nulos e aspas na observação
        const obsLimpa = (r.observacao || "").replace(/"/g, '""');
        csv += `${r.id},${r.equipamento},${r.latitude},${r.longitude},"${r.data_hora}","${obsLimpa}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Maprix_Relatorio_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
}

// Event Listeners
document.getElementById('filtroEquipamento').addEventListener('change', aplicarFiltro);

// Inicialização
carregarTudo();