/**
 * MAPRIX MOBILE - Operador Logic v1.2 (Checklist Dinâmico)
 * Correção: Vínculo estrito entre Nome do Equipamento -> Tipo -> Perguntas
 */

// =========================================================
// 1. VARIÁVEIS GLOBAIS
// =========================================================
let equipamentosConhecidos = [];
let mapaAtivosTipos = {};
let checklistRealizado = false;
let tempEquipNome = "";

// =========================================================
// 2. UTILITÁRIOS VISUAIS (TOASTS & ALERTAS)
// =========================================================

function showToast(msg, type = 'default') {
    const container = document.getElementById('toastContainer');
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'info-circle';
    if(type === 'success') icon = 'check-circle';
    if(type === 'error') icon = 'times-circle';
    if(type === 'warning') icon = 'exclamation-circle';

    toast.innerHTML = `<i class="fas fa-${icon}"></i> <span>${msg}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

function showAlert(title, msg, type = 'warning', callback = null) {
    const modal = document.getElementById('modalAlert');
    const iconDiv = document.getElementById('alertIcon');
    const btn = document.getElementById('btnAlertOk');
    
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerText = msg;
    
    iconDiv.className = `modal-icon ${type}`;
    let iconHtml = '<i class="fas fa-exclamation-triangle"></i>';
    if(type === 'success') iconHtml = '<i class="fas fa-check"></i>';
    if(type === 'error') iconHtml = '<i class="fas fa-times"></i>';
    iconDiv.innerHTML = iconHtml;

    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    newBtn.onclick = function() {
        modal.style.display = 'none';
        if(callback) callback();
    };

    modal.style.display = 'flex';
}

function fecharModalAlert() {
    document.getElementById('modalAlert').style.display = 'none';
}

// =========================================================
// 3. INICIALIZAÇÃO
// =========================================================

document.addEventListener("DOMContentLoaded", () => {
    carregarListaAtivos();
    
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    if (session) entrarNoApp(session.equipamento, session.operador);

    verificarConexao();
    window.addEventListener('online', verificarConexao);
    window.addEventListener('offline', verificarConexao);
    
    atualizarPendentes();
    
    const btn = document.getElementById('mainBtn');
    if(btn) {
        btn.style.opacity = "0.5";
        btn.style.filter = "grayscale(100%)";
    }
});

// =========================================================
// 4. LOGIN E DROPDOWN INTELIGENTE
// =========================================================

function carregarListaAtivos() {
    fetch('/api/ativos')
        .then(r => r.json())
        .then(lista => {
            equipamentosConhecidos = [];
            mapaAtivosTipos = {};
            
            const ul = document.getElementById('listaSuspensa');
            ul.innerHTML = "";
            
            lista.forEach(item => {
                equipamentosConhecidos.push(item.nome);
                
                mapaAtivosTipos[item.nome] = item.tipo_id; 

                const li = document.createElement('li');
                li.innerHTML = `
                    <span>${item.nome}</span> 
                    <span class="type-tag">${item.nome_tipo || 'Geral'}</span>
                `;
                
                li.onclick = () => {
                    document.getElementById('inputEquipamento').value = item.nome;
                    ul.style.display = 'none';
                };
                
                ul.appendChild(li);
            });
        })
        .catch(() => console.log("Offline ou erro ao carregar ativos"));
}

function filtrarEquipamentos() {
    const input = document.getElementById('inputEquipamento');
    const filtro = input.value.toUpperCase();
    const ul = document.getElementById('listaSuspensa');
    const li = ul.getElementsByTagName('li');

    ul.style.display = 'block';

    let visiveis = 0;
    for (let i = 0; i < li.length; i++) {
        const texto = li[i].innerText || li[i].textContent;
        if (texto.toUpperCase().indexOf(filtro) > -1) {
            li[i].style.display = "";
            visiveis++;
        } else {
            li[i].style.display = "none";
        }
    }
    
    if (filtro === "") ul.style.display = 'none';
}

function mostrarListaEquip() {
    const ul = document.getElementById('listaSuspensa');
    if(ul.children.length > 0) ul.style.display = 'block';
}

document.addEventListener('click', function(event) {
    const wrapper = document.querySelector('.dropdown-wrapper');
    if (wrapper && !wrapper.contains(event.target)) {
        document.getElementById('listaSuspensa').style.display = 'none';
    }
});

async function iniciarTurno() {
    const equipInput = document.getElementById('inputEquipamento');
    const operInput = document.getElementById('inputOperador');
    const equip = equipInput.value.trim();
    const oper = operInput.value.trim();

    if (!equip || !oper) return showToast("Preencha todos os campos.", "warning");

    if (!equipamentosConhecidos.includes(equip)) {
        tempEquipNome = equip;
        document.getElementById('lblNovoEquip').innerText = equip;
        document.getElementById('modalNovoEquip').style.display = 'flex';
        return;
    }
    
    efetuarLogin(equip, oper);
}

async function confirmarAutoCadastro() {
    const oper = document.getElementById('inputOperador').value.trim();
    const btn = document.querySelector('#modalNovoEquip .btn-modal-confirm');
    
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cadastrando...';
    
    try {
        await fetch('/api/ativos', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ nome: tempEquipNome, tipo_id: 3, cor: '#007bff' }) 
        });
        
        equipamentosConhecidos.push(tempEquipNome);
        mapaAtivosTipos[tempEquipNome] = 3;

        showToast("Equipamento cadastrado!", "success");
        efetuarLogin(tempEquipNome, oper);
        
    } catch (e) {
        showToast("Erro ao cadastrar.", "error");
    } finally {
        document.getElementById('modalNovoEquip').style.display = 'none';
        btn.innerHTML = '<i class="fas fa-plus-circle"></i> Cadastrar e Entrar';
    }
}

function fecharModalNovoEquip() { document.getElementById('modalNovoEquip').style.display = 'none'; }

function efetuarLogin(equip, oper) {
    localStorage.setItem('maprix_session', JSON.stringify({ equipamento: equip, operador: oper }));
    entrarNoApp(equip, oper);
    showToast(`Bem-vindo, ${oper}!`, "success");
}

function entrarNoApp(equip, oper) {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-operacao').style.display = 'flex';
    document.getElementById('displayEquipamento').innerText = equip;
}

// =========================================================
// 5. OPERAÇÃO (GPS E BLOQUEIO)
// =========================================================

function capturarLocalizacao() {
    if (!checklistRealizado) {
        showAlert(
            "Acesso Bloqueado", 
            "Atenção: É obrigatório realizar e enviar o CHECKLIST antes de iniciar as atividades.", 
            "warning", 
            () => { abrirChecklist(); } 
        );
        return;
    }

    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const obsInput = document.getElementById('inputObs');
    const btn = document.getElementById('mainBtn');
    const feed = document.getElementById('msgFeedback');

    feed.className = "feedback-msg processing";
    feed.innerHTML = '<i class="fas fa-satellite-dish fa-spin"></i> Buscando GPS...';
    btn.style.transform = "scale(0.95)";

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const dados = {
                    equipamento: session.equipamento, operador: session.operador,
                    latitude: pos.coords.latitude, longitude: pos.coords.longitude,
                    data_hora: new Date().toISOString(), observacao: obsInput.value.trim()
                };
                processarEnvio(dados);
                obsInput.value = "";
                btn.style.transform = "scale(1)";
            }, 
            (err) => { 
                showToast("Erro de GPS.", "error");
                feed.className = "feedback-msg error"; feed.innerText = "Erro GPS"; 
                btn.style.transform = "scale(1)"; 
            }, 
            { enableHighAccuracy: true, timeout: 10000 }
        );
    } else {
        showToast("GPS não suportado.", "error");
    }
}

function processarEnvio(dados) {
    const feed = document.getElementById('msgFeedback');
    
    if(navigator.onLine) {
        feed.innerHTML = '<i class="fas fa-paper-plane"></i> Enviando...';
        fetch('/api/registrar', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(dados) })
        .then(r => { 
            if(r.ok){ 
                feed.className = "feedback-msg success";
                feed.innerHTML = '<i class="fas fa-check"></i> Registrado!'; 
                showToast("Posição enviada!", "success");
                setTimeout(() => { feed.className = "feedback-msg"; feed.innerText = "Aguardando..."; }, 3000); 
            } else throw new Error(); 
        })
        .catch(() => { 
            salvarLocal(dados); 
            feed.className = "feedback-msg warning"; feed.innerText = "Salvo Local";
            showToast("Sem rede. Salvo local.", "warning");
        });
    } else {
        salvarLocal(dados); 
        feed.className = "feedback-msg warning"; feed.innerText = "Salvo Offline";
        showToast("Modo Offline. Salvo.", "warning");
    }
}

// =========================================================
// 6. CHECKLIST (LÓGICA CORRIGIDA E ESPECÍFICA)
// =========================================================

function abrirChecklist() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const equipNome = session.equipamento;
    
    document.getElementById('chkEquipNome').innerText = equipNome;
    const container = document.getElementById('containerPerguntas');
    
    container.innerHTML = '<div style="text-align:center; padding:20px; color:#888;"><i class="fas fa-spinner fa-spin"></i> Carregando configuração...</div>';
    document.getElementById('modalChecklistOp').style.display = 'flex';

    // 1. Busca o ID do tipo no CACHE (Instantâneo)
    const tipoId = mapaAtivosTipos[equipNome];

    if (!tipoId) {
        container.innerHTML = 
            '<div style="text-align:center; padding:20px; color:#ff9800;">' + 
            '<i class="fas fa-exclamation-triangle"></i><br>Tipo de equipamento não definido.<br>Contate o supervisor.</div>';
        return;
    }

    // 2. Busca APENAS as perguntas daquele ID
    carregarItensChecklist(tipoId);
}

function carregarItensChecklist(tipoId) {
    fetch(`/api/checklist/config/${tipoId}`)
    .then(r => r.json())
    .then(perguntas => {
        const container = document.getElementById('containerPerguntas');
        container.innerHTML = "";
        
        if(perguntas.length === 0) {
            container.innerHTML = "<p style='text-align:center; color:#666'>Nenhum item de verificação para este tipo.</p>";
            return;
        }

        perguntas.forEach(p => {
            const div = document.createElement('div');
            div.className = 'checklist-item';
            div.innerHTML = `
                <div class="chk-header">
                    <span class="chk-label">${p.texto}</span>
                    <label class="toggle-switch">
                        <input type="checkbox" name="item_${p.id}_conforme" checked>
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="chk-details">
                    <input type="hidden" name="item_${p.id}_texto" value="${p.texto}">
                    <input type="text" name="item_${p.id}_obs" class="chk-obs" placeholder="Observação (se houver problema)">
                    
                    <label class="btn-photo-upload" id="lbl_foto_${p.id}">
                        <i class="fas fa-camera"></i>
                        <input type="file" name="item_${p.id}_foto" accept="image/*" style="display:none" onchange="marcarFoto(${p.id})">
                    </label>
                </div>
            `;
            container.appendChild(div);
        });
    })
    .catch(err => {
        document.getElementById('containerPerguntas').innerHTML = 
            "<p style='text-align:center; color:red'>Erro ao carregar perguntas. Verifique conexão.</p>";
    });
}

function marcarFoto(id) {
    document.getElementById(`lbl_foto_${id}`).classList.add('has-file');
}

function fecharModalChecklist() { document.getElementById('modalChecklistOp').style.display = 'none'; }

function enviarChecklist() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const form = document.getElementById('formChecklist');
    
    // Validação
    const itens = document.querySelectorAll('.checklist-item');
    for (const item of itens) {
        const label = item.querySelector('.chk-label').innerText;
        const obsInput = item.querySelector('.chk-obs');
        const fileInput = item.querySelector('input[type="file"]');
        const checkbox = item.querySelector('input[type="checkbox"]');
        
        // Regra: Se "Não OK" (unchecked), obriga obs e foto
        if (!checkbox.checked) {
            if (!obsInput.value.trim()) {
                showToast(`Descreva o problema em: "${label}"`, "warning");
                obsInput.focus(); obsInput.style.borderBottom = "1px solid var(--danger)";
                return;
            }
            if (fileInput.files.length === 0) {
                showToast(`Foto obrigatória em: "${label}"`, "warning");
                return;
            }
        }
    }

    const formData = new FormData(form);
    formData.append('equipamento', session.equipamento);
    formData.append('operador', session.operador);

    const btn = document.querySelector('#modalChecklistOp .btn-save');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    btn.disabled = true;

    fetch('/api/checklist/submit', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(d => {
        if(d.status === 'sucesso') {
            showAlert("Sucesso", "Checklist enviado! Acesso liberado.", "success");
            checklistRealizado = true;
            document.getElementById('mainBtn').style.opacity = "1";
            document.getElementById('mainBtn').style.filter = "none";
            fecharModalChecklist();
        } else {
            showAlert("Erro", "Falha no envio: " + d.erro, "error");
        }
    })
    .catch(e => showToast("Erro de conexão.", "error"))
    .finally(() => { btn.innerHTML = originalText; btn.disabled = false; });
}

// =========================================================
// 7. GESTÃO DE BATERIA
// =========================================================

function verStatusBateria() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const equipNome = session.equipamento;
    
    const modal = document.getElementById('modalBateria');
    const inputData = document.getElementById('opDataBateria');
    
    // Busca novamente da API para pegar o status atualizado
    // (Poderia usar cache, mas status de bateria pode mudar no servidor)
    fetch('/api/ativos').then(r=>r.json()).then(ativos => {
        const ativo = ativos.find(a => a.nome === equipNome);
        if(ativo) {
            if(ativo.bateria_fabricacao) inputData.value = ativo.bateria_fabricacao;
            else inputData.value = "";
            atualizarVisualBateria(ativo.status_bateria, ativo.cor_bateria);
        }
        modal.style.display = 'flex';
    });
}

function atualizarVisualBateria(status, cor) {
    const texto = document.getElementById('textoStatusBateria');
    const icon = document.getElementById('iconBateriaModal');
    const card = document.querySelector('.battery-status-card');

    if (!status || status === "indefinido") {
        texto.innerText = "SEM REGISTRO";
        texto.style.color = "#ccc"; icon.style.color = "#ccc"; card.style.borderColor = "#444";
        return;
    }

    texto.innerText = status;
    let corHex = '#ccc';
    if(cor === 'verde') corHex = '#28a745';
    else if(cor === 'laranja') corHex = '#fd7e14';
    else if(cor === 'vermelho') corHex = '#dc3545';

    texto.style.color = corHex; icon.style.color = corHex; card.style.borderColor = corHex;
}

function salvarDataBateria() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const novaData = document.getElementById('opDataBateria').value;

    if(!novaData) return showToast("Selecione a data.", "warning");

    const btn = document.querySelector('#modalBateria .btn-modal-confirm');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    fetch('/api/operador/bateria', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ equipamento: session.equipamento, data: novaData })
    })
    .then(r => r.json())
    .then(d => {
        if(d.status === 'sucesso') {
            atualizarVisualBateria(d.novo_status, d.nova_cor);
            showToast("Data atualizada!", "success");
        } else showToast("Erro: " + d.erro, "error");
    })
    .catch(() => showToast("Erro de conexão.", "error"))
    .finally(() => { btn.innerHTML = originalText; });
}

// =========================================================
// 8. LOGOUT E SYNC
// =========================================================

function abrirModalLogout() { document.getElementById('modalLogout').style.display = 'flex'; }
function fecharModalLogout() { document.getElementById('modalLogout').style.display = 'none'; }
function confirmarLogout() { localStorage.removeItem('maprix_session'); location.reload(); }

function salvarLocal(dados) {
    let f = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    f.push(dados);
    localStorage.setItem('maprix_fila', JSON.stringify(f));
    atualizarPendentes();
}

function atualizarPendentes() {
    let f = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    const count = f.length;
    document.getElementById('countPendentes').innerText = count;
    document.getElementById('btnSync').disabled = count === 0;
}

function sincronizarPendentes() {
    let f = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    if(f.length === 0) return;
    
    const btn = document.getElementById('btnSync');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    btn.disabled = true;

    fetch('/api/registrar', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(f) })
    .then(r => {
        if(r.ok) { 
            showToast("Sincronizado!", "success");
            localStorage.removeItem('maprix_fila'); 
            atualizarPendentes(); 
        }
    })
    .finally(() => { 
        btn.innerHTML = originalText; 
        if(JSON.parse(localStorage.getItem('maprix_fila')).length > 0) btn.disabled = false;
    });
}

function verificarConexao() {
    const el = document.getElementById('statusIndicator');
    if(navigator.onLine) { 
        el.className = 'status-bar online'; 
        el.innerHTML = '<i class="fas fa-wifi"></i> <span>Online</span>'; 
    } else { 
        el.className = 'status-bar offline'; 
        el.innerHTML = '<i class="fas fa-ban"></i> <span>Offline</span>'; 
    }
}