import math
import os
import re
import threading
from typing import Any, Dict, List, Optional, Tuple
import duckdb

# Database path: persistent local DuckDB file
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fraud_data.duckdb")

_lock = threading.Lock()
_connection: Optional[duckdb.DuckDBPyConnection] = None


def get_connection() -> duckdb.DuckDBPyConnection:
    """Returns a shared, thread-safe DuckDB connection."""
    global _connection
    with _lock:
        if _connection is None:
            _connection = duckdb.connect(DB_PATH, read_only=False)
        return _connection


def init_db() -> None:
    """Initialize database and ensure the transactions schema is ready."""
    conn = get_connection()
    with _lock:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                sender VARCHAR,
                receiver VARCHAR,
                amount DOUBLE,
                timestamp VARCHAR
            )
        """)


def _clean_str(s: str) -> str:
    """Lowercase and remove non-alphanumeric characters for fuzzy matching."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _identify_columns(schema_info: List[Tuple]) -> Dict[str, str]:
    """
    Dynamically identifies the best candidate column for sender, receiver,
    amount, and timestamp using aliases, substrings, DuckDB types, and positions.
    """
    col_names = [row[0] for row in schema_info]
    col_types = {row[0]: str(row[1]).upper() for row in schema_info}

    clean_map = {col: _clean_str(col) for col in col_names}
    used: set = set()
    result: Dict[str, str] = {}

    sender_aliases = [
        "sender", "senderid", "senderaccount", "senders", "senderacc",
        "source", "sources", "sourceid", "sourceaccount", "src", "srcid", "srcacc",
        "from", "fromid", "fromaccount", "fromacc", "fromaccountno",
        "nameorig", "orig", "origin", "originator", "originaccount",
        "payer", "payerid", "payeraccount", "debitaccount", "debitor",
        "client", "clientid", "customer", "customerid", "custid",
        "account1", "acc1", "accountfrom"
    ]

    receiver_aliases = [
        "receiver", "receiverid", "receiveraccount", "receivers", "receiveracc",
        "recipient", "recipients", "recipientid", "recipientaccount",
        "target", "targets", "targetid", "targetaccount", "dst", "dstid", "dstacc",
        "to", "toid", "toaccount", "toacc", "toaccountno",
        "namedest", "dest", "destination", "destinationaccount",
        "payee", "payeeid", "payeeaccount", "beneficiary", "beneficiaryid",
        "beneficiaryaccount", "creditaccount", "creditor", "merchant", "merchantid",
        "account2", "acc2", "accountto"
    ]

    amount_aliases = [
        "amount", "amt", "value", "val", "transactionamount", "transamount",
        "transferamount", "txnamount", "sum", "total", "money", "volume"
    ]

    timestamp_aliases = [
        "timestamp", "time", "date", "datetime", "transdate", "transdatetime",
        "transactiondate", "createdat", "transtime", "step", "epoch", "timestamputc"
    ]

    # Exact alias matches
    for col, c_clean in clean_map.items():
        if "amount" not in result and c_clean in amount_aliases:
            result["amount"] = col
            used.add(col)
            break

    for col, c_clean in clean_map.items():
        if "timestamp" not in result and col not in used and c_clean in timestamp_aliases:
            result["timestamp"] = col
            used.add(col)
            break

    for col, c_clean in clean_map.items():
        if "sender" not in result and col not in used and c_clean in sender_aliases:
            result["sender"] = col
            used.add(col)
            break

    for col, c_clean in clean_map.items():
        if "receiver" not in result and col not in used and c_clean in receiver_aliases:
            result["receiver"] = col
            used.add(col)
            break

    # Substring matching
    if "sender" not in result:
        for col, c_clean in clean_map.items():
            if col not in used and any(k in c_clean for k in ["orig", "send", "from", "src", "payer"]):
                result["sender"] = col
                used.add(col)
                break

    if "receiver" not in result:
        for col, c_clean in clean_map.items():
            if col not in used and any(k in c_clean for k in ["dest", "receiv", "recip", "to", "target", "payee", "benef"]):
                result["receiver"] = col
                used.add(col)
                break

    if "amount" not in result:
        for col, c_clean in clean_map.items():
            if col not in used and any(k in c_clean for k in ["amt", "amount", "val", "sum"]):
                result["amount"] = col
                used.add(col)
                break

    if "timestamp" not in result:
        for col, c_clean in clean_map.items():
            if col not in used and any(k in c_clean for k in ["time", "date", "step"]):
                result["timestamp"] = col
                used.add(col)
                break

    # Data type & positional fallback
    if "amount" not in result:
        for col in col_names:
            if col not in used and any(t in col_types.get(col, "") for t in ["INT", "DOUBLE", "FLOAT", "DECIMAL", "NUMERIC"]):
                result["amount"] = col
                used.add(col)
                break

    if "timestamp" not in result:
        for col in col_names:
            if col not in used and any(t in col_types.get(col, "") for t in ["DATE", "TIME"]):
                result["timestamp"] = col
                used.add(col)
                break

    if "sender" not in result:
        for col in col_names:
            if col not in used:
                result["sender"] = col
                used.add(col)
                break

    if "receiver" not in result:
        for col in col_names:
            if col not in used:
                result["receiver"] = col
                used.add(col)
                break

    if "timestamp" not in result:
        leftover = [c for c in col_names if c not in used]
        if leftover:
            result["timestamp"] = leftover[0]
            used.add(leftover[0])
        else:
            result["timestamp"] = result.get("sender", col_names[0])

    return result


