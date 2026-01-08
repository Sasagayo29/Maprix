/**
 * MAPRIX MOBILE - Operador Logic v4.0
 * Correções: Checklist Dinâmico (Só bloqueia se houver perguntas) e Hora Local.
 */

// =========================================================
// 1. VARIÁVEIS GLOBAIS
// =========================================================
let equipamentosConhecidos = [];
let listaCompletaAtivos = []; // Cache para buscar Tipo ID
let checklistRealizado = false;
let checklistNecessario = true; // Novo flag
let tempEquipNome = "";

// =========================================================
// 2. UTILITÁRIOS VISUAIS
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

function fecharModalAlert() { document.getElementById('modalAlert').style.display = 'none'; }

// =========================================================
// 3. INICIALIZAÇÃO E LOGIN
// =========================================================

document.addEventListener("DOMContentLoaded", () => {
    carregarListaAtivos();
    
    // Verifica sessão ativa e já valida as regras
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    if (session) {
        entrarNoApp(session.equipamento, session.operador);
    }

    verificarConexao();
    window.addEventListener('online', verificarConexao);
    window.addEventListener('offline', verificarConexao);
    atualizarPendentes();
    
    // Bloqueia visualmente o botão até validarmos a regra
    atualizarEstadoBotaoPrincipal(false);
});

