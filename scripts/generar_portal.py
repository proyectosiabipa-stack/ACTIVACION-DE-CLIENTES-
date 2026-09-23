#!/usr/bin/env python3
import json
from pathlib import Path

DATA_FILE = Path("portal/data.json")
PORTAL_DIR = Path("portal")

def generar_portal():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        data_js_content = f"// Auto-generado
const PORTAL_DATA = {json.dumps(data, ensure_ascii=False, indent=2)};"
        
        with open(PORTAL_DIR / "data.js", "w", encoding="utf-8") as f:
            f.write(data_js_content)
        
        print(f"✓ Portal actualizado")
        
    except Exception as e:
        print(f"✗ Error: {e}")
        raise

if __name__ == "__main__":
    generar_portal()