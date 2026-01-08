from flask import Flask, render_template, request, jsonify, send_file
import psycopg2
from psycopg2.extras import RealDictCursor
import json
import csv
import io
import os
from datetime import datetime
from werkzeug.utils import secure_filename

# --- NOVO: Importação do Cloudinary ---
import cloudinary
import cloudinary.uploader
import cloudinary.api

app = Flask(__name__)

# Configuração do Cloudinary
cloudinary.config(
    cloud_name = os.getenv('CLOUD_NAME'),
    api_key = os.getenv('API_KEY'),
    api_secret = os.getenv('API_SECRET')
)

# Pegar a URL do banco
DATABASE_URL = os.getenv('DATABASE_URL')

# ==========================================
# 1. CONFIGURAÇÃO E BANCO DE DADOS
# ==========================================

def get_db_connection():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    return conn

def allowed_file(filename):
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'svg'}
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ... (A função init_db e calcular_status_bateria permanecem IGUAIS ao passo anterior, 
# mas vou manter abreviado aqui para focar na mudança das imagens. 
# Mantenha o init_db e calcular_status_bateria do código PostgreSQL que te passei antes) ...

# PARA FACILITAR, COLE AQUI AS FUNÇÕES 'init_db' E 'calcular_status_bateria' DO CÓDIGO ANTERIOR
# SE PRECISAR QUE EU REESCREVA ELAS AQUI, ME AVISE. VOU FOCAR NAS ROTAS DE UPLOAD ABAIXO.

def init_db():
    # ... (Cole o conteúdo do init_db do passo anterior aqui) ...
    # Se você copiar e colar este bloco inteiro, certifique-se de que o init_db 
    # está criando as tabelas corretamente como mostrei na resposta anterior.
    conn = get_db_connection()
    cur = conn.cursor()
    # ... (Criação das tabelas igual ao código anterior) ...
    # Vou resumir para economizar espaço, mas execute o init_db completo
    cur.execute('''CREATE TABLE IF NOT EXISTS registros (id SERIAL PRIMARY KEY, equipamento TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, data_hora TEXT NOT NULL, sincronizado_em TEXT, observacao TEXT, cor TEXT DEFAULT '#007bff')''')
    cur.execute('''CREATE TABLE IF NOT EXISTS areas (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, geometria TEXT NOT NULL, cor TEXT DEFAULT '#FFC107')''')
    cur.execute('''CREATE TABLE IF NOT EXISTS equipamentos_cadastrados (id SERIAL PRIMARY KEY, nome TEXT NOT NULL UNIQUE, tipo_id INTEGER, cor_padrao TEXT DEFAULT '#007bff', bateria_fabricacao TEXT)''')
    cur.execute('''CREATE TABLE IF NOT EXISTS regioes (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, latitude REAL, longitude REAL, zoom INTEGER)''')
    cur.execute('''CREATE TABLE IF NOT EXISTS tipos_equipamento (id SERIAL PRIMARY KEY, nome TEXT NOT NULL UNIQUE, icone TEXT)''')
    cur.execute('''CREATE TABLE IF NOT EXISTS checklist_perguntas (id SERIAL PRIMARY KEY, tipo_id INTEGER NOT NULL, texto TEXT NOT NULL, FOREIGN KEY(tipo_id) REFERENCES tipos_equipamento(id) ON DELETE CASCADE)''')
    cur.execute('''CREATE TABLE IF NOT EXISTS checklist_realizados (id SERIAL PRIMARY KEY, equipamento TEXT NOT NULL, operador TEXT NOT NULL, data_hora TEXT NOT NULL)''')
    cur.execute('''CREATE TABLE IF NOT EXISTS checklist_itens (id SERIAL PRIMARY KEY, checklist_id INTEGER NOT NULL, pergunta TEXT NOT NULL, conforme INTEGER, observacao TEXT, foto_path TEXT, FOREIGN KEY(checklist_id) REFERENCES checklist_realizados(id) ON DELETE CASCADE)''')
    cur.execute('''CREATE TABLE IF NOT EXISTS config_sistema (chave TEXT PRIMARY KEY, valor TEXT)''')
    
    # Configs iniciais
    cur.execute("SELECT count(*) as count FROM config_sistema WHERE chave='bat_aviso'")
    if cur.fetchone()['count'] == 0:
        cur.execute("INSERT INTO config_sistema (chave, valor) VALUES ('bat_aviso', '48')") 
        cur.execute("INSERT INTO config_sistema (chave, valor) VALUES ('bat_critico', '54')") 
    
    cur.execute('SELECT count(*) as count FROM tipos_equipamento')
    if cur.fetchone()['count'] == 0:
        cur.execute("INSERT INTO tipos_equipamento (nome) VALUES ('Caminhão')")
        cur.execute("INSERT INTO tipos_equipamento (nome) VALUES ('Escavadeira')")
        cur.execute("INSERT INTO tipos_equipamento (nome) VALUES ('Veículo Leve')")

    conn.commit()
    cur.close()
    conn.close()

def calcular_status_bateria(data_fab_str):
    if not data_fab_str: return "Indefinido", "cinza"
    try:
        fab = datetime.strptime(data_fab_str, "%Y-%m")
        hoje = datetime.now()
        meses_uso = (hoje.year - fab.year) * 12 + (hoje.month - fab.month)
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT valor FROM config_sistema WHERE chave='bat_aviso'")
        aviso = int(cur.fetchone()['valor'])
        cur.execute("SELECT valor FROM config_sistema WHERE chave='bat_critico'")
        critico = int(cur.fetchone()['valor'])
        cur.close()
        conn.close()
        if meses_uso >= critico: return "B/ Vencida", "vermelho"
        elif meses_uso >= aviso: return "B/ Próximo ao Vencimento", "laranja"
        else: return "Bateria Saúdavel", "verde"
    except:
        return "Erro Data", "cinza"

@app.route('/api/restaurar_dados', methods=['POST'])
def restaurar_dados():
    if 'file' not in request.files: return jsonify({"erro": "Sem arquivo"}), 400
    file = request.files['file']
    
    try:
        dados = json.load(file)
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 1. Configurações
        if 'config_sistema' in dados:
            for c in dados['config_sistema']:
                cur.execute("INSERT INTO config_sistema (chave, valor) VALUES (%s, %s) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor", (c['chave'], c['valor']))

        # 2. Tipos
        if 'tipos_equipamento' in dados:
            for t in dados['tipos_equipamento']:
                cur.execute("INSERT INTO tipos_equipamento (id, nome, icone) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING", (t['id'], t['nome'], t['icone']))

        # 3. Regiões
        if 'regioes' in dados:
            for r in dados['regioes']:
                cur.execute("INSERT INTO regioes (id, nome, latitude, longitude, zoom) VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING", (r['id'], r['nome'], r['latitude'], r['longitude'], r['zoom']))

        # 4. Áreas
        if 'areas' in dados:
            for a in dados['areas']:
                cur.execute("INSERT INTO areas (id, nome, geometria, cor) VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING", (a['id'], a['nome'], a['geometria'], a['cor']))

        # 5. Ativos
        if 'equipamentos_cadastrados' in dados:
            for e in dados['equipamentos_cadastrados']:
                cur.execute("INSERT INTO equipamentos_cadastrados (id, nome, tipo_id, cor_padrao, bateria_fabricacao) VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING", 
                            (e['id'], e['nome'], e['tipo_id'], e['cor_padrao'], e['bateria_fabricacao']))

        # 6. Registros
        if 'registros' in dados:
            for r in dados['registros']:
                cur.execute("INSERT INTO registros (id, equipamento, latitude, longitude, data_hora, sincronizado_em, observacao, cor) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING", 
                            (r['id'], r['equipamento'], r['latitude'], r['longitude'], r['data_hora'], r['sincronizado_em'], r['observacao'], r['cor']))

        # 7. Perguntas
        if 'checklist_perguntas' in dados:
            for p in dados['checklist_perguntas']:
                cur.execute("INSERT INTO checklist_perguntas (id, tipo_id, texto) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING", (p['id'], p['tipo_id'], p['texto']))

        # 8. Checklists Realizados (O PAI)
        if 'checklist_realizados' in dados:
            for c in dados['checklist_realizados']:
                cur.execute("INSERT INTO checklist_realizados (id, equipamento, operador, data_hora) VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING", 
                            (c['id'], c['equipamento'], c['operador'], c['data_hora']))

        # 9. Itens do Checklist (CORREÇÃO DE SEGURANÇA AQUI)
        if 'checklist_itens' in dados:
            for i in dados['checklist_itens']:
                # Truque SQL: INSERT ... SELECT ... WHERE EXISTS
                # Isso só insere o item SE o pai (checklist_realizados) existir no banco.
                # Se o pai não existir (dado órfão), ele ignora silenciosamente e não dá erro 500.
                cur.execute("""
                    INSERT INTO checklist_itens (id, checklist_id, pergunta, conforme, observacao, foto_path)
                    SELECT %s, %s, %s, %s, %s, %s
                    WHERE EXISTS (SELECT 1 FROM checklist_realizados WHERE id = %s)
                    ON CONFLICT (id) DO NOTHING
                """, (i['id'], i['checklist_id'], i['pergunta'], i['conforme'], i['observacao'], i['foto_path'], i['checklist_id']))

        conn.commit()
        cur.close()
        conn.close()
        
        reset_sequences()
        
        return jsonify({"status": "sucesso", "mensagem": "Backup restaurado com sucesso! (Itens órfãos ignorados)"}), 200
    except Exception as e:
        print(f"Erro Restore: {e}")
        # Importante: Rollback em caso de erro grave para não travar o banco
        try:
            if conn: conn.rollback()
        except: pass
        return jsonify({"erro": str(e)}), 500

# ==========================================
# ROTAS DE TELA
# ==========================================
@app.route('/operador')
def view_operador(): return render_template('operador.html')

@app.route('/mapa')
def view_mapa(): return render_template('index.html') 

@app.route('/')
def index(): return render_template('index.html')

# ==========================================
# API: OPERACIONAL (REGISTROS)
# ==========================================
@app.route('/api/registrar', methods=['POST'])
def registrar_posicao():
    dados = request.json
    lista_dados = dados if isinstance(dados, list) else [dados]
    conn = get_db_connection()
    cur = conn.cursor()
    for item in lista_dados:
        cur.execute('SELECT cor_padrao FROM equipamentos_cadastrados WHERE nome = %s', (item['equipamento'],))
        res = cur.fetchone()
        cor_final = res['cor_padrao'] if res else '#007bff'
        cur.execute('INSERT INTO registros (equipamento, latitude, longitude, data_hora, sincronizado_em, observacao, cor) VALUES (%s, %s, %s, %s, %s, %s, %s)',
            (item['equipamento'], item['latitude'], item['longitude'], item['data_hora'], datetime.now().isoformat(), item.get('observacao', ''), cor_final))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"status": "sucesso"}), 201

