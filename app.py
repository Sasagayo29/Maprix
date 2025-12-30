from flask import Flask, render_template, request, jsonify
import sqlite3
import json
from datetime import datetime

app = Flask(__name__)
DB_NAME = "equipamentos.db"

def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    
    # Tabela de Equipamentos (Já tinha cor)
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
    
    # ATUALIZADO: Tabela Areas agora tem COR
    conn.execute('''
        CREATE TABLE IF NOT EXISTS areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            geometria TEXT NOT NULL,
            cor TEXT DEFAULT '#FFC107'
        )
    ''')
    conn.commit()
    conn.close()

# --- ROTAS DE TELA ---
@app.route('/operador')
def view_operador():
    return render_template('operador.html')

@app.route('/mapa')
def view_mapa():
    return render_template('mapa.html')

# --- API ---
@app.route('/api/registrar', methods=['POST'])
def registrar_posicao():
    dados = request.json
    lista_dados = dados if isinstance(dados, list) else [dados]
    
    conn = get_db_connection()
    for item in lista_dados:
        # Pega a observação (ou vazio se não tiver)
        obs = item.get('observacao', '')
        # Cor padrão é Azul, o gestor muda depois se quiser
        cor_padrao = '#007bff' 
        
        conn.execute('''
            INSERT INTO registros (equipamento, latitude, longitude, data_hora, sincronizado_em, observacao, cor) 
            VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (item['equipamento'], item['latitude'], item['longitude'], item['data_hora'], datetime.now().isoformat(), obs, cor_padrao)
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

@app.route('/api/registro/<int:id>', methods=['PUT'])
def update_registro(id):
    dados = request.json
    conn = get_db_connection()
    
    # ATUALIZADO: Permite editar Nome, Cor e Observação
    conn.execute('''
        UPDATE registros 
        SET equipamento = ?, cor = ?, observacao = ? 
        WHERE id = ?''', 
        (dados['equipamento'], dados['cor'], dados['observacao'], id))
        
    conn.commit()
    conn.close()
    return jsonify({"status": "atualizado"})

@app.route('/api/registro/<int:id>', methods=['DELETE'])
def delete_registro(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM registros WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deletado"})

# --- ROTAS DE ÁREAS (ATUALIZADAS PARA COR) ---
@app.route('/api/salvar_area', methods=['POST'])
def salvar_area():
    dados = request.json
    conn = get_db_connection()
    # Salva Nome, Geometria e Cor
    conn.execute('INSERT INTO areas (nome, geometria, cor) VALUES (?, ?, ?)',
                 (dados['nome'], json.dumps(dados['geometry']), dados['cor']))
    conn.commit()
    conn.close()
    return jsonify({"status": "sucesso"}), 201

@app.route('/api/areas')
def get_areas():
    conn = get_db_connection()
    areas = conn.execute('SELECT * FROM areas').fetchall()
    conn.close()
    lista = []
    for row in areas:
        lista.append({
            "id": row['id'], 
            "nome": row['nome'], 
            "geometry": json.loads(row['geometria']),
            "cor": row['cor'] # Retorna a cor para o mapa
        })
    return jsonify(lista)

# NOVA ROTA: Deletar Área (Útil se desenhar errado)
@app.route('/api/area/<int:id>', methods=['DELETE'])
def delete_area(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM areas WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deletado"})

if __name__ == '__main__':
    init_db()
    app.run(debug=True, host='0.0.0.0', port=5000)