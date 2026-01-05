from flask import Flask, render_template, request, jsonify, send_file
import sqlite3
import json
import csv
import io
import os
import shutil
from datetime import datetime
from werkzeug.utils import secure_filename

app = Flask(__name__)
DB_NAME = "equipamentos.db"
UPLOAD_FOLDER = 'static/icons' # Pasta onde os ícones ficarão
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'svg'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Configuração de Upload de Checklist
CHECKLIST_FOLDER = 'static/uploads/checklist'
app.config['CHECKLIST_FOLDER'] = CHECKLIST_FOLDER
os.makedirs(CHECKLIST_FOLDER, exist_ok=True)

# ==========================================
# 1. CONFIGURAÇÃO E BANCO DE DADOS
# ==========================================

def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

# Cria a pasta de ícones se não existir
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def init_db():
    conn = get_db_connection()
    
    # Tabela 1: Histórico de Posições
    conn.execute('''
        CREATE TABLE IF NOT EXISTS registros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            equipamento TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            data_hora TEXT NOT NULL,
            sincronizado_em TEXT,
            observacao TEXT,
            cor TEXT DEFAULT '#007bff'
        )
    ''')
    
    # Tabela 2: Áreas (Geofencing)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            geometria TEXT NOT NULL,
            cor TEXT DEFAULT '#FFC107'
        )
    ''')

    # Tabela 3: Cadastro de Ativos (Frota Real)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS equipamentos_cadastrados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE,
            tipo_id INTEGER,
            cor_padrao TEXT DEFAULT '#007bff'
        )
    ''')

    # Tabela 4: Regiões Salvas
    conn.execute('''
        CREATE TABLE IF NOT EXISTS regioes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            latitude REAL,
            longitude REAL,
            zoom INTEGER
        )
    ''')

    # Tabela 5: Tipos de Equipamento (NOVO - CRUD DE TIPOS)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS tipos_equipamento (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE,
            icone TEXT
        )
    ''')
    
    # 6. Perguntas do Checklist (Vinculado ao Tipo)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS checklist_perguntas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo_id INTEGER NOT NULL,
            texto TEXT NOT NULL,
            FOREIGN KEY(tipo_id) REFERENCES tipos_equipamento(id) ON DELETE CASCADE
        )
    ''')

    # 7. Cabeçalho do Checklist Realizado
    conn.execute('''
        CREATE TABLE IF NOT EXISTS checklist_realizados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            equipamento TEXT NOT NULL,
            operador TEXT NOT NULL,
            data_hora TEXT NOT NULL
        )
    ''')

    # 8. Detalhes do Checklist (Respostas)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS checklist_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            checklist_id INTEGER NOT NULL,
            pergunta TEXT NOT NULL,
            conforme INTEGER, -- 1 para OK, 0 para Não OK
            observacao TEXT,
            foto_path TEXT,
            FOREIGN KEY(checklist_id) REFERENCES checklist_realizados(id) ON DELETE CASCADE
        )
    ''')

    # Insere alguns tipos padrão se a tabela estiver vazia
    if conn.execute('SELECT count(*) FROM tipos_equipamento').fetchone()[0] == 0:
        conn.execute("INSERT INTO tipos_equipamento (nome) VALUES ('Caminhão')")
        conn.execute("INSERT INTO tipos_equipamento (nome) VALUES ('Escavadeira')")
        conn.execute("INSERT INTO tipos_equipamento (nome) VALUES ('Veículo Leve')")

    conn.commit()
    conn.close()

# ==========================================
# 2. ROTAS DE TELA
# ==========================================

@app.route('/operador')
def view_operador():
    return render_template('operador.html')

@app.route('/mapa')
def view_mapa():
    return render_template('mapa.html') # Alterei para index.html conforme padrão

@app.route('/')
def index():
    return render_template('mapa.html')

# ==========================================
# 3. API: OPERACIONAL
# ==========================================

@app.route('/api/registrar', methods=['POST'])
def registrar_posicao():
    dados = request.json
    lista_dados = dados if isinstance(dados, list) else [dados]
    conn = get_db_connection()
    
    for item in lista_dados:
        # Busca cor do cadastro oficial
        cursor = conn.execute('SELECT cor_padrao FROM equipamentos_cadastrados WHERE nome = ?', (item['equipamento'],))
        res = cursor.fetchone()
        cor_final = res['cor_padrao'] if res else '#007bff'
        
        conn.execute('''
            INSERT INTO registros (equipamento, latitude, longitude, data_hora, sincronizado_em, observacao, cor) 
            VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (item['equipamento'], item['latitude'], item['longitude'], item['data_hora'], datetime.now().isoformat(), item.get('observacao', ''), cor_final)
        )
    conn.commit()
    conn.close()
    return jsonify({"status": "sucesso"}), 201

