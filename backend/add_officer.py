#!/usr/bin/env python3
"""
CLI Tool: add_officer.py
Provision authorized law enforcement officer accounts into local offline SQLite (officers.db).
Usage:
    python add_officer.py
    python add_officer.py <username> <password>
"""

import sys
import os
import sqlite3
import argparse
from passlib.context import CryptContext

# Fix Windows console UTF-8 output
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass


# Path to local SQLite database
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "officers.db")

# Setup password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def init_db(conn):
    """Ensure the users table exists in officers.db."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            hashed_password TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.commit()


def main():
    parser = argparse.ArgumentParser(description="Provision offline Law Enforcement Officer accounts.")
    parser.add_argument("username", nargs="?", help="Officer Username (optional, prompts if omitted)")
    parser.add_argument("password", nargs="?", help="Officer Password (optional, prompts if omitted)")
    args = parser.parse_args()

    print("\n==============================================================")
    print("  OPERATION ABHEDYA-CHAKRA | OFFICER CREDENTIAL PROVISIONING ")
    print("  100% Offline Air-Gapped Authentication System (SQLite / JWT)")
    print("==============================================================\n")

    username = args.username
    if not username:
        try:
            username = input("New Officer Username: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nAborted.")
            sys.exit(1)

    if not username:
        print("❌ Error: Username cannot be blank.")
        sys.exit(1)

    password = args.password
    if not password:
        try:
            password = input("Password: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nAborted.")
            sys.exit(1)

    if not password:
        print("❌ Error: Password cannot be blank.")
        sys.exit(1)

    # Securely hash the password using passlib[bcrypt]
    hashed_password = pwd_context.hash(password)

    conn = sqlite3.connect(DB_PATH)
    try:
        init_db(conn)
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
        existing = cursor.fetchone()

        if existing:
            cursor.execute("UPDATE users SET hashed_password = ? WHERE username = ?", (hashed_password, username))
            conn.commit()
            print(f"ℹ️ Updated existing officer credentials for [{username}].")
        else:
            cursor.execute("INSERT INTO users (username, hashed_password) VALUES (?, ?)", (username, hashed_password))
            conn.commit()

        print(f"✅ Officer account [{username}] provisioned securely.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