function carregarListaAtivos() {
    fetch('/api/ativos')
        .then(r => r.json())
        .then(lista => {
            listaCompletaAtivos = lista; // Guarda lista completa com IDs e Tipos
            equipamentosConhecidos = lista.map(item => item.nome);
            
            const ul = document.getElementById('listaSuspensa');
            ul.innerHTML = "";
            lista.forEach(item => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${item.nome}</span> <span class="type-tag">${item.nome_tipo || 'Geral'}</span>`;
                li.onclick = () => {
                    document.getElementById('inputEquipamento').value = item.nome;
                    ul.style.display = 'none';
                };
                ul.appendChild(li);
            });
        })
        .catch(() => console.log("Offline: Usando cache"));
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
        } else { li[i].style.display = "none"; }
    }
    if (filtro === "") ul.style.display = 'none';
}

function mostrarListaEquip() {
    const ul = document.getElementById('listaSuspensa');
    if(ul.children.length > 0) ul.style.display = 'block';
}

document.addEventListener('click', function(event) {
    const wrapper = document.querySelector('.dropdown-wrapper');
    if (wrapper && !wrapper.contains(event.target)) document.getElementById('listaSuspensa').style.display = 'none';
});

async function iniciarTurno() {
    const equip = document.getElementById('inputEquipamento').value.trim();
    const oper = document.getElementById('inputOperador').value.trim();

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
            body: JSON.stringify({ nome: tempEquipNome, tipo_id: null, cor: '#007bff' })
        });
        showToast("Equipamento cadastrado!", "success");
        // Recarrega a lista para ter o dado atualizado
        await carregarListaAtivos();
        efetuarLogin(tempEquipNome, oper);
    } catch (e) { showToast("Erro ao cadastrar.", "error"); } 
    finally {
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
    
    // --- LÓGICA VITAL: VERIFICAR SE PRECISA DE CHECKLIST ---
    verificarRegrasDeAcesso(equip);
}

// === NOVO: LÓGICA INTELIGENTE DE BLOQUEIO ===
async function verificarRegrasDeAcesso(nomeEquipamento) {
    const feedback = document.getElementById('msgFeedback');
    feedback.innerText = "Verificando regras...";
    
    // 1. Achar o equipamento na lista completa para pegar o ID do Tipo
    const ativo = listaCompletaAtivos.find(a => a.nome === nomeEquipamento);
    
    if (!ativo || !ativo.tipo_id) {
        // Se não tem tipo definido, não tem checklist. Libera.
        liberarAcesso("Checklist não configurado (Tipo indefinido)");
        return;
    }

    try {
        // 2. Buscar perguntas para esse tipo
        const res = await fetch(`/api/checklist/config/${ativo.tipo_id}`);
        const perguntas = await res.json();

        if (perguntas.length > 0) {
            // TEM PERGUNTAS: BLOQUEIA
            checklistNecessario = true;
            checklistRealizado = false;
            atualizarEstadoBotaoPrincipal(false); // Cinza/Bloqueado
            feedback.innerText = "Aguardando Checklist...";
            
            // Sugere abrir o checklist imediatamente
            setTimeout(() => {
                showToast("Checklist Obrigatório pendente", "warning");
            }, 1000);
        } else {
            // SEM PERGUNTAS: LIBERA
            liberarAcesso("Checklist Dispensado (Sem itens)");
        }
    } catch (e) {
        console.error("Erro ao validar regras", e);
        // Em caso de erro de rede, assume bloqueado por segurança ou libera dependendo da sua política.
        // Aqui vou manter bloqueado e pedir para tentar abrir o checklist (que vai falhar e mostrar erro)
        showToast("Erro ao verificar regras online.", "error");
    }
}

function liberarAcesso(motivo) {
    console.log("Acesso liberado: " + motivo);
    checklistNecessario = false;
    checklistRealizado = true;
    atualizarEstadoBotaoPrincipal(true);
    document.getElementById('msgFeedback').innerText = "Pronto para operar";
}

function atualizarEstadoBotaoPrincipal(ativo) {
    const btn = document.getElementById('mainBtn');
    if(ativo) {
        btn.style.opacity = "1";
        btn.style.filter = "none";
        btn.style.cursor = "pointer";
    } else {
        btn.style.opacity = "0.5";
        btn.style.filter = "grayscale(100%)";
        btn.style.cursor = "not-allowed";
    }
}

// =========================================================
// 4. OPERAÇÃO (GPS)
// =========================================================

function capturarLocalizacao() {
    // Só bloqueia se o checklist for necessário E não tiver sido feito
    if (checklistNecessario && !checklistRealizado) {
        showAlert(
            "Acesso Bloqueado", 
            "Este equipamento possui checklist obrigatório pendente.", 
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
    feed.innerHTML = '<i class="fas fa-satellite-dish fa-spin"></i> GPS...';
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
    } else { showToast("GPS não suportado.", "error"); }
}

function processarEnvio(dados) {
    const feed = document.getElementById('msgFeedback');
    if(navigator.onLine) {
        feed.innerHTML = 'Enviando...';
        fetch('/api/registrar', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(dados) })
        .then(r => { 
            if(r.ok){ 
                feed.className = "feedback-msg success"; feed.innerHTML = '<i class="fas fa-check"></i> OK'; 
                showToast("Posição enviada!", "success");
                setTimeout(() => { feed.className = "feedback-msg"; feed.innerText = "Pronto"; }, 3000); 
            } else throw new Error(); 
        })
        .catch(() => { 
            salvarLocal(dados); 
            feed.className = "feedback-msg warning"; feed.innerText = "Salvo Local";
        });
    } else {
        salvarLocal(dados); 
        feed.className = "feedback-msg warning"; feed.innerText = "Salvo Offline";
    }
}

// =========================================================
// 5. CHECKLIST (COM CORREÇÃO DE HORA)
// =========================================================

function abrirChecklist() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    document.getElementById('chkEquipNome').innerText = session.equipamento;
    document.getElementById('containerPerguntas').innerHTML = '<div style="text-align:center; padding:20px; color:#888;"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';
    document.getElementById('modalChecklistOp').style.display = 'flex';

    // Se já sabemos que não precisa (na verificação inicial), avisar
    if (!checklistNecessario) {
        document.getElementById('containerPerguntas').innerHTML = 
            '<div style="text-align:center; padding:20px; color:#28a745;">' + 
            '<i class="fas fa-check-circle" style="font-size:30px; margin-bottom:10px;"></i><br>Este equipamento não necessita de checklist.</div>';
        return;
    }

    const ativo = listaCompletaAtivos.find(a => a.nome === session.equipamento);
    if(ativo && ativo.tipo_id) {
        carregarItensChecklist(ativo.tipo_id);
    } else {
        document.getElementById('containerPerguntas').innerHTML = "<p style='text-align:center'>Equipamento sem tipo definido.</p>";
    }
}

function carregarItensChecklist(tipoId) {
    fetch(`/api/checklist/config/${tipoId}`).then(r=>r.json()).then(perguntas => {
        const container = document.getElementById('containerPerguntas');
        container.innerHTML = "";
        
        if(perguntas.length === 0) {
            container.innerHTML = "<p style='text-align:center; color:#666'>Nenhum item configurado.</p>";
            // Auto-libera se abriu e viu que estava vazio
            liberarAcesso("Lista vazia");
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
                    <input type="text" name="item_${p.id}_obs" class="chk-obs" placeholder="Observação...">
                    <label class="btn-photo-upload" id="lbl_foto_${p.id}">
                        <i class="fas fa-camera"></i>
                        <input type="file" name="item_${p.id}_foto" accept="image/*" style="display:none" onchange="marcarFoto(${p.id})">
                    </label>
                </div>
            `;
            container.appendChild(div);
        });
    });
}

