import os
import shutil
import tempfile
import traceback
from typing import Optional
from pydantic import BaseModel
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import database

app = FastAPI(
    title="Financial Fraud Network Tracer API",
    description="Enterprise Backend API with DuckDB OLAP Columnar Engine & Recursive Tracing",
    version="1.2.0",
)

# Configure CORS for local development
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "*",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    """Ensure DuckDB schema is initialized on server startup."""
    database.init_db()


@app.get("/")
def read_root():
    return {
        "status": "ok",
        "app": "Financial Fraud Network Tracer API",
        "version": "1.2.0",
        "endpoints": {
            "health": "/api/health",
            "upload": "/api/upload",
            "transactions": "/api/transactions?page=1&limit=50",
            "trace": "/api/trace/{victim_id}",
            "stats": "/api/stats",
        },
    }


@app.get("/api/health")
def health_check():
    db_info = database.get_table_info()
    return {
        "status": "healthy",
        "service": "fraud-tracer-backend",
        "database": {
            "engine": "DuckDB",
            "table": "transactions",
            "rows_loaded": db_info.get("row_count", 0),
        },
    }


@app.get("/api/stats")
def get_stats():
    """Returns current transaction status and high-level metrics."""
    info = database.get_table_info()
    return {
        "status": "ok",
        "transactions_loaded": info.get("row_count", 0) > 0,
        "row_count": info.get("row_count", 0),
        "stats": info.get("stats", {}),
    }


@app.get("/api/suspicious")
@app.get("/suspicious")
def get_suspicious(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    limit: int = Query(50, ge=1, le=500, description="Items per page"),
    search: Optional[str] = Query(None, description="Optional search filter for account, device, or IP"),
):
    """
    Auto-detects flagged suspicious money laundering hub accounts with pagination.
    Analyzes device anomalies, IP anomalies, structuring threshold evasion, and nocturnal timing.
    """
    try:
        result = database.get_suspicious_accounts(page=page, limit=limit, search=search)
        return {
            "status": "ok",
            "total_rows": result["total_rows"],
            "page": result["page"],
            "limit": result["limit"],
            "total_pages": result["total_pages"],
            "data": result["data"],
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to detect suspicious accounts: {str(e)}")


@app.get("/api/transactions")
def get_transactions(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    limit: int = Query(50, ge=1, le=500, description="Items per page"),
):
    """
    Returns paginated transactions from DuckDB using LIMIT and OFFSET.
    Prevents browser crashes on massive datasets (e.g. 2,000,000+ rows).
    """
    try:
        result = database.get_transactions_paginated(page=page, limit=limit)
        return {
            "status": "ok",
            "total_rows": result["total_rows"],
            "page": result["page"],
            "limit": result["limit"],
            "total_pages": result["total_pages"],
            "data": result["data"],
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to query transactions: {str(e)}")


@app.get("/api/trace/{victim_id}")
@app.get("/trace/{victim_id}")
def trace_victim(victim_id: str):
    """
    Executes 3-hop recursive CTE from victim account to discover money muling layers.
    Returns strictly formatted graph payload:
      - nodes: [{ id: string, group: number }] (0=Victim, 1=L1, 2=L2, 3=L3)
      - links: [{ source: string, target: string, amount: float, timestamp: string, hop: number }]
    """
    clean_id = victim_id.strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail="Victim Account ID cannot be empty.")

    try:
        result = database.trace_victim_network(clean_id)

        if result.get("status") == "error":
            error_code = result.get("error_code")
            if error_code == "ACCOUNT_NOT_FOUND":
                raise HTTPException(status_code=404, detail=result["message"])
            elif error_code in ["EMPTY_DATABASE", "TABLE_NOT_FOUND"]:
                raise HTTPException(status_code=400, detail=result["message"])
            else:
                raise HTTPException(status_code=400, detail=result["message"])

        return result

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Internal error executing recursive trace: {str(e)}",
        )