def ingest_csv(file_path: str) -> Dict[str, Any]:
    """
    Ingests CSV file directly into DuckDB `transactions` table using read_csv_auto().
    Dynamically maps and standardizes columns to (sender, receiver, amount, timestamp).
    """
    conn = get_connection()
    with _lock:
        schema_info = conn.execute("DESCRIBE SELECT * FROM read_csv_auto(?)", [file_path]).fetchall()
        col_mapping = _identify_columns(schema_info)

        sender_col = col_mapping["sender"].replace('"', '""')
        receiver_col = col_mapping["receiver"].replace('"', '""')
        amount_col = col_mapping["amount"].replace('"', '""')
        timestamp_col = col_mapping["timestamp"].replace('"', '""')

        query = f"""
            CREATE OR REPLACE TABLE transactions AS
            SELECT 
                CAST("{sender_col}" AS VARCHAR) AS sender,
                CAST("{receiver_col}" AS VARCHAR) AS receiver,
                COALESCE(TRY_CAST("{amount_col}" AS DOUBLE), 0.0) AS amount,
                CAST("{timestamp_col}" AS VARCHAR) AS timestamp
            FROM read_csv_auto(?)
        """
        conn.execute(query, [file_path])

        count_res = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()
        row_count = count_res[0] if count_res else 0

        preview_rows = conn.execute("""
            SELECT sender, receiver, amount, timestamp 
            FROM transactions 
            LIMIT 50
        """).fetchall()

        preview = [
            {
                "sender": str(r[0]) if r[0] is not None else "",
                "receiver": str(r[1]) if r[1] is not None else "",
                "amount": float(r[2]) if r[2] is not None else 0.0,
                "timestamp": str(r[3]) if r[3] is not None else "",
            }
            for r in preview_rows
        ]

        stats = conn.execute("""
            SELECT 
                COUNT(DISTINCT sender) as unique_senders,
                COUNT(DISTINCT receiver) as unique_receivers,
                COALESCE(SUM(amount), 0) as total_volume
            FROM transactions
        """).fetchone()

        return {
            "row_count": row_count,
            "columns": ["sender", "receiver", "amount", "timestamp"],
            "detected_mapping": col_mapping,
            "preview": preview,
            "stats": {
                "unique_senders": stats[0] if stats else 0,
                "unique_receivers": stats[1] if stats else 0,
                "total_volume": round(float(stats[2]), 2) if stats else 0.0,
            },
        }


def get_transactions_paginated(page: int = 1, limit: int = 50) -> Dict[str, Any]:
    """Returns paginated transactions using DuckDB LIMIT and OFFSET."""
    conn = get_connection()
    with _lock:
        try:
            count_res = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()
            total_rows = count_res[0] if count_res else 0
        except Exception:
            return {
                "total_rows": 0,
                "page": page,
                "limit": limit,
                "total_pages": 0,
                "data": [],
            }

        total_pages = math.ceil(total_rows / limit) if total_rows > 0 else 0
        current_page = max(1, page)
        offset = (current_page - 1) * limit

        rows = conn.execute("""
            SELECT sender, receiver, amount, timestamp 
            FROM transactions 
            LIMIT ? OFFSET ?
        """, [limit, offset]).fetchall()

        data = [
            {
                "sender": str(r[0]) if r[0] is not None else "",
                "receiver": str(r[1]) if r[1] is not None else "",
                "amount": float(r[2]) if r[2] is not None else 0.0,
                "timestamp": str(r[3]) if r[3] is not None else "",
            }
            for r in rows
        ]

        return {
            "total_rows": total_rows,
            "page": current_page,
            "limit": limit,
            "total_pages": total_pages,
            "data": data,
        }