@app.route('/api/locais')
def get_locais():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('SELECT * FROM registros ORDER BY data_hora ASC')
    registros = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([dict(row) for row in registros])

@app.route('/api/registro/<int:id>', methods=['PUT', 'DELETE'])
def manage_registro(id):
    conn = get_db_connection()
    cur = conn.cursor()
    if request.method == 'DELETE':
        cur.execute('DELETE FROM registros WHERE id = %s', (id,))
        msg = "deletado"
    elif request.method == 'PUT':
        d = request.json
        cur.execute('UPDATE registros SET equipamento=%s, cor=%s, observacao=%s WHERE id=%s', (d['equipamento'], d['cor'], d['observacao'], id))
        msg = "atualizado"
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"status": msg})

# ==========================================
# API: GESTÃO (COM UPLOAD CLOUDINARY)
# ==========================================

@app.route('/api/tipos', methods=['GET', 'POST'])
def manage_tipos():
    conn = get_db_connection()
    cur = conn.cursor()
    
    if request.method == 'POST':
        nome = request.form.get('nome')
        file = request.files.get('file')
        
        if not nome: return jsonify({"erro": "Nome obrigatório"}), 400
        
        icone_path = None
        
        # --- LÓGICA CLOUDINARY PARA ÍCONES ---
        if file and allowed_file(file.filename):
            try:
                # Envia direto para a nuvem
                upload_result = cloudinary.uploader.upload(file)
                # Pega a URL segura (https)
                icone_path = upload_result['secure_url']
            except Exception as e:
                print(f"Erro Upload Cloudinary: {e}")
                return jsonify({"erro": "Falha no upload da imagem"}), 500
        # -------------------------------------

        try:
            cur.execute('INSERT INTO tipos_equipamento (nome, icone) VALUES (%s, %s)', (nome, icone_path))
            conn.commit()
            return jsonify({"status": "sucesso"}), 201
        except psycopg2.IntegrityError:
            conn.rollback()
            return jsonify({"erro": "Tipo já existe"}), 400
        finally:
            cur.close()
            conn.close()
    else:
        cur.execute('SELECT * FROM tipos_equipamento ORDER BY nome')
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return jsonify([dict(row) for row in rows])

