#!/bin/bash
# Double-click this file to start the Expense Tracker, then keep this window open while you use it.
cd "$(dirname "$0")"
echo "Close this window (or press Ctrl+C) to stop it."
(sleep 1; open "http://localhost:8000") &
exec python3 serve.py
