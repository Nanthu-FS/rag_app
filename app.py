import os
import tempfile
import streamlit as st

from langchain_ollama import OllamaLLM, OllamaEmbeddings
from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader, TextLoader, Docx2txtLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough

CHROMA_DIR = "./chroma_db"

st.set_page_config(page_title="RAG Chat", page_icon="◆", layout="wide")

st.markdown("""
<style>
/* ── Design tokens ─────────────────────────────────────────────────────── */
:root {
    --bg: #0e0e14;
    --surface: #16161f;
    --surface-2: #1c1c28;
    --border: #2a2a3a;
    --border-soft: #232331;
    --text: #e4e4ef;
    --text-muted: #9a9ab0;
    --accent: #7c6cff;
    --accent-soft: rgba(124, 108, 255, 0.12);
    --radius: 14px;
    --radius-sm: 10px;
}

/* ── Base typography ───────────────────────────────────────────────────── */
html, body, [class*="css"] {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: -0.01em;
}

.stApp {
    background:
        radial-gradient(900px 500px at 12% -8%, rgba(124, 108, 255, 0.10), transparent 60%),
        radial-gradient(800px 500px at 100% 0%, rgba(80, 160, 255, 0.06), transparent 55%),
        var(--bg);
}

/* ── App header ────────────────────────────────────────────────────────── */
.app-header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 0 4px;
}
.app-mark {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--accent), #5b8def);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: white;
    box-shadow: 0 8px 24px rgba(124, 108, 255, 0.35);
}
.app-title {
    font-size: 1.55rem;
    font-weight: 700;
    margin: 0;
    line-height: 1.1;
    color: var(--text);
}
.app-sub {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-top: 2px;
}

/* ── Meta chips ────────────────────────────────────────────────────────── */
.meta-row { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0 6px; }
.chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--surface);
    border: 1px solid var(--border-soft);
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 0.76rem;
    color: var(--text-muted);
}
.chip b { color: var(--text); font-weight: 600; }
.chip-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--accent);
}

/* ── Sidebar ───────────────────────────────────────────────────────────── */
section[data-testid="stSidebar"] {
    background: var(--surface);
    border-right: 1px solid var(--border-soft);
}
section[data-testid="stSidebar"] .stSelectbox label,
section[data-testid="stSidebar"] .stSlider label,
section[data-testid="stSidebar"] .stFileUploader label {
    font-size: 0.78rem !important;
    color: var(--text-muted) !important;
    font-weight: 500;
}
.sidebar-heading {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 4px 0 2px;
}
.sidebar-brand {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 4px;
}
.sidebar-brand .dot {
    width: 9px; height: 9px; border-radius: 3px;
    background: linear-gradient(135deg, var(--accent), #5b8def);
}

/* ── Buttons ───────────────────────────────────────────────────────────── */
.stButton > button {
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    font-weight: 500;
    font-size: 0.82rem;
    transition: all 0.15s ease;
}
.stButton > button:hover {
    border-color: var(--accent);
    color: white;
    background: var(--accent-soft);
}
.stButton > button[kind="primary"] {
    background: linear-gradient(135deg, var(--accent), #5b8def);
    border: none;
    color: white;
}
.stButton > button[kind="primary"]:hover {
    filter: brightness(1.08);
}

/* ── File uploader ─────────────────────────────────────────────────────── */
section[data-testid="stFileUploaderDropzone"] {
    background: var(--surface-2);
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
}

/* ── Status pills ──────────────────────────────────────────────────────── */
.status-ok {
    display: flex; align-items: center; gap: 8px;
    background: rgba(60, 200, 130, 0.10);
    border: 1px solid rgba(60, 200, 130, 0.30);
    color: #67e0a3;
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    font-size: 0.8rem;
    font-weight: 500;
}
.status-ok .ring {
    width: 8px; height: 8px; border-radius: 50%;
    background: #67e0a3;
    box-shadow: 0 0 0 3px rgba(103, 224, 163, 0.20);
}
.doc-pill {
    display: flex; align-items: center; gap: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border-soft);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 0.76rem;
    color: var(--text-muted);
    margin-top: 6px;
}
.doc-pill .file-tag {
    font-size: 0.62rem; font-weight: 700;
    color: var(--accent);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 1px 5px;
    letter-spacing: 0.04em;
}

/* ── Empty state ───────────────────────────────────────────────────────── */
.empty-state {
    text-align: center;
    padding: 48px 24px;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius);
    background: linear-gradient(180deg, var(--surface), transparent);
    margin-top: 24px;
}
.empty-state .es-mark {
    width: 56px; height: 56px; border-radius: 16px;
    background: var(--accent-soft);
    border: 1px solid var(--border);
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--accent); font-size: 24px;
    margin-bottom: 16px;
}
.empty-state h3 { color: var(--text); font-weight: 600; margin: 0 0 6px; }
.empty-state p { color: var(--text-muted); font-size: 0.88rem; margin: 0; }

/* ── Chat messages ─────────────────────────────────────────────────────── */
[data-testid="stChatMessage"] {
    background: var(--surface);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius);
    padding: 4px 6px;
}

/* ── Sources ───────────────────────────────────────────────────────────── */
.source-box {
    background: var(--surface-2);
    border: 1px solid var(--border-soft);
    border-left: 2px solid var(--accent);
    border-radius: var(--radius-sm);
    padding: 12px 14px;
    font-size: 0.82rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin-top: 8px;
}
.source-title {
    color: var(--text);
    font-weight: 600;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.source-title .page-tag {
    font-size: 0.68rem;
    font-weight: 500;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: 5px;
    padding: 1px 7px;
}

/* ── Chat input ────────────────────────────────────────────────────────── */
[data-testid="stChatInput"] {
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
}

#MainMenu, footer { visibility: hidden; }
</style>
""", unsafe_allow_html=True)


