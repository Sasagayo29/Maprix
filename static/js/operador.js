/**
 * MAPRIX MOBILE - Lógica do Operador
 * Funcionalidades: Busca Inteligente, Auto-Cadastro, Sync Offline, GPS
 */

let equipamentosConhecidos = []; // Cache para validação

document.addEventListener("DOMContentLoaded", () => {
    // 1. Verifica se já existe sessão ativa
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    if (session) entrarNoApp(session.equipamento, session.operador);

    // 2. Carrega lista para Autocomplete (Busca Inteligente)
    carregarListaAtivos();

    // 3. Listeners de Rede
    verificarConexao();
    window.addEventListener('online', verificarConexao);
    window.addEventListener('offline', verificarConexao);
    
    // 4. Atualiza contador de pendentes
    atualizarPendentes();
});

function carregarListaAtivos() {
    fetch('/api/ativos')
        .then(r => r.json())
        .then(lista => {
            equipamentosConhecidos = lista.map(item => item.nome); // Guarda nomes para validação
            const datalist = document.getElementById('listaEquipamentos');
            datalist.innerHTML = "";
            lista.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.nome;
                // Exibe o tipo como informação auxiliar (navegadores desktop mostram, mobile varia)
                opt.label = item.tipo || 'Equipamento'; 
                datalist.appendChild(opt);
            });
        })
        .catch(() => console.log("Modo Offline: Usando cache do navegador se disponível"));
}

// --- LÓGICA DE LOGIN E AUTO-CADASTRO ---

async function iniciarTurno() {
    const equipInput = document.getElementById('inputEquipamento');
    const operInput = document.getElementById('inputOperador');
    const btnLogin = document.querySelector('.btn-login'); // Para feedback visual
    
    const equip = equipInput.value.trim();
    const oper = operInput.value.trim();

    if (!equip || !oper) return alert("Por favor, preencha o equipamento e seu nome.");

    // Feedback visual que está processando
    const textoOriginal = btnLogin.innerHTML;
    btnLogin.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processando...';
    btnLogin.disabled = true;

    try {
        // LÓGICA DE AUTO-CRIAÇÃO
        if (!equipamentosConhecidos.includes(equip)) {
            // Se o usuário cancelar o confirm, paramos tudo e restauramos o botão
            if(!confirm(`O equipamento "${equip}" não está na lista oficial. Deseja cadastrá-lo e usar assim mesmo?`)) {
                btnLogin.innerHTML = textoOriginal;
                btnLogin.disabled = false;
                return;
            }

            try {
                await fetch('/api/ativos', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ nome: equip, tipo: 'Veículo Leve', cor: '#007bff' })
                });
                console.log("Novo ativo cadastrado automaticamente:", equip);
                // Adiciona na lista local para não perguntar de novo na mesma sessão
                equipamentosConhecidos.push(equip);
            } catch (e) {
                console.warn("Erro ao tentar auto-cadastrar (pode ser offline), seguindo...", e);
            }
        }
        
        // Salva Sessão e Entra
        localStorage.setItem('maprix_session', JSON.stringify({ equipamento: equip, operador: oper }));
        entrarNoApp(equip, oper);

    } catch (error) {
        console.error("Erro crítico no login:", error);
        alert("Erro ao iniciar turno. Tente novamente.");
        // Restaura botão em caso de erro
        btnLogin.innerHTML = textoOriginal;
        btnLogin.disabled = false;
    }
}

function entrarNoApp(equip, oper) {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-operacao').style.display = 'flex';
    document.getElementById('displayEquipamento').innerText = equip;
}

// --- LÓGICA DE GEOLOCALIZAÇÃO ---

function capturarLocalizacao() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const obsInput = document.getElementById('inputObs');
    const btn = document.getElementById('mainBtn');
    const feed = document.getElementById('msgFeedback');

    // UI Feedback
    feed.className = "feedback-msg processing";
    feed.innerHTML = '<i class="fas fa-satellite-dish fa-spin"></i> Buscando GPS...';
    btn.style.transform = "scale(0.95)";

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const dados = {
                    equipamento: session.equipamento,
                    operador: session.operador,
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    data_hora: new Date().toISOString(),
                    observacao: obsInput.value.trim()
                };
                
                processarEnvio(dados);
                
                // Limpa obs e reseta botão
                obsInput.value = "";
                btn.style.transform = "scale(1)";
            }, 
            (err) => { 
                alert("Erro ao obter GPS: " + err.message); 
                feed.className = "feedback-msg error";
                feed.innerText = "❌ Erro GPS"; 
                btn.style.transform = "scale(1)"; 
            }, 
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    } else {
        alert("Geolocalização não suportada neste dispositivo.");
    }
}

function processarEnvio(dados) {
    const feed = document.getElementById('msgFeedback');
    
    if(navigator.onLine) {
        feed.innerHTML = '<i class="fas fa-paper-plane"></i> Enviando...';
        
        fetch('/api/registrar', { 
            method: 'POST', 
            headers: {'Content-Type':'application/json'}, 
            body: JSON.stringify(dados) 
        })
        .then(r => { 
            if(r.ok){ 
                feed.className = "feedback-msg success";
                feed.innerHTML = '<i class="fas fa-check"></i> Registrado!'; 
                setTimeout(() => {
                    feed.className = "feedback-msg";
                    feed.innerText = "Aguardando comando...";
                }, 3000); 
            } else { throw new Error(); } 
        })
        .catch(() => { 
            salvarLocal(dados); 
            feed.className = "feedback-msg warning";
            feed.innerText = "⚠️ Salvo no Celular (Rede)"; 
        });
    } else {
        salvarLocal(dados); 
        feed.className = "feedback-msg warning";
        feed.innerText = "💾 Salvo Offline";
    }
}

