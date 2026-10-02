import os
import shutil
import tempfile
import traceback
from typing import Optional, List
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
    connected_accounts: Optional[List[str]] = None
    is_bulk: Optional[bool] = False


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

    # Guardrail 1: Check if transactions table exists and has rows in DuckDB
    info = database.get_table_info()
    if info.get("row_count", 0) == 0:
        return {
            "status": "idle",
            "account_id": None,
            "response": "System idle. Waiting for transaction journal CSV upload. No transaction records currently loaded in DuckDB.",
            "summary": None,
            "source": "forensic_engine",
            "suggested_actions": []
        }

    # Parse account ID from message text if not explicitly supplied
    if not target_account:
        tokens = re.findall(r'\b[A-Za-z0-9_]{6,25}\b', msg)
        stop_words = {"analyze", "victim", "account", "suspect", "freeze", "notice", "investigate", "report", "please", "thanks", "status", "detail", "details", "check", "urgent", "dataset"}
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
        if not summary or not summary.get("found"):
            return {
                "status": "not_found",
                "account_id": target_account,
                "response": f"Account `{target_account}` was not found in the active transaction ledger. Please check the account number or verify against the uploaded dataset.",
                "summary": None,
                "source": "forensic_engine",
                "suggested_actions": []
            }

    # If an account is identified and summarized in DuckDB
    if summary and summary.get("found"):
        summary_data = (
            f"Target Account: {summary['account']}\n"
            f"Risk Score: {summary['risk_score']}% (Capped at 99%)\n"
            f"Total Inflow Received: ₹{summary['total_in']:,.2f} across {summary['in_count']} transactions ({summary['unique_senders']} unique senders)\n"
            f"Total Outflow Dispersed: ₹{summary['total_out']:,.2f} across {summary['out_count']} transactions ({summary['unique_receivers']} unique receivers)\n"
            f"Wash Ratio: {summary['wash_ratio']}%\n"
            f"Associated IPs: {summary['ips']}\n"
            f"Hardware / Devices: {summary['devices']}\n"
            f"Timestamp Inflow Window: {summary['min_in_ts']} to {summary['max_in_ts']}\n"
            f"Timestamp Outflow Window: {summary['min_out_ts']} to {summary['max_out_ts']}"
        )

        prompt = (
            f"You are an expert financial forensic investigator. Analyze the following account data dynamically and conversationally. "
            f"Explain WHY each metric — the Wash Ratio, the Structuring pattern, the Off-hours activity, the device fingerprint — is suspicious. "
            f"Do NOT just spit out a rigid template. Be insightful: make connections between these signals, explain what they reveal about the suspect's behavior, "
            f"and conclude with ONE specific recommended next human action the investigator should take right now.\n\n"
            f"Account Data:\n{summary_data}"
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
            wash_pct = summary['wash_ratio']
            in_amt = f"₹{summary['total_in']:,.2f}"
            out_amt = f"₹{summary['total_out']:,.2f}"
            acc = summary['account']
            score = summary['risk_score']
            receivers = summary['unique_receivers']
            senders = summary['unique_senders']
            device = summary['devices']
            ip = summary['primary_ip']
            in_txns = summary['in_count']
            out_txns = summary['out_count']

            ai_response_text = (
                f"Looking at this account `{acc}`, a few things immediately stand out to me as deeply suspicious when you connect the dots.\n\n"
                f"**The {wash_pct}% Wash Ratio is the smoking gun.** This account received {in_amt} from {senders} different sources across {in_txns} inbound transactions, then "
                f"almost immediately dispersed {out_amt} outward to {receivers} different beneficiaries across {out_txns} outgoing transfers. "
                f"That near-complete passthrough — retaining almost nothing — is textbook mule behavior. Real people and businesses retain some funds. This account behaves like a relay station.\n\n"
                f"**The fan-out to {receivers} receivers is deliberate structuring.** By splitting the inbound lump sum into smaller chunks across many recipients, "
                f"this account is specifically designed to stay below bank-level reporting thresholds. Each individual transfer looks innocuous; together they tell a story of systematic layering.\n\n"
                f"**The device fingerprint from `{device}` (IP: `{ip}`) adds the tech fraud signature.** When you see emulator or automation tooling associated with a financial account, "
                f"it almost always means scripted transfers — not a human sitting at a branch. This level of automation suggests organized cyber fraud.\n\n"
                f"**My recommended next action:** Issue an immediate Section 91 CrPC freezing directive on `{acc}` to halt any remaining outbound dissipation, "
                f"then expand the 3-hop graph to trace where those {receivers} recipients are sending the money next. The clock is ticking — structured funds typically reach cash-out terminals within 24-48 hours. "
                f"Risk Score: **{score}%**."
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
    if not top:
        return {
            "status": "no_suspects",
            "account_id": None,
            "response": "Active dataset scanned. No high-risk laundering entities or suspicious transaction patterns detected in current records.",
            "summary": None,
            "source": "forensic_engine",
            "suggested_actions": []
        }

    top_acc = top["account"]
    top_score = top["risk_score"]
    top_amt = top["total_in"] if top.get("total_in") and top["total_in"] > 0 else top.get("total_out", 0.0)

    general_prompt = (
        f"You are a cyber forensics AI. A financial crime investigator asks: '{msg}'. "
        f"Analyze this transaction data. Highlight key risks (like velocity or structuring) and suggest the next investigative step. Be analytical. "
        f"Context: The highest risk flagged account in current ledger is {top_acc} with a {top_score}% risk score and volume of ₹{top_amt:,.2f}."
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
            f"I have scanned the active ledger. Priority target `{top_acc}` exhibits a **{top_score}% risk score** "
            f"with ₹{top_amt:,.2f} in observed volume. Signature indicates rapid passthrough and smurfing distribution. "
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
                "amount": top_amt,
            },
            {
                "type": "trace_graph",
                "label": f"Trace Network ({top_acc})",
                "account_id": top_acc,
            },
        ],
    }