# (Rotas de Tipos Delete, Ativos, Bateria e Áreas permanecem iguais...)
# ... COPIAR AS ROTAS manage_ativos, update_ativo, delete_ativo, update_bateria_operador, manage_config_bateria, salvar_area, get_areas, manage_area, manage_regioes ...
# Vou pular para a rota de CHECKLIST SUBMIT que é onde tem upload também.

# ==========================================
# GESTÃO DE CHECKLIST (COM UPLOAD CLOUDINARY)
# ==========================================

@app.route('/api/checklist/submit', methods=['POST'])
def submit_checklist():
    try:
        equipamento = request.form.get('equipamento')
        operador = request.form.get('operador')
        
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            'INSERT INTO checklist_realizados (equipamento, operador, data_hora) VALUES (%s, %s, %s) RETURNING id',
            (equipamento, operador, datetime.now().isoformat())
        )
        checklist_id = cur.fetchone()['id']
        
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
            valor_recebido = dados.get('conforme')
            conforme = 1 if valor_recebido in ['on', 'true', '1'] else 0
            obs = dados.get('obs', '')
            
            # --- LÓGICA CLOUDINARY PARA CHECKLIST ---
            foto_path = None
            foto_file = request.files.get(f'item_{p_id}_foto')
            
            if foto_file and allowed_file(foto_file.filename):
                try:
                    # Envia para o Cloudinary (pasta 'checklist' na nuvem)
                    upload_result = cloudinary.uploader.upload(foto_file, folder="checklist")
                    foto_path = upload_result['secure_url']
                except Exception as e:
                    print(f"Erro ao subir foto do item {p_id}: {e}")
                    # Não vamos parar o processo, mas a foto não será salva
            # ----------------------------------------
            
            cur.execute('''
                INSERT INTO checklist_itens (checklist_id, pergunta, conforme, observacao, foto_path)
                VALUES (%s, %s, %s, %s, %s)
            ''', (checklist_id, texto, conforme, obs, foto_path))
            
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({"status": "sucesso"}), 201

    except Exception as e:
        print(e)
        return jsonify({"erro": str(e)}), 500

