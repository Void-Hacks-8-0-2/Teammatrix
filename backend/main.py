import os
import shutil
import tempfile
import traceback
from typing import Optional
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
