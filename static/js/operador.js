/**
 * MAPRIX MOBILE - Operador Logic v1.2
 */

// =========================================================
// 1. VARIÁVEIS GLOBAIS
// =========================================================
let equipamentosConhecidos = [];
let checklistRealizado = false;
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
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    if (session) entrarNoApp(session.equipamento, session.operador);

    carregarListaAtivos();
    
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

function carregarListaAtivos() {
    fetch('/api/ativos')
        .then(r => r.json())
        .then(lista => {
            equipamentosConhecidos = lista.map(item => item.nome);
            const ul = document.getElementById('listaSuspensa');
            ul.innerHTML = "";
            lista.forEach(item => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${item.nome}</span><span class="type-tag">${item.nome_tipo || 'Geral'}</span>`;
                li.onclick = () => {
                    document.getElementById('inputEquipamento').value = item.nome;
                    ul.style.display = 'none';
                };
                ul.appendChild(li);
            });
        })
        .catch(() => console.log("Offline"));
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
            li[i].style.display = ""; visiveis++;
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
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...';
    try {
        await fetch('/api/ativos', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ nome: tempEquipNome, tipo: 'Veículo Leve', cor: '#007bff' })
        });
        showToast("Cadastrado!", "success");
        efetuarLogin(tempEquipNome, oper);
    } catch (e) { showToast("Erro.", "error"); } 
    finally {
        document.getElementById('modalNovoEquip').style.display = 'none';
        btn.innerHTML = 'Confirmar';
    }
}

function fecharModalNovoEquip() { document.getElementById('modalNovoEquip').style.display = 'none'; }

function efetuarLogin(equip, oper) {
    localStorage.setItem('maprix_session', JSON.stringify({ equipamento: equip, operador: oper }));
    entrarNoApp(equip, oper);
    showToast(`Olá, ${oper}!`, "success");
}

function entrarNoApp(equip, oper) {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-operacao').style.display = 'flex';
    document.getElementById('displayEquipamento').innerText = equip;
}

// =========================================================
// 4. CHECKLIST INTELIGENTE (CORREÇÃO DE LÓGICA)
// =========================================================

function abrirChecklist() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const btn = document.querySelector('.btn-checklist-trigger');
    
    // Feedback visual de carregamento
    const textoOriginal = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
    btn.disabled = true;

    // 1. Busca detalhes do ativo para saber o TIPO
    fetch('/api/ativos').then(r=>r.json()).then(ativos => {
        const ativo = ativos.find(a => a.nome === session.equipamento);
        
        // Se não achou ativo ou não tem tipo
        if(!ativo || !ativo.tipo_id) {
            btn.innerHTML = textoOriginal;
            btn.disabled = false;
            showAlert("Aviso", `O equipamento "${session.equipamento}" não possui um Tipo definido. Não há checklist disponível.`, "warning");
            return;
        }

        // 2. Busca as perguntas desse TIPO específico
        fetch(`/api/checklist/config/${ativo.tipo_id}`).then(r=>r.json()).then(perguntas => {
            btn.innerHTML = textoOriginal;
            btn.disabled = false;

            // Se o tipo existe mas NÃO tem perguntas cadastradas
            if(perguntas.length === 0) {
                showAlert("Aviso", `Não há perguntas de checklist configuradas para o tipo "${ativo.nome_tipo}".`, "warning");
                return;
            }

            // SE TIVER PERGUNTAS, AÍ SIM ABRE O MODAL
            renderizarChecklist(perguntas, session.equipamento);
            document.getElementById('modalChecklistOp').style.display = 'flex';
        });
    })
    .catch(err => {
        btn.innerHTML = textoOriginal;
        btn.disabled = false;
        showToast("Erro de conexão ao buscar checklist.", "error");
    });
}

function renderizarChecklist(perguntas, nomeEquip) {
    document.getElementById('chkEquipNome').innerText = nomeEquip;
    const container = document.getElementById('containerPerguntas');
    container.innerHTML = "";

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
}

function marcarFoto(id) { document.getElementById(`lbl_foto_${id}`).classList.add('has-file'); }
function fecharModalChecklist() { document.getElementById('modalChecklistOp').style.display = 'none'; }

// CORREÇÃO DE HORA: Enviamos a hora local do dispositivo
function enviarChecklist() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const form = document.getElementById('formChecklist');
    
    // Validação
    const itens = document.querySelectorAll('.checklist-item');
    for (const item of itens) {
        const label = item.querySelector('.chk-label').innerText;
        const obsInput = item.querySelector('.chk-obs');
        const fileInput = item.querySelector('input[type="file"]');
        
        if (!obsInput.value.trim()) {
            showToast(`Falta observação em: "${label}"`, "warning");
            obsInput.focus(); obsInput.style.borderBottom = "1px solid var(--danger)";
            return;
        } else obsInput.style.borderBottom = "1px solid #555";

        if (fileInput.files.length === 0) {
            showToast(`Falta foto em: "${label}"`, "warning");
            item.querySelector('.btn-photo-upload').style.color = "var(--danger)";
            return;
        }
    }

    const formData = new FormData(form);
    formData.append('equipamento', session.equipamento);
    formData.append('operador', session.operador);

    // --- CORREÇÃO DE DATA/HORA ---
    // Cria um ISO String respeitando o fuso horário local do navegador/celular
    const agora = new Date();
    // Subtrai o offset (em minutos) para ajustar o UTC para o local antes de converter para string
    const dataLocal = new Date(agora.getTime() - (agora.getTimezoneOffset() * 60000)).toISOString();
    
    formData.append('data_hora', dataLocal); 
    // ------------------------------

    const btn = document.querySelector('#modalChecklistOp .btn-save');
    const txtOrig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...'; btn.disabled = true;

    fetch('/api/checklist/submit', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(d => {
        if(d.status === 'sucesso') {
            showAlert("Sucesso", "Checklist enviado! Rastreamento Liberado.", "success");
            checklistRealizado = true;
            document.getElementById('mainBtn').style.opacity = "1";
            document.getElementById('mainBtn').style.filter = "none";
            fecharModalChecklist();
        } else showAlert("Erro", d.erro, "error");
    })
    .catch(e => showToast("Erro envio", "error"))
    .finally(() => { btn.innerHTML = txtOrig; btn.disabled = false; });
}

// =========================================================
// 5. OPERAÇÃO (GPS)
// =========================================================

function capturarLocalizacao() {
    if (!checklistRealizado) {
        showAlert("Bloqueado", "Realize o Checklist primeiro.", "warning", () => abrirChecklist());
        return;
    }

    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const obs = document.getElementById('inputObs').value.trim();
    const feed = document.getElementById('msgFeedback');
    
    feed.className = "feedback-msg processing";
    feed.innerHTML = '<i class="fas fa-satellite-dish fa-spin"></i> GPS...';

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const dados = {
                    equipamento: session.equipamento, operador: session.operador,
                    latitude: pos.coords.latitude, longitude: pos.coords.longitude,
                    data_hora: new Date().toISOString(), observacao: obs
                };
                processarEnvio(dados);
                document.getElementById('inputObs').value = "";
            }, 
            (err) => { showToast("Erro GPS", "error"); feed.innerText = "Erro GPS"; }, 
            { enableHighAccuracy: true, timeout: 10000 }
        );
    } else showToast("Sem GPS", "error");
}

function processarEnvio(dados) {
    const feed = document.getElementById('msgFeedback');
    if(navigator.onLine) {
        feed.innerHTML = 'Enviando...';
        fetch('/api/registrar', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(dados) })
        .then(r => { 
            if(r.ok){ 
                feed.className = "feedback-msg success"; feed.innerHTML = '<i class="fas fa-check"></i> OK!'; 
                setTimeout(() => { feed.className = "feedback-msg"; feed.innerText = "Aguardando..."; }, 3000); 
            } else throw new Error(); 
        })
        .catch(() => { salvarLocal(dados); feed.innerText = "Salvo Local"; });
    } else { salvarLocal(dados); feed.innerText = "Salvo Offline"; }
}

// =========================================================
// 6. GESTÃO DE BATERIA E SYNC
// =========================================================

function verStatusBateria() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    fetch('/api/ativos').then(r=>r.json()).then(ativos => {
        const ativo = ativos.find(a => a.nome === session.equipamento);
        const modal = document.getElementById('modalBateria');
        if(ativo) {
            document.getElementById('opDataBateria').value = ativo.bateria_fabricacao || "";
            atualizarVisualBateria(ativo.status_bateria, ativo.cor_bateria);
        }
        modal.style.display = 'flex';
    });
}

function atualizarVisualBateria(status, cor) {
    const t = document.getElementById('textoStatusBateria');
    const icon = document.getElementById('iconBateriaModal');
    const card = document.querySelector('.battery-status-card');
    
    t.innerText = (!status || status==="indefinido") ? "SEM DATA" : status;
    let hex = '#ccc';
    if(cor==='verde') hex='#28a745'; if(cor==='laranja') hex='#fd7e14'; if(cor==='vermelho') hex='#dc3545';
    t.style.color = hex; icon.style.color = hex; card.style.borderColor = hex;
}

function salvarDataBateria() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const data = document.getElementById('opDataBateria').value;
    if(!data) return showToast("Informe a data", "warning");
    
    fetch('/api/operador/bateria', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ equipamento: session.equipamento, data: data })
    }).then(r=>r.json()).then(d => {
        if(d.status==='sucesso') { atualizarVisualBateria(d.novo_status, d.nova_cor); showToast("Salvo!", "success"); }
    });
}

function salvarLocal(dados) {
    let f = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    f.push(dados); localStorage.setItem('maprix_fila', JSON.stringify(f));
    atualizarPendentes();
}
function atualizarPendentes() {
    const count = (JSON.parse(localStorage.getItem('maprix_fila')) || []).length;
    document.getElementById('countPendentes').innerText = count;
    document.getElementById('btnSync').disabled = count === 0;
}
function sincronizarPendentes() {
    let f = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    if(f.length === 0) return;
    const btn = document.getElementById('btnSync'); btn.innerHTML = '...'; btn.disabled = true;
    fetch('/api/registrar', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(f) })
    .then(r => { if(r.ok) { showToast("Sincronizado!", "success"); localStorage.removeItem('maprix_fila'); atualizarPendentes(); } })
    .finally(() => { btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> ENVIAR'; if(JSON.parse(localStorage.getItem('maprix_fila')).length > 0) btn.disabled = false; });
}

function abrirModalLogout() { document.getElementById('modalLogout').style.display = 'flex'; }
function fecharModalLogout() { document.getElementById('modalLogout').style.display = 'none'; }
function confirmarLogout() { localStorage.removeItem('maprix_session'); location.reload(); }
function verificarConexao() {
    const el = document.getElementById('statusIndicator');
    if(navigator.onLine) { el.className='status-bar online'; el.innerHTML='<i class="fas fa-wifi"></i> Online'; }
    else { el.className='status-bar offline'; el.innerHTML='<i class="fas fa-ban"></i> Offline'; }
}