# (Restante das rotas de leitura e delete do checklist permanecem iguais...)
# ... Inclua as rotas get_checklist_config, add_checklist_item, delete_checklist_item, get_all_checklists, check_novos_checklists, delete_checklist, update_checklist_header ...

# Rota de Inicialização
@app.route('/init_db')
def manual_init_db():
    try:
        init_db()
        return "Banco de dados inicializado com sucesso!"
    except Exception as e:
        return f"Erro: {str(e)}"

# Rotas auxiliares que faltaram no resumo acima, inclua elas aqui para o app funcionar completo:
@app.route('/api/tipos/<int:id>', methods=['DELETE'])
def delete_tipo(id):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('DELETE FROM tipos_equipamento WHERE id = %s', (id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"status": "deletado"})

@app.route('/api/ativos', methods=['GET', 'POST'])
def manage_ativos():
    conn = get_db_connection()
    cur = conn.cursor()
    if request.method == 'POST':
        d = request.json
        try:
            cur.execute('INSERT INTO equipamentos_cadastrados (nome, tipo_id, cor_padrao, bateria_fabricacao) VALUES (%s, %s, %s, %s)', (d['nome'], d['tipo_id'], d['cor'], d.get('bateria_fabricacao')))
            conn.commit()
            return jsonify({"status": "sucesso"}), 201
        except psycopg2.IntegrityError:
            conn.rollback()
            return jsonify({"erro": "Ativo já existe"}), 400
        finally:
            cur.close()
            conn.close()
    else:
        cur.execute('SELECT e.*, t.nome as nome_tipo FROM equipamentos_cadastrados e LEFT JOIN tipos_equipamento t ON e.tipo_id = t.id ORDER BY e.nome')
        rows = cur.fetchall()
        cur.close()
        conn.close()
        lista = []
        for r in rows:
            item = dict(r)
            status, cor_status = calcular_status_bateria(item['bateria_fabricacao'])
            item['status_bateria'] = status
            item['cor_bateria'] = cor_status
            lista.append(item)
        return jsonify(lista)

@app.route('/api/ativos_update/<int:id>', methods=['PUT'])
def update_ativo(id):
    d = request.json
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute('UPDATE equipamentos_cadastrados SET nome = %s, cor_padrao = %s, bateria_fabricacao = %s WHERE id = %s', (d['nome'], d['cor'], d['bateria_fabricacao'], id))
        conn.commit()
        return jsonify({"status": "sucesso"})
    except Exception as e: return jsonify({"erro": str(e)}), 500
    finally: cur.close(); conn.close()