@app.route('/api/locais')
def get_locais():
    conn = get_db_connection()
    registros = conn.execute('SELECT * FROM registros ORDER BY data_hora ASC').fetchall()
    conn.close()
    return jsonify([dict(row) for row in registros])

@app.route('/api/registro/<int:id>', methods=['PUT', 'DELETE'])
def manage_registro(id):
    conn = get_db_connection()
    if request.method == 'DELETE':
        conn.execute('DELETE FROM registros WHERE id = ?', (id,))
        msg = "deletado"
    elif request.method == 'PUT':
        d = request.json
        conn.execute('UPDATE registros SET equipamento=?, cor=?, observacao=? WHERE id=?', 
                     (d['equipamento'], d['cor'], d['observacao'], id))
        msg = "atualizado"
    conn.commit()
    conn.close()
    return jsonify({"status": msg})

# ==========================================
# 4. API: GESTÃO (ATIVOS, TIPOS, ÁREAS)
# ==========================================

# --- TIPOS DE EQUIPAMENTO (ATUALIZAÇÃO NA API DE TIPOS (UPLOAD)) ---
@app.route('/api/tipos', methods=['GET', 'POST'])
def manage_tipos():
    conn = get_db_connection()
    
    if request.method == 'POST':
        # Verifica se tem arquivo e texto
        nome = request.form.get('nome') # Agora vem via Form Data, não JSON puro
        file = request.files.get('file') # Arquivo
        
        if not nome:
            return jsonify({"erro": "Nome obrigatório"}), 400
            
        icone_path = None
        
        # Processa o Upload
        if file and allowed_file(file.filename):
            filename = secure_filename(f"{datetime.now().timestamp()}_{file.filename}")
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            icone_path = f"icons/{filename}" # Caminho relativo para o HTML
            
        try:
            conn.execute('INSERT INTO tipos_equipamento (nome, icone) VALUES (?, ?)', (nome, icone_path))
            conn.commit()
            return jsonify({"status": "sucesso"}), 201
        except sqlite3.IntegrityError:
            return jsonify({"erro": "Tipo já existe"}), 400
        finally:
            conn.close()
    else:
        rows = conn.execute('SELECT * FROM tipos_equipamento ORDER BY nome').fetchall()
        conn.close()
        return jsonify([dict(row) for row in rows])