# ── session state ────────────────────────────────────────────────────────────

def init_state():
    defaults = {
        "messages": [],
        "vectorstore": None,
        "docs_loaded": False,
        "doc_names": [],
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v

init_state()


# ── helpers ──────────────────────────────────────────────────────────────────

def load_document(uploaded_file) -> list:
    suffix = os.path.splitext(uploaded_file.name)[1].lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(uploaded_file.read())
        tmp_path = tmp.name
    try:
        if suffix == ".pdf":
            loader = PyPDFLoader(tmp_path)
        elif suffix == ".txt":
            loader = TextLoader(tmp_path, encoding="utf-8")
        elif suffix in (".docx", ".doc"):
            loader = Docx2txtLoader(tmp_path)
        else:
            st.error(f"Unsupported file type: {suffix}")
            return []
        return loader.load()
    finally:
        os.unlink(tmp_path)


def build_vectorstore(docs: list, embed_model: str) -> Chroma:
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    chunks = splitter.split_documents(docs)
    embeddings = OllamaEmbeddings(model=embed_model)
    return Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=CHROMA_DIR,
    )


def load_existing_vectorstore(embed_model: str) -> Chroma | None:
    if os.path.exists(CHROMA_DIR):
        embeddings = OllamaEmbeddings(model=embed_model)
        vs = Chroma(persist_directory=CHROMA_DIR, embedding_function=embeddings)
        if vs._collection.count() > 0:
            return vs
    return None


def make_chain(vectorstore: Chroma, llm_model: str, top_k: int):
    retriever = vectorstore.as_retriever(search_kwargs={"k": top_k})
    llm = OllamaLLM(model=llm_model, temperature=0.1)

    prompt = ChatPromptTemplate.from_template("""You are a helpful assistant. Answer the question using ONLY the provided context.
If the answer is not in the context, say "I don't have enough information to answer that."

Context:
{context}

Question: {question}

Answer:""")

    def format_docs(docs):
        return "\n\n".join(d.page_content for d in docs)

    chain = (
        {"context": retriever | format_docs, "question": RunnablePassthrough()}
        | prompt
        | llm
        | StrOutputParser()
    )
    return chain, retriever


def render_sources(sources: list):
    for src in sources:
        st.markdown(
            f'<div class="source-box"><div class="source-title">'
            f'<span>{src["source"]}</span>'
            f'<span class="page-tag">page {src.get("page", "?")}</span></div>'
            f'{src["snippet"]}</div>',
            unsafe_allow_html=True,
        )


# ── sidebar ──────────────────────────────────────────────────────────────────

