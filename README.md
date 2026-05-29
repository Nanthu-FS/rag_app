# RAG Chat

A local, privacy-friendly **Retrieval-Augmented Generation** chat app. Upload PDF, TXT, or DOCX files, build a vector index, and ask questions grounded in your documents — answered with cited sources. Everything runs locally via [Ollama](https://ollama.com); no data leaves your machine and no API keys are required.

Built with [Streamlit](https://streamlit.io), [LangChain](https://www.langchain.com), and [Chroma](https://www.trychroma.com).

## Features

- 📄 Ingest **PDF, TXT, and DOCX** files (multiple at once)
- 🔍 Semantic retrieval over your documents with a persistent Chroma vector store
- 💬 Streaming chat responses grounded strictly in retrieved context
- 📌 Inline **source citations** (file name, page, and snippet) for every answer
- ⚙️ Switch LLM / embedding models and tune top-k retrieval from the sidebar
- 🔒 Fully local — powered by Ollama, no external services

## Prerequisites

- **Python 3.10+**
- **[Ollama](https://ollama.com)** installed and running

Pull the models used by the app (defaults shown):

```bash
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

You can also use `llama3:latest` or `mistral-small3.2:24b` — just select them in the sidebar (and pull them first).

## Setup

```bash
git clone https://github.com/Nanthu-FS/rag_app.git
cd rag_app

python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

## Running

Make sure Ollama is running, then start the app:

```bash
streamlit run app.py
```

On Windows you can also just double-click **`run.bat`**.

The app opens at <http://localhost:8501>.

## Usage

1. In the sidebar, choose your **LLM** and **embedding** models and the number of chunks to retrieve (top-k).
2. Upload one or more documents and click **Ingest Documents**.
3. Once the vector store is ready, ask questions in the chat box.
4. Expand **Sources** under any answer to see the cited passages.

Use **Clear chat** to reset the conversation, or **Reset index** to delete the vector store and start fresh.

## How it works

1. Documents are loaded and split into ~800-character chunks (100-char overlap).
2. Chunks are embedded with an Ollama embedding model and stored in a persistent Chroma database (`./chroma_db`).
3. On each question, the top-k most relevant chunks are retrieved and passed as context to the LLM.
4. The model answers **only** from the provided context, or says it doesn't have enough information.

## Notes

- The `chroma_db/` index is generated locally and is **not** tracked in git.
- No API keys or secrets are used — all inference is local via Ollama.
