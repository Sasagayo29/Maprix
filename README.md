# 🌍 MAPRIX Enterprise

![Status](https://img.shields.io/badge/Status-Cloud_Native-blueviolet)
![Backend](https://img.shields.io/badge/Backend-Flask_%2B_Python-blue)
![Database](https://img.shields.io/badge/Database-PostgreSQL-336791)
![Storage](https://img.shields.io/badge/Storage-Cloudinary-orange)
![Deploy](https://img.shields.io/badge/Deploy-Vercel-black)

**MAPRIX Enterprise** é uma solução moderna de **Gestão de Frota e Georreferenciamento Industrial**. Projetado para rodar em arquitetura *serverless*, o sistema utiliza banco de dados PostgreSQL para persistência segura e Cloudinary para armazenamento de mídia. Oferece monitoramento em tempo real, gestão avançada de ativos e um módulo mobile robusto para operadores, incluindo **Checklist Digital Obrigatório** e controle de vida útil de baterias.

---

## 📸 Screenshots

| Painel do Gestor (Desktop) | Visão do Operador (Mobile) |
|:--------------------------:|:--------------------------:|
| <img width="1233" alt="Painel Gestor" src="https://github.com/user-attachments/assets/bfdc1348-4ff8-43bd-b3ac-5e88740e7378" />| <img width="412" alt="App Operador" src="https://github.com/user-attachments/assets/e27b0c56-5c30-40fa-ba92-90bf5ee99fb9" />|

---

## 🚀 Funcionalidades Principais

### 🏢 Módulo Gestor (Web Desktop)
* **Monitoramento em Tempo Real:** Visualização de ativos no mapa com ícones personalizados via Cloudinary.
* **Gestão de Checklist:**
    * Criação de perguntas dinâmicas por **Tipo de Equipamento**.
    * Monitoramento de respostas e visualização de fotos de evidência (avarias).
* **Controle de Bateria:** Dashboard visual que indica a saúde da bateria (Verde/Laranja/Vermelho) baseada na data de fabricação e configurações de meses de vida útil.
* **Geofencing (Cercas Virtuais):**
    * Desenho de polígonos no mapa.
    * Edição de geometria e cores para categorização de áreas.
* **Backup & Restore JSON:**
    * Sistema de backup robusto que exporta todo o banco (incluindo checklists e configs) para JSON.
    * Restauração inteligente que mescla dados e ignora registros órfãos.
* **Gestão de Cadastros:** CRUD completo de Ativos e Tipos de Equipamento.

### 👷 Módulo Operador (Mobile Web App)
* **Checklist Inteligente:**
    * **Bloqueio de Operação:** O operador não consegue registrar posição GPS sem antes enviar o checklist (se houver itens configurados para o tipo do ativo).
    * **Evidências Fotográficas:** Upload direto da câmera para avarias.
    * **Dispensa Automática:** Se o ativo não tiver checklist configurado (ex: Salas), o sistema libera o acesso automaticamente.
* **Sincronização de Hora Local:** Garante que o registro de checklist utilize o fuso horário correto do dispositivo do operador.
* **Modo Offline (Sync):** Armazena registros de GPS localmente quando sem sinal e sincroniza ao reconectar.
* **Gestão de Bateria:** O operador pode atualizar a data de fabricação da bateria diretamente pelo app lendo a etiqueta.

---

## 🛠️ Stack Tecnológico

* **Backend:** Python 3 (Flask).
* **Banco de Dados:** PostgreSQL (Neon / Supabase) - *Migrado de SQLite para escalabilidade.*
* **Armazenamento de Imagens:** Cloudinary API (Ícones e Fotos de Checklist).
* **Frontend:**
    * HTML5 / CSS3 (Variáveis CSS, Flexbox, Grid, Design Responsivo).
    * JavaScript (ES6+, Async/Await).
* **Mapas:** Leaflet.js (Camadas de Satélite e Rua) + Leaflet.Draw.
* **Hospedagem:** Vercel (Serverless Functions).

---

## 📦 Instalação e Configuração

### Pré-requisitos
* Python 3.x
* Conta no **Neon.tech** (ou qualquer Postgres).
* Conta no **Cloudinary**.

### 1. Clonar o Repositório
```bash
git clone [https://github.com/seu-usuario/maprix-enterprise.git](https://github.com/seu-usuario/maprix-enterprise.git)
cd maprix-enterprise
```
---
### 2. Configurar Variáveis de Ambiente
Crie um arquivo .env na raiz (ou configure no painel da Vercel) com as chaves:
```bash
DATABASE_URL=postgres://usuario:senha@host-do-banco.net/neondb...
CLOUD_NAME=seu_cloud_name
API_KEY=sua_api_key
API_SECRET=sua_api_secret
```
---
### 3. Instalar Dependências
```bash
pip install -r requirements.txt
```
Conteúdo do `requirements.txt`:
```bash
Flask==3.0.0
psycopg2-binary==2.9.9
Werkzeug==3.0.0
cloudinary==1.36.0
```
---
### 4. Executar Localmente
```bash
python app.py
```
Acesse:
* **Gestor:** `http://localhost:5000/`
* **Operador:** `http://localhost:5000/operador`
### 5. Inicialização do Banco (Primeiro Uso)

Ao subir para a Vercel ou rodar pela primeira vez com um banco vazio, acesse a rota de inicialização para criar as tabelas:https://seu-projeto.vercel.app/init_db

---
## ☁️ Deploy na Vercel

O projeto já contém o arquivo `vercel.json` configurado.

1. Suba o código para o GitHub.
2. Importe o projeto na Vercel.
3. Nas configurações do projeto na Vercel, adicione as **Environment Variables** (`DATABASE_URL`, `CLOUD_NAME`, `API_KEY`, `API_SECRET`).
4. Faça o Deploy.
5. Acesse a rota `/init_db` na URL de produção uma única vez.

---

## 📂 Estrutura do Projeto

```text
maprix-enterprise/
│
├── app.py                # Backend Flask (API REST, Conexão Postgres, Lógica Cloudinary)
├── requirements.txt      # Dependências (Flask, psycopg2, cloudinary, etc)
├── vercel.json           # Configuração de Deploy Serverless
│
├── static/
│   ├── css/
│   │   ├── style.css     # Estilos do Painel Gestor (Dark/Gold)
│   │   └── operador.css  # Estilos Mobile do Operador
│   │
│   └── js/
│       ├── mapa.js       # Lógica Gestor (Leaflet, Gráficos, CRUD)
│       └── operador.js   # Lógica Mobile (GPS, Checklist Dinâmico, Sync)
│
└── templates/
    ├── index.html        # Dashboard do Gestor
    └── operador.html     # App do Operador
```
## ⚠️ Notas de Deploy (Vercel)
* **Persistência:** O sistema foi adaptado para não salvar arquivos locais (como imagens ou SQLite) na pasta do servidor, pois a Vercel possui sistema de arquivos efêmero. Tudo é salvo no **PostgreSQL** ou **Cloudinary**.
* **Backup:** Utilize a função de "Baixar JSON" no painel do gestor para backups completos. O arquivo `.db` antigo não é mais utilizado.