function marcarFoto(id) { document.getElementById(`lbl_foto_${id}`).classList.add('has-file'); }
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
        
        if (obsInput.value.trim() && fileInput.files.length === 0) {
            showToast(`Adicione foto para: "${label}"`, "warning");
            return;
        }
    }

    const formData = new FormData(form);
    formData.append('equipamento', session.equipamento);
    formData.append('operador', session.operador);

    // --- CORREÇÃO DA HORA: ENVIA DATA LOCAL ---
    // O JS pega a hora do dispositivo do operador.
    const agora = new Date();
    // Ajusta o fuso horário manualmente para enviar ISO correto
    const offsetMs = agora.getTimezoneOffset() * 60000;
    const localIso = new Date(agora.getTime() - offsetMs).toISOString().slice(0, 19);
    
    formData.append('data_hora_local', localIso);
    // ------------------------------------------

    const btn = document.querySelector('#modalChecklistOp .btn-save');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...';
    btn.disabled = true;

    fetch('/api/checklist/submit', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(d => {
        if(d.status === 'sucesso') {
            showAlert("Sucesso", "Checklist registrado!", "success");
            liberarAcesso("Checklist Concluído");
            fecharModalChecklist();
        } else {
            showAlert("Erro", d.erro, "error");
        }
    })
    .catch(e => showToast("Erro de envio.", "error"))
    .finally(() => { btn.innerHTML = originalText; btn.disabled = false; });
}

// =========================================================
// 6. OUTROS (BATERIA, SYNC, LOGOUT)
// =========================================================

function verStatusBateria() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    fetch('/api/ativos').then(r=>r.json()).then(ativos => {
        const ativo = ativos.find(a => a.nome === session.equipamento);
        const modal = document.getElementById('modalBateria');
        const inputData = document.getElementById('opDataBateria');
        if(ativo) {
            inputData.value = ativo.bateria_fabricacao || "";
            atualizarVisualBateria(ativo.status_bateria, ativo.cor_bateria);
        }
        modal.style.display = 'flex';
    });
}

function atualizarVisualBateria(status, cor) {
    const texto = document.getElementById('textoStatusBateria');
    const icon = document.getElementById('iconBateriaModal');
    const card = document.querySelector('.battery-status-card');

    texto.innerText = (!status || status==="indefinido") ? "DATA NÃO INFORMADA" : status;
    
    let corHex = '#ccc';
    if(cor === 'verde') corHex = '#28a745';
    if(cor === 'laranja') corHex = '#fd7e14';
    if(cor === 'vermelho') corHex = '#dc3545';

    texto.style.color = corHex;
    icon.style.color = corHex;
    card.style.borderColor = corHex;
}

function salvarDataBateria() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const novaData = document.getElementById('opDataBateria').value;
    if(!novaData) return showToast("Selecione a data.", "warning");

    fetch('/api/operador/bateria', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ equipamento: session.equipamento, data: novaData })
    }).then(r => r.json()).then(d => {
        if(d.status === 'sucesso') {
            atualizarVisualBateria(d.novo_status, d.nova_cor);
            showToast("Atualizado!", "success");
        }
    });
}

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
    const f = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    document.getElementById('countPendentes').innerText = f.length;
    document.getElementById('btnSync').disabled = f.length === 0;
}

function sincronizarPendentes() {
    const f = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    if(f.length === 0) return;
    
    document.getElementById('btnSync').disabled = true;
    fetch('/api/registrar', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(f) })
    .then(r => {
        if(r.ok) { 
            showToast("Sincronizado!", "success");
            localStorage.removeItem('maprix_fila'); 
            atualizarPendentes(); 
        }
    });
}

function verificarConexao() {
    const el = document.getElementById('statusIndicator');
    if(navigator.onLine) { el.className='status-bar online'; el.innerHTML='<i class="fas fa-wifi"></i> <span>Online</span>'; }
    else { el.className='status-bar offline'; el.innerHTML='<i class="fas fa-ban"></i> <span>Offline</span>'; }
}