@app.post("/api/upload")
@app.post("/upload")
async def upload_csv(file: UploadFile = File(...)):
    """
    Accepts CSV file upload, saves temporarily, executes DuckDB read_csv_auto()
    with dynamic column standardization, deletes temp file, and returns row count and metadata.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{file.filename}'. Only CSV files are supported.",
        )

    temp_file_path = None
    try:
        suffix = os.path.splitext(file.filename)[1] or ".csv"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file_path = temp_file.name
            shutil.copyfileobj(file.file, temp_file)

        if os.path.getsize(temp_file_path) == 0:
            raise HTTPException(
                status_code=400,
                detail="The uploaded CSV file is empty.",
            )

        result = database.ingest_csv(temp_file_path)

        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "message": f"Successfully ingested {result['row_count']:,} transactions in {result.get('elapsed_sec', 0)}s",
                "filename": file.filename,
                "rows_ingested": result["row_count"],
                "elapsed_sec": result.get("elapsed_sec", 0),
                "columns": result.get("columns", []),
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to ingest CSV into DuckDB: {str(e)}",
        )
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as cleanup_err:
                print(f"Warning: Failed to delete temp file {temp_file_path}: {cleanup_err}")


@app.delete("/api/reset")
@app.post("/api/reset")
def reset_database():
    """Clear Space: Drops the transactions table and caches to free up memory."""
    try:
        return database.reset_db()
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to reset database: {str(e)}")


class GenerateNoticeRequest(BaseModel):
    account_id: str
    bank_name: str
    amount: float


class AIChatRequest(BaseModel):
    message: str
    account_id: Optional[str] = None


@app.get("/api/top-suspect")
def get_top_suspect():
    """
    Returns the highest risk suspect account from DuckDB for proactive AI scanning.
    """
    try:
        suspect = database.get_top_suspect()
        if not suspect:
            return {"status": "empty", "suspect": None}
        return {"status": "ok", "suspect": suspect}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to fetch top suspect: {str(e)}")


@app.post("/api/ai-chat")
def ai_chat(req: AIChatRequest):
    """
    Interactive Cyber Forensics AI Chat Assistant.
    Parses account ID, fetches comprehensive DuckDB summary, queries Ollama (qwen2.5:1.5b),
    and returns risk analysis and investigative next steps.
    """
    import re
    import requests

    msg = req.message.strip()
    target_account = req.account_id.strip() if req.account_id else None

    # Parse account ID from message text if not explicitly supplied
    if not target_account:
        # Match alphanumeric tokens like KKBK10000405
        tokens = re.findall(r'\b[A-Za-z0-9_]{6,25}\b', msg)
        stop_words = {"analyze", "victim", "account", "suspect", "freeze", "notice", "investigate", "report", "please", "thanks", "status", "detail", "details", "check", "urgent"}
        for t in tokens:
            if t.lower() not in stop_words and any(c.isdigit() for c in t):
                target_account = t.strip()
                break

    # If still no account, check if asking about highest risk or top suspect
    if not target_account and any(k in msg.lower() for k in ["highest", "top", "mule", "risk", "scan", "suspect"]):
        top = database.get_top_suspect()
        if top:
            target_account = top["account"]

    summary = None
    if target_account:
        summary = database.get_account_forensic_summary(target_account)

    # If an account is identified and summarized in DuckDB
    if summary and summary.get("found"):
        summary_data = (
            f"Target Account: {summary['account']}\n"
            f"Risk Score: {summary['risk_score']}% (Capped at 99%)\n"
            f"Total Inflow Received: ${summary['total_in']:,.2f} across {summary['in_count']} transactions ({summary['unique_senders']} unique senders)\n"
            f"Total Outflow Dispersed: ${summary['total_out']:,.2f} across {summary['out_count']} transactions ({summary['unique_receivers']} unique receivers)\n"
            f"Wash Ratio: {summary['wash_ratio']}%\n"
            f"Associated IPs: {summary['ips']}\n"
            f"Hardware / Devices: {summary['devices']}\n"
            f"Timestamp Inflow Window: {summary['min_in_ts']} to {summary['max_in_ts']}\n"
            f"Timestamp Outflow Window: {summary['min_out_ts']} to {summary['max_out_ts']}"
        )

        prompt = (
            f"You are a cyber forensics AI. Based on this transaction summary: {summary_data}, "
            f"what are the potential risks and next steps for investigation?"
        )

        ai_response_text = None
        source_label = "forensic_engine"

        # Try local Ollama
        try:
            ollama_url = "http://localhost:11434/api/generate"
            ollama_payload = {
                "model": "qwen2.5:1.5b",
                "prompt": prompt,
                "stream": False,
            }
            res = requests.post(ollama_url, json=ollama_payload, timeout=20)
            if res.status_code == 200:
                data = res.json()
                reply = data.get("response", "").strip()
                if reply:
                    ai_response_text = reply
                    source_label = "ollama (qwen2.5:1.5b)"
        except Exception:
            pass

        # Statutory Forensic Engine Fallback if Ollama is not active
        if not ai_response_text:
            ai_response_text = (
                f"**CYBER FORENSICS INTELLIGENCE ASSESSMENT**\n\n"
                f"**Target Entity:** `{summary['account']}` | **Risk Rating:** **{summary['risk_score']}%** (CRITICAL)\n\n"
                f"**1. Core Forensic Risks Identified:**\n"
                f"• **High-Velocity Pass-Through:** Account exhibits a **{summary['wash_ratio']}% wash ratio**, receiving ${summary['total_in']:,.2f} across {summary['in_count']} inbound transfers and immediately dispersing ${summary['total_out']:,.2f} across {summary['out_count']} outbound transactions. This high-velocity throughput is consistent with a specialized mule aggregation hub.\n"
                f"• **Structuring & Layering:** Inbound funds are fragmented and distributed among {summary['unique_receivers']} distinct downstream recipients, indicating smurfing techniques designed to circumvent mandatory AML threshold alerts.\n"
                f"• **Virtualization & Geo-Anomalies:** Telemetry traces to `{summary['devices']}` originating from IP `{summary['primary_ip']}`, suggesting automated scripting / emulator signatures and proxy redirection.\n\n"
                f"**2. Recommended Next Steps for Investigation:**\n"
                f"1. **Statutory Freezing Order:** Issue an immediate Section 91 CrPC notice to freeze Account `{summary['account']}` before funds complete downstream cash-out.\n"
                f"2. **3-Hop Directional Traversal:** Expand the visual money trail graph to identify Layer 2 and Layer 3 beneficiary terminals.\n"
                f"3. **Bank Dossier Requisition:** Requisition certified KYC records, Account Opening Forms (AOF), linked UPI VPA handles, and biometric authentication logs from the branch manager."
            )

        amount_val = summary["total_in"] if summary["total_in"] > 0 else summary["total_out"]
        return {
            "status": "success",
            "account_id": summary["account"],
            "response": ai_response_text,
            "summary": summary,
            "source": source_label,
            "suggested_actions": [
                {
                    "type": "freeze_notice",
                    "label": f"Draft Sec 91 Notice ({summary['account']})",
                    "account_id": summary["account"],
                    "bank_name": "Beneficiary Bank",
                    "amount": amount_val if amount_val > 0 else 50000.0,
                },
                {
                    "type": "trace_graph",
                    "label": f"Trace Network ({summary['account']})",
                    "account_id": summary["account"],
                },
            ],
        }

    # General questions or proactive assistant responses
    top = database.get_top_suspect()
    top_acc = top["account"] if top else "KKBK10000405"
    top_score = top["risk_score"] if top else 99

    general_prompt = (
        f"You are a cyber forensics AI. A financial crime investigator asks: '{msg}'. "
        f"Context: The highest risk flagged account in current ledger is {top_acc} with a {top_score}% risk score. "
        f"Keep your response concise, professional, and action-oriented."
    )

    general_text = None
    try:
        res = requests.post("http://localhost:11434/api/generate", json={"model": "qwen2.5:1.5b", "prompt": general_prompt, "stream": False}, timeout=15)
        if res.status_code == 200:
            general_text = res.json().get("response", "").strip()
    except Exception:
        pass

    if not general_text:
        general_text = (
            f"I have scanned the active ledger. Flagged account `{top_acc}` shows a **{top_score}% risk** "
            f"of being an active money mule hub due to rapid off-hour transfers and proxy signatures. "
            f"Would you like me to generate a Section 91 CrPC freeze notice or trace its 3-hop money trail?"
        )

    return {
        "status": "success",
        "account_id": top_acc,
        "response": general_text,
        "summary": None,
        "source": "forensic_engine",
        "suggested_actions": [
            {
                "type": "freeze_notice",
                "label": f"Draft Sec 91 Notice ({top_acc})",
                "account_id": top_acc,
                "bank_name": "Beneficiary Bank",
                "amount": top["total_in"] if top and top.get("total_in") else 245000.0,
            },
            {
                "type": "trace_graph",
                "label": f"Trace Network ({top_acc})",
                "account_id": top_acc,
            },
        ],
    }


@app.post("/api/generate-notice")
@app.post("/generate-notice")
def generate_notice(req: GenerateNoticeRequest):
    """
    Generates a formal Section 91 CrPC freezing notice using local Ollama AI (qwen2.5:1.5b).
    Makes an HTTP POST request to http://localhost:11434/api/generate.
    Falls back gracefully if Ollama is not running.
    """
    clean_account = req.account_id.strip()
    clean_bank = req.bank_name.strip()
    formatted_amount = f"{float(req.amount):,.2f}"

    prompt = (
        f"You are a legal assistant. Write a formal Section 91 CrPC notice to the Branch Manager "
        f"of {clean_bank} requesting the immediate freezing of account number {clean_account} "
        f"which has received suspected fraudulent funds totaling ${formatted_amount}. "
        f"Keep it professional, objective, and brief. Do not invent any additional names, dates, or details."
    )

    ollama_url = "http://localhost:11434/api/generate"
    ollama_payload = {
        "model": "qwen2.5:1.5b",
        "prompt": prompt,
        "stream": False,
    }

    try:
        import requests
        res = requests.post(ollama_url, json=ollama_payload, timeout=20)
        if res.status_code == 200:
            data = res.json()
            notice_text = data.get("response", "").strip()
            if notice_text:
                return {
                    "status": "success",
                    "notice": notice_text,
                    "account_id": clean_account,
                    "bank_name": clean_bank,
                    "amount": req.amount,
                    "source": "ollama",
                    "model": "qwen2.5:1.5b",
                }
    except Exception as ollama_err:
        print(f"Ollama local inference unavailable or timed out ({ollama_err}), using legal fallback template.")

    # Statutory Section 91 CrPC fallback template if local Ollama service is not running
    fallback_text = (
        f"OFFICE OF THE INVESTIGATING OFFICER\n"
        f"CYBER CRIME POLICE STATION & FINANCIAL FRAUD INVESTIGATION CELL\n"
        f"NOTICE UNDER SECTION 91 OF THE CODE OF CRIMINAL PROCEDURE (CrPC), 1973\n\n"
        f"To,\n"
        f"The Branch Manager,\n"
        f"{clean_bank}\n\n"
        f"SUBJECT: URGENT NOTICE UNDER SECTION 91 CrPC FOR IMMEDIATE FREEZING OF ACCOUNT NO. {clean_account}\n\n"
        f"Sir / Madam,\n\n"
        f"1. Whereas an ongoing investigation into cyber-enabled banking fraud reveals that fraudulent proceeds of crime totaling ${formatted_amount} have been traced directly into beneficiary Account Number {clean_account} maintained at your branch.\n\n"
        f"2. In exercise of powers conferred under Section 91 of the Code of Criminal Procedure, 1973, you are hereby directed to:\n"
        f"   a. Place an immediate and total debit freeze on account number {clean_account} with immediate effect.\n"
        f"   b. Restrict all outgoing debits, ATM withdrawals, RTGS/NEFT/IMPS transfers, internet banking, and UPI channels.\n"
        f"   c. Furnish certified copies of Account Opening Form (AOF), KYC documents, IP/MAC transaction logs, and full statement of account from inception to date within 24 hours of receipt of this notice.\n\n"
        f"3. Compliance with this statutory order is mandatory. Failure to comply shall attract penal proceedings under Sections 175 and 188 of the Indian Penal Code, 1860.\n\n"
        f"Yours faithfully,\n\n"
        f"Investigating Officer\n"
        f"Cyber Crime & Financial Forensics Cell"
    )

    return {
        "status": "success",
        "notice": fallback_text,
        "account_id": clean_account,
        "bank_name": clean_bank,
        "amount": req.amount,
        "source": "legal_template",
        "model": "qwen2.5:1.5b",
    }