// --- LOGOUT & MODAIS ---
function abrirModalLogout() { document.getElementById('modalLogout').style.display = 'flex'; }
function fecharModalLogout() { document.getElementById('modalLogout').style.display = 'none'; }
function confirmarLogout() { 
    localStorage.removeItem('maprix_session'); 
    location.reload(); 
}

// --- SYNC SYSTEM ---
function salvarLocal(dados) {
    let f = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    f.push(dados);
    localStorage.setItem('maprix_fila', JSON.stringify(f));
    atualizarPendentes();
}

function actualizarPendentes() { // Alias para manter compatibilidade se necessário
    atualizarPendentes();
}

function atualizarPendentes() {
    let f = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    const count = f.length;
    document.getElementById('countPendentes').innerText = count;
    
    const btn = document.getElementById('btnSync');
    btn.disabled = count === 0;
    
    if(count > 0) {
        btn.classList.add('pulse');
    } else {
        btn.classList.remove('pulse');
    }
}

function sincronizarPendentes() {
    let f = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    if(f.length === 0) return;
    
    const btn = document.getElementById('btnSync');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    btn.disabled = true;

    fetch('/api/registrar', { 
        method: 'POST', 
        headers: {'Content-Type':'application/json'}, 
        body: JSON.stringify(f) 
    })
    .then(r => {
        if(r.ok) { 
            alert("✅ Todos os registros foram sincronizados!"); 
            localStorage.removeItem('maprix_fila'); 
            atualizarPendentes(); 
        } else {
            alert("Erro no servidor ao sincronizar.");
        }
    })
    .catch(() => alert("Falha na conexão. Tente novamente."))
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
        // Tenta sincronizar automático se voltar a net
        if (JSON.parse(localStorage.getItem('maprix_fila') || "[]").length > 0) {
            // Opcional: auto-sync ou apenas avisar
        }
    } else { 
        el.className = 'status-bar offline'; 
        el.innerHTML = '<i class="fas fa-ban"></i> <span>Offline</span>'; 
    }
}

// === MÓDULO CHECKLIST ===

// 1. Abre o Modal e Carrega Perguntas
function abrirChecklist() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    if(!session) return alert("Sessão inválida");

    document.getElementById('chkEquipNome').innerText = session.equipamento;
    document.getElementById('containerPerguntas').innerHTML = '<div style="text-align:center; padding:20px; color:#888;"><i class="fas fa-spinner fa-spin"></i> Carregando itens...</div>';
    document.getElementById('modalChecklistOp').style.display = 'flex';

    // Primeiro precisamos descobrir o TIPO do equipamento
    // Como o operador não sabe o ID do tipo, precisamos consultar o backend
    // Vamos usar a lista de ativos que já carregamos no autocomplete (cacheada em equipamentosConhecidos não tem ID, vamos melhorar)
    
    // Melhor abordagem: Fazer uma rota rápida para pegar info do ativo ou varrer a lista se tivermos dados completos.
    // Vamos assumir que precisamos buscar o ID do tipo pelo nome.
    fetch('/api/ativos').then(r=>r.json()).then(ativos => {
        const ativo = ativos.find(a => a.nome === session.equipamento);
        if(ativo && ativo.tipo_id) {
            carregarItensChecklist(ativo.tipo_id);
        } else {
            document.getElementById('containerPerguntas').innerHTML = 
                '<div style="text-align:center; padding:20px; color:#ff9800;">' + 
                '<i class="fas fa-exclamation-triangle"></i><br>Este equipamento não possui um Tipo definido ou checklist configurado.</div>';
        }
    });
}

function carregarItensChecklist(tipoId) {
    fetch(`/api/checklist/config/${tipoId}`).then(r=>r.json()).then(perguntas => {
        const container = document.getElementById('containerPerguntas');
        container.innerHTML = "";
        
        if(perguntas.length === 0) {
            container.innerHTML = "<p style='text-align:center; color:#666'>Nenhum item para verificar.</p>";
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
    });
}

function marcarFoto(id) {
    document.getElementById(`lbl_foto_${id}`).classList.add('has-file');
}

function fecharModalChecklist() {
    document.getElementById('modalChecklistOp').style.display = 'none';
}

function enviarChecklist() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const form = document.getElementById('formChecklist');
    const formData = new FormData(form);

    // Adiciona metadados
    formData.append('equipamento', session.equipamento);
    formData.append('operador', session.operador);

    // Validação visual
    const btn = document.querySelector('#modalChecklistOp .btn-save');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    btn.disabled = true;

    fetch('/api/checklist/submit', {
        method: 'POST',
        body: formData // Fetch detecta FormData e configura multipart/form-data automaticamente
    })
    .then(r => r.json())
    .then(d => {
        if(d.status === 'sucesso') {
            alert("Checklist Enviado com Sucesso!");
            fecharModalChecklist();
        } else {
            alert("Erro ao enviar: " + d.erro);
        }
    })
    .catch(e => alert("Erro de conexão. Tente novamente."))
    .finally(() => {
        btn.innerHTML = originalText;
        btn.disabled = false;
    });
}