#!/bin/bash
set -e
python3 -m venv python/venv
source python/venv/bin/activate
pip install -r requirements.txt
echo "Python venv setup complete"
