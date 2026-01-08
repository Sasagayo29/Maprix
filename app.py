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
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ==========================================
# 1. CONFIGURAÇÃO E BANCO DE DADOS
# ==========================================

def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def init_db():
    conn = get_db_connection()
    
    # 1. Histórico de Posições
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
    
    # 2. Áreas (Geofencing)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            geometria TEXT NOT NULL,
            cor TEXT DEFAULT '#FFC107'
        )
    ''')

    # 3. Cadastro de Ativos (Frota Real)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS equipamentos_cadastrados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE,
            tipo_id INTEGER,
            cor_padrao TEXT DEFAULT '#007bff',
            bateria_fabricacao TEXT  -- NOVO: Data de fabricação (YYYY-MM)
        )
    ''')
    
    try:
        conn.execute('ALTER TABLE equipamentos_cadastrados ADD COLUMN bateria_fabricacao TEXT')
    except:
        pass

    # 4. Regiões Salvas
    conn.execute('''
        CREATE TABLE IF NOT EXISTS regioes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            latitude REAL,
            longitude REAL,
            zoom INTEGER
        )
    ''')

    # 5. Tipos de Equipamento
    conn.execute('''
        CREATE TABLE IF NOT EXISTS tipos_equipamento (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE,
            icone TEXT
        )
    ''')
    
    # 6. Perguntas do Checklist
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

    # 8. Detalhes do Checklist
    conn.execute('''
        CREATE TABLE IF NOT EXISTS checklist_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            checklist_id INTEGER NOT NULL,
            pergunta TEXT NOT NULL,
            conforme INTEGER,
            observacao TEXT,
            foto_path TEXT,
            FOREIGN KEY(checklist_id) REFERENCES checklist_realizados(id) ON DELETE CASCADE
        )
    ''')

    # 9. Configurações do Sistema (Limites de Bateria, etc)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS config_sistema (
            chave TEXT PRIMARY KEY,
            valor TEXT
        )
    ''')
    
    if conn.execute("SELECT count(*) FROM config_sistema WHERE chave='bat_aviso'").fetchone()[0] == 0:
        conn.execute("INSERT INTO config_sistema (chave, valor) VALUES ('bat_aviso', '48')") 
        conn.execute("INSERT INTO config_sistema (chave, valor) VALUES ('bat_critico', '54')") 

    if conn.execute('SELECT count(*) FROM tipos_equipamento').fetchone()[0] == 0:
        conn.execute("INSERT INTO tipos_equipamento (nome) VALUES ('Caminhão')")
        conn.execute("INSERT INTO tipos_equipamento (nome) VALUES ('Escavadeira')")
        conn.execute("INSERT INTO tipos_equipamento (nome) VALUES ('Veículo Leve')")

    conn.commit()
    conn.close()

def calcular_status_bateria(data_fab_str):
    if not data_fab_str: return "Indefinido", "cinza"
    try:
        fab = datetime.strptime(data_fab_str, "%Y-%m")
        hoje = datetime.now()
        meses_uso = (hoje.year - fab.year) * 12 + (hoje.month - fab.month)
        
        conn = get_db_connection()
        aviso = int(conn.execute("SELECT valor FROM config_sistema WHERE chave='bat_aviso'").fetchone()['valor'])
        critico = int(conn.execute("SELECT valor FROM config_sistema WHERE chave='bat_critico'").fetchone()['valor'])
        conn.close()

        if meses_uso >= critico: return "B/ Vencida", "vermelho"
        elif meses_uso >= aviso: return "B/ Próximo ao Vencimento", "laranja"
        else: return "Bateria Saúdavel", "verde"
    except:
        return "Erro Data", "cinza"

# ==========================================
# 2. ROTAS DE TELA
# ==========================================

@app.route('/operador')
def view_operador():
    return render_template('operador.html')

@app.route('/mapa')
def view_mapa():
    return render_template('index.html') 

@app.route('/')
def index():
    return render_template('index.html')

# ==========================================
# 3. API: OPERACIONAL
# ==========================================

@app.route('/api/registrar', methods=['POST'])
def registrar_posicao():
    dados = request.json
    lista_dados = dados if isinstance(dados, list) else [dados]
    conn = get_db_connection()
    
    for item in lista_dados:
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
# 4. API: GESTÃO (ATIVOS, TIPOS, ÁREAS, BATERIA)
# ==========================================

# --- TIPOS ---
@app.route('/api/tipos', methods=['GET', 'POST'])
def manage_tipos():
    conn = get_db_connection()
    if request.method == 'POST':
        nome = request.form.get('nome')
        file = request.files.get('file')
        if not nome: return jsonify({"erro": "Nome obrigatório"}), 400
        icone_path = None
        if file and allowed_file(file.filename):
            filename = secure_filename(f"{datetime.now().timestamp()}_{file.filename}")
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            icone_path = f"icons/{filename}"
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

# --- ATIVOS ---
@app.route('/api/ativos', methods=['GET', 'POST'])
def manage_ativos():
    conn = get_db_connection()
    if request.method == 'POST':
        d = request.json
        try:
            conn.execute('''
                INSERT INTO equipamentos_cadastrados (nome, tipo_id, cor_padrao, bateria_fabricacao) 
                VALUES (?, ?, ?, ?)''',
                (d['nome'], d['tipo_id'], d['cor'], d.get('bateria_fabricacao')))
            conn.commit()
            return jsonify({"status": "sucesso"}), 201
        except sqlite3.IntegrityError:
            return jsonify({"erro": "Ativo já existe"}), 400
        finally:
            conn.close()
    else:
        query = '''
            SELECT e.*, t.nome as nome_tipo 
            FROM equipamentos_cadastrados e 
            LEFT JOIN tipos_equipamento t ON e.tipo_id = t.id 
            ORDER BY e.nome
        '''
        rows = conn.execute(query).fetchall()
        conn.close()
        lista = []
        for r in rows:
            item = dict(r)
            status, cor_status = calcular_status_bateria(item['bateria_fabricacao'])
            item['status_bateria'] = status
            item['cor_bateria'] = cor_status
            lista.append(item)
        return jsonify(lista)

# Adicione junto com as rotas de ATIVOS
@app.route('/api/ativos_update/<int:id>', methods=['PUT'])
def update_ativo(id):
    d = request.json
    conn = get_db_connection()
    try:
        conn.execute('''
            UPDATE equipamentos_cadastrados 
            SET nome = ?, cor_padrao = ?, bateria_fabricacao = ?
            WHERE id = ?
        ''', (d['nome'], d['cor'], d['bateria_fabricacao'], id))
        conn.commit()
        return jsonify({"status": "sucesso"})
    except Exception as e:
        return jsonify({"erro": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/ativos/<int:id>', methods=['DELETE'])
def delete_ativo(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM equipamentos_cadastrados WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deletado"})

@app.route('/api/operador/bateria', methods=['POST'])
def update_bateria_operador():
    d = request.json
    equipamento_nome = d.get('equipamento')
    nova_data = d.get('data') 
    if not equipamento_nome or not nova_data: return jsonify({"erro": "Dados incompletos"}), 400
    conn = get_db_connection()
    try:
        conn.execute('UPDATE equipamentos_cadastrados SET bateria_fabricacao = ? WHERE nome = ?', (nova_data, equipamento_nome))
        conn.commit()
        status, cor = calcular_status_bateria(nova_data)
        return jsonify({"status": "sucesso", "novo_status": status, "nova_cor": cor})
    except Exception as e:
        return jsonify({"erro": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/config/bateria', methods=['GET', 'POST'])
def manage_config_bateria():
    conn = get_db_connection()
    if request.method == 'POST':
        d = request.json
        conn.execute("UPDATE config_sistema SET valor = ? WHERE chave = 'bat_aviso'", (d['aviso'],))
        conn.execute("UPDATE config_sistema SET valor = ? WHERE chave = 'bat_critico'", (d['critico'],))
        conn.commit()
        conn.close()
        return jsonify({"status": "sucesso"})
    else:
        try:
            aviso = conn.execute("SELECT valor FROM config_sistema WHERE chave='bat_aviso'").fetchone()['valor']
            critico = conn.execute("SELECT valor FROM config_sistema WHERE chave='bat_critico'").fetchone()['valor']
        except:
            aviso, critico = 48, 54
        conn.close()
        return jsonify({"aviso": aviso, "critico": critico})

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

# ==========================================
# ROTA UNIFICADA: DELETAR / EDITAR ÁREA
# (CORRIGIDA PARA FUNCIONAR COM COR E GEOMETRIA)
# ==========================================
@app.route('/api/area/<int:id>', methods=['DELETE', 'PUT'])
def manage_area(id):
    conn = get_db_connection()
    try:
        if request.method == 'DELETE':
            conn.execute('DELETE FROM areas WHERE id = ?', (id,))
            conn.commit()
            return jsonify({"status": "deletado"})
        
        elif request.method == 'PUT':
            dados = request.json
            
            # Atualiza Geometria (se fornecida)
            if 'geometry' in dados:
                conn.execute('UPDATE areas SET geometria = ? WHERE id = ?', 
                             (json.dumps(dados['geometry']), id))
            
            # Atualiza Cor (se fornecida)
            if 'cor' in dados:
                conn.execute('UPDATE areas SET cor = ? WHERE id = ?', 
                             (dados['cor'], id))
            
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

@app.route('/api/backup_db')
def backup_db():
    try:
        return send_file(DB_NAME, as_attachment=True, download_name=f"Backup_Maprix_{datetime.now().strftime('%Y%m%d_%H%M')}.db")
    except Exception as e:
        return str(e), 500

@app.route('/api/restore_db', methods=['POST'])
def restore_db():
    if 'file' not in request.files: return jsonify({"erro": "Sem arquivo"}), 400
    file = request.files['file']
    if not file.filename.endswith('.db'): return jsonify({"erro": "Formato inválido"}), 400
    try:
        file.save("temp_restore.db")
        shutil.move("temp_restore.db", DB_NAME)
        return jsonify({"status": "sucesso", "mensagem": "Restaurado!"}), 200
    except Exception as e:
        return jsonify({"erro": str(e)}), 500

# ==========================================
# GESTÃO DE CHECKLIST (ADMIN & OPERADOR)
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
        equipamento = request.form.get('equipamento')
        operador = request.form.get('operador')
        
        conn = get_db_connection()
        cursor = conn.execute(
            'INSERT INTO checklist_realizados (equipamento, operador, data_hora) VALUES (?, ?, ?)',
            (equipamento, operador, datetime.now().isoformat())
        )
        checklist_id = cursor.lastrowid
        
        perguntas_map = {} 
        for key in request.form:
            if key.startswith('item_'):
                parts = key.split('_') 
                p_id = parts[1]
                tipo_campo = parts[2]
                if p_id not in perguntas_map: perguntas_map[p_id] = {}
                perguntas_map[p_id][tipo_campo] = request.form[key]

        for p_id, dados in perguntas_map.items():
            texto = dados.get('texto', 'Item')
            
            # --- CORREÇÃO AQUI ---
            # O Checkbox HTML envia 'on' por padrão. Aceitamos 'on', 'true' ou '1'.
            valor_recebido = dados.get('conforme')
            conforme = 1 if valor_recebido in ['on', 'true', '1'] else 0
            # ---------------------

            obs = dados.get('obs', '')
            
            foto_path = None
            foto_file = request.files.get(f'item_{p_id}_foto')
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

@app.route('/api/checklists/all')
def get_all_checklists():
    conn = get_db_connection()
    headers = conn.execute('SELECT * FROM checklist_realizados ORDER BY id DESC LIMIT 50').fetchall()
    
    resultado = []
    for h in headers:
        itens = conn.execute('SELECT * FROM checklist_itens WHERE checklist_id = ?', (h['id'],)).fetchall()
        resultado.append({
            "id": h['id'],
            "equipamento": h['equipamento'],
            "operador": h['operador'],
            "data_hora": h['data_hora'],
            "itens": [dict(i) for i in itens]
        })
    conn.close()
    return jsonify(resultado)

@app.route('/api/checklists/novos')
def check_novos_checklists():
    last_id = request.args.get('last_id', 0)
    conn = get_db_connection()
    novos = conn.execute('SELECT count(*) as qtd, max(id) as max_id FROM checklist_realizados WHERE id > ?', (last_id,)).fetchone()
    conn.close()
    return jsonify({"qtd": novos['qtd'], "max_id": novos['max_id']})

@app.route('/api/checklist/<int:id>', methods=['DELETE'])
def delete_checklist(id):
    conn = get_db_connection()
    try:
        conn.execute('DELETE FROM checklist_realizados WHERE id = ?', (id,))
        conn.commit()
        return jsonify({"status": "sucesso"})
    except Exception as e:
        return jsonify({"erro": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/checklist/<int:id>', methods=['PUT'])
def update_checklist_header(id):
    d = request.json
    conn = get_db_connection()
    try:
        conn.execute('''
            UPDATE checklist_realizados 
            SET equipamento = ?, operador = ?, data_hora = ? 
            WHERE id = ?
        ''', (d['equipamento'], d['operador'], d['data_hora'], id))
        conn.commit()
        return jsonify({"status": "sucesso"})
    except Exception as e:
        return jsonify({"erro": str(e)}), 500
    finally:
        conn.close()

if __name__ == '__main__':
    init_db()
    app.run(debug=True, host='0.0.0.0', port=5000)