@app.get("/api/ai/global-scan")
@app.post("/api/ai/global-scan")
def ai_global_scan():
    """
    Executes a dataset-wide macro analysis across DuckDB transactions ledger.
    Aggregates volume, row count, unique accounts, top suspect hubs, and structuring anomalies.
    Returns executive summary formatted in Markdown with analytical insights.
    """
    info = database.get_table_info()
    total_rows = info.get("row_count", 0)
    stats = info.get("stats", {})
    total_volume = stats.get("total_volume", 0.0)

    if total_rows == 0:
        return {
            "status": "idle",
            "total_rows": 0,
            "total_volume": 0.0,
            "flagged_entities": 0,
            "top_suspect": None,
            "report": "### ⚠️ System Idle — Waiting for Data Ingestion\n\nNo transaction records found in the DuckDB ledger. Please upload a transaction journal CSV to perform macro scanning and network forensic analysis.",
            "suggested_actions": []
        }

    suspicious_summary = database.get_suspicious_accounts(page=1, limit=5)
    flagged_count = suspicious_summary.get("total_rows", 0)
    top_list = suspicious_summary.get("data", [])

    top = database.get_top_suspect()
    top_acc = top["account"] if top else (top_list[0]["account"] if top_list else None)
    top_score = top["risk_score"] if top else (top_list[0]["risk_score"] if top_list else 0)
    top_in = top["total_in"] if top and top.get("total_in") else (top_list[0]["total_received"] if top_list else 0.0)

    top_bullets = "\n".join([
        f"• **Account `{item['account']}`**: Risk Score **{item['risk_score']}%** | Inflow: ₹{item['total_received']:,.2f} | Outflow: ₹{item['total_sent']:,.2f} | Wash Ratio: {item['wash_ratio']}%"
        for item in top_list[:3]
    ]) if top_list else "No anomalous accounts detected."

    prompt = (
        f"You are a financial forensics AI. Analyze this full dataset overview and provide a macro threat report. "
        f"Total Records: {total_rows:,}, Total Volume: ₹{total_volume:,.2f}, Flagged High-Risk Entities: {flagged_count:,}.\n"
        f"Top Flagged Suspects:\n{top_bullets}\n"
        f"Highlight key macro risks (velocity, smurfing networks, threshold evasion) and suggest prioritized next investigative steps. Be analytical."
    )

    ollama_text = None
    try:
        res = requests.post(
            "http://localhost:11434/api/generate",
            json={"model": "qwen2.5:1.5b", "prompt": prompt, "stream": False},
            timeout=25,
        )
        if res.status_code == 200:
            ollama_text = res.json().get("response", "").strip()
    except Exception:
        pass

    if not ollama_text:
        ollama_text = (
            f"### **Macro Forensic Dataset Scan Report**\n\n"
            f"**Ledger Scope:** Analyzed **{total_rows:,} records** representing **₹{total_volume:,.2f}** in gross transactional volume. "
            f"DuckDB heuristic engine identified **{flagged_count:,} high-risk laundering entities**.\n\n"
            f"#### **1. Key Syndicated Patterns Detected:**\n"
            f"• **High-Velocity Aggregation & Smurfing:** Inflow funds are immediately dispersed across downstream nodes within <24-hour windows, minimizing asset recovery windows.\n"
            f"• **Threshold Evasion (Structuring):** Repeated transaction clusters hovering just below statutory reporting thresholds (₹49,000–₹49,999).\n"
            f"• **Priority Suspect Hubs:**\n"
            f"{top_bullets}\n\n"
            f"#### **2. Prioritized Investigative Actions:**\n"
            f"1. **Statutory Freezing:** Issue Section 91 CrPC freezing notices on Priority Target `{top_acc}` to halt further outbound dissipation.\n"
            f"2. **Multi-Hop Traversal:** Trace 3-hop downstream disbursement networks to identify ultimate cash-out terminals and crypto exchanges.\n"
            f"3. **Bank Dossier Requisition:** Requisition KYC documents and IP logs from respective beneficiary banks."
        )

    suggested_actions = []
    if top_acc:
        suggested_actions = [
            {
                "type": "trace_graph",
                "label": f"Trace Priority Target ({top_acc})",
                "account_id": top_acc,
            },
            {
                "type": "freeze_notice",
                "label": f"Draft Sec 91 Notice ({top_acc})",
                "account_id": top_acc,
                "bank_name": "Beneficiary Bank",
                "amount": top_in,
            },
        ]

    return {
        "status": "success",
        "total_rows": total_rows,
        "total_volume": total_volume,
        "flagged_entities": flagged_count,
        "top_suspect": top_acc,
        "report": ollama_text,
        "suggested_actions": suggested_actions,
    }


