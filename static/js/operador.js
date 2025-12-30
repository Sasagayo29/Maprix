/**
 * MAPRIX - Lógica do App do Operador (Mobile)
 * Arquivo: static/js/operador.js
 */

// --- 1. INICIALIZAÇÃO ---
document.addEventListener("DOMContentLoaded", () => {
    // Verifica se já existe um turno aberto
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    
    if (session) {
        entrarNoApp(session.equipamento, session.operador);
    }

    // Inicializa monitores de rede e fila
    verificarConexao();
    atualizarPendentes();
});

// --- 2. GESTÃO DE SESSÃO (LOGIN/LOGOUT) ---

function iniciarTurno() {
    const equip = document.getElementById('inputEquipamento').value.trim();
    const oper = document.getElementById('inputOperador').value.trim();

    if (!equip || !oper) {
        alert("Por favor, preencha o ID do Equipamento e seu Nome/Matrícula.");
        return;
    }

    // Salva a sessão no navegador
    const session = { equipamento: equip, operador: oper };
    localStorage.setItem('maprix_session', JSON.stringify(session));

    entrarNoApp(equip, oper);
}

function entrarNoApp(equip, oper) {
    // Troca de tela (Esconde Login, Mostra App)
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-operacao').style.display = 'flex';
    
    // Atualiza o cabeçalho
    document.getElementById('displayEquipamento').innerText = equip;
}

// --- FUNÇÕES DE LOGOUT (MODAL) ---

// Substitui o confirm() nativo
function encerrarTurno() {
    document.getElementById('modalLogout').style.display = 'flex';
}

function fecharModalLogout() {
    document.getElementById('modalLogout').style.display = 'none';
}

function confirmarLogout() {
    localStorage.removeItem('maprix_session');
    location.reload();
}

// --- 3. CAPTURA DE DADOS (GPS) ---

function capturarLocalizacao() {
    const session = JSON.parse(localStorage.getItem('maprix_session'));
    const obsInput = document.getElementById('inputObs');
    const btn = document.getElementById('mainBtn');
    const feedback = document.getElementById('msgFeedback');

    // Feedback Visual: "Pensando"
    feedback.innerText = "🛰️ Buscando satélites...";
    feedback.style.color = "var(--kinross-gold)";
    btn.style.transform = "scale(0.95)"; // Efeito de clique pressionado
    btn.style.opacity = "0.8";

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((pos) => {
            
            // Monta o objeto de dados
            const dados = {
                equipamento: session.equipamento,
                operador: session.operador,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                data_hora: new Date().toISOString(),
                observacao: obsInput.value.trim() // Pega o texto da observação
            };
            
            // Envia para processamento
            processarEnvio(dados);
            
            // Limpeza pós-envio
            obsInput.value = ""; // Limpa o campo de texto
            btn.style.transform = "scale(1)";
            btn.style.opacity = "1";
            
        }, (err) => {
            // Erro de GPS
            alert("Erro ao obter GPS: " + err.message);
            feedback.innerText = "❌ Erro de GPS";
            feedback.style.color = "var(--danger)";
            btn.style.transform = "scale(1)";
            btn.style.opacity = "1";
        }, 
        { 
            enableHighAccuracy: true, // Tenta a melhor precisão possível
            timeout: 10000,           // Espera no máximo 10s
            maximumAge: 0             // Não aceita cache velho
        });
    } else {
        alert("Seu dispositivo não suporta Geolocalização.");
    }
}

// --- 4. ENVIO E ARMAZENAMENTO (ONLINE/OFFLINE) ---

function processarEnvio(dados) {
    const feedback = document.getElementById('msgFeedback');
    
    if (navigator.onLine) {
        feedback.innerText = "📡 Enviando dados...";
        
        fetch('/api/registrar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        })
        .then(res => {
            if(res.ok) {
                feedback.innerText = "✅ Posição Registrada!";
                feedback.style.color = "var(--success)";
                // Reseta mensagem após 3 segundos
                setTimeout(() => { 
                    feedback.innerText = "Pronto para operar"; 
                    feedback.style.color = "var(--kinross-gold)";
                }, 3000);
            } else {
                throw new Error("Erro no servidor");
            }
        })
        .catch(() => {
            // Se falhar o envio (mesmo parecendo online), salva local
            feedback.innerText = "⚠️ Erro de rede. Salvo no dispositivo.";
            feedback.style.color = "var(--offline)";
            salvarLocal(dados);
        });
    } else {
        // Se estiver offline declarado
        salvarLocal(dados);
        feedback.innerText = "💾 Offline. Salvo no dispositivo.";
        feedback.style.color = "var(--offline)";
    }
}

function salvarLocal(dados) {
    let fila = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    fila.push(dados);
    localStorage.setItem('maprix_fila', JSON.stringify(fila));
    atualizarPendentes();
}

// --- 5. SINCRONIZAÇÃO E STATUS ---

function atualizarPendentes() {
    let fila = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    const countSpan = document.getElementById('countPendentes');
    const btnSync = document.getElementById('btnSync');

    countSpan.innerText = fila.length;
    
    // Habilita ou desabilita botão de sync
    if (fila.length > 0) {
        btnSync.disabled = false;
        btnSync.style.opacity = "1";
    } else {
        btnSync.disabled = true;
        btnSync.style.opacity = "0.6";
    }
}

function sincronizarPendentes() {
    let fila = JSON.parse(localStorage.getItem('maprix_fila')) || [];
    if (fila.length === 0) return;

    const btnSync = document.getElementById('btnSync');
    const iconOriginal = btnSync.innerHTML;

    // Muda estado do botão para "Carregando"
    btnSync.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> ENVIANDO...';
    btnSync.disabled = true;

    fetch('/api/registrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fila) // Envia a lista toda de uma vez
    })
    .then(res => {
        if (res.ok) {
            alert("Sincronização concluída com sucesso!");
            localStorage.removeItem('maprix_fila'); // Limpa a fila
            atualizarPendentes();
            document.getElementById('msgFeedback').innerText = "✅ Sincronizado!";
        } else {
            alert("Erro ao sincronizar. Tente novamente.");
        }
    })
    .catch(() => {
        alert("Falha na conexão. Verifique sua internet.");
    })
    .finally(() => {
        // Restaura o botão
        btnSync.innerHTML = '<i class="fas fa-sync"></i> SINCRONIZAR';
        atualizarPendentes(); // Reavalia se deve habilitar/desabilitar
    });
}

function verificarConexao() {
    const badge = document.getElementById('statusIndicator');
    
    if (navigator.onLine) {
        badge.className = 'status-bar online';
        badge.innerHTML = '<i class="fas fa-wifi"></i> <span>Conectado</span>';
    } else {
        badge.className = 'status-bar offline';
        badge.innerHTML = '<i class="fas fa-ban"></i> <span>Offline</span>';
    }
}

// Event Listeners globais para mudança de rede
window.addEventListener('online', verificarConexao);
window.addEventListener('offline', verificarConexao);