def trace_victim_network(victim_id: str) -> Dict[str, Any]:
    """
    Executes a high-performance Recursive CTE up to 3 hops starting from `victim_id`.
    Applies cycle prevention using path array tracking.
    Formats results strictly into graph-ready JSON payload with:
      - `nodes`: [{ id: string, group: number }] (0=Victim, 1=Layer 1, 2=Layer 2, 3=Layer 3)
      - `links`: [{ source: string, target: string, amount: float, timestamp: string, hop: number }]
    """
    clean_id = victim_id.strip()
    if not clean_id:
        return {
            "status": "error",
            "error_code": "EMPTY_ID",
            "message": "Victim Account ID cannot be empty.",
        }

    conn = get_connection()
    with _lock:
        try:
            count_res = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()
            if not count_res or count_res[0] == 0:
                return {
                    "status": "error",
                    "error_code": "EMPTY_DATABASE",
                    "message": "No transactions loaded in the database. Please ingest a CSV file first.",
                }
        except Exception:
            return {
                "status": "error",
                "error_code": "TABLE_NOT_FOUND",
                "message": "Transactions database table is not ready.",
            }

        # Check if victim account exists as sender (exact or case-insensitive)
        match = conn.execute("SELECT sender FROM transactions WHERE sender = ? LIMIT 1", [clean_id]).fetchone()
        if not match:
            case_match = conn.execute("SELECT sender FROM transactions WHERE UPPER(sender) = UPPER(?) LIMIT 1", [clean_id]).fetchone()
            if case_match:
                clean_id = case_match[0]
            else:
                return {
                    "status": "error",
                    "error_code": "ACCOUNT_NOT_FOUND",
                    "message": f"Account '{clean_id}' was not found as a sender in the transactions database.",
                }

        # High-performance 3-hop recursive CTE with cycle prevention
        query = """
        WITH RECURSIVE trace_network AS (
            -- Anchor: Hop 1 (Victim to Layer 1 Mules)
            SELECT 
                sender AS source,
                receiver AS target,
                amount,
                timestamp,
                1 AS hop,
                [sender, receiver] AS path
            FROM transactions
            WHERE sender = ?

            UNION ALL

            -- Recursive: Layer 2 and Layer 3 Smurfing / Terminal nodes
            SELECT 
                t.sender AS source,
                t.receiver AS target,
                t.amount,
                t.timestamp,
                tn.hop + 1 AS hop,
                list_append(tn.path, t.receiver) AS path
            FROM transactions t
            JOIN trace_network tn ON t.sender = tn.target
            WHERE tn.hop < 3
              AND NOT list_contains(tn.path, t.receiver)
        )
        SELECT source, target, amount, timestamp, hop 
        FROM trace_network 
        ORDER BY timestamp ASC;
        """

        rows = conn.execute(query, [clean_id]).fetchall()

        if not rows:
            return {
                "status": "success",
                "victim_id": clean_id,
                "nodes": [{"id": clean_id, "group": 0}],
                "links": [],
                "layer_summary": {"victim": 1, "layer_1": 0, "layer_2": 0, "layer_3": 0},
                "total_nodes": 1,
                "total_links": 0,
                "total_volume": 0.0,
                "message": f"No outbound transaction trails found originating from '{clean_id}'.",
            }

        # Format into graph-ready nodes and links
        node_groups: Dict[str, int] = {clean_id: 0}
        links: List[Dict[str, Any]] = []
        total_volume = 0.0

        for src, tgt, amt, ts, hop in rows:
            amount_val = float(amt) if amt is not None else 0.0
            total_volume += amount_val
            links.append({
                "source": str(src),
                "target": str(tgt),
                "amount": amount_val,
                "timestamp": str(ts),
                "hop": int(hop),
            })

            # Assign lowest hop group for each node (Victim=0, L1=1, L2=2, L3=3)
            if tgt not in node_groups or hop < node_groups[tgt]:
                node_groups[tgt] = int(hop)

        nodes = [{"id": node_id, "group": group} for node_id, group in node_groups.items()]

        # Sort nodes by group for clean presentation
        nodes.sort(key=lambda n: (n["group"], n["id"]))

        layer_summary = {
            "victim": 1,
            "layer_1": sum(1 for n in nodes if n["group"] == 1),
            "layer_2": sum(1 for n in nodes if n["group"] == 2),
            "layer_3": sum(1 for n in nodes if n["group"] == 3),
        }

        return {
            "status": "success",
            "victim_id": clean_id,
            "nodes": nodes,
            "links": links,
            "layer_summary": layer_summary,
            "total_nodes": len(nodes),
            "total_links": len(links),
            "total_volume": round(total_volume, 2),
        }