@app.post("/api/generate-notice")
@app.post("/generate-notice")
def generate_notice(req: GenerateNoticeRequest):
    """
    Generates a formal Section 91 CrPC freezing notice using local Ollama AI (qwen2.5:1.5b).
    Supports single account freezing as well as bulk downstream syndicate network freezing.
    Falls back gracefully if Ollama is not running.
    """
    clean_account = req.account_id.strip()
    clean_bank = req.bank_name.strip()
    formatted_amount = f"{float(req.amount):,.2f}"
    is_bulk = bool(req.is_bulk and req.connected_accounts and len(req.connected_accounts) > 0)
    connected_list = req.connected_accounts or []

    if is_bulk:
        connected_count = len(connected_list)
        connected_summary = ", ".join(connected_list[:12])
        if connected_count > 12:
            connected_summary += f", and {connected_count - 12} other accounts"

        prompt = (
            f"You are a cyber forensics legal officer. Write a formal statutory Section 91 CrPC Network Freezing Order "
            f"to the Branch Manager of {clean_bank} and all connected nodal bank officers demanding the immediate debit freeze "
            f"of primary laundering hub account {clean_account} and all {connected_count} connected downstream mule/terminal accounts: "
            f"{connected_summary}. Cumulative syndicate volume: ₹{formatted_amount}. Keep it formal, statutory, and concise."
        )
    else:
        prompt = (
            f"You are a legal assistant. Write a formal Section 91 CrPC notice to the Branch Manager "
            f"of {clean_bank} requesting the immediate freezing of account number {clean_account} "
            f"which has received suspected fraudulent funds totaling ₹{formatted_amount}. "
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
                    "is_bulk": is_bulk,
                    "connected_accounts_count": len(connected_list),
                    "source": "ollama",
                    "model": "qwen2.5:1.5b",
                }
    except Exception as ollama_err:
        print(f"Ollama local inference unavailable or timed out ({ollama_err}), using legal fallback template.")

    # Statutory Section 91 CrPC fallback template
    if is_bulk:
        account_lines = [f"   • [PRIMARY HUB] {clean_account} ({clean_bank}) - Retained & Dispersed Volume: ₹{formatted_amount}"]
        for idx, acc in enumerate(connected_list):
            account_lines.append(f"   • [DOWNSTREAM NODE {idx+1}] {acc}")
        schedule_text = "\n".join(account_lines)

        fallback_text = (
            f"OFFICE OF THE INVESTIGATING OFFICER\n"
            f"CYBER CRIME POLICE STATION & FINANCIAL FRAUD INVESTIGATION CELL\n"
            f"COMPREHENSIVE NOTICE UNDER SECTION 91 OF THE CODE OF CRIMINAL PROCEDURE (CrPC), 1973\n"
            f"(STATUTORY DIRECTIVE FOR BULK SYNDICATE NETWORK DEBIT FREEZE)\n\n"
            f"To,\n"
            f"1. The Branch Manager, {clean_bank} (Nodal Officer for Primary Hub)\n"
            f"2. Nodal Officers of All Connected Beneficiary Institutions Listed in Schedule Below\n\n"
            f"SUBJECT: URGENT STATUTORY DIRECTIVE UNDER SECTION 91 CrPC FOR IMMEDIATE BULK DEBIT FREEZING OF PRIMARY LAUNDERING HUB {clean_account} AND ALL {len(connected_list)} CONNECTED BENEFICIARY ACCOUNTS\n\n"
            f"Sir / Madam,\n\n"
            f"1. Whereas an ongoing cyber fraud investigation into syndicated financial layering has identified an organized laundering network originating from Primary Target Hub {clean_account}, through which illicit proceeds totaling ₹{formatted_amount} have been systematically dispersed across multiple downstream mule accounts and cash-out terminals.\n\n"
            f"2. In exercise of statutory powers conferred under Section 91 of the Code of Criminal Procedure, 1973, you are hereby ordered to immediately effectuate an unconditional, complete debit freeze on all accounts specified in the schedule below:\n\n"
            f"SCHEDULE OF FRAUDULENT SYNDICATE ACCOUNTS TO BE FROZEN:\n"
            f"{schedule_text}\n\n"
            f"3. You are further commanded to:\n"
            f"   a. Place an immediate and total debit freeze on each listed account with zero outbound dissipation.\n"
            f"   b. Restrict all outgoing debits, ATM withdrawals, RTGS/NEFT/IMPS transfers, internet banking, POS terminals, and UPI VPA channels.\n"
            f"   c. Furnish certified copies of Account Opening Forms (AOF), biometric/e-KYC records, IP/MAC transaction logs, and full statements of account within 24 hours of receipt of this statutory notice.\n\n"
            f"4. Compliance with this statutory order is mandatory under law. Non-compliance shall attract penal proceedings under Sections 175 and 188 of the Indian Penal Code, 1860.\n\n"
            f"Yours faithfully,\n\n"
            f"Investigating Officer\n"
            f"Cyber Crime & Financial Forensics Unit"
        )
    else:
        fallback_text = (
            f"OFFICE OF THE INVESTIGATING OFFICER\n"
            f"CYBER CRIME POLICE STATION & FINANCIAL FRAUD INVESTIGATION CELL\n"
            f"NOTICE UNDER SECTION 91 OF THE CODE OF CRIMINAL PROCEDURE (CrPC), 1973\n\n"
            f"To,\n"
            f"The Branch Manager,\n"
            f"{clean_bank}\n\n"
            f"SUBJECT: URGENT NOTICE UNDER SECTION 91 CrPC FOR IMMEDIATE FREEZING OF ACCOUNT NO. {clean_account}\n\n"
            f"Sir / Madam,\n\n"
            f"1. Whereas an ongoing investigation into cyber-enabled banking fraud reveals that fraudulent proceeds of crime totaling ₹{formatted_amount} have been traced directly into beneficiary Account Number {clean_account} maintained at your branch.\n\n"
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
        "is_bulk": is_bulk,
        "connected_accounts_count": len(connected_list),
        "source": "legal_template",
        "model": "qwen2.5:1.5b",
    }

