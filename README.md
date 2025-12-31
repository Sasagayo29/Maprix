# 🌍 MAPRIX Enterprise

![Status do Projeto](https://img.shields.io/badge/Status-Em_Desenvolvimento-yellow)
![Python](https://img.shields.io/badge/Backend-Flask-blue)
![Frontend](https://img.shields.io/badge/Frontend-LeafletJS_%2B_HTML5-green)
![Database](https://img.shields.io/badge/Database-SQLite-lightgrey)

**MAPRIX Enterprise** é uma solução completa de **Gestão de Frota e Georreferenciamento Industrial**. O sistema permite o monitoramento em tempo real de ativos móveis (caminhões, escavadeiras, veículos leves), criação de cercas virtuais (Geofencing) e oferece uma interface mobile-first robusta para operadores de campo, com suporte a funcionamento offline.

---

## 📸 Screenshots


| Painel do Gestor (Desktop) | Visão do Operador (Mobile) |
|:--------------------------:|:--------------------------:|
| <img width="1233" height="990" alt="image" src="https://github.com/user-attachments/assets/bfdc1348-4ff8-43bd-b3ac-5e88740e7378" />| <img width="412" height="911" alt="image" src="https://github.com/user-attachments/assets/e27b0c56-5c30-40fa-ba92-90bf5ee99fb9" />|

---

## 🚀 Funcionalidades Principais

### 🏢 Módulo Gestor (Web Desktop)
* **Monitoramento em Tempo Real:** Visualização de todos os ativos no mapa.
* **Timeline de Rastreamento:** Filtre por equipamento e veja o histórico de trajeto com linhas do tempo interativas.
* **Geofencing (Cercas Virtuais):**
    * Ferramenta de desenho no mapa (Polígonos).
    * Edição de geometria (arrastar nós) e exclusão.
    * Atribuição de cores e nomes para áreas (Ex: "Mina Sul", "Pátio").
* **Gestão de Cadastros (CRUD Completo):**
    * Cadastro de **Tipos de Equipamento** (Dinâmico).
    * Cadastro de **Frota/Ativos** com cores personalizadas.
* **Backup & Restore:**
    * Download do banco de dados completo (`.db`).
    * Restauração do sistema via upload de arquivo.
    * Exportação de dados históricos para CSV.
* **Regiões Salvas:** Salve coordenadas e níveis de zoom (Ex: "Visão Geral", "Oficina") para navegação rápida.

### 👷 Módulo Operador (Mobile Web App)
* **Interface Mobile-First:** Design otimizado para celulares, com botões grandes e prevenção de zoom indesejado.
* **Busca Inteligente:** Autocomplete para selecionar equipamentos cadastrados.
* **Auto-Cadastro:** Detecção automática de novos ativos não cadastrados.
* **Modo Offline (Sync):**
    * Armazena registros localmente quando sem internet.
    * Sincronização automática ou manual quando a conexão é restabelecida.
* **GPS de Alta Precisão:** Captura latitude/longitude com carimbo de tempo.

---

## 🛠️ Tecnologias Utilizadas

* **Backend:** Python 3, Flask.
* **Banco de Dados:** SQLite (Nativo, leve e rápido).
* **Frontend:**
    * HTML5 / CSS3 (Variáveis CSS, Flexbox, Grid).
    * JavaScript (ES6+).
* **Mapas:** Leaflet.js (OpenStreetMap e Satélite ESRI).
* **Plugins:** Leaflet.Draw (para desenhar áreas).
* **Ícones:** FontAwesome 6.

---

## 📦 Instalação e Execução

Siga os passos abaixo para rodar o projeto localmente:

### Pré-requisitos
* Python 3.x instalado.

### Passo a Passo

1.  **Clone o repositório:**
    ```bash
    git clone [https://github.com/seu-usuario/maprix-enterprise.git](https://github.com/seu-usuario/maprix-enterprise.git)
    cd maprix-enterprise
    ```

2.  **Crie um ambiente virtual (Opcional, mas recomendado):**
    ```bash
    python -m venv venv
    # Windows
    venv\Scripts\activate
    # Linux/Mac
    source venv/bin/activate
    ```

3.  **Instale as dependências:**
    ```bash
    pip install flask
    ```

4.  **Execute a aplicação:**
    ```bash
    python app.py
    ```
    *O banco de dados `equipamentos.db` será criado automaticamente na primeira execução.*

5.  **Acesse no navegador:**
    * **Gestor:** `http://localhost:5000/mapa`
    * **Operador:** `http://localhost:5000/operador` (Para testar o visual mobile, use o DevTools do navegador em modo dispositivo ou acesse pelo celular na mesma rede Wi-Fi).

---

## 📂 Estrutura do Projeto

```text
maprix-enterprise/
│
├── app.py                # Cérebro do Backend (Rotas, API, Banco de Dados)
├── equipamentos.db       # Banco de Dados SQLite (Gerado automaticamente)
│
├── static/
│   ├── css/
│   │   ├── style.css     # Estilos do Gestor (Dark/Gold Enterprise)
│   │   └── operador.css  # Estilos do Operador (Mobile UX)
│   │
│   └── js/
│       ├── mapa.js       # Lógica do Gestor (Leaflet, CRUD, Backup)
│       └── operador.js   # Lógica do Operador (GPS, Offline Sync)
│
└── templates/
    ├── index.html        # Interface do Gestor
    └── operador.html     # Interface do Operador