def get_table_info() -> Dict[str, Any]:
    """Returns the current state and summary metrics of transactions table."""
    conn = get_connection()
    with _lock:
        try:
            count = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
            stats = conn.execute("""
                SELECT 
                    COUNT(DISTINCT sender) as unique_senders,
                    COUNT(DISTINCT receiver) as unique_receivers,
                    COALESCE(SUM(amount), 0) as total_volume
                FROM transactions
            """).fetchone()

            return {
                "exists": True,
                "row_count": count,
                "stats": {
                    "unique_senders": stats[0] if stats else 0,
                    "unique_receivers": stats[1] if stats else 0,
                    "total_volume": round(float(stats[2]), 2) if stats else 0.0,
                },
            }
        except Exception:
            return {"exists": False, "row_count": 0, "stats": {}}


def get_suspicious_accounts(limit: int = 50) -> List[Dict[str, Any]]:
    """
    Auto-detects flagged suspicious money laundering hub accounts.
    Analyzes:
      - High distinct sender fan-in (mule aggregator)
      - High outbound receiver dispersion (layering smurf)
      - Rapid turnover volume and wash ratios.
    """
    conn = get_connection()
    with _lock:
        try:
            query = """
            WITH in_stats AS (
                SELECT 
                    receiver AS account, 
                    COUNT(DISTINCT sender) AS in_senders, 
                    COUNT(*) AS in_count, 
                    COALESCE(SUM(amount), 0) AS total_in
                FROM transactions 
                GROUP BY receiver
            ),
            out_stats AS (
                SELECT 
                    sender AS account, 
                    COUNT(DISTINCT receiver) AS out_receivers, 
                    COUNT(*) AS out_count, 
                    COALESCE(SUM(amount), 0) AS total_out
                FROM transactions 
                GROUP BY sender
            )
            SELECT 
                COALESCE(i.account, o.account) AS account,
                COALESCE(i.in_senders, 0) AS in_senders,
                COALESCE(i.in_count, 0) AS in_count,
                ROUND(COALESCE(i.total_in, 0), 2) AS total_in,
                COALESCE(o.out_receivers, 0) AS out_receivers,
                COALESCE(o.out_count, 0) AS out_count,
                ROUND(COALESCE(o.total_out, 0), 2) AS total_out
            FROM in_stats i
            FULL OUTER JOIN out_stats o ON i.account = o.account
            WHERE (i.in_senders >= 2 OR o.out_receivers >= 3 OR i.total_in >= 50000 OR o.total_out >= 50000)
            ORDER BY (COALESCE(i.total_in, 0) + COALESCE(o.total_out, 0)) DESC
            LIMIT ?;
            """
            rows = conn.execute(query, [limit]).fetchall()

            flagged = []
            for acc, in_senders, in_count, total_in, out_receivers, out_count, total_out in rows:
                if not acc:
                    continue

                total_volume = round(float(total_in) + float(total_out), 2)
                total_txns = in_count + out_count

                # Wash ratio (percentage of funds passed through)
                wash_ratio = 0.0
                if total_in > 0 and total_out > 0:
                    wash_ratio = round((min(total_in, total_out) / max(total_in, total_out)) * 100, 1)

                # Dynamic Risk Score (60 - 99)
                score = 55
                reasons = []

                if in_senders >= 4:
                    score += 15
                    reasons.append(f"High-Density Funnel ({in_senders} distinct senders)")
                elif in_senders >= 2:
                    score += 8
                    reasons.append(f"Multi-Source Inflow ({in_senders} senders)")

                if out_receivers >= 15:
                    score += 15
                    reasons.append(f"Rapid Layering Smurf ({out_receivers} outbound targets)")
                elif out_receivers >= 5:
                    score += 10
                    reasons.append(f"Dispersal Fan-Out ({out_receivers} targets)")

                if total_volume >= 2000000:
                    score += 10
                    reasons.append(f"Extreme Volume Velocity (${total_volume:,.0f})")
                elif total_volume >= 500000:
                    score += 5
                    reasons.append(f"Substantial Volume (${total_volume:,.0f})")

                if wash_ratio >= 80:
                    score += 10
                    reasons.append(f"Layering Pass-Through Wash ({wash_ratio}% turnover)")

                score = min(99, max(60, score))

                if score >= 90:
                    risk_level = "CRITICAL"
                elif score >= 75:
                    risk_level = "HIGH"
                else:
                    risk_level = "ELEVATED"

                flagged.append({
                    "account": str(acc),
                    "total_received": float(total_in),
                    "total_sent": float(total_out),
                    "total_volume": float(total_volume),
                    "transaction_count": int(total_txns),
                    "unique_senders": int(in_senders),
                    "unique_receivers": int(out_receivers),
                    "wash_ratio": float(wash_ratio),
                    "risk_score": int(score),
                    "risk_level": risk_level,
                    "flag_reasons": reasons,
                })

            return flagged
        except Exception as e:
            print(f"Error querying suspicious accounts: {e}")
            return []