@app.route('/api/ativos/<int:id>', methods=['DELETE'])
def delete_ativo(id):
    conn = get_db_connection(); cur = conn.cursor()
    cur.execute('DELETE FROM equipamentos_cadastrados WHERE id = %s', (id,)); conn.commit(); cur.close(); conn.close()
    return jsonify({"status": "deletado"})

@app.route('/api/operador/bateria', methods=['POST'])
def update_bateria_operador():
    d = request.json
    conn = get_db_connection(); cur = conn.cursor()
    try:
        cur.execute('UPDATE equipamentos_cadastrados SET bateria_fabricacao = %s WHERE nome = %s', (d['data'], d['equipamento']))
        conn.commit()
        status, cor = calcular_status_bateria(d['data'])
        return jsonify({"status": "sucesso", "novo_status": status, "nova_cor": cor})
    except Exception as e: return jsonify({"erro": str(e)}), 500
    finally: cur.close(); conn.close()

@app.route('/api/config/bateria', methods=['GET', 'POST'])
def manage_config_bateria():
    conn = get_db_connection(); cur = conn.cursor()
    if request.method == 'POST':
        d = request.json
        cur.execute("UPDATE config_sistema SET valor = %s WHERE chave = 'bat_aviso'", (d['aviso'],))
        cur.execute("UPDATE config_sistema SET valor = %s WHERE chave = 'bat_critico'", (d['critico'],))
        conn.commit(); cur.close(); conn.close()
        return jsonify({"status": "sucesso"})
    else:
        try:
            cur.execute("SELECT valor FROM config_sistema WHERE chave='bat_aviso'"); aviso = cur.fetchone()['valor']
            cur.execute("SELECT valor FROM config_sistema WHERE chave='bat_critico'"); critico = cur.fetchone()['valor']
        except: aviso, critico = 48, 54
        cur.close(); conn.close()
        return jsonify({"aviso": aviso, "critico": critico})

@app.route('/api/salvar_area', methods=['POST'])
def salvar_area():
    d = request.json; conn = get_db_connection(); cur = conn.cursor()
    cur.execute('INSERT INTO areas (nome, geometria, cor) VALUES (%s, %s, %s)', (d['nome'], json.dumps(d['geometry']), d['cor']))
    conn.commit(); cur.close(); conn.close()
    return jsonify({"status": "sucesso"}), 201

@app.route('/api/areas', methods=['GET'])
def get_areas():
    conn = get_db_connection(); cur = conn.cursor(); cur.execute('SELECT * FROM areas'); rows = cur.fetchall(); cur.close(); conn.close()
    return jsonify([{"id":r['id'], "nome":r['nome'], "geometry":json.loads(r['geometria']), "cor":r['cor']} for r in rows])

@app.route('/api/area/<int:id>', methods=['DELETE', 'PUT'])
def manage_area(id):
    conn = get_db_connection(); cur = conn.cursor()
    try:
        if request.method == 'DELETE':
            cur.execute('DELETE FROM areas WHERE id = %s', (id,)); conn.commit(); return jsonify({"status": "deletado"})
        elif request.method == 'PUT':
            dados = request.json
            if 'geometry' in dados: cur.execute('UPDATE areas SET geometria = %s WHERE id = %s', (json.dumps(dados['geometry']), id))
            if 'cor' in dados: cur.execute('UPDATE areas SET cor = %s WHERE id = %s', (dados['cor'], id))
            conn.commit(); return jsonify({"status": "sucesso"}), 200
    except Exception as e: return jsonify({"erro": str(e)}), 500
    finally: cur.close(); conn.close()

@app.route('/api/regioes', methods=['GET', 'POST'])
def manage_regioes():
    conn = get_db_connection(); cur = conn.cursor()
    if request.method == 'POST':
        d = request.json
        cur.execute('INSERT INTO regioes (nome, latitude, longitude, zoom) VALUES (%s, %s, %s, %s)', (d['nome'], d['latitude'], d['longitude'], d['zoom']))
        conn.commit(); res = {"status": "sucesso"}
    else:
        cur.execute('SELECT * FROM regioes'); rows = cur.fetchall(); res = [dict(row) for row in rows]
    cur.close(); conn.close()
    return jsonify(res)