@app.route('/api/tipos/<int:id>', methods=['DELETE'])
def delete_tipo(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM tipos_equipamento WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deletado"})

# --- ATIVOS (FROTA) ---
@app.route('/api/ativos', methods=['GET', 'POST'])
def manage_ativos():
    conn = get_db_connection()
    if request.method == 'POST':
        d = request.json
        try:
            # Agora salvamos o ID do tipo ou o nome do tipo (optei por salvar o nome do tipo para facilitar a busca no operador)
            # Mas idealmente seria relacionamento. Vou manter simples: salvando o nome do tipo vindo do front.
            conn.execute('INSERT INTO equipamentos_cadastrados (nome, tipo_id, cor_padrao) VALUES (?, ?, ?)',
                         (d['nome'], d['tipo_id'], d['cor'])) # tipo_id aqui armazena o ID
            conn.commit()
            return jsonify({"status": "sucesso"}), 201
        except sqlite3.IntegrityError:
            return jsonify({"erro": "Ativo já existe"}), 400
        finally:
            conn.close()
    else:
        # Faz Join para pegar o nome do tipo
        query = '''
            SELECT e.*, t.nome as nome_tipo 
            FROM equipamentos_cadastrados e 
            LEFT JOIN tipos_equipamento t ON e.tipo_id = t.id 
            ORDER BY e.nome
        '''
        rows = conn.execute(query).fetchall()
        conn.close()
        return jsonify([dict(row) for row in rows])

@app.route('/api/ativos/<int:id>', methods=['DELETE'])
def delete_ativo(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM equipamentos_cadastrados WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deletado"})

# --- ÁREAS & REGIÕES ---
@app.route('/api/salvar_area', methods=['POST'])
def salvar_area():
    d = request.json
    conn = get_db_connection()
    conn.execute('INSERT INTO areas (nome, geometria, cor) VALUES (?, ?, ?)',
                 (d['nome'], json.dumps(d['geometry']), d['cor']))
    conn.commit()
    conn.close()
    return jsonify({"status": "sucesso"}), 201

@app.route('/api/areas', methods=['GET'])
def get_areas():
    conn = get_db_connection()
    rows = conn.execute('SELECT * FROM areas').fetchall()
    conn.close()
    return jsonify([{"id":r['id'], "nome":r['nome'], "geometry":json.loads(r['geometria']), "cor":r['cor']} for r in rows])

@app.route('/api/area/<int:id>', methods=['DELETE'])
def delete_area(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM areas WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deletado"})

# --- ATUALIZAÇÃO: ROTA PARA EDITAR GEOMETRIA DA ÁREA ---
@app.route('/api/area/<int:id>', methods=['PUT'])
def update_area_geometry(id):
    dados = request.json
    conn = get_db_connection()
    try:
        # Atualiza apenas a geometria (o desenho)
        conn.execute('UPDATE areas SET geometria = ? WHERE id = ?', 
                     (json.dumps(dados['geometry']), id))
        conn.commit()
        return jsonify({"status": "sucesso"}), 200
    except Exception as e:
        return jsonify({"erro": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/regioes', methods=['GET', 'POST'])
def manage_regioes():
    conn = get_db_connection()
    if request.method == 'POST':
        d = request.json
        conn.execute('INSERT INTO regioes (nome, latitude, longitude, zoom) VALUES (?, ?, ?, ?)',
                     (d['nome'], d['latitude'], d['longitude'], d['zoom']))
        conn.commit()
        res = {"status": "sucesso"}
    else:
        rows = conn.execute('SELECT * FROM regioes').fetchall()
        res = [dict(row) for row in rows]
    conn.close()
    return jsonify(res)

@app.route('/api/regioes/<int:id>', methods=['DELETE'])
def delete_regiao(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM regioes WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deletado"})

# ==========================================
# 5. IMPORTAÇÃO, EXPORTAÇÃO E BACKUP
# ==========================================

@app.route('/api/importar_csv', methods=['POST'])
def importar_csv():
    # ... (Código de importação CSV anterior mantido igual) ...
    if 'file' not in request.files: return jsonify({"erro": "Sem arquivo"}), 400
    file = request.files['file']
    stream = io.StringIO(file.stream.read().decode("UTF8"), newline=None)
    csv_input = csv.reader(stream)
    next(csv_input, None)
    conn = get_db_connection()
    c = 0
    for row in csv_input:
        if len(row) >= 5:
            conn.execute('INSERT INTO registros (equipamento, latitude, longitude, data_hora, sincronizado_em, observacao, cor) VALUES (?,?,?,?,?,?,?)',
                         (row[1], float(row[2]), float(row[3]), row[4], datetime.now().isoformat(), row[5] if len(row)>5 else "", '#007bff'))
            c += 1
    conn.commit()
    conn.close()
    return jsonify({"status": "sucesso", "importados": c}), 201

# --- BACKUP E RESTORE DO BANCO DE DADOS (.db) ---

@app.route('/api/backup_db')
def backup_db():
    """Baixa o arquivo .db atual para o computador do usuário"""
    try:
        return send_file(DB_NAME, as_attachment=True, download_name=f"Backup_Maprix_{datetime.now().strftime('%Y%m%d_%H%M')}.db")
    except Exception as e:
        return str(e), 500

@app.route('/api/restore_db', methods=['POST'])
def restore_db():
    """Recebe um arquivo .db e substitui o atual"""
    if 'file' not in request.files:
        return jsonify({"erro": "Nenhum arquivo enviado"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"erro": "Arquivo vazio"}), 400

    if not file.filename.endswith('.db'):
        return jsonify({"erro": "Formato inválido. Envie um arquivo .db"}), 400

    try:
        # Caminho temporário para salvar o upload
        temp_path = "temp_restore.db"
        file.save(temp_path)
        
        # Substitui o banco oficial
        # (Em sistemas Windows, pode precisar fechar conexões abertas, 
        # mas como usamos 'conn.close()' em todas as rotas, deve funcionar)
        shutil.move(temp_path, DB_NAME)
        
        return jsonify({"status": "sucesso", "mensagem": "Banco restaurado com sucesso! Atualize a página."}), 200
    except Exception as e:
        return jsonify({"erro": f"Falha ao restaurar: {str(e)}"}), 500

# ==========================================
# API: GESTÃO DE CHECKLIST (ADMIN)
# ==========================================

@app.route('/api/checklist/config/<int:tipo_id>', methods=['GET'])
def get_checklist_config(tipo_id):
    conn = get_db_connection()
    rows = conn.execute('SELECT * FROM checklist_perguntas WHERE tipo_id = ?', (tipo_id,)).fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows])

@app.route('/api/checklist/config', methods=['POST'])
def add_checklist_item():
    d = request.json
    conn = get_db_connection()
    conn.execute('INSERT INTO checklist_perguntas (tipo_id, texto) VALUES (?, ?)', (d['tipo_id'], d['texto']))
    conn.commit()
    conn.close()
    return jsonify({"status": "sucesso"}), 201

@app.route('/api/checklist/config/<int:id>', methods=['DELETE'])
def delete_checklist_item(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM checklist_perguntas WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deletado"})

# ==========================================
# API: OPERAÇÃO DE CHECKLIST (SUBMIT)
# ==========================================

@app.route('/api/checklist/submit', methods=['POST'])
def submit_checklist():
    try:
        # Dados vêm via FormData
        equipamento = request.form.get('equipamento')
        operador = request.form.get('operador')
        
        # Cria o cabeçalho
        conn = get_db_connection()
        cursor = conn.execute(
            'INSERT INTO checklist_realizados (equipamento, operador, data_hora) VALUES (?, ?, ?)',
            (equipamento, operador, datetime.now().isoformat())
        )
        checklist_id = cursor.lastrowid
        
        # Processa os itens (as chaves do form são dinâmicas)
        # Padrão esperado das chaves: "item_X_conforme", "item_X_obs", "item_X_foto" (onde X é o ID da pergunta ou índice)
        
        # Primeiro, identificamos quais IDs de perguntas vieram
        perguntas_map = {} # id -> {texto, conforme, obs, foto}
        
        # Recupera texto das perguntas para salvar histórico (caso a pergunta mude depois)
        # O ideal seria mandar o texto junto no form, vamos assumir que o front manda: "item_ID_texto"
        
        for key in request.form:
            if key.startswith('item_'):
                parts = key.split('_') # item, ID, tipo
                p_id = parts[1]
                tipo_campo = parts[2] # texto, conforme, obs
                
                if p_id not in perguntas_map: perguntas_map[p_id] = {}
                perguntas_map[p_id][tipo_campo] = request.form[key]

        # Salva cada item
        for p_id, dados in perguntas_map.items():
            texto = dados.get('texto', 'Item removido')
            conforme = 1 if dados.get('conforme') == 'true' else 0
            obs = dados.get('obs', '')
            
            # Processa Foto
            foto_file = request.files.get(f'item_{p_id}_foto')
            foto_path = None
            if foto_file and allowed_file(foto_file.filename):
                filename = secure_filename(f"chk_{checklist_id}_{p_id}_{int(datetime.now().timestamp())}.jpg")
                foto_file.save(os.path.join(app.config['CHECKLIST_FOLDER'], filename))
                foto_path = f"uploads/checklist/{filename}"
            
            conn.execute('''
                INSERT INTO checklist_itens (checklist_id, pergunta, conforme, observacao, foto_path)
                VALUES (?, ?, ?, ?, ?)
            ''', (checklist_id, texto, conforme, obs, foto_path))
            
        conn.commit()
        conn.close()
        return jsonify({"status": "sucesso"}), 201

    except Exception as e:
        print(e)
        return jsonify({"erro": str(e)}), 500

if __name__ == '__main__':
    init_db()
    app.run(debug=True, host='0.0.0.0', port=5000)