with st.sidebar:
    st.markdown(
        '<div class="sidebar-brand"><span class="dot"></span>RAG Workspace</div>',
        unsafe_allow_html=True,
    )

    st.markdown('<div class="sidebar-heading">Models</div>', unsafe_allow_html=True)
    llm_model = st.selectbox(
        "LLM Model",
        ["llama3.2:3b", "llama3:latest", "mistral-small3.2:24b"],
        index=0,
    )
    embed_model = st.selectbox(
        "Embedding Model",
        ["nomic-embed-text:latest"],
        index=0,
    )
    top_k = st.slider("Retrieved chunks (top-k)", 1, 8, 4)

    st.divider()
    st.markdown('<div class="sidebar-heading">Documents</div>', unsafe_allow_html=True)

    uploaded_files = st.file_uploader(
        "Upload files",
        type=["pdf", "txt", "docx"],
        accept_multiple_files=True,
        help="PDF, TXT, or DOCX files",
    )

    if st.button("Ingest Documents", use_container_width=True, type="primary", disabled=not uploaded_files):
        all_docs = []
        progress = st.progress(0, text="Loading files…")
        for i, f in enumerate(uploaded_files):
            docs = load_document(f)
            if docs:
                for d in docs:
                    d.metadata["source"] = f.name
                all_docs.extend(docs)
                progress.progress((i + 1) / len(uploaded_files), text=f"Loaded {f.name}")

        if all_docs:
            with st.spinner("Building vector index…"):
                st.session_state.vectorstore = build_vectorstore(all_docs, embed_model)
                st.session_state.docs_loaded = True
                st.session_state.doc_names = list({f.name for f in uploaded_files})
            progress.empty()
            st.success(f"Indexed {len(all_docs)} pages from {len(uploaded_files)} file(s)")

    # try loading persisted store if none in session
    if not st.session_state.vectorstore:
        vs = load_existing_vectorstore(embed_model)
        if vs:
            st.session_state.vectorstore = vs
            st.session_state.docs_loaded = True

    if st.session_state.docs_loaded:
        st.markdown(
            '<div class="status-ok"><span class="ring"></span>Vector store ready</div>',
            unsafe_allow_html=True,
        )
        if st.session_state.doc_names:
            for name in st.session_state.doc_names:
                ext = os.path.splitext(name)[1].lstrip(".").upper() or "DOC"
                st.markdown(
                    f'<div class="doc-pill"><span class="file-tag">{ext}</span>{name}</div>',
                    unsafe_allow_html=True,
                )

    st.divider()
    col1, col2 = st.columns(2)
    with col1:
        if st.button("Clear chat", use_container_width=True):
            st.session_state.messages = []
            st.rerun()
    with col2:
        if st.button("Reset index", use_container_width=True):
            st.session_state.vectorstore = None
            st.session_state.docs_loaded = False
            st.session_state.doc_names = []
            st.session_state.messages = []
            if os.path.exists(CHROMA_DIR):
                import shutil
                shutil.rmtree(CHROMA_DIR)
            st.rerun()


# ── main chat ────────────────────────────────────────────────────────────────

st.markdown(
    '<div class="app-header">'
    '<div class="app-mark">◆</div>'
    '<div><div class="app-title">RAG Chat</div>'
    '<div class="app-sub">Ask questions grounded in your documents</div></div>'
    '</div>',
    unsafe_allow_html=True,
)

st.markdown(
    '<div class="meta-row">'
    f'<span class="chip"><span class="chip-dot"></span>LLM&nbsp;<b>{llm_model}</b></span>'
    f'<span class="chip">Embeddings&nbsp;<b>{embed_model}</b></span>'
    f'<span class="chip">Top-k&nbsp;<b>{top_k}</b></span>'
    '</div>',
    unsafe_allow_html=True,
)

if not st.session_state.docs_loaded:
    st.markdown(
        '<div class="empty-state">'
        '<div class="es-mark">◆</div>'
        '<h3>No documents indexed yet</h3>'
        '<p>Upload files in the sidebar and click Ingest Documents to begin.</p>'
        '</div>',
        unsafe_allow_html=True,
    )

for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])
        if msg.get("sources"):
            with st.expander("Sources", expanded=False):
                render_sources(msg["sources"])

if prompt := st.chat_input("Ask something about your documents…", disabled=not st.session_state.docs_loaded):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        placeholder = st.empty()
        placeholder.markdown("_Thinking…_")

        chain, retriever = make_chain(st.session_state.vectorstore, llm_model, top_k)

        # stream response
        full_response = ""
        for chunk in chain.stream(prompt):
            full_response += chunk
            placeholder.markdown(full_response + "▌")
        placeholder.markdown(full_response)

        # collect source metadata
        source_docs = retriever.invoke(prompt)
        sources = []
        seen = set()
        for doc in source_docs:
            key = (doc.metadata.get("source", ""), doc.page_content[:80])
            if key not in seen:
                seen.add(key)
                sources.append({
                    "source": doc.metadata.get("source", "unknown"),
                    "page": doc.metadata.get("page", "?"),
                    "snippet": doc.page_content[:300] + ("…" if len(doc.page_content) > 300 else ""),
                })

        if sources:
            with st.expander("Sources", expanded=False):
                render_sources(sources)

    st.session_state.messages.append({
        "role": "assistant",
        "content": full_response,
        "sources": sources,
    })