@app.route('/api/regioes/<int:id>', methods=['DELETE'])
def delete_regiao(id):
    conn = get_db_connection(); cur = conn.cursor()
    cur.execute('DELETE FROM regioes WHERE id = %s', (id,)); conn.commit(); cur.close(); conn.close()
    return jsonify({"status": "deletado"})
    
@app.route('/api/importar_csv', methods=['POST'])
def importar_csv():
    if 'file' not in request.files: return jsonify({"erro": "Sem arquivo"}), 400
    file = request.files['file']
    stream = io.StringIO(file.stream.read().decode("UTF8"), newline=None)
    csv_input = csv.reader(stream)
    next(csv_input, None)
    conn = get_db_connection(); cur = conn.cursor(); c = 0
    for row in csv_input:
        if len(row) >= 5:
            cur.execute('INSERT INTO registros (equipamento, latitude, longitude, data_hora, sincronizado_em, observacao, cor) VALUES (%s,%s,%s,%s,%s,%s,%s)', (row[1], float(row[2]), float(row[3]), row[4], datetime.now().isoformat(), row[5] if len(row)>5 else "", '#007bff')); c += 1
    conn.commit(); cur.close(); conn.close()
    return jsonify({"status": "sucesso", "importados": c}), 201
    
@app.route('/api/checklist/config/<int:tipo_id>', methods=['GET'])
def get_checklist_config(tipo_id):
    conn = get_db_connection(); cur = conn.cursor()
    cur.execute('SELECT * FROM checklist_perguntas WHERE tipo_id = %s', (tipo_id,)); rows = cur.fetchall()
    cur.close(); conn.close()
    return jsonify([dict(row) for row in rows])

@app.route('/api/checklist/config', methods=['POST'])
def add_checklist_item():
    d = request.json; conn = get_db_connection(); cur = conn.cursor()
    cur.execute('INSERT INTO checklist_perguntas (tipo_id, texto) VALUES (%s, %s)', (d['tipo_id'], d['texto']))
    conn.commit(); cur.close(); conn.close()
    return jsonify({"status": "sucesso"}), 201

@app.route('/api/checklist/config/<int:id>', methods=['DELETE'])
def delete_checklist_item(id):
    conn = get_db_connection(); cur = conn.cursor()
    cur.execute('DELETE FROM checklist_perguntas WHERE id = %s', (id,)); conn.commit(); cur.close(); conn.close()
    return jsonify({"status": "deletado"})

@app.route('/api/checklists/all')
def get_all_checklists():
    conn = get_db_connection(); cur = conn.cursor()
    cur.execute('SELECT * FROM checklist_realizados ORDER BY id DESC LIMIT 50'); headers = cur.fetchall()
    resultado = []
    for h in headers:
        cur.execute('SELECT * FROM checklist_itens WHERE checklist_id = %s', (h['id'],))
        itens = cur.fetchall()
        resultado.append({"id": h['id'], "equipamento": h['equipamento'], "operador": h['operador'], "data_hora": h['data_hora'], "itens": [dict(i) for i in itens]})
    cur.close(); conn.close()
    return jsonify(resultado)

@app.route('/api/checklists/novos')
def check_novos_checklists():
    last_id = request.args.get('last_id', 0); conn = get_db_connection(); cur = conn.cursor()
    cur.execute('SELECT count(*) as qtd, max(id) as max_id FROM checklist_realizados WHERE id > %s', (last_id,)); novos = cur.fetchone()
    cur.close(); conn.close()
    return jsonify({"qtd": novos['qtd'], "max_id": novos['max_id']})

@app.route('/api/checklist/<int:id>', methods=['DELETE'])
def delete_checklist(id):
    conn = get_db_connection(); cur = conn.cursor()
    try: cur.execute('DELETE FROM checklist_realizados WHERE id = %s', (id,)); conn.commit(); return jsonify({"status": "sucesso"})
    except Exception as e: return jsonify({"erro": str(e)}), 500
    finally: cur.close(); conn.close()

@app.route('/api/checklist/<int:id>', methods=['PUT'])
def update_checklist_header(id):
    d = request.json; conn = get_db_connection(); cur = conn.cursor()
    try: cur.execute('UPDATE checklist_realizados SET equipamento = %s, operador = %s, data_hora = %s WHERE id = %s', (d['equipamento'], d['operador'], d['data_hora'], id)); conn.commit(); return jsonify({"status": "sucesso"})
    except Exception as e: return jsonify({"erro": str(e)}), 500
    finally: cur.close(); conn.close()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)